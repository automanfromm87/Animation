import { createStubCanvas, installDomStub } from '../testing/domStub';
import { close, equal, ok, suite } from '../testing/harness';
import { messageChannelYielder } from '../export/offlineEnv';
import { directedSegment } from './segments';
import { timedSegment } from './timed';
import type { Segment } from './types';
import type { DryRunEnv } from './voice';
import type { MeasuredAudio, VoiceScript } from './voiceScript';
import { buildVoiceScript, layoutSheet } from './voiceScript';
import { parseVoiceSheet } from './voiceSheet';

const dryRun: DryRunEnv = { createCanvas: () => createStubCanvas(), createYielder: messageChannelYielder };

/** 装上 DOM 桩跑一段异步代码(与内容测试一致)。 */
async function withDom<T>(body: () => Promise<T>): Promise<T> {
  const dom = installDomStub();
  try {
    return await body();
  } finally {
    dom.restore();
  }
}

/**
 * 测试用 timedSegment:a 开口后动画要 3 秒才轮到 b;b 开口 0.5 秒后等标记 m;之后动画还要 2 秒。
 * 草稿:a 在 0.3 开口(10 字 / 4.5 ≈ 2.22 秒),b 在 3.3 开口,m 按字数落在 b 开口后约 0.67 秒。
 */
function sampleTimed(): Segment {
  return timedSegment(
    {
      id: 'sample',
      name: '样例',
      lines: [
        { id: 'a', text: '一二三四五六七八九十' },
        { id: 'b', text: '甲乙丙<mark name="m"/>丁戊己' },
      ],
    },
    async (env) => {
      await env.untilLine('a');
      await env.wait(3);
      await env.untilLine('b');
      await env.wait(0.5);
      await env.untilMark('b', 'm');
      await env.wait(2);
    },
  );
}

function sampleFixed(): Segment {
  return directedSegment(
    '固定段',
    6,
    [
      { start: 0.3, end: 2.5, text: '第一句。' },
      { start: 3, end: 5.5, text: '第二句。' },
    ],
    async (env) => {
      await env.wait(6);
    },
  );
}

async function scriptOf(segments: readonly Segment[]): Promise<VoiceScript> {
  const { script, problems } = await withDom(() => buildVoiceScript('test', segments, dryRun));
  equal(problems.length, 0, `台词稿不该有问题:${problems.map((p) => p.message).join(' | ')}`);
  return script;
}

export default suite('配音台词稿与排期', [
  [
    '台词稿:timed 段带草稿时间、每个提示点前动画要的时间与尾巴;fixed 段的句子就是字幕窗口',
    async () => {
      const script = await scriptOf([sampleTimed(), sampleFixed()]);
      equal(script.film, 'test');
      const [timed, fixed] = script.segments;
      if (!timed || !fixed) {
        throw new Error('缺分段');
      }
      equal(timed.kind, 'timed');
      equal(timed.id, 'sample');
      equal(timed.lines.map((l) => l.id).join(','), 'a,b');
      const [a, b] = timed.lines;
      close(a?.draft.start ?? NaN, 0.3, 1e-9, 'a 在句首留白后开口');
      close(b?.draft.start ?? NaN, 3.3, 0.05, 'b 等动画走完 3 秒才开口');
      close(b?.needsBefore ?? NaN, 3, 0.05, 'b 前动画要 3 秒');
      close(b?.markNeeds?.['m'] ?? NaN, 0.5, 0.05, '标记 m 前动画要 0.5 秒');
      equal(b?.plain, '甲乙丙丁戊己', '纯文本去掉标签');
      close(b?.draft.marks?.['m'] ?? NaN, 3.967, 0.06, '台词稿带标记的草稿时刻');
      equal(b?.marks.join(','), 'm');
      equal(timed.cues?.map((c) => `${c.line}${c.mark !== undefined ? `.${c.mark}` : ''}`).join(' '), 'a b b.m');
      close(timed.tail ?? NaN, 2, 0.05, '最后一个提示点后动画还要 2 秒');
      // 标记 m 按字数落在 b 开口后 3 / 4.5 ≈ 0.667 秒(3.967),之后动画再走 2 秒 → 5.967。
      close(timed.duration, 5.967, 0.1, '草稿时长到动画结束');

      equal(fixed.kind, 'fixed');
      equal(fixed.id, '固定段', '没设 id 时用分段名');
      equal(fixed.duration, 6);
      equal(fixed.lines.map((l) => l.id).join(','), '固定段/1,固定段/2', '句子 id 为「分段id/序号」');
      equal(fixed.lines[1]?.draft.start, 3);
      equal(fixed.lines[1]?.draft.end, 5.5);
      equal(fixed.cues, undefined);
    },
  ],
  [
    '台词稿:分段 id 重复要报出来',
    async () => {
      const { problems } = await withDom(() => buildVoiceScript('dup', [sampleFixed(), sampleFixed()], dryRun));
      ok(problems.some((p) => p.level === 'error' && p.message.includes('重复')), '重复 id 应当报 error');
    },
  ],
  [
    '排期:每句不早于上一句说完 + 停顿,且满足提示点前动画要的时间;时长到动画结束',
    async () => {
      const script = await scriptOf([sampleTimed()]);
      const measured: MeasuredAudio = {
        sample: { a: { duration: 2, audio: 'a.m4a' }, b: { duration: 1.5, marks: { m: 1 }, audio: 'b.m4a' } },
      };
      const { sheet, problems } = layoutSheet(script, measured);
      equal(problems.length, 0, `不该有问题:${problems.map((p) => p.message).join(' | ')}`);
      const seg = sheet.segments[0];
      const [a, b] = seg?.lines ?? [];
      close(a?.start ?? NaN, 0.3, 1e-9);
      close(a?.end ?? NaN, 2.3, 1e-9);
      // b:上一句 2.3 结束 + 0.25 停顿 = 2.55;动画要 a 开口后 3 秒 = 3.3 → 取 3.3。
      close(b?.start ?? NaN, 3.3, 0.05);
      close(b?.end ?? NaN, (b?.start ?? 0) + 1.5, 1e-9);
      close(b?.marks?.['m'] ?? NaN, (b?.start ?? 0) + 1, 1e-9, '标记按实测落在句中');
      equal(b?.audio, 'b.m4a', '音频文件写进时间表');
      // 时长:max(b 说完 + 0.6, 标记 + 动画尾巴 2 秒)。
      const expected = Math.max((b?.end ?? 0) + 0.6, (b?.marks?.['m'] ?? 0) + 2);
      close(seg?.duration ?? NaN, expected, 0.05);
      equal(parseVoiceSheet(sheet).problems.length, 0, '排出来的时间表本身合法');
    },
  ],
  [
    '排期:句中标记说得太早(这句已经开口)时提醒加停顿;句子说得短时照样满足动画',
    async () => {
      const script = await scriptOf([sampleTimed()]);
      const early = layoutSheet(script, { sample: { a: { duration: 1 }, b: { duration: 1.5, marks: { m: 0.2 } } } });
      ok(
        early.problems.some((p) => p.line === 'b' && p.message.includes('太早')),
        `应当提醒标记太早:${early.problems.map((p) => p.message).join(' | ')}`,
      );
      const short = layoutSheet(script, { sample: { a: { duration: 0.5 }, b: { duration: 0.5 } } });
      const b = short.sheet.segments[0]?.lines?.[1];
      close(b?.start ?? NaN, 3.3, 0.05, '句子再短也得等动画');
      const long = layoutSheet(script, { sample: { a: { duration: 5 }, b: { duration: 0.5 } } });
      close(long.sheet.segments[0]?.lines?.[1]?.start ?? NaN, 5.55, 1e-9, '上一句说得长,下一句等它说完 + 停顿');
    },
  ],
  [
    '排期:一段的第一个提示点就是句中标记时,让那个词正好落在动画走到的时刻',
    async () => {
      const segment = timedSegment(
        { id: 'first-mark', name: '先等词', lines: [{ id: 'a', text: '一二三<mark name="m"/>四五六' }] },
        async (env) => {
          await env.wait(2);
          await env.untilMark('a', 'm');
          await env.wait(1);
        },
      );
      const script = await scriptOf([segment]);
      const { sheet, problems } = layoutSheet(script, { 'first-mark': { a: { duration: 3, marks: { m: 1 } } } });
      equal(problems.length, 0, problems.map((p) => p.message).join(' | '));
      const a = sheet.segments[0]?.lines?.[0];
      close(a?.start ?? NaN, 1, 0.05, '开口提前 1 秒,让「m」正好在 2 秒说到');
      close(a?.marks?.['m'] ?? NaN, 2, 0.05);
    },
  ],
  [
    '排期:没量标记时按草稿里标记在句中的比例换算',
    async () => {
      // 带标点:草稿比例(语速 4.5、停顿按秒)与单纯字数比例不同,能区分两种估法。
      const segment = timedSegment(
        {
          id: 'punct',
          name: '带标点',
          lines: [
            { id: 'a', text: '一二三四五六七八九十' },
            { id: 'b', text: '甲乙丙,<mark name="m"/>丁戊己。' },
          ],
        },
        async (env) => {
          await env.untilLine('a');
          await env.wait(3);
          await env.untilLine('b');
          await env.untilMark('b', 'm');
          await env.wait(1);
        },
      );
      const script = await scriptOf([segment]);
      const b = script.segments[0]?.lines[1];
      const ratio = ((b?.draft.marks?.['m'] ?? 0) - (b?.draft.start ?? 0)) / ((b?.draft.end ?? 1) - (b?.draft.start ?? 0));
      const { sheet } = layoutSheet(script, { punct: { a: { duration: 2 }, b: { duration: 3 } } });
      const laid = sheet.segments[0]?.lines?.[1];
      close((laid?.marks?.['m'] ?? NaN) - (laid?.start ?? 0), ratio * 3, 0.002, '时间表保留到毫秒');
      ok(Math.abs(ratio - 0.458) < 0.01, `草稿比例约 0.458(单纯字数比例是 0.488),实际 ${ratio}`);
    },
  ],
  [
    '排期:缺实测的句子报 error、按草稿占位',
    async () => {
      const script = await scriptOf([sampleTimed()]);
      const { sheet, problems } = layoutSheet(script, { sample: { a: { duration: 2 } } });
      ok(problems.some((p) => p.level === 'error' && p.line === 'b'), '缺 b 的实测应当报 error');
      ok((sheet.segments[0]?.lines?.length ?? 0) === 2, '占位后两句都在');
    },
  ],
  [
    '排期:固定段每句放在字幕窗口起点;比窗口长但没撞上下一句是提醒,撞上是错误并截到下一句开口',
    async () => {
      const script = await scriptOf([sampleFixed()]);
      const fine = layoutSheet(script, { 固定段: { '固定段/1': { duration: 2 }, '固定段/2': { duration: 2 } } });
      equal(fine.problems.length, 0);
      const lines = fine.sheet.segments[0]?.lines ?? [];
      equal(lines[0]?.start, 0.3);
      close(lines[0]?.end ?? NaN, 2.3, 1e-9);
      equal(lines[1]?.start, 3);
      equal(fine.sheet.segments[0]?.duration, 6, '固定段时长不变');

      const longish = layoutSheet(script, { 固定段: { '固定段/1': { duration: 2.5 }, '固定段/2': { duration: 1 } } });
      ok(longish.problems.some((p) => p.level === 'warning' && p.line === '固定段/1'), '比窗口长 0.3 秒:提醒');

      const clash = layoutSheet(script, { 固定段: { '固定段/1': { duration: 4 }, '固定段/2': { duration: 1 } } });
      ok(clash.problems.some((p) => p.level === 'error' && p.line === '固定段/1'), '撞上下一句:错误');
      equal(clash.sheet.segments[0]?.lines?.[0]?.end, 3, '截到下一句开口,时间表仍合法');
      equal(parseVoiceSheet(clash.sheet).problems.length, 0);

      const tail = layoutSheet(script, { 固定段: { '固定段/1': { duration: 1 }, '固定段/2': { duration: 4 } } });
      ok(tail.problems.some((p) => p.level === 'error' && p.message.includes('段尾')), '最后一句撞上段尾:错误');
      equal(tail.sheet.segments[0]?.lines?.[1]?.end, 6);
    },
  ],
]);
