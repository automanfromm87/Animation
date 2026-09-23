import {
  Arrow,
  Circle,
  Create,
  Dot,
  Ellipse,
  FadeIn,
  FadeOut,
  Line,
  Rectangle,
  Transform,
} from '../engine';
import type { Segment } from './film';
import { cardSegment, directedSegment } from './film';
import {
  chapterCard,
  hide,
  isNarrow,
  label,
  labelLine,
  listSegment,
  stage,
  tex,
  texLine,
  unrevealed,
} from './helpers';

/**
 * 《拓扑学基础 · 前三章》:第一章基本语言、第二章连续与同胚、第三章核心性质。
 * 每段注释里写清时长账(duration 必须等于脚本实际时间线,内容测试按 ±0.25 秒卡)。
 */

const titleCard = cardSegment({
  name: '片头',
  title: '从开集到流形',
  titleSize: 64,
  heading: '拓扑学基础 · 前三章',
  narration: '拓扑学,研究空间在连续变形下保持不变的性质',
  holdSeconds: 4,
});

const outlineSegment = listSegment({
  name: '本片三章',
  // 4 条 × (1 + 0.8) + 3 = 10.2。
  duration: 10.2,
  subtitles: [
    { start: 0.2, end: 5, text: '三章:语言、映射、性质' },
    { start: 5.2, end: 10, text: '定义是骨架,例子是直觉' },
  ],
  entries: () => [
    labelLine('本片三章', 30),
    labelLine('第一章 · 基本语言', 24),
    labelLine('第二章 · 连续与同胚', 24),
    labelLine('第三章 · 紧致、连通与分离性', 24),
  ],
  gap: 0.8,
  holdSeconds: 3,
});

const ch1Card = chapterCard({
  name: '章节 · 基本语言',
  title: '第一章',
  heading: '基本语言:开集、闭集、邻域',
  narration: '第一章,基本语言',
});

const topoDefSegment = directedSegment(
  '拓扑空间的定义',
  // 1.2 + 1.2 + 1 + 0.8 + 0.6 + 0.8 + 0.6 + 0.8 + 3.5 = 10.5。
  10.5,
  [
    { start: 0.2, end: 3.4, text: '拓扑规定:哪些集合算开集' },
    { start: 3.6, end: 7, text: '空集全集开,任意并开,有限交开' },
    { start: 7.2, end: 10.3, text: '满足这三条,就是拓扑空间' },
  ],
  async (env) => {
    const { scene } = env;
    const narrow = isNarrow(scene);
    const box = narrow
      ? new Rectangle(340, 250).moveTo({ x: 0, y: -165 })
      : new Rectangle(300, 380).moveTo({ x: -230, y: 0 });
    const blobPos = narrow
      ? [
          { x: -85, y: -205 },
          { x: 75, y: -160 },
          { x: -25, y: -90 },
        ]
      : [
          { x: -290, y: -90 },
          { x: -170, y: 20 },
          { x: -280, y: 120 },
        ];
    const blobs = blobPos.map((p) => new Circle(narrow ? 42 : 55).moveTo(p));
    const uLabels = blobPos.map((p, i) => tex(`U_${i + 1}`, 20, p));
    const xLabel = narrow ? tex('X', 30, { x: -138, y: -260 }) : tex('X', 30, { x: -352, y: -158 });
    const axSize = narrow ? 24 : 26;
    const ax1 = tex(
      '\\varnothing, X \\in \\mathcal{T}',
      axSize,
      narrow ? { x: 0, y: 55 } : { x: 170, y: -110 },
    );
    const ax2 = tex(
      '\\bigcup_{\\alpha} U_\\alpha \\in \\mathcal{T}',
      axSize,
      narrow ? { x: 0, y: 135 } : { x: 170, y: -10 },
    );
    const ax3 = tex(
      '\\bigcap_{i=1}^{n} U_i \\in \\mathcal{T}',
      axSize,
      narrow ? { x: 0, y: 215 } : { x: 170, y: 90 },
    );
    unrevealed(box, ...blobs);
    hide(xLabel, ...uLabels, ax1, ax2, ax3);
    stage(scene, [box, ...blobs, xLabel, ...uLabels, ax1, ax2, ax3], 24);
    await env.play(new Create(box, { runTime: 1.2 }), new FadeIn(xLabel, { runTime: 1.2 }));
    await env.play(
      ...blobs.map((b) => new Create(b, { runTime: 1.2 })),
      ...uLabels.map((l) => new FadeIn(l, { runTime: 1.2 })),
    );
    await env.wait(1);
    await env.play(new FadeIn(ax1, { runTime: 0.8 }));
    await env.wait(0.6);
    await env.play(new FadeIn(ax2, { runTime: 0.8 }));
    await env.wait(0.6);
    await env.play(new FadeIn(ax3, { runTime: 0.8 }));
    await env.wait(3.5);
  },
);

const extremesSegment = listSegment({
  name: '两个极端',
  // 5 条 × (1 + 1) + 4 = 14。
  duration: 14,
  subtitles: [
    { start: 0.2, end: 5, text: '离散拓扑:每个子集都是开集' },
    { start: 5.2, end: 10, text: '平凡拓扑:只有空集和全集开' },
    { start: 10.2, end: 13.8, text: '注意:没有连续集合这种说法' },
  ],
  entries: () => [
    labelLine('两个极端', 30),
    labelLine('离散拓扑:所有子集都开', 22),
    texLine('\\mathcal{T} = \\mathcal{P}(X)', 26),
    labelLine('平凡拓扑:只有空集和全集', 22),
    texLine('\\mathcal{T} = \\{\\varnothing, X\\}', 26),
  ],
  gap: 1,
  holdSeconds: 4,
});

const closedNbhdSegment = directedSegment(
  '闭集与邻域',
  // 1 + 1 + 0.5 + 1 + 1 + 0.5 + 1 + 3 = 9。
  9,
  [
    { start: 0.2, end: 3, text: '闭集:余集开,自身就闭' },
    { start: 3.2, end: 6, text: 'x 的邻域:包含 x 的开集再往外扩' },
    { start: 6.2, end: 8.8, text: '记住邻域的样子,后面反复用' },
  ],
  async (env) => {
    const { scene } = env;
    const narrow = isNarrow(scene);
    const box = narrow
      ? new Rectangle(340, 240).moveTo({ x: 0, y: -170 })
      : new Rectangle(320, 300).moveTo({ x: -190, y: 0 });
    const disk = narrow
      ? new Circle(60).moveTo({ x: -90, y: -210 })
      : new Circle(70).moveTo({ x: -250, y: -50 });
    disk.setStyle({ fill: '#dbeafe' });
    const diskPos = narrow ? { x: -90, y: -210 } : { x: -250, y: -50 };
    const fLabel = tex('F', 26, diskPos);
    const xPos = narrow ? { x: 60, y: -120 } : { x: -110, y: 85 };
    const xDot = new Dot(7).moveTo(xPos);
    const nbhd = narrow
      ? new Circle(50).moveTo(xPos).setStyle({ dash: [6, 5] })
      : new Circle(55).moveTo(xPos).setStyle({ dash: [6, 5] });
    const xLabel = narrow
      ? tex('x', 22, { x: 92, y: -120 })
      : tex('x', 22, { x: -140, y: 108 });
    const nLabel = narrow
      ? tex('N', 22, { x: 60, y: -58 })
      : tex('N', 22, { x: -47, y: 85 });
    const f1 = narrow
      ? tex('F \\text{ 闭 } \\iff X\\setminus F \\text{ 开}', 22, { x: 0, y: 40 })
      : tex('F \\text{ 闭 } \\iff X\\setminus F \\text{ 开}', 24, { x: 180, y: -60 });
    const f2a = narrow
      ? tex('x \\in U \\subseteq N,', 22, { x: 0, y: 110 })
      : tex('x \\in U \\subseteq N,', 24, { x: 180, y: 30 });
    const f2b = narrow
      ? tex('U \\text{ 开 } \\Rightarrow N \\text{ 是邻域}', 22, { x: 0, y: 170 })
      : tex('U \\text{ 开 } \\Rightarrow N \\text{ 是邻域}', 24, { x: 180, y: 90 });
    unrevealed(box, nbhd);
    hide(disk, fLabel, xDot, xLabel, nLabel, f1, f2a, f2b);
    stage(scene, [box, disk, fLabel, xDot, nbhd, xLabel, nLabel, f1, f2a, f2b], 24);
    await env.play(new Create(box, { runTime: 1 }));
    await env.play(new FadeIn(disk, { runTime: 1 }), new FadeIn(fLabel, { runTime: 1 }));
    await env.wait(0.5);
    await env.play(
      new Create(nbhd, { runTime: 1 }),
      new FadeIn(xDot, { runTime: 1 }),
      new FadeIn(xLabel, { runTime: 1 }),
      new FadeIn(nLabel, { runTime: 1 }),
    );
    await env.play(new FadeIn(f1, { runTime: 1 }));
    await env.wait(0.5);
    await env.play(new FadeIn(f2a, { runTime: 1 }), new FadeIn(f2b, { runTime: 1 }));
    await env.wait(3);
  },
);

const intClosureSegment = directedSegment(
  '内部、闭包、边界',
  // 1.2 + 1 + 1 + 0.5 + 1 + 1 + 1 + 3.3 = 10。
  10,
  [
    { start: 0.2, end: 3.5, text: '内部:能塞进开集的点' },
    { start: 3.7, end: 7, text: '闭包再挖掉内部,就是边界' },
    { start: 7.2, end: 9.8, text: '开邻域条件别丢,考试常考' },
  ],
  async (env) => {
    const { scene } = env;
    const narrow = isNarrow(scene);
    const center = narrow ? { x: 0, y: -160 } : { x: -210, y: 0 };
    const outerR = narrow ? 90 : 100;
    const innerR = narrow ? 62 : 70;
    const disk = new Circle(outerR).moveTo(center);
    const inner = new Circle(innerR).moveTo(center).setStyle({ dash: [6, 5] });
    const dots: Dot[] = [];
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      dots.push(
        new Dot(6).moveTo({ x: center.x + outerR * Math.cos(a), y: center.y + outerR * Math.sin(a) }),
      );
    }
    const aLabel = narrow
      ? tex('A', 26, { x: 108, y: -160 })
      : tex('A', 26, { x: -88, y: 0 });
    const intLabel = tex('\\operatorname{Int}(A)', 20, { x: center.x, y: center.y - 5 });
    const bdLabel = tex('\\partial A', 20, { x: center.x, y: center.y + outerR + 32 });
    const fSize = narrow ? 20 : 22;
    const f1 = tex(
      '\\operatorname{Int}(A)=\\bigcup\\{U\\subseteq A: U\\text{开}\\}',
      fSize,
      narrow ? { x: 0, y: 50 } : { x: 190, y: -90 },
    );
    const f2 = tex(
      '\\overline{A}=\\bigcap\\{F\\supseteq A: F\\text{闭}\\}',
      fSize,
      narrow ? { x: 0, y: 120 } : { x: 190, y: 0 },
    );
    const f3 = tex(
      '\\partial A=\\overline{A}\\setminus\\operatorname{Int}(A)',
      fSize,
      narrow ? { x: 0, y: 190 } : { x: 190, y: 90 },
    );
    unrevealed(disk, inner);
    hide(aLabel, intLabel, bdLabel, ...dots, f1, f2, f3);
    stage(scene, [disk, inner, ...dots, aLabel, intLabel, bdLabel, f1, f2, f3], 24);
    await env.play(new Create(disk, { runTime: 1.2 }), new FadeIn(aLabel, { runTime: 1.2 }));
    await env.play(new Create(inner, { runTime: 1 }), new FadeIn(intLabel, { runTime: 1 }));
    await env.play(
      ...dots.map((d) => new FadeIn(d, { runTime: 1 })),
      new FadeIn(bdLabel, { runTime: 1 }),
    );
    await env.wait(0.5);
    await env.play(new FadeIn(f1, { runTime: 1 }));
    await env.play(new FadeIn(f2, { runTime: 1 }));
    await env.play(new FadeIn(f3, { runTime: 1 }));
    await env.wait(3.3);
  },
);

const closureCriterionSegment = listSegment({
  name: '闭包的邻域判据',
  // 4 条 × (1 + 1) + 4 = 12。
  duration: 12,
  subtitles: [
    { start: 0.2, end: 5.5, text: '点在闭包里,当且仅当' },
    { start: 5.7, end: 11.8, text: '它的每个开邻域都碰到集合' },
  ],
  entries: () => [
    labelLine('闭包的邻域判据', 30),
    texLine('x \\in \\overline{A} \\iff \\forall U \\ni x,', 26),
    texLine('U \\text{ 开 } \\Rightarrow U \\cap A \\neq \\varnothing', 26),
    labelLine('每个开邻域都碰到 A', 22),
  ],
  gap: 1,
  holdSeconds: 4,
});

const basisSegment = listSegment({
  name: '基与子基',
  // 4 条 × (1 + 1) + 4 = 12。
  duration: 12,
  subtitles: [
    { start: 0.2, end: 5.5, text: '基拼出全部开集' },
    { start: 5.7, end: 11.8, text: '开球是欧氏空间的典型基' },
  ],
  entries: () => [
    labelLine('基与子基', 30),
    texLine('\\mathcal{T} = \\{\\bigcup B_\\alpha\\}', 26),
    labelLine('子基的有限交构成基', 22),
    texLine('B_r(x) = \\{y : \\lVert x-y \\rVert < r\\}', 24),
  ],
  gap: 1,
  holdSeconds: 4,
});

const ch2Card = chapterCard({
  name: '章节 · 连续与同胚',
  title: '第二章',
  heading: '连续与同胚',
  narration: '第二章,连续与同胚',
});

const continuitySegment = directedSegment(
  '连续的定义',
  // 1.2 + 0.8 + 1 + 1.2 + 0.5 + 1 + 0.8 + 3.5 = 10。
  10,
  [
    { start: 0.2, end: 3.5, text: '连续:开集的原像还是开集' },
    { start: 3.7, end: 7, text: 'Y 里开一块,拉回 X 里也开' },
    { start: 7.2, end: 9.8, text: '注意:定义用的是原像' },
  ],
  async (env) => {
    const { scene } = env;
    const narrow = isNarrow(scene);
    const xPos = narrow ? { x: 0, y: -200 } : { x: -250, y: 0 };
    const yPos = narrow ? { x: 0, y: 40 } : { x: 250, y: 0 };
    const xBlob = narrow
      ? new Ellipse(120, 90).moveTo(xPos)
      : new Ellipse(110, 140).moveTo(xPos);
    const yBlob = narrow
      ? new Ellipse(120, 90).moveTo(yPos)
      : new Ellipse(110, 140).moveTo(yPos);
    const arrow = narrow
      ? new Arrow({ x: 0, y: -100 }, { x: 0, y: -60 })
      : new Arrow({ x: -120, y: 0 }, { x: 120, y: 0 });
    const fLabel = narrow ? tex('f', 30, { x: 38, y: -80 }) : tex('f', 30, { x: 0, y: 42 });
    const vPos = narrow ? { x: 30, y: 55 } : { x: 270, y: 30 };
    const vDisk = new Circle(narrow ? 35 : 40).moveTo(vPos);
    vDisk.setStyle({ fill: '#dbeafe' });
    const vLabel = narrow ? tex('V', 24, { x: 30, y: 108 }) : tex('V', 24, { x: 270, y: 100 });
    const prePos = narrow ? { x: -30, y: -215 } : { x: -270, y: -20 };
    const preDisk = new Circle(narrow ? 35 : 45).moveTo(prePos);
    preDisk.setStyle({ fill: '#dbeafe' });
    const preLabel = narrow
      ? tex('f^{-1}(V)', 20, { x: -30, y: -162 })
      : tex('f^{-1}(V)', 22, { x: -270, y: 62 });
    const xLabel = tex('X', 28, narrow ? { x: -88, y: -248 } : { x: -318, y: -108 });
    const yLabel = tex('Y', 28, narrow ? { x: 88, y: -8 } : { x: 318, y: -108 });
    const f1 = narrow
      ? tex('V \\text{ 开 } \\Rightarrow f^{-1}(V) \\text{ 开}', 22, { x: 0, y: 200 })
      : tex('V \\text{ 开 } \\Rightarrow f^{-1}(V) \\text{ 开}', 26, { x: 0, y: 220 });
    const note = narrow
      ? label('用原像,不是像!', 22, { x: 0, y: 252 })
      : label('用原像,不是像!', 24, { x: 0, y: 278 });
    unrevealed(xBlob, yBlob, arrow);
    hide(fLabel, vDisk, vLabel, preDisk, preLabel, xLabel, yLabel, f1, note);
    stage(
      scene,
      [xBlob, yBlob, arrow, fLabel, vDisk, vLabel, preDisk, preLabel, xLabel, yLabel, f1, note],
      24,
    );
    await env.play(new Create(xBlob, { runTime: 1.2 }), new Create(yBlob, { runTime: 1.2 }));
    await env.play(new Create(arrow, { runTime: 0.8 }), new FadeIn(fLabel, { runTime: 0.8 }));
    await env.play(new FadeIn(vDisk, { runTime: 1 }), new FadeIn(vLabel, { runTime: 1 }));
    await env.play(new FadeIn(preDisk, { runTime: 1.2 }), new FadeIn(preLabel, { runTime: 1.2 }));
    await env.wait(0.5);
    await env.play(new FadeIn(f1, { runTime: 1 }));
    await env.play(new FadeIn(note, { runTime: 0.8 }));
    await env.wait(3.5);
  },
);

const epsilonSegment = listSegment({
  name: 'ε-δ 语言',
  // 3 条 × (1 + 1) + 4 = 10。
  duration: 10,
  subtitles: [
    { start: 0.2, end: 4.5, text: '度量空间里,连续就是 ε-δ 语言' },
    { start: 4.7, end: 9.8, text: '两点靠近,像也靠近' },
  ],
  entries: () => [
    labelLine('回到度量空间', 30),
    texLine('\\forall \\varepsilon > 0, \\exists \\delta > 0', 26),
    texLine('d_X(x,x_0)<\\delta \\Rightarrow d_Y(f(x),f(x_0))<\\varepsilon', 22),
  ],
  gap: 1,
  holdSeconds: 4,
});

const homeoSegment = directedSegment(
  '同胚',
  // 1.2 + 0.5 + 1.8 + 0.8 + 1 + 1.2 + 3.5 = 10。
  10,
  [
    { start: 0.2, end: 3.5, text: '圆压成椭圆,拓扑结构没变' },
    { start: 3.7, end: 7, text: '双射且正反都连续,就是同胚' },
    { start: 7.2, end: 9.8, text: '同胚的空间,拓扑完全相同' },
  ],
  async (env) => {
    const { scene } = env;
    const narrow = isNarrow(scene);
    const center = narrow ? { x: 0, y: -180 } : { x: -150, y: 0 };
    const circle = new Circle(narrow ? 80 : 90).moveTo(center);
    const ellipse = narrow
      ? new Ellipse(120, 55).moveTo(center)
      : new Ellipse(130, 60).moveTo(center);
    const xLabel = narrow
      ? tex('X', 28, { x: 0, y: -292 })
      : tex('X', 28, { x: -150, y: -125 });
    const yLabel = narrow
      ? tex('Y', 28, { x: 0, y: -80 })
      : tex('Y', 28, { x: -150, y: 122 });
    const f1 = narrow
      ? tex('f, f^{-1} \\text{ 都连续}', 24, { x: 0, y: 70 })
      : tex('f, f^{-1} \\text{ 都连续}', 26, { x: 200, y: -40 });
    const big = narrow
      ? tex('X \\cong Y', 40, { x: 0, y: 160 })
      : tex('X \\cong Y', 44, { x: 200, y: 60 });
    unrevealed(circle);
    // 变形目标先藏起:Transform 开始前它不该露出来;预置 0 的目标结束时按 1 恢复。
    hide(ellipse, xLabel, yLabel, f1, big);
    stage(scene, [circle, ellipse, xLabel, yLabel, f1, big], 24);
    await env.play(new Create(circle, { runTime: 1.2 }));
    await env.wait(0.5);
    await env.play(new Transform(circle, ellipse, { runTime: 1.8 }));
    await env.play(new FadeIn(xLabel, { runTime: 0.8 }), new FadeIn(yLabel, { runTime: 0.8 }));
    await env.play(new FadeIn(f1, { runTime: 1 }));
    await env.play(new FadeIn(big, { runTime: 1.2 }));
    await env.wait(3.5);
  },
);

const bijSegment = listSegment({
  name: '连续双射与同胚',
  // 4 条 × (1 + 1) + 4 = 12。
  duration: 12,
  subtitles: [
    { start: 0.2, end: 5.5, text: '连续双射,还差逆映射连续' },
    { start: 5.7, end: 11.8, text: '紧致配 Hausdorff,自动补上' },
  ],
  entries: () => [
    labelLine('连续双射 ≠ 同胚', 30),
    texLine('f \\text{ 连续双射 } \\nRightarrow f \\text{ 同胚}', 24),
    labelLine('但紧空间到 Hausdorff 空间,自动同胚', 22),
    texLine('X \\text{ 紧}, Y \\text{ Hausdorff } \\Rightarrow f \\text{ 同胚}', 22),
  ],
  gap: 1,
  holdSeconds: 4,
});

const ch3Card = chapterCard({
  name: '章节 · 核心性质',
  title: '第三章',
  heading: '紧致、连通与分离性',
  narration: '第三章,核心性质',
});

const compactSegment = directedSegment(
  '紧致性',
  // 1 + 1.2 + 0.8 + 0.4 + 1 + 1.2 + 1 + 3 = 9.6。
  9.6,
  [
    { start: 0.2, end: 3.2, text: '开覆盖:一堆开集盖住整个空间' },
    { start: 3.4, end: 6.4, text: '紧致:总能挑出有限个盖住' },
    { start: 6.6, end: 9.4, text: '欧氏空间里,紧就是闭且有界' },
  ],
  async (env) => {
    const { scene } = env;
    const narrow = isNarrow(scene);
    const segment = narrow
      ? new Line({ x: 0, y: -330 }, { x: 0, y: 150 })
      : new Line({ x: -300, y: 0 }, { x: 300, y: 0 });
    const circles: Circle[] = narrow
      ? [-270, -180, -90, 0, 90].map((y) => new Circle(75).moveTo({ x: 0, y }))
      : [-270, -180, -90, 0, 90, 180, 270].map((x) => new Circle(90).moveTo({ x, y: 0 }));
    const dropIdx = narrow ? [1, 3] : [1, 3, 5];
    const fading = circles.filter((_, i) => dropIdx.includes(i));
    const coverPos = narrow ? { x: 128, y: -90 } : { x: 0, y: -130 };
    const coverLabel = label('开覆盖', 24, coverPos);
    const subLabel = label('有限子覆盖', 24, coverPos);
    const fSize = narrow ? 20 : 24;
    const l1 = tex(
      'X \\subseteq \\bigcup_{\\alpha} U_\\alpha',
      fSize,
      narrow ? { x: 0, y: 225 } : { x: 0, y: 170 },
    );
    const l2 = tex(
      '\\Rightarrow X \\subseteq U_1 \\cup \\cdots \\cup U_n',
      fSize,
      narrow ? { x: 0, y: 270 } : { x: 0, y: 225 },
    );
    const hb = tex(
      '\\mathbb{R}^n\\text{ 中:}K\\text{ 紧}\\iff K\\text{ 闭且有界}',
      narrow ? 20 : 22,
      narrow ? { x: 0, y: 315 } : { x: 0, y: 280 },
    );
    unrevealed(segment, ...circles);
    hide(coverLabel, subLabel, l1, l2, hb);
    stage(scene, [segment, ...circles, coverLabel, subLabel, l1, l2, hb], 24);
    await env.play(new Create(segment, { runTime: 1 }));
    await env.play(...circles.map((c) => new Create(c, { runTime: 1.2 })));
    await env.play(new FadeIn(coverLabel, { runTime: 0.8 }));
    await env.wait(0.4);
    await env.play(
      ...fading.map((c) => new FadeOut(c, { runTime: 1 })),
      new FadeOut(coverLabel, { runTime: 1 }),
      new FadeIn(subLabel, { runTime: 1 }),
    );
    await env.play(new FadeIn(l1, { runTime: 1.2 }), new FadeIn(l2, { runTime: 1.2 }));
    await env.play(new FadeIn(hb, { runTime: 1 }));
    await env.wait(3);
  },
);

const connectedSegment = directedSegment(
  '连通性',
  // 1.2 + 0.8 + 0.8 + 0.4 + 1 + 0.4 + 1 + 3.4 = 9。
  9,
  [
    { start: 0.2, end: 3.2, text: '连通:不能劈成两块不交的开集' },
    { start: 3.4, end: 6.2, text: 'U 并 V 盖住全集,还不相交' },
    { start: 6.4, end: 8.8, text: '就只能是空集和全集本身' },
  ],
  async (env) => {
    const { scene } = env;
    const narrow = isNarrow(scene);
    const uPos = narrow ? { x: 0, y: -210 } : { x: -190, y: 0 };
    const vPos = narrow ? { x: 0, y: -20 } : { x: 190, y: 0 };
    const blobR = narrow ? 70 : 80;
    const uBlob = new Circle(blobR).moveTo(uPos);
    const vBlob = new Circle(blobR).moveTo(vPos);
    const uLabel = tex('U', 28, uPos);
    const vLabel = tex('V', 28, vPos);
    const separator = narrow
      ? new Line({ x: -90, y: -115 }, { x: 90, y: -115 }).setStyle({ dash: [6, 5] })
      : new Line({ x: 0, y: -110 }, { x: 0, y: 110 }).setStyle({ dash: [6, 5] });
    const f1 = narrow
      ? tex('X = U \\cup V,\\ U \\cap V = \\varnothing', 22, { x: 0, y: 120 })
      : tex('X = U \\cup V,\\ U \\cap V = \\varnothing', 24, { x: 0, y: 170 });
    const f2 = narrow
      ? label('等价:既开又闭的只有空集和全集', 20, { x: 0, y: 180 })
      : label('等价:既开又闭的只有空集和全集', 22, { x: 0, y: 230 });
    unrevealed(uBlob, vBlob, separator);
    hide(uLabel, vLabel, f1, f2);
    stage(scene, [uBlob, vBlob, uLabel, vLabel, separator, f1, f2], 24);
    await env.play(new Create(uBlob, { runTime: 1.2 }), new Create(vBlob, { runTime: 1.2 }));
    await env.play(new FadeIn(uLabel, { runTime: 0.8 }), new FadeIn(vLabel, { runTime: 0.8 }));
    await env.play(new Create(separator, { runTime: 0.8 }));
    await env.wait(0.4);
    await env.play(new FadeIn(f1, { runTime: 1 }));
    await env.wait(0.4);
    await env.play(new FadeIn(f2, { runTime: 1 }));
    await env.wait(3.4);
  },
);

const pathSegment = directedSegment(
  '道路连通',
  // 1 + 0.8 + 0.5 + 1.5 + 0.5 + 0.8 + 0.8 + 0.8 + 3 = 9.7。
  9.7,
  [
    { start: 0.2, end: 3.2, text: '道路连通:任意两点有路可达' },
    { start: 3.4, end: 6.5, text: '一条连续曲线连起 x 和 y' },
    { start: 6.7, end: 9.5, text: '有路可达,自然连通' },
  ],
  async (env) => {
    const { scene } = env;
    const narrow = isNarrow(scene);
    const blob = narrow
      ? new Ellipse(140, 95).moveTo({ x: 0, y: -190 })
      : new Ellipse(150, 110).moveTo({ x: -150, y: 0 });
    const p0 = narrow ? { x: -70, y: -215 } : { x: -230, y: -35 };
    const p1 = narrow ? { x: -30, y: -170 } : { x: -190, y: 30 };
    const p2 = narrow ? { x: 20, y: -200 } : { x: -120, y: -10 };
    const p3 = narrow ? { x: 60, y: -160 } : { x: -70, y: 40 };
    const legs = [new Line(p0, p1), new Line(p1, p2), new Line(p2, p3)];
    const xDot = new Dot(7).moveTo(p0);
    const yDot = new Dot(7).moveTo(p3);
    const xLabel = narrow ? tex('x', 22, { x: -98, y: -228 }) : tex('x', 22, { x: -258, y: -52 });
    const yLabel = narrow ? tex('y', 22, { x: 85, y: -148 }) : tex('y', 22, { x: -42, y: 58 });
    const f1 = narrow
      ? tex('\\gamma:[0,1] \\to X', 22, { x: 0, y: 20 })
      : tex('\\gamma:[0,1] \\to X', 26, { x: 190, y: -70 });
    const f2 = narrow
      ? tex('\\gamma(0)=x,\\ \\gamma(1)=y', 22, { x: 0, y: 80 })
      : tex('\\gamma(0)=x,\\ \\gamma(1)=y', 26, { x: 190, y: 0 });
    const f3 = narrow
      ? label('道路连通 ⇒ 连通', 20, { x: 0, y: 140 })
      : label('道路连通 ⇒ 连通', 22, { x: 190, y: 70 });
    unrevealed(blob, ...legs);
    hide(xDot, yDot, xLabel, yLabel, f1, f2, f3);
    stage(scene, [blob, ...legs, xDot, yDot, xLabel, yLabel, f1, f2, f3], 24);
    await env.play(new Create(blob, { runTime: 1 }));
    await env.play(
      new FadeIn(xDot, { runTime: 0.8 }),
      new FadeIn(yDot, { runTime: 0.8 }),
      new FadeIn(xLabel, { runTime: 0.8 }),
      new FadeIn(yLabel, { runTime: 0.8 }),
    );
    await env.wait(0.5);
    await env.play(...legs.map((l) => new Create(l, { runTime: 1.5 })));
    await env.wait(0.5);
    await env.play(new FadeIn(f1, { runTime: 0.8 }));
    await env.play(new FadeIn(f2, { runTime: 0.8 }));
    await env.play(new FadeIn(f3, { runTime: 0.8 }));
    await env.wait(3);
  },
);

const hausdorffSegment = directedSegment(
  'Hausdorff 性',
  // 0.8 + 0.4 + 1.2 + 0.6 + 0.4 + 1 + 0.8 + 3.8 = 9。
  9,
  [
    { start: 0.2, end: 3, text: '豪斯多夫:两点总能隔开' },
    { start: 3.2, end: 6, text: '各自找不交的开邻域' },
    { start: 6.2, end: 8.8, text: '极限唯一,紧子集必闭' },
  ],
  async (env) => {
    const { scene } = env;
    const narrow = isNarrow(scene);
    const xPos = narrow ? { x: -60, y: -200 } : { x: -270, y: 0 };
    const yPos = narrow ? { x: 60, y: -120 } : { x: -30, y: 0 };
    const r = narrow ? 55 : 70;
    const xDot = new Dot(7).moveTo(xPos);
    const yDot = new Dot(7).moveTo(yPos);
    const uCircle = new Circle(r).moveTo(xPos).setStyle({ dash: [6, 5] });
    const vCircle = new Circle(r).moveTo(yPos).setStyle({ dash: [6, 5] });
    const xLabel = narrow ? tex('x', 22, { x: -88, y: -200 }) : tex('x', 22, { x: -270, y: 30 });
    const yLabel = narrow ? tex('y', 22, { x: 88, y: -120 }) : tex('y', 22, { x: -30, y: 30 });
    const uLabel = narrow ? tex('U', 22, { x: -60, y: -272 }) : tex('U', 22, { x: -270, y: -100 });
    const vLabel = narrow ? tex('V', 22, { x: 60, y: -192 }) : tex('V', 22, { x: -30, y: -100 });
    const f1 = narrow
      ? tex('x \\in U,\\ y \\in V,\\ U \\cap V = \\varnothing', 22, { x: 0, y: 60 })
      : tex('x \\in U,\\ y \\in V,\\ U \\cap V = \\varnothing', 24, { x: 170, y: -30 });
    const note = narrow
      ? label('极限唯一,紧子集都是闭的', 20, { x: 0, y: 120 })
      : label('极限唯一,紧子集都是闭的', 22, { x: 170, y: 40 });
    unrevealed(uCircle, vCircle);
    hide(xDot, yDot, xLabel, yLabel, uLabel, vLabel, f1, note);
    stage(scene, [xDot, yDot, uCircle, vCircle, xLabel, yLabel, uLabel, vLabel, f1, note], 24);
    await env.play(
      new FadeIn(xDot, { runTime: 0.8 }),
      new FadeIn(yDot, { runTime: 0.8 }),
      new FadeIn(xLabel, { runTime: 0.8 }),
      new FadeIn(yLabel, { runTime: 0.8 }),
    );
    await env.wait(0.4);
    await env.play(new Create(uCircle, { runTime: 1.2 }), new Create(vCircle, { runTime: 1.2 }));
    await env.play(new FadeIn(uLabel, { runTime: 0.6 }), new FadeIn(vLabel, { runTime: 0.6 }));
    await env.wait(0.4);
    await env.play(new FadeIn(f1, { runTime: 1 }));
    await env.play(new FadeIn(note, { runTime: 0.8 }));
    await env.wait(3.8);
  },
);

const preserveSegment = listSegment({
  name: '连续映射保持什么',
  // 3 条 × (1 + 1) + 3 = 9。
  duration: 9,
  subtitles: [
    { start: 0.2, end: 4.5, text: '紧致,连续像仍紧致' },
    { start: 4.7, end: 8.8, text: '连通,连续像仍连通' },
  ],
  entries: () => [
    labelLine('连续映射保持什么', 30),
    texLine('X \\text{ 紧}, f \\text{ 连续 } \\Rightarrow f(X) \\text{ 紧}', 24),
    texLine('X \\text{ 连通}, f \\text{ 连续 } \\Rightarrow f(X) \\text{ 连通}', 24),
  ],
  gap: 1,
  holdSeconds: 3,
});

const outroCard = cardSegment({
  name: '片尾',
  title: '前三章完',
  heading: '定义是骨架,例子是直觉',
  narration: '前三章讲完,后会有期',
  holdSeconds: 5,
});

/** 《拓扑学基础 · 前三章》:21 段约 3.3 分钟(198 秒)。 */
export const topologyFilm: Segment[] = [
  titleCard,
  outlineSegment,
  ch1Card,
  topoDefSegment,
  extremesSegment,
  closedNbhdSegment,
  intClosureSegment,
  closureCriterionSegment,
  basisSegment,
  ch2Card,
  continuitySegment,
  epsilonSegment,
  homeoSegment,
  bijSegment,
  ch3Card,
  compactSegment,
  connectedSegment,
  pathSegment,
  hausdorffSegment,
  preserveSegment,
  outroCard,
];
