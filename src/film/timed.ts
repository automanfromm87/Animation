import type { SegmentEnv } from './segments';
import { playDirected } from './segments';
import type { Segment, SegmentContext, SegmentHandle, SegmentVoice, Subtitle } from './types';
import { markNames, stripMarks, textBeforeMark } from './voiceSheet';

/**
 * 按台词对齐的分段(timedSegment):分段声明台词(稳定 id + 文本),脚本用提示点踩时间 ——
 * `await env.untilLine('slope-2')` 等到这句开口、`await env.untilMark('slope-2', 'k')` 等到句中某个词。
 * 时长、字幕时间都不写:有配音时间表时全听时间表的;没有时按「动画走到了、上一句也说完了」
 * 尽早排一份草稿(prepareVoice 干跑一遍排出来),片子照常能播、能预览、能导出。
 */

export interface TimedLine {
  /** 稳定 id:配音方按它交音频、写时间表。 */
  readonly id: string;
  /** 台词。可以用 <mark name="k"/> 标出要对齐的词(配音方据此给出那个词的时刻)。 */
  readonly text: string;
}

export interface TimedSegmentOptions {
  /** 稳定 id(配音时间表按它对应)。 */
  readonly id: string;
  /** 显示名(进度条提示、报错信息)。 */
  readonly name: string;
  readonly lines: readonly TimedLine[];
  readonly marker?: 'chapter' | 'segment';
  readonly chapter?: string;
  /** 草稿语速(字 / 秒),缺省 4.5:没有时间表时按它估每句要说多久。 */
  readonly draftRate?: number;
}

/** 一句台词的时间(秒,相对本段开头)。 */
export interface LineTiming {
  readonly start: number;
  readonly end: number;
  /** 句中标记的时刻。 */
  readonly marks: Readonly<Record<string, number>>;
}

/** 一段的时间:时长 + 每句台词的起止与标记。 */
export interface SegmentTiming {
  readonly duration: number;
  readonly lines: Readonly<Record<string, LineTiming>>;
}

export interface TimedEnv extends SegmentEnv {
  /** 等到这句台词开口。 */
  untilLine(id: string): Promise<void>;
  /** 等到台词里 <mark name="…"/> 标出的那个词。 */
  untilMark(lineId: string, mark: string): Promise<void>;
  /** 本段已播秒数。 */
  now(): number;
  /** 某句台词的起止(秒,相对本段);草稿模式下还没排到的句子给预估值。 */
  line(id: string): { readonly start: number; readonly end: number; readonly duration: number };
  /** 这句还剩多少秒(已经说完为 0)。常用作 runTime:`{ runTime: env.remaining('slope-2') }`。 */
  remaining(id: string): number;
}

/** 提示点事件:脚本在 called 秒走到这个提示点,它被排在 at 秒(at < called 说明动画来不及)。 */
export interface CueEvent {
  readonly line: string;
  readonly mark?: string;
  readonly called: number;
  readonly at: number;
}

/** 观察脚本踩提示点的情况(干跑排草稿、校验时间表时用)。 */
export interface TimingObserver {
  cue?(event: CueEvent): void;
  /** 脚本跑完:called 是跑完时的时刻,duration 是本段要撑到的时长。 */
  end?(event: { readonly called: number; readonly duration: number }): void;
}

export interface TimedSegment extends Segment {
  readonly id: string;
  readonly lines: readonly TimedLine[];
  /** 按给定时间(时间表或草稿)产出一个确定时长的普通分段。 */
  withTiming(timing: SegmentTiming, options?: { voice?: SegmentVoice; observer?: TimingObserver }): Segment;
  /** 草稿模式的分段:提示点按「动画走到了、上一句也说完了」尽早排;跑完后 result() 给出排出来的时间。 */
  drafting(observer?: TimingObserver): { readonly segment: Segment; result(): SegmentTiming | null };
}

/** 句首留白、句间停顿、段尾留白(秒)。 */
const LEAD_IN = 0.3;
const GAP = 0.25;
const TAIL = 0.6;
const DEFAULT_RATE = 4.5;

const TIMED = Symbol('timedSegment');

/** 是不是 timedSegment 造的(还没套上时间的)分段。 */
export function isTimedSegment(segment: Segment): segment is TimedSegment {
  return (segment as Partial<Record<typeof TIMED, boolean>>)[TIMED] === true;
}

/** 按字数估一句要说多久(秒):字数 / 语速,逗号类停 0.15 秒、句号类停 0.3 秒。 */
export function estimateSpeech(text: string, rate: number, floor = 0.8): number {
  const plain = stripMarks(text);
  let chars = 0;
  let pauses = 0;
  for (const ch of plain) {
    if (/\s/.test(ch)) {
      continue;
    }
    if (/[,，、;；:：]/.test(ch)) {
      pauses += 0.15;
    } else if (/[。.!！?？…]/.test(ch)) {
      pauses += 0.3;
    } else {
      chars += 1;
    }
  }
  return Math.max(floor, chars / rate + pauses);
}

/** 字幕:每句台词一条(去掉标记标签)。 */
export function subtitlesFor(lines: readonly TimedLine[], timing: SegmentTiming): Subtitle[] {
  const out: Subtitle[] = [];
  for (const line of lines) {
    const t = timing.lines[line.id];
    if (t) {
      out.push({ id: line.id, start: t.start, end: t.end, text: stripMarks(line.text) });
    }
  }
  return out.sort((a, b) => a.start - b.start);
}

/** 提示点的时间来源:时间表(固定)或草稿(边跑边排)。 */
interface CueClock {
  lineStart(id: string, now: number): number;
  markAt(lineId: string, mark: string, now: number): number;
  line(id: string): LineTiming;
  /** 脚本跑完:返回本段要撑到的时刻。 */
  finish(now: number): number;
}

class FixedClock implements CueClock {
  private readonly timing: SegmentTiming;

  constructor(timing: SegmentTiming) {
    this.timing = timing;
  }

  lineStart(id: string): number {
    return this.line(id).start;
  }

  markAt(lineId: string, mark: string): number {
    const at = this.line(lineId).marks[mark];
    if (at === undefined) {
      throw new Error(`台词「${lineId}」里没有标记 <mark name="${mark}"/>`);
    }
    return at;
  }

  line(id: string): LineTiming {
    const t = this.timing.lines[id];
    if (!t) {
      throw new Error(`没有台词「${id}」的时间`);
    }
    return t;
  }

  finish(now: number): number {
    return Math.max(now, this.timing.duration);
  }
}

interface Placed {
  start: number;
  end: number;
  marks: Record<string, number>;
}

/**
 * 草稿排期:台词按声明顺序排,每句在「脚本走到它的提示点」与「上一句说完 + 停顿」两者中较晚的时刻开口;
 * 脚本没有等的句子接着上一句说。标记按字数比例落在句中,脚本来晚了就把这句往后挪。
 */
class DraftPlanner implements CueClock {
  private readonly lines: readonly TimedLine[];
  private readonly rate: number;
  private readonly placed = new Map<string, Placed>();
  private lastPlaced: string | null = null;
  private cursor = LEAD_IN;

  constructor(lines: readonly TimedLine[], rate: number) {
    this.lines = lines;
    this.rate = rate;
  }

  lineStart(id: string, now: number): number {
    const hit = this.placed.get(id);
    if (hit) {
      return hit.start;
    }
    const target = this.find(id);
    for (const l of this.lines) {
      if (l.id === id) {
        break;
      }
      if (!this.placed.has(l.id)) {
        this.put(l, this.cursor);
      }
    }
    return this.put(target, Math.max(now, this.cursor)).start;
  }

  markAt(lineId: string, mark: string, now: number): number {
    this.lineStart(lineId, now);
    const entry = this.placed.get(lineId);
    const planned = entry?.marks[mark];
    if (!entry || planned === undefined) {
      throw new Error(`台词「${lineId}」里没有标记 <mark name="${mark}"/>`);
    }
    if (now <= planned) {
      return planned;
    }
    // 脚本来晚了:这句从这个标记起整体往后挪(只挪最后排的那句,排过的句子已经说过了)。
    if (this.lastPlaced === lineId) {
      const shift = now - planned;
      for (const [name, t] of Object.entries(entry.marks)) {
        if (t >= planned) {
          entry.marks[name] = t + shift;
        }
      }
      entry.end += shift;
      this.cursor = Math.max(this.cursor, entry.end + GAP);
      return now;
    }
    entry.marks[mark] = Math.min(now, entry.end);
    return entry.marks[mark] ?? now;
  }

  line(id: string): LineTiming {
    const hit = this.placed.get(id);
    if (hit) {
      return hit;
    }
    // 还没排到:按「接在当前排期后面」给个预估,不落定。
    const line = this.find(id);
    return this.plan(line, this.cursor);
  }

  finish(now: number): number {
    for (const l of this.lines) {
      if (!this.placed.has(l.id)) {
        this.put(l, this.cursor);
      }
    }
    let lastEnd = 0;
    for (const p of this.placed.values()) {
      lastEnd = Math.max(lastEnd, p.end);
    }
    return Math.max(now, lastEnd + TAIL);
  }

  timing(duration: number): SegmentTiming {
    const lines: Record<string, LineTiming> = {};
    for (const [id, p] of this.placed) {
      lines[id] = { start: p.start, end: p.end, marks: { ...p.marks } };
    }
    return { duration, lines };
  }

  private find(id: string): TimedLine {
    const line = this.lines.find((l) => l.id === id);
    if (!line) {
      throw new Error(`没有声明台词「${id}」`);
    }
    return line;
  }

  private plan(line: TimedLine, start: number): Placed {
    const end = start + estimateSpeech(line.text, this.rate);
    const marks: Record<string, number> = {};
    for (const name of markNames(line.text)) {
      const before = textBeforeMark(line.text, name) ?? '';
      marks[name] = Math.min(end, start + estimateSpeech(before, this.rate, 0));
    }
    return { start, end, marks };
  }

  private put(line: TimedLine, start: number): Placed {
    const p = this.plan(line, Math.max(start, this.cursor));
    this.placed.set(line.id, p);
    this.lastPlaced = line.id;
    this.cursor = p.end + GAP;
    return p;
  }
}

/** 纯按字数排的时间(台词一句接一句):没经过 prepareVoice 时的兜底时长与字幕。 */
function estimatedTiming(lines: readonly TimedLine[], rate: number): SegmentTiming {
  const planner = new DraftPlanner(lines, rate);
  return planner.timing(planner.finish(0));
}

function validate(options: TimedSegmentOptions): number {
  const where = `timedSegment「${options.name}」`;
  if (options.id.trim() === '') {
    throw new Error(`${where}需要 id`);
  }
  const ids = new Set<string>();
  for (const line of options.lines) {
    if (line.id.trim() === '') {
      throw new Error(`${where}有台词缺少 id`);
    }
    if (ids.has(line.id)) {
      throw new Error(`${where}的台词 id「${line.id}」重复`);
    }
    ids.add(line.id);
    if (stripMarks(line.text).trim() === '') {
      throw new Error(`${where}的台词「${line.id}」是空的`);
    }
    const marks = markNames(line.text);
    if (new Set(marks).size !== marks.length) {
      throw new Error(`${where}的台词「${line.id}」里有重名的标记`);
    }
  }
  const rate = options.draftRate ?? DEFAULT_RATE;
  if (!(Number.isFinite(rate) && rate > 0)) {
    throw new Error(`${where}的 draftRate 需要正数`);
  }
  return rate;
}

/**
 * timedSegment:按台词对齐的分段。时长与字幕时间由配音时间表决定(没有时由草稿决定),
 * 脚本里用 env.untilLine / env.untilMark 踩提示点。用之前经过 prepareVoice(影片加载时统一做)。
 */
export function timedSegment(
  options: TimedSegmentOptions,
  direct: (env: TimedEnv) => Promise<void>,
): TimedSegment {
  const rate = validate(options);
  const lines = options.lines.map((l) => ({ id: l.id, text: l.text }));
  const declared = new Set(lines.map((l) => l.id));
  const base = {
    name: options.name,
    id: options.id,
    ...(options.marker !== undefined ? { marker: options.marker } : {}),
    ...(options.chapter !== undefined ? { chapter: options.chapter } : {}),
  };

  const run = (
    clock: CueClock,
    observer: TimingObserver | undefined,
    canvas: HTMLCanvasElement,
    context: SegmentContext | undefined,
  ): SegmentHandle =>
    playDirected(canvas, context, async (env) => {
      const now = (): number => env.scene.getElapsed();
      const requireLine = (id: string): void => {
        if (!declared.has(id)) {
          throw new Error(`timedSegment「${options.name}」没有声明台词「${id}」`);
        }
      };
      const timedEnv: TimedEnv = {
        ...env,
        now,
        untilLine: async (id) => {
          requireLine(id);
          const called = now();
          const at = clock.lineStart(id, called);
          observer?.cue?.({ line: id, called, at });
          await env.wait(Math.max(0, at - called));
        },
        untilMark: async (lineId, mark) => {
          requireLine(lineId);
          const called = now();
          const at = clock.markAt(lineId, mark, called);
          observer?.cue?.({ line: lineId, mark, called, at });
          await env.wait(Math.max(0, at - called));
        },
        line: (id) => {
          requireLine(id);
          const t = clock.line(id);
          return { start: t.start, end: t.end, duration: t.end - t.start };
        },
        remaining: (id) => {
          requireLine(id);
          return Math.max(0, clock.line(id).end - now());
        },
      };
      await direct(timedEnv);
      const called = now();
      const until = clock.finish(called);
      observer?.end?.({ called, duration: until });
      // 撑到本段时长:话还没说完(或时间表留了尾巴)就停在最后一帧等着。
      await env.wait(Math.max(0, until - called));
    });

  const estimate = estimatedTiming(lines, rate);
  let warned = false;
  const segment: TimedSegment & Record<typeof TIMED, boolean> = {
    ...base,
    [TIMED]: true,
    lines,
    duration: estimate.duration,
    subtitles: subtitlesFor(lines, estimate),
    play(canvas, context) {
      if (!warned) {
        warned = true;
        console.warn(
          `[film] timedSegment「${options.name}」没有经过 prepareVoice:时长是按字数估的,可能和实际时间线对不上`,
        );
      }
      return run(new DraftPlanner(lines, rate), undefined, canvas, context);
    },
    withTiming(timing, extra) {
      for (const line of lines) {
        if (!timing.lines[line.id]) {
          throw new Error(`timedSegment「${options.name}」缺少台词「${line.id}」的时间`);
        }
      }
      return {
        ...base,
        duration: timing.duration,
        subtitles: subtitlesFor(lines, timing),
        ...(extra?.voice ? { voice: extra.voice } : {}),
        play: (canvas, context) => run(new FixedClock(timing), extra?.observer, canvas, context),
      };
    },
    drafting(observer) {
      let result: SegmentTiming | null = null;
      const draft: Segment = {
        ...base,
        duration: estimate.duration,
        subtitles: subtitlesFor(lines, estimate),
        play: (canvas, context) => {
          const planner = new DraftPlanner(lines, rate);
          return run(
            planner,
            {
              ...(observer?.cue ? { cue: (e: CueEvent) => observer.cue?.(e) } : {}),
              end: (e) => {
                result = planner.timing(e.duration);
                observer?.end?.(e);
              },
            },
            canvas,
            context,
          );
        },
      };
      return { segment: draft, result: () => result };
    },
  };
  return segment;
}
