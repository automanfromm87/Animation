/**
 * 配音时间表:外部(配音方)交付的时间数据。时长、每句台词的起止、句中标记的时刻都由它说了算;
 * 时间一律相对各自分段的开头(秒),所以转场、跳转、每段实际结束的误差都不影响对齐。
 * 格式说明与 JSON Schema 见 docs/voice.md、docs/voice-timing.schema.json。
 */

/** 音频文件:相对时间表所在目录的路径,或带起读偏移(一个长文件管好几段时用)。 */
export type AudioRef = string | { readonly file: string; readonly offset?: number };

export interface VoiceLineTiming {
  /** 台词 id(timedSegment 声明的 id;普通分段按「分段id/序号」)。 */
  readonly id: string;
  /** 录音时用的台词(可选):和当前稿子不一样时提示重做。 */
  readonly text?: string;
  readonly start: number;
  readonly end: number;
  /** 这句的音频(可选;整段一个文件时写在分段上)。从 start 开始播,放完为止。 */
  readonly audio?: AudioRef;
  /** 句中 <mark name="…"/> 标记的时刻(秒,相对本段)。 */
  readonly marks?: Readonly<Record<string, number>>;
}

export interface VoiceSegmentTiming {
  /** 分段 id(timedSegment 的 id;普通分段没设 id 时用分段名)。 */
  readonly id: string;
  /** 本段时长(秒)。 */
  readonly duration: number;
  /** 整段一个音频(可选),从本段开头播。 */
  readonly audio?: AudioRef;
  readonly lines?: readonly VoiceLineTiming[];
}

export interface VoiceTimingSheet {
  readonly version?: 1;
  readonly film?: string;
  readonly locale?: string;
  readonly segments: readonly VoiceSegmentTiming[];
}

/** 配音相关的问题。error:这一项用不了(按草稿或静音处理);warning:能用,但要有人看一眼。 */
export interface VoiceProblem {
  readonly level: 'error' | 'warning';
  readonly message: string;
  readonly segment?: string;
  readonly line?: string;
}

/** 容差:浮点误差与四舍五入(秒)。 */
const EPS = 0.05;

const MARK = /<mark\s+name\s*=\s*["']([^"']+)["']\s*\/?>/g;

/** 去掉 <mark …/> 标签(字幕显示用)。 */
export function stripMarks(text: string): string {
  return text.replace(MARK, '');
}

/** 台词里的标记名(按出现顺序)。 */
export function markNames(text: string): string[] {
  return [...text.matchAll(MARK)].map((m) => m[1] ?? '').filter((n) => n !== '');
}

/** 标记之前的文字(去掉标签);没有这个标记返回 null。 */
export function textBeforeMark(text: string, mark: string): string | null {
  for (const m of text.matchAll(MARK)) {
    if (m[1] === mark) {
      return stripMarks(text.slice(0, m.index ?? 0));
    }
  }
  return null;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function finite(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function parseAudioRef(v: unknown): AudioRef | null | undefined {
  if (v === undefined) {
    return undefined;
  }
  if (typeof v === 'string') {
    return v.trim() === '' ? null : v;
  }
  if (isRecord(v) && typeof v['file'] === 'string' && v['file'].trim() !== '') {
    const offset = v['offset'];
    if (offset !== undefined && !(finite(offset) && offset >= 0)) {
      return null;
    }
    return offset === undefined ? { file: v['file'] } : { file: v['file'], offset };
  }
  return null;
}

/**
 * 解析并校验时间表(JSON.parse 之后的对象)。结构坏掉的分段整段丢弃(error),
 * 小问题修正后保留(warning)。返回能用的部分与全部问题。
 */
export function parseVoiceSheet(raw: unknown): { sheet: VoiceTimingSheet | null; problems: VoiceProblem[] } {
  const problems: VoiceProblem[] = [];
  if (!isRecord(raw) || !Array.isArray(raw['segments'])) {
    problems.push({ level: 'error', message: '时间表格式不对:需要一个带 segments 数组的对象' });
    return { sheet: null, problems };
  }
  const seen = new Set<string>();
  const segments: VoiceSegmentTiming[] = [];
  raw['segments'].forEach((entry, index) => {
    const where = `第 ${index + 1} 个分段`;
    if (!isRecord(entry) || typeof entry['id'] !== 'string' || entry['id'].trim() === '') {
      problems.push({ level: 'error', message: `${where}缺少 id` });
      return;
    }
    const id = entry['id'];
    if (seen.has(id)) {
      problems.push({ level: 'error', segment: id, message: `分段 id「${id}」重复,后一个被忽略` });
      return;
    }
    seen.add(id);
    const duration = entry['duration'];
    if (!(finite(duration) && duration > 0)) {
      problems.push({ level: 'error', segment: id, message: `分段「${id}」的 duration 需要正数` });
      return;
    }
    const audio = parseAudioRef(entry['audio']);
    if (audio === null) {
      problems.push({ level: 'error', segment: id, message: `分段「${id}」的 audio 写法不对(字符串,或 { file, offset })` });
      return;
    }
    const rawLines = entry['lines'];
    if (rawLines !== undefined && !Array.isArray(rawLines)) {
      problems.push({ level: 'error', segment: id, message: `分段「${id}」的 lines 需要数组` });
      return;
    }
    const lines: VoiceLineTiming[] = [];
    const lineIds = new Set<string>();
    let broken = false;
    let prevEnd = -Infinity;
    (rawLines ?? []).forEach((line: unknown, li: number) => {
      if (broken) {
        return;
      }
      const lwhere = `分段「${id}」第 ${li + 1} 句`;
      if (!isRecord(line) || typeof line['id'] !== 'string' || line['id'].trim() === '') {
        problems.push({ level: 'error', segment: id, message: `${lwhere}缺少 id` });
        broken = true;
        return;
      }
      const lid = line['id'];
      if (lineIds.has(lid)) {
        problems.push({ level: 'error', segment: id, line: lid, message: `${lwhere}的 id「${lid}」重复` });
        broken = true;
        return;
      }
      lineIds.add(lid);
      const start = line['start'];
      const end = line['end'];
      if (!(finite(start) && finite(end) && start >= 0 && end > start && end <= duration + EPS)) {
        problems.push({
          level: 'error',
          segment: id,
          line: lid,
          message: `台词「${lid}」的起止不合法(需要 0 ≤ start < end ≤ 本段时长 ${duration})`,
        });
        broken = true;
        return;
      }
      if (start < prevEnd - 1e-6) {
        problems.push({
          level: 'error',
          segment: id,
          line: lid,
          message: `台词「${lid}」和上一句重叠或乱序(${start} 早于上一句结束 ${prevEnd})`,
        });
        broken = true;
        return;
      }
      prevEnd = end;
      const laudio = parseAudioRef(line['audio']);
      if (laudio === null) {
        problems.push({ level: 'error', segment: id, line: lid, message: `台词「${lid}」的 audio 写法不对` });
        broken = true;
        return;
      }
      let marks: Record<string, number> | undefined;
      const rawMarks = line['marks'];
      if (rawMarks !== undefined) {
        if (!isRecord(rawMarks)) {
          problems.push({ level: 'warning', segment: id, line: lid, message: `台词「${lid}」的 marks 需要对象,已忽略` });
        } else {
          marks = {};
          for (const [name, t] of Object.entries(rawMarks)) {
            if (!finite(t)) {
              problems.push({ level: 'warning', segment: id, line: lid, message: `标记「${name}」的时刻不是数字,已忽略` });
              continue;
            }
            const clamped = Math.min(end, Math.max(start, t));
            if (Math.abs(clamped - t) > EPS) {
              problems.push({
                level: 'warning',
                segment: id,
                line: lid,
                message: `标记「${name}」(${t})不在这句的起止之内,已收到 ${clamped}`,
              });
            }
            marks[name] = clamped;
          }
        }
      }
      const text = typeof line['text'] === 'string' ? line['text'] : undefined;
      lines.push({
        id: lid,
        start,
        end: Math.min(end, duration),
        ...(text !== undefined ? { text } : {}),
        ...(laudio !== undefined ? { audio: laudio } : {}),
        ...(marks ? { marks } : {}),
      });
    });
    if (broken) {
      return;
    }
    segments.push({
      id,
      duration,
      ...(audio !== undefined ? { audio } : {}),
      lines,
    });
  });
  const film = typeof raw['film'] === 'string' ? raw['film'] : undefined;
  const locale = typeof raw['locale'] === 'string' ? raw['locale'] : undefined;
  return {
    sheet: { version: 1, ...(film !== undefined ? { film } : {}), ...(locale !== undefined ? { locale } : {}), segments },
    problems,
  };
}

/** 音频引用 → 绝对地址与起读偏移。base 是时间表自己的地址(文件路径相对它)。 */
export function resolveAudioRef(ref: AudioRef, base: string): { url: string; offset: number } {
  const file = typeof ref === 'string' ? ref : ref.file;
  const offset = typeof ref === 'string' ? 0 : (ref.offset ?? 0);
  let url = file;
  try {
    url = new URL(file, base).href;
  } catch {
    // base 不是合法地址(测试里的相对路径):原样用。
  }
  return { url, offset };
}
