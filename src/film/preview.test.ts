import { Label } from '../engine';
import { createStubCanvas, flushTasks } from '../testing/domStub';
import type { StubCanvas } from '../testing/domStub';
import { createFakeCtx } from '../testing/fakeCtx';
import type { FakeCtxCall } from '../testing/fakeCtx';
import { equal, ok, suite } from '../testing/harness';
import type { Segment, SegmentHandle } from './film';
import { directedSegment, isFilmError } from './film';
import { ManualClock } from './offline';
import { fastForwardTo, previewFrameAt } from './preview';

/**
 * 单帧预览用例:真分段(directedSegment + 真 Scene)跑在桩画布上,
 * 每步让出一个宏任务(flushTasks),与离线导出同一套推进口径。
 */
function scripted(name: string, duration: number, text: string): Segment {
  return directedSegment(name, duration, [{ start: 0, end: duration, text }], async (env) => {
    env.scene.add(new Label('hi'));
    await env.wait(duration);
  });
}

interface StubStage {
  canvas: StubCanvas & HTMLCanvasElement;
  calls: FakeCtxCall[];
}

function stage(): StubStage {
  const canvas = createStubCanvas();
  const fake = createFakeCtx({ record: true });
  (canvas as unknown as { getContext: () => CanvasRenderingContext2D }).getContext =
    () => fake.ctx;
  return { canvas, calls: fake.calls };
}

/** 绘制类调用(量字、save/restore、路径搭建不算,只看真正上色的)。 */
const PAINT_OPS = new Set(['fill', 'stroke', 'fillText', 'strokeText', 'drawImage', 'fillRect']);

const paints = (calls: readonly FakeCtxCall[]): number =>
  calls.filter((c) => PAINT_OPS.has(c.op)).length;

export default suite('film 单帧预览', [
  [
    '快进把段内时钟推到目标偏移',
    async () => {
      const { canvas } = stage();
      const seg = scripted('t', 3, '解说');
      const clock = new ManualClock();
      const handle = seg.play(canvas, { clock });
      try {
        const r = await fastForwardTo(handle, clock, 2, { yieldTask: flushTasks });
        equal(r.aborted, false);
        ok(Math.abs(r.elapsed - 2) < 0.05, `elapsed 偏了:${r.elapsed}`);
        ok(Math.abs(handle.getElapsed() - 2) < 0.05, `句柄时钟偏了:${handle.getElapsed()}`);
      } finally {
        handle.dispose();
      }
    },
  ],
  [
    '干跑跳过中间绘制:2 秒 60 步只画收尾, legacy 句柄(无干跑)步步都画',
    async () => {
      const seg = scripted('t', 3, '解说');
      // 两只互相独立的挂载,各快进各的,绘制数才能比。
      // legacy 句柄:把可选的干跑/补画去掉,模拟老版本的分段实现。
      const dry = stage();
      const dryClock = new ManualClock();
      const dryHandle = seg.play(dry.canvas, { clock: dryClock });
      const legacy = stage();
      const legacyClock = new ManualClock();
      const fullHandle = seg.play(legacy.canvas, { clock: legacyClock });
      const { setDryRun: _d, render: _r, ...legacyHandle } = fullHandle as SegmentHandle & {
        setDryRun?: unknown;
        render?: unknown;
      };
      void _d;
      void _r;
      try {
        await fastForwardTo(dryHandle, dryClock, 2, { yieldTask: flushTasks });
        await fastForwardTo(legacyHandle as SegmentHandle, legacyClock, 2, {
          yieldTask: flushTasks,
        });
        ok(
          paints(dry.calls) <= 6,
          `干跑画太多了:${paints(dry.calls)} 次上色 / ${dry.calls.length} 次调用`,
        );
        ok(
          paints(legacy.calls) > paints(dry.calls) * 5,
          `legacy 没比干跑多画:legacy ${paints(legacy.calls)} vs 干跑 ${paints(dry.calls)}`,
        );
      } finally {
        dryHandle.dispose();
        fullHandle.dispose();
      }
    },
  ],
  [
    '两次同 t 预览逐调用一致(确定性)',
    async () => {
      const segs = [scripted('a', 2, '甲'), scripted('b', 3, '乙')];
      const s1 = stage();
      const s2 = stage();
      const r1 = await previewFrameAt(segs, 3.5, s1.canvas, { yieldTask: flushTasks });
      const r2 = await previewFrameAt(segs, 3.5, s2.canvas, { yieldTask: flushTasks });
      equal(r1.index, 1);
      equal(r1.offset, 1.5);
      equal(r1.name, 'b');
      equal(r1.subtitle, '乙');
      equal(r1.position, 3.5);
      equal(JSON.stringify(r1), JSON.stringify(r2));
      equal(JSON.stringify(s1.calls), JSON.stringify(s2.calls), '两次预览的绘制调用不一致');
    },
  ],
  [
    'previewFrameAt 越界夹紧:超片尾落到最后一段末尾,负数落到开头',
    async () => {
      const segs = [scripted('a', 2, '甲'), scripted('b', 3, '乙')];
      const s1 = stage();
      const end = await previewFrameAt(segs, 99, s1.canvas, { yieldTask: flushTasks });
      equal(end.index, 1);
      equal(end.offset, 3);
      equal(end.position, 5);
      const s2 = stage();
      const head = await previewFrameAt(segs, -5, s2.canvas, { yieldTask: flushTasks });
      equal(head.index, 0);
      equal(head.offset, 0);
      equal(head.position, 0);
    },
  ],
  [
    '空清单抛 no-segments',
    async () => {
      const { canvas } = stage();
      let code = '';
      try {
        await previewFrameAt([], 1, canvas, { yieldTask: flushTasks });
      } catch (e) {
        code = isFilmError(e) ? e.code : '不是 FilmError';
      }
      equal(code, 'no-segments');
    },
  ],
  [
    'shouldAbort 中止快进:停在半路且不补画',
    async () => {
      const { canvas, calls } = stage();
      const seg = scripted('t', 10, '解说');
      const clock = new ManualClock();
      const handle = seg.play(canvas, { clock });
      try {
        let n = 0;
        const r = await fastForwardTo(handle, clock, 8, {
          yieldTask: flushTasks,
          shouldAbort: () => {
            n += 1;
            return n > 5;
          },
        });
        equal(r.aborted, true);
        ok(r.elapsed < 8, `中止了还走满了:${r.elapsed}`);
        // 中止不补画:上色次数不能超过挂载那一次。
        ok(paints(calls) <= 2, `中止后还补画了:${paints(calls)}`);
      } finally {
        handle.dispose();
      }
    },
  ],
  [
    '步长超过 0.5 按 0.5 走(帧泵停摆钳制),照样落到目标',
    async () => {
      const { canvas } = stage();
      const seg = scripted('t', 4, '解说');
      const clock = new ManualClock();
      const handle = seg.play(canvas, { clock });
      try {
        const r = await fastForwardTo(handle, clock, 3, { step: 10, yieldTask: flushTasks });
        ok(Math.abs(r.elapsed - 3) < 0.05, `elapsed 偏了:${r.elapsed}`);
      } finally {
        handle.dispose();
      }
    },
  ],
]);
