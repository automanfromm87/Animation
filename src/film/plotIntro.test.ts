import { Create } from '../engine';
import type { Playable } from '../engine';
import { equal, ok, suite } from '../testing/harness';
import { makePlot, plotIntro } from './helpers';
import type { SegmentEnv } from './segments';

/** 只记录 play 了什么的假 env:plotIntro 只用 play / wait。 */
function recordingEnv(): { env: SegmentEnv; played: Playable[]; waited: number[] } {
  const played: Playable[] = [];
  const waited: number[] = [];
  const env = {
    play: (...playables: Playable[]) => {
      played.push(...playables);
      return Promise.resolve();
    },
    wait: (seconds: number) => {
      waited.push(seconds);
      return Promise.resolve();
    },
  } as unknown as SegmentEnv;
  return { env, played, waited };
}

function plot(): ReturnType<typeof makePlot> {
  return makePlot({ xRange: [-3, 3], yRange: [-2, 2], width: 300, height: 200, fn: Math.sin, at: { x: 0, y: 0 } });
}

/** 播到 alpha 时曲线的笔速(null 为匀速)。 */
function curvePaceAt(played: readonly Playable[], p: ReturnType<typeof makePlot>): string | null {
  const create = played.find((a): a is Create => a instanceof Create);
  ok(create !== undefined, 'plotIntro 应当用 Create 描曲线');
  create?.begin();
  create?.interpolate(0.4);
  const pace = p.curve.getRevealPace();
  return pace ? `${pace.mode}:${pace.strength}` : null;
}

export default suite('plotIntro 的曲线笔速', [
  [
    '缺省按弧长匀速;curvePace 原样交给曲线的 Create,时长仍由 curveRunTime 决定',
    async () => {
      const plain = recordingEnv();
      const p = plot();
      await plotIntro(plain.env, p);
      equal(curvePaceAt(plain.played, p), null);

      const paced = recordingEnv();
      const q = plot();
      await plotIntro(paced.env, q, { curvePace: { pace: 'curvature', paceStrength: 3 }, curveRunTime: 2 });
      equal(curvePaceAt(paced.played, q), 'curvature:3');
      const create = paced.played.find((a) => a instanceof Create);
      equal(create?.runTime, 2);
      equal(paced.waited.join(','), '1');
    },
  ],
]);
