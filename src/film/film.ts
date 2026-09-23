import { browserClock, lightTheme } from '../engine';
import { browserOfflineEnv } from '../export/offlineEnv';
import { ExportRecorder } from '../export/recorder';
import type { RecorderFrame } from '../export/recorder';
import type { ExportHandle, ExportOptions } from '../export/types';
import { FilmError, describeError, isFilmError } from '../export/types';
import type { ChromeState, FilmChrome } from './chrome';
import { NULL_CHROME, createDomChrome } from './chrome';
import { FilmDriver } from './driver';
import type { OfflineExport } from './offline';
import { ManualClock, exportFilmOffline } from './offline';
import { fastForwardTo } from './preview';
import {
  planFilm,
  progressLabelPx,
  resolveSubtitleVisual,
  segmentAtTime,
  subtitleAt,
  subtitleSafeBottom,
} from './timeline';
import { Veil } from './transition';
import type {
  FilmController,
  FilmOptions,
  FilmState,
  Segment,
  SegmentContext,
  SegmentErrorPhase,
} from './types';

// 对外 API 统一从这里导出(宿主与内容脚本只 import './film')。
export type {
  FilmController,
  FilmOptions,
  FilmState,
  ProgressStyle,
  Segment,
  SegmentContext,
  SegmentErrorPhase,
  SegmentHandle,
  Subtitle,
  SubtitleStyle,
} from './types';
export type { ExportHandle, ExportMode, ExportOptions, FilmErrorCode } from '../export/types';
export { FilmError, isFilmError } from '../export/types';
export type { RecorderHealth, StallDiagnosis } from '../export/watchdog';
export { diagnoseRecorderStall } from '../export/watchdog';
export { filmDuration, segmentAtTime, segmentIndexAt, segmentTicks, subtitleAt } from './timeline';
export type { SegmentAtTime } from './timeline';
export type { FastForwardOptions, FastForwardResult, PreviewOptions, PreviewResult } from './preview';
export { fastForwardTo, previewFrameAt } from './preview';
export type { CardBuild, CardSegmentOptions, DirectedSegmentOptions, SegmentEnv } from './segments';
export {
  CARD_INTRO_SECONDS,
  cardSegment,
  directedSegment,
  runCard,
  sceneSegmentHandle,
} from './segments';

/** 失败的导出句柄(同步就能判定的错误)。 */
function failedExport(error: FilmError): ExportHandle {
  const done = Promise.reject(error);
  // 调用方可能根本不看 done(比如只关心 cancel),别让它变成未处理拒绝。
  done.catch(() => undefined);
  return { done, mimeType: '', mode: 'realtime', cancel: () => undefined };
}

/** 调用宿主回调:抛错只记日志,不能拖垮播放器。 */
function callHost(name: string, fn: () => void): void {
  try {
    fn();
  } catch (e) {
    console.error(`[film] ${name} 回调抛错(已忽略)`, e);
  }
}

/**
 * runFilm:按清单顺序播放分段,白场转场,带字幕、进度条、暂停、跳转与视频导出。
 * 返回的控制器可直接调用(= dispose)。每个分段播完即释放,片子多长都不漏。
 *
 * 结构:FilmDriver 管调度状态机,Veil 管转场不透明度,FilmChrome 把状态画成 DOM,
 * ExportRecorder 把同一份状态合成进视频;这里只做接线和唯一的一条帧循环。
 */
export function runFilm(
  canvas: HTMLCanvasElement,
  segments: readonly Segment[],
  options?: FilmOptions,
): FilmController {
  if (segments.length === 0) {
    const noop = (): void => undefined;
    const state: FilmState = {
      mode: 'ended',
      index: 0,
      segment: null,
      segmentElapsed: 0,
      position: 0,
      total: 0,
      paused: false,
      exporting: false,
    };
    return Object.assign(noop, {
      dispose: noop,
      seekTo: noop,
      seekToTime: noop,
      setPaused: noop,
      exportVideo: (): ExportHandle =>
        failedExport(new FilmError('no-segments', '影片没有任何分段')),
      getState: (): FilmState => ({ ...state }),
    });
  }

  const plan = planFilm(segments, options);
  const clock = options?.clock ?? browserClock;
  const transitionMs = Math.max(0, options?.transition ?? 0.6) * 1000;
  const veilColor = options?.transitionColor ?? lightTheme.background;
  const showSubtitles = options?.subtitles !== false;
  const veil = new Veil(1);
  let disposed = false;
  let recorder: ExportRecorder | null = null;
  /** 进行中的导出(离线或实时):同一时间只允许一个。 */
  let activeExport: ExportHandle | null = null;
  /** 进行中的离线导出会话(播放器销毁时要中止它)。 */
  let offline: OfflineExport | null = null;
  // ---- 段内跳转的手动时钟 ----
  // 分段没有可拖的时间轴,跳到段内某秒只能重挂该段再快进。
  // 重挂的段跑在一只手动时钟上:快进时由快进循环推进,快进完由帧循环按墙钟增量接着推,
  // 效果与 rAF 时间戳一致,暂停/切段/重建时回到正常时钟。
  /** 待认领的跳转:目标段起播时认领(比对分段对象,起播失败顺延时不认领)。 */
  let armedManual: { clock: ManualClock; segment: Segment; offset: number } | null = null;
  /** 正在跟随墙钟的手动时钟。 */
  let manualFollow: { clock: ManualClock; segment: Segment; lastWall: number } | null = null;
  /** 快进代次:新的跳转/挂载让上一代快进停下来。 */
  let ffGeneration = 0;
  const wallNow = (): number => clock.now();

  // 画布 css 尺寸缓存:只在创建时和 ResizeObserver 回调里读布局,
  // 帧循环里读 clientWidth 会在刚写完 chrome 样式之后强制同步布局。
  const viewport = { width: canvas.clientWidth, height: canvas.clientHeight };
  const narrowNow = (): boolean | null =>
    viewport.width > 0 || viewport.height > 0 ? viewport.width < viewport.height : null;
  /** 当前分段搭建时的横竖屏;翻转后与它比较决定要不要重建。 */
  let builtNarrow: boolean | null = narrowNow();

  let visual = resolveSubtitleVisual(viewport.width, options?.subtitleStyle, plan, 'sans-serif');
  const parent = canvas.parentElement;
  let chrome: FilmChrome = NULL_CHROME;
  if (parent && typeof document !== 'undefined') {
    chrome = createDomChrome({
      parent,
      segments,
      plan,
      veilColor,
      visual,
      labelPx: progressLabelPx(viewport.width),
      ...(options?.progressStyle ? { progressStyle: options.progressStyle } : {}),
      explicitFontFamily: options?.subtitleStyle?.fontFamily !== undefined,
      callbacks: {
        seek: (target) => {
          driver.seek(target);
        },
        seekTime: (seconds) => {
          seekToTime(seconds);
        },
        togglePause: () => {
          driver.setPaused(!driver.paused);
        },
      },
    });
    // 导出合成用字幕条实际继承到的字体,成片与预览才是同一套字。
    if (chrome.fontFamily !== null && options?.subtitleStyle?.fontFamily === undefined) {
      visual = { ...visual, fontFamily: chrome.fontFamily };
    }
  }

  /** 分段出错:交给宿主的 onError,没有就写日志(预览与离线导出共用)。 */
  const reportSegmentError = (
    error: unknown,
    info: { segment: string; phase: SegmentErrorPhase },
  ): void => {
    if (options?.onError) {
      callHost('onError', () => options.onError?.(error, info));
      return;
    }
    console.error(
      `[film] 分段「${info.segment}」${info.phase === 'start' ? '启动失败' : '播放出错'}`,
      error,
    );
  };

  const contextFor = (segment: Segment): SegmentContext => ({
    ...(showSubtitles && (segment.subtitles?.length ?? 0) > 0
      ? { safeArea: { bottom: subtitleSafeBottom(visual) } }
      : {}),
    ...(options?.clock ? { clock: options.clock } : {}),
    // 跳转目标段跑在手动时钟上(快进需要):只认领分段对象一致的挂载。
    ...(armedManual && segment === armedManual.segment ? { clock: armedManual.clock } : {}),
  });

  /** 在目标段上起一次快进。上一代快进(如果还在跑)会被代次中止。 */
  const startFastForward = (segment: Segment, fClock: ManualClock, offset: number): void => {
    ffGeneration += 1;
    const gen = ffGeneration;
    const handle = driver.currentHandle();
    if (!handle || driver.currentSegment() !== segment) {
      return;
    }
    void fastForwardTo(handle, fClock, offset, {
      shouldAbort: () => gen !== ffGeneration || disposed || driver.currentSegment() !== segment,
    }).then(
      (r) => {
        if (gen !== ffGeneration || disposed || r.aborted) {
          return;
        }
        // 快进花掉的墙钟不能算进跟随:重定锚点,否则下一帧跳变。
        if (manualFollow && manualFollow.segment === segment) {
          manualFollow.lastWall = wallNow();
        }
        // 暂停中跳转:帧循环停着,手动唤一次把进度条刷到新位置(刷完自己会停)。
        wake();
      },
      (e: unknown) => reportSegmentError(e, { segment: segment.name, phase: 'play' }),
    );
  };

  const driver: FilmDriver = new FilmDriver({
    canvas,
    segments,
    starts: plan.starts,
    total: plan.total,
    loop: options?.loop ?? true,
    transitionMs,
    veil,
    hooks: {
      beforeSegment: (index, segment) => {
        if (options?.onSegment) {
          callHost('onSegment', () => options.onSegment?.(index, segment));
        }
      },
      segmentStarted: (_index, segment) => {
        builtNarrow = narrowNow();
        if (armedManual && segment === armedManual.segment) {
          // 认领:这段跑在手动时钟上,快进到跳转目标后由帧循环接着跟墙钟。
          const { clock: fClock, offset } = armedManual;
          armedManual = null;
          manualFollow = { clock: fClock, segment, lastWall: wallNow() };
          startFastForward(segment, fClock, offset);
        } else {
          // 任何没被认领的挂载(自然接段、重建、跳转、起播失败后的顺延)都结束手动跟随,
          // 顺手清理掉没认领上的跳转(目标段起播失败)。
          armedManual = null;
          manualFollow = null;
          ffGeneration += 1;
        }
        // 导出段的第一个起播分段:此刻白场正盖满画面,成片从白场淡入开场。
        if (recorder?.armed) {
          recorder.start();
        }
      },
      contextFor,
      passEnded: () => {
        // 导出只录一遍,到片尾收带(还没真正开录时录制器自己会忽略,跟着下一轮从头录)。
        recorder?.endOfPass();
      },
      isExporting: () => recorder !== null,
      allSegmentsFailed: () => {
        console.error('[film] 所有分段都启动失败,播放器停止');
        recorder?.finish(false, new FilmError('segments-failed', '所有分段都启动失败,导出中止'));
      },
      crashed: (e) => {
        console.error('[film] 播放器异常退出', e);
        recorder?.finish(
          false,
          new FilmError('crashed', `播放器异常退出:${describeError(e)}`, describeError(e)),
        );
      },
      ended: () => {
        if (options?.onEnded) {
          callHost('onEnded', () => options.onEnded?.());
        }
      },
      reportError: (error, info) => {
        // 起播失败的跳转不再有认领对象:清掉,免得以后自然挂到同一段时误认领旧偏移。
        // 只清直播驱动的(离线导出共用 reportSegmentError,但它不认领跳转,不碰)。
        if (
          info.phase === 'start' &&
          armedManual &&
          armedManual.segment.name === info.segment
        ) {
          armedManual = null;
        }
        reportSegmentError(error, info);
      },
      pausedChanged: (paused) => {
        // 恢复播放时重定跟随锚点:暂停期间帧循环停着,lastWall 陈旧,不重定下一帧会跳变。
        if (!paused && manualFollow) {
          manualFollow.lastWall = wallNow();
        }
        if (options?.onPausedChange) {
          callHost('onPausedChange', () => options.onPausedChange?.(paused));
        }
      },
      wake: () => wake(),
    },
  });

  // ---- 唯一的帧循环:推进转场 -> 算状态 -> 画 chrome -> 合成导出帧。
  // 以前白闪、字幕/进度条、导出合成各跑一条 rAF,先后顺序全凭偶然。
  let raf = 0;
  const chromeState = (): ChromeState => {
    const segment = driver.currentSegment();
    const elapsed = driver.segmentElapsed();
    const subs = showSubtitles && segment ? (segment.subtitles ?? []) : [];
    return {
      veilAlpha: veil.alpha,
      subtitle: subtitleAt(subs, elapsed),
      progress: plan.total > 0 ? Math.min(1, (driver.completed + elapsed) / plan.total) : 0,
      index: driver.index,
    };
  };
  const recorderFrame = (state: ChromeState): RecorderFrame => ({
    veilAlpha: state.veilAlpha,
    subtitle: state.subtitle === '' ? null : { text: state.subtitle, visual },
    position: driver.position(),
  });
  // 播着、转场中、或者在导出时才需要逐帧跑;暂停时停下(转场也冻结着,白闪自己记得暂停起点),
  // 状态一变再唤醒。
  const needsFrames = (): boolean =>
    !disposed &&
    (recorder !== null ||
      (!driver.paused && (veil.animating || driver.currentSegment() !== null)));
  const frame = (now: number): void => {
    raf = 0;
    if (disposed) {
      return;
    }
    // 手动跟随:跳转后的段跑在手动时钟上,每帧按墙钟增量推进,效果与 rAF 时间戳一致。
    // 快进循环跑的时候这里照推也安全:快进用绝对时刻(advanceTo 会盖掉这里的增量,
    // 时间总量守恒),干跑又让交错进来的泵不画画,进度条还会跟着快进动,挺好。
    const follow = manualFollow;
    if (follow && !driver.paused) {
      const dt = Math.max(0, now - follow.lastWall);
      follow.lastWall = now;
      if (dt > 0) {
        follow.clock.advance(dt);
      }
    }
    veil.tick(now, driver.paused);
    const state = chromeState();
    chrome.render(state);
    // 录制会话的 tick 自己兜住所有异常,不会打断这条循环。
    recorder?.tick(now, recorderFrame(state));
    // 本帧里可能已经被唤醒排过下一帧(比如导出在 tick 里失败收尾 -> onFinish -> wake):
    // 再排一次就成了两条并行的循环,每帧跑两遍。
    if (raf === 0 && needsFrames()) {
      raf = clock.request(frame);
    }
  };
  const wake = (): void => {
    if (raf === 0 && !disposed) {
      raf = clock.request(frame);
    }
  };

  /** 横竖屏翻转:分段的排版分支只在搭建时求值一次,必须重建这一段。 */
  const checkOrientation = (): void => {
    const narrow = narrowNow();
    if (narrow === null) {
      return;
    }
    // 挂载时画布可能还没布局(尺寸为 0):首次拿到尺寸只记录,不当成翻转,免得开局白重播一次。
    if (builtNarrow === null) {
      builtNarrow = narrow;
      return;
    }
    if (narrow !== builtNarrow && driver.canRebuild()) {
      driver.rebuildCurrent();
    }
  };

  let resizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver((entries) => {
      const rect = entries[entries.length - 1]?.contentRect;
      viewport.width = rect ? rect.width : canvas.clientWidth;
      viewport.height = rect ? rect.height : canvas.clientHeight;
      visual = {
        ...resolveSubtitleVisual(viewport.width, options?.subtitleStyle, plan, visual.fontFamily),
        fontFamily: visual.fontFamily,
      };
      chrome.relayout(visual, progressLabelPx(viewport.width));
      // 当前段重设分辨率 + 重取景 + 按新字号更新字幕安全区。
      driver.resizeCurrent();
      checkOrientation();
      wake();
    });
    resizeObserver.observe(canvas);
  }

  /** 实时录制:从第 0 段起墙钟实时录一遍(导出期间锁定用户跳转/暂停/重建)。 */
  const startRealtime = (exportOptions?: ExportOptions): ExportHandle => {
    if (disposed) {
      return failedExport(new FilmError('disposed', '播放器已销毁,无法导出'));
    }
    if (recorder) {
      return failedExport(new FilmError('busy', '已经在导出了'));
    }
    let rec: ExportRecorder;
    try {
      rec = ExportRecorder.create({
        main: canvas,
        mainCssWidth: () => viewport.width,
        veilColor,
        total: plan.total,
        ...(exportOptions ? { options: exportOptions } : {}),
        ...(options?.exportEnv ? { env: options.exportEnv } : {}),
        // 与帧循环交给 tick 的时间戳同源:开录时刻、数据块时刻、成片时长都按这一个钟算。
        now: () => clock.now(),
        onFinish: (r) => {
          if (recorder !== r) {
            return;
          }
          recorder = null;
          if (disposed) {
            return;
          }
          chrome.setSeekEnabled(true);
          // 导出期间翻过屏:现在补上重建。
          const narrow = narrowNow();
          if (narrow !== null && builtNarrow !== null && narrow !== builtNarrow) {
            driver.rebuildCurrent();
          }
          wake();
        },
      });
    } catch (e) {
      return failedExport(
        isFilmError(e)
          ? e
          : new FilmError('init', `导出初始化失败:${describeError(e)}`, describeError(e)),
      );
    }
    // 导出是墙钟实时录制,暂停态下永远录不完:先恢复播放(并通知宿主同步按钮)。
    driver.setPaused(false);
    recorder = rec;
    chrome.setSeekEnabled(false);
    // 从头录:白场盖满后跳回第 0 段(驱动已结束时会被重新叫醒)。开录由分段起播事件触发。
    driver.restartForExport();
    wake();
    return {
      done: rec.done,
      mimeType: rec.mimeType,
      mode: 'realtime',
      cancel: () => rec.cancel(),
    };
  };

  const exportVideo = (exportOptions?: ExportOptions): ExportHandle => {
    if (disposed) {
      return failedExport(new FilmError('disposed', '播放器已销毁,无法导出'));
    }
    if (activeExport || recorder) {
      return failedExport(new FilmError('busy', '已经在导出了'));
    }
    const mode = exportOptions?.mode ?? 'auto';
    const offlineEnv = mode === 'realtime' ? null : (options?.offlineEnv ?? browserOfflineEnv());
    let handle: ExportHandle;
    if (offlineEnv) {
      // 离线:另起一套离屏实例按帧渲染,预览照常播放、照常能跳转。
      const session = exportFilmOffline({
        segments,
        plan,
        cssWidth: viewport.width,
        cssHeight: viewport.height,
        transitionMs,
        veilColor,
        subtitleVisual: showSubtitles ? visual : null,
        env: offlineEnv,
        ...(exportOptions ? { options: exportOptions } : {}),
        // auto:编码器编不了所选容器就退回实时录制;显式要离线则直接失败。
        ...(mode === 'auto' ? { fallback: () => startRealtime(exportOptions) } : {}),
        reportError: reportSegmentError,
      });
      offline = session;
      handle = session.handle;
    } else if (mode === 'offline') {
      return failedExport(
        new FilmError('unsupported', '当前浏览器不支持离线导出(缺少 WebCodecs),请改用实时录制'),
      );
    } else {
      handle = startRealtime(exportOptions);
      if (!recorder) {
        // 初始化就失败了(同步判定的错误):不占导出位。
        return handle;
      }
    }
    activeExport = handle;
    const settle = (): void => {
      if (activeExport === handle) {
        activeExport = null;
        offline = null;
      }
    };
    handle.done.then(settle, settle);
    return handle;
  };

  /**
   * 跳到全片 seconds 处(秒),精确到段内:目标段重挂后快进到偏移处,再跟墙钟续播。
   * 实时录制期间忽略(成片不能被悄悄剪掉一截);离线导出不占用预览,照常能跳。
   */
  const seekToTime = (seconds: number): void => {
    if (disposed || recorder !== null || !Number.isFinite(seconds)) {
      return;
    }
    const { index, offset } = segmentAtTime(segments, plan.starts, plan.total, seconds);
    const target = segments[index];
    if (!target) {
      return;
    }
    // 同一段上继续往前:不用重挂,直接把快进再往前推(拖进度条向前时不闪)。
    if (
      manualFollow &&
      manualFollow.segment === target &&
      driver.currentSegment() === target &&
      offset >= driver.segmentElapsed()
    ) {
      startFastForward(target, manualFollow.clock, offset);
      return;
    }
    armedManual = { clock: new ManualClock(), segment: target, offset };
    driver.seek(index, true);
  };

  const getState = (): FilmState => {
    const segment = driver.currentSegment();
    return {
      mode: driver.mode,
      index: driver.index,
      segment: segment?.name ?? null,
      segmentElapsed: driver.segmentElapsed(),
      position: driver.position(),
      total: plan.total,
      paused: driver.paused,
      exporting: activeExport !== null || recorder !== null,
    };
  };

  const dispose = (): void => {
    if (disposed) {
      return;
    }
    disposed = true;
    recorder?.finish(false, new FilmError('disposed', '播放器已销毁,导出中止'));
    offline?.abort(new FilmError('disposed', '播放器已销毁,导出中止'));
    if (raf !== 0) {
      clock.cancel(raf);
      raf = 0;
    }
    resizeObserver?.disconnect();
    resizeObserver = null;
    // 同步释放当前分段:等驱动的 await 恢复会让新旧两套监听共存一帧以上。
    driver.dispose();
    veil.dispose();
    chrome.dispose();
  };

  driver.start();
  wake();

  return Object.assign(dispose, {
    dispose,
    seekTo: (index: number): void => {
      driver.seek(index);
    },
    seekToTime,
    setPaused: (paused: boolean): void => {
      driver.setPaused(paused);
    },
    exportVideo,
    getState,
  });
}
