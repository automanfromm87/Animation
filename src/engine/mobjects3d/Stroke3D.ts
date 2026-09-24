import { MObject } from '../mobjects/MObject';
import { requireNonNegative } from '../mobjects/shapes';
import type { Box } from '../mobjects/types';
import { boxFromSize } from '../mobjects/types';
import type { PathLayer } from '../path/draw';
import type { PathData } from '../path/path';
import { EMPTY_PATH, PathBuilder, concatPaths } from '../path/path';
import type { ResolvedStyle } from '../theme/Theme';
import type { Mesh3D } from './Mesh3D';
import type {
  ActiveOccluders,
  AutoOccludable,
  HiddenStyle3D,
  Occlusion3DOptions,
  VisibilityRun,
} from './occlusion';
import {
  DEFAULT_DEPTH_TOLERANCE,
  copyOccluders,
  occlusionAt,
  requireHidden,
  resolveOccluders,
  safeHidden,
  safeTolerance,
} from './occlusion';
import type { ProjectionFrame, ViewConstants } from './Projection3D';
import { Projection3D } from './Projection3D';
import { HIDDEN_ALPHA, HIDDEN_DASH } from './shading';
import type { Vec3 } from './vec3';

/** 箭头:'none' 没有;'end' 只在终点(生长时跟着笔尖);'both' 两端都有。 */
export type Tips3D = 'none' | 'end' | 'both';

const TIPS: readonly Tips3D[] = ['none', 'end', 'both'];

export interface Stroke3DOptions extends Occlusion3DOptions {
  /** 共享视角;缺省每个对象各持一份(与 Mesh3D 一致 —— 但线条几乎总要和网格共用同一个)。 */
  projection?: Projection3D;
  /** 箭头,缺省 'none'(Arrow3D 缺省 'end')。 */
  tips?: Tips3D;
  /** 箭头长与底宽(本地 3D 单位,随透视缩放),缺省 14 / 10(与 2D Arrow 相同)。 */
  headLength?: number;
  headWidth?: number;
}

/** 遮挡探针的间距(本地 2D 单位,不随相机缩放:预览与导出结果一致)。 */
const PROBE_SPACING = 6;
/** 每条边最多的探针数,与每次绘制的探针总数预算(超了按比例放大间距,确定性)。 */
const MAX_PROBES_PER_EDGE = 64;
const PROBE_BUDGET = 2048;
/** 相邻探针可见性不同时,对弧长二分的次数。 */
const BISECT_STEPS = 8;

const NO_MESHES: readonly Mesh3D[] = Object.freeze([]);

/** 构造期校验 tips。 */
export function requireTips(owner: string, value: Tips3D): Tips3D {
  if (!TIPS.includes(value)) {
    throw new Error(`${owner} 的 tips 只能是 none / end / both,收到 ${String(value)}`);
  }
  return value;
}

/** 尺寸类公共字段在绘制点钳非负:动画、作者代码会绕过构造期校验。 */
function safeSize(v: number): number {
  return Number.isFinite(v) && v > 0 ? v : 0;
}

/** 路径输出目标:画布与 PathBuilder 都满足(PathBuilder 的 close 由适配器转成 closePath)。 */
interface PathSink {
  moveTo(x: number, y: number): void;
  lineTo(x: number, y: number): void;
  closePath(): void;
}

function builderSink(b: PathBuilder): PathSink {
  return {
    moveTo: (x, y) => {
      b.moveTo(x, y);
    },
    lineTo: (x, y) => {
      b.lineTo(x, y);
    },
    closePath: () => {
      b.close();
    },
  };
}

/**
 * Stroke3D:3D 线条的共同基类(Line3D、Arrow3D、Polyline3D、ParametricCurve3D)。
 * 子类只给出 3D 折线(points3D,本地坐标);投影、遮挡、按 3D 弧长的生长(Create)、
 * 箭头、包围盒、剔除半径、变形用的路径都在这里统一处理。
 *
 * 和网格同一约定:持有(通常是共用的)Projection3D,以**自身原点**为灭点,
 * 每次绘制现读视角,所以 Orbit3D / Spin3D / ViewTo 转视角时线条跟着网格一起动,不需要 updater。
 * 要和网格对得上,就放在同一个父节点、同样的位置(或都放进 Space3D)。
 *
 * 深度:线条不和网格的面交错排序,而是逐点判断可见性(见 occlusion.ts)——
 * 被 occluders 挡住的部分按 hidden 画(缺省淡虚线,与网格线框的隐藏边同一画法)。
 * 线条的可见部分总画在网格上面,所以**网格要先加、线条后加**(Space3D 自动排好)。
 * 虚线(style.dash)是屏幕空间的,与 2D 图元一致,不随透视缩短。
 */
export abstract class Stroke3D extends MObject implements AutoOccludable {
  tips: Tips3D;
  headLength: number;
  headWidth: number;
  hidden: HiddenStyle3D;
  depthTolerance: number;
  private projection: Projection3D;
  private explicitOccluders: readonly Mesh3D[] | null;
  private autoOccluders: readonly Mesh3D[] = NO_MESHES;
  /** 遮挡检查用的画框(缺省是自己;Axes3D 的零件用坐标轴本身)。 */
  private frameHost: ProjectionFrame | null = null;
  // 逐帧复用的几何缓冲:本地坐标、视图坐标、投影、全局弧长。
  private capacity = 0;
  private lx = new Float64Array(0);
  private ly = new Float64Array(0);
  private lz = new Float64Array(0);
  private vx = new Float64Array(0);
  private vy = new Float64Array(0);
  private vz = new Float64Array(0);
  private px = new Float64Array(0);
  private py = new Float64Array(0);
  private arc = new Float64Array(0);
  /** 笔画:[起点下标, 终点下标](含),连续的有限点。 */
  private strokes = new Uint32Array(0);
  private strokeCount = 0;
  private pointCount = 0;
  /** 闭合折线且整条就是一笔:完整画出时用 closePath 收口。 */
  private loop = false;
  private total = 0;
  // 按弧长取点的输出(不逐点分配对象)。
  private edge = 0;
  private edgeT = 0;
  private sx = 0;
  private sy = 0;
  private sz = 0;
  private spx = 0;
  private spy = 0;
  // 可见段(按弧长),每次绘制重算。
  private runFrom: number[] = [];
  private runTo: number[] = [];
  private runK: number[] = [];
  // 箭头三角形的输出:尖(视图坐标 + 投影)与两个底角的投影。
  private readonly head = new Float64Array(9);

  protected constructor(options?: Stroke3DOptions) {
    super();
    const name = this.constructor.name;
    this.projection = options?.projection ?? new Projection3D();
    this.tips = requireTips(name, options?.tips ?? 'none');
    this.headLength = requireNonNegative(`${name} 的 headLength`, options?.headLength ?? 14);
    this.headWidth = requireNonNegative(`${name} 的 headWidth`, options?.headWidth ?? 10);
    this.hidden = requireHidden(name, options?.hidden ?? 'dashed');
    this.depthTolerance = requireNonNegative(
      `${name} 的 depthTolerance`,
      options?.depthTolerance ?? DEFAULT_DEPTH_TOLERANCE,
    );
    this.explicitOccluders = copyOccluders(name, options?.occluders);
    // 与网格线框同宽;用 setDefaultStyle,容器的 setStyle({ strokeWidth }) 还改得动。
    this.setDefaultStyle({ strokeWidth: 2 });
  }

  /** 子类给出当前的 3D 折线(本地坐标);坐标非有限的点处断笔。每次绘制 / 量尺寸都会调用。 */
  protected abstract points3D(): ReadonlyArray<Readonly<Vec3>>;

  /** 首尾闭合(Polyline3D 的 closed):生长绕一圈回到起点。 */
  protected get closedLoop(): boolean {
    return false;
  }

  /** 线宽为 0 时箭头还画不画:缺省不画(跟数轴的箭头一致),Arrow3D 照画(跟 2D Arrow 一致)。 */
  protected get headsWithoutStroke(): boolean {
    return false;
  }

  /** 共享视角:和被标注的网格共用同一个 Projection3D。 */
  setProjection(projection: Projection3D): this {
    this.projection = projection;
    return this;
  }

  getProjection(): Projection3D {
    return this.projection;
  }

  /** 显式遮挡网格;[] 关掉遮挡;null 回到「自动」(Space3D 里取空间内全部网格)。 */
  setOccluders(meshes: readonly Mesh3D[] | null): this {
    this.explicitOccluders = copyOccluders(this.constructor.name, meshes);
    return this;
  }

  getOccluders(): readonly Mesh3D[] | null {
    return this.explicitOccluders;
  }

  /** @internal Space3D 用:没显式给 occluders 时生效的网格表。 */
  setAutoOccluders(meshes: readonly Mesh3D[]): void {
    this.autoOccluders = meshes;
  }

  /** @internal Axes3D 用:遮挡检查按哪个对象的画框比较(null = 自己)。 */
  setFrameHost(host: ProjectionFrame | null): void {
    this.frameHost = host;
  }

  /** 当前 3D 总弧长(本地单位,与视角无关)。没有可画的点返回 0。 */
  length(): number {
    this.build();
    return this.total;
  }

  /**
   * 按 3D 弧长比例 f(钳在 [0, 1])取点(本地 3D 坐标):把 Anchor3D / Dot3D 放到曲线上用。
   * 没有可画的点返回 null。
   */
  pointAt(f: number): Vec3 | null {
    this.build();
    if (this.strokeCount === 0) {
      return null;
    }
    const t = Number.isFinite(f) ? Math.min(1, Math.max(0, f)) : 0;
    const r = this.strokeOf(t * this.total);
    this.locate(t * this.total, r);
    const i = this.edge;
    const k = this.edgeT;
    return {
      x: mix(this.lx[i] ?? 0, this.lx[i + 1] ?? 0, k),
      y: mix(this.ly[i] ?? 0, this.ly[i + 1] ?? 0, k),
      z: mix(this.lz[i] ?? 0, this.lz[i + 1] ?? 0, k),
    };
  }

  /** @internal 当前视角下按弧长的可见段,覆盖 [0, length()](测试、调试用)。 */
  visibilityRuns(): readonly VisibilityRun[] {
    this.build();
    const hidden = safeHidden(this.hidden, 'dashed');
    const active = hidden === 'shown' ? null : this.activeOccluders();
    this.computeRuns(0, this.total, active, safeTolerance(this.depthTolerance));
    return this.runFrom.map((from, i) => ({
      from,
      to: this.runTo[i] ?? from,
      k: this.runK[i] ?? 0,
    }));
  }

  override get supportsReveal(): boolean {
    return true;
  }

  /** 全部有限点投影后的外接矩形,并入箭头(完整画出时)。随视角变化,与网格同性质。 */
  override getBox(): Box {
    this.build();
    const n = this.pointCount;
    if (this.strokeCount === 0) {
      return boxFromSize(0, 0);
    }
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const include = (x: number, y: number): void => {
      if (Number.isFinite(x) && Number.isFinite(y)) {
        minX = Math.min(minX, x);
        minY = Math.min(minY, y);
        maxX = Math.max(maxX, x);
        maxY = Math.max(maxY, y);
      }
    };
    for (let i = 0; i < n; i++) {
      include(this.px[i] ?? NaN, this.py[i] ?? NaN);
    }
    this.forEachHead(this.total, () => {
      const h = this.head;
      include(h[3] ?? NaN, h[4] ?? NaN);
      include(h[5] ?? NaN, h[6] ?? NaN);
      include(h[7] ?? NaN, h[8] ?? NaN);
    });
    if (minX === Infinity) {
      return boxFromSize(0, 0);
    }
    return {
      size: { w: maxX - minX, h: maxY - minY },
      center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    };
  }

  /** 与 Mesh3D 同一上界推导:R = 点到原点的最远距离(加箭头外伸),再乘最大透视放大系数。 */
  override getCullRadius(): number {
    this.build();
    let radius = 0;
    for (let i = 0; i < this.pointCount; i++) {
      const len = Math.hypot(this.lx[i] ?? 0, this.ly[i] ?? 0, this.lz[i] ?? 0);
      if (Number.isFinite(len)) {
        radius = Math.max(radius, len);
      }
    }
    if (safeTips(this.tips) !== 'none') {
      radius += Math.max(safeSize(this.headLength), safeSize(this.headWidth) / 2);
    }
    const d = this.projection.viewDistance;
    const scaleMax = d / Math.max(d * this.projection.nearRatio, d - radius);
    return radius * scaleMax;
  }

  /**
   * 当前视角下的投影折线(杆,画到箭底为止)+ 箭头三角形。
   * 这是**当前视角的快照**:Transform / Write 播放期间视角再变,变形里的这一份不跟。
   */
  override toPath(): PathData {
    const [shaft, heads] = this.snapshot();
    return concatPaths([shaft, heads]);
  }

  /** 两层:杆(描边、style.dash)与箭头(用描边色填满)。 */
  override pathLayers(style: ResolvedStyle): PathLayer[] {
    const [shaft, heads] = this.snapshot();
    const headsOn = style.strokeWidth > 0 || this.headsWithoutStroke;
    return [
      {
        path: shaft,
        paint: { fill: null, stroke: style.stroke, strokeWidth: style.strokeWidth, dash: style.dash },
      },
      { path: heads, paint: { fill: headsOn ? style.stroke : null, stroke: null, strokeWidth: 0 } },
    ];
  }

  protected override drawShape(ctx: CanvasRenderingContext2D, style: ResolvedStyle): void {
    this.build();
    if (this.strokeCount === 0) {
      return;
    }
    const strokeOn = style.strokeWidth > 0;
    const headsOn = strokeOn || this.headsWithoutStroke;
    if (!headsOn) {
      return;
    }
    const r = this.revealed();
    const sEnd = r === null ? this.total : r * this.total;
    const [from, to] = this.shaftRange(sEnd);
    const hidden = safeHidden(this.hidden, 'dashed');
    const active = hidden === 'shown' ? null : this.activeOccluders();
    const tolerance = safeTolerance(this.depthTolerance);
    const base = ctx.globalAlpha;
    if (strokeOn && to > from) {
      this.computeRuns(from, to, active, tolerance);
      this.strokeRuns(ctx, style, hidden, base);
    }
    this.forEachHead(sEnd, () => {
      const h = this.head;
      const k = active
        ? occlusionAt(active, h[0] ?? 0, h[1] ?? 0, h[2] ?? 0, h[3] ?? 0, h[4] ?? 0, tolerance)
        : 0;
      const alpha = base * (hidden === 'none' ? 1 - k : 1 - 0.65 * k);
      if (!(alpha > 0)) {
        return;
      }
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = style.stroke;
      ctx.beginPath();
      ctx.moveTo(h[3] ?? 0, h[4] ?? 0);
      ctx.lineTo(h[5] ?? 0, h[6] ?? 0);
      ctx.lineTo(h[7] ?? 0, h[8] ?? 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    });
  }

  /** 本帧生效的遮挡网格(显式优先,否则 Space3D 发布的自动表)。 */
  private activeOccluders(): ActiveOccluders | null {
    const list = this.explicitOccluders ?? this.autoOccluders;
    if (list.length === 0) {
      return null;
    }
    return resolveOccluders(this, list, this.projection, this.frameHost ?? this);
  }

  /** 生长到弧长 sEnd 时杆的弧长区间:箭头占掉的那一截不画(粗线不会从箭尖旁探出来)。 */
  private shaftRange(sEnd: number): [number, number] {
    const tip = this.tipLength(sEnd);
    const tips = safeTips(this.tips);
    return [tips === 'both' ? tip : 0, sEnd - (tips === 'none' ? 0 : tip)];
  }

  /** 生长到 sEnd 时的箭头长:'both' 两头平分已长出的长度,短于头长时同比例收缩(与数轴一致)。 */
  private tipLength(sEnd: number): number {
    const tips = safeTips(this.tips);
    if (tips === 'none') {
      return 0;
    }
    const room = tips === 'both' ? sEnd / 2 : sEnd;
    return Math.max(0, Math.min(safeSize(this.headLength), room));
  }

  /** 对生长到 sEnd 时的每个箭头,把三角形算进 this.head 后调用 visit。 */
  private forEachHead(sEnd: number, visit: () => void): void {
    const tips = safeTips(this.tips);
    const headLength = safeSize(this.headLength);
    const tip = this.tipLength(sEnd);
    if (tips === 'none' || !(tip > 0) || !(headLength > 0)) {
      return;
    }
    const half = (safeSize(this.headWidth) / 2) * (tip / headLength);
    if (!(half > 0)) {
      return;
    }
    if (this.headTriangle(sEnd, sEnd - tip, half)) {
      visit();
    }
    if (tips === 'both' && this.headTriangle(0, tip, half)) {
      visit();
    }
  }

  /**
   * 箭头是一个 3D 三角形投影出来的:尖 T 在弧长 sTip,底 B 在 sBase(同一笔画内),
   * 宽度方向 w ⟂ (T − B) 且尽量正对视点(w = u × (E − T)),所以箭头朝向观众时自然缩短。
   * 结果写进 this.head:[T 的视图坐标 x, y, z,T 的投影 x, y,两个底角的投影]。退化返回 false。
   */
  private headTriangle(sTip: number, sBase: number, half: number): boolean {
    // 终点箭头正好落在断口上时,取断口前那一笔(箭头长在已画出的线上,不落到下一笔的起点)。
    const r = this.strokeOf(sTip, sBase < sTip);
    const first = this.strokes[r * 2] ?? 0;
    this.locate(Math.max(sBase, this.arc[first] ?? 0), r);
    const bx = this.sx;
    const by = this.sy;
    const bz = this.sz;
    this.locate(sTip, r);
    const tx = this.sx;
    const ty = this.sy;
    const tz = this.sz;
    let ux = tx - bx;
    let uy = ty - by;
    let uz = tz - bz;
    let len = Math.hypot(ux, uy, uz);
    if (!(len > 1e-12)) {
      // 尖和底重合(零长的一笔):用所在边的方向。
      const i = this.edge;
      ux = (this.vx[i + 1] ?? 0) - (this.vx[i] ?? 0);
      uy = (this.vy[i + 1] ?? 0) - (this.vy[i] ?? 0);
      uz = (this.vz[i + 1] ?? 0) - (this.vz[i] ?? 0);
      len = Math.hypot(ux, uy, uz);
      if (!(len > 1e-12)) {
        return false;
      }
    }
    ux /= len;
    uy /= len;
    uz /= len;
    const c = this.projection.constants();
    const ex = -tx;
    const ey = -ty;
    const ez = c.d - tz;
    let wx = uy * ez - uz * ey;
    let wy = uz * ex - ux * ez;
    let wz = ux * ey - uy * ex;
    let wl = Math.hypot(wx, wy, wz);
    if (!(wl > 1e-9 * Math.hypot(ex, ey, ez))) {
      // 箭头正对视点:退回 u × (0, 1, 0),再退化(u 沿 y)就取 x 方向。
      wx = -uz;
      wy = 0;
      wz = ux;
      wl = Math.hypot(wx, wz);
      if (!(wl > 1e-9)) {
        wx = 1;
        wz = 0;
        wl = 1;
      }
    }
    const k = half / wl;
    wx *= k;
    wy *= k;
    wz *= k;
    const head = this.head;
    head[0] = tx;
    head[1] = ty;
    head[2] = tz;
    head[3] = this.spx;
    head[4] = this.spy;
    project(c, bx + wx, by + wy, bz + wz, head, 5);
    project(c, bx - wx, by - wy, bz - wz, head, 7);
    return true;
  }

  /** 完整画出时的投影快照:[杆, 箭头]。 */
  private snapshot(): [PathData, PathData] {
    this.build();
    if (this.strokeCount === 0) {
      return [EMPTY_PATH, EMPTY_PATH];
    }
    const [from, to] = this.shaftRange(this.total);
    const shaft = new PathBuilder();
    if (to > from) {
      this.tracePiece(builderSink(shaft), from, to);
    }
    const heads = new PathBuilder();
    this.forEachHead(this.total, () => {
      const h = this.head;
      heads
        .moveTo(h[3] ?? 0, h[4] ?? 0)
        .lineTo(h[5] ?? 0, h[6] ?? 0)
        .lineTo(h[7] ?? 0, h[8] ?? 0)
        .close();
    });
    return [shaft.build(), heads.build()];
  }

  /**
   * 按可见段描边:先画被挡的(每种强度 k 一组,各自 save/restore,虚线不漏给下一组),
   * 再画看得见的(style.dash 照常)。进入时的 globalAlpha(已含对象与祖先的透明度)记为 base。
   */
  private strokeRuns(
    ctx: CanvasRenderingContext2D,
    style: ResolvedStyle,
    hidden: HiddenStyle3D,
    base: number,
  ): void {
    const levels: number[] = [];
    for (const k of this.runK) {
      if (k > 0 && !levels.includes(k)) {
        levels.push(k);
      }
    }
    const group = (k: number, alpha: number, dash: readonly number[]): void => {
      if (!(alpha > 0)) {
        return;
      }
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = style.strokeWidth;
      if (dash.length > 0) {
        ctx.setLineDash(dash as number[]);
      }
      this.strokeLevel(ctx, k);
      ctx.restore();
    };
    for (const k of levels) {
      if (hidden === 'dashed') {
        // 部分遮挡(遮挡网格半透明):实线按 1 − k 淡出,淡虚线按 k 淡入;k = 1 与线框隐藏边同一画法。
        group(k, base * (1 - k), style.dash);
        group(k, base * k * HIDDEN_ALPHA, style.dash.length > 0 ? style.dash : HIDDEN_DASH);
      } else if (hidden === 'faded') {
        group(k, base * (1 - 0.65 * k), style.dash);
      } else {
        group(k, base * (1 - k), style.dash);
      }
    }
    if (this.runK.includes(0)) {
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = style.strokeWidth;
      // ctx 由 MObject.render 的 save/restore 包着,虚线不会漏给下一个对象。
      if (style.dash.length > 0) {
        ctx.setLineDash(style.dash as number[]);
      }
      this.strokeLevel(ctx, 0);
    }
  }

  /** 把强度为 k 的全部可见段描成一条路径并 stroke。 */
  private strokeLevel(ctx: CanvasRenderingContext2D, k: number): void {
    ctx.beginPath();
    for (let i = 0; i < this.runK.length; i++) {
      if (this.runK[i] === k) {
        this.tracePiece(ctx, this.runFrom[i] ?? 0, this.runTo[i] ?? 0);
      }
    }
    ctx.stroke();
  }

  /** 描出弧长区间 [from, to] 的投影折线(跨笔画时各自一条子路径)。 */
  private tracePiece(sink: PathSink, from: number, to: number): void {
    for (let r = 0; r < this.strokeCount; r++) {
      const i0 = this.strokes[r * 2] ?? 0;
      const i1 = this.strokes[r * 2 + 1] ?? 0;
      const s0 = this.arc[i0] ?? 0;
      const s1 = this.arc[i1] ?? 0;
      const lo = Math.max(from, s0);
      const hi = Math.min(to, s1);
      if (!(hi > lo)) {
        continue;
      }
      if (this.loop && lo <= s0 && hi >= s1) {
        // 闭合折线整圈:用 closePath 收口,接缝处是正常的拐角而不是两个线头。
        sink.moveTo(this.px[i0] ?? 0, this.py[i0] ?? 0);
        for (let i = i0 + 1; i < i1; i++) {
          sink.lineTo(this.px[i] ?? 0, this.py[i] ?? 0);
        }
        sink.closePath();
        continue;
      }
      this.locate(lo, r);
      sink.moveTo(this.spx, this.spy);
      for (let i = this.edge + 1; i <= i1 && (this.arc[i] ?? 0) < hi; i++) {
        sink.lineTo(this.px[i] ?? 0, this.py[i] ?? 0);
      }
      this.locate(hi, r);
      sink.lineTo(this.spx, this.spy);
    }
  }

  /**
   * 可见段:把 [from, to] 分成遮挡强度相同的若干段,写进 runFrom / runTo / runK。
   * 探针按边放(每条边 m 个,等分小段的中点),位置只取决于几何与视角,与生长比例无关 ——
   * Create 期间分界点不会抖。相邻探针强度不同就对弧长二分,找到分界。
   */
  private computeRuns(
    from: number,
    to: number,
    active: ActiveOccluders | null,
    tolerance: number,
  ): void {
    this.runFrom.length = 0;
    this.runTo.length = 0;
    this.runK.length = 0;
    if (!(to > from)) {
      return;
    }
    if (!active) {
      this.pushRun(from, to, 0, from, to);
      return;
    }
    const c = this.projection.constants();
    const spacing = this.probeSpacing();
    for (let r = 0; r < this.strokeCount; r++) {
      const i0 = this.strokes[r * 2] ?? 0;
      const i1 = this.strokes[r * 2 + 1] ?? 0;
      const s0 = this.arc[i0] ?? 0;
      const s1 = this.arc[i1] ?? 0;
      if (!(s1 > from) || !(s0 < to)) {
        continue;
      }
      if (this.strokeClear(i0, i1, active)) {
        this.pushRun(s0, s1, 0, from, to);
        continue;
      }
      let runStart = NaN;
      let runK = -1;
      let prev = 0;
      let coverEnd = s0;
      for (let i = i0; i < i1; i++) {
        const a = this.arc[i] ?? 0;
        const b = this.arc[i + 1] ?? 0;
        if (!(b > a) || !(b > from) || !(a < to)) {
          continue;
        }
        const m = this.probesOnEdge(i, spacing);
        for (let j = 0; j < m; j++) {
          const t = (j + 0.5) / m;
          const s = a + (b - a) * t;
          this.pointOnEdge(i, t, c);
          const k = occlusionAt(active, this.sx, this.sy, this.sz, this.spx, this.spy, tolerance);
          if (runK < 0) {
            runStart = a;
            runK = k;
          } else if (k !== runK) {
            const cut = this.bisect(prev, s, runK, r, active, tolerance);
            this.pushRun(runStart, cut, runK, from, to);
            runStart = cut;
            runK = k;
          }
          prev = s;
        }
        coverEnd = b;
      }
      if (runK >= 0) {
        this.pushRun(runStart, coverEnd, runK, from, to);
      }
    }
  }

  /** 在 [lo, hi] 里二分出强度从 kLo 变掉的位置。 */
  private bisect(
    lo: number,
    hi: number,
    kLo: number,
    r: number,
    active: ActiveOccluders,
    tolerance: number,
  ): number {
    let a = lo;
    let b = hi;
    for (let step = 0; step < BISECT_STEPS; step++) {
      const mid = (a + b) / 2;
      this.locate(mid, r);
      const k = occlusionAt(active, this.sx, this.sy, this.sz, this.spx, this.spy, tolerance);
      if (k === kLo) {
        a = mid;
      } else {
        b = mid;
      }
    }
    return (a + b) / 2;
  }

  /** 追加一段(裁到 [from, to],空段丢掉,与上一段同强度且相接就合并)。 */
  private pushRun(a: number, b: number, k: number, from: number, to: number): void {
    const lo = Math.max(a, from);
    const hi = Math.min(b, to);
    if (!(hi > lo)) {
      return;
    }
    const last = this.runK.length - 1;
    if (last >= 0 && this.runK[last] === k && Math.abs((this.runTo[last] ?? 0) - lo) <= 1e-9) {
      this.runTo[last] = hi;
      return;
    }
    this.runFrom.push(lo);
    this.runTo.push(hi);
    this.runK.push(k);
  }

  /** 探针间距:估算总数超预算就按比例放大(只取决于几何与视角,确定性)。 */
  private probeSpacing(): number {
    let estimate = 0;
    for (let r = 0; r < this.strokeCount; r++) {
      const i0 = this.strokes[r * 2] ?? 0;
      const i1 = this.strokes[r * 2 + 1] ?? 0;
      for (let i = i0; i < i1; i++) {
        estimate += this.probesOnEdge(i, PROBE_SPACING);
      }
    }
    return estimate > PROBE_BUDGET ? (PROBE_SPACING * estimate) / PROBE_BUDGET : PROBE_SPACING;
  }

  /**
   * 第 i 条边上的探针数:按投影长度每 spacing 一个;几乎正对视点的边投影很短,
   * 但沿深度仍可能穿过遮挡面,所以按 3D 长度的四分之一保底。钳在 [1, 64]。
   */
  private probesOnEdge(i: number, spacing: number): number {
    const len2d = Math.hypot(
      (this.px[i + 1] ?? 0) - (this.px[i] ?? 0),
      (this.py[i + 1] ?? 0) - (this.py[i] ?? 0),
    );
    const len3d = (this.arc[i + 1] ?? 0) - (this.arc[i] ?? 0);
    const reach = Math.max(len2d, len3d / 4);
    return Math.min(MAX_PROBES_PER_EDGE, Math.max(1, Math.ceil(reach / spacing)));
  }

  /** 这一笔的投影外接矩形与遮挡网格的包围盒不相交:整笔都看得见,不用探测。 */
  private strokeClear(i0: number, i1: number, active: ActiveOccluders): boolean {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = i0; i <= i1; i++) {
      const x = this.px[i] ?? 0;
      const y = this.py[i] ?? 0;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
    return maxX < active.minX || minX > active.maxX || maxY < active.minY || minY > active.maxY;
  }

  /** 弧长 s 落在哪一笔:最后一个起点 <= s(strict 时 < s)的笔画。 */
  private strokeOf(s: number, strict = false): number {
    let r = 0;
    for (let q = 1; q < this.strokeCount; q++) {
      const start = this.arc[this.strokes[q * 2] ?? 0] ?? 0;
      if (strict ? start < s : start <= s) {
        r = q;
      } else {
        break;
      }
    }
    return r;
  }

  /**
   * 第 r 笔上弧长为 s(钳在笔画内)的点:所在边与边内参数写进 edge / edgeT,
   * 视图坐标写进 sx / sy / sz,投影写进 spx / spy。视图空间里线性插值再投影(透视正确)。
   */
  private locate(s: number, r: number): void {
    const i0 = this.strokes[r * 2] ?? 0;
    const i1 = this.strokes[r * 2 + 1] ?? 0;
    const arc = this.arc;
    // 二分:最后一个 arc[i] <= s 的 i(i < i1)。
    let lo = i0;
    let hi = i1 - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if ((arc[mid] ?? 0) <= s) {
        lo = mid;
      } else {
        hi = mid - 1;
      }
    }
    const a = arc[lo] ?? 0;
    const b = arc[lo + 1] ?? a;
    const t = b > a ? Math.min(1, Math.max(0, (s - a) / (b - a))) : s >= b ? 1 : 0;
    this.pointOnEdge(lo, t, this.projection.constants());
  }

  /** 第 i 条边上参数 t 处的点(视图坐标 + 投影),同时记下 edge / edgeT。 */
  private pointOnEdge(
    i: number,
    t: number,
    c: ViewConstants,
  ): void {
    this.edge = i;
    this.edgeT = t;
    if (t === 0) {
      // 端点直接取缓冲里的值:与网格同一公式投影,逐位一致。
      this.sx = this.vx[i] ?? 0;
      this.sy = this.vy[i] ?? 0;
      this.sz = this.vz[i] ?? 0;
      this.spx = this.px[i] ?? 0;
      this.spy = this.py[i] ?? 0;
      return;
    }
    if (t === 1) {
      this.sx = this.vx[i + 1] ?? 0;
      this.sy = this.vy[i + 1] ?? 0;
      this.sz = this.vz[i + 1] ?? 0;
      this.spx = this.px[i + 1] ?? 0;
      this.spy = this.py[i + 1] ?? 0;
      return;
    }
    this.sx = mix(this.vx[i] ?? 0, this.vx[i + 1] ?? 0, t);
    this.sy = mix(this.vy[i] ?? 0, this.vy[i + 1] ?? 0, t);
    this.sz = mix(this.vz[i] ?? 0, this.vz[i + 1] ?? 0, t);
    const s = c.d / Math.max(c.minDenom, c.d - this.sz);
    this.spx = this.sx * s;
    this.spy = this.sy * s;
  }

  /**
   * 取子类的点列,分笔画、旋转、投影、累计弧长(本地坐标算,与视角无关:
   * 视角边转边生长时,笔尖钉在同一个 3D 点上)。各笔画首尾相接成一条全局弧长参数,断口不计长度。
   */
  private build(): void {
    const pts = this.points3D();
    const closing = this.closedLoop && pts.length >= 3;
    const count = pts.length + (closing ? 1 : 0);
    this.ensureCapacity(count);
    const c = this.projection.constants();
    let n = 0;
    let strokeCount = 0;
    let s = 0;
    let runStart = 0;
    const endRun = (): void => {
      if (n - runStart >= 2) {
        this.strokes[strokeCount * 2] = runStart;
        this.strokes[strokeCount * 2 + 1] = n - 1;
        strokeCount += 1;
      } else {
        // 孤立的单点不成线。
        n = runStart;
      }
      runStart = n;
    };
    for (let i = 0; i < count; i++) {
      const p = pts[i < pts.length ? i : 0];
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) {
        endRun();
        continue;
      }
      this.lx[n] = p.x;
      this.ly[n] = p.y;
      this.lz[n] = p.z;
      // 与 Mesh3D.updateView 逐项相同的旋转与透视。
      const x1 = p.x * c.cosY + p.z * c.sinY;
      const z1 = -p.x * c.sinY + p.z * c.cosY;
      const y = p.y * c.cosX - z1 * c.sinX;
      const z = p.y * c.sinX + z1 * c.cosX;
      this.vx[n] = x1;
      this.vy[n] = y;
      this.vz[n] = z;
      const k = c.d / Math.max(c.minDenom, c.d - z);
      this.px[n] = x1 * k;
      this.py[n] = y * k;
      if (n > runStart) {
        s += Math.hypot(
          p.x - (this.lx[n - 1] ?? 0),
          p.y - (this.ly[n - 1] ?? 0),
          p.z - (this.lz[n - 1] ?? 0),
        );
      }
      this.arc[n] = s;
      n += 1;
    }
    endRun();
    this.pointCount = n;
    this.strokeCount = strokeCount;
    this.total = s;
    this.loop = closing && strokeCount === 1 && n === count;
  }

  private ensureCapacity(count: number): void {
    if (this.capacity >= count) {
      return;
    }
    const size = Math.max(count, this.capacity * 2, 4);
    this.lx = new Float64Array(size);
    this.ly = new Float64Array(size);
    this.lz = new Float64Array(size);
    this.vx = new Float64Array(size);
    this.vy = new Float64Array(size);
    this.vz = new Float64Array(size);
    this.px = new Float64Array(size);
    this.py = new Float64Array(size);
    this.arc = new Float64Array(size);
    this.strokes = new Uint32Array(size + 2);
    this.capacity = size;
  }
}

/** 公共字段 tips 被改坏时按 'none'。 */
function safeTips(v: Tips3D): Tips3D {
  return TIPS.includes(v) ? v : 'none';
}

/** 线性插值;t 为 1 时精确返回 b。 */
function mix(a: number, b: number, t: number): number {
  return t === 1 ? b : a + (b - a) * t;
}

/** 视图空间点透视投影,写进 out[o], out[o + 1]。 */
function project(
  c: ViewConstants,
  x: number,
  y: number,
  z: number,
  out: Float64Array,
  o: number,
): void {
  const s = c.d / Math.max(c.minDenom, c.d - z);
  out[o] = x * s;
  out[o + 1] = y * s;
}
