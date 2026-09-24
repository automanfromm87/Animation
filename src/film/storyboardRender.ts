import { lightTheme } from '../engine';
import type { ExportProgress, ExportSubtitle, MainRect, ProgressVisual, SubtitleVisual } from '../export/composite';
import { compositeFrame, subtitleBlock } from '../export/composite';
import { messageChannelYielder } from '../export/offlineEnv';
import { exportGeometry } from '../export/output';
import { FilmError, describeError } from '../export/types';
import { ManualClock, OFFLINE_DEFAULT_FPS } from './offline';
import type { FastForwardResult } from './preview';
import { fastForwardTo } from './preview';
import type { StoryboardCaption, StoryboardFrame } from './storyboard';
import { STORYBOARD_TAIL_SECONDS, groupFramesBySegment, sheetLayout, veilAlphaAt } from './storyboard';
import type { FilmPlan } from './timeline';
import {
  progressFraction,
  resolveProgressVisual,
  resolveSubtitleVisual,
  subtitleAt,
  subtitleSafeBottom,
} from './timeline';
import type { FilmOptions, Segment, SegmentContext, SegmentHandle } from './types';

/**
 * 故事板的渲染核心:每帧按导出成片合成(主画面 + 白场 + 字幕 + 进度条,与离线导出同一个 compositeFrame、
 * 同一套样式 resolver),画进调用方给的缩略图画布。不碰布局,测试给桩画布就能跑。
 *
 * 一段只挂一次:同一段里的帧按段内时刻递增,fastForwardTo 按「还差多少」接着往前推,
 * 整轮快进的总步数约等于「每段最后一帧的段内秒数之和 × fps」,而不是每帧都从 0 重放。
 * 主画面直接按缩略图分辨率栅格化(固定视口的 pixelRatio = 缩略图宽 / 舞台 css 宽),不先画大图再缩。
 */

/**
 * 段尾帧出完后,再往前推到「声明时长 + 这么多秒」看脚本结束没有;还在跑就在说明里标出来。
 * 与内容时序审计(content.test.ts 的 DURATION_TOLERANCE)同一容差。
 */
export const STORYBOARD_OVERRUN_TOLERANCE = 0.25;

/** 影响成片外观的播放器选项(宿主给 runFilm 什么,就给故事板什么,两边才一致)。 */
export type StoryboardFilmOptions = Pick<
  FilmOptions,
  'transition' | 'transitionColor' | 'subtitles' | 'subtitleStyle' | 'progress' | 'progressStyle'
>;

/** 合成用的样式,一轮解析一次。 */
export interface StoryboardVisuals {
  /** null 表示不画字幕(subtitles:false),这时也不设字幕安全区。 */
  readonly subtitle: SubtitleVisual | null;
  /** null 表示不画进度条(progress:false 或片长为 0)。 */
  readonly progress: ProgressVisual | null;
  readonly veilColor: string;
  /** 转场单边时长(秒)。 */
  readonly transition: number;
}

/**
 * 与 runFilm 同一套 resolver 解析样式,不另写常量。
 * plan 必须是 planFilm(segments, film):progress:false 会改变字幕底距(让出进度条占块)。
 * fontFamily 传宿主容器实际继承到的字体(与 DOM 字幕条、章名继承到的是同一个页面字体)。
 */
export function resolveStoryboardVisuals(
  segments: readonly Segment[],
  plan: FilmPlan,
  cssWidth: number,
  fontFamily: string,
  film?: StoryboardFilmOptions,
): StoryboardVisuals {
  const transition = film?.transition;
  return {
    subtitle:
      film?.subtitles === false ? null : resolveSubtitleVisual(cssWidth, film?.subtitleStyle, plan, fontFamily),
    progress: resolveProgressVisual(segments, film?.progressStyle, plan, cssWidth, fontFamily),
    veilColor: film?.transitionColor ?? lightTheme.background,
    transition: transition !== undefined && Number.isFinite(transition) ? Math.max(0, transition) : 0.6,
  };
}

/** css 像素矩形(舞台坐标,左上角为原点)。 */
export interface StoryboardBox {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/** 布局检查器挂钩收到的上下文。 */
export interface StoryboardOverlayContext {
  /** 缩略图的 2D 上下文:主画面、白场、字幕、进度条都已经合成好了。 */
  readonly ctx: CanvasRenderingContext2D;
  readonly frame: StoryboardFrame;
  /** 实际停到的段内秒数。 */
  readonly elapsed: number;
  /** 排版尺寸(舞台 css 尺寸)。 */
  readonly cssWidth: number;
  readonly cssHeight: number;
  /** 舞台 css → 缩略图像素:x' = rect.x + x · scale(与 compositeFrame 同一套几何)。 */
  readonly rect: MainRect;
  readonly scale: number;
  /**
   * 这一刻的分段句柄:时钟停在 elapsed,回调返回(或它的 Promise 落定)之前不会再推进。
   * 只读:别 dispose / setPaused / resize。检查器要的场景信息若句柄上有(将来的可选方法),从这里取。
   */
  readonly handle: SegmentHandle;
  /** 主画面(缩略图分辨率,只有分段自己画的内容)。 */
  readonly main: HTMLCanvasElement;
  /** 本帧合成用的字幕 / 进度条(没有为 null)。 */
  readonly subtitle: ExportSubtitle | null;
  readonly progress: ExportProgress | null;
  /**
   * 字幕底板的盒(舞台 css 像素,与 outline 同一坐标)和折成的行数;这一帧没有字幕为 null。
   * 与合成时画出来的底板是同一份几何(composite.ts 的 subtitleBlock),检查器不必再复刻折行。
   */
  readonly subtitleBox: (StoryboardBox & { readonly lines: number }) | null;
  /** 在缩略图上描一个问题框(css 像素 → 缩略图像素)。缺省 '#ff2d2d',线宽 max(2, round(缩略图宽 / 320))。 */
  outline(box: StoryboardBox, color?: string): void;
}

export interface StoryboardOverlayResult {
  /** 追加到这张缩略图说明里的文字(如「字幕与公式重叠」)。 */
  readonly notes?: readonly string[];
}

/** 每张缩略图合成完调一次(可异步;渲染会等它,期间分段时钟不动)。 */
export type StoryboardOverlay = (
  o: StoryboardOverlayContext,
) => void | StoryboardOverlayResult | Promise<void | StoryboardOverlayResult>;

/** 一帧的结果(每出一帧回调一次)。 */
export interface StoryboardFrameResult {
  readonly frame: StoryboardFrame;
  readonly status: 'done' | 'failed';
  /** 实际停到的段内秒数:网格取整后通常就等于 frame.offset;脚本比声明时长先结束时更小。 */
  readonly elapsed: number;
  /** 段起点 + elapsed。 */
  readonly position: number;
  /** 实际画上的字幕(无则空串)。 */
  readonly subtitle: string;
  readonly veilAlpha: number;
  /** overlay 返回的 notes(overlay 抛错时是一条「检查器出错:…」)。 */
  readonly notes: readonly string[];
  /** failed:为什么没出;done:这段脚本在此刻之前已经抛过错(帧照出)。 */
  readonly error?: string;
  /**
   * 脚本比声明时长先结束、没走到这一帧的时刻:结束时的段内秒数(= elapsed)。
   * 这一帧和同段之后的帧画的都是结束那一刻;成片里这段会提前切走。
   */
  readonly endedEarly?: number;
  /** 段尾帧:推到声明时长 + STORYBOARD_OVERRUN_TOLERANCE 脚本还没结束,值为查到的段内秒数。 */
  readonly overran?: number;
}

export interface RenderStoryboardInit {
  readonly segments: readonly Segment[];
  /** planStoryboard 的输出(顺序不限,内部按段分组)。 */
  readonly frames: readonly StoryboardFrame[];
  /** planFilm(segments, film):段起点、总时长。 */
  readonly plan: FilmPlan;
  /** 排版尺寸(舞台 css 尺寸,≤ 0 时按 1280×720)。 */
  readonly cssWidth: number;
  readonly cssHeight: number;
  /** 缩略图像素尺寸(thumbnailSize 算好)。主画面直接按它栅格化:pixelRatio = thumbWidth / cssWidth。 */
  readonly thumbWidth: number;
  readonly thumbHeight: number;
  readonly visuals: StoryboardVisuals;
  /** 取这一帧要画进的画布(视图给它自己的 <canvas>,测试给桩)。每次合成前会把它设成缩略图尺寸。 */
  readonly target: (frame: StoryboardFrame) => HTMLCanvasElement;
  /** 建主画面用的离屏画布(一轮一张,各段共用)。 */
  readonly createCanvas: () => HTMLCanvasElement;
  readonly overlay?: StoryboardOverlay;
  /** 每帧出完(或失败)回调。抛错只记一次日志,不影响渲染。 */
  readonly onFrame?: (result: StoryboardFrameResult) => void;
  /** 每步快进前、每帧合成前检查;返回 true 就中止本轮。 */
  readonly shouldAbort?: () => boolean;
  /** 与 planStoryboard 的 fps 一致,缺省 OFFLINE_DEFAULT_FPS;快进步长 = 1/fps。 */
  readonly fps?: number;
  /** 让出任务;缺省本轮建一个 messageChannelYielder,结束时 close。 */
  readonly yieldTask?: () => Promise<void>;
}

export interface RenderStoryboardResult {
  readonly done: number;
  readonly failed: number;
  readonly aborted: boolean;
}

/**
 * 按段顺序逐帧渲染,出一帧回调一帧(调用方据此逐张显示)。
 * 字幕、进度、白场都按实际停到的 elapsed 算(与离线导出用 driver.segmentElapsed() 同一口径)。
 * 段尾 0.6 秒的淡出发生在全片时刻不再前进的时候,没有对应的全片时刻,故事板不表现它。
 */
export async function renderStoryboard(init: RenderStoryboardInit): Promise<RenderStoryboardResult> {
  const fpsRaw = init.fps;
  const fps = fpsRaw !== undefined && Number.isFinite(fpsRaw) && fpsRaw >= 1 ? fpsRaw : OFFLINE_DEFAULT_FPS;
  const step = 1 / fps;
  const own = init.yieldTask ? null : messageChannelYielder();
  const yieldTask = init.yieldTask ?? (() => (own as NonNullable<typeof own>).yieldTask());
  const abort = (): boolean => init.shouldAbort?.() === true;
  const cssW = init.cssWidth > 0 && init.cssHeight > 0 ? init.cssWidth : 1280;
  const cssH = init.cssWidth > 0 && init.cssHeight > 0 ? init.cssHeight : 720;
  const thumbW = Math.max(1, Math.round(init.thumbWidth));
  const thumbH = Math.max(1, Math.round(init.thumbHeight));
  const { visuals, plan } = init;
  const viewport = { width: cssW, height: cssH, pixelRatio: thumbW / cssW };
  let done = 0;
  let failed = 0;
  let frameCallbackWarned = false;
  let overlayWarned = false;
  const emit = (result: StoryboardFrameResult): void => {
    if (result.status === 'done') {
      done += 1;
    } else {
      failed += 1;
    }
    try {
      init.onFrame?.(result);
    } catch (e) {
      if (!frameCallbackWarned) {
        frameCallbackWarned = true;
        console.warn('[storyboard] onFrame 回调抛错(已忽略)', e);
      }
    }
  };
  const fail = (frame: StoryboardFrame, error: string): void => {
    // 没出成的帧按计划值报时刻和字幕,说明里照样写得出「哪段、第几秒、在说什么」。
    emit({
      frame,
      status: 'failed',
      elapsed: frame.offset,
      position: frame.position,
      subtitle: visuals.subtitle ? frame.subtitle : '',
      veilAlpha: 0,
      notes: [],
      error,
    });
  };
  const aborted = (): RenderStoryboardResult => ({ done, failed, aborted: true });
  const main = init.createCanvas();
  try {
    for (const group of groupFramesBySegment(init.frames)) {
      if (abort()) {
        return aborted();
      }
      const segment = init.segments[group.index];
      if (!segment) {
        for (const f of group.frames) {
          fail(f, '分段不存在');
        }
        continue;
      }
      const clock = new ManualClock();
      // 快进的时间网格从挂载时刻数起:分几次接着推,每一步的时刻也和单帧预览从 0 推的一模一样。
      const origin = clock.now();
      const forward = { step, yieldTask, shouldAbort: abort, origin };
      // 与离线导出给分段的上下文同一口径(有字幕的段才设安全区)。
      const context: SegmentContext = {
        ...(visuals.subtitle && (segment.subtitles?.length ?? 0) > 0
          ? { safeArea: { bottom: subtitleSafeBottom(visuals.subtitle) } }
          : {}),
        clock,
        viewport,
      };
      let handle: SegmentHandle;
      try {
        handle = segment.play(main, context);
      } catch (e) {
        for (const f of group.frames) {
          fail(f, `分段启动失败:${describeError(e)}`);
        }
        continue;
      }
      let scriptError: string | null = null;
      /** 脚本(done)已经落定:用来分辨「脚本提前结束」和「声明时长到了还在跑」。 */
      let settled = false;
      // 立刻接住:脚本报错不能变成未处理拒绝,并且要写进之后那几帧的说明。
      Promise.resolve(handle.done).then(
        () => {
          settled = true;
        },
        (e: unknown) => {
          settled = true;
          scriptError ??= describeError(e);
        },
      );
      const last = group.frames[group.frames.length - 1];
      let remaining = [...group.frames];
      try {
        while (remaining.length > 0) {
          const f = remaining[0] as StoryboardFrame;
          if (abort()) {
            return aborted();
          }
          const r = await fastForwardTo(handle, clock, f.offset, forward);
          if (r.aborted || abort()) {
            return aborted();
          }
          // 推不到计划时刻(差过半步)而脚本已经正常结束:时间线比声明时长短(抛错结束的由 error 说明)。
          const endedEarly =
            settled && scriptError === null && r.elapsed < f.offset - step / 2 ? r.elapsed : undefined;
          const elapsed = Math.min(r.elapsed, segment.duration);
          const subtitle = visuals.subtitle ? subtitleAt(segment.subtitles ?? [], elapsed) : '';
          const position = (plan.starts[f.index] ?? 0) + elapsed;
          const veilAlpha = veilAlphaAt(elapsed, visuals.transition);
          const out = init.target(f);
          out.width = thumbW;
          out.height = thumbH;
          const ctx = out.getContext('2d');
          if (!ctx) {
            remaining = remaining.slice(1);
            fail(f, '拿不到缩略图的 2D 上下文');
            continue;
          }
          const { rect, scale } = exportGeometry(main.width, main.height, cssW, thumbW, thumbH);
          const sub: ExportSubtitle | null =
            visuals.subtitle && subtitle !== '' ? { text: subtitle, visual: visuals.subtitle } : null;
          const bar: ExportProgress | null = visuals.progress
            ? { value: progressFraction(position, plan.total), visual: visuals.progress }
            : null;
          try {
            compositeFrame(ctx, thumbW, thumbH, {
              main,
              mainRect: rect,
              scale,
              veilAlpha,
              veilColor: visuals.veilColor,
              subtitle: sub,
              progress: bar,
            });
          } catch (e) {
            remaining = remaining.slice(1);
            fail(f, `合成失败:${describeError(e)}`);
            continue;
          }
          let notes: readonly string[] = [];
          if (init.overlay) {
            const block = sub ? subtitleBlock(ctx, rect, scale, sub) : null;
            const subtitleBox = block
              ? {
                  x: (block.x - rect.x) / scale,
                  y: (block.y - rect.y) / scale,
                  w: block.w / scale,
                  h: block.h / scale,
                  lines: block.lines.length,
                }
              : null;
            const lineWidth = Math.max(2, Math.round(thumbW / 320));
            const outline = (box: StoryboardBox, color = '#ff2d2d'): void => {
              ctx.save();
              ctx.strokeStyle = color;
              ctx.lineWidth = lineWidth;
              ctx.strokeRect(
                Math.round(rect.x + box.x * scale),
                Math.round(rect.y + box.y * scale),
                Math.round(box.w * scale),
                Math.round(box.h * scale),
              );
              ctx.restore();
            };
            try {
              const result = await init.overlay({
                ctx,
                frame: f,
                elapsed,
                cssWidth: cssW,
                cssHeight: cssH,
                rect,
                scale,
                handle,
                main,
                subtitle: sub,
                progress: bar,
                subtitleBox,
                outline,
              });
              if (result && Array.isArray(result.notes)) {
                notes = result.notes.map(String);
              }
            } catch (e) {
              if (!overlayWarned) {
                overlayWarned = true;
                console.warn('[storyboard] 检查器(overlay)抛错,这一轮只报一次', e);
              }
              notes = [`检查器出错:${describeError(e)}`];
            }
            if (abort()) {
              return aborted();
            }
          }
          // 段尾帧(这段的最后一帧、离段尾不到 STORYBOARD_TAIL_SECONDS):缩略图已经合成完,
          // 再往前推到声明时长 + 容差看脚本结束没有。只推零点几秒;段中的帧不查(要多推整段)。
          let overran: number | undefined;
          if (f === last && !settled && f.offset >= segment.duration - STORYBOARD_TAIL_SECONDS - 1e-6) {
            let check: FastForwardResult | null = null;
            try {
              check = await fastForwardTo(handle, clock, segment.duration + STORYBOARD_OVERRUN_TOLERANCE, forward);
            } catch {
              // 往后推时脚本崩了:这一帧已经画好,只是查不成时长,不算失败。
            }
            if (check?.aborted === true || abort()) {
              return aborted();
            }
            if (check && !settled) {
              overran = check.elapsed;
            }
          }
          remaining = remaining.slice(1);
          emit({
            frame: f,
            status: 'done',
            elapsed,
            position,
            subtitle,
            veilAlpha,
            notes,
            ...(scriptError !== null ? { error: scriptError } : {}),
            ...(endedEarly !== undefined ? { endedEarly } : {}),
            ...(overran !== undefined ? { overran } : {}),
          });
        }
      } catch (e) {
        // fastForwardTo 本身抛错(分段 render 崩了之类)的兜底:这段剩下的帧都算失败。
        for (const f of remaining) {
          fail(f, describeError(e));
        }
      } finally {
        try {
          handle.dispose();
        } catch {
          // 用完即弃的句柄,释放失败不影响下一段。
        }
      }
    }
    return { done, failed, aborted: false };
  } finally {
    own?.close();
    // 主画布不等 GC,立刻还掉像素缓冲(连着重画几轮也不攒内存)。
    main.width = 0;
    main.height = 0;
  }
}

/** 联系表上的一格。canvas 为 null 表示这帧还没出 / 失败,画占位。 */
export interface SheetEntry {
  readonly canvas: HTMLCanvasElement | null;
  readonly caption: StoryboardCaption;
}

export interface StoryboardSheetOptions {
  readonly createCanvas: () => HTMLCanvasElement;
  readonly thumbWidth: number;
  readonly thumbHeight: number;
  /** 片名(标题行「片名 · 故事板 · N 帧」)。 */
  readonly title?: string;
  readonly fontFamily?: string;
  readonly columns?: number;
}

/** 超宽的一行按 measureText 二分截断,末尾加「…」。 */
export function fitText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string {
  if (!(maxWidth > 0)) {
    return '';
  }
  if (ctx.measureText(text).width <= maxWidth) {
    return text;
  }
  const chars = Array.from(text);
  let lo = 0;
  let hi = chars.length;
  // 找最长的前缀 p,使 p + '…' 放得下。
  while (lo < hi) {
    const mid = Math.ceil((lo + hi) / 2);
    if (ctx.measureText(`${chars.slice(0, mid).join('')}…`).width <= maxWidth) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  const out = `${chars.slice(0, lo).join('')}…`;
  return ctx.measureText(out).width <= maxWidth ? out : '';
}

const SHEET_BACKGROUND = '#141414';
const SHEET_PLACEHOLDER = '#2a2a2a';
const SHEET_TEXT = '#ffffff';
const SHEET_MUTED = '#cfcfcf';
const SHEET_FLAG = '#f5c56b';

/**
 * 把各帧的缩略图和说明拼成一张联系表(排版见 sheetLayout)。太大时整体缩小,不超画布上限。
 * 说明与网页上同一份文案(storyboardCaption),每格三行:时刻 · 段 / 段内秒数 + 标记 / 字幕。
 */
export function composeStoryboardSheet(
  entries: readonly SheetEntry[],
  options: StoryboardSheetOptions,
): HTMLCanvasElement {
  const layout = sheetLayout({
    count: entries.length,
    thumbWidth: options.thumbWidth,
    thumbHeight: options.thumbHeight,
    ...(options.columns !== undefined ? { columns: options.columns } : {}),
  });
  const canvas = options.createCanvas();
  canvas.width = Math.max(1, Math.round(layout.width * layout.scale));
  canvas.height = Math.max(1, Math.round(layout.height * layout.scale));
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.width = 0;
    canvas.height = 0;
    throw new FilmError('unsupported', '拿不到联系表画布的 2D 上下文');
  }
  const family = options.fontFamily ?? 'sans-serif';
  const { gap, fontPx, cellWidth } = layout;
  const thumbH = layout.cellHeight - layout.captionHeight;
  const lineH = fontPx * 1.35;
  ctx.save();
  ctx.scale(layout.scale, layout.scale);
  ctx.fillStyle = SHEET_BACKGROUND;
  ctx.fillRect(0, 0, layout.width, layout.height);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.font = `bold ${Math.round(fontPx * 1.2)}px ${family}`;
  ctx.fillStyle = SHEET_TEXT;
  const title = `${options.title !== undefined && options.title !== '' ? `${options.title} · ` : ''}故事板 · ${entries.length} 帧`;
  ctx.fillText(fitText(ctx, title, layout.width - gap * 2), gap, gap / 2 + layout.headerHeight / 2);
  ctx.font = `${fontPx}px ${family}`;
  entries.forEach((entry, i) => {
    const cell = layout.cells[i];
    if (!cell) {
      return;
    }
    const thumb = entry.canvas;
    if (thumb && thumb.width > 0 && thumb.height > 0) {
      ctx.drawImage(thumb, cell.x, cell.y, cellWidth, thumbH);
    } else {
      ctx.fillStyle = SHEET_PLACEHOLDER;
      ctx.fillRect(cell.x, cell.y, cellWidth, thumbH);
    }
    const lineY = (j: number): number => cell.y + thumbH + gap / 2 + lineH * (j + 0.5);
    const c = entry.caption;
    ctx.fillStyle = SHEET_TEXT;
    ctx.fillText(fitText(ctx, `${c.time} · ${c.segment}`, cellWidth), cell.x, lineY(0));
    ctx.fillStyle = SHEET_MUTED;
    const local = fitText(ctx, c.local, cellWidth);
    ctx.fillText(local, cell.x, lineY(1));
    if (c.flags.length > 0) {
      const dx = ctx.measureText(`${local}  `).width;
      const flags = fitText(ctx, c.flags.join(';'), cellWidth - dx);
      if (flags !== '') {
        ctx.fillStyle = SHEET_FLAG;
        ctx.fillText(flags, cell.x + dx, lineY(1));
      }
    }
    ctx.fillStyle = SHEET_TEXT;
    ctx.fillText(fitText(ctx, c.subtitle, cellWidth), cell.x, lineY(2));
  });
  ctx.restore();
  return canvas;
}
