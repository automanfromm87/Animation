import { close, equal, ok, suite, throws } from '../../testing/harness';
import { typesetTex } from '../math/typeset';
import type { PathLayer } from './draw';
import { partialPath, pathLength } from './measure';
import type { RevealPace } from './pace';
import { DEFAULT_PACE_STRENGTH, pacedFraction, resolvePace, revealPartial } from './pace';
import type { PathData } from './path';
import { EMPTY_PATH, PathBuilder, polylinePath, similarityAffine, transformPath } from './path';
import { writeStep } from './write';

const CURVE = resolvePace('测试', { pace: 'curvature' });

function pace(strength = DEFAULT_PACE_STRENGTH): RevealPace {
  const p = resolvePace('测试', { pace: 'curvature', paceStrength: strength });
  if (!p) {
    throw new Error('强度为正时应得到笔速');
  }
  return p;
}

/** 笔走到弧长比例 f 时的进度(pacedFraction 单调,二分求逆)。 */
function progressAt(path: PathData, f: number, p: RevealPace | null = CURVE): number {
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (pacedFraction(path, mid, p) < f) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

/** 弧长比例区间 [a, b] 占用的时间份额。 */
function timeShare(path: PathData, a: number, b: number, p: RevealPace | null = CURVE): number {
  return progressAt(path, b, p) - progressAt(path, a, p);
}

function glyph(tex: string): PathData {
  const p = typesetTex(tex, false).primitives.find((q) => q.kind === 'fill');
  if (!p || p.kind !== 'fill') {
    throw new Error(`${tex} 没有字形轮廓`);
  }
  return p.path;
}

const square = new PathBuilder().rect(0, 0, 100, 100).build();
/** 发卡弯:直行 100、半径 5 的半圆掉头、直行 100(接弧时多出一段零长度的线段)。 */
const hairpin = new PathBuilder()
  .moveTo(0, 0)
  .lineTo(100, 0)
  .arc(100, 5, 5, -Math.PI / 2, Math.PI / 2)
  .lineTo(0, 10)
  .build();
/** 两个周期的正弦(宽 600,200 段折线,和函数图像的采样一样)。 */
const sinePoints = Array.from({ length: 201 }, (_, i) => {
  const t = -2 * Math.PI + (4 * Math.PI * i) / 200;
  return { x: (t / (4 * Math.PI)) * 600 + 300, y: (-Math.sin(t) / 3) * 200 };
});
const sine = polylinePath(sinePoints);

/** 正弦折线上横坐标 x 处(最近的顶点)的弧长比例。 */
function sineFractionAt(x: number): number {
  const k = Math.round((x / 600) * 200);
  let upTo = 0;
  let total = 0;
  for (let i = 1; i < sinePoints.length; i++) {
    const a = sinePoints[i - 1];
    const b = sinePoints[i];
    const d = a && b ? Math.hypot(b.x - a.x, b.y - a.y) : 0;
    total += d;
    if (i <= k) {
      upTo += d;
    }
  }
  return upTo / total;
}

/** 按 frames 帧取样时每帧笔走的弧长比例。 */
function frameSteps(path: PathData, frames: number): number[] {
  const steps: number[] = [];
  let last = 0;
  for (let i = 1; i <= frames; i++) {
    const f = pacedFraction(path, i / frames, CURVE);
    steps.push(f - last);
    last = f;
  }
  return steps;
}

/** 速度序列里的局部极小值个数(相邻相等的步长先合并:直段上速度恒定)。 */
function speedMinima(steps: readonly number[]): number {
  const runs: number[] = [];
  for (const v of steps) {
    const q = runs[runs.length - 1];
    if (q === undefined || Math.abs(v - q) > 1e-9 * q) {
      runs.push(v);
    }
  }
  let minima = 0;
  for (let i = 1; i + 1 < runs.length; i++) {
    const b = runs[i] ?? 0;
    if (b < (runs[i - 1] ?? 0) && b < (runs[i + 1] ?? 0)) {
      minima += 1;
    }
  }
  return minima;
}

export default suite('笔速 pace', [
  [
    'resolvePace:缺省匀速(null);curvature 缺省强度 2;只给强度视为 curvature;强度 0 等同匀速',
    () => {
      equal(resolvePace('Create'), null);
      equal(resolvePace('Create', {}), null);
      equal(resolvePace('Create', { pace: 'uniform' }), null);
      equal(CURVE?.mode, 'curvature');
      equal(CURVE?.strength, 2);
      equal(resolvePace('Create', { paceStrength: 3 })?.strength, 3);
      equal(resolvePace('Create', { pace: 'curvature', paceStrength: 0 }), null);
      equal(resolvePace('Create', { paceStrength: 0 }), null);
      ok(Object.isFrozen(CURVE), '解析结果应当冻结');
    },
  ],
  [
    'resolvePace:非法取值点名报错',
    () => {
      throws(() => resolvePace('Create', { pace: 'fast' as never }));
      throws(() => resolvePace('Write', { paceStrength: -1 }));
      throws(() => resolvePace('Write', { paceStrength: Number.NaN }));
      throws(() => resolvePace('Write', { paceStrength: Infinity }));
      throws(() => resolvePace('Write', { paceStrength: 4.5 }));
      throws(() => resolvePace('Write', { paceStrength: '2' as never }));
      throws(() => resolvePace('Create', { pace: 'uniform', paceStrength: 1 }));
      let message = '';
      try {
        resolvePace('Write', { pace: 'zigzag' as never });
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      ok(message.includes('Write') && message.includes('zigzag'), `报错应点名动画与取值:${message}`);
    },
  ],
  [
    '两端精确、单调不减、落在 [0, 1];pace 为 null 或 u 在 (0, 1) 之外原样返回',
    () => {
      for (const path of [square, hairpin, sine, glyph('a'), glyph('S')]) {
        equal(pacedFraction(path, 0, CURVE), 0);
        equal(pacedFraction(path, 1, CURVE), 1);
        let prev = 0;
        for (let i = 0; i <= 2000; i++) {
          const f = pacedFraction(path, i / 2000, CURVE);
          ok(f >= prev && f >= 0 && f <= 1, `第 ${i} 个采样不单调或越界:${f}`);
          prev = f;
        }
      }
      equal(pacedFraction(square, 0.3, null), 0.3);
      equal(pacedFraction(square, -0.5, CURVE), -0.5);
      equal(pacedFraction(square, 1.5, CURVE), 1.5);
      ok(Number.isNaN(pacedFraction(square, Number.NaN, CURVE)));
    },
  ],
  [
    '直线(含多段共线折线)与匀速完全一样',
    () => {
      const line = new PathBuilder().moveTo(0, 0).lineTo(120, 35).build();
      const collinear = polylinePath([
        { x: 0, y: 0 },
        { x: 10, y: 5 },
        { x: 50, y: 25 },
        { x: 60, y: 30 },
      ]);
      for (let i = 1; i < 100; i++) {
        equal(pacedFraction(line, i / 100, pace(4)), i / 100);
        equal(pacedFraction(collinear, i / 100, pace(4)), i / 100);
      }
    },
  ],
  [
    '曲率处处相同(整圆、开放圆弧,任意大小)与匀速完全一样',
    () => {
      const circle = new PathBuilder().arc(0, 0, 50, -Math.PI / 2, Math.PI * 1.5).close().build();
      const arc = new PathBuilder().arc(0, 0, 45, 0, Math.PI * 1.5).build();
      const tiny = transformPath(arc, [0.01, 0, 0, 0.01, 0, 0]);
      for (let i = 1; i < 100; i++) {
        for (const path of [circle, arc, tiny]) {
          equal(pacedFraction(path, i / 100, pace(4)), i / 100);
        }
      }
    },
  ],
  [
    '急弯处放慢、直段加快:发卡弯占的时间明显多于它的长度份额,强度越大越多',
    () => {
      const L = pathLength(hairpin);
      const a = 100 / L;
      const b = (100 + Math.PI * 5) / L;
      const share = timeShare(hairpin, a, b);
      ok(share > 1.5 * (b - a), `弯道时间份额 ${share} 应明显大于长度份额 ${b - a}`);
      ok(timeShare(hairpin, 0, a) < a, '直段应比匀速快');
      const s1 = timeShare(hairpin, a, b, pace(1));
      const s4 = timeShare(hairpin, a, b, pace(4));
      ok(s1 < share && share < s4, `强度 1 / 2 / 4 的弯道份额应递增:${s1} ${share} ${s4}`);
      // 减速有上限:任何一段的时间份额都不超过长度份额的 (1 + 强度) 倍。
      ok(s4 < 5 * (b - a), `强度 4 最多慢到 5 倍:${s4} vs ${b - a}`);
    },
  ],
  [
    '正弦(函数图像那样的折线):波峰波谷比过零处慢',
    () => {
      // 宽 600 的两个周期:波峰波谷在 x = 75、225、375、525,过零在 0、150、300、450、600。
      const w = 6 / pathLength(sine);
      const perLength = (x: number): number => {
        const f = sineFractionAt(x);
        return timeShare(sine, f - w, f + w) / (2 * w);
      };
      const zero = perLength(300);
      for (const x of [75, 225, 375, 525]) {
        ok(perLength(x) > 1.3 * zero, `x=${x} 处单位长度用时 ${perLength(x)} 应明显多于过零处 ${zero}`);
      }
      ok(zero < 1, `过零处(近乎直)应比匀速快:${zero}`);
    },
  ],
  [
    '拐角:正方形在四个角附近停留更久且四边对称;锐角比钝角停得久',
    () => {
      let corners = 0;
      for (const c of [0, 100, 200, 300, 400]) {
        corners += timeShare(square, Math.max(0, c - 5) / 400, Math.min(400, c + 5) / 400);
      }
      ok(corners > 1.5 * 0.1, `角附近 10% 的长度应占 15% 以上的时间,实际 ${corners}`);
      // 对称只精确到分格的粒度(格子不一定整除边长)。
      close(pacedFraction(square, 0.5, CURVE), 0.5, 2e-3, '对称:进度一半走到对角');
      close(pacedFraction(square, 0.125, CURVE), 0.125, 2e-3, '对称:每条边的中点');
      // 直行 100 → 左转 30° → 直行 100 → 再转 150° → 直行 100。
      const r = Math.PI / 6;
      const p2 = { x: 100 + 100 * Math.cos(r), y: 100 * Math.sin(r) };
      const zigzag = polylinePath([{ x: 0, y: 0 }, { x: 100, y: 0 }, p2, { x: p2.x - 100, y: p2.y }]);
      const gentle = timeShare(zigzag, 92 / 300, 108 / 300);
      const sharp = timeShare(zigzag, 192 / 300, 208 / 300);
      ok(sharp > gentle && gentle > 16 / 300, `150° 的角(${sharp})应比 30° 的角(${gentle})停得久`);
    },
  ],
  [
    '速度平滑:折线逐个顶点的小转角被平滑成连续的减速,不会逐帧抖动',
    () => {
      for (const frames of [240, 2000]) {
        // 正方形:只在三个内部拐角各慢一次(起点处的角在两端);直段上速度恒定。
        equal(speedMinima(frameSteps(square, frames)), 3, `正方形 ${frames} 帧`);
        // 200 段的正弦:每个顶点都转一点,平滑后只在 4 个波峰波谷处慢下来。
        equal(speedMinima(frameSteps(sine, frames)), 4, `正弦 ${frames} 帧`);
      }
      // 没有拐角的曲线,按 60 fps 取帧相邻两帧的步长变化很小。
      const steps = frameSteps(sine, 60);
      for (let i = 1; i < steps.length; i++) {
        const a = steps[i - 1] ?? 0;
        const b = steps[i] ?? 0;
        ok(Math.max(a / b, b / a) < 1.25, `正弦第 ${i} 帧步长突变:${a} → ${b}`);
      }
    },
  ],
  [
    '只看形状:缩放、旋转、平移不改变节奏',
    () => {
      const g = glyph('a');
      const moved = transformPath(g, similarityAffine(1e4, -3e3, 7, 0.7));
      for (let i = 1; i < 200; i++) {
        close(pacedFraction(moved, i / 200, CURVE), pacedFraction(g, i / 200, CURVE), 1e-6);
      }
    },
  ],
  [
    '退化路径:空路径、零长度、重复顶点、NaN 坐标都不出错;多条子路径按弧长累计',
    () => {
      equal(pacedFraction(EMPTY_PATH, 0.4, CURVE), 0.4);
      const dot = new PathBuilder().moveTo(5, 5).lineTo(5, 5).build();
      equal(pacedFraction(dot, 0.4, CURVE), 0.4);
      const dup = polylinePath([
        { x: 0, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 0 },
        { x: 100, y: 50 },
      ]);
      ok(timeShare(dup, 95 / 150, 105 / 150) > 10 / 150, '重复顶点处的拐角照样放慢');
      const bad: PathData = {
        subpaths: [{ points: [0, 0, 10, 0, 20, 0, 30, 0, Number.NaN, 5, 40, 5, 50, 5], closed: false }],
      };
      for (let i = 1; i < 10; i++) {
        const f = pacedFraction(bad, i / 10, CURVE);
        ok(Number.isFinite(f) && f >= 0 && f <= 1, `NaN 坐标时应得到有限值:${f}`);
      }
      // 尖点(三次段中间导数为零、原路折返)是一次集中的掉头,不出错且放慢。
      const cusp: PathData = {
        subpaths: [{ points: [0, 0, 60, 0, -20, 0, 40, 0], closed: false }],
      };
      for (let i = 1; i < 50; i++) {
        const f = pacedFraction(cusp, i / 50, CURVE);
        ok(Number.isFinite(f) && f >= 0 && f <= 1);
      }
      const two = new PathBuilder().rect(0, 0, 50, 50).rect(100, 0, 50, 50).build();
      close(pacedFraction(two, 0.5, CURVE), 0.5, 2e-3, '两个一样的正方形:进度一半写完第一个');
    },
  ],
  [
    'revealPartial 就是按换算后的比例 partialPath;两端与 partialPath 一致',
    () => {
      const f = pacedFraction(hairpin, 0.4, CURVE);
      close(pathLength(revealPartial(hairpin, 0.4, CURVE)), pathLength(partialPath(hairpin, 0, f)), 1e-9);
      ok(revealPartial(hairpin, 1, CURVE) === hairpin, '画完必须是原路径');
      equal(revealPartial(hairpin, 0, CURVE), EMPTY_PATH);
      ok(Math.abs(f - 0.4) > 0.005, '发卡弯上 0.4 的进度应当偏离匀速');
      close(pathLength(revealPartial(hairpin, 0.4, null)), 0.4 * pathLength(hairpin), 1e-4 * pathLength(hairpin));
    },
  ],
  [
    'writeStep 带笔速:只描边的层与有填充的层的轮廓都按换算后的比例截取;不传与原来一样',
    () => {
      const line: PathLayer = { path: hairpin, paint: { fill: null, stroke: '#000000', strokeWidth: 2 } };
      const L = pathLength(hairpin);
      // 截出来的一截再量弧长有 LUT 插值误差,按全长的万分之一比。
      close(
        pathLength(writeStep(line, 0.4, 1, CURVE)?.path ?? EMPTY_PATH),
        L * pacedFraction(hairpin, 0.4, CURVE),
        1e-4 * L,
      );
      close(pathLength(writeStep(line, 0.4, 1)?.path ?? EMPTY_PATH), L * 0.4, 1e-4 * L);
      const filled: PathLayer = { path: hairpin, paint: { fill: '#ff0000', stroke: null, strokeWidth: 0 } };
      close(
        pathLength(writeStep(filled, 0.2, 1, CURVE)?.path ?? EMPTY_PATH),
        L * pacedFraction(hairpin, 0.4, CURVE),
        1e-4 * L,
      );
      // 后半程(填充淡入)与笔速无关:整条路径。
      ok(writeStep(filled, 0.7, 1, CURVE)?.path === hairpin);
      ok(writeStep(filled, 1, 1, CURVE) === filled);
      equal(writeStep(filled, 0, 1, CURVE), null);
    },
  ],
  [
    '缓存:剖面按路径对象只算一次,之后每帧只查表(换强度也不再读路径);新的路径对象另算',
    () => {
      let reads = 0;
      /** 数一数读了几次 subpaths:算剖面(和弧长表)要读路径,查表不读。 */
      const watched = (p: PathData): PathData =>
        new Proxy(p, {
          get(target, key, receiver) {
            if (key === 'subpaths') {
              reads += 1;
            }
            return Reflect.get(target, key, receiver) as unknown;
          },
        });
      const path = watched(polylinePath(sinePoints));
      const first = Array.from({ length: 101 }, (_, i) => pacedFraction(path, i / 100, CURVE));
      ok(reads > 0, '第一次要读路径算剖面');
      ok(first.some((f, i) => Math.abs(f - i / 100) > 1e-3), '正弦应当偏离匀速(真的在查表)');
      reads = 0;
      for (let round = 0; round < 3; round++) {
        first.forEach((f, i) => equal(pacedFraction(path, i / 100, CURVE), f));
      }
      pacedFraction(path, 0.3, pace(4));
      equal(reads, 0, '剖面已缓存:重复查表、换强度都不再读路径');
      const again = watched(polylinePath(sinePoints));
      equal(pacedFraction(again, 0.3, CURVE), first[30]);
      ok(reads > 0, '新的路径对象(同样的几何)另算一份剖面');
    },
  ],
  [
    '手写的 RevealPace 不经 resolvePace:强度非正、NaN 按匀速,超过上限按上限',
    () => {
      for (const strength of [-3, 0, Number.NaN, -Infinity]) {
        const bad: RevealPace = { mode: 'curvature', strength };
        for (let i = 1; i < 20; i++) {
          equal(pacedFraction(square, i / 20, bad), i / 20, `强度 ${strength}`);
        }
        equal(JSON.stringify(revealPartial(square, 0.5, bad)), JSON.stringify(partialPath(square, 0, 0.5)));
      }
      const huge: RevealPace = { mode: 'curvature', strength: 1e6 };
      const inf: RevealPace = { mode: 'curvature', strength: Infinity };
      for (let i = 1; i < 20; i++) {
        equal(pacedFraction(hairpin, i / 20, huge), pacedFraction(hairpin, i / 20, pace(4)));
        equal(pacedFraction(hairpin, i / 20, inf), pacedFraction(hairpin, i / 20, pace(4)));
      }
    },
  ],
  [
    '比窗口短得多的碎子路径(SVG 里浮点噪声留下的一小截)不拖慢、不影响主路径的节奏',
    () => {
      // 修之前开放碎子路径的核半径 ∝ 1 / 长度:1e-9 长的一截要空转上百亿次,首帧卡死几十秒。
      const outline = new PathBuilder().rect(0, 0, 100, 100).build();
      for (const d of [1e-9, 1e-14]) {
        for (const closed of [false, true]) {
          const speck: PathData = {
            subpaths: [...outline.subpaths, { points: [50, 50, 50 + d / 3, 50, 50 + (2 * d) / 3, 50, 50 + d, 50], closed }],
          };
          equal(pacedFraction(speck, 0, CURVE), 0);
          equal(pacedFraction(speck, 1, CURVE), 1);
          let prev = 0;
          for (let i = 1; i < 200; i++) {
            const f = pacedFraction(speck, i / 200, CURVE);
            ok(Number.isFinite(f) && f >= prev && f <= 1, `长度 ${d} 第 ${i} 个采样:${f}`);
            close(f, pacedFraction(outline, i / 200, CURVE), 1e-6);
            prev = f;
          }
        }
      }
    },
  ],
  [
    '急不急按整条路径的尺寸算:同样的正弦波峰,周期少时放慢,密到 20 个周期(每个波峰只占几帧)按匀速',
    () => {
      /** k 个周期(每个宽 300、振幅 66、100 段折线)上相邻采样的最大 / 最小笔速之比。 */
      const speedRatio = (k: number): { ratio: number; path: PathData } => {
        const n = 100 * k;
        const path = polylinePath(
          Array.from({ length: n + 1 }, (_, i) => ({
            x: (300 * k * i) / n,
            y: 66 * Math.sin((2 * Math.PI * k * i) / n),
          })),
        );
        let lo = Infinity;
        let hi = 0;
        let last = 0;
        for (let i = 1; i <= 2000; i++) {
          const f = pacedFraction(path, i / 2000, CURVE);
          lo = Math.min(lo, f - last);
          hi = Math.max(hi, f - last);
          last = f;
        }
        return { ratio: hi / lo, path };
      };
      for (const k of [2, 5]) {
        const { ratio } = speedRatio(k);
        ok(ratio > 1.5, `${k} 个周期的波峰应明显放慢:快慢比 ${ratio}`);
      }
      // 窗口(约整条路径尺寸的 5%)盖住了好几个波峰,平均下来处处一样:按匀速,不逐峰抖动。
      const { path } = speedRatio(20);
      for (let i = 1; i < 100; i++) {
        equal(pacedFraction(path, i / 100, CURVE), i / 100);
      }
    },
  ],
]);
