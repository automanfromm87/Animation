import type { Resamplable } from './Mesh3D';
import { sameParams } from './Mesh3D';
import type { Stroke3DOptions } from './Stroke3D';
import { Stroke3D } from './Stroke3D';
import type { Vec3 } from './vec3';
import { requireFiniteVec3 } from './vec3';

/**
 * 具体的 3D 线条:只负责给出 3D 点列,投影、遮挡、生长、箭头都在 Stroke3D 里。
 * 坐标是引擎坐标(x 右、y 下、z 朝观众);课本坐标用 mathPoint / Axes3D.point 换算。
 */

/** 3D 线段。start / end 是公共可写字段(与 2D Line 一致),每次绘制现读;被改成非有限值时什么都不画。 */
export class Line3D extends Stroke3D {
  start: Vec3;
  end: Vec3;
  private readonly pair: Array<Readonly<Vec3>> = [];

  constructor(start: Vec3, end: Vec3, options?: Stroke3DOptions) {
    super(options);
    this.start = requireFiniteVec3(`${this.constructor.name} 的 start`, start);
    this.end = requireFiniteVec3(`${this.constructor.name} 的 end`, end);
  }

  protected override points3D(): ReadonlyArray<Readonly<Vec3>> {
    this.pair[0] = this.start;
    this.pair[1] = this.end;
    return this.pair;
  }
}

/** 3D 箭头:Line3D + tips 缺省 'end';线宽为 0 时箭头照画(与 2D Arrow 一致)。 */
export class Arrow3D extends Line3D {
  constructor(start: Vec3, end: Vec3, options?: Stroke3DOptions) {
    super(start, end, { ...options, tips: options?.tips ?? 'end' });
  }

  protected override get headsWithoutStroke(): boolean {
    return true;
  }
}

export interface Polyline3DOptions extends Stroke3DOptions {
  /** 首尾闭合(截面多边形),缺省 false。闭合时生长绕一圈回到起点。 */
  closed?: boolean;
}

/** 点列拷贝:任一点非有限就抛错(调用方据此保持原样)。 */
function copyPoints(owner: string, points: readonly Vec3[]): Vec3[] {
  if (!Array.isArray(points)) {
    throw new Error(`${owner} 需要一个 3D 点数组`);
  }
  return points.map((p, i) => requireFiniteVec3(`${owner} 第 ${i} 个点`, p));
}

/** 3D 折线 / 闭合多边形(截面、棱、自己采样好的曲线)。 */
export class Polyline3D extends Stroke3D {
  readonly closed: boolean;
  private pts: Vec3[];

  constructor(points: readonly Vec3[], options?: Polyline3DOptions) {
    super(options);
    this.closed = options?.closed ?? false;
    this.pts = copyPoints(this.constructor.name, points);
  }

  /** 当前点列(只读视图)。 */
  get points(): ReadonlyArray<Readonly<Vec3>> {
    return this.pts;
  }

  /** 整体替换(拷贝);任一点非有限抛错,原点列保持不变。 */
  setPoints(points: readonly Vec3[]): this {
    this.pts = copyPoints(this.constructor.name, points);
    return this;
  }

  protected override get closedLoop(): boolean {
    return this.closed;
  }

  protected override points3D(): ReadonlyArray<Readonly<Vec3>> {
    return this.pts;
  }
}

/** 可去奇点重取时挪动的距离:万分之一个采样步(与 ParametricSurface 相同)。 */
const NAN_NUDGE = 1e-4;

/** 参数曲线的采样函数:与 ParamFn 同样的 params 约定,可配 ParamMorph。 */
export type Curve3DFn = (t: number, params: number[]) => Vec3;

export interface ParametricCurve3DOptions extends Stroke3DOptions {
  /** 采样段数(>= 1 的整数),缺省 120。 */
  samples?: number;
  /** 参数初值,缺省 []。要 ParamMorph 就给初值(与 ParametricSurface 同一个坑)。 */
  params?: readonly number[];
}

/**
 * 3D 参数曲线(螺旋线、曲面上的曲线、截线):在 tRange 上等距采 samples 段,折线连起来;t1 < t0 时反向生长。
 * 采样规则与 ParametricSurface 相同:返回 NaN 多半是 0/0 型的可去奇点(sin(3t)/(3t) 在 t = 0),
 * 先向区间内侧挪万分之一个采样步重取,取到的是极限附近的值 —— 否则采样点正好落在奇点上时,
 * 曲面是连续的、画在它上面的截线却在峰顶断开。±Infinity 是真正的极点,不挪;
 * 重取后仍非有限就在那里断笔(对渐近线、定义域以外的部分友好)。
 */
export class ParametricCurve3D extends Stroke3D implements Resamplable {
  private readonly fn: Curve3DFn;
  private readonly t0: number;
  private readonly t1: number;
  private readonly samples: number;
  private params: number[];
  private readonly pts: Vec3[];
  private sampled = false;
  private warnedEmpty = false;

  constructor(fn: Curve3DFn, tRange: readonly [number, number], options?: ParametricCurve3DOptions) {
    super(options);
    const name = this.constructor.name;
    const samples = options?.samples ?? 120;
    if (!Number.isInteger(samples) || samples < 1) {
      throw new Error(`${name} 的 samples 需要 >= 1 的整数,收到 ${samples}`);
    }
    const [t0, t1] = tRange;
    if (!Number.isFinite(t0) || !Number.isFinite(t1) || t0 === t1) {
      throw new Error(`${name} 的 tRange 需要有限且两端不同的区间,收到 [${t0}, ${t1}]`);
    }
    this.fn = fn;
    this.t0 = t0;
    this.t1 = t1;
    this.samples = samples;
    this.params = [...(options?.params ?? [])];
    this.pts = Array.from({ length: samples + 1 }, () => ({ x: NaN, y: NaN, z: NaN }));
    this.sample();
  }

  /** 当前采样点(只读视图;无定义处是 NaN 坐标,即断笔)。 */
  get points(): ReadonlyArray<Readonly<Vec3>> {
    return this.pts;
  }

  getParams(): number[] {
    return [...this.params];
  }

  /** 按新参数重采样;参数与当前逐元素相等时是空操作。不传参数则按当前参数强制重采。 */
  resample(params?: readonly number[]): void {
    if (params) {
      if (this.sampled && sameParams(params, this.params)) {
        return;
      }
      this.params = [...params];
    }
    this.sample();
  }

  protected override points3D(): ReadonlyArray<Readonly<Vec3>> {
    return this.pts;
  }

  private sample(): void {
    let finite = 0;
    const n = this.samples;
    const step = (this.t1 - this.t0) / n;
    for (let i = 0; i <= n; i++) {
      const t = i === n ? this.t1 : this.t0 + ((this.t1 - this.t0) * i) / n;
      let p: Readonly<Vec3> | null | undefined = this.fn(t, this.params);
      if (p && (Number.isNaN(p.x) || Number.isNaN(p.y) || Number.isNaN(p.z))) {
        p = this.fn(t + (i < n ? step : -step) * NAN_NUDGE, this.params);
      }
      const dst = this.pts[i];
      if (!dst) {
        continue;
      }
      if (p && Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z)) {
        dst.x = p.x;
        dst.y = p.y;
        dst.z = p.z;
        finite += 1;
      } else {
        dst.x = NaN;
        dst.y = NaN;
        dst.z = NaN;
      }
    }
    this.sampled = true;
    if (finite === 0 && !this.warnedEmpty) {
      this.warnedEmpty = true;
      console.warn(
        `[${this.constructor.name}] 采样函数在整个 tRange 上都没有有限值,曲线画不出来`,
      );
    }
  }
}
