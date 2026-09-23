import { Create, Dot, FadeIn, FadeOut, FunctionGraph, Line, Rectangle } from '../engine';
import type { MObject, Tex } from '../engine';
import type { Segment } from './film';
import { directedSegment } from './film';
import {
  chapterCard,
  fadeIns,
  hide,
  isNarrow,
  label,
  makePlot,
  plotIntro,
  sideColumn,
  stage,
  sweep,
  tangentProbe,
  tex,
  unrevealed,
} from './helpers';

const appsChapter = chapterCard({
  name: '章节 · 导数的应用',
  title: '导数的应用',
  heading: '单调性 · 极值 · 最优化',
  narration: '第四章,导数的应用',
});

const monotonicSegment = directedSegment(
  '单调性与极值',
  // 3.5 开场 + 1.2 + 10 扫描 + 1.5 + 5 停留。
  21.2,
  [
    { start: 0.2, end: 3.3, text: '导数的符号,决定增减' },
    { start: 3.7, end: 8, text: '切点滑动,读数实时变化' },
    { start: 8.5, end: 14, text: '读数为正上升,为负下降' },
    // 只说「读数为 0」不够:x³ 在原点读数也是 0,却不是极值(后面凹凸那一段就是它)。
    { start: 14.5, end: 18, text: '读数经过 0 并变号的地方,是极值点' },
    { start: 18.2, end: 21, text: '左极大,右极小,一目了然' },
  ],
  async (env) => {
    const { scene } = env;
    const f = (x: number): number => x * x * x - 3 * x;
    const fp = (x: number): number => 3 * x * x - 3;
    const p = makePlot({
      xRange: [-2.2, 2.2],
      yRange: [-5, 5],
      width: 480,
      height: 360,
      fn: f,
      samples: 240,
      at: { x: 0, y: -20 },
    });
    const { W } = p;
    const probe = tangentProbe({
      W,
      f,
      fp,
      clamp: [-2.2, 2.2],
      halfSpan: 0.8,
      readoutOffset: { x: 0, y: -44 },
    });
    probe.drawAt(-1.6);
    // f'(±1)=0:x=-1 处 f=2(极大),x=1 处 f=-2(极小)。
    const maxDot = new Dot(7);
    maxDot.moveTo(W(-1, 2));
    const maxLabel = label('极大', 20, { x: W(-1, 2).x, y: W(-1, 2).y - 30 });
    const minDot = new Dot(7);
    minDot.moveTo(W(1, -2));
    const minLabel = label('极小', 20, { x: W(1, -2).x, y: W(1, -2).y + 30 });
    const marks: MObject[] = [maxDot, maxLabel, minDot, minLabel];
    hide(...probe.parts, ...marks);
    stage(scene, [p.plot, ...probe.parts, ...marks], 20);
    await plotIntro(env, p);
    await env.play(...fadeIns(probe.parts, 1.2));
    await sweep(env, { from: -1.6, to: 1.6, runTime: 10, draw: probe.drawAt });
    await env.play(...fadeIns(marks, 1.5));
    await env.wait(5);
  },
);

const concavitySegment = directedSegment(
  '凹凸性与拐点',
  // 3.5 开场 + 1.2 + 8 扫描 + 1.5 + 4 停留。
  18.2,
  [
    { start: 0.2, end: 3.3, text: '二阶导数,看弯曲方向' },
    { start: 3.7, end: 9, text: '左边 ∩ 形,f″ 小于 0' },
    { start: 9.5, end: 13.5, text: '右边 ∪ 形,f″ 大于 0' },
    // ∩ 是凸、∪ 是凹,原点处由凸变凹。
    { start: 14, end: 18.2, text: '原点处由凸变凹,是拐点' },
  ],
  async (env) => {
    const { scene } = env;
    const f = (x: number): number => x * x * x;
    const fp = (x: number): number => 3 * x * x;
    const fpp = (x: number): number => 6 * x;
    const p = makePlot({
      xRange: [-2, 2],
      yRange: [-8, 8],
      width: 440,
      height: 360,
      fn: f,
      samples: 220,
      at: { x: 0, y: -20 },
    });
    const { W } = p;
    const probe = tangentProbe({
      W,
      f,
      fp,
      clamp: [-2, 2],
      halfSpan: 0.8,
      readoutOffset: { x: 70, y: -30 },
      format: (a) => `f″ = ${fpp(a).toFixed(2)}`,
    });
    probe.drawAt(-1.2);
    // 读数跟着切点跑,取景必须覆盖它在两个端点的位置,否则竖屏下扫到末尾会出画。
    const readoutHalfW =
      probe.readout.getBox(scene.measureContext()).size.w / 2 + 12;
    const span = [-1.2, 1.2].map((a) => {
      const marker = new Dot(Math.max(1, readoutHalfW));
      const at = W(a, f(a));
      marker.moveTo({ x: at.x + 70, y: at.y - 30 });
      return marker;
    });
    const oDot = new Dot(7);
    oDot.moveTo(W(0, 0));
    const leftLabel = tex("f''<0", 24, W(-1.2, 4));
    const rightLabel = tex("f''>0", 24, W(1.2, -4));
    const marks: MObject[] = [oDot, leftLabel, rightLabel];
    hide(...probe.parts, ...marks);
    // span 只参与取景,不进场景。
    stage(scene, [p.plot, ...probe.parts, ...marks], 20, span);
    await plotIntro(env, p);
    await env.play(...fadeIns(probe.parts, 1.2));
    await sweep(env, { from: -1.2, to: 1.2, runTime: 8, draw: probe.drawAt });
    await env.play(...fadeIns(marks, 1.5));
    await env.wait(4);
  },
);

const optimizeSegment = directedSegment(
  '最优化实例',
  // 2 开场 + 1 + 1 + 8 + 1.5 扫描 + 1.5 + 3.5 停留。
  18.5,
  [
    // 两边之和为 10 => 周长 20,面积 A = x(10-x),最大值 25。
    { start: 0.2, end: 3, text: '周长 20 的矩形,面积能有多大' },
    { start: 3.5, end: 7, text: '一边变长,另一边就变短' },
    { start: 7.5, end: 12, text: '面积先增后减,顶点处最大' },
    { start: 12.5, end: 18, text: 'x 等于 5 的正方形,面积 25' },
  ],
  async (env) => {
    const { scene } = env;
    const A = (x: number): number => x * (10 - x);
    const narrow = isNarrow(scene);
    const rect = new Rectangle(36, 324);
    const areaLabel = label('A = 0.0', 24, narrow ? { x: 0, y: 10 } : { x: -230, y: 175 });
    const p = makePlot({
      xRange: [0, 10],
      yRange: [0, 26],
      width: 380,
      height: 300,
      fn: A,
      at: narrow ? { x: 0, y: 190 } : { x: 170, y: 0 },
    });
    const { W } = p;
    const dot = new Dot(7);
    const maxDot = new Dot(8);
    maxDot.moveTo(W(5, 25));
    const conclusion = tex(
      'x = 5,\\ A_{\\max} = 25',
      26,
      narrow ? { x: 0, y: 390 } : { x: 0, y: 205 },
    );
    const drawAt = (x: number): void => {
      rect.width = x * 36;
      rect.height = (10 - x) * 36;
      dot.moveTo(W(x, A(x)));
      areaLabel.text = `A = ${A(x).toFixed(1)}`;
    };
    rect.moveTo(narrow ? { x: 0, y: -190 } : { x: -230, y: -20 });
    hide(rect, areaLabel, dot, maxDot, conclusion);
    // 取景按最大包络来,变形全程不出画。
    rect.width = 324;
    rect.height = 324;
    stage(scene, [rect, areaLabel, p.plot, dot, maxDot, conclusion], 24);
    drawAt(1);
    await plotIntro(env, p, {
      curveRunTime: 2,
      with: [
        new FadeIn(rect, { runTime: 1.2 }),
        new FadeIn(areaLabel, { runTime: 1.2 }),
      ],
    });
    await env.play(new FadeIn(dot, { runTime: 1 }));
    await sweep(env, { from: 1, to: 9, runTime: 8, draw: drawAt });
    // 扫完回到最优解再下结论,否则画面停在 A=9.0 的细长条上而字幕在说 A=25。
    await sweep(env, { from: 9, to: 5, runTime: 1.5, draw: drawAt });
    await env.play(
      new FadeIn(maxDot, { runTime: 1 }),
      new FadeIn(conclusion, { runTime: 1.5 }),
    );
    await env.wait(3.5);
  },
);

const differentialSegment = directedSegment(
  '微分与线性近似',
  // 3.5 开场 + 1.5 + 8 扫描 + 1.2 + 4 停留。
  18.2,
  [
    { start: 0.2, end: 3.3, text: '曲线很弯,但局部几乎是直的' },
    { start: 3.7, end: 7, text: 'Δx 缩小,点 Q 向点 P 靠拢' },
    { start: 7.5, end: 13, text: '误差飞快归零,切线就是近似' },
    { start: 13.5, end: 18.2, text: 'dy 等于 f′(x)dx,这就是微分' },
  ],
  async (env) => {
    const { scene } = env;
    const f = (x: number): number => 0.2 * x * x + 1;
    const a = 2;
    const fa = f(a);
    const fpa = 0.4 * a;
    const tanY = (x: number): number => fa + fpa * (x - a);
    const p = makePlot({
      xRange: [0, 5],
      yRange: [0, 7],
      width: 480,
      height: 360,
      fn: f,
      at: { x: 0, y: -30 },
    });
    const { W } = p;
    const tangent = new Line(W(0, tanY(0)), W(5, tanY(5))).setStyle({ dash: [6, 5] });
    unrevealed(tangent);
    const pDot = new Dot(7);
    pDot.moveTo(W(a, fa));
    const pLabel = tex('P', 22, { x: W(a, fa).x - 26, y: W(a, fa).y + 24 });
    const qDot = new Dot(7);
    const qLabel = tex('Q', 22);
    const errSeg = new Line({ x: 0, y: 0 }, { x: 1, y: 1 }).setStyle({ dash: [4, 3] });
    const errLabel = label('err = 0.000', 22, { x: 170, y: -190 });
    const drawAt = (dx: number): void => {
      const q = W(a + dx, f(a + dx));
      qDot.moveTo(q);
      qLabel.moveTo({ x: q.x + 26, y: q.y - 22 });
      errSeg.start = W(a + dx, tanY(a + dx));
      errSeg.end = q;
      errLabel.text = `err = ${Math.abs(f(a + dx) - tanY(a + dx)).toFixed(3)}`;
    };
    drawAt(2);
    const formula = tex("dy = f'(x)\\,dx", 28, { x: 0, y: 195 });
    const movers: MObject[] = [qDot, qLabel, errSeg, errLabel];
    // tangent 走 Create 生长(Create 不碰 opacity),不能预先藏起来。
    hide(pDot, pLabel, formula, ...movers);
    stage(scene, [p.plot, tangent, pDot, pLabel, formula, ...movers], 24);
    await plotIntro(env, p);
    await env.play(
      new Create(tangent, { runTime: 1.5 }),
      new FadeIn(pDot, { runTime: 1 }),
      new FadeIn(pLabel, { runTime: 1 }),
      ...fadeIns(movers, 1),
    );
    await sweep(env, { from: 2, to: 0.1, runTime: 8, draw: drawAt });
    await env.play(new FadeIn(formula, { runTime: 1.2 }));
    await env.wait(4);
  },
);

const sketchingSegment = directedSegment(
  '函数作图四步法',
  // 1 + (1 + 1.5) × 2 + (1.2 + 1.5) × 2 + 2.5 + 4 停留。
  17.9,
  [
    { start: 0.2, end: 3.3, text: '第一步,求导' },
    { start: 3.7, end: 7, text: '第二步,找驻点' },
    { start: 7.5, end: 11, text: '第三步,定极大极小' },
    { start: 11.8, end: 17.5, text: '第四步,连成曲线' },
  ],
  async (env) => {
    const { scene } = env;
    const f = (x: number): number => x * x * x - 3 * x;
    const { colX, colYs } = sideColumn(scene, 4);
    const p = makePlot({
      xRange: [-2.2, 2.2],
      yRange: [-5, 5],
      width: 460,
      height: 340,
      fn: f,
      samples: 240,
      at: isNarrow(scene) ? { x: 0, y: -170 } : { x: -100, y: 0 },
    });
    const { W } = p;
    const s1 = tex("f'(x) = 3x^2-3", 24, { x: colX, y: colYs[0] ?? 0 });
    const s2 = tex('x = \\pm 1', 24, { x: colX, y: colYs[1] ?? 0 });
    const s3 = label('极大值 f(-1) = 2', 22, { x: colX, y: colYs[2] ?? 0 });
    const s4 = label('极小值 f(1) = -2', 22, { x: colX, y: colYs[3] ?? 0 });
    const maxDot = new Dot(7);
    maxDot.moveTo(W(-1, 2));
    const minDot = new Dot(7);
    minDot.moveTo(W(1, -2));
    hide(s1, s2, s3, s4, maxDot, minDot);
    stage(scene, [p.plot, s1, s2, s3, s4, maxDot, minDot], 24);
    // 先只立坐标轴:曲线要等四步推完才连出来。
    await env.play(new FadeIn(p.axes, { runTime: 1 }));
    await env.play(new FadeIn(s1, { runTime: 1 }));
    await env.wait(1.5);
    await env.play(new FadeIn(s2, { runTime: 1 }));
    await env.wait(1.5);
    await env.play(...fadeIns([s3, maxDot], 1.2));
    await env.wait(1.5);
    await env.play(...fadeIns([s4, minDot], 1.2));
    await env.wait(1.5);
    await env.play(new Create(p.curve, { runTime: 2.5 }));
    await env.wait(4);
  },
);

const taylorSegment = directedSegment(
  '泰勒多项式逼近',
  // 4.5 开场 + (1.5 + 2.5 + 1) × 2 + 1.5 + 2.5 + 1.2 + 5 停留。
  24.7,
  [
    { start: 0.2, end: 4.5, text: '多项式,能模仿正弦吗' },
    { start: 5, end: 9.5, text: '一次项,只在原点附近像' },
    { start: 10, end: 14.5, text: '加到三次项,像的范围变大' },
    // 五次多项式在 ±π 处还差约 0.52(画面两端看得出分叉),说「完全重合」不对。
    { start: 15, end: 19.5, text: '五次项,中间一大段几乎重合' },
    { start: 20, end: 24.5, text: '项越多逼近越好——这就是泰勒' },
  ],
  async (env) => {
    const { scene } = env;
    const p = makePlot({
      xRange: [-Math.PI, Math.PI],
      yRange: [-3.5, 3.5],
      width: 520,
      height: 340,
      fn: (x) => Math.sin(x),
      samples: 220,
      at: { x: 0, y: 0 },
    });
    const p1 = new FunctionGraph((x) => x, p.axes, 100);
    const p3 = new FunctionGraph((x) => x - (x * x * x) / 6, p.axes, 160);
    const p5 = new FunctionGraph(
      (x) => x - (x * x * x) / 6 + (x * x * x * x * x) / 120,
      p.axes,
      220,
    );
    p.plot.add(p1, p3, p5);
    const approx: Array<[FunctionGraph, Tex]> = [
      [p1, tex('y = x', 24, { x: 140, y: -140 })],
      [p3, tex('y=x-\\frac{x^3}{6}', 24, { x: 140, y: -140 })],
      [p5, tex('y=\\cdots+\\frac{x^5}{120}', 24, { x: 140, y: -140 })],
    ];
    const labels = approx.map(([, l]) => l);
    const conclusion = label('项越多,逼近越好', 24, { x: 0, y: 210 });
    hide(...labels, conclusion);
    unrevealed(p1, p3, p5);
    stage(scene, [p.plot, ...labels, conclusion], 24);
    await plotIntro(env, p, { holdSeconds: 2 });
    for (let i = 0; i < approx.length; i += 1) {
      const entry = approx[i];
      if (!entry) {
        continue;
      }
      const [c, l] = entry;
      c.opacity = 1;
      await env.play(new Create(c, { runTime: 1.5 }), new FadeIn(l, { runTime: 1.5 }));
      await env.wait(2.5);
      if (i < approx.length - 1) {
        await env.play(new FadeOut(c, { runTime: 1 }), new FadeOut(l, { runTime: 1 }));
      }
    }
    await env.play(new FadeIn(conclusion, { runTime: 1.2 }));
    await env.wait(5);
  },
);

/** 第四章:导数的应用。 */
export const applicationChapters: Segment[] = [
  appsChapter,
  monotonicSegment,
  concavitySegment,
  optimizeSegment,
  differentialSegment,
  sketchingSegment,
  taylorSegment,
];
