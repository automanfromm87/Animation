import { lerpColor } from '../color';
import type { PathLayer } from '../path/draw';
import { drawPath } from '../path/draw';
import type { PathData } from '../path/path';
import { PathBuilder, concatPaths, pathBounds } from '../path/path';
import type { ResolvedStyle } from '../theme/Theme';
import type { CoordinateSystem } from './graphs';
import { niceStep } from './graphs';
import { requirePositive } from './labels';
import { MObject } from './MObject';
import type { Box, Point } from './types';
import { boxFromSize } from './types';

/** 向量函数:数学坐标 (x, y) 处的向量 [vx, vy](数学单位,y 向上)。 */
export type VectorFunction = (x: number, y: number) => readonly [number, number];

/** 取样点总数上限:超过就是步长写错了。 */
const MAX_ARROWS = 10000;
/** 按模长着色时量化成多少档颜色(每档一次描边、一次填充)。 */
const COLOR_BUCKETS = 16;

export interface VectorFieldOptions {
  /**
   * 取样的横轴区间 [min, max, step]:从 min 起每隔 step 取一列(max 落在步长上时也取到)。
   * 缺省为坐标系的横轴范围,step 缺省自动取整(约 12 列)。
   */
  xRange?: readonly [number, number, number?];
  /** 取样的纵轴区间,同上(step 缺省与横轴的相同)。 */
  yRange?: readonly [number, number, number?];
  /** 最长箭头的本地长度,缺省为本地取样间距(取横纵较小者)的 0.85 倍。 */
  maxLength?: number;
  /** 所有箭头一样长(只用颜色区分大小),默认 false:长度与模长成正比,最大模长对应 maxLength。 */
  uniform?: boolean;
  /** 按模长着色:[最小, 最大] 两个颜色(OKLab 插值)。缺省不着色,用描边色。 */
  colors?: readonly [string, string];
  /** 箭头以取样点为中点('middle',默认)还是尾巴在取样点('tail')。 */
  pivot?: 'middle' | 'tail';
}

/** 取样区间:两端有限、max ≥ min(相等时只取一行 / 一列)。 */
function sampleRange(name: string, range: readonly [number, number, number?]): [number, number] {
  const [min, max] = range;
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(max >= min)) {
    throw new Error(`VectorField 的 ${name} 需要有限且 max ≥ min 的区间,收到 [${min}, ${max}]`);
  }
  return [min, max];
}

/**
 * 从 min 起每隔 step 取一个,不超过 max(两端各放宽 1e-9 个步长)。个数超过上限返回 null。
 * 从起点数而不是取步长的整数倍:[0.5, 3.5, 1] 这样的区间就能取到格子中心。
 */
function stepsFrom(min: number, max: number, step: number): number[] | null {
  const count = Math.floor((max - min) / step + 1e-9);
  if (!(count >= 0)) {
    return [];
  }
  if (count + 1 > MAX_ARROWS) {
    return null;
  }
  return Array.from({ length: count + 1 }, (_, i) => min + i * step);
}

/** 一个箭头:本地坐标的尾巴、单位方向、模长。 */
interface Sample {
  readonly x: number;
  readonly y: number;
  readonly ux: number;
  readonly uy: number;
  readonly magnitude: number;
}

/** 一档颜色的全部箭头:杆(描边)与头(填充)。color 为 null 表示用描边色。 */
interface Bucket {
  readonly color: string | null;
  readonly shafts: PathData;
  readonly heads: PathData;
}

/**
 * VectorField:向量场 —— 在网格点上画一片小箭头(按坐标系取样,放进坐标系所在的组)。
 * 长度按最大模长归一(uniform 时等长),可按模长着色。几何建一次就缓存:
 * 同色的箭头合成一条杆路径、一条头路径,每帧每档颜色只描一次、填一次,几百上千个箭头也不卡。
 * 场随时间变化时调 setFunction 重新取样(不要每帧新建对象)。
 * 支持 Create(所有箭头同时从零长出来)、Write、Transform(按颜色档分层变形)。
 */
export class VectorField extends MObject {
  readonly coords: CoordinateSystem;
  private fn: VectorFunction;
  private readonly points: readonly Point[];
  private readonly maxLength: number;
  private readonly uniform: boolean;
  private readonly colors: readonly [string, string] | null;
  private readonly pivot: 'middle' | 'tail';
  private samples: Sample[] = [];
  private maxMag = 0;
  private buckets: Bucket[] = [];
  private box: Box = boxFromSize(0, 0);
  private cullRadius = 0;

  constructor(coords: CoordinateSystem, fn: VectorFunction, options?: VectorFieldOptions) {
    super();
    this.setDefaultStyle({ strokeWidth: 1.5 });
    this.coords = coords;
    this.fn = fn;
    const [xMin, xMax] = options?.xRange ? sampleRange('xRange', options.xRange) : coords.xRange;
    const [yMin, yMax] = options?.yRange ? sampleRange('yRange', options.yRange) : coords.yRange;
    const autoStep = niceStep(Math.max(xMax - xMin, yMax - yMin) / 12);
    const xStep = requirePositive('VectorField 的 x 步长', options?.xRange?.[2] ?? autoStep);
    const yStep = requirePositive('VectorField 的 y 步长', options?.yRange?.[2] ?? xStep);
    const xs = stepsFrom(xMin, xMax, xStep);
    const ys = stepsFrom(yMin, yMax, yStep);
    if (!xs || !ys || xs.length * ys.length > MAX_ARROWS) {
      throw new Error(`VectorField 要画 ${MAX_ARROWS} 个以上箭头,步长是不是写错了`);
    }
    const points: Point[] = [];
    for (const y of ys) {
      for (const x of xs) {
        points.push({ x, y });
      }
    }
    this.points = points;
    // 本地取样间距:相邻两列 / 两行在坐标系里隔多远。
    const o = coords.toLocal(xMin, yMin);
    const gx = coords.toLocal(xMin + xStep, yMin);
    const gy = coords.toLocal(xMin, yMin + yStep);
    const spacing = Math.min(
      Math.hypot(gx.x - o.x, gx.y - o.y),
      Math.hypot(gy.x - o.x, gy.y - o.y),
    );
    this.maxLength = requirePositive(
      'VectorField 的 maxLength',
      options?.maxLength ?? spacing * 0.85,
    );
    this.uniform = options?.uniform ?? false;
    this.colors = options?.colors ?? null;
    this.pivot = options?.pivot ?? 'middle';
    if (this.pivot !== 'middle' && this.pivot !== 'tail') {
      throw new Error(`VectorField 的 pivot 只能是 middle / tail,收到 ${String(this.pivot)}`);
    }
    this.resample();
  }

  /** 箭头个数(无定义、零向量不算)。 */
  get count(): number {
    return this.samples.filter((s) => s.magnitude > 0).length;
  }

  /** 取样到的最大模长(数学单位)。 */
  get maxMagnitude(): number {
    return this.maxMag;
  }

  /** 换向量函数并重新取样(几何重建一次)。 */
  setFunction(fn: VectorFunction): this {
    this.fn = fn;
    this.resample();
    return this;
  }

  /** 每个取样点的箭头:本地坐标的尾巴、终点(按当前长度规则算好)。测试与自定义绘制用。 */
  arrows(): Array<{ tail: Point; tip: Point; magnitude: number }> {
    return this.samples
      .filter((s) => s.magnitude > 0)
      .map((s) => {
        const len = this.lengthOf(s);
        const tail = this.tailOf(s, len);
        const tip = { x: tail.x + s.ux * len, y: tail.y + s.uy * len };
        return { tail, tip, magnitude: s.magnitude };
      });
  }

  private resample(): void {
    const { coords } = this;
    const samples: Sample[] = [];
    let max = 0;
    for (const p of this.points) {
      const v = this.fn(p.x, p.y);
      const vx = v[0];
      const vy = v[1];
      if (!Number.isFinite(vx) || !Number.isFinite(vy)) {
        continue;
      }
      const magnitude = Math.hypot(vx, vy);
      const local = coords.toLocal(p.x, p.y);
      // 方向按坐标系换算(横纵比例不同时箭头方向也跟图一致)。
      const ahead = coords.toLocal(p.x + vx, p.y + vy);
      const dx = ahead.x - local.x;
      const dy = ahead.y - local.y;
      const d = Math.hypot(dx, dy);
      if (!(magnitude > 0) || !(d > 0) || !Number.isFinite(d)) {
        samples.push({ x: local.x, y: local.y, ux: 0, uy: 0, magnitude: 0 });
        continue;
      }
      max = Math.max(max, magnitude);
      samples.push({ x: local.x, y: local.y, ux: dx / d, uy: dy / d, magnitude });
    }
    this.samples = samples;
    this.maxMag = max;
    this.buckets = this.buildBuckets(1);
    this.measure();
  }

  private lengthOf(s: Sample): number {
    if (!(s.magnitude > 0) || !(this.maxMag > 0)) {
      return 0;
    }
    return this.uniform ? this.maxLength : this.maxLength * (s.magnitude / this.maxMag);
  }

  private tailOf(s: Sample, len: number): Point {
    return this.pivot === 'tail'
      ? { x: s.x, y: s.y }
      : { x: s.x - (s.ux * len) / 2, y: s.y - (s.uy * len) / 2 };
  }

  /** 按颜色档分好的杆与头。scale 是生长比例(1 为完整)。 */
  private buildBuckets(scale: number): Bucket[] {
    const count = this.colors ? COLOR_BUCKETS : 1;
    const shafts = Array.from({ length: count }, () => new PathBuilder());
    const heads = Array.from({ length: count }, () => new PathBuilder());
    const headCap = this.maxLength * 0.35;
    for (const s of this.samples) {
      const full = this.lengthOf(s);
      const len = full * scale;
      if (!(len > 1e-6)) {
        continue;
      }
      const k =
        this.colors && this.maxMag > 0 ? Math.round((s.magnitude / this.maxMag) * (count - 1)) : 0;
      const tail = this.tailOf(s, full);
      const tipX = tail.x + s.ux * len;
      const tipY = tail.y + s.uy * len;
      const head = Math.min(len * 0.4, headCap);
      const half = head * 0.45;
      const bx = tipX - s.ux * head;
      const by = tipY - s.uy * head;
      shafts[k]?.moveTo(tail.x, tail.y).lineTo(bx, by);
      heads[k]
        ?.moveTo(tipX, tipY)
        .lineTo(bx - s.uy * half, by + s.ux * half)
        .lineTo(bx + s.uy * half, by - s.ux * half)
        .close();
    }
    const [low, high] = this.colors ?? [null, null];
    return shafts.map((b, i) => ({
      color:
        low !== null && high !== null
          ? lerpColor(low, high, count > 1 ? i / (count - 1) : 0)
          : null,
      shafts: b.build(),
      heads: heads[i]?.build() ?? { subpaths: [] },
    }));
  }

  private measure(): void {
    const b = pathBounds(concatPaths(this.buckets.flatMap((k) => [k.shafts, k.heads])));
    if (!b) {
      this.box = boxFromSize(0, 0);
      this.cullRadius = 0;
      return;
    }
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

  override get supportsReveal(): boolean {
    return true;
  }

  override toPath(): PathData {
    return concatPaths(this.buckets.flatMap((k) => [k.shafts, k.heads]));
  }

  override pathLayers(style: ResolvedStyle): PathLayer[] {
    return this.layersOf(this.buckets, style);
  }

  private layersOf(buckets: readonly Bucket[], style: ResolvedStyle): PathLayer[] {
    const layers: PathLayer[] = [];
    for (const k of buckets) {
      const color = k.color ?? style.stroke;
      const shaft = { fill: null, stroke: color, strokeWidth: style.strokeWidth, dash: style.dash };
      layers.push(
        { path: k.shafts, paint: shaft },
        { path: k.heads, paint: { fill: color, stroke: null, strokeWidth: 0 } },
      );
    }
    return layers;
  }

  protected override drawShape(ctx: CanvasRenderingContext2D, style: ResolvedStyle): void {
    const r = this.revealed();
    const buckets = r === null ? this.buckets : this.buildBuckets(r);
    for (const layer of this.layersOf(buckets, style)) {
      drawPath(ctx, layer.path, layer.paint);
    }
  }
}
