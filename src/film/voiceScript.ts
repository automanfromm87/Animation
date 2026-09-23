import type { DryRunEnv } from './voice';
import { draftTiming, voiceIdOf, voiceLineIdOf } from './voice';
import { estimateSpeech, isTimedSegment } from './timed';
import type { Segment } from './types';
import type { AudioRef, VoiceLineTiming, VoiceProblem, VoiceSegmentTiming, VoiceTimingSheet } from './voiceSheet';
import { markNames, stripMarks, textBeforeMark } from './voiceSheet';

/**
 * 台词稿(交给配音方)与时间表排期(配音方的参考实现)。
 *
 * 台词稿:每段每句的 id、台词(带 <mark> 标签)、草稿时间;timedSegment 还带「动画需要多少时间」——
 * 脚本按顺序踩提示点(某句开口、句中某个词),needs 是从上一个提示点到这里动画至少要的秒数,
 * 配音方排时间时满足它,画面就不会跟不上声音。
 *
 * layoutSheet:拿到每句实测的音频时长(和句中标记的时刻)后,按上面的约束排出一份时间表。
 * 配音方用自己的语言写一遍也行,规则见 docs/voice.md。
 */

/** 句首留白、句间停顿、段尾留白(秒),与草稿排期一致。 */
export const LAYOUT_DEFAULTS = { leadIn: 0.3, gap: 0.25, tail: 0.6 } as const;

export interface VoiceScriptLine {
  readonly id: string;
  /** 台词(带 <mark name="…"/> 标签:配音方据此给出那个词的时刻)。 */
  readonly text: string;
  /** 去掉标签的纯文本(照着念的)。 */
  readonly plain: string;
  /** 句中标记,按出现顺序。 */
  readonly marks: readonly string[];
  /**
   * 草稿时间(秒,相对本段):timed 段按字数与动画需要排;fixed 段就是字幕窗口,句子要放进去。
   * marks 是句中标记的草稿时刻(timed 段)。
   */
  readonly draft: { readonly start: number; readonly end: number; readonly marks?: Readonly<Record<string, number>> };
  /** timed 段:从上一个提示点起,动画至少要这么多秒才轮到这句开口(脚本不等这句时省略)。 */
  readonly needsBefore?: number;
  /** timed 段:从上一个提示点起,动画至少要这么多秒才轮到这个词。 */
  readonly markNeeds?: Readonly<Record<string, number>>;
}

export interface VoiceScriptCue {
  readonly line: string;
  readonly mark?: string;
  /** 从上一个提示点(或段首)到这里动画至少要的秒数。 */
  readonly needs: number;
}

export interface VoiceScriptSegment {
  readonly id: string;
  readonly name: string;
  /** timed:时长由配音决定;fixed:动画时长固定,每句放进自己的字幕窗口。 */
  readonly kind: 'timed' | 'fixed';
  /** fixed:动画时长;timed:草稿时长(仅供参考)。 */
  readonly duration: number;
  readonly lines: readonly VoiceScriptLine[];
  /** timed 段:脚本踩提示点的顺序与每个提示点前动画要的时间。 */
  readonly cues?: readonly VoiceScriptCue[];
  /** timed 段:最后一个提示点之后动画还要的秒数(本段至少到「最后提示点 + tail」)。 */
  readonly tail?: number;
}

export interface VoiceScript {
  readonly version: 1;
  readonly film: string;
  readonly segments: readonly VoiceScriptSegment[];
}

/** 秒数保留到毫秒(JSON 好读;约束检查都有 0.05 秒容差)。 */
function ms(v: number): number {
  return Math.round(v * 1000) / 1000;
}

/**
 * 生成台词稿。timedSegment 干跑一遍排草稿(同时量出每个提示点前动画要的时间);
 * 普通分段的句子来自字幕,id 为「分段id/序号」(字幕自带 id 时用它)。
 */
export async function buildVoiceScript(
  film: string,
  segments: readonly Segment[],
  dryRun: DryRunEnv,
): Promise<{ script: VoiceScript; problems: VoiceProblem[] }> {
  const problems: VoiceProblem[] = [];
  const seen = new Set<string>();
  const out: VoiceScriptSegment[] = [];
  for (const segment of segments) {
    const id = voiceIdOf(segment);
    if (seen.has(id)) {
      problems.push({
        level: 'error',
        segment: id,
        message: `分段 id「${id}」重复:配音会对不上,请给其中一段设一个不同的 id`,
      });
    }
    seen.add(id);
    if (isTimedSegment(segment)) {
      try {
        const draft = await draftTiming(segment, dryRun);
        const firstLineCue = new Map<string, number>();
        const markNeeds = new Map<string, Record<string, number>>();
        for (const cue of draft.cues) {
          if (cue.mark === undefined) {
            if (!firstLineCue.has(cue.line)) {
              firstLineCue.set(cue.line, cue.needs);
            }
          } else {
            const byMark = markNeeds.get(cue.line) ?? {};
            if (byMark[cue.mark] === undefined) {
              byMark[cue.mark] = ms(cue.needs);
            }
            markNeeds.set(cue.line, byMark);
          }
        }
        out.push({
          id,
          name: segment.name,
          kind: 'timed',
          duration: ms(draft.timing.duration),
          lines: segment.lines.map((line) => {
            const t = draft.timing.lines[line.id];
            const needs = firstLineCue.get(line.id);
            const marks = markNeeds.get(line.id);
            const draftMarks: Record<string, number> = {};
            for (const [name, at] of Object.entries(t?.marks ?? {})) {
              draftMarks[name] = ms(at);
            }
            return {
              id: line.id,
              text: line.text,
              plain: stripMarks(line.text),
              marks: markNames(line.text),
              draft: {
                start: ms(t?.start ?? 0),
                end: ms(t?.end ?? 0),
                ...(Object.keys(draftMarks).length > 0 ? { marks: draftMarks } : {}),
              },
              ...(needs !== undefined ? { needsBefore: ms(needs) } : {}),
              ...(marks ? { markNeeds: marks } : {}),
            };
          }),
          cues: draft.cues.map((c) => ({ line: c.line, ...(c.mark !== undefined ? { mark: c.mark } : {}), needs: ms(c.needs) })),
          tail: ms(draft.tail),
        });
      } catch (e) {
        problems.push({
          level: 'error',
          segment: id,
          message: `分段「${segment.name}」排草稿失败,台词稿里只有按字数估的时间:${e instanceof Error ? e.message : String(e)}`,
        });
        const subs = segment.subtitles ?? [];
        out.push({
          id,
          name: segment.name,
          kind: 'timed',
          duration: ms(segment.duration),
          lines: segment.lines.map((line) => {
            const s = subs.find((x) => x.id === line.id);
            return {
              id: line.id,
              text: line.text,
              plain: stripMarks(line.text),
              marks: markNames(line.text),
              draft: { start: ms(s?.start ?? 0), end: ms(s?.end ?? 0) },
            };
          }),
          cues: [],
          tail: 0,
        });
      }
      continue;
    }
    const subs = segment.subtitles ?? [];
    out.push({
      id,
      name: segment.name,
      kind: 'fixed',
      duration: ms(segment.duration),
      lines: subs.map((s, i) => ({
        id: voiceLineIdOf(segment, i),
        text: s.text,
        plain: stripMarks(s.text),
        marks: markNames(s.text),
        draft: { start: ms(s.start), end: ms(s.end) },
      })),
    });
  }
  return { script: { version: 1, film, segments: out }, problems };
}

/** 一句实测:音频时长,句中标记相对这句开头的时刻,以及文件(写进时间表)。 */
export interface MeasuredLine {
  readonly duration: number;
  readonly marks?: Readonly<Record<string, number>>;
  readonly audio?: AudioRef;
}

/** 实测结果:分段 id → 台词 id → 实测。 */
export type MeasuredAudio = Readonly<Record<string, Readonly<Record<string, MeasuredLine>>>>;

export interface LayoutOptions {
  /** 句首留白(秒),缺省 0.3。 */
  leadIn?: number;
  /** 句间停顿(秒),缺省 0.25。 */
  gap?: number;
  /** 段尾留白(秒),缺省 0.6。 */
  tail?: number;
}

interface Slot {
  start: number;
  end: number;
  marks: Record<string, number>;
}

/** 标记在句中的时刻(相对句首):有实测用实测;没有时按草稿里标记在句中的比例,再没有按字数比例估。 */
function markOffset(line: VoiceScriptLine, mark: string, duration: number, measured: MeasuredLine | undefined): number {
  const given = measured?.marks?.[mark];
  if (given !== undefined && Number.isFinite(given)) {
    return Math.min(duration, Math.max(0, given));
  }
  const draftMark = line.draft.marks?.[mark];
  const draftLength = line.draft.end - line.draft.start;
  if (draftMark !== undefined && draftLength > 0) {
    return Math.min(duration, Math.max(0, ((draftMark - line.draft.start) / draftLength) * duration));
  }
  const total = estimateSpeech(line.text, 1, 0);
  const before = estimateSpeech(textBeforeMark(line.text, mark) ?? '', 1, 0);
  return total > 0 ? (duration * before) / total : 0;
}

function layoutTimed(
  segment: VoiceScriptSegment,
  measured: Readonly<Record<string, MeasuredLine>> | undefined,
  o: Required<LayoutOptions>,
  problems: VoiceProblem[],
): VoiceSegmentTiming {
  const lines = segment.lines;
  const slots = new Map<string, Slot>();
  let cursor = o.leadIn;
  let lastCue = 0;

  const durationOf = (line: VoiceScriptLine): number => {
    const m = measured?.[line.id];
    if (m && Number.isFinite(m.duration) && m.duration > 0) {
      return m.duration;
    }
    return Math.max(0.1, line.draft.end - line.draft.start);
  };
  const place = (line: VoiceScriptLine, earliest: number): Slot => {
    const start = Math.max(earliest, cursor);
    const duration = durationOf(line);
    const marks: Record<string, number> = {};
    for (const mark of line.marks) {
      marks[mark] = start + markOffset(line, mark, duration, measured?.[line.id]);
    }
    const slot = { start, end: start + duration, marks };
    slots.set(line.id, slot);
    cursor = slot.end + o.gap;
    return slot;
  };
  const placeUpTo = (id: string): void => {
    for (const line of lines) {
      if (line.id === id) {
        return;
      }
      if (!slots.has(line.id)) {
        place(line, cursor);
      }
    }
  };
  const find = (id: string): VoiceScriptLine | undefined => lines.find((l) => l.id === id);

  for (const line of lines) {
    if (!measured?.[line.id]) {
      problems.push({
        level: 'error',
        segment: segment.id,
        line: line.id,
        message: `缺少台词「${line.id}」的实测音频,先按草稿时长 ${ms(line.draft.end - line.draft.start)} 秒占位`,
      });
    }
  }

  (segment.cues ?? []).forEach((cue, index) => {
    const line = find(cue.line);
    if (!line) {
      return;
    }
    const due = lastCue + cue.needs;
    let at: number;
    if (cue.mark === undefined) {
      const hit = slots.get(line.id);
      if (hit) {
        at = hit.start;
        if (at < due - 1e-9) {
          problems.push({
            level: 'warning',
            segment: segment.id,
            line: line.id,
            message: `第 ${index + 1} 个提示点(台词「${line.id}」开口)排在 ${ms(at)} 秒,动画要到 ${ms(due)} 秒才走到`,
          });
        }
      } else {
        placeUpTo(line.id);
        at = place(line, due).start;
      }
    } else {
      let slot = slots.get(line.id);
      if (!slot) {
        // 第一次碰到这句就是它的标记:让这个词正好落在动画走到的时刻(或更晚)。
        placeUpTo(line.id);
        const offset = markOffset(line, cue.mark, durationOf(line), measured?.[line.id]);
        slot = place(line, due - offset);
      }
      at = slot.marks[cue.mark] ?? slot.start;
      if (at < due - 1e-9) {
        // 这句的开口(或前一个标记)已经兑现过,整句后挪会把它们一起挪走:只能在音频里加停顿。
        const short = due - at;
        problems.push({
          level: 'warning',
          segment: segment.id,
          line: line.id,
          message: `标记「${cue.mark}」在这句里说得太早:动画还要 ${ms(short)} 秒才走到。请在这个词前面加 ${ms(short)} 秒停顿(或把这句拆成两段音频)`,
        });
      }
    }
    lastCue = Math.max(at, due);
  });

  for (const line of lines) {
    if (!slots.has(line.id)) {
      place(line, cursor);
    }
  }
  let lastEnd = 0;
  for (const slot of slots.values()) {
    lastEnd = Math.max(lastEnd, slot.end);
  }
  const duration = Math.max(lastEnd + o.tail, lastCue + (segment.tail ?? 0));
  return {
    id: segment.id,
    duration: ms(duration),
    lines: lines.map((line): VoiceLineTiming => {
      const slot = slots.get(line.id) ?? { start: 0, end: 0, marks: {} };
      const audio = measured?.[line.id]?.audio;
      const marks: Record<string, number> = {};
      for (const [name, t] of Object.entries(slot.marks)) {
        marks[name] = ms(t);
      }
      return {
        id: line.id,
        text: line.text,
        start: ms(slot.start),
        end: ms(slot.end),
        ...(audio !== undefined ? { audio } : {}),
        ...(Object.keys(marks).length > 0 ? { marks } : {}),
      };
    }),
  };
}

function layoutFixed(
  segment: VoiceScriptSegment,
  measured: Readonly<Record<string, MeasuredLine>> | undefined,
  problems: VoiceProblem[],
): VoiceSegmentTiming {
  const lines = segment.lines;
  return {
    id: segment.id,
    duration: segment.duration,
    lines: lines.map((line, i): VoiceLineTiming => {
      const m = measured?.[line.id];
      const start = line.draft.start;
      if (!m || !Number.isFinite(m.duration) || !(m.duration > 0)) {
        problems.push({
          level: 'error',
          segment: segment.id,
          line: line.id,
          message: `缺少台词「${line.id}」的实测音频:这句按字幕窗口显示,没有声音`,
        });
        return { id: line.id, text: line.text, start, end: line.draft.end };
      }
      const limit = Math.min(lines[i + 1]?.draft.start ?? segment.duration, segment.duration);
      let end = start + m.duration;
      if (end > line.draft.end + 0.05) {
        if (end > limit + 1e-9) {
          problems.push({
            level: 'error',
            segment: segment.id,
            line: line.id,
            message: `台词「${line.id}」说了 ${ms(m.duration)} 秒,这段动画时长固定,它会撞上${
              lines[i + 1] ? `下一句(${ms(limit)} 秒开口)` : `段尾(${ms(limit)} 秒)`
            }:请压缩到 ${ms(limit - start)} 秒以内`,
          });
          end = limit;
        } else {
          problems.push({
            level: 'warning',
            segment: segment.id,
            line: line.id,
            message: `台词「${line.id}」比字幕窗口长 ${ms(end - line.draft.end)} 秒(没撞上下一句,可以接受)`,
          });
        }
      }
      return {
        id: line.id,
        text: line.text,
        start: ms(start),
        end: ms(end),
        ...(m.audio !== undefined ? { audio: m.audio } : {}),
      };
    }),
  };
}

/**
 * 按实测音频排时间表:
 * - timed 段:每句不早于「上一句说完 + 停顿」;按脚本踩提示点的顺序满足每个提示点前动画要的时间
 *   (标记来得太早、这句又没法整体后挪时报出来,需要在那个词前加停顿);时长 = max(最后一句说完 + 段尾留白,
 *   最后一个提示点 + 动画尾巴)。
 * - fixed 段:动画时长固定,每句放在自己字幕窗口的起点;说得比窗口长时报出来(撞上下一句为 error)。
 */
export function layoutSheet(
  script: VoiceScript,
  measured: MeasuredAudio,
  options?: LayoutOptions,
): { sheet: VoiceTimingSheet; problems: VoiceProblem[] } {
  const o: Required<LayoutOptions> = {
    leadIn: options?.leadIn ?? LAYOUT_DEFAULTS.leadIn,
    gap: options?.gap ?? LAYOUT_DEFAULTS.gap,
    tail: options?.tail ?? LAYOUT_DEFAULTS.tail,
  };
  const problems: VoiceProblem[] = [];
  const segments = script.segments.map((segment) =>
    segment.kind === 'timed'
      ? layoutTimed(segment, measured[segment.id], o, problems)
      : layoutFixed(segment, measured[segment.id], problems),
  );
  return { sheet: { version: 1, film: script.film, segments }, problems };
}
