import { Circle, Create, Dot, FadeIn, Line, linear } from '../engine';
import type { MObject, Point } from '../engine';
import type { Segment, Subtitle } from './film';
import { directedSegment } from './film';
import {
  chapterCard,
  fadeIns,
  hide,
  isNarrow,
  label,
  makePlot,
  plotIntro,
  stage,
  sweep,
  tex,
  unrevealed,
} from './helpers';

const advancedChapter = chapterCard({
  name: '章节 · 进阶与实战',
  title: '进阶与实战',
  heading: '隐函数 · 牛顿法 · 习题',
  narration: '第五章,进阶与实战',
});

const implicitSegment = directedSegment(
  '隐函数求导',
  // 2 画圆 + 1 + 1 + 1.5 + 1.2 + 8 扫描 + 1.2 + 3 停留。
  18.9,
  [
    { start: 0.2, end: 3, text: 'x²+y²=r²,y 藏在里面' },
    { start: 3.5, end: 6.5, text: '两边求导,别忘了链式法则' },
    { start: 7, end: 13.5, text: '点在圆上走,切线跟着转' },
    { start: 14, end: 18.5, text: '斜率等于 -x/y,就这么简单' },
  ],
  async (env) => {
    const { scene } = env;
    const narrow = isNarrow(scene);
    const C: Point = narrow ? { x: 0, y: -140 } : { x: -40, y: -20 };
    const R = 130;
    const circle = new Circle(R);
    circle.moveTo(C);
    unrevealed(circle);
    const dot = new Dot(7);
    const tangent = new Line({ x: 0, y: 0 }, { x: 1, y: 1 });
    const radius = new Line(C, C).setStyle({ dash: [5, 4] });
    const readout = label('k = 0.00', 22);
    const pointAt = (th: number): Point => ({
      x: C.x + R * Math.cos(th),
      y: C.y + R * Math.sin(th),
    });
    const drawAt = (th: number): void => {
      const p = pointAt(th);
      dot.moveTo(p);
      const dx = -Math.sin(th) * 90;
      const dy = Math.cos(th) * 90;
      tangent.start = { x: p.x - dx, y: p.y - dy };
      tangent.end = { x: p.x + dx, y: p.y + dy };
      radius.start = { ...C };
      radius.end = p;
      readout.moveTo({ x: p.x, y: p.y - 36 });
      // 世界 y 轴向下:数学坐标的 y = -R·sinθ,于是 y' = -x/y = +cosθ/sinθ。
      // 写成 -cosθ/sinθ 会与画面上切线的走向反号。
      readout.text = `k = ${(Math.cos(th) / Math.sin(th)).toFixed(2)}`;
    };
    drawAt(0.6);
    const f1 = tex("2x+2yy'=0", 24, narrow ? { x: 0, y: 60 } : { x: 300, y: -80 });
    const f2 = tex("y' = -x/y", 26, narrow ? { x: 0, y: 130 } : { x: 300, y: 0 });
    const movers: MObject[] = [dot, tangent, radius, readout];
    hide(...movers, f1, f2);
    stage(scene, [circle, ...movers, f1, f2], 24);
    await env.play(new Create(circle, { runTime: 2 }));
    await env.wait(1);
    await env.play(new FadeIn(f1, { runTime: 1 }));
    await env.wait(1.5);
    await env.play(...fadeIns(movers, 1.2));
    await sweep(env, { from: 0.6, to: 2.2, runTime: 8, draw: drawAt });
    await env.play(new FadeIn(f2, { runTime: 1.2 }));
    await env.wait(3);
  },
);

const relatedSegment = directedSegment(
  '相关变化率',
  // 1 + 1 + 1 + 1 + 12 扫描 + 1.5 + 3.5 停留。
  21,
  [
    { start: 0.2, end: 3.5, text: '气球充气,半径匀速变大' },
    { start: 4, end: 8, text: '体积的变化率,和半径有关' },
    { start: 8.5, end: 15, text: '看,半径越大,体积涨得越快' },
    { start: 15.5, end: 20.5, text: '链式法则,把两个变化率连起来' },
  ],
  async (env) => {
    const { scene } = env;
    const narrow = isNarrow(scene);
    const balloon = new Circle(20);
    balloon.moveTo(narrow ? { x: 0, y: -160 } : { x: -120, y: -60 });
    const rLabel = label('r = 20.0', 24, narrow ? { x: 0, y: 10 } : { x: -120, y: 130 });
    const vLabel = label('V = 33.5k', 24, narrow ? { x: 0, y: 45 } : { x: -120, y: 165 });
    const formula = tex(
      '\\frac{dV}{dt} = 4\\pi r^2\\frac{dr}{dt}',
      22,
      narrow ? { x: 0, y: 130 } : { x: 250, y: -40 },
    );
    const conclusion = label(
      '半径越大,体积涨得越快',
      22,
      narrow ? { x: 0, y: 200 } : { x: 250, y: 40 },
    );
    const drawAt = (r: number): void => {
      balloon.radius = r;
      rLabel.text = `r = ${r.toFixed(1)}`;
      vLabel.text = `V = ${(((4 / 3) * Math.PI * r * r * r) / 1000).toFixed(1)}k`;
    };
    hide(balloon, rLabel, vLabel, formula, conclusion);
    // 取景按最大包络来,膨胀全程不出画。
    balloon.radius = 110;
    stage(scene, [balloon, rLabel, vLabel, formula, conclusion], 24);
    drawAt(20);
    await env.play(...fadeIns([balloon, rLabel, vLabel], 1));
    await env.wait(1);
    await env.play(new FadeIn(formula, { runTime: 1 }));
    await env.wait(1);
    // 旁白说「半径匀速变大」,缓动就必须是 linear;
    // 默认的 smooth 会让体积增速在末尾归零,正好和结论相反。
    await sweep(env, { from: 20, to: 110, runTime: 12, draw: drawAt, rateFunc: linear });
    await env.play(new FadeIn(conclusion, { runTime: 1.5 }));
    await env.wait(3.5);
  },
);

const newtonSegment = directedSegment(
  '牛顿迭代法',
  // 3.5 开场 + 1 + 3 × (1.5 + 1) + 1.2 + 6.3 停留。
  19.5,
  [
    { start: 0.2, end: 3.5, text: '猜一个 x0,作切线' },
    { start: 4, end: 8, text: '切线交 x 轴,得到 x1' },
    { start: 8.5, end: 13, text: '重复这个步骤' },
    { start: 13.5, end: 19.5, text: '三步,就逼近了 √2' },
  ],
  async (env) => {
    const { scene } = env;
    const f = (x: number): number => x * x - 2;
    const p = makePlot({
      xRange: [0, 4],
      yRange: [0, 8],
      width: 480,
      height: 340,
      fn: f,
      at: { x: 0, y: -10 },
    });
    const { W } = p;
    // 预先算好的三步迭代:3 → 1.8333 → 1.4621 → 1.415。
    const xs = [3, 1.8333, 1.4621, 1.415] as const;
    const x0Dot = new Dot(7);
    x0Dot.moveTo(W(xs[0], f(xs[0])));
    const steps: Array<{ tangent: Line; drop: Line; hit: Dot }> = [];
    for (let i = 0; i < 3; i += 1) {
      const from = xs[i] ?? 0;
      const to = xs[i + 1] ?? 0;
      const tangent = new Line(W(from, f(from)), W(to, 0));
      unrevealed(tangent);
      const drop = new Line(W(to, 0), W(to, f(to))).setStyle({ dash: [4, 3] });
      const hit = new Dot(6);
      hit.moveTo(W(to, 0));
      steps.push({ tangent, drop, hit });
    }
    const finalDot = new Dot(8);
    finalDot.moveTo(W(xs[3], f(xs[3])));
    const formula = tex("x_{n+1} = x_n - \\frac{f(x_n)}{f'(x_n)}", 26, { x: 0, y: 195 });
    const all: MObject[] = [
      x0Dot,
      ...steps.flatMap((s) => [s.tangent, s.drop, s.hit]),
      finalDot,
      formula,
    ];
    hide(...all);
    stage(scene, [p.plot, ...all], 24);
    await plotIntro(env, p);
    await env.play(new FadeIn(x0Dot, { runTime: 1 }));
    for (const step of steps) {
      // Create 不碰 opacity,切线必须先抬回不透明。
      step.tangent.opacity = 1;
      await env.play(
        new Create(step.tangent, { runTime: 1.5 }),
        new FadeIn(step.drop, { runTime: 1 }),
        new FadeIn(step.hit, { runTime: 1 }),
      );
      await env.wait(1);
    }
    await env.play(
      new FadeIn(finalDot, { runTime: 1 }),
      new FadeIn(formula, { runTime: 1.2 }),
    );
    // 留够时间让最后一句字幕(13.5–19.5)播完。
    await env.wait(6.3);
  },
);

interface QuizSpec {
  title: string;
  stem: string;
  options: [string, string, string];
  correct: 0 | 1 | 2;
  answer: string;
  subs: Subtitle[];
}

const quizSegment = (spec: QuizSpec): Segment =>
  // 1 + 1 + 3 × 0.8 + 7 + 1.5 + 5 停留。
  directedSegment(spec.title, 17.9, spec.subs, async (env) => {
    const { scene } = env;
    const stem = tex(spec.stem, 28, { x: 0, y: -120 });
    const optYs = [-20, 50, 120];
    const opts = spec.options.map((text, i) => tex(text, 24, { x: 0, y: optYs[i] ?? 0 }));
    const correctY = optYs[spec.correct] ?? 0;
    // 取景前按最宽选项估一个位置,别用一个远远的固定值 —— 那会把取景盒撑歪、整屏内容右偏。
    let widestOption = 0;
    for (const o of opts) {
      widestOption = Math.max(widestOption, o.getBox(scene.measureContext()).size.w);
    }
    const check = label('✓', 26, { x: -(widestOption / 2 + 28), y: correctY });
    const answer = tex(spec.answer, 24, { x: 0, y: 195 });
    const all: MObject[] = [stem, ...opts, check, answer];
    hide(...all);
    stage(scene, all, 24);
    await env.play(new FadeIn(stem, { runTime: 1 }));
    await env.wait(1);
    for (const o of opts) {
      await env.play(new FadeIn(o, { runTime: 0.8 }));
    }
    await env.wait(7);
    // ✓ 贴住正确那一行的左缘(排版尺寸此时已按实测值更新)。
    const target = opts[spec.correct];
    if (target) {
      const width = target.getBox(scene.measureContext()).size.w;
      check.moveTo({ x: target.position.x - width / 2 - 28, y: correctY });
    }
    await env.play(
      new FadeIn(check, { runTime: 1.5 }),
      new FadeIn(answer, { runTime: 1.5 }),
    );
    await env.wait(5);
  });

/** 第五章:进阶与习题。 */
export const advancedChapters: Segment[] = [
  advancedChapter,
  implicitSegment,
  relatedSegment,
  newtonSegment,
  quizSegment({
    title: '习题一:幂法则',
    stem: "f(x) = x^3,\\ f'(2) = ?",
    options: ['A:\\ 8', 'B:\\ 12', 'C:\\ 6'],
    correct: 1,
    answer: '\\text{答案:B}',
    subs: [
      { start: 0.2, end: 3, text: 'f(x) 等于 x³,f′(2) 等于几' },
      { start: 3.5, end: 7, text: '三个选项,先自己算一算' },
      { start: 7.5, end: 13, text: '幂法则:3x²,代入 x=2' },
      { start: 13.5, end: 17.5, text: '答案是 B,12' },
    ],
  }),
  quizSegment({
    title: '习题二:乘法法则',
    stem: "(x^2\\sin x)' = ?",
    options: [
      'A:\\ 2x\\sin x + x^2\\cos x',
      'B:\\ 2x\\cos x',
      'C:\\ 2x\\sin x',
    ],
    correct: 0,
    answer: '\\text{答案:A}',
    subs: [
      { start: 0.2, end: 3, text: 'x²sinx 求导,用乘法法则' },
      { start: 3.5, end: 7, text: '前导乘后,加前乘后导' },
      { start: 7.5, end: 13, text: '别漏了第二项的 x²cosx' },
      { start: 13.5, end: 17.5, text: '答案是 A,两项都要' },
    ],
  }),
  quizSegment({
    title: '习题三:单调性',
    stem: "f' > 0 \\Rightarrow f ?",
    options: ['A:\\ \\text{递减}', 'B:\\ \\text{递增}', 'C:\\ \\text{为零}'],
    correct: 1,
    answer: '\\text{答案:B}',
    subs: [
      { start: 0.2, end: 3, text: '导数大于 0,函数怎么样' },
      { start: 3.5, end: 7, text: '回想单调性那一段' },
      { start: 7.5, end: 13, text: '切线斜率为正,函数上升' },
      { start: 13.5, end: 17.5, text: '答案是 B,单调递增' },
    ],
  }),
];
