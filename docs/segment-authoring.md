# 从零写一个分段

分段是影片的最小叙事单位:一个布景 + 一条时间线 + 若干字幕。
本教程带你写一个 8 秒的分段,接进影片,跑通测试,用单帧预览检查画面。

约定:内容脚本放在 `src/film/`(如 `derivatives.ts`),引擎从 `../engine` 拿,
分段模板与类型从 `./film` 出口拿(分层检查会拦住其它方向的引用)。

## 1. 选模板

- `cardSegment`:标题卡/章节卡/片尾卡 —— 大标题 + 横线 + 第二行,1 秒开场后停留。
  时长自动 = 1 + `holdSeconds`,不用手算。
- `directedSegment`:导演式分段 —— 自己布景、自己写时间线。下面全程用它。
- `listSegment` / `chapterCard`(`helpers.ts`):逐条列点、章节卡,都是包好的一段。

## 2. 写一个 8 秒分段

```ts
// src/film/slope.ts
import { Axes, Create, FadeIn, FunctionGraph, Label, Tex } from '../engine';
import { directedSegment } from './film';
import type { Segment } from './film';

export const slopeSegment: Segment = directedSegment(
  '斜率', // 分段名(进度条提示、报错信息里显示它)
  8, // duration,秒:必须等于脚本实际时间线(第 4 节)
  [
    { start: 0.3, end: 3.8, text: '先画坐标系,再画一条直线。' },
    { start: 4.0, end: 7.8, text: '斜率就是这条直线倾斜的程度。' },
  ],
  async (env) => {
    const { scene } = env;
    const axes = new Axes([0, 5], [0, 4], 360, 280);
    const line = new FunctionGraph((x) => 0.6 * x + 0.5, axes);
    const formula = new Tex('k = \\frac{\\Delta y}{\\Delta x}').setStyle({ fontSize: 40 });
    formula.moveTo({ x: 0, y: 220 });
    const caption = new Label('斜率').setStyle({ fontSize: 24 });
    caption.moveTo({ x: -320, y: -200 });
    scene.add(axes, line, formula, caption);
    scene.fitObjects([axes, line, formula, caption], 40);

    await env.play(new FadeIn(axes, { runTime: 1 })); // 0~1
    await env.play(new Create(line, { runTime: 1.5 })); // 1~2.5,函数图像是矢量路径,描边生长
    await env.play(new FadeIn(formula, { runTime: 1 })); // 2.5~3.5
    await env.wait(1); // 3.5~4.5,停顿
    await env.play(new FadeIn(caption, { runTime: 0.5 })); // 4.5~5
    await env.wait(3); // 5~8,收尾停留
  },
);
```

时间线加起来:1 + 1.5 + 1 + 1 + 0.5 + 3 = 8,正好等于 `duration`。
`scene.fitObjects` 把内容框进画面(含字幕安全区,内容不会压到字幕上)。

## 3. 时间线写法

- `env.play(...动画)`:同播一组,`await` 到全部播完;`env.wait(秒)`:停顿。
- 用 `env.play` / `env.wait`,不要直接调 `scene.play`:跳转/销毁时它们抛取消哨兵,
  脚本直接结束;否则取消后脚本还在后台往已释放的场景上画。
- 长段同步搭建(循环建几十个对象)之后加一句 `env.checkpoint()`:取消检查点。
- `env.isCancelled()` 很少需要 —— 哨兵已经覆盖了 `play` / `wait` 之后的路径。
- 逐帧变化的数字用 `Label`,不要用 `Tex`:每个新串都要重新排版(1 秒换源 20 次会告警)。
- 窄屏(手机竖屏)分支:`helpers` 的 `isNarrow(scene)` 判断,`sideColumn` 排侧栏;
  同一分段在两种画幅下都要能看(布局只在搭建时求值一次,翻转会重建本段)。

## 4. 时长与字幕的契约(测试会卡)

- `duration` 必须等于脚本实际时间线,允许偏差 **0.25 秒**;
  分段必须在 `duration + 5` 秒内结束,否则内容测试失败。
- 字幕 `[start, end)` 左闭右开,不要重叠;`end` 不能晚于分段实际结束。
- 跑 `node scripts/test.mjs content` 即审计全片:每个分段干跑一遍,核对时长与字幕。

```bash
node scripts/test.mjs content   # 只审内容时序,很快
```

## 5. 接进影片

```ts
// src/film/derivatives.ts(或 program.ts)
import { slopeSegment } from './slope';

export const derivativesFilm: Segment[] = [
  // ...其它段
  slopeSegment,
];
```

章节卡(`marker: 'chapter'` + `chapter: '短标题'`)会在进度条上标出大刻度和章名(导出的成片里同样有);
普通段是小刻度,不用填。

## 6. 调试:单帧预览与秒级跳转

- 单帧预览:打开 `/?scene=derivatives&preview=480`,直接看第 480 秒那一帧,
  不用从头播。改 `?preview=` 的数字切帧;画幅按钮照常用(重画同一帧)。
  逐帧与离线导出同一套步进(30fps),主画面与成片逐像素一致;字幕和底部进度条(刻度、章名)
  是导出时另行合成的,预览里不画(字幕文本见 `previewFrameAt` 的返回值)。
  进度条占住画面底部约 38px(有章名时),别把要紧的内容压在那里。
- 进度条点击精确到秒:点哪跳到哪一秒(目标段重挂后快进过去)。
  方向键还是按段跳,PageUp/PageDown 按章节跳。
- 程序里也要逐帧:`previewFrameAt(segments, seconds, canvas)` 返回
  `{ index, offset, name, subtitle, position }`,字幕文本顺手可断言。
  播放器运行时跳转:`controller.seekToTime(seconds)`。

## 7. 要配音的分段:timedSegment

打算配音的分段用 `timedSegment` 写:声明台词(稳定 id + 文本,可用 `<mark name="k"/>` 标出要对齐的词),
脚本里用提示点踩时间,**不写 duration、不写字幕时间** —— 它们来自配音方交回的时间表;
没有时间表时,影片加载时干跑一遍排出草稿时间。

```ts
import { Create, Indicate } from '../engine';
import { timedSegment } from './film';

export const slope = timedSegment(
  {
    id: 'slope', // 稳定 id,配音方按它交音频;改显示名不影响配音
    name: '斜率',
    lines: [
      { id: 'slope-1', text: '先画出函数的图像。' },
      { id: 'slope-2', text: '这条切线的斜率<mark name="k"/>,就是导数。' },
    ],
  },
  async (env) => {
    env.scene.add(graph, tangent, formula);
    await env.play(new Create(graph));
    await env.untilLine('slope-2'); // 等第二句开口
    await env.play(new Create(tangent, { runTime: env.remaining('slope-2') * 0.4 }));
    await env.untilMark('slope-2', 'k'); // 正好说到「斜率」
    await env.play(new Indicate(formula));
  },
);
```

- 动画要赶在句中某个词之前完成时,用这句剩余时间的**比例**(如 `env.remaining(id) * 0.4`),或者干脆等那个标记;
  不要写成「句尾减 0.8 秒」这种常数 —— 配音一慢,常数就不够了。
- `node scripts/test.mjs voice` 跑配音相关的测试;`npm run voice:script -- <影片>` 看排出来的草稿时间与每个提示点前动画要多久。
- 和配音方的协作流程、时间表格式见 [voice.md](voice.md)。

## 8. 收尾检查

```bash
node scripts/test.mjs content  # 时长与字幕
npm run check                  # 类型 + lint + 全测试
npm run bench -- preview       # 快进性能没退化(可选)
```

然后正常播放一遍、导一段看看(导出默认离线渲染,比实时快)。
