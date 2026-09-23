import type { PathLayer } from '../path/draw';
import { drawPath } from '../path/draw';
import { cubicSlice, partialPath } from '../path/measure';
import type { PathData, Subpath } from '../path/path';
import { EMPTY_PATH, PathBuilder, concatPaths, segmentCount } from '../path/path';
import type { ResolvedStyle } from '../theme/Theme';
import type { CoordinateSystem } from './graphs';
import {
  arrowHeadPath,
  formatTick,
  frameToLocal,
  localToFrame,
  stepMultiples,
} from './graphs';
import { Group } from './Group';
import type { MObject } from './MObject';
import type { LabelKind } from './labels';
import {
  makeLabel,
  placeOutside,
  requireFinite,
  requirePositive,
  requireRange,
  typographicMinus,
} from './labels';
import { PathShape, requireNonNegative } from './shapes';
import type { Point } from './types';

/** 一条数轴 / 一张网格的刻度、网格线数量上限:超过就是步长写错了,直接报错。 */
const MAX_MARKS = 1000;
/** 数轴箭头的长度与半宽(本地单位)。 */
const TIP_LENGTH = 9;
const TIP_HALF_WIDTH = 4.5;
/** 轴线、刻度的缺省线宽(比图形的线细一号,和 Axes 一致)。 */
const AXIS_STROKE_WIDTH = 2;

/** 数轴端头的箭头:'end' 只在最大值一端,'both' 两端都有。 */
export type NumberLineTips = 'none' | 'end' | 'both';

function marks(name: string, min: number, max: number, step: number): number[] {
  const values = stepMultiples(min, max, step, MAX_MARKS);
  if (!values) {
    throw new Error(`${name}:[${min}, ${max}] 按步长 ${step} 要画 ${MAX_MARKS} 条以上,步长是不是写错了`);
  }
  return values;
}

/** 两个值在步长的一亿分之一内算同一个刻度(浮点累加的残差)。 */
function sameMark(a: number, b: number, step: number): boolean {
  return Math.abs(a - b) <= step * 1e-8;
}

/** 数轴的线:可选箭头(头部用描边色填满)。生长时终点的箭头跟着笔尖走,起点的箭头一开始就在。 */
class AxisLine extends PathShape {
  readonly start: Point;
  readonly end: Point;
  readonly tips: NumberLineTips;

  constructor(start: Point, end: Point, tips: NumberLineTips) {
    super();
    this.start = start;
    this.end = end;
    this.tips = tips;
    this.setDefaultStyle({ strokeWidth: AXIS_STROKE_WIDTH });
  }

  /** 杆与箭头。f 是生长比例(null 为完整)。杆缩到箭头底部,粗线不会从箭尖旁探出来。 */
  private parts(f: number | null): { shaft: PathData; heads: PathData } {
    const { start, end } = this;
    const k = f === null ? 1 : f;
    const ex = start.x + (end.x - start.x) * k;
    const ey = start.y + (end.y - start.y) * k;
    const len = Math.hypot(end.x - start.x, end.y - start.y);
    if (!(len > 0) || !(k > 0)) {
      return { shaft: EMPTY_PATH, heads: EMPTY_PATH };
    }
    const ux = (end.x - start.x) / len;
    const uy = (end.y - start.y) / len;
    const grown = len * k;
    const room = this.tips === 'both' ? grown / 2 : grown;
    const tip = Math.min(TIP_LENGTH, room);
    const half = TIP_HALF_WIDTH * (tip / TIP_LENGTH);
    const heads: PathData[] = [];
    let sx = start.x;
    let sy = start.y;
    let tx = ex;
    let ty = ey;
    if (this.tips !== 'none' && tip > 0) {
      heads.push(arrowHeadPath(ex, ey, ux, uy, tip, half));
      tx -= ux * tip;
      ty -= uy * tip;
      if (this.tips === 'both') {
        heads.push(arrowHeadPath(start.x, start.y, -ux, -uy, tip, half));
        sx += ux * tip;
        sy += uy * tip;
      }
    }
    return {
      shaft: new PathBuilder().moveTo(sx, sy).lineTo(tx, ty).build(),
      heads: concatPaths(heads),
    };
  }

  private layers(style: ResolvedStyle, f: number | null): PathLayer[] {
    const { shaft, heads } = this.parts(f);
    const width = style.strokeWidth;
    const stroke = style.stroke;
    return [
      { path: shaft, paint: { fill: null, stroke, strokeWidth: width, dash: style.dash } },
      // 箭头跟着轴线:线宽为 0 时一起不画(与 Axes 一致)。
      { path: heads, paint: { fill: width > 0 ? stroke : null, stroke: null, strokeWidth: 0 } },
    ];
  }

  protected override get fillable(): boolean {
    return false;
  }

  protected override pathKey(): string {
    return '';
  }

  protected override buildPath(): PathData {
    const { shaft, heads } = this.parts(null);
    return concatPaths([shaft, heads]);
  }

  override pathLayers(style: ResolvedStyle): PathLayer[] {
    return this.layers(style, null);
  }

  protected override drawShape(ctx: CanvasRenderingContext2D, style: ResolvedStyle): void {
    for (const layer of this.layers(style, this.revealed())) {
      drawPath(ctx, layer.path, layer.paint);
    }
  }
}

/** 一组互不相连的线段(刻度线、网格线):一条路径,线段各占一条子路径。 */
class Segments extends PathShape {
  private readonly path: PathData;
  /** 生长方式:'sequence' 逐条画出(刻度),'together' 所有线同时从起点长出来(网格)。 */
  private readonly growth: 'sequence' | 'together';

  constructor(segments: ReadonlyArray<readonly [Point, Point]>, growth: 'sequence' | 'together') {
    super();
    const b = new PathBuilder();
    for (const [p, q] of segments) {
      b.moveTo(p.x, p.y).lineTo(q.x, q.y);
    }
    this.path = b.build();
    this.growth = growth;
  }

  protected override get fillable(): boolean {
    return false;
  }

  protected override pathKey(): string {
    return '';
  }

  protected override buildPath(): PathData {
    return this.path;
  }

  protected override revealPath(f: number): PathData {
    if (this.growth === 'sequence') {
      return partialPath(this.path, 0, f);
    }
    return growEach(this.path, f);
  }
}

/** 每条子路径各自按比例生长(单段子路径直接截贝塞尔参数,直线上就是按长度)。 */
function growEach(path: PathData, f: number): PathData {
  if (!(f > 0)) {
    return EMPTY_PATH;
  }
  if (f >= 1) {
    return path;
  }
  const subpaths: Subpath[] = [];
  for (const sub of path.subpaths) {
    const p = sub.points;
    if (segmentCount(sub) === 1) {
      const c = cubicSlice(
        [p[0] ?? 0, p[1] ?? 0, p[2] ?? 0, p[3] ?? 0, p[4] ?? 0, p[5] ?? 0, p[6] ?? 0, p[7] ?? 0],
        0,
        f,
      );
      subpaths.push({ points: [...c], closed: false });
    } else {
      subpaths.push(...partialPath({ subpaths: [sub] }, 0, f).subpaths);
    }
  }
  return { subpaths };
}

/** 刻度线:缺省线宽与轴线一致。 */
class TickMarks extends Segments {
  constructor(segments: ReadonlyArray<readonly [Point, Point]>) {
    super(segments, 'sequence');
    this.setDefaultStyle({ strokeWidth: AXIS_STROKE_WIDTH });
  }
}

/** 网格线:淡色细线,所有线同时长出来。 */
class GridLines extends Segments {
  constructor(segments: ReadonlyArray<readonly [Point, Point]>, stroke: string) {
    super(segments, 'together');
    this.setDefaultStyle({ stroke, strokeWidth: 1 });
  }
}

export interface NumberLineOptions {
  /** 数轴的本地长度,默认 400。 */
  length?: number;
  /** 竖直数轴(最小值在下、朝上增大,数字在左侧),默认 false:水平,数字在下方。 */
  vertical?: boolean;
  /** 画刻度线,默认 true。 */
  ticks?: boolean;
  /** 刻度线总长,默认 10(轴线两侧各一半)。 */
  tickSize?: number;
  /** 标数字:true 为每个刻度都标(默认),false 不标,或者给出要标的数值。 */
  numbers?: boolean | readonly number[];
  /** 这些数值不标数字(刻度照画),比如坐标网格的原点。 */
  exclude?: readonly number[];
  /** 数字格式,缺省舍到 6 位小数。 */
  format?: (value: number) => string;
  /** 数字排成 Tex(默认)还是画布文字 Label。 */
  labelKind?: LabelKind;
  /** 数字字号,默认 18。 */
  fontSize?: number;
  /** 数字与刻度(或轴线)的间距,默认 6。 */
  numberGap?: number;
  /** 端头箭头,默认 'none'。箭头画在区间外侧,不压住最末的刻度。 */
  tips?: NumberLineTips;
}

/**
 * NumberLine:数轴(组:轴线 line、刻度 tickMarks、数字 numberLabels)。
 * range = [min, max, step](step 缺省 1),刻度落在 step 的整数倍上。
 * 以自身原点为中心:n2p(数值) 给出本地坐标,p2n 反过来;把点、箭头直接加进数轴这个组里,
 * 数轴怎么移动、缩放、旋转它们都跟着(旋转时数字也跟着转)。
 * 支持 Create(轴线生长、刻度依次出现、数字逐个写出)、Write、Transform。
 */
export class NumberLine extends Group {
  readonly min: number;
  readonly max: number;
  readonly step: number;
  readonly length: number;
  readonly vertical: boolean;
  readonly line: PathShape;
  readonly tickMarks: PathShape | null;
  readonly numberLabels: readonly MObject[];
  private readonly ticksAt: readonly number[];
  /** 标了数字的数值、数字对象,以及负数去掉负号后的样子(量宽度用,不进场景)。 */
  private readonly numbered: ReadonlyArray<{ value: number; label: MObject; bare: MObject | null }>;
  /** 数字离轴线的距离:刻度半长 + 间距。 */
  private readonly numberOffset: number;

  constructor(range: readonly [number, number, number?], options?: NumberLineOptions) {
    super();
    const [min, max] = requireRange('NumberLine 的 range', range);
    const step = requirePositive('NumberLine 的步长', range[2] ?? 1);
    this.min = min;
    this.max = max;
    this.step = step;
    this.length = requirePositive('NumberLine 的 length', options?.length ?? 400);
    this.vertical = options?.vertical ?? false;
    const tickSize = requireNonNegative('NumberLine 的 tickSize', options?.tickSize ?? 10);
    const numberGap = requireNonNegative('NumberLine 的 numberGap', options?.numberGap ?? 6);
    const fontSize = requirePositive('NumberLine 的 fontSize', options?.fontSize ?? 18);
    const tips = options?.tips ?? 'none';
    if (tips !== 'none' && tips !== 'end' && tips !== 'both') {
      throw new Error(`NumberLine 的 tips 只能是 none / end / both,收到 ${String(tips)}`);
    }
    const showTicks = options?.ticks ?? true;
    const numbers = options?.numbers ?? true;
    const kind = options?.labelKind ?? 'tex';
    const format =
      options?.format ??
      (kind === 'label' ? (v: number): string => typographicMinus(formatTick(v)) : formatTick);

    const dir = this.direction();
    const side = this.numberSide();
    // 箭头画在区间外侧:最末的刻度与数字不被压住。
    const extra = TIP_LENGTH + 4;
    const lo = this.n2p(min);
    const hi = this.n2p(max);
    const before = tips === 'both' ? extra : 0;
    const after = tips === 'none' ? 0 : extra;
    this.line = new AxisLine(
      { x: lo.x - dir.x * before, y: lo.y - dir.y * before },
      { x: hi.x + dir.x * after, y: hi.y + dir.y * after },
      tips,
    );
    this.add(this.line);

    const needTicks = showTicks || numbers === true;
    this.ticksAt = needTicks ? marks('NumberLine', min, max, step) : [];
    if (showTicks && tickSize > 0 && this.ticksAt.length > 0) {
      const h = tickSize / 2;
      this.tickMarks = new TickMarks(
        this.ticksAt.map((v) => {
          const p = this.n2p(v);
          return [
            { x: p.x - side.x * h, y: p.y - side.y * h },
            { x: p.x + side.x * h, y: p.y + side.y * h },
          ] as const;
        }),
      );
      this.add(this.tickMarks);
    } else {
      this.tickMarks = null;
    }

    const exclude = options?.exclude ?? [];
    const labelled = (numbers === true ? this.ticksAt : numbers === false ? [] : numbers).filter(
      (v) => Number.isFinite(v) && !exclude.some((e) => sameMark(e, v, step)),
    );
    this.numberOffset = (showTicks ? tickSize / 2 : 0) + numberGap;
    this.numbered = labelled.map((value) => {
      const text = format(value);
      // 水平数轴上的负数:让数字本身(而不是连同负号)对准刻度,负号探到左边(与 Manim 一致)。
      const negative = !this.vertical && value < 0 && /^[-−]/.test(text);
      const bare = negative ? makeLabel(format(-value), kind, fontSize) : null;
      return { value, label: makeLabel(text, kind, fontSize), bare };
    });
    this.numberLabels = this.numbered.map((n) => n.label);
    this.placeNumbers();
    if (this.numberLabels.length > 0) {
      this.add(...this.numberLabels);
    }
  }

  /** 数字摆到刻度外侧;画布文字的宽度在字体加载后会变,onMeasurementsChanged 时重摆。 */
  private placeNumbers(): void {
    const side = this.numberSide();
    for (const { value, label, bare } of this.numbered) {
      const p = this.n2p(value);
      placeOutside(label, p, side, this.numberOffset);
      if (bare) {
        label.shift(-(label.getBox().size.w - bare.getBox().size.w) / 2, 0);
      }
    }
  }

  override onMeasurementsChanged(): void {
    super.onMeasurementsChanged();
    this.placeNumbers();
  }

  /** 数值增大的方向(单位向量)。 */
  private direction(): Point {
    return this.vertical ? { x: 0, y: -1 } : { x: 1, y: 0 };
  }

  /** 数字所在的一侧:水平数轴在下方,竖直数轴在左侧。 */
  private numberSide(): Point {
    return this.vertical ? { x: -1, y: 0 } : { x: 0, y: 1 };
  }

  /** 数值 → 本地坐标(数轴中点为原点;区间外的数照样按比例外推)。 */
  n2p(value: number): Point {
    const t = ((value - this.min) / (this.max - this.min) - 0.5) * this.length;
    const dir = this.direction();
    return { x: dir.x * t, y: dir.y * t };
  }

  /** 本地坐标 → 数值(先投影到数轴上)。 */
  p2n(point: Point): number {
    const dir = this.direction();
    const t = point.x * dir.x + point.y * dir.y;
    return this.min + (t / this.length + 0.5) * (this.max - this.min);
  }

  /** 每个刻度的数值(从小到大)。 */
  get tickValues(): readonly number[] {
    return this.ticksAt;
  }
}

export interface NumberPlaneOptions {
  /** 相邻两条主网格线之间再细分几份(画淡色的次网格线),默认 2;1 表示不画次网格线。 */
  minorDivisions?: number;
  /** 画两条坐标轴,默认 true。 */
  axes?: boolean;
  /** 坐标轴上标数字(原点除外),默认 false。 */
  numbers?: boolean;
  /** 数字排成 Tex(默认)还是画布文字 Label。 */
  labelKind?: LabelKind;
  /** 数字字号,默认 14。 */
  fontSize?: number;
  /** 坐标轴端头的箭头,默认 'none'。 */
  tips?: NumberLineTips;
  /** 主网格线颜色,默认淡蓝。 */
  gridColor?: string;
  /** 次网格线颜色,默认更淡的蓝。 */
  minorGridColor?: string;
}

/** 数学坐标 → 本地坐标的区间写法:[min, max] 或 [min, max, step](step 缺省 1)。 */
export type PlaneRange = readonly [number, number] | readonly [number, number, number];

/**
 * NumberPlane:坐标网格(组:次网格 minorGrid、主网格 majorGrid、两条坐标轴 xAxis / yAxis)。
 * 主网格线落在各自步长的整数倍上;坐标轴是 NumberLine(x 轴水平、y 轴竖直),
 * 零点不在区间里时贴到离零点较近的那条边上(与 Axes 一致)。
 * 本身就是一个坐标系(CoordinateSystem):c2p / p2c 是数学坐标与本地坐标的换算,
 * 可以直接交给 FunctionGraph、AreaUnderCurve、VectorField 等;把它们加进网格这个组里就跟着网格走。
 */
export class NumberPlane extends Group implements CoordinateSystem {
  readonly xRange: readonly [number, number];
  readonly yRange: readonly [number, number];
  readonly xStep: number;
  readonly yStep: number;
  readonly width: number;
  readonly height: number;
  readonly majorGrid: PathShape;
  readonly minorGrid: PathShape | null;
  readonly xAxis: NumberLine | null;
  readonly yAxis: NumberLine | null;

  constructor(
    xRange: PlaneRange,
    yRange: PlaneRange,
    width: number,
    height: number,
    options?: NumberPlaneOptions,
  ) {
    super();
    this.xRange = requireRange('NumberPlane 的 xRange', xRange);
    this.yRange = requireRange('NumberPlane 的 yRange', yRange);
    this.xStep = requirePositive('NumberPlane 的 x 步长', xRange[2] ?? 1);
    this.yStep = requirePositive('NumberPlane 的 y 步长', yRange[2] ?? 1);
    this.width = requirePositive('NumberPlane 的 width', width);
    this.height = requirePositive('NumberPlane 的 height', height);
    const divisions = requireFinite('NumberPlane 的 minorDivisions', options?.minorDivisions ?? 2);
    if (!Number.isInteger(divisions) || divisions < 1) {
      throw new Error(`NumberPlane 的 minorDivisions 需要不小于 1 的整数,收到 ${divisions}`);
    }
    const [xMin, xMax] = this.xRange;
    const [yMin, yMax] = this.yRange;
    const xs = marks('NumberPlane 的竖网格线', xMin, xMax, this.xStep);
    const ys = marks('NumberPlane 的横网格线', yMin, yMax, this.yStep);

    if (divisions > 1) {
      const minorX = marks('NumberPlane 的次网格线', xMin, xMax, this.xStep / divisions).filter(
        (v) => !xs.some((m) => sameMark(m, v, this.xStep)),
      );
      const minorY = marks('NumberPlane 的次网格线', yMin, yMax, this.yStep / divisions).filter(
        (v) => !ys.some((m) => sameMark(m, v, this.yStep)),
      );
      this.minorGrid = new GridLines(
        this.gridSegments(minorX, minorY),
        options?.minorGridColor ?? 'rgba(59, 130, 246, 0.14)',
      );
      this.add(this.minorGrid);
    } else {
      this.minorGrid = null;
    }
    this.majorGrid = new GridLines(
      this.gridSegments(xs, ys),
      options?.gridColor ?? 'rgba(59, 130, 246, 0.38)',
    );
    this.add(this.majorGrid);

    if (options?.axes ?? true) {
      const numbers = options?.numbers ?? false;
      const axisOptions: NumberLineOptions = {
        ticks: false,
        numbers,
        labelKind: options?.labelKind,
        fontSize: options?.fontSize ?? 14,
        tips: options?.tips,
      };
      const origin = this.axisOrigin();
      // 两条轴在原点相交时,原点的数字两条轴都会标,干脆都不标。
      const crossX = xMin <= 0 && 0 <= xMax;
      const crossY = yMin <= 0 && 0 <= yMax;
      this.xAxis = new NumberLine([xMin, xMax, this.xStep], {
        ...axisOptions,
        length: this.width,
        exclude: crossX && crossY ? [0] : [],
      });
      this.xAxis.moveTo({ x: 0, y: origin.y });
      this.yAxis = new NumberLine([yMin, yMax, this.yStep], {
        ...axisOptions,
        length: this.height,
        vertical: true,
        exclude: crossX && crossY ? [0] : [],
      });
      this.yAxis.moveTo({ x: origin.x, y: 0 });
      this.add(this.xAxis, this.yAxis);
    } else {
      this.xAxis = null;
      this.yAxis = null;
    }
  }

  /** 竖线自下而上、横线自左向右(生长的方向)。 */
  private gridSegments(
    xs: readonly number[],
    ys: readonly number[],
  ): Array<readonly [Point, Point]> {
    const w = this.width / 2;
    const h = this.height / 2;
    return [
      ...xs.map((x) => {
        const px = this.c2p(x, 0).x;
        return [{ x: px, y: h }, { x: px, y: -h }] as const;
      }),
      ...ys.map((y) => {
        const py = this.c2p(0, y).y;
        return [{ x: -w, y: py }, { x: w, y: py }] as const;
      }),
    ];
  }

  /** 两条轴的交点(本地坐标);零点不在区间里时贴到离它较近的边上。 */
  private axisOrigin(): Point {
    const [xMin, xMax] = this.xRange;
    const [yMin, yMax] = this.yRange;
    const w = this.width / 2;
    const h = this.height / 2;
    const zero = this.c2p(0, 0);
    return {
      x: xMin <= 0 && 0 <= xMax ? zero.x : xMax < 0 ? w : -w,
      y: yMin <= 0 && 0 <= yMax ? zero.y : yMax < 0 ? -h : h,
    };
  }

  /** 数学坐标 → 本地坐标(网格中心为原点,y 向上)。 */
  c2p(x: number, y: number): Point {
    return frameToLocal(this.xRange, this.yRange, this.width, this.height, x, y);
  }

  /** 本地坐标 → 数学坐标。 */
  p2c(point: Point): Point {
    return localToFrame(this.xRange, this.yRange, this.width, this.height, point);
  }

  /** CoordinateSystem:同 c2p。 */
  toLocal(x: number, y: number): Point {
    return this.c2p(x, y);
  }
}
