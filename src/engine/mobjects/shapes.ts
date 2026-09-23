import type { PathLayer, PathPaint } from '../path/draw';
import { drawPath } from '../path/draw';
import { partialPath } from '../path/measure';
import type { PathData } from '../path/path';
import {
  EMPTY_PATH,
  PathBuilder,
  concatPaths,
  maxPathRadius,
  pathBounds,
  polylinePath,
  transformPath,
} from '../path/path';
import { parseSvgPath } from '../path/svgPath';
import type { ResolvedStyle } from '../theme/Theme';
import { MObject } from './MObject';
import type { Box, MeasureContext, Point } from './types';
import {
  FALLBACK_MEASURE,
  boxFromPoints,
  boxFromSize,
  expandBox,
  maxPointRadius,
} from './types';

let measureCanvas: HTMLCanvasElement | null = null;

/** 文本宽度:有 DOM 用 canvas 实测,无 DOM(node 探针)按平均字宽估算。 */
export function measureTextWidth(
  text: string,
  fontSize: number,
  fontFamily: string,
): number {
  if (typeof document !== 'undefined') {
    measureCanvas ??= document.createElement('canvas');
    const ctx = measureCanvas.getContext('2d');
    if (ctx) {
      ctx.font = `${fontSize}px ${fontFamily}`;
      return ctx.measureText(text).width;
    }
  }
  return text.length * fontSize * 0.6;
}

/**
 * 设置描边状态;线宽不是正数时返回 false,调用方就不该 stroke()。
 * 画布会忽略 0/负数/NaN 的 lineWidth 赋值、沿用之前的值(通常是 1),
 * 不拦的话 strokeWidth: 0 的对象反而会画出一根发丝线。
 */
export function applyStroke(
  ctx: CanvasRenderingContext2D,
  style: ResolvedStyle,
  lineWidth: number = style.strokeWidth,
): boolean {
  if (!(lineWidth > 0)) {
    return false;
  }
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = lineWidth;
  // ctx 由 MObject.render 的 save/restore 包着,虚线不会漏给下一个对象。
  if (style.dash.length > 0) {
    ctx.setLineDash(style.dash as number[]);
  }
  return true;
}

/** 尺寸类参数在绘制点钳非负:它们是 public 可写字段,动画会绕过构造期校验。 */
function safeRadius(r: number): number {
  return Number.isFinite(r) && r > 0 ? r : 0;
}

export function requireNonNegative(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} 需要一个非负有限数,收到 ${value}`);
  }
  return value;
}

export function requireFinitePoint(name: string, p: Point): Point {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) {
    throw new Error(`${name} 需要有限坐标,收到 (${p.x}, ${p.y})`);
  }
  return { x: p.x, y: p.y };
}

/** 按 (字号, 字体) 缓存拼好的 ctx.font 串,静态文本每帧不再重新拼接。 */
export class FontCache {
  private size = NaN;
  private family = '';
  private prefix = '';
  private value = '';

  get(size: number, family: string, prefix = ''): string {
    if (size !== this.size || family !== this.family || prefix !== this.prefix) {
      this.size = size;
      this.family = family;
      this.prefix = prefix;
      this.value = `${prefix}${size}px ${family}`;
    }
    return this.value;
  }
}

/**
 * ctx.arc 实际扫过的角度:沿角度增大方向,delta 对 2π 取模(delta >= 2π 才画整圆)。
 * 包围盒、路径与生长动画共用这一份规范化,几处才不会各算各的。
 */
function arcSweep(startAngle: number, endAngle: number): number {
  const full = Math.PI * 2;
  let delta = endAngle - startAngle;
  if (!(delta >= full)) {
    delta = ((delta % full) + full) % full;
  }
  return Math.min(delta, full);
}

/**
 * 圆弧的真实包围盒:两端点 + 区间内经过的四个轴向极值点(解析解,比贝塞尔近似的路径盒精确)。
 * includeCenter 为 true 时再并入圆心(扇形)。
 */
function arcBox(
  radius: number,
  startAngle: number,
  endAngle: number,
  includeCenter: boolean,
): Box {
  const r = safeRadius(radius);
  if (!Number.isFinite(startAngle) || !Number.isFinite(endAngle)) {
    return boxFromSize(r * 2, r * 2);
  }
  const end = startAngle + arcSweep(startAngle, endAngle);
  const points: Point[] = [
    { x: Math.cos(startAngle) * r, y: Math.sin(startAngle) * r },
    { x: Math.cos(end) * r, y: Math.sin(end) * r },
  ];
  if (includeCenter) {
    points.push({ x: 0, y: 0 });
  }
  const quarter = Math.PI / 2;
  const first = Math.ceil(startAngle / quarter);
  for (let k = first; k * quarter <= end && k - first < 8; k++) {
    points.push({ x: Math.cos(k * quarter) * r, y: Math.sin(k * quarter) * r });
  }
  return boxFromPoints(points);
}

/** 圆弧路径:从 startAngle 沿角度增大方向扫 sweep(不闭合)。 */
function arcPath(radius: number, startAngle: number, sweep: number): PathData {
  const r = safeRadius(radius);
  if (!(r > 0) || !Number.isFinite(startAngle) || !(sweep > 0)) {
    return EMPTY_PATH;
  }
  return new PathBuilder().arc(0, 0, r, startAngle, startAngle + sweep).build();
}

/** 整圆:从正上方(-π/2)顺时针一圈、闭合。生长从 12 点钟方向开始。 */
function circlePath(radius: number): PathData {
  const r = safeRadius(radius);
  return r > 0
    ? new PathBuilder().arc(0, 0, r, -Math.PI / 2, Math.PI * 1.5).close().build()
    : EMPTY_PATH;
}

/** 扇形:圆心 → 弧起点 → 沿弧扫 sweep → 回圆心(闭合)。 */
function wedgePath(radius: number, startAngle: number, sweep: number): PathData {
  const r = safeRadius(radius);
  if (!(r > 0) || !Number.isFinite(startAngle) || !(sweep > 0)) {
    return EMPTY_PATH;
  }
  return new PathBuilder()
    .moveTo(0, 0)
    .arc(0, 0, r, startAngle, startAngle + sweep)
    .close()
    .build();
}

/**
 * PathShape:形状由一条矢量路径描述的图元(圆、多边形、线、函数图像……)。
 * 子类只给出几何(buildPath,本地坐标);填充、描边、虚线、按弧长的描边生长(Create)、
 * 包围盒与剔除半径都在这里统一处理,形状变形(Transform)与逐字书写(Write)也直接用这条路径。
 */
export abstract class PathShape extends MObject {
  private pathCache: PathData | null = null;
  private pathCacheKey: string | null = null;
  private cullCacheFor: PathData | null = null;
  private cullCache = 0;

  /** 几何(本地坐标)。 */
  protected abstract buildPath(): PathData;

  /**
   * 几何的身份键:与上次相同就复用上次建好的路径(连同挂在它上面的 Path2D 与弧长表)。
   * 返回 null(缺省)表示每次都重建;几何参数是可写字段的图元把参数拼进键里。
   */
  protected pathKey(): string | null {
    return null;
  }

  override toPath(): PathData {
    const key = this.pathKey();
    if (key === null || key !== this.pathCacheKey || !this.pathCache) {
      this.pathCache = this.buildPath();
      this.pathCacheKey = key;
    }
    return this.pathCache;
  }

  /** 开放的线(线段、圆弧、折线、函数图像)只描边、不填充。 */
  protected get fillable(): boolean {
    return true;
  }

  /** 生长到 f(0..1)时画的路径:缺省按弧长截取前 f。扇形、圆点这类有自己长法的覆盖它。 */
  protected revealPath(f: number): PathData {
    return partialPath(this.toPath(), 0, f);
  }

  /** 画这个图元的颜料。reveal 是生长比例,null 为完整。 */
  protected paint(style: ResolvedStyle, _reveal: number | null): PathPaint {
    return {
      fill: this.fillable ? style.fill : null,
      stroke: style.stroke,
      strokeWidth: style.strokeWidth,
      dash: style.dash,
    };
  }

  override get supportsReveal(): boolean {
    return true;
  }

  /** 路径的紧包围盒。常见图元另有解析解(圆弧的贝塞尔近似不精确)。 */
  override getBox(): Box {
    const b = pathBounds(this.toPath());
    return b
      ? {
          size: { w: b.maxX - b.minX, h: b.maxY - b.minY },
          center: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 },
        }
      : boxFromSize(0, 0);
  }

  /** 控制点离原点的最远距离:控制点凸包包住曲线,是保守上界。按路径对象缓存。 */
  override getCullRadius(): number {
    const path = this.toPath();
    if (path !== this.cullCacheFor) {
      this.cullCacheFor = path;
      this.cullCache = maxPathRadius(path);
    }
    return this.cullCache;
  }

  override pathLayers(style: ResolvedStyle): PathLayer[] {
    return [{ path: this.toPath(), paint: this.paint(style, null) }];
  }

  protected override drawShape(ctx: CanvasRenderingContext2D, style: ResolvedStyle): void {
    const r = this.revealed();
    drawPath(ctx, r === null ? this.toPath() : this.revealPath(r), this.paint(style, r));
  }
}

/**
 * SvgPath:任意矢量路径图元(SVG path 的 d 字符串,或 PathBuilder 造好的 PathData)。
 * 与内置图形一样支持样式、Create 生长、Transform 变形与 Write 书写。
 * 填充按 SVG 的规矩:开放的子路径也按隐式闭合填充(不想填就不设 fill)。
 */
export class SvgPath extends PathShape {
  private path: PathData;

  constructor(path: string | PathData) {
    super();
    this.path = typeof path === 'string' ? parseSvgPath(path) : path;
  }

  /** 整体替换路径。 */
  setPath(path: string | PathData): this {
    this.path = typeof path === 'string' ? parseSvgPath(path) : path;
    return this;
  }

  protected override buildPath(): PathData {
    return this.path;
  }
}

export class Circle extends PathShape {
  radius: number;

  constructor(radius = 50) {
    super();
    this.radius = requireNonNegative('Circle 的 radius', radius);
  }

  protected override pathKey(): string {
    return String(this.radius);
  }

  protected override buildPath(): PathData {
    return circlePath(this.radius);
  }

  /** 从 12 点钟方向顺时针扫出来(精确圆弧,不是贝塞尔近似上按弧长截)。 */
  protected override revealPath(f: number): PathData {
    return arcPath(this.radius, -Math.PI / 2, Math.PI * 2 * f);
  }

  override getBox(): Box {
    const r = safeRadius(this.radius);
    return boxFromSize(r * 2, r * 2);
  }

  override getCullRadius(): number {
    return safeRadius(this.radius);
  }
}

export class Rectangle extends PathShape {
  width: number;
  height: number;

  constructor(width = 120, height = 80) {
    super();
    this.width = requireNonNegative('Rectangle 的 width', width);
    this.height = requireNonNegative('Rectangle 的 height', height);
  }

  protected override pathKey(): string {
    return `${this.width}|${this.height}`;
  }

  /** 从左上角顺时针一圈。 */
  protected override buildPath(): PathData {
    const w = safeRadius(this.width);
    const h = safeRadius(this.height);
    return w > 0 || h > 0 ? new PathBuilder().rect(-w / 2, -h / 2, w, h).build() : EMPTY_PATH;
  }

  override getBox(): Box {
    return boxFromSize(safeRadius(this.width), safeRadius(this.height));
  }

  override getCullRadius(): number {
    return Math.hypot(safeRadius(this.width), safeRadius(this.height)) / 2;
  }
}

export class Line extends PathShape {
  start: Point;
  end: Point;

  constructor(start: Point, end: Point) {
    super();
    this.start = requireFinitePoint('Line 的 start', start);
    this.end = requireFinitePoint('Line 的 end', end);
  }

  /** @deprecated 用 setStyle({ dash }):虚线已是所有描边共享、可被容器继承的样式键。 */
  get dash(): readonly number[] {
    return this.styleOverride.dash ?? [];
  }

  set dash(value: readonly number[]) {
    this.setStyle({ dash: value });
  }

  protected override get fillable(): boolean {
    return false;
  }

  protected override pathKey(): string {
    return `${this.start.x},${this.start.y},${this.end.x},${this.end.y}`;
  }

  protected override buildPath(): PathData {
    return new PathBuilder()
      .moveTo(this.start.x, this.start.y)
      .lineTo(this.end.x, this.end.y)
      .build();
  }

  override getBox(): Box {
    return boxFromPoints([this.start, this.end]);
  }

  override getCullRadius(): number {
    return Math.max(
      Math.hypot(this.start.x, this.start.y),
      Math.hypot(this.end.x, this.end.y),
    );
  }
}

export class Dot extends PathShape {
  radius: number;

  constructor(radius = 6) {
    super();
    this.radius = requireNonNegative('Dot 的 radius', radius);
  }

  protected override pathKey(): string {
    return String(this.radius);
  }

  protected override buildPath(): PathData {
    return circlePath(this.radius);
  }

  /** Create 时从圆心长大到完整半径(而不是沿圆周描出来)。 */
  protected override revealPath(f: number): PathData {
    return circlePath(safeRadius(this.radius) * f);
  }

  /** 实心圆点:填充色缺省时用描边色,不描边。 */
  protected override paint(style: ResolvedStyle): PathPaint {
    return { fill: style.fill ?? style.stroke, stroke: null, strokeWidth: 0 };
  }

  override getBox(): Box {
    const r = safeRadius(this.radius);
    return boxFromSize(r * 2, r * 2);
  }

  override getCullRadius(): number {
    return safeRadius(this.radius);
  }
}

export class Label extends MObject {
  text: string;
  private readonly font = new FontCache();

  constructor(text: string) {
    super();
    this.text = text;
  }

  /** TextLike:与 Tex 统一的文本读写(FadeTransform 等不必区分具体类型)。 */
  getText(): string {
    return this.text;
  }

  setText(text: string): this {
    this.text = text;
    return this;
  }

  override getBox(context?: MeasureContext): Box {
    // 自身 setStyle 优先,其次是容器链/主题传下来的上下文,否则量出来的盒和画出来的字对不上。
    const fontSize =
      this.styleOverride.fontSize ?? context?.fontSize ?? FALLBACK_MEASURE.fontSize;
    const fontFamily =
      this.styleOverride.fontFamily ??
      context?.fontFamily ??
      FALLBACK_MEASURE.fontFamily;
    return boxFromSize(
      measureTextWidth(this.text, fontSize, fontFamily),
      fontSize,
    );
  }

  /** Create 时像打字机一样逐字写出(字在最终位置出现,不会边写边挪)。 */
  override get supportsReveal(): boolean {
    return true;
  }

  protected override drawShape(
    ctx: CanvasRenderingContext2D,
    style: ResolvedStyle,
  ): void {
    ctx.font = this.font.get(style.fontSize, style.fontFamily);
    ctx.textBaseline = 'middle';
    ctx.fillStyle = style.textColor;
    const r = this.revealed();
    if (r === null) {
      ctx.textAlign = 'center';
      ctx.fillText(this.text, 0, 0);
      return;
    }
    // 按码位切,不会把一个汉字或代理对切成半个。
    const chars = [...this.text];
    const shown = chars.slice(0, Math.ceil(chars.length * r)).join('');
    if (shown === '') {
      return;
    }
    ctx.textAlign = 'left';
    ctx.fillText(shown, -ctx.measureText(this.text).width / 2, 0);
  }
}

export interface PolygonOptions {
  /** 首尾闭合(默认 true)。false 为折线,不填充。 */
  closed?: boolean;
}

/**
 * Polygon:任意多边形 / 折线(本地坐标的点列)。支持 Create 沿周长生长。
 * 顶点可以通过 setPoints 整体替换。
 */
export class Polygon extends PathShape {
  readonly closed: boolean;
  private pts: Point[];
  private cullRadius: number;
  /** 顶点换过几次:路径缓存的身份键。 */
  private version = 0;

  constructor(points: readonly Point[], options?: PolygonOptions) {
    super();
    this.closed = options?.closed ?? true;
    this.pts = points.map((p, i) => requireFinitePoint(`Polygon 第 ${i} 个顶点`, p));
    this.cullRadius = maxPointRadius(this.pts);
  }

  get points(): readonly Point[] {
    return this.pts;
  }

  setPoints(points: readonly Point[]): this {
    this.pts = points.map((p, i) => requireFinitePoint(`Polygon 第 ${i} 个顶点`, p));
    this.cullRadius = maxPointRadius(this.pts);
    this.version += 1;
    return this;
  }

  protected override get fillable(): boolean {
    return this.closed;
  }

  protected override pathKey(): string {
    return String(this.version);
  }

  protected override buildPath(): PathData {
    return polylinePath(this.pts, this.closed);
  }

  /** 生长中还没合拢,只描边;画完才填充。 */
  protected override paint(style: ResolvedStyle, reveal: number | null): PathPaint {
    return { ...super.paint(style, reveal), fill: this.closed && reveal === null ? style.fill : null };
  }

  override get supportsReveal(): boolean {
    return this.pts.length >= 2;
  }

  override getBox(): Box {
    return boxFromPoints(this.pts);
  }

  override getCullRadius(): number {
    return this.cullRadius;
  }
}

export class Ellipse extends PathShape {
  radiusX: number;
  radiusY: number;

  constructor(radiusX = 60, radiusY = 40) {
    super();
    this.radiusX = requireNonNegative('Ellipse 的 radiusX', radiusX);
    this.radiusY = requireNonNegative('Ellipse 的 radiusY', radiusY);
  }

  protected override pathKey(): string {
    return `${this.radiusX}|${this.radiusY}`;
  }

  /** 单位圆(从正上方顺时针)按两个半轴拉伸。 */
  protected override buildPath(): PathData {
    return this.stretch(circlePath(1));
  }

  protected override revealPath(f: number): PathData {
    return this.stretch(arcPath(1, -Math.PI / 2, Math.PI * 2 * f));
  }

  override getBox(): Box {
    return boxFromSize(safeRadius(this.radiusX) * 2, safeRadius(this.radiusY) * 2);
  }

  override getCullRadius(): number {
    return Math.max(safeRadius(this.radiusX), safeRadius(this.radiusY));
  }

  private stretch(unit: PathData): PathData {
    const rx = safeRadius(this.radiusX);
    const ry = safeRadius(this.radiusY);
    return rx > 0 || ry > 0 ? transformPath(unit, [rx, 0, 0, ry, 0, 0]) : EMPTY_PATH;
  }
}

export class Square extends Rectangle {
  constructor(size = 90) {
    super(size, size);
  }
}

/** 正多边形。顶点在构造时生成,sides/radius 只读(要改尺寸请用 scale)。 */
export class RegularPolygon extends PathShape {
  readonly sides: number;
  readonly radius: number;
  readonly points: readonly Point[];

  constructor(sides: number, radius = 50) {
    super();
    if (!Number.isInteger(sides) || sides < 3) {
      throw new Error(`RegularPolygon 至少需要 3 条边,收到 ${sides}`);
    }
    requireNonNegative('RegularPolygon 的 radius', radius);
    this.sides = sides;
    this.radius = radius;
    const points: Point[] = [];
    for (let i = 0; i < sides; i++) {
      const angle = -Math.PI / 2 + (i * Math.PI * 2) / sides;
      points.push({
        x: Math.cos(angle) * radius,
        y: Math.sin(angle) * radius,
      });
    }
    this.points = points;
  }

  /** 顶点只读:路径只建一次。 */
  protected override pathKey(): string {
    return '';
  }

  protected override buildPath(): PathData {
    return polylinePath(this.points, true);
  }

  override getBox(): Box {
    // 用真实顶点而不是外接圆:三角形等在布局里才不会纵向偏心。
    return boxFromPoints(this.points);
  }

  override getCullRadius(): number {
    return this.radius;
  }
}

export class Triangle extends RegularPolygon {
  constructor(radius = 55) {
    super(3, radius);
  }
}

export interface StarOptions {
  /** 角数,默认 5。 */
  points?: number;
  outerRadius?: number;
  innerRadius?: number;
}

/** 星形。顶点在构造时生成,参数只读(要改尺寸请用 scale)。 */
export class Star extends PathShape {
  readonly pointCount: number;
  readonly outerRadius: number;
  readonly innerRadius: number;
  readonly points: readonly Point[];

  constructor(options: StarOptions);
  constructor(pointCount?: number, outerRadius?: number, innerRadius?: number);
  constructor(a: number | StarOptions = 5, outer = 50, inner = 22) {
    super();
    const o = typeof a === 'object' ? a : { points: a, outerRadius: outer, innerRadius: inner };
    const pointCount = o.points ?? 5;
    const outerRadius = o.outerRadius ?? 50;
    const innerRadius = o.innerRadius ?? 22;
    if (!Number.isInteger(pointCount) || pointCount < 3) {
      throw new Error(`Star 至少需要 3 个角,收到 ${pointCount}`);
    }
    requireNonNegative('Star 的 outerRadius', outerRadius);
    requireNonNegative('Star 的 innerRadius', innerRadius);
    this.pointCount = pointCount;
    this.outerRadius = outerRadius;
    this.innerRadius = innerRadius;
    const points: Point[] = [];
    const total = pointCount * 2;
    for (let i = 0; i < total; i++) {
      const angle = -Math.PI / 2 + (i * Math.PI * 2) / total;
      const r = i % 2 === 0 ? outerRadius : innerRadius;
      points.push({ x: Math.cos(angle) * r, y: Math.sin(angle) * r });
    }
    this.points = points;
  }

  /** 顶点只读:路径只建一次。 */
  protected override pathKey(): string {
    return '';
  }

  protected override buildPath(): PathData {
    return polylinePath(this.points, true);
  }

  override getBox(): Box {
    return boxFromPoints(this.points);
  }

  override getCullRadius(): number {
    return maxPointRadius(this.points);
  }
}

/** 箭头的两部分:杆(描边)与头(用描边色填满)。 */
interface ArrowParts {
  shaft: PathData;
  head: PathData;
}

export class Arrow extends PathShape {
  start: Point;
  end: Point;
  headLength = 14;
  headWidth = 10;

  constructor(start: Point, end: Point) {
    super();
    this.start = requireFinitePoint('Arrow 的 start', start);
    this.end = requireFinitePoint('Arrow 的 end', end);
  }

  /** 箭头头部在任意方向上的最大外伸:头长与半个头宽取大者。 */
  private headReach(): number {
    return Math.max(safeRadius(this.headLength), safeRadius(this.headWidth) / 2);
  }

  /**
   * 杆与头的几何。f 是生长比例(null 为完整):生长中箭头跟随笔尖,画完才落到真正的 end。
   * 头长被钳短(箭头比头还短)时头宽同比例收缩,短箭头才不会退化成一根粗短杠。
   */
  private parts(f: number | null): ArrowParts {
    const ex = f === null ? this.end.x : this.start.x + (this.end.x - this.start.x) * f;
    const ey = f === null ? this.end.y : this.start.y + (this.end.y - this.start.y) * f;
    const dx = ex - this.start.x;
    const dy = ey - this.start.y;
    const len = Math.hypot(dx, dy);
    if (!(len > 0)) {
      return { shaft: EMPTY_PATH, head: EMPTY_PATH };
    }
    const ux = dx / len;
    const uy = dy / len;
    const headLength = safeRadius(this.headLength);
    const headLen = Math.min(headLength, len);
    const shrink = headLength > 0 ? headLen / headLength : 1;
    const baseX = ex - ux * headLen;
    const baseY = ey - uy * headLen;
    const px = -uy;
    const py = ux;
    const hw = (safeRadius(this.headWidth) / 2) * shrink;
    const shaft = new PathBuilder()
      .moveTo(this.start.x, this.start.y)
      .lineTo(baseX, baseY)
      .build();
    const head =
      hw > 0 && headLen > 0
        ? new PathBuilder()
            .moveTo(ex, ey)
            .lineTo(baseX + px * hw, baseY + py * hw)
            .lineTo(baseX - px * hw, baseY - py * hw)
            .close()
            .build()
        : EMPTY_PATH;
    return { shaft, head };
  }

  private layers(style: ResolvedStyle, parts: ArrowParts): PathLayer[] {
    return [
      {
        path: parts.shaft,
        paint: { fill: null, stroke: style.stroke, strokeWidth: style.strokeWidth, dash: style.dash },
      },
      // 头部用描边色填满:线宽为 0 时杆不画,头照画(与传统画法一致)。
      { path: parts.head, paint: { fill: style.stroke, stroke: null, strokeWidth: 0 } },
    ];
  }

  protected override pathKey(): string {
    return `${this.start.x},${this.start.y},${this.end.x},${this.end.y},${this.headLength},${this.headWidth}`;
  }

  protected override buildPath(): PathData {
    const parts = this.parts(null);
    return concatPaths([parts.shaft, parts.head]);
  }

  override pathLayers(style: ResolvedStyle): PathLayer[] {
    return this.layers(style, this.parts(null));
  }

  override getBox(): Box {
    // 箭头只长在末端,这里保守地四周都留出头部外伸量。
    return expandBox(boxFromPoints([this.start, this.end]), this.headReach());
  }

  override getCullRadius(): number {
    return (
      Math.max(
        Math.hypot(this.start.x, this.start.y),
        Math.hypot(this.end.x, this.end.y),
      ) + this.headReach()
    );
  }

  protected override drawShape(ctx: CanvasRenderingContext2D, style: ResolvedStyle): void {
    for (const layer of this.layers(style, this.parts(this.revealed()))) {
      drawPath(ctx, layer.path, layer.paint);
    }
  }
}

/** 圆弧/扇形的选项(角度为弧度,沿角度增大方向扫)。 */
export interface ArcOptions {
  radius?: number;
  startAngle?: number;
  endAngle?: number;
}

export class Arc extends PathShape {
  radius: number;
  startAngle: number;
  endAngle: number;

  constructor(options: ArcOptions);
  constructor(radius?: number, startAngle?: number, endAngle?: number);
  constructor(a: number | ArcOptions = 45, startAngle = 0, endAngle = Math.PI * 1.5) {
    super();
    const o = typeof a === 'object' ? a : { radius: a, startAngle, endAngle };
    this.radius = requireNonNegative('Arc 的 radius', o.radius ?? 45);
    this.startAngle = o.startAngle ?? 0;
    this.endAngle = o.endAngle ?? Math.PI * 1.5;
  }

  protected override get fillable(): boolean {
    return false;
  }

  protected override pathKey(): string {
    return `${this.radius},${this.startAngle},${this.endAngle}`;
  }

  /** 按规范化的扫角沿角度增大方向画(反向或超一圈也不会先画整圆再往回缩)。 */
  protected override buildPath(): PathData {
    return arcPath(this.radius, this.startAngle, arcSweep(this.startAngle, this.endAngle));
  }

  /** 终点角按扫角等比推进,与最终形状、包围盒一致。 */
  protected override revealPath(f: number): PathData {
    return arcPath(this.radius, this.startAngle, arcSweep(this.startAngle, this.endAngle) * f);
  }

  override getBox(): Box {
    return arcBox(this.radius, this.startAngle, this.endAngle, false);
  }

  override getCullRadius(): number {
    return safeRadius(this.radius);
  }
}

export class Sector extends PathShape {
  radius: number;
  startAngle: number;
  endAngle: number;

  constructor(options: ArcOptions);
  constructor(radius?: number, startAngle?: number, endAngle?: number);
  constructor(a: number | ArcOptions = 50, startAngle = 0, endAngle = Math.PI / 2) {
    super();
    const o = typeof a === 'object' ? a : { radius: a, startAngle, endAngle };
    this.radius = requireNonNegative('Sector 的 radius', o.radius ?? 50);
    this.startAngle = o.startAngle ?? 0;
    this.endAngle = o.endAngle ?? Math.PI / 2;
  }

  protected override pathKey(): string {
    return `${this.radius},${this.startAngle},${this.endAngle}`;
  }

  protected override buildPath(): PathData {
    return wedgePath(this.radius, this.startAngle, arcSweep(this.startAngle, this.endAngle));
  }

  /** 生长是楔形按角度扫开(连同填充),而不是沿轮廓描一圈。 */
  protected override revealPath(f: number): PathData {
    return wedgePath(this.radius, this.startAngle, arcSweep(this.startAngle, this.endAngle) * f);
  }

  override getBox(): Box {
    return arcBox(this.radius, this.startAngle, this.endAngle, true);
  }

  override getCullRadius(): number {
    return safeRadius(this.radius);
  }
}

export interface AnnotationOptions {
  offset?: Point;
  badgeRadius?: number;
  dotRadius?: number;
  showDot?: boolean;
  showLeader?: boolean;
}

/**
 * Annotation:关键点标注(编号/字母)。position 即被标的点,
 * 徽标画在 offset 处,附带引导线与目标圆点。
 */
export class Annotation extends MObject {
  text: string;
  offset: Point;
  badgeRadius: number;
  dotRadius: number;
  showDot: boolean;
  showLeader: boolean;
  private readonly font = new FontCache();

  constructor(text: string, options?: AnnotationOptions) {
    super();
    this.text = text;
    this.offset = options?.offset
      ? requireFinitePoint('Annotation 的 offset', options.offset)
      : { x: 18, y: -18 };
    this.badgeRadius = requireNonNegative(
      'Annotation 的 badgeRadius',
      options?.badgeRadius ?? 11,
    );
    this.dotRadius = requireNonNegative('Annotation 的 dotRadius', options?.dotRadius ?? 4);
    this.showDot = options?.showDot ?? true;
    this.showLeader = options?.showLeader ?? true;
  }

  override getBox(): Box {
    // 锚点圆点 + 偏移徽标的联合盒(相对 position,position 即锚点)。
    const { x: ox, y: oy } = this.offset;
    const dot = safeRadius(this.dotRadius);
    const badge = safeRadius(this.badgeRadius);
    return boxFromPoints([
      { x: -dot, y: -dot },
      { x: dot, y: dot },
      { x: ox - badge, y: oy - badge },
      { x: ox + badge, y: oy + badge },
    ]);
  }

  override getCullRadius(): number {
    return (
      Math.hypot(this.offset.x, this.offset.y) +
      Math.max(safeRadius(this.badgeRadius), safeRadius(this.dotRadius))
    );
  }

  /** 引导线止于徽标边缘,避免穿进字里。 */
  private leaderEnd(): Point {
    const { x: ox, y: oy } = this.offset;
    const badge = safeRadius(this.badgeRadius);
    const len = Math.hypot(ox, oy) || 1;
    return { x: ox - (ox / len) * badge, y: oy - (oy / len) * badge };
  }

  /** 线条部分(引导线、目标圆点、徽标圈)的几何;徽标里的字不在其中。 */
  override toPath(): PathData {
    return concatPaths(this.pathLayers(null).map((layer) => layer.path));
  }

  /**
   * 变形与书写用的分层几何(与 drawShape 的画法一一对应):引导线、目标圆点、徽标圈。
   * style 为 null 时只取几何。
   */
  override pathLayers(style: ResolvedStyle | null): PathLayer[] {
    const stroke = style?.stroke ?? null;
    const dash = style?.dash;
    const layers: PathLayer[] = [];
    if (this.showLeader) {
      const end = this.leaderEnd();
      layers.push({
        path: new PathBuilder().moveTo(0, 0).lineTo(end.x, end.y).build(),
        paint: { fill: null, stroke, strokeWidth: 1, dash },
      });
    }
    if (this.showDot) {
      layers.push({
        path: circlePath(this.dotRadius),
        paint: { fill: stroke, stroke: null, strokeWidth: 0 },
      });
    }
    layers.push({
      path: transformPath(circlePath(this.badgeRadius), [1, 0, 0, 1, this.offset.x, this.offset.y]),
      paint: { fill: style?.fill ?? null, stroke, strokeWidth: 1.5, dash },
    });
    return layers;
  }

  /** 变形期间交叉淡化的只有徽标里的字。 */
  override drawMorphResidual(ctx: CanvasRenderingContext2D, style: ResolvedStyle): void {
    this.drawText(ctx, style);
  }

  protected override drawShape(
    ctx: CanvasRenderingContext2D,
    style: ResolvedStyle,
  ): void {
    const { x: ox, y: oy } = this.offset;
    const badge = safeRadius(this.badgeRadius);
    if (this.showLeader && applyStroke(ctx, style, 1)) {
      const end = this.leaderEnd();
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
    }
    if (this.showDot) {
      ctx.beginPath();
      ctx.arc(0, 0, safeRadius(this.dotRadius), 0, Math.PI * 2);
      ctx.fillStyle = style.stroke;
      ctx.fill();
    }
    ctx.beginPath();
    ctx.arc(ox, oy, badge, 0, Math.PI * 2);
    if (style.fill !== null) {
      ctx.fillStyle = style.fill;
      ctx.fill();
    }
    if (applyStroke(ctx, style, 1.5)) {
      ctx.stroke();
    }
    this.drawText(ctx, style);
  }

  private drawText(ctx: CanvasRenderingContext2D, style: ResolvedStyle): void {
    ctx.font = this.font.get(safeRadius(this.badgeRadius), style.fontFamily);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = style.textColor;
    ctx.fillText(this.text, this.offset.x, this.offset.y);
  }
}
