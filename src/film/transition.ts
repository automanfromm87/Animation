import { smooth } from '../engine';

interface VeilAnimation {
  from: number;
  to: number;
  /** 起点时间戳;null 表示还没被帧循环推进过(以第一帧的时间戳为起点,不受调度延迟影响)。 */
  start: number | null;
  duration: number;
  /** 暂停开始的时间戳(没暂停为 null)。恢复时起点整体后移这么久。 */
  pausedAt: number | null;
  resolve: () => void;
}

/**
 * 转场白闪的状态模型(不透明度 0~1)。
 * 它是唯一的数据源:DOM 白闪层和导出合成都读它,而不是反过来从 DOM 的 style.opacity 里解析。
 * 由播放器的帧循环逐帧推进;暂停时时间不流动 —— 暂停在淡出途中不会「暂停着切到下一段」。
 */
export class Veil {
  private value: number;
  private anim: VeilAnimation | null = null;
  private lastTick: number | null = null;

  constructor(initial = 1) {
    this.value = initial;
  }

  get alpha(): number {
    return this.value;
  }

  get animating(): boolean {
    return this.anim !== null;
  }

  /** 立即设值:取消进行中的渐变,并放行它的等待者。 */
  set(alpha: number): void {
    this.value = Math.min(1, Math.max(0, alpha));
    this.settle();
  }

  /**
   * 渐变到 target,推进到位后 resolve。durationMs <= 0 立即完成。
   * 跳转可能让新旧转场重叠:新渐变会放行旧渐变的等待者,只有最新一路写值。
   */
  fadeTo(target: number, durationMs: number): Promise<void> {
    this.settle();
    const to = Math.min(1, Math.max(0, target));
    if (!(durationMs > 0) || this.value === to) {
      this.value = to;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      this.anim = {
        from: this.value,
        to,
        start: null,
        duration: durationMs,
        pausedAt: null,
        resolve,
      };
    });
  }

  /**
   * 帧循环每帧调用。paused 时记下暂停起点、不推进;恢复后起点整体后移暂停的时长,接着原进度走。
   * 暂停期间帧循环可以完全停掉(不必逐帧空转),恢复的第一帧一次补齐。
   */
  tick(now: number, paused: boolean): void {
    const prev = this.lastTick;
    this.lastTick = now;
    const a = this.anim;
    if (!a) {
      return;
    }
    if (a.start === null) {
      a.start = now;
    }
    if (paused) {
      // 从上一次推进的时刻算起冻结(那之后的时间都算暂停);这一路渐变还没推进过就从现在算。
      a.pausedAt ??= prev !== null && prev >= a.start ? prev : now;
      return;
    }
    if (a.pausedAt !== null) {
      a.start += now - a.pausedAt;
      a.pausedAt = null;
    }
    const t = Math.min(1, Math.max(0, (now - a.start) / a.duration));
    this.value = a.from + (a.to - a.from) * smooth(t);
    if (t >= 1) {
      this.value = a.to;
      this.anim = null;
      a.resolve();
    }
  }

  /** 放行所有等待者(播放器销毁时调用,驱动才能退出)。 */
  dispose(): void {
    this.settle();
  }

  private settle(): void {
    const a = this.anim;
    this.anim = null;
    a?.resolve();
  }
}
