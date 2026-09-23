import type { FrameClock } from '../engine';
import type { SubtitleVisual } from '../export/composite';
import { compositeFrame } from '../export/composite';
import type { VideoEncoderSink } from '../export/encoder';
import type { OfflineEnv } from '../export/offlineEnv';
import { DEFAULT_MAX_LONG_EDGE, exportGeometry, exportSize } from '../export/output';
import { MAX_FRAME_ERRORS } from '../export/recorder';
import type { ExportHandle, ExportOptions } from '../export/types';
import { FilmError, describeError, isFilmError } from '../export/types';
import { FilmDriver } from './driver';
import type { FilmPlan } from './timeline';
import { subtitleAt, subtitleSafeBottom } from './timeline';
import { Veil } from './transition';
import type { Segment, SegmentContext, SegmentErrorPhase } from './types';

/**
 * 确定性离线导出:另起一套无界面的影片驱动,在离屏画布上用虚拟时钟逐帧推进,
 * 每帧合成(主画面 + 白闪 + 字幕,与实时导出同一套合成)后交给 WebCodecs 编码。
 * 时间戳按帧号精确给出,与墙钟无关:比实时快、不掉帧,切到后台也照样导出,
 * 也不占用正在播放的预览(预览和导出是两套互不相干的实例)。
 */

/** 缺省帧率:与实时录制的捕获帧率一致。 */
export const OFFLINE_DEFAULT_FPS = 30;

/** 手动推进的帧时钟:离线导出用它代替 rAF,时间只随帧号前进。 */
export class ManualClock implements FrameClock {
  private time: number;
  private nextId = 1;
  private queue = new Map<number, (time: number) => void>();

  /** 从 1000 起:真实的 rAF 时间戳不会是 0,代码里不该有人拿 0 当「未开始」。 */
  constructor(start = 1000) {
    this.time = start;
  }

  now(): number {
    return this.time;
  }

  request(callback: (time: number) => void): number {
    const id = this.nextId++;
    this.queue.set(id, callback);
    return id;
  }

  cancel(id: number): void {
    this.queue.delete(id);
  }

  /** 排队中的回调数。 */
  get pending(): number {
    return this.queue.size;
  }

  /** 时间前进 ms,跑掉此刻排队的全部回调(回调里新排的留给下一次推进)。 */
  advance(ms: number): void {
    this.advanceTo(this.time + ms);
  }

  /**
   * 时间推进到 time,跑掉此刻排队的全部回调。
   * 按帧号直接算时刻(start + i·1000/fps)再推进,而不是一帧帧累加 33.33…ms:
   * 累加的浮点误差会让「刚好 1 秒」的时间线在第 30 帧差 1e-13 没播满,每段平白多出一帧。
   */
  advanceTo(time: number): void {
    this.time = time;
    const due = this.queue;
    this.queue = new Map();
    for (const callback of due.values()) {
      callback(this.time);
    }
  }
}

export interface OfflineExportInit {
  segments: readonly Segment[];
  plan: FilmPlan;
  /** 预览画布的 css 尺寸:离屏按它排版(构图、横竖屏分支与预览一致),按导出分辨率出图。 */
  cssWidth: number;
  cssHeight: number;
  /** 转场单边时长(毫秒)。 */
  transitionMs: number;
  veilColor: string;
  /** 字幕样式(与预览同一份);null 表示不画字幕。 */
  subtitleVisual: SubtitleVisual | null;
  env: OfflineEnv;
  options?: ExportOptions;
  /**
   * 编码器编不了请求的容器时调用:返回改用的导出(auto 模式回退实时录制)。
   * 不传时以 unsupported-mime 失败。
   */
  fallback?: () => ExportHandle;
  /** 分段出错时回调(跳过出错的分段继续导出)。 */
  reportError?: (error: unknown, info: { segment: string; phase: SegmentErrorPhase }) => void;
}

/** 一次离线导出会话。 */
export interface OfflineExport {
  readonly handle: ExportHandle;
  /** 带指定错误中止(播放器销毁时用 'disposed')。 */
  abort(error: FilmError): void;
}

function sanitizeFps(fps: number | undefined): number {
  return fps !== undefined && Number.isFinite(fps) && fps >= 1 ? Math.min(120, Math.round(fps)) : OFFLINE_DEFAULT_FPS;
}

/**
 * 开始一次离线导出,立即返回句柄;渲染在后台逐帧进行。
 * 生命周期:探测编码器 -> 起离屏驱动(只播一遍)-> 每帧 推进时钟/白闪/让出/合成/编码 -> 播完收尾。
 */
export function exportFilmOffline(init: OfflineExportInit): OfflineExport {
  const opts = init.options;
  const fps = sanitizeFps(opts?.fps);
  const cssW = init.cssWidth > 0 ? init.cssWidth : 1280;
  const cssH = init.cssHeight > 0 ? init.cssHeight : 720;
  // 矢量内容放大不糊:成片长边直接取上限(默认 1920),而不是受屏幕像素比限制。
  const size = exportSize(
    cssW * 16,
    cssH * 16,
    opts?.maxLongEdge ?? opts?.maxWidth ?? DEFAULT_MAX_LONG_EDGE,
  );
  let stopped: FilmError | null = null;
  let delegate: ExportHandle | null = null;
  let resolveDone: (blob: Blob) => void = () => undefined;
  let rejectDone: (e: unknown) => void = () => undefined;
  const done = new Promise<Blob>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  const abort = (error: FilmError): void => {
    stopped ??= error;
    delegate?.cancel();
  };

  let progressFailed = false;
  const reportProgress = (position: number): void => {
    const cb = opts?.onProgress;
    if (!cb) {
      return;
    }
    try {
      cb(Math.min(init.plan.total, Math.max(0, position)), init.plan.total);
    } catch (e) {
      if (!progressFailed) {
        progressFailed = true;
        console.error('[export] onProgress 回调抛错(已忽略,导出继续)', e);
      }
    }
  };

  const render = async (): Promise<Blob | null> => {
    const out = init.env.createCanvas();
    out.width = size.width;
    out.height = size.height;
    const ctx = out.getContext('2d');
    if (!ctx) {
      throw new FilmError('init', '导出初始化失败:拿不到导出画布的 2D 上下文');
    }
    let encoder: VideoEncoderSink | null;
    try {
      encoder = await init.env.encoder({
        canvas: out,
        width: size.width,
        height: size.height,
        fps,
        ...(opts?.mimeType !== undefined ? { mimeType: opts.mimeType } : {}),
      });
    } catch (e) {
      throw new FilmError('encoder', `编码器初始化失败:${describeError(e)}`, describeError(e));
    }
    if (!encoder) {
      return null;
    }
    const sink = encoder;
    if (stopped) {
      await sink.cancel().catch(() => undefined);
      throw stopped;
    }
    const yielder = init.env.createYielder();
    const clock = new ManualClock();
    const main = init.env.createCanvas();
    const veil = new Veil(1);
    const visual = init.subtitleVisual;
    let ended = false;
    let failure: FilmError | null = null;
    const contextFor = (segment: Segment): SegmentContext => ({
      ...(visual && (segment.subtitles?.length ?? 0) > 0
        ? { safeArea: { bottom: subtitleSafeBottom(visual) } }
        : {}),
      clock,
      viewport: { width: cssW, height: cssH, pixelRatio: size.width / cssW },
    });
    const driver = new FilmDriver({
      canvas: main,
      segments: init.segments,
      starts: init.plan.starts,
      total: init.plan.total,
      loop: false,
      transitionMs: init.transitionMs,
      veil,
      hooks: {
        beforeSegment: () => undefined,
        segmentStarted: () => undefined,
        contextFor,
        passEnded: () => undefined,
        // 离线实例只播一遍:不走导出锁,片尾照常结束。
        isExporting: () => false,
        allSegmentsFailed: () => {
          failure ??= new FilmError('segments-failed', '所有分段都启动失败,导出中止');
        },
        crashed: (e) => {
          failure ??= new FilmError(
            'crashed',
            `播放器异常退出:${describeError(e)}`,
            describeError(e),
          );
        },
        ended: () => {
          ended = true;
        },
        reportError: (error, info) => {
          if (init.reportError) {
            init.reportError(error, info);
            return;
          }
          console.error(
            `[export] 分段「${info.segment}」${info.phase === 'start' ? '启动失败' : '播放出错'}`,
            error,
          );
        },
        pausedChanged: () => undefined,
        wake: () => undefined,
      },
    });
    const startTime = clock.now();
    // 上限:声明总时长 + 每段两次转场,再放宽一倍。某段的时间线停不下来时不能无限渲染下去。
    const budgetSeconds =
      (init.plan.total + (init.segments.length * 2 * init.transitionMs) / 1000 + 5) * 2;
    const maxFrames = Math.ceil(budgetSeconds * fps);
    let frameErrors = 0;
    try {
      driver.start();
      for (let i = 0; ; i++) {
        if (i > 0) {
          clock.advanceTo(startTime + (i * 1000) / fps);
        }
        veil.tick(clock.now(), false);
        // 让出一次:这一帧的动画收尾、分段脚本的下一步、驱动的切段都在这里推进。
        await yielder.yieldTask();
        if (stopped) {
          throw stopped;
        }
        if (failure) {
          throw failure;
        }
        try {
          const segment = driver.currentSegment();
          const text =
            visual && segment ? subtitleAt(segment.subtitles ?? [], driver.segmentElapsed()) : '';
          const { rect, scale } = exportGeometry(main.width, main.height, cssW, size.width, size.height);
          compositeFrame(ctx, size.width, size.height, {
            main,
            mainRect: rect,
            scale,
            veilAlpha: veil.alpha,
            veilColor: init.veilColor,
            subtitle: visual && text !== '' ? { text, visual } : null,
          });
          frameErrors = 0;
        } catch (e) {
          frameErrors += 1;
          if (frameErrors === 1) {
            console.error('[export] 离线合成抛错,本帧沿用上一帧画面', e);
          }
          if (frameErrors > MAX_FRAME_ERRORS) {
            throw new FilmError(
              'composite',
              `导出合成连续 ${frameErrors} 帧失败:${describeError(e)}`,
              describeError(e),
            );
          }
        }
        try {
          await sink.addFrame(i / fps, 1 / fps);
        } catch (e) {
          throw new FilmError('encoder', `视频编码失败:${describeError(e)}`, describeError(e));
        }
        reportProgress(driver.position());
        if (ended) {
          break;
        }
        if (i >= maxFrames) {
          throw new FilmError(
            'overrun',
            `影片播了 ${(i / fps).toFixed(1)} 秒还没结束(声明总时长 ${init.plan.total.toFixed(1)} 秒),导出中止`,
          );
        }
      }
      if (stopped) {
        throw stopped;
      }
      try {
        return await sink.finish();
      } catch (e) {
        throw new FilmError('encoder', `视频收尾失败:${describeError(e)}`, describeError(e));
      }
    } catch (e) {
      await sink.cancel().catch(() => undefined);
      throw e;
    } finally {
      yielder.close();
      driver.dispose();
      veil.dispose();
      // 两张导出分辨率的画布不等 GC,立刻还掉像素缓冲(连着导几次也不攒内存)。
      main.width = 0;
      main.height = 0;
      out.width = 0;
      out.height = 0;
    }
  };

  void render().then(
    (blob) => {
      if (blob) {
        resolveDone(blob);
        return;
      }
      // 编码器编不了请求的容器:auto 模式改走实时录制,否则明确失败。
      if (stopped) {
        rejectDone(stopped);
        return;
      }
      if (!init.fallback) {
        rejectDone(
          new FilmError(
            'unsupported-mime',
            `当前浏览器无法离线编码 ${opts?.mimeType ?? 'MP4 / WebM'}`,
          ),
        );
        return;
      }
      const next = init.fallback();
      delegate = next;
      next.done.then(resolveDone, rejectDone);
    },
    (e: unknown) => {
      rejectDone(
        isFilmError(e) ? e : new FilmError('crashed', `离线导出异常:${describeError(e)}`, describeError(e)),
      );
    },
  );

  const requested = opts?.mimeType ?? 'video/mp4';
  return {
    handle: {
      done,
      get mimeType(): string {
        return delegate?.mimeType ?? requested;
      },
      get mode(): 'offline' | 'realtime' {
        return delegate?.mode ?? 'offline';
      },
      cancel: () => abort(new FilmError('cancelled', '导出已取消')),
    },
    abort,
  };
}
