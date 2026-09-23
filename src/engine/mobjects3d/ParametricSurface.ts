import type { Resamplable, Vec3 } from './Mesh3D';
import { Mesh3D, newellNormalAt, normalizeAt, sameParams } from './Mesh3D';
import type { ParamFn } from './parametric';
import { sphereParam } from './parametric';
import type { Projection3D } from './Projection3D';

export interface ParametricSurfaceOptions {
  uSegs?: number;
  vSegs?: number;
  uRange?: readonly [number, number];
  vRange?: readonly [number, number];
  params?: readonly number[];
  /**
   * 单面还是双面。'auto'(默认)在构造时按网格缝判断:四周闭合且可定向
   * (环面、球面)为单面,否则(开放曲面、莫比乌斯带、克莱因瓶)为双面。
   * 只在构造时判一次:同伦形变中途网格暂时张开,线框样式也不会跟着跳。
   */
  sided?: 'auto' | 'one' | 'two';
  /** 共享视角;缺省每个网格各持一份。 */
  projection?: Projection3D;
}

function requireSegs(name: string, value: number): number {
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`ParametricSurface 的 ${name} 需要 >= 1 的整数,收到 ${value}`);
  }
  return value;
}

function requireRange(
  name: string,
  range: readonly [number, number],
): [number, number] {
  if (!Number.isFinite(range[0]) || !Number.isFinite(range[1])) {
    throw new Error(`ParametricSurface 的 ${name} 需要有限区间,收到 [${range[0]}, ${range[1]}]`);
  }
  return [range[0], range[1]];
}

/** 可去奇点重取时挪动的距离:万分之一格,肉眼看不出,又大到不至于算出 0/0。 */
const NUDGE = 1e-4;

/**
 * 采样一点。返回 NaN 多半是 0/0 型的可去奇点(比如 r = 0 处的 sin(r)/r),
 * 这时向定义域内侧挪一点重取,拿到的是极限附近的值;±Infinity 是真正的极点,不挪。
 * 仍非有限返回 null。
 */
function sampleFinite(
  fn: ParamFn,
  u: number,
  v: number,
  params: number[],
  nudgeU: number,
  nudgeV: number,
): Readonly<Vec3> | null {
  let p = fn(u, v, params);
  if (Number.isNaN(p.x) || Number.isNaN(p.y) || Number.isNaN(p.z)) {
    p = fn(u + nudgeU, v + nudgeV, params);
  }
  return Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z) ? p : null;
}

type SeamKind = 'same' | 'reversed' | 'open';

function near(p: Readonly<Vec3>, q: Readonly<Vec3>, tol: number): boolean {
  return (
    Math.abs(p.x - q.x) <= tol &&
    Math.abs(p.y - q.y) <= tol &&
    Math.abs(p.z - q.z) <= tol
  );
}

/** 一条网格线上的点是否全部塌成一点(极点)。 */
function collapsed(line: ReadonlyArray<Readonly<Vec3>>, tol: number): boolean {
  const first = line[0];
  return first !== undefined && line.every((p) => near(p, first, tol));
}

/**
 * 同一方向首尾两条网格线 a、b 是否粘合,粘合时是同向还是反向(反向 = 莫比乌斯式的翻转缝)。
 * 允许错位粘合(克莱因瓶的 u 缝把 v 映成 π − v);另一方向本身首尾重合时按周期取模。
 */
function seamKind(
  a: ReadonlyArray<Readonly<Vec3>>,
  b: ReadonlyArray<Readonly<Vec3>>,
  tol: number,
): SeamKind {
  const m = a.length;
  if (m === 0 || b.length !== m) {
    return 'open';
  }
  if (a.every((p, k) => { const q = b[k]; return q !== undefined && near(p, q, tol); })) {
    return 'same';
  }
  // b 的每个点在 a 里的全部匹配位置(极点、周期重复点会有多个)。
  const matches = b.map((q) => {
    const list: number[] = [];
    a.forEach((p, i) => {
      if (near(p, q, tol)) {
        list.push(i);
      }
    });
    return list;
  });
  if (matches.some((list) => list.length === 0)) {
    return 'open';
  }
  const firstA = a[0];
  const lastA = a[m - 1];
  const period = firstA && lastA && near(firstA, lastA, tol) ? m - 1 : 0;
  const fits = (dir: 1 | -1): boolean =>
    (matches[0] ?? []).some((c) => {
      for (let k = 1; k < m; k++) {
        let want = c + dir * k;
        if (period > 0) {
          want = ((want % period) + period) % period;
        }
        if (!(matches[k] ?? []).includes(want)) {
          return false;
        }
      }
      return true;
    });
  if (fits(-1)) {
    return 'reversed';
  }
  return fits(1) ? 'same' : 'open';
}

/**
 * ParametricSurface:参数曲面。
 * 网格拓扑固定(uSegs × vSegs),顶点按 fn(u, v, params) 采样;
 * resample() 用新参数重算顶点,供 ParamMorph / updater 逐帧驱动。
 * 周期方向靠首尾采到同一值自然闭合,无需包裹面片。
 *
 * 法线用网格四边形的对角线叉积(极点处两个顶点重合也不退化)× 全局朝向符号,
 * 而不是基类的「按体心定向」:环面这类非凸曲面按体心定向会把近一半的面判反。
 */
export class ParametricSurface extends Mesh3D implements Resamplable {
  private readonly fn: ParamFn;
  private readonly uSegs: number;
  private readonly vSegs: number;
  private readonly uRange: readonly [number, number];
  private readonly vRange: readonly [number, number];
  private params: number[];
  private sampled = false;
  private warnedNonFinite = false;
  private readonly twoSidedValue: boolean;
  /** 叉积法线的全局朝向(+1 朝外 / -1 朝内)。顶点变了要重标定(见 computeFaceNormals)。 */
  private normalSign = 1;

  constructor(fn: ParamFn, options?: ParametricSurfaceOptions) {
    const uSegs = requireSegs('uSegs', options?.uSegs ?? 28);
    const vSegs = requireSegs('vSegs', options?.vSegs ?? 20);
    // 优先用显式选项,其次用采样函数自己声明的推荐定义域
    // (sphereParam 的 v 只到 π,kleinParam 的 u 只到 π,不这样会把曲面覆盖两遍)。
    const uRange = requireRange('uRange', options?.uRange ?? fn.uRange ?? [0, Math.PI * 2]);
    const vRange = requireRange('vRange', options?.vRange ?? fn.vRange ?? [0, Math.PI * 2]);
    const params = [...(options?.params ?? [])];
    const du = (uRange[1] - uRange[0]) / uSegs;
    const dv = (vRange[1] - vRange[0]) / vSegs;
    const vertices: Vec3[] = [];
    for (let j = 0; j <= vSegs; j++) {
      const v = vRange[0] + dv * j;
      for (let i = 0; i <= uSegs; i++) {
        const u = uRange[0] + du * i;
        const p = sampleFinite(
          fn,
          u,
          v,
          params,
          (i < uSegs ? du : -du) * NUDGE,
          (j < vSegs ? dv : -dv) * NUDGE,
        );
        if (!p) {
          throw new Error(`ParametricSurface 的采样函数在 (u=${u}, v=${v}) 处返回了非有限值`);
        }
        vertices.push({ x: p.x, y: p.y, z: p.z });
      }
    }
    const faces: number[][] = [];
    const cols = uSegs + 1;
    for (let j = 0; j < vSegs; j++) {
      for (let i = 0; i < uSegs; i++) {
        const a = j * cols + i;
        faces.push([a, a + 1, a + cols + 1, a + cols]);
      }
    }
    super(vertices, faces, options?.projection);
    this.fn = fn;
    this.uSegs = uSegs;
    this.vSegs = vSegs;
    this.uRange = uRange;
    this.vRange = vRange;
    this.params = params;
    this.sampled = true;
    const sided = options?.sided ?? 'auto';
    this.twoSidedValue =
      sided === 'two' || (sided === 'auto' && !this.isClosedOrientable());
  }

  getParams(): number[] {
    return [...this.params];
  }

  /**
   * 按新参数重采样;参数与当前逐元素相等时是空操作。不传参数则按当前参数强制重采。
   * 采样规则与构造时相同(NaN 先挪一点重取);仍非有限的点沿用上一次的位置并告警一次 ——
   * 构造时没有「上一次」,只能抛错;形变动画中途抛错则会打断整条时间线。
   */
  resample(params?: readonly number[]): void {
    if (params) {
      if (this.sampled && sameParams(params, this.params)) {
        return;
      }
      this.params = [...params];
    }
    const cols = this.uSegs + 1;
    const du = (this.uRange[1] - this.uRange[0]) / this.uSegs;
    const dv = (this.vRange[1] - this.vRange[0]) / this.vSegs;
    for (let j = 0; j <= this.vSegs; j++) {
      const v = this.vRange[0] + dv * j;
      const nudgeV = (j < this.vSegs ? dv : -dv) * NUDGE;
      for (let i = 0; i <= this.uSegs; i++) {
        const u = this.uRange[0] + du * i;
        const p = sampleFinite(this.fn, u, v, this.params, (i < this.uSegs ? du : -du) * NUDGE, nudgeV);
        if (p) {
          this.setVertexAt(j * cols + i, p.x, p.y, p.z);
        } else if (!this.warnedNonFinite) {
          this.warnedNonFinite = true;
          console.warn(
            `[ParametricSurface] 采样函数在 (u=${u}, v=${v}) 处返回了非有限值,该点沿用上一次的位置`,
          );
        }
      }
    }
    this.sampled = true;
  }

  protected override get twoSided(): boolean {
    return this.twoSidedValue;
  }

  /**
   * 四边形对角线叉积 (p2−p0)×(p3−p1),再乘全局朝向符号。
   * 单面曲面每次几何变化都重标定符号:同伦形变(球→环)两端的参数化定向是相反的,
   * 冻结构造期那一次标定会让后半段所有法线整体反向。双面曲面打光时自会翻向观察者,符号无所谓。
   */
  protected override computeFaceNormals(
    normals: Float64Array,
    centers: Float64Array,
  ): void {
    const verts = this.vertices;
    const faces = this.faces;
    for (let f = 0; f < faces.length; f++) {
      const face = faces[f] ?? [];
      const o = f * 3;
      const p0 = verts[face[0] ?? -1];
      const p1 = verts[face[1] ?? -1];
      const p2 = verts[face[2] ?? -1];
      const p3 = verts[face[3] ?? -1];
      if (face.length !== 4 || !p0 || !p1 || !p2 || !p3) {
        newellNormalAt(face, verts, normals, centers, o);
        continue;
      }
      const ax = p2.x - p0.x;
      const ay = p2.y - p0.y;
      const az = p2.z - p0.z;
      const bx = p3.x - p1.x;
      const by = p3.y - p1.y;
      const bz = p3.z - p1.z;
      normals[o] = ay * bz - az * by;
      normals[o + 1] = az * bx - ax * bz;
      normals[o + 2] = ax * by - ay * bx;
      centers[o] = (p0.x + p1.x + p2.x + p3.x) / 4;
      centers[o + 1] = (p0.y + p1.y + p2.y + p3.y) / 4;
      centers[o + 2] = (p0.z + p1.z + p2.z + p3.z) / 4;
    }
    if (this.twoSidedValue) {
      this.normalSign = 1;
    } else {
      this.calibrateNormalSign();
    }
    for (let f = 0; f < faces.length; f++) {
      normalizeAt(normals, f * 3, this.normalSign);
    }
  }

  /** 构造时的网格缝检测:四周闭合(缝粘合或塌成极点)且没有反向缝。 */
  private isClosedOrientable(): boolean {
    const verts = this.vertices;
    const cols = this.uSegs + 1;
    const rows = this.vSegs + 1;
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const v of verts) {
      minX = Math.min(minX, v.x);
      minY = Math.min(minY, v.y);
      minZ = Math.min(minZ, v.z);
      maxX = Math.max(maxX, v.x);
      maxY = Math.max(maxY, v.y);
      maxZ = Math.max(maxZ, v.z);
    }
    const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
    const tol = Math.max(1e-9, diag * 1e-6);
    const at = (i: number, j: number): Readonly<Vec3> =>
      verts[j * cols + i] ?? { x: NaN, y: NaN, z: NaN };
    const column = (i: number): Array<Readonly<Vec3>> =>
      Array.from({ length: rows }, (_, j) => at(i, j));
    const row = (j: number): Array<Readonly<Vec3>> =>
      Array.from({ length: cols }, (_, i) => at(i, j));
    const uSeam = seamKind(column(0), column(this.uSegs), tol);
    const vSeam = seamKind(row(0), row(this.vSegs), tol);
    const uClosed =
      uSeam !== 'open' ||
      (collapsed(column(0), tol) && collapsed(column(this.uSegs), tol));
    const vClosed =
      vSeam !== 'open' || (collapsed(row(0), tol) && collapsed(row(this.vSegs), tol));
    return uClosed && vClosed && uSeam !== 'reversed' && vSeam !== 'reversed';
  }

  /**
   * 定出叉积法线的全局朝向(只对单面,即封闭可定向的曲面有意义)。
   * 主判据是网格的有向体积:它是顶点的多项式,随形变连续变化,
   * 不像「离质心最远的面」那样在两个几乎打平的候选之间跳来跳去 ——
   * 那会让同伦形变中途整张曲面的法线在一帧内全体反向(肉眼是一次爆闪)。
   * 有向体积接近 0 时(形变正好穿过反转点)退回面积加权的
   * 「法线 vs 离心方向」投票,并加迟滞避免逐帧抖动。
   */
  private calibrateNormalSign(): void {
    const prev = this.normalSign;
    const volume = this.signedVolume();
    const extent = this.boundingVolume();
    if (extent > 0 && Math.abs(volume) > extent * 1e-3) {
      this.normalSign = volume > 0 ? 1 : -1;
      return;
    }
    const { score, area } = this.outwardScore();
    if (!(area > 0)) {
      this.normalSign = prev;
      return;
    }
    const want = score >= 0 ? 1 : -1;
    // 证据不够强就保持原判,免得在过零点附近逐帧翻。
    if (want !== prev && Math.abs(score) < area * 0.1) {
      this.normalSign = prev;
      return;
    }
    this.normalSign = want;
  }

  /** 按原始绕序算出的有向体积。闭合曲面绕序朝外时为正。 */
  private signedVolume(): number {
    const verts = this.vertices;
    let vol = 0;
    for (const face of this.faces) {
      const a = verts[face[0] ?? -1];
      if (!a) {
        continue;
      }
      for (let k = 1; k + 1 < face.length; k++) {
        const b = verts[face[k] ?? -1];
        const c = verts[face[k + 1] ?? -1];
        if (!b || !c) {
          continue;
        }
        vol +=
          a.x * (b.y * c.z - b.z * c.y) -
          a.y * (b.x * c.z - b.z * c.x) +
          a.z * (b.x * c.y - b.y * c.x);
      }
    }
    return vol / 6;
  }

  /** 顶点包围盒的体积,给有向体积当量纲参照。 */
  private boundingVolume(): number {
    let minX = Infinity;
    let minY = Infinity;
    let minZ = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    let maxZ = -Infinity;
    for (const v of this.vertices) {
      minX = Math.min(minX, v.x);
      minY = Math.min(minY, v.y);
      minZ = Math.min(minZ, v.z);
      maxX = Math.max(maxX, v.x);
      maxY = Math.max(maxY, v.y);
      maxZ = Math.max(maxZ, v.z);
    }
    if (!Number.isFinite(minX)) {
      return 0;
    }
    return (maxX - minX) * (maxY - minY) * (maxZ - minZ);
  }

  /** 面积加权的「叉积法线是否指向离心方向」总分。score > 0 表示原始绕序朝外。 */
  private outwardScore(): { score: number; area: number } {
    const verts = this.vertices;
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const v of verts) {
      cx += v.x;
      cy += v.y;
      cz += v.z;
    }
    const n = verts.length || 1;
    cx /= n;
    cy /= n;
    cz /= n;
    let score = 0;
    let area = 0;
    for (const face of this.faces) {
      const p0 = verts[face[0] ?? -1];
      const p1 = verts[face[1] ?? -1];
      const p2 = verts[face[2] ?? -1];
      const p3 = verts[face[3] ?? -1];
      if (!p0 || !p1 || !p2 || !p3) {
        continue;
      }
      const ax = p2.x - p0.x;
      const ay = p2.y - p0.y;
      const az = p2.z - p0.z;
      const bx = p3.x - p1.x;
      const by = p3.y - p1.y;
      const bz = p3.z - p1.z;
      const nx = ay * bz - az * by;
      const ny = az * bx - ax * bz;
      const nz = ax * by - ay * bx;
      const mag = Math.hypot(nx, ny, nz);
      if (!(mag > 0)) {
        continue;
      }
      const dx = (p0.x + p1.x + p2.x + p3.x) / 4 - cx;
      const dy = (p0.y + p1.y + p2.y + p3.y) / 4 - cy;
      const dz = (p0.z + p1.z + p2.z + p3.z) / 4 - cz;
      const dist = Math.hypot(dx, dy, dz);
      if (!(dist > 0)) {
        continue;
      }
      area += mag;
      score += (nx * dx + ny * dy + nz * dz) / dist;
    }
    return { score, area };
  }
}

/**
 * 球面预设:把 vRange 钉在 [0, π]。
 * sphereParam 已经自带这个定义域;这里再钉一次,
 * 防止调用方通过 options 传入别的 vRange 把球面覆盖两遍。
 */
export function sphereSurface(
  radius: number,
  options?: Omit<ParametricSurfaceOptions, 'vRange'>,
): ParametricSurface {
  return new ParametricSurface(sphereParam(radius), {
    ...options,
    vRange: [0, Math.PI],
  });
}
