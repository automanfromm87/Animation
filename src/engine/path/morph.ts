import type { PathData, Subpath } from './path';
import { pathBounds, segmentCount } from './path';
import { cubicSlice } from './measure';

/**
 * 形状变形的对齐:让两条路径的子路径数、每条子路径的段数一一对应,之后就能逐点插值。
 * - 子路径少的一方补「塌成一点」的子路径(位于自身包围盒中心),新出现的部分从中心长出来;
 * - 段数少的一方把段均匀细分(de Casteljau),多出来的段摊给尽量多的原段;
 * - 两条都闭合时,把目标的起点转到离源起点最近的位置、绕向不同就反过来,变形才不会拧成麻花
 *   (只反单条子路径的一方,见 alignPaths)。
 */

type Cubic = [number, number, number, number, number, number, number, number];

function segmentsOf(sub: Subpath): Cubic[] {
  const out: Cubic[] = [];
  const p = sub.points;
  for (let k = 0; k < segmentCount(sub); k++) {
    const i = 6 * k;
    out.push([
      p[i] ?? 0,
      p[i + 1] ?? 0,
      p[i + 2] ?? 0,
      p[i + 3] ?? 0,
      p[i + 4] ?? 0,
      p[i + 5] ?? 0,
      p[i + 6] ?? 0,
      p[i + 7] ?? 0,
    ]);
  }
  return out;
}

function fromSegments(segs: readonly Cubic[], closed: boolean): Subpath {
  const first = segs[0];
  if (!first) {
    return { points: [], closed };
  }
  const points = [first[0], first[1]];
  for (const s of segs) {
    points.push(s[2], s[3], s[4], s[5], s[6], s[7]);
  }
  return { points, closed };
}

/** 一个点重复成 count 段零长度三次段。 */
function collapsed(x: number, y: number, count: number): Cubic[] {
  return Array.from({ length: Math.max(1, count) }, (): Cubic => [x, y, x, y, x, y, x, y]);
}

/** 把 segs 细分成恰好 target 段:每段切成 m_i 等份,Σm_i = target,m_i 尽量平均。 */
function subdivideTo(segs: readonly Cubic[], target: number): Cubic[] {
  const n = segs.length;
  if (n === 0 || target <= n) {
    return segs.slice();
  }
  const out: Cubic[] = [];
  const base = Math.floor(target / n);
  let extra = target - base * n;
  for (const s of segs) {
    let m = base;
    if (extra > 0) {
      m += 1;
      extra -= 1;
    }
    for (let j = 0; j < m; j++) {
      out.push(cubicSlice(s, j / m, (j + 1) / m) as Cubic);
    }
  }
  return out;
}

/** 闭合子路径的有向面积(按端点折线算,够判断绕向)。 */
function signedArea(segs: readonly Cubic[]): number {
  let a = 0;
  for (const s of segs) {
    a += s[0] * s[7] - s[6] * s[1];
  }
  return a / 2;
}

function reverseSegments(segs: readonly Cubic[]): Cubic[] {
  return segs
    .slice()
    .reverse()
    .map((s): Cubic => [s[6], s[7], s[4], s[5], s[2], s[3], s[0], s[1]]);
}

/** 目标起点转到哪一段,能让两边端点的平方距离和最小。 */
function bestRotation(a: readonly Cubic[], b: readonly Cubic[]): number {
  const n = b.length;
  let best = 0;
  let bestCost = Infinity;
  for (let shift = 0; shift < n; shift++) {
    let cost = 0;
    for (let i = 0; i < n && cost < bestCost; i++) {
      const p = a[i];
      const q = b[(i + shift) % n];
      if (p && q) {
        cost += (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;
      }
    }
    if (cost < bestCost) {
      bestCost = cost;
      best = shift;
    }
  }
  return best;
}

function center(path: PathData): { x: number; y: number } {
  const b = pathBounds(path);
  return b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : { x: 0, y: 0 };
}

/**
 * 与 path 同结构、所有点都塌在 (x, y) 的路径:形状变形里没有对应物的部分从这里长出来(或缩回这里)。
 * 结构相同,alignPaths 不用再补子路径,闭合标记也跟着 path。
 */
export function collapsePath(path: PathData, x: number, y: number): PathData {
  return {
    subpaths: path.subpaths.map((sub) => ({
      points: sub.points.map((_, i) => (i % 2 === 0 ? x : y)),
      closed: sub.closed,
    })),
  };
}

/** 对齐两条路径,返回点数一一对应的两条新路径(用 lerpPath 插值)。 */
export function alignPaths(a: PathData, b: PathData): [PathData, PathData] {
  const n = Math.max(a.subpaths.length, b.subpaths.length);
  if (n === 0) {
    return [a, b];
  }
  const ca = center(a);
  const cb = center(b);
  const outA: Subpath[] = [];
  const outB: Subpath[] = [];
  for (let i = 0; i < n; i++) {
    const sa = a.subpaths[i];
    const sb = b.subpaths[i];
    let segA = sa ? segmentsOf(sa) : [];
    let segB = sb ? segmentsOf(sb) : [];
    if (segA.length === 0 && segB.length === 0) {
      continue;
    }
    const count = Math.max(segA.length, segB.length);
    segA = segA.length === 0 ? collapsed(ca.x, ca.y, count) : subdivideTo(segA, count);
    segB = segB.length === 0 ? collapsed(cb.x, cb.y, count) : subdivideTo(segB, count);
    // 各自保留自己的闭合标记(补出来的塌点子路径跟随对方),插值时前半程用源的、后半程用目标的。
    const closedA = sa?.closed ?? sb?.closed ?? false;
    const closedB = sb?.closed ?? sa?.closed ?? false;
    if (sa?.closed && sb?.closed) {
      // 只反「独占一条子路径」的那一方:非零环绕规则下,带洞图形(字形 o、a)的洞靠反向绕挖出来,
      // 把洞反过来它就被填上了。两边都是多子路径时宁可中途拧一下,也不让终态前的画面填错。
      if (Math.sign(signedArea(segA)) * Math.sign(signedArea(segB)) < 0) {
        if (b.subpaths.length === 1) {
          segB = reverseSegments(segB);
        } else if (a.subpaths.length === 1) {
          segA = reverseSegments(segA);
        }
      }
      const shift = bestRotation(segA, segB);
      if (shift > 0) {
        segB = [...segB.slice(shift), ...segB.slice(0, shift)];
      }
    }
    outA.push(fromSegments(segA, closedA));
    outB.push(fromSegments(segB, closedB));
  }
  return [{ subpaths: outA }, { subpaths: outB }];
}

/**
 * 逐点插值两条已对齐的路径(alignPaths 的输出)。t=0 返回 a、t=1 返回 b(精确终态)。
 * 点数对不上的子路径按较短的一方截断(防御,不抛错)。
 */
export function lerpPath(a: PathData, b: PathData, t: number): PathData {
  if (t <= 0) {
    return a;
  }
  if (t >= 1) {
    return b;
  }
  const n = Math.min(a.subpaths.length, b.subpaths.length);
  const subpaths: Subpath[] = [];
  for (let i = 0; i < n; i++) {
    const pa = a.subpaths[i]?.points ?? [];
    const pb = b.subpaths[i]?.points ?? [];
    const len = Math.min(pa.length, pb.length);
    const points = new Array<number>(len);
    for (let k = 0; k < len; k++) {
      const x = pa[k] ?? 0;
      points[k] = x + ((pb[k] ?? 0) - x) * t;
    }
    subpaths.push({ points, closed: (t < 0.5 ? a.subpaths[i]?.closed : b.subpaths[i]?.closed) ?? false });
  }
  return { subpaths };
}
