import { FilmError } from '../export/types';
import { messageChannelYielder } from '../export/offlineEnv';
import { ManualClock, OFFLINE_DEFAULT_FPS } from './offline';
import type { FilmPlan } from './timeline';
import {
  planFilm,
  resolveSubtitleVisual,
  segmentAtTime,
  subtitleAt,
  subtitleSafeBottom,
} from './timeline';
import type { Segment, SegmentContext, SegmentHandle } from './types';

/**
 * 单帧预览与段内快进。
 * 分段是「从头播的剧本」,没有可拖的时间轴;想看第 8 分钟的画面,
 * 只能把目标段挂起来,用虚拟时钟(ManualClock)快进到段内偏移。
 * 步长与离线导出一致(默认 30fps),逐出来的帧与成片逐像素一致;
 * 干跑(FramePump 照常推进、只跳过栅格化)让几千步的快进不到一秒。
 */

export interface FastForwardOptions {
  /** 步长(秒),默认 1/30。超过 0.5 会被帧泵的停摆钳制吃掉,实际走 0.5。 */
  step?: number;
  /** 每步之后让出任务(分段脚本的下一步在这里续跑)。默认 MessageChannel 让出。 */
  yieldTask?: () => Promise<void>;
  /** 每步之前检查:返回 true 就中止(新的跳转来了、播放器销毁了)。 */
  shouldAbort?: () => boolean;
}

export interface FastForwardResult {
  /** 快进结束时的段内已播秒数。 */
  elapsed: number;
  aborted: boolean;
}

function safeElapsed(handle: SegmentHandle): number {
  try {
    const e = handle.getElapsed();
    return Number.isFinite(e) ? Math.max(0, e) : 0;
  } catch {
    return 0;
  }
}

/**
 * 把已挂载的分段(必须跑在给定的 ManualClock 上)从当前进度推进到 offset 秒。
 * 干跑跳过中间绘制,收尾补一画;中止时不补画(后来者会画)。
 */
export async function fastForwardTo(
  handle: SegmentHandle,
  clock: ManualClock,
  offset: number,
  options?: FastForwardOptions,
): Promise<FastForwardResult> {
  const want = Math.max(0, Number.isFinite(offset) ? offset : 0);
  const stepRaw = options?.step;
  const step = stepRaw !== undefined && Number.isFinite(stepRaw) && stepRaw > 0
    ? Math.min(stepRaw, 0.5)
    : 1 / OFFLINE_DEFAULT_FPS;
  const stepMs = step * 1000;
  const own = options?.yieldTask ? null : messageChannelYielder();
  const yieldTask = options?.yieldTask ?? (() => (own as NonNullable<typeof own>).yieldTask());
  try {
    // 步数按「还差多少」算:同一段上继续往前快进时不用从头来。
    const steps = Math.max(0, Math.round((want - safeElapsed(handle)) / step));
    // 绝对时刻推进(与离线导出同式):相对累加的浮点误差会让「刚好 1 秒」的
    // 时间线差 1e-13 没播满,逐出的帧与成片差一帧。
    const t0 = clock.now();
    handle.setDryRun?.(true);
    try {
      for (let i = 0; i < steps; i += 1) {
        if (options?.shouldAbort?.()) {
          return { elapsed: safeElapsed(handle), aborted: true };
        }
        clock.advanceTo(t0 + (i + 1) * stepMs);
        await yieldTask();
      }
    } finally {
      handle.setDryRun?.(false);
    }
    if (options?.shouldAbort?.()) {
      return { elapsed: safeElapsed(handle), aborted: true };
    }
    // 收尾两连:+0 推进让还活着的帧泵画出来,再直接补一画兜住已空闲的泵。
    clock.advanceTo(clock.now());
    await yieldTask();
    handle.render?.();
    return { elapsed: safeElapsed(handle), aborted: false };
  } finally {
    own?.close();
  }
}

export interface PreviewOptions {
  /** 排片信息,默认现算。直播预览时把播放器的 plan 传进来,安全区与直播一致。 */
  plan?: FilmPlan;
  step?: number;
  yieldTask?: () => Promise<void>;
}

export interface PreviewResult {
  index: number;
  /** 段内偏移(秒)。 */
  offset: number;
  /** 分段名。 */
  name: string;
  /** 该时刻的字幕文本(无则空串)。 */
  subtitle: string;
  /** 全片位置(秒)。 */
  position: number;
}

/**
 * 渲染全片 seconds 处的单帧到 canvas,句柄随即释放(静态帧留在画布上)。
 * 只挂目标段:前面的段不播,所以 8 分钟处的帧也是一两秒就出来。
 */
export async function previewFrameAt(
  segments: readonly Segment[],
  seconds: number,
  canvas: HTMLCanvasElement,
  options?: PreviewOptions,
): Promise<PreviewResult> {
  if (segments.length === 0) {
    throw new FilmError('no-segments', '影片没有任何分段');
  }
  const plan = options?.plan ?? planFilm(segments);
  const { index, offset } = segmentAtTime(segments, plan.starts, plan.total, seconds);
  const segment = segments[index];
  if (!segment) {
    throw new FilmError('no-segments', '影片没有任何分段');
  }
  // 中文回退字要等网页字体:预览只画一次,必须等,不像直播能晚到重画。
  if (typeof document !== 'undefined') {
    const fonts = (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts;
    if (fonts?.ready) {
      await fonts.ready;
    }
  }
  const visual = resolveSubtitleVisual(canvas.clientWidth, undefined, plan, 'sans-serif');
  const clock = new ManualClock();
  const context: SegmentContext = {
    ...(segment.subtitles && segment.subtitles.length > 0
      ? { safeArea: { bottom: subtitleSafeBottom(visual) } }
      : {}),
    clock,
  };
  const handle = segment.play(canvas, context);
  try {
    await fastForwardTo(handle, clock, offset, {
      ...(options?.step !== undefined ? { step: options.step } : {}),
      ...(options?.yieldTask ? { yieldTask: options.yieldTask } : {}),
    });
  } finally {
    handle.dispose();
  }
  return {
    index,
    offset,
    name: segment.name,
    subtitle: subtitleAt(segment.subtitles ?? [], offset),
    position: (plan.starts[index] ?? 0) + offset,
  };
}
