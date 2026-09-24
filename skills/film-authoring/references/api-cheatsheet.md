# API 速查

只列写片子最常用的部分,签名与默认值和源码一致。完整参考在 `README.md`:第 5 节(分段与影片)、第 6 节(图元)、第 7 节(动画)、第 8 节(场景、相机与取景)、第 9 节(3D)。

## 目录

1. import 从哪来
2. 分段模板:directedSegment / cardSegment / timedSegment
3. SegmentEnv 与 scene
4. helpers
5. 图元
6. 动画
7. 样式与颜色

## 1. import 从哪来

| 来源 | 拿什么 |
| --- | --- |
| `'../engine'` | 图元、动画、缓动(`linear`、`smooth`、`thereAndBack`…)、`lightTheme`、3D |
| `'./film'` | `directedSegment`、`cardSegment`、`timedSegment`;类型 `Segment`、`Subtitle`、`SegmentEnv`、`TimedEnv` |
| `'./helpers'` | `tex`、`label`、`hide`、`unrevealed`、`fadeIns`、`stage`、`makePlot`、`plotIntro`、`fadeSequence`、`sweep`、`tangentProbe`、`isNarrow`、`sideColumn`、`columnList`、`texLine`、`labelLine`、`listSegment`、`chapterCard` |

类型一律 `import type`(`verbatimModuleSyntax` 打开着)。

## 2. 分段模板

```ts
directedSegment(name, duration, subtitles: Subtitle[], direct: (env: SegmentEnv) => Promise<void>,
                options?: { id?: string; marker?: 'chapter' | 'segment'; chapter?: string }): Segment
// Subtitle = { start: number; end: number; text: string; id?: string }   秒,相对段首,[start, end)
```

- `marker: 'chapter'` → 进度条大刻度;`chapter: '短名'` → 进度条章名(自动编号「一 · 短名」)。
- `id` 是稳定的配音 id(不写就用 `name`)。

```ts
cardSegment({ name, title | titleTex, heading? | headingTex?, narration, holdSeconds,
              titleSize = 56, headingSize = 24(公式 36), marker?, chapter? }): Segment
```

- duration = 1 + holdSeconds(自动);唯一一条字幕 `[0.3, duration)` = narration。
- `title` / `titleTex` 必须恰好一个,到播放时才检查。卡片没有 `id` 选项,配音 id 就是 `name`;拿不到 scene(关不了背景网格)。

```ts
timedSegment({ id, name, lines: { id: string; text: string }[], marker?, chapter?, draftRate = 4.5 },
             direct: (env: TimedEnv) => Promise<void>): TimedSegment
```

- 不写 duration、不写字幕时间:有 `public/voice/<voiceId>/timing.json` 按表,没有就干跑排草稿(首句 0.3 秒开口,句间 0.25,段尾 0.6;每句 = max(0.8, 字数 / draftRate + 逗号类 0.15 + 句号类 0.3))。
- `text` 里用 `<mark name="k"/>` 标要对齐的词(名字要带引号)。
- `TimedEnv` = SegmentEnv + `untilLine(id)`、`untilMark(lineId, mark)`、`remaining(id)`(这句还剩几秒,常作 runTime:`Math.max(下限, env.remaining(id))`)、`line(id)`、`now()`。
- 末尾自己写 `await env.wait(3)` 收尾停留。含 timedSegment 的片子不进 `content.test.ts`(照 `src/film/voiceDemo.test.ts` 先 `prepareVoice` 再审)。
- 构造时校验 id、台词 id 不重复等,不满足时 import 就抛错,整部片子加载失败。

## 3. SegmentEnv 与 scene

| 成员 | 说明 |
| --- | --- |
| `env.play(...动画)` | 同时开始,耗时取最长 runTime;查取消 |
| `env.wait(s)` | 停顿;查取消 |
| `env.checkpoint()` | 已取消就抛哨兵;放在大段同步搭建和 `scene.playFit` 之后 |
| `env.scene.add(...)` / `remove(...)` | |
| `scene.fitObjects(objs, pad = 0)` | 瞬时取景(已扣字幕安全区) |
| `scene.playFit(objs, { pad?, runTime = 1, rateFunc? })` | 运镜;不查取消,后面跟 `env.checkpoint()` |
| `scene.measureContext()` | 量尺,传给 `getBox` / `columnList` |
| `scene.addUpdater(fn)` | 返回注销函数;`fn(scene, dt)` 只在 play / wait 期间每帧调用 |
| `scene.getViewportSize()` | `{ w, h }` css 像素 |
| `scene.setTheme({ ...lightTheme, showGrid: false, showAxes: false })` | 关背景网格与原点十字(只影响本段) |

## 4. helpers(`'./helpers'`)

| 导出 | 签名 / 缺省 | 时长 |
| --- | --- | --- |
| `tex(src, size, at?, { displayMode? })` | 新建 Tex、设字号、移到 at | — |
| `label(text, size, at?)` | 单行画布文字;每帧变的读数用它(Tex 频繁换源码会慢) | — |
| `hide(...m)` / `unrevealed(...m)` | opacity = 0 / setRevealFraction(0) | — |
| `fadeIns(objs, runTime)` | `FadeIn[]`,配 `env.play(...fadeIns([a, b], 1.2))` | — |
| `stage(scene, objs, pad, fitExtra = [])` | add + `fitObjects([...objs, ...fitExtra], pad)`;fitExtra 只参与取景 | — |
| `makePlot({ xRange, yRange, width, height, fn, samples = 200, at })` | `{ plot: Group, axes, curve, W(x, y) }`;轴已藏、曲线已收起;`W` 数学坐标 → 世界坐标 | — |
| `plotIntro(env, p, { axesRunTime = 1, curveRunTime = 2.5, holdSeconds = 1, with? })` | 轴 FadeIn + 曲线 Create 同播,再停 | 3.5 |
| `fadeSequence(env, items, { runTime, gap })` | 逐个 FadeIn,每个之后停 gap(条目先 hide) | n × (runTime + gap) |
| `sweep(env, { from, to, runTime, draw, rateFunc = smooth })` | 每帧 `draw(值)` 从 from 补间到 to | runTime |
| `tangentProbe({ W, f, fp, clamp, halfSpan, readoutOffset = {x:0,y:-40}, format? })` | `{ dot, tangent, readout, parts, drawAt(a) }`;**先 `drawAt(a0)` 再 stage**,配 `sweep({ draw: probe.drawAt })` | — |
| `isNarrow(scene)` | 视口 w < h(竖屏) | — |
| `sideColumn(scene, count)` | `{ colX, colYs }`:横屏 colX 250、行距 70;竖屏 colX 0、首行 y 60 | — |
| `columnList(entries, { gap = 14, padding = 12, align = 'center', minWidth = 0, context? })` | 纵向列表 Layout(再 `moveTo`) | — |
| `texLine(s, size)` / `labelLine(s, size)` | 列表条目 | — |
| `listSegment({ name, duration, subtitles, entries: () => ListEntry[], gap, holdSeconds })` | 居中逐条 FadeIn 1 秒 + gap,再停 hold;**entries 必须是工厂函数** | 手写 n × (1 + gap) + hold |
| `chapterCard({ name, title, heading, narration, holdSeconds = 6 })` | = cardSegment + `marker: 'chapter'`、`chapter: title` | 7 |

## 5. 图元(`'../engine'`)

世界坐标:原点居中,x 右、y **下**,角度弧度**顺时针**;1 单位 ≈ 缩放为 1 时的 1 css 像素。所有图元:`moveTo(点)`、`shift(dx, dy)`、`scale`、`rotation`、`opacity`、`setStyle({...})`、`setRevealFraction(0–1)`、`getBox(ctx?)`。

| 图元 | 构造 | 备注 |
| --- | --- | --- |
| 圆 / 椭圆 | `new Circle(r = 50)` / `new Ellipse(rx = 60, ry = 40)` | |
| 矩形 / 正方形 | `new Rectangle(w = 120, h = 80)` / `new Square(s = 90)` | |
| 线 / 箭头 | `new Line(start, end)` / `new Arrow(start, end)` | 虚线 `setStyle({ dash: [6, 5] })` |
| 点 | `new Dot(r = 6)` | 实心 |
| 弧 | `new Arc(r = 45, startAngle = 0, endAngle = 1.5π)` | 顺时针 |
| 多边形 | `new Polygon(points, { closed = true })` | `setPoints(点[])`;`closed: false` 是折线(会变的曲线用它逐帧 setPoints) |
| 文字 | `new Label(text)` | 单行;`setText` 便宜 |
| 公式 | `new Tex(src, { displayMode? })` | 字号设在 Tex 自己身上;整条上色 `textColor` / `ColorTo`;局部 `\textcolor{#hex}{…}`;中文放 `\text{}` |
| 坐标系 | `new Axes(xRange, yRange, w, h, labels?)` | 内部数学坐标(y 上),`toLocal(x, y)`;刻度字号固定 10 |
| 函数图像 | `new FunctionGraph(fn, axes, samples = 200)` | 建好不能换函数;和 axes 放同一个 Group |
| 参数曲线 | `new ParametricCurve2D(fn: t => [x, y], axes, [t0, t1], samples = 240)` | |
| 数轴 / 网格 | `new NumberLine([min, max, step], opts)` / `new NumberPlane(xR, yR, w, h, opts)` | `format` 自定刻度文字 |
| 面积 / 黎曼和 | `new AreaUnderCurve(coords, fn, [a, b])` / `RiemannRectangles` + `RiemannTo` | 本地坐标,加进坐标系的组 |
| 切线 / 割线 | `new TangentLine(coords, fn, x, { length = 160 })` / `new SecantLine(coords, fn, x1, x2)` | `setX(...)` |
| 花括号 | `Brace.for(目标, 方向, { label })` / `new Brace(from, to, { label })` | 不能 Create |
| 角 / 直角 | `new Angle(顶点, a, b, { radius = 24, label? })` / `new RightAngle(顶点, a, b, { size = 12 })` | 不能 Create |
| 组 / 排版 | `new Group().add(...)` / `Layout` | 组移动、缩放绕原点(不是视觉中心);没有 arrange / nextTo |
| 3D | `Projection3D`、`Cube`、`Cylinder`、`Cone`、`Sphere`、`Pyramid`、`ParametricSurface` | 共用一个 Projection3D;一律 FadeIn |

## 6. 动画(`'../engine'`)

缺省 runTime 1、缓动 `smooth`。选项都是 `{ runTime?, rateFunc? }` 加各自的字段。

| 动画 | 构造 | 要点 |
| --- | --- | --- |
| 淡入 / 淡出 | `new FadeIn(m, { to? })` / `new FadeOut(m)` | FadeIn 前 `hide`;FadeOut 后对象仍在场景 |
| 描边生长 | `new Create(m)` | 前 `unrevealed`;不碰 opacity |
| 书写 | `new Write(m, { lagRatio? })` | 不要预先藏 |
| 移动 / 缩放 / 旋转 | `new MoveTo(m, 点)` / `new ScaleTo(m, k)` / `new RotateTo(m, 弧度)` | 父容器坐标;RotateTo 是绝对角。引擎没有「调暗到某个透明度」的动画(FadeIn 会先跳到 0),README 7.11 有 10 行的自定义 `OpacityTo` |
| 变形 | `new Transform(src, dst)` | dst 先 hide,两个都进场景;播完对 dst 操作 |
| 按结构变形 | `new TransformMatchingTex(src, dst, { partMap? })` | 同上;相同项平移 |
| 公式换内容 | `new FadeTransform(tex或label, '新源码', { shift = 12 })` | 同一对象原地换 |
| 换色 | `new ColorTo(m, '#hex' \| { stroke?, fill?, textColor?, strokeWidth? })` | 持久 |
| 强调 | `new Indicate(m, { scaleFactor = 1.2, part? })` / `new Circumscribe(m, { shape = 'rectangle', buff = 10 })` / `new Flash(m)` / `new Wiggle(m)`(2 秒) | 一闪就回去 |
| 编排 | `new AnimationGroup([...])` / `new LaggedStart([...], { lagRatio = 0.2 })` / `new Succession([...])` | 缓动 linear |
| 数值 | `new ValueTracker(v)` + `new TweenValue(tracker, to)`;或 helpers 的 `sweep` | 画面在 updater / draw 里按值重画 |
| 黎曼和加细 | `new RiemannTo(rects, { n?, sample? })` | 常用 1.2 秒 |
| 运镜 | `scene.playFit(objs, { runTime })`;`CameraMove` | |
| 3D | `new Orbit3D(projection, 圈数 = 1)`、`new Spin3D(mesh, 圈数 = 1)`、`new ParamMorph(surface, [终值])` | 改俯仰角的 `TiltTo` 是 README 9.5 的自定义动画 |

## 7. 样式与颜色

`setStyle` 常用键:`stroke`、`strokeWidth`(缺省 3)、`fill`、`dash`、`fontSize`、`textColor`、`fontFamily`。没有 `opacity` 键(直接设 `m.opacity`)。颜色一律 `#rrggbb` 或 `rgb()`(颜色名在 node 里插值不了)。

推荐语义色:墨色 `#1a1a1a` 主线,蓝 `#2563eb` 主对象,粉 `#db2777` 强调 / 切线,绿 `#16a34a` 结论 / 正确,紫 `#7c3aed` 次要,灰 `#9ca3af` 对照,红 `#dc2626` 错误,橙 `#ea580c` 临时高亮,浅蓝填充 `#dbeafe`。同一个量全片同色。
