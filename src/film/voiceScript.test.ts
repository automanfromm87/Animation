import { Circle, Create, Dot, FadeIn, Indicate } from '../engine';
import { createStubCanvas, installDomStub } from '../testing/domStub';
import { close, equal, ok, suite } from '../testing/harness';
import { messageChannelYielder } from '../export/offlineEnv';
import { directedSegment } from './segments';
import type { SegmentTiming, SpanEvent, TimedEnv, TimedSegment, TimingObserver } from './timed';
import { timedSegment } from './timed';
import type { Segment } from './types';
import type { DryRunEnv } from './voice';
import { runSegmentToEnd } from './voice';
import { checkVoiceSheet, formatProblems } from './voiceCheck';
import type { MeasuredAudio, VoiceScript, VoiceScriptSegment } from './voiceScript';
import { buildVoiceScript, layoutSheet } from './voiceScript';
import type { VoiceSegmentTiming } from './voiceSheet';
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

/**
 * README §10.2 的「切线的斜率」:切线画到第一句说完、斜率强调到第二句说完,之后停 3 秒。
 * legacy 用 remaining 定长(旧写法),否则用 playUntil。
 */
function slopeSegment(legacy: boolean): Segment {
  return timedSegment(
    {
      id: 'slope',
      name: '切线的斜率',
      lines: [
        { id: 'slope-1', text: '在 x 等于 1 处画一条<mark name="t"/>切线。' },
        { id: 'slope-2', text: '它的斜率是 2,正好是 2x 在这一点的值。' },
      ],
    },
    async (env: TimedEnv) => {
      const dot = new Dot(6);
      const tangent = new Circle(40);
      const k = new Circle(10);
      env.scene.add(dot, tangent, k);
      await env.untilLine('slope-1');
      await env.play(new FadeIn(dot, { runTime: 0.6 }));
      await env.untilMark('slope-1', 't');
      if (legacy) {
        await env.play(new Create(tangent, { runTime: Math.max(0.6, env.remaining('slope-1')) }));
      } else {
        await env.playUntil({ end: 'slope-1', min: 0.6 }, new Create(tangent));
      }
      await env.untilLine('slope-2');
      await env.play(new FadeIn(k, { runTime: 0.8 }));
      if (legacy) {
        await env.play(new Indicate(k, { runTime: Math.max(0.6, env.remaining('slope-2')) }));
      } else {
        await env.playUntil({ end: 'slope-2', min: 0.6, max: 1.2 }, new Indicate(k));
      }
      await env.wait(3);
    },
  );
}

/** README §10.3 的实测:slope-1 念了 2.9 秒(「切线」在 2.0 秒),slope-2 念了 4.6 秒(草稿约 4.2 秒)。 */
const SLOPE_MEASURED: MeasuredAudio = {
  slope: { 'slope-1': { duration: 2.9, marks: { t: 2 } }, 'slope-2': { duration: 4.6 } },
};

/** 手写一段 timed 台词稿(只有一句 u,草稿 0.3–1.3)。 */
function handScript(cues: VoiceScriptSegment['cues'], tail = 0): VoiceScript {
  return {
    version: 1,
    film: 'hand',
    segments: [
      {
        id: 'hand',
        name: '手写',
        kind: 'timed',
        duration: 2,
        lines: [{ id: 'u', text: '一二三四五', plain: '一二三四五', marks: [], draft: { start: 0.3, end: 1.3 } }],
        ...(cues ? { cues } : {}),
        tail,
      },
    ],
  };
}

/** 每句按草稿时长(乘 factor)当实测,模拟配音比草稿快 / 慢。 */
function measuredLike(script: VoiceScript, factor = 1): MeasuredAudio {
  const out: Record<string, Record<string, { duration: number }>> = {};
  for (const segment of script.segments) {
    out[segment.id] = Object.fromEntries(
      segment.lines.map((l) => [l.id, { duration: (l.draft.end - l.draft.start) * factor }]),
    );
  }
  return out;
}

/** 时间表里一段 → 按它重跑用的时间(标记缺省为空)。 */
function timingOf(entry: VoiceSegmentTiming | undefined): SegmentTiming {
  return {
    duration: entry?.duration ?? 0,
    lines: Object.fromEntries(
      (entry?.lines ?? []).map((l) => [l.id, { start: l.start, end: l.end, marks: l.marks ?? {} }]),
    ),
  };
}

/** 跑一遍,收集 playUntil / playThrough 的事件。 */
async function spansOf(segment: Segment, observe: (observer: TimingObserver) => Segment): Promise<SpanEvent[]> {
  const spans: SpanEvent[] = [];
  const run = await withDom(() => runSegmentToEnd(observe({ span: (e) => spans.push(e) }), dryRun));
  ok(run.error === null, `${segment.name}:${String(run.error)}`);
  return spans;
}

/** 可复现的伪随机数(线性同余)。 */
function lcg(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 2 ** 32;
  };
}

const FUZZ_LINES = [
  { id: 'a', text: '一二三<mark name="p"/>四五六七八九十' },
  { id: 'b', text: '甲乙丙<mark name="m"/>丁戊己<mark name="n"/>庚辛' },
  { id: 'c', text: '天地玄黄宇宙<mark name="k"/>洪荒' },
  { id: 'd', text: '好。' },
] as const;
const FUZZ_MARKS: Readonly<Record<string, readonly string[]>> = { a: ['p'], b: ['m', 'n'], c: ['k'], d: [] };

/**
 * 随机脚本:untilLine / untilMark / 固定时长的 play 与 playUntil(三种目标)/ playThrough 混排,带随机 min / max / lead。
 * 台词大多按顺序往后踩(这句或下一句),偶尔跳回去踩一句已经说过的(乱序)。
 */
function fuzzSegment(seed: number): { segment: TimedSegment; desc: string } {
  const r = lcg(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T;
  const steps: Array<(env: TimedEnv) => Promise<void>> = [];
  const desc: string[] = [];
  const count = 3 + Math.floor(r() * 6);
  let at = 0;
  for (let i = 0; i < count; i++) {
    const roll = r();
    const index = roll < 0.1 ? Math.floor(r() * FUZZ_LINES.length) : Math.min(FUZZ_LINES.length - 1, at + (roll < 0.55 ? 0 : 1));
    at = Math.max(at, index);
    const line = FUZZ_LINES[index]?.id ?? 'a';
    const marks = FUZZ_MARKS[line] ?? [];
    const runTime = Math.round(r() * 20) / 10;
    const o: { min?: number; max?: number; lead?: number } = {};
    if (r() < 0.3) o.min = Math.round(r() * 10) / 10;
    if (r() < 0.3) o.max = (o.min ?? 0) + Math.round(r() * 20) / 10;
    if (r() < 0.3) o.lead = Math.round(r() * 5) / 10;
    const anim = (env: TimedEnv): FadeIn => {
      const c = new Circle(5);
      env.scene.add(c);
      return new FadeIn(c, { runTime });
    };
    const kind = Math.floor(r() * 7);
    const mark = marks.length > 0 ? pick(marks) : null;
    if (kind === 0) {
      desc.push(`playUntil({ end: ${line} })`);
      steps.push((env) => env.playUntil({ end: line, ...o }, anim(env)));
    } else if (kind === 1) {
      desc.push(`playUntil({ start: ${line} })`);
      steps.push((env) => env.playUntil({ start: line, ...o }, anim(env)));
    } else if (kind === 2 && mark !== null) {
      desc.push(`playUntil({ ${line}#${mark} })`);
      steps.push((env) => env.playUntil({ line, mark, ...o }, anim(env)));
    } else if (kind === 3) {
      desc.push(`playThrough(${line})`);
      steps.push((env) => env.playThrough({ line, ...o }, anim(env)));
    } else if (kind === 4) {
      desc.push(`untilLine(${line})`);
      steps.push((env) => env.untilLine(line));
    } else if (kind === 5 && mark !== null) {
      desc.push(`untilMark(${line}#${mark})`);
      steps.push((env) => env.untilMark(line, mark));
    } else {
      desc.push(`play(${runTime})`);
      steps.push((env) => env.play(anim(env)));
    }
  }
  const segment = timedSegment({ id: 'fuzz', name: '随机', lines: FUZZ_LINES }, async (env) => {
    for (const step of steps) {
      await step(env);
    }
  });
  return { segment, desc: `seed ${seed}: ${desc.join('; ')}` };
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
  [
    '台词稿:playUntil 的句尾提示点只记动画的 min(伸缩部分不算);按实测排出来的时间表通过校验(README §10.3 的回归)',
    async () => {
      const script = await scriptOf([slopeSegment(false)]);
      const timed = script.segments[0];
      equal(
        timed?.cues?.map((c) => `${c.line}${c.mark !== undefined ? `#${c.mark}` : ''}${c.end === true ? '$' : ''}`).join(' '),
        'slope-1 slope-1#t slope-1$ slope-2 slope-2$',
      );
      const endCue = timed?.cues?.[2];
      equal(endCue?.end, true, '句尾提示点带 end: true');
      close(endCue?.needs ?? NaN, 0.6, 0.05, '切线至少画 0.6 秒');
      close(timed?.cues?.[4]?.needs ?? NaN, 1.4, 0.05, '淡入 0.8 + 强调至少 0.6');
      close(timed?.tail ?? NaN, 3, 0.05, '尾巴只有最后的 3 秒停留(不含跟着台词伸缩的强调)');
      close(timed?.lines[0]?.needsEnd ?? NaN, 0.6, 0.05, '每句也带一份 needsEnd');
      equal(timed?.lines[0]?.needsBefore, 0);
      equal(timed?.lines[1]?.needsEnd !== undefined, true);

      const { sheet, problems } = layoutSheet(script, SLOPE_MEASURED);
      equal(problems.length, 0, formatProblems(problems));
      const laid = sheet.segments[0];
      const second = laid?.lines?.[1];
      close(laid?.duration ?? NaN, (second?.end ?? 0) + 3, 0.05, '时长 = 第二句说完 + 3 秒停留');
      close(second?.end ?? NaN, 8.05, 1e-9, '第二句 3.45 开口(上一句 3.2 说完 + 停顿),念 4.6 秒');
      const check = await withDom(() => checkVoiceSheet([slopeSegment(false)], sheet, dryRun));
      equal(check.filter((p) => p.level === 'error').length, 0, formatProblems(check));

      // 对照:remaining 写法把草稿速度下的强调时长算进尾巴,配音一慢,时间表就比动画短。
      const legacy = await scriptOf([slopeSegment(true)]);
      const old = layoutSheet(legacy, SLOPE_MEASURED);
      const oldCheck = await withDom(() => checkVoiceSheet([slopeSegment(true)], old.sheet, dryRun));
      ok(
        oldCheck.some((p) => p.level === 'error' && p.message.includes('动画比时间表长')),
        `旧写法应当报「动画比时间表长」:${formatProblems(oldCheck)}`,
      );
    },
  ],
  [
    '排期:句尾提示点是第一次碰到这句时,让这句正好在动画收住时说完',
    () => {
      const { sheet, problems } = layoutSheet(handScript([{ line: 'u', end: true, needs: 3 }]), {
        hand: { u: { duration: 1 } },
      });
      equal(problems.length, 0, formatProblems(problems));
      const u = sheet.segments[0]?.lines?.[0];
      close(u?.start ?? NaN, 2, 1e-9, '开口推到 3 − 1 = 2 秒');
      close(u?.end ?? NaN, 3, 1e-9);
    },
  ],
  [
    '排期:句尾来不及(这句已经开口、说得比动画短)只提醒,时长照样撑到动画收住',
    () => {
      const script = handScript(
        [
          { line: 'u', needs: 0 },
          { line: 'u', end: true, needs: 2 },
        ],
        0.5,
      );
      const { sheet, problems } = layoutSheet(script, { hand: { u: { duration: 1 } } });
      equal(problems.length, 1, formatProblems(problems));
      const warning = problems[0];
      equal(warning?.level, 'warning');
      ok(warning?.message.includes('说完') && warning.message.includes('多播 1'), warning?.message);
      close(sheet.segments[0]?.lines?.[0]?.start ?? NaN, 0.3, 1e-9, '开口不动');
      close(sheet.segments[0]?.duration ?? NaN, 2.3 + 0.5, 1e-9, '时长 = 动画收住(0.3 + 2)+ 尾巴');
    },
  ],
  [
    '台词稿:草稿里 playUntil 时间不够时报提醒(配音方和作者都能看到)',
    async () => {
      const segment = timedSegment(
        { id: 'tight', name: '太紧', lines: [{ id: 'p', text: '好。' }] },
        async (env) => {
          const c = new Circle(10);
          env.scene.add(c);
          await env.untilLine('p');
          await env.playUntil({ end: 'p' }, new FadeIn(c, { runTime: 1.5 }));
        },
      );
      const { problems } = await withDom(() => buildVoiceScript('tight', [segment], dryRun));
      equal(problems.length, 1, formatProblems(problems));
      equal(problems[0]?.level, 'warning');
      equal(problems[0]?.line, 'p');
      ok(problems[0]?.message.includes('草稿里动画时间不够') && problems[0].message.includes('台词「p」说完'), problems[0]?.message);
    },
  ],
  [
    '台词稿 → 排期 → 重跑:句尾目标落在还没开口的句子上,那句不早于调用时开口;按草稿时长排出来的时间表里,动画时长与草稿一致',
    async () => {
      const LONG = '一二三四五六七八九十一二三四五六七八';
      const make = (): TimedSegment =>
        timedSegment(
          {
            id: 'first-end',
            name: '句尾先到',
            lines: [
              { id: 'p', text: '好。' },
              { id: 'long', text: LONG },
            ],
          },
          async (env) => {
            const c = new Circle(10);
            const d = new Circle(5);
            env.scene.add(c, d);
            await env.untilLine('p');
            await env.play(new FadeIn(c, { runTime: 5 }));
            await env.playUntil({ end: 'long' }, new FadeIn(d, { runTime: 1 }));
          },
        );
      const segment = make();
      const script = await scriptOf([segment]);
      const timed = script.segments[0];
      equal(
        timed?.cues?.map((c) => `${c.line}${c.end === true ? '$' : ''}:${c.needs}`).join(' '),
        'p:0 long:5 long$:1',
        '句尾提示点前有这句的开口提示点(不早于调用时)',
      );
      close(timed?.lines[1]?.needsBefore ?? NaN, 5, 1e-9);
      close(timed?.lines[1]?.needsEnd ?? NaN, 1, 1e-9);

      const draftSpans = await spansOf(segment, (observer) => segment.drafting(observer).segment);
      for (const factor of [1, 0.6, 1.5]) {
        const { sheet, problems } = layoutSheet(script, measuredLike(script, factor));
        equal(problems.length, 0, `×${factor}:${formatProblems(problems)}`);
        const laid = sheet.segments[0];
        const long = laid?.lines?.find((l) => l.id === 'long');
        close(long?.start ?? NaN, 5.3, 1e-6, `×${factor}:在淡入 5 秒之后开口(以前会排到句尾对齐、提前开口)`);
        const voiced = await spansOf(segment, (observer) => segment.withTiming(timingOf(laid), { observer }));
        close(
          voiced[0]?.runTime ?? NaN,
          (draftSpans[0]?.runTime ?? NaN) * factor,
          0.05,
          `×${factor}:动画铺满整句,时长随配音伸缩(以前只剩 min 的 1 秒)`,
        );
        const check = await withDom(() => checkVoiceSheet([make()], sheet, dryRun));
        equal(check.length, 0, `×${factor}:${formatProblems(check)}`);
      }
    },
  ],
  [
    '台词稿 → 排期 → 校验:playThrough 用在已经开口的句子上,不多出来晚的开口提示点,时间表没有问题',
    async () => {
      const make = (): Segment =>
        timedSegment(
          {
            id: 'through',
            name: '整句',
            lines: [
              { id: 'a', text: '一二三四五六七八九十一二三四五' },
              { id: 'b', text: '甲乙丙丁' },
            ],
          },
          async (env) => {
            const c = new Circle(10);
            const d = new Circle(5);
            const e = new Circle(3);
            env.scene.add(c, d, e);
            await env.untilLine('a');
            await env.play(new FadeIn(c, { runTime: 0.8 }));
            await env.playThrough('a', new FadeIn(d, { runTime: 1 }));
            await env.untilLine('b');
            await env.play(new FadeIn(e, { runTime: 1 }));
          },
        );
      const script = await scriptOf([make()]);
      equal(
        script.segments[0]?.cues?.map((c) => `${c.line}${c.end === true ? '$' : ''}:${c.needs}`).join(' '),
        'a:0 a$:1.8 b:0',
      );
      const { sheet, problems } = layoutSheet(script, measuredLike(script));
      equal(problems.length, 0, formatProblems(problems));
      const check = await withDom(() => checkVoiceSheet([make()], sheet, dryRun));
      equal(check.length, 0, formatProblems(check));
    },
  ],
  [
    '台词稿 → 排期 → 重跑 → 校验:开口目标({ start })就是普通的开口提示点,配音快慢都排得下',
    async () => {
      const make = (): TimedSegment =>
        timedSegment(
          {
            id: 'to-start',
            name: '画到下一句开口',
            lines: [
              { id: 'x', text: '一二三四五六七八九十' },
              { id: 'y', text: '然后呢。' },
            ],
          },
          async (env) => {
            const c = new Circle(10);
            const d = new Circle(5);
            env.scene.add(c, d);
            await env.untilLine('x');
            await env.playUntil({ start: 'y' }, new FadeIn(c, { runTime: 3 }));
            await env.play(new FadeIn(d, { runTime: 0.5 }));
          },
        );
      const segment = make();
      const script = await scriptOf([segment]);
      const timed = script.segments[0];
      equal(timed?.cues?.map((c) => `${c.line}${c.end === true ? '$' : ''}:${c.needs}`).join(' '), 'x:0 y:3');
      close(timed?.lines[1]?.draft.start ?? NaN, 3.3, 1e-6, '草稿:y 等动画的 3 秒(上一句早就说完了)');
      equal(timed?.lines[1]?.needsEnd, undefined, '没有句尾提示点');
      const xDraft = (timed?.lines[0]?.draft.end ?? NaN) - (timed?.lines[0]?.draft.start ?? NaN);
      for (const factor of [0.4, 2]) {
        const { sheet, problems } = layoutSheet(script, measuredLike(script, factor));
        equal(problems.length, 0, `×${factor}:${formatProblems(problems)}`);
        const laid = sheet.segments[0];
        const y = laid?.lines?.find((l) => l.id === 'y');
        // 配音快:x 早说完,y 等动画的 3 秒;配音慢:y 接在 x 说完 + 停顿,动画拉长填满。
        const yStart = Math.max(0.3 + 3, 0.3 + xDraft * factor + 0.25);
        close(y?.start ?? NaN, yStart, 1e-3, `×${factor}:y 在 max(动画的 3 秒, x 说完 + 停顿) 开口`);
        const spans = await spansOf(segment, (observer) => segment.withTiming(timingOf(laid), { observer }));
        close(spans[0]?.runTime ?? NaN, yStart - 0.3, 0.05, `×${factor}:动画填满到 y 开口`);
        const check = await withDom(() => checkVoiceSheet([make()], sheet, dryRun));
        equal(check.length, 0, `×${factor}:${formatProblems(check)}`);
      }
    },
  ],
  [
    '随机脚本(提示点与 playUntil / playThrough 混排):草稿与按草稿重跑一致;按实测排出的时间表不出排期没提醒过的错误,动画时长与草稿一致',
    async () => {
      const failures: string[] = [];
      let clean = 0;
      const { warn } = console;
      console.warn = (): void => undefined; // 随机脚本里「时间不够」很常见,这里只看结构
      try {
        for (let seed = 1; seed <= 200 && failures.length < 5; seed++) {
          const { segment, desc } = fuzzSegment(seed);
          const bad: string[] = [];
          // 1. 草稿 vs 按草稿时间重跑:目标时刻相同、动画时长只差帧取整、时间线等于声明时长。
          const drafted: SpanEvent[] = [];
          const draft = segment.drafting({ span: (e) => drafted.push(e) });
          await withDom(() => runSegmentToEnd(draft.segment, dryRun));
          const timing = draft.result();
          if (!timing) {
            failures.push(`${desc}:草稿没排出来`);
            continue;
          }
          const replayed: SpanEvent[] = [];
          const replay = await withDom(() =>
            runSegmentToEnd(segment.withTiming(timing, { observer: { span: (e) => replayed.push(e) } }), dryRun),
          );
          if (Math.abs(replay.elapsed - timing.duration) > 0.1) {
            bad.push(`重跑 ${replay.elapsed.toFixed(3)} 秒,声明 ${timing.duration.toFixed(3)} 秒`);
          }
          drafted.forEach((e, i) => {
            const again = replayed[i];
            if (!again || Math.abs(again.at - e.at) > 1e-6 || Math.abs(again.runTime - e.runTime) > 0.07) {
              bad.push(`第 ${i + 1} 个 playUntil:草稿 ${e.at.toFixed(3)} / ${e.runTime.toFixed(3)},重跑 ${again?.at.toFixed(3)} / ${again?.runTime.toFixed(3)}`);
            }
          });
          // 2. 按草稿时长(×0.6–1.6)当实测排期、校验:有错误时排期必须已经提醒过。
          const { script } = await withDom(() => buildVoiceScript('fuzz', [segment], dryRun));
          const factor = [0.6, 0.8, 1.25, 1.6][seed % 4] ?? 1;
          const laid = layoutSheet(script, measuredLike(script, factor));
          const check = await withDom(() => checkVoiceSheet([segment], laid.sheet, dryRun));
          const errs = check.filter((p) => p.level === 'error');
          if (errs.length > 0 && laid.problems.length === 0) {
            bad.push(`×${factor} 排期没提醒,校验却报错:${formatProblems(errs)}`);
          }
          // 3. 按草稿时长原样当实测:排期没提醒时,按时间表重跑的每段动画时长与草稿一样(草稿预言了配音版)。
          const same = layoutSheet(script, measuredLike(script));
          if (same.problems.length === 0) {
            clean += 1;
            const voiced = await spansOf(segment, (observer) => segment.withTiming(timingOf(same.sheet.segments[0]), { observer }));
            drafted.forEach((e, i) => {
              if (Math.abs((voiced[i]?.runTime ?? NaN) - e.runTime) > 0.1) {
                bad.push(`同速配音第 ${i + 1} 个 playUntil 播 ${voiced[i]?.runTime.toFixed(3)} 秒,草稿 ${e.runTime.toFixed(3)} 秒`);
              }
            });
          }
          if (bad.length > 0) {
            failures.push(`${desc}\n    ${bad.join('\n    ')}`);
          }
        }
      } finally {
        console.warn = warn;
      }
      equal(failures.length, 0, failures.join('\n'));
      ok(clean >= 50, `同速排期没提醒的脚本太少(${clean} 个),第 3 条等于没测`);
    },
  ],
]);
