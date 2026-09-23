import type { SubtitleVisual } from '../export/composite';
import type { FilmOptions, Segment, Subtitle, SubtitleStyle } from './types';

/** 清单总时长(秒)。 */
export function filmDuration(segments: readonly Segment[]): number {
  return segments.reduce((s, g) => s + g.duration, 0);
}

/** 各段起点(秒)的前缀和,长度 = 段数;配合总时长就是完整的时间轴。 */
export function segmentStarts(segments: readonly Segment[]): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const s of segments) {
    out.push(acc);
    acc += s.duration;
  }
  return out;
}

/** 进度比例(0~1)对应的分段序号,点击跳转用,越界夹紧。 */
export function segmentIndexAt(segments: readonly Segment[], frac: number): number {
  const total = filmDuration(segments);
  const t = Math.min(1, Math.max(0, Number.isFinite(frac) ? frac : 0)) * total;
  let acc = 0;
  for (let i = 0; i < segments.length; i += 1) {
    const seg = segments[i];
    if (!seg) {
      continue;
    }
    if (t < acc + seg.duration || i === segments.length - 1) {
      return i;
    }
    acc += seg.duration;
  }
  return 0;
}

/** 绝对秒数定位到段:段序号 + 段内偏移(秒)。跳转与单帧预览都从这里算。 */
export interface SegmentAtTime {
  index: number;
  /** 段内偏移,钳在 [0, duration]。 */
  offset: number;
}

/** 把全片秒数定位到某段的段内偏移。越界夹紧到片头/片尾,非有限值落在第 0 段开头。 */
export function segmentAtTime(
  segments: readonly Segment[],
  starts: readonly number[],
  total: number,
  seconds: number,
): SegmentAtTime {
  const n = segments.length;
  if (n === 0 || !(total > 0)) {
    return { index: 0, offset: 0 };
  }
  const t = Math.min(total, Math.max(0, Number.isFinite(seconds) ? seconds : 0));
  let index = 0;
  for (let i = 0; i < n; i += 1) {
    const start = starts[i] ?? 0;
    const duration = segments[i]?.duration ?? 0;
    if (t < start + duration || i === n - 1) {
      index = i;
      break;
    }
  }
  const duration = segments[index]?.duration ?? 0;
  return { index, offset: Math.min(Math.max(0, t - (starts[index] ?? 0)), duration) };
}

/** 各段起点在全片中的比例(0~1),进度条刻度用。 */
export function segmentTicks(segments: readonly Segment[]): number[] {
  const total = filmDuration(segments);
  return segmentStarts(segments).map((start) => (total > 0 ? start / total : 0));
}

/** elapsed 时刻的字幕文本,无则空串。 */
export function subtitleAt(subs: readonly Subtitle[], elapsed: number): string {
  const current = subs.find((s) => elapsed >= s.start && elapsed < s.end);
  return current ? current.text : '';
}

/** 底部进度条占块高度(px):有章名时要给标签留一行。 */
export const BAR_BLOCK_WITH_CHAPTERS_PX = 38;
export const BAR_BLOCK_PLAIN_PX = 18;
/** 字幕与底部进度条之间至少留的间隙。 */
const SUBTITLE_GAP_ABOVE_BAR_PX = 10;

/** 由清单和选项一次算好的排片信息。 */
export interface FilmPlan {
  total: number;
  starts: number[];
  hasChapters: boolean;
  progressOn: boolean;
  barPosition: 'top' | 'bottom';
  /** 进度条占块高度(关闭时为 0)。 */
  barBlockPx: number;
}

export function planFilm(segments: readonly Segment[], options?: FilmOptions): FilmPlan {
  const total = filmDuration(segments);
  const hasChapters = segments.some((s) => s.chapter !== undefined);
  const progressOn = options?.progress !== false && total > 0;
  return {
    total,
    starts: segmentStarts(segments),
    hasChapters,
    progressOn,
    barPosition: options?.progressStyle?.position ?? 'bottom',
    barBlockPx: !progressOn ? 0 : hasChapters ? BAR_BLOCK_WITH_CHAPTERS_PX : BAR_BLOCK_PLAIN_PX,
  };
}

const clampPx = (v: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, Math.round(v)));

/** 字幕底板的默认样式(直播与导出共用)。 */
export const SUBTITLE_DEFAULTS = {
  color: '#fff',
  background: 'rgba(0,0,0,0.65)',
  padX: 16,
  padY: 6,
  radius: 8,
  lineHeight: 1.35,
  maxWidthRatio: 0.8,
} as const;

/**
 * 按画布 css 宽度解析字幕视觉样式。尺寸跟画布宽度走,换屏自适应;
 * 底部进度条时字幕要让出进度条占块,顶部进度条则不必。
 */
export function resolveSubtitleVisual(
  viewportWidth: number,
  style: SubtitleStyle | undefined,
  plan: FilmPlan,
  fontFamily: string,
): SubtitleVisual {
  const vw = viewportWidth > 0 ? viewportWidth : 1280;
  const barReserve =
    plan.barPosition === 'bottom' && plan.barBlockPx > 0
      ? plan.barBlockPx + SUBTITLE_GAP_ABOVE_BAR_PX
      : 0;
  return {
    fontPx: style?.fontSize ?? clampPx(vw * 0.016, 14, 20),
    fontFamily: style?.fontFamily ?? fontFamily,
    color: style?.color ?? SUBTITLE_DEFAULTS.color,
    background: style?.background ?? SUBTITLE_DEFAULTS.background,
    padX: SUBTITLE_DEFAULTS.padX,
    padY: SUBTITLE_DEFAULTS.padY,
    radius: SUBTITLE_DEFAULTS.radius,
    lineHeight: SUBTITLE_DEFAULTS.lineHeight,
    bottomPx: style?.bottom ?? Math.max(clampPx(vw * 0.028, 24, 36), barReserve),
    maxWidthRatio: SUBTITLE_DEFAULTS.maxWidthRatio,
  };
}

/** 有字幕的分段给 Scene 的底部安全区:字幕块整体高度 + 一点呼吸空间(单行估算)。 */
export function subtitleSafeBottom(visual: SubtitleVisual): number {
  return Math.round(
    visual.bottomPx + visual.fontPx * visual.lineHeight + visual.padY * 2 + 12,
  );
}

/** 进度条章名标签字号。 */
export function progressLabelPx(viewportWidth: number): number {
  return clampPx((viewportWidth > 0 ? viewportWidth : 1280) * 0.011, 10, 14);
}

const NUMERALS = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];

/** 第 n 章(0 起)的编号:前九章用中文数字,之后用阿拉伯数字,而不是悄悄没了编号。 */
export function chapterNumeral(n: number): string {
  return NUMERALS[n] ?? String(n + 1);
}

/** 从 from 起沿 dir 方向找下一个章节卡的序号;没有则返回 null。 */
export function nextChapterIndex(
  segments: readonly Segment[],
  from: number,
  dir: 1 | -1,
): number | null {
  for (let i = from + dir; i >= 0 && i < segments.length; i += dir) {
    if (segments[i]?.marker === 'chapter') {
      return i;
    }
  }
  return null;
}
