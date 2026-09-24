---
name: film-authoring
description: 为本仓库(mini-manim,3Blue1Brown 风格的网页数学动画引擎)写、改、审「影片」——分段清单 + 字幕 + 转场,能导出成视频。凡是要做数学讲解动画 / 短片 / 讲解片 / 科普视频、在 src/film/ 里新增或修改分段(cardSegment、directedSegment、timedSegment、listSegment、chapterCard)、挑片子模板、调节奏和字幕、注册新片、核对时长、给片子配音或导出,都用这个 skill——即使用户只说「做个讲勾股定理的动画」「这段太快了」「加一章」,也要用。
---

# mini-manim 影片创作

**影片 = 分段清单。** 每个分段 = 一个布景 + 一条时间线 + 几条字幕 + 手写的 `duration`。播放器负责段间转场(白场 0.6 秒)、字幕条、带章名的进度条、单帧预览和导出(字幕、进度条、配音一起进成片)。

完整手册是仓库根的 `README.md`(第 2 节教程、第 3 节手艺、第 4 节 11 个模板、第 5–9 节参考、第 12 节排错)。这份 skill 是提炼:流程、硬规则、可照抄的数字。要细节时按小节号查 README,例如 `grep -n '^### 3.4' README.md` 找到行号再读那一段。

- 模板怎么选、每个模板的结构 → [references/templates.md](references/templates.md)
- API 速查(分段模板、SegmentEnv、helpers、常用图元与动画的签名和默认值)→ [references/api-cheatsheet.md](references/api-cheatsheet.md)

## 工作流

1. **定题**:观众看完要记住的**一件事**、片长(一分钟 / 三分钟 / 十分钟)、要不要配音。拿不准就按一分钟概念短片做。
2. **选模板**:按 references/templates.md 选;完整代码在 README 对应小节的折叠块里(`<details>`),复制成 `src/film/<片名>.ts` 再改。从零写就照下面的骨架。
3. **先写分镜再写代码**:一段一件事。每段列出 `段名 | 时长 | 画面 | 字幕 | 用到的 API`,字幕按「设情境 → 指对象 → 描述过程 → 给结论 →(抛下一段的问题)」写。
4. **写文件**:每个 `directedSegment` 上方写一行**时长账**,加起来等于 `duration`。
5. **登记四处**(见下「注册新片」)。
6. **核验**(不用先注册):
   ```bash
   node skills/film-authoring/scripts/check-film.mjs src/film/<片名>.ts
   ```
   它在临时副本里做类型检查、oxlint,把导出的每个分段干跑一遍,核对声明时长 vs 实际时间线(±0.25 秒)、字幕区间,并提醒偏长 / 偏快的字幕。登记之后再跑 `node scripts/test.mjs content` 和 `npm run check`。
7. **看画面**:`npm run dev`,打开 `/?scene=<键>`;`/?scene=<键>&preview=<秒>` 看某一帧(秒 = 前面各段 duration 之和 + 段内秒数;预览不画白场、字幕、进度条)。16:9 和 9:16 各看一遍。沙箱里起不了浏览器时,把要人眼看的点列给用户。
8. **交付时汇报**:每段声明 / 实际时长、总长(Σ duration + 0.6 × 段数)、核验结果、需要用户在浏览器里确认的画面。

## 骨架:一部能跑的小片

```ts
// src/film/skillSkeleton.ts
import { Create, Line, lightTheme } from '../engine';
import { cardSegment, directedSegment } from './film';
import type { Segment } from './film';
import { fadeIns, hide, isNarrow, makePlot, plotIntro, stage, tex, unrevealed } from './helpers';

// 卡片的时长自动算:1 + holdSeconds。
const intro = cardSegment({
  name: '片头',
  title: '直线的斜率',
  heading: '陡不陡,用一个数说清',
  narration: '今天说说直线的斜率。',
  holdSeconds: 4,
});

const slope = directedSegment(
  '斜率',
  // 3.5 开场 + 1.5 画三角 + 1 停 + 1.2 公式 + 1.5 停 + 1.5 结论 + 4 停留 = 14.2。
  14.2,
  [
    { start: 0.2, end: 3.3, text: '先画坐标系和一条直线' },
    { start: 3.7, end: 6.9, text: '取一段:横走两格,竖升一格' },
    { start: 7.1, end: 10.3, text: '斜率等于竖升除以横走' },
    { start: 10.5, end: 14.0, text: '这条直线的斜率是二分之一' },
  ],
  async (env) => {
    const { scene } = env;
    scene.setTheme({ ...lightTheme, showGrid: false, showAxes: false }); // 关背景网格和原点十字
    const narrow = isNarrow(scene); // 竖屏只改位置,时间线不变
    const p = makePlot({
      xRange: [0, 6],
      yRange: [0, 4],
      width: 360,
      height: 260,
      fn: (x) => 0.5 * x + 0.5,
      at: narrow ? { x: 0, y: -110 } : { x: -130, y: 0 },
    }); // 坐标轴与曲线已藏好,交给 plotIntro
    const run = new Line(p.W(2, 1.5), p.W(4, 1.5)).setStyle({ stroke: '#2563eb', strokeWidth: 3 });
    const rise = new Line(p.W(4, 1.5), p.W(4, 2.5)).setStyle({ stroke: '#db2777', strokeWidth: 3 });
    const formula = tex('k = \\frac{\\Delta y}{\\Delta x}', 36, narrow ? { x: 0, y: 120 } : { x: 210, y: -40 });
    const result = tex('k = \\frac{1}{2}', 36, narrow ? { x: 0, y: 190 } : { x: 210, y: 40 });
    unrevealed(run, rise); // 要 Create 的:收起描边
    hide(formula, result); // 要 FadeIn 的:opacity 0
    stage(scene, [p.plot, run, rise, formula, result], 24); // add + 取景(已避开字幕安全区)

    await plotIntro(env, p); // 0–3.5
    await env.play(new Create(run, { runTime: 1.5 }), new Create(rise, { runTime: 1.5 })); // 3.5–5.0
    await env.wait(1); // 5.0–6.0
    await env.play(...fadeIns([formula], 1.2)); // 6.0–7.2
    await env.wait(1.5); // 7.2–8.7
    await env.play(...fadeIns([result], 1.5)); // 8.7–10.2
    await env.wait(4); // 10.2–14.2 收尾停留,不 FadeOut
  },
);

const outro = cardSegment({ name: '片尾', title: '斜率', heading: '感谢观看', narration: '感谢观看。', holdSeconds: 3 });

export const skillSkeletonFilm: Segment[] = [intro, slope, outro];
```

import 只从三处来:引擎 `'../engine'`,分段模板与类型 `'./film'`,助手 `'./helpers'`(helpers 不经 `./film` 导出)。类型用 `import type`。

## 硬规则(违反了不报错,只出怪事)

**1. 先藏后揭。** 对象 `add` / `stage` 之后从第一帧起就整个画出来,入场动画到开播那一刻才藏它。所以将来才入场的对象,搭建时就按入场方式藏好:

| 入场 | 搭建时 | 注意 |
| --- | --- | --- |
| `FadeIn(m)` | `hide(m)` | 只藏被 FadeIn 的那一层;`FadeIn(group)` 时子元素别藏 |
| `Create(m)` | `unrevealed(m)` | Create 不碰 opacity,被 hide 过的永远看不见。Annotation(Brace、Angle 等)、3D 网格、空组不能 Create,改 FadeIn |
| `Write(m)` | 不藏;不是第一拍时 `hide(m)`,紧挨 `env.play(new Write(m))` 的上一行写 `m.opacity = 1` | |
| `Transform` / `TransformMatchingTex(src, dst)` | `hide(dst)`,两个都进场景 | 播完 src 留在场景(opacity 0),之后对 dst 做动画 |
| `makePlot` 的轴和曲线 | 已藏好 | 用 `plotIntro`;另加进 `p.plot` 的曲线要自己 `unrevealed` |
| `Succession` 里靠后的入场 | 按各自方式藏 | 轮到才开始 |

**2. 用 `env.play` / `env.wait`,不用 `scene.play` / `scene.wait`。** 跳转、销毁、横竖屏重建时前者抛取消哨兵让脚本停下,后者会在已释放的场景上空跑。`scene.playFit(...)` 之后跟 `env.checkpoint()`;`try/catch` 要把错误重新抛出。

**3. 时长账。** `duration` 必须等于实际时间线(内容测试 ±0.25 秒)。写错不报错:实际更长,后面的字幕永远不出;更短,进度条往前跳。

| 写法 | 花的秒数 |
| --- | --- |
| `env.play(a, b, …)` | 最长的 runTime(缺省 1,`Wiggle` 2) |
| `env.wait(s)` / `sweep(env, { runTime })` | s / runTime |
| `new LaggedStart([…])` | n 个 d 秒:d × (1 + 0.2 × (n − 1)) |
| `new Succession([…])` / `new AnimationGroup([…])` | 之和 / 最长 |
| `plotIntro(env, p)` | 3.5(`curveRunTime: 2` 时 3) |
| `fadeSequence(env, items, { runTime, gap })` | n × (runTime + gap) |
| `cardSegment` / `chapterCard` | 1 + holdSeconds(自动)/ 7(自动) |
| `listSegment` | n × (1 + gap) + holdSeconds,**自己算好写进 duration**(n 含标题行) |
| `timedSegment` | 不写 duration,由台词 / 配音时间表决定(见 api-cheatsheet) |

**4. 字幕。** 首条 0.2 秒起;相邻间隙 0.2–0.5 秒;每条 ≤ 20 字(单行,两行会压进画面);停留 2.5–6 秒;读速 ≤ 4.5 字/秒(舒服的是字数 / 3 秒;字母、数字、符号都按字算);`[start, end)` 不重叠;末条不晚于段尾。关键信息必须写进字幕(读屏只念字幕)。结论字幕出现时,画面已停在它说的状态。

**5. 转场。** 每段前 0.6 秒被白场淡入遮着,别把一闪而过的关键镜头放在 t < 0.6;段尾再定格 0.6 秒淡出(不计入 duration),所以**以停留收尾,不要 FadeOut**。收尾停留 3–6 秒(中位 4)。

**6. 脚本要能重放。** 预览、跳转、离线导出、配音草稿都会在虚拟时钟上重跑 `direct`:只用引擎的时间,不用 `setTimeout` / `Date.now()` / 无种子 `Math.random()`;MObject 在 `direct` 里新建(`listSegment` 的 `entries` 必须是工厂函数)。

**7. 数学必须准确。** 字幕和画面上每句话都要站得住(「h 趋于 0」不是「h 等于 0」;极值的必要条件不要说成充要条件)。

**8. 竖屏。** 9:16 会重建当前段;用 `isNarrow(scene)` 分支,只改位置和大小,时间线不变(内容测试只跑横屏,竖屏要人眼看)。左右并排的布局改成上下叠放。

## 可照抄的数字

| 用途 | 写法 | 秒 |
| --- | --- | --- |
| 点、标签、列表条目 | `FadeIn` | 1.0,之后停 0.5–1 |
| 公式、辅助线组 | `FadeIn` | 1.2,之后停 1 |
| 结论公式 | `FadeIn` | 1.5,之后停 ≥ 1.5 |
| 曲线 / 直线、切线 / 箭头 | `Create` | 2.5 / 1.5 / 0.8 |
| 主扫动 / 回到关键值 | `sweep` | 5–12(典型 8)/ 1.5–2 |
| 公式原地演化 | `FadeTransform(f, '新 TeX')` | 1.5,换形前停 1–3.5 |
| 按结构推导 | `TransformMatchingTex` | 1.3–1.5 |
| 强调 | `Indicate` / `Circumscribe` / `Flash` / `Wiggle` | 0.8–1 / 1 / 1 / 2 |
| 换色 | `ColorTo` | 0.9 |
| 思考题(选项出齐后) | `env.wait` | 7 |
| 卡片停留 | 片头 / 章节卡 / 片尾 | 4 / 6 / 3–5 |

字幕说「匀速」,缓动就必须 `rateFunc: linear`(从 `'../engine'` import);缺省 `smooth` 两头慢。

**片长参考**:一分钟概念短片 30–60 秒、3–5 段(内容段 15–25 秒,3–6 条字幕);三分钟章节短片约 21 段(内容段约 10 秒,3 条字幕);十分钟一集约 35 段(内容段 14–25 秒,4–5 条字幕)。全片动与停约各一半,别连着三段扫动。同一时刻只给一个新焦点。

**标准节拍(坐标系类内容段)**:`plotIntro` 3.5 → 引入对象 1–1.5 → 停 1 → 主动作(扫动 5–12 或画线 1.5)→ 回到关键值 1.5–2 → 结论淡入 1.2–1.5(同时撤脚手架)→ 停 3–6。

## 版面与颜色

- 坐标:原点在画面中心,x 向右、**y 向下**,角度弧度**顺时针**;但 `Axes` / `NumberPlane` 内部是数学坐标(y 向上),用 `p.W(x, y)` / `axes.toLocal` 换算。
- 取景:搭完景用 `stage(scene, 对象[], pad)`(= add + `fitObjects`),pad 常用 20–40;会动、会变长的对象按最大的样子放进 `stage` 第 4 个参数 `fitExtra`(只参与取景)。有字幕的段自动避开字幕安全区;**没字幕的段不避让**,底部进度条(18 px,有章名 38 px)可能压住内容。
- 字号是世界单位,屏幕大小取决于取景缩放:卡片缩放约 2.9、坐标系段约 1.3。常用:标题 56,公式 34–40,标签 22–28。`Axes` 刻度数字固定 10 号。
- 背景:影片主题默认画淡网格和原点十字,在 `direct` 里 `scene.setTheme({ ...lightTheme, showGrid: false, showAxes: false })` 关掉(只影响本段;卡片、列表段关不了)。
- 颜色(十六进制,别用颜色名):墨色 `#1a1a1a` 主线;蓝 `#2563eb` 主对象;粉 `#db2777` 强调 / 切线;绿 `#16a34a` 结论、正确;紫 `#7c3aed` 次要;灰 `#9ca3af` 对照;红 `#dc2626` 错误;橙 `#ea580c` 只做临时高亮。公式上色用 `textColor` 或 `ColorTo(tex, '#hex')`,局部用 `\textcolor{#hex}{…}`(不支持 `\textcolor[HTML]`、`\bm`)。

## 注册新片(四处)

```ts
// ① src/sceneRegistry.ts —— SCENES 末尾加一行(键 = ?scene= 的值;第二个参数 voiceId)
  myfilm: filmEntry('片名', 'myfilm', async () => (await import('./film/myFilm')).myFilm),
```

```ts
// ② src/film/catalog.ts —— FILM_CATALOG 加一行,键必须等于 voiceId
  myfilm: async () => (await import('./myFilm')).myFilm,
```

```ts
// ③ src/film/content.test.ts —— import 并加进 suite(只放全由固定时长分段组成的片子;含 timedSegment 的照 voiceDemo.test.ts 另写测试)
import { myFilm } from './myFilm';
  ...myFilm.map((s) => audit('片名', s)),
```

```ts
// ④ src/film/voiceDemo.test.ts —— 「影片目录」用例里写死的片名列表按 catalog 顺序补上
      equal(filmNames().join(','), 'film,derivatives,topology,voice-demo,myfilm');
```

用 `filmEntry`,不要自己写 `fromFilm(runFilm(...))`(会跳过配音准备)。键、voiceId、catalog 键用同一个小写字符串最省事。配音时间表放 `public/voice/<voiceId>/timing.json`,改了要刷新页面。

## 常见问题 → 修法

| 现象 | 原因 → 修法 |
| --- | --- |
| 对象开场就露出、到时间「啪」地消失再出现 | 没先藏 → 按硬规则 1 |
| `Create` 完仍看不见 | 用了 `hide` → 改 `unrevealed`,或 Create 前 `m.opacity = 1` |
| `Create 需要支持描边生长的对象……` | Brace / Angle / 3D / 空组不能 Create → 改 FadeIn |
| 「源对象 / 目标对象不在场景里」 | Transform 的两个对象都要先 `stage` |
| 内容测试「声明时长 X 秒,实际时间线 Y 秒」 | 时长账算错 → 按实际改 duration,或补 / 删 `env.wait` |
| 「字幕重叠或乱序」/「字幕晚于分段结束」 | 调 start / end,或加长 duration |
| 字幕压住画面 | 字幕超过一行 → 缩到 ≤ 20 字 |
| 公式显示成红字 | TeX 写错或用了不支持的命令(`tex.error` 不一定报)→ 改源码,预览里看一眼 |
| 加片后 `npm test` 在 voiceDemo.test 失败 | 登记 ④ 没做 |
| 竖屏出画 / 字太小 | 加 `isNarrow` 分支,扫动两端放进 `fitExtra` |
| 导出没有配音 | 看导出后工具条下方的提示(`handle.audio` 的原因);README §11、§12 |

更多见 README §12。配音流程见 README §10 和 references/api-cheatsheet.md 的 timedSegment 一节。

## 交付前检查清单

- [ ] `check-film.mjs` 全部通过,没有字幕提醒(或每条提醒都有理由)
- [ ] 登记四处;`node scripts/test.mjs content`、`npm run check` 通过
- [ ] 每段一件事;字幕叙事弧完整;结论字幕与画面同步
- [ ] 每个将来入场的对象都藏好了(用 `?preview=段起点+0.1` 看:只有第一个动画在入场)
- [ ] 段尾停留 3–6 秒,没有 FadeOut 收尾;关键镜头不在 t < 0.6
- [ ] 数学表述逐句核对过
- [ ] 16:9、9:16 各看一遍(或把需要人眼看的帧列给用户)
