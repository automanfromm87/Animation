import {
  Angle,
  AnimationGroup,
  AreaUnderCurve,
  Axes,
  BarChart,
  BarChartTo,
  Brace,
  Circle,
  Circumscribe,
  ColorTo,
  Create,
  Dot,
  FadeIn,
  FadeOut,
  FadeTransform,
  Flash,
  FunctionGraph,
  Group,
  Indicate,
  Label,
  LaggedStart,
  Line,
  MoveTo,
  NumberLine,
  NumberPlane,
  Polygon,
  RiemannRectangles,
  RiemannTo,
  RightAngle,
  Scene,
  Square,
  Succession,
  TangentLine,
  Tex,
  TransformMatchingTex,
  Triangle,
  TweenValue,
  ValueTracker,
  VectorField,
  Wait,
  Wiggle,
  Write,
  lightTheme,
} from '../engine';
import type { FrameClock, MObject, Playable, Point, SafeArea, SceneViewport } from '../engine';
import type { RecordableSceneHandle, SceneContext } from './types';

export interface VocabularyOptions {
  /** 只播一遍就结束(测试用),默认 false 无限循环。 */
  once?: boolean;
  /** 自然播完回调;dispose 取消不调。 */
  onDone?: () => void;
  /** 时间线出错回调(dispose 之后的错误不报)。 */
  onError?: (error: unknown) => void;
  safeArea?: SafeArea;
  clock?: FrameClock;
  viewport?: SceneViewport;
}

/** dispose 之后时间线里的 play / wait 抛出它,整条时间线安静地结束。 */
const CANCELLED = Symbol('cancelled');

/** 每章取景的留白。 */
const PAD = 36;
const MUTED = '#6b7280';

function heading(text: string, y: number): Label {
  return new Label(text).setStyle({ fontSize: 30 }).moveTo({ x: 0, y });
}

function caption(text: string, at: Point): Label {
  return new Label(text).setStyle({ fontSize: 18, textColor: MUTED }).moveTo(at);
}

/** 先藏起来:FadeIn 会从 0 淡入到 1。 */
function hidden<T extends MObject>(m: T): T {
  m.opacity = 0;
  return m;
}

/** 先不画出来:Create 会从头生长。 */
function ungrown<T extends MObject>(m: T): T {
  m.setRevealFraction(0);
  return m;
}

/**
 * 讲解词汇演示:编排(错峰出场、一个接一个)→ 强调(高亮、圈出、闪一下、摆动,含公式的某一项)
 * → 换色与线宽 → 标注图元(坐标网格、面积与黎曼和、切线、角、花括号、数轴、向量场、柱状图)
 * → 按式子结构推导。一遍约一分半,默认循环;每章开始时重新取景。
 */
export function runVocabularyScene(
  canvas: HTMLCanvasElement,
  options?: VocabularyOptions,
): RecordableSceneHandle {
  const scene = new Scene(canvas, {
    theme: lightTheme,
    ...(options?.clock ? { clock: options.clock } : {}),
    ...(options?.viewport ? { viewport: options.viewport } : {}),
  });
  scene.setInteractionEnabled(false);
  scene.setSafeArea(options?.safeArea ?? {});
  let cancelled = false;

  const play = async (...playables: Playable[]): Promise<void> => {
    if (cancelled) {
      throw CANCELLED;
    }
    await scene.play(...playables);
    if (cancelled) {
      throw CANCELLED;
    }
  };
  const wait = async (seconds: number): Promise<void> => {
    if (cancelled) {
      throw CANCELLED;
    }
    await scene.wait(seconds);
    if (cancelled) {
      throw CANCELLED;
    }
  };

  /** 一章:搭好整章的对象(没出场的先藏着)、取景、播完、淡出、移除。 */
  const chapter = async (root: Group, body: () => Promise<void>): Promise<void> => {
    scene.add(root);
    scene.fitObjects([root], PAD);
    scene.render();
    try {
      await body();
      await wait(0.6);
      await play(new FadeOut(root, { runTime: 0.6 }));
    } finally {
      scene.remove(root);
    }
  };

  const composition = async (): Promise<void> => {
    const title = hidden(heading('① 编排:错峰出场、一个接一个', -170));
    const colors = ['#2563eb', '#7c3aed', '#db2777', '#ea580c', '#16a34a', '#0891b2'];
    const dots = colors.map((c, i) =>
      hidden(new Circle(24).setStyle({ fill: c, stroke: c }).moveTo({ x: -250 + i * 100, y: -30 })),
    );
    const lagNote = hidden(caption('LaggedStart:下一个在上一个播到 25% 时开始', { x: 0, y: 5 }));
    const start = { x: -250, y: 110 };
    const stops = [
      { x: -120, y: 160 },
      { x: 0, y: 90 },
      { x: 120, y: 160 },
      { x: 250, y: 110 },
    ];
    const trail = ungrown(
      new Polygon([start, ...stops], { closed: false }).setStyle({ stroke: '#9ca3af', strokeWidth: 2, dash: [6, 6] }),
    );
    const walker = hidden(new Dot(11).setStyle({ fill: '#111827' }).moveTo(start));
    const seqNote = hidden(caption('Succession:一段接一段,每段都从上一段的终点出发', { x: 0, y: 215 }));
    const root = new Group().add(title, ...dots, lagNote, trail, walker, seqNote);
    await chapter(root, async () => {
      await play(new FadeIn(title, { runTime: 0.6 }));
      // 圆点从下方浮上来:每一个都是「淡入 + 上移」的小组,再错峰排开。
      await play(
        new LaggedStart(
          dots.map(
            (d) =>
              new AnimationGroup([
                new FadeIn(d, { runTime: 0.6 }),
                new MoveTo(d, { x: d.position.x, y: -60 }, { runTime: 0.6 }),
              ]),
          ),
          { lagRatio: 0.25 },
        ),
        new FadeIn(lagNote, { runTime: 0.8 }),
      );
      await wait(0.4);
      await play(new Create(trail, { runTime: 0.8 }), new FadeIn(walker), new FadeIn(seqNote));
      await play(
        new Succession(
          stops.flatMap((p, i) => [new MoveTo(walker, p, { runTime: 0.5 }), ...(i < stops.length - 1 ? [new Wait(0.2)] : [])]),
        ),
      );
      await wait(0.3);
      await play(new LaggedStart([...dots].reverse().map((d) => new FadeOut(d, { runTime: 0.4 })), { lagRatio: 0.3 }));
    });
  };

  const emphasis = async (): Promise<void> => {
    const title = hidden(heading('② 强调:高亮、圈出、闪一下、摆动', -190));
    const formula = hidden(new Tex('E = mc^2').setStyle({ fontSize: 44 }).moveTo({ x: -270, y: -40 }));
    const square = hidden(
      new Square(90).setStyle({ fill: 'rgba(37, 99, 235, 0.15)', stroke: '#2563eb' }).moveTo({ x: -85, y: -40 }),
    );
    const dot = hidden(new Dot(12).setStyle({ fill: '#db2777' }).moveTo({ x: 90, y: -40 }));
    const tri = hidden(
      new Triangle(55).setStyle({ fill: 'rgba(22, 163, 74, 0.15)', stroke: '#16a34a' }).moveTo({ x: 260, y: -30 }),
    );
    const names = ['Indicate', 'Circumscribe', 'Flash', 'Wiggle'].map((n, i) =>
      hidden(caption(n, { x: [-270, -85, 90, 260][i] ?? 0, y: 40 })),
    );
    const law = hidden(
      new Tex('\\class{lhs}{a^2 + b^2} = \\class{rhs}{c^2}').setStyle({ fontSize: 44 }).moveTo({ x: 0, y: 140 }),
    );
    const partNote = hidden(caption('part:只强调公式里的某一项(用 \\class 标出来)', { x: 0, y: 205 }));
    const root = new Group().add(title, formula, square, dot, tri, ...names, law, partNote);
    await chapter(root, async () => {
      await play(new FadeIn(title, { runTime: 0.6 }));
      await play(
        new LaggedStart([formula, square, dot, tri].map((m) => new FadeIn(m, { runTime: 0.5 })), { lagRatio: 0.3 }),
        new LaggedStart(names.map((m) => new FadeIn(m, { runTime: 0.5 })), { lagRatio: 0.3 }),
      );
      await play(new Indicate(formula));
      await play(new Circumscribe(square));
      await play(new Flash(dot));
      await play(new Wiggle(tri, { runTime: 1.4 }));
      await wait(0.3);
      // 可以叠在一起同时播。
      await play(new Indicate(formula), new Circumscribe(square, { shape: 'circle' }), new Flash(dot), new Wiggle(tri, { runTime: 1 }));
      await wait(0.3);
      await play(new FadeIn(law, { runTime: 0.6 }), new FadeIn(partNote, { runTime: 0.6 }));
      await play(new Indicate(law, { part: 'rhs', runTime: 1.2 }));
      await play(new Circumscribe(law, { part: 'lhs', runTime: 1.2 }));
    });
  };

  const colorTween = async (): Promise<void> => {
    const title = hidden(heading('③ 换色与线宽:ColorTo', -170));
    const axes = ungrown(new Axes([-Math.PI, Math.PI], [-1.5, 1.5], 380, 150));
    const curve = ungrown(new FunctionGraph(Math.sin, axes).setStyle({ strokeWidth: 3 }));
    const plot = new Group().add(axes, curve).moveTo({ x: 0, y: -40 });
    const shapes = hidden(
      new Group()
        .add(
          new Circle(32).setStyle({ fill: 'rgba(234, 88, 12, 0.3)', stroke: '#ea580c' }).moveTo({ x: -140, y: 0 }),
          new Square(60).setStyle({ stroke: '#ea580c' }).moveTo({ x: 0, y: 0 }),
          new Line({ x: 100, y: 25 }, { x: 180, y: -25 }).setStyle({ stroke: '#ea580c' }),
        )
        .moveTo({ x: -20, y: 120 }),
    );
    const note = hidden(caption('给整组换色:原本没填充的线条不会被填满', { x: 0, y: 190 }));
    const root = new Group().add(title, plot, shapes, note);
    await chapter(root, async () => {
      await play(new FadeIn(title, { runTime: 0.6 }));
      await play(new Create(axes, { runTime: 0.8 }));
      await play(new Create(curve, { runTime: 0.8 }));
      await play(new ColorTo(curve, { stroke: '#2563eb', strokeWidth: 8 }, { runTime: 0.9 }));
      await play(new ColorTo(curve, { stroke: '#db2777', strokeWidth: 3 }, { runTime: 0.9 }));
      await play(new FadeIn(shapes, { runTime: 0.5 }), new FadeIn(note, { runTime: 0.5 }));
      await play(new ColorTo(shapes, '#16a34a', { runTime: 0.9 }));
      await play(new ColorTo(shapes, '#7c3aed', { runTime: 0.9 }));
    });
  };

  const calculus = async (): Promise<void> => {
    const title = hidden(heading('④ 标注:坐标网格 · 黎曼和 · 曲线下面积 · 切线', -250));
    const plane = ungrown(new NumberPlane([-1, 4, 1], [-1, 4, 1], 400, 400, { numbers: true }));
    const f = (x: number): number => 0.25 * x * x + 0.6;
    const rects = hidden(new RiemannRectangles(plane, f, [0, 3], { n: 4 }));
    const area = ungrown(new AreaUnderCurve(plane, f, [0, 3]));
    const graph = ungrown(new FunctionGraph(f, plane).setStyle({ stroke: '#2563eb', strokeWidth: 4 }));
    const tracker = new ValueTracker(0.4);
    const tangent = hidden(
      new TangentLine(plane, f, tracker.getValue(), { length: 170 }).setStyle({ stroke: '#db2777', strokeWidth: 3 }),
    );
    // 取样得到的是网格的本地坐标:与网格放在同一个组里(同一变换)就对得上;
    // 不放进网格本身 —— 对网格做 Create 会连带把它们一起长出来。
    const plot = new Group().add(plane, rects, area, graph, tangent);
    const note = hidden(caption('黎曼和 n = 4', { x: 0, y: 235 }));
    const integral = hidden(new Tex('\\int_0^3 f(x)\\,dx').setStyle({ fontSize: 30 }).moveTo({ x: -100, y: -150 }));
    const root = new Group().add(title, plot, note, integral);
    await chapter(root, async () => {
      await play(new FadeIn(title, { runTime: 0.6 }));
      await play(new Create(plane, { runTime: 1.2 }));
      await play(new Create(graph, { runTime: 0.8 }));
      rects.opacity = 1;
      await play(new Create(rects, { runTime: 0.8 }), new FadeIn(note, { runTime: 0.5 }));
      await play(new RiemannTo(rects, { n: 12 }, { runTime: 1.2 }), new FadeTransform(note, '黎曼和 n = 12', { runTime: 0.8 }));
      await play(new RiemannTo(rects, { n: 40 }, { runTime: 1.2 }), new FadeTransform(note, '黎曼和 n = 40', { runTime: 0.8 }));
      await wait(0.3);
      await play(
        new FadeOut(rects, { runTime: 0.6 }),
        new Create(area, { runTime: 1 }),
        new FadeIn(integral, { runTime: 0.8 }),
        new FadeTransform(note, '曲线下面积', { runTime: 0.8 }),
      );
      await play(new FadeIn(tangent, { runTime: 0.4 }), new FadeTransform(note, '切线:跟着参数逐帧更新', { runTime: 0.6 }));
      const stop = scene.addUpdater(() => {
        tangent.setX(tracker.getValue());
      });
      try {
        await play(new TweenValue(tracker, 3.4, { runTime: 2.4 }));
      } finally {
        stop();
      }
    });
  };

  const geometry = async (): Promise<void> => {
    const title = hidden(heading('④ 标注:角 · 直角 · 花括号', -190));
    const A = { x: -150, y: 80 };
    const B = { x: 170, y: 80 };
    const C = { x: -150, y: -120 };
    const tri = ungrown(new Polygon([A, B, C]));
    const right = ungrown(new RightAngle(A, B, C, { size: 16 }));
    const theta = ungrown(new Angle(B, A, C, { radius: 46, label: '\\theta' }));
    const base = ungrown(new Brace({ x: A.x, y: A.y + 8 }, { x: B.x, y: B.y + 8 }, { label: 'b' }));
    // 尖角朝 from → to 前进方向的右手侧:底边从左往右(朝下),竖边从上往下(朝左),都在三角形外面。
    const side = ungrown(new Brace({ x: C.x - 8, y: C.y }, { x: A.x - 8, y: A.y }, { label: 'a' }));
    const hyp = hidden(new Tex('c').setStyle({ fontSize: 26 }).moveTo({ x: 25, y: -35 }));
    const root = new Group().add(title, tri, right, theta, base, side, hyp);
    await chapter(root, async () => {
      await play(new FadeIn(title, { runTime: 0.6 }));
      await play(new Create(tri, { runTime: 1 }), new FadeIn(hyp, { runTime: 1 }));
      await play(new LaggedStart([new Create(right, { runTime: 0.6 }), new Create(theta, { runTime: 0.8 })], { lagRatio: 0.5 }));
      await play(new LaggedStart([new Create(base, { runTime: 0.8 }), new Create(side, { runTime: 0.8 })], { lagRatio: 0.4 }));
      await play(new Indicate(theta));
    });
  };

  const charts = async (): Promise<void> => {
    const title = hidden(heading('④ 标注:数轴 · 向量场 · 柱状图', -230));
    const line = ungrown(new NumberLine([-4, 4, 1], { length: 540, tips: 'both' }).moveTo({ x: 0, y: -140 }));
    const marker = hidden(new Dot(9).setStyle({ fill: '#db2777' }).moveTo(line.n2p(-3)));
    const fieldPlane = ungrown(new NumberPlane([-2, 2, 1], [-2, 2, 1], 240, 240, { minorDivisions: 1 }));
    const field = ungrown(new VectorField(fieldPlane, (x, y) => [-y, x], { colors: ['#3b82f6', '#ef4444'] }));
    const fieldGroup = new Group().add(fieldPlane, field).moveTo({ x: -160, y: 90 });
    const chart = ungrown(
      new BarChart([3, 5, 2, 4], { labels: ['甲', '乙', '丙', '丁'], showValues: true, width: 240, height: 180 }).moveTo({
        x: 170,
        y: 90,
      }),
    );
    const root = new Group().add(title, line, fieldGroup, chart);
    await chapter(root, async () => {
      await play(new FadeIn(title, { runTime: 0.6 }));
      await play(new Create(line, { runTime: 1 }));
      line.add(marker); // 加进数轴这个组:坐标是数轴的本地坐标,跟着数轴走
      await play(new FadeIn(marker, { runTime: 0.3 }));
      await play(new MoveTo(marker, line.n2p(2.5), { runTime: 1.2 }));
      await play(
        new LaggedStart([new Create(fieldPlane, { runTime: 0.8 }), new Create(field, { runTime: 1 })], { lagRatio: 0.5 }),
        new Create(chart, { runTime: 1.2 }),
      );
      await play(new BarChartTo(chart, [5, 2, 4, 1], { runTime: 1.2 }));
      await play(new Flash(line, { at: line.n2p(2.5) }));
    });
  };

  const derivation = async (): Promise<void> => {
    const title = hidden(heading('⑤ 推导:相同的项平移过去,变了的才变形', -130));
    const sources = ['2x + 3 = 7', '2x = 7 - 3', '2x = 4', 'x = \\frac{4}{2}', 'x = 2'];
    const steps = sources.map((s) => hidden(new Tex(s).setStyle({ fontSize: 56 })));
    const reasons = ['移项', '计算', '两边除以 2', '约分'];
    const note = hidden(caption('解方程', { x: 0, y: 90 }));
    const speed = hidden(
      new Tex('\\text{速度} = \\frac{\\text{路程}}{\\text{时间}}').setStyle({ fontSize: 48 }).moveTo({ x: 0, y: 0 }),
    );
    const distance = hidden(new Tex('\\text{路程} = \\text{速度} \\times \\text{时间}').setStyle({ fontSize: 48 }));
    const root = new Group().add(title, ...steps, note, speed, distance);
    await chapter(root, async () => {
      const first = steps[0];
      const last = steps[steps.length - 1];
      if (!first || !last) {
        return;
      }
      await play(new FadeIn(title, { runTime: 0.6 }), new FadeIn(note, { runTime: 0.6 }));
      first.opacity = 1;
      await play(new Write(first, { runTime: 1 }));
      for (let i = 0; i + 1 < steps.length; i++) {
        const from = steps[i];
        const to = steps[i + 1];
        if (!from || !to) {
          continue;
        }
        await wait(0.5);
        await play(
          new TransformMatchingTex(from, to, { runTime: 1.3 }),
          new FadeTransform(note, reasons[i] ?? '', { runTime: 0.8 }),
        );
      }
      await play(new Circumscribe(last, { runTime: 1.2 }));
      await play(new FadeOut(last, { runTime: 0.5 }), new FadeTransform(note, '中文公式按文字内容配对', { runTime: 0.8 }));
      speed.opacity = 1;
      await play(new Write(speed, { runTime: 1.2 }));
      await wait(0.5);
      await play(new TransformMatchingTex(speed, distance, { runTime: 1.5 }));
      await play(new Indicate(distance, { runTime: 1 }));
    });
  };

  const program = [composition, emphasis, colorTween, calculus, geometry, charts, derivation];
  const maxRounds = options?.once ? 1 : Number.POSITIVE_INFINITY;
  const loop = async (): Promise<void> => {
    for (let round = 0; round < maxRounds; round++) {
      for (const part of program) {
        await part();
      }
    }
    options?.onDone?.();
  };
  void loop().catch((e: unknown) => {
    if (cancelled || e === CANCELLED) {
      return;
    }
    if (options?.onError) {
      options.onError(e);
    } else {
      console.error('[vocabulary] 时间线出错', e);
    }
  });

  return {
    dispose: () => {
      cancelled = true;
      scene.dispose();
    },
    resize: (context?: SceneContext) => {
      if (context) {
        scene.clearSafeArea();
        scene.setSafeArea(context.safeArea ?? {});
      }
      scene.resizeAndRefit();
    },
    getElapsed: () => scene.getElapsed(),
    setPaused: (value: boolean) => scene.setPaused(value),
  };
}
