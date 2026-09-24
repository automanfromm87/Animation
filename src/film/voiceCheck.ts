import type { DryRunEnv } from './voice';
import { prepareVoice, runSegmentToEnd, voiceIdOf, voiceLineIdOf } from './voice';
import type { CueEvent, LineTiming, SegmentTiming, TimedSegment } from './timed';
import { describeSpanTarget, estimateSpeech, isTimedSegment } from './timed';
import type { Segment } from './types';
import type { AudioRef, VoiceProblem, VoiceSegmentTiming } from './voiceSheet';
import { markNames, parseVoiceSheet, stripMarks, textBeforeMark } from './voiceSheet';

/**
 * 校验配音时间表(voice:check):
 * - 格式与内容:parseVoiceSheet / prepareVoice 报的全部问题(id 对不上、缺句、台词改过、标记缺失……);
 * - 覆盖:有台词的分段在时间表里没有;
 * - 动画放得下:按时间表把每个 timedSegment 干跑一遍,提示点来不及、动画比时间表长都报出来;
 *   playUntil / playThrough 收不住:目标是开口 / 标记而动画在它之后才收住为 error,句尾(或只是提前量不够)为提醒;
 * - 固定时长的分段:句子超出动画时长、台词改过;
 * - 音频文件在不在(给了 audioExists 时)。
 */

export interface CheckOptions {
  /** 音频文件是否存在(命令行按时间表所在目录解析);不给就不查。 */
  audioExists?: (file: string) => boolean;
}

/** 容差(秒):与内容测试、帧步长同一量级。 */
const TOLERANCE = 0.05;

function fileOf(ref: AudioRef): string {
  return typeof ref === 'string' ? ref : ref.file;
}

/** 与 prepareVoice 相同的标记补法:时间表没给的标记按字数比例落在句中。 */
function timingFor(segment: TimedSegment, entry: VoiceSegmentTiming): SegmentTiming | null {
  const byId = new Map((entry.lines ?? []).map((l) => [l.id, l]));
  const lines: Record<string, LineTiming> = {};
  for (const line of segment.lines) {
    const t = byId.get(line.id);
    if (!t) {
      return null;
    }
    const marks: Record<string, number> = {};
    const total = estimateSpeech(line.text, 1, 0);
    for (const name of markNames(line.text)) {
      const given = t.marks?.[name];
      if (given !== undefined) {
        marks[name] = given;
        continue;
      }
      const before = estimateSpeech(textBeforeMark(line.text, name) ?? '', 1, 0);
      marks[name] = t.start + (t.end - t.start) * (total > 0 ? before / total : 0);
    }
    lines[line.id] = { start: t.start, end: t.end, marks };
  }
  return { duration: entry.duration, lines };
}

function describeCue(e: CueEvent): string {
  if (e.mark !== undefined) {
    return `台词「${e.line}」的标记「${e.mark}」`;
  }
  // 脚本没写 untilLine:playUntil 到这句说完 / 某个标记时,这句还没开口,按约定在调用时开口。
  return e.implicit === true ? `台词「${e.line}」开口,playUntil 让它在调用时开口` : `台词「${e.line}」开口`;
}

/** 按时间表干跑一个 timedSegment,把动画跟不上的地方报出来。 */
async function checkFit(
  segment: TimedSegment,
  timing: SegmentTiming,
  dryRun: DryRunEnv,
  push: (p: VoiceProblem) => void,
): Promise<void> {
  const id = segment.id;
  let index = 0;
  let ended = false;
  const probe = segment.withTiming(timing, {
    observer: {
      cue: (e) => {
        index += 1;
        if (e.at < e.called - TOLERANCE) {
          push({
            level: 'error',
            segment: id,
            line: e.line,
            message: `动画来不及:第 ${index} 个提示点(${describeCue(e)})排在 ${e.at.toFixed(2)} 秒,动画 ${e.called.toFixed(2)} 秒才走到,晚了 ${(e.called - e.at).toFixed(2)} 秒`,
          });
        }
      },
      span: (e) => {
        index += 1;
        const short = e.ready - e.at;
        if (short <= TOLERANCE) {
          return;
        }
        const late = e.from + e.runTime - e.at;
        const where = describeSpanTarget(e);
        if (e.kind !== 'end' && late > TOLERANCE) {
          // 与 untilLine / untilMark 来不及同一类:声音已经到了,画面还在动。
          push({
            level: 'error',
            segment: id,
            line: e.line,
            message: `动画收不住:第 ${index} 个提示点(${where})排在 ${e.at.toFixed(2)} 秒,${e.api} 的动画 ${e.from.toFixed(2)} 秒开始、至少要 ${e.min.toFixed(2)} 秒,晚了 ${late.toFixed(2)} 秒`,
          });
          return;
        }
        push({
          level: 'warning',
          segment: id,
          line: e.line,
          message: `动画时间不够:第 ${index} 个提示点(${where})排在 ${e.at.toFixed(2)} 秒,${e.api} 的动画 ${e.from.toFixed(2)} 秒开始、要 ${e.min.toFixed(2)} 秒${
            e.lead > 0 ? ` + 提前 ${e.lead.toFixed(2)} 秒` : ''
          },差 ${short.toFixed(2)} 秒${late > TOLERANCE ? `(动画比这句多播 ${late.toFixed(2)} 秒)` : '(提前量不足)'}`,
        });
      },
      end: (e) => {
        ended = true;
        if (e.called > timing.duration + TOLERANCE) {
          push({
            level: 'error',
            segment: id,
            message: `动画比时间表长 ${(e.called - timing.duration).toFixed(2)} 秒:动画 ${e.called.toFixed(2)} 秒才跑完,时间表只给了 ${timing.duration} 秒`,
          });
        }
      },
    },
  });
  const run = await runSegmentToEnd(probe, dryRun);
  if (run.error) {
    push({
      level: 'error',
      segment: id,
      message: `按时间表干跑时脚本出错:${run.error instanceof Error ? run.error.message : String(run.error)}`,
    });
    return;
  }
  if (!run.settled || !ended) {
    push({ level: 'error', segment: id, message: `按时间表干跑 ${run.elapsed.toFixed(1)} 秒还没结束` });
  }
}

/** 固定时长的分段:句子不能超出动画时长;台词改过要重做。 */
function checkFixed(segment: Segment, entry: VoiceSegmentTiming, push: (p: VoiceProblem) => void): void {
  const id = voiceIdOf(segment);
  const subs = segment.subtitles ?? [];
  (entry.lines ?? []).forEach((line, i) => {
    if (line.end > segment.duration + TOLERANCE) {
      push({
        level: 'error',
        segment: id,
        line: line.id,
        message: `台词「${line.id}」到 ${line.end} 秒才结束,超出了这段动画的 ${segment.duration} 秒(会被截断)`,
      });
    }
    const expectedId = voiceLineIdOf(segment, i);
    if (i < subs.length && line.id !== expectedId) {
      push({
        level: 'warning',
        segment: id,
        line: line.id,
        message: `第 ${i + 1} 句的 id 应该是「${expectedId}」,时间表写的是「${line.id}」`,
      });
    }
    const current = subs[i]?.text;
    if (line.text !== undefined && current !== undefined && stripMarks(line.text).trim() !== stripMarks(current).trim()) {
      push({
        level: 'warning',
        segment: id,
        line: line.id,
        message: `台词改过了:时间表按「${stripMarks(line.text)}」做,现在是「${stripMarks(current)}」,这句需要重做`,
      });
    }
  });
}

/**
 * 校验时间表(JSON.parse 之后的对象)。返回全部问题;没有 error 就可以交付。
 */
export async function checkVoiceSheet(
  segments: readonly Segment[],
  raw: unknown,
  dryRun: DryRunEnv,
  options?: CheckOptions,
): Promise<VoiceProblem[]> {
  const problems: VoiceProblem[] = [];
  const push = (p: VoiceProblem): void => {
    problems.push(p);
  };
  // 格式问题与套用问题(缺句、台词改过、id 对不上……)由 prepareVoice 统一报。
  await prepareVoice(segments, { sheet: raw, dryRun, onProblem: push });
  const { sheet } = parseVoiceSheet(raw);
  if (!sheet) {
    return problems;
  }
  const entries = new Map(sheet.segments.map((e) => [e.id, e]));
  for (const segment of segments) {
    const id = voiceIdOf(segment);
    const entry = entries.get(id);
    const timed = isTimedSegment(segment);
    const hasLines = timed ? segment.lines.length > 0 : (segment.subtitles?.length ?? 0) > 0;
    if (!entry) {
      if (hasLines) {
        push({
          level: timed ? 'error' : 'warning',
          segment: id,
          message: timed
            ? `分段「${segment.name}」(id「${id}」)在时间表里没有:它会按草稿时间播,没有声音`
            : `分段「${segment.name}」(id「${id}」)在时间表里没有:这一段没有配音`,
        });
      }
      continue;
    }
    if (options?.audioExists) {
      const refs: AudioRef[] = [];
      if (entry.audio !== undefined) {
        refs.push(entry.audio);
      }
      for (const line of entry.lines ?? []) {
        if (line.audio !== undefined) {
          refs.push(line.audio);
        }
      }
      for (const ref of refs) {
        if (!options.audioExists(fileOf(ref))) {
          push({ level: 'error', segment: id, message: `音频文件「${fileOf(ref)}」不存在` });
        }
      }
    }
    if (timed) {
      const timing = timingFor(segment, entry);
      if (timing) {
        await checkFit(segment, timing, dryRun, push);
      }
    } else {
      checkFixed(segment, entry, push);
    }
  }
  return problems;
}

/** 问题列表 → 命令行文本(一行一个,error 在前)。 */
export function formatProblems(problems: readonly VoiceProblem[]): string {
  const order = (p: VoiceProblem): number => (p.level === 'error' ? 0 : 1);
  return [...problems]
    .sort((a, b) => order(a) - order(b))
    .map((p) => {
      const where = [p.segment, p.line].filter((x) => x !== undefined).join(' / ');
      return `${p.level === 'error' ? '✗ 错误' : '! 提醒'}${where !== '' ? ` [${where}]` : ''} ${p.message}`;
    })
    .join('\n');
}
