import { Circle, FadeIn } from '../engine';
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

/** x 画到说完(至少 1 秒);y 开口后在标记 m 前 0.2 秒画完(至少 0.5 秒)。 */
function spanFilm(): Segment[] {
  return [
    timedSegment(
      {
        id: 'span',
        name: '按目标',
        lines: [
          { id: 'x', text: '一二三四五六七八九十' },
          { id: 'y', text: '甲乙丙<mark name="m"/>丁戊己' },
        ],
      },
      async (env) => {
        const c = new Circle(10);
        const d = new Circle(5);
        env.scene.add(c, d);
        await env.untilLine('x');
        await env.playUntil({ end: 'x' }, new FadeIn(c, { runTime: 1 }));
        await env.untilLine('y');
        await env.playUntil({ line: 'y', mark: 'm', lead: 0.2 }, new FadeIn(d, { runTime: 0.5 }));
      },
    ),
  ];
}

/** spanFilm 的时间表:x 0.3–2.5,y 2.8–4.3(m 在 3.6),时长 5;edit 改动后校验。 */
async function checkSpans(edit: (x: Line, y: Line) => void): Promise<VoiceProblem[]> {
  const x: Line = { id: 'x', start: 0.3, end: 2.5 };
  const y: Line = { id: 'y', start: 2.8, end: 4.3, marks: { m: 3.6 } };
  edit(x, y);
  const dom = installDomStub();
  try {
    return await checkVoiceSheet(spanFilm(), { segments: [{ id: 'span', duration: 5, lines: [x, y] }] }, dryRun);
  } finally {
    dom.restore();
  }
}

/**
 * 开口目标与隐含开口:x 开口后画到 y 开口(至少 3 秒、提前 0.5 秒收住);淡入 1 秒后 playThrough 画到 z 说完
 * (至少 1 秒);再淡入 3 秒后画到 w 说完 —— w 还没开口,按约定在调用时开口。
 */
function startFilm(): Segment[] {
  return [
    timedSegment(
      {
        id: 'start',
        name: '开口目标',
        lines: [
          { id: 'x', text: '一二三四五六七八九十' },
          { id: 'y', text: '然后呢。' },
          { id: 'z', text: '甲乙丙丁戊己' },
          { id: 'w', text: '天地玄黄宇宙洪荒' },
        ],
      },
      async (env) => {
        const dots = [new Circle(10), new Circle(8), new Circle(6), new Circle(4), new Circle(2)];
        env.scene.add(...dots);
        const [c0, c1, c2, c3, c4] = dots as [Circle, Circle, Circle, Circle, Circle];
        await env.untilLine('x');
        await env.playUntil({ start: 'y', lead: 0.5 }, new FadeIn(c0, { runTime: 3 }));
        await env.untilLine('z');
        await env.play(new FadeIn(c1, { runTime: 1 }));
        await env.playThrough('z', new FadeIn(c2, { runTime: 1 }));
        await env.play(new FadeIn(c3, { runTime: 3 }));
        await env.playUntil({ end: 'w' }, new FadeIn(c4, { runTime: 1 }));
      },
    ),
  ];
}

/** startFilm 的合格时间表(layoutSheet 按实测 x 2.2、y 1、z 2.45、w 2 秒排出来的);edit 改动后校验。 */
async function checkStarts(edit: (lines: Record<'x' | 'y' | 'z' | 'w', Line>) => void): Promise<VoiceProblem[]> {
  const lines = {
    x: { id: 'x', start: 0.3, end: 2.5 },
    y: { id: 'y', start: 3.8, end: 4.8 },
    z: { id: 'z', start: 5.05, end: 7.5 },
    w: { id: 'w', start: 10.5, end: 12.5 },
  };
  edit(lines);
  const dom = installDomStub();
  try {
    return await checkVoiceSheet(
      startFilm(),
      { segments: [{ id: 'start', duration: 13.1, lines: [lines.x, lines.y, lines.z, lines.w] }] },
      dryRun,
    );
  } finally {
    dom.restore();
  }
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
  [
    'playUntil 收不住:开口 / 标记目标之后才收住是错误;句尾或只是提前量不够是提醒;提示点编号把 playUntil 也算上',
    async () => {
      const good = await checkSpans(() => undefined);
      equal(good.length, 0, formatProblems(good));

      const shortLine = await checkSpans((x) => {
        x.end = 1;
      });
      equal(errors(shortLine).length, 0, formatProblems(shortLine));
      ok(has(shortLine, 'warning', '动画时间不够:第 2 个提示点(台词「x」说完)'), formatProblems(shortLine));
      ok(has(shortLine, 'warning', '动画比这句多播'), formatProblems(shortLine));

      const earlyMark = await checkSpans((_, y) => {
        y.marks = { m: 3 };
      });
      ok(has(earlyMark, 'error', '动画收不住:第 4 个提示点(台词「y」的标记「m」)'), formatProblems(earlyMark));
      ok(has(earlyMark, 'error', '晚了 0.3'), formatProblems(earlyMark));

      const leadOnly = await checkSpans((_, y) => {
        y.marks = { m: 3.4 };
      });
      equal(errors(leadOnly).length, 0, formatProblems(leadOnly));
      ok(has(leadOnly, 'warning', '提前量不足'), formatProblems(leadOnly));
    },
  ],
  [
    '开口目标 / playThrough / 隐含开口:动画在开口之后才收住是错误,只差提前量是提醒;消息照脚本写的说',
    async () => {
      const good = await checkStarts(() => undefined);
      equal(good.length, 0, formatProblems(good));

      const early = await checkStarts((l) => {
        l.y.start = 2.8;
      });
      ok(has(early, 'error', '动画收不住:第 2 个提示点(台词「y」开口)'), formatProblems(early));
      ok(has(early, 'error', 'playUntil 的动画'), formatProblems(early));
      ok(has(early, 'error', '晚了 0.50'), formatProblems(early));

      const leadOnly = await checkStarts((l) => {
        l.y.start = 3.5;
      });
      equal(errors(leadOnly).length, 0, formatProblems(leadOnly));
      ok(has(leadOnly, 'warning', '动画时间不够:第 2 个提示点(台词「y」开口)'), formatProblems(leadOnly));
      ok(has(leadOnly, 'warning', '提前量不足'), formatProblems(leadOnly));

      const shortZ = await checkStarts((l) => {
        l.z.end = 6.5;
      });
      equal(errors(shortZ).length, 0, formatProblems(shortZ));
      ok(has(shortZ, 'warning', '第 4 个提示点(台词「z」说完)'), formatProblems(shortZ));
      ok(has(shortZ, 'warning', 'playThrough 的动画'), formatProblems(shortZ));

      const wEarly = await checkStarts((l) => {
        l.w.start = 8.5;
      });
      ok(
        has(wEarly, 'error', '动画来不及:第 5 个提示点(台词「w」开口,playUntil 让它在调用时开口)'),
        formatProblems(wEarly),
      );
    },
  ],
]);
