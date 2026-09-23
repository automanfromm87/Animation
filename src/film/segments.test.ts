import type { Scene } from '../engine';
import { installDomStub } from '../testing/domStub';
import type { DomStub } from '../testing/domStub';
import { equal, ok, suite } from '../testing/harness';
import { CARD_INTRO_SECONDS, cardSegment, directedSegment, runCard, sceneSegmentHandle } from './segments';

async function withStub(body: (dom: DomStub) => Promise<void>): Promise<void> {
  const dom = installDomStub();
  try {
    await body(dom);
  } finally {
    dom.restore();
  }
}

async function run(dom: DomStub, frames: number): Promise<void> {
  for (let i = 0; i < frames; i++) {
    dom.frame(16);
    await dom.flush();
  }
}

/** 统计画布监听的挂/摘,验证 Scene 是否被释放。 */
function countingCanvas(dom: DomStub): { canvas: HTMLCanvasElement; balance(): number } {
  const canvas = dom.canvas();
  let added = 0;
  let removed = 0;
  const c = canvas as unknown as Record<string, unknown>;
  c['addEventListener'] = () => {
    added += 1;
  };
  c['removeEventListener'] = () => {
    removed += 1;
  };
  return { canvas, balance: () => added - removed };
}

export default suite('film 分段模板', [
  [
    'directedSegment:取消后 env.play / env.wait 抛哨兵结束脚本,done 正常落定',
    () =>
      withStub(async (dom) => {
        const log: string[] = [];
        const seg = directedSegment('导演', 3, [], async (env) => {
          log.push('a');
          await env.wait(1);
          log.push('b');
          await env.wait(1);
          log.push('c');
        });
        const handle = seg.play(dom.canvas());
        let settled = 'pending';
        handle.done.then(
          () => {
            settled = 'resolved';
          },
          () => {
            settled = 'rejected';
          },
        );
        await run(dom, 10);
        handle.dispose();
        await run(dom, 3);
        equal(settled, 'resolved', '取消不该变成错误');
        equal(log.join(''), 'a', `取消后脚本还在往下跑:${log.join('')}`);
      }),
  ],
  [
    'directedSegment:脚本里真正的错误照常 reject;marker / chapter 透传',
    () =>
      withStub(async (dom) => {
        const seg = directedSegment(
          '坏',
          1,
          [],
          async () => {
            throw new Error('脚本错误');
          },
          { marker: 'chapter', chapter: '起' },
        );
        equal(seg.marker, 'chapter');
        equal(seg.chapter, '起');
        let message = '';
        await seg
          .play(dom.canvas())
          .done.catch((e: unknown) => {
            message = e instanceof Error ? e.message : String(e);
          });
        equal(message, '脚本错误');
      }),
  ],
  [
    'sceneSegmentHandle.resize:收到新上下文时先更新安全区再重取景',
    () => {
      const calls: string[] = [];
      const scene = {
        clearSafeArea: () => calls.push('clear'),
        setSafeArea: (s: { bottom?: number }) => calls.push(`set:${s.bottom ?? '-'}`),
        resizeAndRefit: () => calls.push('refit'),
        dispose: () => calls.push('dispose'),
        getElapsed: () => 0,
        setPaused: () => undefined,
      } as unknown as Scene;
      const handle = sceneSegmentHandle(scene, Promise.resolve());
      handle.resize({ safeArea: { bottom: 80 } });
      handle.resize();
      equal(calls.join('|'), 'clear|set:80|refit|refit');
    },
  ],
  [
    'runCard:build 抛错时释放已经创建的 Scene,不泄漏画布监听',
    () =>
      withStub(async (dom) => {
        const { canvas, balance } = countingCanvas(dom);
        let threw = false;
        try {
          runCard(canvas, () => {
            throw new Error('搭建失败');
          });
        } catch {
          threw = true;
        }
        ok(threw, 'build 的错误应当抛给调用方');
        equal(balance(), 0, '画布监听没摘干净');
      }),
  ],
  [
    'cardSegment:时长由脚本推导(开场 + 停留),解说贯穿全段,时间线与声明一致',
    () =>
      withStub(async (dom) => {
        const seg = cardSegment({
          name: '卡',
          title: '标题',
          heading: '第二行',
          narration: '解说',
          holdSeconds: 2,
          marker: 'chapter',
          chapter: '起',
        });
        equal(seg.duration, CARD_INTRO_SECONDS + 2);
        equal(seg.subtitles?.[0]?.end, seg.duration);
        equal(seg.marker, 'chapter');
        equal(seg.chapter, '起');
        const handle = seg.play(dom.canvas());
        let done = false;
        void handle.done.then(() => {
          done = true;
        });
        let frames = 0;
        while (!done && frames < 400) {
          await run(dom, 1);
          frames += 1;
        }
        ok(done, '卡片段没有播完');
        const elapsed = handle.getElapsed();
        ok(Math.abs(elapsed - seg.duration) < 0.1, `实际时长 ${elapsed} ≠ 声明 ${seg.duration}`);
        handle.dispose();
      }),
  ],
]);
