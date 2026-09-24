import type { Mesh3D, Resamplable, Vec3 } from '../mobjects3d/Mesh3D';
import type { Projection3D } from '../mobjects3d/Projection3D';
import type { MObject } from '../mobjects/MObject';
import { lerp } from '../mobjects/types';
import type { AnimationOptions } from './Animation';
import { Animation, BasePlayable } from './Animation';

/**
 * Spin3D:让 Mesh3D 绕 Y 轴旋转 turns 圈(1 圈 = 2π)。
 * 注意它转的是网格的 Projection3D:几个网格共用同一个视角时会一起转,
 * 同一次 play 里对共用视角的两个网格各播一个 Spin3D,只有一个生效 —— 这种情况用 Orbit3D。
 */
export class Spin3D extends Animation {
  private startRotY = 0;
  private readonly deltaRotY: number;
  private readonly mesh: Mesh3D;

  constructor(mesh: Mesh3D, turns = 1, options?: AnimationOptions) {
    super(mesh, options);
    this.mesh = mesh;
    this.deltaRotY = turns * Math.PI * 2;
  }

  override begin(): void {
    this.startRotY = this.mesh.rotY;
  }

  override interpolate(alpha: number): void {
    this.mesh.rotY = this.startRotY + this.deltaRotY * alpha;
  }
}

/**
 * Orbit3D:驱动一套共享 3D 视角自转 turns 圈(1 圈 = 2π)。
 * 一组网格共用同一个 Projection3D 时,这一个动画就能带动整组,
 * 不必给每个网格各播一个 Spin3D。
 */
export class Orbit3D extends BasePlayable {
  private readonly projection: Projection3D;
  private readonly delta: number;
  private start = 0;

  constructor(projection: Projection3D, turns = 1, options?: AnimationOptions) {
    super(options);
    this.projection = projection;
    this.delta = turns * Math.PI * 2;
  }

  override begin(): void {
    this.start = this.projection.rotY;
  }

  interpolate(alpha: number): void {
    this.projection.rotY = this.start + this.delta * alpha;
  }
}

/** ViewTo 的目标视角:给了哪几个就动哪几个。azimuth / elevation 是数学视角(见 Projection3D.math)。 */
export interface ViewTarget {
  rotX?: number;
  rotY?: number;
  azimuth?: number;
  elevation?: number;
  viewDistance?: number;
}

/**
 * ViewTo:把一套共享视角补间到目标(俯仰、环绕到指定方位、推近拉远)。
 * 给了哪几个键就动哪几个;azimuth / elevation 在构造时换算成 rotY / rotX
 * (rotY = −azimuth − π/2,rotX = −elevation)。共用这个视角的网格、线条、标注一起动。
 *
 * azimuth 是**方位**,取最短路径:播放开始时把目标换成与当前 rotY 相差不超过 π 的等价角。
 * Orbit3D 转过整圈后 rotY 已经累加了 2π 的倍数,「回到课本视角」不该倒着再转几圈。
 * 这一点故意与 RotateTo 不同(相机方位是周期的,物体转角不是)。
 * rotY / rotX / elevation 照字面线性补间:要整圈环绕就直接给 rotY(或用 Orbit3D)。
 */
export class ViewTo extends BasePlayable {
  private readonly projection: Projection3D;
  private readonly toRotX: number | undefined;
  /** 字面目标 rotY(azimuth 已换算);azimuth 目标在 begin 里再换成最近的等价角。 */
  private readonly targetRotY: number | undefined;
  private readonly shortestRotY: boolean;
  private readonly toDistance: number | undefined;
  private toRotY: number | undefined;
  private fromRotX = 0;
  private fromRotY = 0;
  private fromDistance = 0;

  constructor(projection: Projection3D, target: ViewTarget, options?: AnimationOptions) {
    super(options);
    const { rotX, rotY, azimuth, elevation, viewDistance } = target;
    const given = [rotX, rotY, azimuth, elevation, viewDistance].filter((v) => v !== undefined);
    if (given.length === 0) {
      throw new Error('ViewTo 至少要给 rotX / rotY / azimuth / elevation / viewDistance 中的一个');
    }
    if (rotY !== undefined && azimuth !== undefined) {
      throw new Error('ViewTo 不能同时给 rotY 和 azimuth(它们是同一个角的两种说法)');
    }
    if (rotX !== undefined && elevation !== undefined) {
      throw new Error('ViewTo 不能同时给 rotX 和 elevation(它们是同一个角的两种说法)');
    }
    if (given.some((v) => !Number.isFinite(v))) {
      throw new Error(`ViewTo 的目标需要有限数,收到 ${JSON.stringify(target)}`);
    }
    this.projection = projection;
    this.toRotX = elevation !== undefined ? 0 - elevation : rotX;
    this.targetRotY = azimuth !== undefined ? 0 - azimuth - Math.PI / 2 : rotY;
    this.shortestRotY = azimuth !== undefined;
    this.toRotY = this.targetRotY;
    this.toDistance = viewDistance;
  }

  override begin(): void {
    this.fromRotX = this.projection.rotX;
    this.fromRotY = this.projection.rotY;
    this.fromDistance = this.projection.viewDistance;
    const target = this.targetRotY;
    if (target !== undefined && this.shortestRotY) {
      // 目标换成与起点相差在 [−π, π] 内的等价角(差 2π 的整数倍,画面相同)。
      const turn = Math.PI * 2;
      const delta = target - this.fromRotY;
      this.toRotY = this.fromRotY + (delta - turn * Math.round(delta / turn));
    } else {
      this.toRotY = target;
    }
  }

  interpolate(alpha: number): void {
    if (this.toRotX !== undefined) {
      this.projection.rotX = lerp(this.fromRotX, this.toRotX, alpha);
    }
    if (this.toRotY !== undefined) {
      this.projection.rotY = lerp(this.fromRotY, this.toRotY, alpha);
    }
    if (this.toDistance !== undefined) {
      this.projection.viewDistance = lerp(this.fromDistance, this.toDistance, alpha);
    }
  }
}

/** MorphTo:同拓扑网格的顶点形变,目标顶点数必须与网格一致。 */
export class MorphTo extends Animation {
  private start: Vec3[] = [];
  private readonly target: readonly Vec3[];
  private readonly mesh: Mesh3D;

  constructor(mesh: Mesh3D, target: readonly Vec3[], options?: AnimationOptions) {
    super(mesh, options);
    this.mesh = mesh;
    this.target = target.map((v) => ({ ...v }));
  }

  override begin(): void {
    // 校验放在 begin:构造到播放之间网格可能被 resample 成别的顶点数。
    if (this.mesh.vertices.length !== this.target.length) {
      throw new Error(
        `MorphTo 需要 ${this.mesh.vertices.length} 个顶点,收到 ${this.target.length}`,
      );
    }
    this.start = this.mesh.vertices.map((v) => ({ ...v }));
  }

  override interpolate(alpha: number): void {
    for (let i = 0; i < this.start.length; i++) {
      const s = this.start[i];
      const t = this.target[i];
      if (!s || !t) {
        continue;
      }
      this.mesh.setVertexAt(
        i,
        lerp(s.x, t.x, alpha),
        lerp(s.y, t.y, alpha),
        lerp(s.z, t.z, alpha),
      );
    }
  }
}

/**
 * ParamMorph:把可重采样曲面的参数补间到 to,每帧 resample。
 * 起点缺省取播放开始时的当前参数(与其它动画一样在 begin 捕获);
 * 也可以显式给出 from(旧写法 `new ParamMorph(s, from, to, opts)`)。
 * 同一个 alpha 不重复重采样:动画结束后、同批更长的动画还在跑时,
 * 场景会继续以 alpha=1 调它,隐式曲面一次重建要好几毫秒。
 */
export class ParamMorph extends Animation {
  private readonly target: MObject & Resamplable;
  private readonly explicitFrom: readonly number[] | null;
  private readonly to: readonly number[];
  private from: readonly number[] = [];
  private readonly buffer: number[] = [];
  private lastAlpha = NaN;

  constructor(target: MObject & Resamplable, to: readonly number[], options?: AnimationOptions);
  constructor(
    target: MObject & Resamplable,
    from: readonly number[],
    to: readonly number[],
    options?: AnimationOptions,
  );
  constructor(
    target: MObject & Resamplable,
    a: readonly number[],
    b?: readonly number[] | AnimationOptions,
    c?: AnimationOptions,
  ) {
    const legacy = Array.isArray(b);
    super(target, legacy ? c : (b as AnimationOptions | undefined));
    this.target = target;
    this.explicitFrom = legacy ? [...a] : null;
    this.to = legacy ? [...(b as readonly number[])] : [...a];
    if (this.explicitFrom && this.explicitFrom.length !== this.to.length) {
      throw new Error(
        `ParamMorph 的 from/to 参数个数不一致:${this.explicitFrom.length} vs ${this.to.length}`,
      );
    }
  }

  override begin(): void {
    this.from = this.explicitFrom ?? this.target.getParams();
    if (this.from.length !== this.to.length) {
      throw new Error(
        `ParamMorph 的目标参数个数(${this.to.length})与曲面当前参数个数(${this.from.length})不一致`,
      );
    }
    this.buffer.length = this.to.length;
    this.lastAlpha = NaN;
  }

  override interpolate(alpha: number): void {
    if (alpha === this.lastAlpha) {
      return;
    }
    this.lastAlpha = alpha;
    for (let i = 0; i < this.to.length; i++) {
      const f = this.from[i] ?? 0;
      this.buffer[i] = lerp(f, this.to[i] ?? f, alpha);
    }
    this.target.resample(this.buffer);
  }
}
