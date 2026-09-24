import { Create, FadeIn, Indicate, Write, preloadAssets } from '../engine';
import { AssetError } from '../engine/assets/errors';
import { isAssetReady } from '../engine/assets/registry';
import type { OfflineEnv } from '../export/offlineEnv';
import { messageChannelYielder } from '../export/offlineEnv';
import { installAssetStub } from '../testing/assetStub';
import { createStubCanvas, flushTasks, installDomStub } from '../testing/domStub';
import type { StubCanvas } from '../testing/domStub';
import { createFakeCtx } from '../testing/fakeCtx';
import type { FakeCtxCall } from '../testing/fakeCtx';
import { equal, ok, suite } from '../testing/harness';
import { LOGO_IMAGE, LOGO_SVG, assetFilm } from './assetFilm.testutil';
import type { Segment } from './film';
import { directedSegment, isFilmError, runFilm } from './film';
import { hide, illustration, picture, stage, unrevealed } from './helpers';
import { ManualClock } from './offline';
import { previewFrameAt } from './preview';
import { runSegmentToEnd } from './voice';

/**
 * 影片层集成:资源预加载之后,分段脚本在虚拟时钟上重放(干跑、单帧预览、离线导出)时间线确定、
 * 画面逐帧一致;没预加载的分段以清楚的 AssetError 失败,而不是悄悄等网络把时间线拖歪。
 */

const CAT = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 80">
  <ellipse id="head" cx="50" cy="45" rx="35" ry="30" fill="#f59e0b" stroke="currentColor" stroke-width="3"/>
  <path id="ear-l" d="M20 30 L25 5 L40 20 Z" fill="#f59e0b"/>
  <path id="ear-r" d="M80 30 L75 5 L60 20 Z" fill="#f59e0b"/>
  <g id="face"><circle cx="38" cy="42" r="4"/><circle cx="62" cy="42" r="4"/>
  <path id="whisker" d="M20 55 H40 M60 55 H80" fill="none" stroke="currentColor" stroke-linecap="round"/></g>
</svg>`;

const ASSETS = { images: { '/img/earth.png': { width: 400, height: 200 } }, texts: { '/svg/cat.svg': CAT } };

/** 用路径字符串(预加载过)构造的分段:Create / Write / Indicate / FadeIn / wait,共 6 秒。 */
function catSegment(): Segment {
  return directedSegment('猫与地球', 6, [{ start: 0, end: 5, text: '插画与图片' }], async (env) => {
    const earth = picture('/img/earth.png', 300, { x: -200, y: 0 });
    const cat = illustration('/svg/cat.svg', 200, { x: 200, y: 0 });
    unrevealed(earth, cat);
    stage(env.scene, [earth, cat], 40);
    await env.play(new Create(earth, { runTime: 1.2 }));
    await env.play(new Create(cat, { runTime: 1.5 }));
    await env.play(new Indicate(cat.part('face'), { runTime: 1 }));
    const copy = illustration('/svg/cat.svg', 80, { x: 0, y: 150 });
    hide(copy);
    env.scene.add(copy);
    await env.play(new FadeIn(copy, { runTime: 0.3 }), new Write(copy, { runTime: 0.8 }));
    await env.wait(1.5);
  });
}

interface Recorded {
  canvas: StubCanvas & HTMLCanvasElement;
  calls: FakeCtxCall[];
}

function recordingCanvas(): Recorded {
  const canvas = createStubCanvas();
  const fake = createFakeCtx({ record: true });
  (canvas as unknown as { getContext: () => CanvasRenderingContext2D }).getContext = () => fake.ctx;
  return { canvas, calls: fake.calls };
}

/** 调用序列的可比较摘要(方法名 + 数字实参 + 字符串值;对象值只记桩地址)。 */
function signature(calls: readonly FakeCtxCall[]): string {
  return calls
    .map((c) => {
      const v = c.value;
      const value =
        typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'
          ? String(v)
          : v && typeof v === 'object' && 'stub' in v
            ? `stub:${String((v as { stub: unknown }).stub)}`
            : '';
      return `${c.op}(${c.args.map((a) => Math.round(a * 1e6) / 1e6).join(',')})${value}`;
    })
    .join('\n');
}

export default suite('film 资源集成', [
  [
    '重放确定性:预加载后干跑两遍,都跑完且时长一致(≈ 声明的 6 秒)',
    async () => {
      const stub = installAssetStub(ASSETS);
      try {
        await preloadAssets(['/img/earth.png', '/svg/cat.svg']);
        const seg = catSegment();
        const env = { createCanvas: () => createStubCanvas(), createYielder: messageChannelYielder };
        const a = await runSegmentToEnd(seg, env);
        const b = await runSegmentToEnd(seg, env);
        equal(a.error, null, `干跑报错:${String(a.error)}`);
        ok(a.settled && b.settled);
        equal(a.elapsed, b.elapsed);
        ok(Math.abs(a.elapsed - 6) <= 0.05, `时间线 ${a.elapsed} 秒`);
      } finally {
        stub.restore();
      }
    },
  ],
  [
    '单帧预览:同一时刻预览两次,画布调用逐项相同,且画了图片与插画',
    async () => {
      const stub = installAssetStub(ASSETS);
      try {
        await preloadAssets(['/img/earth.png', '/svg/cat.svg']);
        const seg = catSegment();
        const first = recordingCanvas();
        const second = recordingCanvas();
        await previewFrameAt([seg], 2.5, first.canvas, { yieldTask: flushTasks });
        await previewFrameAt([seg], 2.5, second.canvas, { yieldTask: flushTasks });
        const sig = signature(first.calls);
        equal(sig, signature(second.calls));
        ok(sig.includes('drawImage(') && sig.includes('stub:/img/earth.png'), '图片画上了');
        ok(first.calls.filter((c) => c.op === 'fill').length >= 4, '插画的部件画上了');
      } finally {
        stub.restore();
      }
    },
  ],
  [
    'content 测试同款干跑(DOM 桩、真帧泵):无报错、时长吻合',
    async () => {
      const stub = installAssetStub(ASSETS);
      const dom = installDomStub();
      const errors: unknown[] = [];
      const { error } = console;
      console.error = (...args: unknown[]): void => {
        errors.push(args);
      };
      try {
        await preloadAssets(['/img/earth.png', '/svg/cat.svg']);
        const seg = catSegment();
        const handle = seg.play(dom.canvas(), {});
        let settled = false;
        handle.done.then(
          () => {
            settled = true;
          },
          (e: unknown) => {
            settled = true;
            errors.push(e);
          },
        );
        for (let i = 0; i < 11 * 60 && !settled; i++) {
          dom.frame(1000 / 60);
          await dom.flush();
        }
        const elapsed = handle.getElapsed();
        handle.dispose();
        ok(settled, '分段没有结束');
        equal(errors.length, 0, `报错:${String(errors[0])}`);
        ok(Math.abs(elapsed - 6) <= 0.25, `时间线 ${elapsed} 秒`);
      } finally {
        console.error = error;
        dom.restore();
        stub.restore();
      }
    },
  ],
  [
    '没预加载:分段以 AssetError(not-loaded) 失败(可预期、确定),不去等网络',
    async () => {
      const stub = installAssetStub(ASSETS);
      try {
        ok(!isAssetReady('/img/earth.png'));
        const handle = catSegment().play(createStubCanvas(), { clock: new ManualClock() });
        let failure: unknown = null;
        await handle.done.catch((e: unknown) => {
          failure = e;
        });
        handle.dispose();
        ok(failure instanceof AssetError, String(failure));
        equal((failure as AssetError).code, 'not-loaded');
        equal(stub.requests.length, 0, '构造时不会顺手去取');
      } finally {
        stub.restore();
      }
    },
  ],
  [
    '模块顶层 await 的影片:import 时已就绪,干跑无报错',
    async () => {
      equal(LOGO_SVG.document.viewBox?.width, 64);
      equal(LOGO_IMAGE.source, null, 'node 里只量尺寸');
      equal(`${LOGO_IMAGE.width}x${LOGO_IMAGE.height}`, '64x64');
      const seg = assetFilm[0];
      ok(seg !== undefined);
      if (!seg) {
        return;
      }
      const env = { createCanvas: () => createStubCanvas(), createYielder: messageChannelYielder };
      const r = await runSegmentToEnd(seg, env);
      equal(r.error, null, String(r.error));
      ok(r.settled && Math.abs(r.elapsed - seg.duration) <= 0.05, `时间线 ${r.elapsed} 秒`);
    },
  ],
  [
    '离线导出:另起的离屏实例里图片与插画照常画出,导出完成',
    async () => {
      const stub = installAssetStub(ASSETS);
      const canvases: FakeCtxCall[][] = [];
      const env: OfflineEnv = {
        createCanvas: () => {
          const r = recordingCanvas();
          canvases.push(r.calls);
          return r.canvas;
        },
        encoder: async () => ({
          mimeType: 'video/mp4',
          codec: 'fake',
          audio: null,
          addFrame: async () => undefined,
          addAudio: async () => undefined,
          finish: async () => new Blob([], { type: 'video/mp4' }),
          cancel: async () => undefined,
        }),
        createYielder: () => ({ yieldTask: flushTasks, close: () => undefined }),
      };
      // 与真实入口一致:资源先就绪(影片模块顶层 await),再挂播放器。
      await preloadAssets(['/img/earth.png', '/svg/cat.svg']);
      const canvas = createStubCanvas();
      canvas.clientWidth = 800;
      canvas.clientHeight = 450;
      const film = runFilm(canvas, [catSegment()], { transition: 0, loop: false, clock: new ManualClock(), offlineEnv: env });
      try {
        const handle = film.exportVideo({ fps: 10 });
        let state = 'pending';
        let code = '';
        handle.done.then(
          () => {
            state = 'resolved';
          },
          (e: unknown) => {
            state = 'rejected';
            code = isFilmError(e) ? e.code : String(e);
          },
        );
        for (let i = 0; i < 5000 && state === 'pending'; i++) {
          await flushTasks();
        }
        equal(state, 'resolved', `导出失败:${code}`);
        const segmentCalls = canvases.slice(1).flat();
        ok(
          segmentCalls.some((c) => c.op === 'drawImage' && (c.value as { stub?: string } | undefined)?.stub === '/img/earth.png'),
          '离屏分段画布上画了图片',
        );
      } finally {
        film.dispose();
        stub.restore();
      }
    },
  ],
  [
    '助手:picture / illustration 的尺寸与位置;内联 SVG 同步可用',
    async () => {
      const stub = installAssetStub(ASSETS);
      try {
        // preloadAssets 返回逐项类型精确的元组:解构出来就是 ImageAsset,直接当句柄用。
        const [earth] = await preloadAssets(['/img/earth.png']);
        const p = picture(earth, 300, { x: 10, y: 20 });
        equal(`${p.width}x${p.height}@${p.position.x},${p.position.y}`, '300x150@10,20');
        const q = picture('/img/earth.png', 100);
        equal(`${q.width}x${q.height}@${q.position.x},${q.position.y}`, '100x50@0,0');
        const illo = illustration('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 5"><rect width="10" height="5"/></svg>', 120);
        equal(`${illo.width}x${illo.height}`, '120x60');
        equal(illo.parts.length, 1);
      } finally {
        stub.restore();
      }
    },
  ],
]);
