import type { AnimationOptions } from '../animations/Animation';
import { BasePlayable } from '../animations/Animation';
import { lerpColor } from '../color';
import type { PathData } from '../path/path';
import { EMPTY_PATH, PathBuilder, polylinePath } from '../path/path';
import type { CoordinateSystem, RealFunction } from './graphs';
import { Group } from './Group';
import { requireFinite, requirePositive } from './labels';
import { PathShape, requireNonNegative } from './shapes';
import type { Box, Point } from './types';
import { boxFromPoints, lerp } from './types';

/** 曲线下面积的缺省填充色(半透明蓝)。 */
const AREA_FILL = 'rgba(59, 130, 246, 0.35)';
/** 黎曼矩形的缺省渐变(左蓝右绿,半透明)。 */
const RIEMANN_COLORS: readonly string[] = ['rgba(59, 130, 246, 0.55)', 'rgba(34, 197, 94, 0.55)'];

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** 取样区间:两端有限、b > a,再截到坐标系的横轴范围里(截完可能为空)。 */
function sampleInterval(
  name: string,
  coords: CoordinateSystem,
  range: readonly [number, number],
): [number, number] {
  const a = requireFinite(`${name} 的区间起点`, range[0]);
  const b = requireFinite(`${name} 的区间终点`, range[1]);
  if (!(b > a)) {
    throw new Error(`${name} 的区间需要 b > a,收到 [${a}, ${b}]`);
  }
  const [xMin, xMax] = coords.xRange;
  return [clamp(a, xMin, xMax), clamp(b, xMin, xMax)];
}

/**
 * 按多个色标插值的渐变色(OKLab):t ∈ [0, 1]。只有一个颜色时就是它。
 */
export function gradientColor(colors: readonly string[], t: number): string {
  const n = colors.length;
  if (n === 0) {
    return '#000';
  }
  if (n === 1 || !(t > 0)) {
    return colors[0] ?? '#000';
  }
  if (t >= 1) {
    return colors[n - 1] ?? '#000';
  }
  const x = t * (n - 1);
  const i = Math.floor(x);
  return lerpColor(colors[i] ?? '#000', colors[i + 1] ?? '#000', x - i) ?? colors[i] ?? '#000';
}

/**
 * 数值导数(中心差分,一侧无定义时退成单侧差分),都无定义返回 NaN。
 * 步长取 1e-5:按函数自身的尺度(而不是 |x|)取,sin(1000x)、大 x 处的 sin 都不会被步长抹平;
 * |x| 大到 1e6 以上才随之放大,免得 x ± h 在浮点里就等于 x。分母用实际算出来的 x+h 与 x-h 之差。
 */
export function numericDerivative(fn: RealFunction, x: number): number {
  const h = Math.max(1e-5, Math.abs(x) * 1e-11);
  const xp = x + h;
  const xm = x - h;
  const fp = fn(xp);
  const fm = fn(xm);
  if (Number.isFinite(fp) && Number.isFinite(fm)) {
    return (fp - fm) / (xp - xm);
  }
  const f0 = fn(x);
  if (Number.isFinite(fp) && Number.isFinite(f0)) {
    return (fp - f0) / (xp - x);
  }
  if (Number.isFinite(fm) && Number.isFinite(f0)) {
    return (f0 - fm) / (x - xm);
  }
  return NaN;
}

export interface AreaUnderCurveOptions {
  /** 下边界函数,缺省为 x 轴(y = 0);给了就是两条曲线之间的区域。 */
  bottom?: RealFunction;
  /** 区间分成多少段取样,默认 128。 */
  samples?: number;
}

/**
 * AreaUnderCurve:曲线 y = fn(x) 与 x 轴(或下边界曲线 bottom)在 [a, b] 上围成的区域。
 * 按坐标系取样,得到的是坐标系的本地坐标:和坐标系放进同一个组(或加进 NumberPlane)。
 * 区间截到横轴范围,函数值截到纵轴范围(不会画出框外);无定义处(NaN)贴着下边界。
 * 曲线穿过 x 轴时,轴上、轴下两块都填(负面积在轴下)。
 * 缺省样式:半透明蓝色填充、不描边。Create 时从左往右扫出来。
 */
export class AreaUnderCurve extends PathShape {
  /** 实际取样的区间(已截到坐标系的横轴范围)。 */
  readonly interval: readonly [number, number];
  private readonly tops: readonly Point[];
  private readonly bottoms: readonly Point[];

  constructor(
    coords: CoordinateSystem,
    fn: RealFunction,
    range: readonly [number, number],
    options?: AreaUnderCurveOptions,
  ) {
    super();
    this.setDefaultStyle({ fill: AREA_FILL, strokeWidth: 0 });
    const [a, b] = sampleInterval('AreaUnderCurve', coords, range);
    this.interval = [a, b];
    const samples = Math.floor(
      requirePositive('AreaUnderCurve 的 samples', options?.samples ?? 128),
    );
    const [yMin, yMax] = coords.yRange;
    const lower = options?.bottom;
    const tops: Point[] = [];
    const bottoms: Point[] = [];
    if (b > a) {
      for (let i = 0; i <= samples; i++) {
        const x = lerp(a, b, i / samples);
        const rawBottom = lower ? lower(x) : 0;
        const yb = clamp(Number.isFinite(rawBottom) ? rawBottom : 0, yMin, yMax);
        const rawTop = fn(x);
        const yt = Number.isFinite(rawTop) ? clamp(rawTop, yMin, yMax) : yb;
        tops.push(coords.toLocal(x, yt));
        bottoms.push(coords.toLocal(x, yb));
      }
    }
    this.tops = tops;
    this.bottoms = bottoms;
  }

  /** 取样点只读:路径只建一次。 */
  protected override pathKey(): string {
    return '';
  }

  protected override buildPath(): PathData {
    return this.region(this.tops.length - 1);
  }

  /** 从左往右扫:只围到区间的前 f。 */
  protected override revealPath(f: number): PathData {
    return this.region((this.tops.length - 1) * f);
  }

  /** 围到第 upto 个取样点(可以是小数,末端线性插值)为止的区域。 */
  private region(upto: number): PathData {
    const last = this.tops.length - 1;
    if (last < 1 || !(upto > 0)) {
      return EMPTY_PATH;
    }
    const end = Math.min(upto, last);
    const k = Math.floor(end);
    const frac = end - k;
    const top = this.tops.slice(0, k + 1);
    const bottom = this.bottoms.slice(0, k + 1);
    if (frac > 0) {
      const t0 = this.tops[k];
      const t1 = this.tops[k + 1];
      const b0 = this.bottoms[k];
      const b1 = this.bottoms[k + 1];
      if (t0 && t1 && b0 && b1) {
        top.push({ x: lerp(t0.x, t1.x, frac), y: lerp(t0.y, t1.y, frac) });
        bottom.push({ x: lerp(b0.x, b1.x, frac), y: lerp(b0.y, b1.y, frac) });
      }
    }
    return polylinePath([...top, ...bottom.reverse()], true);
  }

  override getBox(): Box {
    return boxFromPoints([...this.tops, ...this.bottoms]);
  }
}

/** 黎曼和的取样点:每个小区间的左端、右端或中点。 */
export type RiemannSample = 'left' | 'right' | 'mid';

/**
 * 一根黎曼矩形 / 柱状图的柱子:本地坐标里从 base 竖到 top 的矩形。Create 时从底边往上长。
 * @internal 标注图元内部共用,不在引擎总出口里。
 */
export class Bar extends PathShape {
  x0: number;
  x1: number;
  base: number;
  top: number;

  constructor(x0: number, x1: number, base: number, top: number, fill: string, strokeWidth = 1) {
    super();
    this.x0 = x0;
    this.x1 = x1;
    this.base = base;
    this.top = top;
    this.setDefaultStyle({ fill, strokeWidth });
  }

  /** 缺省填充色(容器与自身 setStyle 仍然优先)。 */
  setFill(fill: string): void {
    this.setDefaultStyle({ fill });
  }

  get fillColor(): string | null | undefined {
    return this.defaultStyle.fill;
  }

  protected override pathKey(): string {
    return `${this.x0},${this.x1},${this.base},${this.top}`;
  }

  protected override buildPath(): PathData {
    return this.rect(this.top);
  }

  protected override revealPath(f: number): PathData {
    return this.rect(lerp(this.base, this.top, f));
  }

  /** 上下两条边都画(高度为 0 时退化成一条线,描边照样看得见底边)。 */
  private rect(top: number): PathData {
    const { x0, x1, base } = this;
    if (![x0, x1, base, top].every(Number.isFinite) || !(x1 > x0)) {
      return EMPTY_PATH;
    }
    return new PathBuilder()
      .moveTo(x0, base)
      .lineTo(x0, top)
      .lineTo(x1, top)
      .lineTo(x1, base)
      .close()
      .build();
  }

  override getBox(): Box {
    return boxFromPoints([
      { x: this.x0, y: this.base },
      { x: this.x1, y: this.top },
    ]);
  }

  override getCullRadius(): number {
    return Math.max(
      Math.hypot(this.x0, this.base),
      Math.hypot(this.x1, this.base),
      Math.hypot(this.x0, this.top),
      Math.hypot(this.x1, this.top),
    );
  }
}

export interface RiemannRectanglesOptions {
  /** 矩形个数,默认 8。 */
  n?: number;
  /** 取样点,默认 'left'。 */
  sample?: RiemannSample;
  /** 填充色:一个颜色,或从左到右渐变的一组色标(OKLab 插值)。缺省半透明的蓝 → 绿。 */
  colors?: string | readonly string[];
}

/** 一个矩形的几何(本地坐标)、有向高度(数学单位)与填充色。 */
interface RiemannBar {
  readonly x0: number;
  readonly x1: number;
  readonly top: number;
  readonly value: number;
  readonly fill: string;
}

/** 一组矩形的几何与数值(RiemannRectangles 与 RiemannTo 共用)。 */
interface RiemannLayout {
  readonly bars: readonly RiemannBar[];
  readonly base: number;
}

/**
 * RiemannRectangles:黎曼和的矩形(组,每个矩形一个子元素)。[a, b] 等分 n 份,
 * 第 i 个矩形高 fn(取样点),负值画在轴下;高度截到纵轴范围,无定义的取样点高度为 0。
 * 按坐标系取样,与 AreaUnderCurve 一样放进坐标系所在的组。
 * 缺省:半透明蓝 → 绿渐变填充、1 像素描边。Create 时所有矩形从轴上同时长出来;
 * RiemannTo 把它补间到新的 n / 取样方式(细分时每个矩形先劈开、再各自长到新高度)。
 */
export class RiemannRectangles extends Group {
  readonly coords: CoordinateSystem;
  readonly fn: RealFunction;
  /** 实际取样的区间(已截到坐标系的横轴范围)。 */
  readonly interval: readonly [number, number];
  private readonly colors: readonly string[];
  private bars: Bar[] = [];
  private nValue: number;
  private sampleValue: RiemannSample;
  private values: number[] = [];

  constructor(
    coords: CoordinateSystem,
    fn: RealFunction,
    range: readonly [number, number],
    options?: RiemannRectanglesOptions,
  ) {
    super();
    this.coords = coords;
    this.fn = fn;
    this.interval = sampleInterval('RiemannRectangles', coords, range);
    const colors = options?.colors ?? RIEMANN_COLORS;
    this.colors = typeof colors === 'string' ? [colors] : [...colors];
    if (this.colors.length === 0) {
      throw new Error('RiemannRectangles 的 colors 至少要有一个颜色');
    }
    this.nValue = requireCount(options?.n ?? 8);
    this.sampleValue = requireSample(options?.sample ?? 'left');
    this.rebuild(this.layout(this.nValue, this.sampleValue));
  }

  /** 矩形个数。 */
  get n(): number {
    return this.nValue;
  }

  get sample(): RiemannSample {
    return this.sampleValue;
  }

  /** 每个小区间的宽度(数学单位)。 */
  get dx(): number {
    return (this.interval[1] - this.interval[0]) / this.nValue;
  }

  /** 各矩形的有向高度 fn(取样点)(数学单位,未截断;无定义为 0)。 */
  get heights(): readonly number[] {
    return this.values;
  }

  /** 黎曼和 Σ fn(取样点)·dx。 */
  get sum(): number {
    const dx = this.dx;
    return this.values.reduce((acc, v) => acc + v * dx, 0);
  }

  /** 当前的矩形(从左到右)。换 n 之后是新的一组对象。 */
  get rectangles(): readonly PathShape[] {
    return this.bars;
  }

  /** 立即换成新的 n / 取样方式(要动画用 RiemannTo)。 */
  set(options: { n?: number; sample?: RiemannSample }): this {
    this.nValue = requireCount(options.n ?? this.nValue);
    this.sampleValue = requireSample(options.sample ?? this.sampleValue);
    this.rebuild(this.layout(this.nValue, this.sampleValue));
    return this;
  }

  /** @internal RiemannTo 用:算出某个 n / 取样方式下的矩形。 */
  layout(n: number, sample: RiemannSample): RiemannLayout {
    const { coords, fn } = this;
    const [a, b] = this.interval;
    const [yMin, yMax] = coords.yRange;
    const base = coords.toLocal(a, clamp(0, yMin, yMax)).y;
    const offset = sample === 'left' ? 0 : sample === 'right' ? 1 : 0.5;
    const bars: RiemannBar[] = [];
    for (let i = 0; i < n; i++) {
      const xa = lerp(a, b, i / n);
      const xb = lerp(a, b, (i + 1) / n);
      const raw = fn(lerp(xa, xb, offset));
      const value = Number.isFinite(raw) ? raw : 0;
      bars.push({
        x0: coords.toLocal(xa, 0).x,
        x1: coords.toLocal(xb, 0).x,
        top: coords.toLocal(xa, clamp(value, yMin, yMax)).y,
        value,
        fill: gradientColor(this.colors, n > 1 ? i / (n - 1) : 0),
      });
    }
    return { bars, base };
  }

  /**
   * @internal RiemannTo 用:换上一组新的矩形对象(几何按 layout 的终态),返回它们。
   * 旧矩形从组里移除。
   */
  rebuild(layout: RiemannLayout): Bar[] {
    this.remove(...this.bars);
    this.bars = layout.bars.map((b) => new Bar(b.x0, b.x1, layout.base, b.top, b.fill));
    this.values = layout.bars.map((b) => b.value);
    this.add(...this.bars);
    return this.bars;
  }

  /** @internal RiemannTo 用:登记补间的终态数值。 */
  commit(n: number, sample: RiemannSample): void {
    this.nValue = n;
    this.sampleValue = sample;
  }
}

function requireCount(n: number): number {
  if (!Number.isInteger(n) || n < 1 || n > 10000) {
    throw new Error(`RiemannRectangles 的 n 需要 1..10000 的整数,收到 ${n}`);
  }
  return n;
}

function requireSample(sample: RiemannSample): RiemannSample {
  if (sample !== 'left' && sample !== 'right' && sample !== 'mid') {
    throw new Error(`RiemannRectangles 的 sample 只能是 left / right / mid,收到 ${String(sample)}`);
  }
  return sample;
}

export interface RiemannToTarget {
  n?: number;
  sample?: RiemannSample;
}

/**
 * RiemannTo:把黎曼矩形补间到新的 n / 取样方式。
 * 开始时换上新的一组矩形:每个新矩形先取「覆盖它中点的旧矩形」的高度与颜色 ——
 * 细分(n 变大)时就是旧矩形原地劈开,看不出跳变;然后高度、颜色一起补间到新值。
 * 结束时 rects.n / sample / heights / sum 都是新值。
 */
export class RiemannTo extends BasePlayable {
  private readonly rects: RiemannRectangles;
  private readonly n: number | undefined;
  private readonly sampleMode: RiemannSample | undefined;
  private tweens: Array<{
    bar: Bar;
    from: number;
    to: number;
    fromFill: string;
    toFill: string;
  }> = [];

  constructor(rects: RiemannRectangles, target: RiemannToTarget, options?: AnimationOptions) {
    super(options);
    this.rects = rects;
    this.n = target.n === undefined ? undefined : requireCount(target.n);
    this.sampleMode = target.sample === undefined ? undefined : requireSample(target.sample);
  }

  override begin(): void {
    const rects = this.rects;
    const oldBars = rects.rectangles as readonly Bar[];
    const old = oldBars.map((bar) => ({
      x0: bar.x0,
      x1: bar.x1,
      top: bar.top,
      fill: bar.fillColor ?? '#000',
    }));
    const n = this.n ?? rects.n;
    const sample = this.sampleMode ?? rects.sample;
    const layout = rects.layout(n, sample);
    const bars = rects.rebuild(layout);
    rects.commit(n, sample);
    this.tweens = bars.map((bar, i) => {
      const mid = (bar.x0 + bar.x1) / 2;
      const src =
        old.find((o) => mid >= Math.min(o.x0, o.x1) && mid <= Math.max(o.x0, o.x1)) ?? null;
      const target = layout.bars[i];
      return {
        bar,
        from: src ? src.top : layout.base,
        to: bar.top,
        fromFill: src ? src.fill : (target?.fill ?? '#000'),
        toFill: target?.fill ?? '#000',
      };
    });
    this.interpolate(0);
  }

  interpolate(alpha: number): void {
    for (const t of this.tweens) {
      t.bar.top = lerp(t.from, t.to, alpha);
      t.bar.setFill(lerpColor(t.fromFill, t.toFill, alpha) ?? t.toFill);
    }
  }
}

export interface TangentLineOptions {
  /** 切线的本地长度(切点在正中),默认 160。 */
  length?: number;
}

/**
 * TangentLine:函数图像在 x 处的切线(数值求导),以切点为中点、给定本地长度的线段。
 * 按坐标系的本地坐标画(横纵比例不同也对)。setX 换切点 —— 配合 ValueTracker 与 updater
 * 让切线沿曲线滑动:scene.addUpdater(() => tangent.setX(t.getValue()))。
 * 函数在 x 处无定义或导数不存在时什么都不画。
 */
export class TangentLine extends PathShape {
  readonly coords: CoordinateSystem;
  readonly fn: RealFunction;
  length: number;
  private xValue: number;

  constructor(coords: CoordinateSystem, fn: RealFunction, x: number, options?: TangentLineOptions) {
    super();
    this.coords = coords;
    this.fn = fn;
    this.xValue = requireFinite('TangentLine 的 x', x);
    this.length = requireNonNegative('TangentLine 的 length', options?.length ?? 160);
  }

  /** 切点的横坐标(数学单位)。 */
  get x(): number {
    return this.xValue;
  }

  /** 换切点。 */
  setX(x: number): this {
    this.xValue = requireFinite('TangentLine 的 x', x);
    return this;
  }

  /** 数学坐标里的斜率 f'(x);无定义为 NaN。 */
  get slope(): number {
    return numericDerivative(this.fn, this.xValue);
  }

  /** 切点(本地坐标);函数在这里无定义时为 null。 */
  get point(): Point | null {
    const y = this.fn(this.xValue);
    return Number.isFinite(y) ? this.coords.toLocal(this.xValue, y) : null;
  }

  protected override get fillable(): boolean {
    return false;
  }

  protected override pathKey(): string {
    return `${this.xValue}|${this.length}`;
  }

  protected override buildPath(): PathData {
    const x = this.xValue;
    const y = this.fn(x);
    const k = this.slope;
    const half = this.length / 2;
    if (!Number.isFinite(y) || !Number.isFinite(k) || !(half > 0)) {
      return EMPTY_PATH;
    }
    const p = this.coords.toLocal(x, y);
    const q = this.coords.toLocal(x + 1, y + k);
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (!(len > 0) || !Number.isFinite(len)) {
      return EMPTY_PATH;
    }
    const ux = ((q.x - p.x) / len) * half;
    const uy = ((q.y - p.y) / len) * half;
    return new PathBuilder().moveTo(p.x - ux, p.y - uy).lineTo(p.x + ux, p.y + uy).build();
  }
}

export interface SecantLineOptions {
  /** 两端各向外延长的本地长度,默认 0(正好连接两个取样点)。 */
  extend?: number;
}

/**
 * SecantLine:过曲线上 (x1, f(x1))、(x2, f(x2)) 两点的割线段,可以两端各延长一截。
 * setX(x1, x2) 换两个取样点 —— x2 逐渐靠近 x1 就是「割线逼近切线」。
 * 两点重合或函数无定义时什么都不画。
 */
export class SecantLine extends PathShape {
  readonly coords: CoordinateSystem;
  readonly fn: RealFunction;
  extend: number;
  private x1Value: number;
  private x2Value: number;

  constructor(
    coords: CoordinateSystem,
    fn: RealFunction,
    x1: number,
    x2: number,
    options?: SecantLineOptions,
  ) {
    super();
    this.coords = coords;
    this.fn = fn;
    this.x1Value = requireFinite('SecantLine 的 x1', x1);
    this.x2Value = requireFinite('SecantLine 的 x2', x2);
    this.extend = requireNonNegative('SecantLine 的 extend', options?.extend ?? 0);
  }

  get x1(): number {
    return this.x1Value;
  }

  get x2(): number {
    return this.x2Value;
  }

  /** 换两个取样点。 */
  setX(x1: number, x2: number): this {
    this.x1Value = requireFinite('SecantLine 的 x1', x1);
    this.x2Value = requireFinite('SecantLine 的 x2', x2);
    return this;
  }

  /** 数学坐标里的斜率 (f(x2) - f(x1)) / (x2 - x1);两点重合或无定义为 NaN。 */
  get slope(): number {
    const { x1Value: a, x2Value: b } = this;
    const k = (this.fn(b) - this.fn(a)) / (b - a);
    return Number.isFinite(k) ? k : NaN;
  }

  /** 两个取样点(本地坐标);有一个无定义时为 null。 */
  get points(): [Point, Point] | null {
    const ya = this.fn(this.x1Value);
    const yb = this.fn(this.x2Value);
    if (!Number.isFinite(ya) || !Number.isFinite(yb)) {
      return null;
    }
    return [this.coords.toLocal(this.x1Value, ya), this.coords.toLocal(this.x2Value, yb)];
  }

  protected override get fillable(): boolean {
    return false;
  }

  protected override pathKey(): string {
    return `${this.x1Value}|${this.x2Value}|${this.extend}`;
  }

  protected override buildPath(): PathData {
    const pts = this.points;
    if (!pts) {
      return EMPTY_PATH;
    }
    const [p, q] = pts;
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (!(len > 0)) {
      return EMPTY_PATH;
    }
    const e = Number.isFinite(this.extend) && this.extend > 0 ? this.extend : 0;
    const ux = ((q.x - p.x) / len) * e;
    const uy = ((q.y - p.y) / len) * e;
    return new PathBuilder().moveTo(p.x - ux, p.y - uy).lineTo(q.x + ux, q.y + uy).build();
  }
}
