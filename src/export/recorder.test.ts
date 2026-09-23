import { createExportStub } from '../testing/exportStub';
import type { ExportStub, ExportStubOptions } from '../testing/exportStub';
import { equal, ok, suite } from '../testing/harness';
import { ExportRecorder, browserRecorderEnv } from './recorder';
import type { RecorderFrame } from './recorder';
import { isFilmError } from './types';

/**
 * 录制器单测:环境与时钟全部注入,不改写任何全局(document / MediaRecorder / performance)。
 */
interface Rig {
  ex: ExportStub;
  rec: ExportRecorder;
  /** 推进注入时钟并 tick 一帧。 */
  tick(dtMs?: number): void;
}

function rig(options?: ExportStubOptions): Rig {
  const ex = createExportStub(options);
  let now = 5000;
  const rec = ExportRecorder.create({
    main: { width: 1280, height: 720 } as HTMLCanvasElement,
    mainCssWidth: () => 1280,
    veilColor: '#fff',
    total: 10,
    env: ex.env,
    now: () => now,
  });
  const frame: RecorderFrame = { veilAlpha: 0, subtitle: null, position: 0 };
  return {
    ex,
    rec,
    tick(dtMs = 34) {
      now += dtMs;
      rec.tick(now, frame);
    },
  };
}

export default suite('导出录制器', [
  [
    '注入环境:不碰全局也能创建、开录、合成并交付成片',
    async () => {
      equal(typeof document, 'undefined', '这条用例要在没有 DOM 全局的环境里跑');
      const { ex, rec, tick } = rig();
      rec.start();
      for (let i = 0; i < 12; i++) {
        tick();
      }
      equal(ex.composited(), 12);
      rec.finish(true);
      const blob = await rec.done;
      ok(blob.size > 0, '成片是空的');
      equal(ex.tracksStopped(), 1, '捕获轨道没停');
      ok(ex.exportCanvasRemoved(), '导出画布没摘');
    },
  ],
  [
    '没有录制能力的环境:不传 env 时按 unsupported 同步抛错',
    () => {
      equal(browserRecorderEnv(), null);
      let error: unknown = null;
      try {
        ExportRecorder.create({
          main: { width: 1280, height: 720 } as HTMLCanvasElement,
          mainCssWidth: () => 1280,
          veilColor: '#fff',
          total: 10,
        });
      } catch (e) {
        error = e;
      }
      ok(isFilmError(error, 'unsupported'), `应当以 unsupported 同步抛错:${String(error)}`);
    },
  ],
  [
    '片尾收带只在已开录时生效:还在等开录时片尾到了不交出空视频',
    () => {
      const { ex, rec } = rig();
      // 这条只看收不收带;没合成几帧,成片校验会 reject,别让它成为未处理拒绝。
      rec.done.catch(() => undefined);
      ok(rec.armed);
      rec.endOfPass();
      ok(rec.armed, '还没开录就被收带了');
      equal(ex.stops(), 0);
      rec.start();
      ok(rec.recording);
      rec.endOfPass();
      ok(!rec.recording, '已开录时片尾应当收带');
      equal(ex.stops(), 1);
    },
  ],
  [
    '切后台经注入的可见性订阅中止,收尾后退订',
    async () => {
      const { ex, rec } = rig();
      rec.start();
      equal(ex.docListenerCount('visibilitychange'), 1);
      ex.setHidden(true);
      let code = '';
      await rec.done.catch((e: unknown) => {
        code = isFilmError(e) ? e.code : 'other';
      });
      equal(code, 'hidden');
      equal(ex.docListenerCount('visibilitychange'), 0, '可见性监听没退订');
    },
  ],
  [
    '成片时长按注入的时钟算:从 0 开始的时钟也不会被当成「没开录」',
    async () => {
      const ex = createExportStub({ chunkSize: 1024 });
      let now = 0;
      const rec = ExportRecorder.create({
        main: { width: 1280, height: 720 } as HTMLCanvasElement,
        mainCssWidth: () => 1280,
        veilColor: '#fff',
        total: 10,
        env: ex.env,
        now: () => now,
      });
      rec.start();
      const frame: RecorderFrame = { veilAlpha: 0, subtitle: null, position: 0 };
      // 录 5 秒、只交 1KB:成片字节远低于下限,必须判成编码器断供(时长没被算成 0)。
      for (let i = 0; i < 150; i++) {
        now += 34;
        rec.tick(now, frame);
      }
      rec.finish(true);
      let code = '';
      await rec.done.catch((e: unknown) => {
        code = isFilmError(e) ? e.code : 'other';
      });
      equal(code, 'encoder-starved');
    },
  ],
  [
    '带配音音轨:并进捕获流、录制器带音频码率、自动格式换成带 Opus 的;收尾只停自己的轨道,不停播放器的音轨',
    async () => {
      const ex = createExportStub({ supportedTypes: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9'] });
      let audioStops = 0;
      const audioTrack = {
        kind: 'audio',
        stop: () => {
          audioStops += 1;
        },
      } as unknown as MediaStreamTrack;
      let now = 5000;
      const rec = ExportRecorder.create({
        main: { width: 1280, height: 720 } as HTMLCanvasElement,
        mainCssWidth: () => 1280,
        veilColor: '#fff',
        total: 10,
        env: ex.env,
        now: () => now,
        audioTrack,
      });
      ok(ex.streamTracks().includes(audioTrack), '配音音轨没有并进捕获流');
      equal(ex.recorderOptions()[0]?.['audioBitsPerSecond'], 128_000);
      equal(rec.mimeType, 'video/webm;codecs=vp9,opus', '带配音时应选带 Opus 的格式');
      rec.start();
      const frame: RecorderFrame = { veilAlpha: 0, subtitle: null, position: 0 };
      for (let i = 0; i < 12; i++) {
        now += 34;
        rec.tick(now, frame);
      }
      rec.finish(true);
      await rec.done;
      equal(ex.tracksStopped(), 1, '捕获的视频轨道应当停掉');
      equal(audioStops, 0, '配音音轨归播放器管,录制器不该停它');

      const plain = createExportStub({ supportedTypes: ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp9'] });
      const noAudio = ExportRecorder.create({
        main: { width: 1280, height: 720 } as HTMLCanvasElement,
        mainCssWidth: () => 1280,
        veilColor: '#fff',
        total: 10,
        env: plain.env,
      });
      equal(noAudio.mimeType, 'video/webm;codecs=vp9', '没有配音时候选不变');
      equal(plain.recorderOptions()[0]?.['audioBitsPerSecond'], undefined, '没有配音不该设音频码率');
      noAudio.cancel();
      await noAudio.done.catch(() => undefined);
    },
  ],
  [
    '捕获流加不了音轨:照常录画面(不带音频码率),提示一次',
    async () => {
      const ex = createExportStub({ noAddTrack: true });
      const warnings: unknown[] = [];
      const { warn } = console;
      console.warn = (...args: unknown[]) => {
        warnings.push(args);
      };
      let rec: ExportRecorder;
      try {
        rec = ExportRecorder.create({
          main: { width: 1280, height: 720 } as HTMLCanvasElement,
          mainCssWidth: () => 1280,
          veilColor: '#fff',
          total: 10,
          env: ex.env,
          audioTrack: { kind: 'audio', stop: () => undefined } as unknown as MediaStreamTrack,
        });
      } finally {
        console.warn = warn;
      }
      equal(warnings.length, 1, '应当提示一次成片没有配音');
      equal(ex.recorderOptions()[0]?.['audioBitsPerSecond'], undefined);
      equal(ex.streamTracks().length, 1, '流里只有视频轨道');
      rec.cancel();
      await rec.done.catch(() => undefined);
    },
  ],
]);
