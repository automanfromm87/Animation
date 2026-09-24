import type { LiveAudioContext, LiveAudioEnv } from '../audio/live';
import { fakeAudio, fakeLiveEnv } from '../audio/testing';
import { OPUS_IN_MP4_NOTE } from '../export/types';
import { installDomStub } from '../testing/domStub';
import type { DomStub, StubCanvas } from '../testing/domStub';
import { installExportStub, installResizeObserverStub } from '../testing/exportStub';
import type { ExportOp, ExportStub, ExportStubOptions, StubElement } from '../testing/exportStub';
import { equal, ok, quiet, suite } from '../testing/harness';
import type {
  ExportAudioReport,
  ExportHandle,
  ExportOptions,
  FilmController,
  FilmOptions,
  Segment,
  SegmentHandle,
} from './film';
import { isFilmError, runFilm } from './film';

/**
 * 导出链路的集成用例:真实的 runFilm + 导出桩(document / MediaRecorder / captureStream)。
 * 合成按约 30fps 节流,桩帧 16ms,所以大约每两帧合成一次;看门狗每秒查一次。
 */
interface Harness {
  dom: DomStub;
  ex: ExportStub;
  canvas: StubCanvas & HTMLCanvasElement;
}

async function withExportStub(
  body: (h: Harness) => Promise<void>,
  options?: ExportStubOptions,
): Promise<void> {
  const dom = installDomStub();
  const ex = installExportStub(options);
  try {
    const canvas = dom.canvas();
    ex.mountedCanvas(canvas);
    await body({ dom, ex, canvas });
  } finally {
    ex.restore();
    dom.restore();
  }
}

async function run(dom: DomStub, frames: number): Promise<void> {
  for (let i = 0; i < frames; i++) {
    dom.frame(16);
    await dom.flush();
  }
}

interface Probe extends Segment {
  finish(): void;
  elapsed: number;
}

function probe(name: string, log: string[] = [], duration = 1, extra: Partial<Segment> = {}): Probe {
  let resolveDone: (() => void) | null = null;
  const seg: Probe = {
    name,
    duration,
    elapsed: 0,
    ...extra,
    play(): SegmentHandle {
      log.push(`play:${name}`);
      const done = new Promise<void>((r) => {
        resolveDone = r;
      });
      return {
        done,
        dispose: () => resolveDone?.(),
        resize: () => undefined,
        getElapsed: () => seg.elapsed,
        setPaused: (p: boolean) => {
          log.push(`paused:${name}:${p}`);
        },
      };
    },
    finish: () => resolveDone?.(),
  };
  return seg;
}

function broken(name: string, log: string[]): Segment {
  return {
    name,
    duration: 1,
    play(): SegmentHandle {
      log.push(`throw:${name}`);
      throw new Error(`${name} 起不来`);
    },
  };
}

/** 跟踪导出句柄的结局。 */
interface Outcome {
  state: 'pending' | 'resolved' | 'rejected';
  code: string;
  message: string;
  size: number;
  type: string;
}

function track(handle: ExportHandle): Outcome {
  const o: Outcome = { state: 'pending', code: '', message: '', size: -1, type: '' };
  handle.done.then(
    (blob) => {
      o.state = 'resolved';
      o.size = blob.size;
      o.type = blob.type;
    },
    (e: unknown) => {
      o.state = 'rejected';
      o.code = isFilmError(e) ? e.code : 'not-film-error';
      o.message = e instanceof Error ? e.message : String(e);
    },
  );
  return o;
}

const instant: FilmOptions = { transition: 0, loop: false };

interface FakeLiveAudioOptions {
  /** 音频上下文的状态,缺省 'running';'suspended' 模拟浏览器没允许出声(resume 也唤不醒)。 */
  state?: string;
  /** 取音频文件,缺省永远不回。 */
  fetch?: (url: string) => Promise<ArrayBuffer>;
  /** 上下文有没有 createMediaStreamDestination,缺省有。 */
  streamDestination?: boolean;
  /** createContext 拿不到上下文(返回 null)。 */
  noContext?: boolean;
  /** resume() 能把上下文唤醒(下一个微任务里变成 'running',与浏览器一样是异步的)。缺省唤不醒。 */
  resumable?: boolean;
}

/** 假的 Web Audio 播放环境:能建上下文、能把声音接出一条录制音轨;记下音轨被停、录制节点被断开的次数。 */
function fakeLiveAudio(o: FakeLiveAudioOptions = {}): {
  env: LiveAudioEnv;
  track: MediaStreamTrack;
  trackStops(): number;
  disconnected(): number;
  /** 改上下文状态(模拟系统挂起、关闭)。 */
  setState(state: string): void;
  resumes(): number;
} {
  let trackStops = 0;
  let resumes = 0;
  let state = o.state ?? 'running';
  let disconnected = 0;
  const audioTrack = {
    kind: 'audio',
    stop: () => {
      trackStops += 1;
    },
  } as unknown as MediaStreamTrack;
  const destination = { stream: { getAudioTracks: () => [audioTrack] } as unknown as MediaStream };
  const ctx: LiveAudioContext = {
    currentTime: 0,
    get state(): string {
      return state;
    },
    destination: {},
    resume: () => {
      resumes += 1;
      return o.resumable
        ? Promise.resolve().then(() => {
            state = 'running';
          })
        : Promise.resolve();
    },
    suspend: () => Promise.resolve(),
    close: () => Promise.resolve(),
    createBufferSource: () => ({
      buffer: null,
      onended: null,
      connect: () => undefined,
      disconnect: () => undefined,
      start: () => undefined,
      stop: () => undefined,
    }),
    createGain: () => ({
      gain: { value: 1 },
      connect: () => undefined,
      disconnect: (node?: unknown) => {
        if (node === destination) {
          disconnected += 1;
        }
      },
    }),
    decodeAudioData: () => Promise.reject(new Error('测试里不解码')),
    ...(o.streamDestination === false ? {} : { createMediaStreamDestination: () => destination }),
  };
  return {
    env: {
      createContext: () => (o.noContext ? null : ctx),
      // 缺省永远不回:测试里不真播声音,也不产生加载失败的告警。
      fetch: o.fetch ?? (() => new Promise<ArrayBuffer>(() => undefined)),
      hidden: () => false,
      onVisibilityChange: () => () => undefined,
    },
    track: audioTrack,
    trackStops: () => trackStops,
    disconnected: () => disconnected,
    setState: (next) => {
      state = next;
    },
    resumes: () => resumes,
  };
}

/** 带一段配音的探针分段。 */
function voicedProbe(name: string): Probe {
  return probe(name, [], 1, {
    voice: { clips: [{ id: `${name}/1`, url: `${name}.wav`, start: 0, duration: 1, offset: 0 }] },
  });
}

/** 导出帧上最近一次画的进度条填充:填充色、轨道高度的 fillRect。 */
function lastFill(ops: readonly ExportOp[], color: string, trackPx: number): ExportOp | undefined {
  return ops.filter((o) => o.op === 'fillRect' && o.fillStyle === color && o.args[3] === trackPx).at(-1);
}

/** 默认样式的进度条颜色(轨道、填充、普通刻度):成片里出现任何一个就是画了进度条。 */
const DEFAULT_BAR_COLORS = ['rgba(0,0,0,0.12)', '#1a1a1a', 'rgba(0,0,0,0.35)'];

/** 这段绘制里的进度条痕迹:进度条先按主画面 clip,再用轨道/填充/刻度色 fillRect。 */
function barTraces(ops: readonly ExportOp[]): string[] {
  return ops
    .filter((o) => o.op === 'clip' || (o.op === 'fillRect' && DEFAULT_BAR_COLORS.includes(String(o.fillStyle))))
    .map((o) => `${o.op}:${String(o.fillStyle)}`);
}

/** DOM 进度条的填充块(创建时宽 0%,之后每帧改 style.width)。 */
function domFill(ex: ExportStub): StubElement | undefined {
  return ex.created().find((el) => el.style['cssText']?.includes('width:0%'));
}

interface AudioRun {
  /** exportVideo 刚返回时读到的配音报告。 */
  before: ExportAudioReport;
  /** done 回调里读到的(收带之后的定论);没有 resolve 时为 null。 */
  atDone: ExportAudioReport | null;
  out: Outcome;
  handle: ExportHandle;
}

/** 实时录完整片(每段录 30 帧后收尾),记下开录时与 done 回调里的配音报告。 */
async function recordAudio(
  dom: DomStub,
  film: FilmController,
  segs: readonly Probe[],
  options?: ExportOptions,
): Promise<AudioRun> {
  const handle = film.exportVideo({ mode: 'realtime', ...options });
  const before = handle.audio;
  const box: { atDone: ExportAudioReport | null } = { atDone: null };
  handle.done.then(
    () => {
      box.atDone = handle.audio;
    },
    () => undefined,
  );
  const out = track(handle);
  for (const s of segs) {
    await run(dom, 30);
    s.finish();
  }
  await run(dom, 6);
  return { before, atDone: box.atDone, out, handle };
}

export default suite('导出', [
  [
    '正常导出照常交付,并释放轨道、导出画布与可见性监听',
    () =>
      withExportStub(async ({ dom, ex, canvas }) => {
        const seg = probe('A');
        const film = runFilm(canvas, [seg], instant);
        await run(dom, 4);
        const out = track(film.exportVideo());
        equal(ex.docListenerCount('visibilitychange'), 1);
        // 跑过看门狗的首次检查:健康链路上(含污染探针)不能误报。
        await run(dom, 130);
        seg.finish();
        await run(dom, 6);
        equal(out.state, 'resolved', `正常导出被误判:${out.message}`);
        ok(out.size > 0, '没拿到成片');
        ok(ex.tracksStopped() >= 1, '捕获轨道没停');
        ok(ex.exportCanvasRemoved(), '导出画布没摘');
        equal(ex.docListenerCount('visibilitychange'), 0, '可见性监听没摘');
        equal(film.getState().exporting, false);
        film();
      }),
  ],
  [
    '只从导出段的第一个起播分段开录:半路点导出,成片也从第 0 段开始',
    () =>
      withExportStub(async ({ dom, ex, canvas }) => {
        const log: string[] = [];
        const segs = [probe('S0', log), probe('S1', log), probe('S2', log)];
        const film = runFilm(canvas, segs, instant);
        film.seekTo(2);
        await run(dom, 4);
        log.length = 0;
        const out = track(film.exportVideo());
        equal(ex.starts(), 0, '还没切到第 0 段就开录了');
        await dom.flush();
        equal(log.filter((l) => l.startsWith('play:')).join('|'), 'play:S0');
        equal(ex.starts(), 1, '第 0 段起播时应当开录');
        film();
        await dom.flush();
        equal(out.code, 'disposed');
      }),
  ],
  [
    '开场是白场:成片第一帧盖着转场白闪,与点击导出的时机无关',
    () =>
      withExportStub(async ({ dom, ex, canvas }) => {
        const seg = probe('A');
        const film = runFilm(canvas, [seg], { transition: 0.2, loop: false });
        await run(dom, 40); // 白闪早已淡出
        track(film.exportVideo());
        await run(dom, 2);
        const ops = ex.exportOps();
        // 每帧的开头是「铺底色 fillRect -> 主画面 drawImage」;按它切出第一帧。
        const starts = ops
          .map((o, i) => (o.op === 'fillRect' && ops[i + 1]?.op === 'drawImage' ? i : -1))
          .filter((i) => i >= 0);
        ok(starts.length > 0, '一帧都没合成');
        const firstFrame = ops.slice((starts[0] ?? 0) + 2, starts[1]);
        // 主画面之上再铺一层不透明的转场色 = 这一帧整个被白场盖住。
        const veil = firstFrame.find((o) => o.op === 'fillRect');
        ok(veil !== undefined, `第一帧没有白场:${firstFrame.map((o) => o.op).join(',')}`);
        ok(Number(veil?.globalAlpha) >= 0.99, `第一帧的白场不是满的:${String(veil?.globalAlpha)}`);
        film();
      }),
  ],
  [
    '导出在帧回调里失败收尾后,帧循环不会翻成两条',
    () =>
      withExportStub(
        async ({ dom, canvas }) => {
          const film = runFilm(canvas, [probe('A')], instant);
          await run(dom, 4);
          const out = track(film.exportVideo());
          await run(dom, 80);
          equal(out.code, 'tainted', out.message);
          await run(dom, 3);
          equal(dom.pending(), 1, `帧循环翻倍了:排着 ${dom.pending()} 个 rAF`);
          film();
        },
        { tainted: true },
      ),
  ],
  [
    '合成按捕获帧率(约 30fps)节流:16ms 一帧时约每两帧合成一次',
    () =>
      withExportStub(async ({ dom, ex, canvas }) => {
        const film = runFilm(canvas, [probe('A')], instant);
        await run(dom, 4);
        track(film.exportVideo());
        await dom.flush();
        equal(ex.starts(), 1);
        const before = ex.composited();
        await run(dom, 60);
        const n = ex.composited() - before;
        ok(n >= 28 && n <= 32, `60 帧里合成了 ${n} 次`);
        film();
      }),
  ],
  [
    '看门狗按时间每秒查一次:污染在开录约 1 秒后报出,与显示帧率无关',
    async () => {
      for (const dt of [16, 7]) {
        await withExportStub(
          async ({ dom, ex, canvas }) => {
            const film = runFilm(canvas, [probe('A')], instant);
            await run(dom, 4);
            const out = track(film.exportVideo());
            await dom.flush();
            equal(ex.starts(), 1, '没有开录');
            let t = 0;
            while (out.state === 'pending' && t < 3000) {
              dom.frame(dt);
              t += dt;
              await dom.flush();
            }
            equal(out.code, 'tainted', out.message);
            ok(t >= 1000 && t <= 1000 + dt, `帧间隔 ${dt}ms 时 ${t}ms 才查出污染(应在开录后约 1 秒)`);
            film();
          },
          { tainted: true },
        );
      }
    },
  ],
  [
    '看门狗每次检查复用同一张污染探针,不会每秒新建一张画布',
    () =>
      withExportStub(async ({ dom, ex, canvas }) => {
        const film = runFilm(canvas, [probe('A')], instant);
        await run(dom, 4);
        const canvases = (): number => ex.created().filter((el) => el.tagName === 'CANVAS').length;
        track(film.exportVideo());
        await dom.flush();
        const atStart = canvases();
        equal(atStart, 2, '导出画布 + 探针,应当正好两张');
        await run(dom, 200); // 约 3 次检查
        equal(canvases(), atStart, '检查时又建了新画布');
        film();
      }),
  ],
  [
    '导出画布被污染时,看门狗约 1 秒内带错收尾,不等录完整片',
    () =>
      withExportStub(
        async ({ dom, ex, canvas }) => {
          const film = runFilm(canvas, [probe('A')], instant);
          await run(dom, 4);
          const out = track(film.exportVideo());
          await run(dom, 80);
          equal(out.code, 'tainted', `没有按污染报错:${out.message}`);
          equal(ex.stops(), 1, '录制机没有停');
          film();
        },
        { tainted: true },
      ),
  ],
  [
    '合成抛错不会让整条合成链停摆',
    () => {
      const state = { throwing: false };
      return withExportStub(
        async ({ dom, ex, canvas }) => {
          const film = runFilm(canvas, [probe('A')], { transition: 0 });
          await run(dom, 4);
          track(film.exportVideo());
          await run(dom, 8);
          const healthy = ex.composited();
          ok(healthy > 0, `开录后就没合成过:${healthy}`);
          await quiet(async () => {
            state.throwing = true;
            await run(dom, 8);
          });
          state.throwing = false;
          const afterThrow = ex.composited();
          await run(dom, 8);
          ok(ex.composited() > afterThrow, `抛错之后合成没有恢复:${afterThrow} -> ${ex.composited()}`);
          film();
        },
        { throwOnDraw: () => state.throwing },
      );
    },
  ],
  [
    '一直抛错时在片子播完之前就以 composite 收尾,不交出空视频',
    () =>
      withExportStub(
        async ({ dom, ex, canvas }) => {
          const seg = probe('A');
          const film = runFilm(canvas, [seg], instant);
          await run(dom, 4);
          let out: Outcome | null = null;
          await quiet(async () => {
            out = track(film.exportVideo());
            // 约每两帧尝试一次合成,31 次连续失败之后必须收尾(分段始终没结束)。
            await run(dom, 80);
          });
          const o = out as Outcome | null;
          equal(o?.code, 'composite', `没有按合成失败收尾:${o?.message}`);
          equal(ex.composited(), 0, '不该有任何成功合成的帧');
          film();
        },
        { throwOnDraw: () => true },
      ),
  ],
  [
    'onProgress 抛错只记一次日志,照常合成、照常交付',
    () =>
      withExportStub(async ({ dom, ex, canvas }) => {
        const seg = probe('A');
        const film = runFilm(canvas, [seg], instant);
        await run(dom, 4);
        let out: Outcome | null = null;
        await quiet(async () => {
          out = track(
            film.exportVideo({
              onProgress: () => {
                throw new Error('宿主进度回调炸了');
              },
            }),
          );
          await run(dom, 80);
          seg.finish();
          await run(dom, 6);
        });
        ok(ex.composited() > 10, `进度回调抛错拖垮了合成:${ex.composited()}`);
        equal((out as Outcome | null)?.state, 'resolved');
        film();
      }),
  ],
  [
    '成片帧数过少时以 empty-output 拒绝交付',
    () =>
      withExportStub(async ({ dom, canvas }) => {
        const seg = probe('A');
        const film = runFilm(canvas, [seg], instant);
        await run(dom, 4);
        const out = track(film.exportVideo());
        await run(dom, 3);
        seg.finish();
        await run(dom, 6);
        equal(out.code, 'empty-output', out.message);
        film();
      }),
  ],
  [
    '合成端正常但编码器几乎没收到帧时,以 encoder-starved 拒绝',
    () =>
      withExportStub(
        async ({ dom, ex, canvas }) => {
          const seg = probe('A');
          const film = runFilm(canvas, [seg], instant);
          await run(dom, 4);
          const out = track(film.exportVideo());
          await run(dom, 80);
          ok(ex.composited() > 10, `合成端帧数不够:${ex.composited()}`);
          seg.finish();
          await run(dom, 6);
          equal(out.code, 'encoder-starved', out.message);
          film();
        },
        { chunkSize: 4096 },
      ),
  ],
  [
    '切到后台中止导出(hidden),失败路径同样释放轨道、画布与监听',
    () =>
      withExportStub(async ({ dom, ex, canvas }) => {
        const film = runFilm(canvas, [probe('A')], instant);
        await run(dom, 4);
        const out = track(film.exportVideo());
        await run(dom, 10);
        ex.setHidden(true);
        await dom.flush();
        equal(out.code, 'hidden');
        ok(ex.tracksStopped() >= 1, '捕获轨道没停');
        ok(ex.exportCanvasRemoved(), '导出画布没摘');
        equal(ex.docListenerCount('visibilitychange'), 0, '可见性监听没摘');
        film();
      }),
  ],
  [
    '导出期间:暂停请求被忽略;用户跳转(seekTo / 进度条键盘)被拒;结束后恢复',
    () =>
      withExportStub(async ({ dom, ex, canvas }) => {
        const log: string[] = [];
        const segs = [probe('S0', log), probe('S1', log), probe('S2', log)];
        const film = runFilm(canvas, segs, instant);
        await run(dom, 4);
        const handle = film.exportVideo();
        const out = track(handle);
        await run(dom, 4);
        log.length = 0;
        film.setPaused(true);
        equal(film.getState().mode, 'exporting');
        equal(film.getState().paused, false, '导出期间不该进入暂停');
        film.seekTo(2);
        const slider = ex.findByAttr('role', 'slider');
        equal(slider?.getAttribute('aria-disabled'), 'true');
        slider?.dispatch('keydown', { key: 'End' });
        await run(dom, 4);
        equal(log.filter((l) => l.startsWith('play:')).join('|'), '', `导出期间跳了段:${log.join('|')}`);
        handle.cancel();
        await dom.flush();
        equal(out.code, 'cancelled');
        equal(slider?.getAttribute('aria-disabled'), 'false');
        film.seekTo(2);
        await run(dom, 3);
        ok(log.includes('play:S2'), '导出结束后跳转应当恢复');
        film();
      }),
  ],
  [
    '横竖屏翻转在导出期间不重建分段,导出结束后补上重建',
    () =>
      withExportStub(async ({ dom, canvas }) => {
        const ro = installResizeObserverStub();
        try {
          const log: string[] = [];
          const film = runFilm(canvas, [probe('A', log)], { transition: 0 });
          await run(dom, 4);
          const handle = film.exportVideo();
          track(handle);
          await run(dom, 4);
          log.length = 0;
          ro.resize(canvas as unknown as StubCanvas, 400, 900);
          await run(dom, 4);
          equal(log.filter((l) => l.startsWith('play:')).length, 0, '导出期间重建了分段');
          handle.cancel();
          await run(dom, 4);
          equal(log.filter((l) => l.startsWith('play:')).join('|'), 'play:A', '导出结束后没补重建');
          film();
        } finally {
          ro.restore();
        }
      }),
  ],
  [
    '暂停态下导出:自动恢复播放(通知宿主),照常录完',
    () =>
      withExportStub(async ({ dom, canvas }) => {
        const seg = probe('A');
        const paused: boolean[] = [];
        const film = runFilm(canvas, [seg], { ...instant, onPausedChange: (p) => paused.push(p) });
        await run(dom, 4);
        film.setPaused(true);
        const out = track(film.exportVideo());
        equal(paused.join(','), 'true,false', '宿主没收到恢复通知');
        equal(film.getState().paused, false);
        await run(dom, 80);
        seg.finish();
        await run(dom, 6);
        equal(out.state, 'resolved', out.message);
        film();
      }),
  ],
  [
    '收带窗口期(已 stop、onstop 未到)取消照样生效:reject cancelled',
    () =>
      withExportStub(
        async ({ dom, ex, canvas }) => {
          const seg = probe('A');
          const film = runFilm(canvas, [seg], instant);
          await run(dom, 4);
          const handle = film.exportVideo();
          const out = track(handle);
          await run(dom, 80);
          seg.finish();
          await dom.flush();
          equal(ex.stops(), 1, '片尾应当已经 stop 了编码器');
          equal(out.state, 'pending', 'onstop 还没来就交付了');
          handle.cancel();
          equal(ex.deliverStops(), 1);
          await dom.flush();
          equal(out.code, 'cancelled', `取消被吞了:${out.state} ${out.message}`);
          film();
        },
        { asyncStop: true },
      ),
  ],
  [
    '显式指定的容器不支持时报 unsupported-mime;成片类型取编码器实际选用的格式',
    () =>
      withExportStub(
        async ({ dom, canvas }) => {
          const seg = probe('A');
          const film = runFilm(canvas, [seg], instant);
          await run(dom, 4);
          const bad = track(film.exportVideo({ mimeType: 'video/webm' }));
          await dom.flush();
          equal(bad.code, 'unsupported-mime');
          const handle = film.exportVideo();
          equal(handle.mimeType, 'video/mp4');
          const out = track(handle);
          await run(dom, 80);
          seg.finish();
          await run(dom, 6);
          equal(out.type, 'video/mp4;codecs=avc1');
          film();
        },
        { supportedTypes: ['video/mp4'], recorderMimeType: 'video/mp4;codecs=avc1' },
      ),
  ],
  [
    '编码器报错:以 recorder 收尾并带上浏览器给的细节',
    () =>
      withExportStub(async ({ dom, ex, canvas }) => {
        const film = runFilm(canvas, [probe('A')], instant);
        await run(dom, 4);
        const out = track(film.exportVideo());
        await run(dom, 4);
        ex.fireRecorderError(new DOMException('encoder died', 'EncodingError'));
        await dom.flush();
        equal(out.code, 'recorder');
        ok(out.message.includes('EncodingError'), `没带细节:${out.message}`);
        film();
      }),
  ],
  [
    '看门狗端到端:持续静音报 track-muted,短暂静音不误报',
    () =>
      withExportStub(
        async ({ dom, ex, canvas }) => {
          const film = runFilm(canvas, [probe('A')], instant);
          await run(dom, 4);
          const out = track(film.exportVideo());
          await run(dom, 2);
          ex.setTrack({ muted: true });
          await run(dom, 70); // 约一次检查
          ex.setTrack({ muted: false });
          await run(dom, 70);
          equal(out.state, 'pending', `短暂静音被误报:${out.message}`);
          ex.setTrack({ muted: true });
          await run(dom, 220);
          equal(out.code, 'track-muted', out.message);
          film();
        },
        { exposeTrack: true },
      ),
  ],
  [
    '看门狗:静音恢复后重新计时(先静音 -> 恢复 5 秒 -> 再短暂静音,不误报)',
    () =>
      withExportStub(
        async ({ dom, ex, canvas }) => {
          const film = runFilm(canvas, [probe('A')], instant);
          await run(dom, 4);
          const out = track(film.exportVideo());
          await dom.flush();
          ex.setTrack({ muted: true });
          await run(dom, 70); // 一次检查看到静音
          ex.setTrack({ muted: false });
          await run(dom, 320); // 恢复 5 秒:静音起点应当被清掉
          ex.setTrack({ muted: true });
          await run(dom, 70); // 再短暂静音一次检查
          ex.setTrack({ muted: false });
          await run(dom, 130);
          equal(out.state, 'pending', `短暂静音被误报:${out.message}`);
          film();
        },
        { exposeTrack: true },
      ),
  ],
  [
    '合成失败按「连续」计数:中间夹一次成功就重新计,不会因累计超限而中止',
    () => {
      let attempts = 0;
      return withExportStub(
        async ({ dom, canvas }) => {
          const film = runFilm(canvas, [probe('A')], instant);
          await run(dom, 4);
          let out: Outcome | null = null;
          await quiet(async () => {
            out = track(film.exportVideo());
            await run(dom, 100);
          });
          ok(attempts > 45, `合成尝试次数不够:${attempts}`);
          equal((out as Outcome | null)?.state, 'pending', `累计失败被当成连续失败:${(out as Outcome | null)?.message}`);
          film();
        },
        {
          // 第 1~20 次失败,第 21 次成功,第 22~41 次再失败(每段都不到 31 次),之后恢复。
          throwOnDraw: () => {
            attempts += 1;
            return attempts !== 21 && attempts <= 41;
          },
        },
      );
    },
  ],
  [
    '看门狗端到端:轨道结束报 track-ended;来过数据后断供报 stalled',
    () =>
      withExportStub(
        async ({ dom, ex, canvas }) => {
          const film = runFilm(canvas, [probe('A')], { transition: 0 });
          await run(dom, 4);
          const out1 = track(film.exportVideo());
          await run(dom, 4);
          ex.setTrack({ readyState: 'ended' });
          await run(dom, 70);
          equal(out1.code, 'track-ended', out1.message);
          ex.setTrack({ readyState: 'live' });
          const out2 = track(film.exportVideo());
          await run(dom, 4);
          ex.emitChunk(50_000);
          await run(dom, 600);
          equal(out2.code, 'stalled', out2.message);
          film();
        },
        { exposeTrack: true },
      ),
  ],
  [
    '成片字幕与直播字幕同一套样式:自定义颜色/底色同时出现在 DOM 与导出帧里',
    () =>
      withExportStub(async ({ dom, ex, canvas }) => {
        const seg = probe('A', [], 3, { subtitles: [{ start: 0, end: 3, text: '字幕' }] });
        const film = runFilm(canvas, [seg], {
          ...instant,
          subtitleStyle: { color: '#ff0', background: '#003' },
        });
        await run(dom, 4);
        track(film.exportVideo());
        await run(dom, 4);
        const box = ex.findByAttr('aria-hidden', 'true');
        equal(box?.style['color'], '#ff0');
        equal(box?.style['background'], '#003');
        const ops = ex.exportOps();
        equal(ops.find((o) => o.op === 'roundRect')?.fillStyle, '#003', '导出字幕底色不对');
        equal(ops.find((o) => o.op === 'fillText')?.fillStyle, '#ff0', '导出字幕文字色不对');
        film();
      }),
  ],
  [
    '成片字幕的行距与折行宽度跟直播字幕条同源:行距 = DOM 的字号 × 行高,折行宽度 = 画面宽 × 80%',
    () =>
      withExportStub(async ({ dom, ex, canvas }) => {
        // 假 ctx 每字 8px;1280 宽的画面 80% 是 1024px = 128 字。
        const text = '长'.repeat(150);
        const seg = probe('A', [], 3, { subtitles: [{ start: 0, end: 3, text }] });
        const film = runFilm(canvas, [seg], instant);
        await run(dom, 4);
        track(film.exportVideo());
        await run(dom, 4);
        const box = ex.findByAttr('aria-hidden', 'true');
        const lines = ex.exportOps().filter((o) => o.op === 'fillText').slice(0, 2);
        equal(lines.map((o) => o.text?.length).join(','), '128,22', '导出折行宽度不是画面宽的 80%');
        // 导出帧与画布等宽(css 1280 → 导出 1280),css 像素 = 导出像素。
        const liveLine = Number(box?.style['lineHeight']) * Number.parseFloat(box?.style['fontSize'] ?? '');
        const dy = (lines[1]?.args[1] ?? 0) - (lines[0]?.args[1] ?? 0);
        ok(liveLine > 0 && Math.abs(dy - liveLine) < 1e-6, `导出行距 ${dy} ≠ 直播行距 ${liveLine}`);
        film();
      }),
  ],
  [
    '已经在导出时再点导出报 busy;销毁播放器以 disposed 中止导出',
    () =>
      withExportStub(async ({ dom, canvas }) => {
        const film = runFilm(canvas, [probe('A')], instant);
        await run(dom, 4);
        const first = track(film.exportVideo());
        const second = track(film.exportVideo());
        await dom.flush();
        equal(second.code, 'busy');
        film();
        await dom.flush();
        equal(first.code, 'disposed');
        const late = track(film.exportVideo());
        await dom.flush();
        equal(late.code, 'disposed');
      }),
  ],
  [
    '所有分段都起不来时以 segments-failed 收尾;第 0 段坏了就从第一个起得来的段开录',
    () =>
      withExportStub(async ({ dom, ex, canvas }) => {
        const log: string[] = [];
        await quiet(async () => {
          const dead = runFilm(canvas, [broken('X', log), broken('Y', log)], instant);
          await run(dom, 2);
          const out = track(dead.exportVideo());
          await run(dom, 4);
          equal(out.code, 'segments-failed');
          dead();
        });
        await quiet(async () => {
          const good = probe('S1', log);
          const film = runFilm(canvas, [broken('S0', log), good], instant);
          await run(dom, 4);
          const out = track(film.exportVideo());
          await run(dom, 80);
          equal(ex.starts(), 1, '应当从 S1 开录');
          good.finish();
          await run(dom, 6);
          equal(out.state, 'resolved', `第 0 段坏掉时导出没收尾:${out.message}`);
          film();
        });
      }),
  ],
  [
    '实时录制带配音:播放器的配音音轨并进录制的媒体流(带音频码率);收尾后断开录制音轨,但不停掉它',
    () =>
      withExportStub(async ({ dom, ex, canvas }) => {
        const audio = fakeLiveAudio();
        const seg = voicedProbe('A');
        const film = runFilm(canvas, [seg], { ...instant, audio: { env: audio.env } });
        await run(dom, 4);
        equal(film.getState().audio.available, true);
        const out = track(film.exportVideo({ mode: 'realtime' }));
        ok(ex.streamTracks().includes(audio.track), '配音音轨没有并进录制的媒体流');
        equal(ex.recorderOptions()[0]?.['audioBitsPerSecond'], 128_000, '带配音时录制器应设音频码率');
        equal(film.getState().audio.enabled, true, '导出按钮的点击顺带打开声音');
        await run(dom, 30);
        seg.finish();
        await run(dom, 6);
        equal(out.state, 'resolved', `导出没有交付:${out.message}`);
        equal(audio.trackStops(), 0, '配音音轨归播放器管,录制器不该停它');
        ok(audio.disconnected() >= 1, '收尾后应断开录制用的音轨');
        film();
      }),
  ],
  [
    '实时录制 audio:false:不接配音音轨,录制器不设音频码率',
    () =>
      withExportStub(async ({ dom, ex, canvas }) => {
        const audio = fakeLiveAudio();
        const seg = voicedProbe('A');
        const film = runFilm(canvas, [seg], { ...instant, audio: { env: audio.env } });
        await run(dom, 4);
        const out = track(film.exportVideo({ mode: 'realtime', audio: false }));
        ok(!ex.streamTracks().includes(audio.track), 'audio:false 不该接配音音轨');
        equal(ex.recorderOptions()[0]?.['audioBitsPerSecond'], undefined);
        film();
        await dom.flush();
        equal(out.code, 'disposed');
      }),
  ],
  [
    '成片进度条与直播进度条同源:填充宽度逐帧一致,章名用同一套颜色、字号与 DOM 继承到的字体',
    () =>
      withExportStub(async ({ dom, ex, canvas }) => {
        const a = probe('A', [], 2, { marker: 'chapter', chapter: '甲' });
        const b = probe('B', [], 2);
        const film = runFilm(canvas, [a, b], {
          ...instant,
          progressStyle: { color: '#f00', background: '#0f0' },
        });
        await run(dom, 4);
        track(film.exportVideo({ mode: 'realtime' }));
        await run(dom, 4);
        const fill = domFill(ex);
        ok(fill !== undefined, '没找到 DOM 进度条的填充块');
        // 画布 css 宽 1280 = 导出宽 1280:css 像素 = 导出像素,进度条贴着导出帧底边(高 3)。
        for (const [elapsed, width, px] of [
          [1, '25.00%', 320],
          [1.5, '37.50%', 480],
        ] as const) {
          a.elapsed = elapsed;
          await run(dom, 4);
          equal(fill?.style['width'], width, `DOM 填充宽度不对(A 播到 ${elapsed}s)`);
          const rect = lastFill(ex.exportOps(), '#f00', 3);
          ok(rect !== undefined, '导出帧里没有进度条填充');
          equal(rect?.args.join(','), `0,717,${px},3`, `导出填充与 DOM ${width} 对不上`);
          equal(Math.round((Number.parseFloat(fill?.style['width'] ?? '') / 100) * 1280), rect?.args[2]);
        }
        const ops = ex.exportOps();
        ok(
          ops.some((o) => o.op === 'fillRect' && o.fillStyle === '#0f0' && o.args.join(',') === '0,717,1280,3'),
          '导出帧里没有自定义底色的轨道',
        );
        const label = ops.filter((o) => o.op === 'fillText' && o.text === '一 · 甲').at(-1);
        ok(label !== undefined, `导出帧里没有章名:${ops.filter((o) => o.op === 'fillText').map((o) => o.text).join('|')}`);
        equal(label?.fillStyle, 'rgba(0,0,0,0.55)', '导出章名颜色不对');
        equal(label?.font, '14px serif', '导出章名应当用 DOM 章名的字号与继承到的字体');
        const domLabel = ex.created().find((el) => el.textContent === '一 · 甲');
        ok(domLabel?.style['cssText']?.includes('color:rgba(0,0,0,0.55)'), 'DOM 章名颜色与导出不一致');
        ok(domLabel?.style['cssText']?.includes('font-size:14px'), 'DOM 章名字号与导出不一致');
        film();
      }),
  ],
  [
    '画布缩放后成片进度条跟着 DOM 走:章名字号 = DOM 字号 × 导出比例,轨道按同一比例加粗',
    () =>
      withExportStub(async ({ dom, ex, canvas }) => {
        const ro = installResizeObserverStub();
        try {
          const a = probe('A', [], 2, { marker: 'chapter', chapter: '甲' });
          const film = runFilm(canvas, [a, probe('B', [], 2)], { ...instant, progressStyle: { color: '#f00' } });
          await run(dom, 4);
          track(film.exportVideo({ mode: 'realtime' }));
          await run(dom, 4);
          // css 宽 800、导出仍是 1280:css -> 导出比例 1.6;章名字号按 800 宽算是 10px。
          ro.resize(canvas as unknown as StubCanvas, 800, 450);
          const from = ex.exportOps().length;
          a.elapsed = 1;
          await run(dom, 4);
          const domLabel = ex.created().find((el) => el.textContent === '一 · 甲');
          equal(domLabel?.style['fontSize'], '10px', 'DOM 章名字号没跟着画布宽度变');
          const ops = ex.exportOps().slice(from);
          const label = ops.filter((o) => o.op === 'fillText' && o.text === '一 · 甲').at(-1);
          equal(label?.font, '16px serif', '导出章名字号应当是 DOM 字号 × 1.6');
          // 3px 轨道 × 1.6 = 4.8 -> 整像素 5;填充仍是全片的 25%。
          equal(lastFill(ops, '#f00', 5)?.args.join(','), '0,715,320,5', '导出填充没按比例缩放');
          equal(domFill(ex)?.style['width'], '25.00%');
          film();
        } finally {
          ro.restore();
        }
      }),
  ],
  [
    '悬停提示不进成片:导出期间在进度条上移动指针,DOM 提示照常出来,导出帧里没有「x / 总时长」',
    () =>
      withExportStub(async ({ dom, ex, canvas }) => {
        const a = probe('A', [], 2, { marker: 'chapter', chapter: '甲' });
        const film = runFilm(canvas, [a, probe('B', [], 2)], instant);
        await run(dom, 4);
        track(film.exportVideo({ mode: 'realtime' }));
        await run(dom, 4);
        const slider = ex.findByAttr('role', 'slider');
        ok(slider !== undefined, '没有进度条');
        const from = ex.exportOps().length;
        slider?.dispatch('pointermove', { clientX: 960 });
        const tip = ex.created().find((el) => el.textContent.includes(' / '));
        equal(tip?.textContent, 'B 0:03 / 0:04', 'DOM 悬停提示没出来');
        equal(tip?.style['display'], '', 'DOM 悬停提示没显示');
        await run(dom, 8);
        const after = ex.exportOps().slice(from);
        ok(after.some((o) => o.op === 'fillText' && o.text === '一 · 甲'), '悬停期间进度条应当照画');
        const leaked = ex.exportOps().filter((o) => o.op === 'fillText' && (o.text ?? '').includes(' / '));
        equal(leaked.map((o) => o.text).join('|'), '', '悬停提示被合成进了成片');
        film();
      }),
  ],
  [
    'FilmOptions.progress:false:没有 DOM 进度条,成片里也没有(不裁剪、不画轨道/填充/刻度)',
    () =>
      withExportStub(async ({ dom, ex, canvas }) => {
        const seg = probe('A', [], 2, { marker: 'chapter', chapter: '甲' });
        const film = runFilm(canvas, [seg, probe('B', [], 2)], { ...instant, progress: false });
        await run(dom, 4);
        equal(ex.findByAttr('role', 'slider'), undefined, 'progress:false 不该有 DOM 进度条');
        track(film.exportVideo({ mode: 'realtime' }));
        await run(dom, 4);
        seg.elapsed = 1;
        await run(dom, 8);
        const ops = ex.exportOps();
        ok(ex.composited() > 3, `没合成几帧:${ex.composited()}`);
        equal(barTraces(ops).join('|'), '', '播放器关了进度条,成片里却画了');
        equal(ops.filter((o) => o.op === 'fillText').length, 0, '成片里不该有章名');
        film();
      }),
  ],
  [
    'exportVideo({ progress:false }):只关成片里的进度条,DOM 进度条照常在、照常走',
    () =>
      withExportStub(async ({ dom, ex, canvas }) => {
        const seg = probe('A');
        const film = runFilm(canvas, [seg], instant);
        await run(dom, 4);
        // 对照:缺省导出画进度条(默认轨道色确实用上了)。
        const first = film.exportVideo({ mode: 'realtime' });
        const firstOut = track(first);
        await run(dom, 8);
        ok(
          ex.exportOps().some((o) => o.op === 'fillRect' && o.fillStyle === 'rgba(0,0,0,0.12)'),
          '缺省导出应当画进度条轨道',
        );
        first.cancel();
        await dom.flush();
        equal(firstOut.code, 'cancelled');
        const from = ex.exportOps().length;
        const out = track(film.exportVideo({ mode: 'realtime', progress: false }));
        await run(dom, 4);
        seg.elapsed = 0.5;
        await run(dom, 8);
        const slider = ex.findByAttr('role', 'slider');
        ok(slider !== undefined && !slider.removed, 'DOM 进度条应当还在');
        equal(slider?.getAttribute('aria-disabled'), 'true', '实时录制期间进度条照常锁定');
        equal(domFill(ex)?.style['width'], '50.00%', 'DOM 进度条应当照常走');
        const ops = ex.exportOps().slice(from);
        ok(ops.some((o) => o.op === 'drawImage'), '第二次导出没合成');
        equal(barTraces(ops).join('|'), '', 'progress:false 的成片里画了进度条');
        equal(out.state, 'pending', out.message);
        film();
      }),
  ],
  [
    '实时录制的配音报告:片子没配音 -> none;audio:false -> off(开录时与收带后一致)',
    async () => {
      await withExportStub(async ({ dom, canvas }) => {
        const seg = probe('A');
        const film = runFilm(canvas, [seg], instant);
        await run(dom, 4);
        const r = await recordAudio(dom, film, [seg]);
        equal(r.out.state, 'resolved', r.out.message);
        equal(r.before.status, 'none');
        equal(r.atDone?.status, 'none');
        film();
      });
      await withExportStub(async ({ dom, canvas }) => {
        const audio = fakeLiveAudio();
        const seg = voicedProbe('A');
        const film = runFilm(canvas, [seg], { ...instant, audio: { env: audio.env } });
        await run(dom, 4);
        const r = await recordAudio(dom, film, [seg], { audio: false });
        equal(r.out.state, 'resolved', r.out.message);
        equal(r.before.status, 'off');
        equal(r.atDone?.status, 'off');
        film();
      });
    },
  ],
  [
    '实时录制带配音:报告 included,音轨编码取编码器实际选用的类型(AAC),不附播放提示',
    () =>
      withExportStub(
        async ({ dom, canvas }) => {
          const audio = fakeLiveAudio();
          const seg = voicedProbe('A');
          const film = runFilm(canvas, [seg], { ...instant, audio: { env: audio.env } });
          await run(dom, 4);
          const r = await recordAudio(dom, film, [seg]);
          equal(r.handle.mimeType, 'video/mp4;codecs=avc1,mp4a.40.2', '带配音时应当先钉 MP4 + AAC');
          // 声音真没真在出要到收带才定论(resume 是异步的):开录时只能说「还没定」。
          equal(r.before.status, 'pending');
          equal(r.out.state, 'resolved', r.out.message);
          equal(r.out.type, 'video/mp4;codecs=avc1.64001f,mp4a.40.2');
          equal(r.atDone?.status, 'included');
          equal(r.atDone?.codec, 'aac');
          equal(r.atDone?.note, undefined, 'AAC 不需要播放提示');
          equal(r.atDone?.reason, undefined);
          equal(r.atDone?.failed, undefined);
          // 定论在收带那一刻快照:之后上下文被挂起 / 关掉,都不该把已经交付的成片改判成没声音。
          audio.setState('closed');
          equal(r.handle.audio.status, 'included', '收带之后的报告被上下文状态改写了');
          film();
        },
        { recorderMimeType: 'video/mp4;codecs=avc1.64001f,mp4a.40.2' },
      ),
  ],
  [
    '实时录制带配音:MP4 里是 Opus 时报 codec opus 并附 QuickTime 播放提示;WebM 里的 Opus 不提示',
    async () => {
      for (const [mime, note] of [
        ['video/mp4;codecs=avc1,opus', OPUS_IN_MP4_NOTE],
        ['video/webm;codecs=vp9,opus', undefined],
      ] as const) {
        await withExportStub(
          async ({ dom, canvas }) => {
            const audio = fakeLiveAudio();
            const seg = voicedProbe('A');
            const film = runFilm(canvas, [seg], { ...instant, audio: { env: audio.env } });
            await run(dom, 4);
            const r = await recordAudio(dom, film, [seg]);
            equal(r.out.state, 'resolved', r.out.message);
            equal(r.out.type, mime);
            equal(r.before.status, 'pending', `${mime} 开录时还没定论`);
            equal(r.atDone?.status, 'included', mime);
            equal(r.atDone?.codec, 'opus', mime);
            equal(r.atDone?.note, note, `${mime} 的播放提示不对`);
            equal(r.atDone?.reason, undefined, `${mime}:included 不该有原因`);
            film();
          },
          { recorderMimeType: mime },
        );
      }
    },
  ],
  [
    '实时录制带配音:有配音文件取不到时报 partial,failed 只列取不到的那个地址',
    () =>
      withExportStub(async ({ dom, canvas }) => {
        const audio = fakeLiveAudio({
          fetch: (url) =>
            url === 'A.wav' ? Promise.reject(new Error('404')) : new Promise<ArrayBuffer>(() => undefined),
        });
        const a = voicedProbe('A');
        const b = voicedProbe('B');
        const film = runFilm(canvas, [a, b], { ...instant, audio: { env: audio.env } });
        await run(dom, 4);
        let r: AudioRun | null = null;
        await quiet(async () => {
          r = await recordAudio(dom, film, [a, b]);
        });
        const got = r as AudioRun | null;
        // 开录那一刻加载失败还没落定(取文件是异步的),声音在不在出也要到收带才定论。
        equal(got?.before.status, 'pending', `开录时的报告不合理:${got?.before.status}`);
        equal(got?.out.state, 'resolved', got?.out.message);
        equal(got?.atDone?.status, 'partial');
        equal(got?.atDone?.failed?.join('|'), 'A.wav');
        equal(got?.atDone?.codec, 'aac');
        ok((got?.atDone?.reason ?? '') !== '', 'partial 应当带原因');
        film();
      }),
  ],
  [
    '实时录制带配音:音频上下文没在跑(浏览器没允许出声)时报 dropped 并说明原因,成片照常交付',
    () =>
      withExportStub(async ({ dom, canvas }) => {
        const audio = fakeLiveAudio({ state: 'suspended' });
        const seg = voicedProbe('A');
        const film = runFilm(canvas, [seg], { ...instant, audio: { env: audio.env } });
        await run(dom, 4);
        let r: AudioRun | null = null;
        await quiet(async () => {
          r = await recordAudio(dom, film, [seg]);
        });
        const got = r as AudioRun | null;
        // resume() 是异步的,开录那一刻的 suspended 不能当定论(否则每次首次录制都误报):收带时才判。
        equal(got?.before.status, 'pending', '开录时不该凭一瞬间的 suspended 下结论');
        equal(got?.out.state, 'resolved', `画面是好的,导出应当照常交付:${got?.out.message}`);
        equal(got?.atDone?.status, 'dropped');
        ok((got?.atDone?.reason ?? '').includes('挂起'), `原因没说清:${got?.atDone?.reason}`);
        equal(got?.atDone?.codec, undefined, 'dropped 不该报音轨编码');
        film();
      }),
  ],
  [
    '实时录制带配音:接不上录制音轨(没有 createMediaStreamDestination / 建不出上下文 / 没有 Web Audio)都报 dropped',
    async () => {
      const cases: Array<[string, FakeLiveAudioOptions | null, ExportStubOptions?]> = [
        ['没有 createMediaStreamDestination', { streamDestination: false }],
        ['建不出音频上下文', { noContext: true }],
        // null:不注入 env,node 里没有 AudioContext,播放器拿不到任何播放环境。
        ['没有 Web Audio', null],
        ['录制流加不了音轨', {}, { noAddTrack: true }],
      ];
      for (const [name, opts, stubOptions] of cases) {
        await withExportStub(async ({ dom, ex, canvas }) => {
          const audio = opts ? fakeLiveAudio(opts) : null;
          const seg = voicedProbe('A');
          const film = runFilm(canvas, [seg], { ...instant, ...(audio ? { audio: { env: audio.env } } : {}) });
          await run(dom, 4);
          let r: AudioRun | null = null;
          await quiet(async () => {
            r = await recordAudio(dom, film, [seg]);
          });
          const got = r as AudioRun | null;
          equal(ex.streamTracks().length, 1, `${name}:流里只该有视频轨道`);
          equal(ex.recorderOptions()[0]?.['audioBitsPerSecond'], undefined, `${name}:没有音轨不该设音频码率`);
          equal(got?.before.status, 'dropped', `${name}:开录时`);
          equal(got?.out.state, 'resolved', `${name}:${got?.out.message}`);
          equal(got?.atDone?.status, 'dropped', `${name}:收带后`);
          ok((got?.atDone?.reason ?? '') !== '', `${name}:dropped 应当带原因`);
          if (!opts) {
            ok((got?.atDone?.reason ?? '').includes('Web Audio'), `没有 Web Audio 时原因不对:${got?.atDone?.reason}`);
          }
          film();
        }, stubOptions);
      }
    },
  ],
  [
    '声音早就开着、上下文后来被系统挂起:导出的点击会再唤醒它,成片带上配音(报告 included)',
    () =>
      withExportStub(async ({ dom, canvas }) => {
        const audio = fakeLiveAudio({ state: 'suspended', resumable: true });
        const seg = voicedProbe('A');
        const film = runFilm(canvas, [seg], { ...instant, audio: { env: audio.env } });
        await run(dom, 4);
        film.setAudioEnabled(true);
        await run(dom, 2);
        equal(film.getState().audio.enabled, true);
        // 切后台 / 换输出设备之类:上下文被系统挂起,但播放器记得声音是开着的。
        audio.setState('suspended');
        const resumesBefore = audio.resumes();
        let r: AudioRun | null = null;
        await quiet(async () => {
          r = await recordAudio(dom, film, [seg]);
        });
        const got = r as AudioRun | null;
        ok(audio.resumes() > resumesBefore, '导出没有借这次点击唤醒音频上下文');
        equal(got?.out.state, 'resolved', got?.out.message);
        equal(got?.atDone?.status, 'included', `上下文被唤醒后应当带上配音:${got?.atDone?.reason}`);
        film();
      }),
  ],
  [
    '实时录制期间关声音被忽略(声音就是成片的音轨,关掉会录成静音);录完照常能关',
    () =>
      withExportStub(async ({ dom, canvas }) => {
        const audio = fakeLiveAudio();
        const seg = voicedProbe('A');
        const film = runFilm(canvas, [seg], { ...instant, audio: { env: audio.env } });
        await run(dom, 4);
        const handle = film.exportVideo({ mode: 'realtime' });
        equal(film.getState().audio.enabled, true, '实时录制应当打开声音');
        film.setAudioEnabled(false);
        equal(film.getState().audio.enabled, true, '录制期间关声音应被忽略');
        const box: { atDone: ExportAudioReport | null } = { atDone: null };
        handle.done.then(
          () => {
            box.atDone = handle.audio;
          },
          () => undefined,
        );
        const out = track(handle);
        await run(dom, 30);
        seg.finish();
        await run(dom, 6);
        equal(out.state, 'resolved', out.message);
        equal(box.atDone?.status, 'included');
        film.setAudioEnabled(false);
        equal(film.getState().audio.enabled, false, '录完之后应当照常能关声音');
        film();
      }),
  ],
  [
    '实时录制前重试预览时失败过的配音:预览时取不到、导出时取得到 → 成片 included,不报缺失',
    () =>
      withExportStub(async ({ dom, canvas }) => {
        const env = fakeLiveEnv({ 'A.wav': fakeAudio(1) });
        const audioTrack = { kind: 'audio', stop: () => undefined } as unknown as MediaStreamTrack;
        const destination = { stream: { getAudioTracks: () => [audioTrack] } as unknown as MediaStream };
        Object.assign(env.ctx, { createMediaStreamDestination: () => destination });
        const baseFetch = env.fetch;
        let fetches = 0;
        env.fetch = (url: string) => {
          fetches += 1;
          return fetches === 1 ? Promise.reject(new Error('断网')) : baseFetch(url);
        };
        const seg = voicedProbe('A');
        const film = runFilm(canvas, [seg], { ...instant, audio: { env } });
        await run(dom, 4);
        await quiet(async () => {
          film.setAudioEnabled(true);
          await run(dom, 4);
        });
        equal(fetches, 1, '前提:预览时取过一次并失败了');
        const r = await recordAudio(dom, film, [seg]);
        equal(fetches, 2, '实时录制前应当重试失败过的配音');
        equal(r.out.state, 'resolved', r.out.message);
        equal(r.atDone?.status, 'included', `${r.atDone?.status} ${r.atDone?.reason ?? ''}`);
        equal(r.atDone?.failed, undefined);
        film();
      }),
  ],
  [
    '实时录制建不起来(容器录不了)时断开已经接出来的录制音轨,不留着挂在声音链上',
    () =>
      withExportStub(
        async ({ dom, canvas }) => {
          const audio = fakeLiveAudio();
          const seg = voicedProbe('A');
          const film = runFilm(canvas, [seg], { ...instant, audio: { env: audio.env } });
          await run(dom, 4);
          const out = track(film.exportVideo({ mode: 'realtime', mimeType: 'video/webm' }));
          await run(dom, 2);
          equal(out.state, 'rejected');
          equal(out.code, 'unsupported-mime');
          equal(audio.disconnected(), 1, '录制音轨没有断开');
          film();
        },
        { supportedTypes: ['video/mp4'] },
      ),
  ],
  [
    '进度条用 CSS 变量上色:成片用浏览器解析后的颜色(画布认不得 var()),与预览一致',
    () =>
      withExportStub(async ({ dom, ex, canvas }) => {
        const g = globalThis as unknown as Record<string, unknown>;
        const saved = g['getComputedStyle'] as (el: StubElement) => Record<string, unknown>;
        const resolved: Record<string, string> = { 'var(--brand)': 'rgb(1, 2, 3)', 'var(--track)': 'rgb(4, 5, 6)' };
        g['getComputedStyle'] = (el: StubElement) => {
          const bg = /background:([^;]+);/.exec(el.style['cssText'] ?? '')?.[1];
          return { ...saved(el), ...(bg !== undefined ? { backgroundColor: resolved[bg] ?? bg } : {}) };
        };
        try {
          const a = probe('A', [], 2);
          const film = runFilm(canvas, [a], {
            ...instant,
            progressStyle: { color: 'var(--brand)', background: 'var(--track)' },
          });
          await run(dom, 4);
          track(film.exportVideo({ mode: 'realtime' }));
          await run(dom, 4);
          a.elapsed = 1;
          await run(dom, 4);
          const ops = ex.exportOps();
          equal(lastFill(ops, 'rgb(1, 2, 3)', 3)?.args.join(','), '0,717,640,3', '填充应当用解析后的颜色');
          ok(
            ops.some((o) => o.op === 'fillRect' && o.fillStyle === 'rgb(4, 5, 6)' && o.args.join(',') === '0,717,1280,3'),
            '轨道应当用解析后的颜色',
          );
          ok(!ops.some((o) => String(o.fillStyle).startsWith('var(')), '画布拿到了认不得的 var()');
          film();
        } finally {
          g['getComputedStyle'] = saved;
        }
      }),
  ],
]);
