import { installDomStub } from '../testing/domStub';
import { ok, suite } from '../testing/harness';
import type { TestFn } from '../testing/harness';
import { derivativesFilm } from './derivatives';
import { pythagorasFilm } from './program';
import { topologyFilm } from './topology';
import type { Segment } from './types';

/**
 * 内容时序审计:在测试桩里把每个分段完整干跑一遍。
 * 进度条、跳转、字幕钳位、导出进度全都信任手写的 duration,
 * 它和脚本实际时间线一旦漂开,没有任何运行时报错 —— 只能靠这里兜住。
 */

const FPS = 60;
/** 声明时长与实际时间线允许的偏差(秒)。 */
const DURATION_TOLERANCE = 0.25;

interface DryRun {
  settled: boolean;
  elapsed: number;
  errors: unknown[];
}

async function dryRun(segment: Segment): Promise<DryRun> {
  const dom = installDomStub();
  const errors: unknown[] = [];
  const { error } = console;
  console.error = (...args: unknown[]): void => {
    errors.push(args);
  };
  try {
    const handle = segment.play(dom.canvas(), {});
    let settled = false;
    handle.done.then(
      () => {
        settled = true;
      },
      (e: unknown) => {
        settled = true;
        errors.push(e);
      },
    );
    const limit = (segment.duration + 5) * FPS;
    for (let i = 0; i < limit && !settled; i++) {
      dom.frame(1000 / FPS);
      await dom.flush();
    }
    const elapsed = handle.getElapsed();
    handle.dispose();
    return { settled, elapsed, errors };
  } finally {
    console.error = error;
    dom.restore();
  }
}

function audit(film: string, segment: Segment): readonly [string, TestFn] {
  return [
    `${film} › ${segment.name}`,
    async () => {
      const { settled, elapsed, errors } = await dryRun(segment);
      ok(settled, `分段在 duration + 5 秒内没有结束(已播 ${elapsed.toFixed(2)} 秒)`);
      ok(errors.length === 0, `分段运行中报错:${String(errors[0])}`);
      ok(
        Math.abs(elapsed - segment.duration) <= DURATION_TOLERANCE,
        `声明时长 ${segment.duration} 秒,实际时间线 ${elapsed.toFixed(2)} 秒`,
      );
      const subs = segment.subtitles ?? [];
      let prevEnd = 0;
      for (const s of subs) {
        ok(s.start >= 0 && s.end > s.start, `字幕区间非法:${s.start}–${s.end}「${s.text}」`);
        ok(s.start >= prevEnd - 1e-9, `字幕重叠或乱序:${s.start} 早于上一条结束 ${prevEnd}「${s.text}」`);
        ok(
          s.end <= Math.min(segment.duration, elapsed) + 0.05,
          `字幕「${s.text}」在 ${s.end} 秒结束,晚于分段结束(${Math.min(segment.duration, elapsed).toFixed(2)} 秒)`,
        );
        prevEnd = s.end;
      }
    },
  ];
}

export default suite('内容时序', [
  ...pythagorasFilm.map((s) => audit('勾股短片', s)),
  ...derivativesFilm.map((s) => audit('导数长片', s)),
  ...topologyFilm.map((s) => audit('拓扑短片', s)),
]);
