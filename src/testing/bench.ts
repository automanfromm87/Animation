import { Circle, Create, FadeIn, Line, MoveTo, Rectangle, Scene, Tex, lightTheme } from '../engine';
import { sdTorus } from '../engine/implicit/sdf';
import { polygonize } from '../engine/implicit/marchingTets';
import { compositeFrame } from '../export/composite';
import type { SubtitleVisual } from '../export/composite';
import { ManualClock } from '../film/offline';
import { fastForwardTo } from '../film/preview';
import { cardSegment } from '../film/segments';
import { createStubCanvas, flushTasks } from './domStub';
import { createFakeCtx } from './fakeCtx';

/**
 * 性能基线:各画一条有代表性的负载,scripts/bench.mjs 计时并与基线比对。
 * node + 假 ctx 跑的是 CPU 侧(排版/插值/合成/曲面提取),不含 GPU 光栅 ——
 * 回归信号看「相对变化」而不是绝对毫秒数;绝对帧率去浏览器里看。
 */

export interface Benchmark {
  /** '分组/名字',runner 按子串过滤。 */
  name: string;
  /** 建一次,返回反复计时的闭包(可异步)。 */
  create(): () => unknown | Promise<unknown>;
}

function stubScene(): { scene: Scene; canvas: HTMLCanvasElement } {
  const canvas = createStubCanvas() as unknown as HTMLCanvasElement;
  const fake = createFakeCtx({ record: false });
  (canvas as unknown as { getContext: () => CanvasRenderingContext2D }).getContext =
    () => fake.ctx;
  return { scene: new Scene(canvas, { theme: lightTheme }), canvas };
}

const FORMULAS = [
  '\\frac{d}{dx}x^2 = 2x',
  '\\int_0^1 x^2\\,dx = \\frac{1}{3}',
  '\\lim_{h \\to 0}\\frac{f(x+h)-f(x)}{h}',
  'e^{i\\pi} + 1 = 0',
  '\\sum_{n=1}^{\\infty}\\frac{1}{n^2} = \\frac{\\pi^2}{6}',
];

const SUBTITLE_VISUAL: SubtitleVisual = {
  fontPx: 20,
  fontFamily: 'sans-serif',
  color: '#fff',
  background: 'rgba(0,0,0,0.65)',
  padX: 16,
  padY: 6,
  radius: 8,
  lineHeight: 1.35,
  bottomPx: 48,
  maxWidthRatio: 0.8,
};

export const BENCHMARKS: Benchmark[] = [
  {
    name: 'render/shapes-300',
    create: () => {
      const { scene } = stubScene();
      for (let i = 0; i < 150; i++) {
        scene.add(new Circle(10 + (i % 40)).moveTo({ x: i * 7 - 500, y: (i % 25) * 30 - 300 }));
      }
      for (let i = 0; i < 100; i++) {
        scene.add(new Rectangle(20, 12).moveTo({ x: (i % 40) * 25 - 480, y: i * 5 - 250 }));
      }
      for (let i = 0; i < 50; i++) {
        scene.add(new Line({ x: -400, y: i * 12 - 300 }, { x: 400, y: i * 12 - 300 }));
      }
      return () => {
        scene.render();
      };
    },
  },
  {
    name: 'render/tex-20',
    create: () => {
      const { scene } = stubScene();
      for (let i = 0; i < 20; i++) {
        scene.add(new Tex(FORMULAS[i % FORMULAS.length] ?? 'x').moveTo({ x: 0, y: i * 40 - 380 }));
      }
      scene.render();
      return () => {
        scene.render();
      };
    },
  },
  {
    name: 'typeset/tex-20-fresh',
    create: () => {
      let n = 0;
      return () => {
        // 每次全新排版:getBox 逼出懒加载的 layout,构造 + 排版一起计时。
        for (let i = 0; i < 20; i++) {
          const t = new Tex(`${FORMULAS[(n + i) % FORMULAS.length] ?? 'x'}_{${n + i}}`);
          t.getBox();
        }
        n += 20;
      };
    },
  },
  {
    name: 'pump/anim-60f',
    create: () => {
      const clock = new ManualClock();
      const canvas = createStubCanvas() as unknown as HTMLCanvasElement;
      const fake = createFakeCtx({ record: false });
      (canvas as unknown as { getContext: () => CanvasRenderingContext2D }).getContext =
        () => fake.ctx;
      const timed = new Scene(canvas, { theme: lightTheme, clock });
      const c = new Circle(50);
      const r = new Rectangle(60, 30);
      const line = new Line({ x: -100, y: 0 }, { x: 100, y: 0 });
      timed.add(c, r, line);
      const stepMs = 1000 / 60;
      return async () => {
        const p = timed.play(
          new MoveTo(c, { x: 99, y: 0 }, { runTime: 1 }),
          new FadeIn(r, { runTime: 1 }),
          new Create(line, { runTime: 1 }),
        );
        // 61 步:相对累加的浮点误差会让第 60 步差 1e-13 没播满,play 永远不 resolve。
        for (let i = 0; i < 61; i++) {
          clock.advance(stepMs);
        }
        // 一个宏任务边界排空全部微任务:60 帧的完成回调在这里兑现。
        await flushTasks();
        await p;
      };
    },
  },
  {
    name: 'implicit/polygonize-torus-48',
    create: () => {
      const field = (x: number, y: number, z: number): number => sdTorus(x, y, z, 1.2, 0.45);
      return () => {
        polygonize(field, 2, 48);
      };
    },
  },
  {
    name: 'export/composite-1080p-x20',
    create: () => {
      const main = createStubCanvas() as unknown as HTMLCanvasElement;
      main.width = 1920;
      main.height = 1080;
      const out = createStubCanvas() as unknown as HTMLCanvasElement;
      const fake = createFakeCtx({ record: false });
      (out as unknown as { getContext: () => CanvasRenderingContext2D }).getContext =
        () => fake.ctx;
      const ctx = out.getContext('2d');
      if (!ctx) {
        throw new Error('bench: 拿不到 2d 上下文');
      }
      const frame = {
        main,
        mainRect: { x: 0, y: 0, w: 1920, h: 1080 },
        scale: 1,
        veilAlpha: 0,
        veilColor: '#ffffff',
        subtitle: {
          text: '导数就是变化率:这一点切线的斜率,也是这一点函数值随自变量变化的快慢',
          visual: SUBTITLE_VISUAL,
        },
      };
      return () => {
        for (let i = 0; i < 20; i++) {
          compositeFrame(ctx, 1920, 1080, frame);
        }
      };
    },
  },
  {
    name: 'preview/fastforward-card-3s',
    create: () => {
      const seg = cardSegment({
        name: '卡',
        title: '标题',
        narration: '解说',
        holdSeconds: 2,
      });
      return async () => {
        const canvas = createStubCanvas() as unknown as HTMLCanvasElement;
        const fake = createFakeCtx({ record: false });
        (canvas as unknown as { getContext: () => CanvasRenderingContext2D }).getContext =
          () => fake.ctx;
        const clock = new ManualClock();
        const handle = seg.play(canvas, { clock });
        try {
          await fastForwardTo(handle, clock, 3, { yieldTask: flushTasks });
        } finally {
          handle.dispose();
        }
      };
    },
  },
];
