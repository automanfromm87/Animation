/**
 * 停摆阈值(秒)。超过它的帧间隔按「场景被冻住了」处理:
 * 时间线整体后移、播放时钟只涨这么多。切后台标签页回来时,
 * 动画不会一帧跳到终态,字幕/进度条也不会凭空冲到段尾。
 * 取 0.5:重 3D 分段偶尔跑到 5~10fps 是正常的,那种帧不该被当成停摆
 * (否则整段会被拉成慢动作,导出时长也会失真)。
 */
export const STALL_DT = 0.5;

/** 帧时钟:注入它就能在测试里确定性地推进帧,而不必改全局。 */
export interface FrameClock {
  now(): number;
  request(callback: (time: number) => void): number;
  cancel(id: number): void;
}

/** 浏览器时钟。调用时才取全局(测试桩可能在导入之后才安装)。 */
export const browserClock: FrameClock = {
  now: () => performance.now(),
  request: (cb) => requestAnimationFrame(cb),
  cancel: (id) => cancelAnimationFrame(id),
};

/** 帧泵的宿主(Scene)。 */
export interface FramePumpHost {
  /**
   * 每帧推进时间线之前调用(跑 updater),dt 与时间线同一步长(秒)。
   * 返回 false 表示宿主已经销毁,本帧到此为止。
   */
  beforeTimelines(dt: number): boolean;
  /** 画一帧。 */
  draw(): void;
}

/** 帧泵里一条待推进的时间线(一次 play 或 wait)。 */
interface Timeline {
  readonly seconds: number;
  /** 起始时刻(毫秒)。暂停/停摆时整体后移,时间线才不会「跳过」那段。 */
  start: number;
  onFrame(elapsed: number): void;
  resolve(): void;
}

/**
 * 唯一的帧泵:推进时间 -> 跑 updater -> 推进各条时间线 -> 画一次。
 * 并发的 play/wait 共享它,无论同时挂了几条时间线,每帧 updater 只跑一遍、只画一次。
 */
export class FramePump {
  private readonly host: FramePumpHost;
  private readonly clock: FrameClock;
  private readonly timelines = new Set<Timeline>();
  private frameId = 0;
  private active = false;
  private lastTick = 0;
  /**
   * 时间线跑空后多泵一帧:把「finish() 的收尾重绘」和「下一段 play() 的起始重绘」
   * 合并进来,否则串行 await 的衔接帧会连画三次。
   */
  private idleFrames = 0;
  private needsRender = false;
  /** 空闲时排的「只重绘」帧(不推进时间、不跑 updater)。 */
  private renderOnlyId = 0;
  private paused = false;
  private elapsedSeconds = 0;
  private disposed = false;
  /**
   * 本帧刚结束的时间线里最晚的「剧本终点」(时钟毫秒)。在它之后、下一帧之前注册的时间线
   * (串行 await 的下一段 play)从这里起算,而不是从注册时刻 —— 否则每段都丢掉上一段
   * 不到一帧的超调,长片里按 getElapsed 取的字幕会越走越领先画面。下一帧开始时作废。
   */
  private carryEnd: number | null = null;

  constructor(host: FramePumpHost, clock: FrameClock = browserClock) {
    this.host = host;
    this.clock = clock;
  }

  /** 是否有时间线在推进(含收尾的那一帧)。 */
  get running(): boolean {
    return this.active;
  }

  /** 已播放的累计时长(秒)。只在时间线推进时累加,暂停与停摆不计。 */
  getElapsed(): number {
    return this.elapsedSeconds;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  isPaused(): boolean {
    return this.paused;
  }

  /** 帧泵在跑时,要求在本帧末尾重绘(暂停中的帧泵靠它知道有人要求重绘)。 */
  markDirty(): void {
    this.needsRender = true;
  }

  /**
   * 请求重绘,合并到最近的一帧:帧泵在跑就并入本帧;空闲时排一个只重绘的 rAF,
   * 同一帧里的多次请求(双指缩放一帧两个 pointermove、接连的样式修改)只画一次。
   */
  requestRender(): void {
    if (this.disposed) {
      return;
    }
    if (this.active) {
      this.needsRender = true;
      return;
    }
    if (this.renderOnlyId !== 0) {
      return;
    }
    this.renderOnlyId = this.clock.request(() => {
      this.renderOnlyId = 0;
      if (!this.disposed && !this.active) {
        this.host.draw();
      }
    });
  }

  /**
   * 注册一条时长为 seconds 的时间线,每帧用已过时长回调,到点后 resolve。
   * seconds 为 Infinity 时一直跑到 dispose。已销毁时立即 resolve ——
   * 否则 dispose 之后才注册的时间线永远等不到帧,上层 await 永远悬着。
   */
  animateFor(seconds: number, onFrame: (elapsed: number) => void): Promise<void> {
    if (this.disposed) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const now = this.clock.now();
      // 承接只对紧跟着的注册有效:帧泵已经停了、过了很久才来的 play 不能从过去起跑。
      const carry = this.carryEnd;
      const start = carry !== null && now - carry <= STALL_DT * 1000 ? carry : now;
      this.timelines.add({ seconds, start, onFrame, resolve });
      if (!this.active) {
        this.active = true;
        // 播放时钟从注册时刻起算(不丢首帧)。取当下而不是 start:承接超调时 start 在过去,
        // 那段超调上一帧已经计进播放时钟,拨回去会重复计一次。
        this.lastTick = now;
        if (this.renderOnlyId !== 0) {
          this.clock.cancel(this.renderOnlyId);
          this.renderOnlyId = 0;
        }
        this.frameId = this.clock.request(this.pump);
      }
    });
  }

  /** 停泵并放行所有挂起的时间线(上层 async 时间线及其清理代码才不会永远悬着)。 */
  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    if (this.frameId !== 0) {
      this.clock.cancel(this.frameId);
      this.frameId = 0;
    }
    if (this.renderOnlyId !== 0) {
      this.clock.cancel(this.renderOnlyId);
      this.renderOnlyId = 0;
    }
    this.active = false;
    const pending = [...this.timelines];
    this.timelines.clear();
    for (const t of pending) {
      t.resolve();
    }
  }

  /**
   * 整段包在 try/finally 里:任何一处抛异常都不能让帧泵停在「active 为真
   * 但没人排下一帧」的死态上 —— 那会让整个场景永久冻结、所有 Promise 悬空。
   */
  private pump = (now: number): void => {
    this.frameId = 0;
    this.carryEnd = null;
    if (this.disposed) {
      this.active = false;
      return;
    }
    const finished: Timeline[] = [];
    try {
      if (this.paused) {
        // 暂停期间时间不流动:把所有时间线的起点和上次 tick 一起后移,
        // 恢复后接着原来的进度跑,不会「跳过」暂停的这段。
        const shift = now - this.lastTick;
        this.lastTick = now;
        for (const t of this.timelines) {
          t.start += shift;
        }
        // 暂停时不主动重绘,但别把别人显式要求的重绘也吞掉(改主题、resize 之后)。
        if (this.needsRender) {
          this.needsRender = false;
          this.host.draw();
        }
        return;
      }
      // 播放时钟与时间线共用同一个墙钟,字幕/进度条才不会越走越落后。
      // 超过 STALL_DT 的那部分算「停摆」:时间线整体后移,时钟也不计。
      const raw = Math.max(0, (now - this.lastTick) / 1000);
      this.lastTick = now;
      const step = Math.min(raw, STALL_DT);
      if (raw > STALL_DT) {
        const stall = (raw - STALL_DT) * 1000;
        for (const t of this.timelines) {
          t.start += stall;
        }
      }
      this.elapsedSeconds += step;
      // updater 与时间线用同一个步长:慢帧上不会出现「时间线走了 1 秒、updater 只走 0.3 秒」。
      if (!this.host.beforeTimelines(step) || this.disposed) {
        return;
      }
      for (const t of [...this.timelines]) {
        // start 取的是注册时刻的时钟,可能略晚于本帧时间戳(updater 里发起的 play),
        // 不钳到 0 会用负 alpha 反向插值一帧。
        const elapsed = Math.max(0, (now - t.start) / 1000);
        try {
          t.onFrame(Math.min(elapsed, t.seconds));
        } catch (e) {
          console.error('[Scene] 动画插值抛错,已终止该时间线', e);
          this.timelines.delete(t);
          finished.push(t);
          continue;
        }
        // 写成 !(elapsed < seconds):NaN 时长走「立即结束」,而不是永久空转。
        if (!(elapsed < t.seconds)) {
          this.timelines.delete(t);
          finished.push(t);
          const end = t.start + t.seconds * 1000;
          if (Number.isFinite(end)) {
            this.carryEnd = Math.max(this.carryEnd ?? end, end);
          }
        }
      }
      this.needsRender = false;
      this.host.draw();
    } finally {
      if (this.disposed) {
        this.active = false;
        this.idleFrames = 0;
      } else if (this.timelines.size > 0) {
        this.idleFrames = 1;
        this.frameId = this.clock.request(this.pump);
      } else if (this.idleFrames > 0) {
        this.idleFrames -= 1;
        this.frameId = this.clock.request(this.pump);
      } else {
        this.active = false;
      }
      for (const t of finished) {
        t.resolve();
      }
    }
  };
}
