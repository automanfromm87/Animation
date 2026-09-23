import { fakeAudio, fakeLiveEnv } from '../audio/testing';
import { Circle, Create, FadeIn } from '../engine';
import { messageChannelYielder } from '../export/offlineEnv';
import { installDomStub } from '../testing/domStub';
import { close, equal, ok, suite, throws } from '../testing/harness';
import { runFilm } from './film';
import { directedSegment } from './segments';
import type { CueEvent, TimedSegment } from './timed';
import { estimateSpeech, isTimedSegment, timedSegment } from './timed';
import type { Segment } from './types';
import type { DryRunEnv } from './voice';
import { draftTiming, prepareVoice, runSegmentToEnd, voiceIdOf, voiceLineIdOf } from './voice';
import { VoicePlayback } from './voicePlayer';
import type { VoiceProblem } from './voiceSheet';
import { markNames, parseVoiceSheet, resolveAudioRef, stripMarks, textBeforeMark } from './voiceSheet';

const SHEET_URL = 'https://cdn.example.com/voice/demo/timing.json';

/** 带 DOM 桩的干跑环境(画布来自桩,让出用 MessageChannel)。 */
async function withDryRun<T>(body: (env: DryRunEnv) => Promise<T>): Promise<T> {
  const dom = installDomStub();
  try {
    return await body({ createCanvas: dom.canvas, createYielder: messageChannelYielder });
  } finally {
    dom.restore();
  }
}

/** 测试用的按台词对齐分段:先画 2 秒的圆,等第二句开口,再等「半径」这个词,淡入 0.5 秒。 */
function demoSegment(): TimedSegment {
  return timedSegment(
    {
      id: 'demo',
      name: '演示',
      lines: [
        { id: 'l1', text: '先画一个圆。' },
        { id: 'l2', text: '它的半径<mark name="r"/>是一。' },
      ],
    },
    async (env) => {
      const c = new Circle(40);
      const label = new Circle(5);
      label.opacity = 0;
      env.scene.add(c, label);
      await env.play(new Create(c, { runTime: 2 }));
      await env.untilLine('l2');
      await env.untilMark('l2', 'r');
      await env.play(new FadeIn(label, { runTime: 0.5 }));
    },
  );
}

function quietProblems(): { problems: VoiceProblem[]; onProblem: (p: VoiceProblem) => void } {
  const problems: VoiceProblem[] = [];
  return { problems, onProblem: (p) => problems.push(p) };
}

const L1 = estimateSpeech('先画一个圆。', 4.5);
const L2 = estimateSpeech('它的半径是一。', 4.5);
const MARK_R = estimateSpeech('它的半径', 4.5, 0);

export default suite('配音:时间表、按台词对齐、prepareVoice、播放', [
  [
    '时间表解析:合法的原样保留;坏掉的分段整段丢弃并报 error;标记越界收进这句并报 warning',
    () => {
      const { sheet, problems } = parseVoiceSheet({
        film: 'demo',
        segments: [
          {
            id: 'a',
            duration: 5,
            audio: { file: 'long.m4a', offset: 12.5 },
            lines: [
              { id: 'a1', start: 0.3, end: 2, text: '你好', marks: { k: 9 } },
              { id: 'a2', start: 2.2, end: 4.8, audio: 'a2.m4a' },
            ],
          },
          { id: 'b', duration: -1 },
          { id: 'c', duration: 3, lines: [{ id: 'x', start: 1, end: 2 }, { id: 'y', start: 1.5, end: 2.5 }] },
          { id: 'a', duration: 2 },
          { duration: 2 },
        ],
      });
      equal(sheet?.segments.map((s) => s.id).join(','), 'a', '只有 a 合法');
      equal(sheet?.segments[0]?.lines?.[0]?.marks?.['k'], 2, '标记收进这句的结束');
      const errors = problems.filter((p) => p.level === 'error').map((p) => p.segment ?? '?');
      equal(errors.join(','), 'b,c,a,?', 'b 时长非法、c 重叠、a 重复、最后一个缺 id');
      ok(problems.some((p) => p.level === 'warning' && p.line === 'a1'));
      equal(parseVoiceSheet('nope').sheet, null);
    },
  ],
  [
    '标记工具与音频地址:去掉标签、列出标记、标记前的文字;路径相对时间表所在目录',
    () => {
      const text = '这条直线的斜率<mark name="k"/>,就是<mark name=\'t\'/>它倾斜的程度。';
      equal(stripMarks(text), '这条直线的斜率,就是它倾斜的程度。');
      equal(markNames(text).join(','), 'k,t');
      equal(textBeforeMark(text, 't'), '这条直线的斜率,就是');
      equal(textBeforeMark(text, 'none'), null);
      equal(resolveAudioRef('a/1.m4a', SHEET_URL).url, 'https://cdn.example.com/voice/demo/a/1.m4a');
      const long = resolveAudioRef({ file: '../all.mp3', offset: 3 }, SHEET_URL);
      equal(long.url, 'https://cdn.example.com/voice/all.mp3');
      equal(long.offset, 3);
    },
  ],
  [
    '按字数估时:字数 / 语速,逗号类停 0.15 秒、句号类停 0.3 秒,空白不算字;有下限',
    () => {
      close(estimateSpeech('先画一个圆。', 4.5), 5 / 4.5 + 0.3, 1e-12);
      close(estimateSpeech('一,二。', 1), 2 + 0.15 + 0.3, 1e-12);
      close(estimateSpeech('a b', 1), 2, 1e-12, '空白不算字');
      close(estimateSpeech('它<mark name="k"/>好', 1), 2, 1e-12, '标签不算字');
      equal(estimateSpeech('好', 10), 0.8, '缺省下限 0.8 秒');
      close(estimateSpeech('好', 10, 0), 0.1, 1e-12);
    },
  ],
  [
    'timedSegment 参数校验:缺 id、台词重名、空台词、标记重名、语速非法都抛错',
    () => {
      const noop = async (): Promise<void> => undefined;
      throws(() => timedSegment({ id: ' ', name: 'x', lines: [] }, noop));
      throws(() => timedSegment({ id: 'x', name: 'x', lines: [{ id: 'a', text: '1' }, { id: 'a', text: '2' }] }, noop));
      throws(() => timedSegment({ id: 'x', name: 'x', lines: [{ id: 'a', text: '<mark name="k"/>' }] }, noop));
      throws(() =>
        timedSegment({ id: 'x', name: 'x', lines: [{ id: 'a', text: '一<mark name="k"/>二<mark name="k"/>' }] }, noop),
      );
      throws(() => timedSegment({ id: 'x', name: 'x', lines: [], draftRate: 0 }, noop));
      ok(isTimedSegment(demoSegment()));
      ok(!isTimedSegment(directedSegment('普通', 1, [], noop)));
    },
  ],
  [
    '草稿排期(尽早):动画比话长时这句等动画;句中标记按字数比例落下;时长 = 最后一句说完 + 尾巴;提示点前动画要的时间记下来',
    () =>
      withDryRun(async (env) => {
        const draft = await draftTiming(demoSegment(), env);
        const l1 = draft.timing.lines['l1'];
        const l2 = draft.timing.lines['l2'];
        close(l1?.start ?? NaN, 0.3, 1e-9, '第一句段首 0.3 秒开口(脚本没等它)');
        close(l1?.end ?? NaN, 0.3 + L1, 1e-9);
        close(l2?.start ?? NaN, 2, 1e-6, '第二句等圆画完(2 秒)才开口,而不是上一句说完就开口');
        close(l2?.end ?? NaN, 2 + L2, 1e-6);
        close(l2?.marks['r'] ?? NaN, 2 + MARK_R, 1e-6, '「半径」落在按字数比例的位置');
        close(draft.timing.duration, 2 + L2 + 0.6, 1e-6, '最后一句说完再留 0.6 秒');
        equal(draft.cues.map((c) => `${c.line}${c.mark ? `#${c.mark}` : ''}`).join(','), 'l2,l2#r');
        close(draft.cues[0]?.needs ?? NaN, 2, 1e-6, '第二句之前动画要 2 秒');
        close(draft.cues[1]?.needs ?? NaN, 0, 1e-6, '标记之前不需要额外的动画');
        close(draft.tail, 0.5, 0.05, '最后一个提示点之后动画还要 0.5 秒');
      }),
  ],
  [
    '草稿排期:话比动画长时等上一句说完 + 停顿;脚本来晚了标记就把这句往后挪;没等的句子接着说',
    () =>
      withDryRun(async (env) => {
        const seg = timedSegment(
          {
            id: 'x',
            name: '长台词',
            lines: [
              { id: 'a', text: '这是一句非常非常长的开场白,要说好几秒钟才能说完。' },
              { id: 'b', text: '然后<mark name="m"/>才轮到这里。' },
              { id: 'c', text: '最后一句。' },
            ],
          },
          async (e) => {
            await e.untilLine('b');
            await e.wait(3); // 动画比「然后」长得多:标记来晚了
            await e.untilMark('b', 'm');
          },
        );
        const a = estimateSpeech('这是一句非常非常长的开场白,要说好几秒钟才能说完。', 4.5);
        const draft = await draftTiming(seg, env);
        const b = draft.timing.lines['b'];
        close(b?.start ?? NaN, 0.3 + a + 0.25, 1e-6, '第二句等第一句说完 + 0.25 秒停顿');
        close(b?.marks['m'] ?? NaN, (b?.start ?? 0) + 3, 0.05, '标记挪到脚本真正走到的时刻');
        const bLen = estimateSpeech('然后才轮到这里。', 4.5);
        const shift = 3 - estimateSpeech('然后', 4.5, 0);
        close(b?.end ?? NaN, (b?.start ?? 0) + bLen + shift, 0.05, '这句整体往后挪');
        const c = draft.timing.lines['c'];
        close(c?.start ?? NaN, (b?.end ?? 0) + 0.25, 1e-6, '没等的句子接着上一句说');
      }),
  ],
  [
    '按时间表播:提示点落在时间表的时刻;动画先完就撑到时长;动画来晚了能看出来;字幕来自时间表(去掉标签)',
    () =>
      withDryRun(async (env) => {
        const events: CueEvent[] = [];
        let ended: { called: number; duration: number } | null = null;
        const timing = {
          duration: 6,
          lines: { l1: { start: 0.5, end: 2, marks: {} }, l2: { start: 2.5, end: 5, marks: { r: 3.5 } } },
        };
        const seg = demoSegment().withTiming(timing, {
          observer: { cue: (e) => events.push(e), end: (e) => (ended = e) },
        });
        equal(seg.duration, 6);
        equal(seg.subtitles?.map((s) => `${s.id}:${s.start}-${s.end}:${s.text}`).join('|'), 'l1:0.5-2:先画一个圆。|l2:2.5-5:它的半径是一。');
        const run = await runSegmentToEnd(seg, env);
        ok(run.settled);
        close(run.elapsed, 6, 0.05, '撑到时间表的 6 秒');
        equal(events.map((e) => e.at).join(','), '2.5,3.5');
        close(events[0]?.called ?? NaN, 2, 0.05, '圆画完时走到第一个提示点');
        close((ended as { called: number } | null)?.called ?? NaN, 4, 0.05, '脚本 4 秒跑完(淡入到 4 秒)');
        const late = demoSegment().withTiming(
          { duration: 6, lines: { l1: { start: 0.3, end: 0.9, marks: {} }, l2: { start: 1, end: 3, marks: { r: 1.5 } } } },
          { observer: { cue: (e) => events.push(e) } },
        );
        events.length = 0;
        await runSegmentToEnd(late, env);
        ok((events[0]?.called ?? 0) - (events[0]?.at ?? 0) > 0.9, '时间表让第二句 1 秒开口,但动画 2 秒才走到:晚了约 1 秒');
        throws(() => demoSegment().withTiming({ duration: 3, lines: {} }), '缺台词的时间不能套用');
      }),
  ],
  [
    'prepareVoice:按时间表定时间、挂音频(路径相对时间表);普通分段挂音频且字幕跟着时间表走;对不上的都报出来',
    () =>
      withDryRun(async (env) => {
        const fixed = directedSegment(
          '固定段',
          4,
          [
            { start: 0.2, end: 1.5, text: '第一句' },
            { start: 1.8, end: 3.5, text: '第二句' },
          ],
          async (e) => {
            await e.wait(4);
          },
          { id: 'fixed' },
        );
        const film: Segment[] = [demoSegment(), fixed];
        equal(voiceIdOf(fixed), 'fixed');
        equal(voiceLineIdOf(fixed, 1), 'fixed/2');
        const { problems, onProblem } = quietProblems();
        const prepared = await prepareVoice(film, {
          sheetUrl: SHEET_URL,
          fetchJson: async () => ({
            segments: [
              {
                id: 'demo',
                duration: 7,
                lines: [
                  { id: 'l1', start: 0.5, end: 2, audio: 'demo/l1.m4a', text: '先画一个圆。' },
                  { id: 'l2', start: 2.5, end: 5.5, audio: 'demo/l2.m4a', text: '它的半径是二。' },
                ],
              },
              {
                id: 'fixed',
                duration: 5,
                audio: 'fixed.m4a',
                lines: [
                  { id: 'fixed/1', start: 0.3, end: 1.6 },
                  { id: 'fixed/2', start: 2, end: 3.8 },
                ],
              },
              { id: 'ghost', duration: 1 },
            ],
          }),
          dryRun: env,
          onProblem,
        });
        const [demo, fx] = prepared.segments;
        equal(demo?.duration, 7);
        equal(demo?.voice?.clips.map((c) => c.url).join(','), 'https://cdn.example.com/voice/demo/demo/l1.m4a,https://cdn.example.com/voice/demo/demo/l2.m4a');
        equal(demo?.voice?.clips[1]?.start, 2.5);
        close(demo?.voice?.clips[1]?.duration ?? NaN, 4.5, 1e-9, '一直播到本段结束(文件先完就先完)');
        ok(problems.some((p) => p.line === 'l2' && p.message.includes('台词改过了')), '台词过期要提示重做');
        ok(problems.some((p) => p.line === 'l2' && p.message.includes('标记「r」')), '缺标记时刻按比例补并提示');
        equal(fx?.duration, 4, '固定段动画时长不变');
        ok(problems.some((p) => p.segment === 'fixed' && p.message.includes('动画时长固定')));
        equal(fx?.subtitles?.map((s) => `${s.start}-${s.end}:${s.text}`).join('|'), '0.3-1.6:第一句|2-3.8:第二句', '字幕跟时间表的起止走,文字用稿子的');
        equal(fx?.voice?.clips[0]?.duration, 4, '整段音频截到动画时长');
        ok(problems.some((p) => p.segment === 'ghost'), '时间表里多出的分段要报');
        const run = await runSegmentToEnd(demo as Segment, env);
        close(run.elapsed, 7, 0.05, '按时间表的时长播');
      }),
  ],
  [
    'prepareVoice:时间表缺句子的段改用草稿(报 error);取不到时间表时 timedSegment 按草稿、普通分段原样',
    () =>
      withDryRun(async (env) => {
        const { problems, onProblem } = quietProblems();
        const partial = await prepareVoice([demoSegment()], {
          sheet: { segments: [{ id: 'demo', duration: 5, lines: [{ id: 'l1', start: 0.3, end: 1 }] }] },
          dryRun: env,
          onProblem,
        });
        ok(problems.some((p) => p.level === 'error' && p.message.includes('缺少台词')));
        close(partial.segments[0]?.duration ?? NaN, 2 + L2 + 0.6, 1e-6, '按草稿时间');
        equal(partial.segments[0]?.voice, undefined, '草稿没有声音');
        const plain = directedSegment('普通', 1, [], async () => undefined);
        const none = await prepareVoice([plain], { sheetUrl: 'missing.json', fetchJson: async () => null, dryRun: env });
        equal(none.segments[0], plain, '没有时间表、也没有 timedSegment:原样返回');
        equal(none.sheet, null);
        const draftOnly = await prepareVoice([demoSegment(), plain], { dryRun: env, onProblem });
        ok(!isTimedSegment(draftOnly.segments[0] as Segment), '草稿也是套好时间的普通分段');
        const run = await runSegmentToEnd(draftOnly.segments[0] as Segment, env);
        ok(Math.abs(run.elapsed - (draftOnly.segments[0]?.duration ?? 0)) <= 0.25, '草稿时长与实际时间线一致(内容测试的契约)');
      }),
  ],
  [
    '播放控制:默认不出声;开声音时建一次音频上下文;对账按段内时刻起播;切后台停、回来接上;销毁关上下文',
    () => {
      const env = fakeLiveEnv({ 'https://x/a.m4a': fakeAudio(5) });
      const voice = new VoicePlayback(env);
      const seg = directedSegment('s', 5, [], async () => undefined);
      const withVoice: Segment = { ...seg, voice: { clips: [{ id: 'a', url: 'https://x/a.m4a', start: 1, duration: 4, offset: 0 }] } };
      voice.sync(withVoice, 1.5, true, null);
      equal(env.contexts, 0, '没开声音不建上下文');
      voice.setEnabled(true);
      equal(env.contexts, 1);
      ok(voice.enabled);
      equal(env.ctx.resumes, 1);
      return (async () => {
        for (let i = 0; i < 5; i++) {
          await Promise.resolve();
        }
        voice.sync(withVoice, 2, true, null);
        const node = env.ctx.nodes[0];
        close(node?.started?.offset ?? NaN, 1, 1e-9, '段内 2 秒 = 片段第 1 秒');
        env.setHidden(true);
        ok(node?.stopped, '切后台就停');
        equal(env.ctx.suspends, 1);
        env.setHidden(false);
        ok(env.ctx.live().length === 1, '回来按当时的位置接上');
        voice.sync(withVoice, 2.1, false, null);
        equal(env.ctx.live().length, 0, '暂停全停');
        equal(voice.captureTrack(), null, '假上下文没有录制出口:拿不到音轨');
        voice.dispose();
        ok(env.ctx.closed);
      })();
    },
  ],
  [
    'runFilm 端到端:有配音时报告可用;用户开声音后按段内时刻出声;暂停停声;关声音全停',
    async () => {
      const dom = installDomStub();
      try {
        const env = fakeLiveEnv({ 'https://x/a.m4a': fakeAudio(5) });
        const seg = directedSegment('s', 3, [], async (e) => {
          await e.wait(3);
        });
        const withVoice: Segment = { ...seg, voice: { clips: [{ id: 'a', url: 'https://x/a.m4a', start: 0.5, duration: 2, offset: 0 }] } };
        const controller = runFilm(dom.canvas(), [withVoice], { loop: false, audio: { env } });
        equal(controller.getState().audio.available, true);
        equal(controller.getState().audio.enabled, false);
        controller.setAudioEnabled(true);
        equal(controller.getState().audio.enabled, true);
        // 音频时钟与画面帧同步前进(真实浏览器里两者都跟着墙钟走)。
        const step = async (frames: number): Promise<void> => {
          for (let i = 0; i < frames; i++) {
            dom.frame(16);
            env.ctx.currentTime += 0.016;
            await dom.flush();
          }
        };
        await step(60);
        const node = env.ctx.nodes[0];
        ok(node?.started !== null && node !== undefined, '播到 0.5 秒之后应当出声');
        equal(env.ctx.nodes.length, 1, '同步着就不反复重排');
        equal(env.ctx.live().length, 1);
        controller.setPaused(true);
        equal(env.ctx.live().length, 0, '暂停立刻停声(不等下一帧)');
        controller.setPaused(false);
        await step(3);
        equal(env.ctx.live().length, 1, '恢复后接着响');
        controller.setAudioEnabled(false);
        equal(env.ctx.live().length, 0, '关声音全停');
        controller.dispose();
        const silent = runFilm(dom.canvas(), [seg], { loop: false, audio: { env } });
        equal(silent.getState().audio.available, false, '没有配音的片子不显示声音开关');
        silent.dispose();
      } finally {
        dom.restore();
      }
    },
  ],
]);
