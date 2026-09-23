import type { MObject } from '../mobjects/MObject';
import type { Affine } from '../path/path';
import type { ResolvedStyle } from '../theme/Theme';
import type { RateFunction } from './rateFunctions';
import { smooth } from './rateFunctions';

export interface AnimationOptions {
  /** 时长(秒),非负有限数,缺省 1。 */
  runTime?: number;
  rateFunc?: RateFunction;
}

/**
 * Scene.play 交给 begin 的场景信息。形状变形这类动画要知道对象在世界里的位置、
 * 在所在位置解析出的样式(公式的大小取决于字号);简单补间用不着,可以忽略。
 */
export interface PlayContext {
  /** 对象的世界变换(沿场景图组合祖先与自身的变换);不在场景图里返回 null。 */
  worldMatrix(m: MObject): Affine | null;
  /** 对象在所在位置解析出的样式(不在场景图里时按脱离容器解析)。 */
  styleOf(m: MObject): ResolvedStyle;
}

/**
 * Playable:Scene.play() 接受的最小契约。
 * Animation 绑定 MObject,TweenValue / CameraMove 等绑定外部参数,都实现它。
 * 生命周期: begin() 捕获初态 -> 每帧 interpolate(alpha) -> finish() 保证终态精确。
 * interpolate 收到的 alpha 已经过 rateFunc 缓动。
 */
export interface Playable {
  readonly runTime: number;
  readonly rateFunc: RateFunction;
  /** context 由 Scene.play 提供;单独调用(测试)时可以不传。 */
  begin(context?: PlayContext): void;
  interpolate(alpha: number): void;
  finish(): void;
}

let warnedRunTime = false;

/**
 * runTime 规范化:非有限或负数按 0(立即完成)处理,并告警一次。
 * `runTime: total - used` 这类算出来的值一旦是 NaN,不能把同批的其它动画一起拖到终态。
 */
export function normalizeRunTime(runTime: number | undefined, fallback = 1): number {
  const r = runTime ?? fallback;
  if (Number.isFinite(r) && r >= 0) {
    return r;
  }
  if (!warnedRunTime) {
    warnedRunTime = true;
    console.warn(`[animation] runTime 需要非负有限数,收到 ${r},按 0(立即完成)处理`);
  }
  return 0;
}

/** Playable 的公共骨架:runTime 校验、缺省缓动、按 rateFunc(1) 收尾。 */
export abstract class BasePlayable implements Playable {
  readonly runTime: number;
  readonly rateFunc: RateFunction;

  constructor(options?: AnimationOptions) {
    this.runTime = normalizeRunTime(options?.runTime);
    this.rateFunc = options?.rateFunc ?? smooth;
  }

  begin(_context?: PlayContext): void {
    // 默认无需捕获初态,子类按需覆盖。
  }

  abstract interpolate(alpha: number): void;

  /**
   * 终态:走一遍 rateFunc(1) 而不是直接 interpolate(1)。
   * 内置缓动 f(1) 恰为 1,行为不变;自定义非归一化缓动才不会在最后一帧跳变。
   */
  finish(): void {
    this.interpolate(this.rateFunc(1));
  }
}

/** Animation:描述一个 MObject 随时间的变化。 */
export abstract class Animation extends BasePlayable {
  readonly mobject: MObject;

  constructor(mobject: MObject, options?: AnimationOptions) {
    super(options);
    this.mobject = mobject;
  }
}
