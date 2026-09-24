import { formatTick, stepMultiples } from '../mobjects/graphs';
import { Group } from '../mobjects/Group';
import type { LabelKind } from '../mobjects/labels';
import { makeLabel, requirePositive, requireRange, typographicMinus } from '../mobjects/labels';
import { MObject, NO_STYLE } from '../mobjects/MObject';
import { requireNonNegative } from '../mobjects/shapes';
import type { Bounds, Box, Point } from '../mobjects/types';
import { boxBoundsInParent, boxFromSize } from '../mobjects/types';
import type { PathData } from '../path/path';
import { PathBuilder } from '../path/path';
import type { ResolvedStyle, StyleOverride, Theme } from '../theme/Theme';
import { Anchor3D } from './Anchor3D';
import type { Anchor3DOptions } from './Anchor3D';
import type { Curve3DFn, ParametricCurve3DOptions } from './lines3d';
import { Line3D, ParametricCurve3D } from './lines3d';
import type { Mesh3D } from './Mesh3D';
import type { AutoOccludable, HiddenStyle3D, Occlusion3DOptions } from './occlusion';
import {
  DEFAULT_DEPTH_TOLERANCE,
  copyOccluders,
  occlusionAt,
  requireHidden,
  resolveOccluders,
  safeHidden,
  safeTolerance,
} from './occlusion';
import type { ProjectedPoint, ProjectionFrame } from './Projection3D';
import { Projection3D } from './Projection3D';
import type { Tips3D } from './Stroke3D';
import { requireTips } from './Stroke3D';
import type { Vec3 } from './vec3';
import { mathPoint } from './vec3';

/** 一条轴的区间与步长:[min, max, step],step 缺省 1。 */
export type Axis3DRange = readonly [number, number, number?];

export interface Axes3DOptions extends Occlusion3DOptions {
  /** 缺省:frame 'math' 用 Projection3D.math(),'engine' 用 new Projection3D()。 */
  projection?: Projection3D;
  /**
   * 'math'(缺省):右手系、z 朝上,三条轴是数学 X / Y / Z(引擎坐标 (x, −z, −y),见 mathPoint);
   * 'engine':引擎自己的 x 右、y 下、z 朝观众。
   */
  frame?: 'math' | 'engine';
  /** 三条轴的区间与步长,缺省 [-3, 3, 1]。 */
  x?: Axis3DRange;
  y?: Axis3DRange;
  z?: Axis3DRange;
  /** 一个坐标单位的本地长度,缺省 40。 */
  unit?: number;
  /** 轴端箭头,缺省 'end';箭头画在区间外侧(不压最末的刻度,与 NumberLine 一致)。 */
  tips?: Tips3D;
  /** 刻度,缺省 true;tickSize 是屏幕空间的总长(本地单位,不随透视),缺省 8。 */
  ticks?: boolean;
  tickSize?: number;
  /** 轴名,缺省 { x: 'x', y: 'y', z: 'z' };某个给空串就不建那一个;false 全不要。 */
  labels?: false | { x?: string; y?: string; z?: string };
  /** 轴名与刻度数字排成 Tex(缺省)还是 Label。 */
  labelKind?: LabelKind;
  /** 轴名字号,缺省 24。 */
  fontSize?: number;
  /** 刻度数字,缺省 false(3D 里很挤);numberSize 缺省 14。 */
  numbers?: boolean;
  numberSize?: number;
}

/** 一条轴的刻度数量上限:超过就是步长写错了,直接报错。 */
const MAX_MARKS = 1000;
/** 轴端箭头的长与底宽(本地单位,与数轴一致)。 */
const TIP_LENGTH = 9;
const TIP_WIDTH = 9;
/** 轴名离轴端的距离,刻度数字离刻度的距离(本地单位)。 */
const LABEL_GAP = 6;
const NUMBER_GAP = 6;
/** 摆放方向无法判定时(地板正好侧对观众)的屏幕偏置:数字在下、偏左(与 2D 惯例一致)。 */
const NUMBER_BIAS: Point = { x: -0.3, y: 1 };
/** 竖直轴(环绕轴)的数字固定摆在左边。 */
const SCREEN_LEFT: Point = Object.freeze({ x: -1, y: 0 });
/** 刻度数字之间、与轴名之间至少留这么宽的缝(本地单位),挤不下的这一帧不画。 */
const NUMBER_CLEARANCE = 2;

type AxisKey = 'x' | 'y' | 'z';
const AXES: readonly AxisKey[] = ['x', 'y', 'z'];
const NO_MESHES: readonly Mesh3D[] = Object.freeze([]);

/** 坐标系里的第 axis 条轴上坐标为 v 的点(另两个分量为 0)。 */
function axisCoords(axis: number, v: number): [number, number, number] {
  return [axis === 0 ? v : 0, axis === 1 ? v : 0, axis === 2 ? v : 0];
}

/** 一个刻度:3D 点(本地)、所在轴、在本轴里的次序与本轴刻度数(生长时依次出现)。 */
interface Mark {
  readonly point: Vec3;
  readonly axis: number;
  readonly rank: number;
  readonly count: number;
}

/**
 * 三条轴的刻度:一个对象画全部刻度。刻度是**屏幕空间**的短线:以投影点为中心、
 * 垂直于该轴的投影方向、总长 tickSize(不随透视)。轴正对观众(投影方向退化)时这一帧不画那条轴的刻度。
 * 遮挡按刻度中心点判定('dashed' 按 'faded' 处理,短线画虚线看不出来)。
 */
class Ticks3D extends MObject implements AutoOccludable {
  tickSize: number;
  hidden: HiddenStyle3D;
  depthTolerance: number;
  private projection: Projection3D;
  private explicitOccluders: readonly Mesh3D[] | null;
  private autoOccluders: readonly Mesh3D[] = NO_MESHES;
  private frameHost: ProjectionFrame | null = null;
  private readonly marks: readonly Mark[];
  /** 三条轴的方向(本地 3D,单位长度 unit)。 */
  private readonly dirs: readonly Vec3[];

  constructor(
    marks: readonly Mark[],
    dirs: readonly Vec3[],
    tickSize: number,
    projection: Projection3D,
    occlusion: Occlusion3DOptions,
  ) {
    super();
    this.marks = marks;
    this.dirs = dirs;
    this.tickSize = tickSize;
    this.projection = projection;
    this.hidden = occlusion.hidden ?? 'dashed';
    this.depthTolerance = occlusion.depthTolerance ?? DEFAULT_DEPTH_TOLERANCE;
    this.explicitOccluders = copyOccluders('Axes3D', occlusion.occluders);
    this.setDefaultStyle({ strokeWidth: 2 });
  }

  /** 刻度个数(三条轴合计)。 */
  get count(): number {
    return this.marks.length;
  }

  setProjection(projection: Projection3D): this {
    this.projection = projection;
    return this;
  }

  getProjection(): Projection3D {
    return this.projection;
  }

  setOccluders(meshes: readonly Mesh3D[] | null): this {
    this.explicitOccluders = copyOccluders('Axes3D', meshes);
    return this;
  }

  getOccluders(): readonly Mesh3D[] | null {
    return this.explicitOccluders;
  }

  /** @internal Space3D 用。 */
  setAutoOccluders(meshes: readonly Mesh3D[]): void {
    this.autoOccluders = meshes;
  }

  /** @internal 遮挡检查按坐标轴的画框比较。 */
  setFrameHost(host: ProjectionFrame | null): void {
    this.frameHost = host;
  }

  override get supportsReveal(): boolean {
    return true;
  }

  override getBox(): Box {
    const half = safeHalf(this.tickSize);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const m of this.marks) {
      const q = this.projection.project(m.point);
      if (Number.isFinite(q.x) && Number.isFinite(q.y)) {
        minX = Math.min(minX, q.x - half);
        minY = Math.min(minY, q.y - half);
        maxX = Math.max(maxX, q.x + half);
        maxY = Math.max(maxY, q.y + half);
      }
    }
    if (minX === Infinity) {
      return boxFromSize(0, 0);
    }
    return {
      size: { w: maxX - minX, h: maxY - minY },
      center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    };
  }

  override getCullRadius(): number {
    let radius = 0;
    for (const m of this.marks) {
      radius = Math.max(radius, Math.hypot(m.point.x, m.point.y, m.point.z));
    }
    const d = this.projection.viewDistance;
    const scaleMax = d / Math.max(d * this.projection.nearRatio, d - radius);
    return radius * scaleMax + safeHalf(this.tickSize);
  }

  /** 当前视角下的刻度短线(每条一个子路径)。 */
  override toPath(): PathData {
    const b = new PathBuilder();
    this.forEachTick(null, (x0, y0, x1, y1) => {
      b.moveTo(x0, y0).lineTo(x1, y1);
    });
    return b.build();
  }

  protected override drawShape(ctx: CanvasRenderingContext2D, style: ResolvedStyle): void {
    if (!(style.strokeWidth > 0)) {
      return;
    }
    const hidden = safeHidden(this.hidden, 'dashed');
    const list = this.explicitOccluders ?? this.autoOccluders;
    const active =
      hidden === 'shown' || list.length === 0
        ? null
        : resolveOccluders(this, list, this.projection, this.frameHost ?? this);
    const tolerance = safeTolerance(this.depthTolerance);
    // 按遮挡强度分组:每组一条路径、一次 stroke。
    const groups = new Map<number, number[]>();
    this.forEachTick(this.revealed(), (x0, y0, x1, y1, mark) => {
      let k = 0;
      if (active) {
        const v = this.projection.toView(mark.point);
        const q = this.projection.project(mark.point);
        k = occlusionAt(active, v.x, v.y, v.z, q.x, q.y, tolerance);
      }
      const list2 = groups.get(k);
      if (list2) {
        list2.push(x0, y0, x1, y1);
      } else {
        groups.set(k, [x0, y0, x1, y1]);
      }
    });
    const base = ctx.globalAlpha;
    for (const [k, segs] of groups) {
      const alpha = base * (hidden === 'none' ? 1 - k : 1 - 0.65 * k);
      if (!(alpha > 0)) {
        continue;
      }
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = style.strokeWidth;
      if (style.dash.length > 0) {
        ctx.setLineDash(style.dash as number[]);
      }
      ctx.beginPath();
      for (let i = 0; i + 3 < segs.length; i += 4) {
        ctx.moveTo(segs[i] ?? 0, segs[i + 1] ?? 0);
        ctx.lineTo(segs[i + 2] ?? 0, segs[i + 3] ?? 0);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  /**
   * 对生长到 f(null 为完整)时该出现的每个刻度给出屏幕短线的两端。
   * 第 k 个刻度(本轴从 min 数起)在 f >= (k + 1) / N 时出现,三条轴同步。
   */
  private forEachTick(
    f: number | null,
    visit: (x0: number, y0: number, x1: number, y1: number, mark: Mark) => void,
  ): void {
    const half = safeHalf(this.tickSize);
    if (!(half > 0)) {
      return;
    }
    for (const m of this.marks) {
      if (f !== null && f < (m.rank + 1) / m.count) {
        continue;
      }
      const dir = this.dirs[m.axis];
      if (!dir) {
        continue;
      }
      const q = this.projection.project(m.point);
      const e = this.projection.project({
        x: m.point.x + dir.x,
        y: m.point.y + dir.y,
        z: m.point.z + dir.z,
      });
      const ax = e.x - q.x;
      const ay = e.y - q.y;
      const len = Math.hypot(ax, ay);
      // 轴正对观众:投影方向退化,垂线没有意义,这一帧不画。
      if (!(len > 1e-6) || !Number.isFinite(q.x) || !Number.isFinite(q.y)) {
        continue;
      }
      const nx = (-ay / len) * half;
      const ny = (ax / len) * half;
      visit(q.x - nx, q.y - ny, q.x + nx, q.y + ny, m);
    }
  }
}

function safeHalf(size: number): number {
  return Number.isFinite(size) && size > 0 ? size / 2 : 0;
}

/**
 * 刻度数字往哪一侧摆:水平轴(与环绕轴 —— 引擎 y 轴 —— 垂直)给一个固定的 3D 方向,
 * 数字摆在轴的投影与这个方向的投影同侧;竖直轴固定摆在屏幕左边。
 */
type NumberSide =
  | { readonly kind: 'world'; readonly dir: Vec3 }
  | { readonly kind: 'screen'; readonly dir: Point };

/**
 * 刻度数字:钉在刻度点上,沿轴投影方向的法向摆开,离刻度 tickSize/2 + 6。
 *
 * 摆在哪一侧由一个**固定的 3D 方向**决定(见 Axes3D 构造里的 numberSide):水平轴取地板上另一条轴的方向
 * (数学坐标里 X 轴的数字朝 +Y 一侧、Y 轴的朝 +X 一侧;课本视角下就是 X 轴数字在右下、Y 轴的在左下),
 * 只要观众在地板(与环绕轴垂直的平面,engine 坐标系同理)上方,这一侧在屏幕上的朝向就不变 ——
 * 环绕(Orbit3D)一整圈数字都跟着轴平滑转动,不会突然跳到轴的另一边。只有视线穿过地板(俯仰从正变负)时才换边。
 * 竖直轴(环绕轴)在屏幕上永远竖直,数字固定在左边。
 * 太挤时 Axes3D 每帧按固定次序排开(layoutNumbers),碰到已放下的数字或轴名的这一帧不画。
 */
class AxisNumber3D extends Anchor3D {
  /** @internal 这一帧被 Axes3D.layoutNumbers 排开(和别的数字 / 轴名重叠)时为 true,不画。 */
  suppressed = false;
  private readonly dir: Vec3;
  private readonly side: NumberSide;
  private readonly tickHalf: number;

  constructor(
    content: MObject,
    point: Vec3,
    dir: Vec3,
    side: NumberSide,
    tickSize: number,
    options: Anchor3DOptions,
  ) {
    super(content, point, options);
    this.dir = dir;
    this.side = side;
    this.tickHalf = safeHalf(tickSize);
  }

  override render(
    ctx: CanvasRenderingContext2D,
    theme: Theme,
    parentOpacity = 1,
    inherited: Readonly<StyleOverride> = NO_STYLE,
  ): void {
    if (this.suppressed) {
      return;
    }
    super.render(ctx, theme, parentOpacity, inherited);
  }

  protected override placePin(q: ProjectedPoint, out: Point): void {
    out.x = q.x;
    out.y = q.y;
    const side = this.side;
    if (side.kind === 'screen') {
      this.pushOut(out, side.dir.x, side.dir.y, this.tickHalf + NUMBER_GAP);
      return;
    }
    const view = this.getProjection();
    const p = this.point;
    const e = view.project({ x: p.x + this.dir.x, y: p.y + this.dir.y, z: p.z + this.dir.z });
    const g = view.project({ x: p.x + side.dir.x, y: p.y + side.dir.y, z: p.z + side.dir.z });
    const ax = e.x - q.x;
    const ay = e.y - q.y;
    const gx = g.x - q.x;
    const gy = g.y - q.y;
    const len = Math.hypot(ax, ay);
    const glen = Math.hypot(gx, gy);
    let nx = NUMBER_BIAS.x;
    let ny = NUMBER_BIAS.y;
    if (len > 1e-6) {
      // 轴投影方向的法向,取与侧向投影同侧的那个;两者平行(地板侧对观众)时退回屏幕偏置。
      nx = -ay / len;
      ny = ax / len;
      const dot = nx * gx + ny * gy;
      const ref = Math.abs(dot) > 1e-9 * glen ? dot : nx * NUMBER_BIAS.x + ny * NUMBER_BIAS.y;
      if (ref < 0) {
        nx = -nx;
        ny = -ny;
      }
    } else if (glen > 1e-6) {
      // 轴正对观众(刻度这一帧不画):直接沿侧向投影摆。
      nx = gx / glen;
      ny = gy / glen;
    } else {
      const b = Math.hypot(NUMBER_BIAS.x, NUMBER_BIAS.y);
      nx /= b;
      ny /= b;
    }
    this.pushOut(out, nx, ny, this.tickHalf + NUMBER_GAP);
  }
}

/** 子元素在父坐标系(Axes3D 本地)里的包围盒;量不出来(锚点非有限、空内容)返回 null。 */
function boundsInAxes(m: MObject): Bounds | null {
  const box = m.getBox();
  if (!(box.size.w > 0) || !(box.size.h > 0)) {
    return null;
  }
  const b = boxBoundsInParent(box, m.position, m.scale, m.rotation);
  return Number.isFinite(b.minX + b.minY + b.maxX + b.maxY) ? b : null;
}

/** 两个包围盒之间的缝小于 gap(含重叠)。 */
function crowded(a: Bounds, b: Bounds, gap: number): boolean {
  return (
    a.minX < b.maxX + gap && b.minX < a.maxX + gap && a.minY < b.maxY + gap && b.minY < a.maxY + gap
  );
}

/**
 * Axes3D:3D 坐标轴(三条带箭头的轴线、屏幕空间刻度、轴名,可选刻度数字)。
 * 缺省是**数学坐标系**(右手系、z 朝上,frame 'math'),配 Projection3D.math() 的课本视角:
 * 数学 X 轴朝左下、Y 轴朝右、Z 轴朝正上。坐标换本地 3D 坐标用 point()(相当于 2D 的 toLocal),
 * 曲面、曲线、标注都拿它算点;axes.curve() 直接画这个坐标系里的参数曲线。
 *
 * 三条轴都过原点(range 不含 0 也照样过原点)。和网格同一约定:以自身原点为灭点,
 * 要和曲面对得上就放在同一个父节点、同样的位置(或都放进 Space3D);
 * 被曲面挡住的部分缺省画淡虚线(occluders 或 Space3D 自动遮挡)。
 * 子元素顺序即绘制顺序:xAxis、yAxis、zAxis、刻度、刻度数字、轴名。Create(axes) 三条轴一起长。
 * 刻度数字(numbers)每帧按当前视角排开:各轴从两端往里、三轴轮流逐个放,
 * 和已放下的数字或轴名挤在一起的这一帧不画(课本视角下透视缩短的 X 轴常常隔一个画一个)。
 */
export class Axes3D extends Group {
  readonly frame: 'math' | 'engine';
  readonly unit: number;
  readonly xRange: readonly [number, number];
  readonly yRange: readonly [number, number];
  readonly zRange: readonly [number, number];
  readonly steps: { readonly x: number; readonly y: number; readonly z: number };
  readonly xAxis: Line3D;
  readonly yAxis: Line3D;
  readonly zAxis: Line3D;
  readonly axisLabels: readonly Anchor3D[];
  private projection: Projection3D;
  private readonly ticks: Ticks3D | null;
  private readonly numberLabels: readonly AxisNumber3D[];
  /** 排开刻度数字的次序:各轴从两端往里(同距正的在前),三轴轮流。 */
  private readonly numberOrder: readonly AxisNumber3D[];

  constructor(options?: Axes3DOptions) {
    super();
    const frame = options?.frame ?? 'math';
    if (frame !== 'math' && frame !== 'engine') {
      throw new Error(`Axes3D 的 frame 只能是 math / engine,收到 ${String(frame)}`);
    }
    this.frame = frame;
    this.unit = requirePositive('Axes3D 的 unit', options?.unit ?? 40);
    const ranges: Array<readonly [number, number]> = [];
    const steps: number[] = [];
    for (const key of AXES) {
      const r = options?.[key] ?? [-3, 3, 1];
      ranges.push(requireRange(`Axes3D 的 ${key} 轴`, r));
      steps.push(requirePositive(`Axes3D 的 ${key} 轴步长`, r[2] ?? 1));
    }
    const [xr = [-3, 3], yr = [-3, 3], zr = [-3, 3]] = ranges;
    this.xRange = xr;
    this.yRange = yr;
    this.zRange = zr;
    this.steps = { x: steps[0] ?? 1, y: steps[1] ?? 1, z: steps[2] ?? 1 };
    const tips = requireTips('Axes3D', options?.tips ?? 'end');
    const tickSize = requireNonNegative('Axes3D 的 tickSize', options?.tickSize ?? 8);
    const fontSize = requirePositive('Axes3D 的 fontSize', options?.fontSize ?? 24);
    const numberSize = requirePositive('Axes3D 的 numberSize', options?.numberSize ?? 14);
    const labelKind: LabelKind = options?.labelKind ?? 'tex';
    const occlusion: Occlusion3DOptions = {
      hidden: requireHidden('Axes3D', options?.hidden ?? 'dashed'),
      depthTolerance: requireNonNegative(
        'Axes3D 的 depthTolerance',
        options?.depthTolerance ?? DEFAULT_DEPTH_TOLERANCE,
      ),
      occluders: copyOccluders('Axes3D', options?.occluders) ?? undefined,
    };
    this.projection =
      options?.projection ?? (frame === 'math' ? Projection3D.math() : new Projection3D());
    const projection = this.projection;

    // 轴线:有箭头的一端向外延伸,箭头画在区间外侧,不压最末的刻度。
    const ext = (TIP_LENGTH + 4) / this.unit;
    const axisLines = ranges.map(([min, max], axis) => {
      const lo = tips === 'both' ? min - ext : min;
      const hi = tips === 'none' ? max : max + ext;
      return new Line3D(this.point(...axisCoords(axis, lo)), this.point(...axisCoords(axis, hi)), {
        ...occlusion,
        projection,
        tips,
        headLength: TIP_LENGTH,
        headWidth: TIP_WIDTH,
      });
    });
    const [xAxis, yAxis, zAxis] = axisLines;
    if (!xAxis || !yAxis || !zAxis) {
      throw new Error('Axes3D:轴线构造失败');
    }
    this.xAxis = xAxis;
    this.yAxis = yAxis;
    this.zAxis = zAxis;
    const origin = this.point(0, 0, 0);
    const dirs = [0, 1, 2].map((axis) => {
      const p = this.point(...axisCoords(axis, 1));
      return { x: p.x - origin.x, y: p.y - origin.y, z: p.z - origin.z };
    });

    // 刻度值:去掉 0(三轴在原点相交,那里的刻度没有意义)。
    const values = ranges.map(([min, max], axis) => {
      const key = AXES[axis] ?? 'x';
      const step = steps[axis] ?? 1;
      const list = stepMultiples(min, max, step, MAX_MARKS);
      if (!list) {
        throw new Error(
          `Axes3D 的 ${key} 轴:[${min}, ${max}] 按步长 ${step} 要画 ${MAX_MARKS} 个以上刻度,步长是不是写错了`,
        );
      }
      return list.filter((v) => Math.abs(v) > step * 1e-9);
    });
    const marks: Mark[] = [];
    values.forEach((list, axis) => {
      list.forEach((v, rank) => {
        marks.push({ point: this.point(...axisCoords(axis, v)), axis, rank, count: list.length });
      });
    });
    this.ticks =
      (options?.ticks ?? true) && marks.length > 0
        ? new Ticks3D(marks, dirs, tickSize, projection, occlusion)
        : null;

    // 刻度数字(可选)与轴名:标注的字缺省不被挡。
    const labelOptions: Anchor3DOptions = {
      projection,
      hidden: 'shown',
      depthTolerance: occlusion.depthTolerance,
      occluders: occlusion.occluders,
    };
    const numberLabels: AxisNumber3D[] = [];
    const perAxis: AxisNumber3D[][] = [];
    if (options?.numbers ?? false) {
      values.forEach((list, axis) => {
        const dir = dirs[axis] ?? { x: 1, y: 0, z: 0 };
        const side = this.numberSide(axis, dirs);
        const made: Array<{ v: number; n: AxisNumber3D }> = [];
        for (const v of list) {
          const text = labelKind === 'label' ? typographicMinus(formatTick(v)) : formatTick(v);
          const n = new AxisNumber3D(
            makeLabel(text, labelKind, numberSize),
            this.point(...axisCoords(axis, v)),
            dir,
            side,
            tickSize,
            labelOptions,
          );
          numberLabels.push(n);
          made.push({ v, n });
        }
        made.sort((a, b) => Math.abs(b.v) - Math.abs(a.v) || b.v - a.v);
        perAxis.push(made.map((m) => m.n));
      });
    }
    this.numberLabels = numberLabels;
    const order: AxisNumber3D[] = [];
    const longest = Math.max(0, ...perAxis.map((list) => list.length));
    for (let i = 0; i < longest; i++) {
      for (const list of perAxis) {
        const n = list[i];
        if (n) {
          order.push(n);
        }
      }
    }
    this.numberOrder = order;
    const names = options?.labels === false ? null : { x: 'x', y: 'y', z: 'z', ...options?.labels };
    const axisLabels: Anchor3D[] = [];
    if (names) {
      AXES.forEach((key, axis) => {
        const name = names[key];
        const line = axisLines[axis];
        if (!name || !line) {
          return;
        }
        axisLabels.push(
          new Anchor3D(makeLabel(name, labelKind, fontSize), line.end, {
            ...labelOptions,
            away: origin,
            gap: LABEL_GAP,
          }),
        );
      });
    }
    this.axisLabels = axisLabels;

    for (const part of this.parts()) {
      part.setFrameHost(this);
    }
    super.add(xAxis, yAxis, zAxis);
    if (this.ticks) {
      super.add(this.ticks);
    }
    super.add(...numberLabels, ...axisLabels);
  }

  /**
   * @internal 按当前视角排开刻度数字(每次 render 先调它):按固定次序逐个放,
   * 包围盒与已放下的数字或轴名(轴名总是先占位)之间的缝小于 2 的这一帧不画。
   * 返回这一帧画出来的数字(测试、调试用)。
   */
  layoutNumbers(): readonly Anchor3D[] {
    if (this.numberOrder.length === 0) {
      return this.numberOrder;
    }
    const placed: Bounds[] = [];
    for (const label of this.axisLabels) {
      const b = boundsInAxes(label);
      if (b) {
        placed.push(b);
      }
    }
    const shown: Anchor3D[] = [];
    for (const n of this.numberOrder) {
      const b = boundsInAxes(n);
      const clash = b === null || placed.some((p) => crowded(p, b, NUMBER_CLEARANCE));
      n.suppressed = clash;
      if (b && !clash) {
        placed.push(b);
        shown.push(n);
      }
    }
    return shown;
  }

  override render(
    ctx: CanvasRenderingContext2D,
    theme: Theme,
    parentOpacity = 1,
    inherited: Readonly<StyleOverride> = NO_STYLE,
  ): void {
    this.layoutNumbers();
    super.render(ctx, theme, parentOpacity, inherited);
  }

  /** 坐标系坐标 → 本地 3D(引擎)坐标:'math' 为 mathPoint(x, y, z, unit),'engine' 为 (x, y, z)·unit。 */
  point(x: number, y: number, z: number): Vec3 {
    if (this.frame === 'math') {
      return mathPoint(x, y, z, this.unit);
    }
    return { x: x * this.unit, y: y * this.unit, z: z * this.unit };
  }

  /** point 的逆映射:本地 3D 坐标 → 坐标系坐标。 */
  toMath(p: Readonly<Vec3>): Vec3 {
    const u = this.unit;
    if (this.frame === 'math') {
      return { x: 0 + p.x / u, y: 0 - p.z / u, z: 0 - p.y / u };
    }
    return { x: p.x / u, y: p.y / u, z: p.z / u };
  }

  /**
   * 在这个坐标系里画参数曲线:fn 返回坐标系坐标,内部经 point() 换算;视角缺省沿用坐标系的。
   * 不加进本组(要和坐标轴放在同一个父节点、同样的位置)。
   */
  curve(
    fn: Curve3DFn,
    tRange: readonly [number, number],
    options?: ParametricCurve3DOptions,
  ): ParametricCurve3D {
    return new ParametricCurve3D(
      (t, params) => {
        // 采样函数返回空值(没写 return 之类)按无定义处理:断笔,而不是抛 TypeError。
        const p: Readonly<Vec3> | null | undefined = fn(t, params);
        return p ? this.point(p.x, p.y, p.z) : { x: NaN, y: NaN, z: NaN };
      },
      tRange,
      { ...options, projection: options?.projection ?? this.projection },
    );
  }

  /** 换视角,连同全部零件(轴线、刻度、数字、轴名)。 */
  setProjection(projection: Projection3D): this {
    this.projection = projection;
    for (const part of this.parts()) {
      part.setProjection(projection);
    }
    return this;
  }

  getProjection(): Projection3D {
    return this.projection;
  }

  /** 遮挡网格,连同全部零件;null 回到「自动」。 */
  setOccluders(meshes: readonly Mesh3D[] | null): this {
    for (const part of this.parts()) {
      part.setOccluders(meshes);
    }
    return this;
  }

  /** 刻度个数(三条轴合计;没有刻度为 0)。 */
  get tickCount(): number {
    return this.ticks?.count ?? 0;
  }

  /** 全部刻度数字(numbers 为 false 时为空);太挤时每帧有一部分不画,见 layoutNumbers。 */
  get numberAnchors(): readonly Anchor3D[] {
    return this.numberLabels;
  }

  /**
   * 第 axis 条轴的刻度数字摆在哪一侧。环绕轴(引擎 y 轴:数学 Z / 引擎 y)在屏幕上永远竖直,固定摆左边;
   * 两条水平轴取地板上另一条轴的方向:math 坐标系 X 轴 → +Y 一侧、Y 轴 → +X 一侧;
   * engine 坐标系 x 轴 → +z 一侧、z 轴 → −x 一侧。两套都选成在各自的缺省视角下数字在轴的下方 / 左下,
   * 与 2D 惯例一致。地板与环绕轴垂直,环绕时永远不会侧对观众,数字就不换边。
   */
  private numberSide(axis: number, dirs: readonly Vec3[]): NumberSide {
    const d = dirs[axis] ?? { x: 1, y: 0, z: 0 };
    if (Math.abs(d.y) > 1e-9 * Math.hypot(d.x, d.y, d.z)) {
      return { kind: 'screen', dir: SCREEN_LEFT };
    }
    // 沿引擎 x 的那条轴往 ∓z 摆,沿引擎 z 的那条往 ±x 摆(math 取上面的符号:−z 即数学 +Y)。
    const along = Math.abs(d.x) >= Math.abs(d.z);
    const u = this.frame === 'math' ? this.unit : -this.unit;
    return { kind: 'world', dir: along ? { x: 0, y: 0, z: 0 - u } : { x: u, y: 0, z: 0 } };
  }

  private parts(): Array<Line3D | Ticks3D | Anchor3D> {
    return [
      this.xAxis,
      this.yAxis,
      this.zAxis,
      ...(this.ticks ? [this.ticks] : []),
      ...this.numberLabels,
      ...this.axisLabels,
    ];
  }
}
