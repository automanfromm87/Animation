import type { Segment } from './film';
import { chapterCard, labelLine, listSegment, texLine } from './helpers';

const rulesChapter = chapterCard({
  name: '章节 · 求导法则',
  title: '求导法则',
  heading: '四则运算 · 复合函数',
  narration: '第二章,求导法则',
});

// 条目用工厂建:MObject 是可变的,模块作用域建一份会被每次播放共用
// (同一份清单挂到两个画布上时会互相把对方的 opacity 打回 0)。
const tableSegment = listSegment({
  name: '常用导数表',
  // 7 条 × (1 + 1) + 4 = 18。
  duration: 18,
  subtitles: [
    { start: 0.2, end: 5, text: '最常用的六个求导公式' },
    { start: 5.5, end: 11, text: '幂函数降次,三角函数轮换' },
    { start: 11.5, end: 17, text: 'eˣ 求导不变,是它最美的性质' },
  ],
  entries: () => [
    labelLine('常用导数公式', 30),
    texLine("(C)' = 0", 24),
    texLine("(x^n)' = nx^{n-1}", 24),
    texLine("(\\sin x)' = \\cos x", 24),
    texLine("(\\cos x)' = -\\sin x", 24),
    texLine("(e^x)' = e^x", 24),
    texLine("(\\ln x)' = \\frac{1}{x}", 24),
  ],
  gap: 1,
  holdSeconds: 4,
});

const arithmeticSegment = listSegment({
  name: '四则运算法则',
  // 6 条 × (1 + 1.2) + 5 = 18.2。
  duration: 18.2,
  subtitles: [
    { start: 0.2, end: 4.5, text: '和差的导数,可以逐项求导' },
    { start: 5, end: 9.5, text: '乘积法则:前导后不导,加后导前不导' },
    { start: 10, end: 13.5, text: '除法类似,别忘了分母平方' },
    { start: 14, end: 18, text: '比如 x² 加 sin x,逐项求导即可' },
  ],
  entries: () => [
    labelLine('四则运算法则', 30),
    texLine("(f+g)' = f'+g'", 24),
    texLine("(fg)' = f'g+fg'", 24),
    texLine("(f/g)' = \\frac{f'g-fg'}{g^2}", 24),
    texLine('f(x) = x^2+\\sin x', 24),
    texLine("f'(x) = 2x+\\cos x", 24),
  ],
  gap: 1.2,
  holdSeconds: 5,
});

const chainSegment = listSegment({
  name: '链式法则',
  // 6 条 × (1 + 1.2) + 5 = 18.2。
  duration: 18.2,
  subtitles: [
    { start: 0.2, end: 5, text: '复合函数,一层一层剥开求导' },
    { start: 5.5, end: 11, text: '先设中间变量 u' },
    { start: 11.5, end: 18, text: '外层导数乘以内层导数,链条咬合' },
  ],
  entries: () => [
    labelLine('链式法则', 30),
    texLine('\\frac{dy}{dx} = \\frac{dy}{du}\\cdot\\frac{du}{dx}', 24),
    texLine('y = (x^2+1)^3', 24),
    texLine('u = x^2+1,\\ y = u^3', 24),
    texLine('\\frac{dy}{dx} = 3u^2 \\cdot 2x', 24),
    texLine('= 6x(x^2+1)^2', 24),
  ],
  gap: 1.2,
  holdSeconds: 5,
});

/** 第二章:求导法则。 */
export const rulesChapters: Segment[] = [
  rulesChapter,
  tableSegment,
  arithmeticSegment,
  chainSegment,
];
