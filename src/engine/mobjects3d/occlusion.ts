import type { Mesh3D } from './Mesh3D';
import type { Projection3D, ProjectionFrame } from './Projection3D';

/**
 * 3D 线条与标注的遮挡:光线投射可见性。
 *
 * 不做「面与线段一起排序」:面排序是每个网格在自己 drawShape 里完成的,别的对象插不进去;
 * 而且线框网格根本没有面可盖,课本式「背后的线画虚线」本来就要逐点判断可见性。
 * 所以线上每一点自己问:视点到它的线段,是否穿过某个遮挡网格的三角形,且它在那个面后方至少
 * depthTolerance(沿面的法向量量,斜着看曲面上的曲线也不会被自己所在的弦面挡住)。
 * 网格照旧按自己的方式画,线条只被**列出的**(或 Space3D 里的)网格遮挡,线不挡线,网格之间仍不遮挡。
 */

/** 被遮挡的部分怎么画:'shown' 不管遮挡;'dashed' 淡虚线(线条缺省);'faded' 调淡;'none' 不画。 */
export type HiddenStyle3D = 'shown' | 'dashed' | 'faded' | 'none';

const HIDDEN_STYLES: readonly HiddenStyle3D[] = ['shown', 'dashed', 'faded', 'none'];

export interface Occlusion3DOptions {
  /**
   * 挡住它的网格。不给 = 自动:在 Space3D 里取空间内全部网格,不在 Space3D 里就没有遮挡。
   * 显式给 [] 表示关掉遮挡(包括 Space3D 的自动遮挡)。
   * 网格必须与它共用同一个 Projection3D 实例、放在同一个画框里(同一父节点、同样的位置)。
   * 画框检查只比较两者**自身**的 position / scale / rotation(对象不知道自己的父节点):
   * 线条加在顶层、网格放进一个挪过的组,两者自身都在 (0, 0) 时检查不出来,
   * 遮挡会按同一画框算错 —— 这种写法请改成都放进同一个 Space3D / 同一个组。
   * 遮挡强度见 Mesh3D.occlusionStrength:半透明填色只挡一部分,不填色的开放曲面不挡。
   */
  occluders?: readonly Mesh3D[];
  /** 被挡住的部分怎么画。缺省:线条 'dashed',Anchor3D 'shown'。 */
  hidden?: HiddenStyle3D;
  /**
   * 深度容差(本地单位,非负有限):点要在遮挡面后方至少这么远(沿那个面的法向量)才算挡住。缺省 1.5。
   * 按法向量而不是视线量,斜着看曲面上的曲线也不会被自己所在曲面的弦面判成挡住;
   * 网格很粗、曲线仍闪虚线就调大。
   */
  depthTolerance?: number;
}

/** 深度容差缺省值:盖住常见网格凹处的弦高(环面内侧约 0.3),又远小于曲面前后两层的间距。 */
export const DEFAULT_DEPTH_TOLERANCE = 1.5;

/** 按全局 3D 弧长的一段:[from, to] 内被遮挡的强度都是 k(0 = 看得见)。 */
export interface VisibilityRun {
  readonly from: number;
  readonly to: number;
  readonly k: number;
}

/** 能接受 Space3D 自动遮挡表的对象。 */
export interface AutoOccludable {
  /** @internal Space3D 用:没显式给 occluders 时生效的网格表。 */
  setAutoOccluders(meshes: readonly Mesh3D[]): void;
}

export function isAutoOccludable(m: object): m is AutoOccludable {
  return typeof (m as Partial<AutoOccludable>).setAutoOccluders === 'function';
}

/** 构造期校验 hidden。 */
export function requireHidden(owner: string, value: HiddenStyle3D): HiddenStyle3D {
  if (!HIDDEN_STYLES.includes(value)) {
    throw new Error(`${owner} 的 hidden 只能是 shown / dashed / faded / none,收到 ${String(value)}`);
  }
  return value;
}

/** 绘制期兜底:公共字段被改坏时按 fallback。 */
export function safeHidden(value: HiddenStyle3D, fallback: HiddenStyle3D): HiddenStyle3D {
  return HIDDEN_STYLES.includes(value) ? value : fallback;
}

/** 绘制期兜底:容差非有限或为负时按缺省。 */
export function safeTolerance(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : DEFAULT_DEPTH_TOLERANCE;
}

/** 构造期校验 occluders:必须是数组(元素是不是网格交给绘制期的视角检查)。 */
export function copyOccluders(
  owner: string,
  list: readonly Mesh3D[] | null | undefined,
): readonly Mesh3D[] | null {
  if (list === undefined || list === null) {
    return null;
  }
  if (!Array.isArray(list)) {
    throw new Error(`${owner} 的 occluders 需要一个网格数组`);
  }
  return Object.freeze([...list]);
}

/** 重心坐标边界容差:光线正好擦过两个三角形的公共边时也算命中。 */
const BARY_EPS = 1e-9;
/**
 * 深度容差按面的法向量量,视线与法向夹角的余弦取这个下限:几乎掠射时,
 * 沿视线最多要求 tolerance / 0.15 的距离,真正挡在前面的面不会因为斜着看被放过。
 */
const MIN_COS = 0.15;
/** 屏幕网格每边格数上限。 */
const MAX_GRID = 64;

/**
 * 一个网格在当前视角下的遮挡索引:参与遮挡的三角形(视图空间坐标)+ 投影平面上的均匀网格。
 * 透视下「视点 → P」的线段在屏幕上只是一个点 proj(P),三角形能挡住 P 仅当 proj(P) 落在它的投影里,
 * 所以只测 proj(P) 所在格子里包围盒含它的三角形。顶点落在近平面钳制区的三角形投影失真,
 * 不能按格子排除,放进「总是测试」表。
 */
export class OcclusionIndex {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
  /** 实际收进来的三角形数(非有限的跳过,缓冲可能有富余)。 */
  private readonly count: number;
  private readonly tri: Float64Array;
  private readonly box: Float64Array;
  private readonly cellStart: Uint32Array;
  private readonly cellTris: Uint32Array;
  private readonly always: Uint32Array;
  private readonly grid: number;
  /** 屏幕网格(只含可按格子排除的三角形)的范围与格子尺寸。 */
  private readonly gridX0: number;
  private readonly gridY0: number;
  private readonly gridX1: number;
  private readonly gridY1: number;
  private readonly cellW: number;
  private readonly cellH: number;
  private readonly d: number;
  private readonly minDenom: number;

  private constructor(mesh: Mesh3D, projection: Projection3D) {
    const { view, twoSided } = mesh.occlusionView();
    const faces = mesh.faces;
    const c = projection.constants();
    this.d = c.d;
    this.minDenom = c.minDenom;
    // 单面(封闭)网格只取正面:从外面进入必经正面,结果精确,且省一半;双面网格取全部面。
    let count = 0;
    for (let f = 0; f < view.faceCount; f++) {
      const face = faces[f];
      if (!face || face.length < 3 || (!twoSided && view.front[f] !== 1)) {
        continue;
      }
      count += face.length - 2;
    }
    const tri = new Float64Array(count * 9);
    const box = new Float64Array(count * 4);
    const near: number[] = [];
    const gridded: number[] = [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const rot = view.rot;
    const proj = view.proj;
    let t = 0;
    for (let f = 0; f < view.faceCount; f++) {
      const face = faces[f];
      if (!face || face.length < 3 || (!twoSided && view.front[f] !== 1)) {
        continue;
      }
      const a = face[0] ?? 0;
      for (let k = 1; k + 1 < face.length; k++) {
        const b = face[k] ?? 0;
        const c2 = face[k + 1] ?? 0;
        let clamped = false;
        let finite = true;
        let bx0 = Infinity;
        let by0 = Infinity;
        let bx1 = -Infinity;
        let by1 = -Infinity;
        for (let q = 0; q < 3; q++) {
          const vi = q === 0 ? a : q === 1 ? b : c2;
          const x = rot[vi * 3] ?? NaN;
          const y = rot[vi * 3 + 1] ?? NaN;
          const z = rot[vi * 3 + 2] ?? NaN;
          tri[t * 9 + q * 3] = x;
          tri[t * 9 + q * 3 + 1] = y;
          tri[t * 9 + q * 3 + 2] = z;
          if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
            finite = false;
          }
          if (c.d - z < c.minDenom) {
            clamped = true;
          }
          const px = proj[vi * 2] ?? NaN;
          const py = proj[vi * 2 + 1] ?? NaN;
          bx0 = Math.min(bx0, px);
          by0 = Math.min(by0, py);
          bx1 = Math.max(bx1, px);
          by1 = Math.max(by1, py);
        }
        if (!finite) {
          continue;
        }
        // 包围盒外扩一点点:点正好落在格子边界上、三角形包围盒贴着边界时不会漏测。
        const pad = 1e-7 * (1 + Math.abs(bx0) + Math.abs(bx1) + Math.abs(by0) + Math.abs(by1));
        box[t * 4] = bx0 - pad;
        box[t * 4 + 1] = by0 - pad;
        box[t * 4 + 2] = bx1 + pad;
        box[t * 4 + 3] = by1 + pad;
        if (clamped || !Number.isFinite(bx0 + by0 + bx1 + by1)) {
          near.push(t);
        } else {
          gridded.push(t);
          minX = Math.min(minX, bx0 - pad);
          minY = Math.min(minY, by0 - pad);
          maxX = Math.max(maxX, bx1 + pad);
          maxY = Math.max(maxY, by1 + pad);
        }
        t += 1;
      }
    }
    this.count = t;
    this.tri = tri;
    this.box = box;
    this.always = Uint32Array.from(near);
    const g = gridded.length > 0
      ? Math.min(MAX_GRID, Math.max(1, Math.round(Math.sqrt(gridded.length))))
      : 1;
    this.grid = g;
    if (gridded.length === 0) {
      minX = 0;
      minY = 0;
      maxX = 0;
      maxY = 0;
    }
    this.gridX0 = minX;
    this.gridY0 = minY;
    this.gridX1 = maxX;
    this.gridY1 = maxY;
    this.cellW = maxX > minX ? (maxX - minX) / g : 1;
    this.cellH = maxY > minY ? (maxY - minY) / g : 1;
    // 「总是测试」表非空时整块屏幕都可能被挡,快速排除用的包围盒放到无穷大。
    const unbounded = near.length > 0;
    this.minX = unbounded ? -Infinity : minX;
    this.minY = unbounded ? -Infinity : minY;
    this.maxX = unbounded ? Infinity : maxX;
    this.maxY = unbounded ? Infinity : maxY;
    // CSR:先数每格的三角形数,再填。
    const counts = new Uint32Array(g * g + 1);
    const span = (tIndex: number): [number, number, number, number] => [
      this.cellX(box[tIndex * 4] ?? 0),
      this.cellY(box[tIndex * 4 + 1] ?? 0),
      this.cellX(box[tIndex * 4 + 2] ?? 0),
      this.cellY(box[tIndex * 4 + 3] ?? 0),
    ];
    for (const tIndex of gridded) {
      const [i0, j0, i1, j1] = span(tIndex);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          counts[j * g + i + 1] = (counts[j * g + i + 1] ?? 0) + 1;
        }
      }
    }
    for (let k = 1; k < counts.length; k++) {
      counts[k] = (counts[k] ?? 0) + (counts[k - 1] ?? 0);
    }
    const cellTris = new Uint32Array(counts[g * g] ?? 0);
    const fill = counts.slice(0, g * g);
    for (const tIndex of gridded) {
      const [i0, j0, i1, j1] = span(tIndex);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const cell = j * g + i;
          const at = fill[cell] ?? 0;
          cellTris[at] = tIndex;
          fill[cell] = at + 1;
        }
      }
    }
    this.cellStart = counts;
    this.cellTris = cellTris;
  }

  /** @internal 为网格在当前视角下建索引(调用方负责缓存,见 occlusionIndexFor)。 */
  static build(mesh: Mesh3D, projection: Projection3D): OcclusionIndex {
    return new OcclusionIndex(mesh, projection);
  }

  /** 参与遮挡的三角形个数(测试、调试用)。 */
  get triangleCount(): number {
    return this.count;
  }

  /**
   * 视图空间点 (x, y, z)、它的投影 (px, py):视点到它的线段是否穿过某个三角形,
   * 且点在那个三角形所在平面后方至少 tolerance(沿面的法向量,见 hit)。
   * 点在近平面钳制区时不测,当作看得见(那里投影本来就不是透视)。
   * brute 为 true 时不用屏幕网格,逐个三角形测(测试对拍用)。
   */
  hides(
    x: number,
    y: number,
    z: number,
    px: number,
    py: number,
    tolerance: number,
    brute = false,
  ): boolean {
    const d = this.d;
    if (!(d - z >= this.minDenom)) {
      return false;
    }
    const dz = z - d;
    const len = Math.hypot(x, y, dz);
    if (!(len > 0)) {
      return false;
    }
    // 沿法向要求 tolerance,沿视线就至少要 tolerance:先用它排除,hit 里再按夹角放大。
    const tMax = 1 - tolerance / len;
    if (!(tMax > 1e-9)) {
      return false;
    }
    if (brute) {
      const n = this.triangleCount;
      for (let t = 0; t < n; t++) {
        if (this.hit(t, x, y, dz, len, tolerance, tMax)) {
          return true;
        }
      }
      return false;
    }
    for (const t of this.always) {
      if (this.hit(t, x, y, dz, len, tolerance, tMax)) {
        return true;
      }
    }
    // 落在屏幕网格外:格子里的三角形都不含它(「总是测试」表已经测过)。
    if (!(px >= this.gridX0 && px <= this.gridX1 && py >= this.gridY0 && py <= this.gridY1)) {
      return false;
    }
    const cell = this.cellY(py) * this.grid + this.cellX(px);
    const from = this.cellStart[cell] ?? 0;
    const to = this.cellStart[cell + 1] ?? from;
    const box = this.box;
    for (let k = from; k < to; k++) {
      const t = this.cellTris[k] ?? 0;
      const o = t * 4;
      if (
        px < (box[o] ?? 0) ||
        py < (box[o + 1] ?? 0) ||
        px > (box[o + 2] ?? 0) ||
        py > (box[o + 3] ?? 0)
      ) {
        continue;
      }
      if (this.hit(t, x, y, dz, len, tolerance, tMax)) {
        return true;
      }
    }
    return false;
  }

  /** 横坐标所在的格子列(钳在网格内)。 */
  private cellX(x: number): number {
    const i = Math.floor((x - this.gridX0) / this.cellW);
    return Math.min(this.grid - 1, Math.max(0, i));
  }

  /** 纵坐标所在的格子行(钳在网格内)。 */
  private cellY(y: number): number {
    const j = Math.floor((y - this.gridY0) / this.cellH);
    return Math.min(this.grid - 1, Math.max(0, j));
  }

  /**
   * Möller–Trumbore:从视点 E = (0, 0, d) 到 P = E + (dx, dy, dz) 的线段是否在 (1e-9, tMax) 内穿过第 t 个三角形,
   * 且 P 离三角形所在平面(沿法向)超过 tolerance。len = |(dx, dy, dz)|。
   *
   * 容差按法向而不按视线量:画在曲面上的曲线离网格的弦面只差一个矢高(沿法向),
   * 斜着看(视线与法向夹角 θ)时沿视线的距离是矢高 / cosθ,按视线量会超过容差,
   * 曲线上就冒出零星的假虚线,Orbit3D 时还一闪一闪。
   */
  private hit(
    t: number,
    dx: number,
    dy: number,
    dz: number,
    len: number,
    tolerance: number,
    tMax: number,
  ): boolean {
    const tri = this.tri;
    const o = t * 9;
    const v0x = tri[o] ?? 0;
    const v0y = tri[o + 1] ?? 0;
    const v0z = tri[o + 2] ?? 0;
    const e1x = (tri[o + 3] ?? 0) - v0x;
    const e1y = (tri[o + 4] ?? 0) - v0y;
    const e1z = (tri[o + 5] ?? 0) - v0z;
    const e2x = (tri[o + 6] ?? 0) - v0x;
    const e2y = (tri[o + 7] ?? 0) - v0y;
    const e2z = (tri[o + 8] ?? 0) - v0z;
    const pX = dy * e2z - dz * e2y;
    const pY = dz * e2x - dx * e2z;
    const pZ = dx * e2y - dy * e2x;
    const det = e1x * pX + e1y * pY + e1z * pZ;
    const scale =
      Math.hypot(e1x, e1y, e1z) * Math.hypot(e2x, e2y, e2z) * Math.hypot(dx, dy, dz);
    if (!(Math.abs(det) > 1e-12 * scale)) {
      return false;
    }
    const inv = 1 / det;
    const tX = -v0x;
    const tY = -v0y;
    const tZ = this.d - v0z;
    const u = (tX * pX + tY * pY + tZ * pZ) * inv;
    if (u < -BARY_EPS || u > 1 + BARY_EPS) {
      return false;
    }
    const qX = tY * e1z - tZ * e1y;
    const qY = tZ * e1x - tX * e1z;
    const qZ = tX * e1y - tY * e1x;
    const v = (dx * qX + dy * qY + dz * qZ) * inv;
    if (v < -BARY_EPS || u + v > 1 + BARY_EPS) {
      return false;
    }
    const hitT = (e2x * qX + e2y * qY + e2z * qZ) * inv;
    if (!(hitT > 1e-9 && hitT < tMax)) {
      return false;
    }
    // |det| = |d·(e1 × e2)|,所以 cosθ = |det| / (|e1 × e2|·|d|)。
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const cos = Math.abs(det) / (Math.hypot(nx, ny, nz) * len);
    return (1 - hitT) * len > tolerance / Math.max(Number.isFinite(cos) ? cos : 1, MIN_COS);
  }
}

interface CacheEntry {
  readonly index: OcclusionIndex;
  readonly geometryVersion: number;
  readonly projection: Projection3D;
  readonly projectionVersion: number;
}

/**
 * 按网格缓存的遮挡索引:几何版本、视角实例、视角版本任一变了就重建。
 * Orbit3D 期间每帧每个遮挡网格重建一次,被所有线条 / 标注 / 刻度共享。
 */
const indexCache = new WeakMap<Mesh3D, CacheEntry>();

export function occlusionIndexFor(mesh: Mesh3D): OcclusionIndex {
  const projection = mesh.getProjection();
  const hit = indexCache.get(mesh);
  if (
    hit &&
    hit.geometryVersion === mesh.geometryVersion &&
    hit.projection === projection &&
    hit.projectionVersion === projection.version
  ) {
    return hit.index;
  }
  const index = OcclusionIndex.build(mesh, projection);
  indexCache.set(mesh, {
    index,
    geometryVersion: mesh.geometryVersion,
    projection,
    projectionVersion: projection.version,
  });
  return index;
}

/** 本帧生效的遮挡:每个网格的索引与强度(Mesh3D.occlusionStrength),以及索引包围盒的并集(快速排除)。 */
export interface ActiveOccluders {
  readonly indices: readonly OcclusionIndex[];
  readonly strengths: readonly number[];
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

const warnedProjection = new WeakMap<object, WeakSet<Mesh3D>>();
const warnedFrame = new WeakMap<object, WeakSet<Mesh3D>>();

/** 每对 (owner, mesh) 只告警一次;WeakMap / WeakSet 不留住任何一方。 */
function warnOnce(
  table: WeakMap<object, WeakSet<Mesh3D>>,
  owner: object,
  mesh: Mesh3D,
  message: string,
): void {
  let seen = table.get(owner);
  if (!seen) {
    seen = new WeakSet();
    table.set(owner, seen);
  }
  if (!seen.has(mesh)) {
    seen.add(mesh);
    console.warn(message);
  }
}

function sameFrame(a: ProjectionFrame, b: ProjectionFrame): boolean {
  return (
    a.position.x === b.position.x &&
    a.position.y === b.position.y &&
    a.scale === b.scale &&
    (a.rotation ?? 0) === (b.rotation ?? 0)
  );
}

/**
 * 整理本帧的遮挡网格:去掉遮挡强度为 0 的(透明、不填色的开放曲面)、视角实例与自己不同的(告警一次,不参与);
 * 画框(自身的 position / scale / rotation,看不到父节点)与自己不同的告警一次,仍按同一画框计算。
 * 一个都不剩返回 null。
 */
export function resolveOccluders(
  owner: object,
  list: readonly Mesh3D[],
  projection: Projection3D,
  frame: ProjectionFrame,
): ActiveOccluders | null {
  if (list.length === 0) {
    return null;
  }
  const name = owner.constructor.name;
  const indices: OcclusionIndex[] = [];
  const strengths: number[] = [];
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const mesh of list) {
    const k = mesh.occlusionStrength();
    if (!(k > 0)) {
      continue;
    }
    if (mesh.getProjection() !== projection) {
      warnOnce(
        warnedProjection,
        owner,
        mesh,
        `[${name}] 遮挡网格 ${mesh.constructor.name} 与它不共用同一个 Projection3D,这个网格不参与遮挡:把同一个视角交给两者(或都放进 Space3D)`,
      );
      continue;
    }
    if (!sameFrame(frame, mesh)) {
      warnOnce(
        warnedFrame,
        owner,
        mesh,
        `[${name}] 遮挡网格 ${mesh.constructor.name} 与它不在同一个画框(position / scale / rotation 不同):3D 对象以自身原点为灭点,线条要和网格放在同一位置(或同一个 Space3D 里都留在原点)`,
      );
    }
    const index = occlusionIndexFor(mesh);
    if (index.triangleCount === 0) {
      continue;
    }
    indices.push(index);
    strengths.push(k);
    minX = Math.min(minX, index.minX);
    minY = Math.min(minY, index.minY);
    maxX = Math.max(maxX, index.maxX);
    maxY = Math.max(maxY, index.maxY);
  }
  if (indices.length === 0) {
    return null;
  }
  return { indices, strengths, minX, minY, maxX, maxY };
}

/**
 * 一个点(视图空间坐标 + 投影)被挡的强度:挡住它的网格里遮挡强度的最大值,没挡住为 0。
 * 用强度而不是是 / 否:遮挡网格 FadeIn / FadeOut 时,被挡部分的画法跟着平滑过渡;
 * 半透明填色的网格按填充色的 alpha 只挡一部分。
 * 只看网格自身,不看祖先组的透明度(组整体淡出时网格仍然遮挡)。
 */
export function occlusionAt(
  active: ActiveOccluders,
  x: number,
  y: number,
  z: number,
  px: number,
  py: number,
  tolerance: number,
): number {
  if (!(px >= active.minX && px <= active.maxX && py >= active.minY && py <= active.maxY)) {
    return 0;
  }
  let k = 0;
  const { indices, strengths } = active;
  for (let i = 0; i < indices.length; i++) {
    const s = strengths[i] ?? 0;
    if (s <= k) {
      continue;
    }
    if (indices[i]?.hides(x, y, z, px, py, tolerance)) {
      k = s;
    }
  }
  return k;
}
