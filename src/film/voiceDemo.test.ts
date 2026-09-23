import { createStubCanvas, installDomStub } from '../testing/domStub';
import { close, equal, ok, rejects, suite } from '../testing/harness';
import { messageChannelYielder } from '../export/offlineEnv';
import { FILM_CATALOG, filmNames, loadFilm } from './catalog';
import type { Segment } from './types';
import type { DryRunEnv } from './voice';
import { prepareVoice, runSegmentToEnd } from './voice';
import { checkVoiceSheet, formatProblems } from './voiceCheck';
import { voiceDemoFilm } from './voiceDemo';
import type { MeasuredAudio } from './voiceScript';
import { buildVoiceScript, layoutSheet } from './voiceScript';
import type { VoiceProblem } from './voiceSheet';

const dryRun: DryRunEnv = { createCanvas: () => createStubCanvas(), createYielder: messageChannelYielder };
/** 声明时长与实际时间线允许的偏差(秒),与内容测试一致。 */
const DURATION_TOLERANCE = 0.25;

async function withDom<T>(body: () => Promise<T>): Promise<T> {
  const dom = installDomStub();
  try {
    return await body();
  } finally {
    dom.restore();
  }
}

/** 干跑每段:跑得完、不出错、时间线与声明时长一致、字幕合法(与内容时序审计同一套标准)。 */
async function audit(segments: readonly Segment[]): Promise<void> {
  for (const segment of segments) {
    const run = await runSegmentToEnd(segment, dryRun);
    ok(run.error === null, `「${segment.name}」运行出错:${String(run.error)}`);
    ok(run.settled, `「${segment.name}」没有跑完`);
    ok(
      Math.abs(run.elapsed - segment.duration) <= DURATION_TOLERANCE,
      `「${segment.name}」声明 ${segment.duration.toFixed(2)} 秒,实际 ${run.elapsed.toFixed(2)} 秒`,
    );
    let prevEnd = 0;
    for (const s of segment.subtitles ?? []) {
      ok(s.start >= prevEnd - 1e-9 && s.end > s.start, `「${segment.name}」字幕乱序或重叠:${s.text}`);
      ok(s.end <= segment.duration + 0.05, `「${segment.name}」字幕超出分段:${s.text}`);
      prevEnd = s.end;
    }
  }
}

export default suite('配音演示片与影片目录', [
  [
    '演示片(没有时间表):prepareVoice 排出草稿,三段时长确定、时间线对得上、字幕带台词 id',
    async () => {
      await withDom(async () => {
        const problems: VoiceProblem[] = [];
        const prepared = await prepareVoice(voiceDemoFilm, { dryRun, onProblem: (p) => problems.push(p) });
        equal(problems.length, 0, formatProblems(problems));
        equal(prepared.segments.length, 3);
        equal(prepared.segments[0]?.marker, 'chapter', '首段是章节');
        ok(prepared.segments.every((s) => s.voice === undefined), '没有时间表时没有声音');
        equal(
          prepared.segments.map((s) => (s.subtitles ?? []).map((x) => x.id).join(',')).join(' | '),
          'secant-1,secant-2,secant-3 | slope-1,slope-2,slope-3 | derivative-1,derivative-2',
        );
        ok(!(prepared.segments[1]?.subtitles ?? []).some((s) => s.text.includes('<mark')), '字幕去掉了标记标签');
        await audit(prepared.segments);
      });
    },
  ],
  [
    '演示片(给定时间表):时长、字幕、音频全按时间表;时间线对得上;校验没有错误',
    async () => {
      await withDom(async () => {
        const { script } = await buildVoiceScript('voice-demo', voiceDemoFilm, dryRun);
        // 假装配音比草稿慢 25%,每句一个文件。
        const measured: Record<string, Record<string, { duration: number; audio: string }>> = {};
        for (const segment of script.segments) {
          const byLine: Record<string, { duration: number; audio: string }> = {};
          for (const line of segment.lines) {
            byLine[line.id] = { duration: (line.draft.end - line.draft.start) * 1.25, audio: `${line.id}.m4a` };
          }
          measured[segment.id] = byLine;
        }
        const laid = layoutSheet(script, measured as MeasuredAudio);
        equal(laid.problems.filter((p) => p.level === 'error').length, 0, formatProblems(laid.problems));
        const problems: VoiceProblem[] = [];
        const prepared = await prepareVoice(voiceDemoFilm, {
          sheet: laid.sheet,
          sheetUrl: 'https://cdn.example/voice/voice-demo/timing.json',
          dryRun,
          onProblem: (p) => problems.push(p),
        });
        equal(problems.filter((p) => p.level === 'error').length, 0, formatProblems(problems));
        laid.sheet.segments.forEach((entry, i) => {
          const s = prepared.segments[i];
          close(s?.duration ?? NaN, entry.duration, 1e-9, `「${s?.name}」时长按时间表`);
          equal(s?.voice?.clips.length, entry.lines?.length, `「${s?.name}」每句一个音频`);
          const first = s?.voice?.clips[0];
          equal(first?.url, `https://cdn.example/voice/voice-demo/${entry.lines?.[0]?.id}.m4a`, '音频地址相对时间表');
          close(first?.start ?? NaN, entry.lines?.[0]?.start ?? NaN, 1e-9);
        });
        await audit(prepared.segments);
        const check = await checkVoiceSheet(voiceDemoFilm, laid.sheet, dryRun);
        equal(check.filter((p) => p.level === 'error').length, 0, formatProblems(check));
      });
    },
  ],
  [
    '演示片经得起语速变化:配音快到 0.8 倍、慢到 1.6 倍,参考排期出来的时间表都能通过校验',
    async () => {
      await withDom(async () => {
        const { script } = await buildVoiceScript('voice-demo', voiceDemoFilm, dryRun);
        for (const factor of [0.8, 1.25, 1.6]) {
          const measured: Record<string, Record<string, { duration: number }>> = {};
          for (const segment of script.segments) {
            const byLine: Record<string, { duration: number }> = {};
            for (const line of segment.lines) {
              byLine[line.id] = { duration: (line.draft.end - line.draft.start) * factor };
            }
            measured[segment.id] = byLine;
          }
          const { sheet } = layoutSheet(script, measured as MeasuredAudio);
          const check = await checkVoiceSheet(voiceDemoFilm, sheet, dryRun);
          equal(check.filter((p) => p.level === 'error').length, 0, `语速 ×${factor}:${formatProblems(check)}`);
        }
      });
    },
  ],
  [
    '影片目录:每部都能加载;名字不对时列出可选的',
    async () => {
      equal(filmNames().join(','), 'film,derivatives,topology,voice-demo');
      for (const name of filmNames()) {
        const segments = await loadFilm(name);
        ok(segments.length > 0, `「${name}」是空的`);
      }
      equal(await FILM_CATALOG['voice-demo']?.(), voiceDemoFilm);
      await rejects(() => loadFilm('nope'), '名字不对应当报错');
      let message = '';
      try {
        await loadFilm('constructor');
      } catch (e) {
        message = e instanceof Error ? e.message : '';
      }
      ok(message.includes('voice-demo'), `报错应当列出可选的影片:${message}`);
    },
  ],
]);
