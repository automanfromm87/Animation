import { createExportStub } from '../testing/exportStub';
import type { ExportOp, ExportStub, ExportStubOptions } from '../testing/exportStub';
import { equal, ok, quiet, suite } from '../testing/harness';
import type { ProgressVisual } from './composite';
import { ExportRecorder, browserRecorderEnv } from './recorder';
import type { ExportRecorderInit, RecorderFrame } from './recorder';
import type { ExportOptions } from './types';
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
  const frame: RecorderFrame = { veilAlpha: 0, subtitle: null, progress: null, position: 0 };
  return {
    ex,
    rec,
    tick(dtMs = 34) {
      now += dtMs;
      rec.tick(now, frame);
    },
  };
}

/** 直接建一个录制器(1280×720,css 宽 1280),extra 覆盖/补充初始化参数。 */
function make(ex: ExportStub, extra: Partial<ExportRecorderInit> = {}): ExportRecorder {
  return ExportRecorder.create({
    main: { width: 1280, height: 720 } as HTMLCanvasElement,
    mainCssWidth: () => 1280,
    veilColor: '#fff',
    total: 10,
    env: ex.env,
    ...extra,
  });
}

/** 取消并吞掉 reject(用例只看创建时的状态)。 */
async function discard(rec: ExportRecorder): Promise<void> {
  rec.cancel();
  await rec.done.catch(() => undefined);
}

function fakeAudioTrack(): MediaStreamTrack {
  return { kind: 'audio', stop: () => undefined } as unknown as MediaStreamTrack;
}

/** 一条好认的进度条:每个部件一种颜色。 */
const BAR: ProgressVisual = {
  position: 'bottom',
  blockPx: 38,
  trackPx: 3,
  color: '#f00',
  background: '#0f0',
  tickColor: '#00f',
  tickWidthPx: 2,
  tickPx: 8,
  chapterTickPx: 14,
  labelPx: 14,
  labelOffsetPx: 20,
  labelGapPx: 6,
  labelColor: '#123',
  labelFontFamily: 'serif',
  ticks: [
    { frac: 0, chapter: true, label: '一 · 甲' },
    { frac: 0.5, chapter: false, label: null },
  ],
};

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
      const frame: RecorderFrame = { veilAlpha: 0, subtitle: null, progress: null, position: 0 };
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
      const frame: RecorderFrame = { veilAlpha: 0, subtitle: null, progress: null, position: 0 };
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
  [
    'audio 标记:配音音轨并进了捕获流才为 true;没给音轨、或捕获流加不了音轨时为 false',
    async () => {
      const withTrack = make(createExportStub(), { audioTrack: fakeAudioTrack() });
      equal(withTrack.audio, true, '音轨加进去了,audio 应为 true');
      const plain = make(createExportStub());
      equal(plain.audio, false, '没给音轨,audio 应为 false');
      let noAdd: ExportRecorder | null = null;
      await quiet(() => {
        noAdd = make(createExportStub({ noAddTrack: true }), { audioTrack: fakeAudioTrack() });
      });
      const rec = noAdd as ExportRecorder | null;
      equal(rec?.audio, false, '捕获流加不了音轨,audio 应为 false');
      for (const r of [withTrack, plain, rec]) {
        if (r) {
          await discard(r);
        }
      }
    },
  ],
  [
    'outputType 优先取编码器实际选用的类型;编码器报空串时退回选定的 mimeType',
    async () => {
      const actual = make(createExportStub({ recorderMimeType: 'video/mp4;codecs=avc1.64001f,mp4a.40.2' }), {
        audioTrack: fakeAudioTrack(),
      });
      equal(actual.mimeType, 'video/mp4;codecs=avc1,mp4a.40.2');
      equal(actual.outputType, 'video/mp4;codecs=avc1.64001f,mp4a.40.2', '应当取编码器实际选用的类型');
      const blank = make(createExportStub({ recorderMimeType: '' }));
      equal(blank.outputType, blank.mimeType, '编码器没报类型时应退回选定值');
      equal(blank.outputType, 'video/mp4');
      await discard(actual);
      await discard(blank);
    },
  ],
  [
    'options.progress:false:帧里给了进度条也不画;缺省照画(轨道、填充、刻度、章名)',
    () => {
      const drawn = (options?: ExportOptions): ExportOp[] => {
        const ex = createExportStub();
        let now = 5000;
        const rec = make(ex, { now: () => now, ...(options ? { options } : {}) });
        rec.start();
        const frame: RecorderFrame = {
          veilAlpha: 0,
          subtitle: null,
          progress: { value: 0.5, visual: BAR },
          position: 5,
        };
        for (let i = 0; i < 3; i++) {
          now += 34;
          rec.tick(now, frame);
        }
        equal(ex.composited(), 3, '每 34ms 应当合成一帧');
        rec.cancel();
        rec.done.catch(() => undefined);
        return ex.exportOps();
      };
      const on = drawn();
      const rects = (ops: ExportOp[]): string[] =>
        ops.filter((o) => o.op === 'fillRect').map((o) => `${String(o.fillStyle)}@${o.args.join(',')}`);
      // 1280×720、css 宽 1280:scale 1,进度条贴底边。
      const onRects = rects(on);
      ok(onRects.includes('#0f0@0,717,1280,3'), `缺省应当画轨道:${onRects.join(' ')}`);
      ok(onRects.includes('#f00@0,717,640,3'), `缺省应当画一半的填充:${onRects.join(' ')}`);
      ok(onRects.includes('#f00@0,706,2,14'), `缺省应当画章节刻度:${onRects.join(' ')}`);
      ok(onRects.includes('#00f@640,712,2,8'), `缺省应当画普通刻度:${onRects.join(' ')}`);
      const label = on.find((o) => o.op === 'fillText');
      equal(label?.text, '一 · 甲');
      equal(label?.font, '14px serif');
      equal(label?.fillStyle, '#123');
      equal(drawn({ progress: true }).filter((o) => o.op === 'clip').length, 3, 'progress:true 与缺省一样画');

      const off = drawn({ progress: false });
      ok(off.some((o) => o.op === 'drawImage'), 'progress:false 时主画面照常合成');
      const barColors = new Set(['#0f0', '#f00', '#00f', '#123']);
      const leaked = off.filter(
        (o) => o.op === 'clip' || o.op === 'fillText' || (o.op === 'fillRect' && barColors.has(String(o.fillStyle))),
      );
      equal(leaked.map((o) => `${o.op}:${String(o.fillStyle)}`).join('|'), '', 'progress:false 仍画了进度条');
    },
  ],
  [
    '带配音时自动格式先钉 MP4 + AAC;显式的裸 video/mp4 也升级成带 AAC 的写法,其余显式格式与不带配音时不动',
    async () => {
      const cases: Array<{
        name: string;
        supported?: readonly string[];
        mimeType?: string;
        audio: boolean;
        want: string;
      }> = [
        { name: '自动 + 配音', audio: true, want: 'video/mp4;codecs=avc1,mp4a.40.2' },
        {
          name: '自动 + 配音(只认这两种)',
          supported: ['video/mp4', 'video/mp4;codecs=avc1,mp4a.40.2'],
          audio: true,
          want: 'video/mp4;codecs=avc1,mp4a.40.2',
        },
        { name: '自动 + 配音(不认 AAC 写法)', supported: ['video/mp4'], audio: true, want: 'video/mp4' },
        { name: '自动、无配音', audio: false, want: 'video/mp4' },
        { name: '显式 video/mp4 + 配音', mimeType: 'video/mp4', audio: true, want: 'video/mp4;codecs=avc1,mp4a.40.2' },
        { name: '显式 video/mp4、无配音', mimeType: 'video/mp4', audio: false, want: 'video/mp4' },
        { name: '显式 webm + 配音', mimeType: 'video/webm', audio: true, want: 'video/webm' },
      ];
      for (const c of cases) {
        const ex = createExportStub(c.supported ? { supportedTypes: c.supported } : undefined);
        const rec = make(ex, {
          ...(c.audio ? { audioTrack: fakeAudioTrack() } : {}),
          ...(c.mimeType !== undefined ? { options: { mimeType: c.mimeType } } : {}),
        });
        equal(rec.mimeType, c.want, `${c.name}:选错了格式`);
        equal(ex.recorderOptions()[0]?.['mimeType'], c.want, `${c.name}:交给编码器的格式不对`);
        await discard(rec);
      }
    },
  ],
]);
