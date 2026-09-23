import { compositeFrame } from './composite';
import type { ExportSubtitle } from './composite';
import {
  CAPTURE_FPS,
  DEFAULT_MAX_LONG_EDGE,
  exportGeometry,
  exportSize,
  outputStats,
  pickMimeType,
  shouldComposite,
  validateOutput,
} from './output';
import type { ExportOptions } from './types';
import { FilmError, describeError } from './types';
import type { RecorderHealth } from './watchdog';
import { WATCHDOG_INTERVAL_MS, diagnoseRecorderStall, isCanvasTainted } from './watchdog';

/** MediaRecorder 构造器(含静态 isTypeSupported),与 DOM 里的全局同形。 */
export interface MediaRecorderCtor {
  new (stream: MediaStream, options?: MediaRecorderOptions): MediaRecorder;
  isTypeSupported(type: string): boolean;
}

/**
 * 录制器用到的浏览器能力。缺省由 browserRecorderEnv() 取全局;
 * 测试(或离屏宿主)注入自己的实现,就不必改写 document / MediaRecorder 这些全局。
 */
export interface RecorderEnv {
  readonly MediaRecorder: MediaRecorderCtor;
  /** 新建一张画布(导出画布与污染探针)。 */
  createCanvas(): HTMLCanvasElement;
  /** 把导出画布挂进文档(透明、不挡点击)。 */
  attach(canvas: HTMLCanvasElement): void;
  /** 页面当前是否在后台。 */
  hidden(): boolean;
  /** 订阅页面可见性变化,返回退订函数。 */
  onVisibilityChange(listener: () => void): () => void;
  /** 把数据块拼成成片。 */
  makeBlob(chunks: readonly Blob[], type: string): Blob;
}

/** 浏览器环境;缺 MediaRecorder 或 document 时返回 null。调用时才取全局(测试桩可能在导入之后才安装)。 */
export function browserRecorderEnv(): RecorderEnv | null {
  if (typeof MediaRecorder === 'undefined' || typeof document === 'undefined') {
    return null;
  }
  return {
    MediaRecorder,
    createCanvas: () => document.createElement('canvas'),
    attach: (canvas) => {
      document.body?.appendChild(canvas);
    },
    hidden: () => document.hidden,
    onVisibilityChange: (listener) => {
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    },
    makeBlob: (chunks, type) => new Blob([...chunks], { type }),
  };
}

/** 每帧合成的输入。由播放器从自己的状态模型给出,绝不从 DOM 回读。 */
export interface RecorderFrame {
  veilAlpha: number;
  subtitle: ExportSubtitle | null;
  /** 当前影片位置(秒),进度回调用。 */
  position: number;
}

export interface ExportRecorderInit {
  /** 直播主画布(公式已画在里面)。 */
  main: HTMLCanvasElement;
  /** 主画布的 css 宽度。必须是缓存值:在合成热路径里读 clientWidth 会强制同步布局。 */
  mainCssWidth: () => number;
  veilColor: string;
  /** 全片时长(秒),进度回调用。 */
  total: number;
  options?: ExportOptions;
  /** 浏览器能力;缺省 browserRecorderEnv()。 */
  env?: RecorderEnv;
  /** 时钟(毫秒),须与 tick 收到的时间戳同源;缺省 performance.now。 */
  now?: () => number;
  /**
   * 开始收尾(成功收带 / 失败 / 取消)的那一刻同步回调。
   * 播放器据此解除导出锁 —— 不能等到 done 落定:收带是异步的,
   * loop:false 的片子必须在这一刻就知道「已经不在导出了」,片尾才会停。
   */
  onFinish?: (recorder: ExportRecorder) => void;
}

/** 连续这么多帧合成失败就放弃,而不是整段录坏帧还硬交付。 */
export const MAX_FRAME_ERRORS = 30;
/** timeslice:每秒交一次数据块,看门狗据此判断断供。 */
const TIMESLICE_MS = 1000;
const VIDEO_BITS_PER_SECOND = 8_000_000;

type RecorderStage = 'armed' | 'recording' | 'stopping' | 'finished';

/**
 * 一次导出会话:另开一张画布,每帧把主画面 + 白闪 + 字幕合成上去,captureStream 交给 MediaRecorder。
 * 生命周期:create(同步初始化)-> 等播放器 start(导出段的第一个分段起播)-> 每帧 tick -> finish。
 */
export class ExportRecorder {
  readonly done: Promise<Blob>;
  /** 选用的容器/编码。 */
  readonly mimeType: string;
  readonly width: number;
  readonly height: number;
  private readonly init: ExportRecorderInit;
  private readonly env: RecorderEnv;
  private readonly now: () => number;
  private readonly out: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly stream: MediaStream;
  private readonly recorder: MediaRecorder;
  /** 污染探针画布,每次检查复用。 */
  private readonly probe: HTMLCanvasElement;
  private readonly chunks: Blob[] = [];
  private stage: RecorderStage = 'armed';
  /** 收带窗口期内收到的失败/取消:交付时改为 reject。 */
  private pendingError: FilmError | null = null;
  private frames = 0;
  private frameErrors = 0;
  // 时间戳用 null 表示「还没有」:注入的时钟可以从 0 开始,0 不能当哨兵。
  private startedAt: number | null = null;
  private lastChunkAt: number | null = null;
  private lastCompositeAt = -Infinity;
  private lastWatchAt = 0;
  private mutedSince: number | null = null;
  private progressFailed = false;
  private resolveDone: (b: Blob) => void = () => undefined;
  private rejectDone: (e: FilmError) => void = () => undefined;
  private unsubscribeVisibility: () => void = () => undefined;

  /** 同步初始化。环境不支持或初始化失败时抛 FilmError(unsupported / unsupported-mime / init)。 */
  static create(init: ExportRecorderInit): ExportRecorder {
    return new ExportRecorder(init);
  }

  private constructor(init: ExportRecorderInit) {
    this.init = init;
    this.now = init.now ?? ((): number => performance.now());
    const env = init.env ?? browserRecorderEnv();
    if (!env) {
      throw new FilmError('unsupported', '当前浏览器不支持视频导出(缺少 MediaRecorder)');
    }
    this.env = env;
    const requested = init.options?.mimeType;
    const picked = pickMimeType(requested, (t) => env.MediaRecorder.isTypeSupported(t));
    if (picked.error === 'unsupported-mime') {
      throw new FilmError('unsupported-mime', `当前浏览器不支持导出 ${requested ?? ''}`);
    }
    if (picked.error !== null) {
      throw new FilmError('unsupported', '当前浏览器没有可用的视频容器(mp4 / webm 都不支持)');
    }
    const size = exportSize(
      init.main.width,
      init.main.height,
      init.options?.maxLongEdge ?? init.options?.maxWidth ?? DEFAULT_MAX_LONG_EDGE,
    );
    this.width = size.width;
    this.height = size.height;
    const out = env.createCanvas();
    out.width = size.width;
    out.height = size.height;
    const ctx = out.getContext('2d');
    if (!ctx) {
      throw new FilmError('init', '导出初始化失败:拿不到导出画布的 2D 上下文');
    }
    // 导出画布挂进 DOM(透明、不挡点击、读屏忽略)。这是保守做法:
    // 「合成几千帧、编码器只收到文件头」的真凶是画布污染(看门狗会直接报出来),不是游离画布。
    out.style.cssText = 'position:fixed;left:0;top:0;opacity:0;pointer-events:none;';
    out.setAttribute('aria-hidden', 'true');
    env.attach(out);
    // 先把底色铺上再取流:捕获轨道不该建立在一张从未绘制过的空画布上。
    ctx.fillStyle = init.veilColor;
    ctx.fillRect(0, 0, size.width, size.height);
    let stream: MediaStream;
    let recorder: MediaRecorder;
    try {
      stream = out.captureStream(CAPTURE_FPS);
      recorder = new env.MediaRecorder(stream, {
        mimeType: picked.mimeType,
        videoBitsPerSecond: VIDEO_BITS_PER_SECOND,
      });
    } catch (e) {
      // captureStream / MediaRecorder 构造是同步抛的,不能让它逃出 exportVideo。
      out.remove();
      throw new FilmError('init', `导出初始化失败:${describeError(e)}`, describeError(e));
    }
    this.out = out;
    this.ctx = ctx;
    this.stream = stream;
    this.recorder = recorder;
    this.mimeType = picked.mimeType;
    this.probe = env.createCanvas();
    this.done = new Promise<Blob>((resolve, reject) => {
      this.resolveDone = resolve;
      this.rejectDone = reject;
    });
    recorder.ondataavailable = (e: BlobEvent): void => {
      if (e.data && e.data.size > 0) {
        this.chunks.push(e.data);
        this.lastChunkAt = this.now();
      }
    };
    recorder.onerror = (e: Event): void => {
      const detail = describeError((e as { error?: unknown }).error ?? e.type);
      this.finish(false, new FilmError('recorder', `编码器出错:${detail}`, detail));
    };
    // 录制是墙钟实时的:切后台会录出整段静帧,与其产出废片不如明确失败。
    this.unsubscribeVisibility = env.onVisibilityChange(() => {
      if (env.hidden()) {
        this.finish(
          false,
          new FilmError('hidden', '导出期间请保持页面可见(后台标签页会录出静帧)'),
        );
      }
    });
  }

  /** 已开录、还没开始收尾。 */
  get recording(): boolean {
    return this.stage === 'recording';
  }

  /** 已创建、等待开录。 */
  get armed(): boolean {
    return this.stage === 'armed';
  }

  /** 开录。播放器在导出段的第一个分段起播时调用(那一刻白场正盖满画面)。 */
  start(now: number = this.now()): void {
    if (this.stage !== 'armed') {
      return;
    }
    try {
      this.recorder.start(TIMESLICE_MS);
    } catch (e) {
      this.finish(false, new FilmError('recorder', `编码器启动失败:${describeError(e)}`));
      return;
    }
    this.stage = 'recording';
    this.startedAt = now;
    this.lastWatchAt = now;
    this.lastCompositeAt = -Infinity;
  }

  /**
   * 每帧调用一次。**绝不往外抛**:它挂在播放器的帧循环上,抛出去会连带白闪/字幕一起停摆。
   * 合成按捕获帧率节流(高刷屏上多余的合成纯属浪费);看门狗按时间节流。
   */
  tick(now: number, frame: RecorderFrame): void {
    if (this.stage !== 'recording') {
      return;
    }
    this.reportProgress(frame.position);
    if (shouldComposite(now, this.lastCompositeAt)) {
      this.lastCompositeAt = now;
      this.compositeOnce(frame);
      if (this.stage !== 'recording') {
        return;
      }
    }
    if (now - this.lastWatchAt >= WATCHDOG_INTERVAL_MS) {
      this.lastWatchAt = now;
      this.watch(now);
    }
  }

  /**
   * 一轮播到片尾:已开录就收带交付。还在等开录(armed)时什么都不做 ——
   * 那时收带只会交出空视频,跟着下一轮从第 0 段起播再开录。
   */
  endOfPass(): void {
    if (this.stage === 'recording') {
      this.finish(true);
    }
  }

  /** 取消(播放继续)。收带窗口期内取消同样生效。 */
  cancel(): void {
    this.finish(false, new FilmError('cancelled', '导出已取消'));
  }

  /**
   * 收尾。ok=true 走收带与成片校验,否则带错 reject。幂等:只有第一次生效;
   * 例外是收带窗口期(已调 stop、onstop 还没来)里的失败/取消 —— 记下来,交付时改判 reject。
   */
  finish(ok: boolean, err?: FilmError): void {
    if (this.stage === 'finished') {
      return;
    }
    if (this.stage === 'stopping') {
      if (!ok) {
        this.pendingError ??= err ?? new FilmError('cancelled', '导出已取消');
      }
      return;
    }
    this.unsubscribeVisibility();
    if (!ok) {
      this.stage = 'finished';
      try {
        if (this.recorder.state !== 'inactive') {
          this.recorder.stop();
        }
      } catch {
        // 忽略,本来就要丢弃。
      }
      this.release();
      this.notifyFinish();
      this.rejectDone(err ?? new FilmError('cancelled', '导出已取消'));
      return;
    }
    this.stage = 'stopping';
    this.notifyFinish();
    try {
      if (this.recorder.state !== 'inactive') {
        this.recorder.onstop = (): void => this.deliver();
        this.recorder.stop();
      } else {
        this.deliver();
      }
    } catch (e) {
      this.stage = 'finished';
      this.release();
      this.rejectDone(new FilmError('recorder', `编码器收带失败:${describeError(e)}`));
    }
  }

  private compositeOnce(frame: RecorderFrame): void {
    try {
      const main = this.init.main;
      const { rect, scale } = exportGeometry(
        main.width,
        main.height,
        this.init.mainCssWidth(),
        this.width,
        this.height,
      );
      compositeFrame(this.ctx, this.width, this.height, {
        main,
        mainRect: rect,
        scale,
        veilAlpha: frame.veilAlpha,
        veilColor: this.init.veilColor,
        subtitle: frame.subtitle,
      });
      this.frames += 1;
      this.frameErrors = 0;
    } catch (e) {
      this.frameErrors += 1;
      if (this.frameErrors === 1) {
        console.error('[export] 导出合成抛错,本帧丢弃', e);
      }
      if (this.frameErrors > MAX_FRAME_ERRORS) {
        this.finish(
          false,
          new FilmError(
            'composite',
            `导出合成连续 ${this.frameErrors} 帧失败:${describeError(e)}`,
            describeError(e),
          ),
        );
      }
    }
  }

  /** 进度回调与合成成败无关:宿主回调抛错只记一次日志,不能让它拖垮合成。 */
  private reportProgress(position: number): void {
    const cb = this.init.options?.onProgress;
    if (!cb) {
      return;
    }
    try {
      cb(Math.min(this.init.total, Math.max(0, position)), this.init.total);
    } catch (e) {
      if (!this.progressFailed) {
        this.progressFailed = true;
        console.error('[export] onProgress 回调抛错(已忽略,录制继续)', e);
      }
    }
  }

  /** 编码链路看门狗:MediaRecorder 的断流是静默的,不查就只能录完才发现是空的。 */
  private watch(now: number): void {
    const tracks =
      typeof this.stream.getVideoTracks === 'function' ? this.stream.getVideoTracks() : [];
    const track = tracks[0];
    const muted = track && typeof track.muted === 'boolean' ? track.muted : null;
    if (muted === true) {
      this.mutedSince ??= now;
    } else {
      this.mutedSince = null;
    }
    const health: RecorderHealth = {
      mimeType: this.mimeType,
      recorderState: typeof this.recorder.state === 'string' ? this.recorder.state : 'unknown',
      trackState: !track ? 'unknown' : track.readyState === 'ended' ? 'ended' : 'live',
      mutedMs: muted === null ? null : this.mutedSince === null ? 0 : now - this.mutedSince,
      streamActive: typeof this.stream.active === 'boolean' ? this.stream.active : null,
      tainted: isCanvasTainted(this.out, this.probe),
      frames: this.frames,
      chunkCount: this.chunks.length,
      msSinceData: this.lastChunkAt !== null ? now - this.lastChunkAt : null,
    };
    const failure = diagnoseRecorderStall(health);
    if (failure) {
      this.finish(false, new FilmError(failure.code, failure.message));
    }
  }

  private deliver(): void {
    this.stage = 'finished';
    this.release();
    if (this.pendingError) {
      this.rejectDone(this.pendingError);
      return;
    }
    // 用编码器实际选用的类型(可能带 codecs),拿不到再退回请求值。
    const type = this.recorder.mimeType || this.mimeType;
    const blob = this.env.makeBlob(this.chunks, type);
    const seconds =
      this.startedAt !== null ? Math.max(0, (this.now() - this.startedAt) / 1000) : 0;
    const sample = { frames: this.frames, seconds, bytes: blob.size };
    const verdict = validateOutput(sample);
    if (verdict === null) {
      this.resolveDone(blob);
      return;
    }
    const stats = outputStats({
      ...sample,
      mimeType: type,
      width: this.width,
      height: this.height,
      chunks: this.chunks.length,
    });
    this.rejectDone(
      verdict === 'empty-output'
        ? new FilmError('empty-output', `导出失败:成片是空的(合成端没出帧)。${stats}`, stats)
        : new FilmError(
            'encoder-starved',
            `导出失败:成片是空的(合成端正常,但编码器几乎没收到帧)。${stats}`,
            stats,
          ),
    );
  }

  private release(): void {
    for (const t of this.stream.getTracks()) {
      try {
        t.stop();
      } catch {
        // 忽略:轨道已经结束。
      }
    }
    this.out.remove();
  }

  private notifyFinish(): void {
    try {
      this.init.onFinish?.(this);
    } catch (e) {
      console.error('[export] onFinish 回调抛错', e);
    }
  }
}
