import type { LiveAudioContext, LiveAudioEnv } from '../audio/live';
import { installDomStub } from '../testing/domStub';
import type { DomStub, StubCanvas } from '../testing/domStub';
import { installExportStub, installResizeObserverStub } from '../testing/exportStub';
import type { ExportStub, ExportStubOptions } from '../testing/exportStub';
import { equal, ok, quiet, suite } from '../testing/harness';
import type { ExportHandle, FilmOptions, Segment, SegmentHandle } from './film';
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

/** 假的 Web Audio 播放环境:能建上下文、能把声音接出一条录制音轨;记下音轨被停、录制节点被断开的次数。 */
function fakeLiveAudio(): { env: LiveAudioEnv; track: MediaStreamTrack; trackStops(): number; disconnected(): number } {
  let trackStops = 0;
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
    state: 'running',
    destination: {},
    resume: () => Promise.resolve(),
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
    createMediaStreamDestination: () => destination,
  };
  return {
    env: {
      createContext: () => ctx,
      // 永远不回:测试里不真播声音,也不产生加载失败的告警。
      fetch: () => new Promise<ArrayBuffer>(() => undefined),
      hidden: () => false,
      onVisibilityChange: () => () => undefined,
    },
    track: audioTrack,
    trackStops: () => trackStops,
    disconnected: () => disconnected,
  };
}

/** 带一段配音的探针分段。 */
function voicedProbe(name: string): Probe {
  return probe(name, [], 1, {
    voice: { clips: [{ id: `${name}/1`, url: `${name}.wav`, start: 0, duration: 1, offset: 0 }] },
  });
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
]);
