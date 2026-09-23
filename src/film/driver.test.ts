import type { FrameClock } from '../engine';
import { createStubCanvas, flushTasks, installDomStub } from '../testing/domStub';
import type { DomStub, StubCanvas } from '../testing/domStub';
import { installExportStub, installResizeObserverStub } from '../testing/exportStub';
import { close, equal, ok, quiet, suite } from '../testing/harness';
import type {
  FilmController,
  FilmOptions,
  Segment,
  SegmentContext,
  SegmentHandle,
} from './film';
import { directedSegment, isFilmError, runFilm } from './film';
import { planFilm, resolveSubtitleVisual, subtitleSafeBottom } from './timeline';

/**
 * 驱动器用例:不接真 Scene,只用可控的假分段验证调度本身。
 * 桩画布没有 parentElement,白闪/字幕/进度条那套 DOM 不会创建;
 * 转场由白闪模型逐帧推进(与有没有 DOM 无关),不关心转场的用例一律 transition: 0。
 */
interface FakeSegment extends Segment {
  finish(): void;
  fail(error: unknown): void;
  elapsed: number;
  disposeCount: number;
}

function fakeSegment(
  name: string,
  log: string[],
  duration = 1,
  hooks?: { onSetPaused?: (p: boolean) => void },
): FakeSegment {
  let resolveDone: (() => void) | null = null;
  let rejectDone: ((e: unknown) => void) | null = null;
  const seg: FakeSegment = {
    name,
    duration,
    elapsed: 0,
    disposeCount: 0,
    play(): SegmentHandle {
      log.push(`play:${name}`);
      const done = new Promise<void>((resolve, reject) => {
        resolveDone = resolve;
        rejectDone = reject;
      });
      return {
        done,
        dispose: () => {
          log.push(`dispose:${name}`);
          seg.disposeCount += 1;
          resolveDone?.();
        },
        resize: () => undefined,
        getElapsed: () => seg.elapsed,
        setPaused: (p: boolean) => {
          log.push(`paused:${name}:${p}`);
          hooks?.onSetPaused?.(p);
        },
      };
    },
    finish: () => resolveDone?.(),
    fail: (e: unknown) => rejectDone?.(e),
  };
  return seg;
}

function brokenSegment(name: string, log: string[]): Segment {
  return {
    name,
    duration: 1,
    play(): SegmentHandle {
      log.push(`throw:${name}`);
      throw new Error(`${name} 起不来`);
    },
  };
}

/** 跟时钟走的假分段:elapsed 读挂载时给的时钟;没给时钟就静止(模拟墙钟段)。 */
interface ClockProbe extends Segment {
  finish(): void;
  playCount: number;
  contexts: (SegmentContext | undefined)[];
}

function clockProbe(name: string, duration: number, log: string[]): ClockProbe {
  let resolveDone: (() => void) | null = null;
  const seg: ClockProbe = {
    name,
    duration,
    playCount: 0,
    contexts: [],
    play(_canvas: HTMLCanvasElement, context?: SegmentContext): SegmentHandle {
      seg.playCount += 1;
      seg.contexts.push(context);
      log.push(`play:${name}`);
      const clock = context?.clock;
      const t0 = clock?.now() ?? 0;
      const done = new Promise<void>((r) => {
        resolveDone = r;
      });
      return {
        done,
        dispose: () => {
          log.push(`dispose:${name}`);
          resolveDone?.();
        },
        resize: () => undefined,
        getElapsed: () => (clock ? Math.max(0, (clock.now() - t0) / 1000) : 0),
        setPaused: () => undefined,
      };
    },
    finish: () => resolveDone?.(),
  };
  return seg;
}

/** 前 failTimes 次起播抛错、之后正常的时钟分段。 */
function flakyProbe(name: string, duration: number, log: string[], failTimes: number): ClockProbe {
  const inner = clockProbe(name, duration, log);
  let attempts = 0;
  return {
    ...inner,
    play(canvas: HTMLCanvasElement, context?: SegmentContext): SegmentHandle {
      attempts += 1;
      if (attempts <= failTimes) {
        log.push(`throw:${name}`);
        throw new Error(`${name} 第 ${attempts} 次起不来`);
      }
      return inner.play(canvas, context);
    },
  };
}

/** 跳转并把快进泵完:快进每步恰好一个宏任务,turns 给足步数就确定收敛。 */
async function seekAndSettle(
  film: FilmController,
  seconds: number,
  turns = 160,
): Promise<void> {
  film.seekToTime(seconds);
  for (let i = 0; i < turns; i++) {
    await flushTasks();
  }
}

async function withStub(body: (dom: DomStub) => Promise<void>): Promise<void> {
  const dom = installDomStub();
  try {
    await body(dom);
  } finally {
    dom.restore();
  }
}

/** 推进若干帧并把微任务跑空。 */
async function run(dom: DomStub, frames = 20): Promise<void> {
  for (let i = 0; i < frames; i++) {
    dom.frame(16);
    await dom.flush();
  }
}

const plays = (log: readonly string[]): string =>
  log.filter((l) => l.startsWith('play:')).join('|');

const instant: FilmOptions = { transition: 0 };

/** 记录 resize 收到的上下文的分段。 */
function resizingSegment(name: string, log: string[], contexts: SegmentContext[], subtitles?: Segment['subtitles']): Segment {
  return {
    name,
    duration: 3,
    ...(subtitles ? { subtitles } : {}),
    play(): SegmentHandle {
      log.push(`play:${name}`);
      return {
        done: new Promise<void>(() => undefined),
        dispose: () => undefined,
        resize: (context?: SegmentContext) => {
          contexts.push(context ?? {});
        },
        getElapsed: () => 0,
        setPaused: () => undefined,
      };
    },
  };
}

/** 手动推进的帧时钟(注入 FilmOptions.clock)。 */
function manualClock(): FrameClock & { step(dtMs?: number): void; pending(): number } {
  let now = 1000;
  let nextId = 1;
  const queue = new Map<number, (time: number) => void>();
  return {
    now: () => now,
    request: (cb) => {
      const id = nextId++;
      queue.set(id, cb);
      return id;
    },
    cancel: (id) => {
      queue.delete(id);
    },
    step(dtMs = 16) {
      now += dtMs;
      const due = [...queue.values()];
      queue.clear();
      for (const cb of due) {
        cb(now);
      }
    },
    pending: () => queue.size,
  };
}

export default suite('film 驱动器', [
  [
    '按顺序播放,一段播完才进下一段',
    () =>
      withStub(async (dom) => {
        const log: string[] = [];
        const a = fakeSegment('A', log);
        const b = fakeSegment('B', log);
        const film = runFilm(dom.canvas(), [a, b], { ...instant, loop: false });
        await run(dom, 3);
        equal(plays(log), 'play:A');
        a.finish();
        await run(dom, 3);
        equal(plays(log), 'play:A|play:B');
        film();
      }),
  ],
  [
    'loop:false 播完后 seekTo 能把播放器叫醒,并且落在目标段上',
    () =>
      withStub(async (dom) => {
        const log: string[] = [];
        const segs = ['A', 'B', 'C'].map((n) => fakeSegment(n, log));
        const film = runFilm(dom.canvas(), segs, { ...instant, loop: false });
        for (const s of segs) {
          await run(dom, 2);
          s.finish();
        }
        await run(dom, 4);
        equal(film.getState().mode, 'ended');
        log.length = 0;
        film.seekTo(1);
        await run(dom, 4);
        // 关键:不能因为重起驱动与唤醒当前段的顺序而跳过 B 落到 C。
        equal(plays(log), 'play:B');
        film();
      }),
  ],
  [
    '播放中 seekTo 切到目标段并释放旧段',
    () =>
      withStub(async (dom) => {
        const log: string[] = [];
        const segs = ['A', 'B', 'C'].map((n) => fakeSegment(n, log));
        const film = runFilm(dom.canvas(), segs, instant);
        await run(dom, 3);
        log.length = 0;
        film.seekTo(2);
        await run(dom, 4);
        ok(log.includes('dispose:A'), `旧段没释放:${log.join('|')}`);
        equal(plays(log), 'play:C');
        film();
      }),
  ],
  [
    'seekTo 非有限值被忽略,不会把播放器杀掉',
    () =>
      withStub(async (dom) => {
        const log: string[] = [];
        const a = fakeSegment('A', log);
        const b = fakeSegment('B', log);
        const film = runFilm(dom.canvas(), [a, b], instant);
        await run(dom, 3);
        film.seekTo(Number.NaN);
        film.seekTo(Number.POSITIVE_INFINITY);
        await run(dom, 3);
        equal(log.join('|'), 'play:A|paused:A:false', `实际:${log.join('|')}`);
        a.finish();
        await run(dom, 3);
        ok(log.includes('play:B'), '忽略非法跳转后应照常播下去');
        film();
      }),
  ],
  [
    '所有分段都启动失败时停下来,而不是同步自旋把页面锁死',
    () =>
      withStub(async (dom) => {
        const log: string[] = [];
        await quiet(async () => {
          const film = runFilm(
            dom.canvas(),
            [brokenSegment('A', log), brokenSegment('B', log)],
            { ...instant, loop: true },
          );
          await run(dom, 3);
          equal(film.getState().mode, 'ended');
          film();
        });
        // 每段各试一次就停,不会无限重试。
        equal(log.length, 2, `重试了 ${log.length} 次`);
      }),
  ],
  [
    '单段启动失败只跳过它自己,错误交给 onError',
    () =>
      withStub(async (dom) => {
        const log: string[] = [];
        const errors: string[] = [];
        const good = fakeSegment('GOOD', log);
        const film = runFilm(dom.canvas(), [brokenSegment('BAD', log), good], {
          ...instant,
          loop: false,
          onError: (_e, info) => errors.push(`${info.segment}:${info.phase}`),
        });
        await run(dom, 4);
        ok(log.includes('play:GOOD'), `实际:${log.join('|')}`);
        equal(errors.join('|'), 'BAD:start');
        film();
      }),
  ],
  [
    'dispose 同步释放当前分段,每个句柄恰好释放一次',
    () =>
      withStub(async (dom) => {
        const log: string[] = [];
        const a = fakeSegment('A', log);
        const film = runFilm(dom.canvas(), [a], instant);
        await run(dom, 3);
        film.dispose();
        equal(a.disposeCount, 1, 'dispose 没有同步释放');
        await run(dom, 5);
        equal(a.disposeCount, 1, `驱动醒来后又释放了一次:${log.join('|')}`);
        film();
        equal(film.getState().mode, 'disposed');
      }),
  ],
  [
    '空清单不抛错,导出返回 no-segments',
    () =>
      withStub(async (dom) => {
        const film = runFilm(dom.canvas(), []);
        let code = '';
        await film.exportVideo().done.catch((e: unknown) => {
          code = isFilmError(e) ? e.code : 'other';
        });
        equal(code, 'no-segments');
        film.seekTo(3);
        film.setPaused(true);
        film();
      }),
  ],
  [
    'onSegment 抛错只记日志,播放继续;在 onSegment 里销毁播放器就不再起分段',
    () =>
      withStub(async (dom) => {
        const log: string[] = [];
        const a = fakeSegment('A', log);
        const b = fakeSegment('B', log);
        await quiet(async () => {
          const film = runFilm(dom.canvas(), [a, b], {
            ...instant,
            onSegment: (i) => {
              if (i === 1) {
                throw new Error('宿主回调炸了');
              }
            },
          });
          await run(dom, 2);
          a.finish();
          await run(dom, 3);
          ok(log.includes('play:B'), `回调抛错把播放器带崩了:${log.join('|')}`);
          film();
        });
        const log2: string[] = [];
        const c = fakeSegment('C', log2);
        const d = fakeSegment('D', log2);
        let film2: (() => void) | null = null;
        film2 = runFilm(dom.canvas(), [c, d], {
          ...instant,
          onSegment: (i) => {
            if (i === 1) {
              film2?.();
            }
          },
        });
        await run(dom, 2);
        c.finish();
        await run(dom, 3);
        ok(!log2.includes('play:D'), `销毁后还起了分段:${log2.join('|')}`);
      }),
  ],
  [
    '分段 done reject:报告 play 阶段错误并继续下一段,不留未处理拒绝',
    () =>
      withStub(async (dom) => {
        const log: string[] = [];
        const errors: string[] = [];
        const unhandled: unknown[] = [];
        const onUnhandled = (e: unknown): void => {
          unhandled.push(e);
        };
        // 应用的 tsconfig 不带 node 类型:经 globalThis 取 process。
        const proc = (
          globalThis as unknown as {
            process: {
              on(event: string, fn: (e: unknown) => void): void;
              off(event: string, fn: (e: unknown) => void): void;
            };
          }
        ).process;
        proc.on('unhandledRejection', onUnhandled);
        try {
          const a = fakeSegment('A', log);
          const b = fakeSegment('B', log);
          const film = runFilm(dom.canvas(), [a, b], {
            ...instant,
            onError: (_e, info) => errors.push(`${info.segment}:${info.phase}`),
          });
          await run(dom, 2);
          a.fail(new Error('时间线炸了'));
          await run(dom, 3);
          await new Promise((r) => setTimeout(r, 0));
          equal(errors.join('|'), 'A:play');
          ok(log.includes('play:B'), `没有切到下一段:${log.join('|')}`);
          film();
        } finally {
          proc.off('unhandledRejection', onUnhandled);
        }
        equal(unhandled.length, 0, '出现了未处理的拒绝');
      }),
  ],
  [
    '驱动异常退出时释放当前分段,不让它继续占着画布',
    () =>
      withStub(async (dom) => {
        const log: string[] = [];
        const bad = fakeSegment('BAD', log, 1, {
          onSetPaused: () => {
            throw new Error('setPaused 炸了');
          },
        });
        await quiet(async () => {
          const film = runFilm(dom.canvas(), [bad], instant);
          await run(dom, 3);
          equal(bad.disposeCount, 1, `崩溃后分段没释放:${log.join('|')}`);
          equal(film.getState().mode, 'ended');
          film();
        });
      }),
  ],
  [
    '片尾淡出期间点的跳转立即兑现(loop:false 也不会就此停掉)',
    () =>
      withStub(async (dom) => {
        const log: string[] = [];
        const a = fakeSegment('A', log);
        const b = fakeSegment('B', log);
        const film = runFilm(dom.canvas(), [a, b], { transition: 0.2, loop: false });
        await run(dom, 20);
        a.finish();
        await run(dom, 40);
        equal(plays(log), 'play:A|play:B');
        b.finish();
        await run(dom, 3); // 淡出进行中
        film.seekTo(0);
        await run(dom, 40);
        equal(plays(log), 'play:A|play:B|play:A', `实际:${log.join('|')}`);
        film();
      }),
  ],
  [
    '暂停态跟着新分段走:暂停中跳转,新段也是暂停的',
    () =>
      withStub(async (dom) => {
        const log: string[] = [];
        const a = fakeSegment('A', log);
        const b = fakeSegment('B', log);
        const paused: boolean[] = [];
        const film = runFilm(dom.canvas(), [a, b], {
          ...instant,
          onPausedChange: (p) => paused.push(p),
        });
        await run(dom, 2);
        film.setPaused(true);
        film.seekTo(1);
        await run(dom, 3);
        ok(log.includes('paused:B:true'), `新段没有接上暂停态:${log.join('|')}`);
        equal(paused.join(','), 'true');
        equal(film.getState().mode, 'paused');
        film();
      }),
  ],
  [
    'loop:false 播完:位置停在全片末尾(不倒退),触发 onEnded',
    () =>
      withStub(async (dom) => {
        const log: string[] = [];
        const a = fakeSegment('A', log, 2);
        const b = fakeSegment('B', log, 3);
        let ended = 0;
        const film = runFilm(dom.canvas(), [a, b], {
          ...instant,
          loop: false,
          onEnded: () => {
            ended += 1;
          },
        });
        await run(dom, 2);
        a.elapsed = 2;
        a.finish();
        await run(dom, 2);
        equal(film.getState().position, 2);
        b.elapsed = 3;
        b.finish();
        await run(dom, 3);
        const state = film.getState();
        equal(state.mode, 'ended');
        equal(state.position, 5, `片尾进度倒退了:${state.position}`);
        equal(ended, 1);
        film();
      }),
  ],
  [
    '暂停冻结转场:暂停在淡出途中不会切到下一段',
    () =>
      withStub(async (dom) => {
        const log: string[] = [];
        const a = fakeSegment('A', log);
        const b = fakeSegment('B', log);
        const film = runFilm(dom.canvas(), [a, b], { transition: 0.2 });
        await run(dom, 20);
        a.finish();
        await run(dom, 3); // 淡出进行中
        film.setPaused(true);
        await run(dom, 60);
        equal(plays(log), 'play:A', `暂停着切段了:${log.join('|')}`);
        film.setPaused(false);
        // 淡出暂停前只走了约 50ms,恢复后还要接着走完剩下的,而不是一下跳到头。
        await run(dom, 2);
        equal(plays(log), 'play:A', '恢复后转场一下跳到了头');
        await run(dom, 40);
        equal(plays(log), 'play:A|play:B');
        film();
      }),
  ],
  [
    '尺寸变化(不翻转)时当前段拿到按新字号重算的安全区;没有字幕的段不设安全区',
    () =>
      withStub(async (dom) => {
        const ro = installResizeObserverStub();
        try {
          const canvas = dom.canvas();
          const size = canvas as unknown as StubCanvas;
          const log: string[] = [];
          const withSubs: SegmentContext[] = [];
          const plain: SegmentContext[] = [];
          const segs = [
            resizingSegment('A', log, withSubs, [{ start: 0, end: 3, text: '甲' }]),
            resizingSegment('B', log, plain),
          ];
          const film = runFilm(canvas, segs, instant);
          await run(dom, 2);
          const plan = planFilm(segs);
          const expected = (width: number): number =>
            subtitleSafeBottom(resolveSubtitleVisual(width, undefined, plan, 'sans-serif'));
          ok(expected(600) !== expected(1280), '两种宽度的安全区应当不同,否则这条用例测不出东西');
          ro.resize(size, 600, 400);
          equal(withSubs.at(-1)?.safeArea?.bottom, expected(600), '变窄后安全区没按新字号更新');
          ro.resize(size, 1280, 720);
          equal(withSubs.at(-1)?.safeArea?.bottom, expected(1280));
          equal(plays(log), 'play:A', '同方向改尺寸不该重建分段');
          film.seekTo(1);
          await run(dom, 2);
          ro.resize(size, 900, 600);
          equal(plain.length, 1);
          equal(plain[0]?.safeArea, undefined, '没有字幕的段不该有安全区');
          film();
        } finally {
          ro.restore();
        }
      }),
  ],
  [
    '翻转后重建的段记下新方向:同一方向内再改尺寸不会反复重建',
    () =>
      withStub(async (dom) => {
        const ro = installResizeObserverStub();
        try {
          const canvas = dom.canvas();
          const size = canvas as unknown as StubCanvas;
          const log: string[] = [];
          const film = runFilm(canvas, [fakeSegment('A', log)], instant);
          await run(dom, 2);
          ro.resize(size, 400, 900);
          await run(dom, 2);
          equal(plays(log), 'play:A|play:A', '翻转没有重建');
          ro.resize(size, 420, 900);
          await run(dom, 2);
          ro.resize(size, 380, 880);
          await run(dom, 2);
          equal(plays(log), 'play:A|play:A', `同方向改尺寸又重建了:${plays(log)}`);
          film();
        } finally {
          ro.restore();
        }
      }),
  ],
  [
    '帧循环按需停下:暂停在转场途中、暂停在段内、loop:false 播完后都不再排帧',
    () =>
      withStub(async (dom) => {
        const log: string[] = [];
        const a = fakeSegment('A', log);
        const b = fakeSegment('B', log);
        const film = runFilm(dom.canvas(), [a, b], { transition: 0.2, loop: false });
        await run(dom, 20);
        a.finish();
        await run(dom, 3); // 淡出进行中
        film.setPaused(true);
        await run(dom, 3);
        equal(dom.pending(), 0, '暂停在转场途中时帧循环还在空转');
        film.setPaused(false);
        ok(dom.pending() > 0, '恢复播放没有唤醒帧循环');
        await run(dom, 40);
        equal(plays(log), 'play:A|play:B');
        film.setPaused(true);
        await run(dom, 2);
        equal(dom.pending(), 0, '段内暂停时帧循环还在跑');
        film.setPaused(false);
        b.finish();
        await run(dom, 40);
        equal(film.getState().mode, 'ended');
        equal(dom.pending(), 0, '片子播完后帧循环还在跑');
        film();
      }),
  ],
  [
    '暂停在段间淡出时跳转立即兑现(不必等恢复播放),新段接着保持暂停',
    () =>
      withStub(async (dom) => {
        const log: string[] = [];
        const segs = ['A', 'B', 'C'].map((n) => fakeSegment(n, log));
        const film = runFilm(dom.canvas(), segs, { transition: 0.6 });
        await run(dom, 60);
        segs[0]?.finish();
        await run(dom, 5); // 淡出进行中
        film.setPaused(true);
        film.seekTo(2);
        await run(dom, 5);
        ok(log.includes('play:C'), `跳转挂到恢复播放才兑现:${log.join('|')}`);
        ok(log.includes('paused:C:true'), '新段没有接上暂停态');
        ok(!log.includes('play:B'), `淡出途中跳转却先播了下一段:${log.join('|')}`);
        film();
      }),
  ],
  [
    'onSegment 回调里点的跳转在起播时就兑现,不等淡入走完',
    () =>
      withStub(async (dom) => {
        const log: string[] = [];
        const segs = ['A', 'B', 'C'].map((n) => fakeSegment(n, log));
        let jumped = false;
        const film = runFilm(dom.canvas(), segs, {
          transition: 0.5,
          onSegment: (i) => {
            if (i === 1 && !jumped) {
              jumped = true;
              film.seekTo(2);
            }
          },
        });
        await run(dom, 40);
        segs[0]?.finish();
        let frames = 0;
        while (!log.includes('play:B') && frames < 80) {
          await run(dom, 1);
          frames += 1;
        }
        await run(dom, 3);
        equal(plays(log), 'play:A|play:B|play:C', `跳转等到淡入走完才兑现:${log.join('|')}`);
        film();
      }),
  ],
  [
    'FilmOptions.clock:帧循环与分段里的 Scene 都走注入的时钟(不装任何全局桩)',
    async () => {
      // 没有 rAF 全局:谁绕过注入的时钟,谁就当场抛 ReferenceError。
      equal(typeof requestAnimationFrame, 'undefined', '这条用例要在没有 rAF 全局的环境里跑');
      const clock = manualClock();
      const errors: unknown[] = [];
      const seg = directedSegment('D', 0.5, [], async (env) => {
        await env.wait(0.5);
      });
      const film = runFilm(createStubCanvas(), [seg], {
        transition: 0,
        loop: false,
        clock,
        onError: (e) => errors.push(e),
      });
      let steps = 0;
      while (film.getState().mode !== 'ended' && steps < 100) {
        clock.step(16);
        steps += 1;
        await flushTasks();
      }
      equal(errors.length, 0, `分段出错:${String(errors[0])}`);
      equal(film.getState().mode, 'ended', '分段没有按注入的时钟播完');
      // 0.5 秒的等待按 16ms 一步要走约 31 步:早早结束说明 Scene 没用这个时钟。
      ok(steps >= 30, `只走了 ${steps} 步就结束了`);
      film();
    },
  ],
  [
    '横竖屏翻转:正在播的段重建;淡出中和片尾之后不重播',
    () =>
      withStub(async (dom) => {
        const ro = installResizeObserverStub();
        try {
          const canvas = dom.canvas();
          const size = canvas as unknown as StubCanvas;
          // 1) 播放中翻转:当前段按新方向重建。
          const log: string[] = [];
          const a = fakeSegment('A', log);
          const b = fakeSegment('B', log);
          const film = runFilm(canvas, [a, b], { transition: 0.2, loop: false });
          await run(dom, 20);
          ro.resize(size, 400, 900);
          await run(dom, 20);
          equal(plays(log), 'play:A|play:A', `翻转没有重建:${log.join('|')}`);
          // 2) 淡出中翻转:已经播完的段不重播。
          a.finish();
          await run(dom, 3);
          ro.resize(size, 1280, 720);
          await run(dom, 40);
          equal(plays(log), 'play:A|play:A|play:B', `淡出中翻转重播了:${log.join('|')}`);
          // 3) 片尾之后翻转:不会把片尾再播一遍。
          b.finish();
          await run(dom, 40);
          equal(film.getState().mode, 'ended');
          ro.resize(size, 400, 900);
          await run(dom, 20);
          equal(plays(log), 'play:A|play:A|play:B', `片尾后翻转重播了:${log.join('|')}`);
          film();
          equal(ro.active(), 0, 'ResizeObserver 没有断开');
        } finally {
          ro.restore();
        }
      }),
  ],
  [
    'seekToTime 落到目标段内偏移,之后跟墙钟续播',
    () =>
      withStub(async (dom) => {
        const log: string[] = [];
        const a = clockProbe('A', 2, log);
        const b = clockProbe('B', 4, log);
        const film = runFilm(dom.canvas(), [a, b], instant);
        await run(dom, 2);
        await seekAndSettle(film, 5); // B 内偏移 3
        const s = film.getState();
        equal(s.index, 1);
        close(s.position, 5, 0.05, `没落到 5 秒处:${s.position}`);
        ok(b.playCount >= 1, `B 没挂起来:${log.join('|')}`);
        ok(b.contexts.at(-1)?.clock !== undefined, '跳转段没跑在手动时钟上');
        await run(dom, 5); // 5 帧 × 16ms,手动跟随续播
        close(film.getState().position, 5.08, 0.05, '跟随后没按墙钟走');
        film();
      }),
  ],
  [
    '同段往前不重挂,往回重挂',
    () =>
      withStub(async (dom) => {
        const log: string[] = [];
        const film = runFilm(dom.canvas(), [clockProbe('A', 2, log), clockProbe('B', 4, log)], instant);
        await run(dom, 2);
        await seekAndSettle(film, 4);
        await seekAndSettle(film, 5);
        equal(
          log.filter((l) => l === 'play:B').length,
          1,
          `往前跳重挂了:${log.join('|')}`,
        );
        close(film.getState().position, 5, 0.05);
        await seekAndSettle(film, 4.2);
        equal(
          log.filter((l) => l === 'play:B').length,
          2,
          `往回跳没重挂:${log.join('|')}`,
        );
        close(film.getState().position, 4.2, 0.05);
        film();
      }),
  ],
  [
    '自然接段后回到墙钟:下一段不再带手动时钟',
    () =>
      withStub(async (dom) => {
        const log: string[] = [];
        const a = clockProbe('A', 2, log);
        const b = clockProbe('B', 4, log);
        const film = runFilm(dom.canvas(), [a, b], instant);
        await run(dom, 2);
        await seekAndSettle(film, 1.9);
        close(film.getState().position, 1.9, 0.05);
        a.finish();
        await run(dom, 10);
        equal(film.getState().index, 1);
        equal(b.contexts.length, 1);
        equal(b.contexts[0]?.clock, undefined, '自然接段还带着手动时钟');
        film();
      }),
  ],
  [
    '目标段起播失败:跳转被放弃,顺延段不受污染',
    () =>
      withStub(async (dom) => {
        const log: string[] = [];
        const b = clockProbe('B', 2, log);
        const film = runFilm(dom.canvas(), [brokenSegment('X', log), b], instant);
        await run(dom, 4);
        equal(film.getState().index, 1, '起播失败没顺延');
        await quiet(async () => {
          await seekAndSettle(film, 0.5); // 落在坏段 X 里(0~1)
        });
        equal(film.getState().index, 1, '失败跳转后没落在 B');
        for (const c of b.contexts) {
          equal(c?.clock, undefined, '顺延段被塞了手动时钟');
        }
        film();
      }),
  ],
  [
    '起播失败的跳转被清理:之后再挂到同一段从头播,不误认领旧偏移',
    () =>
      withStub(async (dom) => {
        const log: string[] = [];
        const x = flakyProbe('X', 2, log, 2);
        const b = clockProbe('B', 2, log);
        const film = runFilm(dom.canvas(), [x, b], instant);
        await quiet(async () => {
          await run(dom, 4); // X 第 1 次起不来,顺延 B
        });
        equal(film.getState().index, 1);
        await quiet(async () => {
          await seekAndSettle(film, 0.5); // 落在 X 里,第 2 次还是起不来
        });
        equal(film.getState().index, 1, '失败跳转后没落在 B');
        film.seekTo(0); // X 第 3 次能起了:必须从头播,不能认领 0.5 的旧跳转
        await run(dom, 4);
        for (let i = 0; i < 60; i++) {
          await flushTasks();
        }
        equal(x.contexts.at(-1)?.clock, undefined, '误认领了旧跳转的手动时钟');
        close(film.getState().position, 0, 0.05, '误认领了旧跳转的偏移');
        film();
      }),
  ],
  [
    '暂停中跳转照样落位,恢复后从新位置续播(锚点重定,不跳变)',
    () =>
      withStub(async (dom) => {
        const log: string[] = [];
        const film = runFilm(dom.canvas(), [clockProbe('A', 2, log), clockProbe('B', 4, log)], instant);
        await run(dom, 2);
        film.setPaused(true);
        await seekAndSettle(film, 5);
        close(film.getState().position, 5, 0.05, '暂停中没落位');
        film.setPaused(false);
        await run(dom, 3);
        const p = film.getState().position;
        ok(p > 5 && p < 5.3, `恢复后跳变了:${p}`);
        film();
      }),
  ],
  [
    '实时录制锁住段内跳转',
    async () => {
      const dom = installDomStub();
      const ex = installExportStub();
      try {
        const log: string[] = [];
        const film = runFilm(dom.canvas(), [clockProbe('A', 2, log), clockProbe('B', 4, log)], instant);
        await run(dom, 2);
        const out = film.exportVideo({ mode: 'realtime' });
        out.done.catch(() => undefined);
        await run(dom, 4);
        film.seekToTime(5);
        await run(dom, 4);
        equal(film.getState().index, 0, '录制中跳转没被锁住');
        ok(!log.includes('play:B'), `录制中挂了 B:${log.join('|')}`);
        out.cancel();
        film();
      } finally {
        ex.restore();
        dom.restore();
      }
    },
  ],
]);
