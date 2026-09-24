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
| `'./helpers'` | `tex`、`label`、`hide`、`unrevealed`、`fadeIns`、`stage`、`picture`、`illustration`、`makePlot`、`plotIntro`、`fadeSequence`、`sweep`、`tangentProbe`、`isNarrow`、`sideColumn`、`columnList`、`texLine`、`labelLine`、`listSegment`、`chapterCard` |

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
- `TimedEnv` = SegmentEnv + `untilLine(id)`、`untilMark(lineId, mark)`、`playUntil(目标, ...动画)`、`playThrough(id, ...动画)`、`now()`;`line(id)` / `remaining(id)` 只是兼容保留的查询,**别拿来算 runTime**(乘比例、减常数都是按草稿速度猜,配音一来就对不上)。
- 跟着台词伸缩的动画写「在哪儿收住」,时长由引擎算:`await env.playUntil({ end: id }, 动画)` 画到这句说完;`{ line: id, mark: 'k', lead: 0.3 }` 在那个词前 0.3 秒画完;`{ start: id }` 画到那句开口;`env.playThrough(id, 动画)` 整句都在画(还没开口就先等开口)。选项 `min`(缺省 = 动画自己的时长:只拉长不压缩,要压缩就写小)、`max`(封顶后静止等,强调用 `{ min: 0.6, max: 1.2 }`)、`lead`(提前收住)。动画时长 = clamp(目标 − lead − 现在, min, max),这一步花 max(目标 − 现在, min);几个动画放进同一次调用就同时开始、按比例伸缩;返回时正好在目标上,后面不用再 `untilMark`。
- 时间不够时按 `min` 播,控制台告警一次 `[film] timedSegment「…」playUntil(…):…`(check-film 列成提醒);目标写错(不是三选一、没声明的台词、没有的标记、min > max)运行时报错、本段被跳过。
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
| `picture(src, width, at?)` | `new Picture(src, { width })`(高按原图比例)+ 移到 at;src 是顶层 `await loadImage` 的资源或已预加载的路径 | — |
| `illustration(src, width, at?)` | `new Illustration(src, { width })` + 移到 at;src 是 SVG 源码(不用预加载)、`loadSvg` 的资源或已预加载的路径 | — |
| `makePlot({ xRange, yRange, width, height, fn, samples = 200, at })` | `{ plot: Group, axes, curve, W(x, y) }`;轴已藏、曲线已收起;`W` 数学坐标 → 世界坐标 | — |
| `plotIntro(env, p, { axesRunTime = 1, curveRunTime = 2.5, curvePace?, holdSeconds = 1, with? })` | 轴 FadeIn + 曲线 Create 同播,再停;`curvePace: { pace: 'curvature' }` 曲线弯处放慢 | 3.5 |
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
| 花括号 | `Brace.for(目标, 方向, { label })` / `new Brace(from, to, { label })` | 先 `unrevealed` 再 `Create`;目标的字号要设在它自己身上 |
| 角 / 直角 | `new Angle(顶点, a, b, { radius = 24, label? })` / `new RightAngle(顶点, a, b, { size = 12 })` | 能 Create;编号角标 `Annotation` 不能(用 FadeIn) |
| 图片 | `new Picture(src, { width?, height?, fit = 'contain' \| 'cover' \| 'fill', smoothing = true })` | 只给宽 / 高时等比;都不给按原图像素。Create = 从左往右擦出,Write = 淡入;ColorTo / Indicate 着色无效 |
| SVG 插画 | `new Illustration(src, { width?, height?, fit = 'contain' \| 'fill', lagRatio?, clip = false })` | 原点 = 画板中心,盒子 = 画板;`part(id)` / `parts[i]` / `partsWithClass(c)` 取部件单独做动画;Create = 部件错峰先描边再填色 |
| 组 / 排版 | `new Group().add(...)` / `Layout` / `nextTo(m, 目标, 'down', 20)` / `arrange([a, b], { direction: 'down' })` / `alignTo` / `centerAt` / `fitWidth` / `keepInside(m, visibleWorldBounds(scene)!, 8)` | 组移动、缩放绕原点(不是视觉中心);排版助手按外接盒只平移、一次性,见 README §6.9 |
| 3D 网格 | `Projection3D` / `Projection3D.math()`(z 朝上的课本视角)、`Cube`、`Cylinder`、`Cone`、`Sphere`、`Pyramid`、`ParametricSurface` | 共用一个 Projection3D;一律 FadeIn;网格之间不遮挡 |
| 3D 线条 / 坐标轴 / 字母 | `new Line3D(a, b)` / `new Arrow3D(a, b)` / `new Polyline3D(点[], { closed = false })` / `new ParametricCurve3D(fn, [t0, t1], { samples = 120 })`;`new Axes3D({ x, y, z, unit })`(区间缺省 `[-3, 3, 1]`、unit 缺省 40,数学坐标 z 朝上)+ `axes.point(x, y, z)` / `axes.curve(fn, [t0, t1])`;`new Anchor3D(tex('P', 24), 点, { offset?, away?, gap = 10 })` / `new Dot3D(点)` | 和网格一起放进一个 `new Space3D(view)`(里面都留在原点,挪就挪空间):视角、绘制顺序、遮挡自动对好,被网格挡住的部分画淡虚线;线条、坐标轴、字母能 Create(按 3D 弧长);`axes.curve` 的曲线要自己 add 进空间;README §9.6 |

**图片与 SVG 插画**(README §6.12):文件放 `public/`,在影片文件**顶层** `await` 预加载,`direct` 里同步构造。

```ts
import { ColorTo, loadImage, preloadAssets } from '../engine';
import { illustration, picture } from './helpers';
const EARTH = await loadImage('/img/earth.png');                              // 模块顶层;SVG 用 loadSvg
const [MOON, CAT] = await preloadAssets(['/img/moon.png', '/svg/cat.svg']);  // 多个并行取;数组字面量 → 逐项类型精确
// direct 里:
const earth = picture(EARTH, 300, { x: -200, y: 0 });                        // unrevealed 后 Create = 从左往右擦出
const cat = illustration(CAT, 200, { x: 200, y: 0 });                        // unrevealed 后 Create = 部件错峰
await env.play(new ColorTo(cat.part('tail'), { fill: '#2563eb' }));          // 按 SVG 的 id 取部件
```

- SVG 源码字符串直接传:`illustration('<svg …>…</svg>', 200)`,不用预加载;`data:` 地址也能 `loadImage` / `loadSvg`。远程图要对方开 CORS,最好下载进 `public/`。
- **绝不在 `direct` 里 await 加载**(不报错,预览、导出的时间线错位);顶层 await 只写在具体影片文件里,别放进 helpers。
- SVG 里写明的颜色锁在部件上(容器 `setStyle` 改不动,用 `ColorTo`);`currentColor` / 没写 fill 的部件跟随 `textColor`。`<text>`、滤镜、裁剪、蒙版被忽略并告警一次(`[svg] …`),渐变按中点单色。
- 出错是 `AssetError`(`code`):`not-loaded`(字符串构造前没预加载)、`loading`(漏了 await)、`http`(`文件应放在 public/…`;开发服务器拿 index.html 顶替也报这个)、`network`(含没开 CORS)、`parse`、`decode`、`bad-path`、`kind-mismatch`、`tainted`、`batch`。顶层加载失败 = 页面红条「场景加载失败:…」,补好文件后刷新页面。
- node 里(内容测试、check-film)位图只量尺寸不画,时间线、取景、版面照常。

## 6. 动画(`'../engine'`)

缺省 runTime 1、缓动 `smooth`。选项都是 `{ runTime?, rateFunc? }` 加各自的字段。

| 动画 | 构造 | 要点 |
| --- | --- | --- |
| 淡入 / 淡出 | `new FadeIn(m, { to? })` / `new FadeOut(m)` | FadeIn 前 `hide`;FadeOut 后对象仍在场景 |
| 描边生长 | `new Create(m, { pace? })` | 前 `unrevealed`;不碰 opacity。`pace: 'curvature'`:急弯、拐角处放慢,直处加快(时长不变;`paceStrength` 0–4,缺省 2);直线、圆、圆弧、椭圆和自有长法的对象不受影响 |
| 书写 | `new Write(m, { lagRatio?, pace? })` | 不要预先藏;`pace` 同 Create,只改每片轮廓内部的快慢 |
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
| 3D | `new Orbit3D(projection, 圈数 = 1)`、`new Spin3D(mesh, 圈数 = 1)`、`new ParamMorph(surface, [终值])`、`new ViewTo(projection, { azimuth?, elevation?, rotX?, rotY?, viewDistance? })` | 俯仰、转到某个方位、改透视用 `ViewTo`(只动给出的键;`azimuth` 走最短路径) |

## 7. 样式与颜色

`setStyle` 常用键:`stroke`、`strokeWidth`(缺省 3)、`fill`、`dash`、`fontSize`、`textColor`、`fontFamily`。没有 `opacity` 键(直接设 `m.opacity`)。颜色一律 `#rrggbb` 或 `rgb()`(颜色名在 node 里插值不了)。

语义色(README §3.8):缺省单色墨线(主题 `#1f2937`);蓝 `#2563eb` 主函数曲线,粉 `#db2777` 割线 / 运动中的对象,绿 `#16a34a` 切线、极限、答案,橙 `#ea580c` / 紫 `#7c3aed` Δy / Δx,灰 `#6b7280` 旁注,浅灰虚线 `#9ca3af` 轨迹,浅蓝填充 `#dbeafe`。同一个量全片同色,一段除墨色最多 4 种;橙是强调动画的缺省色,要强调的对象别用橙。
