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
