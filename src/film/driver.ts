import type { Veil } from './transition';
import type { FilmState, Segment, SegmentContext, SegmentErrorPhase, SegmentHandle } from './types';

export type DriverMode = FilmState['mode'];
/** 当前分段所处的阶段。只有淡入/正在播的分段才允许因横竖屏翻转被重建。 */
export type SegmentPhase = 'fading-in' | 'playing' | 'fading-out';

/** 驱动向宿主(runFilm)报告的事件与查询。宿主负责隔离它自己转发给用户的回调。 */
export interface DriverHooks {
  /** 分段起播前(宿主在这里调 onSegment)。 */
  beforeSegment(index: number, segment: Segment): void;
  /** 分段成功起播(宿主在这里武装的导出开录)。 */
  segmentStarted(index: number, segment: Segment): void;
  /** 给分段的上下文(字幕安全区)。 */
  contextFor(segment: Segment): SegmentContext;
  /** 一轮播到片尾,还没决定下一步(宿主在这里收带)。 */
  passEnded(): void;
  /** 是否在导出:导出时片尾不停,用户跳转/暂停/重建被锁定。 */
  isExporting(): boolean;
  /** 所有分段都起不来,驱动停止。 */
  allSegmentsFailed(): void;
  /** 驱动异常退出(已经释放了当前分段)。 */
  crashed(error: unknown): void;
  /** loop:false 自然播完。 */
  ended(): void;
  reportError(error: unknown, info: { segment: string; phase: SegmentErrorPhase }): void;
  pausedChanged(paused: boolean): void;
  /** 状态变了,帧循环该跑了。 */
  wake(): void;
}

export interface DriverConfig {
  canvas: HTMLCanvasElement;
  segments: readonly Segment[];
  /** 各段起点(秒)。 */
  starts: readonly number[];
  total: number;
  loop: boolean;
  /** 转场单边时长(毫秒)。 */
  transitionMs: number;
  veil: Veil;
  hooks: DriverHooks;
}

interface CurrentSegment {
  handle: SegmentHandle;
  segment: Segment;
  phase: SegmentPhase;
}

/**
 * 分段调度:按清单顺序播放,白场转场,跳转/暂停/循环,以及导出期间的锁定。
 * 状态都在这里,宿主只通过 hooks 接收事件 —— 以前这些散落在一个 950 行闭包的二十来个变量里。
 */
export class FilmDriver {
  private readonly cfg: DriverConfig;
  private pending: number | null = null;
  /** 唤醒当前分段的等待(跳转/销毁)。 */
  private wakeSkip: (() => void) | null = null;
  private current: CurrentSegment | null = null;
  private readonly released = new WeakSet<SegmentHandle>();
  private completedValue = 0;
  private indexValue = 0;
  private pausedValue = false;
  private endedValue = false;
  private disposed = false;

  constructor(cfg: DriverConfig) {
    this.cfg = cfg;
  }

  start(): void {
    this.launch();
  }

  get mode(): DriverMode {
    if (this.disposed) {
      return 'disposed';
    }
    if (this.endedValue) {
      return 'ended';
    }
    if (this.cfg.hooks.isExporting()) {
      return 'exporting';
    }
    return this.pausedValue ? 'paused' : 'playing';
  }

  get paused(): boolean {
    return this.pausedValue;
  }

  get index(): number {
    return this.indexValue;
  }

  /** 已播完的分段总时长(秒),即当前分段的起点;分段播满后推到下一段起点。 */
  get completed(): number {
    return this.completedValue;
  }

  currentSegment(): Segment | null {
    return this.current?.segment ?? null;
  }

  /** 当前分段的句柄(段内跳转快进时用,平时不要碰它的时间线)。 */
  currentHandle(): SegmentHandle | null {
    return this.current?.handle ?? null;
  }

  /** 本段已播秒数,钳在 [0, duration]。 */
  segmentElapsed(): number {
    const c = this.current;
    if (!c) {
      return 0;
    }
    let elapsed = 0;
    try {
      elapsed = c.handle.getElapsed();
    } catch {
      elapsed = 0;
    }
    return Math.min(Math.max(Number.isFinite(elapsed) ? elapsed : 0, 0), c.segment.duration);
  }

  /** 全片位置(秒)。 */
  position(): number {
    return Math.min(this.cfg.total, this.completedValue + this.segmentElapsed());
  }

  /**
   * 跳到第 target 段。internal=false 是用户发起的(进度条/键盘/宿主 seekTo),导出期间一律忽略 ——
   * 否则成片会被悄悄剪掉一截还照样「成功」。非有限值忽略。返回是否受理。
   */
  seek(target: number, internal = false): boolean {
    if (this.disposed || !Number.isFinite(target)) {
      return false;
    }
    if (!internal && this.cfg.hooks.isExporting()) {
      return false;
    }
    const n = this.cfg.segments.length;
    this.pending = Math.max(0, Math.min(n - 1, Math.round(target)));
    // 顺序要紧:先唤醒**当前**这一段的等待,再考虑重起驱动。
    // 反过来的话,新起的驱动会同步跑到第一个 await、把 pending 消费掉并换上新段的唤醒器,
    // 随后这一行就会立刻打断刚开播的目标段,表现为「点第 1 段却落到第 2 段」。
    const wake = this.wakeSkip;
    this.wakeSkip = null;
    wake?.();
    // loop:false 播完之后驱动已经退出,跳转必须能把它叫醒。
    if (this.endedValue) {
      this.launch();
    }
    this.cfg.hooks.wake();
    return true;
  }

  /** 暂停/恢复。导出期间的暂停请求被忽略(墙钟实时录制,暂停就永远录不完)。返回是否生效。 */
  setPaused(next: boolean): boolean {
    if (this.disposed || next === this.pausedValue) {
      return false;
    }
    if (next && this.cfg.hooks.isExporting()) {
      return false;
    }
    this.pausedValue = next;
    const c = this.current;
    if (c) {
      try {
        c.handle.setPaused(next);
      } catch (e) {
        this.cfg.hooks.reportError(e, { segment: c.segment.name, phase: 'play' });
      }
    }
    this.cfg.hooks.pausedChanged(next);
    this.cfg.hooks.wake();
    return true;
  }

  /** 导出重启:白场立刻盖满(成片从白场淡入开场,与点击时机无关),从第 0 段重播。 */
  restartForExport(): void {
    this.cfg.veil.set(1);
    this.seek(0, true);
  }

  /** 画布尺寸变化:当前分段按新上下文重设分辨率/安全区。 */
  resizeCurrent(): void {
    const c = this.current;
    if (!c) {
      return;
    }
    try {
      c.handle.resize(this.cfg.hooks.contextFor(c.segment));
    } catch (e) {
      this.cfg.hooks.reportError(e, { segment: c.segment.name, phase: 'play' });
    }
  }

  /**
   * 横竖屏翻转后能否重建当前段:只有淡入/正在播的段才重建。
   * 淡出中的段已经播完,片尾之后更没有段可建;导出期间不重建(contain 适配已经兜住了几何)。
   */
  canRebuild(): boolean {
    const c = this.current;
    return (
      !this.disposed &&
      !this.endedValue &&
      c !== null &&
      c.phase !== 'fading-out' &&
      !this.cfg.hooks.isExporting()
    );
  }

  rebuildCurrent(): void {
    if (this.canRebuild()) {
      this.seek(this.indexValue, true);
    }
  }

  /** 同步释放当前分段;驱动在下一个 await 处醒来后自行退出。 */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.pending = null;
    const wake = this.wakeSkip;
    this.wakeSkip = null;
    wake?.();
    this.cfg.veil.dispose();
    if (this.current) {
      this.release(this.current.handle);
    }
  }

  private launch(): void {
    if (this.disposed) {
      return;
    }
    this.endedValue = false;
    this.run().catch((e: unknown) => {
      // 驱动本身抛错(宿主回调之外的意外):收拾当前分段,不能让它继续往同一张画布上画。
      if (this.current) {
        this.release(this.current.handle);
      }
      this.endedValue = true;
      this.cfg.hooks.crashed(e);
      this.cfg.hooks.wake();
    });
  }

  private end(): void {
    this.current = null;
    this.endedValue = true;
    this.cfg.hooks.ended();
    this.cfg.hooks.wake();
  }

  /** 每个分段句柄恰好 dispose 一次(SegmentHandle 不要求自己幂等)。 */
  private release(handle: SegmentHandle): void {
    if (this.current?.handle === handle) {
      this.current = null;
    }
    if (this.released.has(handle)) {
      return;
    }
    this.released.add(handle);
    try {
      handle.dispose();
    } catch (e) {
      console.error('[film] 分段释放出错', e);
    }
  }

  /**
   * 建立当前分段的唤醒器(跳转/销毁时 resolve)。
   * 建立时就兑现已挂起的跳转:起播前后(onSegment 回调里、转场期间)点的跳转不会被吞掉。
   */
  private armSkip(): Promise<void> {
    return new Promise<void>((resolve) => {
      this.wakeSkip = resolve;
      if (this.pending !== null || this.disposed) {
        resolve();
      }
    });
  }

  /** 推进到下一段;返回 null 表示片子该停了。 */
  private advance(i: number): number | null {
    const next = i + 1;
    if (next < this.cfg.segments.length) {
      return next;
    }
    this.cfg.hooks.passEnded();
    // 走到这里时没有唤醒器(比如最后一段起播就抛错,它的 onSegment 回调里点了跳转),
    // 挂起的跳转叫不醒任何人,必须在这里兑现,否则 loop:false 下驱动直接退出、播放器死掉。
    if (this.pending !== null) {
      return this.pending;
    }
    if (!this.cfg.loop && !this.cfg.hooks.isExporting()) {
      this.end();
      return null;
    }
    return 0;
  }

  private async run(): Promise<void> {
    const { segments, starts, hooks, veil } = this.cfg;
    let index = 0;
    // 连续启动失败计数:全片都起不来时 catch 分支里没有 await,会变成同步自旋把整页锁死。
    let consecutiveFailures = 0;
    while (!this.disposed) {
      if (this.pending !== null) {
        index = this.pending;
        this.pending = null;
      }
      // 进度基准一律从起点表取:跳转、循环、以及「某段起播抛错被跳过」三条路径都自洽。
      this.completedValue = starts[index] ?? 0;
      this.indexValue = index;
      const segment = segments[index];
      if (!segment) {
        this.end();
        return;
      }
      hooks.beforeSegment(index, segment);
      // 宿主回调里可能把播放器销毁了,那就别再往画布上起新分段。
      if (this.disposed) {
        return;
      }
      let handle: SegmentHandle;
      try {
        handle = segment.play(this.cfg.canvas, hooks.contextFor(segment));
      } catch (e) {
        // 单段崩了不该让整个播放器停摆;但全都崩了就得停,不能同步自旋。
        hooks.reportError(e, { segment: segment.name, phase: 'start' });
        consecutiveFailures += 1;
        if (consecutiveFailures >= segments.length) {
          hooks.allSegmentsFailed();
          this.end();
          return;
        }
        const next = this.advance(index);
        if (next === null) {
          return;
        }
        index = next;
        continue;
      }
      consecutiveFailures = 0;
      const current: CurrentSegment = { handle, segment, phase: 'fading-in' };
      this.current = current;
      // 暂停态要跟着新分段走,否则切段会「自己恢复播放」。
      handle.setPaused(this.pausedValue);
      hooks.segmentStarted(index, segment);
      // 立刻挂上 rejection handler:转场中被跳转/销毁的分段走不到下面的 race,
      // done 稍后 reject 会变成未处理拒绝。已释放的分段之后再报的错不算数。
      const settled = Promise.resolve(handle.done).catch((e: unknown) => {
        if (!this.released.has(handle)) {
          hooks.reportError(e, { segment: segment.name, phase: 'play' });
        }
      });
      const skip = this.armSkip();
      hooks.wake();
      await Promise.race([veil.fadeTo(0, this.cfg.transitionMs), skip]);
      if (this.disposed) {
        this.release(handle);
        return;
      }
      if (this.pending === null) {
        current.phase = 'playing';
        await Promise.race([settled, skip]);
      }
      this.wakeSkip = null;
      if (this.disposed) {
        this.release(handle);
        return;
      }
      if (this.pending !== null) {
        // 跳转:直接切段,不闪白。
        this.release(handle);
        continue;
      }
      current.phase = 'fading-out';
      // 淡出同样要能被跳转打断:暂停会冻结白闪,不和跳转竞速的话,
      // 暂停在段间淡出时点的跳转要一直挂到恢复播放才兑现。
      const skipOut = this.armSkip();
      hooks.wake();
      await Promise.race([veil.fadeTo(1, this.cfg.transitionMs), skipOut]);
      this.wakeSkip = null;
      this.release(handle);
      if (this.disposed) {
        return;
      }
      if (this.pending !== null) {
        // 淡出途中跳转:不推进到下一段,直接从循环顶部切到目标段(新段从当前白闪接着淡入)。
        continue;
      }
      // 本段已播满:把进度推到下一段的起点。
      // 不这么写的话 loop:false 的最后一段结束后,进度条会从 100% 倒退回最后一段的起点。
      this.completedValue = starts[index + 1] ?? this.cfg.total;
      const next = this.advance(index);
      if (next === null) {
        return;
      }
      index = next;
    }
  }
}
