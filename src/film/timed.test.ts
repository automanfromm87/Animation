import { BasePlayable, Circle, Create, FadeIn } from '../engine';
import type { Playable } from '../engine';
import { messageChannelYielder } from '../export/offlineEnv';
import { installDomStub } from '../testing/domStub';
import { close, equal, ok, suite } from '../testing/harness';
import type { CueEvent, SegmentTiming, SpanEvent, TimedEnv, TimedLine, TimedSegment, TimingObserver } from './timed';
import { estimateSpeech, spanRunTime, timedSegment } from './timed';
import type { Segment } from './types';
import type { DryRunEnv } from './voice';
import { draftTiming, prepareVoice, runSegmentToEnd } from './voice';
import type { VoiceProblem } from './voiceSheet';

/** 帧取整的容差(30 fps 一帧约 0.033 秒)。 */
const T = 0.05;

const A_TEXT = '一二三四五六七八九十';
const B_TEXT = '甲乙丙<mark name="m"/>丁戊己';
const E_TEXT = '甲<mark name="m"/>乙丙丁戊己';
/** 10 字 / 4.5 ≈ 2.222 秒。 */
const A = estimateSpeech(A_TEXT, 4.5);
/** 6 字 / 4.5 ≈ 1.333 秒;标记 m 在句中约 0.667 秒。 */
const B = estimateSpeech(B_TEXT, 4.5);
const B_M = estimateSpeech('甲乙丙', 4.5, 0);
const E = estimateSpeech(E_TEXT, 4.5);
const E_M = estimateSpeech('甲', 4.5, 0);
/** 「好。」「然后。」都碰到 0.8 秒的下限。 */
const SHORT = estimateSpeech('好。', 4.5);

const LINES_AB: readonly TimedLine[] = [
  { id: 'a', text: A_TEXT },
  { id: 'b', text: B_TEXT },
];

/** 带 DOM 桩的干跑环境。 */
async function withDryRun<T>(body: (env: DryRunEnv) => Promise<T>): Promise<T> {
  const dom = installDomStub();
  try {
    return await body({ createCanvas: dom.canvas, createYielder: messageChannelYielder });
  } finally {
    dom.restore();
  }
}

/** 收集 console.warn(测试里断言告警的次数与内容)。 */
async function captureWarnings<R>(body: () => Promise<R>): Promise<{ result: R; warnings: string[] }> {
  const warnings: string[] = [];
  const { warn } = console;
  console.warn = (...args: unknown[]): void => {
    warnings.push(args.map(String).join(' '));
  };
  try {
    return { result: await body(), warnings };
  } finally {
    console.warn = warn;
  }
}

/** 探针动画:记下自己收尾时的段内时刻(只记第一次)。 */
class Probe extends BasePlayable {
  finishedAt = NaN;
  private readonly clock: () => number;

  constructor(clock: () => number, runTime = 1) {
    super({ runTime });
    this.clock = clock;
  }

  interpolate(): void {
    // 只关心什么时候收尾。
  }

  override finish(): void {
    super.finish();
    if (Number.isNaN(this.finishedAt)) {
      this.finishedAt = this.clock();
    }
  }
}

function probe(env: TimedEnv, runTime = 1): Probe {
  return new Probe(() => env.now(), runTime);
}

/** 一个可见的小圆(FadeIn / Create 的对象)。 */
function dot(env: TimedEnv): Circle {
  const c = new Circle(8);
  env.scene.add(c);
  return c;
}

function seg(lines: readonly TimedLine[], direct: (env: TimedEnv) => Promise<void>, name = '测试'): TimedSegment {
  return timedSegment({ id: 'seg', name, lines }, direct);
}

/** 草稿模式跑一遍:记下提示点、playUntil 事件与排出来的时间。 */
async function draftRun(
  segment: TimedSegment,
  env: DryRunEnv,
): Promise<{ timing: SegmentTiming; cues: CueEvent[]; spans: SpanEvent[]; elapsed: number }> {
  const cues: CueEvent[] = [];
  const spans: SpanEvent[] = [];
  const { segment: draft, result } = segment.drafting({ cue: (e) => cues.push(e), span: (e) => spans.push(e) });
  const run = await runSegmentToEnd(draft, env);
  if (run.error) {
    throw run.error;
  }
  const timing = result();
  if (!timing) {
    throw new Error('草稿没有排出来');
  }
  return { timing, cues, spans, elapsed: run.elapsed };
}

function quietProblems(): { problems: VoiceProblem[]; onProblem: (p: VoiceProblem) => void } {
  const problems: VoiceProblem[] = [];
  return { problems, onProblem: (p) => problems.push(p) };
}

function cueNames(cues: ReadonlyArray<{ line: string; mark?: string; end?: true }>): string {
  return cues.map((c) => `${c.line}${c.mark !== undefined ? `#${c.mark}` : ''}${c.end === true ? '$' : ''}`).join(',');
}

/** 时间表:a 0.5–2,b 2.5–5(标记 m 在 3.5),时长 6。 */
const VOICED: SegmentTiming = {
  duration: 6,
  lines: { a: { start: 0.5, end: 2, marks: {} }, b: { start: 2.5, end: 5, marks: { m: 3.5 } } },
};

export default suite('按台词定时长:playUntil / playThrough', [
  [
    'spanRunTime:clamp(目标 − 提前量 − 现在, min, max)',
    () => {
      close(spanRunTime(1, 3, { min: 0.5, max: Infinity, lead: 0 }), 2);
      close(spanRunTime(1, 3, { min: 0.5, max: Infinity, lead: 0.5 }), 1.5, 1e-12, '提前 0.5 秒收住');
      close(spanRunTime(1, 3, { min: 0.5, max: 1, lead: 0 }), 1, 1e-12, 'max 封顶');
      close(spanRunTime(1, 1.2, { min: 0.5, max: Infinity, lead: 0 }), 0.5, 1e-12, '不到 min 按 min');
      close(spanRunTime(4, 3, { min: 0.3, max: Infinity, lead: 0 }), 0.3, 1e-12, '目标已过按 min');
    },
  ],
  [
    '草稿:画到句尾、在标记前 lead 秒收住;返回时正好在目标;排出来的台词时间与不用 playUntil 时一样',
    () =>
      withDryRun(async (env) => {
        let p1: Probe | null = null;
        let p2: Probe | null = null;
        const after: number[] = [];
        const segment = seg(LINES_AB, async (e) => {
          const c = dot(e);
          await e.untilLine('a');
          await e.play(new Create(c, { runTime: 1 }));
          p1 = probe(e, 1);
          await e.playUntil({ end: 'a' }, p1);
          after.push(e.now());
          await e.untilLine('b');
          p2 = probe(e, 0.3);
          await e.playUntil({ line: 'b', mark: 'm', lead: 0.2 }, p2);
          after.push(e.now());
        });
        const { result: draft, warnings } = await captureWarnings(() => draftRun(segment, env));
        equal(warnings.length, 0, warnings.join(' | '));
        const aEnd = 0.3 + A;
        const bStart = aEnd + 0.25;
        const mark = bStart + B_M;
        const [end, onMark] = draft.spans;
        equal(end?.kind, 'end');
        equal(end?.line, 'a');
        close(end?.from ?? NaN, 1.3, T, '画完坐标轴(1 秒)时调用');
        close(end?.ready ?? NaN, (end?.from ?? 0) + 1, 1e-9, '最早 from + min(自身时长 1 秒)');
        close(end?.at ?? NaN, aEnd, 1e-9, '目标就是 a 说完');
        close(end?.runTime ?? NaN, aEnd - (end?.from ?? 0), 1e-9, '动画拉长到句尾');
        close((p1 as Probe | null)?.finishedAt ?? NaN, aEnd, T, '动画在 a 说完时收住');
        close(after[0] ?? NaN, aEnd, T, '返回时正好 a 说完');
        equal(onMark?.kind, 'mark');
        equal(onMark?.mark, 'm');
        close(onMark?.at ?? NaN, mark, 1e-9, '目标是标记 m 的草稿时刻(没挪)');
        close(onMark?.runTime ?? NaN, mark - 0.2 - (onMark?.from ?? 0), 1e-9);
        close((p2 as Probe | null)?.finishedAt ?? NaN, mark - 0.2, T, '在标记前 0.2 秒收住');
        close(after[1] ?? NaN, mark, T, '静止等到标记:返回时正好说到 m');
        const a = draft.timing.lines['a'];
        const b = draft.timing.lines['b'];
        close(a?.start ?? NaN, 0.3, 1e-9);
        close(a?.end ?? NaN, aEnd, 1e-9);
        close(b?.start ?? NaN, bStart, 1e-6, 'b 接在 a 后 + 停顿');
        close(b?.end ?? NaN, bStart + B, 1e-6, '句尾不因 playUntil 挪动');
        close(b?.marks['m'] ?? NaN, mark, 1e-6);

        const result = await draftTiming(segment, env);
        equal(cueNames(result.cues), 'a,a$,b,b#m', '句尾提示点(a$)按调用顺序进 cues');
        close(result.cues[0]?.needs ?? NaN, 0, 1e-9);
        close(result.cues[1]?.needs ?? NaN, 2, T, 'a 开口后:坐标轴 1 秒 + 曲线至少 1 秒,不含拉长的部分');
        close(result.cues[2]?.needs ?? NaN, 0, T, 'b 从 a 说完时量起:不需要额外时间');
        close(result.cues[3]?.needs ?? NaN, 0.5, T, '标记前:至少 0.3 秒 + 提前 0.2 秒');
        close(result.tail, 0, T, 'playUntil 返回在目标上:之后没有尾巴');
        equal(result.shortfalls.length, 0);
      }),
  ],
  [
    '草稿:标记来不及时这句从标记起后挪(同 untilMark),不告警;动画按自身时长播',
    () =>
      withDryRun(async (env) => {
        const segment = seg([{ id: 'e', text: E_TEXT }], async (e) => {
          const c = dot(e);
          await e.untilLine('e');
          await e.playUntil({ line: 'e', mark: 'm' }, new FadeIn(c, { runTime: 1.5 }));
        });
        const { result: draft, warnings } = await captureWarnings(() => draftRun(segment, env));
        equal(warnings.length, 0, warnings.join(' | '));
        const line = draft.timing.lines['e'];
        close(line?.marks['m'] ?? NaN, 1.8, T, '标记挪到动画最早收住的时刻(0.3 + 1.5)');
        close(line?.end ?? NaN, 0.3 + E + (1.5 - E_M), T, '句尾跟着一起挪');
        close(draft.timing.duration, (line?.end ?? 0) + 0.6, 1e-9);
        close(draft.spans[0]?.runTime ?? NaN, 1.5, 1e-9);
        const result = await draftTiming(segment, env);
        equal(cueNames(result.cues), 'e,e#m');
        close(result.cues[1]?.needs ?? NaN, 1.5, T);
        const { problems, onProblem } = quietProblems();
        const prepared = await prepareVoice([segment], { dryRun: env, onProblem });
        equal(problems.length, 0);
        const run = await runSegmentToEnd(prepared.segments[0] as Segment, env);
        close(run.elapsed, prepared.segments[0]?.duration ?? NaN, T, '草稿时长与重跑的时间线一致');
      }),
  ],
  [
    '草稿:目标是还没开口的句子时,那句等动画的 min(不早于上一句说完 + 停顿);对照 remaining 会把那句往后推',
    () =>
      withDryRun(async (env) => {
        let p: Probe | null = null;
        let after = NaN;
        const lines: TimedLine[] = [
          { id: 'a', text: A_TEXT },
          { id: 'q', text: '然后。' },
        ];
        const fill = seg(lines, async (e) => {
          await e.untilLine('a');
          p = probe(e, 1);
          await e.playUntil({ start: 'q' }, p);
          after = e.now();
        });
        const filled = await draftRun(fill, env);
        const qStart = 0.3 + A + 0.25;
        close(filled.timing.lines['q']?.start ?? NaN, qStart, 1e-6, '动画比上一句短:q 照常在 a 说完 + 停顿时开口');
        close(filled.spans[0]?.runTime ?? NaN, qStart - (filled.spans[0]?.from ?? 0), 1e-9, '动画填满到 q 开口');
        close((p as Probe | null)?.finishedAt ?? NaN, qStart, T);
        close(after, qStart, T);
        const draftCues = await draftTiming(fill, env);
        equal(cueNames(draftCues.cues), 'a,q', '开口目标就是普通的开口提示点');
        close(draftCues.cues[1]?.needs ?? NaN, 1, T, 'needs 只算动画的 min');

        const waits = seg(
          [
            { id: 'p', text: '好。' },
            { id: 'q', text: '然后。' },
          ],
          async (e) => {
            await e.untilLine('p');
            await e.playUntil({ start: 'q' }, new FadeIn(dot(e), { runTime: 2 }));
          },
        );
        const waited = await draftRun(waits, env);
        close(waited.timing.lines['q']?.start ?? NaN, 2.3, T, '动画比上一句长:q 等动画的 2 秒');
        ok(0.3 + SHORT + 0.25 < 2.2, '(上一句说完 + 停顿明显更早)');

        const legacy = seg(lines, async (e) => {
          await e.untilLine('a');
          await e.play(new FadeIn(dot(e), { runTime: e.remaining('q') }));
          await e.untilLine('q');
        });
        const old = await draftRun(legacy, env);
        ok(
          (old.timing.lines['q']?.start ?? 0) > qStart + SHORT - T,
          `remaining 按预估的 q 算时长,q 反被动画推到预估的句尾之后:${old.timing.lines['q']?.start}`,
        );
      }),
  ],
  [
    '时间不够(句尾早于动画的 min):按 min 播、句尾不挪;告警一次(草稿干跑有观察者时不告警)',
    () =>
      withDryRun(async (env) => {
        const segment = seg(
          [{ id: 'p', text: '好。' }],
          async (e) => {
            await e.untilLine('p');
            await e.playUntil({ end: 'p' }, new FadeIn(dot(e), { runTime: 1.5 }));
          },
          '太短',
        );
        const { problems, onProblem } = quietProblems();
        const { result: prepared, warnings: quiet } = await captureWarnings(() =>
          prepareVoice([segment], { dryRun: env, onProblem }),
        );
        equal(quiet.length, 0, `干跑排草稿不告警:${quiet.join(' | ')}`);
        equal(problems.length, 0);
        const draft = await draftTiming(segment, env);
        close(draft.timing.lines['p']?.end ?? NaN, 0.3 + SHORT, 1e-9, '句尾不为动画后挪');
        close(draft.timing.duration, 1.8, T, '时长撑到动画收住(1.8)而不是句尾 + 0.6(1.7)');
        equal(draft.shortfalls.length, 1, '草稿结果里记下时间不够');
        const played = prepared.segments[0] as Segment;
        const { result: runs, warnings } = await captureWarnings(async () => [
          await runSegmentToEnd(played, env),
          await runSegmentToEnd(played, env),
        ]);
        equal(warnings.length, 1, `播两遍只告警一次:${warnings.join(' | ')}`);
        const text = warnings[0] ?? '';
        for (const part of ['timedSegment「太短」', '台词「p」说完', '1.10', '1.50', '晚 0.70']) {
          ok(text.includes(part), `告警要包含「${part}」:${text}`);
        }
        close(runs[0]?.elapsed ?? NaN, played.duration, T, '时间线与声明时长一致');
      }),
  ],
  [
    '目标已经过了:按 min 播,告警说明目标已过',
    () =>
      withDryRun(async (env) => {
        const times: number[] = [];
        const segment = seg(LINES_AB, async (e) => {
          await e.untilLine('b');
          times.push(e.now());
          await e.playUntil({ end: 'a' }, new FadeIn(dot(e), { runTime: 0.5 }));
          times.push(e.now());
        });
        const { warnings } = await captureWarnings(() => runSegmentToEnd(segment.drafting().segment, env));
        equal(warnings.length, 1, warnings.join(' | '));
        ok(warnings[0]?.includes('目标已经过了'), warnings[0]);
        close((times[1] ?? NaN) - (times[0] ?? NaN), 0.5, T, '按 min(自身 0.5 秒)播完就返回');
      }),
  ],
  [
    '按时间表:句尾、标记 + max(提前停、静止到标记)、几个动画按比例一起伸缩;有观察者时报事件不告警',
    () =>
      withDryRun(async (env) => {
        const probes: Probe[] = [];
        const after: number[] = [];
        const segment = seg(LINES_AB, async (e) => {
          const p = (runTime: number): Probe => {
            const x = probe(e, runTime);
            probes.push(x);
            return x;
          };
          await e.untilLine('a');
          await e.playUntil({ end: 'a' }, p(1));
          after.push(e.now());
          await e.playUntil({ line: 'b', mark: 'm', max: 0.5 }, p(1));
          after.push(e.now());
          await e.playUntil({ end: 'b' }, p(0.5), p(1));
          after.push(e.now());
          await e.playUntil({ start: 'b' });
        });
        const spans: SpanEvent[] = [];
        const observer: TimingObserver = { span: (x) => spans.push(x) };
        const { result: run, warnings } = await captureWarnings(() =>
          runSegmentToEnd(segment.withTiming(VOICED, { observer }), env),
        );
        equal(warnings.length, 0, `有观察者时由观察者报:${warnings.join(' | ')}`);
        ok(run.error === null, String(run.error));
        close(run.elapsed, 6, T, '撑到时间表的 6 秒');
        close(probes[0]?.finishedAt ?? NaN, 2, T, 'a 0.5 开口,画到 2 秒说完');
        close(after[0] ?? NaN, 2, T);
        close(spans[0]?.runTime ?? NaN, 1.5, T);
        close(spans[1]?.min ?? NaN, 0.5, 1e-12, 'min 缺省 = 自身时长与 max 取小');
        close(probes[1]?.finishedAt ?? NaN, 2.5, T, 'max 0.5:提前停');
        close(after[1] ?? NaN, 3.5, T, '静止等到标记');
        close(probes[2]?.finishedAt ?? NaN, 4.25, T, '0.5 秒的那个按比例拉到 0.75 秒');
        close(probes[3]?.finishedAt ?? NaN, 5, T, '最长的那个填满到 b 说完');
        close(after[2] ?? NaN, 5, T);
        equal(spans.map((x) => x.kind).join(','), 'end,mark,end,start');
        const passed = spans[3];
        close(passed?.at ?? NaN, 2.5, 1e-12, '目标(b 开口)早已过了');
        ok((passed?.ready ?? 0) > (passed?.at ?? 0), '事件里能看出时间不够');
        equal(passed?.runTime, 0, '没有动画:什么也不播');
        const { warnings: unobserved } = await captureWarnings(() => runSegmentToEnd(segment.withTiming(VOICED), env));
        equal(unobserved.length, 1, `没有观察者就告警:${unobserved.join(' | ')}`);
        ok(unobserved[0]?.includes('台词「b」开口'), unobserved[0]);
      }),
  ],
  [
    'playThrough:先等这句开口(发开口提示点),再画到这句说完;可以带 min / max',
    () =>
      withDryRun(async (env) => {
        let p: Probe | null = null;
        let after = NaN;
        const through = (spec: Parameters<TimedEnv['playThrough']>[0]): TimedSegment =>
          seg(LINES_AB, async (e) => {
            p = probe(e, 1);
            await e.playThrough(spec, p);
            after = e.now();
          });
        const cues: CueEvent[] = [];
        const spans: SpanEvent[] = [];
        const run = await runSegmentToEnd(
          through('b').withTiming(VOICED, { observer: { cue: (x) => cues.push(x), span: (x) => spans.push(x) } }),
          env,
        );
        ok(run.error === null, String(run.error));
        equal(cues.length, 1);
        equal(cues[0]?.line, 'b');
        close(cues[0]?.called ?? NaN, 0, 1e-9);
        close(cues[0]?.at ?? NaN, 2.5, 1e-12);
        equal(spans.length, 1);
        equal(spans[0]?.kind, 'end');
        close(spans[0]?.from ?? NaN, 2.5, T);
        close((p as Probe | null)?.finishedAt ?? NaN, 5, T, '整句都在画');
        close(after, 5, T);

        await runSegmentToEnd(through({ line: 'b', min: 0.3, max: 0.5 }).withTiming(VOICED), env);
        close((p as Probe | null)?.finishedAt ?? NaN, 3, T, 'max 0.5:开口后 0.5 秒画完');
        close(after, 5, T, '静止到这句说完');

        const draft = await draftTiming(through('b'), env);
        equal(cueNames(draft.cues), 'b,b$');
        close(draft.cues[1]?.needs ?? NaN, 1, T, '句尾前动画至少 1 秒');
      }),
  ],
  [
    '草稿里 playUntil 读过的时刻不再挪:之后来晚的 untilMark 不改句尾,草稿与重跑一致',
    () =>
      withDryRun(async (env) => {
        const finished: number[] = [];
        const segment = seg([{ id: 'b', text: B_TEXT }], async (e) => {
          await e.untilLine('b');
          const p = probe(e, 0.5);
          await e.playUntil({ end: 'b' }, p);
          finished.push(p.finishedAt);
          await e.untilMark('b', 'm'); // 标记早就过了(句尾之前)
        });
        const draft = await draftRun(segment, env);
        const b = draft.timing.lines['b'];
        close(b?.end ?? NaN, 0.3 + B, 1e-9, '句尾没被挪');
        close(b?.marks['m'] ?? NaN, 0.3 + B_M, 1e-9, '标记没被挪');
        const late = draft.cues.find((c) => c.mark === 'm');
        ok((late?.called ?? 0) - (late?.at ?? 0) > 0.5, '那个提示点算来晚了');
        const run = await runSegmentToEnd(segment.withTiming(draft.timing), env);
        close(run.elapsed, draft.timing.duration, T, '按草稿时间重跑,时间线与声明时长一致');
        close(finished[1] ?? NaN, finished[0] ?? NaN, 1e-9, '重跑时动画收住的时刻与草稿一样');

        const plain = seg([{ id: 'b', text: B_TEXT }], async (e) => {
          await e.untilLine('b');
          await e.wait(B);
          await e.untilMark('b', 'm');
        });
        const moved = await draftRun(plain, env);
        ok((moved.timing.lines['b']?.end ?? 0) > 0.3 + B + 0.5, '对照:没有 playUntil 读过时,来晚的标记照旧把句尾后挪');
      }),
  ],
  [
    '草稿里 untilMark 交给过脚本的标记也不再挪:之后 playUntil 到同一个标记算目标已过(告警),草稿与重跑一致',
    () =>
      withDryRun(async (env) => {
        const segment = seg(
          [{ id: 'b', text: B_TEXT }],
          async (e) => {
            await e.untilMark('b', 'm');
            await e.play(new FadeIn(dot(e), { runTime: 1 }));
            await e.playUntil({ line: 'b', mark: 'm' }, new FadeIn(dot(e), { runTime: 0.5 }));
          },
          '读过的标记',
        );
        const draft = await draftRun(segment, env);
        const b = draft.timing.lines['b'];
        close(b?.marks['m'] ?? NaN, 0.3 + B_M, 1e-9, '标记还在 untilMark 等到它的时刻');
        close(b?.end ?? NaN, 0.3 + B, 1e-9, '句尾没被挪');
        close(draft.spans[0]?.at ?? NaN, 0.3 + B_M, 1e-9, '目标就是那个已经过了的标记');
        close(draft.spans[0]?.runTime ?? NaN, 0.5, 1e-9, '按 min 播');
        equal((await draftTiming(segment, env)).shortfalls.length, 1, '草稿里记下时间不够');
        const { problems, onProblem } = quietProblems();
        const prepared = await prepareVoice([segment], { dryRun: env, onProblem });
        equal(problems.length, 0);
        const played = prepared.segments[0] as Segment;
        const { result: run, warnings } = await captureWarnings(() => runSegmentToEnd(played, env));
        close(run.elapsed, played.duration, T, '按草稿时间重跑,时间线与声明时长一致');
        equal(warnings.length, 1, warnings.join(' | '));
        ok(warnings[0]?.includes('目标已经过了'), warnings[0]);
      }),
  ],
  [
    '句尾 / 标记目标落在还没踩到的句子上:那句在调用时开口(不等),先报一个开口提示点;按时间表重跑时照样报',
    () =>
      withDryRun(async (env) => {
        const LONG = '一二三四五六七八九十一二三四五六七八';
        let p: Probe | null = null;
        const toEnd = seg(
          [
            { id: 'p', text: '好。' },
            { id: 'long', text: LONG },
          ],
          async (e) => {
            await e.untilLine('p');
            await e.play(new FadeIn(dot(e), { runTime: 5 }));
            p = probe(e, 1);
            await e.playUntil({ end: 'long' }, p);
          },
        );
        const draft = await draftRun(toEnd, env);
        const long = draft.timing.lines['long'];
        close(long?.start ?? NaN, 5.3, T, '在调用时(淡入 5 秒之后)开口,不是接着上一句');
        close(long?.end ?? NaN, (long?.start ?? 0) + estimateSpeech(LONG, 4.5), 1e-9);
        equal(cueNames(draft.cues), 'p,long');
        const opened = draft.cues[1];
        equal(opened?.implicit, true, '脚本没写 untilLine:标成隐含的开口');
        close(opened?.called ?? NaN, 5.3, T);
        close(opened?.at ?? NaN, opened?.called ?? NaN, 1e-9, '不等:调用时就开口');
        close(draft.spans[0]?.runTime ?? NaN, estimateSpeech(LONG, 4.5), T, '动画铺满整句');
        close((p as Probe | null)?.finishedAt ?? NaN, long?.end ?? NaN, T);
        const result = await draftTiming(toEnd, env);
        equal(cueNames(result.cues), 'p,long,long$', '台词稿里句尾提示点前多一个开口提示点');
        close(result.cues[1]?.needs ?? NaN, 5, T, '开口不早于调用(淡入 5 秒)');
        close(result.cues[2]?.needs ?? NaN, 1, T, '说完不早于开口 + 动画的 min');

        const replay: CueEvent[] = [];
        await runSegmentToEnd(toEnd.withTiming(draft.timing, { observer: { cue: (x) => replay.push(x) } }), env);
        equal(cueNames(replay), 'p,long', '按时间表重跑:提示点序列与草稿一样(踩没踩到与时钟无关)');
        equal(replay[1]?.implicit, true);

        const toMark = seg(
          [
            { id: 'p', text: '好。' },
            { id: 'b', text: B_TEXT },
          ],
          async (e) => {
            await e.untilLine('p');
            await e.play(new FadeIn(dot(e), { runTime: 3 }));
            await e.playUntil({ line: 'b', mark: 'm' }, new FadeIn(dot(e), { runTime: 0.3 }));
          },
        );
        const marked = await draftTiming(toMark, env);
        equal(cueNames(marked.cues), 'p,b,b#m');
        close(marked.timing.lines['b']?.start ?? NaN, 3.3, T, '标记目标同样让那句在调用时开口');
        close(marked.cues[1]?.needs ?? NaN, 3, T);
        close(marked.cues[2]?.needs ?? NaN, 0.3, T);

        const reached = await draftTiming(
          seg(LINES_AB, async (e) => {
            await e.untilLine('b');
            await e.playUntil({ end: 'b' }, new FadeIn(dot(e), { runTime: 0.5 }));
          }),
          env,
        );
        equal(cueNames(reached.cues), 'b,b$', '已经开口的句子不再报开口');
      }),
  ],
  [
    'playThrough 用在已经开口的句子上:不再等开口(不报来晚的开口提示点),同 playUntil({ end })',
    () =>
      withDryRun(async (env) => {
        let p: Probe | null = null;
        const segment = seg(LINES_AB, async (e) => {
          await e.untilLine('a');
          await e.play(new FadeIn(dot(e), { runTime: 0.3 }));
          p = probe(e, 1);
          await e.playThrough('a', p);
          await e.untilLine('b');
        });
        const cues: CueEvent[] = [];
        const spans: SpanEvent[] = [];
        const run = await runSegmentToEnd(
          segment.withTiming(VOICED, { observer: { cue: (x) => cues.push(x), span: (x) => spans.push(x) } }),
          env,
        );
        ok(run.error === null, String(run.error));
        equal(cueNames(cues), 'a,b', '只有脚本写的两个开口');
        equal(spans[0]?.api, 'playThrough');
        close(spans[0]?.from ?? NaN, 0.8, T, '从调用时起画,不等');
        close((p as Probe | null)?.finishedAt ?? NaN, 2, T, '画到 a 说完');
        const draft = await draftTiming(segment, env);
        equal(cueNames(draft.cues), 'a,a$,b');
        close(draft.cues[1]?.needs ?? NaN, 1.3, T, '淡入 0.3 + 至少 1 秒');

        const afterMark = await draftTiming(
          seg(LINES_AB, async (e) => {
            await e.untilMark('b', 'm');
            await e.playThrough('b', probe(e, 0.5));
          }),
          env,
        );
        equal(cueNames(afterMark.cues), 'b#m,b$', '踩过这句的标记也算开过口');

        const later = await draftTiming(
          seg(LINES_AB, async (e) => {
            await e.untilLine('b');
            await e.playThrough('a', new FadeIn(dot(e), { runTime: 0.5 }));
          }),
          env,
        );
        equal(cueNames(later.cues), 'b,a$', '更靠后的句子已经开口:a 也算踩过');
        equal(later.shortfalls.length, 1, 'a 早就说完了:报时间不够,而不是一个来晚的开口');
      }),
  ],
  [
    '时间不够的告警照脚本写的说:playThrough 就写 playThrough',
    () =>
      withDryRun(async (env) => {
        const segment = seg([{ id: 'p', text: '好。' }], async (e) => {
          await e.playThrough({ line: 'p', min: 2 }, new FadeIn(dot(e), { runTime: 1 }));
        });
        const { problems, onProblem } = quietProblems();
        const prepared = await prepareVoice([segment], { dryRun: env, onProblem });
        equal(problems.length, 0);
        const { warnings } = await captureWarnings(() => runSegmentToEnd(prepared.segments[0] as Segment, env));
        equal(warnings.length, 1, warnings.join(' | '));
        ok(warnings[0]?.includes('playThrough(台词「p」说完)'), warnings[0]);
        ok(!warnings[0]?.includes('playUntil'), warnings[0]);
      }),
  ],
  [
    '取消(跳转 / 销毁):正在播或正在静止等目标都能停下,finally 照常收尾,done 正常落定',
    async () => {
      const dom = installDomStub();
      try {
        // 按时间表:a 0.5 开口;动画 0.5–1.0(max 0.5),之后静止到 2.0(a 说完)。
        for (const [label, stopAt] of [
          ['播放中', 0.75],
          ['静止等目标中', 1.5],
        ] as const) {
          const log: string[] = [];
          const segment = seg(LINES_AB, async (e) => {
            await e.untilLine('a');
            const stop = e.scene.addUpdater(() => undefined);
            try {
              await e.playUntil({ end: 'a', max: 0.5 }, new FadeIn(dot(e), { runTime: 1 }));
              log.push('after');
            } finally {
              stop();
              log.push('finally');
            }
          });
          const handle = segment.withTiming(VOICED).play(dom.canvas());
          let settled = 'pending';
          handle.done.then(
            () => {
              settled = 'resolved';
            },
            () => {
              settled = 'rejected';
            },
          );
          for (let i = 0; i < 200 && handle.getElapsed() < stopAt; i++) {
            dom.frame(1000 / 60);
            await dom.flush();
          }
          ok(handle.getElapsed() >= stopAt && handle.getElapsed() < 2, `${label}:取消前停在 ${handle.getElapsed()}`);
          handle.dispose();
          for (let i = 0; i < 5; i++) {
            dom.frame(1000 / 60);
            await dom.flush();
          }
          equal(settled, 'resolved', `${label}:取消不该变成错误`);
          equal(log.join(','), 'finally', `${label}:取消后脚本不再往下走,finally 照常收尾`);
        }
      } finally {
        dom.restore();
      }
    },
  ],
  [
    '写错了就报错(段被跳过):目标不是三选一、没声明的台词、没有的标记、min / max / lead 不合法、playThrough 带标记',
    () =>
      withDryRun(async (env) => {
        const failWith = async (body: (e: TimedEnv) => Promise<void>, expected: string): Promise<void> => {
          const segment = seg(LINES_AB, body, '坏脚本');
          const run = await runSegmentToEnd(segment.withTiming(VOICED), env);
          const message = run.error instanceof Error ? run.error.message : String(run.error);
          ok(message.includes(expected), `期望报错含「${expected}」,实际:${message}`);
        };
        await failWith((e) => e.playUntil({ start: 'a', end: 'a' } as never), 'timedSegment「坏脚本」playUntil 的目标要三选一');
        await failWith((e) => e.playUntil({ line: 'a' } as never), '三选一');
        await failWith((e) => e.playUntil({ end: 3 } as never), '三选一');
        await failWith((e) => e.playUntil({ end: 'zz' }), '没有声明台词「zz」');
        await failWith((e) => e.playUntil({ line: 'b', mark: 'nope' }), '没有标记');
        await failWith((e) => e.playUntil({ end: 'a', min: 2, max: 1 }), 'min(2)大于 max(1)');
        await failWith((e) => e.playUntil({ end: 'a', lead: -1 }), 'lead 需要非负有限数');
        await failWith((e) => e.playUntil({ end: 'a', min: Number.NaN }), 'min 需要非负有限数');
        await failWith((e) => e.playUntil({ end: 'a', max: Number.NaN }), 'max 需要非负数');
        await failWith((e) => e.playThrough({ line: 'b', mark: 'm' } as never), 'playThrough 要一句台词的 id');
        await failWith((e) => e.playThrough({ line: 'a', min: -1 }), 'playThrough 的 min');
        await failWith(async (e) => {
          const once: Playable = new FadeIn(dot(e));
          await e.playUntil({ end: 'a' }, once, once);
        }, '同一个动画实例');
        const { problems, onProblem } = quietProblems();
        await prepareVoice([seg(LINES_AB, (e) => e.playUntil({ line: 'a' } as never))], { dryRun: env, onProblem });
        ok(
          problems.some((p) => p.level === 'error' && p.message.includes('排草稿失败') && p.message.includes('三选一')),
          problems.map((p) => p.message).join(' | '),
        );
      }),
  ],
  [
    '兼容:remaining / line 照旧;不带动画的 playUntil 就是等到目标',
    () =>
      withDryRun(async (env) => {
        const got: number[] = [];
        let line: ReturnType<TimedEnv['line']> | null = null;
        const segment = seg(LINES_AB, async (e) => {
          await e.untilLine('a');
          got.push(e.remaining('a'));
          line = e.line('a');
          await e.wait(1);
          got.push(e.remaining('a'));
          await e.playUntil({ end: 'a' });
          got.push(e.now());
          await e.wait(1);
          got.push(e.remaining('a'));
        });
        const run = await runSegmentToEnd(segment.withTiming(VOICED), env);
        ok(run.error === null, String(run.error));
        close(got[0] ?? NaN, 1.5, T);
        close(got[1] ?? NaN, 0.5, T);
        close(got[2] ?? NaN, 2, T, '不带动画:等到 a 说完');
        equal(got[3], 0, '说完之后为 0');
        const l = line as ReturnType<TimedEnv['line']> | null;
        equal(`${l?.start}-${l?.end}-${l?.duration}`, '0.5-2-1.5');
      }),
  ],
]);
