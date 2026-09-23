import type { AnimationOptions, PlayContext, Playable } from './Animation';
import { BasePlayable } from './Animation';
import { linear } from './rateFunctions';

export interface AnimationGroupOptions extends AnimationOptions {
  /**
   * 相邻两个动画开始时刻的间隔,占前一个动画时长的比例:
   * 0 同时开始,0.5 前一个播到一半时下一个开始,1 首尾相接。非负有限数。
   */
  lagRatio?: number;
}

/** LaggedStart 缺省的错峰比例(Manim 是 0.05;这里取 0.2,三五个对象的错峰一眼能看出来)。 */
export const DEFAULT_LAG_RATIO = 0.2;

/** 子动画在组内时间轴上的位置(组的「自然时间」,秒)。 */
interface Slot {
  readonly playable: Playable;
  readonly start: number;
  readonly duration: number;
}

/**
 * 子动画的状态。dead:begin 就抛错了(从没开始,也不收尾);
 * faulted:开始之后插值 / 收尾抛过错,之后的帧不再碰它,组收尾时再给它一次 finish 的机会。
 */
type SlotState = 'idle' | 'running' | 'done' | 'dead' | 'faulted';

/** 与 Scene.play 一样:非有限 / 非正的时长按 0(立即完成)。 */
function durationOf(p: Playable): number {
  return Number.isFinite(p.runTime) && p.runTime > 0 ? p.runTime : 0;
}

/** 组内时间 time 时子动画的线性进度(0..1);时长为 0 的一到开始时刻就是 1。 */
function progressAt(slot: Slot, time: number): number {
  if (slot.duration <= 0) {
    return time >= slot.start ? 1 : 0;
  }
  const t = (time - slot.start) / slot.duration;
  return t >= 1 ? 1 : t > 0 ? t : 0;
}

/**
 * AnimationGroup:把几个动画编成一个,可以再交给 Scene.play、或嵌进别的组。
 * 第 i+1 个在第 i 个开始之后 lagRatio × 它的时长 时开始(缺省 0,全部同时);
 * 组的时长缺省是排出来的总长,指定 runTime 则整条时间轴按比例伸缩;
 * 组的 rateFunc 缺省 linear(扭曲的是整条时间轴),子动画各自的缓动照常生效。
 *
 * 开始时一次性 begin 全部子动画(按顺序):FadeIn / Create / Transform 这类入场动画会先把
 * 各自的对象藏好,轮到时才出现。要让后一个动画接着前一个的终态开始
 * (同一对象先移到 A 再移到 B、连续变形),用 Succession —— 它轮到谁才 begin 谁。
 * 每个子动画走到自己的终点就单独 finish(终态精确),不必等整组结束。
 */
export class AnimationGroup extends BasePlayable {
  readonly animations: readonly Playable[];
  readonly lagRatio: number;
  /** 子动画按各自时长排出来的总长(秒)。 */
  readonly naturalRunTime: number;
  private readonly slots: readonly Slot[];
  private states: SlotState[] = [];
  /** 每个子动画上一次拿到的线性进度:没变就不重复插值。 */
  private last: number[] = [];
  private context: PlayContext | undefined;
  private failed = false;
  private failure: unknown = null;

  constructor(animations: readonly Playable[], options?: AnimationGroupOptions) {
    const lagRatio = options?.lagRatio ?? 0;
    if (!(Number.isFinite(lagRatio) && lagRatio >= 0)) {
      throw new RangeError(`AnimationGroup:lagRatio 需要非负有限数,收到 ${lagRatio}`);
    }
    if (new Set(animations).size !== animations.length) {
      throw new Error('AnimationGroup:同一个动画实例不能在组里出现两次(它只有一份播放状态)');
    }
    const slots: Slot[] = [];
    let start = 0;
    let total = 0;
    for (const playable of animations) {
      const duration = durationOf(playable);
      slots.push({ playable, start, duration });
      total = Math.max(total, start + duration);
      start += lagRatio * duration;
    }
    super({ runTime: options?.runTime ?? total, rateFunc: options?.rateFunc ?? linear });
    this.animations = [...animations];
    this.lagRatio = lagRatio;
    this.naturalRunTime = total;
    this.slots = slots;
  }

  /** 子动画是否轮到时才 begin(Succession 覆盖为 true)。 */
  protected beginsLazily(): boolean {
    return false;
  }

  override begin(context?: PlayContext): void {
    this.context = context;
    this.states = this.slots.map(() => 'idle');
    this.last = this.slots.map(() => 0);
    this.failed = false;
    this.failure = null;
    try {
      if (!this.beginsLazily()) {
        this.slots.forEach((slot, i) => {
          slot.playable.begin(context);
          this.states[i] = 'running';
        });
      }
      // 从 0 开始、时长为 0 的直接完成;Succession 在这里开始第一个。
      this.advance(0);
    } catch (e) {
      // begin 抛错时 Scene 不会再收尾这个组:已经开始的子动画在这里收尾(与 Scene.play 一致)。
      this.abort();
      throw e;
    }
  }

  override interpolate(alpha: number): void {
    if (Number.isFinite(alpha)) {
      this.advance(alpha * this.naturalRunTime);
    }
  }

  /**
   * 终态(按 rateFunc(1)):走到头时所有子动画按顺序 finish(还没轮到的 Succession 子动画先 begin);
   * 往返型缓动停在中途时,子动画各自停在那个时刻。有子动画抛过错时,别的都收完尾再抛出第一个错误。
   */
  override finish(): void {
    const a = this.rateFunc(1);
    if (a < 1) {
      this.advance(Math.max(0, a) * this.naturalRunTime);
      return;
    }
    this.states = this.states.map((s) => (s === 'faulted' ? 'running' : s));
    this.advance(Infinity);
  }

  /** 把组内时间推到 time:按顺序开始、插值、收尾各个子动画。 */
  private advance(time: number): void {
    this.slots.forEach((slot, i) => {
      const state = this.states[i];
      if (state === 'dead' || state === 'faulted') {
        return;
      }
      if (state === 'idle') {
        if (time < slot.start) {
          return;
        }
        try {
          slot.playable.begin(this.context);
        } catch (e) {
          this.states[i] = 'dead';
          this.remember(e);
          return;
        }
        this.states[i] = 'running';
      }
      const t = progressAt(slot, time);
      try {
        if (t >= 1) {
          if (this.states[i] !== 'done') {
            this.states[i] = 'done';
            slot.playable.finish();
          }
        } else if (t !== this.last[i]) {
          // 往回走(往返型缓动)时已经收尾的也重新插值(它的上一个进度是 1,必然不同)。
          this.states[i] = 'running';
          slot.playable.interpolate(slot.playable.rateFunc(t));
        }
        this.last[i] = t;
      } catch (e) {
        this.states[i] = 'faulted';
        this.remember(e);
      }
    });
    if (this.failed) {
      throw this.failure;
    }
  }

  /** begin 失败时的清理:已经开始、还没收尾的子动画收尾,错误不再掩盖真正的那个。 */
  private abort(): void {
    this.slots.forEach((slot, i) => {
      if (this.states[i] === 'running') {
        this.states[i] = 'done';
        try {
          slot.playable.finish();
        } catch {
          // 收尾失败不再掩盖真正的错误。
        }
      }
    });
  }

  private remember(e: unknown): void {
    if (!this.failed) {
      this.failed = true;
      this.failure = e;
    }
  }
}

/**
 * LaggedStart:错峰依次开始 —— 下一个在上一个播到 lagRatio(缺省 0.2)时开始。
 * 常见写法:new LaggedStart(items.map((m) => new FadeIn(m)), { lagRatio: 0.3 })。
 * 其余语义同 AnimationGroup(开始时一次性 begin 全部子动画)。
 */
export class LaggedStart extends AnimationGroup {
  constructor(animations: readonly Playable[], options?: AnimationGroupOptions) {
    super(animations, { ...options, lagRatio: options?.lagRatio ?? DEFAULT_LAG_RATIO });
  }
}

/**
 * Succession:一个接一个(lagRatio 缺省 1,首尾相接)。与 LaggedStart 不同,子动画轮到时才 begin,
 * 捕获的是那一刻的状态 —— 同一对象先移到 A 再移到 B、连续变形 A → B → C 都首尾相接。
 * 也因此后面的入场动画轮到之前,它的对象保持原样:要一直藏到轮到时的对象先把 opacity 设为 0
 * (FadeIn 会淡入到 1),或者改用 LaggedStart(..., { lagRatio: 1 })。
 */
export class Succession extends AnimationGroup {
  constructor(animations: readonly Playable[], options?: AnimationGroupOptions) {
    super(animations, { ...options, lagRatio: options?.lagRatio ?? 1 });
  }

  protected override beginsLazily(): boolean {
    return true;
  }
}

/** Wait:什么都不做的一段时间,在 Succession / LaggedStart 里留停顿。 */
export class Wait extends BasePlayable {
  constructor(seconds = 1) {
    super({ runTime: seconds, rateFunc: linear });
  }

  interpolate(_alpha: number): void {
    // 只占时间。
  }
}
