import { Create, Dot, FadeIn, FadeOut, Line } from '../engine';
import type { MObject } from '../engine';
import type { Segment } from './film';
import { directedSegment } from './film';
import {
  chapterCard,
  fadeIns,
  hide,
  makePlot,
  plotIntro,
  stage,
  sweep,
  tangentProbe,
  tex,
  unrevealed,
} from './helpers';

const mvtChapter = chapterCard({
  name: '章节 · 中值定理',
  title: '中值定理',
  heading: '罗尔 · 拉格朗日',
  narration: '第三章,中值定理',
});

const rolleSegment = directedSegment(
  '罗尔定理',
  // 3.5 开场 + 1.5 + 1 + 1.2 + 6 + 2 扫描 + 1.5 + 4 停留。
  20.7,
  [
    { start: 0.2, end: 3.3, text: '端点一样高,中间拱起来' },
    { start: 3.7, end: 7, text: '切线从左滑到右,斜率由正变负' },
    { start: 7.5, end: 13, text: '连续变化,必经过 0' },
    { start: 13.5, end: 16.8, text: '这个 ξ 点,就是罗尔定理的结论' },
    { start: 17, end: 20.5, text: 'f(a) 等于 f(b),则存在 ξ 使 f′(ξ) 等于 0' },
  ],
  async (env) => {
    const { scene } = env;
    // 抬高一格(端点落在 y=1),弦才不会和 x 轴重合 ——
    // 否则「端点一样高」这条视觉信息在画面上根本不存在。
    const f = (x: number): number => 5 - (x - 2) * (x - 2);
    const fp = (x: number): number => 2 * (2 - x);
    const p = makePlot({
      xRange: [0, 4],
      yRange: [0, 6],
      width: 460,
      height: 340,
      fn: f,
      at: { x: 0, y: -40 },
    });
    const { W } = p;
    const aW = W(0, f(0));
    const bW = W(4, f(4));
    const aDot = new Dot(7);
    aDot.moveTo(aW);
    const bDot = new Dot(7);
    bDot.moveTo(bW);
    const aLabel = tex('A', 22, { x: aW.x - 24, y: aW.y + 22 });
    const bLabel = tex('B', 22, { x: bW.x + 24, y: bW.y + 22 });
    const chord = new Line(aW, bW).setStyle({ dash: [6, 5] });
    // 读数摆到切点下方:收尾时 ξ 在切线上方,两个文字才不会挤在一起。
    const probe = tangentProbe({
      W,
      f,
      fp,
      clamp: [0, 4],
      halfSpan: 0.6,
      readoutOffset: { x: 0, y: 40 },
    });
    probe.drawAt(0.5);
    // 抬高一个字高:收尾时水平切线停在 y = W(2,5).y 上,压在字上会像被划掉。
    const xiLabel = tex('\\xi', 26, { x: W(2, 5).x + 30, y: W(2, 5).y - 34 });
    const formula = tex(
      "f(a) = f(b) \\Rightarrow \\exists\\,\\xi\\in(a,b),\\ f'(\\xi) = 0",
      26,
      { x: 0, y: 200 },
    );
    const ends: MObject[] = [aDot, bDot, aLabel, bLabel, chord];
    hide(...probe.parts, xiLabel, formula, ...ends);
    stage(scene, [p.plot, ...probe.parts, xiLabel, formula, ...ends], 24);
    await plotIntro(env, p);
    await env.play(...fadeIns(ends, 1.5));
    await env.wait(1);
    await env.play(...fadeIns(probe.parts, 1.2));
    // 先扫完整个区间,再回到 ξ 停住 —— 结论出现时画面上就是一条水平切线。
    // (读数随后淡出,把画面留给 ξ 与结论公式。)
    await sweep(env, { from: 0.5, to: 3.5, runTime: 6, draw: probe.drawAt });
    await sweep(env, { from: 3.5, to: 2, runTime: 2, draw: probe.drawAt });
    await env.play(
      new FadeIn(xiLabel, { runTime: 1.5 }),
      new FadeIn(formula, { runTime: 1.5 }),
      new FadeOut(probe.readout, { runTime: 1.5 }),
    );
    await env.wait(4);
  },
);

const lagrangeSegment = directedSegment(
  '拉格朗日中值定理',
  // 3.5 开场 + 1.5 + 1 + 1.2 + 5 扫描 + 1.5 + 5.3 停留。
  19,
  [
    { start: 0.2, end: 3.3, text: '端点高度不同,割线有了坡度' },
    { start: 3.7, end: 7, text: '找一条切线,和割线平行' },
    { start: 7.5, end: 12, text: '切线滑到 ξ,斜率刚刚相等' },
    { start: 12.5, end: 17.5, text: '这就是拉格朗日中值定理' },
  ],
  async (env) => {
    const { scene } = env;
    const f = (x: number): number => 0.15 * x * x + 0.5 * x;
    const fp = (x: number): number => 0.3 * x + 0.5;
    const p = makePlot({
      xRange: [0, 4],
      yRange: [0, 5],
      width: 460,
      height: 340,
      fn: f,
      at: { x: 0, y: -40 },
    });
    const { W } = p;
    const aW = W(0, f(0));
    const bW = W(4, f(4));
    const aDot = new Dot(7);
    aDot.moveTo(aW);
    const bDot = new Dot(7);
    bDot.moveTo(bW);
    const secant = new Line(aW, bW);
    unrevealed(secant);
    const probe = tangentProbe({ W, f, fp, clamp: [0, 4], halfSpan: 0.7 });
    probe.drawAt(0.8);
    // 割线斜率 (f(4)-f(0))/4 = 1.1,f'(ξ)=1.1 解得 ξ=2。
    const xiLabel = tex('\\xi = 2', 24, { x: W(2, f(2)).x + 52, y: W(2, f(2)).y - 10 });
    const formula = tex("f'(\\xi) = \\frac{f(b)-f(a)}{b-a}", 26, { x: 0, y: 200 });
    hide(...probe.parts, xiLabel, formula, aDot, bDot);
    stage(scene, [p.plot, ...probe.parts, xiLabel, formula, secant, aDot, bDot], 24);
    await plotIntro(env, p);
    await env.play(
      new FadeIn(aDot, { runTime: 1 }),
      new FadeIn(bDot, { runTime: 1 }),
      new Create(secant, { runTime: 1.5 }),
    );
    await env.wait(1);
    await env.play(...fadeIns(probe.parts, 1.2));
    await sweep(env, { from: 0.8, to: 2, runTime: 5, draw: probe.drawAt });
    await env.play(
      new FadeIn(xiLabel, { runTime: 1.5 }),
      new FadeIn(formula, { runTime: 1.5 }),
    );
    await env.wait(5.3);
  },
);

/** 第三章:中值定理。 */
export const mvtChapters: Segment[] = [mvtChapter, rolleSegment, lagrangeSegment];
