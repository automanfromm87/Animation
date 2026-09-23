import { lerp } from '../mobjects/types';
import type { AnimationOptions } from './Animation';
import { BasePlayable } from './Animation';

/** ValueTracker:被动画驱动的外部参数,updater 每帧读取它重算曲面。 */
export class ValueTracker {
  private value: number;

  constructor(initial = 0) {
    this.value = initial;
  }

  getValue(): number {
    return this.value;
  }

  setValue(value: number): this {
    this.value = value;
    return this;
  }
}

/** TweenValue:把 tracker 的值从当前补间到目标,不绑定任何 MObject。 */
export class TweenValue extends BasePlayable {
  private readonly tracker: ValueTracker;
  private readonly to: number;
  private from = 0;

  constructor(tracker: ValueTracker, to: number, options?: AnimationOptions) {
    super(options);
    this.tracker = tracker;
    this.to = to;
  }

  override begin(): void {
    this.from = this.tracker.getValue();
  }

  interpolate(alpha: number): void {
    this.tracker.setValue(lerp(this.from, this.to, alpha));
  }
}
