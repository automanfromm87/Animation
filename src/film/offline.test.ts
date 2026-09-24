import type { LiveAudioEnv } from '../audio/live';
import { fakeAudio, fakeLiveEnv } from '../audio/testing';
import type { AudioLoader, DecodedAudio } from '../audio/types';
import { Circle } from '../engine';
import type { SceneViewport } from '../engine';
import type { EncoderRequest, VideoEncoderSink } from '../export/encoder';
import type { OfflineEnv } from '../export/offlineEnv';
import { messageChannelYielder } from '../export/offlineEnv';
import { OPUS_IN_MP4_NOTE } from '../export/types';
import { createStubCanvas, flushTasks } from '../testing/domStub';
import { createExportStub } from '../testing/exportStub';
import { CTX_STATE_DEFAULTS, createFakeCtx } from '../testing/fakeCtx';
import type { FakeCtxCall } from '../testing/fakeCtx';
import { equal, ok, quiet, suite } from '../testing/harness';
import type { ExportHandle, Segment, SegmentContext, SegmentHandle } from './film';
import { directedSegment, isFilmError, runFilm } from './film';
import { ManualClock } from './offline';
import { pythagorasFilm } from './program';

/** 假编码端收到的一块音频(拷贝)。 */
interface AudioChunk {
  timestamp: number;
  planes: Float32Array[];
}

/** 假编码端的记录。 */
interface EncoderLog {
  requests: EncoderRequest[];
  timestamps: number[];
  durations: number[];
  /** 每次 addFrame 时导出画布上已有的调用数(按它把调用切成一帧一帧)。 */
  marks: number[];
  finished: number;
  cancelled: number;
  /** 收到的音频块(按收到的顺序)。 */
  audio: AudioChunk[];
  /** 视频帧与音频块交错的顺序:'v' 一帧、'a' 一块。 */
  order: string[];
}

interface FakeEnvOptions {
  /** 编码器编不了请求的容器(工厂返回 null)。 */
  unsupported?: boolean;
  /** 第 n 帧(0 起)编码时抛错。 */
  failAt?: number;
  /** 导出画布记录完整调用(看合成内容);长片用例关掉省内存。 */
  recordOutput?: boolean;
  /** 只收集导出画布上画过的字幕文字。 */
  texts?: Set<string>;
  /** 导出画布的 drawImage 一律抛错(合成失败)。 */
  failComposite?: boolean;
  /** 注入的配音解码(OfflineEnv.audio);不给就是环境解不了音频。 */
  audioLoader?: AudioLoader;
  /** 请求了音频时编码端报告的音频编码;null 表示编不了音频(成片无声)。缺省 'fake-aac'。 */
  audioCodec?: string | null;
}

interface FakeEnv {
  env: OfflineEnv;
  log: EncoderLog;
  /** 导出画布上的调用(recordOutput 时)。 */
  output(): FakeCtxCall[];
  /** 建过的画布,按创建顺序(第 0 张是导出画布,第 1 张是分段的离屏画布)。 */
  canvases: HTMLCanvasElement[];
}

function fakeEnv(o: FakeEnvOptions = {}): FakeEnv {
  const log: EncoderLog = {
    requests: [],
    timestamps: [],
    durations: [],
    marks: [],
    finished: 0,
    cancelled: 0,
    audio: [],
    order: [],
  };
  const canvases: HTMLCanvasElement[] = [];
  let outputCalls: FakeCtxCall[] = [];
  const env: OfflineEnv = {
    createCanvas: () => {
      const canvas = createStubCanvas();
      const first = canvases.length === 0;
      const fake = createFakeCtx({
        record: first && (o.recordOutput ?? true),
        ...(first && (o.texts || o.failComposite)
          ? {
              onCall: (call) => {
                if (call.op === 'fillText' && typeof call.value === 'string') {
                  o.texts?.add(call.value);
                }
                if (o.failComposite && call.op === 'drawImage') {
                  throw new Error('合成炸了');
                }
              },
            }
          : {}),
      });
      if (first) {
        outputCalls = fake.calls;
      }
      (canvas as unknown as { getContext: () => CanvasRenderingContext2D }).getContext = () =>
        fake.ctx;
      canvases.push(canvas);
      return canvas;
    },
    encoder: async (req) => {
      log.requests.push(req);
      if (o.unsupported) {
        return null;
      }
      const audioCodec = req.audio ? (o.audioCodec === undefined ? 'fake-aac' : o.audioCodec) : null;
      const sink: VideoEncoderSink = {
        mimeType: req.mimeType?.startsWith('video/webm') ? 'video/webm' : 'video/mp4',
        codec: 'fake',
        audio: audioCodec ? { codec: audioCodec } : null,
        addFrame: async (timestamp, duration) => {
          if (o.failAt !== undefined && log.timestamps.length === o.failAt) {
            throw new Error('编码器罢工了');
          }
          log.timestamps.push(timestamp);
          log.durations.push(duration);
          log.marks.push(outputCalls.length);
          log.order.push('v');
        },
        addAudio: async (planes, timestamp) => {
          if (!audioCodec) {
            throw new Error('没有音频轨却收到了音频');
          }
          log.audio.push({ timestamp, planes: planes.map((p) => Float32Array.from(p)) });
          log.order.push('a');
        },
        finish: async () => {
          log.finished += 1;
          return new Blob([new Uint8Array(log.timestamps.length)], { type: sink.mimeType });
        },
        cancel: async () => {
          log.cancelled += 1;
        },
      };
      return sink;
    },
    createYielder: () => ({ yieldTask: flushTasks, close: () => undefined }),
    ...(o.audioLoader ? { audio: o.audioLoader } : {}),
  };
  return { env, log, output: () => outputCalls, canvases };
}

/** 假音频文件:秒数、声道、每个采样的值(按文件里的采样序号算);'fail' 表示取 / 解码失败。 */
type FakeFile = { seconds: number; channels?: number; sampleRate?: number; value: (i: number, ch: number) => number } | 'fail';

/** 假解码器:按地址给出合成的音频;记下每个地址被取了几次。delayTasks:解码要多等这么多个宏任务(模拟慢解码)。 */
function fakeLoader(
  files: Record<string, FakeFile>,
  delayTasks = 0,
): AudioLoader & { fetches: Map<string, number>; decoded: () => number } {
  let decodedCount = 0;
  const fetches = new Map<string, number>();
  return {
    fetches,
    decoded: () => decodedCount,
    fetch: async (url) => {
      fetches.set(url, (fetches.get(url) ?? 0) + 1);
      const file = files[url];
      if (file === undefined || file === 'fail') {
        throw new Error(`取不到 ${url}`);
      }
      return new TextEncoder().encode(url).buffer as ArrayBuffer;
    },
    decode: async (bytes) => {
      for (let i = 0; i < delayTasks; i++) {
        await flushTasks();
      }
      const url = new TextDecoder().decode(bytes);
      const file = files[url];
      if (file === undefined || file === 'fail') {
        throw new Error(`解不开 ${url}`);
      }
      const sampleRate = file.sampleRate ?? 48000;
      const channels = file.channels ?? 1;
      const length = Math.round(file.seconds * sampleRate);
      const data = Array.from({ length: channels }, (_, ch) => Float32Array.from({ length }, (_v, i) => file.value(i, ch)));
      const decoded: DecodedAudio = {
        sampleRate,
        length,
        numberOfChannels: channels,
        duration: length / sampleRate,
        getChannelData: (ch) => data[ch] ?? new Float32Array(length),
      };
      decodedCount += 1;
      return decoded;
    },
  };
}

/** 带配音的分段:在 holdSegment 上挂音频片段。 */
function voiced(segment: Segment, clips: Array<{ id: string; url: string; start: number; duration: number; offset?: number }>): Segment {
  return { ...segment, voice: { clips: clips.map((c) => ({ ...c, offset: c.offset ?? 0 })) } };
}

/** 音频块拼成一整条(某个声道)。 */
function joined(chunks: readonly AudioChunk[], ch = 0): Float32Array {
  const total = chunks.reduce((n, c) => n + (c.planes[ch]?.length ?? 0), 0);
  const out = new Float32Array(total);
  let at = 0;
  for (const c of chunks) {
    const plane = c.planes[ch] ?? new Float32Array(0);
    out.set(plane, at);
    at += plane.length;
  }
  return out;
}

/** 跟踪导出句柄的结局。 */
interface Outcome {
  state: 'pending' | 'resolved' | 'rejected';
  code: string;
  type: string;
}

function track(handle: ExportHandle): Outcome {
  const o: Outcome = { state: 'pending', code: '', type: '' };
  handle.done.then(
    (blob) => {
      o.state = 'resolved';
      o.type = blob.type;
    },
    (e: unknown) => {
      o.state = 'rejected';
      o.code = isFilmError(e) ? e.code : 'not-film-error';
    },
  );
  return o;
}

/** 让离线渲染跑到结束(或跑满 limit 轮)。 */
async function settle(outcome: Outcome, limit = 5000): Promise<void> {
  for (let i = 0; i < limit && outcome.state === 'pending'; i++) {
    await flushTasks();
  }
}

/** 一个真实的导演式分段:加个圆,停 seconds 秒;可带字幕。 */
function holdSegment(name: string, seconds: number, subtitle?: string): Segment {
  return directedSegment(
    name,
    seconds,
    subtitle ? [{ start: 0, end: seconds / 2, text: subtitle }] : [],
    async (env) => {
      env.scene.add(new Circle(20));
      await env.wait(seconds);
    },
  );
}

/** 预览画布(无父节点 → 不建 DOM chrome)+ 不推进的时钟:预览停在原地,只看离线实例。 */
function preview(segments: Segment[], env: OfflineEnv, extra: object = {}) {
  const canvas = createStubCanvas();
  canvas.clientWidth = 800;
  canvas.clientHeight = 450;
  const clock = new ManualClock();
  const film = runFilm(canvas, segments, {
    transition: 0,
    loop: false,
    clock,
    offlineEnv: env,
    ...extra,
  });
  return { canvas, clock, film };
}

/** 导出画布上的一次调用,带上当时的 fillStyle / font。 */
interface PaintOp extends FakeCtxCall {
  fill: unknown;
  font: unknown;
}

/**
 * 把导出画布的调用按帧切开(marks 是每次 addFrame 时的调用数)。
 * 假 ctx 把属性赋值('=fillStyle')和方法调用分开记:按顺序回放一遍,每个调用才知道当时的填充色与字体。
 */
function paintFrames(calls: readonly FakeCtxCall[], marks: readonly number[]): PaintOp[][] {
  let fill: unknown = CTX_STATE_DEFAULTS['fillStyle'];
  let font: unknown = CTX_STATE_DEFAULTS['font'];
  const ops = calls.map((c): PaintOp => {
    if (c.op === '=fillStyle') {
      fill = c.value;
    } else if (c.op === '=font') {
      font = c.value;
    }
    return { ...c, fill, font };
  });
  return marks.map((m, i) => ops.slice(i === 0 ? 0 : (marks[i - 1] ?? 0), m));
}

/** 预览 800×450 -> 成片 1920×1080(scale 2.4):进度条贴底,轨道 / 填充高 round(3 × 2.4) = 7,顶边 y = 1073。 */
const BAR_Y = 1073;
const BAR_H = 7;

/** 这一帧里进度条的填充矩形(默认墨色 '#1a1a1a'、x 0、贴底、高 7)。 */
function fillRects(frame: readonly PaintOp[]): PaintOp[] {
  return frame.filter(
    (o) =>
      o.op === 'fillRect' &&
      o.fill === '#1a1a1a' &&
      o.args[0] === 0 &&
      o.args[1] === BAR_Y &&
      o.args[3] === BAR_H,
  );
}

/** 整帧的 fillRect 数:底色一次,盖着白闪时再来一次。 */
function fullFrameRects(frame: readonly FakeCtxCall[]): number {
  return frame.filter((c) => c.op === 'fillRect' && c.args[2] === 1920 && c.args[3] === 1080).length;
}

/** 两段各 1 秒,第一段是章节卡「甲」(进度条上画成「一 · 甲」)。 */
function chapterFilm(): Segment[] {
  return [{ ...holdSegment('A', 1), marker: 'chapter', chapter: '甲' }, holdSegment('B', 1)];
}

/**
 * 假的 Web Audio 播放环境(实时录制录得进配音):上下文能接出一条录制音轨;
 * contexts 记 createContext 被调了几次。urls 里的地址都能取到、解开。
 */
function liveAudio(urls: readonly string[]): {
  env: ReturnType<typeof fakeLiveEnv>;
  track: MediaStreamTrack;
} {
  const env = fakeLiveEnv(Object.fromEntries(urls.map((u) => [u, fakeAudio(1)])));
  const audioTrack = { kind: 'audio', stop: () => undefined } as unknown as MediaStreamTrack;
  const destination = { stream: { getAudioTracks: () => [audioTrack] } as unknown as MediaStream };
  Object.assign(env.ctx, { createMediaStreamDestination: () => destination });
  return { env, track: audioTrack };
}

/** 建不出音频上下文的播放环境(构造 AudioContext 抛错的浏览器):有 env,却录不进配音。 */
function deadAudioEnv(): LiveAudioEnv & { contexts: number } {
  const env = {
    contexts: 0,
    createContext: () => {
      env.contexts += 1;
      return null;
    },
    fetch: () => new Promise<ArrayBuffer>(() => undefined),
    hidden: () => false,
    onVisibilityChange: () => () => undefined,
  };
  return env;
}

/** 推着预览时钟一帧帧往前走(实时录制按墙钟录,靠它录完)。 */
async function runPreview(clock: ManualClock, outcome: Outcome, limit = 3000): Promise<void> {
  for (let i = 0; i < limit && outcome.state === 'pending'; i++) {
    clock.advance(16);
    await flushTasks();
  }
}

export default suite('离线导出', [
  [
    '按帧号精确给时间戳,帧数 = 时长 × 帧率(±1),播完交出编码器的成片',
    async () => {
      const fe = fakeEnv({ recordOutput: false });
      const { film } = preview([holdSegment('A', 1), holdSegment('B', 0.5)], fe.env);
      const progress: number[] = [];
      let reportedTotal = 0;
      const handle = film.exportVideo({
        fps: 30,
        onProgress: (done, total) => {
          progress.push(done);
          reportedTotal = total;
        },
      });
      equal(handle.mode, 'offline');
      const outcome = track(handle);
      await settle(outcome);
      equal(outcome.state, 'resolved', `导出没有完成:${outcome.code}`);
      equal(outcome.type, 'video/mp4');
      const n = fe.log.timestamps.length;
      ok(Math.abs(n - 1.5 * 30) <= 1, `帧数 ${n},应约为 45`);
      fe.log.timestamps.forEach((t, i) => {
        equal(t, i / 30, `第 ${i} 帧的时间戳不是 i / fps`);
      });
      ok(fe.log.durations.every((d) => d === 1 / 30));
      equal(fe.log.finished, 1);
      equal(fe.log.cancelled, 0);
      // 进度按影片时间报:每帧一次、单调不减、收尾正好是总时长。
      equal(progress.length, n);
      equal(reportedTotal, film.getState().total);
      ok(
        progress.every((p, i) => p >= 0 && p <= reportedTotal && (i === 0 || p >= (progress[i - 1] ?? 0))),
        `进度不单调或越界:${progress.join(',')}`,
      );
      equal(progress[progress.length - 1], reportedTotal, '播完时进度应到 100%');
      equal(film.getState().exporting, false, '导出结束后应释放导出位');
      film.dispose();
    },
  ],
  [
    '帧率可调(时间戳仍是帧号 / 帧率);非法帧率回落到 30',
    async () => {
      const fe = fakeEnv({ recordOutput: false });
      const { film } = preview([holdSegment('A', 1)], fe.env);
      const outcome = track(film.exportVideo({ fps: 24 }));
      await settle(outcome);
      equal(outcome.state, 'resolved');
      equal(fe.log.requests[0]?.fps, 24);
      const n = fe.log.timestamps.length;
      ok(Math.abs(n - 24) <= 1, `帧数 ${n},应约为 24`);
      fe.log.timestamps.forEach((t, i) => {
        equal(t, i / 24, `第 ${i} 帧的时间戳不是 i / fps`);
      });
      film.dispose();
      for (const fps of [Number.NaN, 0, -5]) {
        const bad = fakeEnv({ recordOutput: false });
        const second = preview([holdSegment('A', 0.1)], bad.env);
        const o = track(second.film.exportVideo({ fps }));
        await settle(o);
        equal(o.state, 'resolved');
        equal(bad.log.requests[0]?.fps, 30, `fps=${fps} 应回落到 30`);
        second.film.dispose();
      }
    },
  ],
  [
    '成片尺寸按长边上限(矢量放大不糊),分段拿到固定视口、导出时钟与离屏画布,按顺序渲染',
    async () => {
      const fe = fakeEnv({ recordOutput: false });
      const seen: Array<{ name: string; viewport?: SceneViewport; clock: boolean; canvas: HTMLCanvasElement }> = [];
      const spy = (seg: Segment): Segment => ({
        ...seg,
        play(canvas: HTMLCanvasElement, context?: SegmentContext): SegmentHandle {
          seen.push({
            name: seg.name,
            ...(context?.viewport ? { viewport: context.viewport } : {}),
            clock: context?.clock !== undefined,
            canvas,
          });
          return seg.play(canvas, context);
        },
      });
      const { film, canvas } = preview([spy(holdSegment('A', 0.3)), spy(holdSegment('B', 0.3))], fe.env);
      seen.length = 0;
      const outcome = track(film.exportVideo());
      await settle(outcome);
      equal(outcome.state, 'resolved');
      const req = fe.log.requests[0];
      equal(req?.width, 1920);
      equal(req?.height, 1080);
      equal(req?.fps, 30);
      equal(seen.map((s) => s.name).join(','), 'A,B', '分段没有按顺序渲染');
      for (const s of seen) {
        equal(s.viewport?.width, 800);
        equal(s.viewport?.height, 450);
        equal(s.viewport?.pixelRatio, 1920 / 800);
        ok(s.clock, '分段没有拿到导出时钟');
        ok(s.canvas !== canvas && s.canvas === fe.canvases[1], '分段应画在离屏画布上,而不是预览画布');
      }
      film.dispose();
    },
  ],
  [
    '每帧都合成了主画面、转场白闪与字幕;开场是白场',
    async () => {
      const fe = fakeEnv();
      const { film } = preview([holdSegment('A', 1, '甲')], fe.env, { transition: 0.2 });
      const outcome = track(film.exportVideo());
      await settle(outcome);
      equal(outcome.state, 'resolved');
      const calls = fe.output();
      const marks = fe.log.marks;
      const frameOf = (i: number): FakeCtxCall[] => calls.slice(i === 0 ? 0 : (marks[i - 1] ?? 0), marks[i]);
      for (let i = 0; i < marks.length; i++) {
        ok(frameOf(i).some((c) => c.op === 'drawImage'), `第 ${i} 帧没有合成主画面`);
      }
      // 第 0 帧:白闪盖满(globalAlpha = 1 画满转场色)。
      const first = frameOf(0);
      ok(
        first.some((c) => c.op === '=globalAlpha' && c.value === 1) &&
          first.filter((c) => c.op === 'fillRect').length >= 2,
        '开场应是白场',
      );
      // 整帧的 fillRect:底色一次,盖着白闪时再来一次。
      const fullRects = (frame: FakeCtxCall[]): number =>
        frame.filter((c) => c.op === 'fillRect' && c.args[2] === 1920 && c.args[3] === 1080).length;
      equal(fullRects(first), 2);
      // 转场结束后、字幕区间内的某一帧:画了字幕、没有白闪。
      const mid = frameOf(Math.round(0.35 * 30));
      ok(mid.some((c) => c.op === 'fillText' && c.value === '甲'), '字幕没有合成进帧');
      equal(fullRects(mid), 1, '转场结束后还盖着白闪');
      // 字幕区间(前 0.5 秒)之后不再有字幕。
      const late = frameOf(Math.round(0.9 * 30));
      ok(!late.some((c) => c.op === 'fillText'), '字幕区间之后还在画字幕');
      // 片尾淡出:最后一帧又盖上了白闪。
      equal(fullRects(frameOf(marks.length - 1)), 2, '片尾没有淡出到白场');
      film.dispose();
    },
  ],
  [
    '进度条合成进成片:填充跟着虚拟时钟的影片位置走(穿过转场也不回退),与 onProgress 同值,播完填满;章名按缩放后的字号画在刻度右侧',
    async () => {
      const fe = fakeEnv();
      const { film } = preview(chapterFilm(), fe.env, { transition: 0.2 });
      const progress: number[] = [];
      let total = 0;
      const outcome = track(
        film.exportVideo({
          onProgress: (done, all) => {
            progress.push(done);
            total = all;
          },
        }),
      );
      await settle(outcome);
      equal(outcome.state, 'resolved', `导出没有完成:${outcome.code}`);
      equal(fe.log.requests[0]?.width, 1920);
      equal(fe.log.requests[0]?.height, 1080);
      equal(total, 2);
      const frames = paintFrames(fe.output(), fe.log.marks);
      const n = frames.length;
      equal(progress.length, n, '每帧应报一次进度');
      const widths = frames.map((frame, i) => {
        const rects = fillRects(frame);
        ok(rects.length <= 1, `第 ${i} 帧画了 ${rects.length} 条填充`);
        return rects[0]?.args[2] ?? 0;
      });
      // 片中确实经过了转场(A 淡出、B 淡入时白闪盖着):单调性要在这些帧上也成立。
      const veiled = frames.filter((f, i) => i > 5 && i < n - 10 && fullFrameRects(f) === 2).length;
      ok(veiled > 0, '片中没有经过转场,单调性没测到转场');
      widths.forEach((w, i) => {
        ok(i === 0 || w >= (widths[i - 1] ?? 0), `第 ${i} 帧填充回退了:${widths[i - 1]} -> ${w}`);
        const expected = ((progress[i] ?? 0) / total) * 1920;
        ok(Math.abs(w - expected) <= 1, `第 ${i} 帧填充宽 ${w},按 onProgress 应约为 ${expected.toFixed(1)}`);
      });
      equal(widths[0], 0, '开场进度为 0,不该画填充');
      equal(widths[n - 1], 1920, '最后一帧填充应铺满整条');
      // A 段中间(0.5 秒)≈ 0.5 / 2 × 1920 = 480。
      const mid = widths[15] ?? 0;
      ok(Math.abs(mid - 480) <= 2, `A 段中间的填充宽 ${mid},应约为 480`);
      // 轨道、刻度(章节卡墨色大刻度 / 普通淡刻度)、章名:每帧都画。
      const tickW = Math.round(2 * 2.4);
      frames.forEach((frame, i) => {
        const rects = frame.filter((o) => o.op === 'fillRect');
        ok(
          rects.some((o) => o.fill === 'rgba(0,0,0,0.12)' && o.args.join(',') === `0,${BAR_Y},1920,${BAR_H}`),
          `第 ${i} 帧没有轨道`,
        );
        const chapterH = Math.round(14 * 2.4);
        ok(
          rects.some((o) => o.fill === '#1a1a1a' && o.args.join(',') === `0,${1080 - chapterH},${tickW},${chapterH}`),
          `第 ${i} 帧没有章节刻度`,
        );
        const tickH = Math.round(8 * 2.4);
        ok(
          rects.some((o) => o.fill === 'rgba(0,0,0,0.35)' && o.args.join(',') === `960,${1080 - tickH},${tickW},${tickH}`),
          `第 ${i} 帧没有 B 段的刻度`,
        );
        const labels = frame.filter((o) => o.op === 'fillText');
        equal(labels.length, 1, `第 ${i} 帧的章名数不对`);
        const label = labels[0];
        equal(label?.value, '一 · 甲');
        // 章名字号 progressLabelPx(800) = 10 -> ×2.4;没有 DOM 父节点时字体是缺省的 sans-serif。
        equal(label?.font, '24px sans-serif', `第 ${i} 帧章名字体不对`);
        ok(Math.abs((label?.args[0] ?? 0) - 14.4) < 1e-6, `章名应在刻度右侧 6 × 2.4 = 14.4 处,实际 ${label?.args[0]}`);
        ok(Math.abs((label?.args[1] ?? 0) - (1080 - (20 + 5) * 2.4)) < 1e-6, `章名行中线位置不对:${label?.args[1]}`);
      });
      film.dispose();
    },
  ],
  [
    'exportVideo({progress:false}) 与 FilmOptions.progress:false:每帧都不画进度条(后者 progress:true 也强加不上);整帧矩形与带进度条时逐帧一致',
    async () => {
      const run = async (filmExtra: object, opts: object): Promise<PaintOp[][]> => {
        const fe = fakeEnv();
        const { film } = preview(chapterFilm(), fe.env, { transition: 0.2, ...filmExtra });
        const outcome = track(film.exportVideo(opts));
        await settle(outcome);
        equal(outcome.state, 'resolved', `导出没有完成:${outcome.code}`);
        film.dispose();
        return paintFrames(fe.output(), fe.log.marks);
      };
      const withBar = await run({}, {});
      ok(withBar.every((f) => f.some((o) => o.op === 'fillText')), '对照组应当每帧都有进度条');
      const cases: Array<[string, PaintOp[][]]> = [
        ['exportVideo({progress:false})', await run({}, { progress: false })],
        ['FilmOptions.progress:false', await run({ progress: false }, {})],
        ['FilmOptions.progress:false + exportVideo({progress:true})', await run({ progress: false }, { progress: true })],
      ];
      for (const [name, frames] of cases) {
        equal(frames.length, withBar.length, `${name}:帧数与对照组不同`);
        frames.forEach((frame, i) => {
          const stray = frame.filter(
            (o) => (o.op === 'fillRect' && !(o.args[2] === 1920 && o.args[3] === 1080)) || o.op === 'fillText' || o.op === 'clip',
          );
          equal(stray.length, 0, `${name}:第 ${i} 帧还画了进度条(${stray.map((o) => `${o.op}(${o.args.join(',')})`).join(' ')})`);
          equal(fullFrameRects(frame), fullFrameRects(withBar[i] ?? []), `${name}:第 ${i} 帧的整帧矩形数变了`);
        });
      }
    },
  ],
  [
    '离线导出不锁预览:导出期间预览照常能跳转;状态报告在导出,但不是实时录制的 exporting 模式',
    async () => {
      const fe = fakeEnv({ recordOutput: false });
      const { film } = preview([holdSegment('A', 2), holdSegment('B', 2)], fe.env);
      film.setPaused(true);
      const outcome = track(film.exportVideo());
      await flushTasks();
      equal(film.getState().exporting, true);
      ok(film.getState().mode !== 'exporting', '离线导出不该把预览锁进导出模式');
      equal(film.getState().paused, true, '离线导出不该替预览恢复播放');
      film.seekTo(1);
      await flushTasks();
      equal(film.getState().index, 1, '导出期间预览的跳转被锁了');
      film.setPaused(false);
      equal(film.getState().paused, false, '导出期间预览的暂停/播放被锁了');
      await settle(outcome);
      equal(outcome.state, 'resolved');
      film.dispose();
    },
  ],
  [
    'cancel 立即停止:拒绝 cancelled、释放编码器、不再出帧',
    async () => {
      const fe = fakeEnv({ recordOutput: false });
      const { film } = preview([holdSegment('A', 30)], fe.env);
      const handle = film.exportVideo();
      const outcome = track(handle);
      for (let i = 0; i < 20; i++) {
        await flushTasks();
      }
      ok(fe.log.timestamps.length > 0, '还没开始出帧');
      handle.cancel();
      const atCancel = fe.log.timestamps.length;
      await settle(outcome);
      equal(outcome.code, 'cancelled');
      equal(fe.log.cancelled, 1);
      equal(fe.log.finished, 0);
      equal(fe.log.timestamps.length, atCancel, '取消之后还在出帧');
      for (let i = 0; i < 10; i++) {
        await flushTasks();
      }
      equal(fe.log.timestamps.length, atCancel, '取消之后还在出帧');
      equal(film.getState().exporting, false);
      film.dispose();

      // 编码器还在探测时就取消:探测完立即释放,不起离屏分段、不出帧。
      const fe2 = fakeEnv({ recordOutput: false });
      const base = holdSegment('A', 1);
      let offscreenPlays = 0;
      const counted: Segment = {
        ...base,
        play: (canvas, context) => {
          if (fe2.canvases.includes(canvas)) {
            offscreenPlays += 1;
          }
          return base.play(canvas, context);
        },
      };
      const second = preview([counted], fe2.env);
      const early = second.film.exportVideo();
      const o2 = track(early);
      early.cancel();
      await settle(o2);
      equal(o2.code, 'cancelled');
      equal(fe2.log.requests.length, 1);
      equal(fe2.log.cancelled, 1, '探测完的编码器没有释放');
      equal(offscreenPlays, 0, '取消之后还起了离屏分段');
      equal(fe2.log.timestamps.length, 0);
      second.film.dispose();
    },
  ],
  [
    '所有分段都起不来:以 segments-failed 中止并释放编码器,出错的分段报给 onError',
    async () => {
      const fe = fakeEnv({ recordOutput: false });
      const base = holdSegment('坏段', 1);
      const broken: Segment = {
        ...base,
        play: (canvas, context) => {
          if (fe.canvases.includes(canvas)) {
            throw new Error('起不来');
          }
          return base.play(canvas, context);
        },
      };
      const errors: string[] = [];
      const { film } = preview([broken], fe.env, {
        onError: (_e: unknown, info: { segment: string; phase: string }) => {
          errors.push(`${info.segment}:${info.phase}`);
        },
      });
      const outcome = track(film.exportVideo());
      await settle(outcome);
      equal(outcome.code, 'segments-failed');
      equal(fe.log.cancelled, 1);
      equal(fe.log.finished, 0);
      ok(errors.includes('坏段:start'), `分段错误没有报给 onError:${errors.join(',')}`);
      film.dispose();
    },
  ],
  [
    '合成连续失败以 composite 中止并释放编码器(偶发失败沿用上一帧)',
    async () => {
      const fe = fakeEnv({ recordOutput: false, failComposite: true });
      const { film } = preview([holdSegment('A', 5)], fe.env);
      const outcome = track(film.exportVideo());
      await quiet(async () => {
        await settle(outcome);
      });
      equal(outcome.code, 'composite');
      equal(fe.log.cancelled, 1);
      equal(fe.log.finished, 0);
      film.dispose();
    },
  ],
  [
    '编码失败以 encoder 拒绝并释放编码器;分段时间线停不下来时按上限以 overrun 中止',
    async () => {
      const fe = fakeEnv({ recordOutput: false, failAt: 5 });
      const { film } = preview([holdSegment('A', 1)], fe.env);
      const outcome = track(film.exportVideo());
      await settle(outcome);
      equal(outcome.code, 'encoder');
      equal(fe.log.cancelled, 1);
      film.dispose();
      const stuck: Segment = {
        name: '卡住',
        duration: 0.1,
        play: (): SegmentHandle => ({
          done: new Promise(() => undefined),
          dispose: () => undefined,
          resize: () => undefined,
          getElapsed: () => 0,
          setPaused: () => undefined,
        }),
      };
      const fe2 = fakeEnv({ recordOutput: false });
      const second = preview([stuck], fe2.env);
      const o2 = track(second.film.exportVideo());
      await settle(o2, 20000);
      equal(o2.code, 'overrun');
      equal(fe2.log.cancelled, 1);
      second.film.dispose();
    },
  ],
  [
    '模式:auto 编码器编不了所选容器时退回实时录制;显式 offline 报 unsupported-mime;realtime 强制实时录制',
    async () => {
      const ex = createExportStub();
      const fe = fakeEnv({ unsupported: true, recordOutput: false });
      const { film } = preview([holdSegment('A', 1)], fe.env, { exportEnv: ex.env });
      const handle = film.exportVideo({ mimeType: 'video/webm' });
      const outcome = track(handle);
      await flushTasks();
      await flushTasks();
      equal(fe.log.requests[0]?.mimeType, 'video/webm');
      equal(handle.mode, 'realtime', 'auto 模式应退回实时录制');
      equal(film.getState().mode, 'exporting');
      handle.cancel();
      await settle(outcome);
      equal(outcome.code, 'cancelled');
      film.dispose();

      const strict = preview([holdSegment('A', 1)], fakeEnv({ unsupported: true }).env);
      const o2 = track(strict.film.exportVideo({ mode: 'offline', mimeType: 'video/webm' }));
      await settle(o2);
      equal(o2.code, 'unsupported-mime');
      strict.film.dispose();

      const fe3 = fakeEnv({ recordOutput: false });
      const rt = preview([holdSegment('A', 1)], fe3.env, { exportEnv: createExportStub().env });
      const h3 = rt.film.exportVideo({ mode: 'realtime' });
      equal(h3.mode, 'realtime');
      equal(fe3.log.requests.length, 0, 'realtime 模式不该探测离线编码器');
      h3.cancel();
      rt.film.dispose();
    },
  ],
  [
    '没有离线能力时:auto 走实时录制,显式 offline 报 unsupported',
    async () => {
      const canvas = createStubCanvas();
      const ex = createExportStub();
      const film = runFilm(canvas, [holdSegment('A', 1)], {
        transition: 0,
        loop: false,
        clock: new ManualClock(),
        exportEnv: ex.env,
      });
      const o = track(film.exportVideo({ mode: 'offline' }));
      await settle(o);
      equal(o.code, 'unsupported');
      const auto = film.exportVideo();
      equal(auto.mode, 'realtime');
      auto.cancel();
      film.dispose();
    },
  ],
  [
    '同一时间只允许一个导出;销毁播放器以 disposed 中止离线导出',
    async () => {
      const fe = fakeEnv({ recordOutput: false });
      const { film } = preview([holdSegment('A', 30)], fe.env);
      const first = track(film.exportVideo());
      const second = track(film.exportVideo());
      await flushTasks();
      equal(second.code, 'busy');
      film.dispose();
      await settle(first);
      equal(first.code, 'disposed');
      equal(fe.log.cancelled, 1);
    },
  ],
  [
    '真实短片(勾股定理)离线导出:分段在固定视口与导出时钟下完整播完,帧数与时间线一致,字幕合成进成片',
    async () => {
      const texts = new Set<string>();
      const fe = fakeEnv({ recordOutput: false, texts });
      const canvas = createStubCanvas();
      const film = runFilm(canvas, pythagorasFilm, {
        loop: false,
        clock: new ManualClock(),
        offlineEnv: fe.env,
      });
      const outcome = track(film.exportVideo());
      await quiet(async () => {
        await settle(outcome, 50000);
      });
      equal(outcome.state, 'resolved', `导出没有完成:${outcome.code}`);
      // 每段:max(时长, 淡入) + 淡出;三段加起来 ≈ 32.3 秒。
      const wall = pythagorasFilm.reduce((s, seg) => s + seg.duration + 0.6, 0);
      const n = fe.log.timestamps.length;
      ok(Math.abs(n / 30 - wall) < 0.5, `成片 ${(n / 30).toFixed(2)} 秒,时间线约 ${wall.toFixed(2)} 秒`);
      ok(texts.has('今天,我们证明勾股定理'), '片头字幕没有合成进成片');
      ok(texts.has('直角边平方之和,等于斜边平方'), '正片字幕没有合成进成片');
      film.dispose();
    },
  ],
  [
    '配音:音轨一秒一块、首尾相接、正好铺满视频时长,跟着视频帧往前推(不是最后一次性写)',
    async () => {
      const loader = fakeLoader({ 'a.wav': { seconds: 0.5, value: () => 0.25 } });
      const fe = fakeEnv({ recordOutput: false, audioLoader: loader });
      const a = voiced(holdSegment('A', 1.2), [{ id: 'a', url: 'a.wav', start: 0.2, duration: 1 }]);
      const { film } = preview([a, holdSegment('B', 1)], fe.env);
      const outcome = track(film.exportVideo({ fps: 30 }));
      await settle(outcome);
      equal(outcome.state, 'resolved', `导出没有完成:${outcome.code}`);
      equal(fe.log.requests[0]?.audio?.sampleRate, 48000);
      equal(fe.log.requests[0]?.audio?.numberOfChannels, 2);
      const frames = fe.log.timestamps.length;
      const total = Math.round((frames / 30) * 48000);
      const chunks = fe.log.audio;
      ok(chunks.length >= 3, `应有至少 3 块音频,实际 ${chunks.length}`);
      let at = 0;
      chunks.forEach((c, i) => {
        equal(c.timestamp, at / 48000, `第 ${i} 块的时间戳不连续`);
        equal(c.planes.length, 2, '应是两个声道');
        const n = c.planes[0]?.length ?? 0;
        equal(c.planes[1]?.length, n, '两个声道长度应相同');
        ok(i === chunks.length - 1 ? n > 0 && n <= 48000 : n === 48000, `第 ${i} 块长度 ${n}`);
        at += n;
      });
      equal(at, total, '音轨总长应正好等于视频时长(帧数 / 帧率)');
      // 第 30 帧(视频走到 1 秒)之后才写第一块;最后一帧之前就已经写过音频。
      equal(fe.log.order.indexOf('a'), 30, '第一块音频应在视频走满 1 秒时写入');
      ok(fe.log.order.lastIndexOf('v') > fe.log.order.indexOf('a'), '音频应跟着视频帧往前推,而不是最后一次性写');
      const left = joined(chunks, 0);
      ok(left.some((v) => Math.abs(v - 0.25) < 1e-9), '配音没有混进音轨');
      film.dispose();
    },
  ],
  [
    '配音落在分段实际起播的时刻(含转场,不是声明的起点);偏移与截断都对;单声道复制到两个声道',
    async () => {
      const loader = fakeLoader({ 'ramp.wav': { seconds: 1, value: (i) => (i / 48000) * 0.5 } });
      const fe = fakeEnv({ recordOutput: false, audioLoader: loader });
      const b = voiced(holdSegment('B', 1), [{ id: 'l1', url: 'ramp.wav', start: 0.1, duration: 0.3, offset: 0.25 }]);
      let bStart = Number.NaN;
      const spyB: Segment = {
        ...b,
        play(canvas: HTMLCanvasElement, context?: SegmentContext): SegmentHandle {
          // 导出实例的虚拟时钟从 1000ms 起步:挂载时刻就是 B 在成片里的起点。
          if (context?.viewport && context.clock) {
            bStart = (context.clock.now() - 1000) / 1000;
          }
          return b.play(canvas, context);
        },
      };
      const { film } = preview([holdSegment('A', 0.5), spyB], fe.env, { transition: 0.2 });
      const outcome = track(film.exportVideo());
      await settle(outcome);
      equal(outcome.state, 'resolved', `导出没有完成:${outcome.code}`);
      ok(bStart > 0.6, `B 应在 A 播完、淡出之后才起播(声明起点 0.5),实际 ${bStart}`);
      const left = joined(fe.log.audio, 0);
      const right = joined(fe.log.audio, 1);
      const first = Math.round((bStart + 0.1) * 48000);
      const end = Math.round((bStart + 0.4) * 48000);
      ok(left.subarray(0, first).every((v) => v === 0), '片段开始之前应当是静音');
      ok(Math.abs((left[first] ?? 0) - 0.125) < 1e-6, `片段起点应读到文件第 0.25 秒(0.125),实际 ${left[first]}`);
      const lastIndex = 0.25 * 48000 + (end - 1 - first);
      ok(
        Math.abs((left[end - 1] ?? 0) - (lastIndex / 48000) * 0.5) < 1e-6,
        `片段最后一个采样读错了位置:${left[end - 1]}`,
      );
      ok(left.subarray(end).every((v) => v === 0), '片段应在 0.3 秒处截断');
      ok(left.every((v, i) => v === right[i]), '单声道配音应复制到两个声道');
      film.dispose();
    },
  ],
  [
    'audio:false 不要音频轨;片子里没有配音也不要;环境解不了码时提示一次、照常出片',
    async () => {
      const loader = fakeLoader({ 'a.wav': { seconds: 0.5, value: () => 0.3 } });
      const clip = [{ id: 'a', url: 'a.wav', start: 0, duration: 0.5 }];
      const off = fakeEnv({ recordOutput: false, audioLoader: loader });
      const first = preview([voiced(holdSegment('A', 0.5), clip)], off.env);
      const o1 = track(first.film.exportVideo({ audio: false }));
      await settle(o1);
      equal(o1.state, 'resolved');
      equal(off.log.requests[0]?.audio, undefined, 'audio:false 不该要音频轨');
      equal(off.log.audio.length, 0);
      equal(loader.fetches.size, 0, 'audio:false 不该去取音频');
      first.film.dispose();

      const silent = fakeEnv({ recordOutput: false, audioLoader: loader });
      const second = preview([holdSegment('A', 0.5)], silent.env);
      const o2 = track(second.film.exportVideo());
      await settle(o2);
      equal(o2.state, 'resolved');
      equal(silent.log.requests[0]?.audio, undefined, '没有配音的片子不该要音频轨');
      second.film.dispose();

      const warnings: unknown[] = [];
      const { warn } = console;
      console.warn = (...args: unknown[]) => {
        warnings.push(args);
      };
      try {
        const noLoader = fakeEnv({ recordOutput: false });
        const third = preview([voiced(holdSegment('A', 0.5), clip)], noLoader.env);
        const o3 = track(third.film.exportVideo());
        await settle(o3);
        equal(o3.state, 'resolved', '解不了码也要照常出片');
        equal(noLoader.log.requests[0]?.audio, undefined);
        third.film.dispose();
      } finally {
        console.warn = warn;
      }
      equal(warnings.length, 1, `应当提示一次成片没有配音,实际 ${warnings.length} 次`);
    },
  ],
  [
    '编码端编不了音频:照常出片、不写音频、提示一次;某个文件解码失败:那一段是静音,别的照常',
    async () => {
      const warnings: unknown[] = [];
      const { warn } = console;
      console.warn = (...args: unknown[]) => {
        warnings.push(args);
      };
      try {
        const loader = fakeLoader({ 'a.wav': { seconds: 0.5, value: () => 0.3 } });
        const fe = fakeEnv({ recordOutput: false, audioLoader: loader, audioCodec: null });
        const { film } = preview([voiced(holdSegment('A', 0.5), [{ id: 'a', url: 'a.wav', start: 0, duration: 0.5 }])], fe.env);
        const outcome = track(film.exportVideo());
        await settle(outcome);
        equal(outcome.state, 'resolved', `编码端编不了音频也要照常出片:${outcome.code}`);
        ok(fe.log.requests[0]?.audio !== undefined, '应当向编码端要过音频轨');
        equal(fe.log.audio.length, 0, '没有音频轨就不该写音频');
        equal(warnings.length, 1, `应当提示一次成片没有配音,实际 ${warnings.length} 次`);
        film.dispose();

        warnings.length = 0;
        const mixed = fakeLoader({ 'bad.wav': 'fail', 'good.wav': { seconds: 0.4, value: () => 0.5 } });
        const fe2 = fakeEnv({ recordOutput: false, audioLoader: mixed });
        const second = preview(
          [
            voiced(holdSegment('A', 1), [
              { id: 'bad', url: 'bad.wav', start: 0, duration: 0.4 },
              { id: 'good', url: 'good.wav', start: 0.5, duration: 0.4 },
            ]),
          ],
          fe2.env,
        );
        const o2 = track(second.film.exportVideo());
        await settle(o2);
        equal(o2.state, 'resolved', `解码失败不该让导出失败:${o2.code}`);
        const left = joined(fe2.log.audio, 0);
        ok(left.subarray(0, Math.round(0.4 * 48000)).every((v) => v === 0), '解不开的那一段应是静音');
        ok(Math.abs((left[Math.round(0.6 * 48000)] ?? 0) - 0.5) < 1e-9, '能解开的那一段照常混进去');
        ok(warnings.length >= 1, '解码失败应当提示');
        second.film.dispose();
      } finally {
        console.warn = warn;
      }
    },
  ],
  [
    '慢解码:写到那一块之前先等与它重叠的片段解完,不会漏掉声音',
    async () => {
      // 解码要等 200 个宏任务,远长于写第一块之前那 30 帧。
      const loader = fakeLoader({ 'slow.wav': { seconds: 0.5, value: () => 0.4 } }, 200);
      const fe = fakeEnv({ recordOutput: false, audioLoader: loader });
      const { film } = preview([voiced(holdSegment('A', 1.5), [{ id: 's', url: 'slow.wav', start: 0.1, duration: 0.5 }])], fe.env);
      const outcome = track(film.exportVideo());
      await settle(outcome, 20000);
      equal(outcome.state, 'resolved', `导出没有完成:${outcome.code}`);
      equal(loader.decoded(), 1);
      const left = joined(fe.log.audio, 0);
      // Float32 存 0.4 是 0.40000000596…,容差按单精度给。
      ok(Math.abs((left[Math.round(0.3 * 48000)] ?? 0) - 0.4) < 1e-6, '慢解码的片段被漏掉了');
      film.dispose();
    },
  ],
  [
    '分段一起播就开始取自己的音频,并顺手预加载下一段(解码与渲染并行,写到那一块时不用干等)',
    async () => {
      const loader = fakeLoader({
        'first.wav': { seconds: 0.5, value: () => 0.2 },
        'next.wav': { seconds: 0.5, value: () => 0.3 },
      });
      const fe = fakeEnv({ recordOutput: false, audioLoader: loader });
      const a = voiced(holdSegment('A', 1.5), [{ id: 'f', url: 'first.wav', start: 0.1, duration: 0.5 }]);
      const b = voiced(holdSegment('B', 0.5), [{ id: 'n', url: 'next.wav', start: 0, duration: 0.5 }]);
      const { film } = preview([a, b], fe.env);
      const outcome = track(film.exportVideo());
      for (let i = 0; i < 5; i++) {
        await flushTasks();
      }
      equal(fe.log.audio.length, 0, '这时还没写到任何一块音频');
      equal(loader.fetches.get('first.wav'), 1, '分段起播时就该开始取它的音频');
      equal(loader.fetches.get('next.wav'), 1, '应当顺手预加载下一段的音频');
      await settle(outcome);
      equal(outcome.state, 'resolved', `导出没有完成:${outcome.code}`);
      equal(loader.fetches.get('next.wav'), 1, '预加载过的不该再取一次');
      film.dispose();
    },
  ],
  [
    '同一个文件被几段用到只取一次;重叠的配音叠加后收在 ±1 之内',
    async () => {
      const loader = fakeLoader({
        'x.wav': { seconds: 0.5, value: () => 0.7 },
        'y.wav': { seconds: 0.5, value: () => 0.6 },
      });
      const fe = fakeEnv({ recordOutput: false, audioLoader: loader });
      let cStart = Number.NaN;
      const c = voiced(holdSegment('C', 0.5), [{ id: 'x2', url: 'x.wav', start: 0, duration: 0.5 }]);
      const spyC: Segment = {
        ...c,
        play(canvas: HTMLCanvasElement, context?: SegmentContext): SegmentHandle {
          if (context?.viewport && context.clock) {
            cStart = (context.clock.now() - 1000) / 1000;
          }
          return c.play(canvas, context);
        },
      };
      const a = voiced(holdSegment('A', 0.6), [
        { id: 'x', url: 'x.wav', start: 0, duration: 0.5 },
        { id: 'y', url: 'y.wav', start: 0, duration: 0.5 },
      ]);
      const { film } = preview([a, holdSegment('B', 0.5), spyC], fe.env);
      const outcome = track(film.exportVideo());
      await settle(outcome);
      equal(outcome.state, 'resolved', `导出没有完成:${outcome.code}`);
      equal(loader.fetches.get('x.wav'), 1, '后面还要用的文件不该被还掉再重取');
      const left = joined(fe.log.audio, 0);
      equal(left[Math.round(0.25 * 48000)], 1, '0.7 + 0.6 叠加后应收到 1');
      ok(left.every((v) => v <= 1 && v >= -1), '音轨不该超出 ±1');
      ok(Math.abs((left[Math.round((cStart + 0.25) * 48000)] ?? 0) - 0.7) < 1e-6, '第三段再次用到的文件照样混进去');
      film.dispose();
    },
  ],
  [
    'ExportHandle.audio:没有配音报 none,audio:false 报 off(导出前后一致);带配音时出片前 pending,出片后 included 并带音轨编码',
    async () => {
      const loader = fakeLoader({ 'a.wav': { seconds: 0.3, value: () => 0.2 } });
      const clip = [{ id: 'a', url: 'a.wav', start: 0, duration: 0.3 }];

      const fe1 = fakeEnv({ recordOutput: false, audioLoader: loader });
      const first = preview([holdSegment('A', 0.3)], fe1.env);
      const h1 = first.film.exportVideo();
      equal(h1.audio.status, 'none', '没有配音的片子一开始就该报 none');
      const o1 = track(h1);
      await settle(o1);
      equal(o1.state, 'resolved');
      equal(h1.audio.status, 'none');
      equal(h1.audio.codec, undefined);
      first.film.dispose();

      const fe2 = fakeEnv({ recordOutput: false, audioLoader: loader });
      const second = preview([voiced(holdSegment('A', 0.3), clip)], fe2.env);
      const h2 = second.film.exportVideo({ audio: false });
      equal(h2.audio.status, 'off', 'audio:false 一开始就该报 off');
      const o2 = track(h2);
      await settle(o2);
      equal(o2.state, 'resolved');
      equal(h2.audio.status, 'off');
      second.film.dispose();

      for (const codec of ['fake-aac', 'aac']) {
        const fe = fakeEnv({ recordOutput: false, audioLoader: loader, audioCodec: codec });
        const { film } = preview([voiced(holdSegment('A', 0.3), clip)], fe.env);
        const h = film.exportVideo();
        equal(h.audio.status, 'pending', '编码器还没探测完,应报 pending');
        const o = track(h);
        await settle(o);
        equal(o.state, 'resolved', `导出没有完成:${o.code}`);
        equal(h.mode, 'offline');
        equal(h.audio.status, 'included');
        equal(h.audio.codec, codec, '音轨编码应取自编码端');
        equal(h.audio.reason, undefined, `AAC 进 MP4 不需要提示:${h.audio.reason}`);
        equal(h.audio.failed, undefined);
        ok(fe.log.audio.length > 0, '配音应当写进编码端');
        film.dispose();
      }
    },
  ],
  [
    'ExportHandle.audio:编码端给的是 Opus 且装进 MP4 → included 附播放提示;装进 WebM 不提示',
    async () => {
      const loader = fakeLoader({ 'a.wav': { seconds: 0.3, value: () => 0.2 } });
      const clip = [{ id: 'a', url: 'a.wav', start: 0, duration: 0.3 }];
      const fe = fakeEnv({ recordOutput: false, audioLoader: loader, audioCodec: 'opus' });
      const { film } = preview([voiced(holdSegment('A', 0.3), clip)], fe.env);
      const h = film.exportVideo();
      const o = track(h);
      await settle(o);
      equal(o.state, 'resolved');
      equal(o.type, 'video/mp4');
      equal(h.audio.status, 'included');
      equal(h.audio.codec, 'opus');
      equal(h.audio.note, OPUS_IN_MP4_NOTE, 'MP4 里装 Opus 应提示 QuickTime 放不出声音');
      equal(h.audio.reason, undefined, 'included 不该有原因');
      film.dispose();

      const fe2 = fakeEnv({ recordOutput: false, audioLoader: loader, audioCodec: 'opus' });
      const second = preview([voiced(holdSegment('A', 0.3), clip)], fe2.env);
      const h2 = second.film.exportVideo({ mimeType: 'video/webm' });
      const o2 = track(h2);
      await settle(o2);
      equal(o2.state, 'resolved');
      equal(o2.type, 'video/webm');
      equal(h2.audio.status, 'included');
      equal(h2.audio.codec, 'opus');
      equal(h2.audio.note, undefined, 'WebM 里的 Opus 不需要提示');
      second.film.dispose();
    },
  ],
  [
    'ExportHandle.audio:某个配音文件取不到 → partial,列出失败的地址并说明原因(能取到的照常进成片)',
    async () => {
      const loader = fakeLoader({ 'bad.wav': 'fail', 'good.wav': { seconds: 0.3, value: () => 0.5 } });
      const fe = fakeEnv({ recordOutput: false, audioLoader: loader });
      const { film } = preview(
        [
          voiced(holdSegment('A', 1), [
            { id: 'bad', url: 'bad.wav', start: 0, duration: 0.3 },
            { id: 'good', url: 'good.wav', start: 0.5, duration: 0.3 },
          ]),
        ],
        fe.env,
      );
      const h = film.exportVideo();
      const o = track(h);
      await quiet(async () => {
        await settle(o);
      });
      equal(o.state, 'resolved', `文件取不到不该让导出失败:${o.code}`);
      equal(h.audio.status, 'partial');
      equal(h.audio.codec, 'fake-aac');
      equal((h.audio.failed ?? []).join(','), 'bad.wav', `失败地址不对:${String(h.audio.failed)}`);
      ok(typeof h.audio.reason === 'string' && h.audio.reason !== '', 'partial 应说明原因');
      ok(joined(fe.log.audio, 0).some((v) => Math.abs(v - 0.5) < 1e-6), '能取到的那句应照常混进去');
      film.dispose();
    },
  ],
  [
    '显式 offline:编码端编不了音频照常出片、报 dropped 并点明容器;环境解不了码同样 dropped;都不回退实时录制,也不建音频上下文',
    async () => {
      const loader = fakeLoader({ 'a.wav': { seconds: 0.3, value: () => 0.2 } });
      const clip = [{ id: 'a', url: 'a.wav', start: 0, duration: 0.3 }];
      for (const mimeType of ['video/mp4', 'video/webm']) {
        const live = liveAudio(['a.wav']);
        const ex = createExportStub();
        const fe = fakeEnv({ recordOutput: false, audioLoader: loader, audioCodec: null });
        const { film } = preview([voiced(holdSegment('A', 0.3), clip)], fe.env, {
          exportEnv: ex.env,
          audio: { env: live.env },
        });
        const h = film.exportVideo({ mode: 'offline', mimeType });
        equal(live.env.contexts, 0, '显式 offline 不会回退,不必建音频上下文');
        const o = track(h);
        await quiet(async () => {
          await settle(o);
        });
        equal(o.state, 'resolved', `编码端编不了音频也要照常出片:${o.code}`);
        equal(h.mode, 'offline', '显式 offline 不该回退实时录制');
        equal(ex.recorderOptions().length, 0, '不该起实时录制');
        equal(h.audio.status, 'dropped');
        ok((h.audio.reason ?? '').includes(mimeType), `原因应点明容器 ${mimeType}:${h.audio.reason}`);
        equal(fe.log.finished, 1);
        equal(fe.log.cancelled, 0);
        equal(fe.log.audio.length, 0);
        equal(live.env.contexts, 0);
        film.dispose();
      }

      const live = liveAudio(['a.wav']);
      const ex = createExportStub();
      const fe = fakeEnv({ recordOutput: false });
      const { film } = preview([voiced(holdSegment('A', 0.3), clip)], fe.env, {
        exportEnv: ex.env,
        audio: { env: live.env },
      });
      // 解不了码是 exportVideo() 里同步判定的(提示也在那时写):调用本身也要静音。
      const { warn } = console;
      console.warn = (): void => undefined;
      let h: ExportHandle;
      try {
        h = film.exportVideo({ mode: 'offline' });
      } finally {
        console.warn = warn;
      }
      const o = track(h);
      await quiet(async () => {
        await settle(o);
      });
      equal(o.state, 'resolved', `解不了码也要照常出片:${o.code}`);
      equal(h.mode, 'offline');
      equal(ex.recorderOptions().length, 0, '不该起实时录制');
      equal(fe.log.requests[0]?.audio, undefined, '解不了码就不该要音频轨');
      equal(h.audio.status, 'dropped');
      ok(typeof h.audio.reason === 'string' && h.audio.reason !== '', 'dropped 应说明原因');
      equal(live.env.contexts, 0);
      film.dispose();
    },
  ],
  [
    'auto:带配音而编码端编不了音频 → 释放离线编码器、改走实时录制把配音录进去;配音情况以实时录制为准(录完仍是 included/aac)',
    async () => {
      const loader = fakeLoader({ 'a.wav': { seconds: 0.3, value: () => 0.2 } });
      const live = liveAudio(['a.wav']);
      const ex = createExportStub();
      const fe = fakeEnv({ recordOutput: false, audioLoader: loader, audioCodec: null });
      const { film, clock } = preview(
        [voiced(holdSegment('A', 0.5), [{ id: 'a', url: 'a.wav', start: 0, duration: 0.3 }])],
        fe.env,
        { exportEnv: ex.env, audio: { env: live.env } },
      );
      const h = film.exportVideo();
      // 离线探测完之后才回退,那时已经不在点击里:音频上下文必须在这次调用里同步建好。
      equal(live.env.contexts, 1, 'auto + 配音应在点击里同步建好音频上下文');
      equal(film.getState().audio.enabled, false, '预热上下文不该替用户开声音');
      equal(h.mode, 'offline');
      equal(h.audio.status, 'pending');
      const o = track(h);
      await quiet(async () => {
        for (let i = 0; i < 5; i++) {
          await flushTasks();
        }
      });
      ok(fe.log.requests[0]?.audio !== undefined, '应当先向离线编码端要过音频轨');
      equal(h.mode, 'realtime', '离线带不上配音时 auto 应改走实时录制');
      equal(fe.log.cancelled, 1, '离线编码器没有释放');
      equal(fe.log.finished, 0);
      equal(fe.log.timestamps.length, 0, '回退前不该编过任何一帧');
      equal(fe.canvases[0]?.width, 0, '离线导出画布没有还掉像素缓冲');
      ok(ex.streamTracks().includes(live.track), '实时录制的媒体流里没有配音音轨');
      equal(ex.recorderOptions()[0]?.['mimeType'], 'video/mp4;codecs=avc1,mp4a.40.2', '带配音录 MP4 应钉死 AAC');
      equal(live.env.contexts, 1, '实时录制应沿用预热好的上下文');
      // 开录前实时录制只能说「还没定」:声音在不在出要到收带才定论。
      equal(h.audio.status, 'pending', `回退后应以实时录制的配音情况为准:${h.audio.status} ${h.audio.reason ?? ''}`);
      await quiet(async () => {
        await runPreview(clock, o);
      });
      equal(o.state, 'resolved', `实时录制没有录完:${o.code}`);
      equal(o.type, 'video/mp4;codecs=avc1,mp4a.40.2');
      equal(h.mode, 'realtime');
      equal(h.audio.status, 'included', `录完后:${h.audio.status} ${h.audio.reason ?? ''}`);
      equal(h.audio.codec, 'aac');
      equal(film.getState().exporting, false);
      film.dispose();
    },
  ],
  [
    'auto:带配音、编码端编不了音频,但播放器录不进配音(没有 Web Audio)→ 不回退,照常离线出片并报 dropped',
    async () => {
      const loader = fakeLoader({ 'a.wav': { seconds: 0.3, value: () => 0.2 } });
      const clip = [{ id: 'a', url: 'a.wav', start: 0, duration: 0.3 }];
      // node 里没有 AudioContext:不注入 audio.env 就是没有 Web Audio 的浏览器。
      const ex = createExportStub();
      const fe = fakeEnv({ recordOutput: false, audioLoader: loader, audioCodec: null });
      const { film } = preview([voiced(holdSegment('A', 0.3), clip)], fe.env, { exportEnv: ex.env });
      equal(film.getState().audio.available, false, '前提:播放器没有声音环境');
      const h = film.exportVideo();
      const o = track(h);
      await quiet(async () => {
        await settle(o);
      });
      equal(o.state, 'resolved', `导出没有完成:${o.code}`);
      equal(h.mode, 'offline', '回退实时录制也录不进配音,不该回退');
      equal(ex.recorderOptions().length, 0, '不该起实时录制');
      equal(fe.log.finished, 1);
      equal(fe.log.cancelled, 0);
      equal(h.audio.status, 'dropped');
      ok((h.audio.reason ?? '').includes('video/mp4'), `原因应点明容器:${h.audio.reason}`);
      film.dispose();
    },
  ],
  [
    // 已知源码缺陷(未修,见报告):film.ts 的 voiceFallback 只看 voice !== null(有播放环境),
    // 不看 prime() 之后到底建没建出上下文 —— 建不出时照样回退实时录制(占住预览、要保持前台),录出来还是没有配音。
    'auto:播放环境建不出音频上下文(AudioContext 构造失败)时同样录不进配音 → 不回退,照常离线出片并报 dropped',
    async () => {
      const loader = fakeLoader({ 'a.wav': { seconds: 0.3, value: () => 0.2 } });
      const dead = deadAudioEnv();
      const ex = createExportStub();
      const fe = fakeEnv({ recordOutput: false, audioLoader: loader, audioCodec: null });
      const { film } = preview(
        [voiced(holdSegment('A', 0.3), [{ id: 'a', url: 'a.wav', start: 0, duration: 0.3 }])],
        fe.env,
        { exportEnv: ex.env, audio: { env: dead } },
      );
      const h = film.exportVideo();
      const o = track(h);
      try {
        // 回退成实时录制时预览时钟不走、永远录不完:settle 跑满上限后照样往下断言。
        await quiet(async () => {
          await settle(o, 500);
        });
        equal(
          h.mode,
          'offline',
          `建不出音频上下文,回退实时录制也录不进配音(film.ts voiceFallback;实际回退后报 ${h.audio.status}:${h.audio.reason ?? ''})`,
        );
        equal(ex.recorderOptions().length, 0, '不该起实时录制');
        equal(o.state, 'resolved', `导出没有完成:${o.code}`);
        equal(fe.log.finished, 1, '离线成片没有交付');
        equal(h.audio.status, 'dropped');
      } finally {
        await quiet(async () => {
          h.cancel();
          await settle(o);
          film.dispose();
        });
      }
    },
  ],
  [
    'auto:环境解不了音频(没有 OfflineAudioContext)而播放器录得进配音 → 直接改走实时录制,不建离线画布、不探测编码器',
    async () => {
      const live = liveAudio(['a.wav']);
      const ex = createExportStub();
      const fe = fakeEnv({ recordOutput: false });
      const { film } = preview(
        [voiced(holdSegment('A', 1), [{ id: 'a', url: 'a.wav', start: 0, duration: 0.5 }])],
        fe.env,
        { exportEnv: ex.env, audio: { env: live.env } },
      );
      const h = film.exportVideo();
      equal(live.env.contexts, 1, 'auto + 配音应在点击里同步建好音频上下文');
      const o = track(h);
      await quiet(async () => {
        await flushTasks();
        await flushTasks();
      });
      equal(h.mode, 'realtime', '解不了码时 auto 应改走实时录制');
      equal(fe.log.requests.length, 0, '不该探测离线编码器');
      equal(fe.canvases.length, 0, '不该建离线画布');
      equal(film.getState().mode, 'exporting');
      ok(ex.streamTracks().includes(live.track), '实时录制的媒体流里没有配音音轨');
      // 实时录制接上了音轨;声音在不在出要到收带才定论,录制途中是「还没定」。
      equal(h.audio.status, 'pending', `配音情况应以实时录制为准:${h.audio.status} ${h.audio.reason ?? ''}`);
      h.cancel();
      await settle(o);
      equal(o.code, 'cancelled');
      film.dispose();
    },
  ],
  [
    'auto + 带配音:点击导出时同步预热音频上下文但不出声,离线照常出片;没有配音、audio:false、显式 offline 都不建上下文',
    async () => {
      const loader = fakeLoader({ 'a.wav': { seconds: 0.3, value: () => 0.2 } });
      const clip = [{ id: 'a', url: 'a.wav', start: 0, duration: 0.3 }];

      const live = liveAudio(['a.wav']);
      const fe = fakeEnv({ recordOutput: false, audioLoader: loader });
      const { film } = preview([voiced(holdSegment('A', 0.3), clip)], fe.env, {
        exportEnv: createExportStub().env,
        audio: { env: live.env },
      });
      equal(live.env.contexts, 0, '前提:声音没开时不建上下文');
      const h = film.exportVideo();
      equal(live.env.contexts, 1, '应在 exportVideo() 调用里同步建好上下文');
      ok(live.env.ctx.resumes >= 1, '预热应顺手 resume(还在点击里,浏览器允许)');
      equal(film.getState().audio.enabled, false, '预热不该替用户开声音');
      const o = track(h);
      await settle(o);
      equal(o.state, 'resolved', `导出没有完成:${o.code}`);
      equal(h.mode, 'offline', '离线带得上配音就不回退');
      equal(h.audio.status, 'included');
      equal(live.env.contexts, 1);
      equal(live.env.ctx.nodes.length, 0, '预热之后不该真的出声');
      // 预热的上下文最终没用上(离线带上了配音、声音仍关着):挂起它,不让它空跑。
      ok(live.env.ctx.suspends >= 1, '没用上的上下文应当挂起');
      equal(live.env.ctx.state, 'suspended');
      film.dispose();

      const cases: Array<[string, Segment[], object]> = [
        ['没有配音', [holdSegment('A', 0.3)], {}],
        ['audio:false', [voiced(holdSegment('A', 0.3), clip)], { audio: false }],
        ['显式 offline', [voiced(holdSegment('A', 0.3), clip)], { mode: 'offline' }],
      ];
      for (const [name, segments, opts] of cases) {
        const other = liveAudio(['a.wav']);
        const fe2 = fakeEnv({ recordOutput: false, audioLoader: loader });
        const p = preview(segments, fe2.env, { exportEnv: createExportStub().env, audio: { env: other.env } });
        const h2 = p.film.exportVideo(opts);
        equal(other.env.contexts, 0, `${name}:不该建音频上下文`);
        const o2 = track(h2);
        await settle(o2);
        equal(o2.state, 'resolved', `${name}:导出没有完成:${o2.code}`);
        equal(other.env.contexts, 0, `${name}:导出过程中也不该建音频上下文`);
        p.film.dispose();
      }
    },
  ],
  [
    'auto:带配音、编码端编不了音频,但实时录制录不了所选容器 → 不回退(免得把能出的无声片变成失败),照常离线出片并报 dropped',
    async () => {
      const loader = fakeLoader({ 'a.wav': { seconds: 0.3, value: () => 0.2 } });
      const clip = [{ id: 'a', url: 'a.wav', start: 0, duration: 0.3 }];
      const live = liveAudio(['a.wav']);
      // MediaRecorder 只录得了 MP4;用户在下拉框里选的是离线才编得出的 WebM。
      const ex = createExportStub({ supportedTypes: ['video/mp4', 'video/mp4;codecs=avc1,mp4a.40.2'] });
      const fe = fakeEnv({ recordOutput: false, audioLoader: loader, audioCodec: null });
      const { film } = preview([voiced(holdSegment('A', 0.3), clip)], fe.env, {
        exportEnv: ex.env,
        audio: { env: live.env },
      });
      const h = film.exportVideo({ mimeType: 'video/webm' });
      equal(live.env.contexts, 0, '回退不了就不该预热音频上下文');
      const o = track(h);
      await quiet(async () => {
        await settle(o);
      });
      equal(o.state, 'resolved', `应当照常出无声的离线成片:${o.code}`);
      equal(o.type, 'video/webm');
      equal(h.mode, 'offline');
      equal(fe.log.cancelled, 0, '离线编码器不该被放弃');
      equal(h.audio.status, 'dropped');
      ok((h.audio.reason ?? '').includes('video/webm'), `原因应点明容器:${h.audio.reason}`);
      film.dispose();
    },
  ],
  [
    'MessageChannel 让出:按顺序放行,关闭后挂起的让出也会放行',
    async () => {
      const y = messageChannelYielder();
      const order: number[] = [];
      const a = y.yieldTask().then(() => order.push(1));
      const b = y.yieldTask().then(() => order.push(2));
      await Promise.all([a, b]);
      equal(order.join(','), '1,2');
      const pending = y.yieldTask();
      y.close();
      await pending;
    },
  ],
]);
