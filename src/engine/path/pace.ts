import type { Cubic, PathMeasure, SegmentMeasure } from './measure';
import { LUT_STEPS, measurePath, partialPath, segmentAt } from './measure';
import type { PathData, Subpath } from './path';

/**
 * 笔速(Create / Write 的 pace):把动画进度 u(0..1)换算成沿路径的弧长比例。
 * 'uniform' 按弧长匀速(原来的样子);'curvature' 弯得急的地方放慢、直的地方加快,
 * 拐角处稍作停顿 —— 像手写。只重新分配笔在路径上的快慢,两端精确、总时长不变。
 *
 * 做法:沿弧长累计「转过的角度」(段内的连续转向 + 段与段接缝处的拐角),
 * 用三角核在一个窗口里取平均得到平滑的曲率;代价 c(s) = 1 + strength · g(曲率 × 窗口),
 * g 有上限,最急的弯最多比直线慢 (1 + strength) 倍。进度 u 走到累计代价的 u 倍处。
 * 窗口按路径自身尺寸(弧长加权的均方根半径)取,所以缩放、旋转、平移都不改变节奏,
 * 公式字号、相机缩放也无关。结果按路径对象缓存,每帧只是一次二分查找。
 */

/** 笔速:'uniform' 按弧长匀速,'curvature' 弯处放慢、直处加快(总时长不变)。 */
export type PenPace = 'uniform' | 'curvature';

/** Create / Write 共用的笔速选项。 */
export interface PaceOptions {
  /** 笔速,缺省 'uniform'。 */
  pace?: PenPace;
  /**
   * 'curvature' 的强度:最急的弯(尖角、折返)比直线段慢到 1 / (1 + paceStrength)。
   * 缺省 2,范围 [0, 4];0 等同匀速。只给强度不给 pace 视为 'curvature'。
   */
  paceStrength?: number;
}

/** 解析好的笔速(Create / Write 构造时生成一次,冻结);匀速用 null 表示。 */
export interface RevealPace {
  readonly mode: 'curvature';
  /** (0, MAX_PACE_STRENGTH]。 */
  readonly strength: number;
}

/**
 * 缺省笔速。改成 'curvature' 就是全局默认按曲率:所有影片的观感都会变(时长不变),
 * 所以保持匀速,按曲率由各处显式打开。
 */
export const DEFAULT_PEN_PACE: PenPace = 'uniform';
export const DEFAULT_PACE_STRENGTH = 2;
export const MAX_PACE_STRENGTH = 4;

/**
 * 平滑窗口半宽 = 路径均方根半径 × 这个系数(常见图形约为包围盒对角线的 5%)。
 * 急不急是相对整条路径说的:比窗口还密的起伏(20 个周期的正弦这类长波浪线)平均下来就是匀速 ——
 * 那时每个波峰只占几帧,逐峰减速看起来是抖动;拐角是集中的转角,总会停一下。
 */
const PACE_WINDOW = 0.13;
/** 每个窗口半宽里放几个格子。 */
const PACE_BINS_PER_WINDOW = 6;
/** 整条路径最多这么多格子(超长的折线把格子放宽)。 */
const PACE_MAX_BINS = 4096;
/** 格子放宽后三角核至少跨这么多格,相邻格的速度仍然连贯。 */
const PACE_MIN_KERNEL = 2;
/** g(x) = x² / (x² + X0²):窗口里转过 45° 时减速到一半的强度。 */
const PACE_TURN_HALF = Math.PI / 4;
/** 代价的起伏小于最小值的 2% 就按匀速处理(圆、圆弧的贝塞尔近似误差不该变成抖动)。 */
const PACE_FLAT_EPS = 0.02;

/**
 * 校验并解析笔速选项。owner 是报错里的动画名。匀速(含强度为 0)返回 null。
 * 抛错:pace 不是 'uniform' / 'curvature';paceStrength 不是 [0, 4] 内的有限数;
 * pace 明确是 'uniform' 却给了 paceStrength(自相矛盾;想开关就用 paceStrength: 0)。
 */
export function resolvePace(owner: string, options?: PaceOptions): RevealPace | null {
  const pace: unknown = options?.pace;
  const strength: unknown = options?.paceStrength;
  if (pace !== undefined && pace !== 'uniform' && pace !== 'curvature') {
    throw new Error(`${owner} 的 pace 只能是 'uniform' 或 'curvature',收到 ${String(pace)}`);
  }
  if (
    strength !== undefined &&
    !(
      typeof strength === 'number' &&
      Number.isFinite(strength) &&
      strength >= 0 &&
      strength <= MAX_PACE_STRENGTH
    )
  ) {
    throw new Error(
      `${owner} 的 paceStrength 需要 0 到 ${MAX_PACE_STRENGTH} 之间的有限数,收到 ${String(strength)}`,
    );
  }
  if (pace === 'uniform' && strength !== undefined) {
    throw new Error(`${owner} 的 paceStrength 只对 pace: 'curvature' 生效,这里 pace 是 'uniform'`);
  }
  const mode: PenPace = pace ?? (strength !== undefined ? 'curvature' : DEFAULT_PEN_PACE);
  const k = typeof strength === 'number' ? strength : DEFAULT_PACE_STRENGTH;
  if (mode === 'uniform' || !(k > 0)) {
    return null;
  }
  return Object.freeze({ mode: 'curvature', strength: k });
}

/** 一条路径与强度无关的曲率剖面:按弧长分格,每格一个「窗口内转角」。 */
interface PaceProfile {
  readonly total: number;
  /** 格子起点的累计弧长(与 partialPath 同一套累计),最后一项是 total。 */
  readonly starts: Float64Array;
  /** 每格的 x = 平滑曲率 × 窗口半宽(无量纲,约等于窗口里转过的弧度)。 */
  readonly x: Float64Array;
  /** 按强度缓存的累计代价表;null 表示这个强度下起伏太小,按匀速。 */
  readonly tables: Map<number, PaceTable | null>;
}

interface PaceTable {
  /** 每格的代价(单位弧长的时间,>= 1)。 */
  readonly cost: Float64Array;
  /** 累计代价,cum[0] = 0,长度 = 格数 + 1。 */
  readonly cum: Float64Array;
}

/** null:路径没有长度或处处不转弯(任何强度都是匀速)。 */
const profiles = new WeakMap<PathData, PaceProfile | null>();

/** 三次段在 t 处的导数(不归一),写进 out。 */
function derivative(c: Cubic, t: number, out: [number, number]): void {
  const u = 1 - t;
  out[0] = 3 * u * u * (c[2] - c[0]) + 6 * u * t * (c[4] - c[2]) + 3 * t * t * (c[6] - c[4]);
  out[1] = 3 * u * u * (c[3] - c[1]) + 6 * u * t * (c[5] - c[3]) + 3 * t * t * (c[7] - c[5]);
}

/** 向量 (x, y) 的方向角;太短或不是有限数返回 null。 */
function direction(x: number, y: number, tiny: number): number | null {
  return Number.isFinite(x) && Number.isFinite(y) && Math.hypot(x, y) > tiny ? Math.atan2(y, x) : null;
}

/**
 * t 处的切线方向角。导数退化(控制点与端点重合)时:起点依次取 P2−P0、P3−P0,
 * 终点依次取 P3−P1、P3−P0;段内的尖点返回 null(下一个采样区间自然吸收那一下折返)。
 */
function tangentAngle(c: Cubic, t: number, tiny: number, d: [number, number]): number | null {
  derivative(c, t, d);
  const a = direction(d[0], d[1], tiny);
  if (a !== null || (t > 0 && t < 1)) {
    return a;
  }
  return t <= 0
    ? (direction(c[4] - c[0], c[5] - c[1], tiny) ?? direction(c[6] - c[0], c[7] - c[1], tiny))
    : (direction(c[6] - c[2], c[7] - c[3], tiny) ?? direction(c[6] - c[0], c[7] - c[1], tiny));
}

/** 两个方向角之间转过的角度(0..π)。 */
function turn(a: number, b: number): number {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) {
    d -= Math.PI * 2;
  } else if (d < -Math.PI) {
    d += Math.PI * 2;
  }
  return Math.abs(d);
}

/** 控制点都在端点连线上、且不往回折:直线段(lineTo 升阶来的就是),段内不转弯。 */
function isStraight(c: Cubic): boolean {
  const ex = c[6] - c[0];
  const ey = c[7] - c[1];
  const e2 = ex * ex + ey * ey;
  if (!(e2 > 0)) {
    return false;
  }
  const tol = 1e-9 * e2;
  const x1 = c[2] - c[0];
  const y1 = c[3] - c[1];
  const x2 = c[4] - c[0];
  const y2 = c[5] - c[1];
  const p1 = x1 * ex + y1 * ey;
  const p2 = x2 * ex + y2 * ey;
  return (
    Math.abs(x1 * ey - y1 * ex) <= tol &&
    Math.abs(x2 * ey - y2 * ex) <= tol &&
    p1 >= 0 &&
    p2 >= 0 &&
    p1 <= e2 &&
    p2 <= e2
  );
}

/** 弧长加权的均方根半径(绕路径自身的重心):窗口大小的尺度,旋转、平移不变。 */
function rmsRadius(path: PathData, m: PathMeasure, skip: number): number {
  const first = path.subpaths[0]?.points;
  // 相对第一个点累加:坐标很大时平方和不至于吃掉精度。
  const ox = first?.[0] ?? 0;
  const oy = first?.[1] ?? 0;
  let w = 0;
  let sx = 0;
  let sy = 0;
  let sq = 0;
  path.subpaths.forEach((sub, si) => {
    m.subpaths[si]?.segments.forEach((seg, k) => {
      if (!(seg.length > skip)) {
        return;
      }
      const c = segmentAt(sub, k);
      for (let j = 1; j <= LUT_STEPS; j++) {
        const dw = (seg.lut[j] ?? 0) - (seg.lut[j - 1] ?? 0);
        const t = (j - 0.5) / LUT_STEPS;
        const u = 1 - t;
        const x = u * u * u * c[0] + 3 * u * u * t * c[2] + 3 * u * t * t * c[4] + t * t * t * c[6] - ox;
        const y = u * u * u * c[1] + 3 * u * u * t * c[3] + 3 * u * t * t * c[5] + t * t * t * c[7] - oy;
        w += dw;
        sx += dw * x;
        sy += dw * y;
        sq += dw * (x * x + y * y);
      }
    });
  });
  if (!(w > 0)) {
    return 0;
  }
  const mx = sx / w;
  const my = sy / w;
  const r = Math.sqrt(Math.max(0, sq / w - mx * mx - my * my));
  return Number.isFinite(r) ? r : 0;
}

/**
 * 一条子路径上的转角按弧长分进 n 个等长的格子(每格累计转过的弧度)。
 * 段内的连续转向按弧长摊开;接缝处的拐角是集中量,按到两侧格心的距离分给相邻两格
 * (闭合子路径首尾相接,起点处的拐角也算)。比 skip 还短的段当作不存在,切线跨过它延续,
 * 所以重复顶点照样算拐角。
 */
function binTurning(
  sub: Subpath,
  segments: readonly SegmentMeasure[],
  length: number,
  n: number,
  skip: number,
  tiny: number,
): Float64Array {
  const dl = length / n;
  const tau = new Float64Array(n);
  const closed = sub.closed;
  const bin = (i: number): number => (closed ? ((i % n) + n) % n : Math.min(n - 1, Math.max(0, i)));
  const point = (s: number, theta: number): void => {
    if (!(theta > 0)) {
      return;
    }
    const b = s / dl - 0.5;
    const i = Math.floor(b);
    const f = b - i;
    const i0 = bin(i);
    const i1 = bin(i + 1);
    tau[i0] = (tau[i0] ?? 0) + theta * (1 - f);
    tau[i1] = (tau[i1] ?? 0) + theta * f;
  };
  const spread = (a: number, b: number, theta: number): void => {
    if (!(theta > 0)) {
      return;
    }
    const lo = Math.max(0, a);
    const hi = Math.min(length, b);
    if (!(hi > lo)) {
      point(Math.min(length, Math.max(0, a)), theta);
      return;
    }
    const density = theta / (hi - lo);
    for (let i = Math.min(n - 1, Math.floor(lo / dl)); i < n && i * dl < hi; i++) {
      // 最后一格一直延伸到 hi:浮点误差不会让一点转角落在格子外面。
      const x0 = Math.max(lo, i * dl);
      const x1 = i === n - 1 ? hi : Math.min(hi, (i + 1) * dl);
      if (x1 > x0) {
        tau[i] = (tau[i] ?? 0) + density * (x1 - x0);
      }
    }
  };
  const d: [number, number] = [0, 0];
  let s0 = 0;
  let firstAngle: number | null = null;
  let lastAngle: number | null = null;
  segments.forEach((seg, k) => {
    const len = seg.length;
    if (!(len > skip)) {
      s0 += len;
      return;
    }
    const c = segmentAt(sub, k);
    if (isStraight(c)) {
      const a = Math.atan2(c[7] - c[1], c[6] - c[0]);
      if (lastAngle !== null) {
        point(s0, turn(lastAngle, a));
      }
      firstAngle ??= a;
      lastAngle = a;
      s0 += len;
      return;
    }
    let prev = tangentAngle(c, 0, tiny, d);
    if (prev !== null) {
      if (lastAngle !== null) {
        point(s0, turn(lastAngle, prev));
      }
      firstAngle ??= prev;
    }
    // 在弧长表的采样点上取切线角,相邻两点之间转过的角度摊在这一小段弧长上。
    let from = 0;
    for (let j = 1; j <= LUT_STEPS; j++) {
      const a = tangentAngle(c, j / LUT_STEPS, tiny, d);
      if (a === null) {
        continue;
      }
      const to = seg.lut[j] ?? len;
      if (prev !== null) {
        spread(s0 + from, s0 + to, turn(prev, a));
      } else {
        firstAngle ??= a;
        if (lastAngle !== null) {
          point(s0 + to, turn(lastAngle, a));
        }
      }
      prev = a;
      from = to;
    }
    if (prev !== null) {
      lastAngle = prev;
    }
    s0 += len;
  });
  if (closed && firstAngle !== null && lastAngle !== null) {
    point(0, turn(lastAngle, firstAngle));
  }
  return tau;
}

/**
 * 三角核平滑,结果写进 out:x = 窗口半宽 h × 平滑后的转角密度(约等于 ±h 里转过的弧度)。
 * 权重按真正落在子路径上的格子归一:开放子路径两端不会因为窗口出界而偏快;
 * 闭合子路径首尾相接,比核还短的整圈取平均转角。
 */
function smoothTurning(
  tau: Float64Array,
  closed: boolean,
  h: number,
  dl: number,
  out: number[],
): void {
  const n = tau.length;
  const H = Math.max(h / dl, PACE_MIN_KERNEL);
  // 开放子路径的核半径不超过格数:出界的格子本来就跳过,权重只看 H,结果不变;
  // 否则比窗口短得多的碎子路径(SVG 里浮点噪声留下的 1e-9 长的一小截)会让 H 大到空转几百万次。
  const R = closed ? Math.floor(H) : Math.min(Math.floor(H), n - 1);
  if (closed && 2 * R + 1 > n) {
    let sum = 0;
    for (const v of tau) {
      sum += v;
    }
    const x = (sum / (n * dl)) * h;
    for (let i = 0; i < n; i++) {
      out.push(Number.isFinite(x) ? x : 0);
    }
    return;
  }
  for (let i = 0; i < n; i++) {
    let num = 0;
    let den = 0;
    for (let o = -R; o <= R; o++) {
      let j = i + o;
      if (closed) {
        j = j < 0 ? j + n : j >= n ? j - n : j;
      } else if (j < 0 || j >= n) {
        continue;
      }
      const w = 1 - Math.abs(o) / H;
      num += w * (tau[j] ?? 0);
      den += w;
    }
    const x = den > 0 ? (num / (den * dl)) * h : 0;
    out.push(Number.isFinite(x) ? x : 0);
  }
}

/** 计算(不缓存)一条路径的曲率剖面;没有长度或处处不转弯返回 null。 */
function buildProfile(path: PathData): PaceProfile | null {
  const m = measurePath(path);
  const total = m.total;
  if (!(total > 0) || !Number.isFinite(total)) {
    return null;
  }
  // 比全长还短九个数量级的段当作不存在:它的切线是噪声。
  const skip = total * 1e-9;
  const tiny = total * 1e-12;
  const radius = rmsRadius(path, m, skip);
  const h = PACE_WINDOW * (radius > 0 ? radius : total);
  const binLength = Math.max(h / PACE_BINS_PER_WINDOW, total / PACE_MAX_BINS);
  const starts: number[] = [];
  const xs: number[] = [];
  let offset = 0;
  let anyTurn = false;
  path.subpaths.forEach((sub, si) => {
    const sm = m.subpaths[si];
    if (!sm) {
      return;
    }
    const length = sm.length;
    if (!(length > 0)) {
      offset += length;
      return;
    }
    const n = Math.max(1, Math.round(length / binLength));
    const dl = length / n;
    const tau = binTurning(sub, sm.segments, length, n, skip, tiny);
    if (tau.some((v) => v > 0)) {
      anyTurn = true;
    }
    smoothTurning(tau, sub.closed, h, dl, xs);
    for (let i = 0; i < n; i++) {
      starts.push(offset + i * dl);
    }
    offset += length;
  });
  if (!anyTurn || xs.length === 0) {
    return null;
  }
  starts.push(total);
  return { total, starts: Float64Array.from(starts), x: Float64Array.from(xs), tables: new Map() };
}

function profileOf(path: PathData): PaceProfile | null {
  const hit = profiles.get(path);
  if (hit !== undefined) {
    return hit;
  }
  const p = buildProfile(path);
  profiles.set(path, p);
  return p;
}

/** 某个强度下的累计代价表(按强度缓存在剖面上)。 */
function tableOf(p: PaceProfile, strength: number): PaceTable | null {
  const hit = p.tables.get(strength);
  if (hit !== undefined) {
    return hit;
  }
  const n = p.x.length;
  const cost = new Float64Array(n);
  const cum = new Float64Array(n + 1);
  const x0 = PACE_TURN_HALF * PACE_TURN_HALF;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = 0; i < n; i++) {
    const x = p.x[i] ?? 0;
    const c = 1 + (strength * x * x) / (x * x + x0);
    cost[i] = c;
    lo = Math.min(lo, c);
    hi = Math.max(hi, c);
    cum[i + 1] = (cum[i] ?? 0) + c * ((p.starts[i + 1] ?? 0) - (p.starts[i] ?? 0));
  }
  const flat = hi - lo <= PACE_FLAT_EPS * lo || !Number.isFinite(cum[n] ?? Number.NaN);
  const table = flat ? null : { cost, cum };
  p.tables.set(strength, table);
  return table;
}

/**
 * 进度 u 对应的弧长比例(0..1,跨子路径累计,与 partialPath 同一套)。
 * pace 为 null、u 不在 (0, 1) 内、路径没长度或不转弯时原样返回 u;单调不减,两端精确。
 * 手写的 RevealPace 不经 resolvePace 校验:强度不是正数(负数、NaN)按匀速,超过上限按上限。
 */
export function pacedFraction(path: PathData, u: number, pace: RevealPace | null): number {
  const strength = pace === null ? 0 : pace.strength;
  if (!(strength > 0) || !(u > 0 && u < 1)) {
    return u;
  }
  const p = profileOf(path);
  const table = p ? tableOf(p, Math.min(strength, MAX_PACE_STRENGTH)) : null;
  if (!p || !table) {
    return u;
  }
  const n = p.x.length;
  const target = u * (table.cum[n] ?? 0);
  let lo = 0;
  let hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((table.cum[mid] ?? 0) <= target) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  // 格内代价是常数,累计代价分段线性,这里的反解是精确的。
  const s = (p.starts[lo] ?? 0) + (target - (table.cum[lo] ?? 0)) / (table.cost[lo] ?? 1);
  return Math.min(1, Math.max(0, s / p.total));
}

/**
 * 生长到进度 u 时按弧长截出的前一截(有笔速时先换算):partialPath(path, 0, pacedFraction(...))。
 * u >= 1 原样返回路径,u <= 0 为空路径。自定义的生长(revealPath 覆盖、自己写的 Uncreate)用它来遵守笔速。
 */
export function revealPartial(path: PathData, u: number, pace: RevealPace | null): PathData {
  return partialPath(path, 0, pacedFraction(path, u, pace));
}
