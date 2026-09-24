import { Group } from '../mobjects/Group';
import { MObject, NO_STYLE } from '../mobjects/MObject';
import { Dot, requireFinitePoint, requireNonNegative } from '../mobjects/shapes';
import type { Bounds, Box, MeasureContext, Point } from '../mobjects/types';
import { boxBoundsInParent, boxFromSize, unionBounds } from '../mobjects/types';
import type { StyleOverride, Theme } from '../theme/Theme';
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
import type { Vec3 } from './vec3';
import { isFiniteVec3, requireFiniteVec3 } from './vec3';

export interface Anchor3DOptions extends Occlusion3DOptions {
  /** 共享视角:和被标注的网格共用同一个 Projection3D。缺省各持一份。 */
  projection?: Projection3D;
  /** 屏幕空间偏移(本地单位),缺省 { x: 0, y: 0 }。 */
  offset?: Point;
  /**
   * 把内容从这个 3D 点的投影往外推(比如底面中心 → 顶点字母往外摆):
   * 内容包围盒离锚点最近的一边与锚点相距 gap,另一个方向上居中。缺省不推。
   */
  away?: Vec3;
  /** away 时内容包围盒最近一边到锚点的距离,缺省 10。 */
  gap?: number;
}

const NO_MESHES: readonly Mesh3D[] = Object.freeze([]);

/** 只取宿主 position 的画框(scale 1、rotation 0):Anchor3D 自己的缩放、转动绕锚点作用,不属于画框。 */
class PositionFrame implements ProjectionFrame {
  readonly scale = 1;
  readonly rotation = 0;
  private readonly host: { readonly position: Point };

  constructor(host: { readonly position: Point }) {
    this.host = host;
  }

  get position(): Point {
    return this.host.position;
  }
}

/**
 * Anchor3D:把 2D 内容(Label、Tex、Dot……)钉在一个 3D 点的投影上,
 * 视角一变下一次绘制就跟着走,不需要 updater(取景量包围盒时也已经在新位置)。
 *
 * 自己的 position 是 3D 画框的原点(与网格同一约定:和被标注的网格放在同一位置 / 同一个组,
 * 或都放进 Space3D 留在原点);内容自己的 position 是相对锚点的额外偏移,通常留在 (0, 0),
 * 所以 FadeIn、Create、Transform、Indicate、FadeTransform、MoveTo 对内容照常可用。
 * 自己的 scale / rotation 不属于画框,**绕锚点**作用在内容上:ScaleTo(dot3d, 2) 让点变大、
 * 仍钉在原处(不会从画框原点往外飞);锚点的投影位置不随它们缩放、转动。
 *
 * 实现:内部一个私有「钉子」组,每次被读(getChildren / getBox / getCullRadius / render)
 * 都把钉子挪到锚点的当前投影。场景图的遍历(渲染、取景、剔除、Transform 的世界矩阵)都读 position,
 * 投影偏移必须是真实的 position 才一致;挪的是没人会动的私有钉子,作者能动的都不被覆盖。
 *
 * 遮挡:只测锚点这一个点(不测内容覆盖的面积),二值判定 —— 转动时字会在锚点被挡住的那一刻变淡。
 */
export class Anchor3D extends Group implements AutoOccludable {
  point: Vec3;
  offset: Point;
  away: Vec3 | null;
  gap: number;
  hidden: HiddenStyle3D;
  depthTolerance: number;
  private projection: Projection3D;
  private explicitOccluders: readonly Mesh3D[] | null;
  private autoOccluders: readonly Mesh3D[] = NO_MESHES;
  private frameHost: ProjectionFrame | null = null;
  private readonly pin: Group;
  /** 锚点这一帧是否可画(非有限时不画,并告警一次)。 */
  private pointOk = true;
  private warnedPoint = false;
  private readonly pinAt: Point = { x: 0, y: 0 };
  /** 遮挡检查用的画框:只有自己的 position(scale / rotation 绕锚点作用,不属于画框)。 */
  private readonly ownFrame: ProjectionFrame;

  constructor(content: MObject | readonly MObject[], point: Vec3, options?: Anchor3DOptions) {
    super();
    const name = this.constructor.name;
    this.point = requireFiniteVec3(`${name} 的 point`, point);
    this.projection = options?.projection ?? new Projection3D();
    this.offset = requireFinitePoint(`${name} 的 offset`, options?.offset ?? { x: 0, y: 0 });
    this.away = options?.away ? requireFiniteVec3(`${name} 的 away`, options.away) : null;
    this.gap = requireNonNegative(`${name} 的 gap`, options?.gap ?? 10);
    this.hidden = requireHidden(name, options?.hidden ?? 'shown');
    this.depthTolerance = requireNonNegative(
      `${name} 的 depthTolerance`,
      options?.depthTolerance ?? DEFAULT_DEPTH_TOLERANCE,
    );
    this.explicitOccluders = copyOccluders(name, options?.occluders);
    this.ownFrame = new PositionFrame(this);
    this.pin = new Group();
    super.add(this.pin);
    this.pin.add(...(content instanceof MObject ? [content] : content));
  }

  /** 第一个内容(没有为 null)。 */
  get content(): MObject | null {
    return this.pin.getChildren()[0] ?? null;
  }

  /** 换锚点(拷贝;非有限抛错)。 */
  setPoint(point: Vec3): this {
    this.point = requireFiniteVec3(`${this.constructor.name} 的 point`, point);
    return this;
  }

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

  /** 锚点当前的投影(本地坐标,不含 offset / away)。 */
  projected(): ProjectedPoint {
    return this.projection.project(this.point);
  }

  /** 锚点当前被挡的强度 0..1(0 = 看得见;hidden 为 'shown' 时恒为 0)。 */
  occlusion(): number {
    if (safeHidden(this.hidden, 'shown') === 'shown' || !isFiniteVec3(this.point)) {
      return 0;
    }
    const list = this.explicitOccluders ?? this.autoOccluders;
    if (list.length === 0) {
      return 0;
    }
    const active = resolveOccluders(this, list, this.projection, this.frameHost ?? this.ownFrame);
    if (!active) {
      return 0;
    }
    const v = this.projection.toView(this.point);
    const q = this.projection.project(this.point);
    return occlusionAt(active, v.x, v.y, v.z, q.x, q.y, safeTolerance(this.depthTolerance));
  }

  /** 内容加进内部钉子组(加入自己或祖先照样抛错)。 */
  override add(...mobjects: MObject[]): this {
    this.pin.add(...mobjects);
    return this;
  }

  override remove(...mobjects: MObject[]): this {
    this.pin.remove(...mobjects);
    return this;
  }

  /** 先把钉子挪到当前投影,再返回 [钉子]。 */
  override getChildren(): readonly MObject[] {
    this.sync();
    return super.getChildren();
  }

  override getBox(context?: MeasureContext): Box {
    this.sync();
    return this.pointOk ? super.getBox(context) : boxFromSize(0, 0);
  }

  override getCullRadius(theme?: Theme, inherited?: Readonly<StyleOverride>): number {
    this.sync();
    return this.pointOk ? super.getCullRadius(theme, inherited) : 0;
  }

  override render(
    ctx: CanvasRenderingContext2D,
    theme: Theme,
    parentOpacity = 1,
    inherited: Readonly<StyleOverride> = NO_STYLE,
  ): void {
    this.sync();
    if (!this.pointOk) {
      return;
    }
    const k = this.occlusion();
    const hidden = safeHidden(this.hidden, 'shown');
    const factor = k > 0 ? (hidden === 'none' ? 1 - k : 1 - 0.65 * k) : 1;
    if (!(factor > 0)) {
      return;
    }
    super.render(ctx, theme, parentOpacity * factor, inherited);
  }

  /**
   * 钉子该在哪(本地坐标):锚点投影 q + offset,有 away 时再沿「away → 锚点」的投影方向往外推。
   * 子类(坐标轴的刻度数字)覆盖它换摆法。结果写进 out。
   */
  protected placePin(q: ProjectedPoint, out: Point): void {
    const ox = Number.isFinite(this.offset.x) ? this.offset.x : 0;
    const oy = Number.isFinite(this.offset.y) ? this.offset.y : 0;
    out.x = q.x + ox;
    out.y = q.y + oy;
    const away = this.away;
    if (!away || !isFiniteVec3(away)) {
      return;
    }
    const a = this.projection.project(away);
    let dx = q.x - a.x;
    let dy = q.y - a.y;
    const len = Math.hypot(dx, dy);
    if (len >= 1e-9) {
      dx /= len;
      dy /= len;
    } else {
      // 两点投影重合(连线正对观众):往上推。
      dx = 0;
      dy = -1;
    }
    this.pushOut(out, dx, dy, Number.isFinite(this.gap) && this.gap > 0 ? this.gap : 0);
  }

  /**
   * 把钉子从 out 沿单位方向 (dx, dy) 推开:内容包围盒最近的一边离 out 为 gap,另一方向上居中
   * (与 2D 标注的 placeOutside 同一规则)。内容自己的 position 不算进来,它是额外偏移。
   */
  protected pushOut(out: Point, dx: number, dy: number, gap: number): void {
    const b = this.contentBounds();
    if (!b) {
      return;
    }
    const w = b.maxX - b.minX;
    const h = b.maxY - b.minY;
    const reach = (Math.abs(dx) * w + Math.abs(dy) * h) / 2;
    out.x += dx * (gap + reach) - (b.minX + b.maxX) / 2;
    out.y += dy * (gap + reach) - (b.minY + b.maxY) / 2;
  }

  /**
   * 内容画出来的包围盒(以钉子为原点、画框的单位),不计各自的 position(那是作者的额外偏移)。
   * 算上自己的 scale / rotation(它们绕钉子作用):放大的字照样离锚点 gap,不会压到锚点上。
   * 不带量尺寸上下文:内容自己设了字号时精确(tex()、label() 助手与坐标轴的字都会设)。
   */
  private contentBounds(): Bounds | null {
    let acc: Bounds | null = null;
    const k = Number.isFinite(this.scale) && this.scale !== 0 ? this.scale : 1;
    const r = Number.isFinite(this.rotation) ? this.rotation : 0;
    for (const child of this.pin.getChildren()) {
      const b = boxBoundsInParent(child.getBox(), { x: 0, y: 0 }, child.scale * k, child.rotation + r);
      acc = acc === null ? b : unionBounds(acc, b);
    }
    return acc;
  }

  /**
   * 把钉子挪到锚点的当前投影(幂等,只写私有钉子)。
   * 渲染时自己的 rotation、scale 作用在钉子的 position 上,所以先把目标点按它们反变换:
   * 画出来钉子正好在 out,而内容绕钉子(锚点)缩放、转动。scale 为 0 或非有限时不反变换
   * (内容本来就缩成一点、看不见)。
   */
  private sync(): void {
    const p = this.point;
    if (!isFiniteVec3(p)) {
      this.pointOk = false;
      if (!this.warnedPoint) {
        this.warnedPoint = true;
        console.warn(`[${this.constructor.name}] 锚点坐标不是有限数,这一帧不画`);
      }
      return;
    }
    this.pointOk = true;
    const out = this.pinAt;
    this.placePin(this.projection.project(p), out);
    let x = out.x;
    let y = out.y;
    const r = this.rotation;
    if (r !== 0 && Number.isFinite(r)) {
      const cos = Math.cos(r);
      const sin = Math.sin(r);
      const rx = x * cos + y * sin;
      y = -x * sin + y * cos;
      x = rx;
    }
    const k = this.scale;
    if (k !== 1 && k !== 0 && Number.isFinite(k)) {
      x /= k;
      y /= k;
    }
    const pos = this.pin.position;
    pos.x = x;
    pos.y = y;
  }
}

export interface Dot3DOptions extends Anchor3DOptions {
  /** 圆点半径(屏幕空间,本地单位,不随透视缩放),缺省 5。 */
  radius?: number;
}

/** 3D 点:装着一个 Dot 的 Anchor3D(实心圆点,颜色随 stroke,与 2D Dot 一致)。 */
export class Dot3D extends Anchor3D {
  readonly dot: Dot;

  constructor(point: Vec3, options?: Dot3DOptions) {
    const dot = new Dot(options?.radius ?? 5);
    super(dot, point, options);
    this.dot = dot;
  }
}
