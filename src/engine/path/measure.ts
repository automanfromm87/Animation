import type { PathData, Subpath } from './path';
import { EMPTY_PATH, segmentCount } from './path';

/** 8 点 Gauss–Legendre 求积(区间 [-1, 1] 上的节点与权重)。 */
const GL_X = [
  -0.9602898564975363, -0.7966664774136267, -0.5255324099163290, -0.1834346424956498,
  0.1834346424956498, 0.5255324099163290, 0.7966664774136267, 0.9602898564975363,
];
const GL_W = [
  0.1012285362903763, 0.2223810344533745, 0.3137066458778873, 0.3626837833783620,
  0.3626837833783620, 0.3137066458778873, 0.2223810344533745, 0.1012285362903763,
];
/** 每段弧长查找表的采样数:长度 → 参数的反查在相邻两个采样之间线性插值。 */
export const LUT_STEPS = 16;

/** 一个三次段的 8 个坐标。 */
export type Cubic = readonly [number, number, number, number, number, number, number, number];

/** @internal 子路径第 k 段的 8 个坐标(笔速 pace.ts 也用)。 */
export function segmentAt(sub: Subpath, k: number): Cubic {
  const p = sub.points;
  const i = 6 * k;
  return [
    p[i] ?? 0,
    p[i + 1] ?? 0,
    p[i + 2] ?? 0,
    p[i + 3] ?? 0,
    p[i + 4] ?? 0,
    p[i + 5] ?? 0,
    p[i + 6] ?? 0,
    p[i + 7] ?? 0,
  ];
}

function speed(c: Cubic, t: number): number {
  const u = 1 - t;
  const dx = 3 * u * u * (c[2] - c[0]) + 6 * u * t * (c[4] - c[2]) + 3 * t * t * (c[6] - c[4]);
  const dy = 3 * u * u * (c[3] - c[1]) + 6 * u * t * (c[5] - c[3]) + 3 * t * t * (c[7] - c[5]);
  return Math.hypot(dx, dy);
}

/** [t0, t1] 区间上的弧长。 */
function arcLength(c: Cubic, t0: number, t1: number): number {
  const half = (t1 - t0) / 2;
  const mid = (t1 + t0) / 2;
  let sum = 0;
  for (let i = 0; i < GL_X.length; i++) {
    sum += (GL_W[i] ?? 0) * speed(c, mid + half * (GL_X[i] ?? 0));
  }
  const len = sum * half;
  return Number.isFinite(len) ? len : 0;
}

/** @internal 一段的弧长表(笔速 pace.ts 也用)。 */
export interface SegmentMeasure {
  length: number;
  /** 累计弧长,lut[j] 对应参数 j / LUT_STEPS。 */
  lut: Float64Array;
}

/** @internal 整条路径的弧长表(笔速 pace.ts 也用)。 */
export interface PathMeasure {
  total: number;
  /** 每条子路径的每一段。 */
  subpaths: Array<{ length: number; segments: SegmentMeasure[] }>;
}

const measures = new WeakMap<PathData, PathMeasure>();

function measureSegment(c: Cubic): SegmentMeasure {
  const lut = new Float64Array(LUT_STEPS + 1);
  let acc = 0;
  for (let j = 0; j < LUT_STEPS; j++) {
    acc += arcLength(c, j / LUT_STEPS, (j + 1) / LUT_STEPS);
    lut[j + 1] = acc;
  }
  return { length: acc, lut };
}

/** @internal 路径的弧长表(按路径对象缓存),与 partialPath 用的是同一份。 */
export function measurePath(path: PathData): PathMeasure {
  return measure(path);
}

function measure(path: PathData): PathMeasure {
  const hit = measures.get(path);
  if (hit) {
    return hit;
  }
  let total = 0;
  const subpaths = path.subpaths.map((sub) => {
    const segments: SegmentMeasure[] = [];
    let length = 0;
    for (let k = 0; k < segmentCount(sub); k++) {
      const m = measureSegment(segmentAt(sub, k));
      segments.push(m);
      length += m.length;
    }
    total += length;
    return { length, segments };
  });
  const result = { total, subpaths };
  measures.set(path, result);
  return result;
}

/** 路径总弧长(结果按路径对象缓存)。 */
export function pathLength(path: PathData): number {
  return measure(path).total;
}

/** 段内弧长 len 对应的参数 t。 */
function paramAtLength(m: SegmentMeasure, len: number): number {
  if (len <= 0 || m.length <= 0) {
    return 0;
  }
  if (len >= m.length) {
    return 1;
  }
  const lut = m.lut;
  let lo = 0;
  let hi = LUT_STEPS;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((lut[mid] ?? 0) < len) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  const a = lut[lo] ?? 0;
  const b = lut[hi] ?? a;
  const f = b > a ? (len - a) / (b - a) : 0;
  return (lo + f) / LUT_STEPS;
}

/** de Casteljau:取出三次段在 [t0, t1] 上的那一截(仍是三次段)。 */
export function cubicSlice(c: Cubic, t0: number, t1: number): Cubic {
  const split = (q: Cubic, t: number): { left: Cubic; right: Cubic } => {
    const lerp = (a: number, b: number): number => a + (b - a) * t;
    const x01 = lerp(q[0], q[2]);
    const y01 = lerp(q[1], q[3]);
    const x12 = lerp(q[2], q[4]);
    const y12 = lerp(q[3], q[5]);
    const x23 = lerp(q[4], q[6]);
    const y23 = lerp(q[5], q[7]);
    const x012 = lerp(x01, x12);
    const y012 = lerp(y01, y12);
    const x123 = lerp(x12, x23);
    const y123 = lerp(y12, y23);
    const x = lerp(x012, x123);
    const y = lerp(y012, y123);
    return {
      left: [q[0], q[1], x01, y01, x012, y012, x, y],
      right: [x, y, x123, y123, x23, y23, q[6], q[7]],
    };
  };
  let seg = c;
  if (t1 < 1) {
    seg = split(seg, t1).left;
  }
  if (t0 > 0) {
    // 已截到 [0, t1]:在这一截里 t0 对应 t0 / t1。
    seg = split(seg, t1 > 0 ? t0 / t1 : 0).right;
  }
  return seg;
}

/**
 * 按弧长比例截取 [from, to](0..1,跨所有子路径依次累计)。
 * 完整落在区间里的子路径原样保留(含闭合标记);被截断的只保留相应的一截、按不闭合处理。
 */
export function partialPath(path: PathData, from: number, to: number): PathData {
  const f0 = Math.max(0, Math.min(1, from));
  const f1 = Math.max(0, Math.min(1, to));
  if (!(f1 > f0)) {
    return EMPTY_PATH;
  }
  if (f0 <= 0 && f1 >= 1) {
    return path;
  }
  const m = measure(path);
  if (!(m.total > 0)) {
    return f1 >= 1 ? path : EMPTY_PATH;
  }
  const l0 = f0 * m.total;
  const l1 = f1 * m.total;
  const out: Subpath[] = [];
  let offset = 0;
  path.subpaths.forEach((sub, si) => {
    const sm = m.subpaths[si];
    if (!sm) {
      return;
    }
    const start = offset;
    const end = offset + sm.length;
    offset = end;
    if (end <= l0 || start >= l1) {
      return;
    }
    if (start >= l0 && end <= l1) {
      out.push(sub);
      return;
    }
    const points: number[] = [];
    let segStart = start;
    sm.segments.forEach((seg, k) => {
      const a = segStart;
      const b = segStart + seg.length;
      segStart = b;
      // 整段落在区间外(含恰好在端点上接触)的不要,免得多出零长度的一截。
      if (b <= l0 || a >= l1) {
        return;
      }
      const t0 = paramAtLength(seg, l0 - a);
      const t1 = paramAtLength(seg, l1 - a);
      const c = cubicSlice(segmentAt(sub, k), t0, t1);
      if (points.length === 0) {
        points.push(c[0], c[1]);
      }
      points.push(c[2], c[3], c[4], c[5], c[6], c[7]);
    });
    if (points.length > 2) {
      out.push({ points, closed: false });
    }
  });
  return { subpaths: out };
}
