# Mini Manim

Manim / 3Blue1Brown 风格的网页数学动画引擎,外加一个影片播放器,面向数学科普。

写一部片子,就是写一份**分段清单**:每一段是一个布景、一条时间线和几条字幕。播放器负责段间转场、字幕、带章名的进度条,
还能把整部片子逐帧离线导出成视频(字幕、进度条、配音一起进成片)。公式由 MathJax 排成矢量字形,和图形画在同一张画布上;
配音由外部提供 —— 交一份时间表和音频,时长、字幕、动画提示点自动对齐。

**这份 README 怎么读**

| 你想 | 读哪里 |
| --- | --- |
| 看看能做出什么 | [1. 跑起来](#1-跑起来) |
| 从零写出第一部片子并导出(约 15 分钟) | [2. 第一部片子](#2-第一部片子) |
| 把片子做**好**:稿子、节奏、字幕、版面、颜色、强调 | [3. 好片子的手艺](#3-好片子的手艺) |
| 找一个现成的结构,换成自己的题材 | [4. 片子模板](#4-片子模板)(11 个模板 + 镜头套路速查) |
| 查某个函数、图元、动画怎么用、默认值是多少 | [5. 分段与影片参考](#5-分段与影片参考) · [6. 图元](#6-图元) · [7. 动画](#7-动画) · [8. 场景、相机与取景](#8-场景相机与取景) · [9. 3D](#9-3d) |
| 给片子配音、导出视频 | [10. 配音](#10-配音) · [11. 导出视频](#11-导出视频) |
| 出了问题 | [12. 排错速查](#12-排错速查) |
| 改引擎、跑测试、了解分层 | [13. 附录:开发者](#13-附录开发者) |

写片子不需要读源码:这份 README 里的每个完整示例(代码块第一行写着 `// src/film/….ts` 的)都是能直接放进仓库的文件,
都经过类型检查,并按内容测试的标准把时间线逐段干跑核对过。

**目录**

- [1. 跑起来](#1-跑起来)
- [2. 第一部片子](#2-第一部片子)
- [3. 好片子的手艺](#3-好片子的手艺)
- [4. 片子模板](#4-片子模板)
  - [4.1 怎么用模板](#41-怎么用模板)
  - [4.2 一分钟概念短片](#42-一分钟概念短片)
  - [4.3 几何证明片](#43-几何证明片)
  - [4.4 公式推导片](#44-公式推导片)
  - [4.5 函数图像探索片](#45-函数图像探索片)
  - [4.6 极限与逼近片](#46-极限与逼近片)
  - [4.7 对比与误区片](#47-对比与误区片)
  - [4.8 习题讲解片](#48-习题讲解片)
  - [4.9 三分钟章节短片](#49-三分钟章节短片)
  - [4.10 十分钟完整一集](#410-十分钟完整一集)
  - [4.11 配音驱动短片](#411-配音驱动短片)
  - [4.12 3D 直观片](#412-3d-直观片)
  - [4.13 镜头套路速查](#413-镜头套路速查)
- [5. 分段与影片参考](#5-分段与影片参考)
- [6. 图元](#6-图元)
- [7. 动画](#7-动画)
- [8. 场景、相机与取景](#8-场景相机与取景)
- [9. 3D](#9-3d)
- [10. 配音](#10-配音)
- [11. 导出视频](#11-导出视频)
- [12. 排错速查](#12-排错速查)
- [13. 附录:开发者](#13-附录开发者)

## 1. 跑起来

需要 Node `^20.19.0 || >=22.12.0`(Vite 8 的要求)。

```bash
npm install
npm run dev      # 打开终端打印的地址(缺省 http://localhost:5173/)
```

七个入口,用地址里的 `?scene=` 切换(没写或写错都回到总览):

| 地址 | 内容 | 长度 | 可导出 |
| --- | --- | --- | --- |
| `/` | 图形总览:45 件图元画廊 + 单位圆生正弦。开场运镜巡游,之后可拖拽、滚轮缩放;画布聚焦后方向键平移、`+` / `-` 缩放 | — | 否 |
| `/?scene=pythagoras` | 勾股定理证明(演示场景,循环) | 21.5 秒一遍 | 否 |
| `/?scene=vocabulary` | 讲解词汇演示:编排、强调、换色、标注图元、按结构推导(循环) | 69.1 秒一遍 | 否 |
| `/?scene=film` | 勾股定理短片:片头 + 正片 + 片尾 | 3 段,30.5 秒 | 是 |
| `/?scene=derivatives` | 《导数》长片:五章 + 习题 | 35 段,553.9 秒 | 是 |
| `/?scene=topology` | 《拓扑学基础》前三章 | 21 段,198 秒 | 是 |
| `/?scene=voicedemo` | 配音演示片,画面按台词踩点(见 [§10](#10-配音)) | 3 段,带配音 38.85 秒 | 是 |

- 影片长度 = 各段 `duration` 之和;播放和导出时每段另加 0.6 秒转场。页面上循环播放,导出只录一遍。
- voicedemo 的声音来自 `public/voice/voice-demo/`;这个目录不在时(没跑过 `npm run voice:demo`)按草稿排期无声播放,约 38 秒。

**工具条**(右上角):

| 控件 | 作用 |
| --- | --- |
| `全屏` `16:9` `4:3` `9:16` | 画框比例;`全屏` = 浏览器窗口比例,是打开页面时的缺省。横竖翻转时影片当前段从头重建 |
| `暂停` / `播放` | 预览模式下没有 |
| `开启声音` / `关闭声音` | 片子有配音时出现;浏览器要求点一下才出声 |
| `自动` / `MP4` / `WebM` | 导出格式(两种都能导时出现),`自动` = MP4 优先 |
| `导出` | 导出中变成 `取消 N%`,再点就取消;完成后自动下载(文件名见 [2.6](#26-导出)) |

导出后的深琥珀色提示条说的都是配音,红条是导出失败,见 [§11](#11-导出视频)。

**进度条**:点击跳到对应时刻,悬停显示 `分段名 mm:ss / mm:ss`。Tab 聚焦后:`→` `↑` / `←` `↓` 下一段 / 上一段;`PageDown` / `PageUp` 下一章 / 上一章;`Home` / `End` 首段 / 尾段;`空格` / `K` 暂停 / 继续。

**单帧预览**:`/?scene=derivatives&preview=480` 只画第 480 秒那一帧(按各段 `duration` 累加,不含转场,可带小数),不播放。只画主画面,**不画字幕、进度条和转场白场**;只对影片有效。详见 [5.9](#59-预览跳转安全区竖屏重建背景网格与-settheme)。

系统开了「减少动态效果」时,演示场景打开即暂停;影片不受影响。

## 2. 第一部片子

从零写一部四段、38.4 秒的短片《平方与抛物线》:片头卡 → 正方形的面积 → 抛物线的斜率 → 片尾卡;接进页面、跑检查、导出 MP4。约 15 分钟。

### 2.1 三个概念

- **影片 = 分段清单**:`src/film/<文件>.ts` 导出一个 `Segment[]`,按顺序播。
- **分段 = 布景 + 时间线 + 字幕 + 时长**。布景:建图元、按登场方式先藏好、加进场景并取景。时间线:一段 async 脚本,`await env.play(动画…)` / `await env.wait(秒)` 一拍一拍走。字幕:`{ start, end, text }`,秒数从本段开头算。时长:`duration` 手写,必须等于时间线实际长度(±0.25 秒),进度条、跳转、预览、导出都按它算。
- **播放器管其余的事**:段间转场、字幕条、进度条、暂停、配音、导出。

每段的时间结构:前 0.6 秒画面被白场淡开盖着(字幕在白场之上,0.2 秒的首条看得见),一闪而过的关键镜头别放这里;脚本跑完定格,再用 0.6 秒淡到白场(不计入 `duration`),所以段尾以停留收尾,不要 `FadeOut`。成片长度 = Σ`duration` + 段数 × 0.6 秒。详见 [3.2 时间](#32-时间)。

三种分段模板(从 `'./film'` import):

| 模板 | 用来做 | 时长 | 字幕 |
| --- | --- | --- | --- |
| `cardSegment({ name, title \| titleTex, heading \| headingTex, narration, holdSeconds, … })` | 片头卡、片尾卡:大标题 + 横线 + 第二行,1 秒淡入后停住 | 自动 = 1 + `holdSeconds` | `narration` 自动成一条,0.3 秒到段尾 |
| `directedSegment(name, duration, subtitles, async (env) => { … }, { id?, marker?, chapter? })` | 一切内容段 | 手写,等于时间线 | 手写数组,没有就传 `[]` |
| `timedSegment({ id, name, lines, … }, async (env) => { … })` | 配音驱动的段(见 [§10](#10-配音)) | 由配音时间表或草稿排期决定 | 来自台词 |

常用助手(从 `'./helpers'` import,**不在** `'./film'` 里;全部签名见 [5.4](#54-助手helpers)):

| 助手 | 做什么 | 时长 / 要点 |
| --- | --- | --- |
| `hide(...)` / `unrevealed(...)` | 先藏:不透明度归零(给 `FadeIn`)/ 描边收起(给 `Create`) | |
| `stage(scene, objects, pad)` | 加进场景,按这批对象取景 | `pad` 是世界单位 |
| `tex(源码, 字号, 位置?)` / `label(文字, 字号, 位置?)` | 一步建好公式 / 文字 | |
| `fadeIns(objects, runTime)` | 一组同时淡入,展开进 `env.play(...)` | = `runTime` |
| `makePlot({ xRange, yRange, width, height, fn, at })` | 坐标轴 + 曲线 + 换算函数 `W(x, y)`(数学 → 世界坐标) | 轴已藏,曲线已收起 |
| `plotIntro(env, p)` | 轴淡入 1 秒、同时曲线描出 2.5 秒,再停 1 秒 | 3.5 秒 |
| `tangentProbe({ W, f, fp, clamp, halfSpan, readoutOffset? })` | 切点 + 切线 + 斜率读数,`drawAt(a)` 摆到 x = a | 读数缺省在切点正上方 40 |
| `sweep(env, { from, to, runTime, draw })` | 参数补间,每帧调 `draw(值)` | = `runTime` |
| `listSegment(…)` / `chapterCard(…)` | 逐条淡入的列表段 / 章节卡(缺省 7 秒) | |
| `isNarrow(scene)` | 竖屏分支 | 见 [5.9](#59-预览跳转安全区竖屏重建背景网格与-settheme) |

import 规矩:引擎从 `'../engine'`,模板与类型从 `'./film'`,助手从 `'./helpers'`;不要 import `sceneRegistry` 或 `App`(lint 会拦)。

### 2.2 写文件

新建 `src/film/firstFilm.ts`,整份照抄。坐标:原点在画面中央,x 向右,**y 向下**(`{ x: 80, y: -80 }` 在右上方)。每段背景画着浅色方格和过世界原点的深色十字,本例把正方形的角和坐标系原点都对在十字上。

```ts
// src/film/firstFilm.ts
import { Create, FadeIn, Square, Write } from '../engine';
import type { Segment } from './film';
import { cardSegment, directedSegment } from './film';
import {
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

/** 片头卡:时长 = 1 秒开场 + holdSeconds = 5 秒。 */
const titleCard = cardSegment({
  name: '片头',
  title: '平方与抛物线',
  headingTex: 'y = x^2',
  narration: '今天,从一个正方形说到一条抛物线',
  holdSeconds: 4,
});

const squareSegment = directedSegment(
  '正方形的面积',
  // 1.5 画正方形 + 1 边长 + 1 停 + 1.5 写公式 + 1.5 停 + 1.2 翻倍 + 4 停留 = 11.7。
  11.7,
  [
    { start: 0.2, end: 3.2, text: '边长为 x 的正方形' },
    { start: 3.5, end: 6.3, text: '面积是 x 的平方' },
    { start: 6.6, end: 11.5, text: '边长翻倍,面积变成 4 倍' },
  ],
  async (env) => {
    const { scene } = env;
    // 左下角放在世界原点:背景的原点十字正好落在两条边上。
    const square = new Square(160).setStyle({ stroke: '#2563eb' }).moveTo({ x: 80, y: -80 });
    const bottomSide = tex('x', 28, { x: 80, y: 28 });
    const leftSide = tex('x', 28, { x: -26, y: -80 });
    const area = tex('S = x^2', 36, { x: 80, y: 90 });
    const doubled = tex('(2x)^2 = 4x^2', 28, { x: 80, y: 155 });

    // 先藏后揭:Create 登场的收起描边,FadeIn 登场的把不透明度归零。
    unrevealed(square);
    hide(bottomSide, leftSide, doubled);
    // Write 不管不透明度:先藏着,轮到它的前一刻再放回 1。
    hide(area);
    stage(scene, [square, bottomSide, leftSide, area, doubled], 40);

    await env.play(new Create(square, { runTime: 1.5 })); // 0 – 1.5
    await env.play(...fadeIns([bottomSide, leftSide], 1)); // 1.5 – 2.5
    await env.wait(1); // 2.5 – 3.5
    area.opacity = 1;
    await env.play(new Write(area, { runTime: 1.5 })); // 3.5 – 5
    await env.wait(1.5); // 5 – 6.5
    await env.play(new FadeIn(doubled, { runTime: 1.2 })); // 6.5 – 7.7
    await env.wait(4); // 7.7 – 11.7
  },
);

const parabolaSegment = directedSegment(
  '抛物线的斜率',
  // 3.5 开场 + 1.2 探针 + 6 扫动 + 1.5 回到 x=1 + 1.5 结论 + 4 停留 = 17.7。
  17.7,
  [
    { start: 0.2, end: 3.6, text: '这是 y = x² 的图像' },
    { start: 3.9, end: 7.4, text: '切点沿曲线滑动,切线跟着转' },
    { start: 7.7, end: 11.8, text: '顶点左边斜率为负,右边为正' },
    { start: 12.1, end: 17.5, text: '在横坐标 x 处,切线斜率是 2x' },
  ],
  async (env) => {
    const { scene } = env;
    const f = (x: number): number => x * x;
    const fp = (x: number): number => 2 * x;
    // makePlot 已经把坐标轴藏好、把曲线收起,交给 plotIntro 揭开。
    const p = makePlot({
      xRange: [-2, 2],
      yRange: [-0.5, 4.5],
      width: 440,
      height: 330,
      fn: f,
      // 坐标原点落在世界原点(W(0, 0) = (0, 0)):坐标轴压在背景的原点十字上,画面上只有一套十字。
      at: { x: 0, y: -132 },
    });
    const probe = tangentProbe({
      W: p.W,
      f,
      fp,
      clamp: [-2, 2],
      halfSpan: 0.6,
      // 读数放在切点左上方:停在 x = 1 收尾时,不被曲线和切线划掉。
      readoutOffset: { x: -90, y: -30 },
    });
    probe.drawAt(-1.5); // 先摆到起点,再取景
    // 结论写在坐标系左上角的空白里(约在 W(-0.9, 3.9)),避开曲线,也不压在背景十字的竖线上。
    const rule = tex('k = 2x', 30, { x: -100, y: -255 });

    hide(...probe.parts, rule);
    stage(scene, [p.plot, ...probe.parts, rule], 24);

    await plotIntro(env, p); // 0 – 3.5
    await env.play(...fadeIns(probe.parts, 1.2)); // 3.5 – 4.7
    await sweep(env, { from: -1.5, to: 1.5, runTime: 6, draw: probe.drawAt }); // 4.7 – 10.7
    // 回到 x = 1 再下结论:读数 k = 2.00,正好是 2 × 1。
    await sweep(env, { from: 1.5, to: 1, runTime: 1.5, draw: probe.drawAt }); // 10.7 – 12.2
    await env.play(new FadeIn(rule, { runTime: 1.5 })); // 12.2 – 13.7
    await env.wait(4); // 13.7 – 17.7
  },
);

/** 片尾卡:1 + 3 = 4 秒。 */
const endCard = cardSegment({
  name: '片尾',
  title: '谢谢观看',
  heading: '平方与抛物线',
  narration: '感谢观看',
  holdSeconds: 3,
});

export const firstFilm: Segment[] = [titleCard, squareSegment, parabolaSegment, endCard];
```

**卡片**:`cardSegment` 时长 = 1 + `holdSeconds`(片头 5 秒、片尾 4 秒);`title`(文字)/ `titleTex`(公式)必须二选一,第二行 `heading` / `headingTex` 可省。

**先藏后揭**:对象一进场景就整个画出来,动画开始那一刻才设初态;所以靠动画登场的对象要在 `stage` 之前藏好,否则 t=0 就露出来,轮到动画时闪没再重来(完整规则见 [3.4](#34-先藏后揭)):

| 登场动画 | 事先怎么藏 | 本例 |
| --- | --- | --- |
| `Create` | `unrevealed(m)`(= `m.setRevealFraction(0)`)。别用 `hide`:Create 不管不透明度 | `square` |
| `FadeIn` | `hide(m)`(= `m.opacity = 0`);淡入 `Group` 就藏 Group 本身,别藏子元素 | `bottomSide`、`leftSide`、`doubled`、`probe.parts`、`rule` |
| `Write` | 先 `hide`,轮到它的前一刻 `m.opacity = 1`(与 `env.play` 同步执行,不会闪) | `area` |

**样式**:`setStyle` 的键是 `stroke`、`fill`(`null` = 不填)、`strokeWidth`、`fontSize`、`textColor`、`fontFamily`、`dash`;缺省描边 `#1f2937`、线宽 3、不填、字号 28。**没有 `opacity` 键**,写 `m.opacity`。见 [6.10](#610-样式主题与颜色)。

**抛物线段**:`probe.drawAt(-1.5)` 要在 `stage` 之前,否则三件套堆在原点,取景就错。坐标系原点对到世界原点:`yRange` 中点 2、每单位 330 / 5 = 66,所以 `at.y = -2 × 66 = -132`。想要干净背景,在脚本第一行写 `env.scene.setTheme({ ...lightTheme, showGrid: false, showAxes: false })`(`lightTheme` 从 `'../engine'` import;`cardSegment`、`chapterCard`、`listSegment` 关不掉),见 [5.9](#59-预览跳转安全区竖屏重建背景网格与-settheme)。

**时长账**(见 [3.2](#32-时间)):`env.play(a, b)` 同时开始、等最长的播完(`fadeIns` 两个 1 秒同播算 1 秒);`env.wait(s)` 停 s 秒;不写 `runTime` 缺省 1 秒;`plotIntro` 3.5 秒,`sweep` = `runTime`。两段干跑实测 11.72 / 17.72 秒,多出的是 60 帧步进的量化,在 ±0.25 秒内。

**取景**:`stage(scene, objects, pad)` = `scene.add(...objects)` + `scene.fitObjects(objects, pad)`:框住这批对象的包围盒(藏着的也算),四周留 `pad`,避开底部字幕安全区,画幅变了自动重取。所以将来才出现的对象(`doubled`、`rule`)也要一起放进去。字号是世界单位:1280×720 下卡片缩放约 2.8–3.0,内容段约 1.5,同一字号在卡片上约大一倍。没有字幕的段不留安全区,底部进度条(18 像素,有章名时 38)会叠在画面上,`pad` × 缩放要大于它。见 [8.4](#84-取景)。

**字幕**(见 [3.3](#33-字幕)):首条 0.2 秒起,间隙 0.2–0.5 秒(本例 0.3),每条 ≤ 20 字(折行会压住画面)、≤ 约 4.5 字/秒,末条不晚于段尾。字幕跟节拍走:「面积是 x 的平方」与 `Write` 同在 3.5 秒;结论字幕 12.1 秒出现,12.2 秒切点退回 x = 1,读数 2.00 正好是 2 × 1。每句都要数学上站得住。

**竖屏**:两段都是上下叠放或结论在坐标系内,9:16 照样能看;左右并排的构图才需要 `isNarrow` 分支。

**三条纪律**:

1. 用 `env.play` / `env.wait`,不用 `scene.play` / `scene.wait`:分段被跳过或销毁时 `env.*` 让脚本立刻结束,`scene.*` 会在已释放的场景上继续跑。
2. 图元在脚本里现建;脚本要确定(不用 `Math.random()`、`Date.now()`、`setTimeout`),同一段会在播放、跳转、循环、预览、导出时重放很多次。
3. 局部变量别和导入的助手重名(`tex`、`stage`、`hide`……),lint 的 `no-shadow` 会报错。

### 2.3 接进页面和工具

新影片要登记四处,另有一处可选:

| # | 文件 | 改什么 | 漏了会怎样 |
| --- | --- | --- | --- |
| ① | `src/sceneRegistry.ts` | `SCENES` 里加一行 `filmEntry(...)` | `?scene=first` 回落到总览 |
| ② | `src/film/catalog.ts` | `FILM_CATALOG` 里加一行,键 = voiceId | 配音工具报 `没有名为「first」的影片;可选:film、derivatives、topology、voice-demo` |
| ③ | `src/film/content.test.ts` | import 这部片子,加进 `suite` | 内容测试根本不审它(静默漏检) |
| ④ | `src/film/voiceDemo.test.ts` | 写死的影片名列表里加上 `first` | `npm test` 失败(做完 ② 以后) |
| ⑤ | `src/sceneRegistry.test.ts` | 加一行 `preview` 断言(可选) | — |

**① `src/sceneRegistry.ts`**:`SCENES` 末尾加一行:

```ts
  topology: filmEntry('拓扑学基础', 'topology', async () => (await import('./film/topology')).topologyFilm),
  voicedemo: filmEntry('配音演示', 'voice-demo', async () => (await import('./film/voiceDemo')).voiceDemoFilm),
  first: filmEntry('平方与抛物线', 'first', async () => (await import('./film/firstFilm')).firstFilm), // ← 新增
} as const satisfies Readonly<Record<string, SceneEntry>>;
```

- 键 `first`:地址 `?scene=first`,也是导出文件名的开头;
- 参数 1:标签页标题和画布读屏标签;
- 参数 2 voiceId:配音时间表在 `public/voice/first/timing.json`,没有就是无配音。首次打开时读一次并缓存,改了要刷新页面;
- 参数 3:动态 `import()`,打开别的页面时不下载。

`filmEntry` 会先做配音准备(`prepareVoice`)再交给播放器,`?preview=` 也用这份。不要自己手写 `fromFilm(runFilm(...))`。

**② `src/film/catalog.ts`**:

```ts
export const FILM_CATALOG: Readonly<Record<string, () => Promise<readonly Segment[]>>> = {
  film: async () => (await import('./program')).pythagorasFilm,
  derivatives: async () => (await import('./derivatives')).derivativesFilm,
  topology: async () => (await import('./topology')).topologyFilm,
  'voice-demo': async () => (await import('./voiceDemo')).voiceDemoFilm,
  first: async () => (await import('./firstFilm')).firstFilm, // ← 新增
};
```

键必须等于 ① 的 voiceId:`npm run voice:script -- first` 按它找片子,时间表放进 `public/voice/first/`。voiceId 与 `?scene=` 键互不检查(仓库里配音演示就是 `?scene=voicedemo` 对 `voice-demo`),建议三处用同一个小写字符串。

**③ `src/film/content.test.ts`**:顶部加 import,末尾 `suite` 里加一行(第一个参数是测试名里的标签):

```ts
import { derivativesFilm } from './derivatives';
import { firstFilm } from './firstFilm'; // ← 新增
import { pythagorasFilm } from './program';
```

```ts
export default suite('内容时序', [
  ...pythagorasFilm.map((s) => audit('勾股短片', s)),
  ...derivativesFilm.map((s) => audit('导数长片', s)),
  ...topologyFilm.map((s) => audit('拓扑短片', s)),
  ...firstFilm.map((s) => audit('平方与抛物线', s)), // ← 新增
]);
```

只放全由固定时长分段组成的片子;含 `timedSegment` 的片子照 `src/film/voiceDemo.test.ts` 先 `prepareVoice` 再审,见 [§10](#10-配音)。

**④ `src/film/voiceDemo.test.ts`**:「影片目录」用例(第 128 行附近)按 ② 的顺序补上:

```ts
      equal(filmNames().join(','), 'film,derivatives,topology,voice-demo,first');
```

**⑤ `src/sceneRegistry.test.ts`**(可选):

```ts
      equal(typeof SCENES.topology.preview, 'function');
      equal(typeof SCENES.first.preview, 'function'); // ← 新增
```

### 2.4 看效果

`npm run dev`,打开 `http://localhost:5173/?scene=first`;保存后热更新,画面没变就刷新。

用 `?preview=` 逐帧检查,秒数 = 前面各段 `duration` 之和 + 段内秒数(片头 0–5,正方形 5–16.7,抛物线 16.7–34.4,片尾 34.4–38.4):

| 地址 | 应该看到 | 检查什么 |
| --- | --- | --- |
| `/?scene=first&preview=6` | 正方形描了一大半,没有 x、没有公式 | 没登场的对象没露出来 |
| `/?scene=first&preview=8` | 正方形和两个 x,还没有 S = x² | `Write` 之前 `area` 藏着 |
| `/?scene=first&preview=20` | 坐标轴和抛物线,探针还没出现 | `plotIntro` 揭开了轴和曲线 |
| `/?scene=first&preview=34` | 切点停在 x = 1,读数 k = 2.00,左上角 k = 2x | 结论与字幕一致,读数没被划掉 |

- 预览不画字幕,最后要完整播一遍,看字幕是否一行、是否与画面同步。
- 公式写错不报错,只显示成红字,测试也抓不到。
- 点 `9:16` 看竖屏;内容测试只跑 1280×720 横屏。

**出错时**不弹窗,看浏览器控制台:

| 出错的地方 | 页面上 | 控制台 |
| --- | --- | --- |
| 模块顶层代码抛错 | 红条 `场景加载失败:<错误信息>`,片子不播 | `[App] 场景加载失败` |
| 分段起播时抛错(如 `title` / `titleTex` 没写对) | 这一段整个跳过 | `[film] 分段「片尾」启动失败` |
| 脚本跑到一半抛错 | 停在抛错那一刻,淡出后接下一段 | `[film] 分段「正方形的面积」播放出错` |

后两种内容测试都能抓到。

### 2.5 跑检查

```bash
node scripts/test.mjs content   # 只跑内容时序,约 5 秒
npm run check                   # 提交前总检:类型检查 + lint + 全部测试
```

通过时输出 `✓ 63/63 通过（1 个测试文件）`(现有三部片子 59 段 + 本片 4 段)。它在 1280×720 下按 60 帧干跑每段,查:能在 `duration` + 5 秒内结束、运行不报错、时间线与 `duration` 差 ≤ 0.25 秒、字幕区间合法且不重叠、不晚于段尾。**不查**字数语速、竖屏、TeX 红字、互压出画、提前露出,这些靠 [2.4](#24-看效果) 用眼睛看。详见 [5.8](#58-内容测试查什么)。

**时长账对不上**(删掉正方形段的 `await env.wait(1.5);`):

```
✗ 内容时序 › 平方与抛物线 › 正方形的面积
  声明时长 11.7 秒,实际时间线 10.22 秒
  at …/src/film/content.test.ts:66:7
```

补回停顿;或把 `duration`、时长账注释、后面的字幕一起改。

**字幕重叠**(第二条改成 3.0 秒开始):

```
✗ 内容时序 › 平方与抛物线 › 正方形的面积
  字幕重叠或乱序:3 早于上一条结束 3.2「面积是 x 的平方」
  at …/src/film/content.test.ts:74:9
```

后一条的 `start` 不早于前一条的 `end`,留 0.2–0.5 秒。

**字幕晚于段尾**(末条 `end` 写成 18):

```
✗ 内容时序 › 平方与抛物线 › 抛物线的斜率
  字幕「在横坐标 x 处,切线斜率是 2x」在 18 秒结束,晚于分段结束(17.70 秒)
  at …/src/film/content.test.ts:75:9
```

`end` 不超过 `duration`,习惯上在段尾前 0.2 秒结束。

其他常见失败:

| 在哪 | 报错 | 修法 |
| --- | --- | --- |
| 内容测试 | `卡片「片尾」需要 title 与 titleTex 二选一` | `title`、`titleTex` 只写一个 |
| 内容测试 | `分段在 duration + 5 秒内没有结束(已播 X 秒)` | 脚本卡住(等不到的 Promise),或 `duration` 少写 5 秒以上 |
| `npm test` | `期望 film,derivatives,topology,voice-demo,实际 film,derivatives,topology,voice-demo,first` | 漏了 [2.3](#23-接进页面和工具) 第 ④ 步 |
| 类型检查 | `error TS2305: Module '"./film"' has no exported member 'hide'.` | 助手从 `'./helpers'` import |
| lint | `Unexpected console statement.` | 别留 `console.log`(只允许 `console.warn` / `console.error`) |
| 任何测试 | `超时:10000ms 内没有结束(挂起的 Promise?)` | 单条用例超过 10 秒;很长的分段用 `TEST_TIMEOUT=30000 node scripts/test.mjs content` |

测试运行器不做类型检查,类型错误只有 `npm run check`(或 `npm run typecheck`)能发现。更多见 [§12](#12-排错速查)。

### 2.6 导出

1. 先点目标画幅,横屏发布点 `16:9`(缺省 `全屏` 是浏览器窗口比例)。
2. 点 `导出`,按钮变成 `取消 N%`,再点就取消。
3. 完成后自动下载 `first-w16h9-<年月日>-<时分秒>.mp4`(画幅段是 `full` / `w16h9` / `w4h3` / `w9h16`)。

| 项 | 值 |
| --- | --- |
| 格式 | `自动` = MP4 优先,编不了才出 WebM |
| 分辨率 | 长边 1920:16:9 → 1920×1080,4:3 → 1920×1440,9:16 → 1080×1920(实时录制按画布实际像素,不放大) |
| 帧率 | 30 fps |
| 字幕、进度条 | 烧进画面,样式和播放时一样 |
| 配音 | 有就带上;本片没有,成片无声 |
| 长度 | 38.4 + 4 × 0.6 ≈ 40.8 秒 |

- 浏览器支持 WebCodecs 时逐帧离线渲染,可以接着看、切后台;否则实时录制,期间不能暂停、跳转、换画幅,页面须留在前台。导出中关闭或刷新页面会弹离开确认。
- 红条 `影片播了 X 秒还没结束(声明总时长 T 秒),导出中止`:某段时间线停不下来,先跑内容测试。
- 页面上的选项改不了;去掉进度条、换帧率或分辨率要在代码里调影片句柄(`runFilm` 的返回值)的 `exportVideo({ progress: false, fps: 60, maxLongEdge: 1280 })`(`fps` 只对离线渲染有效);去掉字幕是播放器选项 `runFilm(canvas, segments, { subtitles: false })`。见 [§11](#11-导出视频)。

### 2.7 下一步

- [§3 好片子的手艺](#3-好片子的手艺):节奏、字幕、版面、颜色、竖屏分支,把「能跑」变成「好看」。
- [§4 片子模板](#4-片子模板):十一种能直接复制、换题材的完整片子。
- [§5 分段与影片参考](#5-分段与影片参考):全部签名和缺省值。
- 配音看 [§10](#10-配音),导出看 [§11](#11-导出视频),报错查 [§12](#12-排错速查)。

## 3. 好片子的手艺

好片子(3Blue1Brown 式):**一段一件事、节奏从容、画面干净、数学准确**。下面的数字来自现成影片的干跑实测:
导数长片(`?scene=derivatives`,35 段,553.9 秒)、拓扑前三章(`?scene=topology`,21 段,198 秒)、
勾股短片(`?scene=film`,30.5 秒)、配音演示(`?scene=voicedemo`,38.8 秒)。

写片顺序:**写稿 → 分镜表 → 每段节拍表 → 代码 + 时长账 → 内容测试 → 逐段预览**。前三步不写代码。

### 3.1 先写稿再写代码

**一段一件事。**

- 每段只讲一个结论,能用**一条 ≤ 20 个汉字的字幕**说完;说不完就拆成两段。
- 每段一个主画面(一个坐标系或一张示意图),机位不动;换画面就换段。
- 内容段 9–25 秒。超过 25 秒多半塞了两件事(现有最长的「泰勒多项式逼近」24.7 秒)。

**字幕叙事弧。** 内容段 3–5 条字幕,按这个顺序:

| 步 | 作用 | 导数长片「平均速度」段 |
| --- | --- | --- |
| ① | 设情境 / 提问题 | 一辆小车沿直线行驶,这是它的位置-时间图像 |
| ② | 指出对象 | 第 1 秒到第 4 秒,平均速度是多少 |
| ③ | 描述过程 | 位移增量比时间增量,就是割线的斜率 |
| ④ | 给结论(和画面上的结论公式同时出现) | 平均速度,等于 Δs 除以 Δt |
| ⑤ | (可选)抛出下一段的问题 | 那,某一瞬间到底有多快 |

第 ⑤ 句引出下一段「割线逼近切线」,段与段用问题串起来。(第 ① 句 19 字只给 3 秒,是反例,见 [3.3](#33-字幕)。)

**全片骨架**(导数长片、拓扑片都是):

```
片头卡 5 s → 提要 / 目录 10–15 s → [ 章节卡 7 s → 3–9 个内容段 ] × N → 小结 14 s(可选)→ 片尾卡 4–6 s
```

- 片头卡字幕写「今天,我们……」,章节卡写「第 N 章,<章名>」,片尾卡写「感谢观看……」。
- 章名**不要**写「第一章」:进度条会自动编号,写了就成了「一 · 第一章」(拓扑片就是这样)。
- 分段名会显示在进度条悬停提示里、被读屏软件念出来,要起有意义的短名。

**分镜表。** 写代码前先填满(直接复制),时长一栏合计就是片长:

```markdown
| 段 | 时长 | 画面 | 字幕 | 用到的 API |
| --- | --- | --- | --- | --- |
| 片头 | 5 | 标题「<片名>」+ 横线 + 副标题 | 今天,我们<……> | `cardSegment` holdSeconds 4 |
| 本集提要 | 10–15 | 目录,逐条淡入 | 先看提要 / <概括> | `listSegment`(居中),或 `columnList(…, { align: 'start' })` + `fadeSequence`(左对齐) |
| 章节 · <章名> | 7 | 章名 + 横线 + 一行小字 | 第一章,<章名> | `chapterCard` |
| <内容段 1> | <9–25> | <主画面:坐标系 / 示意图;出场顺序> | ①<提问> ②<指认> ③<过程> ④<结论> | `directedSegment` + `makePlot` / `plotIntro` / `sweep` / … |
| <内容段 2> | | | | |
| 小结 | 14 | 居中列表 | <概括规律,不逐条念> | `listSegment` |
| 片尾 | 4–6 | 标题 + 横线 | 感谢观看,<……> | `cardSegment` holdSeconds 3–5 |
| **合计** | <Σ> | 实际播放 ≈ Σ + 0.6 × 段数 | | |
```

卡片、列表的参数见 [5.3](#53-cardsegment)、[5.4](#54-助手helpers)(`title` / `titleTex` 恰好给一个;`entries` 必须是工厂函数),时长见 [3.2](#32-时间) 的时长账表。

然后给每个内容段写**节拍表**(一个 `env.play` 或一段 `env.wait` 算一拍;[3.6](#36-标准节拍一个完整的内容段) 有写好的一张):

```markdown
| t 起止 | 节拍 | 画面动作(动画 · runTime) | 字幕(start–end) |
| --- | --- | --- | --- |
| 0–3.5 | 开场 | plotIntro:轴 1 + 曲线 2.5,停 1 | 0.2–3.3 <提问> |
| … | | | |
| <T−4>–<T> | 收尾停留 | wait 4 | <末条> |
```

### 3.2 时间

**片长。**

| 片型 | 片长 | 段数 | 内容段长 | 每段字幕 | 现成的例子 |
| --- | --- | --- | --- | --- | --- |
| 一分钟概念短片 | 30–60 s | 3–5(含片头、片尾) | 15–25 s | 3–6 | 勾股短片 30.5 s(5 + 21.5 + 4) |
| 配音短片 | 30–60 s | 2–3 个 `timedSegment` | 11–15 s | 2–3 句 | 配音演示 38.8 s |
| 三分钟章节短片 | 3–4 min | ≈ 21 | 9–14 s(中位 10) | 3 | 拓扑前三章 198 s |
| 十分钟完整一集 | 9–10 min | ≈ 35 | 14–25 s(中位 18.2) | 4–5 | 导数长片 553.9 s |

实际播放 / 导出时长 = Σ duration + 0.6 秒 × 段数(每段尾多 0.6 秒淡出),如导数长片 553.9 + 35 × 0.6 ≈ 575 秒。

**节拍密度**(每段节拍数 · 每分钟节拍 · 相邻两拍间隔中位 / p90):导数长片 4–7 拍 / 15–25 s · 16.6 · 2.2 / 6.0 s;拓扑 3–6 拍 / 9–10 s · 24.5 · 1.4 / 2.0 s;配音演示 5 拍 / 11–15 s · 23.2 · 1.3 / 3.7 s。
同一时刻只给一个新焦点:同播的只能是同一件事的部件(点 + 切线 + 读数;ξ 标签 + 结论公式),或新对象加给它腾地方的 `FadeOut`。

**动与停**(动画时间 / 段长):扫动类内容段 0.62–0.76,公式推导、列表、习题 0.27–0.44,卡片 0.14–0.25;**全片约一半**(导数 0.49、拓扑 0.41;配音演示按语速走,0.65)。
扫动段动得多,靠列表、卡片的长停留拉回一半;别连着三段扫动。

**转场。**

- 新段一开始就起播,同时白场 0.6 秒淡成透明:**每段前 0.6 秒画面被遮着**,别把一闪而过的关键镜头放在 t < 0.6(字幕在白场之上,0.2 秒的首条照样看得见)。
- 段播完定格,再 0.6 秒淡到白场(**不计入** duration)。所以段尾**以停留收尾,不要 `FadeOut`**(否则淡两次)。
- 收尾停留 3–6 秒(中位 4)。卡片停留:片头卡 4、章节卡 6、片尾卡 3–5。

**时长账。** `duration` 必须等于实际时间线(内容测试允许 ±0.25 秒,且须在 duration + 5 秒内结束)。写错不报错,只出怪事:
实际更长,进度条停在段尾、后面的字幕永远不出;实际更短,段提前结束、进度条往前跳。所以每个 `directedSegment` 的 duration 上方写一行时长账:

```ts
  // 3.5 开场 + 1.2 + 8 + 2 扫描 + 4 停留。
  18.7,
```

| 写法 | 花的时间(秒) | 备注 |
| --- | --- | --- |
| `await env.play(a, b, …)` | 其中最长的 runTime | 所有动画缺省 runTime 1;`Wiggle` 缺省 2 |
| `await env.wait(s)` | s | |
| `new AnimationGroup([…])` | 最长的子动画 | |
| `new LaggedStart([…])` | 第 i 个在「前面各子动画时长 × 0.2 之和」处开始;n 个都是 d 秒 → d × (1 + 0.2 × (n − 1)) | 3 个 1 秒 → 1.4 |
| `new Succession([…])` | 各子动画时长之和 | |
| `plotIntro(env, p)` | max(轴 1, 曲线 2.5, with 里的动画) + 停 1 = **3.5** | `curveRunTime: 2` 时是 3 |
| `fadeSequence(env, items, { runTime, gap })` | n × (runTime + gap) | 最后一项之后也停 gap |
| `sweep(env, { runTime, … })` | runTime | |
| `playFit` 与 `env.play` 放进同一个 `Promise.all` | 两者中较长的 | 运镜和入场同播,见 [3.7](#37-版面) |
| `cardSegment({ holdSeconds, … })` | 1 + holdSeconds,**自动算** | 唯一一条字幕 [0.3, duration) 也是自动的 |
| `chapterCard({ … })` | 1 + 6 = **7**,自动算 | |
| `listSegment({ entries, gap, holdSeconds, duration, … })` | n × (1 + gap) + holdSeconds,**要自己算好写进 duration** | n 包括标题行 |
| `timedSegment` | 不写 duration。草稿排期 = 0.3 + Σ 每句 + 0.25 × (句数 − 1) + 0.6;每句 = max(0.8, 字数 / 4.5 + 0.15 × 逗号类 + 0.3 × 句号类)(`19.6` 的小数点也算句号类) | 动画比台词长时顺延;有配音时间表就按表。计字细则见 [5.5](#55-timedsegment按台词对齐) |

### 3.3 字幕

| # | 规则 | 数字 | 为什么 / 备注 |
| --- | --- | --- | --- |
| 1 | 首条起点 | **0.2 秒**(卡片和 `timedSegment` 自动 0.3) | 画面领先字幕 0.2 秒 |
| 2 | 相邻间隙 | **0.2–0.5 秒**(拓扑一律 0.2,导数中位 0.5,配音 0.25) | 看得出「换了一句」 |
| 3 | 单条长度 | **≤ 20 个汉字**,单行(现有中位 10–11 字) | 安全区只留一行,第二行会压进画面 19–27 px。一行容量:1280 宽约 51 字,405 宽(9:16)约 23 字,375 宽手机约 21 字 |
| 4 | 单条停留 | **2.5–6 秒**(中位 3.3–4.0) | |
| 5 | 读速 | **≤ 4.5 字/秒**(中位 2.3–3.2);停留 ≥ max(2.5, 字数 / 4.5),舒服的值是字数 / 3 | 超过 5.5 字/秒就读不完 |
| 6 | 条数 | 内容段 3–5,列表段 2–4,卡片 1 | 平均约 4 秒一条,覆盖段长的 85–95% |
| 7 | 末条 | 不晚于段尾,离段尾 0–1.5 秒(中位 0.2) | 播放器按 duration 截断,超出的看不到 |
| 8 | 区间 | `[start, end)` 左闭右开,按时间排序,不重叠(首尾相接可以) | 内容测试会查 |
| 9 | 和画面对齐 | 描述动作的字幕在动作开始 ±0.3–0.6 秒内出现;**结论字幕出现时,画面已停在(或正在回到)它说的状态** | 现有片子 58% 的字幕在某动画开始 ±0.6 秒内 |
| 10 | 列表段 | 概括规律,不逐条念(「幂函数降次,三角函数轮换」) | 条目观众自己会读 |
| 11 | 字幕就是旁白 | 关键信息必须写进字幕,不能只出现在画面上 | 读屏软件只念字幕 |
| 12 | 要配音 | 用 `timedSegment` 按台词排时间,别给手工定时的段直接配音 | TTS 约 3.9 字/秒,手工节奏直接配音会空出 30–40% |

**夹着字母、公式怎么算。** 西文字母、数字、符号(`dy/dx`、`f′(x)`)约半个汉字宽:算**行宽**(规则 3)时两个算一个字;算**读速**(规则 5)不打折,
按非空白字计(空格和标点不算),与 `timedSegment` 口径一致。例:「f(a) 等于 f(b),则存在 ξ 使 f′(ξ) 等于 0」只有 8 个汉字,却是 23 个非空白字,给 3.5 秒就是 6.6 字/秒,读不完。

反例改对:「一辆小车沿直线行驶,这是它的位置-时间图像」19 字只给 3.0 秒(6.3 字/秒)。要么减字(「小车的位置-时间图像」9 字 / 3 秒),要么停留拉到 19 / 3.5 ≈ 5.4 秒并推后后面的字幕。

### 3.4 先藏后揭

最常见的 bug。对象 `scene.add`(或 `stage`)后**从第一帧起就整个画出来**;`FadeIn` 到开播那一刻才把 opacity 置 0,`Create` 也到那时才收起描边。
不先藏的对象会在 t = 0 完整露出,轮到入场时「啪」地消失再出现。规矩:**第一个动画之外、将来才入场的对象,都在搭建时按入场方式藏好。**

| 入场动画 | 搭建时怎么藏 | 注意 |
| --- | --- | --- |
| `FadeIn(m)` | `hide(m)`(即 `m.opacity = 0`) | 淡到 1(或 `to`)。只藏**被 FadeIn 的那一层** |
| `FadeIn(group)` 整组出来 | `hide(group)`,子元素**不要**藏 | 子元素 opacity 为 0,组淡入了它也看不见 |
| 组里成员逐个 `FadeIn` | 逐个 `hide(child)`,组不藏 | `listSegment` / `fadeSequence` 就是这样 |
| `Create(m)` | `unrevealed(m)`(即 `m.setRevealFraction(0)`) | `Create` **不碰 opacity**:被 `hide` 过的要先 `m.opacity = 1`。`Annotation`、3D 网格、空 `Group` / `Layout`、少于 2 点的 `Polygon` 及含它们的组,Create 一开始就抛错(`Create 需要支持描边生长的对象……`),改用 FadeIn |
| `makePlot` 的轴和曲线 | 已藏好(轴 opacity 0、曲线描边收起) | 用 `plotIntro`,或 `FadeIn(p.axes)` + `Create(p.curve)`;另加进 `p.plot` 的 `FunctionGraph` 要自己 `unrevealed` |
| `Write(m)` | **不要藏**。不是第一拍又不能提前露:搭建时 `m.opacity = 0`,紧挨 `env.play(new Write(m))` 的上一行写 `m.opacity = 1` | `Write` 不改 opacity:藏着去写,写完还是看不见。它开始时自己会藏对象,中间不画帧 |
| `Transform(src, target)`、`TransformMatchingTex(src, target)` | `hide(target)`,**两个都**进 `stage` | 替换语义:播完 src 留在场景里(opacity 0),之后对 target 做动画。任一方不在场景里,play 报错「源对象 / 目标对象不在场景里」 |
| `FadeTransform(m, '新串')` | 不藏 | 同一对象原地换内容 |
| `ScaleTo(m, 1)`(从无到有) | 先 `stage`(按 scale 1 取景),再 `m.scale = 0` | 先缩再取景会出画。绕 `position`(组的原点,不是中心)缩放 |
| `Succession([…])` 里靠后的入场 | 按上面各行藏 | 轮到才开始,之前一直露着 |
| `AnimationGroup` / `LaggedStart` 里的入场 | 组是 t = 0 第一拍就不用藏,否则按上面各行藏 | 组起点让所有子动画同时开始,靠后启动的不会提前露。几个 `Write` 要错开,放进一个 `LaggedStart`,别连着几次 `env.play` |
| `Indicate` / `Circumscribe` / `ColorTo` / `MoveTo` / `sweep` 改的对象 | 不藏 | 作用于已看得见的对象 |

**检查**:`/?scene=<片>&preview=<段起点 + 0.1>`(段起点 = 前面各段 duration 之和;影片要已按 [2.3](#23-接进页面和工具) 注册)。预览不画白场、字幕和进度条:
除了正在入场的第一个动画,什么都不该有。再在每次入场前 0.1 秒各看一帧,该入场的对象必须还看不见。

### 3.5 动画节奏表

缺省 runTime 1 秒(`Wiggle` 2 秒),缓动 `smooth`;`Indicate` 用 `thereAndBack`,`Circumscribe`、`Wiggle`、`AnimationGroup` / `LaggedStart` / `Succession` 用 `linear`。现有片子实际用的数:

| 用途 | 写法 | runTime(秒) | 之后停(秒) |
| --- | --- | --- | --- |
| 坐标系开场 | `plotIntro(env, p)` | 轴 1 + 曲线 2.5(同播) | 1(内置),共 3.5 |
| 开场同时淡入别的对象 | `plotIntro(env, p, { curveRunTime: 2, with: [...] })` | 2 | 1,共 3 |
| 点、点名、标签、列表条目 | `FadeIn` | **1.0** | 0.5–1 |
| 公式、探针三件套、辅助线组 | `FadeIn` | **1.2** | 1 |
| 结论公式、收尾标记 | `FadeIn` | **1.5** | 收尾停留 3–6 |
| 小标签、习题选项、小标注 | `FadeIn` | 0.6–0.8 | 0.4–0.6 |
| 曲线 | `Create` | **2.5**(和别的开场同播时 2.0) | |
| 直线、割线、切线 | `Create` | **1.5** | 1 |
| 框、圆、椭圆(示意图) | `Create` | 1.0–1.2 | 0.4–0.6 |
| 箭头 | `Create` | 0.8 | |
| 主扫动 | `sweep` | **5–12**(典型 8) | 0,紧接回扫 |
| 回到关键值 | `sweep` | **1.5–2** | 0,紧接结论 |
| 换下旧对象 | `FadeOut` | 1.0(割线让位给切线 1.2,给结论腾地方 1.5) | |
| 公式原地演化 | `FadeTransform(f, '新 TeX')` | 1.5 | **换形前停 3.5**,最后停 4 |
| 数值代入(`3^2+4^2=5^2` → `9+16=25`) | `FadeTransform` | 1.0 | 换形前停 1 |
| 按结构推导 | `TransformMatchingTex` | 1.3–1.5 | 1–1.5 |
| 形状变形(圆 → 椭圆) | `Transform` | 1.8 | |
| 强调 | `Indicate` / `Circumscribe` / `Flash` / `Wiggle` | 0.8–1.0 / 1.0 / 1.0 / 2.0 | 见 [3.9](#39-指给观众看) |
| 持久换色 | `ColorTo` | 0.9 | |
| 黎曼和加细 | `RiemannTo` | 1.2 | 1–1.5 |
| 运镜(和 `Create` 同播) | `scene.playFit`,写法见 [3.7](#37-版面) | 2.0–2.2 | |
| 3D 转视角 / 曲面变形 | `Orbit3D` / `ParamMorph` | 2.4 / 4 | 0.3–0.5 |
| 列表逐条 | `listSegment` / `fadeSequence` | 1.0 | gap 0.8–1.2(数值表 1.5:每行都要读数字) |
| 中间停顿 | `env.wait` | | 中位 1.0;导数片 1.0–1.5,拓扑片 0.4–0.6 |
| 揭示结论之后 | `env.wait` | | **≥ 1.5** |
| 思考题(选项出齐后) | `env.wait` | | **7** |
| 收尾停留 | `env.wait` | | **3–6**(中位 4) |

缓动:

- 缺省 `smooth` 两头慢中间快,扫动也一样。**字幕说「匀速」,就必须传 `rateFunc: linear`**(导数长片「相关变化率」段:smooth 会让体积增速在末尾归零,和「半径匀速变大」的结论相反)。`FadeIn`、`MoveTo` 等同样接受 `rateFunc`:

  ```ts
  import { linear } from '../engine';
  await sweep(env, { from: 20, to: 110, runTime: 12, draw: drawAt, rateFunc: linear });
  new MoveTo(m, to, { runTime: 2, rateFunc: linear });
  ```

- 字幕要对准扫动中的某一刻,就按缓动算:`sweep` 走过比例 p 的时刻 = 起点 + runTime × u,其中 3u² − 2u³ = p。中点 u = 0.5;走过 20% 在 u ≈ 0.29,80% 在 u ≈ 0.71。

### 3.6 标准节拍:一个完整的内容段

坐标系类内容段的标准节拍(导数长片「罗尔定理」「最优化实例」是完整版):

```
plotIntro 3.5 → 引入对象 1–1.5 → 停 1 → 主动作(扫动 5–12 或画线 1.5)→ 回到关键值 1.5–2 → 结论淡入 1.2–1.5(同时撤掉脚手架)→ 收尾停留 3–6
```

完整写法如下。放进 `src/film/`,把 `craftBeatsSegment` 插进某部已注册([2.3](#23-接进页面和工具))的片子,比如 [2.2](#22-写文件) 的 `firstFilm` 的片尾卡前(`import { craftBeatsSegment } from './craftBeats';`):

```ts
// src/film/craftBeats.ts
import { FadeIn, FadeOut } from '../engine';
import { directedSegment } from './film';
import { fadeIns, hide, label, makePlot, plotIntro, stage, sweep, tangentProbe, tex } from './helpers';

export const craftBeatsSegment = directedSegment(
  '哪里上坡最陡',
  // 3.5 开场 + 1.2 + 1 + 8 扫描 + 2 回扫 + 1.5 + 4 停留 = 21.2。
  21.2,
  [
    { start: 0.2, end: 3.3, text: '正弦曲线上,哪里上坡最陡?' },
    { start: 3.5, end: 7.4, text: '放一条切线,读数就是它的斜率' },
    { start: 7.7, end: 13.4, text: '波峰、波谷处切线放平,斜率为 0' },
    { start: 13.7, end: 18.2, text: '回到原点:上坡最陡,斜率正好是 1' },
    { start: 18.4, end: 21, text: '斜率又怎样随 x 变化?' },
  ],
  async (env) => {
    const { scene } = env;
    const f = Math.sin;
    const fp = Math.cos; // 切线、读数、结论都从同一个导函数算。
    // 范围关于 0 对称、摆在世界原点:坐标轴正好压在背景的原点十字上。
    const p = makePlot({
      xRange: [-Math.PI, Math.PI],
      yRange: [-1.5, 1.5],
      width: 480,
      height: 300,
      fn: f,
      at: { x: 0, y: 0 },
    });
    const probe = tangentProbe({ W: p.W, f, fp, clamp: [-Math.PI, Math.PI], halfSpan: 0.9 });
    // 读数固定在始终空着的左上角;跟点走会在原点被切线划掉。
    const readout = label('', 24, p.W(-2.2, 1.15));
    const drawAt = (a: number): void => {
      probe.drawAt(a);
      readout.text = `k = ${fp(a).toFixed(2)}`;
    };
    drawAt(-2.6);
    // 结论最后才出现,但搭建时就进取景。
    const conclusion = tex("(\\sin x)'\\,\\big|_{x=0} = 1", 28, { x: 0, y: 205 });
    // 先藏后揭:makePlot 已藏好轴和曲线,其余要 FadeIn 的在这里藏。
    const parts = [probe.dot, probe.tangent, readout];
    hide(...parts, conclusion);
    stage(scene, [p.plot, ...parts, conclusion], 24);

    await plotIntro(env, p); // 0–3.5
    await env.play(...fadeIns(parts, 1.2)); // 3.5–4.7
    await env.wait(1); // 4.7–5.7
    await sweep(env, { from: -2.6, to: 2.6, runTime: 8, draw: drawAt }); // 5.7–13.7
    // 回到关键值再下结论:停在 x = 2.6(k = −0.86)画面会和第 4 句相反。
    await sweep(env, { from: 2.6, to: 0, runTime: 2, draw: drawAt }); // 13.7–15.7
    await env.play(
      new FadeIn(conclusion, { runTime: 1.5 }),
      new FadeOut(readout, { runTime: 1.5 }),
    ); // 15.7–17.2
    await env.wait(4); // 17.2–21.2
  },
);
```

节拍表(干跑实测 21.2 秒,与声明一致):

| t 起止 | 节拍 | 画面动作(动画 · runTime) | 字幕(start–end)· 叙事弧 |
| --- | --- | --- | --- |
| 0–3.5 | 开场 | `plotIntro`:轴 1 + 曲线 2.5(同播),停 1 | 0.2–3.3 正弦曲线上,哪里上坡最陡?① |
| 3.5–4.7 | 引入对象 | 切点 + 切线 + 读数 `FadeIn` 1.2 | 3.5–7.4 放一条切线,读数就是它的斜率 ② |
| 4.7–5.7 | 停 | `wait` 1 | 〃 |
| 5.7–13.7 | 主动作 | `sweep` −2.6 → 2.6,8 秒:≈ 8.0 过波谷,9.7 过原点,11.4 过波峰 | 7.7–13.4 波峰、波谷处切线放平,斜率为 0 ③ |
| 13.7–15.7 | 回到关键值 | `sweep` 2.6 → 0,2 秒 | 13.7–18.2 回到原点:上坡最陡,斜率正好是 1 ④ |
| 15.7–17.2 | 结论 | 结论公式 `FadeIn` 1.5,同时读数 `FadeOut` 1.5 | 〃 |
| 17.2–21.2 | 收尾停留 | `wait` 4 | 18.4–21.0 斜率又怎样随 x 变化?⑤ |

要点:动画 15.2 / 21.2 秒(0.72,扫动段正常值);字幕 8–13 字、2.1–3.5 字/秒、间隙 0.2–0.3、末条离段尾 0.2,
第 3 句 7.7 秒出现,赶上 ≈ 8.0 秒过波谷(按缓动公式算),第 4 句随回扫出现;上下叠放不需要竖屏分支(zoom 横屏约 1.4、9:16 约 0.75);
「上坡最陡」只在画出的 [−π, π] 上说,那里 cos x 的最大值 1 只在 x = 0 取到。

换题材:换 `f` / `fp` / 范围 / 关键值和五条字幕,节拍不动;读数挪到新曲线空着的角落,关键值选结论说的点;扫动变了就按缓动公式重新对准第 3 句,并重算时长账。

### 3.7 版面

**取景一次,机位不动。** 搭建时用 `stage(scene, objects, pad)`(加进场景 + `fitObjects`)取景一次,之后整段不动机位。

- 本段**将来会出现的所有对象**(包括最后才淡入的结论)都一起进 `stage`。
- 会变大、会移动的对象按**最大包络**取景:先摆到最大尺寸 / 最远位置 → `stage` → 再 `drawAt(初值)`;或把占位对象传给第 4 个参数 `fitExtra`(只参与取景)。占位太远会把整屏推歪。
- 别只给一个小对象取景(一条 `a^2+b^2=c^2`、pad 40 时 zoom 4.96),要框整个舞台。

**运镜是例外**(导数、拓扑两片一段都没有;勾股短片每个镜头 `playFit` 一次,2.0–2.2 秒)。确需段内换景时,第一个镜头的对象进 `stage`,后出现的只 `scene.add` 并藏好,运镜和入场同播:

```ts
// 运镜与画正方形同播:时长账记 2 秒(取较长者)
await Promise.all([
  scene.playFit([tri, square], { pad: 20, runTime: 2 }), // pad 缺省 0
  env.play(new Create(square, { runTime: 2 })),
]);
env.checkpoint(); // playFit 走的是 scene.play,不检查取消,要补这一句
```

`playFit` 的落点会被记住,之后窗口缩放按它重新取景(横竖翻转则从 t = 0 重建整段)。

**`pad`**(世界单位,屏幕留白 = pad × zoom):20 探针密集的坐标系段;**24** 坐标系段、示意图段的主力;30 列表(`listSegment` 固定 30)、定义段、带侧栏的段;40 卡片(`cardSegment` 固定 40)、配音演示。

**字幕安全区。** 有字幕的段底部让出一条安全区(1280 宽有章名 99 px、没章名 87 px),`fitObjects` 不往里摆;它**只按一行字幕估**,所以字幕 ≤ 20 字。
**没有字幕的段不留**,底部进度条(18 px,有章名 38 px)会盖住内容,所以每段至少一条字幕。详见 [5.9](#59-预览跳转安全区竖屏重建背景网格与-settheme)。

**`fontSize` 是世界单位**,屏幕字号 = fontSize × zoom,zoom 由 `fitObjects` 按内容定。1280×720 实测 zoom:卡片 2.4–3.0(24 号字 58–72 px)、列表 1.5–2.9、
坐标系段 1.08–1.57(24 号字 30–35 px,固定 10 号的刻度 12–15 px);9:16 竖屏坐标系段 0.70–0.79(24 号字 ≈ 18 px,刻度 7–8 px 几乎看不清)。
所以卡片、列表的字比坐标系段大一倍左右(现有影片都接受了);想统一,可往 `fitExtra` 放一个固定尺寸的隐形框(如 `new Rectangle(640, 400)`)。

**按角色的字号**(世界单位):

| 角色 | 字号 | 角色 | 字号 |
| --- | --- | --- | --- |
| 卡片大标题 | 56(缺省);片头、片尾 64–72 | 卡片第二行 | 文字 24、公式 36(缺省) |
| 列表标题行 | 30;小结 / 提要 32;数值表 26 | 列表公式 / 说明 | `texLine` 24(长公式 22,压轴 30–32)/ `labelLine` 22–24 |
| 独立大公式 | 34,`{ displayMode: true }` | 图下结论公式 | 26(主力)/ 28 / 30 |
| 侧栏推导 | 公式 24–26,文字步骤 22 | 逐帧读数 | `Label` 22–24(`tangentProbe` 缺省 22) |
| 点名、小符号 | 22–24 | 坐标轴刻度 / 轴名 | 固定 10 / 13,改不了 |

**标准位置**(横屏,世界坐标,y 向下):

| 元素 | 位置 / 尺寸 |
| --- | --- |
| 坐标系(下方放公式) | `makePlot` 宽 440–520 × 高 300–360,`at: { x: 0, y: -20 … -40 }` |
| 坐标系(右侧放推导栏) | `at: { x: -100 … -150, y: 0 }`;竖屏 `{ x: 0, y: -170 }` |
| 图下结论公式 | y **195–232**(多数 195–205),第二行 y ≈ 290 |
| 侧栏 `sideColumn(scene, n)` | 横屏 `colX` 250,整列以 y = 0 居中(4 行:−105 / −35 / 35 / 105);竖屏 `colX` 0、首行 y 60;行距都是 70 |
| 顶部标题 / 全局读数(h、误差) | y −120,label 26 / 右上角 `{ x: 160 … 170, y: -185 … -190 }` |
| 跟点读数(`tangentProbe`) | 缺省切点上方 `{ x: 0, y: -40 }`;避让时改下方 `{ x: 0, y: 40 }` 或右上 `{ x: 70, y: -30 }` |
| 点名(P、Q、A、B) / 列表 | 离点约 (±18…26, ±22…28) / 居中于 (0, 0),条间距 14、内边距 12 |
| 习题 | 题干 y −120;选项 y −20 / 50 / 120;答案 y 195 |
| 示意图 + 公式列 | 图在左 x ≈ −190…−250;公式在右 x ≈ 170–200(行距 100),或在下方 y 170 / 225 / 280(行距 55) |

**避让。** 文字不能被线划掉、不能互挤:读数挪到切点下方,让收尾时 ξ 在切线上方;ξ 标签抬高一个字高,避开收尾的水平切线;标注摆进不被曲线横穿的空白区。检查**收尾那一帧**:扫动停下处、最后画出的线最容易压字。

**背景方格。** 分段用 `lightTheme`:40 单位的淡网格加过**世界原点**的十字轴。坐标系放在 `{ x: 0, y: -20 }` 这类位置(或范围不关于 0 对称)时,画面上会有两套十字:
要么像 [3.6](#36-标准节拍一个完整的内容段) 把对称的坐标系放在 `{ x: 0, y: 0 }`,要么用 `setTheme` 关掉(卡片、列表关不掉,全片要一致;现有影片都没关),见 [5.9](#59-预览跳转安全区竖屏重建背景网格与-settheme)。

**竖屏分支**(9:16 画幅,或手机竖屏全屏):

- `isNarrow(scene)`(视口宽 < 高)**只在搭建时求值一次**;横竖一翻转,播放器从 t = 0 重建当前段。
- **上下叠放**(图在上、公式在下 y ≈ 200)横竖都能看,**不需要分支**(导数长片大多如此)。
- **左右并排**(图在左、推导栏在右)**必须分支**:竖屏改成图在上、栏在下。`sideColumn` 已经替你分好(导数长片「自由落体」段):

  ```ts
  const { colX, colYs } = sideColumn(scene, 4); // 横竖屏的 colX / colYs 见上面的标准位置表
  const p = makePlot({ xRange: [0, 4], yRange: [0, 80], width: 420, height: 340, fn: (t) => 4.9 * t * t,
    at: isNarrow(scene) ? { x: 0, y: -170 } : { x: -150, y: 0 } });
  const f1 = tex('s(t) = 4.9t^2', 26, { x: colX, y: colYs[1] ?? 0 });
  ```

- 竖屏分支**只改位置和字号,时间线必须一模一样**:内容测试和配音工具只跑 1280×720 横屏,竖屏只能在浏览器切 9:16 + `?preview=` 逐段看。拓扑片竖屏把字号统一降 2(26 → 24、24 → 22)。

### 3.8 颜色

**缺省用单色墨线**(导数长片一种颜色都没设,拓扑片只用浅蓝填充 `#dbeafe` 表示「被关注的集合」),全靠主题:背景 `#f8f7f4`,描边与文字 `#1f2937`、线宽 3,字体 `Georgia, "Times New Roman", serif`。
区分主次靠**虚实线、出场顺序、淡入淡出**,不靠颜色:

- 虚线 `setStyle({ dash: [6, 5] })`:辅助线 / 参考线(Δ 辅助线、精确切线、弦、邻域圈);`[4, 3]`:度量线、误差线、垂足线;`[5, 4]`:半径。
- `Dot` 半径 7 是标准点(`tangentProbe` 也是 7),6 次要点,8 最终点 / 最优点。读数用 `Label` + `toFixed(2)`,宽度不抖。

**要用颜色时**用这套语义配色(取自配音演示和演示场景),**整部片子同一个意思始终同一个颜色**:

| 值 | 语义 |
| --- | --- |
| 蓝 `#2563eb`,线宽 4 | 主函数曲线 |
| 粉 `#db2777`,线宽 3 | 割线 / 运动中的对象 / 被追踪的点 |
| 绿 `#16a34a`,线宽 3 | 切线、极限、答案 |
| 橙 `#ea580c` / 紫 `#7c3aed` | Δy / Δx |
| 青 `#0891b2` / 灰 `#6b7280` | 第六色备用 / 旁注、次要文字 |
| 浅灰虚线 `#9ca3af`,`dash: [6, 6]` | 轨迹 / 路径提示 |
| `rgba(37,99,235,0.15)`、`rgba(22,163,74,0.15)`、`rgba(234,88,12,0.3)`、`#dbeafe` | 面 / 区域填充:和描边同色,低透明度 |

- 一段里除墨色最多 **4 种**颜色(配音演示「切线的斜率」段:蓝曲线、绿切线、橙 Δy、紫 Δx)。
- **公式里的项和图上的线同色、同时出现**:`\textcolor{#ea580c}{\Delta y}`,或 `\class{dy}{\Delta y}` 配 `Indicate(formula, { part: 'dy' })`([3.9](#39-指给观众看))。
- 公式上色用 `textColor`(`setStyle({ textColor: '#2563eb' })`)或 `ColorTo`,不是 `stroke` / `fill`;TeX 里用 `\textcolor{#2563eb}{x}`,不支持 `\textcolor[HTML]{2563EB}{x}`。
- 颜色只写 hex 或 `rgba()`:颜色名(`'red'`)和 `hsl()` 在 node(内容测试)里解析不出来,`ColorTo` 没法插值。
- 橙 `#ea580c` 是 `Indicate` / `Circumscribe` / `Flash` 在浅色背景上的缺省强调色:要强调的对象别用橙色,非用不可就给强调动画传 `color`。

### 3.9 指给观众看

字幕说到哪,画面就指到哪:

| 要做的事 | 工具 | runTime(秒) |
| --- | --- | --- |
| 一闪而过:「看这里」(放大 1.2 倍并染强调色,再复原) | `new Indicate(m)` | 0.8–1.0 |
| 圈出一个结果 / 公式的一项 | `new Circumscribe(m, { shape: 'circle', buff: 12 })` | 1.0 |
| 点出图上的一个点(`at` 是对象本地坐标) | `new Flash(p.axes, { at: p.axes.toLocal(2, 4) })` | 1.0 |
| 「注意,这里有问题」(误区片) | `new Wiggle(m)` | 2.0(缺省) |
| 从此以后它就是焦点(**持久**换色) | `new ColorTo(m, '#16a34a', { runTime: 0.9 })` | 0.9 |
| 标出一段长度 / 一组项 | `Brace.for(target, 'down', { label: '\\Delta x' })`,先 `unrevealed` 再 `Create`;target 自己要设 `fontSize`(`tex()` 建的就是) | 0.8–1.0 |
| 持久框住公式的一部分 | TeX 里写 `\boxed{…}`(没有 SurroundingRectangle,自己建框见 [6.11](#611-manim-名字对照)) | 随公式入场 |
| 公式的一项 ↔ 图上的一条线 | `\class{dy}{…}` + `Create(dyLine)` 同播 `Indicate(formula, { part: 'dy' })`,见下 | 0.8 |
| 标点、标名 / 指向 / 编号角标 | `Dot(7)` + `tex('P', 24, …)` `FadeIn` / `Arrow` + `Create` / `Annotation` + `FadeIn`(不能 `Create`) | 1.0 / 0.8 / 1.0 |

选项与缺省值见 [7.7](#77-强调indicatecircumscribeflashwiggle)。

```ts
// 配音演示「切线的斜率」段:公式分项和图上的线同时亮
const formula = tex('k = \\frac{\\class{dy}{\\Delta y}}{\\class{dx}{\\Delta x}}', 30, { x: 250, y: -40 });
await env.play(new Create(dyLine, { runTime: 0.8 }), new Indicate(formula, { part: 'dy', runTime: 0.8 }));
await env.play(new Create(dxLine, { runTime: 0.8 }), new Circumscribe(formula, { part: 'dx', runTime: 1 }));
```

- 强调动画只在渲染时生效(不改对象、播完复原),能和移动中的对象同播、叠播。
- **一次只强调一个东西**,在提到它的那条字幕开始 ±0.3 秒内播(配音段用 `env.untilMark` 踩到词上);同一秒内不超过 3 次(防闪烁,框架不拦)。
- `part` 只对 `Tex` 有效,名字写错会报错。一闪而过用 `Indicate`,要一直记住用 `ColorTo`。

### 3.10 数学准确与措辞

字幕和画面上的每一句话都要站得住。现有源码注释里改过的例子:

| 不准确的说法 | 改成 | 理由 |
| --- | --- | --- |
| 「让 h 缩到 0」 | 「让区间长度 h **趋于** 0,取极限」 | h = 0 时比值没有意义 |
| 「读数为 0 的地方是极值点」 | 「读数**经过 0 并变号**的地方,是极值点」 | x³ 在原点读数也是 0,却不是极值 |
| 「五次项,完全重合」 | 「五次项,中间一大段**几乎**重合」 | 五次泰勒多项式在 ±π 处还差约 0.52 |
| 「凸」「凹」直接用 | 先说「左边 ∩ 形,f″ 小于 0」,再说「由凸变凹」 | 教材叫法相反,先用形状和符号把定义钉在画面上(这里 ∩ 是凸) |

**画面也要和字幕一致:**

- **扫动停在结论说的值上**:字幕「经过最低点时切线放平,导数等于 0」而画面停在 x = 3.5(k = 1.40)就正好相反,要回扫到 0;最优化段扫完回到最优解 A = 25 再下结论,别停在 A = 9.0 的细长条上。
- **缓动和字幕一致**:说「匀速」就用 `linear`([3.5](#35-动画节奏表))。
- **字幕说的视觉信息画面上要真有**:罗尔定理段把函数整体抬高一格,弦才不和 x 轴重合,「端点一样高」才看得出来。
- **符号方向**:世界坐标 y 向下,自己用三角函数算几何要反号(否则切线走向反号);用 `p.W(x, y)` 或 `axes.toLocal(x, y)` 换算就不用操心。
- **轴名**:`makePlot` 的轴永远标 x、y;要标 t、s,自己 `new Axes(xRange, yRange, w, h, { x: 't', y: 's' })`。

**写法上的保证:**

- 画面上的每个数都从同一个函数算(`f(a)`、`fp(a).toFixed(2)`),不手抄;核算写成注释放在旁边,如「f(x) = 0.15x² 在 x = 1.5 处:割线斜率 = 0.45 + 0.15h」。
- 定理条件不能丢,字幕放不下就放进画面公式:`f\in C[a,b],\ f \text{ 在 } (a,b) \text{ 内可导},\ f(a)=f(b) \Rightarrow \exists\,\xi\in(a,b),\ f'(\xi)=0`(太长就拆成条件、结论两个 `tex`)。导数长片罗尔定理段只写了 `f(a) = f(b) \Rightarrow …`、字幕也没提连续可导,是反例。
- TeX 写错不报错:MathJax 画成红字,内容测试抓不到,只能逐段预览看。

### 3.11 上线前检查清单

**稿**

- [ ] 每段一件事(一条 ≤ 20 字的字幕说得完,内容段 9–25 秒),字幕走完叙事弧:提问 → 指认 → 过程 → 结论(→ 下一问)
- [ ] 每句话数学上站得住,有歧义的术语先在画面上定义([3.10](#310-数学准确与措辞));章名不带「第 N 章」,分段名是有意义的短名

**时间**

- [ ] 每个 `directedSegment` 都有时长账注释且等于 duration;`listSegment` 的 duration = n × (1 + gap) + holdSeconds
- [ ] 段首 0.6 秒内没有关键镜头;段尾停 3–6 秒收尾、不 `FadeOut`;结论后停 ≥ 1.5 秒,公式换形前停 1–3.5 秒,思考题停约 7 秒
- [ ] 全片动画时间约占一半;没有连续三段都是扫动

**字幕**

- [ ] 首条 0.2 秒起;间隙 0.2–0.5 秒;每条 ≤ 20 字、单行;≤ 4.5 字/秒;`[start, end)` 不重叠;末条不晚于段尾;结论字幕出现时画面已停在它说的状态

**画面**

- [ ] 每段 `?preview=<段起点 + 0.1>` 只看到该出现的东西(`Create` 的对象没被 `hide`;`Write` 前没藏,或紧挨着恢复了 opacity);`?preview=<段终点 − 0.5>` 就是末条结论字幕说的样子
- [ ] 所有对象都进了 `stage`(运镜段除外),会动、会变大的按最大包络取景;收尾帧文字不被线划掉、不互相挤,公式没有红字
- [ ] 颜色:缺省墨色;用了颜色的同义同色、每段 ≤ 4 种,要强调的对象不是橙色
- [ ] 9:16 竖屏逐段看过;左右并排的段有 `isNarrow` 分支,两支时间线一致

**代码与命令**

- [ ] 只用 `env.play` / `env.wait`(`scene.play` / `scene.wait` 在段被释放后立刻返回,脚本会空跑到底,见 [5.2](#52-directedsegment-与-segmentenv));`scene.playFit` 之后紧跟 `env.checkpoint()`
- [ ] 对象都在 `direct`(或 `entries` 工厂)里新建,不放模块作用域;不用 `setTimeout` / `Date.now` / `Math.random`(预览、跳转、导出都从 t = 0 重放脚本)
- [ ] 影片加进 `src/film/content.test.ts`(不加就不审,见 [2.3](#23-接进页面和工具)、[5.7](#57-注册新片));`node scripts/test.mjs content`(查什么见 [5.8](#58-内容测试查什么))和 `npm run check`(类型 + lint + 全部测试)全过
- [ ] `npm run dev` 打开 `/?scene=<片>`,带字幕完整看一遍;再导出一段看看成片

## 4. 片子模板

4.2–4.12 是 11 个能直接改的片子模板,4.13 是镜头套路速查。每个模板都是完整、能跑、时长账与字幕都核过的文件,已按 [§3](#3-好片子的手艺) 做好节奏、版面与先藏后揭。4.2–4.7 的示例只留两个关键内容段,其余段怎么加写在各节「换题材」里。

### 4.1 怎么用模板

**选模板、原样试跑**:按「观众看完要记住什么」选;把折叠块里的代码存成表中的文件,按 [2.3](#23-接进页面和工具) 登记四处(`?scene=` 键、voiceId、catalog 键都用表中的键,标题随意),`npm run dev` 后打开 `/?scene=<键>`。

| 节 | 观众要记住的 | 文件(`src/film/`) | 键 | 整部片子 |
| --- | --- | --- | --- | --- |
| [4.2](#42-一分钟概念短片) | 一个画面(圆面积为何是 πr²) | `tplConcept.ts` | `tplconcept` | `tplConceptFilm` |
| [4.3](#43-几何证明片) | 一条逻辑链(内角和) | `tplProof.ts` | `tplproof` | `tplProofFilm` |
| [4.4](#44-公式推导片) | 一串式子怎么变过来 | `tplDerive.ts` | `tplderive` | `tplDeriveFilm` |
| [4.5](#45-函数图像探索片) | 一个参数管什么(y = ax²) | `tplExplore.ts` | `tplexplore` | `tplExploreFilm` |
| [4.6](#46-极限与逼近片) | 一个量逼近到哪里 | `tplLimit.ts` | `tpllimit` | `tplLimitFilm` |
| [4.7](#47-对比与误区片) | 一个「不要这样做」 | `tplCompare.ts` | `tplcompare` | `tplCompareFilm` |
| [4.8](#48-习题讲解片) | 一道题的解法 | `tplQuiz.ts` | `tplquiz` | `tplQuizFilm` |
| [4.9](#49-三分钟章节短片) | 一个主题的三四个要点 | `tplChapters.ts` | `tplchapters` | `tplChaptersFilm` |
| [4.10](#410-十分钟完整一集) | 一整集(一章教材) | `tplEpisode.ts` | `tplepisode` | `tplEpisodeFilm` |
| [4.11](#411-配音驱动短片) | 已有配音、按台词踩点 | `tplVoice.ts` | `tplvoice` | `tplVoiceFilm` |
| [4.12](#412-3d-直观片) | 立体的东西 | `tpl3d.ts` | `tpl3d` | `tpl3dFilm` |
| [4.13](#413-镜头套路速查) | 只想拍某一个镜头 | `tplShots.ts` | `tplshots` | `tplShotsFilm` |

例外:4.10 import 4.8 的 `quizSegment`,两个文件都要放;4.11 的 ③ 是单独的测试文件。

**改成自己的片子**:复制成 `src/film/<片名>.ts` → 数组改名 `<片名>Film`,分段名(`directedSegment` 第一个参数、`cardSegment` / `listSegment` 的 `name`)改成你的(进度条提示、报错、缺省配音 id 都用它)→ 登记,删掉试跑时的 `tpl…` 行 → `node scripts/test.mjs content` → `npm run check` → `/?scene=<键>&preview=<秒>` 逐段看关键帧,16:9、9:16 各看一遍。`preview` 秒数 = 前面各段 `duration` 之和 + 段内秒数。

**改时长与字幕**(账怎么算见 [3.2](#32-时间),字幕规则见 [3.3](#33-字幕)):改一个数改三处——`runTime` / `env.wait`、时长账注释、`duration`;字幕是相对段首的固定秒数,不跟动画走,时间线一变要把每条 `start` 对回它解说的动画 ±0.3 秒。最安全的是只改收尾停留(3–6 秒)。

**反复出现的做法**:

- **统一机位**:几个内容段共用一个 `frame()`(不进场景的 `Rectangle`)作 `stage` 的第 4 个参数 `fitExtra`,切段时位置、字号不跳。框要包住各段所有对象**最大时**的包络;拿不准就把 `frame().setStyle({ stroke: '#dc2626', dash: [6, 5] })` 放进第 2 个参数,用 `&preview=` 看红框。
- **接续末帧**:下一段开场复现上一段结尾的对象,**不藏**,段首停 0.6–1 秒。
- 会变长、会动的对象按最大的样子放进 `fitExtra`;读数用 `label()` + `toFixed(n)`;扫动后回到字幕要说的值再下结论([3.5](#35-动画节奏表)、[3.7](#37-版面))。
- **配色**(面与块;和 [3.8](#38-颜色) 的曲线配色二选一):蓝 `#2563eb` 主对象、绿 `#16a34a` 结论与正确、粉 `#db2777` 强调的差异、紫 `#7c3aed` 次要的块、灰 `#9ca3af` 对照、红 `#dc2626` 错误;橙 `#ea580c` 只做临时高亮。
- **竖屏**(分支规则见 [3.7](#37-版面)):左右并排一律分支成上下叠放(4.7),时间线不动。最宽的一行总占满宽度,加大它的字号没用,要让它变窄(长公式 `aligned` 折行,4.6)。

### 4.2 一分钟概念短片

一个概念、一个核心画面。示例《圆的面积》:扇形交错排成一排,越切越细越像长 πr、宽 r 的长方形。适合面积公式的直观、「切开 → 重排 → 取极限」;不适合多步证明(4.3)、多步计算(4.4)、立体(4.12)。

**时长** 50–65 秒,内容段 ≤ 3 个、每段 12–17 秒;示例 40.6 秒(含片头卡 5、片尾卡 4,下同)。

| 段 | 用到 | 秒 | 画面 → 字幕要点 |
| --- | --- | --- | --- |
| 切开重排 | `directedSegment` | 15.2 | 16 块扇形分两批入列,描出轮廓 → 一句一个动作 |
| 越切越细 | `directedSegment` | 16.4 | 换成 48 块,括号量出 πr 与 r,公式 → 结论 |

| t(切开重排) | 画面 | 字幕 |
| --- | --- | --- |
| 0–3 | 停 0.8;扇形淡入 1.2,圆 `ColorTo` 退成灰轮廓;停 1 | 0.2–2.9 把圆切成 16 块扇形 |
| 3–6 | 上半圆 8 块 `MoveTo` + `RotateTo` 入列 2.5;停 0.5 | 3.2–5.8 上半圆的扇形排成一排 |
| 6–10 | 下半圆 8 块插进空隙 2.5;停 1.5 | 6.1–9.5 下半圆的扇形,交错插进空隙 |
| 10–15.2 | `Create` 虚线轮廓 1.2;收尾停 4 | 9.8–15.0 拼成了一个近似的平行四边形 |

<details>
<summary>完整代码:<code>src/film/tplConcept.ts</code>(40.6 秒,4 段)</summary>

```ts
// src/film/tplConcept.ts
import { Brace, Circle, Circumscribe, ColorTo, Create, FadeIn, FadeOut, MoveTo, Polygon, Rectangle, RotateTo, Sector } from '../engine';
import type { Point } from '../engine';
import type { Segment } from './film';
import { cardSegment, directedSegment } from './film';
import { fadeIns, hide, stage, tex, unrevealed } from './helpers';

const R = 90;
const CENTER: Point = { x: 0, y: -110 };
const ROW_Y = 60; // 重排后那一排的中线
const MUTED = '#9ca3af';
/** 两个内容段共用的取景框(不进场景):机位一致,切段不跳。 */
const frame = () => new Rectangle(460, 450).moveTo({ x: 0, y: 15 });

/** 切成 n 块后的一排:d 圆心角,w 尖端间距,h 排高,x0 让整排居中。 */
function rowGeometry(n: number) {
  const d = (2 * Math.PI) / n;
  const w = 2 * R * Math.sin(d / 2);
  return { d, half: n / 2, w, h: R * Math.cos(d / 2), x0: (-(n / 2 - 0.5) * w) / 2 };
}

interface Wedge { sector: Sector; top: boolean; rowAt: Point; rowTurn: number }

/** n 块扇形;rowAt / rowTurn 是排进一排后尖端的位置与转角。 */
function wedges(n: number): Wedge[] {
  const { d, half, w, h, x0 } = rowGeometry(n);
  const make = (start: number, top: boolean, rowAt: Point, rowTurn: number): Wedge => ({
    sector: new Sector(R, start, start + d)
      .setStyle({ fill: top ? 'rgba(37, 99, 235, 0.35)' : 'rgba(22, 163, 74, 0.35)', strokeWidth: n > 20 ? 0.8 : 1.5 })
      .moveTo(CENTER),
    top, rowAt, rowTurn,
  });
  // 画布 y 向下、角度顺时针:π..2π 是上半圆(尖端落在底边),0..π 是下半圆(尖端朝上,插进空隙)。
  return Array.from({ length: half }, (_, k) => [
    make(Math.PI + k * d, true, { x: x0 + (k + 0.5) * w, y: ROW_Y + h / 2 }, Math.PI / 2 - (k + 0.5) * d),
    make(Math.PI - (k + 1) * d, false, { x: x0 + k * w, y: ROW_Y - h / 2 }, (k + 0.5) * d - Math.PI / 2),
  ]).flat();
}

const moveIntoRow = (list: Wedge[], runTime: number) =>
  list.flatMap((p) => [new MoveTo(p.sector, p.rowAt, { runTime }), new RotateTo(p.sector, p.rowTurn, { runTime })]);

/** 直接摆到排好的位置(复现上一段末帧)。 */
function placeInRow(list: Wedge[]): Sector[] {
  for (const p of list) {
    p.sector.moveTo(p.rowAt);
    p.sector.rotation = p.rowTurn;
  }
  return list.map((p) => p.sector);
}

function rowOutline(n: number): Polygon {
  const { half, w, h, x0 } = rowGeometry(n);
  const [top, bottom] = [ROW_Y - h / 2, ROW_Y + h / 2];
  return new Polygon([
    { x: x0, y: top }, { x: x0 + half * w, y: top }, { x: x0 + (half - 0.5) * w, y: bottom }, { x: x0 - w / 2, y: bottom },
  ]).setStyle({ stroke: '#6b7280', strokeWidth: 2, dash: [6, 5] });
}

export const conceptIntro = cardSegment({
  name: '片头', title: '圆的面积', headingTex: 'S = \\pi r^2\\ ?', narration: '圆的面积,为什么是 πr²', holdSeconds: 4,
});

export const cutSegment = directedSegment(
  '切开重排',
  // 0.8 + 1.2 切开 + 1 + 2.5 上半圆入列 + 0.5 + 2.5 下半圆入列 + 1.5 + 1.2 描轮廓 + 4 停留 = 15.2。
  15.2,
  [
    { start: 0.2, end: 2.9, text: '把圆切成 16 块扇形' },
    { start: 3.2, end: 5.8, text: '上半圆的扇形排成一排' },
    { start: 6.1, end: 9.5, text: '下半圆的扇形,交错插进空隙' },
    { start: 9.8, end: 15, text: '拼成了一个近似的平行四边形' },
  ],
  async (env) => {
    const circle = new Circle(R).setStyle({ stroke: '#2563eb', fill: 'rgba(37, 99, 235, 0.12)' }).moveTo(CENTER);
    const pieces = wedges(16);
    const sectors = pieces.map((p) => p.sector);
    const outline = rowOutline(16);
    // 圆开场就在(随转场白场淡入);扇形与轮廓后出场,先藏。
    hide(...sectors);
    unrevealed(outline);
    stage(env.scene, [circle, ...sectors, outline], 24, [frame()]);
    await env.wait(0.8);
    await env.play(...fadeIns(sectors, 1.2), new ColorTo(circle, { stroke: MUTED, fill: null }, { runTime: 1.2 }));
    await env.wait(1);
    await env.play(...moveIntoRow(pieces.filter((p) => p.top), 2.5));
    await env.wait(0.5);
    await env.play(...moveIntoRow(pieces.filter((p) => !p.top), 2.5));
    await env.wait(1.5);
    await env.play(new Create(outline, { runTime: 1.2 }));
    await env.wait(4);
  },
);

export const finerSegment = directedSegment(
  '越切越细',
  // 1 + 1.5 换成 48 块 + 1.5 + 1.2 长 + 1.5 + 1.2 宽 + 1.5 + 1.5 公式 + 1 圈出 + 4.5 停留 = 16.4。
  16.4,
  [
    { start: 0.2, end: 3.8, text: '切得越细,就越接近长方形' },
    { start: 4.1, end: 6.6, text: '长是半个周长,πr' },
    { start: 6.9, end: 9.4, text: '宽是半径 r' },
    { start: 9.7, end: 15.7, text: '所以面积 S = πr × r = πr²' },
  ],
  async (env) => {
    const ghost = new Circle(R).setStyle({ stroke: MUTED }).moveTo(CENTER);
    const coarse = [...placeInRow(wedges(16)), rowOutline(16)];
    const fine = [...placeInRow(wedges(48)), rowOutline(48)];
    const { h, w, x0 } = rowGeometry(48);
    const [top, bottom, left] = [ROW_Y - h / 2, ROW_Y + h / 2, x0 - w / 2];
    // 括号量的是极限值:长 πr(半个周长),宽 r。
    const long = new Brace({ x: (-Math.PI * R) / 2, y: bottom + 10 }, { x: (Math.PI * R) / 2, y: bottom + 10 }, { label: '\\pi r' });
    const wide = new Brace({ x: left - 10, y: top }, { x: left - 10, y: bottom }, { label: 'r' });
    const formula = tex('S = \\pi r \\cdot r = \\pi r^2', 30, { x: 0, y: 215 });
    hide(...fine, formula);
    unrevealed(long, wide);
    stage(env.scene, [ghost, ...coarse, ...fine, long, wide, formula], 24, [frame()]);
    await env.wait(1);
    await env.play(...coarse.map((m) => new FadeOut(m, { runTime: 1.5 })), ...fadeIns(fine, 1.5));
    await env.wait(1.5);
    await env.play(new Create(long, { runTime: 1.2 }));
    await env.wait(1.5);
    await env.play(new Create(wide, { runTime: 1.2 }));
    await env.wait(1.5);
    await env.play(new FadeIn(formula, { runTime: 1.5 }));
    await env.play(new Circumscribe(formula, { runTime: 1 }));
    await env.wait(4.5);
  },
);

export const conceptOutro = cardSegment({
  name: '片尾', titleTex: 'S = \\pi r^2', heading: '感谢观看', narration: '感谢观看', holdSeconds: 3,
});

export const tplConceptFilm: Segment[] = [conceptIntro, cutSegment, finerSegment, conceptOutro];
```

</details>

**换题材**:别的切拼(三角形、梯形拼平行四边形)换掉 `wedges()`(每块给目标位置与转角)和 `rowOutline()`,重量 `frame()`,改块数、入列 `runTime`(8 块 2.5 秒)和字幕里的「16 块」。要交代已知(画圆、半径、周长 2πr)就在前面加一段约 12 秒。

**易错**:① 字幕比画面说得多——16 块只是「近似的平行四边形」;括号量的 πr 是上下各 24 段弧长之和。② 画布 y 向下、角度顺时针,上半圆是 π..2π;`RotateTo` 按绝对角度补间、不走最短路。

### 4.3 几何证明片

先观察、再证明:拖动图形让观众相信命题,再用辅助线搭出证明。示例《三角形内角和》。适合内角和、外角、圆周角、勾股(拼图);不适合纯代数证明(4.4)、长证明(拆章节,4.9)。

**时长** 50–90 秒;示例 54.8 秒。

| 段 | 用到 | 秒 | 画面 → 字幕要点 |
| --- | --- | --- | --- |
| 量一量 | `sweep` | 21.7 | 画三角形、标角、读数;拖动 C,和一直 180°;读数换成待证式子 → 观察 → 猜想 |
| 作平行线 | `Transform` | 24.1 | 过 C 作平行线,α、β 的替身搬到 C,半圆标平角,式子变绿、「证毕」→ 每步说依据 |

| t(作平行线) | 画面 | 字幕 |
| --- | --- | --- |
| 0–2.6 | 停 0.6;`Create` 平行线 DE 1.5;停 0.5 | 0.2–2.7 过 C 作 AB 的平行线 |
| 2.6–6.6 | 截线 AC 高亮 1.2;停 1;α 的替身 `Transform` 到 C 1.8 | 2.9–7.4 截线 AC:内错角相等,这个角等于 α |
| 6.6–10.7 | 停 1;AC 淡出、BC 画出 1;停 0.3;β 的替身 `Transform` 1.8 | 7.7–11.3 同理看截线 BC,这个角是 β |
| 10.7–16.9 | 停 1.5;虚线半圆 + 180° 1.5;停 1;三个角 `Indicate` 1;停 1.2 | 11.6–16.9 三个角拼成一个平角,等于 180° |
| 16.9–20.1 | 式子 `ColorTo` 绿 1.2、`Circumscribe` 1、「证毕」淡入 1 | 17.2–20.4 所以 α + β + γ = 180° |
| 20.1–24.1 | 收尾停 4 | 20.7–23.9 对任意三角形都成立 |

<details>
<summary>完整代码:<code>src/film/tplProof.ts</code>(54.8 秒,4 段)</summary>

```ts
// src/film/tplProof.ts
import { Angle, Arc, Circumscribe, ColorTo, Create, FadeIn, FadeOut, Indicate, Line, Polygon, Rectangle, Transform } from '../engine';
import type { Point } from '../engine';
import type { Segment } from './film';
import { cardSegment, directedSegment } from './film';
import { fadeIns, hide, label, stage, sweep, tex, unrevealed } from './helpers';

const A: Point = { x: -190, y: 110 };
const B: Point = { x: 190, y: 110 };
const C: Point = { x: -50, y: -110 };
const D: Point = { x: -270, y: -110 }; // 过 C 的平行线 DE
const E: Point = { x: 170, y: -110 };
const [ALPHA, BETA, GAMMA] = ['#2563eb', '#16a34a', '#db2777'] as const;
const CLAIM = '\\alpha + \\beta + \\gamma = 180^\\circ';
const CLAIM_AT: Point = { x: 0, y: 215 };
/** 两个内容段共用的取景框(不进场景)。 */
const frame = () => new Rectangle(540, 405).moveTo({ x: -40, y: 42 });
/** 带颜色的角:弧与字母同色。 */
const angleAt = (v: Point, a: Point, b: Point, name: string, color: string, radius: number) =>
  new Angle(v, a, b, { radius, label: name, fontSize: 24 }).setStyle({ stroke: color, textColor: color });

/** 三角形 ABC、三个内角、顶点名(每段各建一份:MObject 不能跨段共用)。 */
function figure() {
  const tri = new Polygon([A, B, C]);
  const alpha = angleAt(A, B, C, '\\alpha', ALPHA, 36);
  const beta = angleAt(B, C, A, '\\beta', BETA, 40);
  const gamma = angleAt(C, A, B, '\\gamma', GAMMA, 34);
  const cName = tex('C', 24, { x: C.x, y: C.y - 26 });
  const names = [tex('A', 24, { x: A.x - 20, y: A.y + 18 }), tex('B', 24, { x: B.x + 20, y: B.y + 18 }), cName];
  return { tri, alpha, beta, gamma, cName, names, parts: [tri, alpha, beta, gamma, ...names] };
}

export const proofIntro = cardSegment({
  name: '片头', title: '三角形内角和', headingTex: '\\alpha + \\beta + \\gamma = \\ ?', narration: '三角形三个内角加起来是多少', holdSeconds: 4,
});

export const measureSegment = directedSegment(
  '量一量',
  // 1.5 画三角形 + 0.5 + 1.2 标角 + 1 读数 + 1 + 4 拖 + 0.5 + 4 拖 + 0.5 + 2 回原位 + 1.5 猜想 + 4 停留 = 21.7。
  21.7,
  [
    { start: 0.2, end: 4.7, text: '画一个三角形,量出三个内角' },
    { start: 5.0, end: 9.5, text: '拖动顶点 C,每个角都在变' },
    { start: 9.8, end: 15.8, text: '三个角的和,却一直是 180°' },
    { start: 16.1, end: 21.5, text: '为什么总是 180°?来证明' },
  ],
  async (env) => {
    const fig = figure();
    const readout = label('', 24, { x: 0, y: 172 });
    const total = label('', 24, CLAIM_AT);
    const claim = tex(CLAIM, 30, CLAIM_AT);
    // 拖动顶点 C:图形与读数一起重算;逐帧变的读数用 Label,不用 Tex。
    const drawAt = (cx: number): void => {
      const c = { x: cx, y: C.y };
      fig.tri.setPoints([A, B, c]);
      fig.alpha.setPoints(A, B, c);
      fig.beta.setPoints(B, c, A);
      fig.gamma.setPoints(c, A, B);
      fig.cName.moveTo({ x: cx, y: C.y - 26 });
      const a = fig.alpha.degrees;
      const b = fig.beta.degrees;
      const g = fig.gamma.degrees;
      readout.text = `α = ${a.toFixed(1)}°   β = ${b.toFixed(1)}°   γ = ${g.toFixed(1)}°`;
      total.text = `α + β + γ = ${(a + b + g).toFixed(1)}°`;
    };
    drawAt(C.x);
    unrevealed(fig.tri, fig.alpha, fig.beta, fig.gamma);
    hide(...fig.names, readout, total, claim);
    stage(env.scene, [...fig.parts, readout, total, claim], 24, [frame()]);
    await env.play(new Create(fig.tri, { runTime: 1.5 }), ...fadeIns(fig.names, 1));
    await env.wait(0.5);
    await env.play(...[fig.alpha, fig.beta, fig.gamma].map((m) => new Create(m, { runTime: 1.2 })));
    await env.play(...fadeIns([readout, total], 1));
    await env.wait(1);
    await sweep(env, { from: C.x, to: 150, runTime: 4, draw: drawAt });
    await env.wait(0.5);
    await sweep(env, { from: 150, to: -170, runTime: 4, draw: drawAt });
    await env.wait(0.5);
    await sweep(env, { from: -170, to: C.x, runTime: 2, draw: drawAt });
    // 读数的和原地交叉淡化成要证明的式子。
    await env.play(new FadeOut(total, { runTime: 1.5 }), new FadeIn(claim, { runTime: 1.5 }));
    await env.wait(4);
  },
);

export const parallelSegment = directedSegment(
  '作平行线',
  // 0.6 + 1.5 平行线 + 0.5 + 1.2 截线 AC + 1 + 1.8 搬 α + 1 + 1 换截线 BC + 0.3 + 1.8 搬 β + 1.5
  // + 1.5 平角 + 1 + 1 闪一下 + 1.2 + 1.2 变绿 + 1 圈出 + 1 证毕 + 4 停留 = 24.1。
  24.1,
  [
    { start: 0.2, end: 2.7, text: '过 C 作 AB 的平行线' },
    { start: 2.9, end: 7.4, text: '截线 AC:内错角相等,这个角等于 α' },
    { start: 7.7, end: 11.3, text: '同理看截线 BC,这个角是 β' },
    { start: 11.6, end: 16.9, text: '三个角拼成一个平角,等于 180°' },
    { start: 17.2, end: 20.4, text: '所以 α + β + γ = 180°' },
    { start: 20.7, end: 23.9, text: '对任意三角形都成立' },
  ],
  async (env) => {
    const fig = figure();
    const claim = tex(CLAIM, 30, CLAIM_AT);
    const parallel = new Line(D, E);
    const cutAC = new Line(A, C).setStyle({ stroke: '#ea580c', strokeWidth: 5 });
    const cutBC = new Line(B, C).setStyle({ stroke: '#ea580c', strokeWidth: 5 });
    // 搬角:原位放一个一模一样的替身,Transform 把替身变到 C 点;原来的角留在原地。
    const alphaCopy = angleAt(A, B, C, '\\alpha', ALPHA, 36);
    const betaCopy = angleAt(B, C, A, '\\beta', BETA, 40);
    const alphaAtC = angleAt(C, D, A, '\\alpha', ALPHA, 34);
    const betaAtC = angleAt(C, E, B, '\\beta', BETA, 34);
    // 平角:以 C 为圆心的下半圆(画布角 0 → π 顺时针),半径 84 绕开三个字母。
    const half = new Arc(84, 0, Math.PI).setStyle({ stroke: '#6b7280', strokeWidth: 2, dash: [6, 5] }).moveTo(C);
    const degrees = tex('180^\\circ', 24, { x: C.x + 72, y: C.y - 28 });
    const done = label('证毕', 24, { x: CLAIM_AT.x + 190, y: CLAIM_AT.y });
    unrevealed(parallel, cutAC, cutBC, half);
    hide(alphaCopy, betaCopy, alphaAtC, betaAtC, degrees, done);
    stage(env.scene, [...fig.parts, claim, parallel, cutAC, cutBC, alphaCopy, betaCopy, alphaAtC, betaAtC, half, degrees, done], 24, [frame()]);
    await env.wait(0.6);
    await env.play(new Create(parallel, { runTime: 1.5 }));
    await env.wait(0.5);
    await env.play(new Create(cutAC, { runTime: 1.2 }));
    await env.wait(1);
    // 替身与原角重合,抬起不透明度时画面不变;Transform 的目标已藏好,结束时自动显示。
    alphaCopy.opacity = 1;
    await env.play(new Transform(alphaCopy, alphaAtC, { runTime: 1.8 }));
    await env.wait(1);
    await env.play(new FadeOut(cutAC, { runTime: 1 }), new Create(cutBC, { runTime: 1 }));
    await env.wait(0.3);
    betaCopy.opacity = 1;
    await env.play(new Transform(betaCopy, betaAtC, { runTime: 1.8 }), new FadeOut(cutBC, { runTime: 1 }));
    await env.wait(1.5);
    await env.play(new Create(half, { runTime: 1.5 }), new FadeIn(degrees, { runTime: 1 }));
    await env.wait(1);
    await env.play(...[alphaAtC, fig.gamma, betaAtC].map((m) => new Indicate(m, { runTime: 1 })));
    await env.wait(1.2);
    await env.play(new ColorTo(claim, '#16a34a', { runTime: 1.2 }));
    await env.play(new Circumscribe(claim, { runTime: 1 }));
    await env.play(new FadeIn(done, { runTime: 1 }));
    await env.wait(4);
  },
);

export const proofOutro = cardSegment({ name: '片尾', titleTex: CLAIM, heading: '感谢观看', narration: '感谢观看', holdSeconds: 3 });

export const tplProofFilm: Segment[] = [proofIntro, measureSegment, parallelSegment, proofOutro];
```

</details>

**换题材**:改 `A`–`E` 与 `figure()`(世界 y 向下);`drawAt` 重算所有依赖动点的对象,`sweep` 范围别让图形退化。搬量用替身 + `Transform`,「合起来是什么」用同时 `Indicate` + 结论 `ColorTo` 绿;同一个量全片同色。勾股定理用拼图:四个直角三角形两种摆法,`MoveTo` + `RotateTo`(同 4.2)。要回顾就在片尾前加一段 `listSegment`(三步,约 13 秒)。

**易错**:① `Transform(源, 目标)` 结束后源的不透明度为 0——原角要留在原地,就变一个先藏的替身(变之前 `opacity = 1`);目标也要先藏,结束时自动显示。② 每步的依据(「内错角相等」「平角 180°」)要进字幕,和高亮同时出现。③ 横向约 540 宽,竖屏 zoom 只有约 0.69:在 `isNarrow` 分支里缩短 DE、换窄的取景框。

### 4.4 公式推导片

一串代数变形:`TransformMatchingTex` 让相同的项平移、新项淡入,上方灰字写每步的理由。示例《配方法》:解 x² + 6x = 7。适合配方、恒等式、解方程;不适合以图形为主的证明(4.3)。

**时长** 40–100 秒,一段 2–3 步,超过 6 步就拆段;示例 39.7 秒。

| 段 | 用到 | 秒 | 画面 → 字幕要点 |
| --- | --- | --- | --- |
| 配方 | `TransformMatchingTex` | 13.7 | 两步:两边加 9 → `(x+3)² = 16` → 每步一句 |
| 开方求解 | 同上 | 17 | 三步,圈出答案 |

| t(开方求解) | 画面 | 字幕 |
| --- | --- | --- |
| 0–5.3 | 停 0.8(`(x+3)² = 16` 接续);→ `x + 3 = ±4` 1.5,理由淡入;停 3 | 0.2–4.9 开平方:x+3 等于正负 4 |
| 5.3–9.3 | → `x = −3 ± 4` 1.5,理由 `FadeTransform` 0.8;停 2.5 | 5.2–9.0 把 3 移到右边 |
| 9.3–13 | → `x₁ = 1, x₂ = −7` 1.5;停 1;`Circumscribe` 1.2 | 9.3–13.0 得到两个解:1 和 −7 |
| 13–17 | 收尾停 4 | 13.3–16.8 配方法:凑出完全平方,再开方 |

<details>
<summary>完整代码:<code>src/film/tplDerive.ts</code>(39.7 秒,4 段)</summary>

```ts
// src/film/tplDerive.ts
import { Circumscribe, FadeIn, FadeTransform, Rectangle, TransformMatchingTex } from '../engine';
import type { Segment } from './film';
import { cardSegment, directedSegment } from './film';
import { hide, label, stage, tex } from './helpers';

/** 两个推导段共用的取景框:公式在同一位置、同样大小,换段不跳。 */
const chainFrame = () => new Rectangle(460, 200).moveTo({ x: 0, y: -25 });
/** 推导链的一步:每步一个 Tex,叠在同一位置,由 TransformMatchingTex 接力。 */
const step = (source: string) => tex(source, 40, { x: 0, y: 0 });
/** 公式上方的灰色「理由」,每步用 FadeTransform 换词。 */
const reason = (text: string) => label(text, 22, { x: 0, y: -70 }).setStyle({ textColor: '#6b7280' });

export const deriveIntro = cardSegment({
  name: '片头', title: '配方法', headingTex: 'x^2 + 6x = 7', narration: '今天用配方法解一元二次方程', holdSeconds: 4,
});

export const completeSegment = directedSegment(
  '配方',
  // 1.2 + 2.5 + 1.5 加 9 + 3 + 1.5 写成平方 + 4 停留 = 13.7。
  13.7,
  [
    { start: 0.2, end: 3.4, text: '先看方程 x² + 6x = 7' },
    { start: 3.7, end: 8.0, text: '两边加上 6 的一半的平方,9' },
    { start: 8.3, end: 13.5, text: '左边就是 (x+3)²,右边是 16' },
  ],
  async (env) => {
    const s0 = step('x^2 + 6x = 7');
    const s1 = step('x^2 + 6x + 9 = 7 + 9');
    const s2 = step('(x+3)^2 = 16');
    const note = reason('原方程');
    hide(s0, s1, s2, note);
    stage(env.scene, [s0, s1, s2, note], 30, [chainFrame()]);
    await env.play(new FadeIn(s0, { runTime: 1.2 }), new FadeIn(note, { runTime: 1.2 }));
    await env.wait(2.5);
    // 相同的项平移过去,新来的 +9 淡入;理由同时换词。
    await env.play(new TransformMatchingTex(s0, s1, { runTime: 1.5 }), new FadeTransform(note, '两边同加 9', { runTime: 0.8 }));
    await env.wait(3);
    await env.play(new TransformMatchingTex(s1, s2, { runTime: 1.5 }), new FadeTransform(note, '左边写成完全平方', { runTime: 0.8 }));
    await env.wait(4);
  },
);

export const solveSegment = directedSegment(
  '开方求解',
  // 0.8 + 1.5 开方 + 3 + 1.5 移项 + 2.5 + 1.5 两个解 + 1 + 1.2 圈出 + 4 停留 = 17。
  17,
  [
    { start: 0.2, end: 4.9, text: '开平方:x+3 等于正负 4' },
    { start: 5.2, end: 9.0, text: '把 3 移到右边' },
    { start: 9.3, end: 13.0, text: '得到两个解:1 和 −7' },
    { start: 13.3, end: 16.8, text: '配方法:凑出完全平方,再开方' },
  ],
  async (env) => {
    const s2 = step('(x+3)^2 = 16');
    const s3 = step('x + 3 = \\pm 4');
    const s4 = step('x = -3 \\pm 4');
    const s5 = step('x_1 = 1,\\quad x_2 = -7');
    const note = reason('两边开平方');
    // s2 接续上一段的末帧,不藏;后面的步骤与理由先藏。
    hide(s3, s4, s5, note);
    stage(env.scene, [s2, s3, s4, s5, note], 30, [chainFrame()]);
    await env.wait(0.8);
    await env.play(new TransformMatchingTex(s2, s3, { runTime: 1.5 }), new FadeIn(note, { runTime: 1 }));
    await env.wait(3);
    await env.play(new TransformMatchingTex(s3, s4, { runTime: 1.5 }), new FadeTransform(note, '把 3 移到右边', { runTime: 0.8 }));
    await env.wait(2.5);
    await env.play(new TransformMatchingTex(s4, s5, { runTime: 1.5 }), new FadeTransform(note, '正负各取一次', { runTime: 0.8 }));
    await env.wait(1);
    await env.play(new Circumscribe(s5, { runTime: 1.2 }));
    await env.wait(4);
  },
);

export const deriveOutro = cardSegment({ name: '片尾', titleTex: '(x+3)^2 = 16', heading: '感谢观看', narration: '感谢观看', holdSeconds: 3 });

export const tplDeriveFilm: Segment[] = [deriveIntro, completeSegment, solveSegment, deriveOutro];
```

</details>

**换题材**:改 `step(…)` 的 TeX;想让整块对应(`x^2 + 6x + 9` → `(x+3)^2`)就两边都用 `\class{名字}{…}` 起同名。理由 8 字以内,换形前停 2.5–3.5 秒。拆开的几段共用 `chainFrame()`,后一段的第一步就是前一段的最后一步(不藏)。可加的段:图形直观(x² 正方形 + 两条 3x 长条 + 缺角 9,块的画法同 4.7 的 `tiles()`,挪块同 4.2)、验算(每个解一行「代入式 → `FadeTransform` 成算出的值 → ✓」)、方法小结(`listSegment`)。

**易错**:① 链上每一步都要一起 `stage`,后面的先 `hide`;漏了报「目标对象不在场景里」,没藏就从 t = 0 叠在一起。② 变形后显示的是目标,后面的 `Circumscribe`、下一步都对目标做。③ `FadeTransform` 成更长的式子时,把最长的样子放进 `fitExtra`。④ 开平方写 ±。

### 4.5 函数图像探索片

一个参数管什么:会动的曲线 + 不动的对照虚线 + 实时读数,每段扫一个方向、得一个结论。示例:扫 y = ax² 的 a。适合 y = a sin(bx + c)、y = kx + b、指数的底;不适合固定函数的性质(用 4.13 的切线探针)。

**时长** 50–90 秒;示例 54.8 秒。

| 段 | 用到 | 秒 | 画面 → 字幕要点 |
| --- | --- | --- | --- |
| 开口大小 | `plotIntro` + `sweep` | 24.3 | 对照虚线 y = x²;a 扫到 3、0.3、回到 1 → a 大则窄 |
| 同一点的高度与斜率 | `tangentProbe` + `sweep` | 21.5 | x = 1 处切点、切线、斜率;a 扫到 2、0.5、回到 1 → 高 a、斜率 2a |

| t(开口大小) | 画面 | 字幕 |
| --- | --- | --- |
| 0–4.5 | `plotIntro`(虚线与蓝曲线同描)3.5;读数 `a = 1.00` 淡入 1 | 0.2–4.6 先画 y = x²,也就是 a = 1 |
| 4.5–10 | 停 0.5;`sweep` a 1 → 3(4 秒);停 1 | 4.9–9.7 把 a 调大,抛物线越收越窄 |
| 10–16 | `sweep` 3 → 0.3(5 秒);停 1 | 10.0–15.5 把 a 调小,开口慢慢张开 |
| 16–18.8 | `sweep` 0.3 → 1(2 秒);停 0.8 | 15.8–18.5 回到 a = 1,和虚线重合 |
| 18.8–24.3 | 结论淡入 1.5;收尾停 4 | 18.8–24.1 a > 0 时,a 越大开口越窄 |

<details>
<summary>完整代码:<code>src/film/tplExplore.ts</code>(54.8 秒,4 段)</summary>

```ts
// src/film/tplExplore.ts
import { Create, FadeIn, Polygon } from '../engine';
import type { Point } from '../engine';
import type { Segment } from './film';
import { cardSegment, directedSegment } from './film';
import { fadeIns, hide, label, makePlot, plotIntro, stage, sweep, tangentProbe, tex, unrevealed } from './helpers';
import type { PlotEnv } from './helpers';

const X_MAX = 2.5;
const Y_MAX = 4;
const READOUT_AT: Point = { x: 0, y: -232 }; // 坐标框上方:a 的读数
const CONCLUSION_AT: Point = { x: 0, y: 205 }; // 坐标框下方:结论

/** y = ax² 截在坐标框里的点列(世界坐标);a = 0 时 xm 是 Infinity → X_MAX。 */
function parabola(p: PlotEnv, a: number): Point[] {
  const xm = Math.min(X_MAX, Math.sqrt(Y_MAX / Math.abs(a)));
  return Array.from({ length: 121 }, (_, i) => {
    const x = -xm + (2 * xm * i) / 120;
    return p.W(x, a * x * x);
  });
}

const aText = (a: number) => `a = ${a.toFixed(2)}`;

/**
 * 每段都要的:坐标系(y = x² 灰虚线作 a = 1 的对照;shown:开场就在,否则交给 plotIntro)、
 * 随 a 变的曲线(FunctionGraph 建好不能改,用不闭合的 Polygon 逐帧 setPoints)、a 的读数。
 */
function live(shown: boolean) {
  const p = makePlot({ xRange: [-X_MAX, X_MAX], yRange: [-Y_MAX, Y_MAX], width: 440, height: 360, fn: (x) => x * x, at: { x: 0, y: -20 } });
  p.curve.setStyle({ stroke: '#9ca3af', strokeWidth: 2, dash: [6, 6] });
  if (shown) {
    p.axes.opacity = 1;
    p.curve.setRevealFraction(null);
  }
  const curve = new Polygon(parabola(p, 1), { closed: false }).setStyle({ stroke: '#2563eb', strokeWidth: 4 });
  const readout = label(aText(1), 26, READOUT_AT);
  const draw = (a: number): void => {
    curve.setPoints(parabola(p, a));
    readout.text = aText(a);
  };
  return { p, curve, readout, draw };
}

export const exploreIntro = cardSegment({
  name: '片头', titleTex: 'y = ax^2', heading: '参数 a 在做什么', narration: '改一改 a,看抛物线怎么变', holdSeconds: 4,
});

export const widthSegment = directedSegment(
  '开口大小',
  // 3.5 开场 + 1 读数 + 0.5 + 4 扫到 3 + 1 + 5 扫到 0.3 + 1 + 2 回到 1 + 0.8 + 1.5 结论 + 4 停留 = 24.3。
  24.3,
  [
    { start: 0.2, end: 4.6, text: '先画 y = x²,也就是 a = 1' },
    { start: 4.9, end: 9.7, text: '把 a 调大,抛物线越收越窄' },
    { start: 10.0, end: 15.5, text: '把 a 调小,开口慢慢张开' },
    { start: 15.8, end: 18.5, text: '回到 a = 1,和虚线重合' },
    { start: 18.8, end: 24.1, text: 'a > 0 时,a 越大开口越窄' },
  ],
  async (env) => {
    const { p, curve, readout, draw } = live(false);
    const conclusion = label('a > 0 时,a 越大开口越窄', 26, CONCLUSION_AT);
    unrevealed(curve);
    hide(readout, conclusion);
    stage(env.scene, [p.plot, curve, readout, conclusion], 24);
    // 对照虚线与蓝色曲线一起描出(此时 a = 1,两条重合)。
    await plotIntro(env, p, { with: [new Create(curve, { runTime: 2.5 })] });
    await env.play(new FadeIn(readout, { runTime: 1 }));
    await env.wait(0.5);
    await sweep(env, { from: 1, to: 3, runTime: 4, draw });
    await env.wait(1);
    await sweep(env, { from: 3, to: 0.3, runTime: 5, draw });
    await env.wait(1);
    // 回到 a = 1 再下结论:画面停在哪个值,字幕就只能说哪个值。
    await sweep(env, { from: 0.3, to: 1, runTime: 2, draw });
    await env.wait(0.8);
    await env.play(new FadeIn(conclusion, { runTime: 1.5 }));
    await env.wait(4);
  },
);

export const slopeSegment = directedSegment(
  '同一点的高度与斜率',
  // 0.8 + 1.2 探针 + 1 + 4 扫到 2 + 1 + 4 扫到 0.5 + 1 + 1.5 回到 1 + 1.5 + 1.5 结论 + 4 停留 = 21.5。
  21.5,
  [
    { start: 0.2, end: 2.7, text: '盯住 x = 1 这一点' },
    { start: 3.0, end: 7.7, text: 'a 翻倍,高度和斜率都翻倍' },
    { start: 8.0, end: 12.7, text: 'a = 0.5:高度 0.5,斜率 1' },
    { start: 12.9, end: 15.7, text: '回到 a = 1:高度 1,斜率 2' },
    { start: 16.0, end: 21.3, text: '纵向缩放 a 倍:高度 a,斜率 2a' },
  ],
  async (env) => {
    const { p, curve, readout, draw } = live(true);
    let a = 1;
    // 探针的 f、fp 读当前的 a:改了 a 再 drawAt,切线与读数就跟上。
    const probe = tangentProbe({
      W: p.W, f: (x) => a * x * x, fp: (x) => 2 * a * x, clamp: [-X_MAX, X_MAX],
      halfSpan: 0.4, // a = 2 时斜率 4:半长 0.4 才不伸出坐标框
      readoutOffset: { x: 62, y: 18 },
    });
    probe.drawAt(1);
    const conclusion = tex('x = 1:\\ y = a,\\ k = 2a', 28, CONCLUSION_AT);
    const drawAll = (v: number): void => {
      a = v;
      draw(v);
      probe.drawAt(1);
    };
    // 坐标系、曲线、读数接续上一段,只藏探针和结论。
    hide(...probe.parts, conclusion);
    stage(env.scene, [p.plot, curve, readout, ...probe.parts, conclusion], 24);
    await env.wait(0.8);
    await env.play(...fadeIns(probe.parts, 1.2));
    await env.wait(1);
    await sweep(env, { from: 1, to: 2, runTime: 4, draw: drawAll });
    await env.wait(1);
    await sweep(env, { from: 2, to: 0.5, runTime: 4, draw: drawAll });
    await env.wait(1);
    await sweep(env, { from: 0.5, to: 1, runTime: 1.5, draw: drawAll });
    await env.wait(1.5);
    await env.play(new FadeIn(conclusion, { runTime: 1.5 }));
    await env.wait(4);
  },
);

export const exploreOutro = cardSegment({ name: '片尾', titleTex: 'y = ax^2', heading: '感谢观看', narration: '感谢观看', holdSeconds: 3 });

export const tplExploreFilm: Segment[] = [exploreIntro, widthSegment, slopeSegment, exploreOutro];
```

</details>

**换题材**:`makePlot` 把 `xRange × yRange` 画成 `width × height` 的框,框中心在 `at`;`p.W(x, y)` 换成世界坐标(本例 x 的 1 = 88、y 的 1 = 45)。`parabola()` 换成你的点列,点要截在 `yRange` 内(`Polygon` 不裁剪)。主扫 4–5 秒,回到关键值 1.5–2 秒;`sweep` 缺省 `smooth`,匀速传 `rateFunc: linear`。`tangentProbe` 的 `halfSpan` 按最陡斜率算。要讲正负,加一段:a 从 1 扫到 0(停 2.8 秒,压成 x 轴)、再到 −1。两个参数同时动见 [7.9](#79-valuetrackertweenvalue-与-updater)。

**易错**:① `FunctionGraph` 建好不能改,会变的曲线用不闭合的 `Polygon` 逐帧 `setPoints`。② 结论必须对着画面停住的值——最后一次 `sweep` 要回到它。③ 「a 越大越窄」只对 a > 0 成立,含负数要说 |a|;a = 0 已不是抛物线。

### 4.6 极限与逼近片

一个量「越来越接近」某个值:逐次加细 + 数值读数,再用夹逼或公式确认。示例《曲线下的面积》:左、右端点矩形夹住 y = x² 在 [0, 1] 下的面积 1/3。适合黎曼和、割线 → 切线、正多边形 → 圆、数列极限。

**时长** 50–90 秒;示例 51.8 秒。

| 段 | 用到 | 秒 | 画面 → 字幕要点 |
| --- | --- | --- | --- |
| 两边夹逼 | `plotIntro` + `RiemannTo` | 27 | 左、右端点矩形同时加细,读数 `左和 < S < 右和`;`R_n − L_n = 1/n → 0` → 夹住、差趋于 0 |
| 算出极限 | `isNarrow` | 15.8 | 右和化简 → 极限 1/3 → 定积分(竖屏折两行) |

| t(两边夹逼) | 画面 | 字幕 |
| --- | --- | --- |
| 0–3.5 | `plotIntro`,同播 `S = ?` 淡入 | 0.2–3.3 抛物线下,0 到 1 这块面积 S |
| 3.5–6.7 | 两组矩形 `Create` + 读数 `0.219 < S < 0.469` 1.2;停 2 | 3.6–7.0 左端点定高少算,右端点定高多算 |
| 6.7–18.5 | 两组同时 `RiemannTo` n = 8、16、32、64(各 1.2,读数同播),之后停 2、2、1.5、1.5 | 7.3–13.3 右和从上往下,左和从下往上;13.6–18.3 面积 S 始终被夹在中间 |
| 18.5–21.5 | 差式淡入 1.5;停 1.5 | 18.6–21.3 两者只差 1/n,趋于 0 |
| 21.5–27 | `Indicate` `S = ?` 1;收尾停 4.5 | 21.6–26.8 夹在中间的 S,就是共同的极限 |

<details>
<summary>完整代码:<code>src/film/tplLimit.ts</code>(51.8 秒,4 段)</summary>

```ts
// src/film/tplLimit.ts
import { Circumscribe, Create, FadeIn, FadeTransform, Indicate, RiemannRectangles, RiemannTo } from '../engine';
import type { Segment } from './film';
import { cardSegment, directedSegment } from './film';
import { hide, isNarrow, label, makePlot, plotIntro, stage, tex, unrevealed } from './helpers';

const f = (x: number) => x * x;
/** n 等分 [0, 1] 的左和、右和精确值:读数按公式算,不靠矩形累加。 */
const leftSum = (n: number) => ((n - 1) * (2 * n - 1)) / (6 * n * n);
const rightSum = (n: number) => ((n + 1) * (2 * n + 1)) / (6 * n * n);
const bounds = (n: number) => `n = ${n}:${leftSum(n).toFixed(3)} < S < ${rightSum(n).toFixed(3)}`;
/** 细分的节奏:[n, 之后停几秒]。越往后差别越小,停得越短。 */
const STEPS = [[8, 2], [16, 2], [32, 1.5], [64, 1.5]] as const;

/** 横屏写成一行 l = a = b;竖屏宽度不够,用 aligned 按等号折成两行。 */
const chain = (narrow: boolean, l: string, a: string, b: string) =>
  narrow ? `\\begin{aligned} ${l} &= ${a} \\\\ &= ${b} \\end{aligned}` : `${l} = ${a} = ${b}`;

export const limitIntro = cardSegment({
  name: '片头', title: '曲线下的面积', headingTex: '\\int_0^1 x^2\\,dx = \\ ?', narration: '弯弯的边,面积怎么算', holdSeconds: 4,
});

export const squeezeSegment = directedSegment(
  '两边夹逼',
  // 3.5 开场 + 1.2 两组矩形 + 2 + (1.2 + 2) × 2 + (1.2 + 1.5) × 2 + 1.5 差 + 1.5 + 1 点名 + 4.5 停留 = 27。
  27,
  [
    { start: 0.2, end: 3.3, text: '抛物线下,0 到 1 这块面积 S' },
    { start: 3.6, end: 7.0, text: '左端点定高少算,右端点定高多算' },
    { start: 7.3, end: 13.3, text: '右和从上往下,左和从下往上' },
    { start: 13.6, end: 18.3, text: '面积 S 始终被夹在中间' },
    { start: 18.6, end: 21.3, text: '两者只差 1/n,趋于 0' },
    { start: 21.6, end: 26.8, text: '夹在中间的 S,就是共同的极限' },
  ],
  async (env) => {
    const p = makePlot({ xRange: [0, 1.2], yRange: [0, 1.2], width: 400, height: 360, fn: f, at: { x: 0, y: -10 } });
    p.curve.setStyle({ stroke: '#2563eb', strokeWidth: 4 });
    const rects = (sample: 'left' | 'right', colors: string) => new RiemannRectangles(p.axes, f, [0, 1], { n: 4, sample, colors });
    const right = rects('right', 'rgba(124, 58, 237, 0.22)');
    const left = rects('left', 'rgba(37, 99, 235, 0.35)');
    // 矩形按坐标系的本地坐标取样:加进坐标系的组、垫在曲线下面;右和先加,高出的那一截露在蓝色矩形上方。
    p.plot.remove(p.curve);
    p.plot.add(right, left, p.curve);
    const ask = tex('S = \\ ?', 32, { x: -95, y: -60 });
    const readout = label(bounds(4), 24, { x: 0, y: -222 });
    const gap = tex('R_n - L_n = \\frac{1}{n} \\to 0', 28, { x: 0, y: 215 });
    unrevealed(right, left);
    hide(ask, readout, gap);
    stage(env.scene, [p.plot, ask, readout, gap], 24);
    await plotIntro(env, p, { with: [new FadeIn(ask, { runTime: 2.5 })] });
    await env.play(new Create(right, { runTime: 1.2 }), new Create(left, { runTime: 1.2 }), new FadeIn(readout, { runTime: 1.2 }));
    await env.wait(2);
    for (const [n, hold] of STEPS) {
      await env.play(
        new RiemannTo(right, { n }, { runTime: 1.2 }),
        new RiemannTo(left, { n }, { runTime: 1.2 }),
        new FadeTransform(readout, bounds(n), { runTime: 0.8 }),
      );
      await env.wait(hold);
    }
    await env.play(new FadeIn(gap, { runTime: 1.5 }));
    await env.wait(1.5);
    await env.play(new Indicate(ask, { runTime: 1 }));
    await env.wait(4.5);
  },
);

export const integralSegment = directedSegment(
  '算出极限',
  // 1.2 + 3.5 + 1.2 + 2.5 + 1.2 + 1 + 1.2 圈出 + 4 停留 = 15.8。
  15.8,
  [
    { start: 0.2, end: 4.6, text: '右和写成式子,用平方和公式化简' },
    { start: 4.9, end: 8.3, text: 'n 趋于无穷,极限是 1/3' },
    { start: 8.6, end: 12.8, text: '这个极限,就是定积分' },
    { start: 13.1, end: 15.6, text: '面积正好是 1/3' },
  ],
  async (env) => {
    // 竖屏分支:两行长式子按等号折成两行、三块重新排位;只改版面,时间线不变。
    const narrow = isNarrow(env.scene);
    const y = narrow ? { sum: -175, limit: 47, result: 222 } : { sum: -125, limit: 0, result: 125 };
    const big = (source: string, size: number, at: number) => tex(source, size, { x: 0, y: at }, { displayMode: true });
    // 1² + 2² + … + n² = n(n+1)(2n+1)/6,所以 R_n = (n+1)(2n+1)/(6n²) = (2n² + 3n + 1)/(6n²)。
    const sum = big(chain(narrow, 'R_n', '\\sum_{i=1}^{n} \\left(\\frac{i}{n}\\right)^2 \\cdot \\frac{1}{n}', '\\frac{(n+1)(2n+1)}{6n^2}'), 30, y.sum);
    const limit = big(chain(narrow, '\\lim_{n \\to \\infty} R_n', '\\lim_{n \\to \\infty} \\frac{2n^2 + 3n + 1}{6n^2}', '\\frac{1}{3}'), 30, y.limit);
    const result = big('S = \\int_0^1 x^2 \\, dx = \\frac{1}{3}', 34, y.result);
    hide(sum, limit, result);
    stage(env.scene, [sum, limit, result], 30);
    await env.play(new FadeIn(sum, { runTime: 1.2 }));
    await env.wait(3.5);
    await env.play(new FadeIn(limit, { runTime: 1.2 }));
    await env.wait(2.5);
    await env.play(new FadeIn(result, { runTime: 1.2 }));
    await env.wait(1);
    await env.play(new Circumscribe(result, { runTime: 1.2 }));
    await env.wait(4);
  },
);

export const limitOutro = cardSegment({
  name: '片尾', titleTex: '\\int_0^1 x^2\\,dx = \\frac{1}{3}', heading: '感谢观看', narration: '感谢观看', holdSeconds: 3,
});

export const tplLimitFilm: Segment[] = [limitIntro, squeezeSegment, integralSegment, limitOutro];
```

</details>

**换题材**:改 `f`、区间和 `leftSum` / `rightSum`(读数按精确公式算,`toFixed(3)`);`STEPS` 翻倍 4 次,前两次停 2 秒、后面 1.5 秒。割线 → 切线用 [4.13](#413-镜头套路速查) 的 `secantSegment`(h 扫到 0.03,不能到 0);左右割线夹住切线斜率**只对该点附近凸或凹的函数成立**。可在夹逼前加一段只画左端点矩形、猜「看起来是 1/3」;没有闭式就停在夹逼。

**易错**:① `RiemannRectangles`、`AreaUnderCurve` 用坐标系的本地坐标,要加进坐标系的组(曲线最后加),直接 `scene.add` 会错位。② 数值逼近只能说「看起来」,夹逼 + 差趋于 0 才说明极限存在,等于多少靠公式。③ 读数和 `RiemannTo` 同播,加细后至少停 1.5 秒。④ 左和第一条高 f(0) = 0,画面上看不见。

### 4.7 对比与误区片

一个常见的错:先用反例看到它错,再用图看到错在哪。示例《(a+b)² ≠ a² + b²》。适合 √(a+b) ≠ √a + √b、「独立 ≠ 互斥」;找不到反例或图形的区分用列表段加例子。

**时长** 40–80 秒;示例 42.7 秒。

| 段 | 用到 | 秒 | 画面 → 字幕要点 |
| --- | --- | --- | --- |
| 代个数试试 | `columnList` + `isNarrow` | 19.1 | 两栏代入 a = 1、b = 2;`9 ≠ 5`;等号改成 ≠ 并变红 → 反例推翻 |
| 画出来比 | `isNarrow` | 14.6 | 四块 vs 两块 + 两个虚线空位;两块 ab `ColorTo` 粉 → 多了 2ab |

| t(代个数试试) | 画面 | 字幕 |
| --- | --- | --- |
| 0–3.2 | 错误等式淡入 1.2;停 2 | 0.2–3.1 这个等式对吗 |
| 3.2–7.2 | 两栏第一行同时淡入 1;停 0.8;第二行 1;停 1.2 | 3.4–6.9 代入 a = 1,b = 2 试试 |
| 7.2–10.7 | 左 `= 9` 1;停 0.5;右 `= 5` 1;停 1 | 7.2–10.4 左边得 9,右边只有 5 |
| 10.7–15.1 | `9 ≠ 5` 1.2;停 1;`FadeTransform` 成 ≠ 1.2;`ColorTo` 红 1 | 10.7–14.3 9 不等于 5,等式不成立 |
| 15.1–19.1 | 收尾停 4 | 14.6–18.9 一个反例,就足以推翻它 |

<details>
<summary>完整代码:<code>src/film/tplCompare.ts</code>(42.7 秒,4 段)</summary>

```ts
// src/film/tplCompare.ts
import { ColorTo, Create, FadeIn, FadeTransform, Rectangle } from '../engine';
import type { MObject, Point, Tex } from '../engine';
import type { Segment } from './film';
import { cardSegment, directedSegment } from './film';
import { columnList, fadeIns, hide, isNarrow, stage, tex, unrevealed } from './helpers';

const SA = 90; // 图上 a 的长度
const SB = 60; // 和 a 明显不等,ab 才看得出是长方形
const HOT = '#db2777'; // 「多出来的 2ab」

/** 边长 a+b 的正方形切成 a²、ab、ab、b² 四块(中心在 c),块里写名字,边上标 a、b。 */
function tiles(c: Point) {
  const [x0, y0] = [c.x - (SA + SB) / 2, c.y - (SA + SB) / 2];
  const block = (w: number, h: number, left: number, top: number, stroke: string, fill: string) =>
    new Rectangle(w, h).setStyle({ stroke, fill }).moveTo({ x: left + w / 2, y: top + h / 2 });
  const aa = block(SA, SA, x0, y0, '#2563eb', 'rgba(37, 99, 235, 0.15)');
  const ab1 = block(SB, SA, x0 + SA, y0, '#7c3aed', 'rgba(124, 58, 237, 0.12)');
  const ab2 = block(SA, SB, x0, y0 + SA, '#7c3aed', 'rgba(124, 58, 237, 0.12)');
  const bb = block(SB, SB, x0 + SA, y0 + SA, '#16a34a', 'rgba(22, 163, 74, 0.15)');
  const names = [tex('a^2', 26, aa.position), tex('ab', 24, ab1.position), tex('ab', 24, ab2.position), tex('b^2', 24, bb.position)] as const;
  const edges = [
    tex('a', 22, { x: x0 + SA / 2, y: y0 - 16 }), tex('b', 22, { x: x0 + SA + SB / 2, y: y0 - 16 }),
    tex('a', 22, { x: x0 - 16, y: y0 + SA / 2 }), tex('b', 22, { x: x0 - 16, y: y0 + SA + SB / 2 }),
  ];
  return { aa, ab1, ab2, bb, names, edges, all: [aa, ab1, ab2, bb, ...names, ...edges] };
}

export const compareIntro = cardSegment({
  name: '片头', titleTex: '(a+b)^2 = a^2 + b^2\\ ?', titleSize: 44, heading: '一个常见的误区', narration: '这个等式,你写过吗', holdSeconds: 4,
});

export const numberSegment = directedSegment(
  '代个数试试',
  // 1.2 + 2 + 1 第一行 + 0.8 + 1 第二行 + 1.2 + 1 左 = 9 + 0.5 + 1 右 = 5 + 1 + 1.2 结论 + 1 + 1.2 改成 ≠ + 1 变红 + 4 停留 = 19.1。
  19.1,
  [
    { start: 0.2, end: 3.1, text: '这个等式对吗' },
    { start: 3.4, end: 6.9, text: '代入 a = 1,b = 2 试试' },
    { start: 7.2, end: 10.4, text: '左边得 9,右边只有 5' },
    { start: 10.7, end: 14.3, text: '9 不等于 5,等式不成立' },
    { start: 14.6, end: 18.9, text: '一个反例,就足以推翻它' },
  ],
  async (env) => {
    const { scene } = env;
    const narrow = isNarrow(scene);
    const claim = tex('(a+b)^2 = a^2 + b^2', 36, { x: 0, y: -170 });
    const [l1, l2, l3] = [tex('(a+b)^2', 30), tex('(1+2)^2', 30), tex('= 9', 30)];
    const [r1, r2, r3] = [tex('a^2 + b^2', 30), tex('1^2 + 2^2', 30), tex('= 5', 30)];
    // 两栏:横屏左右并排,竖屏上下叠放。
    const column = (nodes: Tex[], at: Point) =>
      columnList(nodes.map((node) => ({ node, fontSize: 30 })), { gap: 22, context: scene.measureContext() }).moveTo(at);
    const leftCol = column([l1, l2, l3], narrow ? { x: 0, y: -10 } : { x: -170, y: 10 });
    const rightCol = column([r1, r2, r3], narrow ? { x: 0, y: 220 } : { x: 170, y: 10 });
    const verdict = tex('9 \\ne 5', 34, narrow ? { x: 0, y: 380 } : { x: 0, y: 190 });
    // 逐行淡入:藏的是行本身,不是整栏。
    hide(claim, l1, l2, l3, r1, r2, r3, verdict);
    stage(scene, [claim, leftCol, rightCol, verdict], 24);
    await env.play(new FadeIn(claim, { runTime: 1.2 }));
    await env.wait(2);
    await env.play(...fadeIns([l1, r1], 1));
    await env.wait(0.8);
    await env.play(...fadeIns([l2, r2], 1));
    await env.wait(1.2);
    await env.play(new FadeIn(l3, { runTime: 1 }));
    await env.wait(0.5);
    await env.play(new FadeIn(r3, { runTime: 1 }));
    await env.wait(1);
    await env.play(new FadeIn(verdict, { runTime: 1.2 }));
    await env.wait(1);
    await env.play(new FadeTransform(claim, '(a+b)^2 \\ne a^2 + b^2', { runTime: 1.2 }));
    await env.play(new ColorTo(claim, '#dc2626', { runTime: 1 }));
    await env.wait(4);
  },
);

export const pictureSegment = directedSegment(
  '画出来比',
  // 1.2 + 1 + 1 名字 + 1.5 + 1.2 右图 + 1.5 + 1.2 空位 + 1 + 1 高亮 + 4 停留 = 14.6。
  14.6,
  [
    { start: 0.2, end: 4.4, text: '边长 a+b 的正方形,分成四块' },
    { start: 4.7, end: 7.3, text: '而 a²+b² 只有两块' },
    { start: 7.6, end: 10.8, text: '空出来的两块,各是 ab' },
    { start: 11.1, end: 14.4, text: '(a+b)² 比它多了 2ab' },
  ],
  async (env) => {
    const narrow = isNarrow(env.scene);
    const full = tiles(narrow ? { x: 0, y: -190 } : { x: -170, y: -20 });
    const part = tiles(narrow ? { x: 0, y: 90 } : { x: 170, y: -20 });
    const fullCaption = tex('(a+b)^2', 28, narrow ? { x: 0, y: -80 } : { x: -170, y: 100 });
    const partCaption = tex('a^2 + b^2', 28, narrow ? { x: 0, y: 200 } : { x: 170, y: 100 });
    // 右图只要 a²、b² 两块;两块 ab 的位置画成虚线空框。
    const holes = [part.ab1, part.ab2];
    for (const h of holes) h.setStyle({ fill: null, stroke: '#9ca3af', dash: [6, 5] });
    const partShown: MObject[] = [part.aa, part.bb, part.names[0], part.names[3], ...part.edges];
    hide(...full.all, fullCaption, ...partShown, partCaption);
    unrevealed(...holes);
    stage(env.scene, [...full.all, fullCaption, ...partShown, ...holes, partCaption], 24);
    await env.play(...fadeIns([full.aa, full.ab1, full.ab2, full.bb, fullCaption], 1.2));
    await env.wait(1);
    await env.play(...fadeIns([...full.names, ...full.edges], 1));
    await env.wait(1.5);
    await env.play(...fadeIns([...partShown, partCaption], 1.2));
    await env.wait(1.5);
    await env.play(...holes.map((h) => new Create(h, { runTime: 1.2 })));
    await env.wait(1);
    // 持久高亮用 ColorTo(一闪而过才用 Indicate):左图两块 ab 与右图空框同时变色。
    await env.play(
      ...[full.ab1, full.ab2].map((m) => new ColorTo(m, { stroke: HOT, fill: 'rgba(219, 39, 119, 0.25)' }, { runTime: 1 })),
      ...holes.map((h) => new ColorTo(h, { stroke: HOT }, { runTime: 1 })),
    );
    await env.wait(4);
  },
);

export const compareOutro = cardSegment({
  name: '片尾', titleTex: '(a+b)^2 = a^2 + 2ab + b^2', titleSize: 44, heading: '感谢观看', narration: '感谢观看', holdSeconds: 3,
});

export const tplCompareFilm: Segment[] = [compareIntro, numberSegment, pictureSegment, compareOutro];
```

</details>

**换题材**:反例挑心算能验证、差别明显的数;最后一行左右错开 0.5 秒出。`SA`、`SB` 要明显不等。可加的段:正确展开(图 + `sideColumn(scene, 3)` 三行推导,横屏右栏、竖屏下栏,圈出 a² + 2ab + b²)、同类误区(`listSegment` 列 3 条,标题写「一般都不成立」)。

**易错**:① 只说错不说错在哪——反例之后要指出多出的 2ab。② 话别太绝对:ab = 0 时等式成立,写「一般不成立」。③ `columnList` 的栏里逐行淡入要藏每一行,藏整栏 `FadeIn(行)` 抬不起来。④ 字幕不写「右边那幅图」——竖屏会变成上下。

### 4.8 习题讲解片

**定位**:一道选择题讲透:题目 → 三个选项 → 7 秒思考 → 揭晓 → 解析。适合课后习题、考点辨析,也可插进长片([4.10](#410-十分钟完整一集) 每章末一道,复用 `quizSegment`);不适合没有选项的证明题(用 [4.3](#43-几何证明片))和推导很长的大题(拆成 [4.4](#44-公式推导片))。

**目标时长**:示例 4 段 Σ 42.3 秒。

| 段 | 模板函数 | 时长 | 画面 | 字幕要点 |
| --- | --- | --- | --- | --- |
| 片头 | `cardSegment` | 5 | 「习题讲解」+「链式法则 · 一道选择题」 | 练什么 |
| 题目 | `quizSegment` | 17.9 | 题干 → 选项 → 7 秒计时 → 揭晓 | 题目 / 先自己算 / 提示 / 答案 |
| 解析 | `directedSegment` | 14.4 | 四行推导逐行淡入,末行圈注 | 方法 → 关键一步 → 代入 → 结论 |
| 片尾 | `cardSegment` | 5 | (sin kx)′ = k cos kx | 推广到任意 k |

**关键段节拍:题目(17.9 秒)**

| t(秒) | 画面动作 | 字幕 |
| --- | --- | --- |
| 0–2.5 | 题干 FadeIn 1,停 1.5 读题 | 0.2–4.4「sin 2x 在 0 处的导数是几」 |
| 2.5–4.9 | 三个选项各 FadeIn 0.8 | |
| 4.9–11.9 | 计时条 FadeIn 0.5,再匀速缩短 6.5(`sweep` + `linear`) | 4.7–8.1「三个选项,先自己算一算」、8.4–11.7「提示:sin 里面是 2x」 |
| 11.9–13.4 | ✓、答案行 FadeIn,选项 `ColorTo` 绿 / 灰(都 1.5);计时条 FadeOut 0.5 | 12.0–17.6「答案是 B:f′(0) = 2」 |
| 13.4–17.9 | 停 4.5 | |

提示放在思考后半段,先给自己做的人留 3.5 秒;答案字幕(12.0)晚于揭晓(11.9),不先说后演。

<details>
<summary>完整代码:<code>src/film/tplQuiz.ts</code>(42.3 秒,4 段;还导出 <code>quizSegment</code> 与 <code>QuizSpec</code>)</summary>

```ts
// src/film/tplQuiz.ts
import { Circumscribe, ColorTo, FadeIn, FadeOut, Line, linear } from '../engine';
import type { MObject } from '../engine';
import type { Segment, Subtitle } from './film';
import { cardSegment, directedSegment } from './film';
import { hide, label, stage, sweep, tex } from './helpers';

const GREEN = '#16a34a';
const GRAY = '#9ca3af';
const BLUE = '#2563eb';
const PINK = '#db2777';

/** 一道三选一的题(都是 TeX,选项写成 'A:\\ 1');subtitles 4 条,窗口见 quizSegment。 */
export interface QuizSpec {
  name: string;
  stem: string;
  options: [string, string, string];
  correct: 0 | 1 | 2;
  answer: string;
  subtitles: Subtitle[];
}

/** 题目 → 选项 → 7 秒思考 → 揭晓。字幕窗口:0.2–4.4 题目 / 4.7–8.1 先自己算 / 8.4–11.7 提示 / 12.0–17.6 答案。 */
export const quizSegment = (spec: QuizSpec): Segment =>
  // 1 题干 + 1.5 + 3 × 0.8 选项 + 0.5 计时条 + 6.5 思考 + 1.5 揭晓 + 4.5 停留 = 17.9。
  directedSegment(spec.name, 17.9, spec.subtitles, async (env) => {
    const { scene } = env;
    const width = (m: MObject): number => m.getBox(scene.measureContext()).size.w;
    const optYs = [-45, 25, 95];
    const y = optYs[spec.correct] ?? 0;
    const stem = tex(spec.stem, 30, { x: 0, y: -130 });
    const opts = spec.options.map((s, i) => tex(s, 26, { x: 0, y: optYs[i] ?? 0 }));
    // 取景前按最宽的选项估 ✓ 的位置,揭晓前再按实测宽度贴好。
    const check = label('✓', 30, { x: -(Math.max(...opts.map(width)) / 2 + 28), y }).setStyle({ textColor: GREEN });
    const bar = new Line({ x: -120, y: 158 }, { x: 120, y: 158 }).setStyle({ stroke: GRAY, strokeWidth: 6 });
    const answer = tex(spec.answer, 26, { x: 0, y: 205 });
    const all: MObject[] = [stem, ...opts, check, bar, answer];
    hide(...all);
    stage(scene, all, 24);

    await env.play(new FadeIn(stem, { runTime: 1 }));
    await env.wait(1.5);
    for (const o of opts) {
      await env.play(new FadeIn(o, { runTime: 0.8 }));
    }
    await env.play(new FadeIn(bar, { runTime: 0.5 }));
    const shrink = (v: number): void => {
      bar.end = { x: -120 + 240 * v, y: 158 };
    };
    await sweep(env, { from: 1, to: 0, runTime: 6.5, rateFunc: linear, draw: shrink });
    const target = opts[spec.correct];
    if (target) {
      check.moveTo({ x: target.position.x - width(target) / 2 - 28, y });
    }
    await env.play(
      new FadeOut(bar, { runTime: 0.5 }),
      new FadeIn(check, { runTime: 1.5 }),
      new FadeIn(answer, { runTime: 1.5 }),
      ...opts.map((o, i) => new ColorTo(o, i === spec.correct ? GREEN : GRAY, { runTime: 1.5 })),
    );
    await env.wait(4.5);
  });

export const titleCard = cardSegment({ name: '片头', title: '习题讲解', heading: '链式法则 · 一道选择题', narration: '一道题,练熟链式法则', holdSeconds: 4 });

export const question = quizSegment({
  name: '题目',
  stem: "f(x) = \\sin 2x,\\quad f'(0) = \\,?",
  options: ['A:\\ 1', 'B:\\ 2', 'C:\\ 0'],
  correct: 1,
  answer: "\\text{答案:B}\\quad f'(0) = 2",
  subtitles: [
    { start: 0.2, end: 4.4, text: 'sin 2x 在 0 处的导数是几' },
    { start: 4.7, end: 8.1, text: '三个选项,先自己算一算' },
    { start: 8.4, end: 11.7, text: '提示:sin 里面是 2x' },
    { start: 12.0, end: 17.6, text: '答案是 B:f′(0) = 2' },
  ],
});

export const solution = directedSegment(
  '解析',
  // 1 + 0.8 + 1.2 + 2.5 + 1.2 + 1.5 + 1.2 + 1 圈注 + 4 停留 = 14.4。
  14.4,
  [
    { start: 0.2, end: 3.6, text: '链式法则:外层导数乘内层导数' },
    { start: 3.9, end: 6.4, text: '内层 2x 的导数是 2' },
    { start: 6.7, end: 9.9, text: '代入 x = 0,cos 0 等于 1' },
    { start: 10.2, end: 14.2, text: '所以 f′(0) = 2,选 B' },
  ],
  async (env) => {
    const r0 = tex('f(x) = \\sin 2x', 28, { x: 0, y: -105 });
    const r1 = tex(`f'(x) = \\textcolor{${BLUE}}{\\cos 2x} \\cdot \\textcolor{${PINK}}{(2x)'}`, 28, { x: 0, y: -35 });
    const r2 = tex("f'(x) = 2\\cos 2x", 28, { x: 0, y: 35 });
    const r3 = tex("f'(0) = 2\\cos 0 = 2", 28, { x: 0, y: 105 });
    hide(r0, r1, r2, r3);
    stage(env.scene, [r0, r1, r2, r3], 30);
    await env.play(new FadeIn(r0, { runTime: 1 }));
    await env.wait(0.8);
    await env.play(new FadeIn(r1, { runTime: 1.2 }));
    await env.wait(2.5); // 关键一步停得最久
    await env.play(new FadeIn(r2, { runTime: 1.2 }));
    await env.wait(1.5);
    await env.play(new FadeIn(r3, { runTime: 1.2 }));
    await env.play(new Circumscribe(r3, { runTime: 1 }));
    await env.wait(4);
  },
);

export const outroCard = cardSegment({
  name: '片尾',
  titleTex: "(\\sin kx)' = k\\cos kx",
  titleSize: 48,
  heading: '换成任何常数 k 都成立',
  narration: '推广:sin kx 的导数是 k cos kx',
  holdSeconds: 4,
});

/** 习题讲解片:4 段,42.3 秒。 */
export const tplQuizFilm: Segment[] = [titleCard, question, solution, outroCard];
```

</details>

键 `tplquiz`,整部片子 `tplQuizFilm`(登记见 [2.3](#23-接进页面和工具))。

**换题材怎么改**

1. **换题**:只改 `question` 的 `stem` / `options` / `correct` / `answer` / `subtitles`。窗口固定,四条字幕分别不超过 18 / 15 / 14 / 20 字;正确答案写在三处(`correct`、`answer`、第 4 条字幕)。
2. **解析**换 `r0`–`r3`,关键一步后停得最久。要讲易错点就另起一段接在后面,写法见 [4.7](#47-对比与误区片)。
3. **4 个选项**:`options` 改四元组、`correct` 加 `3`、`optYs` 改 `[-68, -8, 52, 112]`、`17.9` 改 `18.7`(时长账里 4 × 0.8),第 2–4 条窗口各后移 0.8。
4. **改思考时间或停留**:选项出齐 b = 2.5 + 0.8 × 选项数,揭晓 r = b + 思考(0.5 + `sweep` 的 `runTime`),`duration` = r + 1.5 + 停留;字幕窗口 0.2–4.4 / (b − 0.2)–(b + 3.2) / (b + 3.5)–(r − 0.2) / (r + 0.1)–(`duration` − 0.3)。提示窗口不足 2.5 秒就去掉提示,「先自己算」放到 r − 0.3。

**这个模板最容易犯的错**

- **选项、✓、计时条、答案行没先 `hide`**:t = 0 全露出来(见 [3.4](#34-先藏后揭))。
- **✓ 用很大的固定 x**:会把取景盒撑歪;按实测宽度 `getBox(scene.measureContext())` 放。
- **揭晓后要保持的颜色**用 `ColorTo`;`Indicate` 一闪就回去。
- **公式**:选项里的中文放进 `\text{}`;推导写全,`\cos 2x \cdot (2x)'` 不能省成 `\cos 2x \cdot 2x`。
- **提示泄底**:只指方向,不说答案;思考停顿里不放新画面。

### 4.9 三分钟章节短片

**定位**:一个主题分三章,每章一张章节卡加 1–4 段。示例《圆周率 π》:π 是什么 → 夹逼 π → 圆的面积,第三章直接拼进 4.2 的两段(拼法见 [4.10](#410-十分钟完整一集))。适合「是什么 → 怎么算 → 为什么」或三个并列的小主题;只讲一件事用 [4.2](#42-一分钟概念短片),五章以上用 4.10。

**目标时长**:2–3 分钟;示例 12 段 Σ 124.6 秒(加转场约 2 分 12 秒)。画面段之间夹列表段:讲一段、歇一段。

| 段 | 模板函数 | 时长 | 片内起点 | 画面 / 字幕要点 |
| --- | --- | --- | --- | --- |
| 片头 | `cardSegment` | 5 | 0 | 「π」+「周长、逼近与面积」 |
| 本片三章 | `listSegment` | 10.2 | 5 | 目录 4 行 |
| 章节 · π 是什么 | `chapterCard` | 7 | 15.2 | 章名 + 小字 |
| 与大小无关 | `listSegment` | 13 | 22.2 | d = 1、2、10 的周长 → C/d = π;相似 ⇒ 比值不变 |
| 章节 · 夹逼 π | `chapterCard` | 7 | 35.2 | |
| 边数加倍 | `directedSegment` | 15.5 | 42.2 | 内接 6 → 48 边形,内接 / 外切的上下界读数跟着换(竖屏分支) |
| 一般的 n | `listSegment` | 11 | 57.7 | n sin(π/n) < π < n tan(π/n) |
| 章节 · 圆的面积 | `chapterCard` | 7 | 68.7 | |
| 切开重排 · 越切越细 | 4.2 的两段 | 15.2 / 16.4 | 75.7 | 切块重排,S = πr² |
| 两个公式 | `listSegment` | 12.3 | 107.3 | C = 2πr、S = πr²、(πr²)′ = 2πr |
| 片尾 | `cardSegment` | 5 | 119.6 | π = 3.14159… |

**关键段节拍:边数加倍(15.5 秒)**

| t(秒) | 画面动作 | 字幕 |
| --- | --- | --- |
| 0–2.5 | 圆、正六边形、`n = 6`、上下界读数 FadeIn 1.2,停 1.3 | 0.2–2.3「边数不断加倍」 |
| 2.5–10.0 | 3 次(n = 12、24、48):旧多边形 FadeOut、新的 FadeIn 0.8,`n =` 与上下界 `FadeTransform` 1,停 1.5 | 2.6–7.3「多边形越来越贴近圆」、7.6–10.9「上下界把 π 越夹越紧」 |
| 10.0–15.5 | 「阿基米德:n = 96」与 223/71 < π < 22/7 FadeIn 1.5,停 4 | 11.2–15.3「阿基米德算到 96 边形」 |

<details>
<summary>完整代码:<code>src/film/tplChapters.ts</code>(124.6 秒,12 段;需要 4.2 的 <code>tplConcept.ts</code>)</summary>

```ts
// src/film/tplChapters.ts
import { Circle, FadeIn, FadeOut, FadeTransform, RegularPolygon } from '../engine';
import type { Segment } from './film';
import { cardSegment, directedSegment } from './film';
import { chapterCard, hide, isNarrow, labelLine, listSegment, stage, tex, texLine } from './helpers';
import { cutSegment, finerSegment } from './tplConcept';

const BLUE = '#2563eb';

export const titleCard = cardSegment({ name: '片头', title: 'π', titleSize: 72, heading: '周长、逼近与面积', narration: '今天,我们认识圆周率 π', holdSeconds: 4 });

export const outline = listSegment({
  name: '本片三章',
  // 4 条 × (1 + 0.8) + 3 = 10.2。
  duration: 10.2,
  subtitles: [
    { start: 0.2, end: 5.0, text: '三章:定义、逼近、面积' },
    { start: 5.3, end: 10.0, text: '从一个比值说起' },
  ],
  entries: () => [labelLine('本片三章', 30), labelLine('一 · π 是什么', 24), labelLine('二 · 夹逼 π', 24), labelLine('三 · 圆的面积', 24)],
  gap: 0.8,
  holdSeconds: 3,
});

export const ch1 = chapterCard({ name: '章节 · π 是什么', title: 'π 是什么', heading: '周长与直径之比', narration: '第一章,π 是什么' });

export const sizeFree = listSegment({
  name: '与大小无关',
  // 5 条 × (1 + 1) + 3 = 13。
  duration: 13,
  subtitles: [
    { start: 0.2, end: 4.5, text: '圆大一倍,周长也大一倍' },
    { start: 4.8, end: 8.8, text: '所有圆都相似,比值不变' },
    { start: 9.1, end: 12.8, text: '这个比值,就叫 π' },
  ],
  entries: () => [
    labelLine('任何圆都一样', 30),
    texLine('d = 1:\\quad C \\approx 3.14', 24),
    texLine('d = 2:\\quad C \\approx 6.28', 24),
    texLine('d = 10:\\quad C \\approx 31.4', 24),
    texLine('\\dfrac{C}{d} = \\pi = 3.14159\\ldots', 30),
  ],
  gap: 1,
  holdSeconds: 3,
});

export const ch2 = chapterCard({ name: '章节 · 夹逼 π', title: '夹逼 π', heading: '阿基米德的多边形', narration: '第二章,夹逼 π' });

/** 内接 / 外切正 n 边形给出的 π 的下界、上界,由代码算,不手抄。 */
const bounds = (n: number): string =>
  `${(n * Math.sin(Math.PI / n)).toFixed(4)} < \\pi < ${(n * Math.tan(Math.PI / n)).toFixed(4)}`;

export const doubling = directedSegment(
  '边数加倍',
  // 1.2 + 1.3 + 3 × (1 换形 + 1.5) + 1.5 + 4 停留 = 15.5。
  15.5,
  [
    { start: 0.2, end: 2.3, text: '边数不断加倍' },
    { start: 2.6, end: 7.3, text: '多边形越来越贴近圆' },
    { start: 7.6, end: 10.9, text: '上下界把 π 越夹越紧' },
    { start: 11.2, end: 15.3, text: '阿基米德算到 96 边形' },
  ],
  async (env) => {
    const R = 100;
    // 图左式右;竖屏图上式下(两个分支时间线完全一样)。
    const narrow = isNarrow(env.scene);
    const c = narrow ? { x: 0, y: -150 } : { x: -150, y: 0 };
    const colX = narrow ? 0 : 200;
    const rows = narrow ? [40, 105, 175, 235] : [-80, -10, 80, 140];
    const polygon = (n: number): RegularPolygon => new RegularPolygon(n, R).moveTo(c).setStyle({ stroke: BLUE, strokeWidth: 3 });
    const circle = new Circle(R).moveTo(c);
    let current = polygon(6);
    const nName = tex('n = 6', 30, { x: colX, y: rows[0] ?? 0 });
    const range = tex(bounds(6), 26, { x: colX, y: rows[1] ?? 0 });
    const who = tex('\\text{阿基米德:}\\ n = 96', 24, { x: colX, y: rows[2] ?? 0 });
    const his = tex('\\tfrac{223}{71} < \\pi < \\tfrac{22}{7}', 30, { x: colX, y: rows[3] ?? 0 });
    hide(circle, current, nName, range, who, his);
    stage(env.scene, [circle, current, nName, range, who, his], 24);

    await env.play(...[circle, current, nName, range].map((m) => new FadeIn(m, { runTime: 1.2 })));
    await env.wait(1.3);
    for (const n of [12, 24, 48]) {
      // 中途新加的多边形先藏好再 add;尺寸与旧的相同,不用重新取景。
      const next = polygon(n);
      hide(next);
      env.scene.add(next);
      await env.play(
        new FadeOut(current, { runTime: 0.8 }),
        new FadeIn(next, { runTime: 0.8 }),
        new FadeTransform(nName, `n = ${n}`, { runTime: 1 }),
        new FadeTransform(range, bounds(n), { runTime: 1 }),
      );
      current = next;
      await env.wait(1.5);
    }
    await env.play(new FadeIn(who, { runTime: 1.5 }), new FadeIn(his, { runTime: 1.5 }));
    await env.wait(4);
  },
);

export const general = listSegment({
  name: '一般的 n',
  // 4 条 × (1 + 1) + 3 = 11。
  duration: 11,
  subtitles: [
    { start: 0.2, end: 5.3, text: '一般地,正 n 边形给出一对界' },
    { start: 5.6, end: 10.8, text: 'n 越大,两个界越接近 π' },
  ],
  entries: () => [
    labelLine('正 n 边形给出的上下界', 28),
    texLine('\\text{内接:}\\ \\dfrac{\\text{周长}}{\\text{直径}} = n\\sin\\dfrac{\\pi}{n}', 24),
    texLine('\\text{外切:}\\ \\dfrac{\\text{周长}}{\\text{直径}} = n\\tan\\dfrac{\\pi}{n}', 24),
    texLine('n\\sin\\dfrac{\\pi}{n} < \\pi < n\\tan\\dfrac{\\pi}{n}', 28),
  ],
  gap: 1,
  holdSeconds: 3,
});

export const ch3 = chapterCard({ name: '章节 · 圆的面积', title: '圆的面积', heading: '切开,拼成长方形', narration: '第三章,圆的面积' });

export const formulas = listSegment({
  name: '两个公式',
  // 4 条 × (1 + 1.2) + 3.5 = 12.3。
  duration: 12.3,
  subtitles: [
    { start: 0.2, end: 5.5, text: '周长 2πr,面积 πr²' },
    { start: 5.8, end: 12.1, text: '面积对 r 求导,正好是周长' },
  ],
  entries: () => [labelLine('一个 π,两个公式', 30), texLine('C = 2\\pi r', 28), texLine('S = \\pi r^2', 28), texLine('\\dfrac{d}{dr}\\,\\pi r^2 = 2\\pi r', 26)],
  gap: 1.2,
  holdSeconds: 3.5,
});

export const outroCard = cardSegment({ name: '片尾', titleTex: '\\pi = 3.14159\\ldots', titleSize: 56, heading: '感谢观看', narration: '感谢观看,下次再见', holdSeconds: 4 });

/** 《圆周率 π》:12 段,124.6 秒;第三章的两段来自 4.2。 */
export const tplChaptersFilm: Segment[] = [
  titleCard, outline,
  ch1, sizeFree,
  ch2, doubling, general,
  ch3, cutSegment, finerSegment, formulas,
  outroCard,
];
```

</details>

键 `tplchapters`,整部片子 `tplChaptersFilm`(登记见 [2.3](#23-接进页面和工具))。`&preview=52.2` 停在 n = 48 的读数上(段内 10 秒)。

**换题材怎么改**

1. **目录、章节卡**改文字;目录条目数变了,`duration` = 条目数 × (1 + gap) + holdSeconds(表头那行也算一条)。`chapterCard` 的 `title` 就是进度条章名。
2. **每章的段**:画面段 15–21 秒、3–5 条字幕;列表段 11–13 秒、2–3 条。现成的段可以整章拼进来。
3. **左右并排的段要竖屏分支**(`narrow`),只改位置,不改时间线。
4. **读数用代码算**(`bounds(n)`):四位小数的四舍五入不破坏不等式(n = 96 时下界离 π 还有 0.0006);要更多位就下界向下取整、上界向上取整。

**这个模板最容易犯的错**

- **章名写成「第一章」**:播放器自动加编号,进度条显示「一 · 第一章」。
- **`listSegment` 的时长**不自动推导,最常漏算表头那一行。
- **中途新加的对象**(新多边形)先 `hide` 再 `scene.add`,且不能超出开头的取景。
- **数学措辞**:内接给下界、外切给上界;字幕说「越夹越紧」,不念读数。

### 4.10 十分钟完整一集

**定位**:长片是**拼**出来的。4.2–4.12 的模板把每一段单独 `export`,一集 = 片头 + 提要 + 5 ×(章节卡 + 现成的段 + 一道题)+ 小结 + 片尾,本文件只写卡片、提要、小结和题目。示例《平方》:完全平方 → 配方法 → 抛物线 → 抛物线下的面积 → 圆与球。适合一个大主题的完整一讲,或把几部短片合成一集;单一概念用 [4.2](#42-一分钟概念短片) / [4.9](#49-三分钟章节短片)。

**目标时长**:8–10 分钟。示例 26 段 Σ 388.7 秒 ≈ 6 分 29 秒(加转场约 6 分 44 秒);要到 10 分钟就每章再接两三段(4.4、4.7 的「换题材」列了可加的段),不拉长停顿。

| 部分 | 段(秒) | 从哪来 | 小计 | 片内起点 |
| --- | --- | --- | --- | --- |
| 开场 | 片头 5 · 本集五章 13.8 | 本文件 | 18.8 | 0:00 |
| 第一章 完全平方 | 章节卡 7 · 代个数试试 19.1 · 画出来比 14.6 · 习题一 17.9 | 4.7 `tplCompare` | 58.6 | 0:18.8 |
| 第二章 配方法 | 章节卡 7 · 配方 13.7 · 开方求解 17 · 习题二 17.9 | 4.4 `tplDerive` | 55.6 | 1:17.4 |
| 第三章 抛物线 | 章节卡 7 · 开口大小 24.3 · 同一点的高度与斜率 21.5 · 习题三 17.9 | 4.5 `tplExplore` | 70.7 | 2:13.0 |
| 第四章 抛物线下的面积 | 章节卡 7 · 两边夹逼 27 · 算出极限 15.8 · 习题四 17.9 | 4.6 `tplLimit` | 67.7 | 3:23.7 |
| 第五章 圆与球 | 章节卡 7 · 切开重排 15.2 · 越切越细 16.4 · 三个立体 15.4 · 截面相等 24.4 · 习题五 17.9 | 4.2 `tplConcept`、4.12 `tpl3d` | 96.3 | 4:31.4 |
| 收尾 | 本集小结 16 · 片尾 5 | 本文件 | 21 | 6:07.7 |

章节卡和习题(4.8 的 `quizSegment`)在本文件生成,其余各段的节拍见原模板。`&preview=` 按起点累加:第五章「截面相等」从 271.4 + 7 + 15.2 + 16.4 + 15.4 = 325.4 秒开始。

<details>
<summary>完整代码:<code>src/film/tplEpisode.ts</code>(388.7 秒,26 段;还导出每一章 <code>ch1</code>…<code>ch5</code>)</summary>

```ts
// src/film/tplEpisode.ts
import type { Segment } from './film';
import { cardSegment } from './film';
import { chapterCard, labelLine, listSegment, texLine } from './helpers';
import { slices, trio } from './tpl3d';
import { numberSegment, pictureSegment } from './tplCompare';
import { cutSegment, finerSegment } from './tplConcept';
import { completeSegment, solveSegment } from './tplDerive';
import { slopeSegment, widthSegment } from './tplExplore';
import { integralSegment, squeezeSegment } from './tplLimit';
import { quizSegment } from './tplQuiz';
import type { QuizSpec } from './tplQuiz';

/** 章节卡(7 秒):title 是进度条上的章名,播放器自动加「一 · 」。 */
const chapter = (n: string, title: string, heading: string): Segment =>
  chapterCard({ name: `章节 · ${title}`, title, heading, narration: `第${n}章,${title}` });

/** 章末一道题(17.9 秒):quizSegment 的字幕窗口是固定的,这里只填四句话。 */
const WINDOWS: Array<[number, number]> = [[0.2, 4.4], [4.7, 8.1], [8.4, 11.7], [12.0, 17.6]];
const quiz = (spec: Omit<QuizSpec, 'subtitles'>, say: string[]): Segment =>
  quizSegment({ ...spec, subtitles: WINDOWS.map(([start, end], i) => ({ start, end, text: say[i] ?? '' })) });

export const titleCard = cardSegment({ name: '片头', title: '平方', titleSize: 64, heading: '从 (a+b)² 到 ⁴⁄₃πr³', narration: '今天,把「平方」讲透', holdSeconds: 4 });

export const outline = listSegment({
  name: '本集五章',
  // 6 条 × (1 + 0.8) + 3 = 13.8。
  duration: 13.8,
  subtitles: [
    { start: 0.2, end: 5.5, text: '五章,都绕着一个平方' },
    { start: 5.8, end: 13.6, text: '从一个常见的错误说起' },
  ],
  entries: () => [
    labelLine('本集五章', 30),
    labelLine('一 · 完全平方', 24),
    labelLine('二 · 配方法', 24),
    labelLine('三 · 抛物线', 24),
    labelLine('四 · 抛物线下的面积', 24),
    labelLine('五 · 圆与球', 24),
  ],
  gap: 0.8,
  holdSeconds: 3,
});

export const ch1: Segment[] = [
  chapter('一', '完全平方', '(a+b)² 不是 a² + b²'),
  numberSegment,
  pictureSegment,
  quiz(
    { name: '习题一', stem: '(x+3)^2 = \\,?', options: ['A:\\ x^2 + 9', 'B:\\ x^2 + 6x + 9', 'C:\\ x^2 + 3x + 9'], correct: 1, answer: '\\text{答案:B}\\quad (x+3)^2 = x^2 + 6x + 9' },
    ['(x+3)² 展开等于什么', '三个选项,先自己想想', '提示:别漏了 2ab', '答案是 B:x² + 6x + 9'],
  ),
];

export const ch2: Segment[] = [
  chapter('二', '配方法', '补成一个完全平方'),
  completeSegment,
  solveSegment, // 开场接续「配方」的末式,两段必须连着放
  quiz(
    { name: '习题二', stem: 'x^2 + 4x + c = (x+2)^2,\\quad c = \\,?', options: ['A:\\ 2', 'B:\\ 4', 'C:\\ 16'], correct: 1, answer: '\\text{答案:B}\\quad c = (\\tfrac{4}{2})^2 = 4' },
    ['c 填几,左边才是完全平方', '三个选项,先自己算一算', '提示:一次项系数的一半', '答案是 B:(4/2)² = 4'],
  ),
];

export const ch3: Segment[] = [
  chapter('三', '抛物线', 'y = ax² 的参数 a'),
  widthSegment,
  slopeSegment, // 接续「开口大小」的坐标系和曲线
  quiz(
    { name: '习题三', stem: 'y = 3x^2 \\text{ 在 } x = 1 \\text{ 处的斜率}', options: ['A:\\ 3', 'B:\\ 6', 'C:\\ 9'], correct: 1, answer: '\\text{答案:B}\\quad k = 2a = 6' },
    ['y = 3x² 在 x = 1 处的斜率', '三个选项,先自己算一算', '提示:纵向拉伸 3 倍', '答案是 B:2 × 3 = 6'],
  ),
];

export const ch4: Segment[] = [
  chapter('四', '抛物线下的面积', '两边夹逼出 1/3'),
  squeezeSegment,
  integralSegment,
  quiz(
    { name: '习题四', stem: '\\int_0^1 2x^2\\,dx = \\,?', options: ['A:\\ \\tfrac{1}{3}', 'B:\\ \\tfrac{2}{3}', 'C:\\ 2'], correct: 1, answer: '\\text{答案:B}\\quad 2 \\times \\tfrac{1}{3} = \\tfrac{2}{3}' },
    ['y = 2x² 下,0 到 1 的面积', '三个选项,先自己算一算', '提示:每处高度都翻倍', '答案是 B:2 × 1/3 = 2/3'],
  ),
];

export const ch5: Segment[] = [
  chapter('五', '圆与球', '面积 πr²,体积 ⁴⁄₃πr³'),
  cutSegment,
  finerSegment,
  trio,
  slices,
  quiz(
    { name: '习题五', stem: 'V_{\\text{球}} = V_{\\text{圆柱}} - V_{\\text{双锥}} = \\,?', options: ['A:\\ \\tfrac{4}{3}\\pi r^3', 'B:\\ \\tfrac{2}{3}\\pi r^3', 'C:\\ \\tfrac{8}{3}\\pi r^3'], correct: 0, answer: '\\text{答案:A}\\quad 2\\pi r^3 - \\tfrac{2}{3}\\pi r^3 = \\tfrac{4}{3}\\pi r^3' },
    ['球的体积是多少', '三个选项,先自己算一算', '提示:双锥 = ⅔πr³', '答案是 A:4/3 πr³'],
  ),
];

export const summary = listSegment({
  name: '本集小结',
  // 6 条 × (1 + 1) + 4 = 16。
  duration: 16,
  subtitles: [
    { start: 0.2, end: 5.0, text: '五章讲的,都是平方' },
    { start: 5.3, end: 10.5, text: '展开、配方、图像、面积、体积' },
    { start: 10.8, end: 15.8, text: '拿不准时,画个图、代个数' },
  ],
  entries: () => [
    labelLine('本集小结', 30),
    texLine('(a+b)^2 = a^2 + 2ab + b^2', 26),
    texLine('x^2 + bx + (\\tfrac{b}{2})^2 = (x + \\tfrac{b}{2})^2', 24),
    labelLine('y = ax²:a 越大越窄,x = 1 处斜率 2a', 24),
    texLine('\\int_0^1 x^2\\,dx = \\tfrac{1}{3}', 26),
    texLine('S = \\pi r^2,\\quad V = \\tfrac{4}{3}\\pi r^3', 26),
  ],
  gap: 1,
  holdSeconds: 4,
});

export const outroCard = cardSegment({ name: '片尾', titleTex: 'x^2', heading: '感谢观看', narration: '感谢观看,下一集见', holdSeconds: 4 });

/** 《平方》:26 段,388.7 秒。 */
export const tplEpisodeFilm: Segment[] = [titleCard, outline, ...ch1, ...ch2, ...ch3, ...ch4, ...ch5, summary, outroCard];
```

</details>

键 `tplepisode`,整部片子 `tplEpisodeFilm`(登记见 [2.3](#23-接进页面和工具));被 import 的七个文件放进 `src/film/` 即可,不必登记,少一个类型检查就报找不到模块。

**换题材怎么改**:先列提纲——五章各用哪几段,现成的段先从 4.2–4.12 挑;缺的镜头照最接近的模板写成短片文件,把段 `export` 出来再拼。五章要串成一条线(本例都绕着「平方」:展开 → 配方 → 图像 → 面积 → 体积),提要和章节卡的小字把这条线说出来;每章末的题考本章内容。小结的时长手算;改了段就重算上表。

**这个模板最容易犯的错**

- **拆散了接续段**:有的段开场接续上一段的末帧(4.4「开方求解」接「配方」的末式,4.5「同一点的高度与斜率」接「开口大小」的曲线),中间插进别的段,那些对象就凭空出现。同一模板的段按原顺序连着放,章节卡只放在每章第一段前。
- **分段名重名**:配音 id 缺省就是分段名,重名时 `voice:script` 报 id 重复。各模板的片头卡都叫「片头」,所以原片的片头、片尾卡(`…Intro` / `…Outro`)不拿;本集的小结叫「本集小结」。
- **同名导出**:各文件都导出 `titleCard`、`outroCard` 之类,真要 import 两个同名的就用 `as` 改名。
- **改被 import 的段**:原来那部短片跟着变;只改这一集就复制一份另起名。
- **`quiz()` 的四句话超字数**:窗口固定,分别 ≤ 18 / 15 / 14 / 20 字。

### 4.11 配音驱动短片

**定位**:画面跟着声音走——脚本里不写秒数,只写「等这句开口」「等说到这个词」;有配音按配音,没配音按草稿。示例《高斯求和》:1 + 2 + … + 100 = 5050。适合要配解说、要按词踩点的短片;不配音的用固定时长的模板更好控节奏。

**配音流程**(完整的见 [§10](#10-配音)):

1. 写 `timedSegment`:每句台词一个稳定 `id`,要对齐的词前插 `<mark name="k"/>`;字幕 = 台词去掉 mark,每句 ≤ 20 字。
2. voiceId `tplvoice`:`filmEntry` 第 2 个参数、`catalog.ts` 的键、`public/voice/tplvoice/` 三处相同。
3. 没有音频也能播:加载时干跑排草稿(本片 `draftRate: 4` 字/秒)。
4. 出配音([10.3](#103-流水线);`measured.json` 见 [10.4](#104-文件格式),timed 段的分段 id 是它的 `id`,片头卡是「片头」),音频和 `timing.json` 放同一目录,刷新即按配音播:

   ```bash
   npm run voice:script -- tplvoice --out script.json   # 配音方照 lines[].plain 念,交回音频和 measured.json
   npm run voice:layout -- script.json measured.json --out public/voice/tplvoice/timing.json
   npm run voice:check -- tplvoice public/voice/tplvoice/timing.json   # 0 个错误才算完
   ```

5. 测试:含 `timedSegment` 的片子**不能**进 `content.test.ts`(没排草稿的时长按字数估);把 [5.5](#55-timedsegment按台词对齐) 的测试文件存成 `src/film/tplVoice.test.ts`,`myFilm` 换成 `tplVoiceFilm`。

**目标时长**:以时间表为准;草稿 4 段 Σ 43.95 秒。

| 段 | 模板函数 | 草稿时长 | 画面 |
| --- | --- | --- | --- |
| 片头 | `cardSegment` | 4 | 「高斯求和」+ 1 + 2 + ⋯ + 100;一句台词(id「片头/1」) |
| 一加到一百 | `timedSegment` | 10.50 | 提问:问题逐字写出 → 1 到 5 的台阶逐列出现 |
| 复制、倒过来 | `timedSegment` | 13.25 | 粉色复制品 → 转 180° 拼上 → 5 × 6 长方形 → 算式 15 |
| 推广到 n | `timedSegment` | 16.20 | n × (n+1) 示意 → 通式 → 代入 100 → 5050,停 3 秒 |

**关键段节拍:复制、倒过来(草稿时间)**

| t(秒) | 台词 / 画面 | 脚本 |
| --- | --- | --- |
| 0.30–4.00 | 「把台阶复制一份,倒过来拼上去。」台阶接上一段露着;1.05 复制品 FadeIn 0.6;2.20 转 180° 并移到台阶上 1.8 秒 | `untilMark('double-1', 'copy')`;`untilMark(…, 'flip')` + `runTime = max(1.2, remaining('double-1'))` |
| 4.25–7.80 | 「正好拼成一个五乘六的长方形。」6.75 外框 `Create` +「5」「6」FadeIn 0.8 | `untilMark('double-2', 'rect')` |
| 8.05–13.25 | 「所以一加到五,等于五乘六除以二,十五。」算式 FadeIn 2.3,停 1,话说完再定格 0.6 | `runTime = max(0.8, remaining × 0.5)` |

四种踩点写法(本片都用到了):

| 要什么 | 写法 |
| --- | --- |
| 整句话都在画(分界线、通式) | `runTime: Math.max(下限, env.remaining(id))` |
| 在这句(或某个词)之前画完(问题、算式) | `runTime: Math.max(1, env.remaining(id) * 0.8)`(算式用 × 0.5);对齐某个词就接 `untilMark` |
| 说到这个词就动(复制品、外框) | `await env.untilMark(id, 'k')` 然后播 |
| 最后一句的强调撑满这句(5050) | `Indicate(x, { runTime: Math.max(0.6, env.remaining(id)) })` |

<details>
<summary>完整代码:<code>src/film/tplVoice.ts</code>(草稿 43.95 秒,4 段)</summary>

```ts
// src/film/tplVoice.ts
import { Create, FadeIn, Group, Indicate, LaggedStart, MoveTo, Polygon, Rectangle, RotateTo, Square, Write } from '../engine';
import type { Segment } from './film';
import { cardSegment, timedSegment } from './film';
import { hide, isNarrow, stage, tex, unrevealed } from './helpers';

const U = 36; // 一格边长
const BLUE = '#2563eb';
const PINK = '#db2777';
const BLUE_FILL = 'rgba(37,99,235,0.18)';
const PINK_FILL = 'rgba(219,39,119,0.18)';

/** 台阶 1 + … + 5:原点在 5 × 6 长方形中心,占左下半边,一列一个子组;转 180° 正好补满右上半边。 */
function staircase(stroke: string, fill: string, numbered: boolean): Group {
  const g = new Group();
  for (let c = 0; c < 5; c++) {
    const column = new Group();
    for (let r = 0; r <= c; r++) {
      column.add(new Square(U).setStyle({ stroke, fill, strokeWidth: 2 }).moveTo({ x: (c - 2) * U, y: (2.5 - r) * U }));
    }
    if (numbered) {
      column.add(tex(`${c + 1}`, 22, { x: (c - 2) * U, y: 3 * U + 20 }));
    }
    g.add(column);
  }
  return g;
}

export const titleCard = cardSegment({ name: '片头', title: '高斯求和', headingTex: '1 + 2 + \\cdots + 100', narration: '小高斯的求和巧思', holdSeconds: 3 });

export const stairs = timedSegment(
  {
    id: 'gauss-stairs',
    name: '一加到一百',
    marker: 'chapter',
    chapter: '高斯求和',
    draftRate: 4, // 草稿语速(字/秒)
    lines: [
      { id: 'stairs-1', text: '一加二加三,一直加到一百,等于多少?' },
      { id: 'stairs-2', text: '先看小一点的:一加到五,<mark name="stairs"/>摆成一个台阶。' },
    ],
  },
  async (env) => {
    const question = tex('1 + 2 + 3 + \\cdots + 100 = \\,?', 36, { x: 0, y: -190 });
    const steps = staircase(BLUE, BLUE_FILL, true).moveTo({ x: 0, y: 30 });
    const columns = steps.getChildren();
    // Write 不改不透明度:先藏,开写前再抬回 1。列用 FadeIn:藏「会被 FadeIn 的那一层」(列组)。
    question.opacity = 0;
    hide(...columns);
    stage(env.scene, [question, steps], 40);

    await env.untilLine('stairs-1');
    question.opacity = 1;
    await env.play(new Write(question, { runTime: Math.max(1, env.remaining('stairs-1') * 0.8) }));
    await env.untilMark('stairs-2', 'stairs');
    await env.play(new LaggedStart(columns.map((c) => new FadeIn(c, { runTime: 0.6 })), { lagRatio: 0.5 }));
    await env.wait(1);
  },
);

export const double = timedSegment(
  {
    id: 'gauss-double',
    name: '复制、倒过来',
    draftRate: 4,
    lines: [
      { id: 'double-1', text: '把台阶<mark name="copy"/>复制一份,<mark name="flip"/>倒过来拼上去。' },
      { id: 'double-2', text: '正好拼成一个五乘六的<mark name="rect"/>长方形。' },
      { id: 'double-3', text: '所以一加到五,等于五乘六除以二,十五。' },
    ],
  },
  async (env) => {
    const narrow = isNarrow(env.scene);
    const home = narrow ? { x: 0, y: -150 } : { x: -150, y: 0 };
    const away = narrow ? { x: 0, y: 150 } : { x: 130, y: 0 };
    const steps = staircase(BLUE, BLUE_FILL, false).moveTo(home); // 接上一段的画面,不藏
    const copy = staircase(PINK, PINK_FILL, false).moveTo(away);
    const outline = new Rectangle(5 * U, 6 * U).moveTo(home).setStyle({ strokeWidth: 3 });
    const five = tex('5', 26, { x: home.x, y: home.y + 3 * U + 24 });
    const six = tex('6', 26, { x: home.x + 2.5 * U + 22, y: home.y });
    const sum = tex('1+2+3+4+5 = \\dfrac{5 \\times 6}{2} = 15', 30, narrow ? { x: 0, y: 150 } : { x: 170, y: 0 });
    unrevealed(outline);
    hide(copy, five, six, sum);
    stage(env.scene, [steps, copy, outline, five, six, sum], 40); // 同时框住复制品的起点和终点

    await env.untilMark('double-1', 'copy');
    await env.play(new FadeIn(copy, { runTime: 0.6 }));
    await env.untilMark('double-1', 'flip');
    const t = Math.max(1.2, env.remaining('double-1'));
    await env.play(new RotateTo(copy, Math.PI, { runTime: t }), new MoveTo(copy, home, { runTime: t }));
    await env.untilMark('double-2', 'rect');
    await env.play(new Create(outline, { runTime: 0.8 }), new FadeIn(five, { runTime: 0.8 }), new FadeIn(six, { runTime: 0.8 }));
    await env.untilLine('double-3');
    await env.play(new FadeIn(sum, { runTime: Math.max(0.8, env.remaining('double-3') * 0.5) }));
    await env.wait(1);
  },
);

export const general = timedSegment(
  {
    id: 'gauss-general',
    name: '推广到 n',
    draftRate: 4,
    lines: [
      { id: 'general-1', text: '换成 n:长方形是 n 乘 (n+1)。' },
      { id: 'general-2', text: '和是它的<mark name="half"/>一半。' },
      { id: 'general-3', text: '代入一百:一百乘一百零一,除以二。' },
      { id: 'general-4', text: '答案是<mark name="answer"/>五千零五十。' },
    ],
  },
  async (env) => {
    const narrow = isNarrow(env.scene);
    const at = narrow ? { x: 0, y: -170 } : { x: -230, y: 0 };
    const colX = narrow ? 0 : 160;
    const box = new Rectangle(150, 180).moveTo(at);
    // 台阶分界线(示意):5 列,每列比左边高一格。
    const corner = [0, 1, 2, 3, 4].flatMap((c) => [-75, -45].map((dx) => ({ x: at.x + dx + 30 * c, y: at.y + 60 - 30 * c })));
    const edge = new Polygon(corner, { closed: false }).setStyle({ stroke: PINK, strokeWidth: 3 });
    const nName = tex('n', 26, { x: at.x, y: at.y + 90 + 24 });
    const n1Name = tex('n+1', 26, { x: at.x + 75 + 36, y: at.y });
    const rule = tex('1 + 2 + \\cdots + n = \\dfrac{n(n+1)}{2}', 32, { x: colX, y: narrow ? 50 : -70 });
    const plug = tex('1 + 2 + \\cdots + 100 = \\dfrac{100 \\times 101}{2}', 30, { x: colX, y: narrow ? 140 : 20 });
    const answer = tex('= 5050', 36, { x: colX, y: narrow ? 215 : 95 });
    unrevealed(box, edge);
    rule.opacity = 0;
    plug.opacity = 0;
    hide(nName, n1Name, answer);
    stage(env.scene, [box, edge, nName, n1Name, rule, plug, answer], 40);

    await env.untilLine('general-1');
    await env.play(new Create(box, { runTime: 1 }), new FadeIn(nName, { runTime: 1 }), new FadeIn(n1Name, { runTime: 1 }));
    await env.play(new Create(edge, { runTime: Math.max(0.8, env.remaining('general-1')) }));
    await env.untilMark('general-2', 'half');
    rule.opacity = 1;
    await env.play(new Write(rule, { runTime: Math.max(1, env.remaining('general-2')) }));
    await env.untilLine('general-3');
    plug.opacity = 1;
    await env.play(new Write(plug, { runTime: Math.max(1, env.remaining('general-3') * 0.8) }));
    await env.untilMark('general-4', 'answer'); // 答案等「答案是」之后再出,不抢在声音前
    await env.play(new FadeIn(answer, { runTime: 0.6 }));
    await env.play(new Indicate(answer, { runTime: Math.max(0.6, env.remaining('general-4')) }));
    await env.wait(3); // 全片最后一帧,停 3 秒
  },
);

/** 片头卡 + 3 段 timedSegment(草稿约 44 秒,以时间表为准)。 */
export const tplVoiceFilm: Segment[] = [titleCard, stairs, double, general];
```

</details>

键 `tplvoice`,整部片子 `tplVoiceFilm`(登记见 [2.3](#23-接进页面和工具),测试按第 5 步)。

**换题材怎么改**

1. **先写台词再写画面**:一句一件事、≤ 20 字、念得出来(「(n+1)」要确认 TTS 读得对);台词 id 全片唯一且不再改(改了已录音频就对不上),mark 名在一句里唯一。
2. **语速**:中文草稿 `draftRate: 4`(TTS 实测约 3.9 字/秒,缺省 4.5);英文按字母数算,设 12–15。
3. **画面**:每句一个主动作,用上表四种写法定时长;段尾 `env.wait(1)`,最后一段 `env.wait(3)`(3–6 秒)收尾,或另加片尾卡。
4. **固定时长的段也能配音**:片头卡的台词就是 `narration`(id「片头/1」),要在 0.3 秒到段尾之间说完(本片 ≤ 3.7 秒)。`voice:layout` 报「……会撞上段尾」就念快点,或 `holdSeconds` 加 1 后**重跑 `voice:script`**(台词稿记着旧段长)。

**这个模板最容易犯的错**

- **「剩余时间减常数」**:`env.remaining(id) - 1` 配音一快就 ≤ 0(按 0 处理并告警,动画跳到终态),一慢就对不上词。用 `remaining × 比例` 或等 mark;先 `untilLine` 再用 `remaining`,一律 `Math.max(下限, …)`。`env.line(id).start` / `.end` 是相对段首的时刻,不是时长。
- **`Write` 前藏了没抬回**:搭建时 `opacity = 0`,紧挨 `Write` 的前一行置 1。
- **mark 写错**:`<mark name=k/>` 没引号不识别,还原样留在字幕里;`untilLine` 没声明的 id,这一段被跳过;台词 id 重复、空台词在 import 时就抛错。
- **竖屏分支改了时间线**:草稿和 `voice:check` 只跑横屏,分支只改位置。
- **`voice:check` 报「动画比时间表长 C 秒」**:把时间表里这一段的 `duration` 加长。

### 4.12 3D 直观片

**定位**:用会转的立体讲一个空间事实。示例《1 : 2 : 3》:半径都是 r、高都是 2r 的圆锥、球、圆柱,用「截面处处相等」(祖暅原理)说明球 = 圆柱 − 双锥,体积之比 1 : 2 : 3。适合立体几何、旋转体、截面论证、曲面形状;不适合要坐标轴和精确读数的图(没有 3D 坐标轴,要画见 [9.6](#96-3d-里的标注辅助线与坐标轴))。

**目标时长**:示例 4 段 Σ 50.8 秒。

| 段 | 模板函数 | 时长 | 画面 | 字幕要点 |
| --- | --- | --- | --- | --- |
| 片头 | `cardSegment` | 5 | 「1 : 2 : 3」+ 圆锥、球与圆柱 | 阿基米德最得意的发现 |
| 三个立体 | `directedSegment` | 15.4 | 三个线框立体依次淡入 → 标尺寸 → `Orbit3D` 整组转半圈 | 三个立体 → 尺寸 → 提问 |
| 截面相等 | `directedSegment` | 24.4 | 球 与 圆柱 − 双锥;同一高度的截面(圆、圆环)上下扫 | 两个截面积 → 处处相等 → 祖暅原理 |
| 片尾 | `cardSegment`(hold 5) | 6 | V锥 : V球 : V柱 = 1 : 2 : 3 与三个体积 | 结论 |

**关键段节拍:截面相等(24.4 秒)**

| t(秒) | 画面动作 | 字幕 |
| --- | --- | --- |
| 0–3.2 | 球、圆柱、双锥(线框)和名字 FadeIn 1.2,停 2 | 0.2–3.0「球,和挖去双锥的圆柱」 |
| 3.2–5.2 | 两个截面(橙色半透明,h = −0.45r)FadeIn 1,停 1 | 3.3–5.9「在同一高度切一刀」 |
| 5.2–12.1 | 左式 π(r² − h²) FadeIn 1.2,停 2.5;右式 πr² − πh² FadeIn 1.2,停 2 | 6.2–9.4「左边截出圆:π(r²−h²)」、9.7–12.9「右边截出圆环:πr²−πh²」 |
| 12.1–18.9 | `sweep` h:−0.45r → 0.8r,6 秒,每帧 `resample([h])`;停 0.8 | 13.2–18.6「换个高度,两边面积始终相等」 |
| 18.9–24.4 | 结论 V球 = V圆柱 − V双锥 FadeIn 1.5,停 4 | 18.9–24.2「祖暅原理:体积也相等」 |

3D 要点(见 [§9](#9-3d)):y **向下**、z 指向观众,单位是世界单位;立体都以 y 为轴,`Cone` 尖顶朝上。`Projection3D({ rotX, rotY, viewDistance, nearRatio })` 缺省 −0.45 / 0.6 / 700 / 0.2,几个网格共用它,一个 `Orbit3D(view, 圈数, { runTime })` 转整组。没设 `fill` 画线框。

<details>
<summary>完整代码:<code>src/film/tpl3d.ts</code>(50.8 秒,4 段)</summary>

```ts
// src/film/tpl3d.ts
import { Cone, Cylinder, FadeIn, Orbit3D, ParametricSurface, Projection3D, Sphere, lightTheme } from '../engine';
import type { Mesh3D, Point } from '../engine';
import type { Segment, SegmentEnv } from './film';
import { cardSegment, directedSegment } from './film';
import { fadeIns, hide, isNarrow, label, stage, sweep, tex } from './helpers';

const R = 80;
const BLUE = '#2563eb';
const PINK = '#db2777';
const INK = '#1f2937';
const SLICE = { fill: 'rgba(234,88,12,0.45)', stroke: '#ea580c', strokeWidth: 0.8 };

/** 关掉方格底纹和原点十字:它们在立体背后像一根穿心的轴。 */
function clean(env: SegmentEnv): void {
  env.scene.setTheme({ ...lightTheme, showGrid: false, showAxes: false });
}

/** 半径都是 R;圆锥、圆柱高 2R,球的直径也是 2R。 */
const TRIO: Array<{ title: string; make: (view: Projection3D) => Mesh3D }> = [
  { title: '圆锥', make: (view) => new Cone(R, 2 * R, 32, { projection: view }).setStyle({ stroke: PINK }) },
  { title: '球', make: (view) => new Sphere(R, 24, 16, { projection: view }).setStyle({ stroke: BLUE }) },
  { title: '圆柱', make: (view) => new Cylinder(R, 2 * R, 32, { projection: view }).setStyle({ stroke: INK }) },
];

/** 横屏一字排开、标签在下;竖屏竖排、标签在右。 */
function slot(narrow: boolean, i: number): { at: Point; below: Point } {
  const at = narrow ? { x: 0, y: (i - 1) * 280 } : { x: (i - 1) * 250, y: 0 };
  return { at, below: narrow ? { x: 150, y: at.y } : { x: at.x, y: 150 } };
}

export const titleCard = cardSegment({ name: '片头', title: '1 : 2 : 3', titleSize: 64, heading: '圆锥、球与圆柱', narration: '阿基米德最得意的发现', holdSeconds: 4 });

export const trio = directedSegment(
  '三个立体',
  // 3 × (1.2 淡入 + 0.4) + 1 尺寸 + 6 环绕 + 3.6 停留 = 15.4。
  15.4,
  [
    { start: 0.2, end: 3.4, text: '一个圆锥,一个球,一个圆柱' },
    { start: 3.7, end: 7.6, text: '半径都是 r,高都是 2r' },
    { start: 7.9, end: 11.2, text: '球正好能放进圆柱里' },
    { start: 11.5, end: 15.2, text: '它们的体积有什么关系?' },
  ],
  async (env) => {
    clean(env);
    const narrow = isNarrow(env.scene);
    const view = new Projection3D({ rotX: -0.35, rotY: 0.4 });
    const pairs = TRIO.map((t, i) => [t.make(view).moveTo(slot(narrow, i).at), label(t.title, 26, slot(narrow, i).below)]);
    const size = tex('\\text{半径 } r,\\quad \\text{高 } 2r', 28, { x: 0, y: narrow ? 420 : 215 });
    hide(...pairs.flat(), size);
    stage(env.scene, [...pairs.flat(), size], 30);

    for (const pair of pairs) {
      await env.play(...fadeIns(pair, 1.2));
      await env.wait(0.4);
    }
    await env.play(new FadeIn(size, { runTime: 1 }));
    // 共用视角:一个 Orbit3D 转整组(轮廓不变、经线在动,立体感就出来了)。
    await env.play(new Orbit3D(view, 0.5, { runTime: 6 }));
    await env.wait(3.6);
  },
);

export const slices = directedSegment(
  '截面相等',
  // 1.2 + 2 + 1 截面 + 1 + 1.2 + 2.5 + 1.2 + 2 + 6 扫动 + 0.8 + 1.5 结论 + 4 停留 = 24.4。
  24.4,
  [
    { start: 0.2, end: 3.0, text: '球,和挖去双锥的圆柱' },
    { start: 3.3, end: 5.9, text: '在同一高度切一刀' },
    { start: 6.2, end: 9.4, text: '左边截出圆:π(r²−h²)' },
    { start: 9.7, end: 12.9, text: '右边截出圆环:πr²−πh²' },
    { start: 13.2, end: 18.6, text: '换个高度,两边面积始终相等' },
    { start: 18.9, end: 24.2, text: '祖暅原理:体积也相等' },
  ],
  async (env) => {
    clean(env);
    const narrow = isNarrow(env.scene);
    const left = narrow ? { x: 0, y: -230 } : { x: -180, y: 0 };
    const right = narrow ? { x: 0, y: 150 } : { x: 180, y: 0 };
    const view = new Projection3D({ rotX: -0.5, rotY: 0.4 });
    const H0 = -0.45 * R; // 截面高度 h(y 向下,负数在球心上方)
    const ball = new Sphere(R, 24, 16, { projection: view }).setStyle({ stroke: BLUE, strokeWidth: 1.5 });
    const can = new Cylinder(R, 2 * R, 32, { projection: view }).setStyle({ stroke: INK, strokeWidth: 1.5 });
    // 双锥:尖顶在中心,上下底就是圆柱的两个底面。
    const cones = new ParametricSurface(
      (u, v) => ({ x: R * Math.abs(v) * Math.cos(u), y: R * v, z: R * Math.abs(v) * Math.sin(u) }),
      { uSegs: 32, vSegs: 8, vRange: [-1, 1], projection: view },
    ).setStyle({ stroke: PINK, strokeWidth: 1.5 });
    // 截面带参数 h,resample([h]) 重采样。球截出圆盘(半径 √(r²−h²)),右边截出圆环(内径 |h|,外径 r)。
    const section = (radius: (h: number, v: number) => number): ParametricSurface =>
      new ParametricSurface(
        (u, v, [h = 0]) => ({ x: radius(h, v) * Math.cos(u), y: h, z: radius(h, v) * Math.sin(u) }),
        { uSegs: 32, vSegs: 1, vRange: [0, 1], params: [H0], projection: view },
      ).setStyle(SLICE);
    const disc = section((h, v) => Math.sqrt(Math.max(0, R * R - h * h)) * v);
    const ring = section((h, v) => Math.abs(h) + (R - Math.abs(h)) * v);
    // 同一个立体的零件放在同一个位置:每个网格以自己的原点为灭点,位置相同透视才一致。
    for (const m of [ball, disc]) {
      m.moveTo(left);
    }
    for (const m of [can, cones, ring]) {
      m.moveTo(right);
    }
    const at = (p: Point, dy: number): Point => ({ x: p.x, y: p.y + dy });
    const names = [label('球', 26, at(left, -150)), label('圆柱 − 双锥', 26, at(right, -150))];
    const leftArea = tex('\\pi(r^2 - h^2)', 28, at(left, 145));
    const rightArea = tex('\\pi r^2 - \\pi h^2', 28, at(right, 145));
    const verdict = tex('V_{\\text{球}} = V_{\\text{圆柱}} - V_{\\text{双锥}}', 30, { x: 0, y: narrow ? 360 : 215 });
    const solids = [ball, can, cones];
    const all = [...solids, disc, ring, ...names, leftArea, rightArea, verdict]; // 先 add 立体,再 add 截面
    hide(...all);
    stage(env.scene, all, 24);

    await env.play(...fadeIns([...solids, ...names], 1.2));
    await env.wait(2);
    await env.play(...fadeIns([disc, ring], 1));
    await env.wait(1);
    await env.play(new FadeIn(leftArea, { runTime: 1.2 }));
    await env.wait(2.5);
    await env.play(new FadeIn(rightArea, { runTime: 1.2 }));
    await env.wait(2);
    const cut = (h: number): void => {
      disc.resample([h]);
      ring.resample([h]);
    };
    await sweep(env, { from: H0, to: 0.8 * R, runTime: 6, draw: cut });
    await env.wait(0.8);
    await env.play(new FadeIn(verdict, { runTime: 1.5 }));
    await env.wait(4);
  },
);

// 结论卡:双锥和高 2r 的圆锥体积相同,所以 V球 = V柱 − V锥 = 2πr³ − ⅔πr³ = ⁴⁄₃πr³。
export const outroCard = cardSegment({
  name: '片尾',
  titleTex: 'V_{\\text{锥}} : V_{\\text{球}} : V_{\\text{柱}} = 1 : 2 : 3',
  titleSize: 44,
  headingTex: '\\tfrac{2}{3}\\pi r^3 : \\tfrac{4}{3}\\pi r^3 : 2\\pi r^3',
  narration: '体积之比,正好 1 : 2 : 3',
  holdSeconds: 5,
});

/** 3D 直观片:4 段,50.8 秒。 */
export const tpl3dFilm: Segment[] = [titleCard, trio, slices, outroCard];
```

</details>

键 `tpl3d`,整部片子 `tpl3dFilm`(登记见 [2.3](#23-接进页面和工具))。`&preview=38.5` 停在截面扫到最低处(段内 18.1 秒)。

**换题材怎么改**

1. **换立体**:改 `TRIO` 的 `make`,可选 `Cube`、`Cuboid`、`Pyramid`、`Tetrahedron`、`TriangularPrism`、`Cylinder`、`Cone`、`Sphere`,或 `ParametricSurface`(预设 `sphereParam`、`torusParam`、`mobiusParam`、`kleinParam`)。旋转体写 `(u, v) => ({ x: S * f(v) * Math.cos(u), y: S * v, z: S * f(v) * Math.sin(u) })`,S 是一个数学单位的世界长度(本片 R = 80),u 缺省取 [0, 2π]。
2. **会变的曲面**:采样函数第三个参数是 `params`,构造时给 `params: [初值]`,之后 `resample([新值])`(`sweep` 驱动,或 `ParamMorph(曲面, [终值], { runTime })`)。
3. **视角**:`rotX` −0.3 到 −0.5 最好读(0 是平视,底面压成线;绝对值超过约 0.8 高度被压扁);方的立体 `rotY` 取 0.4–0.6,露出两个侧面。竖屏由 `slot(narrow, i)` 改成竖排。

**这个模板最容易犯的错**

- **对网格用 `Create`**:开始就抛错,这一段被跳过;3D 网格一律 `FadeIn`。
- **视角没共享**:`Orbit3D` 只转共用那个 `Projection3D` 的网格;共用后对任何一个播 `Spin3D` 也会带着整组转。
- **用 `position` 拼一个立体**:每个网格以自己的原点为灭点,同一立体的零件放同一位置,错开要改顶点或采样函数。
- **网格之间不遮挡**:后 add 的盖在上面;截面半透明,先 add 立体再 add 截面。
- **转起来出画**:取景只量一次,非旋转体转起来会变宽。用 `stage` 的第 4 个参数放一个正方形框,边长 ≈ 2.3 × 最远顶点到原点的距离(`new Cube(70)` 配 `new Rectangle(140, 140)`)。
- **方格底纹和原点十字**从立体背后穿过:3D 段开头调 `clean(env)`。

### 4.13 镜头套路速查

现有影片里反复出现的 18 种镜头套路(时长为实测)。「完整代码」一栏是模板小节和分段的变量名;标「—」的照「主要 API」写。字幕通则:扫动、逼近时说变化和规律,不念读数;结论字幕出现时画面已停在对应状态。

| # | 套路 | 主要 API | 典型时长 | 完整代码 |
| --- | --- | --- | --- | --- |
| 1 | 片头卡 · 章节卡 · 片尾卡 | `cardSegment`、`chapterCard`;一条字幕 `[0.3, 段尾)` | 5 / 7 / 4–6 | 各模板的 `titleCard` / `outroCard`(4.2–4.7 叫 `…Intro` / `…Outro`);[4.9](#49-三分钟章节短片) `ch1` |
| 2 | 本集提要 / 目录 | `listSegment`(居中);左对齐用 `columnList({ align: 'start', minWidth: 420 })` + `fadeSequence` | 10–15 | [4.9](#49-三分钟章节短片)、[4.10](#410-十分钟完整一集) `outline` |
| 3 | 坐标系开场 + 标注 | `makePlot` + `plotIntro`(3.5)+ `Dot(7)` + `tex` | 16 | [4.5](#45-函数图像探索片) `widthSegment`;[4.6](#46-极限与逼近片) `squeezeSegment` |
| 4 | 割线逼近切线 | `drawAt(h)` 改 Q 点、割线两端、`h = …` 读数;`sweep({ from: 3, to: 0.03, runTime: 9, draw: drawAt })`(h 不能到 0);最后割线换成切线 1.2 | 19–20 | — |
| 5 | 数值逼近表 / 读数换形 | `listSegment`(gap 1.5);`FadeTransform(读数, 新文字)` | 11–17.5 | [4.9](#49-三分钟章节短片) `sizeFree`、`doubling`;[4.6](#46-极限与逼近片) `squeezeSegment` |
| 6 | 公式原地演化 | `FadeTransform(f, '新 TeX', { runTime: 1.5 })`,每步前停 3–3.5;按结构变用 `TransformMatchingTex`(1.3) | 15–17 | [4.4](#44-公式推导片) `completeSegment`、`solveSegment` |
| 7 | 切线探针扫动 | `tangentProbe` + `sweep`(主扫 5–10 + 回扫 1.5–2) | 18–21 | [4.5](#45-函数图像探索片) `slopeSegment` |
| 8 | 联动双视图 | 一个 `drawAt(x)` 同时改左边图形和右边图像上的点、读数;先按全程最大包络取景再设初值;主扫 `linear`,回扫到最优值再下结论 | 18.5–21 | — |
| 9 | 图 + 侧栏推导 | 左图右栏(竖屏上图下栏):`sideColumn(scene, n)` + `isNarrow` + `fadeSequence` | 15–21 | — |
| 10 | 列点小结 / 公式表 | `listSegment`:时长 = 条目数 × (1 + gap) + hold | 9–18 | [4.9](#49-三分钟章节短片) `general`;[4.10](#410-十分钟完整一集) `summary` |
| 11 | 逐次逼近(叠加 → 替换) | 新对象先 `hide` 再 `scene.add`;`FadeOut(旧)` + `FadeIn(新)` 0.8 | 15–25 | [4.9](#49-三分钟章节短片) `doubling` |
| 12 | 迭代构造(牛顿法) | 先算好每步的切线、垂线、落点;每步 `Create(切线, 1.5)` + `FadeIn(垂线、落点, 1)`,停 1 | 19–20 | — |
| 13 | 习题讲解 | `quizSegment` | 17.9 | [4.8](#48-习题讲解片) `question` |
| 14 | 集合 / 映射示意图 | `Ellipse` / `Circle` / `Arrow` 用 `Create` 1–1.2,标签 `FadeIn` 0.8–1;关注的集合填 `#dbeafe` | 9–10.5 | — |
| 15 | 按台词踩点 | `timedSegment` + `untilLine` / `untilMark` / `remaining` | 每句 3–6 | [4.11](#411-配音驱动短片) `double` |
| 16 | 高亮圈注 | `Indicate` / `Circumscribe`(可带 `{ part }`,公式里 `\class{名}{…}`);持久变色 `ColorTo` | 各约 1 | [4.8](#48-习题讲解片) `quizSegment`、`solution`;[4.11](#411-配音驱动短片) `general` |
| 17 | 黎曼和加细 | `RiemannRectangles` + `RiemannTo({ n })` + 读数 `FadeTransform`,每次细分后停 1.5–2 | 18–20 | [4.6](#46-极限与逼近片) `squeezeSegment` |
| 18 | 运镜分镜 / 3D 旋转 | `Promise.all([scene.playFit(对象, { pad, runTime: 2–2.2 }), env.play(…)])` 之后 `env.checkpoint()`(见 [8.3](#83-播放语义));`Projection3D` + `Orbit3D` | 每镜 2–2.2;环绕 2.4–6 | [4.12](#412-3d-直观片) `trio` |

## 5. 分段与影片参考

写片子会调用的全部 API、默认值和时长公式。节奏、字幕、版面见 [§3](#3-好片子的手艺),整片骨架见 [§4](#4-片子模板)。

**从哪里 import**

| 来源 | 拿什么 |
|---|---|
| `'../engine'` | 图元、动画、缓动函数(`linear`、`smooth`……)、`lightTheme`、引擎类型(`MObject`、`Point`、`RealFunction`……)。 |
| `'./film'` | `directedSegment`、`cardSegment`、`timedSegment`、`CARD_INTRO_SECONDS`、`runFilm`、`prepareVoice`、`previewFrameAt`、时间线工具;类型 `Segment`、`Subtitle`、`SegmentEnv`、`TimedEnv`、`DirectedSegmentOptions`、`CardSegmentOptions`、`TimedSegmentOptions`、`FilmOptions`、`FilmController`。 |
| `'./helpers'` | 全部助手(`tex`、`label`、`hide`、`unrevealed`、`stage`、`makePlot`、`plotIntro`、`sweep`、`listSegment`、`chapterCard`……)。**`./film` 不转出助手**,助手只能从 `./helpers` import。 |

内容文件放在 `src/film/<名字>.ts`。编译 / lint 规则(类型用 `import type`、下标取值写 `arr[i] ?? 0`、不许 `console.log`、局部变量不与助手重名、不 import `./catalog` / `../sceneRegistry`……)的报错和修法见 [12.6](#126-测试类型检查lint加载)。

### 5.1 分段的契约

影片就是一个 `Segment[]`。每个分段是这样的对象:

| 字段 | 类型 | 说明 |
|---|---|---|
| `name` | `string` | 显示名,出现在进度条悬停提示和报错信息里。 |
| `id?` | `string` | 稳定的配音 id。不写时配音按 `name` 对应,改名就和已有的配音时间表对不上。 |
| `duration` | `number` | 秒。**必须等于实际时间线**,允许 ±0.25 秒(内容测试卡这个)。 |
| `subtitles?` | `Subtitle[]` | 字幕,时间相对本段开头。缺省没有字幕,这时也没有字幕安全区(见 [5.9](#59-预览跳转安全区竖屏重建背景网格与-settheme))。 |
| `marker?` | `'chapter' \| 'segment'` | `'chapter'`:进度条上画大刻度,也是 PageUp / PageDown 的落点。缺省是小刻度。 |
| `chapter?` | `string` | 章节短标题,进度条上显示成 `一 · 章名`。 |
| `voice?` | `SegmentVoice` | 配音音频,由 `prepareVoice` 挂上,作者不用写。 |
| `play(canvas, context?)` | `→ SegmentHandle` | 起播。模板已经实现好了。 |

`Subtitle = { start: number; end: number; text: string; id?: string }`:区间 `[start, end)`,按时间排好、不重叠(首尾相接可以),`end ≤ duration`。显示满足 `start ≤ elapsed < end` 的那条(elapsed 钳在 `[0, duration]`,所以段尾淡出时字幕已消失)。`id` 是配音台词 id,缺省 `"<分段 id 或 name>/<序号>"`(从 1 数,调换顺序会改 id)。写法见 [3.3 字幕](#33-字幕)。

**duration 契约。** 进度条、跳转、字幕钳位、导出进度都按声明的 `duration` 算;对不上时运行时**不报错**,只出怪事(见 [3.2 时间](#32-时间)),所以手写时长的分段上方都写一行时长账注释。`cardSegment` / `chapterCard` 自动算 `1 + holdSeconds`;`listSegment` 要手写;`timedSegment` 不写,由 `prepareVoice` 定。

**播放器的其他行为**(`transition` 缺省 0.6 秒;首尾白场与实际片长见 [3.2 时间](#32-时间)):

- 跳转直接切段,没有白闪。
- 出错:`play()` 同步抛错 → `phase: 'start'`,马上跳过这段(每段都起不来时播放器停止);`done` reject → `phase: 'play'`,照常淡出进下一段。
- 永远不结束的分段(`env.wait(Infinity)`、一直等不到的循环):直播一直停在这段;离线导出超过 `(Σduration + 段数 × 2 × transition + 5) × 2` 秒后以 `'overrun'` 失败。

**自己实现 `play`**(包装现成场景,平时用不到):照 `src/film/program.ts` 的 `pythagorasSegment`,把 `once: true`、`onDone`、`onError` 和 `context` 的 `safeArea` / `clock` / `viewport` 交给场景,返回 `{ ...handle, done }`。场景出错时**必须**让 `done` reject,否则播放器永远停在这段。

### 5.2 directedSegment 与 SegmentEnv

```ts
directedSegment(
  name: string,
  duration: number,
  subtitles: Subtitle[],                      // 必填;没有字幕就传 []
  direct: (env: SegmentEnv) => Promise<void>,
  options?: DirectedSegmentOptions,           // { id?: string; marker?: 'chapter' | 'segment'; chapter?: string }
): Segment
```

构造时不校验,`duration` 原样采用;`options` 只复制写了的字段。每次 `play` 新建一个 Scene(`lightTheme`,带网格和原点十字,见 [5.9](#59-预览跳转安全区竖屏重建背景网格与-settheme);关鼠标交互;套字幕安全区;用播放器的时钟和视口),执行 `direct(env)`:resolve 即本段结束,抛错(取消哨兵除外)让 `done` reject。

**`SegmentEnv` 的全部成员**

| 成员 | 说明 |
|---|---|
| `scene` | 本段的 Scene,常用成员见下表。 |
| `play(...playables)` | 等于 `scene.play`,前后各查一次取消。所有动画同时开始,耗时取最长的 runTime;runTime 非有限或 ≤ 0 时瞬间完成。各写法耗时见 [3.2](#32-时间)。 |
| `wait(seconds)` | 等于 `scene.wait`,同样查取消。NaN 或负数按 0。 |
| `checkpoint()` | 已取消就抛哨兵。用在大段同步搭建之后和 `scene.playFit(...)` 之后。 |
| `isCancelled()` | 是否已取消(用 `env.play` / `env.wait` 时基本用不上)。 |
| `camera` | 已废弃,即 `scene.getCamera()`。 |

**取消。** 跳转、销毁、横竖屏重建都会释放当前段,之后 `env.play` / `env.wait` / `env.checkpoint` 抛私有哨兵,模板吞掉它、`done` 照常 resolve,不用在每个 await 后查 `isCancelled()`。

- **不要用 `scene.play` / `scene.wait`**:释放后立即 resolve,脚本在已释放的场景上跑到底,`for (;;) await scene.wait(1)` 永远空转。
- `try/catch` 的 catch 要把错误重新抛出,否则哨兵被吞,后面的代码在已释放的场景上接着跑。`try/finally`(如注销 updater)没问题。

**`scene` 的常用成员**

| 成员 | 说明 |
|---|---|
| `add(...m)` / `remove(...m)` | 加入 / 移出场景(重复加入忽略)。 |
| `fitObjects(objects, pad = 0)` | 瞬时取景:把这些对象框进画面(已扣安全区)。尺寸变化或字体晚到时按同一批对象自动重取景。 |
| `playFit(objects, { pad?, runTime?, rateFunc? })` | 运镜到框住这些对象(默认 1 秒),之后的重取景以它为准。走 `scene.play`,**不检查取消**,后面跟 `env.checkpoint()`。 |
| `measureContext()` | 量尺上下文,传给 `getBox` / `columnList`。 |
| `addUpdater(fn)` | 返回注销函数。`fn(scene, dt)` 只在 play / wait 期间每帧调用,先于动画插值。 |
| `getViewportSize()` | `{ w, h }`,css 像素(`isNarrow` 用它判断)。 |
| `getElapsed()` | 本段已播秒数。 |
| `setTheme(theme)` | 换主题,关网格见 [5.9](#59-预览跳转安全区竖屏重建背景网格与-settheme)。 |

**脚本必须能重放。** 单帧预览、段内跳转、离线导出、配音排草稿都会在虚拟时钟上从 t = 0 重跑 `direct`(快进时不画)。因此:

- 只用引擎的时间(`env.play`、`env.wait`、updater),不用 `setTimeout`、`Date.now()`、`performance.now()`、`requestAnimationFrame`,不发网络请求。
- 不用不带种子的 `Math.random()`;要随机就用固定种子的伪随机,每次进 `direct` 时重置。
- MObject 在 `direct`(或 `entries` 工厂)里新建:离线导出会另起一份实例和预览同时跑,模块作用域的对象会被两边共用。常量、函数、纯数据放模块作用域没问题。
- 横竖屏分支时间线完全相同,只改位置和大小(内容测试和配音草稿只跑横屏)。

下例用上了 `options` 三个字段、关网格、竖屏分支、`plotIntro` / `tangentProbe` / `sweep`、读数的取景包络和时长账(16.7 秒)。分段放进 `Segment[]`(`refDirectedFilm`)、按 [2.3](#23-接进页面和工具) 注册后才能看。

```ts
// src/film/refDirected.ts
import { Dot, Indicate, lightTheme } from '../engine';
import { directedSegment } from './film';
import type { Segment } from './film';
import { fadeIns, hide, isNarrow, makePlot, plotIntro, stage, sweep, tangentProbe, tex } from './helpers';

export const refSlopeSegment: Segment = directedSegment(
  '切线斜率',
  // 3.5 开场 + 1 + 6 扫描 + 1.2 + 1 强调 + 4 停留 = 16.7。
  16.7,
  [
    { start: 0.2, end: 3.3, text: '画出 y 等于 x 的平方' },
    { start: 3.7, end: 10.3, text: '切点滑动,斜率读数跟着变' },
    { start: 10.7, end: 16.5, text: '斜率总是切点横坐标的两倍' },
  ],
  async (env) => {
    const { scene } = env;
    // 关网格和原点十字;全片每段都要关,背景才一致(见 5.9)。
    scene.setTheme({ ...lightTheme, showGrid: false, showAxes: false });
    const narrow = isNarrow(scene);
    const f = (x: number): number => x * x;
    const fp = (x: number): number => 2 * x;
    const p = makePlot({
      xRange: [-2, 2],
      yRange: [-1, 4],
      width: 440,
      height: 330,
      fn: f,
      at: narrow ? { x: 0, y: -60 } : { x: -120, y: 0 },
    });
    const probe = tangentProbe({ W: p.W, f, fp, clamp: [-2, 2], halfSpan: 0.7 });
    probe.drawAt(-1.5); // 先摆到起点再取景
    // 取景包络:扫描两端各放一个读数大小的 Dot(readoutOffset 缺省 { x: 0, y: -40 })。
    const half = probe.readout.getBox(scene.measureContext()).size.w / 2 + 12;
    const span = [-1.5, 1.5].map((a) => {
      const d = new Dot(half);
      const at = p.W(a, f(a));
      d.moveTo({ x: at.x, y: at.y - 40 });
      return d;
    });
    const result = tex("f'(x) = 2x", 34, narrow ? { x: 0, y: 200 } : { x: 250, y: 0 });
    hide(...probe.parts, result);
    stage(scene, [p.plot, ...probe.parts, result], 24, span); // span 只参与取景,不进场景

    await plotIntro(env, p); // 0–3.5:坐标轴淡入 + 曲线描出 + 停 1
    await env.play(...fadeIns(probe.parts, 1)); // 3.5–4.5
    await sweep(env, { from: -1.5, to: 1.5, runTime: 6, draw: probe.drawAt }); // 4.5–10.5
    await env.play(...fadeIns([result], 1.2)); // 10.5–11.7
    await env.play(new Indicate(result)); // 11.7–12.7
    await env.wait(4); // 12.7–16.7
  },
  { id: 'ref-slope', marker: 'chapter', chapter: '切线' },
);

export const refDirectedFilm: Segment[] = [refSlopeSegment];
```

### 5.3 cardSegment

片头卡、章节卡、片尾卡:一行大标题、一条横线、可选的第二行。开场三者同时出现(标题 FadeIn、横线 Create、第二行 FadeIn,各 1 秒),再停留 `holdSeconds` 秒;取景 `fitObjects(parts, 40)`。

```ts
cardSegment(o: CardSegmentOptions): Segment
```

| 选项 | 缺省 | 说明 |
|---|---|---|
| `name` | 必填 | 分段名,也是配音 id(卡片**没有 `id` 选项**,改名就对不上已有配音)。 |
| `title` / `titleTex` | 二选一,必填 | 第一行:`title` 是文字(Label),`titleTex` 是公式(Tex)。 |
| `titleSize` | 56 | 标题字号。 |
| `titleY` | -44 | 标题的纵坐标(世界单位,y 向下)。 |
| `lineY` | 4 | 横线的纵坐标。 |
| `lineHalfWidth` | 100 | 横线半长。 |
| `heading` / `headingTex` | 可省 | 第二行:文字或公式。两个都写时 `headingTex` 生效,不报错。 |
| `headingSize` | 文字 24,公式 36 | 第二行字号。 |
| `headingY` | 48 | 第二行的纵坐标。 |
| `narration` | 必填 | 整张卡唯一的一条字幕:`{ start: 0.3, end: duration }`。 |
| `holdSeconds` | 必填 | 开场之后停留的秒数。 |
| `marker` / `chapter` | 可省 | 同 [5.1](#51-分段的契约)。 |

- **`duration = CARD_INTRO_SECONDS + holdSeconds`**(`CARD_INTRO_SECONDS = 1`)。常用 hold:片头 4、章节卡 6、片尾 3–5。
- `narration` 同样 ≤ 20 字,语速按 `字数 ÷ (duration − 0.3)` 算。
- **`title` / `titleTex` 必须恰好给一个**,但到 `play()` 才检查:抛出 `卡片「name」需要 title 与 titleTex 二选一`,这段按 `'start'` 跳过,内容测试失败。
- 卡片拿不到 `scene`,关不了网格、加不了对象;要定制就写 `directedSegment`(见 [5.9](#59-预览跳转安全区竖屏重建背景网格与-settheme))。

### 5.4 助手(`./helpers`)

选项类型(`PlotOptions`、`PlotEnv`、`PlotIntroOptions`、`FadeSequenceOptions`、`SweepOptions`、`TangentProbeOptions`、`TangentProbe`、`ListEntry`、`ColumnListOptions`、`ListSegmentOptions`、`ChapterCardOptions`)用 `import type`。

**构造与布景**

| 导出 | 签名 | 行为与缺省 | 什么时候用 |
|---|---|---|---|
| `tex` | `(source: string, fontSize: number, at?: Point, options?: { displayMode?: boolean }) => Tex` | 新建 Tex,设字号,移到 `at`。 | 每个公式。 |
| `label` | `(text: string, fontSize: number, at?: Point) => Label` | 同上,建的是 Label(单行画布文字)。 | 文字、标签、每帧变的数字读数(Tex 每换源码都重排版,每秒换 20 次以上会告警)。 |
| `hide` | `(...objects: MObject[]) => void` | 设 `opacity = 0`。 | `FadeIn` 之前藏(藏**被 FadeIn 的那一层**);`Write` 的对象搭建时 `hide`、临播前设回 `opacity = 1`。见 [3.4](#34-先藏后揭)。 |
| `unrevealed` | `(...objects: MObject[]) => void` | `setRevealFraction(0)`。 | `Create` 之前收起描边(`Create` 不改不透明度)。 |
| `fadeIns` | `(objects: readonly MObject[], runTime: number) => FadeIn[]` | 每个对象一个 FadeIn。 | 一组对象同时淡入:`await env.play(...fadeIns(xs, 1.2))`,耗时等于 runTime。 |
| `stage` | `(scene: Scene, objects: readonly MObject[], pad: number, fitExtra: readonly MObject[] = []) => void` | 执行 `scene.add(...objects)` 和 `fitObjects([...objects, ...fitExtra], pad)`。 | 搭景最后一步。`fitExtra` 只参与取景、不进场景,当运动全程的包络占位。 |

**坐标系**

| 导出 | 签名 | 行为与缺省 | 时长 |
|---|---|---|---|
| `makePlot` | `(o: { xRange: [n, n]; yRange: [n, n]; width: number; height: number; fn: RealFunction; samples?: number; at: Point }) => { plot: Group; axes: Axes; curve: FunctionGraph; W(x, y): Point }` | `plot = Group(axes, curve)`,移到 `at`;`samples` 缺省 200;`width` / `height` 是世界单位。**坐标轴初始藏着(opacity 0)、曲线初始收起**:用 `plotIntro`,或 `FadeIn(p.axes)` + `Create(p.curve)`。`W` 把数学坐标换成世界坐标,每次读 `plot.position`,不管缩放旋转。另加进 `p.plot` 的曲线要自己 `unrevealed`。 | 不占时间 |
| `plotIntro` | `(env: SegmentEnv, p: PlotEnv, options?: { axesRunTime?: number; curveRunTime?: number; holdSeconds?: number; with?: readonly Playable[] }) => Promise<void>` | 在同一个 `env.play` 里放 `FadeIn(axes, axesRunTime = 1)`、`Create(curve, curveRunTime = 2.5)` 和 `with` 里的动画;然后如果 `holdSeconds`(缺省 1)> 0,就 `wait(holdSeconds)`。 | `max(axesRunTime, curveRunTime, with 各自的 runTime) + holdSeconds`,缺省 **3.5 秒**。 |

**时间线**

| 导出 | 签名 | 行为与缺省 | 时长 |
|---|---|---|---|
| `fadeSequence` | `(env: SegmentEnv, items: readonly MObject[], o: { runTime: number; gap: number }) => Promise<void>` | 逐个 `FadeIn(runTime)`,每个之后停 `gap`,**最后一个之后也停**。条目要先 `hide`。 | `条目数 × (runTime + gap)` |
| `sweep` | `(env: SegmentEnv, o: { from: number; to: number; runTime: number; draw: (value: number) => void; rateFunc?: RateFunction }) => Promise<void>` | 先 `draw(from)`,再用每帧 updater 把值从 `from` 补间到 `to`(缓动缺省 `smooth`),finally 里注销,最后精确画一次 `draw(to)`。「匀速」传 `rateFunc: linear`(从 `'../engine'` import)。 | `runTime` |

**部件与排版**

| 导出 | 签名 | 行为与缺省 |
|---|---|---|
| `tangentProbe` | `(o: { W; f; fp; clamp: [n, n]; halfSpan: number; readoutOffset?: Point; format?: (a: number) => string }) => { dot: Dot; tangent: Line; readout: Label; parts: MObject[]; drawAt(a: number): void }` | 切点(`Dot(7)`)+ 切线 + 斜率读数(22 号 Label)。`readoutOffset` 缺省 `{ x: 0, y: -40 }`,`format` 缺省 `` a => `k = ${fp(a).toFixed(2)}` ``。切线半长 `halfSpan`(数学单位),两端 x 夹在 `clamp` 内(只限 x,陡时仍可能伸出框的上下)。**先 `drawAt(a0)` 再 `stage`**,否则三件套在原点。读数扫过的两端要用 `stage` 的 `fitExtra` 框进来,否则竖屏会出画,写法见 [5.2](#52-directedsegment-与-segmentenv) 的例子。配合 `sweep(env, { …, draw: probe.drawAt })`。 |
| `isNarrow` | `(scene: Scene) => boolean` | 视口 `w < h` 时为 true(0×0 时为 false)。只在搭景时判断一次,翻转屏幕会重建本段(见 [5.9](#59-预览跳转安全区竖屏重建背景网格与-settheme))。 |
| `sideColumn` | `(scene: Scene, count: number) => { colX: number; colYs: number[] }` | 公式列的坐标,行距 70。横屏 `colX = 250`,整列以 y = 0 为中心;竖屏 `colX = 0`,第一行 y = 60。配套的坐标系位置:`at: isNarrow(scene) ? { x: 0, y: -170 } : { x: -150, y: 0 }`。 |
| `columnList` | `(entries: readonly ListEntry[], options?: { gap?: number; padding?: number; align?: 'start' \| 'center' \| 'end'; minWidth?: number; context?: MeasureContext }) => Layout` | 纵向列表。缺省 `gap` 14、`padding` 12、`align` `'center'`、`minWidth` 0。返回时已排好,再 `col.moveTo(...)`。`context` 传 `scene.measureContext()` 才量得准。空列表也安全。 |
| `texLine` / `labelLine` | `(s: string, fontSize: number) => ListEntry` | 生成 `{ node: Tex 或 Label, fontSize }`,给 `columnList` 和 `listSegment` 用。 |

**列表与卡片(直接返回分段)**

| 导出 | 签名 | 行为与缺省 |
|---|---|---|
| `listSegment` | `(o: { name: string; duration: number; subtitles: Subtitle[]; entries: () => ListEntry[]; gap: number; holdSeconds: number }) => Segment` | 条目居中放在 (0, 0),取景留白 30,逐条 FadeIn(固定 **1 秒**)后停 `gap`,出完再停 `holdSeconds`。**时长不自动算**:手写 `duration = 条目数 × (1 + gap) + holdSeconds`(含标题行)。`entries` **必须是工厂函数**(模块作用域的对象会被多次播放共用)。没有 `id` / `marker` / `chapter` 选项,配音 id 就是 `name`。 |
| `chapterCard` | `(o: { name: string; title: string; heading: string; narration: string; holdSeconds?: number }) => Segment` | 等于 `cardSegment({ name, title, heading, narration, holdSeconds, marker: 'chapter', chapter: title })`,`holdSeconds` 缺省 6,所以**缺省 7 秒**。章名就是 `title`;要别的短名就用 `cardSegment`。 |

用法:卡片、章节卡、列表拼成整部片子见 [4.9](#49-三分钟章节短片);「左图右式」(`sideColumn`)见 [4.7](#47-对比与误区片);左对齐目录(`columnList` 传 `align: 'start'`,`hide` 各条目的 `.node` 而非容器,再 `fadeSequence`)见 [4.10](#410-十分钟完整一集)。

### 5.5 timedSegment(按台词对齐)

要配音的分段用它:声明台词,脚本踩提示点。**不写 `duration`、不写字幕时间**,由配音时间表定,没有时间表时由干跑草稿定。配音流程见 [§10](#10-配音)。

```ts
timedSegment(options: TimedSegmentOptions, direct: (env: TimedEnv) => Promise<void>): TimedSegment
```

| 选项 | 缺省 | 说明 |
|---|---|---|
| `id` | 必填 | 稳定的配音 id,配音方按它交音频;改 `name` 不影响配音。 |
| `name` | 必填 | 显示名。 |
| `lines` | 必填 | `{ id: string; text: string }[]`,每句一个稳定 id;`text` 里用 `<mark name="k"/>` 标出要对齐的词。 |
| `marker` / `chapter` | 可省 | 同 [5.1](#51-分段的契约)。 |
| `draftRate` | 4.5 | 草稿语速(字/秒)。英文按字母计数,英文台词设 12–15。 |

字幕每句一条(去掉标记,带台词 id,按开口时间排序)。标记写成 `<mark name="k"/>`、`<mark name='k'>`、`<mark name="k" />` 都行;名字必须带引号,否则不识别且留在字幕里。

**`TimedEnv`** = `SegmentEnv` 全部成员,外加:

| 成员 | 说明 |
|---|---|
| `untilLine(id)` | 等到这句开口;已开口过的立即返回。 |
| `untilMark(lineId, mark)` | 等到标记的那个词。 |
| `now()` | 本段已播秒数,即 `scene.getElapsed()`。 |
| `line(id)` | `{ start, end, duration }`;草稿模式下没排到的句子给预估值。 |
| `remaining(id)` | `max(0, 这句结束时刻 − now)`,常用来当 runTime。 |

**构造时校验**:id 非空;台词 id 非空且不重复;去掉标记后台词不空;同句标记不重名;`draftRate` 是正的有限数。不满足时**模块 import 就抛错**,整部片子加载失败(「场景加载失败:…」)。
**运行时报错**(`done` reject,本段被跳过):`untilLine` / `untilMark` / `line` / `remaining` 用了没声明的台词 id(`timedSegment「name」没有声明台词「id」`),或者标记名不存在。

**时长怎么定。** 影片加载时,`filmEntry` 调用 `prepareVoice`:

- 有时间表(`public/voice/<voiceId>/timing.json`)且本段每句都有时间:按表,`duration` 取表里的值。
- 否则在 1280×720、30 fps 虚拟时钟上干跑脚本排草稿,再用 `withTiming` 换成时长固定的普通分段。草稿规则(首句 0.3 秒开口、句间停 0.25 秒、段尾留 0.6 秒):
  - 每句时长 `estimateSpeech(text, draftRate)` = `max(0.8, 字数 / draftRate + 停顿)`:不计空白,`,，、;；:：` 各加 0.15 秒,`。.!！?？…` 各加 0.3 秒(数字里的 `.` 也算),其余每个字符算 1 字。
  - 按声明顺序排,开口时刻 = max(脚本走到提示点的时刻, 上一句结束 + 0.25);脚本没等的句子接在上一句后。
  - 标记落在 `开口 + estimateSpeech(标记前文字, draftRate, 0)`,不超过句尾;脚本迟到且这句是最后排下的一句时,它和其后的标记连同句尾一起后挪。
  - `direct` 返回后未说的句子依次排完,本段停到 `max(now, 最后一句结束 + 0.6)`;按时间表播时停到 `max(now, 表里的 duration)`,脚本比表长会超出声明时长,`voice:check` 会报。

**脚本写法**(`remaining` 兜底、踩标记、不写「句尾减常数」)见 [10.2](#102-作者这一侧两种分段怎么配音)。**收尾停留要自己写**:草稿末句后只留 0.6 秒,有时间表时在表里的 `duration` 处结束,所以 `direct` 末尾加 `await env.wait(3)`(3–6 秒);照抄 `src/film/voiceDemo.ts` 会每段戛然而止。

**测试。** 没经过 `prepareVoice` 的 timedSegment,`duration` 只是按字数排的估计(没算等提示点),实际常超出 ±0.25 秒(演示片「割线逼近切线」声明 14.53、实际 14.78 秒),还会 `console.warn`「没有经过 prepareVoice」。所以含它的片子**不要加进 `content.test.ts`**,照 `src/film/voiceDemo.test.ts` 单独写测试,先 `prepareVoice` 再逐段干跑。把 `myFilm` 换成你的片子,存成 `src/film/<名字>.test.ts`(`src/` 下的 `.test.ts` 自动发现):

```ts
import { createStubCanvas, installDomStub } from '../testing/domStub';
import { equal, ok, suite } from '../testing/harness';
import { messageChannelYielder } from '../export/offlineEnv';
import { prepareVoice, runSegmentToEnd } from './film';
import type { DryRunEnv, VoiceProblem } from './film';
import { myFilm } from './myFilm';

const dryRun: DryRunEnv = { createCanvas: () => createStubCanvas(), createYielder: messageChannelYielder };

export default suite('我的配音片', [
  [
    'prepareVoice 之后逐段审:跑得完、不出错、时长对得上、字幕合法',
    async () => {
      const dom = installDomStub();
      try {
        const problems: VoiceProblem[] = [];
        const { segments } = await prepareVoice(myFilm, { dryRun, onProblem: (p) => problems.push(p) });
        equal(problems.length, 0, problems.map((p) => p.message).join('\n'));
        for (const s of segments) {
          const run = await runSegmentToEnd(s, dryRun);
          ok(run.error === null, `「${s.name}」运行出错:${String(run.error)}`);
          ok(run.settled, `「${s.name}」没有跑完`);
          ok(Math.abs(run.elapsed - s.duration) <= 0.25, `「${s.name}」声明 ${s.duration} 秒,实际 ${run.elapsed} 秒`);
          let prevEnd = 0;
          for (const sub of s.subtitles ?? []) {
            ok(sub.start >= prevEnd - 1e-9 && sub.end > sub.start, `「${s.name}」字幕乱序或重叠:${sub.text}`);
            ok(sub.end <= s.duration + 0.05, `「${s.name}」字幕超出分段:${sub.text}`);
            prevEnd = sub.end;
          }
        }
      } finally {
        dom.restore();
      }
    },
  ],
]);
```

只跑它:`node scripts/test.mjs <名字>`(按路径子串匹配)。它审草稿;有了真实时间表再跑 `npm run voice:check -- <voiceId>`。

完整的配音分段示例见 [10.2](#102-作者这一侧两种分段怎么配音) 的 `appxVoice.ts` 和 [4.11 配音驱动短片](#411-配音驱动短片)。

### 5.6 影片选项与控制器

`runFilm(canvas, segments, options?) → FilmController`。页面的 `filmEntry` 只传 `onPausedChange`,**注册的片子没法自选转场、字幕样式或循环**;下列选项用于自己调 `runFilm`(自建宿主、测试)或改 `filmEntry`。

**`FilmOptions`**

| 选项 | 缺省 | 说明 |
|---|---|---|
| `transition` | 0.6 | 转场单边秒数(淡出旧段 → 切段 → 淡入新段),负数按 0。 |
| `transitionColor` | `'#f8f7f4'` | 白场颜色,等于 `lightTheme.background`。 |
| `loop` | `true` | 整片循环播放。 |
| `onSegment(index, segment)` | — | 每段开始前调用,抛错只记日志。 |
| `subtitles` | `true` | 是否显示字幕。`false` 时字幕安全区也一并取消。 |
| `subtitleStyle` | 见下 | 字幕样式。 |
| `progress` | `true` | 底部进度条(片长为 0 时也关闭)。导出的成片带同一套进度条。 |
| `progressStyle` | 见下 | 进度条样式。 |
| `onPausedChange(paused)` | — | 让宿主按钮与暂停状态同步(进度条上按空格或 K 也会暂停)。 |
| `onEnded()` | — | 只在 `loop: false` 时,整片播完后调用。 |
| `onError(error, { segment, phase })` | 写 `console.error('[film] 分段「…」启动失败 / 播放出错')` | `phase` 是 `'start'` 或 `'play'`。不管有没有这个回调,出错的分段总会被跳过。 |
| `clock` | 浏览器的 rAF 时钟 | 通过 `SegmentContext` 交给分段。 |
| `exportEnv` / `offlineEnv` | 浏览器实现 | 测试或非浏览器宿主注入导出能力用。 |
| `audio` | 浏览器实现 | `{ env?: LiveAudioEnv }`:配音播放环境,测试注入用。 |

**`SubtitleStyle`** 缺省:`fontSize` = 画布宽 × 0.016,取整后夹在 14–20 px;`fontFamily` 继承页面字体;`color` `'#fff'`;`background` `'rgba(0,0,0,0.65)'`;`bottom` = max(画布宽 × 0.028 夹在 24–36 px, 进度条占块 + 10),进度条占块有章名时 38 px、没有时 18 px,贴顶时不占。不可改:左右内边距 16、上下内边距 6、圆角 8、行高 1.35、最大宽度为画面的 80%。
**`ProgressStyle`** 缺省:`height` 3,`color` `'#1a1a1a'`,`background` `'rgba(0,0,0,0.12)'`,`position` `'bottom'`(设成 `'top'` 时字幕不再为进度条让位)。

**`FilmController`**

| 成员 | 说明 |
|---|---|
| `controller()` / `dispose()` | 停止播放并释放全部资源(DOM 覆盖层、监听、当前分段、进行中的导出)。 |
| `seekTo(index)` | 跳到第 index 段(从 0 数)。取整后夹在有效范围内;非有限值忽略;实时录制期间忽略。 |
| `seekToTime(seconds)` | 跳到全片第 seconds 秒,精确到段内:重挂目标段,在虚拟时钟上快进到偏移处再续播(同段往前跳不重挂)。越界夹紧,非有限值忽略,实时录制期间忽略。 |
| `setPaused(paused)` | 暂停 / 恢复。实时录制期间的暂停请求被忽略。 |
| `exportVideo(options?)` | 返回 `{ done: Promise<Blob>, mimeType, mode, audio, cancel() }`。选项:`mode`(`'auto'` / `'offline'` / `'realtime'`,缺省 `'auto'`)、`fps`(30)、`maxLongEdge`(1920)、`mimeType`、`onProgress(filmSec, totalSec)`、`audio`(`true`)、`progress`(`true`)。同一时间只能有一个导出。详见 [§11](#11-导出视频)。 |
| `getState()` | `{ mode: 'playing' \| 'paused' \| 'exporting' \| 'ended' \| 'disposed', index, segment, segmentElapsed, position, total, paused, exporting, audio: { available, enabled } }`。 |
| `setAudioEnabled(enabled)` | 开关声音。第一次开必须在点击回调里同步调用;没有音频时不做事;实时录制期间不能关。 |

`runFilm(canvas, [])` 返回一个什么都不做的控制器,它的 `exportVideo` 以 `'no-segments'` 失败。

**时间线工具**(都从 `'./film'` import)

| 函数 | 说明 |
|---|---|
| `filmDuration(segments)` | `Σduration`。 |
| `segmentAtTime(segments, starts, total, seconds)` | 返回 `{ index, offset }`,越界夹紧。`starts` 是各段起点的前缀和,`./film` 没有导出现成的,要自己算:`const starts = segments.map((_, i) => filmDuration(segments.slice(0, i)))`。 |
| `segmentIndexAt(segments, frac)` | 进度比例(0–1)对应的段序号。 |
| `segmentTicks(segments)` | 每段起点在全片中的比例。 |
| `subtitleAt(subtitles, elapsed)` | 这一时刻的字幕文字,没有时返回空串。 |
| `previewFrameAt(segments, seconds, canvas, options?)` | 把全片第 seconds 秒画到 canvas 上,返回 `{ index, offset, name, subtitle, position }`。空清单时抛出 `FilmError('no-segments')`。 |

### 5.7 注册新片

逐步做法和漏改的后果见 [2.3 接进页面和工具](#23-接进页面和工具)。清单:

| # | 文件 | 改什么 |
|---|---|---|
| 1 | `src/film/<名字>.ts` | `export const <名字>Film: Segment[] = [ … ];` |
| 2 | `src/sceneRegistry.ts` | `SCENES` 加 `<key>: filmEntry('<标题>', '<voiceId>', async () => (await import('./film/<名字>')).<名字>Film),`(`<key>` 即 `?scene=` 的值;时间表在 `public/voice/<voiceId>/timing.json`)。 |
| 3 | `src/film/catalog.ts` | `FILM_CATALOG` 加 `'<voiceId>': async () => (await import('./<名字>')).<名字>Film`(配音命令靠它找片子)。voiceId、catalog 键、配音目录名用同一个字符串。 |
| 4 | `src/film/voiceDemo.test.ts` | 按 `FILM_CATALOG` 书写顺序写死的断言改成 `equal(filmNames().join(','), 'film,derivatives,topology,voice-demo,<voiceId>')`(新条目加在末尾)。 |
| 5 | `src/film/content.test.ts` | 不加就不审:顶部 `import { <名字>Film } from './<名字>';`,`suite('内容时序', [...])` 里加 `...<名字>Film.map((s) => audit('<片名>', s)),`。含 timedSegment 的不加,按 [5.5](#55-timedsegment按台词对齐) 单独测。 |
| 6 | `src/sceneRegistry.test.ts` | 可选:给新片加 `preview` 检查。 |

然后跑 `node scripts/test.mjs content`(配音片跑 `node scripts/test.mjs <名字>`)和 `npm run check`,再 `npm run dev` 打开 `/?scene=<key>`、`/?scene=<key>&preview=<秒>` 看。

### 5.8 内容测试查什么

`node scripts/test.mjs content` 把清单里每个分段用 `segment.play(canvas, {})` 在 **1280×720 横屏**测试桩上干跑到底(每步 1/60 秒,无安全区),检查:

- 分段在 `duration + 5` 秒内结束。
- 没有报错:任何 `console.error` 或 `done` reject 都算失败(`console.warn` 不算)。
- `|实际时间线 − duration| ≤ 0.25` 秒。
- 字幕:`start ≥ 0` 且 `end > start`;按时间排序、不重叠(首尾相接可以);`end ≤ min(duration, 实际时间线) + 0.05`。

**不查**:竖屏分支(含其时间线)、TeX 写错(画成红字,不抛错不打日志;未定义的命令连 `tex.error` 都是 null)、画面重叠、先藏后揭漏写、字幕长度和语速、数学对错。这些要在 `?preview=` 里逐段看。失败输出和修法见 [2.5](#25-跑检查)、[12.1](#121-内容测试-node-scriptstestmjs-content)。

### 5.9 预览、跳转、安全区、竖屏重建、背景网格与 setTheme

**单帧预览** `/?scene=<key>&preview=<秒>`:只接受非负有限数,超过片尾停在最后一帧。**只画主画面**(无字幕条、进度条),页面显示「静态预览 Ns · 改 ?preview= 切帧」,窗口尺寸变化约 120 ms 后重画。它只挂目标段,按 1/30 秒一步(不绘制)快进到段内偏移再画,步进同离线导出,所以主画面和成片逐像素一致。程序里用 `previewFrameAt`(见 [5.6](#56-影片选项与控制器))。

**段内跳转**:点进度条跳到对应秒(`seekToTime`)。进度条有焦点时:←/↓、→/↑ 按段跳,PageUp / PageDown 按章跳(落在 `marker: 'chapter'` 的段),Home / End 首段 / 末段,空格或 K 暂停。

**进度条上的章节**:写了 `chapter` 就显示章名并自动编号成 `一 · 章名`(前九章中文数字,之后阿拉伯数字),章名别再写「第一章」。**每个写了 `chapter` 的分段都占一个编号**,只在每章第一段(通常是章节卡)写。大刻度和 PageUp / PageDown 看的是独立的 `marker === 'chapter'`;`chapterCard` 两个都设好。

**字幕安全区**:只有带字幕(且开着字幕)的分段才拿到 `safeArea.bottom`,`fitObjects` / `stage` 自动把内容框在字幕条上方。高度 = 字幕底距 + 字号 × 1.35 + 12 + 12,按一行估:1280 宽有章名约 99 css 像素、无章名约 87;9:16(约 594 宽)有章名约 91。字幕两行会压到画面。**不带字幕的分段没有安全区**,底部进度条(18 px,有章名 38 px)可能盖住内容。

**竖屏重建**:`isNarrow(scene)` 只在搭景时判断一次。横竖屏翻转时,当前段若正在淡入或播放(且没有实时录制),**从 t = 0 重建**;正在淡出的段不重建,下一段按新方向建;实时录制结束后补重建。方向不变的尺寸变化(16:9 换 4:3)只重新取景。页面画幅:全屏 / 16:9 / 4:3 / 9:16。

**背景网格与 `setTheme`**:分段固定用 `lightTheme`:背景 `#f8f7f4`,**40 单位的淡网格 + 穿过原点的 x = 0 / y = 0 两条线**(`rgba(0,0,0,0.3)`);描边 `#1f2937`、线宽 3、默认不填充;字体 `Georgia, "Times New Roman", serif`,字号 28。在 `directedSegment` / `timedSegment` 里关掉:

```ts
env.scene.setTheme({ ...lightTheme, showGrid: false, showAxes: false }); // lightTheme 从 '../engine' import
```

`setTheme` 只对当前段生效;`cardSegment`、`listSegment`、`chapterCard` 拿不到 scene、关不掉。同一部片子背景要一致,二选一:

- **全片保留网格**(缺省,现有影片都是):什么都不写。
- **全片关掉**:每个 `directedSegment` / `timedSegment` 开头都调上面那句,卡片和列表也改用 `directedSegment` 自己搭(标题 `FadeIn`、横线 `Create`、第二行 `FadeIn`,各 1 秒,再停留)。

世界坐标 y 向下;现有影片内容大致在 x ±350、y ±300 内,由 `fitObjects` / `stage`(留白 20–40)缩放到画面。

## 6. 图元

画面上的一切都是图元(`MObject`),全部从 `'../engine'` 导入,类型(`Point`、`Box`、`Theme`、`MeasureContext`、`TexOptions`……)用 `import type`。
写片子更常用 `./helpers` 的捷径(`tex`、`label`、`hide`、`unrevealed`、`stage`、`makePlot`……,见 [5.4](#54-助手helpers))。动画见 [7](#7-动画),取景见 [8](#8-场景相机与取景),3D 见 [9](#9-3d)。

完整示例 `objTrig.ts`(6.6)、`objTex.ts`(6.7)各导出一个分段;想看就在 `src/sceneRegistry.ts` 的 `SCENES` 末尾加一行,开 `/?scene=obj`(正式登记见 [2.3](#23-接进页面和工具)):

```ts
  obj: filmEntry('图元示例', 'obj', async () => [(await import('./film/objTrig')).objTrigSegment]),
```

### 6.1 坐标、单位与字号

| 在哪里 | 方向 |
| --- | --- |
| 世界坐标(`moveTo`、`shift`、`Line` 端点、`Polygon` 顶点……) | x 向右、**y 向下**;角度用弧度,**增大 = 顺时针** |
| 坐标系内部(`Axes.toLocal(x, y)`、`NumberPlane.c2p(x, y)` 的输入) | 数学坐标,**y 向上**;输出的本地坐标仍是 y 向下 |
| 3D 网格 | x 右、y 下、z 朝向观众(见 [9](#9-3d)) |

- 「往上」是 −y:`m.shift(0, -20)` 上移 20;`m.rotation = Math.PI / 6` 是**顺时针** 30°。
- `new Arc(50, 0, Math.PI / 2)` 从 3 点钟顺时针扫到 6 点钟;数学里「从 0 逆时针到 θ」的弧写 `new Arc(r, -θ, 0)`(`Create` 从 θ 那端画起)。
- 自己算点时 y 取负:`{ x: cx + r * Math.cos(t), y: cy - r * Math.sin(t) }`。坐标系里的点一律用 `axes.toLocal(x, y)`。
- 1 世界单位 = zoom 为 1 时的 1 CSS 像素(zoom 限制在 [0.1, 10])。每段搭建时 `stage` 把布景框满画面,所以**只有比例有意义**;`strokeWidth`、`dash`、`fontSize`
  都是世界单位,跟着 zoom 和 `scale` 缩放。zoom 实测、按角色的字号与位置见 [3.7 版面](#37-版面)。
- 几段字号想一致:`stage` 第 4 个参数(只参与取景)放一个**摆在内容中心**的隐形框 `new Rectangle(640, 400).moveTo(内容中心)`(留在原点会把画面框偏、框小)。

**引擎自带的尺寸缺省**(世界单位)

| 在哪里 | 值 |
| --- | --- |
| 主题字号(`Label`、`Tex` 没设时)/ 主题线宽 | 28 / 3 |
| `NumberLine` 数字 / `NumberPlane` 数字 / `Brace` 说明 / `Angle` 说明 | 18 / 14 / 24 / 22(选项 `fontSize` 可改) |
| `BarChart` 类别 / 数值标签 | 16 / 14(选项可改) |
| `Axes` 刻度数字 / 轴名 | **10 / 13(斜体),固定,不能改** |
| `Annotation` 徽标里的字 | = `badgeRadius`(缺省 11) |
| 线宽:`Axes` 的轴 / `NumberLine`、`NumberPlane` 的轴 / 网格线 / `VectorField` 箭头 | max(1, strokeWidth − 1)(主题下 2)/ 2 / 1 / 1.5 |

影片背景的淡网格和**过世界原点**的十字,与放在 `{ x: 0, y: -30 }` 的坐标系不重合;怎么关见 [5.9](#59-预览跳转安全区竖屏重建背景网格与-settheme)。

### 6.2 通用操作

```ts
m.moveTo({ x: 100, y: 0 });   // 位置(父坐标系),返回 this 可链式;shift(dx, dy) 相对移动
m.scale = 1.5;                // 统一缩放(没有 scaleX / scaleY),绕 position;绝对值,负数等于转 180°
m.rotation = Math.PI / 6;     // 顺时针 30°,绕 position;绝对值
m.opacity = 0.5;              // 唯一的透明度通道(setStyle 里没有);组的 opacity 乘到整棵子树
m.setStyle({ stroke: '#2563eb', strokeWidth: 4, dash: [6, 5] }); // 键见 6.10;值为 undefined 的键被忽略
m.getBox(ctx?);               // { size: { w, h }, center }:本地、未乘 scale;文字类传 scene.measureContext() 才按容器字号量
m.setRevealFraction(0);       // 描边生长比例,null = 完整,0 = Create 之前的收起状态
```

另有 `position`(可直接赋值)、`getChildren()`。变换顺序「缩放 → 旋转 → 平移」,都绕 `position`(`Group` 是组的原点,见 6.9);渐变用 `MoveTo` / `ScaleTo` / `RotateTo`。
入场前怎么藏见 [3.4 先藏后揭](#34-先藏后揭)。

**能 `Create` 的**:所有矢量图形(`Circle` … `SvgPath`、`FunctionGraph`、`ParametricCurve2D`、`Trace`、`AreaUnderCurve`、`TangentLine`、`SecantLine`、`AngleArc`、`RightAngle`、`BraceShape`)、
`Label`(逐字出现)、`Tex`(逐字形描轮廓再填充)、`Axes`、`VectorField`,以及子元素全能 `Create` 的组(`NumberLine`、`NumberPlane`、`Brace`、`Angle`、`RiemannRectangles`、`BarChart`、有内容的 `Layout`)。
**不能**(报「Create 需要支持描边生长的对象……」,改用 `FadeIn`):`Annotation`、3D 网格、空 `Group` / `Layout`、少于 2 点的 `Polygon`,及含有它们的组。

- **没有 z-index**:后加的压在上面;提到最上层:`scene.remove(m)` 再 `scene.add(m)`。
- **别加两次**:已在组里的对象再 `scene.add` 会画两遍(常见:`stage(scene, [plot, curve], …)` 而 `curve` 已在 `plot` 里)。
- **没有 `copy()`**:写工厂函数建两次;图元可变,在 `direct` 里新建,别放模块顶层共用。
- 世界包围盒:`worldBoundsOf(对象[], ctx?)` / `worldBoundsInScene(根[], 对象[], ctx?)`,返回 `{ minX, minY, maxX, maxY } | null`;盒子工具 `boxFromSize(w, h)`、`boxFromPoints`、`expandBox(box, pad)`。
- 以 `position` 为中心:圆、矩形、`Dot`、`Arc`、`Sector`、正多边形、`Star`、`Label`、`Tex`、`Layout`、坐标框;`Line`、`Arrow`、`Polygon`、`SvgPath` 的点是本地坐标,`position` 是整体偏移。

### 6.3 基础图形

全部是矢量路径(`PathShape`),支持 `Create`、`Transform`、`Write`;几何参数是普通字段,改了下一帧生效(配合 updater 或 `sweep` 做连续变化)。

| 图元 | 构造(缺省值) | 可写字段 / 备注 | `Create` 怎么长 |
| --- | --- | --- | --- |
| `Circle` | `new Circle(radius = 50)` | `radius` | 从 12 点钟顺时针 |
| `Ellipse` | `new Ellipse(radiusX = 60, radiusY = 40)` | `radiusX`、`radiusY` | 同上 |
| `Rectangle` / `Square` | `new Rectangle(width = 120, height = 80)` / `new Square(size = 90)` | `width`、`height`;没有圆角 | 从左上角顺时针 |
| `Line` | `new Line(start, end)` | `start`、`end` | 从 start 到 end |
| `Arrow` | `new Arrow(start, end)` | `start`、`end`、`headLength = 14`、`headWidth = 10`(字段,不是构造参数) | 箭头跟着笔尖走 |
| `Dot` | `new Dot(radius = 6)` | `radius`;实心,没设 `fill` 用描边色 | 从圆心长大 |
| `Arc` | `new Arc(radius = 45, startAngle = 0, endAngle = 1.5π)` 或选项对象 | 三个参数;不填充 | 从 startAngle 顺时针 |
| `Sector` | `new Sector(radius = 50, startAngle = 0, endAngle = π/2)` 或选项对象 | 三个参数 | 连填充一起扫开 |
| `Polygon` | `new Polygon(points, { closed = true })` | `setPoints(点[])`;`closed: false` 是折线 | 沿周长,**画完一圈才填** |
| `RegularPolygon` | `new RegularPolygon(sides, radius = 50)` | 只读(改大小用 `scale`);`sides` ≥ 3 的整数 | 首顶点在正上方 |
| `Triangle` / `Star` | `new Triangle(radius = 55)` / `new Star(points = 5, outerRadius = 50, innerRadius = 22)` | 只读 | 尖朝上 |
| `SvgPath` | `new SvgPath(d: string \| PathData)` | `setPath(d)`;按 SVG 规矩填充 | 沿路径 |

- `endAngle < startAngle` 时按 2π 取模(`new Arc(r, 0, -Math.PI / 2)` 扫 3/4 圈)。
- 带填充的圆、矩形 `Create` 时边画边填;要「先描边、后上色」就 `Create` 之后 `ColorTo(m, { fill: … })`。虚线用 `setStyle({ dash: [6, 5] })`(`Line.dash` 已弃用)。
- 没有双向箭头、弧形箭头、圆角矩形:两支背对背的 `Arrow`;`Arc` + 末端切线上一支短 `Arrow`;`SvgPath` / `PathBuilder` 自己画(6.8)。

### 6.4 文字

`new Label(text)`:画布文字,`getText()` / `setText(t)`(逐帧改也便宜),走 `fontSize` / `textColor` / `fontFamily`。

- 以 `position` 为中心,**只有一行**:`\n` 画成空格;多行叠几个 `Label` 或用 `columnList`。盒高 = 字号,盒宽按字体量(node 里每字按 0.6 em 估)。
- **没有粗体、斜体**(`fontFamily` 塞 `bold` 无效):用 `Tex` 的 `\textbf{…}` / `\textit{…}`(中文也行),别套进 `\text{}`(`\text{\textbf{速度}}` 会原样画出命令)。
- 没有左对齐:`x = 左边界 + label.getBox().size.w / 2`(字号设在 `Label` 自己身上才准)。
- `Create` = 逐字出现;`Write` = 原地淡入;`FadeTransform(label, '新文字')` = 旧的上浮淡出、新的自下浮现。
- 中文标题、旁注、逐帧读数(`setText(v.toFixed(2))`,宽度不抖)用 `Label`;公式、变量名、要做 `TransformMatchingTex` 的用 `Tex`。

### 6.5 公式 Tex

```ts
new Tex(source: string, options?: { displayMode?: boolean })   // displayMode 缺省 false(行内)
const big = tex('\\sum_{k=1}^{n} k', 34, { x: 0, y: 0 }, { displayMode: true }); // 捷径:源码、字号、位置、TexOptions
```

MathJax 3 排成矢量字形(node 与浏览器一致)。宏包:`base`、`ams`、`newcommand`、`noundefined`、`boldsymbol`、`color`、`cancel`、`html`。

- **字号设在 Tex 自己身上**(`setStyle({ fontSize })` 或 `tex(源码, 字号)`)。`getBox()`、`getPartBox()`、`Brace.for()` 不带测量上下文时只认自己设过的字号,否则按 28 量 ——
  组设 56 号、公式没设时,`Brace.for` 只量到实际宽度的一半。`fontFamily` 对公式无效。
- `getBox()` 立刻是真实尺寸;单行公式按中心排成一行即基线对齐。
- **上色**:整条用 `textColor` 或 `ColorTo(tex, '#2563eb')`(`stroke` / `fill` 无效);局部写在源码里:`\textcolor{#2563eb}{a^2}`、`{\color{#16a34a} b}`、`\style{color:#16a34a}{x}`、
  `\colorbox{#fde68a}{x}`。**一律写 `#rrggbb`**(颜色名在 node 里无法插值)。显式上色的部分不跟 `textColor` / `ColorTo` 走,`Indicate` 整条时也保持原色。
- **命名部分** `\class{名字}{…}`(或 `\cssId`):`law.partNames`(按阅读顺序)、`law.getPartBox('rhs')`(本地盒,没有返回 `null`)、`new Indicate(law, { part: 'rhs' })`
  (写错名字会报错并列出现有部分)、`TransformMatchingTex` 按同名部分对应(7.5)。名字以 `mjx-` 开头的被忽略;可以嵌套。

| 能用 | 不能用 → 替代 |
| --- | --- |
| `\frac` `\dfrac` `\sqrt` `\sum` `\int` `\lim_{h\to 0}` `\vec` `\overrightarrow` `\xrightarrow{f}` `\overset` | `\textcolor[HTML]{2563EB}{x}` → 报错;写 `\textcolor{#2563eb}{x}` |
| `\underbrace{…}_{…}` `\overbrace` `\boxed`(只描边框) `\cancel` | `\bm{v}` → 红字;用 `\boldsymbol{v}` |
| `\mathbb` `\mathcal` `\mathrm` `\boldsymbol` `\operatorname` `\text` `\textbf` `\textit` | `\bbox`、`\SI` 等没加载的宏包 → 红字 |
| `pmatrix` `aligned` `gathered` `array` `cases` `align` 环境 | 环境外的 `a \\ b`、`\newline` → **不换行** |
| `\newcommand` `\quad` `\phantom` `^\circ` `\fcolorbox` | `\tag{1}`、`\label` → 被丢掉,编号用 `Label` 画;`\href` 只显示内容 |

- **换行**用环境:`\begin{gathered} a+b \\ c+d \end{gathered}`(居中)、`\begin{aligned} a &= b \\ &= c \end{aligned}`(按 `&` 对齐);或拆成几个 `Tex`。
- **中文**放进 `\text{…}`(`\text{速度} = \frac{\text{路程}}{\text{时间}}`),用画布文字画(通用 `serif`,每字按 1 em 估宽);`Transform` 时交叉淡化,`TransformMatchingTex` 按文字配对。
- **写错了不抛错,内容测试也不失败**:语法错误(`\frac{a}`)整条红字,`tex.error` 是说明;未定义命令(`\bm`)只把命令画红,**`tex.error` 仍是 `null`**。
  写完用 `?preview=秒数` 看一眼;搭建时 `if (law.error) throw new Error(law.error);` 能让测试抓到语法错误。
- **逐帧变化的数字别用 Tex**:每个新串都重排版,1 秒内换源超过 20 次会告警。
- 成员:`tex`(只读)、`setTex(s)`、`displayMode`、`error`、`partNames`、`getPartBox(名字, ctx?)`;底层 `typesetTex(source, displayMode = false)`。

### 6.6 坐标系与函数图像

`Axes`、`NumberPlane` 都是坐标系(`{ xRange, yRange, width, height, toLocal(x, y) }`)。函数图像、面积、黎曼矩形、切线、割线、向量场都接受任一个,取样得到**坐标系的本地坐标**,
所以要和坐标系放进同一个组(加入顺序 = 绘制顺序:`new Group().add(axes, area, curve, tangent)`,面积垫在曲线下)。

**Axes**:`new Axes(xRange: [min, max], yRange: [min, max], width, height, labels?: { x?: string; y?: string })`,`labels` 缺省 `{ x: 'x', y: 'y' }`,`''` 隐藏轴名。

- 整体对象(不是组);原点不在范围内时轴贴到离 0 近的边。包围盒含刻度数字和轴名,居中用 `centerAt`(6.9)。
- 只有 `toLocal(x, y)`,**没有 `c2p` / `plot` / `getGraph`**。换到组外:组没缩放、没旋转时 `{ x: plot.position.x + p.x, y: plot.position.y + p.y }`(= `makePlot` 的 `W`);
  否则用 `objTrig.ts` 的 `toParent(组, 本地点)`。它只算调用那一刻;要一直跟着,就 `plot.add(dot)` 按本地坐标摆。
- **刻度全自动,不能改**:x 步长取「跨度 / 6」、y 取「跨度 / 5」,再取整到 1 / 2 / 5 × 10ᵏ;刻度 10 号、轴名 13 号斜体,字号固定(竖屏看不清时缩小坐标框)。
  字色走 `textColor`,轴线走 `stroke`。`Create`:轴按长度画出,数字、轴名后半程淡入。

  | 跨度 | 2 | 3 | 4 | 5 | 6 | 8 | 9 | 10 | 12 |
  | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
  | x 轴每格 | 0.2 | 0.5 | 0.5 | 1 | 1 | 1 | 2 | 2 | 2 |
  | y 轴每格 | 0.5 | 0.5 | 1 | 1 | 1 | 2 | 2 | 2 | 2 |

- 要自定步长或 Tex 数字:用 `NumberPlane`(`minorDivisions: 1, numbers: true`,再 `plane.majorGrid.opacity = 0`)。它**没有 `format`**(步长 `Math.PI / 2` 标成 1.570796):
  标 π 就用 `axes: false` 的网格 + 两条带 `format` 的 `NumberLine`,见 `objTrig.ts`。

```ts
new NumberLine([min, max, step = 1], {
  length = 400, vertical = false, ticks = true, tickSize = 10,
  numbers = true /* | false | 要标的数值[] */, exclude = [], format /* 缺省舍到 6 位小数 */,
  labelKind = 'tex' /* | 'label' */, fontSize = 18, numberGap = 6, tips = 'none' /* | 'end' | 'both' */,
})
new NumberPlane(xRange: [min, max, step?], yRange: [min, max, step?], width, height, {
  minorDivisions = 2 /* 1 = 不画次网格 */, axes = true, numbers = false, labelKind = 'tex', fontSize = 14, tips = 'none',
  gridColor = 'rgba(59, 130, 246, 0.38)', minorGridColor = 'rgba(59, 130, 246, 0.14)',
})
```

- `NumberLine` 是组(`line`、`tickMarks`、`numberLabels`;`min`、`max`、`step`、`tickValues`),以中点为原点:`n2p(数值)` → 本地点(区间外外推),`p2n(点)` → 数值。
  竖直的朝上增大。点 `numberLine.add(...)` 就跟着走。数字字号只能用选项改。`numbers: [-1, 1]` 只标这几个,`exclude: [0]` 去掉这几个。
- `NumberPlane` 是组(`minorGrid`、`majorGrid`、`xAxis` / `yAxis`)。`c2p(x, y)` = `toLocal`,`p2c(点)` 反算。整个网格 `setStyle({ stroke })` 会盖掉网格线颜色,只改轴用 `plane.xAxis?.setStyle(...)`。
- 两者 `Create` 时所有部分同时开始。`plane.add(curve)` 的曲线会跟着 `Create(plane)` 一起长;要单独出场就 `new Group().add(plane, curve)`。

```ts
// src/film/objTrig.ts
import { Create, Dot, FadeIn, FunctionGraph, Group, NumberLine, NumberPlane, sinFn } from '../engine';
import type { MObject, Point } from '../engine';
import type { Segment } from './film';
import { directedSegment } from './film';
import { hide, stage, tex, unrevealed } from './helpers';

/** 刻度值(π/2 的整数倍)→ Tex 源码。 */
const HALF_PI = ['0', '\\frac{\\pi}{2}', '\\pi', '\\frac{3\\pi}{2}', '2\\pi'];
export const halfPiTex = (v: number): string => HALF_PI[Math.round(v / (Math.PI / 2))] ?? '';

/** 组 g 里的本地点 → g 的父坐标(含 g 的位置、缩放、旋转)。 */
export function toParent(g: MObject, p: Point): Point {
  const c = Math.cos(g.rotation);
  const s = Math.sin(g.rotation);
  const k = g.scale;
  return { x: g.position.x + k * (p.x * c - p.y * s), y: g.position.y + k * (p.x * s + p.y * c) };
}

export const objTrigSegment: Segment = directedSegment(
  'π 刻度的正弦图像',
  // 1.5 网格与坐标轴 + 0.5 + 2.5 曲线 + 1 + 1 最高点 + 4 停留 = 10.5
  10.5,
  [
    { start: 0.2, end: 2.2, text: '横轴每格 π/2' },
    { start: 2.6, end: 6, text: 'sin x 的一个周期是 2π' },
    { start: 6.4, end: 10.4, text: '在 π/2 处取到最大值 1' },
  ],
  async (env) => {
    const [w, h] = [480, 300];
    const plane = new NumberPlane([0, 2 * Math.PI, Math.PI / 2], [-1.5, 1.5, 0.5], w, h, { minorDivisions: 1, axes: false });
    // 区间、长度与网格一致:数轴中点 = 网格中心,挪到原点所在的线上即可。
    const origin = plane.c2p(0, 0);
    const xAxis = new NumberLine([0, 2 * Math.PI, Math.PI / 2], { length: w, format: halfPiTex, exclude: [0], tips: 'end' });
    xAxis.moveTo({ x: 0, y: origin.y });
    const yAxis = new NumberLine([-1.5, 1.5, 0.5], { length: h, vertical: true, numbers: [-1, 1], tips: 'end' });
    yAxis.moveTo({ x: origin.x, y: 0 });
    const curve = new FunctionGraph(sinFn, plane).setStyle({ stroke: '#2563eb', strokeWidth: 4 });
    const plot = new Group().add(plane, xAxis, yAxis, curve).moveTo({ x: 0, y: -20 });
    // 组外的对象:数学坐标 → 网格本地(c2p)→ 世界(toParent)。
    const P = toParent(plot, plane.c2p(Math.PI / 2, 1));
    const dot = new Dot(7).setStyle({ fill: '#16a34a' }).moveTo(P);
    const peak = tex('\\left(\\tfrac{\\pi}{2},\\ 1\\right)', 22, { x: P.x, y: P.y - 28 });
    const law = tex('y = \\sin x', 26, toParent(plot, plane.c2p(1.65 * Math.PI, 1.15)));

    hide(dot, peak, law);
    unrevealed(plane, xAxis, yAxis, curve);
    stage(env.scene, [plot, dot, peak, law], 24);

    await env.play(new Create(plane, { runTime: 1.5 }), new Create(xAxis, { runTime: 1.5 }), new Create(yAxis, { runTime: 1.5 }));
    await env.wait(0.5);
    await env.play(new Create(curve, { runTime: 2.5 }), new FadeIn(law, { runTime: 2.5 }));
    await env.wait(1);
    await env.play(new FadeIn(dot), new FadeIn(peak));
    await env.wait(4);
  },
);
```

| 图元 | 构造(缺省值) | 说明 |
| --- | --- | --- |
| `FunctionGraph` | `new FunctionGraph(fn, axes, samples = 200)` | 在**整个 xRange** 上取样,超出 yRange 或 NaN 处断笔(只画一段就在范围外返回 `NaN`)。不能换函数,换曲线用 `Transform` |
| `ParametricCurve2D` | `new ParametricCurve2D(fn: (t) => [x, y], axes, tRange: [t0, t1], samples = 240)` | 出框或无定义处断笔 |
| `Trace` | `new Trace()` | 轨迹:updater 里 `addPoint(p)`;`clear()` |
| 预置函数 | `sinFn` `cosFn` `tanFn` `expFn` `logFn` `sincFn`;`spiralFn(growth)`、`lissajousFn(fx, fy, delta, amp)` | 后两个返回参数曲线函数 |
| `AreaUnderCurve` | `new AreaUnderCurve(coords, fn, [a, b], { bottom?, samples = 128 })` | 与 x 轴之间(`bottom: g` 是两曲线之间);负值画在轴下 |
| `RiemannRectangles` | `new RiemannRectangles(coords, fn, [a, b], { n = 8, sample = 'left', colors })` | 组;`sample`:`'left' \| 'right' \| 'mid'`。`sum`(黎曼和)、`set({ n, sample })`;细分动画 `RiemannTo` |
| `TangentLine` | `new TangentLine(coords, fn, x, { length = 160 })` | 切点为中点。`setX(x)`、`slope`;**不裁到坐标框内** |
| `SecantLine` | `new SecantLine(coords, fn, x1, x2, { extend = 0 })` | `setX(x1, x2)`、`slope`;两点重合时不画 |
| `numericDerivative` | `(fn, x) => number` | 中心差分 |
| `VectorField` | `new VectorField(coords, (x, y) => [vx, vy], { xRange?, yRange?, maxLength, uniform = false, colors?: [低, 高], pivot = 'middle' })` | 场变了用 `setFunction(fn)`,**不要逐帧新建** |
| `BarChart` | `new BarChart(values, { width = 300, height = 180, labels, colors, range, barRatio = 0.6, labelKind = 'label', fontSize = 16, showValues = false, valueFontSize = 14 })` | 组;`setValues(v)`(个数不变),补间 `BarChartTo` |

切线沿曲线滑:`scene.addUpdater(() => tangent.setX(t.getValue()))` 配 `TweenValue`(7.9),或 `sweep` 的 `draw: (x) => tangent.setX(x)`。

### 6.7 标注图元

标注的坐标是**本地坐标**,要和被标注的对象挂在同一个父节点下。带文字的标注是组,字符串说明按 `Tex` 排。

```ts
new Brace(from: Point, to: Point, { depth = 14, thickness = depth × 0.2, label?: string | MObject, labelGap = 6, fontSize = 24 })
Brace.for(target: MObject, side: 'up' | 'down' | 'left' | 'right' = 'down', { ...同上, buff = 6 })
```

- 尖角朝「沿 from → to 前进的**右手侧**」(从左往右时朝下)。组:`shape`、`label`、`tip`、`setEnds(from, to)`。
- `label` 传 `MObject` 时被收进括号组,**别再单独 `scene.add`**。`Brace.for` 不带测量上下文:目标是 `Tex` / `Label` 时字号必须设在它自己身上;目标之后移动了要 `setEnds` 或重建。
- 只括公式的一部分:按 `getPartBox` 算端点(`objTex.ts`)。只要括号本身:`new BraceShape(from, to, { depth, thickness })`。

| 图元(参数顺序都是 **顶点**, 一边上的点, 另一边上的点) | 说明 |
| --- | --- |
| `new Angle(vertex, a, b, { radius = 24, reflex = false, exterior = false, label?, labelGap = 4, fontSize = 22 })` | 组:`arc`、`label`。缺省画小于 180° 的一侧,`reflex` 画另一侧,`exterior` 画外角。`degrees`、`setPoints(v, a, b)` |
| `Angle.fromLines(l1: Line, l2: Line, options?)` | 顶点取两直线交点;平行时报错 |
| `new AngleArc(vertex, a, b, { radius = 24, reflex, exterior })` | 只有弧 |
| `new RightAngle(vertex, a, b, { size = 12 })` | 只描边的小折角 |

`a`、`b` 与顶点重合会报错;顶点在动就 `scene.addUpdater(() => theta.setPoints(v, a, b))`。

`new Annotation(text, { offset = { x: 18, y: -18 }, badgeRadius = 11, dotRadius = 4, showDot = true, showLeader = true })`:`position` 处画小圆点,引线连到 `offset` 处的编号徽标;**不支持 `Create`**。

没有的标注:持久外框用 `Rectangle`(下面的 `surroundPart`);圈注 `Circumscribe`(7.7);公式内框 `\boxed{…}`;叉掉 `\cancel{…}`;下划线、尺寸线用 `Line`;
带名字的点 = `Dot` + 旁边 22–24 号的 `Tex`,放在曲线、切线都不经过的一侧。

```ts
// src/film/objTex.ts
import { Brace, Create, Indicate, Rectangle, Write } from '../engine';
import type { Tex } from '../engine';
import type { Segment } from './film';
import { directedSegment } from './film';
import { stage, tex, unrevealed } from './helpers';

/** 公式里某个命名部分的外框(Manim 的 SurroundingRectangle)。公式没旋转时成立。 */
export function surroundPart(t: Tex, part: string, pad: number): Rectangle {
  const b = t.getPartBox(part);
  if (!b) {
    throw new Error(`公式里没有部分「${part}」,现有:${t.partNames.join('、')}`);
  }
  const k = t.scale;
  return new Rectangle(b.size.w * k + pad * 2, b.size.h * k + pad * 2).moveTo({
    x: t.position.x + b.center.x * k,
    y: t.position.y + b.center.y * k,
  });
}

export const objTexSegment: Segment = directedSegment(
  '公式的上色与标注',
  // 1.5 书写 + 1.5 + 1 高亮 + 1.5 括号 + 1.5 + 1.2 外框 + 4 停留 = 12.2
  12.2,
  [
    { start: 0.2, end: 3, text: '这是勾股定理' },
    { start: 3.4, end: 6.8, text: '左边:两条直角边的平方和' },
    { start: 7.2, end: 12, text: '右边:斜边的平方' },
  ],
  async (env) => {
    // 字号设在 Tex 自己身上(tex 助手就是这么做的),getPartBox 才量得准。
    const law = tex('\\class{lhs}{\\textcolor{#2563eb}{a^2} + \\textcolor{#16a34a}{b^2}} = \\class{rhs}{c^2}', 44, { x: 0, y: -20 });
    // 括号只括住 lhs:借 surroundPart 量出 lhs 的位置和尺寸(这个框不进场景)。
    const lhs = surroundPart(law, 'lhs', 0);
    const y = lhs.position.y + lhs.height / 2 + 8;
    const brace = new Brace({ x: lhs.position.x - lhs.width / 2, y }, { x: lhs.position.x + lhs.width / 2, y }, { label: '\\text{平方和}' });
    const box = surroundPart(law, 'rhs', 8).setStyle({ stroke: '#ea580c' });
    // Write 的对象不要藏;Create 的对象先收起。
    unrevealed(brace, box);
    stage(env.scene, [law, brace, box], 40);

    await env.play(new Write(law, { runTime: 1.5 }));
    await env.wait(1.5);
    await env.play(new Indicate(law, { part: 'lhs' }));
    await env.play(new Create(brace, { runTime: 1.5 }));
    await env.wait(1.5);
    await env.play(new Create(box, { runTime: 1.2 }));
    await env.wait(4);
  },
);
```

### 6.8 自定义形状与路径

```ts
const d = new PathBuilder().moveTo(0, 0).quadTo(60, -80, 120, 0).lineTo(120, 40).close().build();
const blob = new SvgPath(d).setStyle({ fill: '#fde68a' });   // 也接受 SVG 的 d 串;setPath(d) 整体替换
```

路径工具(`PathData` 视为不可变):`PathBuilder` 的 `moveTo` `lineTo` `quadTo(cx, cy, x, y)` `cubicTo(c1x, c1y, c2x, c2y, x, y)` `arc(cx, cy, r, a0, a1, anticlockwise = false)`(角度顺时针)
`rect(x, y, w, h)` `close()` → `build()`;`parseSvgPath(d)`、`polylinePath(points, closed = false)`、`transformPath(path, [a, b, c, d, e, f])`、`pathBounds`、`pathLength`、
`partialPath(path, from, to)`(按弧长比例截取)、`alignPaths` / `lerpPath`(变形)、`drawPath`。

**自定义 `PathShape`**:子类只给几何,填充、描边、虚线、按弧长的 `Create`、包围盒、`Transform` / `Write` 由基类处理。

```ts
class Wave extends PathShape {
  amplitude = 30;                                 // 几何参数用可写字段
  protected override buildPath(): PathData {      // 必须;本地坐标,以自身原点为中心
    return new PathBuilder().moveTo(-120, 0).quadTo(-60, -2 * this.amplitude, 0, 0).quadTo(60, 2 * this.amplitude, 120, 0).build();
  }
  protected override pathKey(): string {          // 可选;参数不变就复用路径(缺省 null = 每次重建)
    return String(this.amplitude);
  }
  protected override get fillable(): boolean {    // 开放曲线:不填充
    return false;
  }
}
```

可选 `revealPath(f)` 自定义 `Create` 的长法。完全自定义的 `MObject`:实现 `protected drawShape(ctx, style)`,按需覆盖 `getBox(ctx?)`、`getCullRadius()`、
`supportsReveal`(配合 `this.revealed()`)、`pathLayers(style)`(参与 `Transform` / `Write`)。
构造里的默认样式用 `setDefaultStyle(...)`,**不要**用 `setStyle`(会把键锁死,容器再也改不动)。

### 6.9 容器与排版

`new Group().add(a, b, c)`(`add` / `remove` 返回 `this`):子元素坐标相对组的原点;`setStyle` 作用于整棵子树,但抢不走子元素自己设过的键。

- **组的原点不是中心**:`moveTo` / `MoveTo` / `ScaleTo` / `RotateTo` 都作用于原点(缺省 (0, 0)),内容偏在一侧时 `ScaleTo(g, 2)` 会把整组推走。
  搭组时让内容围着 (0, 0) 摆,或用下面的 `centerAt`。(`Indicate` / `Wiggle` / `Flash` 绕盒子中心。)把组自己或祖先加进来会报错。

**没有 `arrange` / `next_to` / `to_edge`**。盒中心(父坐标)= `position + box.center × scale`,半宽 = `box.size.w × scale / 2`(没旋转时)。可以原样复制:

```ts
export type Side = 'left' | 'right' | 'up' | 'down';

/** Manim 的 next_to:把 b 摆到 a 的某一侧,间距 buff。a、b 在同一个父节点下且都没旋转。 */
export function nextTo(b: MObject, a: MObject, side: Side, buff = 16, ctx?: MeasureContext): void {
  const A = a.getBox(ctx);
  const B = b.getBox(ctx);
  const ax = a.position.x + A.center.x * a.scale;
  const ay = a.position.y + A.center.y * a.scale;
  const gapX = (A.size.w * a.scale + B.size.w * b.scale) / 2 + buff;
  const gapY = (A.size.h * a.scale + B.size.h * b.scale) / 2 + buff;
  const cx = side === 'right' ? ax + gapX : side === 'left' ? ax - gapX : ax;
  const cy = side === 'down' ? ay + gapY : side === 'up' ? ay - gapY : ay;
  b.moveTo({ x: cx - B.center.x * b.scale, y: cy - B.center.y * b.scale });
}

/** 让 m 的外接盒中心落在 p(Group 居中要用它而不是 moveTo)。没旋转时成立。 */
export function centerAt(m: MObject, p: Point, ctx?: MeasureContext): void {
  const c = m.getBox(ctx).center;
  m.moveTo({ x: p.x - c.x * m.scale, y: p.y - c.y * m.scale });
}
```

**`Layout`**:固定尺寸的行 / 列容器,以自身中心为原点,盒子就是 width × height。

```ts
new Layout(width, height, {
  direction = 'row' /* | 'column' */, gap = 0, padding = 0,
  justify = 'start' /* | 'center' | 'end' | 'space-between' | 'space-around' */,
  align = 'center' /* | 'start' | 'end' */, frame = false /* | { stroke, strokeWidth } */, clip = false,
})
row.place(tex('a^2+b^2', 28)).place(label('等于', 24));   // place(child, flex = 0)
env.scene.layout(row);   // = row.layout(scene.measureContext()),一次性排好;不传上下文按字号 28 量
```

- **排布是一次性的**:内容变了要再 `layout`(网页字体晚到时,没挪过的容器会自动重排;自己按字宽摆位的用 `onFontsLoaded(cb)`)。
- **`flex` 只拉伸子 `Layout`**(给 `Tex` 设 flex 只是分到更宽的槽位)。内容超出照样溢出,`clip: true` 裁掉。
- 影片里更常用 `columnList`、`sideColumn`、`isNarrow`(见 [5.4](#54-助手helpers))。

### 6.10 样式、主题与颜色

| 样式键(`StyleOverride`) | 说明 |
| --- | --- |
| `stroke` / `fill` | 描边色 / 填充色(`null` = 不填充,主题缺省) |
| `strokeWidth` / `fontSize` | 线宽 / 字号(世界单位) |
| `fontFamily` | 字体(`Label`、坐标刻度;对 `Tex` 无效) |
| `textColor` | 文字色(`Label`、`Tex`、坐标数字) |
| `dash` | 虚线的线段 / 间隔长度;`[]` = 实线 |

没有 `opacity` 键(只有 `m.opacity`)。谁认哪些键:闭合图形(含 `SvgPath`、`AreaUnderCurve`)认 `stroke`、`fill`、`strokeWidth`、`dash`;开放的线忽略 `fill`;
`Dot`、`BraceShape` 实心,`fill` 没设时用 `stroke` 的颜色;`Arrow` 头用 `stroke` 色填满;`Tex` 只认 `textColor`、`fontSize`,`Label` 再加 `fontFamily`;
`Axes` 线用 `stroke`、字用 `textColor`;组自己不画,样式传给子树。

**解析顺序**:自身 `setStyle` > 容器链(近的优先)> 子类构造默认 > 主题。所以给装着坐标系的组设 `stroke` / `fill`,会连网格线、面积、黎曼矩形、柱子的缺省色一起改掉;
反过来,子元素自己设过的键(包括被 `ColorTo` 设过的)容器改不动。

**主题**:影片分段固定用 `lightTheme`(唯一预设),字段值见 [5.9](#59-预览跳转安全区竖屏重建背景网格与-settheme)。
自定义就是 `env.scene.setTheme({ ...lightTheme, 改几个字段 })`,只管当前段。改背景色时影片选项 `transitionColor` 要设成同一色(否则转场白场对不上,[5.6](#56-影片选项与控制器));
注册的片子要传它得改 `src/sceneRegistry.ts` 里 `filmEntry` 调 `runFilm` 的那行(对所有片子生效)。`cardSegment`、`listSegment`、`chapterCard` 的背景改不了。

**配色**:引擎不导出颜色常量,语义配色见 [3.8 颜色](#38-颜色)(橙 `#ea580c` 是强调动画的缺省色,普通对象少用)。颜色串 `#rgb`、`#rgba`、`#rrggbb`、`#rrggbbaa`、`rgb()`、`rgba()` 处处可解析;
颜色名和 `hsl()` 只有浏览器能解析,node 里插值不了 —— **一律写十六进制**。

颜色工具:`parseColor(c)`、`formatColor(rgba)`、`lerpColor(a, b, t)`(OKLab 插值)、`fadeColor(c, factor)`(`fadeColor('#2563eb', 0.15)` 得同色浅填充)、
`colorAlpha(c)`、`highlightColor(background)`(亮底 `#ea580c`、暗底 `#fbbf24`)、`resolveStyle(theme, override?)`。

### 6.11 Manim 名字对照

| Manim | mini-manim |
| --- | --- |
| `MathTex` / `Tex` | `Tex`(行间样式 `{ displayMode: true }`) |
| `Text` / `MarkupText` | `Label`(单行);多行叠几个 |
| `DecimalNumber` + `always_redraw` | `Label` + updater 里 `setText(v.toFixed(2))`,或 `sweep` |
| `VMobject` 子类 / `SVGMobject` | `PathShape` 子类 / `SvgPath`(只接受 `d` 串,不读文件;不支持位图) |
| `Circle` `Square` `Line` `Arrow` `Dot` `Arc` `Polygon` `Star`…… | 同名;世界单位(≈ px),**y 向下、角度顺时针**:Manim 的 `Arc(r, 0, PI/2)`(扫过的角)写 `new Arc(r, -Math.PI / 2, 0)`(终止角);`Polygon` 顶点 y 取负 |
| `DashedLine` | `Line` + `setStyle({ dash: [6, 5] })` |
| `DoubleArrow` / `RoundedRectangle` | 没有,见 6.3 |
| `Brace` / `BraceBetweenPoints` | `Brace.for(目标, 方向, { label })` / `new Brace(from, to, { label })` |
| `Angle` / `RightAngle` | 同名,参数(**顶点**, 点, 点) |
| `Axes` / `NumberPlane` / `NumberLine` | 同名;刻度限制见 6.6 |
| `axes.c2p` | `Axes.toLocal(x, y)` / `NumberPlane.c2p`,得本地坐标,再 `toParent` 换到组外 |
| `axes.plot(f)` / `ParametricFunction` | `new FunctionGraph(f, axes)` / `ParametricCurve2D`,和坐标系同组 |
| `get_area` / `get_riemann_rectangles` | `AreaUnderCurve` / `RiemannRectangles`(+ `RiemannTo`) |
| `TangentLine` / `get_secant_slope_group` | `TangentLine(coords, fn, x)` / `SecantLine(coords, fn, x1, x2)` |
| `TracedPath` / `ArrowVectorField` / `BarChart` | `Trace` + updater / `VectorField` / `BarChart`(+ `BarChartTo`) |
| `Matrix` / `Table` | `Tex` 的 `pmatrix` / `array` |
| `SurroundingRectangle` / `Underline` | 没有:`surroundPart`(6.7)/ `Line` |
| `arrange` / `next_to` / `to_edge` | 没有:`nextTo` / `centerAt`(6.9)或 `Layout` |
| `move_to` / `shift(UP)` | `moveTo({ x, y })`(组按中心放用 `centerAt`)/ `shift(0, -d)`,d 是世界单位 |
| `.scale(k)` / `.rotate(a)` | `m.scale *= k` / `m.rotation -= a`(绝对值字段;这里正角顺时针);渐变用 `ScaleTo` / `RotateTo` |
| `set_color` / `set_fill` / `set_stroke` | `setStyle({ stroke, fill, strokeWidth, textColor })` |
| `set_color_by_tex` | 源码里 `\textcolor{#hex}{…}` |
| `submobjects[i]` | `getChildren()`;公式的某一项用 `\class{名字}{…}` |
| `copy()` / `set_z_index` | 没有:工厂函数再建一个 / 加入顺序即绘制顺序 |
| `ValueTracker` | `ValueTracker` + `TweenValue`(见 [7.9](#79-valuetrackertweenvalue-与-updater)) |
| `config.frame_width` | 没有固定画幅,按内容取景([8.4](#84-取景)) |

动画名字的对照见 [7.12](#712-从-manim-过来)。

## 7. 动画

动画都是 `Playable`:`begin` 记初态 → 每帧 `interpolate(进度)` → `finish` 落到精确终态。普通动画、组合、运镜、3D 转动都交给 `env.play(...)`,全部从 `'../engine'` import。
逐帧重算的几何(切线、读数、轨迹)见 [7.9](#79-valuetrackertweenvalue-与-updater),运镜见 [8.5](#85-相机与运镜),3D 动画见 [9.5](#95-3d-动画)。节奏数字见 [3.5 动画节奏表](#35-动画节奏表)。

### 7.1 怎么播

```ts
await env.play(new Create(circle), new FadeIn(name, { runTime: 0.5 })); // 同播:这一步 1 秒(取最长)
await env.play(new MoveTo(dot, { x: 100, y: 0 }, { runTime: 2, rateFunc: linear }));
await env.wait(1.5); // 停留:画面不动,updater 照跑
```

- 选项 `AnimationOptions = { runTime?: number; rateFunc?: RateFunction }`,缺省 **1 秒、`smooth`**。例外:`Wiggle` 2 秒;`Indicate` 用 `thereAndBack`;`Wiggle`、`Circumscribe` 和组合动画(7.6)用 `linear`。
- `runTime: 0` 直接到终态;NaN、±Infinity、负数也按 0 并告警。
- **同播** `env.play(a, b, c)`:调用时同步执行每个 `begin`(入场动画当场藏好对象),最长的结束时 resolve。**时长账里一次 `play` 记最长的 runTime。**
- 任何一个 `begin` 抛错(对不支持的对象 `Create`、`Transform` 的目标没进场景……):`play` reject,这一段被跳过,内容测试报错。
- 同播的两个动画别改同一个属性(后插值的覆盖先插值的)。每次播放都 `new` 新实例。
- 影片里一律 `env.play` / `env.wait`(带取消检查,见 [5.2](#52-directedsegment-与-segmentenv));`scene.play` 只在自建场景里用(见 [8.3](#83-播放语义))。

### 7.2 先藏后揭

`scene.add` / `stage` 之后对象从第一帧起就画出来,入场动画到自己 `begin` 时才藏。**第一个 `play` 之外的对象都要在搭建时按入场方式藏好**(`hide` / `unrevealed` 来自 `'./helpers'`);完整规则和检查方法见 [3.4 先藏后揭](#34-先藏后揭)。

| 入场动画 | 搭建时 | 藏错的后果 |
|---|---|---|
| `FadeIn(m)` | `hide(m)`(即 `m.opacity = 0`) | 不藏:t = 0 就露出。藏了子元素却 FadeIn 整组:永远看不见 |
| `Create(m)` | `unrevealed(m)`(即 `m.setRevealFraction(0)`) | 用 `hide` 藏:Create 完仍看不见(Create 不碰 opacity) |
| `Write(m)` | 不藏;不是第一拍时 `hide(m)`,紧挨 `env.play(new Write(m))` 的上一行写 `m.opacity = 1` | 藏着 Write:写完仍看不见 |
| `Transform` / `TransformMatchingTex` | 目标 `hide`,**两个都进场景** | 目标不藏:变形前两个同时露着 |
| `ScaleTo(m, 1)`(从无到有) | 先取景,再 `m.scale = 0` | 先缩再取景:包围盒塌成一点,取景偏 |
| `AnimationGroup` / `LaggedStart` 里的入场 | 组是第一拍可不藏,否则按各子动画藏 | 组开始时就 begin 全部子动画 |
| `Succession` 里的入场 | **必须**按各自方式藏 | 轮到才 begin,之前一直露着 |

### 7.3 基础动画

| 动画 | 签名 | 说明 |
|---|---|---|
| `FadeIn` | `new FadeIn(m, { to?, runTime?, rateFunc? })` | begin 时 opacity 置 0,淡到 `to`(缺省当前值,为 0 时取 1)。**不能调暗可见对象**(先跳到 0),用 7.11 的 `OpacityTo` |
| `FadeOut` | `new FadeOut(m, { runTime?, rateFunc? })` | 淡到 0,**对象仍在场景里**,可再 `FadeIn`(淡回 1);不要了就 `scene.remove(m)` |
| `Create` | `new Create(m, { runTime?, rateFunc? })` | 描边生长(见下)。不支持的对象 begin 时抛错 `Create 需要支持描边生长的对象:…`;`m.supportsReveal` 可查 |
| `Write` | `new Write(m, { lagRatio?, runTime?, rateFunc? })` | 逐片描轮廓再填充,片间错开;`lagRatio` 缺省 min(4 / 片数, 0.2)。`Label` 和 `\text{…}` 里的中文按片淡入 |
| `MoveTo` / `ScaleTo` / `RotateTo` | `new MoveTo(m, target: Point, opts?)`、`new ScaleTo(m, k, opts?)`、`new RotateTo(m, radians, opts?)` | 补间 `position`(**父容器坐标**,组移动的是原点)/ `scale`(绕 `position`)/ 绝对角度(**正角顺时针**,0 → 2π 转一整圈) |
| `FadeTransform` | `new FadeTransform(text, newText: string, { shift?, runTime?, rateFunc? })` | 只用于 `Label` / `Tex`:旧串上浮淡出,中点换串,新串自下浮现;`shift` 缺省 12。text 应已可见 |

`RiemannTo(rects, { n?, sample? }, opts?)`、`BarChartTo(chart, values, opts?)` 见 [§6](#6-图元)。

**`Create` 的样子**:圆和椭圆从 12 点钟顺时针画;线从起点到终点;`Dot` 从中心长大;闭合 `Polygon` 画完边才填色,其它闭合图形填充随笔迹出现(想先描边后填色:先不设 fill,Create 后 `ColorTo(m, { fill })`);
`Label` 逐字打出;`Tex` 像 `Write`;`Axes` 画轴和刻度,箭头和轴名后半程淡入;任何 `Group`(含 `NumberPlane`)子元素同时生长,要逐个出现用 `LaggedStart`。
**不支持**(改用 `FadeIn`):`Annotation`、3D 网格、空的 `Group` / `Layout`、少于 2 个点的 `Polygon`,以及含它们的组。
缓动终点不是 1 时 `Create` / `Write` / `Transform` 停在对应进度(`thereAndBack` 播完回到「还没画」)。

### 7.4 Transform:替换式变形

`new Transform(source, target, { runTime?, rateFunc? })`,相当于 Manim 的 `ReplacementTransform`:

```ts
circle.opacity = 0;                                  // 目标先藏
env.scene.add(square, circle);                       // 两个都要在场景里
await env.play(new Transform(square, circle, { runTime: 1.5 }));
await env.play(new Indicate(circle));                // 之后活着的是 circle
```

- 结束时源 opacity 0(**仍在场景里**),目标恢复藏之前的不透明度(没记录就是 1)。没有「保留源」的 Transform,也没有 `clone`:两个都要就再构造一个。
- 位置、缩放、旋转、形状、颜色、线宽、不透明度一起插值。
- **组对组**按先序展开、**按顺序**配对(多出的从对面中心长出),子元素顺序要对应。**公式对公式**按阅读顺序逐字形配对、不看内容:推导用 7.5。
- 没有路径的部分(`Label`、`\text{…}` 里的中文、3D 网格)交叉淡化。
- 源和目标是同一对象,构造时抛错;互相包含或任一不在场景里,begin 时抛 `Transform:目标对象不在场景里 —— 两个都要先 scene.add(…)`。常用 1.2–1.8 秒。

### 7.5 TransformMatchingTex:按式子结构变形

`new TransformMatchingTex(source, target, options?)`:**没变的项平移过去**,变了的淡出淡入。替换语义和场景要求同 `Transform`。

| 选项 | 缺省 | 说明 |
|---|---|---|
| `runTime` / `rateFunc` | 1 / `smooth` | 同其它动画 |
| `partMap` | `{}` | 部分改名 `{ 源里的名字: '目标里的名字' }`;部分是 `\class{名字}{…}` 或 `\cssId{名字}{…}` 标出的子式 |
| `transformMismatches` | `false` | 配不上的也按阅读顺序直接变形,不再淡出淡入 |
| `matchAcrossSizes` | `true` | 同一符号换了字号也配对,边移边缩放(指数挪下来当系数) |
| `duplicates` | `'merge'` | 多出的副本:`'merge'` 飞向配上对的那个并淡掉;`'fade'` 原地淡出淡入 |
| `fadeLag` | `0.3` | [0, 1):淡出占进度 [0, 1 − fadeLag],淡入占 [fadeLag, 1] |
| `fadeScale` | `0.8` | 淡出缩到 / 淡入从这个比例开始;1 为不缩放 |

**配对优先级**:① 同名命名部分整体对应(源名先经 `partMap`);② 结构相同的整组子式(上下标、分式、根式、括号组),所以 `c^2` 的指数跟着底数走;
③ 同一字形(字形 + 字号,**不看颜色**)平移,先保序,移到等号另一边的再就近配;④ 同符号换字号;⑤ 多出的副本按 `duplicates`(`x + x → 2x`);⑥ 配不上的缩小淡出 / 从小淡入。
`\text{…}` 里的中文按内容配对;源和目标也可以是 `Group`(非公式叶子按顺序变形)。

```ts
hide(s2, b);                                              // 目标先藏,全部进 stage
await env.play(new TransformMatchingTex(s1, s2, { runTime: 1.3 })); // '2x + 3 = 7' → '2x = 7 - 3'
// 指定对应:a = tex('\\class{sq}{x^2 + 2x + 1} = 0'),b = tex('\\class{square}{(x + 1)^2} = 0')
await env.play(new TransformMatchingTex(a, b, { partMap: { sq: 'square' }, runTime: 1.5 }));
```

每步 1.2–1.5 秒,换形前停 1–3.5 秒,一步只改一处。整部推导片见 [4.4 公式推导片](#44-公式推导片)。

### 7.6 编排:AnimationGroup、LaggedStart、Succession

| 写法 | 签名与缺省 | 效果 |
|---|---|---|
| `AnimationGroup` | `new AnimationGroup(anims, { lagRatio = 0, runTime?, rateFunc = linear })` | 同时开始 |
| `LaggedStart` | `new LaggedStart(anims, { lagRatio = 0.2, runTime?, rateFunc = linear })` | 上一个播到 `lagRatio` 时下一个开始(0.2 即 `DEFAULT_LAG_RATIO`) |
| `Succession` | `new Succession(anims, { lagRatio = 1, runTime?, rateFunc = linear })` | 首尾相接 |
| `Wait` | `new Wait(seconds = 1)` | 组里的停顿 |

**总长**:第 i+1 个在第 i 个开始后 `lagRatio × 第 i 个的时长` 开始;n 个时长 d 的子动画总长 d × (1 + (n − 1) × lagRatio)。
例:`LaggedStart([a, b, c])` 各 1 秒 → **1.4 秒**;`Succession([1 秒, new Wait(0.5), 2 秒])` → **3.5 秒**;`AnimationGroup([1 秒, 2 秒])` → **2 秒**。

```ts
await env.play(new LaggedStart(dots.map((d) => new FadeIn(d)), { lagRatio: 0.25 }));   // 依次出场
await env.play(new Succession([new MoveTo(p, A), new Wait(0.3), new MoveTo(p, B)]));   // 第二段从 A 出发
await env.play(new Succession([new Transform(a, b), new Transform(b, c)]));            // a → b → c(b、c 先 hide)
```

- 组可嵌套、可和别的同播;给 `runTime` 时整条时间轴按比例伸缩,组的 `rateFunc` 扭曲整条时间轴。
- **`AnimationGroup` / `LaggedStart` 开始时就 begin 全部子动画**:入场对象当场藏好;同一对象的两次移动不能放进同一个 `LaggedStart`(都在开始时记初态)。
- **`Succession` 轮到谁才 begin 谁**,连续移动、变形能首尾相接;后面的入场对象要预先藏好,或改用 `new LaggedStart(…, { lagRatio: 1 })`。

### 7.7 强调:Indicate、Circumscribe、Flash、Wiggle

| 动画 | 选项与缺省 | 效果 |
|---|---|---|
| `Indicate(m, opts?)` | `scaleFactor = 1.2`,`color` 自动,`part?`,`runTime = 1`,`rateFunc = thereAndBack` | 绕包围盒中心放大并染强调色,再回原样 |
| `Circumscribe(m, opts?)` | `shape = 'rectangle'`(或 `'circle'`),`buff = 10`,`color` 自动,`strokeWidth` = 主题线宽(3),`fadeOut = false`,`part?`,`runTime = 1`,`rateFunc = linear` | 前半程顺时针画一圈,后半程收回(`fadeOut: true` 改成淡出) |
| `Flash(m, opts?)` | `at?`(对象本地坐标),`radius` = 外接半径 + 6(给了 `at` 时 10),`lineLength` = max(14, radius / 2),`lineCount = 12`,`color` 自动,`strokeWidth` = 主题线宽,`timeWidth = 1`,`part?`,`runTime = 1`,`rateFunc = smooth` | 一圈光芒向外掠过 |
| `Wiggle(m, opts?)` | `scaleFactor = 1.1`,`rotationAngle = 0.02π`,`wiggles = 6`(半周期数),`part?`,`runTime = 2`,`rateFunc = linear` | 左右摆几下并微微放大 |

```ts
await env.play(new Circumscribe(result, { shape: 'circle', buff: 12 }));
await env.play(new Flash(axes, { at: axes.toLocal(2, 4) }));   // 在数据点 (2, 4) 闪一下
await env.play(new Indicate(law, { part: 'rhs' }));            // law = tex('\\class{lhs}{a^2 + b^2} = \\class{rhs}{c^2}')
```

- 都是**渲染时的临时效果**:不改位置、缩放、样式,播完精确回原样,可与移动中的对象同时用。
- 缺省强调色:亮底(影片)橙 `#ea580c`,暗底琥珀 `#fbbf24`。普通对象别用这个橙,否则 `Indicate` 染不出变化。
- `part` 是 `\class` 的名字,只对 `Tex` 有效,写错时报错会列出现有部分。`Indicate` 不染 `\textcolor` 上过色的部分(指定 `part` 时那一项里的照染)。
- 放大和光芒**不参与取景**,靠边的对象要留余量([8.4](#84-取景))。持久高亮用 `ColorTo`;强调完停 1 秒以上。

### 7.8 ColorTo:换色与线宽

`new ColorTo(m, target: string | ColorTarget, opts?)`,`ColorTarget = { color?, stroke?, fill?: string | null, textColor?, strokeWidth? }`。

```ts
await env.play(new ColorTo(term, '#db2777'));                               // 简写:描边和文字色一起变
await env.play(new ColorTo(curve, { stroke: '#2563eb', strokeWidth: 6 }));  // 颜色 + 线宽
await env.play(new ColorTo(region, { fill: null }));                        // 填充淡出
```

- 字符串等于 `{ color }`:换描边色和文字色,**只给原本有填充的叶子换填充色**,整组换色时线条不会被填满;具体的键优先于 `color`。OKLab 插值,从当前实际颜色出发。
- **终态等于对每个叶子 `setStyle(目标)`**:这些键从此锁在叶子上,之后对容器 `setStyle` 改不动。
- 公式上色用文字色(`'#hex'` 或 `{ textColor }`)。颜色写十六进制或 `rgb()` / `rgba()`;CSS 颜色名和 `hsl()` 在内容测试(node)里插值不了。

### 7.9 ValueTracker、TweenValue 与 updater

几何要跟着参数逐帧重算时(切点滑动、读数、轨迹、曲面形变),写法固定:**一个参数 + 一个 updater + 一个补间**。

| API | 签名 | 说明 |
|---|---|---|
| `ValueTracker` | `new ValueTracker(initial = 0)`;`getValue()`、`setValue(v): this` | 一个数,不画东西 |
| `TweenValue` | `new TweenValue(tracker, to, { runTime?, rateFunc? })` | 从**播放开始时的当前值**补间到 `to` |
| `scene.addUpdater` | `addUpdater((scene, dt) => void): () => void` | 返回注销函数;也可 `scene.removeUpdater(fn)` |
| `Trace` | `new Trace()`;`addPoint(p)`、`setPoints(点[])`、`clear()` | 轨迹折线;空的什么都不画,不用藏 |

- updater 只在 `play` / `wait` 期间每帧跑一次,**在动画插值之前**,暂停时不跑;抛错的会被移除并 `console.error`(内容测试失败)。
- 补间最后一帧画的是上一帧的值:`play` 后马上注销就先按终值再画一次。只是「从 a 扫到 b」用 `sweep(env, { from, to, runTime, draw, rateFunc? })`([5.4](#54-助手helpers))包办。
- 读数用 `Label` + `toFixed`,别用 `Tex`(每秒换源超过 20 次告警)。updater 不读墙钟(预览、跳转、导出都会重放)。
- `Trace` 放进坐标系所在的组,点用 `axes.toLocal(x, y)`;**只在参数变了时** `addPoint`(`wait` 期间照加会堆重复点)。

切点沿 y = x² 滑动,切线和读数逐帧更新,绿点高度是斜率,`Trace` 画出 k = 2x(17 秒,横屏):

```ts
// src/film/animTracker.ts
import { Axes, Create, Dot, FadeIn, Flash, FunctionGraph, Group, Indicate, TangentLine, Trace, TweenValue, ValueTracker } from '../engine';
import type { Segment } from './film';
import { directedSegment } from './film';
import { hide, label, stage } from './helpers';

// 2 开场 + 0.5 + 1 + 0.5 + 6 扫动 + 0.5 + 1.5 回到 x=1 + 1 强调 + 4 停留 = 17。
export const slopeReadout: Segment = directedSegment(
  '切线斜率读数',
  17,
  [
    { start: 0.2, end: 3.2, text: '抛物线 y = x² 上的切线' },
    { start: 3.5, end: 6.6, text: '绿点的高度等于切线斜率' },
    { start: 6.9, end: 9.9, text: '经过原点时,切线是水平的' },
    { start: 10.2, end: 12.8, text: '停在 x = 1,斜率是 2' },
    { start: 13.1, end: 16.8, text: '绿线就是斜率 k = 2x' },
  ],
  async (env) => {
    const f = (x: number): number => x * x;
    const fp = (x: number): number => 2 * x;
    const axes = new Axes([-2, 2], [-3.5, 4.5], 420, 400);
    const curve = new FunctionGraph(f, axes).setStyle({ stroke: '#2563eb' });
    const tangent = new TangentLine(axes, f, -1.5, { length: 170 }).setStyle({ stroke: '#db2777' });
    const trace = new Trace().setStyle({ stroke: '#16a34a', strokeWidth: 3 });
    const plot = new Group().add(axes, curve, trace, tangent);
    const W = (x: number, y: number): { x: number; y: number } => {
      const p = axes.toLocal(x, y);
      return { x: plot.position.x + p.x, y: plot.position.y + p.y };
    };
    const dot = new Dot(7).setStyle({ fill: '#db2777' });
    const slopeDot = new Dot(6).setStyle({ fill: '#16a34a' });
    const readout = label('', 24, W(1.2, 4));

    const a = new ValueTracker(-1.5);
    let tracedX = Number.NaN;
    const draw = (x: number): void => {
      tangent.setX(x);
      dot.moveTo(W(x, f(x)));
      slopeDot.moveTo(W(x, fp(x)));
      if (x !== tracedX) {
        trace.addPoint(axes.toLocal(x, fp(x))); // 参数变了才加点
        tracedX = x;
      }
      const k = fp(x);
      readout.setText(`k = ${(Math.abs(k) < 0.005 ? 0 : k).toFixed(2)}`); // 不显示 -0.00
    };
    draw(a.getValue()); // 先画出初值,再布景取景

    hide(tangent, dot, slopeDot, readout);
    stage(env.scene, [plot, dot, slopeDot, readout], 24);

    const stop = env.scene.addUpdater(() => draw(a.getValue()));
    try {
      await env.play(new FadeIn(axes), new Create(curve, { runTime: 2 }));
      await env.wait(0.5);
      await env.play(new FadeIn(tangent), new FadeIn(dot), new FadeIn(slopeDot), new FadeIn(readout));
      await env.wait(0.5);
      await env.play(new TweenValue(a, 1.5, { runTime: 6 }));
      await env.wait(0.5);
      await env.play(new TweenValue(a, 1, { runTime: 1.5 }));
      await env.play(new Indicate(readout), new Flash(dot));
      await env.wait(4);
    } finally {
      stop();
    }
  },
);
```

### 7.10 缓动函数

`RateFunction = (t: number) => number`,把 t ∈ [0, 1] 映射成进度。括号里是 t = 0.25 / 0.5 / 1 的值。

| 名字 | 形状 |
|---|---|
| `linear` / `smooth`(缺省) | 匀速 / 3t² − 2t³ 两头慢(0.156 / 0.5 / 1) |
| `easeIn` / `easeOut` / `easeInOut` | t² / 1 − (1 − t)² / 二次慢进慢出 |
| `thereAndBack` / `thereAndBackWithPause(pauseRatio = 1/3)` | 去而复返(0.5 / 1 / 0)/ 顶点停 `pauseRatio` 的时间 |
| `wiggle(t, wiggles = 2)` | ±1 间摆动,两端为 0 |
| `rushInto` / `rushFrom` / `doubleSmooth` | 慢起冲到终点 / 冲出后缓停 / 两段 smooth 中间停一下 |
| `squish(rate, a, b)` | 把 `rate` 压进 [a, b]:之前停在 rate(0),之后停在 rate(1) |

例:`new FadeIn(result, { rateFunc: squish(smooth, 0.6, 1) })` 放进 `runTime: 2` 的 `AnimationGroup`,只在后 40% 的时间里淡入。
自写缓动满足 f(0) = 0、f(1) = 1 终态就精确;f(1) ≠ 1 时 `finish` 按 `rateFunc(1)` 收尾(强调动画除外)。

### 7.11 自定义动画

- 绑定对象的继承 `Animation`(`this.mobject: MObject`;要用子类成员如 `Label.setText` 就另存带类型的字段);不绑对象的(参数、视角)继承 `BasePlayable`。构造接收 `AnimationOptions`。
- `begin(context?)`:记初态,`play` 调用时同步执行,抛错让 `play` reject;`context` 提供 `worldMatrix(对象)` 和 `styleOf(对象)`。
- `interpolate(alpha)`:`alpha` 已过缓动,**按「初态 + alpha」绝对地**算,不要累加(预览、跳转会重放)。`finish()` 缺省 `interpolate(rateFunc(1))`。不用计时器、不读墙钟。

`OpacityTo` 从**当前**不透明度补间到任意值(压暗配角,`FadeIn` 做不到);`Uncreate` 倒着收回描边。`BasePlayable` 的例子见 9.5 的 `TiltTo`。

```ts
import { Animation } from '../engine';
import type { AnimationOptions, MObject } from '../engine';

export class OpacityTo extends Animation {
  private readonly to: number;
  private from = 1;
  constructor(mobject: MObject, to: number, options?: AnimationOptions) {
    super(mobject, options);
    this.to = to;
  }
  override begin(): void {
    this.from = this.mobject.opacity; // 初态在 begin 里记,不在构造时记
  }
  interpolate(alpha: number): void {
    this.mobject.opacity = this.from + (this.to - this.from) * alpha;
  }
}

export class Uncreate extends Animation { // 只用于 supportsReveal 的对象;结束时对象还在场景里
  interpolate(alpha: number): void {
    this.mobject.setRevealFraction(1 - alpha);
  }
}

// await env.play(new Uncreate(aux), new OpacityTo(triangle, 0.35, { runTime: 1.2 }));
```

### 7.12 从 Manim 过来

| Manim | 这里 |
|---|---|
| `ReplacementTransform` / `TransformMatchingShapes` | `Transform` / `TransformMatchingTex`;没有保留源的 `Transform` |
| `ShowCreation`、`GrowArrow` / `DrawBorderThenFill` | `Create` / `Write` |
| `Uncreate`、`Unwrite` | `FadeOut`,或 7.11 的 `Uncreate` |
| `GrowFromCenter` / `ShrinkToCenter` | `m.scale = 0` 后 `ScaleTo(m, 1)` / `ScaleTo(m, 0)` |
| `m.animate.shift / scale / set_color`、`FadeToColor` | `MoveTo`(绝对位置)/ `ScaleTo` / `ColorTo` |
| `Rotate(m, θ)` | `RotateTo(m, m.rotation - θ)`(正角顺时针) |
| `FadeIn(m, shift=…)` | `FadeIn(m)` 与 `MoveTo(m, 终点)` 同播 |
| `m.animate.set_opacity(0.3)` | 7.11 的 `OpacityTo` |
| `MoveAlongPath` / `TracedPath` / `DecimalNumber` | updater 或 `sweep` / `Trace` / `Label` + `setText`(7.9) |
| `ThreeDAxes`、3D 点线 | 2D 对象按投影摆位(9.6) |
| `self.camera.frame.animate` | `scene.playFit`、`CameraMove`(8.5) |
| `set_camera_orientation` / 环绕相机 | `Projection3D` / `Orbit3D`;俯仰用 9.5 的 `TiltTo` |

## 8. 场景、相机与取景

`Scene` = 画布 + 场景图 + 时间线 + 镜头。影片分段拿到的 `env.scene` 已建好;只有 `src/scenes/` 的自建场景才 `new Scene`。

### 8.1 影片里的 Scene 与自建 Scene

**影片里**:每次分段播放新建一个 Scene,主题 `lightTheme`(淡网格和原点十字,关法见 [5.9](#59-预览跳转安全区竖屏重建背景网格与-settheme)),鼠标交互关闭,带字幕的分段套字幕安全区,缩放区间固定 [0.1, 10];分段结束时 Scene 连同对象和 updater 一起销毁。

**自建场景**:`new Scene(canvas, { theme?, camera?, clock?, viewport? })`,缺省 `lightTheme`、机位 `{ x: 0, y: 0, zoom: 1, minZoom: 0.1, maxZoom: 10 }`、`requestAnimationFrame` 时钟、跟随画布 DOM 尺寸(`viewport: { width, height, pixelRatio? }` 固定视口,离屏渲染用)。
**必须 `dispose()`**:停帧泵、摘监听器,挂起和之后的 `play` / `wait` 都立即 resolve;所以自建场景每个 `await` 后要检查自己的 `cancelled` 标志(影片的 `env.play` 会抛取消哨兵,不用操心)。

### 8.2 Scene 方法一览

| 方法 | 签名与缺省 | 作用 |
|---|---|---|
| `add` / `remove` | `add(...m: MObject[]): this`、`remove(...m): this` | 加入顺序即绘制顺序(后加的在上);既是根又在组里会画两遍 |
| `play` / `wait` | `play(...playables): Promise<void>`、`wait(seconds)` | 影片里用 `env.play` / `env.wait`;`wait(Infinity)` 会等到 `dispose`,别用 |
| `fitObjects` / `fitBounds` | `fitObjects(objects, pad = 0)`、`fitBounds(bounds: WorldBounds, pad = 0)` | 瞬时取景(8.4);`fitView(…)` 已废弃 |
| `playFit` | `playFit(objects, { pad = 0, runTime = 1, rateFunc = smooth }?)` | 运镜取景(8.5),之后跟 `env.checkpoint()` |
| `getFitView` / `computeFitView` | `getFitView(objects, pad = 0)`、`computeFitView(bounds, pad = 0)` | 只算不动,返回 `{ x, y, zoom }` |
| `setSafeArea` / `clearSafeArea` | `setSafeArea({ top?, bottom?, left?, right? })` | 屏幕 css 像素,只改写了的边;`safeAreaCenterOffset(): Point` 给镜头跟随用 |
| `addUpdater` / `removeUpdater` | `addUpdater(fn: (scene, dt) => void): () => void` | 每帧、插值之前(7.9) |
| `setPaused` / `getElapsed` | `setPaused(paused: boolean)`、`getElapsed(): number` | `getElapsed` 只在 play / wait 推进时增长 |
| `getTheme` / `setTheme` | `setTheme(theme: Theme)` | 换主题,立即重画 |
| `measureContext` / `layout` | `measureContext()`、`layout(node)` | 当前主题的量尺;排 `Layout` 用 `scene.layout(node)` |
| `getCamera` / `getViewportSize` | `getCamera(): Camera`、`getViewportSize(): { w, h }` | 镜头(8.5)/ 视口 css 尺寸 |

引擎和导出用的:`setDryRun(dry)`(不绘制)、`render()`、`renderTo(ctx, { x?, y?, width?, height? }?)`、`resize()` / `resizeAndRefit()`(8.6)、`setInteractionEnabled(enabled)`、`dispose()`。

### 8.3 播放语义

- 每个动画到自己的 `runTime` 单独收尾;并发的 `play` / `wait` 共用一个帧泵(每帧 updater 跑一遍、画一次):

  ```ts
  await Promise.all([env.scene.playFit(everything, { pad: 24, runTime: 2 }), env.play(new Create(curve, { runTime: 2 }))]);
  env.checkpoint(); // playFit 不带取消检查
  ```

- 串行 `await` 承接上一步不到一帧的超调,字幕不会越走越超前。超过 0.5 秒的帧间隔只推进 0.5 秒。

### 8.4 取景

`fitObjects(objects, pad)` 把世界包围盒 + 四周 pad 放进可用区(视口减安全区)并居中:zoom = min(可用宽 ÷ (盒宽 + 2pad),可用高 ÷ (盒高 + 2pad)),钳进 [0.1, 10];屏幕字号 = `fontSize` × zoom。

- **pad 是世界单位**。现有影片:卡片 40、列表 30、坐标系段 24(探针多的 20)。
- **不管可见不可见**:opacity 0、未 `Create` 的照样计入,所以搭建时把以后会出现的东西一起取景。`scale = 0` 的对象塌成一点,先取景再缩。
- **不在场景里的对象也能参与取景**:用作**取景框**,让移动的对象不出画、各段字号统一(只框内容时字号随内容多少忽大忽小):

  ```ts
  // 1280×720、有字幕时 zoom ≈ 1.24,fontSize 24 在屏幕上约 30 px
  stage(env.scene, [plot, formula, note], 30, [new Rectangle(800, 450)]); // 第 4 个参数只参与取景
  ```

- **竖屏分支**:横框在 9:16 下 zoom 只有约 0.69。换竖框、内容改成上下排,起作用的是框的**宽度**(450 左右,字号和横屏接近):
  `const frame = isNarrow(env.scene) ? new Rectangle(450, 800) : new Rectangle(800, 450);`(竖屏 zoom ≈ 1.12)。
  `isNarrow` 来自 `'./helpers'`,搭景时判断一次;两个分支只改位置和大小,**时间线必须一致**(内容测试只跑横屏)。完整写法见 9.6 和 [5.9](#59-预览跳转安全区竖屏重建背景网格与-settheme)。
- 强调的放大和光芒、之后才移过去的位置都**不在包围盒里**,要留余量或用取景框兜住。3D 网格的包围盒随视角变(9.7)。
- **安全区**只给带字幕的分段设底部(1280 宽时有章名约 99 像素、无章名约 87),按一行字幕估算;详见 [5.9](#59-预览跳转安全区竖屏重建背景网格与-settheme)。

### 8.5 相机与运镜

**Camera**(`env.scene.getCamera()`;`env.camera` 已废弃):`x`、`y`、`zoom` 可读写(`zoom` 钳进 [`minZoom`, `maxZoom`]);`getView()` / `setView(partial)`;`screenToWorld(sx, sy, vw, vh)` / `worldToScreen(wx, wy, vw, vh)`。

| 运镜写法 | 签名与缺省 | 说明 |
|---|---|---|
| `scene.playFit` | `playFit(objects, { pad = 0, runTime = 1, rateFunc = smooth }?)` | **影片首选**:尊重安全区,记为「上次取景」;包围盒在调用时量一次 |
| `CameraMove` | `new CameraMove(camera, target: Partial<CameraView> \| (() => Partial<CameraView>), { runTime?, rateFunc? })` | 缩放按对数补间。**不管安全区、不记为上次取景**(尺寸一变就弹回),目标写 `env.scene.getFitView(...)` |
| `createCameraFollow` | `createCameraFollow(camera, target: MObject \| (() => Point), { damping = 4, zoom?, centerOffset? }?)` | 返回 updater,交给 `addUpdater`;有字幕时传 `centerOffset: env.scene.safeAreaCenterOffset` |

- **推近时线宽、点、字号、背景网格一起变大**(世界单位)。要保持屏幕尺寸,用 updater 按 `1 / camera.zoom` 缩回:

  ```ts
  scene.setTheme({ ...lightTheme, showGrid: false, showAxes: false }); // 推近的段关掉背景网格
  const camera = scene.getCamera();
  const keepScreenSize = (): void => {
    const k = 1 / camera.zoom; // 1 屏幕像素 = k 世界单位
    curve.setStyle({ strokeWidth: 4 * k });
    dot.scale = k;
  };
  keepScreenSize();
  scene.addUpdater(keepScreenSize);
  await scene.playFit([new Rectangle(100, 50).moveTo(P)], { runTime: 2 }); // 不进场景的框只参与取景
  env.checkpoint();
  ```

- **zoom 上限 10**:要放大十几倍就把全景画大,让全景 zoom < 1(1200 × 960 的坐标系全景约 0.59);这时 `Axes` 刻度数字会小到看不清。
- 一段最多一两次运镜,每次 2–2.2 秒,可和 `Create` 同播;落地后停 ≥ 1 秒,最后拉回全景再停留。

### 8.6 尺寸变化与字体晚到

- **画布尺寸变了**:分段调 `resizeAndRefit()` 按上次取景重框;只有 `fitObjects`、`fitBounds`、`playFit` 会被记下,`CameraMove`、`setView`、镜头跟随不记。横竖屏翻转则**重建**整段(5.9)。
- **网页字体晚到**时 `Layout` 重排,并重做上一次按对象的取景(前提是镜头和那些对象都没动过)。画布隐藏时取景推迟到尺寸就绪。

## 9. 3D

3D 对象是软件投影进 2D 画布的网格,都是 `MObject`:`moveTo`、`scale`、`opacity`、`setStyle`、`FadeIn` 照常用,可与 2D 图元混排、一起取景。
点、线、字母、坐标轴用 2D 对象按投影摆位(9.6);网格之间互不遮挡(9.7)。整部 3D 片见 [4.12 3D 直观片](#412-3d-直观片)。

### 9.1 坐标与视角

- **坐标**:x 向右、**y 向下**、z 指向观察者;角度用弧度(`Spin3D` / `Orbit3D` 的 `turns` 是圈数)。内置立体和曲面预设都以 **y 轴为对称轴**:圆锥、四棱锥尖朝上(−y)。
- **视角** `new Projection3D({ rotX = -0.45, rotY = 0.6, viewDistance = 700, nearRatio = 0.2 })`:先绕 y 转 `rotY`(转台),再绕 x 转 `rotX`(俯仰,负值从上往下看);`viewDistance` 越小透视越强。
- **每个网格缺省各持一份视角**。同一个 `Projection3D` 交给几个网格(构造选项 `projection` 或 `mesh.setProjection(view)`)就共用,一个 `Orbit3D` 带动整组;网格的 `rotX` / `rotY` 读写的就是视角。
- **样式**:不设 `fill` 画线框,被挡住的边画成淡虚线,线宽缺省 2;设了 `fill` 按深度排序填色加平面明暗,每个面的边用 `stroke` 描,嫌密就把 `strokeWidth` 调到 1 或 0。

### 9.2 立体

`new Cube(size = 70)`、`new Cuboid(width = 90, height = 60, depth = 50)`、`new Pyramid(baseSize = 80, height = 85)`、`new Tetrahedron(radius = 60)`(外接球半径)、
`new TriangularPrism(radius = 50, height = 60)`、`new Cylinder(radius = 40, height = 80, segments = 24)`、`new Cone(radius = 45, height = 85, segments = 24)`、`new Sphere(radius = 48, lonSegments = 24, latSegments = 16)`。

- 都可在末尾再传 `options?: Mesh3DOptions`(`{ projection?: Projection3D; sided?: 'auto' | 'one' | 'two' }`);`Cylinder` / `Cone` / `Sphere` 也可只传一个对象(`{ radius, height, segments, projection, sided }`,球是 `lonSegments`、`latSegments`)。
- 中心在自己的原点,锥和棱锥的底面在 y = +height/2。分段数须为 ≥ 3 的整数。

```ts
const view = new Projection3D({ rotX: -0.45, rotY: 0.6 });
const ball = new Sphere({ radius: 48, projection: view }).setStyle({ fill: '#dbeafe', strokeWidth: 1 }); // 填色 + 明暗
const cone = new Cone({ radius: 45, height: 90, segments: 32, projection: view }).moveTo({ x: 160, y: 0 });
```

### 9.3 曲面

**参数曲面** `new ParametricSurface(fn: ParamFn, options?)`,`ParamFn = (u, v, params: number[]) => Vec3`。选项:`uSegs` / `vSegs` 缺省 28 / 20;`uRange` / `vRange` 缺省取预设自带的,否则 [0, 2π];
`params` 缺省 `[]`;`sided` 缺省 `'auto'`(闭合可定向的画单面,开放或不可定向的画双面);`projection`。
预设(都以 y 为轴):`sphereParam(radius)`、`torusParam(mainRadius, tubeRadius)`、`mobiusParam(radius, halfWidth)`、`kleinParam(scale)`(`vSegs` 取偶数接缝才齐)、
`sphereTorusHomotopy(sphereRadius, mainRadius, tubeRadius)`(球面到环面参数化的线性插值,`params[0]` = t ∈ [0, 1]);`sphereSurface(radius, options?)` 直接返回球面。

- `resample(params?)` 按新参数重采样(不传则强制重采),`getParams()` 返回副本。
- **要 `ParamMorph` 就在构造时给参数初值**(如 `params: [0]`),否则 begin 时报「ParamMorph 的目标参数个数(1)与曲面当前参数个数(0)不一致」。

**隐式曲面** `new ImplicitSurface(field: FieldFn, options?)`,`FieldFn = (x, y, z, params: number[]) => number`(有向距离场,体内为负)。
选项:`bounds` 缺省 70(采样立方体**半边长**,超出的被截掉);`resolution` 缺省 22(每边体素数);`params` 缺省 `[0]`;`projection`。
现成的场:`sdSphere(x, y, z, radius)`、`sdTorus(x, y, z, mainRadius, tubeRadius)`、`sphereToTorusField(sphereRadius, mainRadius, tubeRadius)`(`params[0]` = t,中途改变亏格)。
隐式曲面只画轮廓,不填色时轮廓全是实线,填了色才有遮挡。

```ts
const morphing = new ParametricSurface(sphereTorusHomotopy(80, 60, 24), { params: [0] });  // 之后 ParamMorph(morphing, [1])
const blob = new ImplicitSurface(sphereToTorusField(72, 60, 24), { bounds: 116 });         // params 缺省 [0]
const twoBalls: FieldFn = (x, y, z, params) => {
  const d = 20 + 40 * (params[0] ?? 0);
  return Math.min(sdSphere(x - d, y, z, 40), sdSphere(x + d, y, z, 40)); // 并集取 min
};
```

### 9.4 自定义网格 Mesh3D

`new Mesh3D(vertices: Vec3[], faces: number[][], options?: Mesh3DOptions | Projection3D)`,`Vec3 = { x, y, z }`,每个面是 ≥ 3 个顶点下标(非法坐标或下标构造时抛错)。
`vertices` / `faces` 是只读视图,改几何用 `setVertices(v)`(数量一致)或 `setVertexAt(i, x, y, z)`。法线对**凸体**总是对的,凹网格可能判反面朝向。

### 9.5 3D 动画

| 动画 | 签名与缺省 | 说明 |
|---|---|---|
| `Spin3D` | `new Spin3D(mesh, turns = 1, opts?)` | 绕 y 轴转;转的是它的**视角**,共用视角的一起转 |
| `Orbit3D` | `new Orbit3D(projection, turns = 1, opts?)` | 转一套共享视角,整组转动用它 |
| `MorphTo` | `new MorphTo(mesh, targetVertices: Vec3[], opts?)` | 顶点逐个补间,数量须一致 |
| `ParamMorph` | `new ParamMorph(surface, to: number[], opts?)` | `params` 从当前值补间到 `to`,每帧 `resample` |

- 匀速转圈写 `rateFunc: linear`。网格入场一律 `FadeIn`(先 `hide`)。
- **旋转体环绕看不出变化**:`Cone`、`Cylinder`、`Sphere`、球面 / 环面绕 y 轴对称,转多少圈轮廓都不变,要靠俯仰显立体感;环绕留给 `Cube`、`Pyramid`、`Tetrahedron`、`TriangularPrism`、莫比乌斯带、自定义网格。
- **没有俯仰动画**(`Orbit3D` 只转 `rotY`):照 7.11 写一个 `BasePlayable`:

```ts
import { BasePlayable } from '../engine';
import type { AnimationOptions, Projection3D } from '../engine';

class TiltTo extends BasePlayable {
  private readonly view: Projection3D;
  private readonly to: number;
  private from = 0;
  constructor(view: Projection3D, to: number, options?: AnimationOptions) {
    super(options);
    this.view = view;
    this.to = to;
  }
  override begin(): void {
    this.from = this.view.rotX;
  }
  interpolate(alpha: number): void {
    this.view.rotX = this.from + (this.to - this.from) * alpha;
  }
}
// await env.play(new TiltTo(view, -1.0, { runTime: 2.5 }));  // 俯仰到更高再回来,圆柱顶面的椭圆先变圆再变扁
```

### 9.6 3D 里的标注、辅助线与坐标轴

**没有 3D 的点、线段、箭头、曲线,也没有 `ThreeDAxes`**。字母、高线、坐标轴用 2D 对象(`Tex`、`Label`、`Dot`、`Line`、`Arrow`、`Trace`)画,位置用网格内部同一个投影公式算(引擎没导出,抄下例的 `project3D`)。

- **视角一变投影就变**:`Orbit3D` / `Spin3D` / 俯仰播放时,标注要在 updater 里每帧重摆;用被标注网格的 `position` 和 `scale` 投影(网格在根上、`rotation` 为 0)。
- **2D 对象不参与遮挡**:后加的总画在网格上面,背后顶点的字母照样可见(填色立体只给朝前的顶点标字)。
- **坐标轴**:三条 `Arrow`,每帧把 `start` / `end` 设成原点和轴端点的投影。课本 Z 轴朝上:数学 (X, Y, Z) 写成引擎 (X, −Z, −Y)。**3D 曲线**:采样后每帧投影,交给 `trace.setPoints(…)`。

正四棱锥标字母、作高 PO;非旋转体,用 `Orbit3D` 转半圈,标注靠 updater 跟着走;竖屏只换取景框(16.9 秒):

```ts
// src/film/animPyramid.ts
import { Create, FadeIn, Line, Orbit3D, Projection3D, Pyramid, Rectangle } from '../engine';
import type { Point, Vec3 } from '../engine';
import type { Segment } from './film';
import { directedSegment } from './film';
import { hide, isNarrow, stage, tex, unrevealed } from './helpers';

// 3D 点 → 画面 2D 点(网格内部同一公式);origin / scale 传网格的 position / scale。
export function project3D(view: Projection3D, origin: Point, p: Vec3, scale = 1): Point {
  const cosY = Math.cos(view.rotY);
  const sinY = Math.sin(view.rotY);
  const cosX = Math.cos(view.rotX);
  const sinX = Math.sin(view.rotX);
  const x1 = p.x * cosY + p.z * sinY; // 先绕 y 轴转 rotY
  const z1 = -p.x * sinY + p.z * cosY;
  const y = p.y * cosX - z1 * sinX; // 再绕 x 轴转 rotX
  const z = p.y * sinX + z1 * cosX;
  const d = view.viewDistance;
  const s = d / Math.max(d * view.nearRatio, d - z); // 透视
  return { x: origin.x + x1 * s * scale, y: origin.y + y * s * scale };
}

// 1.5 入场 + 1 标注 + 0.5 + 5 环绕 + 0.5 + 1.2 作高 + 1.5 + 1.2 公式 + 4.5 停留 = 16.9。
export const pyramidLabels: Segment = directedSegment(
  '正四棱锥',
  16.9,
  [
    { start: 0.2, end: 2.8, text: '正四棱锥 P-ABCD' },
    { start: 3.1, end: 7.9, text: '底面 ABCD 是正方形' },
    { start: 8.2, end: 11.1, text: '高 PO 垂直于底面' },
    { start: 11.4, end: 16.6, text: '体积是底面积乘高的三分之一' },
  ],
  async (env) => {
    const view = new Projection3D({ rotX: -0.4, rotY: 0.5 });
    const a = 160; // 底面边长
    const h = 150; // 高
    const pyramid = new Pyramid(a, h, { projection: view }).setStyle({ stroke: '#2563eb' }).moveTo({ x: 0, y: -30 });
    const P: Vec3 = { x: 0, y: -h / 2, z: 0 }; // 尖顶(y 向下)
    const O: Vec3 = { x: 0, y: h / 2, z: 0 }; // 底面中心
    const corners: Vec3[] = [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([sx = 0, sz = 0]) => ({ x: (sx * a) / 2, y: h / 2, z: (sz * a) / 2 })); // A B C D
    const at = (p: Vec3): Point => project3D(view, pyramid.position, p, pyramid.scale);

    const names = ['A', 'B', 'C', 'D'].map((s) => tex(s, 24));
    const apex = tex('P', 24);
    const foot = tex('O', 22);
    const height = new Line(at(P), at(O)).setStyle({ stroke: '#db2777', dash: [6, 5] });
    const place = (): void => {
      const o = at(O);
      corners.forEach((c, i) => {
        const v = at(c);
        const len = Math.hypot(v.x - o.x, v.y - o.y) || 1;
        names[i]?.moveTo({ x: v.x + ((v.x - o.x) / len) * 20, y: v.y + ((v.y - o.y) / len) * 20 }); // 从底面中心往外推 20
      });
      apex.moveTo(at({ x: 0, y: P.y - 22, z: 0 }));
      foot.moveTo({ x: o.x + 16, y: o.y + 4 });
      height.start = at(P);
      height.end = o;
    };
    place(); // 先摆好再取景

    const formula = tex('V = \\tfrac{1}{3}\\, S_{ABCD} \\cdot PO', 34, { x: 0, y: 170 });
    hide(pyramid, ...names, apex, foot, formula);
    unrevealed(height);
    const frame = isNarrow(env.scene) ? new Rectangle(450, 800) : new Rectangle(800, 450); // 竖屏分支:只换取景框
    stage(env.scene, [pyramid, height, ...names, apex, foot, formula], 30, [frame]); // 2D 对象后加,画在网格上面
    env.scene.addUpdater(place); // 标注每帧重摆

    await env.play(new FadeIn(pyramid, { runTime: 1.5 }));
    await env.play(...[...names, apex].map((n) => new FadeIn(n)));
    await env.wait(0.5);
    await env.play(new Orbit3D(view, 0.5, { runTime: 5 }));
    await env.wait(0.5);
    await env.play(new Create(height, { runTime: 1.2 }), new FadeIn(foot, { runTime: 1.2 }));
    await env.wait(1.5);
    await env.play(new FadeIn(formula, { runTime: 1.2 }));
    await env.wait(4.5);
  },
);
```

### 9.7 限制与性能

- **不支持 `Create`**:所有 3D 网格 begin 时抛错,入场用 `FadeIn`。
- **网格之间没有遮挡**:不同网格按加入顺序整块叠画。嵌套或交叠的立体(球内切于圆柱)画不对:并排摆开;或里层填色、外层只画线框,并**先加里层、后加外层**。
- **隐藏线只做背面剔除**,凹处自遮挡不处理。**包围盒随视角变**:转动时轮廓会变的(正方体转 45° 约宽 1.4 倍)按最大轮廓留余量或用取景框。
- **重建成本**:`ImplicitSurface` 缺省 `resolution` 22 每次约 2 毫秒(40 约 6 毫秒),参数曲面约 0.1 毫秒;预览、跳转、导出都从头重放,形变段会慢些,时长不受影响。

## 10. 配音

配音从外部来:配音方交回「音频 + 时间表」,放进 `public/voice/<voiceId>/`,刷新页面就对上了。时长、字幕起止、提示点、声音位置都按时间表走,**不用改代码**。没有时间表时片子照常无声播放(`timedSegment` 按字数排草稿)。

### 10.1 分工:引擎做什么,配音方交什么

| 谁 | 负责 | 产物 |
| --- | --- | --- |
| 引擎与工具 | 导出台词稿(稳定 id、照念的纯文本、句中标记、每个提示点前动画至少要几秒);没有时间表时排草稿;按实测排参考时间表;校验;加载时套用;导出时混进成片 | `voice:script`、`voice:layout`、`voice:check`;运行时 `prepareVoice` |
| 配音方(TTS 或真人) | 照 `plain` 念每一句;量每句时长和标记时刻 | 音频 + `timing.json`(或只交 `measured.json`,作者跑 `voice:layout`) |
| 作者 | 写分段、登记影片、导出台词稿;收回后跑 `voice:check`、放文件、刷新页面听一遍,再导出 | — |

给配音方的独立说明在 [docs/voice.md](docs/voice.md),有出入以本节为准。

### 10.2 作者这一侧:两种分段怎么配音

两种分段可以混用。`timedSegment` 的选项、`TimedEnv`、收尾停留、构造校验、测试见 [5.5](#55-timedsegment按台词对齐),完整配音片见 [4.11](#411-配音驱动短片)。

| | 按台词对齐:`timedSegment` | 固定时长:`directedSegment` / `cardSegment` / `listSegment` / `chapterCard` / 自建 |
| --- | --- | --- |
| 台词稿 `kind` | `timed` | `fixed` |
| 分段 id | 必填 `id` | `directedSegment` 第 5 参数 `{ id }`;其余**没有 id 选项**,id = 分段名,改名就对不上已有配音 |
| 台词 id | `lines[].id` | 字幕的 `id`;没写时是 `<分段id>/<序号>`(从 1 起,如 `片头/1`) |
| 时长 | 由时间表定;没有时按草稿 | 手写 `duration`,不迁就配音;表里的时长差 0.25 秒以上只提醒,多出的声音截掉 |
| 字幕 | 起止来自时间表或草稿;文字 = 台词去掉 `<mark>` | 表里写了 `lines` 就换成表的起止;**文字按序号取原字幕**(不按 id) |
| 对齐 | `await env.untilLine(id)` / `env.untilMark(id, 'k')` | 不对齐:每句从自己字幕窗口开头说起,不撞下一句开口或段尾 |
| `<mark name="k"/>` | 就是提示点 | 没用,会原样显示 |

下文的例子是影片 `appx-voice`:固定时长段 `parabola`(`directedSegment` 写死 `{ id: 'parabola' }`,8 秒 = FadeIn 1 + Create 2 + 停 0.5 + FadeIn 1 + 停 3.5;字幕 0.2–3.3「先画出一条抛物线。」、3.6–7.8「它的方程是 y 等于 x 的平方。」,即 `parabola/1`、`parabola/2`),加上这段:

```ts
const slope = timedSegment({
  id: 'slope',
  name: '切线的斜率',
  lines: [
    { id: 'slope-1', text: '在 x 等于 1 处画一条<mark name="t"/>切线。' },
    { id: 'slope-2', text: '它的斜率是 2,正好是 2x 在这一点的值。' },
  ],
}, async (env) => {
  // ……布景:切点 dot、切线 tangent、公式 k,都先藏……
  await env.untilLine('slope-1');
  await env.play(new FadeIn(dot, { runTime: 0.6 }));
  await env.untilMark('slope-1', 't'); // 正好说到「切线」
  await env.play(new Create(tangent, { runTime: Math.max(0.6, env.remaining('slope-1')) }));
  await env.untilLine('slope-2');
  await env.play(new FadeIn(k, { runTime: 0.8 }));
  await env.play(new Indicate(k, { runTime: Math.max(0.6, env.remaining('slope-2')) }));
  await env.wait(3); // 收尾停留写进脚本:段尾只自动留约 0.6 秒
});
```

没有时间表时草稿 10.5 秒(两句 0.3–3.04、3.29–7.52,再停 3 秒)。

**脚本写法**:
- 跟某句同步的动画前写 `await env.untilLine(id)`;踩某个词就在台词里放 `<mark name="k"/>`、脚本写 `await env.untilMark(id, 'k')`。没等的句子接在上一句后说。
- 跟着台词伸缩的 runTime 写 `Math.max(下限, env.remaining(id))`(`remaining` 可能是 0),且先 `untilLine` 再用(否则等开口的时间也算进去)。要在某个词之前做完,用比例(`env.remaining(id) * 0.6`)或等那个标记,**别写「句尾减常数」**:配音一慢就不够。
- 该伸缩的是有过程的动画(`Create`、`Write`);强调保持约 1 秒,上例末尾的 `Indicate` 只为演示。

固定时长分段的字幕写成念得出来的样子(「y 等于 x 的平方」,不写「y=x²」),窗口按约 4.5 字/秒留够;给字幕写 `id`,插删字幕就不打乱台词 id。

**登记**:页面按 `filmEntry` 第 2 参数(voiceId)找 `public/voice/<voiceId>/timing.json`,命令行按 `src/film/catalog.ts` 的键找影片,两处必须同名(没有检查),`?scene=` 也同名最省事,见 [5.7](#57-注册新片)。现有影片只有演示片不同名:`?scene=voicedemo`,voiceId 是 **`voice-demo`**。

### 10.3 流水线

| 步 | 谁 | 命令 / 动作 | 产物 |
| --- | --- | --- | --- |
| 1 | 作者 | `npm run voice:script -- <影片> --out script.json` | 台词稿(不给 `--out` 就打到标准输出) |
| 2 | 配音方 | 照每句 `plain` 合成或录音,量时长和标记时刻 | 音频 + `measured.json` |
| 3 | 配音方或作者 | `npm run voice:layout -- script.json measured.json --out timing.json`(可选,也可手写) | `timing.json`;有错误也写出,退出码 1,**先修排期错误** |
| 4 | 作者 | 把 `timing.json` 和音频放进 `public/voice/<voiceId>/` | — |
| 5 | 作者 | `npm run voice:check -- <影片> public/voice/<voiceId>/timing.json` | 0 个错误才能交付 |
| 6 | 作者 | **刷新页面**,点「开启声音」听一遍 | — |

- `<影片>` 是 `catalog.ts` 的键(现有 `film`、`derivatives`、`topology`、`voice-demo`),写错报 `没有名为「x」的影片;可选:…`。
- 命令在 Node 里用 DOM 桩干跑(1280×720)。退出码 0 没有错误,1 有 `✗ 错误`,2 用法 / 文件 / JSON / 影片名不对。
- `voice:check` 按 timing.json 所在目录找音频,**在最终位置上校验**。
- `voice:layout` 只有 `--out`;留白:段首 0.3、句间 0.25、段尾 0.6 秒。
- **`voice:check` 只看时间表、不量音频**:排期报的「缺少实测音频」「请压缩到 L 秒以内」,写出的表已被改成「没声音」/「句尾截到下一句开口」,`voice:check` 不再报。

**量时长和标记**(从这句音频第 0 秒量起,先剪掉句首句尾静音):时长用 `ffprobe -v error -show_entries format=duration -of csv=p=0 句.m4a`(macOS 也可 `afinfo`)。标记时刻:支持 SSML 的 TTS 把 `text` 包进 `<speak>…</speak>`(`&`、`<` 转义)并打开标记回报(Google Cloud TTS v1beta1 `enableTimePointing: ['SSML_MARK']`、Amazon Polly `ssml` speech marks(毫秒 ÷ 1000)、Azure bookmark 事件);不支持的就把标记前的文字单独合成一次量时长(10.8);真人录音在剪辑软件里打点。

**走一遍**(10.2 的例子):

```bash
npm run voice:script -- appx-voice --out script.json   # 《appx-voice》:2 段,4 句
```

配音方交回 `measured.json`(`marks` 相对**这句开头**;`audio` 也可写 `{ "file", "offset" }`),四个音频放进 `public/voice/appx-voice/`:

```json
{ "parabola": { "parabola/1": { "duration": 2.4, "audio": "parabola-1.m4a" }, "parabola/2": { "duration": 3.5, "audio": "parabola-2.m4a" } },
  "slope": { "slope-1": { "duration": 2.9, "marks": { "t": 2.0 }, "audio": "slope-1.m4a" }, "slope-2": { "duration": 4.6, "audio": "slope-2.m4a" } } }
```

```bash
npm run voice:layout -- script.json measured.json --out public/voice/appx-voice/timing.json
npm run voice:check -- appx-voice public/voice/appx-voice/timing.json
# ✗ 错误 [slope] 动画比时间表长 0.38 秒:动画 11.03 秒才跑完,时间表只给了 10.656 秒
# 1 个错误,0 个提醒:时间表还不能交付
```

`slope-2` 念了 4.6 秒(草稿 4.23),最后一个提示点之后按 `remaining('slope-2')` 定长的 `Indicate` 跟着变长,排期的 `tail` 却按草稿算。把表里 `slope` 的 `"duration": 10.656` 改成 `11.1`,再跑就是 `✓ 时间表没有问题`。

**固定时长段说太长了**:假如 `parabola/1` 念了 3.6 秒,`voice:layout` 报 `台词「parabola/1」说了 3.6 秒,这段动画时长固定,它会撞上下一句(3.6 秒开口):请压缩到 3.4 秒以内`;写出的表里 `end` 截成 3.6,声音却放到 3.8 秒、和下一句叠 0.2 秒。差零点几秒就**压缩音频**(提速重合成、剪静音);差得多就**加长分段**:下一句字幕和之后的动画往后挪、`duration` 跟着加(本例停 0.5 改 0.9,第二句改 4.0–8.2,时长 8.4),重新 `voice:script`、重新排期,音频不用重录。

### 10.4 文件格式

**台词稿 `script.json`**(工具生成)里 `slope` 段(`…` 为省略):

```
{
  "id": "slope", "name": "切线的斜率", "kind": "timed", "duration": 10.5,
  "lines": [
    { "id": "slope-1", "text": "在 x 等于 1 处画一条<mark name=\"t\"/>切线。", "plain": "在 x 等于 1 处画一条切线。", "marks": ["t"],
      "draft": { "start": 0.3, "end": 3.044, "marks": { "t": 2.3 } }, "needsBefore": 0, "markNeeds": { "t": 0.6 } },
    { "id": "slope-2", …, "marks": [], "draft": { "start": 3.294, "end": 7.522 }, "needsBefore": 0.733 }
  ],
  "cues": [{ "line": "slope-1", "needs": 0 }, { "line": "slope-1", "mark": "t", "needs": 0.6 }, { "line": "slope-2", "needs": 0.733 }],
  "tail": 7.206
}
```

| 字段 | 含义 |
| --- | --- |
| `kind` / `duration` | `timed`:时长由配音定,`duration` 是草稿(参考);`fixed`:`duration` 是动画时长,定死 |
| `lines[].plain` | **照着念这个**(标记不念) |
| `lines[].draft` | 草稿时间(相对本段);fixed 段就是字幕窗口 |
| `cues` | 提示点顺序;`needs` = 从上一个提示点(或段首)到这里动画至少要的秒数(`needsBefore` / `markNeeds` 是按句列的同一个数) |
| `tail` | 最后一个提示点之后动画还要的秒数 |

上例:第一句开口后至少 0.6 秒才能说到「切线」,之后至少 0.733 秒第二句才能开口,第二句开口后动画还要 7.206 秒。

**实测 `measured.json`** 的格式见 10.3 的例子。

**时间表 `timing.json`**(交付物;Schema 在 `docs/voice-timing.schema.json`)。上例修好后,每句一个音频:

```json
{
  "version": 1,
  "film": "appx-voice",
  "segments": [
    { "id": "parabola", "duration": 8, "lines": [
      { "id": "parabola/1", "text": "先画出一条抛物线。", "start": 0.2, "end": 2.6, "audio": "parabola-1.m4a" },
      { "id": "parabola/2", "text": "它的方程是 y 等于 x 的平方。", "start": 3.6, "end": 7.1, "audio": "parabola-2.m4a" } ] },
    { "id": "slope", "duration": 11.1, "lines": [
      { "id": "slope-1", "text": "在 x 等于 1 处画一条<mark name=\"t\"/>切线。", "start": 0.3, "end": 3.2, "audio": "slope-1.m4a", "marks": { "t": 2.3 } },
      { "id": "slope-2", "text": "它的斜率是 2,正好是 2x 在这一点的值。", "start": 3.45, "end": 8.05, "audio": "slope-2.m4a" } ] }
  ]
}
```

另两种写法(可混用):段级 `"audio": "parabola.mp3"` 整段一个文件,从段首播;`"audio": { "file": "all.m4a", "offset": 12.5 }` 一个长文件管几段,`offset` = 这段从文件第几秒开始。这两种的 `lines` 只写 `id`、`start`、`end`(和 `marks`),只管字幕和提示点。

| 字段 | 必填 | 说明 |
| --- | --- | --- |
| `version` / `film` / `locale` | 否 | 不参与校验 |
| `segments[].id` / `duration` | 是 | 按 id 对应(顺序无所谓);时长是正数秒 |
| `segments[].audio` | 否 | 整段一个音频,从段首播;字符串或 `{ "file", "offset" }` |
| `segments[].lines` | timed 段必填 | timed 段每句都要有,缺一句整段按草稿播、没声音(只给段级 `audio` 也一样);fixed 段省了就保留原字幕时间 |
| `lines[].id` / `start` / `end` | 是 | 秒,相对本段;`end` 只管字幕消失,不截断声音 |
| `lines[].text` | 否 | 录音时的台词;和现稿不同就提醒「台词改过了」 |
| `lines[].audio` | 否 | 从 `start` 播到文件结束(最多到段尾) |
| `lines[].marks` | 否 | `{ "标记": 秒 }`,相对**本段**开头(`measured.json` 里相对句首) |

### 10.5 规则

- **id** 照抄台词稿。**时间**一律是秒、相对本段开头;段内按开口排序、互不重叠,`0 ≤ start < end ≤ duration`(只有 `end ≤ duration` 有 0.05 秒容差;下一句 `start` 早于上一句 `end` 哪怕 0.001 秒也算重叠,整段作废)。
- **标记**:每个 `<mark>` 都在 `marks` 里给出时刻,落在这句起止之内。没给的按字数比例估,落在外面的收进来,都给提醒。
- **timed 段**的时长由配音方定,但要满足动画:按 `cues` 顺序,每个提示点时刻(整句 = 那句的 `start`,标记 = 那个词的时刻)≥ 上一个提示点 + `needs`;`duration` ≥ 最后一个提示点 + `tail`,也 ≥ 最后一句说完(最后一个提示点之后有跟着台词伸缩的动画时,以 `voice:check` 为准)。建议段首 ≥ 0.3、句间 ≥ 0.25、段尾 ≥ 0.6 秒。
- **fixed 段**:`duration` 照抄台词稿;每句从自己字幕窗口开头说起,不说进下一句开口,也不超过段尾。
- **音频**:mp3、m4a(AAC)、wav、ogg(Opus),以浏览器能解码为准;单声道 / 立体声、44.1 / 48 kHz 都行。
- **路径**相对 `timing.json` 所在目录。别用 `/` 开头(`voice:check` 当成文件系统绝对路径,误报不存在);完整网址放在别的域名下要开 CORS,否则播放和导出都读不到。
- **结构错误整段作废**(timed 段改按草稿、没有声音,`voice:check` 连带报「在时间表里没有」):分段缺 id、id 重复、`duration` 不是正数、`audio` 写法不对、`lines` 不是数组;任一句缺 id、id 重复、起止不合法、重叠或乱序、`audio` 写法不对。

### 10.6 校验报错与提醒

`voice:check` 先列错误再列提醒,方括号里是 `分段id / 台词id`,末行三选一:`N 个错误,M 个提醒:时间表还不能交付`(退出码 1)/ `没有错误,M 个提醒` / `✓ 时间表没有问题`。**错误** = 这一项用不了(整段作废、按草稿播或没声音);**提醒** = 能用但要看一眼,不影响退出码。

| 错误原文(`X`、`…` 是占位) | 原因 → 怎么改 |
| --- | --- |
| `时间表格式不对:需要一个带 segments 数组的对象` | 顶层写 `{ "segments": [ … ] }` |
| `第 N 个分段缺少 id` / `分段 id「x」重复,后一个被忽略` / `分段「x」的 duration 需要正数` / `分段「x」的 audio 写法不对(字符串,或 { file, offset })` / `分段「x」的 lines 需要数组` | 分段结构错,整段作废 → 按文案补齐 |
| `分段「x」第 N 句缺少 id` / `…的 id「y」重复` / `台词「y」的 audio 写法不对` | 句子结构错,整段作废 → 按文案补齐 |
| `台词「y」的起止不合法(需要 0 ≤ start < end ≤ 本段时长 D)` | 越界(手写时 fixed 段句尾写到了段尾之后也是它)→ 改时间,或压缩这句 |
| `台词「y」和上一句重叠或乱序(S 早于上一句结束 E)` | 往后挪,或压缩上一句 |
| `分段「名」(id「x」)在时间表里没有:它会按草稿时间播,没有声音` | timed 段 id 没对上,或因结构错误被丢 → 核对 id,先修结构错误 |
| `时间表缺少台词 「a」「b」,这一段先按草稿时间播(没有声音)` | 补上缺的句子 |
| `音频文件「f」不存在` | 路径相对 timing.json,别用 `/` 开头,在最终位置校验 |
| `动画来不及:第 N 个提示点(台词「x」开口 / 台词「x」的标记「k」)排在 A 秒,动画 B 秒才走到,晚了 C 秒` | 把那句(或那个词)往后挪 C 秒 |
| `动画比时间表长 C 秒:动画 B 秒才跑完,时间表只给了 D 秒` | `duration` 至少加 C 秒 |
| `台词「x」到 E 秒才结束,超出了这段动画的 D 秒(会被截断)` | fixed 段:压缩这句,或加长分段、重新导出台词稿 |
| `按时间表干跑时脚本出错:…` / `按时间表干跑 X 秒还没结束` / `没有干跑环境,排不了草稿:…` / `排草稿失败,这一段按字数估的时长播:…` | 脚本的问题 → 先跑内容测试,修脚本 |

| 提醒原文 | 意思 / 怎么办 |
| --- | --- |
| `台词改过了:时间表按「旧」做,现在是「新」,这句需要重做` | 这句要重新配 |
| `时间表没给标记「k」的时刻,按字数比例估在 X 秒` | 补上 `marks` |
| `标记「k」(t)不在这句的起止之内,已收到 c` / `台词「x」的 marks 需要对象,已忽略` / `标记「k」的时刻不是数字,已忽略` | 标记写得不对 |
| `时间表里的台词「x」在分段里没有声明,已忽略` / `时间表里的分段「x」在影片里找不到,已忽略` | 多半是 id 拼错,或分段改了名 |
| `分段「名」(id「x」)在时间表里没有:这一段没有配音` | fixed 段没配音;本该有就核对 id(卡片类 id = 分段名) |
| `这一段的动画时长固定为 D 秒,时间表写的是 T 秒:按动画时长播,多出的声音会被截掉` | fixed 段时长不能变 |
| `时间表有 N 句,分段字幕有 M 条:按时间表的句子显示字幕` | 字幕文字按序号取原字幕,多出的原字幕被丢掉 |
| `第 N 句的 id 应该是「分段/N」,时间表写的是「x」` | fixed 段台词 id 写错 |

**只在 `voice:layout` 出现**(前两条之后 `voice:check` 不会再报,必须在排期时修;后两条不处理,`voice:check` 会报「动画来不及」):

| 原文 | 级别 → 怎么办 |
| --- | --- |
| `缺少台词「x」的实测音频,先按草稿时长 T 秒占位` / `缺少台词「x」的实测音频:这句按字幕窗口显示,没有声音` | 错误 → 补实测 |
| `台词「x」说了 T 秒,这段动画时长固定,它会撞上下一句(S 秒开口)/ 段尾(D 秒):请压缩到 L 秒以内` | 错误 → 压缩到 L 秒以内 |
| `台词「x」比字幕窗口长 C 秒(没撞上下一句,可以接受)` | 提醒 → 可不管 |
| `第 N 个提示点(台词「x」开口)排在 A 秒,动画要到 B 秒才走到` | 提醒 → 手动把这句往后挪 |
| `标记「k」在这句里说得太早:动画还要 C 秒才走到。请在这个词前面加 C 秒停顿(或把这句拆成两段音频)` | 提醒 → 照做 |

`voice:script` 报 `分段 id「x」重复:配音会对不上,请给其中一段设一个不同的 id`:两个固定时长分段同名(如都叫「小结」),给其中一个 `directedSegment` 设 `{ id }` 或改名;`分段「名」排草稿失败,台词稿里只有按字数估的时间:…` → 修脚本。

### 10.7 在页面上听

- **换了配音要刷新页面**:时间表只在加载时读一次(播放和 `?preview=` 共用)。
- **「开启声音」按钮**只在至少一段挂上音频时出现;程序里调 `controller.setAudioEnabled(true)` 必须在点击回调里同步调用。
- **页面上不报配音问题**:时间表问题只写控制台 `[voice] …`;音频取不到或解不开写 `[audio] 音频加载失败,按静音处理:<地址>`(那几句静音);`timing.json` 不存在或不是合法 JSON 时当作没配音,**什么都不报**。交付前一定跑 `voice:check`。
- 暂停、跳转、切段、切后台再回来,声音都跟画面对齐,每段按实际起点锚定,不会越播越偏。
- 部署在子路径下要配 Vite 的 `base`(配音地址按 `import.meta.env.BASE_URL` 拼)。

### 10.8 参考实现:npm run voice:demo

`scripts/voice-demo-say.mjs` 用 macOS 的 `say` 跑完整条流水线,也是写对接代码的样板:换成真配音只替换第 2 步。

```bash
npm run voice:demo                        # 给 voice-demo 配音,写进 public/voice/voice-demo/
npm run voice:demo -- --voice Tingting    # 指定声音(缺省 Tingting;say -v '?' 列出)
npm run voice:demo -- --dry-run           # 不合成,按草稿时长假装量出来,只验证流程
```

其它选项:`--rate`(每分钟字数)、`--film`(catalog 键)、`--out-dir`、`--help`。没有中文声音时提示去「系统设置 → 辅助功能 → 朗读内容 → 系统声音」下载。流程:`voice:script` → 逐句 `say` 合成、`afinfo` 量时长、`afconvert` 转 `.m4a`(标记前的文字单独合成,时长就是标记时刻)→ `measured.json` → `voice:layout` → `voice:check`(有错误退出码 1)。文件名如 `01-01-parabola_1.m4a`(段号-句号-台词 id,`/`、汉字等换成 `_`)。

非 macOS 且没加 `--dry-run` 时直接退出;沙箱里 `say` 出空文件,脚本报「语音合成没有工作…请在自己的终端里运行」。仓库里没有 `public/voice/voice-demo/` 时演示片没声音、没「开启声音」按钮,先跑一次。

## 11. 导出视频

### 11.1 从页面导出

选画幅(发片一般 `16:9`)→ 有下拉框时选格式 → 点「导出」。按钮变成「取消 N%」(按片内位置,转场不计),再点一下取消。完成后自动下载;配音情况看琥珀色提示条([11.5](#115-成片里的配音)),失败显示红条([11.6](#116-导出失败)),自己取消不报错。

页面导出**只用缺省**:`auto`、30 fps、长边 1920、字幕和进度条烧进成片、有配音就带。格式下拉「自动」(MP4 优先)/ `MP4` / `WebM` 只列浏览器真能导的,两种都能导才显示;一种都不行就没有「导出」按钮。要改就改 `src/App.tsx` 的 `startExport`([11.2](#112-程序里导出))。

- **画幅按点「导出」那一刻算**;离线导出途中换画幅不影响成片,实时录制期间画幅、暂停、跳转、声音开关都被锁。
- 离线成片:`16:9` → 1920×1080,`4:3` → 1920×1440,`9:16` → 1080×1920(走竖屏分支);「全屏」= 窗口比例(1440×789 → 1920×1052)。
- 文件名 `<?scene=>-<full|w16h9|w4h3|w9h16>-<年月日>-<时分秒>.<mp4|webm>`,如 `derivatives-w16h9-20260924-141500.mp4`。
- 成片长度 ≈ Σ 各段实际时长 + 段数 × 0.6 秒(每段定格后淡出)。
- 导出中关页会弹确认;读屏播报开始、每 10% 进度和结果。`auto` 改走实时录制时片子从头重播、按钮被锁,别切走标签页。

### 11.2 程序里导出

`controller` 是 `runFilm(canvas, segments, options)` 的返回值;页面上 `filmEntry` 把它包成场景句柄,句柄的 `exportVideo` 原样转给它。

```ts
const handle = controller.exportVideo({
  mode: 'auto',           // 'auto'(缺省)| 'offline' | 'realtime'
  fps: 30,                // 只对离线有效,夹在 1~120;实时录制固定 30
  maxLongEdge: 1920,      // 长边上限,最小 320(maxWidth 是弃用的旧名)
  mimeType: 'video/mp4',  // 缺省自动(MP4 优先);显式指定而不支持时报 unsupported-mime,不静默换格式
  onProgress: (sec, total) => updateProgressBar(sec / total), // 按片内位置报
  audio: true,            // 有配音就带(缺省)
  progress: true,         // 带进度条(缺省);播放器 progress: false 时恒不带
});
const blob = await handle.done;   // 格式看 blob.type;失败或取消时 reject FilmError(11.6)
handle.mode;                      // 实际走的路;handle.cancel() 随时取消
handle.audio;                     // { status, codec?, reason?, note?, failed? }(11.5)
```

同一时间只能一个导出(第二个报 `busy`);播放器销毁时以 `disposed` 中止。成片带不带字幕由播放器的 `subtitles` 选项决定,页面上一律开着。

### 11.3 走哪条路:auto、offline、realtime

1. `mode: 'realtime'` → 实时录制。
2. 否则有 WebCodecs → 离线导出。编不了所选容器:`auto` 改走实时录制,显式 `offline` 报 `unsupported-mime`。有配音而离线带不上(没有 OfflineAudioContext 或编不了音频):`auto` 且实时录制录得进时改走实时录制,否则出**无声**成片,`handle.audio.status = 'dropped'`。
3. 没有 WebCodecs:`auto` → 实时录制;显式 `offline` 报 `unsupported`。

回退时 `handle.mode` 从 `'offline'` 变成 `'realtime'`。

### 11.4 离线逐帧 vs 实时录制

| | 离线逐帧(缺省) | 实时录制(回退) |
| --- | --- | --- |
| 原理 | 离屏画布 + 虚拟时钟逐帧推进,WebCodecs 编码 | `captureStream(30)` + `MediaRecorder`,实时播一遍 |
| 速度 | 比实时快,不掉帧 | 等于片长 |
| 预览 | 照常播放、跳转、换画幅(可能掉帧) | 锁定,从第 0 段重播;有配音时**会出声** |
| 后台标签页 | 照样导出 | 立即失败(`hidden`) |
| 尺寸 | 长边直接取 `maxLongEdge`(矢量,不糊) | 画布等比缩到长边 ≤ `maxLongEdge`,不放大 |
| 编码 | MP4:H.264 → HEVC → AV1 → VP9,音频先 AAC 后 Opus;WebM:VP9 → VP8 → AV1,音频 Opus / Vorbis | 视频 8 Mbps,音频 128 kbps |
| 内存 | 整部成片在内存里,收尾时短暂翻倍 | 分块收集 |
| 兜底 | 超过 `(Σduration + 段数 × 1.2 + 5) × 2` 秒 → `overrun` | 看门狗(画布污染、轨道结束或静音、编码器停、8 秒没数据)+ 空成片检查 |

两条路的合成(白场、字幕、进度条)与预览相同。

### 11.5 成片里的配音

配音问题**不会**让导出失败,结果在 `handle.audio`(`done` 之后才是定论);页面用 `exportAudioMessage()`(`src/sceneRegistry.ts`)生成提示条和读屏文字。

| `status` | 什么时候 | 琥珀色提示条(原文) / 怎么办 |
| --- | --- | --- |
| `pending` | 导出进行中 | — |
| `none` / `off` | 没有配音 / `audio: false` | 无 |
| `included` | 配音进了成片 | 只有 MP4 里是 Opus 时:`成片含配音。MP4 里的音轨是 Opus,QuickTime / 访达预览可能放不出声音,请用浏览器或 VLC 播放。` → 换播放器 |
| `partial` | 有音频取不到或解不开,那几句静音 | `成片含配音,但N 个配音文件取不到或解不开,那几句是静音(a.m4a、b.m4a、c.m4a 等 N 个)。`(完整地址在 `failed`)→ 查路径、格式、CORS,刷新重导 |
| `dropped` | 有配音,成片里没有 | `成片没有配音:<原因>。` → 看下表 |

| `dropped` 的原因(原文) | 路 | 怎么办 |
| --- | --- | --- |
| `当前浏览器解码不了音频(缺少 OfflineAudioContext)` | 离线 | 换浏览器 |
| `浏览器编不了 <mime> 的音频` | 离线 | 换格式或浏览器 |
| `当前浏览器不支持 Web Audio,录不进配音` / `接不上录制用的音轨` / `浏览器的录制流加不了音轨` | 实时 | 换格式或浏览器 |
| `浏览器没有允许出声(音频上下文被挂起),录到的是静音` | 实时 | 再点一次「导出」 |
| `录制途中声音被关掉了,录到的是静音` | 实时 | 重新导出 |

### 11.6 导出失败

`done` reject 一个 `FilmError`,按 `code` 分支(别匹配文案);页面红条显示 `message`,用户取消不弹错。

| `code` | `message` 原文 | 怎么办 |
| --- | --- | --- |
| `cancelled` / `disposed` / `busy` / `no-segments` | `导出已取消` / `播放器已销毁,…` / `已经在导出了` / `影片没有任何分段` | 取消;切了场景;等上一次;空清单 |
| `unsupported` | `当前浏览器不支持离线导出(缺少 WebCodecs),请改用实时录制` / `…视频导出(缺少 MediaRecorder)` / `当前浏览器没有可用的视频容器(mp4 / webm 都不支持)` | 换浏览器;显式 `offline` 改 `auto` |
| `unsupported-mime` | `当前浏览器无法离线编码 X` / `当前浏览器不支持导出 X` | 格式选「自动」 |
| `init` / `encoder` | `导出初始化失败:…` / `编码器初始化失败:…`、`视频编码失败:…`、`音频编码失败:…`、`视频收尾失败:…` | 换格式试试 |
| `composite` | `导出合成连续 N 帧失败:…` | 连续 30 帧以上合成抛错 |
| `overrun` | `影片播了 X 秒还没结束(声明总时长 T 秒),导出中止` | 某段停不下来或 `duration` 严重少写 → 跑内容测试 |
| `segments-failed` | `所有分段都启动失败,导出中止` | 看控制台 `[film]` |
| `crashed` / `recorder` | `播放器异常退出:…`、`离线导出异常:…` / `编码器出错:…`、`编码器启动失败:…`、`编码器收带失败:…` | 内部异常 / MediaRecorder 出错 |
| `hidden` | `导出期间请保持页面可见(后台标签页会录出静帧)` | 保持前台重导 |
| `tainted` / `track-ended` / `track-muted` / `recorder-stopped` / `stalled` / `empty-output` / `encoder-starved` | `导出中断:…` / `导出失败:成片是空的…` | 实时录制的看门狗与收带检查 |

单个分段出错不会让导出失败(跳过接着导,控制台 `[film] 分段「x」启动失败`),所有段都起不来才报 `segments-failed`。

## 12. 排错速查

按「在哪里看到」分组。`X`、`…` 是占位。

### 12.1 内容测试 `node scripts/test.mjs content`

| 看到什么 | 原因 → 怎么修 |
| --- | --- |
| `声明时长 D 秒,实际时间线 X 秒` | 时长账不对 → 改 `duration` 或补删 `env.wait`。动画缺省 1 秒,`Wiggle` 2 秒,`env.play(a, b)` 取最长,`listSegment` = 条目数 × (1 + gap) + holdSeconds |
| `分段在 duration + 5 秒内没有结束(已播 X 秒)` | 死等(`env.wait(Infinity)`、永不 resolve 的 Promise)或 `duration` 少写 5 秒以上 |
| `分段运行中报错:…` | 脚本抛错,或引擎 `console.error`(`[CanvasRenderer] 对象绘制抛错…`、`[Scene] updater 抛错,已移除`、`[Scene] 动画插值抛错,已终止该时间线`) |
| `…Create 需要支持描边生长的对象:对象本身(Annotation)不支持`(或 `Cube`…、「其中的子元素」) | `Create` 用在 `Annotation`、3D 网格、空 `Group` / `Layout`、少于 2 点的 `Polygon` 上 → 改 `FadeIn` |
| `…Transform:目标对象不在场景里 —— 两个都要先 scene.add…`(或「源对象」) | 两个都 `scene.add`,目标先藏 |
| `字幕区间非法:…` / `字幕重叠或乱序:…` / `字幕「…」在 E 秒结束,晚于分段结束(X 秒)` | `[start, end)` 递增不重叠,末条 ≤ `duration` |
| `卡片「名」需要 title 与 titleTex 二选一` | `cardSegment` 只给一个 |
| `超时:10000ms 内没有结束(挂起的 Promise?)`(之后的用例不再执行) | `TEST_TIMEOUT=30000 node scripts/test.mjs content` |
| 新影片不在结果里 / timedSegment 报时长不符 | `content.test.ts` 写死了影片清单,按 [5.7](#57-注册新片) 加;含 `timedSegment` 的按 [5.5](#55-timedsegment按台词对齐) 单独测(先 `prepareVoice`) |

内容测试**不查** TeX 错误、重叠出框、提前露出、竖屏,只能 `?preview=` 逐段看。

### 12.2 画面不对(预览、播放时)

| 症状 | 原因 → 怎么修 |
| --- | --- |
| 对象第一帧就露出,出场时「啪」地消失再出现 | 没[先藏后揭](#34-先藏后揭):`FadeIn` 前 `opacity = 0` / `hide()`,`Create` 前 `unrevealed()`;`Transform` 的目标、`Succession` 后面的对象也要藏 |
| `Create` 播完还看不见 | 用 `opacity = 0` 藏的,`Create` 不管不透明度 → 改 `unrevealed()` |
| `Write` 播完公式还看不见 | `Write` 前藏了 → 不藏,或 `Write` 前一行把 `opacity` 改回 1 |
| `FadeIn(组)` 后某个子元素没出来 | 藏在了子元素上 → 只藏被 `FadeIn` 的那层 |
| 第二次变形时旧形状留着;对变形过的对象做动画没反应 | `Transform` 是替换语义 → 后续都对目标做:`Transform(a, b)` 后写 `Transform(b, c)` |
| 公式显示成红字 | TeX 语法错或未定义命令(`\bm` 换 `\boldsymbol`;`\textcolor[HTML]` 改 `\textcolor{#2563eb}{…}`);测试抓不到 |
| 字幕压住画面底部 | 字幕折成两行(每条 ≤ 20 字);无字幕段没有安全区,进度条(18 px,有章名 38 px)压到内容;对象没进 `fitObjects` |
| 关键镜头看不见或一闪就没 | 在段首 0.6 秒内被白场盖着 → 挪到 t ≥ 0.6 |
| 段尾像淡出两次 | 段尾写了 `FadeOut` → 以停留收尾 |
| 背景有淡方格和十字 | `env.scene.setTheme({ ...lightTheme, showGrid: false, showAxes: false })` |
| 章名显示成「一 · 第一章」 | `chapter` 只写短标题,编号自动加 |
| `[Tex] 公式内容 1 秒内变了 N 次…` | 逐帧变的读数改用 `Label`,固定小数位 |
| `Scene.fitObjects: 包围盒含非有限值,已忽略` | 坐标算出了 NaN |
| `[film] 分段「x」启动失败` / `播放出错` | 这段被跳过 → 跑内容测试看完整报错 |

### 12.3 竖屏(9:16)

点 `9:16` 再用 `?preview=秒` 逐段看(测试和配音工具只跑横屏)。

| 症状 | 原因 → 怎么修 |
| --- | --- |
| 并排的图和公式挤成一小条 | 没写竖屏分支 → `isNarrow(env.scene)` 分两套坐标:图在上(如 `{ x: 0, y: -170 }`),公式在下(`sideColumn` 竖屏首行 y 60、行距 70) |
| 有对象出画 | 按最大包络取景(`stage` 第 4 参数 `fitExtra`) |
| 切 9:16 或转屏时当前段从头播 | 预期行为(重建当前段) |
| 节奏和横屏不一样 | 竖屏分支只改布局,不改时间线 |

### 12.4 配音

| 症状 | 原因 → 怎么修 |
| --- | --- |
| 没有「开启声音」按钮 | 一段音频都没拿到:`public/voice/<voiceId>/timing.json` 不存在(演示片是 `voice-demo`)、不是合法 JSON(静默)、没写 `audio`、id 全没对上或整段被丢、没刷新 → 跑 `voice:check`,0 错误后刷新 |
| 有几句没声音 | 控制台 `[audio] 音频加载失败,按静音处理:<地址>` → 修路径、开 CORS 或转 m4a / mp3 |
| 有按钮但完全没声音 | 没点「开启声音」,或 `setAudioEnabled(true)` 不在点击回调里同步调用 |
| 字幕和声音对不上,或按草稿播 | 这段没套上时间表(控制台 `[voice] …`;缺整段时页面不报)→ `voice:check`,按 [10.6](#106-校验报错与提醒) 修 |
| 固定时长段的声音在段尾被截断 | 压缩配音,或加长 `duration` 并重新导出台词稿 |
| 红条「场景加载失败:timedSegment「…」…」 | 构造校验失败 → 按文案补 id、去重、去空台词 |
| `[film] timedSegment「…」没有经过 prepareVoice…` | 绕过了 `filmEntry`,或测试没先 `prepareVoice` |
| `没有名为「x」的影片;可选:…` | `FILM_CATALOG` 加一行,键 = voiceId |
| `voice:check` 说音频不存在,文件明明在 | 路径以 `/` 开头,或校验的不是最终目录的 timing.json |

### 12.5 导出

红条见 [11.6](#116-导出失败),琥珀色提示条见 [11.5](#115-成片里的配音)。

| 症状 | 原因 → 怎么修 |
| --- | --- |
| 成片比例不对 | 停在「全屏」或别的画幅 → 先点 `16:9` |
| 不想要字幕或进度条 | 进度条:`startExport` 里给 `exportVideo({ mimeType, onProgress })` 加 `progress: false`;字幕:`filmEntry` 里写 `runFilm(canvas, segments, { onPausedChange: hooks.onPausedChange, subtitles: false })`(播放时也没有)。别绕过 `filmEntry`(会跳过 `prepareVoice`) |
| 没有「导出」按钮 | 演示场景(`kind: 'scene'`)、地址带 `?preview=`,或浏览器 MP4、WebM 都导不了 |
| 导出很慢,片子从头实时播 | 改走了实时录制 → 保持前台等它播完 |

### 12.6 测试、类型检查、lint、加载

| 看到什么 | 原因 → 怎么修 |
| --- | --- |
| `期望 film,derivatives,topology,voice-demo,实际 …` | `voiceDemo.test.ts` 写死了影片目录 → 加上新片名([5.7](#57-注册新片)) |
| 红条「场景加载失败:…」 | 内容模块 import 时抛错 → 按文案修 |
| `error TS6133: 'x' is declared but its value is never read.` / `TS6192` | 删掉没用的 import / 变量 |
| `error TS1484: 'X' is a type and must be imported using a type-only import…` | `import type { X }`,值和类型分两行 |
| `error TS1294: This syntax is not allowed when 'erasableSyntaxOnly' is enabled.` | 别用 `enum`、`namespace`、构造函数参数属性 |
| `… is possibly 'undefined'.` | `noUncheckedIndexedAccess` → `arr[i] ?? 0` |
| lint `film 不能依赖 app…` / `scenes 不能依赖 film / app…` | 去掉反向 import;场景里直接 `opacity = 0`、`setRevealFraction(0)` |
| lint `'scene' is already declared in the upper scope.` | 局部变量和 import 的助手(`tex`、`hide`…)重名 → 换名 |
| lint `Unexpected console statement.` / `Expected === and instead saw ==` | 删 `console.log`(警告也算失败);写 `===` |
| `✗ 发现 N 个依赖环(含纯类型 import):` | 内容文件 import 了 `catalog.ts` / `sceneRegistry.ts`,或子文件反向 import 影片文件 |
| 测试全过,`npm run typecheck` 却报错 | 测试只剥类型 → 提交前跑 `npm run check` |

## 13. 附录:开发者

### 13.1 不做影片、只做独立场景

独立场景(`kind: 'scene'`)没有字幕、进度条、转场、导出、配音和 `?preview=`,适合可交互演示。不同之处:`src/scenes/` 不能 import film(用不了 `hide` / `unrevealed`);没有 `env.play`,直接 `scene.play`,场景销毁后 `play` / `wait` 立即返回,**每个 `await` 之后都要查是否已取消**;句柄必须实现 `setPaused`(系统开了「减少动态效果」时一打开就会暂停)。

```ts
// src/scenes/appxDemo.ts
import { Circle, Create, FadeIn, Indicate, Scene, Tex, lightTheme } from '../engine';
import type { SceneHandle } from './types';

/** 独立演示:画一个圆,淡入面积公式,再高亮一下;播一遍后停在最后一帧。 */
export function runAppxDemo(canvas: HTMLCanvasElement): SceneHandle {
  const scene = new Scene(canvas, { theme: lightTheme });
  scene.setInteractionEnabled(false); // 关掉拖拽和滚轮缩放
  const circle = new Circle(80).setStyle({ stroke: '#2563eb' });
  const formula = new Tex('S = \\pi r^2').setStyle({ fontSize: 36 });
  formula.moveTo({ x: 0, y: 130 });
  circle.setRevealFraction(0); // 先藏后揭
  formula.opacity = 0;
  scene.add(circle, formula);
  scene.fitObjects([circle, formula], 40);

  let cancelled = false;
  const steps = [
    () => scene.play(new Create(circle, { runTime: 1.5 })), // 0–1.5
    () => scene.wait(0.5), // 1.5–2
    () => scene.play(new FadeIn(formula)), // 2–3
    () => scene.play(new Indicate(formula)), // 3–4
  ];
  const run = async (): Promise<void> => {
    for (const step of steps) {
      await step();
      if (cancelled) {
        return; // 每个 await 之后查一次
      }
    }
  };
  run().catch((e: unknown) => console.error('[appxDemo] 播放出错', e));

  return {
    dispose: () => {
      cancelled = true;
      scene.dispose();
    },
    resize: () => scene.resizeAndRefit(),
    setPaused: (paused) => scene.setPaused(paused),
  };
}
```

在 `src/sceneRegistry.ts` 的 `SCENES` 里加一项,`/?scene=appxdemo` 就能打开:

```ts
appxdemo: {
  title: '圆的面积',
  kind: 'scene',
  interactive: false, // 只管画布的无障碍属性;真正开关平移缩放的是 setInteractionEnabled
  load: async () => {
    const { runAppxDemo } = await import('./scenes/appxDemo');
    return (canvas) => runAppxDemo(canvas); // 第二个参数 hooks:reducedMotion、onPausedChange(paused)
  },
},
```

要字幕、导出、配音就写成影片分段([2. 第一部片子](#2-第一部片子))。

### 13.2 开发与测试

```bash
npm run typecheck        # tsc -b
npm run lint             # oxlint --deny-warnings + scripts/check-imports.mjs(纯类型 import 的环)
npm test                 # src 下全部 *.test.ts(x)
node scripts/test.mjs content                     # 只跑路径含关键字的测试文件
TEST_TIMEOUT=30000 node scripts/test.mjs content  # 单条用例超时 30 秒(缺省 10)
npm run check            # typecheck + lint + test + test:runner,提交前跑
npm run build            # 生产构建到 dist/
npm run bench            # 性能基线比对(--save 存基线;--strict 慢 25% 以上退出码 2)
```

测试壳 `src/testing/harness.ts`(`suite`、`ok`、`equal`、`close`、`throws`、`rejects`、`fakeCtx`、`stateAt`……);文件以 `.test.ts` 结尾,`export default suite('名字', [[用例名, async () => { … }], …])`。**一条超时就中止整轮**。运行器只剥类型不查类型。端到端用 `installDomStub()`:`dom.frame(16)` 推一帧、`await dom.flush()`,用完 `dom.restore()`。

### 13.3 目录与分层

```
src/
  App.tsx / main.tsx   # 宿主:画布、工具条、导出按钮
  sceneRegistry.ts     # SCENES 注册表(filmEntry:加载 → prepareVoice → runFilm)
  engine/              # 引擎,不依赖 React;index.ts 是唯一出口
  audio/               # 声音层:混音、解码、实时播放
  film/                # 播放器与内容;film.ts 是对外出口,helpers.ts 是助手,catalog.ts 是影片目录(配音工具用)
  export/              # 导出:录制、合成、离线编码、错误模型
  scenes/              # 单场景 demo 与场景句柄契约
  testing/             # 测试壳与桩
scripts/               # 测试运行器、依赖环检查、bench、配音工具
public/voice/<voiceId>/  # timing.json 与音频
```

依赖单向:app → film → scenes → engine;app、film、scenes → export;film、export → audio。oxlint 检查分层(含 `import type`);内容文件别 import `catalog.ts` 或 `sceneRegistry.ts`。

### 13.4 已知取舍

- 3D 用画家算法,没有 z-buffer,穿插的面会穿帮。
- 离线导出整部成片在内存里,与预览共用主线程。
- TeX 写错排成红字,测试抓不到。`Transform` 逐点线性插值(同 Manim),按顺序配对。
- 内容测试和配音工具只跑 1280×720 横屏。

### 13.5 更多文档

README 是主文档;[docs/segment-authoring.md](docs/segment-authoring.md)、[docs/explainer-vocabulary.md](docs/explainer-vocabulary.md)、[docs/voice.md](docs/voice.md)(给配音方)、[docs/api.md](docs/api.md) 只作延伸阅读,有些地方比 README 旧,有出入以 README 为准。
