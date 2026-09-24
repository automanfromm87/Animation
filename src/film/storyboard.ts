import { smooth } from '../engine';
import { FilmError } from '../export/types';
import { OFFLINE_DEFAULT_FPS } from './offline';
import { filmDuration, segmentAtTime, segmentStarts, subtitleAt } from './timeline';
import type { Segment } from './types';

/**
 * 故事板(contact sheet)的纯逻辑:URL 规格解析、取帧、取整到帧网格、说明文案、缩略图与联系表的尺寸。
 * 不碰 DOM 和画布,全部可以在 node 里单测;渲染在 storyboardRender.ts,视图在 storyboardView.ts。
 *
 * 取帧的关键约束:段内偏移一律取整到 1/fps 的整数步。快进的步数按「还差多少」四舍五入,
 * 目标是整数步时,「同一段接着上一帧往前推」和「从 0 推」(?preview= 单帧预览)落在同一步上,
 * 缩略图和点进去的单帧预览才是同一帧。
 */

/** 缺省帧数。 */
export const DEFAULT_STORYBOARD_COUNT = 24;
/** 一页最多多少帧(内存:200 × 400×225×4 ≈ 72 MB)。 */
export const MAX_STORYBOARD_FRAMES = 200;
/** 段首躲白场的余量:转场单边时长 + 它。 */
export const STORYBOARD_LEAD_MARGIN = 0.1;
/** 分段模式段尾那一帧离段尾多远。 */
export const STORYBOARD_TAIL_SECONDS = 0.3;
/** 分段模式里两帧至少隔多久,再近就合并。 */
export const STORYBOARD_MIN_GAP = 0.2;
/**
 * 非末段的帧离段尾至少这么远(秒)。段尾那一刻按 segmentAtTime 属于下一段的 0 秒;
 * 留 2 ms,预览地址按毫秒级小数写出来也不会越过段界。
 */
const SEGMENT_END_GUARD = 0.002;
/** 缺省转场单边时长(与播放器一致)。 */
const DEFAULT_TRANSITION = 0.6;

/** 故事板取帧方式。 */
export type StoryboardSpec =
  | { readonly kind: 'even'; readonly count: number }
  | { readonly kind: 'times'; readonly times: readonly number[] }
  | { readonly kind: 'segments' };

export interface ParsedStoryboardSpec {
  readonly spec: StoryboardSpec;
  /** 解析时丢掉 / 改写的项(中文,显示在页头)。 */
  readonly notes: readonly string[];
}

const DEFAULT_SPEC: StoryboardSpec = { kind: 'even', count: DEFAULT_STORYBOARD_COUNT };

/** 秒数写成人读的短串:最多三位小数,去掉末尾的 0。 */
function fmtSeconds(s: number): string {
  return String(Math.round(s * 1000) / 1000);
}

/** 保留一位小数(说明文案里的段内秒数、时长)。 */
function fmt1(x: number): string {
  return (Math.round((Number.isFinite(x) ? x : 0) * 10) / 10).toFixed(1);
}

/**
 * 全角 → 半角(NFKC):中文输入法打出来的 '１０ｓ'、'1：05'、'，'、'；'、全角空格都按半角认。
 */
const toHalfWidth = (text: string): string => text.normalize('NFKC');

/** 整数秒 → 'm:ss'(提示里教人怎么写时刻用)。 */
function clockOf(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
}

/** 单个时刻:'12.5' | '12.5s' | '.5' | '1:05.5'(全角也认)→ 秒;认不出(含负数、指数写法)返回 null。 */
export function parseStoryboardTime(token: string): number | null {
  const t = toHalfWidth(token).trim();
  const plain = /^(\d+(?:\.\d*)?|\.\d+)s?$/i.exec(t);
  if (plain?.[1] !== undefined) {
    const v = Number(plain[1]);
    return Number.isFinite(v) ? v : null;
  }
  const clock = /^(\d+):(\d+(?:\.\d*)?|\.\d+)$/.exec(t);
  if (clock?.[1] !== undefined && clock[2] !== undefined) {
    const m = Number(clock[1]);
    const s = Number(clock[2]);
    // m:ss 的秒必须小于 60:1:75 多半是笔误,不猜。
    return Number.isFinite(m) && Number.isFinite(s) && s < 60 ? m * 60 + s : null;
  }
  return null;
}

/**
 * URL 里 storyboard= 的原文 → 规格。null / undefined / 空白按缺省 24 帧。永不抛错。
 * 先把全角字符转成半角(中文输入法打的数字、冒号、逗号、分号都认)。
 * - 纯整数 n:均匀取 n 帧(**只有一个纯整数时它是帧数**;第 10 秒写 10s、10.0、0:10 或 10,)。
 *   这条最容易误会,所以每次都在页头提示一句怎么写时刻。
 * - segments / segment(大小写不敏感):每段三帧
 * - 其余按时刻列表:分隔符 , ; 、 或空白;单项认 12.5 / 12.5s / .5 / 1:05.5
 */
export function parseStoryboardSpec(raw: string | null | undefined): ParsedStoryboardSpec {
  const text = toHalfWidth(raw ?? '').trim();
  if (text === '') {
    return { spec: DEFAULT_SPEC, notes: [] };
  }
  const lower = text.toLowerCase();
  if (lower === 'segments' || lower === 'segment') {
    return { spec: { kind: 'segments' }, notes: [] };
  }
  if (/^\d+$/.test(text)) {
    const count = Number(text);
    if (!(count >= 1)) {
      return { spec: DEFAULT_SPEC, notes: [`帧数至少为 1,按缺省 ${DEFAULT_STORYBOARD_COUNT} 帧`] };
    }
    return {
      spec: { kind: 'even', count },
      notes: [`按 ${count} 帧均匀取;要看第 ${count} 秒那一帧,写 ${count}s 或 ${clockOf(count)}`],
    };
  }
  const notes: string[] = [];
  const times: number[] = [];
  for (const token of text.split(/[,;、\s]+/u)) {
    if (token === '') {
      continue;
    }
    const v = parseStoryboardTime(token);
    if (v === null) {
      notes.push(`“${token}” 不是时刻(写秒数如 12.5、12.5s,或 m:ss 如 1:05.5),已忽略`);
    } else {
      times.push(v);
    }
  }
  if (times.length === 0) {
    notes.push(`没有可用的时刻,按缺省 ${DEFAULT_STORYBOARD_COUNT} 帧`);
    return { spec: DEFAULT_SPEC, notes };
  }
  return { spec: { kind: 'times', times }, notes };
}

export type StoryboardFrameRole = 'even' | 'start' | 'middle' | 'end' | 'explicit';

/** 计划里的一帧(取整后)。 */
export interface StoryboardFrame {
  /** 显示序号(0 起,按全片时刻升序)。 */
  readonly n: number;
  /** 分段序号。 */
  readonly index: number;
  /** 段内偏移(秒),已取整到 1/fps 网格。 */
  readonly offset: number;
  /** 全片时刻(秒)= 段起点 + offset。 */
  readonly position: number;
  /**
   * 点进单帧预览(?preview=)用的全片秒数:能还原到同一段、同一步的最短小数(≤ 6 位)。
   * 直接写 position 会带上 12.366666666666667 这种浮点尾巴。
   */
  readonly preview: number;
  readonly name: string;
  /** 该段声明时长。 */
  readonly duration: number;
  /** 该时刻的字幕(无则空串)。 */
  readonly subtitle: string;
  readonly role: StoryboardFrameRole;
  /** times 模式:用户写的秒数(夹紧前)。 */
  readonly requested?: number;
  /** times 模式:超出片长、按片尾画。 */
  readonly clamped?: boolean;
}

export interface StoryboardPlanOptions {
  /** 转场单边时长(秒),缺省 0.6(与播放器一致)。 */
  readonly transition?: number;
  /** 最多多少帧,缺省 MAX_STORYBOARD_FRAMES。 */
  readonly maxFrames?: number;
  /** 帧网格(与快进步长一致),缺省 OFFLINE_DEFAULT_FPS。不是 30 时点进的单帧预览可能差一帧(预览按 30 快进)。 */
  readonly fps?: number;
}

export interface StoryboardPlan {
  readonly frames: readonly StoryboardFrame[];
  readonly notes: readonly string[];
  readonly total: number;
  readonly segmentCount: number;
}

/** 均匀取帧的理想时刻:n 个等宽区间的中点(避开 0 秒的白场和片尾那一刻)。total ≤ 0 或 n < 1 返回 []。 */
export function evenStoryboardTimes(total: number, count: number): number[] {
  const n = Math.floor(count);
  if (!(total > 0) || !(n >= 1)) {
    return [];
  }
  return Array.from({ length: n }, (_, k) => ((k + 0.5) * total) / n);
}

const sanitizeTransition = (t: number | undefined): number =>
  t !== undefined && Number.isFinite(t) ? Math.max(0, t) : DEFAULT_TRANSITION;

/** 分段模式单段的候选偏移(未取整;取整和合并在 planStoryboard 里做)。 */
export function segmentStoryboardOffsets(
  duration: number,
  transition?: number,
): Array<{ offset: number; role: 'start' | 'middle' | 'end' }> {
  const d = Number.isFinite(duration) ? Math.max(0, duration) : 0;
  const lead = sanitizeTransition(transition) + STORYBOARD_LEAD_MARGIN;
  const s = Math.min(lead, d);
  const e = Math.max(s, d - STORYBOARD_TAIL_SECONDS);
  const m = Math.min(e, Math.max(s, d / 2));
  return [
    { offset: s, role: 'start' },
    { offset: m, role: 'middle' },
    { offset: e, role: 'end' },
  ];
}

/** 取整前的候选帧:段号 + 网格步数。 */
interface Candidate {
  index: number;
  k: number;
  role: StoryboardFrameRole;
  requested?: number;
  clamped?: boolean;
}

/**
 * 按规格取帧。语义:
 * - even:n 个等宽区间的中点;落在段首白场里(段内 < 转场 + 0.1)的推到白场之后。
 * - segments:每段 段首 +0.7 / 段中 / 段尾 −0.3,与上一帧相差不到 0.2 秒的丢掉(短段只剩一两帧)。
 * - times:按升序;超出片长的按片尾并提示;不推白场(明确要的就给)。
 * 段内偏移一律取整到 1/fps;非末段不落在段尾那一刻(那一刻属于下一段的 0 秒)。
 * (段, 步数) 相同的帧合并;超过上限截断。空清单抛 FilmError('no-segments')。
 */
export function planStoryboard(
  segments: readonly Segment[],
  requestedSpec: StoryboardSpec,
  options?: StoryboardPlanOptions,
): StoryboardPlan {
  if (segments.length === 0) {
    throw new FilmError('no-segments', '影片没有任何分段');
  }
  const notes: string[] = [];
  let spec = requestedSpec;
  if (spec.kind === 'times' && !spec.times.some((t) => Number.isFinite(t) && t >= 0)) {
    // 程序直接传进来的空列表(URL 解析那一步已经兜过):与解析同一个说法。
    notes.push(`没有可用的时刻,按缺省 ${DEFAULT_STORYBOARD_COUNT} 帧`);
    spec = DEFAULT_SPEC;
  }
  const fpsRaw = options?.fps;
  const fps = fpsRaw !== undefined && Number.isFinite(fpsRaw) && fpsRaw >= 1 ? fpsRaw : OFFLINE_DEFAULT_FPS;
  const transition = sanitizeTransition(options?.transition);
  const lead = transition + STORYBOARD_LEAD_MARGIN;
  const maxRaw = options?.maxFrames;
  const maxFrames =
    maxRaw !== undefined && Number.isFinite(maxRaw) && maxRaw >= 1 ? Math.floor(maxRaw) : MAX_STORYBOARD_FRAMES;
  const total = filmDuration(segments);
  const starts = segmentStarts(segments);
  const last = segments.length - 1;
  const durationOf = (i: number): number => {
    const d = segments[i]?.duration ?? 0;
    return Number.isFinite(d) ? Math.max(0, d) : 0;
  };
  /** 该段允许的最大步数:非末段严格小于段尾(再留 2 ms),末段可以到片尾。 */
  const maxStep = (i: number): number => {
    const d = durationOf(i);
    return i < last
      ? Math.max(0, Math.floor((d - SEGMENT_END_GUARD) * fps + 1e-9))
      : Math.max(0, Math.floor(d * fps + 1e-9));
  };
  const toStep = (i: number, offset: number): number =>
    Math.min(maxStep(i), Math.max(0, Math.round(offset * fps)));

  const candidates: Candidate[] = [];
  let dedupe = true;
  if (spec.kind === 'segments') {
    // 分段模式自己按最小间隔合并,不再报「同一时刻」。
    dedupe = false;
    const minGapSteps = STORYBOARD_MIN_GAP * fps - 1e-9;
    segments.forEach((_, i) => {
      let prev = Number.NEGATIVE_INFINITY;
      for (const { offset, role } of segmentStoryboardOffsets(durationOf(i), transition)) {
        const k = toStep(i, offset);
        if (k - prev < minGapSteps) {
          continue;
        }
        candidates.push({ index: i, k, role });
        prev = k;
      }
    });
  } else if (!(total > 0)) {
    notes.push('影片总时长为 0,只出一帧');
    candidates.push({ index: 0, k: 0, role: spec.kind === 'even' ? 'even' : 'explicit' });
  } else if (spec.kind === 'even') {
    const want = Number.isFinite(spec.count) && spec.count >= 1 ? Math.floor(spec.count) : DEFAULT_STORYBOARD_COUNT;
    const n = Math.min(want, maxFrames);
    if (n < want) {
      notes.push(`最多 ${maxFrames} 帧,已按 ${maxFrames} 帧均匀取`);
    }
    for (const t of evenStoryboardTimes(total, n)) {
      const { index, offset } = segmentAtTime(segments, starts, total, t);
      // 段首 0.6 秒被白场盖着(成片里看不见),推到白场之后。
      const floor = Math.min(lead, durationOf(index));
      candidates.push({ index, k: toStep(index, Math.max(offset, floor)), role: 'even' });
    }
  } else {
    const sorted = spec.times.filter((t) => Number.isFinite(t) && t >= 0).sort((a, b) => a - b);
    for (const t of sorted) {
      const clamped = t > total;
      if (clamped) {
        notes.push(`${fmtSeconds(t)} 秒超出片长 ${fmtSeconds(total)} 秒,按片尾`);
      }
      const { index, offset } = segmentAtTime(segments, starts, total, clamped ? total : t);
      candidates.push({
        index,
        k: toStep(index, offset),
        role: 'explicit',
        requested: t,
        ...(clamped ? { clamped: true } : {}),
      });
    }
  }

  let kept = candidates;
  if (dedupe) {
    const seen = new Set<string>();
    kept = candidates.filter((c) => {
      const key = `${c.index}:${c.k}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
    const merged = candidates.length - kept.length;
    if (merged > 0) {
      notes.push(`${merged} 帧落在同一时刻,已合并`);
    }
  }
  kept.sort((a, b) => a.index - b.index || a.k - b.k);
  if (kept.length > maxFrames) {
    if (spec.kind === 'segments') {
      kept = thinSegmentFrames(kept, maxFrames, durationOf, notes);
    } else {
      const first = kept[maxFrames] as Candidate;
      const from = formatFilmTime((starts[first.index] ?? 0) + first.k / fps);
      notes.push(`共 ${kept.length} 帧,超过上限 ${maxFrames},只保留前 ${maxFrames} 帧(${from} 起的没出)`);
      kept = kept.slice(0, maxFrames);
    }
  }

  const frames = kept.map((c, n): StoryboardFrame => {
    const segment = segments[c.index];
    const offset = c.k / fps;
    const position = (starts[c.index] ?? 0) + offset;
    return {
      n,
      index: c.index,
      offset,
      position,
      preview: previewSecondsFor(segments, starts, total, fps, c.index, c.k, position),
      name: segment?.name ?? '',
      duration: segment?.duration ?? 0,
      subtitle: subtitleAt(segment?.subtitles ?? [], offset),
      role: c.role,
      ...(c.requested !== undefined ? { requested: c.requested } : {}),
      ...(c.clamped ? { clamped: true } : {}),
    };
  });
  return { frames, notes, total, segmentCount: segments.length };
}

/**
 * 分段模式超上限时的取舍:先去段中、再去段尾(都从最短的段去起 —— 短段的三帧本来就挨得近),
 * 每段的段首帧留到最后:片尾那几段照样有缩略图,不会整段整段地从后面丢掉。
 * 段数本身就超过上限时,才按顺序截掉后面的段。去掉了哪些段的哪一帧写进提示。
 */
function thinSegmentFrames(
  kept: readonly Candidate[],
  maxFrames: number,
  durationOf: (i: number) => number,
  notes: string[],
): Candidate[] {
  const total = kept.length;
  let out = [...kept];
  const parts: string[] = [];
  for (const [role, label] of [['middle', '段中'], ['end', '段尾']] as const) {
    const excess = out.length - maxFrames;
    if (excess <= 0) {
      break;
    }
    const drop = new Set(
      out
        .filter((c) => c.role === role)
        .sort((a, b) => durationOf(a.index) - durationOf(b.index) || a.index - b.index)
        .slice(0, excess),
    );
    if (drop.size > 0) {
      out = out.filter((c) => !drop.has(c));
      parts.push(`第 ${formatSegmentList([...drop].map((c) => c.index))} 段去掉了${label}那帧`);
    }
  }
  if (out.length > maxFrames) {
    parts.push(`第 ${formatSegmentList(out.slice(maxFrames).map((c) => c.index))} 段没有出帧`);
    out = out.slice(0, maxFrames);
  }
  notes.push(`共 ${total} 帧,超过上限 ${maxFrames}:${parts.join(';')}`);
  return out;
}

/** 段号列表(0 起)→ '3、5、7–12'(1 起,连续三段以上写成区间)。 */
export function formatSegmentList(indices: readonly number[]): string {
  const runs: Array<[number, number]> = [];
  for (const n of [...new Set(indices)].sort((a, b) => a - b).map((i) => i + 1)) {
    const last = runs[runs.length - 1];
    if (last && n === last[1] + 1) {
      last[1] = n;
    } else {
      runs.push([n, n]);
    }
  }
  return runs.map(([a, b]) => (a === b ? `${a}` : b === a + 1 ? `${a}、${b}` : `${a}–${b}`)).join('、');
}

/** 能还原到同一段、同一步的最短小数(1~6 位);都不行就原样给。 */
function previewSecondsFor(
  segments: readonly Segment[],
  starts: readonly number[],
  total: number,
  fps: number,
  index: number,
  k: number,
  position: number,
): number {
  for (let digits = 1; digits <= 6; digits += 1) {
    const f = 10 ** digits;
    const t = Math.round(position * f) / f;
    const at = segmentAtTime(segments, starts, total, t);
    if (at.index === index && Math.round(at.offset * fps) === k) {
      return t;
    }
  }
  return position;
}

/** 按段分组,段号升序,组内按 offset 升序(同 offset 按 n):渲染时一段挂一次、帧按时刻递增。 */
export function groupFramesBySegment(
  frames: readonly StoryboardFrame[],
): Array<{ index: number; frames: StoryboardFrame[] }> {
  const sorted = [...frames].sort((a, b) => a.index - b.index || a.offset - b.offset || a.n - b.n);
  const groups: Array<{ index: number; frames: StoryboardFrame[] }> = [];
  for (const f of sorted) {
    const tail = groups[groups.length - 1];
    if (tail && tail.index === f.index) {
      tail.frames.push(f);
    } else {
      groups.push({ index: f.index, frames: [f] });
    }
  }
  return groups;
}

/**
 * 段内 elapsed 秒时成片上的白场不透明度:淡入 = 1 − smooth(t / transition),之后为 0。
 * 与 Veil 同一条曲线。离线导出里非首段的淡入比分段晚起一帧,这里不补,误差 ≤ 1 帧。
 */
export function veilAlphaAt(elapsed: number, transition: number): number {
  if (!(transition > 0)) {
    return 0;
  }
  const t = Math.max(0, Number.isFinite(elapsed) ? elapsed : 0) / transition;
  return t >= 1 ? 0 : 1 - smooth(t);
}

/** 全片时刻 → 'm:ss.s'(先四舍五入到 0.1 秒再进位;非有限 / 负数按 0;分钟不封顶)。 */
export function formatFilmTime(seconds: number): string {
  const tenths = Math.round(Math.max(0, Number.isFinite(seconds) ? seconds : 0) * 10);
  const m = Math.floor(tenths / 600);
  const r = tenths - m * 600;
  return `${m}:${String(Math.floor(r / 10)).padStart(2, '0')}.${r % 10}`;
}

export interface StoryboardCaption {
  /** '1:05.3' */
  readonly time: string;
  /** '第 3/35 段 · 正方形的面积' */
  readonly segment: string;
  /** '段内 3.2s / 11.7s' */
  readonly local: string;
  /** 字幕原文;没有字幕时 '(无字幕)'。 */
  readonly subtitle: string;
  /** '白场 85%'、'超出片长(42.0s),按片尾'、脚本与声明时长对不上、'出错:…'、检查器的说明…… */
  readonly flags: readonly string[];
  /** 给读屏 / title 的整句。 */
  readonly label: string;
}

/** 渲染结果对说明的补充(StoryboardFrameResult 结构上就满足它,可以直接传)。 */
export interface StoryboardCaptionExtra {
  /** 实际停到的段内秒数(缺省 frame.offset)。 */
  readonly elapsed?: number;
  /** 实际停到的全片秒数(缺省 frame.position)。 */
  readonly position?: number;
  /** 实际画上的字幕(缺省 frame.subtitle)。 */
  readonly subtitle?: string;
  /** 缺省 0;≥ 0.02 时加「白场 N%」。 */
  readonly veilAlpha?: number;
  /** 脚本比声明时长先结束:结束时的段内秒数(画面停在那一刻)。 */
  readonly endedEarly?: number;
  /** 声明时长(加容差)到了脚本还在跑:查到的段内秒数。 */
  readonly overran?: number;
  readonly notes?: readonly string[];
  readonly error?: string;
}

/** 缩略图下面的说明(纯文案,视图与联系表 PNG 共用)。 */
export function storyboardCaption(
  frame: StoryboardFrame,
  segmentCount: number,
  extra?: StoryboardCaptionExtra,
): StoryboardCaption {
  const elapsed = extra?.elapsed ?? frame.offset;
  const time = formatFilmTime(extra?.position ?? frame.position);
  const text = extra?.subtitle ?? frame.subtitle;
  const subtitle = text !== '' ? text : '(无字幕)';
  const flags: string[] = [];
  const veil = extra?.veilAlpha ?? 0;
  if (veil >= 0.02) {
    flags.push(`白场 ${Math.round(veil * 100)}%`);
  }
  if (frame.clamped && frame.requested !== undefined) {
    flags.push(`超出片长(${fmt1(frame.requested)}s),按片尾`);
  }
  if (extra?.endedEarly !== undefined) {
    flags.push(`脚本 ${fmt1(extra.endedEarly)}s 就结束了(声明 ${fmt1(frame.duration)}s)`);
  }
  if (extra?.overran !== undefined) {
    flags.push(`脚本超过声明的 ${fmt1(frame.duration)}s(到 ${fmt1(extra.overran)}s 还没结束)`);
  }
  if (extra?.error !== undefined && extra.error !== '') {
    flags.push(`出错:${extra.error}`);
  }
  flags.push(...(extra?.notes ?? []));
  const label =
    `${time},第 ${frame.index + 1} 段「${frame.name}」段内 ${fmt1(elapsed)} 秒。字幕:${subtitle}。` +
    (flags.length > 0 ? `${flags.join(';')}。` : '');
  return {
    time,
    segment: `第 ${frame.index + 1}/${segmentCount} 段 · ${frame.name}`,
    local: `段内 ${fmt1(elapsed)}s / ${fmt1(frame.duration)}s`,
    subtitle,
    flags,
    label,
  };
}

/** 缩略图长边(像素):≤ 48 帧 640,更多 400(控制内存)。 */
export function thumbnailLongEdge(count: number): number {
  return count <= 48 ? 640 : 400;
}

/** 缩略图像素尺寸:按舞台 css 比例、长边 longEdge;尺寸为 0 时按 1280×720;每边至少 2。 */
export function thumbnailSize(
  cssWidth: number,
  cssHeight: number,
  longEdge: number,
): { width: number; height: number } {
  const w = cssWidth > 0 && cssHeight > 0 ? cssWidth : 1280;
  const h = cssWidth > 0 && cssHeight > 0 ? cssHeight : 720;
  const edge = Math.max(2, Math.round(longEdge));
  const k = edge / Math.max(w, h);
  return { width: Math.max(2, Math.round(w * k)), height: Math.max(2, Math.round(h * k)) };
}

/** 网格列最小宽度(css px):让缩略图约 190 px 高,夹在 [150, 360]。16:9≈338,4:3≈253,9:16=150。 */
export function thumbnailMinWidth(cssWidth: number, cssHeight: number): number {
  const ratio = cssWidth > 0 && cssHeight > 0 ? cssWidth / cssHeight : 16 / 9;
  return Math.min(360, Math.max(150, Math.round(190 * ratio)));
}

/** 联系表 PNG 的排版。 */
export interface SheetLayout {
  readonly columns: number;
  readonly rows: number;
  readonly gap: number;
  readonly fontPx: number;
  readonly headerHeight: number;
  readonly captionHeight: number;
  readonly cellWidth: number;
  readonly cellHeight: number;
  /** 未缩放的整张尺寸。 */
  readonly width: number;
  readonly height: number;
  /** 超过面积 / 边长上限时的整体缩小倍数(≤ 1)。 */
  readonly scale: number;
  /** 每格左上角(未缩放)。 */
  readonly cells: ReadonlyArray<{ readonly x: number; readonly y: number }>;
}

/** 画布单边上限(各浏览器的公约数)。 */
const SHEET_MAX_EDGE = 16384;

/** 联系表排版:格子 = 缩略图 + 三行说明;太大时整体缩小(Safari 画布面积上限约 16.7M 像素)。 */
export function sheetLayout(o: {
  readonly count: number;
  readonly thumbWidth: number;
  readonly thumbHeight: number;
  /** 缺省:横图 6 列,竖图 8 列,不超过 count。 */
  readonly columns?: number;
  /** 缺省 16_000_000;每边另限 16384。 */
  readonly maxArea?: number;
}): SheetLayout {
  const count = Math.max(0, Math.floor(o.count));
  const thumbWidth = Math.max(1, Math.round(o.thumbWidth));
  const thumbHeight = Math.max(1, Math.round(o.thumbHeight));
  const wanted =
    o.columns !== undefined && Number.isFinite(o.columns) && o.columns >= 1
      ? Math.floor(o.columns)
      : thumbHeight > thumbWidth
        ? 8
        : 6;
  const columns = Math.max(1, Math.min(wanted, count));
  const rows = Math.ceil(count / columns);
  const gap = Math.max(8, Math.round(thumbWidth / 40));
  const fontPx = Math.max(12, Math.round(thumbWidth / 30));
  const captionHeight = Math.round(fontPx * 1.35 * 3 + gap / 2);
  const headerHeight = Math.round(fontPx * 2.2);
  const cellWidth = thumbWidth;
  const cellHeight = thumbHeight + captionHeight;
  const width = gap + columns * (cellWidth + gap);
  const height = headerHeight + gap + rows * (cellHeight + gap);
  const maxArea = o.maxArea !== undefined && o.maxArea > 0 ? o.maxArea : 16_000_000;
  const scale = Math.min(1, Math.sqrt(maxArea / (width * height)), SHEET_MAX_EDGE / width, SHEET_MAX_EDGE / height);
  const cells = Array.from({ length: count }, (_, i) => ({
    x: gap + (i % columns) * (cellWidth + gap),
    y: headerHeight + gap + Math.floor(i / columns) * (cellHeight + gap),
  }));
  return { columns, rows, gap, fontPx, headerHeight, captionHeight, cellWidth, cellHeight, width, height, scale, cells };
}
