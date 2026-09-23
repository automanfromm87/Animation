import type { AnimationOptions } from '../animations/Animation';
import { BasePlayable } from '../animations/Animation';
import { formatTick } from './graphs';
import { Group } from './Group';
import type { MObject } from './MObject';
import type { LabelKind } from './labels';
import { makeLabel, placeOutside, requirePositive, typographicMinus } from './labels';
import { Bar } from './plots';
import { Label, Line } from './shapes';
import type { Point } from './types';
import { lerp } from './types';

/** 柱子的缺省配色(依次循环)。 */
const BAR_COLORS: readonly string[] = [
  '#3b82f6',
  '#22c55e',
  '#f59e0b',
  '#ef4444',
  '#8b5cf6',
  '#06b6d4',
  '#ec4899',
  '#84cc16',
];

export interface BarChartOptions {
  /** 图表的本地宽度,默认 300。 */
  width?: number;
  /** 数值范围对应的本地高度,默认 180。 */
  height?: number;
  /** 每根柱子下方的类别标签。 */
  labels?: readonly string[];
  /** 柱子颜色:一个颜色(全部相同)或一组颜色(依次循环),缺省用内置的八色。 */
  colors?: string | readonly string[];
  /** 数值范围 [min, max]:映射到图表的底边和顶边。缺省取 [min(0, 各值), max(0, 各值)]。 */
  range?: readonly [number, number];
  /** 柱宽占每格宽度的比例,默认 0.6。 */
  barRatio?: number;
  /** 类别标签排成画布文字 Label(默认)还是 Tex。 */
  labelKind?: LabelKind;
  /** 类别标签字号,默认 16。 */
  fontSize?: number;
  /** 在柱顶标出数值(画布文字,补间时逐帧更新):true 用缺省格式,或给一个格式函数。默认不标。 */
  showValues?: boolean | ((value: number) => string);
  /** 数值标签字号,默认 14。 */
  valueFontSize?: number;
}

/** 基线:比柱子的描边细一些(缺省样式,容器样式仍能覆盖)。 */
class Baseline extends Line {
  constructor(start: Point, end: Point) {
    super(start, end);
    this.setDefaultStyle({ strokeWidth: 1.5 });
  }
}

function requireValues(name: string, values: readonly number[]): number[] {
  if (values.length === 0) {
    throw new Error(`${name} 至少要有一个数值`);
  }
  values.forEach((v, i) => {
    if (!Number.isFinite(v)) {
      throw new Error(`${name} 第 ${i} 个数值不是有限数:${v}`);
    }
  });
  return [...values];
}

/**
 * BarChart:简单柱状图(组:基线 baseline、柱子 bars、类别标签 labels、数值标签 valueLabels)。
 * 以自身原点为中心,宽 width、高 height;数值范围 range 映射到底边与顶边,
 * 基线在数值 0 处(0 不在范围里就贴底边或顶边),负值的柱子朝下。
 * setValues 立即换数值,BarChartTo 把柱高补间过去(柱子个数不变,数值范围不变 —— 超出范围的柱子会伸出图表)。
 * 支持 Create(柱子从基线长出来、标签写出)、Write、Transform。
 */
export class BarChart extends Group {
  readonly width: number;
  readonly height: number;
  readonly range: readonly [number, number];
  readonly baseline: Line;
  readonly bars: readonly MObject[];
  readonly labels: readonly MObject[];
  readonly valueLabels: readonly Label[];
  private readonly barShapes: readonly Bar[];
  private readonly format: ((value: number) => string) | null;
  private readonly valueGap = 4;
  private current: number[];

  constructor(values: readonly number[], options?: BarChartOptions) {
    super();
    const data = requireValues('BarChart', values);
    this.width = requirePositive('BarChart 的 width', options?.width ?? 300);
    this.height = requirePositive('BarChart 的 height', options?.height ?? 180);
    const lo = options?.range?.[0] ?? Math.min(0, ...data);
    const hi = options?.range?.[1] ?? Math.max(0, ...data);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || !(hi >= lo)) {
      throw new Error(`BarChart 的 range 需要有限且 max ≥ min,收到 [${lo}, ${hi}]`);
    }
    // 全为 0 时范围退化,给一个单位高度,柱子都贴在基线上。
    this.range = hi > lo ? [lo, hi] : [lo, lo + 1];
    const ratio = options?.barRatio ?? 0.6;
    if (!(ratio > 0 && ratio <= 1)) {
      throw new Error(`BarChart 的 barRatio 需要在 (0, 1] 里,收到 ${ratio}`);
    }
    const colorOption = options?.colors ?? BAR_COLORS;
    const colors = typeof colorOption === 'string' ? [colorOption] : colorOption;
    if (colors.length === 0) {
      throw new Error('BarChart 的 colors 至少要有一个颜色');
    }
    const show = options?.showValues ?? false;
    this.format =
      show === false ? null : show === true ? (v) => typographicMinus(formatTick(v)) : show;
    this.current = data;

    const w = this.width;
    const h = this.height;
    const slot = w / data.length;
    // 基线在 0 处;0 不在范围里就贴到离它近的那条边。
    const base = this.valueToY(Math.min(this.range[1], Math.max(this.range[0], 0)));
    this.baseline = new Baseline({ x: -w / 2, y: base }, { x: w / 2, y: base });
    this.barShapes = data.map((v, i) => {
      const cx = -w / 2 + slot * (i + 0.5);
      const half = (slot * ratio) / 2;
      const fill = colors[i % colors.length] ?? '#000';
      return new Bar(cx - half, cx + half, base, this.valueToY(v), fill, 0);
    });
    this.bars = this.barShapes;
    this.add(...this.barShapes, this.baseline);

    const names = options?.labels ?? [];
    const kind = options?.labelKind ?? 'label';
    const fontSize = requirePositive('BarChart 的 fontSize', options?.fontSize ?? 16);
    this.labels = names.slice(0, data.length).map((text, i) => {
      const label = makeLabel(text, kind, fontSize);
      placeOutside(label, { x: -w / 2 + slot * (i + 0.5), y: h / 2 }, { x: 0, y: 1 }, 8);
      return label;
    });
    const valueFont = requirePositive('BarChart 的 valueFontSize', options?.valueFontSize ?? 14);
    this.valueLabels = this.format
      ? data.map(() => {
          const label = new Label('');
          label.setStyle({ fontSize: valueFont });
          return label;
        })
      : [];
    if (this.labels.length > 0) {
      this.add(...this.labels);
    }
    if (this.valueLabels.length > 0) {
      this.add(...this.valueLabels);
    }
    this.placeValues();
  }

  /** 当前数值(拷贝)。 */
  get values(): number[] {
    return [...this.current];
  }

  /** 数值 → 本地纵坐标(按 range 线性映射,范围外照样外推)。 */
  valueToY(value: number): number {
    const [lo, hi] = this.range;
    return this.height / 2 - ((value - lo) / (hi - lo)) * this.height;
  }

  /** 立即换数值(个数必须与柱子数相同)。 */
  setValues(values: readonly number[]): this {
    const data = requireValues('BarChart.setValues', values);
    if (data.length !== this.barShapes.length) {
      throw new Error(`BarChart.setValues 需要 ${this.barShapes.length} 个数值,收到 ${data.length}`);
    }
    this.current = data;
    this.barShapes.forEach((bar, i) => {
      bar.top = this.valueToY(data[i] ?? 0);
    });
    this.placeValues();
    return this;
  }

  /** 数值标签:正值在柱顶上方,负值在柱底下方。 */
  private placeValues(): void {
    if (!this.format) {
      return;
    }
    this.valueLabels.forEach((label, i) => {
      const bar = this.barShapes[i];
      const v = this.current[i] ?? 0;
      if (!bar || !this.format) {
        return;
      }
      label.setText(this.format(v));
      const up = bar.top <= bar.base;
      const anchor = { x: (bar.x0 + bar.x1) / 2, y: bar.top };
      placeOutside(label, anchor, { x: 0, y: up ? -1 : 1 }, this.valueGap);
    });
  }

  /** 字体加载后画布文字宽度变了:重新摆数值标签(类别标签按中心对齐,不受影响)。 */
  override onMeasurementsChanged(): void {
    super.onMeasurementsChanged();
    this.placeValues();
  }
}

/**
 * BarChartTo:把柱状图的柱高补间到新数值(个数必须与柱子数相同),数值标签逐帧跟着变。
 * 结束时 chart.values 精确等于目标。
 */
export class BarChartTo extends BasePlayable {
  private readonly chart: BarChart;
  private readonly target: readonly number[];
  private from: number[] = [];

  constructor(chart: BarChart, values: readonly number[], options?: AnimationOptions) {
    super(options);
    this.chart = chart;
    this.target = requireValues('BarChartTo', values);
    if (this.target.length !== chart.bars.length) {
      throw new Error(`BarChartTo 需要 ${chart.bars.length} 个数值,收到 ${this.target.length}`);
    }
  }

  override begin(): void {
    this.from = this.chart.values;
  }

  interpolate(alpha: number): void {
    this.chart.setValues(this.target.map((v, i) => lerp(this.from[i] ?? v, v, alpha)));
  }
}
