import { Create, Dot, FadeIn, FadeOut, FadeTransform, Group, Line } from '../engine';
import type { MObject } from '../engine';
import type { Segment } from './film';
import { cardSegment, directedSegment } from './film';
import {
  chapterCard,
  columnList,
  fadeIns,
  fadeSequence,
  hide,
  isNarrow,
  label,
  labelLine,
  listSegment,
  makePlot,
  plotIntro,
  sideColumn,
  stage,
  sweep,
  tangentProbe,
  tex,
  texLine,
  unrevealed,
} from './helpers';
import { rulesChapters } from './rules';
import { mvtChapters } from './mvt';
import { applicationChapters } from './applications';
import { advancedChapters } from './advanced';

const TITLE_HOLD = 4;

const titleCard = cardSegment({
  name: '片头',
  title: '导数',
  titleSize: 72,
  titleY: -60,
  lineY: 0,
  lineHalfWidth: 130,
  headingTex: "f'(x) = \\lim_{h \\to 0} \\frac{f(x+h)-f(x)}{h}",
  headingSize: 30,
  headingY: 56,
  narration: '今天,我们把导数一次讲清楚',
  holdSeconds: TITLE_HOLD,
});

const averageSegment = directedSegment(
  '平均速度',
  // 3.5 开场 + 1 + 1.5 + 1 + 1.2 + 1 + 1.2 + 2 + 1 + 3 停留。
  16.4,
  [
    { start: 0.2, end: 3.2, text: '一辆小车沿直线行驶,这是它的位置-时间图像' },
    { start: 3.4, end: 6, text: '第 1 秒到第 4 秒,平均速度是多少' },
    { start: 6.2, end: 9, text: '位移增量比时间增量,就是割线的斜率' },
    { start: 9.2, end: 12.2, text: '平均速度,等于 Δs 除以 Δt' },
    { start: 12.4, end: 16.2, text: '那,某一瞬间到底有多快' },
  ],
  async (env) => {
    const { scene } = env;
    const f = (t: number): number => 0.15 * t * t;
    const p = makePlot({
      xRange: [0, 5],
      yRange: [0, 4],
      width: 480,
      height: 360,
      fn: f,
      at: { x: 0, y: -20 },
    });
    const pW = p.W(1, f(1));
    const qW = p.W(4, f(4));
    const pDot = new Dot(7);
    pDot.moveTo(pW);
    const qDot = new Dot(7);
    qDot.moveTo(qW);
    const dots = new Group().add(
      pDot,
      qDot,
      tex('P', 24, { x: pW.x - 18, y: pW.y + 28 }),
      tex('Q', 24, { x: qW.x + 20, y: qW.y - 26 }),
    );
    const secant = new Line(pW, qW);
    unrevealed(secant);
    const helpers = new Group().add(
      new Line(qW, { x: qW.x, y: pW.y }).setStyle({ dash: [6, 5] }),
      new Line(pW, { x: qW.x, y: pW.y }).setStyle({ dash: [6, 5] }),
      tex('\\Delta s', 24, { x: qW.x + 34, y: (pW.y + qW.y) / 2 }),
      tex('\\Delta t', 24, { x: (pW.x + qW.x) / 2, y: pW.y - 24 }),
    );
    const formula = tex('\\bar{v} = \\frac{\\Delta s}{\\Delta t}', 30, { x: 0, y: 232 });
    const question = label('某一瞬间有多快?', 26, { x: 0, y: 292 });
    // 只藏「会被 FadeIn 的那一层」;藏到子元素上会让 FadeIn(组) 抬不起来。
    hide(dots, helpers, formula, question);
    stage(scene, [p.plot, dots, secant, helpers, formula, question], 24);
    await plotIntro(env, p);
    await env.play(new FadeIn(dots, { runTime: 1 }));
    await env.play(new Create(secant, { runTime: 1.5 }));
    await env.wait(1);
    await env.play(new FadeIn(helpers, { runTime: 1.2 }));
    await env.wait(1);
    await env.play(new FadeIn(formula, { runTime: 1.2 }));
    await env.wait(2);
    await env.play(new FadeIn(question, { runTime: 1 }));
    await env.wait(3);
  },
);

const secantSegment = directedSegment(
  '割线逼近切线',
  // 3 开场 + 1.5 + 1 + 9 扫描 + 1.2 + 4 停留。
  19.7,
  [
    { start: 0.2, end: 2.8, text: '固定 P 点,让 Q 沿着曲线滑向 P' },
    { start: 3, end: 5.3, text: '两点间的割线,跟着转动起来' },
    { start: 5.5, end: 12, text: 'Q 越靠近 P,割线就越贴近切线' },
    { start: 12.2, end: 15.5, text: '当 h 趋于 0,割线变成了切线' },
    { start: 15.7, end: 19.5, text: '切线的斜率,就是 P 点的瞬时变化率' },
  ],
  async (env) => {
    const { scene } = env;
    const f = (x: number): number => 0.15 * x * x;
    const fp = (x: number): number => 0.3 * x;
    const PX = 1.5;
    const p = makePlot({
      xRange: [0, 5],
      yRange: [0, 4],
      width: 480,
      height: 360,
      fn: f,
      at: { x: 0, y: -30 },
    });
    const { W } = p;
    const pW = W(PX, f(PX));
    const pDot = new Dot(7);
    pDot.moveTo(pW);
    const pLabel = tex('P', 24, { x: pW.x - 18, y: pW.y + 26 });
    const qDot = new Dot(7);
    const qLabel = tex('Q', 24);
    const secant = new Line(pW, pW);
    unrevealed(secant);
    const hLabel = label('h = 3.00', 22, { x: 160, y: -185 });
    // 精确切线:x 从 0.75 起笔,刚好落在坐标框内。
    const tangent = new Line(W(0.75, 0), W(5, f(PX) + fp(PX) * (5 - PX))).setStyle({
      dash: [6, 5],
    });
    // 摆在左上空白区,不被抛物线横穿。
    const limitLabel = tex('h \\to 0', 24, { x: -150, y: -120 });
    hide(pDot, pLabel, qDot, qLabel, hLabel, tangent, limitLabel);
    const drawAt = (h: number): void => {
      const q = W(PX + h, f(PX + h));
      qDot.moveTo(q);
      qLabel.moveTo({ x: q.x + 20, y: q.y - 26 });
      secant.start = { ...pW };
      secant.end = { ...q };
      hLabel.text = `h = ${h.toFixed(2)}`;
    };
    drawAt(3);
    stage(
      scene,
      [p.plot, pDot, pLabel, qDot, qLabel, secant, hLabel, tangent, limitLabel],
      24,
    );
    await plotIntro(env, p, {
      curveRunTime: 2,
      with: fadeIns([pDot, pLabel], 1),
    });
    await env.play(
      ...fadeIns([qDot, qLabel], 1),
      new Create(secant, { runTime: 1.5 }),
      new FadeIn(hLabel, { runTime: 1 }),
    );
    await env.wait(1);
    await sweep(env, { from: 3, to: 0.03, runTime: 9, draw: drawAt });
    await env.play(
      new FadeIn(tangent, { runTime: 1.2 }),
      new FadeOut(secant, { runTime: 1.2 }),
      new FadeIn(limitLabel, { runTime: 1.2 }),
    );
    await env.wait(4);
  },
);

const definitionSegment = directedSegment(
  '导数定义',
  // 1.2 + 3.5 + 1.5 + 3.5 + 1.5 + 4 停留。
  15.2,
  [
    { start: 0.2, end: 4.5, text: '平均变化率,是一段区间上的快慢' },
    // 不是「缩到 0」:h 等于 0 时这个比值没有意义,只能让它趋于 0。
    { start: 4.9, end: 9.5, text: '让区间长度 h 趋于 0,取极限' },
    { start: 9.9, end: 15, text: '极限值就是 x 点的导数,记作 f′(x)' },
  ],
  async (env) => {
    const { scene } = env;
    const caption = label('导数的定义', 26, { x: 0, y: -120 });
    const formula = tex('\\frac{f(x+h)-f(x)}{h}', 34, { x: 0, y: 20 }, { displayMode: true });
    hide(caption, formula);
    stage(scene, [caption, formula], 30);
    await env.play(...fadeIns([caption, formula], 1.2));
    await env.wait(3.5);
    await env.play(
      new FadeTransform(formula, '\\lim_{h \\to 0}\\frac{f(x+h)-f(x)}{h}', { runTime: 1.5 }),
    );
    await env.wait(3.5);
    await env.play(
      new FadeTransform(formula, "f'(x) = \\lim_{h \\to 0}\\frac{f(x+h)-f(x)}{h}", {
        runTime: 1.5,
      }),
    );
    await env.wait(4);
  },
);

const geometricSegment = directedSegment(
  '几何意义',
  // 3.5 开场 + 1.2 + 8 + 2 扫描 + 4 停留。
  18.7,
  [
    { start: 0.2, end: 3.3, text: '导数的几何意义,是切线的斜率' },
    { start: 3.7, end: 8, text: '让切点沿曲线滑动,切线跟着转动' },
    { start: 8.5, end: 12.5, text: '上坡时斜率为正,下坡时为负' },
    { start: 13, end: 18.5, text: '经过最低点时切线放平,导数等于 0' },
  ],
  async (env) => {
    const { scene } = env;
    const f = (x: number): number => 0.2 * x * x + 1;
    const fp = (x: number): number => 0.4 * x;
    const X_MIN = -2;
    const X_MAX = 4;
    const p = makePlot({
      xRange: [X_MIN, X_MAX],
      yRange: [0, 5],
      width: 480,
      height: 360,
      fn: f,
      samples: 220,
      at: { x: 0, y: -20 },
    });
    const probe = tangentProbe({
      W: p.W,
      f,
      fp,
      clamp: [X_MIN, X_MAX],
      halfSpan: 1,
    });
    probe.drawAt(-1.5);
    hide(...probe.parts);
    stage(scene, [p.plot, ...probe.parts], 20);
    await plotIntro(env, p);
    await env.play(...fadeIns(probe.parts, 1.2));
    await sweep(env, { from: -1.5, to: 3.5, runTime: 8, draw: probe.drawAt });
    // 回到最低点收尾:最后一条字幕说的是「切线放平、导数等于 0」,
    // 停在 x=3.5(k=1.40)上会和旁白正好相反。
    await sweep(env, { from: 3.5, to: 0, runTime: 2, draw: probe.drawAt });
    await env.wait(4);
  },
);

const physicsSegment = directedSegment(
  '自由落体',
  // 3.5 开场 + 1.5 + 1 + 4 × (1 + 0.5) + 3 停留。
  15,
  [
    { start: 0.2, end: 3.3, text: '苹果下落,路程和时间是平方关系' },
    { start: 3.7, end: 5.8, text: '第 2 秒那一瞬间,速度是多少' },
    { start: 6.2, end: 8.8, text: '对路程求导,就得到速度函数' },
    { start: 9.2, end: 13.8, text: '代入 t 等于 2,秒速 19.6 米' },
  ],
  async (env) => {
    const { scene } = env;
    const s = (t: number): number => 4.9 * t * t;
    const { colX, colYs } = sideColumn(scene, 4);
    const p = makePlot({
      xRange: [0, 4],
      yRange: [0, 80],
      width: 420,
      height: 340,
      fn: s,
      at: isNarrow(scene) ? { x: 0, y: -170 } : { x: -150, y: 0 },
    });
    const { W } = p;
    const dot = new Dot(7);
    dot.moveTo(W(2, s(2)));
    // 切线斜率 19.6,取 t∈[1, 3.2] 落在框内。
    const tangent = new Line(W(1, s(2) + 19.6 * (1 - 2)), W(3.2, s(2) + 19.6 * (3.2 - 2)));
    unrevealed(tangent);
    const caption = label('自由落体', 26, { x: colX, y: colYs[0] ?? 0 });
    const f1 = tex('s(t) = 4.9t^2', 26, { x: colX, y: colYs[1] ?? 0 });
    const f2 = tex("v(t) = s'(t) = 9.8t", 26, { x: colX, y: colYs[2] ?? 0 });
    const f3 = tex('v(2) = 19.6\\ \\text{m/s}', 26, { x: colX, y: colYs[3] ?? 0 });
    hide(dot, caption, f1, f2, f3);
    stage(scene, [p.plot, dot, tangent, caption, f1, f2, f3], 30);
    await plotIntro(env, p);
    await env.play(new FadeIn(dot, { runTime: 1 }), new Create(tangent, { runTime: 1.5 }));
    await env.wait(1);
    await fadeSequence(env, [caption, f1, f2, f3], { runTime: 1, gap: 0.5 });
    await env.wait(3);
  },
);

const summarySegment = listSegment({
  name: '小结',
  // 6 条 × (1 + 0.8) + 3.2 = 14。
  duration: 14,
  subtitles: [
    { start: 0.2, end: 3, text: '记住这几句话' },
    { start: 3.2, end: 6, text: '导数是极限,是斜率,也是瞬时快慢' },
    { start: 6.2, end: 9.4, text: '法则求导数,定理找ξ点' },
    { start: 9.6, end: 13.6, text: '从定义到应用,全片完' },
  ],
  entries: () => [
    labelLine('小结', 32),
    texLine("f'(x) = \\lim_{h \\to 0}\\frac{f(x+h)-f(x)}{h}", 26),
    labelLine('几何意义:切线斜率', 24),
    labelLine('物理意义:瞬时变化率', 24),
    labelLine('中值定理:平均总等于某个瞬时', 24),
    labelLine('应用:单调极值最优泰勒', 24),
  ],
  gap: 0.8,
  holdSeconds: 3.2,
});

const OUTRO_HOLD = 3;

const outroCard = cardSegment({
  name: '片尾',
  titleTex: "f'(x)",
  titleSize: 64,
  heading: '感谢观看',
  narration: '感谢观看',
  holdSeconds: OUTRO_HOLD,
});

const limitTableSegment = listSegment({
  name: '极限数表',
  // 6 条 × (1 + 1.5) + 2.5 = 17.5。
  duration: 17.5,
  subtitles: [
    { start: 0.2, end: 4.5, text: '把 h 的取值列出来,看斜率如何变化' },
    { start: 5, end: 11, text: 'h 从 1 缩到 0.001,斜率逼近 0.45' },
    { start: 11.5, end: 16.5, text: '这就是极限:无限接近' },
  ],
  // f(x)=0.15x² 在 x=1.5 处:割线斜率 = 0.45 + 0.15h。
  entries: () => [
    labelLine('h 越小,斜率越接近 0.45', 26),
    texLine('h = 1,\\ k = 0.600', 24),
    texLine('h = 0.1,\\ k = 0.465', 24),
    texLine('h = 0.01,\\ k = 0.4515', 24),
    texLine('h = 0.001,\\ k = 0.45015', 24),
    texLine('k \\to 0.45', 30),
  ],
  gap: 1.5,
  holdSeconds: 2.5,
});

const notationSegment = listSegment({
  name: '两种记号',
  // 5 条 × (1 + 1.2) + 4.5 = 15.5,正好覆盖最后一条字幕。
  duration: 15.5,
  subtitles: [
    // 导数不止两种写法(还有牛顿的点记号等),这里讲的是最常用的两种。
    { start: 0.2, end: 5, text: '导数有两种常用记号' },
    { start: 5.5, end: 10.5, text: 'dy/dx 像除法,好做运算' },
    { start: 11, end: 15.5, text: 'f′(x) 是函数视角,好想意义' },
  ],
  entries: () => [
    labelLine('两种记号', 30),
    texLine('\\frac{dy}{dx}', 32),
    labelLine('莱布尼茨:像除法一样运算', 22),
    texLine("f'(x)", 32),
    labelLine('拉格朗日:函数的视角', 22),
  ],
  gap: 1.2,
  holdSeconds: 4.5,
});

const continuitySegment = directedSegment(
  '连续与可导',
  // 3.5 开场 + 1.2 + 6 扫描 + 1.5 + 4 停留。
  16.2,
  [
    { start: 0.2, end: 3.3, text: '绝对值函数,在原点有个尖角' },
    { start: 3.7, end: 8, text: '左边斜率恒为 -1,右边恒为 +1' },
    { start: 8.5, end: 12, text: '滑到尖点,切线断掉了' },
    { start: 12.5, end: 16.2, text: '连续,不一定可导' },
  ],
  async (env) => {
    const { scene } = env;
    const f = (x: number): number => Math.abs(x);
    const p = makePlot({
      xRange: [-3, 3],
      yRange: [0, 3.5],
      width: 460,
      height: 340,
      fn: f,
      at: { x: 0, y: -30 },
    });
    const { W } = p;
    const dot = new Dot(7);
    const tangent = new Line({ x: 0, y: 0 }, { x: 1, y: 1 });
    const readout = label('k = -1', 22);
    const drawAt = (a: number): void => {
      dot.moveTo(W(a, f(a)));
      if (a < -0.15) {
        tangent.start = W(-3, 3);
        tangent.end = W(0, 0);
        tangent.opacity = 1;
        readout.text = 'k = -1';
      } else if (a > 0.15) {
        tangent.start = W(0, 0);
        tangent.end = W(3, 3);
        tangent.opacity = 1;
        readout.text = 'k = +1';
      } else {
        // 尖点处左右导数不等,没有切线可画。
        tangent.opacity = 0;
        readout.text = 'k = ???';
      }
      readout.moveTo({ x: dot.position.x, y: dot.position.y - 40 });
    };
    drawAt(-2.5);
    const conclusion = label('连续不一定可导', 26, { x: 0, y: 205 });
    hide(dot, tangent, readout, conclusion);
    stage(scene, [p.plot, dot, tangent, readout, conclusion], 24);
    await plotIntro(env, p);
    await env.play(...fadeIns([dot, tangent, readout], 1.2));
    await sweep(env, { from: -2.5, to: 2.5, runTime: 6, draw: drawAt });
    await env.play(new FadeIn(conclusion, { runTime: 1.5 }));
    await env.wait(4);
  },
);

const tangentEqSegment = directedSegment(
  '切线方程',
  // 3.5 开场 + 1.5 + 2 + 4 × (1 + 1.2) + 5 停留。
  20.8,
  [
    { start: 0.2, end: 3.3, text: '求抛物线在 x 等于 1 处的切线' },
    { start: 3.7, end: 6.5, text: '先算斜率:导数值 f′(1) 等于 2' },
    { start: 7, end: 13, text: '点斜式,写出直线方程' },
    { start: 13.5, end: 20, text: '化简:切线是 y 等于 2x 减 1' },
  ],
  async (env) => {
    const { scene } = env;
    const f = (x: number): number => x * x;
    const { colX, colYs } = sideColumn(scene, 4);
    const p = makePlot({
      xRange: [-1, 3],
      yRange: [-1, 5],
      width: 440,
      height: 340,
      fn: f,
      at: isNarrow(scene) ? { x: 0, y: -170 } : { x: -120, y: 0 },
    });
    const { W } = p;
    const dot = new Dot(7);
    dot.moveTo(W(1, 1));
    // 摆到切线下方的空白里,不被刚画出的切线划掉。
    const coord = tex('(1, 1)', 20, { x: W(1, 1).x + 40, y: W(1, 1).y + 30 });
    const tangent = new Line(W(0.2, -0.6), W(2.4, 3.8));
    unrevealed(tangent);
    const steps = [
      "f'(x) = 2x",
      "k = f'(1) = 2",
      'y - 1 = 2(x - 1)',
      'y = 2x - 1',
    ].map((s, i) => tex(s, 24, { x: colX, y: colYs[i] ?? 0 }));
    hide(dot, coord, ...steps);
    // 最后一步是这一段的结论,必须进场景也必须进取景。
    stage(scene, [p.plot, dot, coord, tangent, ...steps], 30);
    await plotIntro(env, p);
    await env.play(...fadeIns([dot, coord], 1), new Create(tangent, { runTime: 1.5 }));
    await env.wait(2);
    await fadeSequence(env, steps, { runTime: 1, gap: 1.2 });
    await env.wait(5);
  },
);

const outlineCard = directedSegment(
  '本集提要',
  // 6 条 × (1 + 1) + 3 停留。
  15,
  [
    { start: 0.2, end: 8, text: '这集内容很丰富,先看提要' },
    { start: 8.5, end: 14, text: '定义、法则、定理、应用,循序渐进' },
  ],
  async (env) => {
    const { scene } = env;
    const items: MObject[] = [
      label('本集提要', 32),
      ...[
        '一 · 导数的定义与意义',
        '二 · 求导法则',
        '三 · 中值定理',
        '四 · 导数的应用',
        '五 · 进阶与实战',
      ].map((s) => label(s, 24)),
    ];
    // 提要是目录式的:左缘齐平、容器宽度固定,和旧版排版一致。
    const col = columnList(
      items.map((node, i) => ({ node, fontSize: i === 0 ? 32 : 24 })),
      {
        gap: 14,
        padding: 14,
        align: 'start',
        minWidth: 420,
        context: scene.measureContext(),
      },
    );
    col.moveTo({ x: 0, y: 0 });
    hide(...items);
    stage(scene, [col], 30);
    await fadeSequence(env, items, { runTime: 1, gap: 1 });
    await env.wait(3);
  },
);

const introChapter = chapterCard({
  name: '章节 · 定义与意义',
  title: '定义与意义',
  heading: '极限 · 切线',
  narration: '第一章,定义与意义',
});

/** 《导数》全片:35 段约 9 分钟(553.9 秒),五章 + 习题 + 小结。 */
export const derivativesFilm: Segment[] = [
  titleCard,
  outlineCard,
  introChapter,
  averageSegment,
  secantSegment,
  limitTableSegment,
  definitionSegment,
  notationSegment,
  geometricSegment,
  continuitySegment,
  tangentEqSegment,
  physicsSegment,
  ...rulesChapters,
  ...mvtChapters,
  ...applicationChapters,
  ...advancedChapters,
  summarySegment,
  outroCard,
];
