import type { PathLayer } from '../path/draw';
import { drawPath } from '../path/draw';
import { partialPath } from '../path/measure';
import type { PathData } from '../path/path';
import { PathBuilder, concatPaths } from '../path/path';
import type { ResolvedStyle } from '../theme/Theme';
import { MObject } from './MObject';
import { FontCache, PathShape, applyStroke, measureTextWidth } from './shapes';
import type { Bounds, Box, Point } from './types';
import { FALLBACK_MEASURE, boxFromPoints, maxPointRadius } from './types';

export type RealFunction = (x: number) => number;
export type ParamCurve2D = (t: number) => [number, number];

/**
 * 坐标系:把数学坐标换成本地坐标(y 向上的数学坐标 → y 向下的画布坐标)。
 * Axes、NumberPlane 都是;函数图像、曲线下面积、切线这些按坐标系取样的图元只认这个接口。
 * 取样得到的是坐标系的本地坐标,把它们和坐标系放进同一个组(或同一个父节点、同样的变换)才对得上。
 */
export interface CoordinateSystem {
  readonly xRange: readonly [number, number];
  readonly yRange: readonly [number, number];
  /** 坐标框的本地尺寸。 */
  readonly width: number;
  readonly height: number;
  toLocal(x: number, y: number): Point;
}

/** 刻度数量上限:超过它就不画刻度,绝不让循环跑飞。 */
export const MAX_TICKS = 1e4;
/** 刻度字号与轴名字号(本地单位,与绘制一致)。 */
const TICK_FONT_PX = 10;
const LABEL_FONT_PX = 13;
/** 轴端箭头的长度与半宽(本地单位)。 */
const ARROW_LENGTH = 7;
const ARROW_HALF_WIDTH = 3.5;

/** 轴端箭头:尖在 (tipX, tipY),指向单位向量 (dx, dy)。 */
export function arrowHeadPath(
  tipX: number,
  tipY: number,
  dx: number,
  dy: number,
  length = ARROW_LENGTH,
  halfWidth = ARROW_HALF_WIDTH,
): PathData {
  const bx = tipX - dx * length;
  const by = tipY - dy * length;
  return new PathBuilder()
    .moveTo(tipX, tipY)
    .lineTo(bx - dy * halfWidth, by + dx * halfWidth)
    .lineTo(bx + dy * halfWidth, by - dx * halfWidth)
    .close()
    .build();
}

/**
 * 刻度步长取整。
 * 非有限输入返回 Infinity —— 让刻度循环一次都不跑(而不是用步长 1 去遍历无穷区间,
 * 那会当场死循环并耗尽内存);非正的有限输入回落到 1。
 */
export function niceStep(raw: number): number {
  if (!Number.isFinite(raw)) {
    return Infinity;
  }
  if (!(raw > 0)) {
    return 1;
  }
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  if (norm < 1.5) {
    return mag;
  }
  if (norm < 3.5) {
    return 2 * mag;
  }
  if (norm < 7.5) {
    return 5 * mag;
  }
  return 10 * mag;
}

/** 刻度数字:舍到 6 位小数(吃掉 0.1 × 3 这类浮点残差)。 */
export function formatTick(v: number): string {
  const r = Math.round(v * 1e6) / 1e6;
  // -0 会被格式化成 "0",但 1e-7 这类残差舍入后可能是 -0,统一归零。
  return String(r === 0 ? 0 : r);
}

/**
 * [min, max] 里 step 的全部整数倍(两端各放宽 1e-9 个步长,吸收浮点误差),从小到大。
 * 输入非有限或步长不是正数时返回空数组;个数超过 limit 返回 null,由调用方决定报错还是不画。
 * 先算出个数,再用从 0 数起的小整数遍历:浮点累加 t += step、甚至 k++ 本身,
 * 在大偏移下都会原地踏步(k≈2e16 时相邻浮点数相差 4,k++ 不变),循环永不结束。
 */
export function stepMultiples(
  min: number,
  max: number,
  step: number,
  limit = MAX_TICKS,
): number[] | null {
  if (!Number.isFinite(step) || !(step > 0) || !Number.isFinite(min) || !Number.isFinite(max)) {
    return [];
  }
  const k0 = Math.ceil(min / step - 1e-9);
  const k1 = Math.floor(max / step + 1e-9);
  const count = k1 - k0;
  if (!(count >= 0)) {
    return [];
  }
  if (count > limit) {
    return null;
  }
  const base = k0 * step;
  const out: number[] = [];
  for (let i = 0; i <= count; i++) {
    out.push(base + i * step);
  }
  return out;
}

/** 数学坐标 → 坐标框本地坐标(框居中于原点,y 翻转)。Axes 与 NumberPlane 共用这一份映射。 */
export function frameToLocal(
  xRange: readonly [number, number],
  yRange: readonly [number, number],
  width: number,
  height: number,
  x: number,
  y: number,
): Point {
  const [xMin, xMax] = xRange;
  const [yMin, yMax] = yRange;
  return {
    x: ((x - xMin) / (xMax - xMin)) * width - width / 2,
    y: height / 2 - ((y - yMin) / (yMax - yMin)) * height,
  };
}

/** frameToLocal 的逆映射。 */
export function localToFrame(
  xRange: readonly [number, number],
  yRange: readonly [number, number],
  width: number,
  height: number,
  p: Point,
): Point {
  const [xMin, xMax] = xRange;
  const [yMin, yMax] = yRange;
  return {
    x: xMin + ((p.x + width / 2) / width) * (xMax - xMin),
    y: yMin + ((height / 2 - p.y) / height) * (yMax - yMin),
  };
}

/**
 * 采样点列连成的折线路径:非有限点处抬笔,breaks[i] 为 true 的点另起一笔。
 * 孤立的单点(前后都断开)画不出线段,不进路径。
 */
function polylineRuns(points: readonly Point[], breaks?: readonly boolean[]): PathData {
  const b = new PathBuilder();
  let penUp = true;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) {
      penUp = true;
      continue;
    }
    if (penUp || breaks?.[i]) {
      b.moveTo(p.x, p.y);
    } else {
      b.lineTo(p.x, p.y);
    }
    penUp = false;
  }
  return b.build();
}

/** 采样数归一到正整数。 */
function sampleCount(samples: number): number {
  return Math.max(1, Math.floor(Number.isFinite(samples) ? samples : 1));
}

function isFiniteInRange(v: number, lo: number, hi: number): boolean {
  return Number.isFinite(v) && v >= lo && v <= hi;
}

interface Tick {
  pos: number;
  text: string;
}

/** 以 (x, y) 为锚点、按对齐方式放置的文字框。 */
function textBounds(
  x: number,
  y: number,
  w: number,
  h: number,
  align: 'left' | 'center' | 'right',
  baseline: 'top' | 'middle' | 'bottom',
): Bounds {
  const minX = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
  const minY = baseline === 'top' ? y : baseline === 'bottom' ? y - h : y - h / 2;
  return { minX, minY, maxX: minX + w, maxY: minY + h };
}

/**
 * Axes:数学坐标系,原点按范围换算,落在框内时两轴过原点。
 * 刻度步长自动取整,箭头指向正方向。范围必须 max > min。
 * width/height 是坐标框的本地尺寸(世界单位,跟相机缩放);
 * 包围盒另外覆盖了刻度数字与轴名的实际占位,取景不会裁字。
 */
export class Axes extends MObject implements CoordinateSystem {
  readonly xRange: readonly [number, number];
  readonly yRange: readonly [number, number];
  readonly width: number;
  readonly height: number;
  readonly xLabel: string;
  readonly yLabel: string;
  private readonly xTicks: Tick[];
  private readonly yTicks: Tick[];
  private readonly box: Box;
  private readonly cullRadius: number;
  private readonly tickFont = new FontCache();
  private readonly labelFont = new FontCache();

  constructor(
    xRange: readonly [number, number],
    yRange: readonly [number, number],
    width: number,
    height: number,
    labels?: { x?: string; y?: string },
  ) {
    super();
    if (!(xRange[1] > xRange[0]) || !(yRange[1] > yRange[0])) {
      throw new Error('Axes 需要 max > min 的 xRange / yRange');
    }
    if (!(width > 0) || !(height > 0) || !Number.isFinite(width) || !Number.isFinite(height)) {
      throw new Error(`Axes 需要正的有限 width / height,收到 ${width} × ${height}`);
    }
    // 拷贝一份:调用方之后改自己的元组不该让坐标系与已采样的曲线错位。
    this.xRange = [xRange[0], xRange[1]];
    this.yRange = [yRange[0], yRange[1]];
    this.width = width;
    this.height = height;
    this.xLabel = labels?.x ?? 'x';
    this.yLabel = labels?.y ?? 'y';
    // 刻度与包围盒只依赖范围与尺寸,构造期算一次,drawShape 里不再重算字符串。
    this.xTicks = this.buildTicks('x', 6);
    this.yTicks = this.buildTicks('y', 5);
    const b = this.contentBounds();
    this.box = {
      size: { w: b.maxX - b.minX, h: b.maxY - b.minY },
      center: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 },
    };
    this.cullRadius = Math.max(
      Math.hypot(b.minX, b.minY),
      Math.hypot(b.maxX, b.minY),
      Math.hypot(b.minX, b.maxY),
      Math.hypot(b.maxX, b.maxY),
    );
  }

  override getBox(): Box {
    return { size: { ...this.box.size }, center: { ...this.box.center } };
  }

  override getCullRadius(): number {
    return this.cullRadius;
  }

  /** 数学坐标转局部坐标(y 翻转,原点居中)。 */
  toLocal(x: number, y: number): Point {
    return frameToLocal(this.xRange, this.yRange, this.width, this.height, x, y);
  }

  /**
   * 两轴在本地坐标里的位置。范围不含 0 时轴贴到「0 所在的那一侧」的边框上。
   * 局部坐标 y 向下:yMax<0(整段为负)时 0 在上方 => -h/2;
   * xMax<0(整段为负)时 0 在右方 => +w/2,整段为正时 0 在左方 => -w/2。
   */
  private axisOrigin(): { x0: number; y0: number } {
    const [xMin, xMax] = this.xRange;
    const [yMin, yMax] = this.yRange;
    const w = this.width;
    const h = this.height;
    return {
      x0: xMin <= 0 && 0 <= xMax ? this.toLocal(0, 0).x : xMax < 0 ? w / 2 : -w / 2,
      y0: yMin <= 0 && 0 <= yMax ? this.toLocal(0, 0).y : yMax < 0 ? -h / 2 : h / 2,
    };
  }

  private buildTicks(axis: 'x' | 'y', divisions: number): Tick[] {
    const [min, max] = axis === 'x' ? this.xRange : this.yRange;
    const size = axis === 'x' ? this.width : this.height;
    const ticks: Tick[] = [];
    const values = stepMultiples(min, max, niceStep((max - min) / divisions));
    if (!values) {
      return ticks;
    }
    let lastText = '';
    for (const t of values) {
      const local = axis === 'x' ? this.toLocal(t, 0).x : this.toLocal(0, t).y;
      if (!Number.isFinite(local) || local < -size / 2 - 1e-6 || local > size / 2 + 1e-6) {
        continue;
      }
      const text = formatTick(t);
      // 相对精度耗尽时相邻刻度会格式化成同一个数,重复的只留一个。
      if (text === lastText) {
        continue;
      }
      lastText = text;
      ticks.push({ pos: local, text });
    }
    return ticks;
  }

  /** 坐标框 + 箭头 + 刻度数字 + 轴名的本地外接矩形(文字宽按兜底字体量)。 */
  private contentBounds(): Bounds {
    const w = this.width;
    const h = this.height;
    const { x0, y0 } = this.axisOrigin();
    const family = FALLBACK_MEASURE.fontFamily;
    const lineH = TICK_FONT_PX * 1.25;
    const acc: Bounds = { minX: -w / 2, minY: -h / 2 - 3.5, maxX: w / 2 + 3.5, maxY: h / 2 };
    const add = (b: Bounds): void => {
      acc.minX = Math.min(acc.minX, b.minX);
      acc.minY = Math.min(acc.minY, b.minY);
      acc.maxX = Math.max(acc.maxX, b.maxX);
      acc.maxY = Math.max(acc.maxY, b.maxY);
    };
    for (const tick of this.xTicks) {
      const tw = measureTextWidth(tick.text, TICK_FONT_PX, family);
      add(textBounds(tick.pos, y0 + 5, tw, lineH, 'center', 'top'));
    }
    for (const tick of this.yTicks) {
      const tw = measureTextWidth(tick.text, TICK_FONT_PX, family);
      add(textBounds(x0 - 5, tick.pos, tw, lineH, 'right', 'middle'));
    }
    // 斜体轴名按 1.1 倍宽度留余量(斜体末字会向右探出)。
    const labelH = LABEL_FONT_PX * 1.25;
    if (this.xLabel !== '') {
      const lw = measureTextWidth(this.xLabel, LABEL_FONT_PX, family) * 1.1;
      add(textBounds(w / 2 + 6, y0, lw, labelH, 'left', 'middle'));
    }
    if (this.yLabel !== '') {
      const lw = measureTextWidth(this.yLabel, LABEL_FONT_PX, family) * 1.1;
      add(textBounds(x0, -h / 2 - 6, lw, labelH, 'center', 'bottom'));
    }
    return acc;
  }

  /** 轴线比曲线细一号;strokeWidth 为 0 时整个坐标系的线都不画(返回 0)。 */
  private lineWidth(style: ResolvedStyle): number {
    return style.strokeWidth > 0 ? Math.max(1, style.strokeWidth - 1) : 0;
  }

  /** 线条部分的几何:x 轴、y 轴、全部刻度线、两个箭头(与 drawShape 的画法一一对应)。 */
  private lineParts(): { xAxis: PathData; yAxis: PathData; ticks: PathData; heads: PathData } {
    const w = this.width;
    const h = this.height;
    const { x0, y0 } = this.axisOrigin();
    const ticks = new PathBuilder();
    for (const tick of this.xTicks) {
      ticks.moveTo(tick.pos, y0 - 3).lineTo(tick.pos, y0 + 3);
    }
    for (const tick of this.yTicks) {
      ticks.moveTo(x0 - 3, tick.pos).lineTo(x0 + 3, tick.pos);
    }
    return {
      xAxis: new PathBuilder().moveTo(-w / 2, y0).lineTo(w / 2, y0).build(),
      yAxis: new PathBuilder().moveTo(x0, h / 2).lineTo(x0, -h / 2).build(),
      ticks: ticks.build(),
      heads: concatPaths([arrowHeadPath(w / 2, y0, 1, 0), arrowHeadPath(x0, -h / 2, 0, -1)]),
    };
  }

  /** 轴线、刻度线与箭头的几何(本地坐标)。刻度数字与轴名是画布文字,不在其中。 */
  override toPath(): PathData {
    const { xAxis, yAxis, ticks, heads } = this.lineParts();
    return concatPaths([xAxis, yAxis, ticks, heads]);
  }

  /** 变形与书写用的分层几何;文字部分交叉淡化(drawMorphResidual)。 */
  override pathLayers(style: ResolvedStyle): PathLayer[] {
    const { xAxis, yAxis, ticks, heads } = this.lineParts();
    const width = this.lineWidth(style);
    const line = { fill: null, stroke: style.stroke, strokeWidth: width, dash: style.dash };
    return [
      { path: xAxis, paint: line },
      { path: yAxis, paint: line },
      { path: ticks, paint: line },
      // 箭头跟着轴线:线宽为 0 时一起不画。
      { path: heads, paint: { fill: width > 0 ? style.stroke : null, stroke: null, strokeWidth: 0 } },
    ];
  }

  /** 变形期间交叉淡化的是刻度数字与轴名。 */
  override drawMorphResidual(ctx: CanvasRenderingContext2D, style: ResolvedStyle): void {
    this.drawLabels(ctx, style);
  }

  /** 支持 Create:两条轴与刻度按长度画出来,箭头与文字在后半程淡入。 */
  override get supportsReveal(): boolean {
    return true;
  }

  protected override drawShape(
    ctx: CanvasRenderingContext2D,
    style: ResolvedStyle,
  ): void {
    const r = this.revealed();
    if (r !== null) {
      this.drawRevealed(ctx, style, r);
      return;
    }
    const w = this.width;
    const h = this.height;
    const { x0, y0 } = this.axisOrigin();
    if (applyStroke(ctx, style, this.lineWidth(style))) {
      ctx.fillStyle = style.stroke;
      ctx.beginPath();
      ctx.moveTo(-w / 2, y0);
      ctx.lineTo(w / 2, y0);
      ctx.stroke();
      this.arrowHead(ctx, w / 2, y0, 1, 0);
      ctx.beginPath();
      ctx.moveTo(x0, h / 2);
      ctx.lineTo(x0, -h / 2);
      ctx.stroke();
      this.arrowHead(ctx, x0, -h / 2, 0, -1);
      // 刻度线合并成一条路径,一次 stroke。
      ctx.beginPath();
      for (const tick of this.xTicks) {
        ctx.moveTo(tick.pos, y0 - 3);
        ctx.lineTo(tick.pos, y0 + 3);
      }
      for (const tick of this.yTicks) {
        ctx.moveTo(x0 - 3, tick.pos);
        ctx.lineTo(x0 + 3, tick.pos);
      }
      ctx.stroke();
    }
    this.drawLabels(ctx, style);
  }

  /** 生长到 f:x 轴从左往右、y 轴自下而上、刻度依次画出;后半程箭头与刻度数字、轴名淡入。 */
  private drawRevealed(ctx: CanvasRenderingContext2D, style: ResolvedStyle, f: number): void {
    const [xAxis, yAxis, ticks, heads] = this.pathLayers(style);
    for (const layer of [xAxis, yAxis, ticks]) {
      if (layer) {
        drawPath(ctx, partialPath(layer.path, 0, f), layer.paint);
      }
    }
    const k = (f - 0.5) * 2;
    if (!(k > 0)) {
      return;
    }
    ctx.save();
    ctx.globalAlpha *= k;
    if (heads) {
      drawPath(ctx, heads.path, heads.paint);
    }
    this.drawLabels(ctx, style);
    ctx.restore();
  }

  /** 刻度数字与轴名。 */
  private drawLabels(ctx: CanvasRenderingContext2D, style: ResolvedStyle): void {
    const w = this.width;
    const h = this.height;
    const { x0, y0 } = this.axisOrigin();
    ctx.font = this.tickFont.get(TICK_FONT_PX, style.fontFamily);
    ctx.fillStyle = style.textColor;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    for (const tick of this.xTicks) {
      ctx.fillText(tick.text, tick.pos, y0 + 5);
    }
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    for (const tick of this.yTicks) {
      ctx.fillText(tick.text, x0 - 5, tick.pos);
    }
    // 轴名:箭头外侧斜体,空串可单独隐藏。
    ctx.font = this.labelFont.get(LABEL_FONT_PX, style.fontFamily, 'italic ');
    if (this.xLabel !== '') {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.xLabel, w / 2 + 6, y0);
    }
    if (this.yLabel !== '') {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(this.yLabel, x0, -h / 2 - 6);
    }
  }

  private arrowHead(
    ctx: CanvasRenderingContext2D,
    tipX: number,
    tipY: number,
    dx: number,
    dy: number,
  ): void {
    const len = ARROW_LENGTH;
    const half = ARROW_HALF_WIDTH;
    const bx = tipX - dx * len;
    const by = tipY - dy * len;
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(bx - dy * half, by + dx * half);
    ctx.lineTo(bx + dy * half, by - dx * half);
    ctx.closePath();
    ctx.fill();
  }
}

/**
 * FunctionGraph:函数图像 y = fn(x),按 axes 范围采样。
 * 越界/无定义/单步跳变超过九成框高(渐近线)处自动断笔;
 * 数学值变号且跳变显著时再补算一次中点,中点越界或无定义才判为极点断笔 ——
 * 这样 tan 的极点不会画出穿屏直线,tanh(100x) 这类陡峭但连续的过零也不会被画出假断口。
 */
export class FunctionGraph extends PathShape {
  readonly points: readonly Point[];
  readonly breaks: readonly boolean[];
  private readonly cullRadius: number;

  constructor(fn: RealFunction, axes: CoordinateSystem, samples = 200) {
    super();
    const n = sampleCount(samples);
    const [xMin, xMax] = axes.xRange;
    const [yMin, yMax] = axes.yRange;
    const points: Point[] = [];
    const breaks: boolean[] = [];
    let prevY = 0;
    let prevX = xMin;
    let prevValue = 0;
    let havePrev = false;
    for (let i = 0; i <= n; i++) {
      const x = xMin + ((xMax - xMin) * i) / n;
      const y = fn(x);
      if (!Number.isFinite(y) || y < yMin || y > yMax) {
        points.push({ x: NaN, y: NaN });
        breaks.push(true);
        havePrev = false;
        continue;
      }
      const p = axes.toLocal(x, y);
      const dy = Math.abs(p.y - prevY);
      const suspect =
        havePrev && prevValue * y < 0 && dy > axes.height * 0.25;
      const jump =
        havePrev &&
        (dy > axes.height * 0.9 ||
          (suspect && !isFiniteInRange(fn((prevX + x) / 2), yMin, yMax)));
      points.push(p);
      breaks.push(jump || !havePrev);
      prevY = p.y;
      prevX = x;
      prevValue = y;
      havePrev = true;
    }
    this.points = points;
    this.breaks = breaks;
    this.cullRadius = maxPointRadius(points);
  }

  protected override get fillable(): boolean {
    return false;
  }

  /** 采样点只读:路径只建一次。 */
  protected override pathKey(): string {
    return '';
  }

  protected override buildPath(): PathData {
    return polylineRuns(this.points, this.breaks);
  }

  override getBox(): Box {
    return boxFromPoints(this.points);
  }

  override getCullRadius(): number {
    return this.cullRadius;
  }
}

/** ParametricCurve2D:平面参数曲线,越界/无定义处断笔。 */
export class ParametricCurve2D extends PathShape {
  readonly points: readonly Point[];
  private readonly cullRadius: number;

  constructor(
    fn: ParamCurve2D,
    axes: CoordinateSystem,
    tRange: readonly [number, number],
    samples = 240,
  ) {
    super();
    const n = sampleCount(samples);
    const [xMin, xMax] = axes.xRange;
    const [yMin, yMax] = axes.yRange;
    const points: Point[] = [];
    for (let i = 0; i <= n; i++) {
      const t = tRange[0] + ((tRange[1] - tRange[0]) * i) / n;
      const [x, y] = fn(t);
      if (
        !Number.isFinite(x) ||
        !Number.isFinite(y) ||
        x < xMin ||
        x > xMax ||
        y < yMin ||
        y > yMax
      ) {
        points.push({ x: NaN, y: NaN });
        continue;
      }
      points.push(axes.toLocal(x, y));
    }
    this.points = points;
    this.cullRadius = maxPointRadius(points);
  }

  protected override get fillable(): boolean {
    return false;
  }

  /** 采样点只读:路径只建一次。 */
  protected override pathKey(): string {
    return '';
  }

  protected override buildPath(): PathData {
    return polylineRuns(this.points);
  }

  override getBox(): Box {
    return boxFromPoints(this.points);
  }

  override getCullRadius(): number {
    return this.cullRadius;
  }
}

export const sinFn: RealFunction = (x) => Math.sin(x);
export const cosFn: RealFunction = (x) => Math.cos(x);
export const tanFn: RealFunction = (x) => Math.tan(x);
export const expFn: RealFunction = (x) => Math.exp(x);
export const logFn: RealFunction = (x) => (x <= 0 ? NaN : Math.log(x));
export const sincFn: RealFunction = (x) =>
  Math.abs(x) < 1e-12 ? 1 : Math.sin(x) / x;

export const spiralFn =
  (growth: number): ParamCurve2D =>
  (t) =>
    [growth * t * Math.cos(t), growth * t * Math.sin(t)];

export const lissajousFn =
  (fx: number, fy: number, delta: number, amp: number): ParamCurve2D =>
  (t) =>
    [amp * Math.sin(fx * t + delta), amp * Math.sin(fy * t)];

/** Trace:逐帧追加的轨迹线,点列由外部每帧重写或增量追加。 */
export class Trace extends PathShape {
  private pts: Point[] = [];
  private cullRadius = 0;
  /** 点列改过几次:路径缓存的身份键(不变的轨迹每帧直接复用路径)。 */
  private version = 0;

  clear(): this {
    this.pts.length = 0;
    this.cullRadius = 0;
    this.version += 1;
    return this;
  }

  /** 整体替换点列。复用已有的点对象(典型用法是每帧调一次),不逐帧分配整条轨迹。 */
  setPoints(points: readonly Point[]): this {
    const pts = this.pts;
    for (let i = 0; i < points.length; i++) {
      const src = points[i];
      if (!src) {
        continue;
      }
      const dst = pts[i];
      if (dst) {
        dst.x = src.x;
        dst.y = src.y;
      } else {
        pts.push({ x: src.x, y: src.y });
      }
    }
    pts.length = points.length;
    this.cullRadius = maxPointRadius(pts);
    this.version += 1;
    return this;
  }

  addPoint(p: Point): this {
    this.pts.push({ x: p.x, y: p.y });
    if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
      this.cullRadius = Math.max(this.cullRadius, Math.hypot(p.x, p.y));
    }
    this.version += 1;
    return this;
  }

  /** 当前点列的快照(元素也是拷贝),改它不会影响 Trace。 */
  getPoints(): Point[] {
    return this.pts.map((p) => ({ ...p }));
  }

  /** 当前点数(避免为了拿长度而拷贝整条轨迹)。 */
  get length(): number {
    return this.pts.length;
  }

  protected override get fillable(): boolean {
    return false;
  }

  protected override pathKey(): string {
    return String(this.version);
  }

  protected override buildPath(): PathData {
    return polylineRuns(this.pts);
  }

  override getBox(): Box {
    return boxFromPoints(this.pts);
  }

  override getCullRadius(): number {
    return this.cullRadius;
  }
}
