import type { Playable } from '../engine';
import { AnimationGroup } from '../engine';
import type { SegmentEnv } from './segments';
import { playDirected } from './segments';
import type { Segment, SegmentContext, SegmentHandle, SegmentVoice, Subtitle } from './types';
import { markNames, stripMarks, textBeforeMark } from './voiceSheet';

/**
 * 按台词对齐的分段(timedSegment):分段声明台词(稳定 id + 文本),脚本用提示点踩时间 ——
 * `await env.untilLine('slope-2')` 等到这句开口、`await env.untilMark('slope-2', 'k')` 等到句中某个词。
 * 时长、字幕时间都不写:有配音时间表时全听时间表的;没有时按「动画走到了、上一句也说完了」
 * 尽早排一份草稿(prepareVoice 干跑一遍排出来),片子照常能播、能预览、能导出。
 * 动画要跟着台词伸缩(画到这句说完、在某个词之前画完)用 env.playUntil / env.playThrough:
 * 写「在哪儿收住」,时长由引擎按目标算,草稿与配音一致,不用拿 remaining 估比例。
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

/** playUntil 的目标(三选一):这句开口 / 这句说完 / 说到句中某个标记。 */
export type TimedTarget =
  | { readonly start: string; readonly end?: never; readonly line?: never; readonly mark?: never }
  | { readonly end: string; readonly start?: never; readonly line?: never; readonly mark?: never }
  | { readonly line: string; readonly mark: string; readonly start?: never; readonly end?: never };

/** playUntil / playThrough 的时长约束(秒)。 */
export interface SpanOptions {
  /** 动画最短时长。缺省 = 这组动画自身的时长(再与 max 取小):只拉长、不压缩;允许压缩就写小一点。 */
  readonly min?: number;
  /** 动画最长时长,缺省不限:到了就停,静止等到目标。 */
  readonly max?: number;
  /** 提前量:动画在「目标 − lead」收住,静止到目标。缺省 0。 */
  readonly lead?: number;
}

/** playUntil 的参数:目标 + 时长约束,如 `{ end: 'slope-1', min: 0.8 }`、`{ line: 'slope-2', mark: 'k', lead: 0.3 }`。 */
export type UntilSpec = TimedTarget & SpanOptions;

/** playThrough 的参数:整句的台词 id + 时长约束。 */
export interface ThroughSpec extends SpanOptions {
  readonly line: string;
}

/**
 * playUntil 的事件(观察者用):动画 from 秒开始,至少 min 秒、提前 lead 秒收住,
 * 目标最早可以排在 ready = from + min + lead,实际排在 at。at < ready 说明时间不够。
 */
export interface SpanEvent {
  /** 脚本里写的是哪个(报问题时照着说)。 */
  readonly api: 'playUntil' | 'playThrough';
  readonly kind: 'start' | 'end' | 'mark';
  readonly line: string;
  /** kind 为 mark 时的标记名。 */
  readonly mark?: string;
  readonly from: number;
  readonly min: number;
  readonly lead: number;
  readonly ready: number;
  readonly at: number;
  /** 实际给动画的时长:clamp(at − lead − from, min, max)。 */
  readonly runTime: number;
}

export interface TimedEnv extends SegmentEnv {
  /** 等到这句台词开口。 */
  untilLine(id: string): Promise<void>;
  /** 等到台词里 <mark name="…"/> 标出的那个词。 */
  untilMark(lineId: string, mark: string): Promise<void>;
  /**
   * 播一组动画,让它在目标时刻(减 lead)收住,再静止等到目标 —— 相当于 untilXxx,只是等待由动画填满;
   * 返回时正好在目标时刻(时间不够时在 from + min)。
   * 时长 = clamp(目标 − lead − now, min, max);几个动画同时开始,按各自 runTime 的比例一起伸缩。
   * 目标:`{ start: 台词 }` 开口、`{ end: 台词 }` 说完、`{ line: 台词, mark: 标记 }` 说到这个词。
   * 时间不够(目标已过,或剩的不到 min + lead)时按 min 播,并告警一次。
   * 脚本还没踩到的句子(它和它后面的句子都还没 until / playUntil 过):`start` 目标让那句等动画的
   * min + lead(也不早于上一句说完 + 停顿);`end` / `mark` 目标让那句在调用时开口(不等,动画照常开始;
   * 台词稿里记一个开口提示点,配音排期也不会让它早于调用)。
   * 按顺序 await;要同时动的放进同一次调用(并发的 playUntil 能播,但台词稿里的 needs 会不准)。
   */
  playUntil(until: UntilSpec, ...playables: Playable[]): Promise<void>;
  /**
   * 整句都在播:这句还没踩到就先等它开口(untilLine),再 playUntil 到这句说完;已经踩到了(等过这句、
   * 它的标记或更靠后的句子)就直接画到说完,同 playUntil({ end })。可以带 min / max / lead。
   */
  playThrough(line: string | ThroughSpec, ...playables: Playable[]): Promise<void>;
  /** 本段已播秒数。 */
  now(): number;
  /**
   * 某句台词的起止(秒,相对本段)。草稿里还没排到的句子给的是不落定的预估:
   * 别拿它算动画时长(那句会被动画往后推),跟台词对齐的动画用 playUntil。
   */
  line(id: string): { readonly start: number; readonly end: number; readonly duration: number };
  /**
   * 这句还剩多少秒(已经说完为 0)。兼容保留的只读查询:跟台词对齐的动画时长用 playUntil / playThrough
   * (引擎按目标算,草稿与配音一致,不用估比例)。
   */
  remaining(id: string): number;
}

/** 提示点事件:脚本在 called 秒走到这个提示点,它被排在 at 秒(at < called 说明动画来不及)。 */
export interface CueEvent {
  readonly line: string;
  readonly mark?: string;
  readonly called: number;
  readonly at: number;
  /** 脚本没写 untilLine:playUntil 的句尾 / 标记目标落在还没踩到的句子上,那句在调用时开口(不等)。 */
  readonly implicit?: true;
}

/** 观察脚本踩提示点的情况(干跑排草稿、校验时间表时用)。 */
export interface TimingObserver {
  cue?(event: CueEvent): void;
  /** playUntil / playThrough 的目标(有它时「时间不够」不再 console.warn,由观察者报)。 */
  span?(event: SpanEvent): void;
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
/** playUntil「时间不够」的容差(秒):吸收一帧(30 fps)的取整。 */
const SPAN_TOLERANCE = 0.05;
/** 离目标不到这么多秒就不再静止等(浮点误差不值得多等一帧)。 */
const HOLD_EPSILON = 1e-6;

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

/** playUntil 的时长:clamp(at − lead − from, min, max)。时间不够(目标已过)时就是 min。 */
export function spanRunTime(
  from: number,
  at: number,
  options: { readonly min: number; readonly max: number; readonly lead: number },
): number {
  return Math.min(options.max, Math.max(options.min, at - options.lead - from));
}

/** playUntil 目标的说法(告警、校验共用)。 */
export function describeSpanTarget(target: Pick<SpanEvent, 'kind' | 'line' | 'mark'>): string {
  if (target.kind === 'start') {
    return `台词「${target.line}」开口`;
  }
  if (target.kind === 'end') {
    return `台词「${target.line}」说完`;
  }
  return `台词「${target.line}」的标记「${target.mark ?? ''}」`;
}

/** 解析后的 playUntil 目标。 */
type SpanTarget =
  | { readonly kind: 'start' | 'end'; readonly line: string }
  | { readonly kind: 'mark'; readonly line: string; readonly mark: string };

/** 目标要恰好三选一(类型挡住了大部分写错,这里兜住 JS 调用与强转)。 */
function parseTarget(spec: UntilSpec, where: string): SpanTarget {
  const raw = (typeof spec === 'object' && spec !== null ? spec : {}) as Partial<
    Record<'start' | 'end' | 'line' | 'mark', unknown>
  >;
  const given = (key: 'start' | 'end' | 'line' | 'mark'): boolean => raw[key] !== undefined;
  const text = (key: 'start' | 'end' | 'line' | 'mark'): string | null => {
    const v = raw[key];
    return typeof v === 'string' ? v : null;
  };
  const start = text('start');
  const end = text('end');
  const line = text('line');
  const mark = text('mark');
  if (start !== null && !given('end') && !given('line') && !given('mark')) {
    return { kind: 'start', line: start };
  }
  if (end !== null && !given('start') && !given('line') && !given('mark')) {
    return { kind: 'end', line: end };
  }
  if (line !== null && mark !== null && !given('start') && !given('end')) {
    return { kind: 'mark', line, mark };
  }
  throw new Error(
    `${where}playUntil 的目标要三选一:{ start: 台词id }(开口)、{ end: 台词id }(说完)、{ line: 台词id, mark: 标记 }`,
  );
}

/** 一组动画同时开始时的自然时长(与 AnimationGroup 不错峰时一致):非有限 / 非正的按 0。 */
function naturalRunTime(playables: readonly Playable[]): number {
  let total = 0;
  for (const p of playables) {
    if (Number.isFinite(p.runTime) && p.runTime > 0) {
      total = Math.max(total, p.runTime);
    }
  }
  return total;
}

/** 时长约束:缺省 min = 自然时长(与 max 取小)、max = ∞、lead = 0;不合法就抛错。 */
function spanOptions(
  spec: SpanOptions,
  natural: number,
  where: string,
  api: 'playUntil' | 'playThrough',
): { min: number; max: number; lead: number } {
  const max: unknown = spec.max ?? Infinity;
  if (!(typeof max === 'number' && max >= 0)) {
    throw new Error(`${where}${api} 的 max 需要非负数,收到 ${String(max)}`);
  }
  const lead: unknown = spec.lead ?? 0;
  if (!(typeof lead === 'number' && Number.isFinite(lead) && lead >= 0)) {
    throw new Error(`${where}${api} 的 lead 需要非负有限数,收到 ${String(lead)}`);
  }
  const min: unknown = spec.min ?? Math.min(natural, max);
  if (!(typeof min === 'number' && Number.isFinite(min) && min >= 0)) {
    throw new Error(`${where}${api} 的 min 需要非负有限数,收到 ${String(min)}`);
  }
  if (min > max) {
    throw new Error(`${where}${api} 的 min(${min})大于 max(${max})`);
  }
  return { min, max, lead };
}

/** playUntil 是否时间不够:目标已过,或剩的不到 min + lead(差出容差才算,帧取整不算)。 */
export function isSpanShort(e: Pick<SpanEvent, 'at' | 'ready'>): boolean {
  return e.at < e.ready - SPAN_TOLERANCE;
}

/** 「时间不够」的说法:哪个目标、差多少(告警、台词稿共用)。 */
export function describeSpanShortfall(e: SpanEvent): string {
  const f = (v: number): string => v.toFixed(2);
  const why =
    e.at <= e.from
      ? `目标在 ${f(e.at)} 秒,调用时已经 ${f(e.from)} 秒(目标已经过了)`
      : `到目标(${f(e.at)} 秒)只剩 ${f(e.at - e.from)} 秒,动画至少要 ${f(e.min)} 秒${
          e.lead > 0 ? `、提前 ${f(e.lead)} 秒收住` : ''
        }`;
  const late = e.from + e.runTime - e.at;
  const result = late > SPAN_TOLERANCE ? `比目标晚 ${f(late)} 秒收住` : `提前量只剩 ${f(Math.max(0, -late))} 秒`;
  return `${e.api}(${describeSpanTarget(e)}):${why};动画按 ${f(e.runTime)} 秒播,${result}`;
}

/** 提示点的时间来源:时间表(固定)或草稿(边跑边排)。 */
interface CueClock {
  lineStart(id: string, now: number): number;
  markAt(lineId: string, mark: string, now: number): number;
  /**
   * playUntil 的目标时刻。from 是调用时刻,ready = from + min + lead 是动画最早能收住(含提前量)的时刻:
   * 时间表直接查;草稿里还没开口的句子,start 目标排在 max(ready, 上一句说完 + 停顿),
   * end / mark 目标让那句在 from 开口;标记来不及就后挪(同 untilMark),句尾不挪。
   */
  target(t: SpanTarget, from: number, ready: number): number;
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

  target(t: SpanTarget): number {
    if (t.kind === 'mark') {
      return this.markAt(t.line, t.mark);
    }
    const line = this.line(t.line);
    return t.kind === 'start' ? line.start : line.end;
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
 * 交给过脚本的时刻(untilMark 的标记、playUntil 的句尾 / 标记)不再挪(frozen):草稿排完后按草稿时间重跑,
 * 每个提示点、每段动画的时长都与干跑时一致。
 */
class DraftPlanner implements CueClock {
  private readonly lines: readonly TimedLine[];
  private readonly rate: number;
  private readonly placed = new Map<string, Placed>();
  /** 台词 → 交给过脚本的最晚时刻(标记或句尾):这个时刻及之前的都不再挪。 */
  private readonly frozen = new Map<string, number>();
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
      return this.handOut(lineId, planned);
    }
    const frozen = this.frozen.get(lineId);
    if (frozen !== undefined && planned <= frozen) {
      // 脚本已经按这个时刻(或更晚的标记 / 句尾)踩过点、算过动画时长:不挪,这个提示点算来晚了。
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
      return this.handOut(lineId, now);
    }
    const moved = Math.min(now, entry.end);
    entry.marks[mark] = moved;
    return this.handOut(lineId, moved);
  }

  target(t: SpanTarget, from: number, ready: number): number {
    if (t.kind === 'start') {
      // 排过的就是排好的开口;还没排到的等动画的 min + lead(不早于上一句说完 + 停顿)。
      return this.lineStart(t.line, ready);
    }
    // 句尾 / 标记:这句还没开口就在调用时开口(同 untilLine / untilMark)。
    this.lineStart(t.line, from);
    let at: number;
    if (t.kind === 'mark') {
      at = this.markAt(t.line, t.mark, ready);
    } else {
      const entry = this.placed.get(t.line);
      if (!entry) {
        throw new Error(`没有台词「${t.line}」的时间`);
      }
      // 句尾按字数定,不为动画后挪:动画比这句长就是真的比这句长(告警)。
      at = this.handOut(t.line, entry.end);
    }
    return at;
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

  /** 把这个时刻交给脚本:记下来,之后来晚的提示点不再把它挪走。 */
  private handOut(lineId: string, at: number): number {
    this.frozen.set(lineId, Math.max(this.frozen.get(lineId) ?? at, at));
    return at;
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
 * 脚本里用 env.untilLine / env.untilMark 踩提示点,跟着台词伸缩的动画用 env.playUntil / env.playThrough。
 * 用之前经过 prepareVoice(影片加载时统一做)。
 */
export function timedSegment(
  options: TimedSegmentOptions,
  direct: (env: TimedEnv) => Promise<void>,
): TimedSegment {
  const rate = validate(options);
  const lines = options.lines.map((l) => ({ id: l.id, text: l.text }));
  /** 台词 id → 声明顺序。 */
  const order = new Map(lines.map((l, i) => [l.id, i]));
  const where = `timedSegment「${options.name}」`;
  const base = {
    name: options.name,
    id: options.id,
    ...(options.marker !== undefined ? { marker: options.marker } : {}),
    ...(options.chapter !== undefined ? { chapter: options.chapter } : {}),
  };
  // 「时间不够」每个目标只告警一次(本段的草稿、时间表版本、重播共用)。
  const spanWarned = new Set<string>();
  const warnSpan = (e: SpanEvent): void => {
    const key = `${e.kind}|${e.line}|${e.mark ?? ''}`;
    if (!spanWarned.has(key)) {
      spanWarned.add(key);
      console.warn(
        `[film] ${where}${describeSpanShortfall(e)}(调小 min / lead、换个更晚的目标,或让台词留出时间)`,
      );
    }
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
        if (!order.has(id)) {
          throw new Error(`${where}没有声明台词「${id}」`);
        }
      };
      // 脚本踩到的最靠后一句(声明顺序):它和它前面的句子都已经排上了 —— 草稿、配音排期(layoutSheet)
      // 都按这个规则排,与时钟无关,所以草稿、按时间表重跑、校验时发出的提示点序列一样。
      let reached = -1;
      const isReached = (id: string): boolean => (order.get(id) ?? -1) <= reached;
      const reach = (id: string): void => {
        reached = Math.max(reached, order.get(id) ?? -1);
      };
      const untilLine = async (id: string): Promise<void> => {
        requireLine(id);
        reach(id);
        const called = now();
        const at = clock.lineStart(id, called);
        observer?.cue?.({ line: id, called, at });
        await env.wait(Math.max(0, at - called));
      };
      const untilMark = async (lineId: string, mark: string): Promise<void> => {
        requireLine(lineId);
        reach(lineId);
        const called = now();
        const at = clock.markAt(lineId, mark, called);
        observer?.cue?.({ line: lineId, mark, called, at });
        await env.wait(Math.max(0, at - called));
      };
      const span = async (
        target: SpanTarget,
        o: SpanOptions,
        playables: readonly Playable[],
        api: 'playUntil' | 'playThrough',
      ): Promise<void> => {
        requireLine(target.line);
        const { min, max, lead } = spanOptions(o, naturalRunTime(playables), where, api);
        const from = now();
        const ready = from + min + lead;
        // 句尾 / 标记落在还没踩到的句子上:这句在调用时开口(不等,动画照常开始)。
        // 随后报一个开口提示点:台词稿因此要求这句不早于调用时开口,配音排期与草稿一致。
        const opens = target.kind !== 'start' && !isReached(target.line) ? clock.lineStart(target.line, from) : null;
        reach(target.line);
        const at = clock.target(target, from, ready);
        const runTime = spanRunTime(from, at, { min, max, lead });
        // 先建组再报事件:同一个动画实例传两次这类错误在这里抛,不留半截事件。
        const group = playables.length > 0 ? new AnimationGroup(playables, { runTime }) : null;
        if (opens !== null) {
          observer?.cue?.({ line: target.line, called: from, at: opens, implicit: true });
        }
        const event: SpanEvent = {
          api,
          kind: target.kind,
          line: target.line,
          ...(target.kind === 'mark' ? { mark: target.mark } : {}),
          from,
          min,
          lead,
          ready,
          at,
          runTime,
        };
        if (observer?.span) {
          observer.span(event);
        } else if (isSpanShort(event)) {
          warnSpan(event);
        }
        if (group) {
          await env.play(group);
        }
        // 动画提前收住(max / lead)就静止等到目标:返回时正好在目标时刻。
        const hold = at - now();
        if (hold > HOLD_EPSILON) {
          await env.wait(hold);
        }
      };
      const timedEnv: TimedEnv = {
        ...env,
        now,
        untilLine,
        untilMark,
        playUntil: async (until, ...playables) => {
          await span(parseTarget(until, where), until, playables, 'playUntil');
        },
        playThrough: async (line, ...playables) => {
          const spec: unknown = typeof line === 'string' ? { line } : line;
          const raw = (typeof spec === 'object' && spec !== null ? spec : {}) as Partial<ThroughSpec> & {
            readonly mark?: unknown;
          };
          if (typeof raw.line !== 'string' || raw.mark !== undefined) {
            throw new Error(`${where}playThrough 要一句台词的 id(整句);对齐标记用 playUntil({ line, mark })`);
          }
          requireLine(raw.line);
          // 已经踩到这句(开过口)就不再等开口:再等一次只会是个来晚的提示点。
          if (!isReached(raw.line)) {
            await untilLine(raw.line);
          }
          await span({ kind: 'end', line: raw.line }, raw, playables, 'playThrough');
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
              ...(observer?.span ? { span: (e: SpanEvent) => observer.span?.(e) } : {}),
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
