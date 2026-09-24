import type { TaskYielder } from '../export/offlineEnv';
import { messageChannelYielder } from '../export/offlineEnv';
import { ManualClock } from './offline';
import type { LineTiming, SegmentTiming, SpanEvent, TimedSegment, TimingObserver } from './timed';
import { estimateSpeech, isSpanShort, isTimedSegment } from './timed';
import type { Segment, SegmentVoice, Subtitle, VoiceClip } from './types';
import type { VoiceLineTiming, VoiceProblem, VoiceSegmentTiming, VoiceTimingSheet } from './voiceSheet';
import { markNames, parseVoiceSheet, resolveAudioRef, stripMarks, textBeforeMark } from './voiceSheet';

/**
 * 配音接入:影片加载时统一做一次 prepareVoice ——
 * 有配音时间表的分段按它定时长、字幕与音频;没有时间表的 timedSegment 干跑一遍排出草稿时间;
 * 普通分段(动画时长固定)有时间表时挂上音频、字幕跟着音频走。产出的是一部时长全部确定的普通影片,
 * 播放器、进度条、跳转、预览、导出都不用知道配音的存在。
 */

/** 分段在配音时间表里的 id:写了 id 用 id,没写用分段名。 */
export function voiceIdOf(segment: Segment): string {
  return segment.id ?? segment.name;
}

/** 普通分段第 index 条字幕的台词 id(1 起):「分段id/序号」。字幕自己带 id 时用它。 */
export function voiceLineIdOf(segment: Segment, index: number): string {
  return segment.subtitles?.[index]?.id ?? `${voiceIdOf(segment)}/${index + 1}`;
}

/** 干跑环境:建画布 + 让出任务。浏览器用离屏画布与 MessageChannel;测试用 DOM 桩。 */
export interface DryRunEnv {
  createCanvas(): HTMLCanvasElement;
  createYielder(): TaskYielder;
}

export function browserDryRunEnv(): DryRunEnv | null {
  if (typeof document === 'undefined') {
    return null;
  }
  return {
    createCanvas: () => document.createElement('canvas'),
    createYielder: messageChannelYielder,
  };
}

export interface DryRunResult {
  /** 脚本在时限内跑完了。 */
  readonly settled: boolean;
  /** 跑到的段内秒数。 */
  readonly elapsed: number;
  readonly error: unknown;
}

/**
 * 把一个分段从头干跑到结束:虚拟时钟按帧推进、跳过绘制,几十秒的段不到一秒跑完。
 * 固定视口:不读 DOM 尺寸、不挂监听,离屏画布就够。
 */
export async function runSegmentToEnd(
  segment: Segment,
  env: DryRunEnv,
  options?: { fps?: number; limitSeconds?: number },
): Promise<DryRunResult> {
  const fps = options?.fps ?? 30;
  const limit = options?.limitSeconds ?? segment.duration * 3 + 30;
  const clock = new ManualClock();
  const canvas = env.createCanvas();
  const yielder = env.createYielder();
  let settled = false;
  let error: unknown = null;
  const handle = segment.play(canvas, {
    clock,
    viewport: { width: 1280, height: 720, pixelRatio: 1 },
  });
  handle.setDryRun?.(true);
  handle.done.then(
    () => {
      settled = true;
    },
    (e: unknown) => {
      settled = true;
      error = e;
    },
  );
  try {
    const t0 = clock.now();
    const steps = Math.ceil(limit * fps);
    await yielder.yieldTask();
    for (let i = 1; i <= steps && !settled; i++) {
      clock.advanceTo(t0 + (i * 1000) / fps);
      await yielder.yieldTask();
    }
    return { settled, elapsed: handle.getElapsed(), error };
  } finally {
    yielder.close();
    try {
      handle.dispose();
    } catch {
      // 干跑用完即弃。
    }
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** 草稿里的一个提示点:某句开口、句中某个标记,或(end)某句说完。 */
export interface DraftCue {
  readonly line: string;
  readonly mark?: string;
  /** 句尾提示点(playUntil / playThrough 到这句说完):这句说完不早于上一个提示点 + needs。 */
  readonly end?: true;
  /** 从上一个提示点(或段首)到这里动画至少要的秒数。 */
  readonly needs: number;
}

/** 排草稿的结果:时间 + 每个提示点前动画至少要的时间(导出台词稿时给配音方参考)。 */
export interface DraftResult {
  readonly timing: SegmentTiming;
  /**
   * 按脚本踩提示点的顺序(untilLine / untilMark,以及 playUntil / playThrough 的目标;句尾 / 标记目标落在
   * 还没踩到的句子上时,前面多一个那句的开口提示点:那句不早于调用时开口)。
   * playUntil 的 needs 只算动画的 min + lead,跟着台词伸缩的那部分不算:配音快慢都成立。
   */
  readonly cues: readonly DraftCue[];
  /** 最后一个提示点之后动画还要的秒数。 */
  readonly tail: number;
  /** 草稿里时间不够的 playUntil(目标已过,或剩的不到 min + lead):台词稿里报提醒。 */
  readonly shortfalls: readonly SpanEvent[];
}

/** 干跑一个 timedSegment,按「尽早」规则排出草稿时间。跑不完或出错时抛出。 */
export async function draftTiming(segment: TimedSegment, env: DryRunEnv): Promise<DraftResult> {
  const cues: DraftCue[] = [];
  const shortfalls: SpanEvent[] = [];
  let lastResolved = 0;
  let tail = 0;
  const observer: TimingObserver = {
    cue: (e) => {
      cues.push({ line: e.line, ...(e.mark !== undefined ? { mark: e.mark } : {}), needs: Math.max(0, e.called - lastResolved) });
      lastResolved = Math.max(e.at, e.called);
    },
    span: (e) => {
      // 从上一个提示点量到「动画最早能收住」:伸缩出来的时长不算进 needs。
      cues.push({
        line: e.line,
        ...(e.mark !== undefined ? { mark: e.mark } : {}),
        ...(e.kind === 'end' ? { end: true as const } : {}),
        needs: Math.max(0, e.ready - lastResolved),
      });
      lastResolved = Math.max(e.at, e.from + e.runTime);
      if (isSpanShort(e)) {
        shortfalls.push(e);
      }
    },
    end: (e) => {
      tail = Math.max(0, e.called - lastResolved);
    },
  };
  const { segment: draft, result } = segment.drafting(observer);
  const run = await runSegmentToEnd(draft, env);
  if (run.error) {
    throw run.error;
  }
  const timing = result();
  if (!run.settled || !timing) {
    throw new Error(`分段「${segment.name}」干跑 ${run.elapsed.toFixed(1)} 秒还没结束`);
  }
  return { timing, cues, tail, shortfalls };
}

export interface PrepareVoiceOptions {
  /** 已经拿到的时间表对象(JSON.parse 之后)。与 sheetUrl 二选一。 */
  sheet?: unknown;
  /** 时间表地址:取不到(404、断网)时按没有时间表处理。音频文件路径相对它。 */
  sheetUrl?: string;
  /** 音频路径的基准地址,缺省为 sheetUrl。 */
  audioBase?: string;
  /** 取时间表(测试注入);取不到返回 null。缺省用 fetch。 */
  fetchJson?: (url: string) => Promise<unknown>;
  /** 干跑环境(排草稿用),缺省浏览器实现。 */
  dryRun?: DryRunEnv;
  /** 问题回调,缺省写 console.warn(不致命:照常出片)。 */
  onProblem?: (problem: VoiceProblem) => void;
}

export interface PreparedFilm {
  /** 时长全部确定的分段(没有配音的原样返回)。 */
  readonly segments: Segment[];
  readonly problems: VoiceProblem[];
  /** 用上的时间表(没有为 null)。 */
  readonly sheet: VoiceTimingSheet | null;
}

async function defaultFetchJson(url: string): Promise<unknown> {
  if (typeof fetch === 'undefined') {
    return null;
  }
  try {
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) {
      return null;
    }
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

function absoluteBase(url: string | undefined): string {
  const here =
    typeof location !== 'undefined' && typeof location.href === 'string' ? location.href : 'http://localhost/';
  if (url === undefined) {
    return here;
  }
  try {
    return new URL(url, here).href;
  } catch {
    return url;
  }
}

/** 时间表 → 本段的音频片段(整段一个文件、每句一个文件都行)。 */
function clipsFrom(entry: VoiceSegmentTiming, base: string): VoiceClip[] {
  const clips: VoiceClip[] = [];
  if (entry.audio !== undefined) {
    const { url, offset } = resolveAudioRef(entry.audio, base);
    clips.push({ id: entry.id, url, start: 0, duration: entry.duration, offset });
  }
  for (const line of entry.lines ?? []) {
    if (line.audio !== undefined) {
      const { url, offset } = resolveAudioRef(line.audio, base);
      // 一直播到文件结束(最多到本段结束):时间表里的 end 管字幕,不截断声音。
      clips.push({ id: `${entry.id}/${line.id}`, url, start: line.start, duration: entry.duration - line.start, offset });
    }
  }
  return clips;
}

/** 时间表里一句的标记;缺了的按字数比例补上(报 warning)。 */
function marksFor(
  text: string,
  sheetLine: VoiceLineTiming,
  push: (p: VoiceProblem) => void,
  segmentId: string,
): Record<string, number> {
  const out: Record<string, number> = {};
  const total = estimateSpeech(text, 1, 0);
  for (const name of markNames(text)) {
    const given = sheetLine.marks?.[name];
    if (given !== undefined) {
      out[name] = given;
      continue;
    }
    const before = estimateSpeech(textBeforeMark(text, name) ?? '', 1, 0);
    const frac = total > 0 ? before / total : 0;
    out[name] = sheetLine.start + (sheetLine.end - sheetLine.start) * frac;
    push({
      level: 'warning',
      segment: segmentId,
      line: sheetLine.id,
      message: `时间表没给标记「${name}」的时刻,按字数比例估在 ${out[name]?.toFixed(2)} 秒`,
    });
  }
  return out;
}

/** 按时间表给 timedSegment 定时间;缺句子时返回 null(这段改用草稿)。 */
function timingFromSheet(
  segment: TimedSegment,
  entry: VoiceSegmentTiming,
  push: (p: VoiceProblem) => void,
): SegmentTiming | null {
  const byId = new Map((entry.lines ?? []).map((l) => [l.id, l]));
  const lines: Record<string, LineTiming> = {};
  const missing: string[] = [];
  for (const line of segment.lines) {
    const t = byId.get(line.id);
    if (!t) {
      missing.push(line.id);
      continue;
    }
    if (t.text !== undefined && stripMarks(t.text).trim() !== stripMarks(line.text).trim()) {
      push({
        level: 'warning',
        segment: segment.id,
        line: line.id,
        message: `台词改过了:时间表按「${stripMarks(t.text)}」做,现在是「${stripMarks(line.text)}」,这句需要重做`,
      });
    }
    lines[line.id] = { start: t.start, end: t.end, marks: marksFor(line.text, t, push, segment.id) };
  }
  if (missing.length > 0) {
    push({
      level: 'error',
      segment: segment.id,
      message: `时间表缺少台词 ${missing.map((m) => `「${m}」`).join('')},这一段先按草稿时间播(没有声音)`,
    });
    return null;
  }
  for (const extra of byId.keys()) {
    if (!segment.lines.some((l) => l.id === extra)) {
      push({ level: 'warning', segment: segment.id, line: extra, message: `时间表里的台词「${extra}」在分段里没有声明,已忽略` });
    }
  }
  return { duration: entry.duration, lines };
}

/** 普通分段挂音频:字幕跟时间表的起止走(文字用稿子里的),动画时长不变。 */
function withSheetVoice(segment: Segment, entry: VoiceSegmentTiming, base: string, push: (p: VoiceProblem) => void): Segment {
  const id = voiceIdOf(segment);
  if (Math.abs(entry.duration - segment.duration) > 0.25) {
    push({
      level: 'warning',
      segment: id,
      message: `这一段的动画时长固定为 ${segment.duration} 秒,时间表写的是 ${entry.duration} 秒:按动画时长播,多出的声音会被截掉`,
    });
  }
  const subs = segment.subtitles ?? [];
  const sheetLines = entry.lines ?? [];
  let subtitles: Subtitle[] | undefined = segment.subtitles;
  if (sheetLines.length > 0) {
    if (sheetLines.length !== subs.length) {
      push({
        level: 'warning',
        segment: id,
        message: `时间表有 ${sheetLines.length} 句,分段字幕有 ${subs.length} 条:按时间表的句子显示字幕`,
      });
    }
    subtitles = sheetLines
      .map((l, i) => ({
        id: l.id,
        start: l.start,
        end: Math.min(l.end, segment.duration),
        text: subs[i]?.text ?? (l.text !== undefined ? stripMarks(l.text) : ''),
      }))
      .filter((s) => s.text !== '' && s.end > s.start);
  }
  const voice: SegmentVoice = {
    clips: clipsFrom(entry, base).map((c) => ({ ...c, duration: Math.min(c.duration, segment.duration - c.start) })),
  };
  // 保留原型(模板造的分段是普通对象,这里只是保险)。
  return Object.assign(Object.create(Object.getPrototypeOf(segment) as object) as Segment, segment, {
    voice,
    ...(subtitles ? { subtitles } : {}),
  });
}

/**
 * 统一做配音准备:取时间表 → 逐段套用(timedSegment 定时间 / 普通分段挂音频)→ 没有时间表的 timedSegment 排草稿。
 * 问题不致命:报出来,片子照常能播(缺的部分没有声音、用草稿时间)。
 */
export async function prepareVoice(segments: readonly Segment[], options?: PrepareVoiceOptions): Promise<PreparedFilm> {
  const problems: VoiceProblem[] = [];
  const report = options?.onProblem ?? ((p: VoiceProblem) => console.warn(`[voice] ${p.message}`));
  const push = (p: VoiceProblem): void => {
    problems.push(p);
    report(p);
  };
  const hasTimed = segments.some(isTimedSegment);
  let raw: unknown = options?.sheet;
  if (raw === undefined && options?.sheetUrl !== undefined) {
    raw = await (options.fetchJson ?? defaultFetchJson)(options.sheetUrl);
  }
  let sheet: VoiceTimingSheet | null = null;
  if (raw !== undefined && raw !== null) {
    const parsed = parseVoiceSheet(raw);
    parsed.problems.forEach(push);
    sheet = parsed.sheet;
  }
  if (!sheet && !hasTimed) {
    return { segments: [...segments], problems, sheet: null };
  }
  const base = absoluteBase(options?.audioBase ?? options?.sheetUrl);
  const entries = new Map((sheet?.segments ?? []).map((e) => [e.id, e]));
  const used = new Set<string>();
  const dryRun = options?.dryRun ?? browserDryRunEnv();
  const out: Segment[] = [];
  for (const segment of segments) {
    const id = voiceIdOf(segment);
    const entry = entries.get(id);
    if (entry) {
      used.add(id);
    }
    if (isTimedSegment(segment)) {
      const timing = entry ? timingFromSheet(segment, entry, push) : null;
      if (timing && entry) {
        const clips = clipsFrom(entry, base);
        out.push(segment.withTiming(timing, clips.length > 0 ? { voice: { clips } } : undefined));
        continue;
      }
      if (!dryRun) {
        push({ level: 'error', segment: id, message: '没有干跑环境,排不了草稿:这一段按字数估的时长播' });
        out.push(segment);
        continue;
      }
      try {
        const draft = await draftTiming(segment, dryRun);
        out.push(segment.withTiming(draft.timing));
      } catch (e) {
        push({
          level: 'error',
          segment: id,
          message: `排草稿失败,这一段按字数估的时长播:${e instanceof Error ? e.message : String(e)}`,
        });
        out.push(segment);
      }
      continue;
    }
    out.push(entry ? withSheetVoice(segment, entry, base, push) : segment);
  }
  for (const id of entries.keys()) {
    if (!used.has(id)) {
      push({ level: 'warning', segment: id, message: `时间表里的分段「${id}」在影片里找不到,已忽略` });
    }
  }
  return { segments: out, problems, sheet };
}
