import type { PathLayer, PathPaint } from '../path/draw';
import type { Affine, PathData } from '../path/path';
import {
  EMPTY_PATH,
  PathBuilder,
  multiplyAffine,
  polylinePath,
  similarityAffine,
  transformPath,
} from '../path/path';
import type { ResolvedStyle } from '../theme/Theme';
import { Group } from './Group';
import type { MObject } from './MObject';
import { makeLabel, placeOutside, requirePositive } from './labels';
import type { Line } from './shapes';
import { PathShape, requireFinitePoint, requireNonNegative } from './shapes';
import type { Point } from './types';
import { boxBoundsInParent } from './types';

/** 一段三次贝塞尔:[x0, y0, c1x, c1y, c2x, c2y, x1, y1]。 */
type Seg = readonly [number, number, number, number, number, number, number, number];

/** 四分之一圆的三次近似的控制柄比例。 */
const KAPPA = (4 / 3) * (Math.SQRT2 - 1);

const BRACE_DEPTH = 14;
const BRACE_THICKNESS_RATIO = 0.2;
const BRACE_LABEL_GAP = 6;
const BRACE_FONT_SIZE = 24;
const BRACE_BUFF = 6;

function lineSeg(x0: number, y0: number, x1: number, y1: number): Seg {
  const dx = x1 - x0;
  const dy = y1 - y0;
  return [x0, y0, x0 + dx / 3, y0 + dy / 3, x0 + (dx * 2) / 3, y0 + (dy * 2) / 3, x1, y1];
}

function reverseSeg(s: Seg): Seg {
  return [s[6], s[7], s[4], s[5], s[2], s[3], s[0], s[1]];
}

function mirrorSeg(s: Seg, length: number): Seg {
  return [length - s[0], s[1], length - s[2], s[3], length - s[4], s[5], length - s[6], s[7]];
}

/** 椭圆弧:中心 (cx, cy)、半轴 (ax, ay),从最上点 (cx, cy - ay) 起朝 +x 一侧扫过 theta(≤ π/2)。 */
function topArc(cx: number, cy: number, ax: number, ay: number, theta: number): Seg {
  const k = (4 / 3) * Math.tan(theta / 4);
  const s = Math.sin(theta);
  const c = Math.cos(theta);
  return [
    cx,
    cy - ay,
    cx + k * ax,
    cy - ay,
    cx + (s - k * c) * ax,
    cy - (c + k * s) * ay,
    cx + s * ax,
    cy - c * ay,
  ];
}

/** 四分之一椭圆:中心 (cx, cy)、半轴 (ax, ay),从最左点 (cx - ax, cy) 到最下点 (cx, cy + ay)。 */
function hookArc(cx: number, cy: number, ax: number, ay: number): Seg {
  return [cx - ax, cy, cx - ax, cy + KAPPA * ay, cx - KAPPA * ax, cy + ay, cx, cy + ay];
}

/** 花括号实际用的臂粗:不超过深度的 0.45 倍(再粗上下沿就交叉了)。 */
function braceThickness(depth: number, thickness: number): number {
  return Math.min(Math.max(0, thickness), depth * 0.45);
}

/** 两端卷钩与中间尖角不压缩时占的总长;长边短于它就整体横向压缩。 */
function braceNaturalLength(depth: number, thickness: number): number {
  return 2 * depth + braceThickness(depth, thickness);
}

/**
 * 花括号轮廓(括号坐标系:x 沿长边 0..length,y 朝尖角 0..depth)。一条闭合子路径,左右对称:
 * 两端是细的卷钩(贴着 y = 0),臂在半深处,中间一个尖角伸到 y = depth,背面(朝被括对象的一侧)
 * 在中点有个 V 形缺口。卷钩与尖角尺寸只取决于深度,长边再长也只伸长直段 —— 任意长度都匀称;
 * 短到放不下时横向整体压缩。
 */
function braceSegments(length: number, depth: number, thickness: number): Seg[] {
  const half = length / 2;
  const w = braceThickness(depth, thickness);
  const yLo = (depth + w) / 2;
  const yUp = (depth - w) / 2;
  const squeeze = Math.min(1, half / (yLo + depth / 2));
  const hx = yLo * squeeze;
  const tx = (depth / 2) * squeeze;
  const endCap = Math.min(w * 0.4, hx * 0.5);
  const cx = half - tx;
  // 背面的尖角弧:与正面同心的椭圆,竖半轴到背面直段,横半轴取「恰好在中点处剩下 notch 厚度」。
  const ry = depth - yUp;
  const notch = Math.min(w * 1.6, ry * 0.8);
  const rx = tx / Math.sqrt(1 - (notch / ry) ** 2);
  const theta = Math.asin(Math.min(1, rx > 0 ? tx / rx : 1));
  // 左半边:尖角 → 正面尖角弧 → 正面直段 → 外卷钩 → 端头 → 内卷钩 → 背面直段 → 背面尖角弧 → 缺口。
  const left: Seg[] = [reverseSeg(topArc(cx, depth, tx, depth - yLo, Math.PI / 2))];
  const straight = cx - hx > 1e-9;
  if (straight) {
    left.push(lineSeg(cx, yLo, hx, yLo));
  }
  left.push(reverseSeg(hookArc(hx, 0, hx, yLo)));
  if (endCap > 0) {
    left.push(lineSeg(0, 0, endCap, 0));
  }
  left.push(hookArc(hx, 0, hx - endCap, yUp));
  if (straight) {
    left.push(lineSeg(hx, yUp, cx, yUp));
  }
  left.push(topArc(cx, depth, rx, ry, theta));
  // 右半边:左半边镜像、倒序,从缺口接回尖角。
  const right = left
    .slice()
    .reverse()
    .map((seg) => mirrorSeg(reverseSeg(seg), length));
  return [...left, ...right];
}

function segmentsPath(segs: readonly Seg[], m: Affine): PathData {
  const first = segs[0];
  if (!first) {
    return EMPTY_PATH;
  }
  const b = new PathBuilder().moveTo(first[0], first[1]);
  for (const s of segs) {
    b.cubicTo(s[2], s[3], s[4], s[5], s[6], s[7]);
  }
  return transformPath(b.close().build(), m);
}

function isFinitePoint(p: Point): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y);
}

export interface BraceShapeOptions {
  /** 尖角离长边的距离(本地单位),默认 14。 */
  depth?: number;
  /** 臂的粗细(本地单位),默认 depth 的 0.2 倍;超过 depth 的 0.45 倍按 0.45 倍画。 */
  thickness?: number;
}

/**
 * BraceShape:花括号本身(一条填充的矢量轮廓),沿线段 from → to 摆放,
 * 尖角朝「沿 from → to 前进时的右手侧」(画布坐标 y 向下:从左往右的线段,尖角朝下)。
 * 颜色:没设 fill 时用描边色填满(与 Dot 一样),不描边。
 * Create 时从尖角处长出来、向两端展开;Transform / Write 按这条轮廓变形、书写。
 * 要带说明文字请用 Brace。
 */
export class BraceShape extends PathShape {
  from: Point;
  to: Point;
  depth: number;
  thickness: number;

  constructor(from: Point, to: Point, options?: BraceShapeOptions) {
    super();
    this.from = requireFinitePoint('Brace 的 from', from);
    this.to = requireFinitePoint('Brace 的 to', to);
    this.depth = requirePositive('Brace 的 depth', options?.depth ?? BRACE_DEPTH);
    this.thickness = requireNonNegative(
      'Brace 的 thickness',
      options?.thickness ?? this.depth * BRACE_THICKNESS_RATIO,
    );
  }

  /** 换两个端点(跟随移动的对象时逐帧调用)。 */
  setEnds(from: Point, to: Point): this {
    this.from = requireFinitePoint('Brace 的 from', from);
    this.to = requireFinitePoint('Brace 的 to', to);
    return this;
  }

  /** 长边的长度。 */
  get length(): number {
    return Math.hypot(this.to.x - this.from.x, this.to.y - this.from.y);
  }

  /** 长边方向(from → to)的单位向量;两端重合时为 (1, 0)。 */
  get direction(): Point {
    const len = this.length;
    return len > 0
      ? { x: (this.to.x - this.from.x) / len, y: (this.to.y - this.from.y) / len }
      : { x: 1, y: 0 };
  }

  /** 尖角的朝向(单位向量):沿 from → to 前进时的右手侧。 */
  get normal(): Point {
    const u = this.direction;
    return { x: -u.y, y: u.x };
  }

  /** 尖角的位置(本地坐标)。 */
  get tip(): Point {
    const n = this.normal;
    return {
      x: (this.from.x + this.to.x) / 2 + n.x * this.depth,
      y: (this.from.y + this.to.y) / 2 + n.y * this.depth,
    };
  }

  /** 括号坐标系 → 本地坐标:原点在 from,x 沿长边,y 朝尖角。 */
  private frame(): Affine {
    const u = this.direction;
    return [u.x, u.y, -u.y, u.x, this.from.x, this.from.y];
  }

  /** 几何参数都合法、长边不为零时才有轮廓(public 字段可能被直接改坏)。 */
  private drawable(): boolean {
    return (
      isFinitePoint(this.from) &&
      isFinitePoint(this.to) &&
      this.depth > 0 &&
      Number.isFinite(this.depth) &&
      Number.isFinite(this.thickness) &&
      this.length > 0
    );
  }

  protected override pathKey(): string {
    const { from, to } = this;
    return `${from.x},${from.y},${to.x},${to.y},${this.depth},${this.thickness}`;
  }

  protected override buildPath(): PathData {
    if (!this.drawable()) {
      return EMPTY_PATH;
    }
    return segmentsPath(braceSegments(this.length, this.depth, this.thickness), this.frame());
  }

  /**
   * 生长:从尖角处冒出来,先按比例长到「放得下卷钩与尖角」的长度,再伸长直段展到两端。
   * 尖角始终在最终位置。
   */
  protected override revealPath(f: number): PathData {
    if (!this.drawable() || !(f > 0)) {
      return EMPTY_PATH;
    }
    const length = this.length;
    const grown = length * f;
    const settled = Math.min(length, braceNaturalLength(this.depth, this.thickness));
    if (grown >= settled) {
      const offset: Affine = [1, 0, 0, 1, (length - grown) / 2, 0];
      return segmentsPath(
        braceSegments(grown, this.depth, this.thickness),
        multiplyAffine(this.frame(), offset),
      );
    }
    // 按比例缩小,缩放中心放在尖角上。
    const k = grown / settled;
    const shrink: Affine = [k, 0, 0, k, length / 2 - (k * settled) / 2, this.depth * (1 - k)];
    return segmentsPath(
      braceSegments(settled, this.depth, this.thickness),
      multiplyAffine(this.frame(), shrink),
    );
  }

  /** 实心:没设 fill 时用描边色填满,不描边。 */
  protected override paint(style: ResolvedStyle): PathPaint {
    return { fill: style.fill ?? style.stroke, stroke: null, strokeWidth: 0 };
  }

  /** 书写时先描的临时轮廓按臂粗取细线。 */
  override pathLayers(style: ResolvedStyle): PathLayer[] {
    return [
      {
        path: this.toPath(),
        paint: this.paint(style),
        outlineWidth: Math.max(0.5, braceThickness(this.depth, this.thickness) * 0.35),
      },
    ];
  }
}

/** Brace.for 把括号摆在目标外接盒的哪一侧(尖角朝这一侧)。 */
export type BraceSide = 'up' | 'down' | 'left' | 'right';

export interface BraceOptions extends BraceShapeOptions {
  /**
   * 说明:字符串按 Tex 排(字号 fontSize),或者任意 MObject(按它自己的包围盒摆放,会被加进括号组里,
   * 别再单独 scene.add)。摆在尖角外侧。
   */
  label?: string | MObject;
  /** 说明与尖角的间距,默认 6。 */
  labelGap?: number;
  /** 字符串说明的字号,默认 24。 */
  fontSize?: number;
}

export interface BraceForOptions extends BraceOptions {
  /** 括号与目标外接盒的间距,默认 6。 */
  buff?: number;
}

/**
 * Brace:花括号 + 可选说明,是一个组(shape 与 label 两个子元素)。
 * 端点、说明位置都是本地坐标(组自己在原点时就是父空间坐标):把它和被括的对象放在同一个父节点下。
 * 支持 Create(括号从尖角展开、说明逐字写出)、Write、Transform(组对组按子元素配对)。
 *
 *   const brace = Brace.for(formula, 'down', { label: 'n\\text{ 项}' });
 *   scene.add(brace);
 */
export class Brace extends Group {
  readonly shape: BraceShape;
  readonly label: MObject | null;
  private readonly labelGap: number;

  constructor(from: Point, to: Point, options?: BraceOptions) {
    super();
    this.shape = new BraceShape(from, to, options);
    this.labelGap = requireNonNegative('Brace 的 labelGap', options?.labelGap ?? BRACE_LABEL_GAP);
    const label = options?.label;
    const fontSize = options?.fontSize ?? BRACE_FONT_SIZE;
    this.label =
      label === undefined
        ? null
        : typeof label === 'string'
          ? makeLabel(label, 'tex', requirePositive('Brace 的 fontSize', fontSize))
          : label;
    this.add(this.shape);
    if (this.label) {
      this.add(this.label);
    }
    this.placeLabel();
  }

  /**
   * 按目标在父空间里的外接盒(含它自己的位置、缩放、旋转)在某一侧放一个等长的括号。
   * 括号应和目标挂在同一个父节点下;目标之后移动了,用 setEnds 或重新生成。
   */
  static for(target: MObject, side: BraceSide = 'down', options?: BraceForOptions): Brace {
    const b = boxBoundsInParent(target.getBox(), target.position, target.scale, target.rotation);
    const buff = requireNonNegative('Brace 的 buff', options?.buff ?? BRACE_BUFF);
    switch (side) {
      case 'up':
        return new Brace({ x: b.maxX, y: b.minY - buff }, { x: b.minX, y: b.minY - buff }, options);
      case 'left':
        return new Brace({ x: b.minX - buff, y: b.minY }, { x: b.minX - buff, y: b.maxY }, options);
      case 'right':
        return new Brace({ x: b.maxX + buff, y: b.maxY }, { x: b.maxX + buff, y: b.minY }, options);
      case 'down':
        return new Brace({ x: b.minX, y: b.maxY + buff }, { x: b.maxX, y: b.maxY + buff }, options);
      default:
        throw new Error(`Brace.for 的 side 只能是 up / down / left / right,收到 ${String(side)}`);
    }
  }

  /** 换端点,说明跟着挪到新的尖角外侧。 */
  setEnds(from: Point, to: Point): this {
    this.shape.setEnds(from, to);
    this.placeLabel();
    return this;
  }

  /** 尖角的位置(本地坐标)。 */
  get tip(): Point {
    return this.shape.tip;
  }

  /** 字体加载完成后画布文字的宽度变了:重新摆说明。 */
  override onMeasurementsChanged(): void {
    super.onMeasurementsChanged();
    this.placeLabel();
  }

  private placeLabel(): void {
    if (this.label) {
      const { tip, normal } = this.shape;
      placeOutside(this.label, tip, normal, this.labelGap, this.childMeasureContext());
    }
  }
}

/** 把 x 规范到 (-π, π]。 */
function wrapAngle(x: number): number {
  const full = Math.PI * 2;
  let a = x % full;
  if (a <= -Math.PI) {
    a += full;
  } else if (a > Math.PI) {
    a -= full;
  }
  return a;
}

function requireRayPoint(name: string, p: Point, vertex: Point): Point {
  const q = requireFinitePoint(name, p);
  if (!(Math.hypot(q.x - vertex.x, q.y - vertex.y) > 0)) {
    throw new Error(`${name} 不能与顶点重合(射线方向无从确定)`);
  }
  return q;
}

export interface AngleArcOptions {
  /** 角弧半径(本地单位),默认 24。 */
  radius?: number;
  /** 画大于 180° 的那一侧(优角),默认 false:画小于 180° 的那一侧。 */
  reflex?: boolean;
  /**
   * 外角:把第二条射线(vertex → b)反向延长,画它与第一条射线之间的角(与原角互补)。
   * 默认 false。想延长另一条边就交换 a、b。
   */
  exterior?: boolean;
}

/**
 * AngleArc:顶点 vertex 处、从射线 vertex→a 转到射线 vertex→b 的角弧(只描边)。
 * 缺省走小于 180° 的那一侧,reflex 走另一侧;exterior 换成外角(b 那条边反向延长)。
 * Create 时从 a 一侧的射线扫到 b 一侧。
 */
export class AngleArc extends PathShape {
  vertex: Point;
  a: Point;
  b: Point;
  radius: number;
  reflex: boolean;
  exterior: boolean;

  constructor(vertex: Point, a: Point, b: Point, options?: AngleArcOptions) {
    super();
    this.vertex = requireFinitePoint('Angle 的 vertex', vertex);
    this.a = requireRayPoint('Angle 的 a', a, this.vertex);
    this.b = requireRayPoint('Angle 的 b', b, this.vertex);
    this.radius = requireNonNegative('Angle 的 radius', options?.radius ?? 24);
    this.reflex = options?.reflex ?? false;
    this.exterior = options?.exterior ?? false;
  }

  /** 换顶点与两条射线上的点。 */
  setPoints(vertex: Point, a: Point, b: Point): this {
    this.vertex = requireFinitePoint('Angle 的 vertex', vertex);
    this.a = requireRayPoint('Angle 的 a', a, this.vertex);
    this.b = requireRayPoint('Angle 的 b', b, this.vertex);
    return this;
  }

  /** 起始射线(vertex → a)的方向角(画布坐标,y 向下,角度增大为顺时针)。 */
  get startAngle(): number {
    return Math.atan2(this.a.y - this.vertex.y, this.a.x - this.vertex.x);
  }

  /** 带符号的扫角:正为顺时针(画布角度增大方向),负为逆时针。 */
  get sweep(): number {
    const end = Math.atan2(this.b.y - this.vertex.y, this.b.x - this.vertex.x);
    const d = wrapAngle(end + (this.exterior ? Math.PI : 0) - this.startAngle);
    if (!this.reflex) {
      return d;
    }
    return d > 0 ? d - Math.PI * 2 : d + Math.PI * 2;
  }

  /** 角的大小(弧度,0..2π)。 */
  get value(): number {
    return Math.abs(this.sweep);
  }

  /** 角平分线方向(单位向量,指向画出来的那一侧)。 */
  get bisector(): Point {
    const mid = this.startAngle + this.sweep / 2;
    return { x: Math.cos(mid), y: Math.sin(mid) };
  }

  protected override get fillable(): boolean {
    return false;
  }

  protected override pathKey(): string {
    const { vertex: v, a, b } = this;
    const shape = `${this.radius},${this.reflex},${this.exterior}`;
    return `${v.x},${v.y},${a.x},${a.y},${b.x},${b.y},${shape}`;
  }

  protected override buildPath(): PathData {
    const sweep = this.sweep;
    const r = this.radius;
    if (!(r > 0) || !Number.isFinite(r) || !(Math.abs(sweep) > 0) || !Number.isFinite(sweep)) {
      return EMPTY_PATH;
    }
    const start = this.startAngle;
    return new PathBuilder()
      .arc(this.vertex.x, this.vertex.y, r, start, start + sweep, sweep < 0)
      .build();
  }
}

export interface AngleOptions extends AngleArcOptions {
  /** 说明(如 '\\theta'):字符串按 Tex 排,或任意 MObject;摆在角平分线上、弧的外侧。 */
  label?: string | MObject;
  /** 说明与弧的间距,默认 4。 */
  labelGap?: number;
  /** 字符串说明的字号,默认 22。 */
  fontSize?: number;
}

/** 线段两端点在父空间里的坐标(按线段自身的位置、缩放、旋转换算)。 */
function lineEnds(line: Line): [Point, Point] {
  const { position, scale, rotation } = line;
  const [a, b, c, d, e, f] = similarityAffine(position.x, position.y, scale, rotation);
  const map = (p: Point): Point => ({ x: a * p.x + c * p.y + e, y: b * p.x + d * p.y + f });
  return [map(line.start), map(line.end)];
}

/**
 * Angle:角弧 + 可选说明(组:arc 与 label)。给顶点与两条射线上各一点;
 * 或者 Angle.fromLines(l1, l2):顶点取两条线的交点,射线指向各自离交点较远的那一端。
 * 坐标都是本地坐标(组在原点时即父空间坐标),与被标注的图形放在同一个父节点下。
 */
export class Angle extends Group {
  readonly arc: AngleArc;
  readonly label: MObject | null;
  private readonly labelGap: number;

  constructor(vertex: Point, a: Point, b: Point, options?: AngleOptions) {
    super();
    this.arc = new AngleArc(vertex, a, b, options);
    this.labelGap = requireNonNegative('Angle 的 labelGap', options?.labelGap ?? 4);
    const label = options?.label;
    this.label =
      label === undefined
        ? null
        : typeof label === 'string'
          ? makeLabel(label, 'tex', requirePositive('Angle 的 fontSize', options?.fontSize ?? 22))
          : label;
    this.add(this.arc);
    if (this.label) {
      this.add(this.label);
    }
    this.placeLabel();
  }

  /** 两条线(Line)夹的角:顶点是两条直线的交点,平行时抛错。 */
  static fromLines(l1: Line, l2: Line, options?: AngleOptions): Angle {
    const [p1, q1] = lineEnds(l1);
    const [p2, q2] = lineEnds(l2);
    const d1x = q1.x - p1.x;
    const d1y = q1.y - p1.y;
    const d2x = q2.x - p2.x;
    const d2y = q2.y - p2.y;
    const cross = d1x * d2y - d1y * d2x;
    if (!(Math.abs(cross) > 1e-12 * Math.hypot(d1x, d1y) * Math.hypot(d2x, d2y))) {
      throw new Error('Angle.fromLines:两条线平行(或有一条长度为 0),没有交点');
    }
    const t = ((p2.x - p1.x) * d2y - (p2.y - p1.y) * d2x) / cross;
    const vertex = { x: p1.x + t * d1x, y: p1.y + t * d1y };
    const dist = (p: Point): number => Math.hypot(p.x - vertex.x, p.y - vertex.y);
    const far = (p: Point, q: Point): Point => (dist(p) >= dist(q) ? p : q);
    return new Angle(vertex, far(p1, q1), far(p2, q2), options);
  }

  /** 换顶点与射线上的点,说明跟着挪。 */
  setPoints(vertex: Point, a: Point, b: Point): this {
    this.arc.setPoints(vertex, a, b);
    this.placeLabel();
    return this;
  }

  /** 角的大小(弧度)。 */
  get value(): number {
    return this.arc.value;
  }

  /** 角的大小(度)。 */
  get degrees(): number {
    return (this.arc.value * 180) / Math.PI;
  }

  override onMeasurementsChanged(): void {
    super.onMeasurementsChanged();
    this.placeLabel();
  }

  private placeLabel(): void {
    if (!this.label) {
      return;
    }
    const dir = this.arc.bisector;
    const { vertex, radius } = this.arc;
    placeOutside(
      this.label,
      { x: vertex.x + dir.x * radius, y: vertex.y + dir.y * radius },
      dir,
      this.labelGap,
      this.childMeasureContext(),
    );
  }
}

export interface RightAngleOptions {
  /** 直角符号的边长(本地单位),默认 12。 */
  size?: number;
}

/**
 * RightAngle:直角符号 —— 顶点处沿两条射线各取 size 的小方块折线(只描边)。
 * 两条射线不垂直时画成平行四边形的一角。
 */
export class RightAngle extends PathShape {
  vertex: Point;
  a: Point;
  b: Point;
  size: number;

  constructor(vertex: Point, a: Point, b: Point, options?: RightAngleOptions) {
    super();
    this.vertex = requireFinitePoint('RightAngle 的 vertex', vertex);
    this.a = requireRayPoint('RightAngle 的 a', a, this.vertex);
    this.b = requireRayPoint('RightAngle 的 b', b, this.vertex);
    this.size = requireNonNegative('RightAngle 的 size', options?.size ?? 12);
  }

  setPoints(vertex: Point, a: Point, b: Point): this {
    this.vertex = requireFinitePoint('RightAngle 的 vertex', vertex);
    this.a = requireRayPoint('RightAngle 的 a', a, this.vertex);
    this.b = requireRayPoint('RightAngle 的 b', b, this.vertex);
    return this;
  }

  protected override get fillable(): boolean {
    return false;
  }

  protected override pathKey(): string {
    const { vertex: v, a, b } = this;
    return `${v.x},${v.y},${a.x},${a.y},${b.x},${b.y},${this.size}`;
  }

  protected override buildPath(): PathData {
    const v = this.vertex;
    const la = Math.hypot(this.a.x - v.x, this.a.y - v.y);
    const lb = Math.hypot(this.b.x - v.x, this.b.y - v.y);
    const s = this.size;
    if (!(la > 0) || !(lb > 0) || !(s > 0) || !Number.isFinite(s)) {
      return EMPTY_PATH;
    }
    const ux = ((this.a.x - v.x) / la) * s;
    const uy = ((this.a.y - v.y) / la) * s;
    const wx = ((this.b.x - v.x) / lb) * s;
    const wy = ((this.b.y - v.y) / lb) * s;
    return polylinePath([
      { x: v.x + ux, y: v.y + uy },
      { x: v.x + ux + wx, y: v.y + uy + wy },
      { x: v.x + wx, y: v.y + wy },
    ]);
  }
}
