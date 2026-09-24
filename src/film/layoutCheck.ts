import {
  captureRender,
  estimateTextWidth,
  findLayoutIssues,
  inspectSnapshot,
  installEstimatedTextMetrics,
  maxSeverity,
  severityRank,
} from '../engine';
import type {
  Bounds,
  LayoutCheckOptions,
  LayoutFrame,
  LayoutIssue,
  LayoutIssueKind,
  LayoutItem,
  LayoutItemKind,
  LayoutMotion,
  LayoutSeverity,
  LayoutZone,
} from '../engine';
import type { ExportSubtitle, SubtitleVisual } from '../export/composite';
import { wrapSubtitle } from '../export/composite';
import { FilmError, describeError } from '../export/types';
import { ManualClock, OFFLINE_DEFAULT_FPS } from './offline';
import type { PreviewResult } from './preview';
import { fastForwardTo } from './preview';
import type { FilmPlan } from './timeline';
import {
  planFilm,
  resolveSubtitleVisual,
  segmentAtTime,
  subtitleAt,
  subtitleSafeBottom,
} from './timeline';
import type { FilmOptions, Segment, SegmentContext, SegmentHandle } from './types';
import type { DryRunEnv } from './voice';
import { browserDryRunEnv } from './voice';

/**
 * 影片版面检查:按播放器同一口径(固定视口、字幕安全区、ManualClock)挂载分段,
 * 每隔 interval 秒 + 段尾采样一帧,横屏 1280×720 与竖屏 405×720 各跑一遍,
 * 算出此刻的字幕条 / 进度条遮挡区,交给引擎的 findLayoutIssues;跨时间把同一问题合并成时间段,出报告。
 * 另给故事板用的入口:inspectFilmFrames / inspectFrameAt(画缩略图的同一次挂载里拿到该帧的问题与屏幕盒),
 * 以及 checkHandleLayout(已经挂着的分段句柄上查一帧,故事板的 overlay 回调里用)。
 *
 * 安全区与字幕块几何照 film.ts / preview.ts / composite.ts 复刻:那边改了算法,这里要跟着改(测试会提示)。
 */

/** 检查用的画幅(css 尺寸)。 */
export interface LayoutViewport {
  readonly width: number;
  readonly height: number;
  /** 离屏渲染的像素比(故事板缩略图可以给 0.25 省像素),缺省 1。只影响出图,不影响排版与问题坐标。 */
  readonly pixelRatio?: number;
  /** 报告里的名字,缺省按宽高:「横屏 1280×720」「竖屏 405×720」。 */
  readonly label?: string;
}

/** 缺省画幅:横屏 1280×720 与 9:16 竖屏 405×720(App 里点 9:16 的舞台尺寸)。 */
export const DEFAULT_LAYOUT_VIEWPORTS: readonly LayoutViewport[] = Object.freeze([
  { width: 1280, height: 720, label: '横屏 1280×720' },
  { width: 405, height: 720, label: '竖屏 405×720' },
]);

/** 缺省采样间隔(秒)。 */
export const DEFAULT_LAYOUT_INTERVAL = 0.5;

/** 画幅在报告里的名字。 */
export function viewportLabel(v: LayoutViewport): string {
  return v.label ?? `${v.width < v.height ? '竖屏' : '横屏'} ${v.width}×${v.height}`;
}

/** 与播放器同一口径的字幕 / 进度条选项(缺省同 runFilm:开字幕、底部进度条)。 */
export type LayoutFilmOptions = Pick<FilmOptions, 'subtitles' | 'subtitleStyle' | 'progress' | 'progressStyle'>;

/** Label 宽度怎么量:'auto'(缺省:没有 document 时估算)/ 'estimate' / 'engine'(引擎原样)。 */
export type LayoutTextMetrics = 'auto' | 'estimate' | 'engine';

export interface LayoutRunOptions {
  /** 挂载与让出任务;缺省 browserDryRunEnv()(node 里没有 → 抛错,请传 { createCanvas: createStubCanvas, createYielder: messageChannelYielder })。 */
  env?: DryRunEnv;
  /** 快进步长(秒),缺省 1/30(与预览、导出一致)。 */
  step?: number;
  film?: LayoutFilmOptions;
  /** 透传给 findLayoutIssues(zones / next 由这里算,不接受外部传入)。 */
  check?: Omit<LayoutCheckOptions, 'zones' | 'next'>;
  textMetrics?: LayoutTextMetrics;
  /** 判断运动(每次采样多看一眼 1/30 秒之后的一帧),缺省 true。 */
  motion?: boolean;
  shouldAbort?: () => boolean;
}

/** 一次采样。 */
export interface LayoutSample {
  /** 分段序号。 */
  readonly index: number;
  /** 分段名。 */
  readonly segment: string;
  readonly viewport: LayoutViewport;
  /** 请求的段内秒(钳过)。 */
  readonly requested: number;
  /** 段内秒(实际快进到的时刻)。 */
  readonly at: number;
  /** 全片秒 = plan.starts[index] + at。 */
  readonly position: number;
  /** 此刻字幕,无则 ''。 */
  readonly subtitle: string;
  /** 这一帧的屏幕盒(含活对象引用,只在回调里用)。 */
  readonly frame: LayoutFrame;
  readonly zones: readonly LayoutZone[];
  readonly issues: readonly LayoutIssue[];
}

/** 报告里的对象(可 JSON 序列化)。 */
export interface FilmLayoutObject {
  readonly label: string;
  readonly kind: LayoutItemKind;
  readonly text?: string;
  readonly rect: Bounds;
  readonly world: Bounds;
  readonly fontPx: number;
}

/** 跨时间合并后的问题(可 JSON 序列化,不含对象引用)。 */
export interface FilmLayoutIssue {
  readonly kind: LayoutIssueKind | 'subtitle-overflow';
  readonly severity: LayoutSeverity;
  readonly segmentIndex: number;
  readonly segment: string;
  /** 分段起点(全片秒)与声明时长:给 ?preview= 与显示的时刻钳在段内用(段尾那一刻已经属于下一段)。 */
  readonly segmentStart: number;
  readonly segmentDuration: number;
  readonly viewport: LayoutViewport;
  /** 段内秒:首次采样。 */
  readonly from: number;
  /** 段内秒:末次采样。 */
  readonly to: number;
  /** 最严重那次采样(段内秒)。 */
  readonly at: number;
  /** 全片秒(at 对应),?preview= 用。 */
  readonly position: number;
  /** 命中的采样次数(同一时刻只算一次)。 */
  readonly samples: number;
  readonly motion: readonly LayoutMotion[];
  readonly objects: readonly FilmLayoutObject[];
  readonly zone?: { readonly kind: LayoutZone['kind']; readonly label: string; readonly rect: Bounds };
  readonly region: Bounds;
  readonly amount: number;
  readonly ticks?: readonly string[];
  readonly message: string;
  /** 怎么修(中文)。 */
  readonly hint: string;
  /** 描述在这段时间里变过(逐帧读数):true 时 objects[].label 取最严重那帧的。 */
  readonly labelChanged?: boolean;
}

/** 每段每画幅的概况。 */
export interface SegmentLayoutSummary {
  readonly index: number;
  readonly segment: string;
  readonly viewport: LayoutViewport;
  /** 段起点(全片秒)与声明时长。 */
  readonly start: number;
  readonly duration: number;
  readonly samples: number;
  /** 采样到的 [最小, 最大] 缩放;一次都没采到时为 null。 */
  readonly zoom: readonly [number, number] | null;
  /** 采样到的最小屏幕字号(文字 / 刻度数字),没有时为 null。 */
  readonly minTextPx: number | null;
  readonly minTickPx: number | null;
}

export interface FilmLayoutFailure {
  readonly index: number;
  readonly segment: string;
  readonly viewport: LayoutViewport;
  readonly error: string;
}

export interface FilmLayoutReport {
  readonly viewports: readonly LayoutViewport[];
  readonly interval: number;
  /** 已排序:severity 降序 → 分段序号 → 画幅顺序 → from。 */
  readonly issues: readonly FilmLayoutIssue[];
  readonly segments: readonly SegmentLayoutSummary[];
  /** 起播抛错、done reject、截不到绘制(每段每画幅最多一条)。 */
  readonly failures: readonly FilmLayoutFailure[];
  /** shouldAbort 中途叫停了:结果只是查到一半的(没轮到的分段不在 segments 里)。 */
  readonly aborted: boolean;
}

// ---------------------------------------------------------------------------
// 遮挡区几何

/** 字幕块、章名行的量字工具:canvas 2D 上下文里用到的那两样。 */
export type TextMeasure = Pick<CanvasRenderingContext2D, 'font' | 'measureText'>;

/**
 * 按「中日韩 1em、其余 0.6em」估字宽的量字工具(node 里没有真实字体度量时用)。
 * font 里带一个标记:wrapSubtitle 的缓存按 font 串分,估算的结果不会和真实上下文量的混用。
 */
export function estimatedTextMeasure(): TextMeasure {
  let fontPx = 16;
  let font = '10px sans-serif /*估算*/';
  return {
    get font(): string {
      return font;
    },
    set font(value: string) {
      const m = /(\d+(?:\.\d+)?)px/.exec(value);
      fontPx = m ? Number(m[1]) : 16;
      font = `${value} /*估算*/`;
    },
    measureText(text: string): TextMetrics {
      return { width: estimateTextWidth(text, fontPx) } as TextMetrics;
    },
  };
}

/** 浏览器里用真实画布量(字幕与页面同一套字体),没有 DOM 时估算。 */
function defaultTextMeasure(): TextMeasure {
  if (typeof document !== 'undefined') {
    try {
      const ctx = document.createElement('canvas').getContext('2d');
      if (ctx) {
        return ctx;
      }
    } catch {
      // 退回估算。
    }
  }
  return estimatedTextMeasure();
}

/**
 * 字幕块在视口里的矩形(css 像素):与导出合成 drawSubtitle、DOM 字幕条同一套盒 ——
 * 折行按 wrapSubtitle,单行块收缩到文字宽,折了行的块撑满最大宽度。空文本返回 null。
 */
export function subtitleBlockRect(
  text: string,
  visual: SubtitleVisual,
  viewport: { readonly width: number; readonly height: number },
  measure: TextMeasure,
): { rect: Bounds; lines: number } | null {
  if (text.trim() === '') {
    return null;
  }
  measure.font = `${visual.fontPx}px ${visual.fontFamily}`;
  const maxWidth = viewport.width * visual.maxWidthRatio;
  const lines = wrapSubtitle(text, measure as CanvasRenderingContext2D, maxWidth);
  if (lines.length === 0) {
    return null;
  }
  let widest = 0;
  for (const line of lines) {
    widest = Math.max(widest, measure.measureText(line).width);
  }
  const textW = lines.length > 1 ? Math.max(widest, maxWidth) : widest;
  const w = textW + visual.padX * 2;
  const h = visual.fontPx * visual.lineHeight * lines.length + visual.padY * 2;
  const x = (viewport.width - w) / 2;
  const y = viewport.height - visual.bottomPx - h;
  return { rect: { minX: x, minY: y, maxX: x + w, maxY: y + h }, lines: lines.length };
}

export interface LayoutZonesInput {
  readonly width: number;
  readonly height: number;
  /** 此刻的字幕(文本 + 视觉样式),没有为 null。故事板直接传 overlay 上下文里的 subtitle。 */
  readonly subtitle?: ExportSubtitle | null;
  /** 进度条占块:位置与高度(ProgressVisual 就满足),关着为 null。 */
  readonly progress?: { readonly position: 'top' | 'bottom'; readonly blockPx: number } | null;
  /** 量字工具,缺省:浏览器用真实画布,node 里估算。 */
  readonly measure?: TextMeasure;
}

/** 某一帧的遮挡区:进度条占块(开着就一直在,贴底或贴顶)+ 此刻的字幕块。 */
export function layoutZones(input: LayoutZonesInput): LayoutZone[] {
  const zones: LayoutZone[] = [];
  const { width, height } = input;
  const bar = input.progress;
  if (bar && bar.blockPx > 0) {
    zones.push({
      kind: 'progress-bar',
      label: '进度条',
      rect:
        bar.position === 'top'
          ? { minX: 0, minY: 0, maxX: width, maxY: bar.blockPx }
          : { minX: 0, minY: height - bar.blockPx, maxX: width, maxY: height },
    });
  }
  const sub = input.subtitle;
  if (sub && sub.text.trim() !== '') {
    const block = subtitleBlockRect(sub.text, sub.visual, { width, height }, input.measure ?? defaultTextMeasure());
    if (block) {
      zones.push({ kind: 'subtitle', label: '字幕条', rect: block.rect });
    }
  }
  return zones;
}

/** 分段 elapsed 时刻的遮挡区(按播放器口径解析字幕样式与进度条)。 */
export function layoutZonesAt(
  segment: Segment,
  plan: FilmPlan,
  viewport: LayoutViewport,
  elapsed: number,
  film: LayoutFilmOptions | undefined,
  measure?: TextMeasure,
): LayoutZone[] {
  const text = film?.subtitles === false ? '' : subtitleAt(segment.subtitles ?? [], elapsed);
  const visual = resolveSubtitleVisual(viewport.width, film?.subtitleStyle, plan, 'sans-serif');
  return layoutZones({
    width: viewport.width,
    height: viewport.height,
    subtitle: text !== '' ? { text, visual } : null,
    progress: plan.progressOn ? { position: plan.barPosition, blockPx: plan.barBlockPx } : null,
    ...(measure ? { measure } : {}),
  });
}

/**
 * 与播放器同一口径的分段上下文:固定视口、ManualClock、有字幕(且开着字幕)的段给底部安全区。
 * 同 film.ts 的 contextFor 与 preview.ts 的 previewFrameAt。
 */
export function layoutSegmentContext(
  segment: Segment,
  plan: FilmPlan,
  viewport: LayoutViewport,
  clock: ManualClock,
  film?: LayoutFilmOptions,
): SegmentContext {
  const visual = resolveSubtitleVisual(viewport.width, film?.subtitleStyle, plan, 'sans-serif');
  const subs = film?.subtitles !== false && (segment.subtitles?.length ?? 0) > 0;
  return {
    clock,
    viewport: { width: viewport.width, height: viewport.height, pixelRatio: viewport.pixelRatio ?? 1 },
    ...(subs ? { safeArea: { bottom: subtitleSafeBottom(visual) } } : {}),
  };
}

// ---------------------------------------------------------------------------
// 采样

function wantsEstimate(mode: LayoutTextMetrics | undefined): boolean {
  return mode === 'estimate' || ((mode ?? 'auto') === 'auto' && typeof document === 'undefined');
}

function requireEnv(env: DryRunEnv | undefined): DryRunEnv {
  const e = env ?? browserDryRunEnv();
  if (!e) {
    throw new Error(
      '版面检查需要干跑环境:node 里请传 env: { createCanvas: createStubCanvas, createYielder: messageChannelYielder }',
    );
  }
  return e;
}

function stepOf(step: number | undefined): number {
  return step !== undefined && Number.isFinite(step) && step > 0 ? Math.min(step, 0.5) : 1 / OFFLINE_DEFAULT_FPS;
}

/** 段内秒钳到 [0, 段长](非有限按 0)。sampleSegmentLayout 与按时刻找回采样的地方用同一个式子。 */
function clampToSegment(t: number, duration: number): number {
  return Math.min(Math.max(0, duration), Math.max(0, Number.isFinite(t) ? t : 0));
}

/** 让 ManualClock 推一帧(零时长)再补画:帧泵在跑时 render() 只记一笔,推一帧它才真的画。 */
function drawNow(handle: SegmentHandle, clock: { now(): number; advanceTo(time: number): void } | undefined): void {
  if (clock) {
    clock.advanceTo(clock.now());
  }
  handle.render?.();
}

export interface SampleSegmentOptions extends LayoutRunOptions {
  readonly index: number;
  readonly plan: FilmPlan;
  readonly viewport: LayoutViewport;
  /** 段内秒,会被排序、钳到 [0, duration];重复的合并。 */
  readonly times: readonly number[];
  /** 渲染目标(故事板传自己的画布);缺省 env.createCanvas()。 */
  readonly canvas?: HTMLCanvasElement;
  /** 字幕块的量字工具,缺省:浏览器用真实画布,node 里估算。 */
  readonly measure?: TextMeasure;
  /**
   * 每次采样之后调用,可返回 Promise。sample.frame 里的屏幕盒、路径、不透明度都是 at 那一刻截获的;
   * frame.items[].object 是活对象 —— 开着 motion 时它已经走到 1/30 秒之后(看运动的前瞻),别再从它读几何。
   * canvas 上此刻是 at 这一帧,前提是句柄有 setDryRun(directedSegment / timedSegment / 卡片这些标准分段都有,前瞻不重画);
   * 没有的(自己写的场景句柄)前瞻时会把 1/30 秒之后那帧画上去,要画面与 at 严格对齐就传 motion: false。
   */
  readonly onSample?: (sample: LayoutSample) => void | Promise<void>;
}

/** sampleSegmentLayout 的结果。 */
export interface SegmentSamplingResult {
  /** 成功的采样次数。 */
  readonly samples: number;
  /** 起播抛错 / done reject / 截不到绘制(只记第一条),没有为 null。 */
  readonly failure: string | null;
  /** done reject 时分段已播到的段内秒(之后的采样都停在出错那一刻);没 reject 为 null。 */
  readonly failedAt: number | null;
  /** shouldAbort 中途叫停了。 */
  readonly aborted: boolean;
}

/**
 * 一次挂载、按给定时刻采样(核心)。快进用绝对时刻,前瞻 1/30 秒之后下一次快进按「还差多少」算步数,时间网格不漂;
 * 所有时间都来自 ManualClock,结果确定。分段起播抛错 / done reject / 截不到绘制记为 failure,不抛出。
 */
export async function sampleSegmentLayout(
  segment: Segment,
  options: SampleSegmentOptions,
): Promise<SegmentSamplingResult> {
  const env = requireEnv(options.env);
  const step = stepOf(options.step);
  const { plan, viewport, index } = options;
  const film = options.film;
  const motion = options.motion !== false;
  const measure = options.measure ?? defaultTextMeasure();
  const start = plan.starts[index] ?? 0;
  const times = [...new Set(options.times.map((t) => clampToSegment(t, segment.duration)))].sort((a, b) => a - b);
  const undoMetrics = wantsEstimate(options.textMetrics) ? installEstimatedTextMetrics() : null;
  const ownCanvas = options.canvas ? null : env.createCanvas();
  const canvas = options.canvas ?? ownCanvas;
  const clock = new ManualClock();
  let failure: string | null = null;
  let failedAt: number | null = null;
  let aborted = false;
  let count = 0;
  let handle: SegmentHandle | null = null;
  let yielder: ReturnType<DryRunEnv['createYielder']> | null = null;
  try {
    if (!canvas) {
      return { samples: 0, failure: '建不了画布', failedAt: 0, aborted: false };
    }
    try {
      handle = segment.play(canvas, layoutSegmentContext(segment, plan, viewport, clock, film));
    } catch (e) {
      return { samples: 0, failure: `起播抛错:${describeError(e)}`, failedAt: 0, aborted: false };
    }
    const live = handle;
    live.done.catch((e: unknown) => {
      failure ??= `播放出错:${describeError(e)}`;
      try {
        failedAt ??= live.getElapsed();
      } catch {
        failedAt ??= 0;
      }
    });
    yielder = env.createYielder();
    const yieldTask = yielder.yieldTask;
    for (const requested of times) {
      if (options.shouldAbort?.()) {
        aborted = true;
        break;
      }
      const ff = await fastForwardTo(live, clock, requested, {
        step,
        yieldTask,
        ...(options.shouldAbort ? { shouldAbort: options.shouldAbort } : {}),
      });
      if (ff.aborted) {
        aborted = true;
        break;
      }
      const snap = captureRender(() => drawNow(live, clock));
      if (!snap) {
        failure ??= `段内 ${requested.toFixed(2)} 秒截不到绘制(分段没有经由 Scene 画这一帧)`;
        continue;
      }
      const frame = inspectSnapshot(snap);
      const at = live.getElapsed();
      let next: LayoutFrame | undefined;
      if (motion) {
        live.setDryRun?.(true);
        try {
          clock.advanceTo(clock.now() + step * 1000);
          await yieldTask();
        } finally {
          live.setDryRun?.(false);
        }
        const snap2 = captureRender(() => drawNow(live, clock), { draw: false });
        // 前瞻帧只用来比位置与不透明度,不取路径(线条命中用的是 frame 里 at 那一刻的路径)。
        next = snap2 ? inspectSnapshot(snap2, { paths: false }) : undefined;
      }
      const zones = layoutZonesAt(segment, plan, viewport, at, film, measure);
      const issues = findLayoutIssues(frame, { ...options.check, zones, ...(next ? { next } : {}) });
      count += 1;
      await options.onSample?.({
        index,
        segment: segment.name,
        viewport,
        requested,
        at,
        position: start + at,
        subtitle: film?.subtitles === false ? '' : subtitleAt(segment.subtitles ?? [], at),
        frame,
        zones,
        issues,
      });
    }
  } finally {
    if (handle) {
      try {
        handle.dispose();
      } catch {
        // 检查用完即弃。
      }
    }
    yielder?.close();
    undoMetrics?.();
    if (ownCanvas) {
      ownCanvas.width = 0;
      ownCanvas.height = 0;
    }
  }
  return { samples: count, failure, failedAt, aborted };
}

/** 每段的采样时刻:interval 的整数倍(不含 0,白场里)+ 段尾前一帧;与段尾太近的网格点并掉。 */
export function layoutSampleTimes(duration: number, interval: number, step: number): number[] {
  const out: number[] = [];
  const end = Math.max(0, duration - step);
  for (let k = 1; k * interval < duration - 1e-6; k++) {
    const t = k * interval;
    if (Math.abs(t - end) < step / 2) {
      continue;
    }
    out.push(t);
  }
  out.push(end);
  return out;
}

// ---------------------------------------------------------------------------
// 整片检查与聚合

/** 类别的中文名。 */
export const LAYOUT_KIND_LABELS: Readonly<Record<FilmLayoutIssue['kind'], string>> = Object.freeze({
  'out-of-frame': '文字出画',
  offscreen: '整个在画外',
  'text-overlap': '文字互压',
  'text-over-tick': '压住刻度',
  'text-over-stroke': '线穿文字',
  'under-subtitle': '被字幕盖住',
  'under-progress-bar': '被进度条盖住',
  'text-too-small': '字太小',
  'subtitle-overflow': '字幕超出安全区',
});

/** 各类问题怎么修。 */
export const LAYOUT_HINTS: Readonly<Record<FilmLayoutIssue['kind'], string>> = Object.freeze({
  'out-of-frame':
    '取景没框住它:会变大 / 后出现 / 会移动的对象按最大包络进 stage(第 4 个参数 fitExtra 放终态);推近镜头时把邻近的字藏掉或一起框进来;竖屏写 isNarrow 分支或用 fitWidth 收窄(README §3.7、§8.4)',
  offscreen: '它整个在画外却没藏起来:不用就 opacity = 0 / FadeOut,要用就进取景',
  'text-overlap': '两块字互压:用 nextTo / arrange 按外接盒摆(引擎导出),或错开出现时间、先 FadeOut 再 FadeIn',
  'text-over-tick': '压住了坐标轴刻度数字:离开刻度行至少一个字高(约 20 世界单位),或挪到坐标框内的空白处',
  'text-over-stroke': '有线从字中间穿过:读数 / 标签挪到线的另一侧(README §3.7 避让)',
  'under-subtitle': '被字幕条盖住:对象要进 stage 一起取景(取景会避开字幕安全区);字幕保持一行(横屏 ≤ 51 字、9:16 ≤ 23 字)',
  'under-progress-bar': '被进度条盖住:没有字幕的段没有底部安全区 —— 至少写一条字幕,或取景时多留 pad',
  'text-too-small': '屏幕上太小:竖屏用 isNarrow 分支把并排改成上下排,或换竖的取景框(README §8.4)',
  'subtitle-overflow': '字幕折成了多行,会压进画面:缩短到一行(横屏约 51 字、9:16 约 23 字,README §3.3)',
});

export interface FilmLayoutCheckOptions extends LayoutRunOptions {
  /** 缺省 DEFAULT_LAYOUT_VIEWPORTS。 */
  viewports?: readonly LayoutViewport[];
  /** 采样间隔(秒),缺省 0.5;非正数抛错。 */
  interval?: number;
  /** 只查这些分段(序号)。 */
  segments?: readonly number[];
  /** 字幕块的量字工具,缺省:浏览器用真实画布,node 里估算。 */
  measure?: TextMeasure;
  onProgress?: (done: number, total: number) => void;
}

interface Hit {
  readonly at: number;
  readonly position: number;
  readonly issue: LayoutIssue;
}

/**
 * 运镜途中的采样跨度超过它(秒)就不再当瞬态:慢推、长时间平移(Ken Burns、线性的长 playFit)里一直出画 / 压字幕,
 * 观众看得见,级别封顶提醒(不到错误:镜头停下后的采样会给出静止状态的真实级别)。
 */
const LONG_CAMERA_SECONDS = 1;

interface Bucket {
  readonly kind: LayoutIssueKind;
  readonly hits: Hit[];
}

function serializeItem(i: LayoutItem): FilmLayoutObject {
  return {
    label: i.label,
    kind: i.kind,
    ...(i.text !== undefined ? { text: i.text } : {}),
    rect: { ...i.rect },
    world: { ...i.world },
    fontPx: i.fontPx,
  };
}

/** 跨时间合并的键:类别 + 遮挡区 + 对象身份(刻度项换成「所属坐标轴:ticks」,哪个刻度被压不影响归并)。 */
function bucketKey(issue: LayoutIssue): string {
  const objects = issue.items
    .map((i) => (i.kind === 'tick-label' ? `${i.objectKey}:ticks` : i.key))
    .sort()
    .join('+');
  return `${issue.kind}|${issue.zone?.kind ?? ''}|${objects}`;
}

/** 把同一问题的采样切成连续的时间段,每段一条 FilmLayoutIssue。 */
function finalizeBucket(
  bucket: Bucket,
  base: { segmentIndex: number; segment: string; segmentStart: number; segmentDuration: number; viewport: LayoutViewport },
  interval: number,
  step: number,
): FilmLayoutIssue[] {
  const hits = [...bucket.hits].sort((a, b) => a.at - b.at);
  const runs: Hit[][] = [];
  for (const h of hits) {
    const run = runs[runs.length - 1];
    const prev = run?.[run.length - 1];
    if (run && prev && h.at - prev.at <= interval + step * 1.5 + 1e-6) {
      run.push(h);
    } else {
      runs.push([h]);
    }
  }
  const out: FilmLayoutIssue[] = [];
  for (const run of runs) {
    const first = run[0];
    const last = run[run.length - 1];
    if (!first || !last) {
      continue;
    }
    const times = new Set(run.map((h) => h.at));
    // 扫描中一闪而过(只命中一次且在移动):降为 info。
    const single = times.size < 2;
    // 运镜途中的采样跨了一秒多:不是一晃而过,不再降成 info,按原级别封顶提醒。
    const cameraAt = run.filter((h) => h.issue.motion === 'camera').map((h) => h.at);
    const longCamera =
      cameraAt.length > 1 && Math.max(...cameraAt) - Math.min(...cameraAt) > LONG_CAMERA_SECONDS + 1e-6;
    const effective = (h: Hit): LayoutSeverity => {
      if (single && h.issue.motion === 'moving') {
        return 'info';
      }
      if (longCamera && h.issue.motion === 'camera') {
        return severityRank(h.issue.baseSeverity) > severityRank('warning') ? 'warning' : h.issue.baseSeverity;
      }
      return h.issue.severity;
    };
    let worst = first;
    let severity: LayoutSeverity = 'info';
    for (const h of run) {
      const s = effective(h);
      if (severityRank(s) > severityRank(severity) || (s === severity && h.issue.amount > worst.issue.amount)) {
        worst = h;
      }
      severity = maxSeverity(severity, s);
    }
    const w = worst.issue;
    const labels = new Set(run.map((h) => h.issue.items.map((i) => i.label).join('|')));
    const motions: LayoutMotion[] = [];
    for (const h of run) {
      if (!motions.includes(h.issue.motion)) {
        motions.push(h.issue.motion);
      }
    }
    out.push({
      kind: w.kind,
      severity,
      ...base,
      from: first.at,
      to: last.at,
      at: worst.at,
      position: worst.position,
      samples: times.size,
      motion: motions,
      objects: w.items.map(serializeItem),
      ...(w.zone ? { zone: { kind: w.zone.kind, label: w.zone.label, rect: { ...w.zone.rect } } } : {}),
      region: { ...w.region },
      amount: w.amount,
      ...(w.ticks ? { ticks: [...w.ticks] } : {}),
      message: w.message,
      hint: LAYOUT_HINTS[w.kind],
      ...(labels.size > 1 ? { labelChanged: true } : {}),
    });
  }
  return out;
}

/** 字幕折行超出安全区(与场景无关:每条字幕每画幅查一次)。 */
function subtitleOverflows(
  segment: Segment,
  index: number,
  plan: FilmPlan,
  viewport: LayoutViewport,
  film: LayoutFilmOptions | undefined,
  measure: TextMeasure,
): FilmLayoutIssue[] {
  const subs = segment.subtitles ?? [];
  if (film?.subtitles === false || subs.length === 0) {
    return [];
  }
  const visual = resolveSubtitleVisual(viewport.width, film?.subtitleStyle, plan, 'sans-serif');
  const safeTop = viewport.height - subtitleSafeBottom(visual);
  const out: FilmLayoutIssue[] = [];
  for (const s of subs) {
    const block = subtitleBlockRect(s.text, visual, viewport, measure);
    if (!block || !(block.rect.minY < safeTop - 0.5)) {
      continue;
    }
    const over = safeTop - block.rect.minY;
    out.push({
      kind: 'subtitle-overflow',
      severity: 'warning',
      segmentIndex: index,
      segment: segment.name,
      segmentStart: plan.starts[index] ?? 0,
      segmentDuration: segment.duration,
      viewport,
      from: s.start,
      to: s.end,
      at: s.start,
      position: (plan.starts[index] ?? 0) + s.start,
      samples: 1,
      motion: ['still'],
      objects: [],
      zone: { kind: 'subtitle', label: '字幕条', rect: block.rect },
      region: { ...block.rect, maxY: Math.min(block.rect.maxY, safeTop) },
      amount: over,
      message: `字幕「${s.text}」折成 ${block.lines} 行,比安全区高出 ${over.toFixed(1)} px`,
      hint: LAYOUT_HINTS['subtitle-overflow'],
    });
  }
  return out;
}

/**
 * 整片检查:每段 × 每种画幅挂载一次,按 interval 采样,聚合成时间段。
 * 估算度量(node 里)在整片外层装一次,结束(包括抛错)后撤销。
 */
export async function checkFilmLayout(
  segments: readonly Segment[],
  options?: FilmLayoutCheckOptions,
): Promise<FilmLayoutReport> {
  const interval = options?.interval ?? DEFAULT_LAYOUT_INTERVAL;
  if (!(interval > 0) || !Number.isFinite(interval)) {
    throw new Error(`checkFilmLayout:interval 必须是正数,收到 ${interval}`);
  }
  const env = requireEnv(options?.env);
  const viewports = options?.viewports ?? DEFAULT_LAYOUT_VIEWPORTS;
  const step = stepOf(options?.step);
  const film = options?.film;
  const plan = planFilm(segments, film);
  const measure = options?.measure ?? defaultTextMeasure();
  const wanted = options?.segments ? new Set(options.segments) : null;
  const indices = segments.map((_, i) => i).filter((i) => wanted === null || wanted.has(i));
  const issues: FilmLayoutIssue[] = [];
  const summaries: SegmentLayoutSummary[] = [];
  const failures: FilmLayoutFailure[] = [];
  const total = indices.length * viewports.length;
  let done = 0;
  let aborted = false;
  const undoMetrics = wantsEstimate(options?.textMetrics) ? installEstimatedTextMetrics() : null;
  try {
    for (const index of indices) {
      const segment = segments[index];
      if (!segment || aborted) {
        continue;
      }
      for (const viewport of viewports) {
        if (aborted || options?.shouldAbort?.()) {
          aborted = true;
          break;
        }
        const buckets = new Map<string, Bucket>();
        let zoomMin = Infinity;
        let zoomMax = -Infinity;
        let minText = Infinity;
        let minTick = Infinity;
        const result = await sampleSegmentLayout(segment, {
          ...options,
          env,
          step,
          index,
          plan,
          viewport,
          measure,
          times: layoutSampleTimes(segment.duration, interval, step),
          onSample: (sample) => {
            zoomMin = Math.min(zoomMin, sample.frame.view.zoom);
            zoomMax = Math.max(zoomMax, sample.frame.view.zoom);
            for (const item of sample.frame.items) {
              const r = item.rect;
              const visible = r.maxX > 0 && r.minX < viewport.width && r.maxY > 0 && r.minY < viewport.height;
              if (!visible || !(item.fontPx > 0)) {
                continue;
              }
              if (item.kind === 'text') {
                minText = Math.min(minText, item.fontPx);
              } else if (item.kind === 'tick-label') {
                minTick = Math.min(minTick, item.fontPx);
              }
            }
            for (const issue of sample.issues) {
              const key = bucketKey(issue);
              let bucket = buckets.get(key);
              if (!bucket) {
                bucket = { kind: issue.kind, hits: [] };
                buckets.set(key, bucket);
              }
              bucket.hits.push({ at: sample.at, position: sample.position, issue });
            }
          },
        });
        const base = {
          segmentIndex: index,
          segment: segment.name,
          segmentStart: plan.starts[index] ?? 0,
          segmentDuration: segment.duration,
          viewport,
        };
        for (const bucket of buckets.values()) {
          issues.push(...finalizeBucket(bucket, base, interval, step));
        }
        issues.push(...subtitleOverflows(segment, index, plan, viewport, film, measure));
        summaries.push({
          index,
          segment: segment.name,
          viewport,
          start: plan.starts[index] ?? 0,
          duration: segment.duration,
          samples: result.samples,
          zoom: zoomMin <= zoomMax ? [zoomMin, zoomMax] : null,
          minTextPx: Number.isFinite(minText) ? minText : null,
          minTickPx: Number.isFinite(minTick) ? minTick : null,
        });
        if (result.failure !== null) {
          failures.push({ index, segment: segment.name, viewport, error: result.failure });
        }
        if (result.aborted) {
          // 查到一半的这段照样留着(问题是真的),但不算完成。
          aborted = true;
          break;
        }
        done += 1;
        options?.onProgress?.(done, total);
      }
    }
  } finally {
    undoMetrics?.();
  }
  const vpOrder = (v: LayoutViewport): number => viewports.indexOf(v);
  issues.sort(
    (a, b) =>
      severityRank(b.severity) - severityRank(a.severity) ||
      a.segmentIndex - b.segmentIndex ||
      vpOrder(a.viewport) - vpOrder(b.viewport) ||
      a.from - b.from,
  );
  return { viewports, interval, issues, segments: summaries, failures, aborted };
}

// ---------------------------------------------------------------------------
// 故事板用的入口

export interface InspectFramesOptions extends LayoutRunOptions {
  /** 缺省 planFilm(segments, film)。 */
  plan?: FilmPlan;
  /**
   * 按哪个画幅排版,缺省横屏 1280×720(不看 canvas 的 css 尺寸)。问题坐标都在这个画幅的 css 像素里。
   * 缩略图别按缩略图大小排版(字幕字号、安全区、取景缩放全都不像成片),要按成片排、按缩略图出图:
   * viewport: { width: 1280, height: 720, pixelRatio: 缩略图宽 / 1280 }(竖屏 405×720 同理),
   * 画布的 backing store 就是缩略图大小;红框坐标乘 缩略图宽 / viewport.width 换到缩略图上。
   */
  viewport?: LayoutViewport;
  canvas?: HTMLCanvasElement;
  measure?: TextMeasure;
}

/** 故事板的缺省画幅:成片的横屏。 */
const DEFAULT_FRAME_VIEWPORT: LayoutViewport = DEFAULT_LAYOUT_VIEWPORTS[0] ?? { width: 1280, height: 720 };

async function waitForFonts(): Promise<void> {
  if (typeof document !== 'undefined') {
    const fonts = (document as unknown as { fonts?: { ready?: Promise<unknown> } }).fonts;
    if (fonts?.ready) {
      await fonts.ready;
    }
  }
}

/** inspectFilmFrames 里出了错的一个时刻。 */
export interface FrameFailure {
  /** 在 positions 里的序号。 */
  readonly order: number;
  /** 所在分段的序号与名字。 */
  readonly index: number;
  readonly segment: string;
  /** 起播抛错 / 播放出错(done reject)/ 截不到绘制。 */
  readonly error: string;
}

/** inspectFilmFrames 的结果。 */
export interface FilmFramesResult {
  /**
   * 与 positions 一一对应(下标就是 order):截不到的时刻为 null,原因在 failures 里;
   * 叫停(aborted)后没轮到的时刻也是 null,不算失败。
   */
  readonly samples: ReadonlyArray<LayoutSample | null>;
  /**
   * 出了错的时刻,按 order 排:截不到的(samples 里是 null),以及分段脚本出错之后的时刻 ——
   * 那些帧还截得到(画面停在出错那一刻),但播放器里这段会被跳过,看到的不是它。
   */
  readonly failures: readonly FrameFailure[];
  /** shouldAbort 中途叫停了。 */
  readonly aborted: boolean;
}

/**
 * 一组全片时刻(秒)→ 每个时刻一帧的检查结果。按分段分组,每段只挂载一次、按时刻顺序快进,
 * 每帧画完调 onFrame(canvas 上此刻就是那一帧,可以把它拷进缩略图;见 SampleSegmentOptions.onSample 的前提)。
 * samples 与 positions 一一对应:某段起播抛错、中途出错或截不到绘制时,对应位置是 null、原因进 failures,别的位置不受影响。
 */
export async function inspectFilmFrames(
  segments: readonly Segment[],
  positions: readonly number[],
  options?: InspectFramesOptions & { onFrame?: (sample: LayoutSample, order: number) => void | Promise<void> },
): Promise<FilmFramesResult> {
  if (segments.length === 0) {
    throw new FilmError('no-segments', '影片没有任何分段');
  }
  await waitForFonts();
  const plan = options?.plan ?? planFilm(segments, options?.film);
  const viewport = options?.viewport ?? DEFAULT_FRAME_VIEWPORT;
  const bySegment = new Map<number, Array<{ order: number; offset: number }>>();
  positions.forEach((seconds, order) => {
    const { index, offset } = segmentAtTime(segments, plan.starts, plan.total, seconds);
    const list = bySegment.get(index) ?? [];
    list.push({ order, offset });
    bySegment.set(index, list);
  });
  const samples: Array<LayoutSample | null> = positions.map(() => null);
  const failures: FrameFailure[] = [];
  let aborted = false;
  const undoMetrics = wantsEstimate(options?.textMetrics) ? installEstimatedTextMetrics() : null;
  try {
    for (const [index, wantedFrames] of [...bySegment.entries()].sort((a, b) => a[0] - b[0])) {
      const segment = segments[index];
      if (!segment) {
        continue;
      }
      if (options?.shouldAbort?.()) {
        aborted = true;
        break;
      }
      const result = await sampleSegmentLayout(segment, {
        ...options,
        index,
        plan,
        viewport,
        times: wantedFrames.map((w) => w.offset),
        onSample: async (sample) => {
          for (const w of wantedFrames) {
            if (clampToSegment(w.offset, segment.duration) === sample.requested) {
              samples[w.order] = sample;
              await options?.onFrame?.(sample, w.order);
            }
          }
        },
      });
      for (const w of wantedFrames) {
        const sample = samples[w.order] ?? null;
        const afterError =
          sample !== null && result.failedAt !== null && sample.requested >= result.failedAt - 1e-6;
        if ((sample === null && !result.aborted) || afterError) {
          failures.push({
            order: w.order,
            index,
            segment: segment.name,
            error: result.failure ?? `段内 ${w.offset.toFixed(2)} 秒截不到绘制`,
          });
        }
      }
      if (result.aborted) {
        aborted = true;
        break;
      }
    }
  } finally {
    undoMetrics?.();
  }
  failures.sort((a, b) => a.order - b.order);
  return { samples, failures, aborted };
}

/** 单帧检查的结果:previewFrameAt 的定位信息 + 这一帧的屏幕盒、遮挡区与问题。 */
export interface FrameInspection extends PreviewResult {
  readonly viewport: LayoutViewport;
  readonly frame: LayoutFrame;
  readonly zones: readonly LayoutZone[];
  readonly issues: readonly LayoutIssue[];
}

/**
 * 单帧版:和 previewFrameAt 一样把 seconds 处的帧画进 canvas(缺省离屏),同时给出这一帧的问题。
 * 没查成(起播抛错、截不到绘制、被中止)时抛错,消息里带原因。
 */
export async function inspectFrameAt(
  segments: readonly Segment[],
  seconds: number,
  options?: InspectFramesOptions,
): Promise<FrameInspection> {
  if (segments.length === 0) {
    throw new FilmError('no-segments', '影片没有任何分段');
  }
  const plan = options?.plan ?? planFilm(segments, options?.film);
  const { index, offset } = segmentAtTime(segments, plan.starts, plan.total, seconds);
  const segment = segments[index];
  if (!segment) {
    throw new FilmError('no-segments', '影片没有任何分段');
  }
  const result = await inspectFilmFrames(segments, [seconds], { ...options, plan });
  const sample = result.samples[0] ?? null;
  if (!sample) {
    const why = result.failures[0]?.error ?? (result.aborted ? '检查被中止' : '截不到绘制');
    throw new Error(`分段「${segment.name}」段内 ${offset.toFixed(2)} 秒没查成:${why}`);
  }
  return {
    index,
    offset,
    name: segment.name,
    subtitle: sample.subtitle,
    position: (plan.starts[index] ?? 0) + offset,
    viewport: sample.viewport,
    frame: sample.frame,
    zones: sample.zones,
    issues: sample.issues,
  };
}

export interface HandleLayoutOptions {
  /** 视口 css 尺寸(故事板传 overlay 上下文的 cssWidth / cssHeight)。 */
  readonly width: number;
  readonly height: number;
  /** 此刻的字幕(故事板直接传 overlay 上下文的 subtitle)。 */
  readonly subtitle?: ExportSubtitle | null;
  /** 进度条占块(故事板传 overlay 上下文的 progress?.visual)。 */
  readonly progress?: { readonly position: 'top' | 'bottom'; readonly blockPx: number } | null;
  /**
   * 分段跑在上面的 ManualClock。帧泵在跑(动画进行中)时 handle.render() 只记一笔不当场画,
   * 给了时钟就先零时长推一帧,截得到;不给时这种帧会返回 null。
   */
  readonly clock?: { now(): number; advanceTo(time: number): void };
  readonly check?: Omit<LayoutCheckOptions, 'zones' | 'next'>;
  readonly measure?: TextMeasure;
}

/**
 * 在一个已经挂着、时钟停住的分段句柄上查当前这一帧(故事板 overlay 回调里用):不推进时间线,不重画画布。
 * 截不到绘制时返回 null(见 clock 的说明)。浏览器里用真实度量,node 里请自己在挂载前装好估算度量。
 */
export function checkHandleLayout(
  handle: SegmentHandle,
  options: HandleLayoutOptions,
): { frame: LayoutFrame; zones: LayoutZone[]; issues: LayoutIssue[] } | null {
  const snap = captureRender(() => drawNow(handle, options.clock), { draw: false });
  if (!snap) {
    return null;
  }
  const frame = inspectSnapshot(snap);
  const zones = layoutZones({
    width: options.width,
    height: options.height,
    subtitle: options.subtitle ?? null,
    progress: options.progress ?? null,
    ...(options.measure ? { measure: options.measure } : {}),
  });
  return { frame, zones, issues: findLayoutIssues(frame, { ...options.check, zones }) };
}

// ---------------------------------------------------------------------------
// 报告

export interface FormatLayoutOptions {
  /** 标题里的片名。 */
  film?: string;
  /** ?scene= 的键;null 时地址里写「<场景键>」并提示先注册。 */
  sceneKey?: string | null;
  /** 地址前缀,缺省 ''(打印 /?scene=…&preview=…)。 */
  base?: string;
  /** 缺省 'warning'。 */
  minSeverity?: LayoutSeverity;
}

const SEVERITY_MARK: Readonly<Record<LayoutSeverity, string>> = { error: '✗', warning: '!', info: '·' };

const MOTION_LABELS: Readonly<Record<LayoutMotion, string>> = {
  still: '静止',
  moving: '移动',
  fading: '淡入淡出',
  camera: '运镜',
};

const sec = (v: number): string => `${Number(v.toFixed(1))}`;

/**
 * 段内秒的显示值:钳到 [0, 段长 − 0.01] 再取两位小数。段尾那一刻已经属于下一段 ——
 * 末次采样在段尾前一帧,按一位小数四舍五入常常正好进位到段尾(「段内 2.3s」的 2.3 秒段)。
 */
function segmentSeconds(v: number, duration: number): number {
  const hi = Math.floor(Math.max(0, duration - 0.01) * 100 + 1e-6) / 100;
  return Math.min(hi, Math.round(Math.max(0, v) * 100) / 100);
}

function timeRange(issue: FilmLayoutIssue): string {
  const from = segmentSeconds(issue.from, issue.segmentDuration);
  const to = segmentSeconds(issue.to, issue.segmentDuration);
  return from === to ? `${from}s` : `${from}–${to}s`;
}

/**
 * ?preview= 用的全片秒:最严重那次采样的时刻,取两位小数,且保证落在本段 [起点, 终点) 里
 * (segmentAtTime 把终点那一刻算给下一段,起点小数多于两位时往里进一格)。
 */
export function layoutPreviewSeconds(issue: Pick<FilmLayoutIssue, 'at' | 'segmentStart' | 'segmentDuration'>): number {
  const start = issue.segmentStart;
  const end = start + issue.segmentDuration;
  let v = Math.round((start + segmentSeconds(issue.at, issue.segmentDuration)) * 100) / 100;
  if (v < start) {
    v = Math.ceil(start * 100) / 100;
  }
  if (v >= end) {
    v = Math.floor(end * 100 - 1e-6) / 100;
  }
  return v;
}

/** 一行版(check-film 用):「[竖屏 405×720] 文字出画 5.5–15.2s:Tex「f'(x) = …」出画 86.9 px(左边),只看得见 70%」。 */
export function formatLayoutIssueLine(issue: FilmLayoutIssue): string {
  return `[${viewportLabel(issue.viewport)}] ${LAYOUT_KIND_LABELS[issue.kind]} ${timeRange(issue)}:${issue.message}`;
}

/** 预览地址(时刻按 layoutPreviewSeconds 钳在本段里);竖屏的问题带上 &aspect=w9h16,打开就是竖屏画幅。 */
export function layoutPreviewUrl(
  issue: Pick<FilmLayoutIssue, 'at' | 'segmentStart' | 'segmentDuration'> & { readonly viewport: LayoutViewport },
  sceneKey: string | null,
  base = '',
): string {
  const aspect = issue.viewport.width < issue.viewport.height ? '&aspect=w9h16' : '';
  return `${base}/?scene=${sceneKey ?? '<场景键>'}&preview=${layoutPreviewSeconds(issue)}${aspect}`;
}

/** 可读的整片报告(CLI 打印)。 */
export function formatLayoutReport(report: FilmLayoutReport, options?: FormatLayoutOptions): string {
  const min = severityRank(options?.minSeverity ?? 'warning');
  const sceneKey = options?.sceneKey === undefined ? null : options.sceneKey;
  const base = options?.base ?? '';
  const count = (s: LayoutSeverity): number => report.issues.filter((i) => i.severity === s).length;
  const segmentCount = new Set(report.segments.map((s) => s.index)).size;
  const lines: string[] = [];
  lines.push(
    `== 版面检查${options?.film ? `《${options.film}》` : ''}:${segmentCount} 段 × ${report.viewports.length} 种画幅(${report.viewports
      .map(viewportLabel)
      .join('、')}),每 ${report.interval} 秒 + 段尾采样`,
  );
  const infos = count('info');
  lines.push(
    `✗ 错误 ${count('error')} · ! 提醒 ${count('warning')} · 信息 ${infos} 条${min > 0 && infos > 0 ? '(加 --all 显示)' : ''}`,
  );
  if (report.aborted) {
    lines.push('(检查中途被叫停,下面只是查到一半的结果)');
  }
  if (sceneKey === null) {
    lines.push('(这部片子还没在 src/sceneRegistry.ts 注册,地址里的 <场景键> 要换成注册的键)');
  }
  const shown = report.issues.filter((i) => severityRank(i.severity) >= min);
  const bySegment = new Map<number, FilmLayoutIssue[]>();
  for (const issue of shown) {
    const list = bySegment.get(issue.segmentIndex) ?? [];
    list.push(issue);
    bySegment.set(issue.segmentIndex, list);
  }
  for (const [index, list] of [...bySegment.entries()].sort((a, b) => a[0] - b[0])) {
    const summary = report.segments.find((s) => s.index === index);
    const range = summary ? `(全片 ${sec(summary.start)}–${sec(summary.start + summary.duration)}s)` : '';
    lines.push('');
    lines.push(`#${index} ${list[0]?.segment ?? ''}${range}`);
    for (const issue of list) {
      lines.push(`  ${SEVERITY_MARK[issue.severity]} ${formatLayoutIssueLine(issue)}`);
      const where = issue.objects[0];
      const center = where
        ? `世界位置 (${Math.round((where.world.minX + where.world.maxX) / 2)}, ${Math.round((where.world.minY + where.world.maxY) / 2)});`
        : '';
      const notes: string[] = [];
      if (issue.zone || issue.kind === 'subtitle-overflow') {
        notes.push('预览不画字幕和进度条');
      }
      if (issue.motion.length > 0 && issue.motion.every((m) => m !== 'still')) {
        notes.push(`采样时在${issue.motion.map((m) => MOTION_LABELS[m]).join(' / ')}`);
      }
      lines.push(
        `      ${center}最严重在段内 ${segmentSeconds(issue.at, issue.segmentDuration)}s → ${layoutPreviewUrl(issue, sceneKey, base)}${notes.length > 0 ? `(${notes.join(';')})` : ''}`,
      );
      lines.push(`      怎么修:${issue.hint}`);
    }
  }
  if (report.failures.length > 0) {
    lines.push('');
    lines.push('没查成的分段:');
    for (const f of report.failures) {
      lines.push(`  ✗ #${f.index} ${f.segment} [${viewportLabel(f.viewport)}]:${f.error}`);
    }
  }
  if (shown.length === 0 && report.failures.length === 0 && !report.aborted) {
    lines.push('');
    lines.push('✓ 没有发现提醒级以上的版面问题');
  }
  return lines.join('\n');
}
