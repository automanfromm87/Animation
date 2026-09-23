import { createStubCanvas, installDomStub } from '../testing/domStub';
import { equal, ok, suite } from '../testing/harness';
import { messageChannelYielder } from '../export/offlineEnv';
import { directedSegment } from './segments';
import { timedSegment } from './timed';
import type { Segment } from './types';
import type { DryRunEnv } from './voice';
import type { CheckOptions } from './voiceCheck';
import { checkVoiceSheet, formatProblems } from './voiceCheck';
import { buildVoiceScript, layoutSheet } from './voiceScript';
import type { VoiceProblem } from './voiceSheet';

const dryRun: DryRunEnv = { createCanvas: () => createStubCanvas(), createYielder: messageChannelYielder };

/** a 开口后动画要 3 秒才轮到 b;b 开口 0.5 秒后等标记 m;之后动画还要 2 秒。 */
function film(): Segment[] {
  const timed = timedSegment(
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
  const fixed = directedSegment(
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
  return [timed, fixed];
}

interface Line {
  id: string;
  text?: string;
  start: number;
  end: number;
  audio?: string;
  marks?: Record<string, number>;
}

/** 一份合格的时间表:b 在动画走到时(3.3)开口,标记 m 在 4.3,动画 6.3 结束,时长 7。 */
function goodSheet(): { version: 1; segments: Array<{ id: string; duration: number; lines: Line[] }> } {
  return {
    version: 1,
    segments: [
      {
        id: 'sample',
        duration: 7,
        lines: [
          { id: 'a', text: '一二三四五六七八九十', start: 0.3, end: 2.3, audio: 'a.m4a' },
          { id: 'b', text: '甲乙丙<mark name="m"/>丁戊己', start: 3.3, end: 4.8, audio: 'b.m4a', marks: { m: 4.3 } },
        ],
      },
      {
        id: '固定段',
        duration: 6,
        lines: [
          { id: '固定段/1', text: '第一句。', start: 0.3, end: 2.3, audio: 'f1.m4a' },
          { id: '固定段/2', text: '第二句。', start: 3, end: 5, audio: 'f2.m4a' },
        ],
      },
    ],
  };
}

async function check(raw: unknown, options?: CheckOptions): Promise<VoiceProblem[]> {
  const dom = installDomStub();
  try {
    return await checkVoiceSheet(film(), raw, dryRun, options);
  } finally {
    dom.restore();
  }
}

function errors(problems: readonly VoiceProblem[]): VoiceProblem[] {
  return problems.filter((p) => p.level === 'error');
}

function has(problems: readonly VoiceProblem[], level: VoiceProblem['level'], text: string): boolean {
  return problems.some((p) => p.level === level && p.message.includes(text));
}

export default suite('配音时间表校验', [
  [
    '合格的时间表:没有错误',
    async () => {
      const problems = await check(goodSheet());
      equal(errors(problems).length, 0, formatProblems(problems));
    },
  ],
  [
    '动画来不及:句子开口早于动画走到,报出第几个提示点、晚了多少',
    async () => {
      const sheet = goodSheet();
      const b = sheet.segments[0]?.lines[1];
      if (b) {
        b.start = 2.6;
        b.end = 4.1;
        b.marks = { m: 3.6 };
      }
      const problems = await check(sheet);
      ok(has(problems, 'error', '动画来不及:第 2 个提示点'), formatProblems(problems));
      ok(has(problems, 'error', '晚了 0.7'), '应当说出晚了约 0.7 秒');
    },
  ],
  [
    '动画比时间表长:报出差多少秒',
    async () => {
      const sheet = goodSheet();
      const seg = sheet.segments[0];
      if (seg) {
        seg.duration = 5.5;
      }
      const problems = await check(sheet);
      ok(has(problems, 'error', '动画比时间表长 0.8'), formatProblems(problems));
    },
  ],
  [
    '标记给得太早:动画还没走到那个词',
    async () => {
      const sheet = goodSheet();
      const b = sheet.segments[0]?.lines[1];
      if (b) {
        b.marks = { m: 3.4 };
      }
      const problems = await check(sheet);
      ok(has(problems, 'error', '标记「m」'), formatProblems(problems));
    },
  ],
  [
    '缺句:时间表少了一句台词',
    async () => {
      const sheet = goodSheet();
      sheet.segments[0]?.lines.pop();
      const problems = await check(sheet);
      ok(
        problems.some((p) => p.level === 'error' && p.message.includes('缺少台词') && p.message.includes('「b」')),
        formatProblems(problems),
      );
    },
  ],
  [
    '台词过期:timed 段与固定段的文本都和稿子比对',
    async () => {
      const sheet = goodSheet();
      const a = sheet.segments[0]?.lines[0];
      const f1 = sheet.segments[1]?.lines[0];
      if (a && f1) {
        a.text = '十九八七六五四三二一';
        f1.text = '旧的第一句。';
      }
      const problems = await check(sheet);
      ok(problems.some((p) => p.line === 'a' && p.message.includes('台词改过了')), formatProblems(problems));
      ok(problems.some((p) => p.line === '固定段/1' && p.message.includes('台词改过了')), formatProblems(problems));
    },
  ],
  [
    'id 对不上:时间表里的分段在片子里找不到,片子里的 timed 段在时间表里也没有',
    async () => {
      const sheet = goodSheet();
      const seg = sheet.segments[0];
      if (seg) {
        seg.id = 'sampel';
      }
      const problems = await check(sheet);
      ok(has(problems, 'warning', '分段「sampel」在影片里找不到'), formatProblems(problems));
      ok(has(problems, 'error', '(id「sample」)在时间表里没有'), formatProblems(problems));
    },
  ],
  [
    '固定段:句子超出动画时长;句子 id 不是「分段id/序号」',
    async () => {
      const sheet = goodSheet();
      const seg = sheet.segments[1];
      if (seg) {
        seg.duration = 8;
        const second = seg.lines[1];
        if (second) {
          second.id = '第二句';
          second.end = 7;
        }
      }
      const problems = await check(sheet);
      ok(has(problems, 'error', '超出了这段动画的 6 秒'), formatProblems(problems));
      ok(has(problems, 'warning', '应该是「固定段/2」'), formatProblems(problems));
    },
  ],
  [
    '音频文件不存在(给了 audioExists 时检查)',
    async () => {
      const problems = await check(goodSheet(), { audioExists: (file) => file !== 'b.m4a' });
      ok(has(problems, 'error', '音频文件「b.m4a」不存在'), formatProblems(problems));
      equal(errors(problems).length, 1, '只有这一个错误');
    },
  ],
  [
    '按时间表干跑时脚本出错:报出错误信息',
    async () => {
      const broken = timedSegment(
        { id: 'broken', name: '坏脚本', lines: [{ id: 'x', text: '一句话' }] },
        async (env) => {
          await env.untilLine('x');
          throw new Error('脚本坏了');
        },
      );
      const dom = installDomStub();
      try {
        const problems = await checkVoiceSheet(
          [broken],
          { segments: [{ id: 'broken', duration: 3, lines: [{ id: 'x', start: 0.3, end: 1.5 }] }] },
          dryRun,
        );
        ok(has(problems, 'error', '脚本出错:脚本坏了'), formatProblems(problems));
      } finally {
        dom.restore();
      }
    },
  ],
  [
    '格式错误只报一次;formatProblems 把错误排在前面',
    async () => {
      const problems = await check({ segments: 'oops' });
      equal(problems.filter((p) => p.message.includes('格式不对')).length, 1, formatProblems(problems));
      const text = formatProblems([
        { level: 'warning', message: '甲' },
        { level: 'error', segment: 's', line: 'l', message: '乙' },
      ]);
      equal(text.split('\n')[0], '✗ 错误 [s / l] 乙');
      equal(text.split('\n')[1], '! 提醒 甲');
    },
  ],
  [
    '参考排期(layoutSheet)排出来的时间表能通过校验',
    async () => {
      const dom = installDomStub();
      try {
        const segments = film();
        const { script } = await buildVoiceScript('test', segments, dryRun);
        const { sheet } = layoutSheet(script, {
          sample: { a: { duration: 2.2 }, b: { duration: 1.8, marks: { m: 0.9 } } },
          固定段: { '固定段/1': { duration: 2 }, '固定段/2': { duration: 2.3 } },
        });
        const problems = await checkVoiceSheet(segments, sheet, dryRun);
        equal(errors(problems).length, 0, formatProblems(problems));
      } finally {
        dom.restore();
      }
    },
  ],
]);
