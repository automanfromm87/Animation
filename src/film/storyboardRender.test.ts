import { Label } from '../engine';
import type { VideoEncoderSink } from '../export/encoder';
import type { OfflineEnv } from '../export/offlineEnv';
import { isFilmError } from '../export/types';
import { createStubCanvas, flushTasks } from '../testing/domStub';
import type { StubCanvas } from '../testing/domStub';
import { createFakeCtx } from '../testing/fakeCtx';
import type { FakeCtxCall } from '../testing/fakeCtx';
import { close, equal, ok, quiet, stateAt, suite } from '../testing/harness';
import { ManualClock, exportFilmOffline } from './offline';
import { fastForwardTo } from './preview';
import { pythagorasFilm } from './program';
import { directedSegment } from './segments';
import type { StoryboardFrame, StoryboardSpec } from './storyboard';
import { planStoryboard, storyboardCaption, veilAlphaAt } from './storyboard';
import type {
  RenderStoryboardInit,
  RenderStoryboardResult,
  StoryboardFrameResult,
  StoryboardOverlay,
  StoryboardVisuals,
} from './storyboardRender';
import {
  STORYBOARD_OVERRUN_TOLERANCE,
  composeStoryboardSheet,
  fitText,
  renderStoryboard,
  resolveStoryboardVisuals,
} from './storyboardRender';
import type { FilmPlan } from './timeline';
import { planFilm, progressFraction, resolveProgressVisual, resolveSubtitleVisual, segmentAtTime } from './timeline';
import type { FilmOptions, Segment, SegmentContext, SegmentHandle } from './types';

/**
 * 故事板渲染核心用例:真分段(directedSegment + 真 Scene)跑在桩画布上,
 * 缩略图画布记录全部调用,按「导出成片」的合成逐条断言。
 */

function scripted(name: string, duration: number, text?: string): Segment {
  return directedSegment(name, duration, text ? [{ start: 0, end: duration, text }] : [], async (env) => {
    env.scene.add(new Label('hi'));
    await env.wait(duration);
  });
}

interface Stage {
  canvas: StubCanvas & HTMLCanvasElement;
  calls: FakeCtxCall[];
}

function stage(): Stage {
  const canvas = createStubCanvas();
  const fake = createFakeCtx({ record: true });
  (canvas as unknown as { getContext: () => CanvasRenderingContext2D }).getContext = () => fake.ctx;
  return { canvas, calls: fake.calls };
}

/** 播放 / 释放计数的包装:照原样起播,只在句柄的 dispose 上记一笔。 */
function counted(inner: Segment, log: string[], contexts?: Array<SegmentContext | undefined>): Segment {
  return {
    name: inner.name,
    duration: inner.duration,
    ...(inner.subtitles ? { subtitles: inner.subtitles } : {}),
    play(canvas, context) {
      log.push(`play:${inner.name}`);
      contexts?.push(context);
      const h = inner.play(canvas, context);
      return {
        ...h,
        dispose: () => {
          log.push(`dispose:${inner.name}`);
          h.dispose();
        },
      };
    },
  };
}

interface Run {
  result: RenderStoryboardResult;
  frames: readonly StoryboardFrame[];
  results: StoryboardFrameResult[];
  /** 每帧的缩略图画布(按 frame.n)。 */
  targets: Map<number, Stage>;
  /** 每次 target() 被调用时的帧序号。 */
  targetCalls: number[];
  mains: Array<StubCanvas & HTMLCanvasElement>;
  yields: number;
  plan: FilmPlan;
  visuals: StoryboardVisuals;
}

async function render(
  segments: readonly Segment[],
  spec: StoryboardSpec,
  extra: Partial<RenderStoryboardInit> & { film?: FilmOptions } = {},
): Promise<Run> {
  const { film, ...rest } = extra;
  const storyboard = planStoryboard(segments, spec);
  const plan = planFilm(segments, film);
  const visuals = resolveStoryboardVisuals(segments, plan, 1280, 'sans-serif', film);
  const targets = new Map<number, Stage>();
  const targetCalls: number[] = [];
  const mains: Array<StubCanvas & HTMLCanvasElement> = [];
  const results: StoryboardFrameResult[] = [];
  let yields = 0;
  const result = await renderStoryboard({
    segments,
    frames: storyboard.frames,
    plan,
    cssWidth: 1280,
    cssHeight: 720,
    thumbWidth: 640,
    thumbHeight: 360,
    visuals,
    target: (f) => {
      targetCalls.push(f.n);
      let s = targets.get(f.n);
      if (!s) {
        s = stage();
        targets.set(f.n, s);
      }
      return s.canvas;
    },
    createCanvas: () => {
      const c = createStubCanvas();
      mains.push(c);
      return c;
    },
    onFrame: (r) => results.push(r),
    yieldTask: () => {
      yields += 1;
      return flushTasks();
    },
    ...rest,
  });
  return { result, frames: storyboard.frames, results, targets, targetCalls, mains, yields, plan, visuals };
}

/** 调用序列(drawImage 的源画布对象各不相同,不比)。 */
const normalize = (calls: readonly FakeCtxCall[]): string =>
  JSON.stringify(calls.map((c) => ({ op: c.op, args: c.args, value: c.op === 'drawImage' ? null : c.value })));

const texts = (calls: readonly FakeCtxCall[]): string[] =>
  calls.filter((c) => c.op === 'fillText' && typeof c.value === 'string').map((c) => c.value as string);

/** 离线导出用的最小假环境:第一张画布是导出画布(记录调用),addFrame 时打标记切帧。 */
function offlineEnv(): { env: OfflineEnv; output: () => FakeCtxCall[]; marks: number[] } {
  let outputCalls: FakeCtxCall[] = [];
  let first = true;
  const marks: number[] = [];
  const env: OfflineEnv = {
    createCanvas: () => {
      const canvas = createStubCanvas();
      const fake = createFakeCtx({ record: first });
      if (first) {
        outputCalls = fake.calls;
        first = false;
      }
      (canvas as unknown as { getContext: () => CanvasRenderingContext2D }).getContext = () => fake.ctx;
      return canvas;
    },
    encoder: async () => {
      const sink: VideoEncoderSink = {
        mimeType: 'video/mp4',
        codec: 'fake',
        audio: null,
        addFrame: async () => {
          marks.push(outputCalls.length);
        },
        addAudio: async () => undefined,
        finish: async () => new Blob([new Uint8Array(marks.length)], { type: 'video/mp4' }),
        cancel: async () => undefined,
      };
      return sink;
    },
    createYielder: () => ({ yieldTask: flushTasks, close: () => undefined }),
  };
  return { env, output: () => outputCalls, marks };
}

export default suite('film 故事板渲染', [
  [
    '一段只挂一次,段内帧按时刻递增接着快进:让出次数 = 各段最后一帧的步数之和 + 每帧收尾一次',
    async () => {
      const log: string[] = [];
      const segs = [counted(scripted('a', 4), log), counted(scripted('b', 4), log), counted(scripted('c', 4), log)];
      const run = await render(segs, { kind: 'times', times: [0.7, 2, 3.5, 9, 11] });
      equal(run.result.done, 5);
      equal(run.result.failed, 0);
      equal(run.result.aborted, false);
      equal(log.join(','), 'play:a,dispose:a,play:c,dispose:c');
      // a 推到 3.5 秒(105 步),c 推到 3 秒(90 步);每次 fastForwardTo 收尾再让出一次。
      equal(run.yields, 105 + 90 + 5);
      const fromZero = (21 + 60 + 105 + 30 + 90) + 5;
      ok(run.yields < fromZero, `没有接着快进:${run.yields} vs 每帧从 0 ${fromZero}`);
      // 出帧顺序 = 全片时刻顺序(按段、段内递增)。
      equal(run.results.map((r) => r.frame.n).join(','), '0,1,2,3,4');
      for (const r of run.results) {
        close(r.elapsed, r.frame.offset, 1e-9, `${r.frame.n} 停在 ${r.elapsed},计划 ${r.frame.offset}`);
      }
    },
  ],
  [
    '接着快进与从 0 快进(?preview= 的路径)停在同一个时刻',
    async () => {
      const segs = [scripted('a', 4.0371), scripted('b', 6.1)];
      const run = await render(segs, { kind: 'segments' });
      for (const r of run.results) {
        // 单帧预览从 URL 里的秒数定位(segmentAtTime),再从 0 快进。
        const at = segmentAtTime(segs, run.plan.starts, run.plan.total, r.frame.preview);
        equal(at.index, r.frame.index);
        const seg = segs[at.index] as Segment;
        const fresh = stage();
        const clock = new ManualClock();
        const handle = seg.play(fresh.canvas, { clock });
        try {
          const ff = await fastForwardTo(handle, clock, at.offset, { yieldTask: flushTasks });
          close(ff.elapsed, r.elapsed, 1e-9, `${r.frame.index}@${r.frame.offset}:从 0 ${ff.elapsed},接着推 ${r.elapsed}`);
        } finally {
          handle.dispose();
        }
      }
    },
  ],
  [
    '接着快进与从 0 快进(?preview= 的路径)的主画面逐条一致:真片子均匀 24 帧,比绘制调用而不只比 elapsed',
    async () => {
      // 共用一张记录调用的主画布;包一层分段,记下时钟每次推进开始时的调用数:
      // 快进收尾是「+0 推进(帧泵画一帧)→ render()」,target() 紧跟其后,
      // 最后一次推进以来的调用就是这一帧的主画面。
      const main = stage();
      let renderStart = 0;
      const contexts: Array<SegmentContext | undefined> = [];
      const wrap = (inner: Segment, calls: () => FakeCtxCall[], ctxLog?: Array<SegmentContext | undefined>): Segment => ({
        ...inner,
        play(canvas, context) {
          ctxLog?.push(context);
          const clock = context?.clock as ManualClock;
          const advanceTo = clock.advanceTo.bind(clock);
          clock.advanceTo = (time: number): void => {
            renderStart = calls().length;
            advanceTo(time);
          };
          return inner.play(canvas, context);
        },
      });
      const segs = pythagorasFilm.map((s) => wrap(s, () => main.calls, contexts));
      const storyboard = planStoryboard(segs, { kind: 'even', count: 24 });
      const plan = planFilm(segs);
      const drawn = new Map<number, string>();
      const byFrame = new Map<number, SegmentContext | undefined>();
      const result = await renderStoryboard({
        segments: segs,
        frames: storyboard.frames,
        plan,
        cssWidth: 1280,
        cssHeight: 720,
        thumbWidth: 400,
        thumbHeight: 225,
        visuals: resolveStoryboardVisuals(segs, plan, 1280, 'sans-serif'),
        target: (f) => {
          drawn.set(f.n, normalize(main.calls.slice(renderStart)));
          byFrame.set(f.n, contexts[contexts.length - 1]);
          return createStubCanvas();
        },
        createCanvas: () => main.canvas,
        yieldTask: flushTasks,
      });
      equal(result.done, storyboard.frames.length);
      for (const f of storyboard.frames) {
        // 单帧预览:URL 里的秒数定位(segmentAtTime),新时钟、同一视口与安全区,从 0 快进。
        const at = segmentAtTime(segs, plan.starts, plan.total, f.preview);
        const fresh = stage();
        const context = byFrame.get(f.n);
        const seg = wrap(pythagorasFilm[at.index] as Segment, () => fresh.calls);
        const clock = new ManualClock();
        const handle = seg.play(fresh.canvas, { ...context, clock });
        try {
          await fastForwardTo(handle, clock, at.offset, { step: 1 / 30, yieldTask: flushTasks });
          const want = normalize(fresh.calls.slice(renderStart));
          ok(want.length > 2, `第 ${f.n} 帧从 0 快进没画出东西`);
          equal(drawn.get(f.n), want, `第 ${f.n} 帧(${f.index}@${f.offset}):接着快进与从 0 快进画得不一样`);
        } finally {
          handle.dispose();
        }
      }
    },
  ],
  [
    '缩略图 = 成片合成:主画面铺满、字幕、进度条填充宽度按全片进度',
    async () => {
      const segs = [scripted('t', 4, '解说')];
      const run = await render(segs, { kind: 'times', times: [2] });
      const r = run.results[0];
      equal(r?.status, 'done');
      close(r?.elapsed ?? -1, 2, 1e-9);
      equal(r?.subtitle, '解说');
      equal(r?.veilAlpha, 0);
      const calls = run.targets.get(0)?.calls ?? [];
      const draw = calls.find((c) => c.op === 'drawImage');
      equal(JSON.stringify(draw?.args), JSON.stringify([0, 0, 640, 360]));
      ok(texts(calls).includes('解说'), `没画字幕:${texts(calls).join('|')}`);
      ok(calls.findIndex((c) => c.op === 'drawImage') < calls.findIndex((c) => c.op === 'fillText'), '字幕要叠在主画面上');
      const fill = Math.round(640 * progressFraction(2, 4));
      ok(
        calls.some((c) => c.op === 'fillRect' && c.args[0] === 0 && c.args[2] === fill),
        `没有宽 ${fill} 的进度填充`,
      );
      // 主画面按缩略图分辨率栅格化:pixelRatio = 640 / 1280。
      equal(run.mains.length, 1);
    },
  ],
  [
    '与离线导出逐条一致:同一时刻的缩略图合成调用和成片那一帧相同',
    async () => {
      const segs = [scripted('t', 4, '解说与导出同一套合成')];
      const plan = planFilm(segs);
      const visuals = resolveStoryboardVisuals(segs, plan, 1280, 'sans-serif');
      const fake = offlineEnv();
      const session = exportFilmOffline({
        segments: segs,
        plan,
        cssWidth: 1280,
        cssHeight: 720,
        transitionMs: 600,
        veilColor: visuals.veilColor,
        subtitleVisual: visuals.subtitle,
        progressVisual: visuals.progress,
        env: fake.env,
        options: { maxLongEdge: 640 },
      });
      await session.handle.done;
      // 第 60 帧 = 段内 2.0 秒(首段白场早退完了)。
      const exported = fake.output().slice(fake.marks[59], fake.marks[60]);
      ok(exported.length > 0, '没切出导出帧');
      const run = await render(segs, { kind: 'times', times: [2] });
      const thumb = run.targets.get(0)?.calls ?? [];
      equal(normalize(thumb), normalize(exported), '缩略图的合成与成片那一帧不一致');
    },
  ],
  [
    '与离线导出逐条一致(后面的段):两段片子里第二段 1.0 秒的缩略图,和成片里的某一帧调用完全相同',
    async () => {
      const segs = [scripted('a', 2, '第一段'), scripted('b', 4, '第二段的解说')];
      const plan = planFilm(segs);
      const visuals = resolveStoryboardVisuals(segs, plan, 1280, 'sans-serif');
      const fake = offlineEnv();
      const session = exportFilmOffline({
        segments: segs,
        plan,
        cssWidth: 1280,
        cssHeight: 720,
        transitionMs: 600,
        veilColor: visuals.veilColor,
        subtitleVisual: visuals.subtitle,
        progressVisual: visuals.progress,
        env: fake.env,
        options: { maxLongEdge: 640 },
      });
      await session.handle.done;
      const run = await render(segs, { kind: 'times', times: [3] });
      equal(run.results[0]?.frame.index, 1);
      close(run.results[0]?.elapsed ?? -1, 1, 1e-9);
      const thumb = normalize(run.targets.get(0)?.calls ?? []);
      const all = fake.output();
      const matches: number[] = [];
      for (let i = 0; i + 1 < fake.marks.length; i += 1) {
        if (normalize(all.slice(fake.marks[i], fake.marks[i + 1])) === thumb) {
          matches.push(i + 1);
        }
      }
      // 第一段 60 帧 + 段间淡出 18 帧 + 第二段 1 秒 30 帧附近(非首段淡入晚起一帧)。
      ok(matches.length > 0, '成片里找不到和缩略图一样的帧');
      ok(matches.every((i) => i >= 100 && i <= 115), `对上的是第 ${matches.join(',')} 帧,不在第二段 1 秒附近`);
    },
  ],
  [
    '脚本比声明时长短:推不到的帧标「提前结束」(停在结束那一刻),之前的帧不标;链接时刻仍是计划值',
    async () => {
      const short = directedSegment('short', 10, [], async (env) => {
        env.scene.add(new Label('x'));
        await env.wait(3);
      });
      const run = await render([short, scripted('ok', 4)], { kind: 'segments' });
      equal(run.result.done, run.frames.length);
      const inShort = run.results.filter((r) => r.frame.index === 0);
      equal(inShort.map((r) => r.frame.offset.toFixed(1)).join(','), '0.7,5.0,9.7');
      equal(inShort[0]?.endedEarly, undefined);
      for (const r of inShort.slice(1)) {
        close(r.endedEarly ?? -1, r.elapsed, 1e-9);
        ok(r.elapsed < 3.1, `停在 ${r.elapsed}`);
        const c = storyboardCaption(r.frame, 2, r);
        ok(c.flags.includes('脚本 3.0s 就结束了(声明 10.0s)'), c.flags.join('|'));
      }
      ok(run.results.filter((r) => r.frame.index === 1).every((r) => r.endedEarly === undefined && r.overran === undefined));
    },
  ],
  [
    '脚本比声明时长长:段尾帧出完再推到声明时长 + 容差,还没结束就标出来;时长对得上的段不标',
    async () => {
      const long = directedSegment('long', 2, [], async (env) => {
        env.scene.add(new Label('x'));
        await env.wait(8);
      });
      const exact = scripted('exact', 3);
      const log: string[] = [];
      const run = await render([counted(long, log), exact], { kind: 'segments' });
      const inLong = run.results.filter((r) => r.frame.index === 0);
      const last = inLong[inLong.length - 1];
      ok(last !== undefined && last.frame.role === 'end', inLong.map((r) => r.frame.role).join(','));
      close(last?.overran ?? -1, 2 + STORYBOARD_OVERRUN_TOLERANCE, 1 / 30 + 1e-9);
      // 缩略图和说明里的时刻仍是段尾帧本身(推过头只是为了查,不改这一帧)。
      close(last?.elapsed ?? -1, last?.frame.offset ?? 0, 1e-9);
      ok(inLong.slice(0, -1).every((r) => r.overran === undefined), '只查段尾帧');
      const c = storyboardCaption(last?.frame as StoryboardFrame, 2, last);
      ok(c.flags.includes('脚本超过声明的 2.0s(到 2.3s 还没结束)'), c.flags.join('|'));
      ok(run.results.filter((r) => r.frame.index === 1).every((r) => r.overran === undefined && r.endedEarly === undefined));
      equal(log.join(','), 'play:long,dispose:long');
      // 均匀取帧时段中间的最后一帧不查(不为了查时长多推整段)。
      const even = await render([long], { kind: 'times', times: [1] });
      equal(even.results[0]?.overran, undefined);
    },
  ],
  [
    '白场:段内 0.1 秒的帧叠一层白场,不透明度与 veilAlphaAt 一致',
    async () => {
      const segs = [scripted('t', 4, '解说')];
      const run = await render(segs, { kind: 'times', times: [0.1] });
      const want = veilAlphaAt(0.1, 0.6);
      close(run.results[0]?.veilAlpha ?? -1, want, 1e-9);
      ok(want > 0.9);
      const calls = run.targets.get(0)?.calls ?? [];
      const drawAt = calls.findIndex((c) => c.op === 'drawImage');
      const veilAt = calls.findIndex((c, i) => i > drawAt && c.op === 'fillRect' && c.args.join() === '0,0,640,360');
      ok(veilAt > drawAt, '主画面之后没有全幅白场');
      // 第 1 次 fillRect(0 起)是白场(第 0 次是底色)。
      close(Number(stateAt(calls, 'fillRect', 'globalAlpha', 1)), want, 1e-9);
      const caption = storyboardCaption(run.frames[0] as StoryboardFrame, 1, run.results[0]);
      ok(caption.flags.some((f) => f.startsWith('白场 9')), caption.flags.join('|'));
    },
  ],
  [
    '分段起播抛错:这段的帧都算失败(说明起因),其余段照常出',
    async () => {
      const bad: Segment = {
        name: 'b',
        duration: 4,
        subtitles: [{ start: 0, end: 4, text: '面积是边长的平方' }],
        play(): SegmentHandle {
          throw new Error('搭景炸了');
        },
      };
      const run = await render([scripted('a', 4), bad, scripted('c', 4)], {
        kind: 'times',
        times: [1, 5, 6, 9],
      });
      equal(run.result.done, 2);
      equal(run.result.failed, 2);
      const failed = run.results.filter((r) => r.status === 'failed');
      equal(failed.map((r) => r.frame.index).join(','), '1,1');
      ok(failed.every((r) => r.error?.startsWith('分段启动失败:') === true), failed.map((r) => r.error).join('|'));
      ok(failed.every((r) => r.error?.includes('搭景炸了') === true));
      equal(run.targetCalls.join(','), '0,3', '失败的帧不碰缩略图画布');
      // 失败的帧照样按计划报字幕:说明里看得出出错时在讲什么。
      ok(failed.every((r) => r.subtitle === '面积是边长的平方'), failed.map((r) => r.subtitle).join('|'));
      const caption = storyboardCaption(failed[0]?.frame as StoryboardFrame, 3, failed[0]);
      equal(caption.subtitle, '面积是边长的平方');
    },
  ],
  [
    '脚本中途抛错:之前的帧没有 error,之后的帧照出并带上错误(不留未处理拒绝)',
    async () => {
      const seg = directedSegment('boom', 4, [], async (env) => {
        env.scene.add(new Label('x'));
        await env.wait(1);
        throw new Error('脚本第 1 秒炸了');
      });
      await quiet(async () => {
        const run = await render([seg], { kind: 'times', times: [0.7, 2] });
        equal(run.result.done, 2);
        equal(run.results[0]?.error, undefined);
        ok(run.results[1]?.error?.includes('脚本第 1 秒炸了') === true, String(run.results[1]?.error));
        const caption = storyboardCaption(run.frames[1] as StoryboardFrame, 1, run.results[1]);
        ok(caption.flags.some((f) => f.startsWith('出错:')), caption.flags.join('|'));
      });
    },
  ],
  [
    '中止:第一帧出完就停,不再取缩略图画布,当前句柄照常释放',
    async () => {
      const log: string[] = [];
      let stop = false;
      const run = await render([counted(scripted('a', 4), log), counted(scripted('b', 4), log)], {
        kind: 'times',
        times: [1, 2, 3, 5],
      }, {
        shouldAbort: () => stop,
        onFrame: () => {
          stop = true;
        },
      });
      equal(run.result.aborted, true);
      equal(run.result.done, 1);
      equal(run.targetCalls.join(','), '0');
      equal(log.join(','), 'play:a,dispose:a');
      equal(run.mains[0]?.width, 0, '中止后主画布也要还掉');
    },
  ],
  [
    'overlay:每张出图调一次,时钟停着;outline 按 css → 缩略图换算;notes 进结果;异步会被等',
    async () => {
      const seen: Array<{ n: number; elapsed: number; handleElapsed: number; after: number }> = [];
      const overlay: StoryboardOverlay = async (o) => {
        const before = o.handle.getElapsed();
        o.outline({ x: 100, y: 50, w: 200, h: 100 });
        // 异步检查:等几个宏任务,期间时钟不能动。
        await flushTasks();
        await flushTasks();
        seen.push({ n: o.frame.n, elapsed: o.elapsed, handleElapsed: before, after: o.handle.getElapsed() });
        equal(o.cssWidth, 1280);
        close(o.scale, 0.5, 1e-12);
        equal(o.subtitle?.text, '解说');
        ok(o.progress !== null);
        equal(o.subtitleBox?.lines, 1);
        // 字幕盒描回缩略图上,就是合成时画的那块底板(同一份几何)。
        if (o.subtitleBox) {
          o.outline(o.subtitleBox, '#00f');
        }
        return { notes: ['重叠'] };
      };
      const run = await render([scripted('t', 4, '解说')], { kind: 'times', times: [1, 2.5] }, { overlay });
      equal(seen.length, 2);
      for (const s of seen) {
        close(s.handleElapsed, s.elapsed, 1e-9);
        close(s.after, s.elapsed, 1e-9, 'overlay 期间时钟被推进了');
      }
      equal(run.results.map((r) => r.notes.join('|')).join(','), '重叠,重叠');
      const calls = run.targets.get(0)?.calls ?? [];
      const rect = calls.find((c) => c.op === 'strokeRect');
      equal(JSON.stringify(rect?.args), JSON.stringify([50, 25, 100, 50]));
      equal(stateAt(calls, 'strokeRect', 'strokeStyle'), '#ff2d2d');
      equal(stateAt(calls, 'strokeRect', 'lineWidth'), 2);
      const plate = calls.find((c) => c.op === 'roundRect');
      const boxed = calls.filter((c) => c.op === 'strokeRect')[1];
      ok(plate !== undefined && boxed !== undefined, '没画字幕底板或没描字幕盒');
      equal(
        JSON.stringify(boxed?.args),
        JSON.stringify(plate?.args.slice(0, 4).map((v) => Math.round(v))),
        '字幕盒与合成画的底板不是同一个矩形',
      );
      equal(stateAt(calls, 'strokeRect', 'strokeStyle', 1), '#00f');
    },
  ],
  [
    'overlay 抛错:帧照常算出,说明里写「检查器出错」,告警每轮只一次',
    async () => {
      let warns = 0;
      const { warn } = console;
      console.warn = (): void => {
        warns += 1;
      };
      try {
        const run = await render([scripted('t', 4)], { kind: 'times', times: [1, 2, 3] }, {
          overlay: () => {
            throw new Error('检查器坏了');
          },
        });
        equal(run.result.done, 3);
        ok(run.results.every((r) => r.notes[0]?.startsWith('检查器出错:') === true), run.results[0]?.notes.join('|'));
        equal(warns, 1);
      } finally {
        console.warn = warn;
      }
      // overlay 不给 notes / 返回 undefined 都行。
      const quietRun = await render([scripted('t', 4)], { kind: 'times', times: [1] }, { overlay: () => undefined });
      equal(quietRun.results[0]?.notes.length, 0);
    },
  ],
  [
    '确定性:同一输入跑两遍,每张缩略图的调用序列相同',
    async () => {
      const make = (): Segment[] => [scripted('a', 3, '甲'), scripted('b', 5, '乙')];
      const a = await render(make(), { kind: 'segments' });
      const b = await render(make(), { kind: 'segments' });
      equal(a.frames.length, b.frames.length);
      for (const f of a.frames) {
        equal(normalize(a.targets.get(f.n)?.calls ?? []), normalize(b.targets.get(f.n)?.calls ?? []), `第 ${f.n} 帧不一致`);
      }
    },
  ],
  [
    'resolveStoryboardVisuals 与播放器同一口径:缺省值、关字幕、关进度条、转场色',
    async () => {
      const segs = [scripted('a', 3, '甲')];
      const plan = planFilm(segs);
      const v = resolveStoryboardVisuals(segs, plan, 1280, 'Songti SC');
      equal(JSON.stringify(v.subtitle), JSON.stringify(resolveSubtitleVisual(1280, undefined, plan, 'Songti SC')));
      equal(JSON.stringify(v.progress), JSON.stringify(resolveProgressVisual(segs, undefined, plan, 1280, 'Songti SC')));
      equal(v.transition, 0.6);
      // 有章名时进度条占块 38px,字幕要让到它上面;关了进度条就不必让。
      const chaptered = [
        directedSegment('章', 3, [{ start: 0, end: 3, text: '甲' }], async () => undefined, { chapter: '开场' }),
      ];
      const withBar = resolveStoryboardVisuals(chaptered, planFilm(chaptered), 1280, 'f');
      const noProgress = resolveStoryboardVisuals(chaptered, planFilm(chaptered, { progress: false }), 1280, 'f', {
        progress: false,
      });
      equal(noProgress.progress, null);
      ok((noProgress.subtitle?.bottomPx ?? 99) < (withBar.subtitle?.bottomPx ?? 0), '关了进度条字幕不必再让位');
      equal(resolveStoryboardVisuals(segs, plan, 1280, 'f', { transitionColor: '#000' }).veilColor, '#000');
      equal(resolveStoryboardVisuals(segs, plan, 1280, 'f', { transition: 0.2 }).transition, 0.2);
      // 关字幕:不画字幕,分段也拿不到字幕安全区。
      const contexts: Array<SegmentContext | undefined> = [];
      const log: string[] = [];
      const run = await render([counted(scripted('a', 3, '甲'), log, contexts)], { kind: 'times', times: [1] }, {
        film: { subtitles: false },
      });
      equal(run.visuals.subtitle, null);
      equal(contexts[0]?.safeArea, undefined);
      ok(!texts(run.targets.get(0)?.calls ?? []).includes('甲'));
      const withSubs: Array<SegmentContext | undefined> = [];
      await render([counted(scripted('a', 3, '甲'), [], withSubs)], { kind: 'times', times: [1] });
      ok((withSubs[0]?.safeArea?.bottom ?? 0) > 0, '有字幕的段要给安全区');
      equal(withSubs[0]?.viewport?.pixelRatio, 0.5);
    },
  ],
  [
    '主画布用完就还掉像素缓冲',
    async () => {
      const run = await render([scripted('a', 2), scripted('b', 2)], { kind: 'segments' });
      equal(run.mains.length, 1, '一轮只建一张主画布,各段共用');
      equal(run.mains[0]?.width, 0);
      equal(run.mains[0]?.height, 0);
    },
  ],
  [
    '联系表:画布尺寸按排版、只画出了图的格子、超宽说明用 … 截断',
    () => {
      const segs = [scripted('a', 4)];
      const plan = planStoryboard(segs, { kind: 'times', times: [1, 2, 3] });
      const thumbs = [stage(), null, stage()];
      for (const t of thumbs) {
        if (t) {
          t.canvas.width = 64;
          t.canvas.height = 36;
        }
      }
      const long = '很长的字幕'.repeat(20);
      const sheet = stage();
      const out = composeStoryboardSheet(
        plan.frames.map((f, i) => ({
          canvas: thumbs[i]?.canvas ?? null,
          caption: storyboardCaption(f, 1, { subtitle: long }),
        })),
        { createCanvas: () => sheet.canvas, thumbWidth: 640, thumbHeight: 360, title: '短片' },
      );
      equal(out, sheet.canvas);
      // 3 帧 → 3 列 1 行。
      equal(out.width, 16 + 3 * 656);
      equal(sheet.calls.filter((c) => c.op === 'drawImage').length, 2);
      const lines = texts(sheet.calls);
      ok(lines[0]?.includes('短片 · 故事板 · 3 帧') === true, lines[0]);
      const sub = lines.find((l) => l.startsWith('很长的字幕'));
      ok(sub?.endsWith('…') === true, String(sub));
      // 假 ctx 的 measureText 每字 8px:截断后放得进 640。
      ok((sub?.length ?? 999) * 8 <= 640);
      ok(lines.some((l) => l.startsWith('0:01.0 · 第 1/1 段')), lines.join('|'));
    },
  ],
  [
    'fitText:放得下原样,放不下二分截断,连 … 都放不下给空串',
    () => {
      const { ctx } = createFakeCtx({ record: false });
      equal(fitText(ctx, 'abcd', 32), 'abcd');
      equal(fitText(ctx, 'abcdefgh', 40), 'abcd…');
      equal(fitText(ctx, 'abcdefgh', 4), '');
      equal(fitText(ctx, 'abc', 0), '');
    },
  ],
  [
    '真片子(勾股定理短片)分段模式横竖屏各出一页:全部出图、没有报错、说明按全片时刻递增',
    async () => {
      const errors: unknown[] = [];
      const { error } = console;
      console.error = (...args: unknown[]): void => {
        errors.push(args);
      };
      try {
        for (const [w, h] of [[1280, 720], [720, 1280]] as const) {
          const storyboard = planStoryboard(pythagorasFilm, { kind: 'segments' });
          const plan = planFilm(pythagorasFilm);
          const results: StoryboardFrameResult[] = [];
          const result = await renderStoryboard({
            segments: pythagorasFilm,
            frames: storyboard.frames,
            plan,
            cssWidth: w,
            cssHeight: h,
            thumbWidth: w > h ? 400 : 225,
            thumbHeight: w > h ? 225 : 400,
            visuals: resolveStoryboardVisuals(pythagorasFilm, plan, w, 'sans-serif'),
            target: () => createStubCanvas(),
            createCanvas: () => createStubCanvas(),
            onFrame: (r) => results.push(r),
            yieldTask: flushTasks,
          });
          equal(result.failed, 0, `${w}×${h}:${results.find((r) => r.status === 'failed')?.error}`);
          equal(result.done, storyboard.frames.length);
          ok(results.every((r) => r.error === undefined), `${w}×${h} 脚本报错:${results.find((r) => r.error)?.error}`);
          const off = results.find((r) => r.endedEarly !== undefined || r.overran !== undefined);
          ok(off === undefined, `${w}×${h} 交付片不该有时长标记:${off?.frame.name} ${off?.endedEarly} ${off?.overran}`);
          for (let i = 1; i < results.length; i += 1) {
            ok((results[i]?.position ?? 0) > (results[i - 1]?.position ?? 0), `${w}×${h} 第 ${i} 帧没按时刻递增`);
          }
        }
        equal(errors.length, 0, `有 console.error:${String(errors[0])}`);
      } finally {
        console.error = error;
      }
    },
  ],
  [
    '空帧表:什么都不挂,主画布照样还掉',
    async () => {
      const mains: HTMLCanvasElement[] = [];
      const plan = planFilm([scripted('a', 1)]);
      const result = await renderStoryboard({
        segments: [scripted('a', 1)],
        frames: [],
        plan,
        cssWidth: 0,
        cssHeight: 0,
        thumbWidth: 64,
        thumbHeight: 36,
        visuals: resolveStoryboardVisuals([scripted('a', 1)], plan, 1280, 'f'),
        target: () => {
          throw new Error('不该取画布');
        },
        createCanvas: () => {
          const c = createStubCanvas();
          mains.push(c);
          return c;
        },
        yieldTask: flushTasks,
      });
      equal(JSON.stringify(result), JSON.stringify({ done: 0, failed: 0, aborted: false }));
      equal(mains[0]?.width, 0);
      ok(!isFilmError(result));
    },
  ],
]);
