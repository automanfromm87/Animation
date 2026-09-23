# Mini Manim

Manim 风格的 2D/3D 数学动画引擎,面向数学科普。Canvas 2D 渲染;公式由 MathJax 排成矢量字形,和图形画在同一张画布上。
内置讲解动画的常用「词汇」:错峰出场、高亮圈注、换色、花括号与角标、坐标网格、黎曼和、切线、按式子结构推导……
还带一个影片播放器(分段、字幕、章节进度条、转场),能把整部片子逐帧离线导出成视频。
运行时依赖只有 MathJax(公式排版)与 mediabunny(视频封装),React 只用来挂一个画布和工具条。

**目录**

1. [跑起来](#1-跑起来) · 2. [五分钟上手](#2-五分钟上手) · 3. [场景](#3-场景) · 4. [图元](#4-图元) ·
5. [动画](#5-动画) · 6. [相机与取景](#6-相机与取景) · 7. [3D](#7-3d) · 8. [影片](#8-影片) ·
9. [导出视频](#9-导出视频) · 10. [开发与测试](#10-开发与测试) · 11. [目录与分层](#11-目录与分层) ·
12. [已知取舍](#12-已知取舍) · 13. [更多文档](#13-更多文档)

## 1. 跑起来

需要 Node `^20.19.0 || >=22.12.0`。

```bash
npm install
npm run dev      # 打开 http://localhost:5173/
```

六个入口,靠 URL 的 `?scene=` 切换(各场景按需懒加载):

| 地址                  | 内容                                                                 | 可导出 |
| --------------------- | -------------------------------------------------------------------- | ------ |
| `/`                   | 图形总览:45 件图元画廊 + 单位圆生正弦,可平移缩放                     | 否     |
| `/?scene=pythagoras`  | 勾股定理证明(约 22 秒一遍,循环播放)                                 | 否     |
| `/?scene=vocabulary`  | 讲解词汇演示:编排、强调、换色、标注图元、按结构推导(约 70 秒一遍,循环) | 否     |
| `/?scene=film`        | 勾股定理短片:片头 + 正片 + 片尾(约 30 秒)                           | 是     |
| `/?scene=derivatives` | 《导数》长片:35 段约 9 分钟,五章 + 习题                              | 是     |
| `/?scene=topology`    | 《拓扑学基础》前三章:21 段约 3 分钟                                  | 是     |

页面操作:

- 右上角工具条:画幅切换、暂停/播放;影片还有「导出」按钮。能导出的格式(实时录制支持的 ∪ WebCodecs 能编的)
  MP4 与 WebM 都有时,再多一个格式下拉框。
- 总览页可以拖拽 / 滚轮操作,画布获得焦点后也能用方向键平移、`+` / `-` 缩放。开场有一段运镜巡游,
  巡游期间手动操作暂时锁定(暂停时放开,恢复播放后巡游接着走)。
- 影片进度条可以用 Tab 聚焦:← / ↓、→ / ↑ 切段,PageUp / PageDown 跳章,Home / End 跳首尾,空格或 K 暂停;
  带修饰键的组合留给浏览器。进度条点击精确到秒(目标段重挂后快进过去)。
- 调片用 `?preview=` 单帧预览:`/?scene=derivatives&preview=480` 直接看第 480 秒那一帧,不用从头播。
- 系统开了「减少动态效果」时:演示场景起始暂停(播放途中打开也会停下),总览页跳过开场巡游。

## 2. 五分钟上手

**核心概念**

- **Scene**:一块画布 + 一棵场景图 + 一条时间线。`scene.add(对象)` 放进去,`await scene.play(动画…)` 播放。
- **MObject**:画面上的一切 —— 图形、文字、公式、坐标系、标注、3D 网格。可以装进 `Group` 组成树,子元素的坐标相对父容器。
- **坐标**:x 向右、**y 向下**(与 Canvas 一致),角度用弧度、增大为顺时针;单位约等于镜头缩放为 1 时的 CSS 像素。
  镜头决定看哪一块、放多大,一般用 `fitObjects` 自动取景,不必在意绝对尺寸。
- **动画**(`Playable`):`begin` 捕获初态 → 每帧 `interpolate(进度)` → `finish` 让终态精确。
  普通动画、组合动画、运镜都是它,都能交给 `scene.play`。
- **样式**:描边、填充、线宽、字号、文字色、虚线,渲染时按「自身 > 容器链 > 构造默认 > 主题」解析。

**第一个场景**

```ts
// src/scenes/demo.ts
import { Circle, Create, FadeIn, Indicate, Scene, Tex, lightTheme } from '../engine';
import type { SceneHandle } from './types';

export function runDemo(canvas: HTMLCanvasElement): SceneHandle {
  const scene = new Scene(canvas, { theme: lightTheme });
  const circle = new Circle(80).setStyle({ stroke: '#2563eb' });
  const formula = new Tex('S = \\pi r^2').setStyle({ fontSize: 36 }).moveTo({ x: 0, y: 130 });
  formula.opacity = 0; // 先藏起来,FadeIn 会把它淡入到 1
  scene.add(circle, formula);
  scene.fitObjects([circle, formula], 40); // 把两者框进画面

  let cancelled = false;
  void (async () => {
    await scene.play(new Create(circle, { runTime: 1.5 })); // 描边生长
    if (cancelled) return;
    await scene.play(new FadeIn(formula));
    if (cancelled) return;
    await scene.play(new Indicate(formula)); // 高亮一下
  })().catch((e: unknown) => console.error(e));

  return {
    dispose: () => {
      cancelled = true;
      scene.dispose();
    },
    resize: () => scene.resizeAndRefit(),
    setPaused: (p) => scene.setPaused(p),
  };
}
```

再在 `src/sceneRegistry.ts` 的 `SCENES` 里加一项,就能用 `/?scene=demo` 打开:

```ts
demo: {
  title: '我的演示',
  kind: 'scene',
  interactive: false,
  load: async () => {
    const { runDemo } = await import('./scenes/demo');
    return (canvas) => runDemo(canvas);
  },
},
```

叙事型的内容(带字幕、进度条、能导出)写成影片的分段,见 [8. 影片](#8-影片)。

## 3. 场景

```ts
const scene = new Scene(canvas, {
  theme: lightTheme,            // 主题,缺省 lightTheme
  camera: { zoom: 1, minZoom: 0.1, maxZoom: 10 }, // 镜头初值与缩放区间
  clock,                        // 帧时钟(测试、离线导出注入;缺省 requestAnimationFrame)
  viewport,                     // 固定视口 { width, height, pixelRatio }(离屏渲染用,不读 DOM 尺寸)
});
```

| 方法 | 作用 |
| --- | --- |
| `add(...)` / `remove(...)` | 放进 / 拿出场景 |
| `play(...动画)` | 同播一组动画,`await` 到全部播完 |
| `wait(秒)` | 保持场景 alive(updater 照跑);`wait(Infinity)` 一直等到 `dispose` |
| `fitObjects(对象[], 边距)` | 立即取景,把这些对象框进画面 |
| `playFit(对象[], { pad, runTime })` | 运镜取景(一段动画) |
| `computeFitView` / `getFitView` / `fitBounds` / `fitView` | 只算机位 / 按包围盒取景 |
| `setSafeArea({ top, bottom, left, right })` / `clearSafeArea()` | 安全区(屏幕像素),取景会避开字幕条 |
| `addUpdater(fn)` → 取消函数 / `removeUpdater(fn)` | 每帧回调 `(scene, dt)`,先于动画插值 |
| `setPaused(bool)` / `isPaused()` / `getElapsed()` | 暂停与播放时钟(秒) |
| `render()` | 立即重画一帧 |
| `renderTo(ctx, { x, y, width, height })` | 按目标分辨率重画到另一块画布(截图直接清晰) |
| `resize()` / `resizeAndRefit()` | 画布尺寸变了:重设分辨率(并按上次的取景重新框住内容) |
| `setTheme` / `getTheme` / `measureContext()` / `layout(容器)` | 主题;按主题字号测量、排版 `Layout` |
| `setInteractionEnabled(bool)` | 手动平移缩放(拖拽、滚轮、方向键、`+` / `-`) |
| `setDryRun(bool)` | 干跑:推进时间线但不画画(预览快进用) |
| `getCamera()` / `getViewportSize()` | 镜头与视口尺寸 |
| `dispose()` | **必须调用**:停帧泵、放行挂起的 `play` / `wait`、摘掉监听与观察者 |

播放语义:

- `play(...)` 同播的一组里,每个动画到了自己的 `runTime` 就单独收尾,不会被同批更长的动画拖着逐帧重复插值。
  并发的 `play` / `wait` 共享同一条帧泵,每帧 updater 只跑一遍、只画一次。
  串行 `await` 的多段首尾相接:下一段承接上一段不到一帧的超调,长片里按 `getElapsed()` 取的字幕不会越走越领先画面。
- `begin(context)` 在调用 `play` 时同步执行,初始画面立刻呈现;`context`(`PlayContext`)能查对象的世界变换与所在位置解析出的样式。
- `runTime` 必须是非负有限数;NaN / 负数按 0(立即完成)处理并告警一次。某个动画 `begin()` 抛错时,已开始的先收尾,`play` 以该错误 reject。
- `setPaused(true)` 冻结整条时间线:updater 不跑、动画不推进、`getElapsed()` 不涨,恢复后接着原进度。
  超过 0.5 秒的帧间隔(切后台)只按 0.5 秒推进;updater 拿到的 `dt` 与时间线同一步长。

取景:

- `fitObjects` / `playFit` / `computeFitView` 尊重安全区,嵌套在变换过的容器里的对象也按真实世界位置算。
- `playFit` 的目标每帧按当前视口重算:运镜途中改了画幅,落点也是新视口的取景;配合 `resizeAndRefit()`,停住的镜头也会重新框住内容。
- 画布隐藏(尺寸为 0)时取景推迟到尺寸就绪(`playFit` 期间镜头原地不动、时长照走)。
- 网页字体稍后加载完成、文字尺寸变了时,按对象取的景会按新尺寸重取 —— 前提是镜头与目标取景之后都没被挪过。

## 4. 图元

### 4.1 通用操作

```ts
m.moveTo({ x: 100, y: 0 });   // 位置(父坐标);shift(dx, dy) 相对移动
m.scale = 1.5;                // 缩放(绕自身原点)
m.rotation = Math.PI / 6;     // 旋转(弧度,顺时针)
m.opacity = 0.5;              // 不透明度
m.setStyle({ stroke: '#2563eb', fill: '#dbeafe', strokeWidth: 4, dash: [6, 4], fontSize: 32, textColor: '#111' });
m.getBox();                   // 本地包围盒 { size: { w, h }, center };文字类可传 scene.measureContext()
```

- 不透明度只有 `opacity` 一条通道(`setStyle` 里没有 opacity),主题的 `opacity` 作为全局系数乘在叶子上。
- `setStyle` 忽略值为 `undefined` 的键;`fill: null` 表示不填充。
- 世界包围盒:`worldBoundsOf(对象[])`(按场景根对象算)、`worldBoundsInScene(根[], 对象[])`(沿场景图组合祖先变换)。

### 4.2 基础图形

| 图元 | 构造 |
| --- | --- |
| 圆 / 椭圆 | `new Circle(r = 50)` · `new Ellipse(rx = 60, ry = 40)` |
| 矩形 / 正方形 | `new Rectangle(w = 120, h = 80)` · `new Square(size = 90)` |
| 线段 / 箭头 | `new Line(起点, 终点)` · `new Arrow(起点, 终点)` |
| 圆弧 / 扇形 | `new Arc(r, 起始角, 终止角)` · `new Sector(r, 起始角, 终止角)`(也可传选项对象) |
| 圆点 | `new Dot(r = 6)`(实心;缺省填充色取描边色,`Create` 时从圆心长大) |
| 多边形 / 折线 | `new Polygon(点[], { closed })` · `new RegularPolygon(边数, r)` · `new Triangle(r)` |
| 星形 | `new Star(角数 = 5, 外半径 = 50, 内半径 = 22)` |
| 任意路径 | `new SvgPath('M 0 0 C 40 -60 …')` 或 `new SvgPath(pathData)`(见 [4.7](#47-自定义形状与路径)) |

这些都是矢量路径(`PathShape`):都支持描边生长 `Create`、形状变形 `Transform`、逐笔书写 `Write`。

### 4.3 文字与标注

```ts
const label = new Label('一个圆').setStyle({ fontSize: 24, textColor: '#6b7280' }); // 画布文字,居中
label.setText('新内容');                               // 逐帧变化的读数用 Label
const badge = new Annotation('A', { offset: { x: 30, y: -30 } }); // 关键点标注:编号徽标 + 引导线 + 圆点
```

- `Label` 支持 `Create`(打字机式逐字写出,字在最终位置出现);字号走主题 / 容器 / 自身的 `fontSize`。
- 中文、读数这种每帧都变的文字用 `Label`;公式用 `Tex`。

### 4.4 公式

```ts
const tex = new Tex('\\frac{a}{b} + \\sqrt{x^2 + 1}').setStyle({ fontSize: 40 });
const display = new Tex('\\sum_{k=1}^{n} k = \\frac{n(n+1)}{2}', { displayMode: true });
```

`Tex` 是普通的场景图节点:MathJax(TeX 输入 + SVG 输出,跑在它自带的轻量 DOM 里,不依赖浏览器)排版,
字形轮廓转成矢量路径,在场景图遍历到它时画进画布 —— 和其它图元一样遵守添加顺序、祖先 `Layout` 的裁剪(含旋转)、透明度与变换,任意缩放都清晰。

- **尺寸同步可知**:`getBox()` 立刻就是真实排版尺寸(浏览器与 node 一样),不量 DOM、不等字体加载,布局与取景在搭场景时就是准的。
  盒子不小于一个 `\strut`(基线上 0.9em、下 0.3em),几个简单公式排成一行基线一致;伸出度量的墨迹(`j` 的钩、积分号上端)也包在盒子里。
- **颜色**:整体走 `textColor`;局部变色用 `\textcolor{red}{x}`(`\color` 与 LaTeX 一样是开关,一直作用到分组结束),`\style{color:red}{x}` 也行。
- **宏包**:base、ams、newcommand、noundefined、boldsymbol、color、cancel、html。语法错误不抛,公式显示成红字,`tex.error` 给出说明。
- **命名部分**:用 `\class{名字}{…}`(或 `\cssId{名字}{…}`)给式子的某一部分起名,供按结构推导与强调使用:
  `tex.partNames`(有哪些)、`tex.getPartBox(名字)`(包围盒)、`tex.partLayers(名字, 样式)`(分层几何)、`tex.layout().parts`(图元下标)。
- `\text` 里 MathJax 字体没有的字(中文)用画布文字画:没有轮廓,变形时按文字内容配对或交叉淡化。`\href` 在画布里只显示内容。
- 支持 `Create` / `Write`(逐个字形先描细轮廓、再淡入填充,按排版顺序错峰);`Transform` 逐个字形变形,
  `TransformMatchingTex` 按字形身份与结构配对(见 [5.4](#54-按式子结构变形transformmatchingtex))。
- **逐帧变化的数字请用 `Label`**:每个新串都要重新排版一次;同一个 `Tex` 1 秒内换源超过 20 次会告警。
- 代价是体积:MathJax(TeX 解析器 + 全套字形路径)压缩后约 1.6MB、gzip 约 575KB,单独打成一个包,引擎代码改动时它仍能命中缓存。

### 4.5 坐标系与函数图像

```ts
const axes = new Axes([-3, 3], [-2, 2], 360, 240, { x: 'x', y: 'y' }); // 区间、宽高、轴名
const graph = new FunctionGraph((x) => x * x - 1, axes);               // 函数图像
const spiral = new ParametricCurve2D(spiralFn(0.35), axes, [0, 4 * Math.PI]); // 参数曲线
const plot = new Group().add(axes, graph, spiral);                     // 曲线与坐标系放在同一个组里
const p = axes.toLocal(1, 0);                                          // 数学坐标 → 坐标系本地坐标

const plane = new NumberPlane([-4, 4], [-3, 3, 1], 480, 360, { numbers: true }); // 坐标网格
const q = plane.c2p(1, 2);                                             // plane.p2c 反过来
const line = new NumberLine([-5, 5, 1], { length: 400, tips: 'end' }); // 数轴:line.n2p(2.5) / line.p2n(点)
const trace = new Trace();                                             // 轨迹:setPoints / addPoint / clear
```

- `Axes` 与 `NumberPlane` 都是坐标系(`CoordinateSystem`):函数图像和下一节的面积、切线、向量场都接受任意一个。
  取样得到的是坐标系的**本地坐标** —— 把它们和坐标系放进同一个组(或同一个父节点、同样的变换)才对得上。
- 注意:`NumberPlane`、`NumberLine` 是组,对它们做 `Create` 会连带加进去的子元素一起长出来;
  曲线要单独出场时放在坐标系旁边(同一个组里),而不是 `plane.add(曲线)`。
- `NumberLine` 选项:`vertical`、`ticks`、`tickSize`、`numbers`(true / false / 指定数值)、`exclude`、`format`、
  `labelKind`('tex' / 'label')、`fontSize`、`numberGap`、`tips`('none' / 'end' / 'both')。负数让数字本身对准刻度。
- `NumberPlane` 选项:`minorDivisions`(次网格细分,1 为不画)、`axes`、`numbers`、`labelKind`、`fontSize`、`tips`、
  `gridColor`、`minorGridColor`;子元素 `minorGrid` / `majorGrid` / `xAxis` / `yAxis` 可以单独 `setStyle`。
- 内置函数:`sinFn`、`cosFn`、`tanFn`、`expFn`、`logFn`、`sincFn`,参数曲线 `spiralFn(增长率)`、`lissajousFn(fx, fy, 相位, 振幅)`。
- `Axes`、`NumberLine`、`NumberPlane` 都支持 `Create`(轴线按长度画出,刻度与数字随后出现)。

### 4.6 标注图元

```ts
// 花括号:沿 from → to,尖角朝前进方向的右手侧(从左往右时朝下);Brace.for 按目标的外接盒放
const brace = Brace.for(tex, 'down', { label: '\\text{两项}' }); // up / down / left / right
new Brace({ x: 0, y: 40 }, { x: 200, y: 40 }, { label: 'b', depth: 14 });

// 角与直角:参数顺序都是(顶点, 一边上的点, 另一边上的点)
const theta = new Angle(A, B, C, { radius: 28, label: '\\theta' });
const right = new RightAngle(C, A, B, { size: 12 });
const beta = Angle.fromLines(line1, line2, { label: '\\beta' });  // 顶点 = 两直线交点

// 曲线下面积与黎曼和
const area = new AreaUnderCurve(axes, f, [0, 3]);                  // 与 x 轴之间;{ bottom: g } 两条曲线之间
const rects = new RiemannRectangles(axes, f, [0, 3], { n: 6, sample: 'mid' }); // left / right / mid
await scene.play(new RiemannTo(rects, { n: 24 }, { runTime: 1.2 })); // 细分:每个矩形劈开再长到新高度
rects.sum;                                                         // 黎曼和

// 切线与割线:数值导数,配合 updater 逐帧移动
const tangent = new TangentLine(axes, f, 0.5, { length: 160 });    // tangent.setX(x)、tangent.slope
const secant = new SecantLine(axes, f, 1, 3, { extend: 20 });      // secant.setX(x1, x2)

// 向量场:同色箭头合成一条路径,几何只在取样时建一次
const field = new VectorField(plane, (x, y) => [-y, x], { colors: ['#3b82f6', '#ef4444'] });

// 柱状图
const chart = new BarChart([3, 5, 2], { labels: ['甲', '乙', '丙'], showValues: true });
await scene.play(new BarChartTo(chart, [4, 1, 6]));                // 柱高补间,数值标签跟着变
```

- 都支持 `Create` / `Write` / `Transform`,也都能配合强调动画。带文字的是装着路径与 `Tex` / `Label` 的组;字符串说明按 Tex 排。
- `Brace` 两端卷钩与尖角尺寸固定,只伸长直段,任意长度都匀称;`setEnds(from, to)` 换端点,说明跟着走。只要括号本身用 `BraceShape`。
- `Angle`:`reflex: true` 画大于 180° 的一侧,`exterior: true` 画外角;说明在角平分线上、弧外;`setPoints(v, a, b)` 更新;`degrees` / `value` 取角度。
- 面积与黎曼矩形:区间截到横轴范围、函数值截到纵轴范围,负值画在轴下,无定义处高度为 0;`Create` 时面积从左往右扫出、矩形从轴上长出。
- `VectorField` 选项:`xRange` / `yRange`(`[min, max, step]`)、`maxLength`、`uniform`、`colors`、`pivot`;场变了用 `setFunction` 重新取样,**不要**逐帧新建对象。
- `BarChart` 选项:`width`、`height`、`range`(缺省含 0)、`colors`、`barRatio`、`labelKind`、`fontSize`、`showValues`;立即换数值用 `setValues`。

### 4.7 自定义形状与路径

```ts
const d = new PathBuilder().moveTo(0, 0).quadTo(60, -80, 120, 0).lineTo(120, 40).close().build();
const blob = new SvgPath(d).setStyle({ fill: '#fde68a' });           // 也可以直接传 SVG 的 d 串

class Wave extends PathShape {
  amplitude = 30; // 几何参数(可写字段)
  protected override buildPath(): PathData {                     // 只给几何
    return new PathBuilder().moveTo(0, 0).quadTo(50, -this.amplitude, 100, 0).quadTo(150, this.amplitude, 200, 0).build();
  }
  protected override pathKey(): string { return String(this.amplitude); } // 参数变了才重建路径
}
```

- `PathShape` 子类只给几何(`buildPath`),填充、描边、虚线、按弧长的描边生长、包围盒与剔除都由基类处理。
- 路径工具:`parseSvgPath`、`PathBuilder`(moveTo / lineTo / quadTo / cubicTo / arc / rect / close)、`polylinePath`、
  `transformPath`、`pathBounds`、`pathLength`、`partialPath`(按弧长截取)、`alignPaths` / `lerpPath`(变形对齐与插值)、`drawPath`。
- 完全自定义的 `MObject`:实现 `drawShape(ctx, style)`,按需覆盖 `getBox`、`getCullRadius`(剔除用的保守外接半径)、
  `supportsReveal`(支持 `Create`);要参与变形 / 书写就覆盖 `pathLayers(style)`(与 `drawMorphResidual`)。

### 4.8 容器与排版

```ts
const group = new Group().add(a, b, c);  // 自身变换作用于所有子元素;setStyle 作用于整棵子树
group.opacity = 0.5;                     // 整组透明度

const row = new Layout(360, 60, { direction: 'row', gap: 16, padding: 8, justify: 'center', align: 'center' });
row.place(title).place(formula, 1);      // 第二个参数是 flex 权重
scene.layout(row);                       // 按场景主题的字号排一次
```

- `Group.add` 忽略已在容器里的对象,加入自身或祖先直接报错(环)。
- `Layout` 选项:`direction`('row' / 'column')、`gap`、`padding`、`justify`('start' / 'center' / 'end' / 'space-between' / 'space-around')、
  `align`('start' / 'center' / 'end')、`frame`(边框)、`clip`(裁剪)。
- 排布是一次性的:子元素内容变了要重新 `layout()`;例外是网页字体加载完成带来的尺寸变化 —— 排好之后没人挪过子元素的容器会按原参数自动重排。
  带 flex 的子 `Layout` 拉伸填满槽位,但不小于自身内容尺寸(类比 CSS 的 `min-width: auto`)。`place` 同一个子元素只占一个槽位。

### 4.9 样式、主题与颜色

- **解析顺序**:自身 `setStyle` > 容器链 > 子类构造默认 > 主题。容器的 `setStyle` 作用于整棵子树,但抢不走子元素自己设过的键;
  移出容器不需要回滚,同一个对象挂在两个容器下也各自按所在位置解析。子类构造期的默认值用 `setDefaultStyle`(容器能覆盖它)。
- 样式键:`stroke`、`fill`(`null` 不填充)、`strokeWidth`、`fontFamily`、`fontSize`、`textColor`、`dash`(虚线,可继承)。
- 主题 `Theme`:背景、网格、坐标轴与默认样式;预设 `lightTheme`(`presetThemes` / `themeByName`)。`scene.setTheme(theme)` 立即重画。
- 颜色工具:`parseColor` / `formatColor`、`lerpColor`(OKLab 插值,感知均匀;`null` 与颜色之间按透明度淡入淡出)、
  `fadeColor`、`colorAlpha`、`highlightColor(背景)`(强调色:亮底橙、暗底琥珀黄)。

## 5. 动画

### 5.1 动画怎么播

```ts
await scene.play(new Create(circle), new FadeIn(label, { runTime: 0.5 })); // 同播,await 到都播完
await scene.play(new MoveTo(dot, { x: 100, y: 0 }, { runTime: 2, rateFunc: linear }));
```

- 所有动画都接受 `{ runTime, rateFunc }`(缺省 1 秒、`smooth`);少数有自己的缺省(`Wiggle` 2 秒、组合动画按子动画排出来的总长)。
- **`FadeIn` 会自己把对象从 0 抬到目标不透明度**(当前是 0 时淡入到 1);`Create` 不碰 `opacity`,预先藏起来的对象要先抬回来。
- 所有内置图形、函数图像、`SvgPath`、`Tex`、`Label`、坐标系与标注图元都支持 `Create`。

### 5.2 基础动画

| 动画 | 效果 |
| --- | --- |
| `Create(m)` | 描边生长(`Label` 逐字打出,`Tex` 逐个字形先描轮廓再填充) |
| `Write(m, { lagRatio })` | 逐笔书写:每片先按弧长描轮廓再淡入填充,片与片错峰(缺省按片数自动取、最多 0.2) |
| `FadeIn(m, { to })` / `FadeOut(m)` | 淡入 / 淡出 |
| `MoveTo(m, 点)` / `ScaleTo(m, k)` / `RotateTo(m, 弧度)` | 移动 / 缩放 / 旋转到目标 |
| `FadeTransform(文字, '新内容', { shift })` | 文字交替:旧的上浮淡出、新的自下浮现(`Tex` 与 `Label` 都行) |
| `Transform(源, 目标)` | 形状变形(见 5.3) |
| `TransformMatchingTex(源公式, 目标公式)` | 按式子结构变形(见 5.4) |
| `TweenValue(tracker, 目标值)` | 补间外部参数(见 5.8) |
| `CameraMove(camera, 机位)` | 运镜(见 [6](#6-相机与取景)) |

### 5.3 形状变形 Transform

```ts
const square = new Square(120).setStyle({ stroke: '#2563eb', fill: '#dbeafe' });
const circle = new Circle(70).setStyle({ stroke: '#dc2626' }).moveTo({ x: 240, y: 0 });
scene.add(square, circle);                                         // 两个都要先 add;目标开始时会被藏起来
await scene.play(new Transform(square, circle, { runTime: 1.5 }));  // 位置、大小、形状、颜色一起变
await scene.play(new Transform(circle, square));                    // 变回来,方块恢复原样
```

- **替换语义**(Manim 的 `ReplacementTransform`):开始时藏起目标并记下它的不透明度,源逐点变成目标
  (位置、缩放、旋转、形状、颜色(OKLab)、线宽、不透明度一起插值),结束时源藏起、目标按记下的不透明度显示,终态精确。
  两个对象可以在不同容器里;来回变形不走样。
- 组对组按子元素先序配对,多出来的从对面对应那一片的中心长出来、少掉的缩回去;公式逐个字形配对,画布文字交叉淡化。
- 变形期间由源画一层覆盖(不往场景里加临时对象),源暂不参与剔除。

### 5.4 按式子结构变形(TransformMatchingTex)

推导最常用的一步:移项、约分、代入、合并同类项。前后两个式子里**没变的项平移过去**,变了的部分淡出淡入(或变形过去)。

```ts
const steps = ['2x + 3 = 7', '2x = 7 - 3', '2x = 4', 'x = \\frac{4}{2}', 'x = 2'].map((s) => new Tex(s));
steps.slice(1).forEach((s) => (s.opacity = 0)); // 摆在同一个位置就是「原地推导」
scene.add(...steps);                             // 源和目标都要先在场景里
for (let i = 1; i < steps.length; i++) {
  await scene.play(new TransformMatchingTex(steps[i - 1]!, steps[i]!, { runTime: 1.2 }));
}

// 用 \class 指定对应关系:同名(或 partMap 改名后同名)的部分整体对应
const a = new Tex('\\class{sq}{x^2 + 2x + 1} = 0');
const b = new Tex('\\class{square}{(x+1)^2} = 0');
scene.add(a, b);
await scene.play(new TransformMatchingTex(a, b, { partMap: { sq: 'square' } }));
```

配对按优先级:① 同名的命名部分整体对应 → ② 结构相同的子式整组配(上下标、分式、根式;c² 的指数跟着底数走)→
③ 同一个字形平移过去(尽量保序、就近)→ ④ 同一个符号换了字号的边移动边缩放 → ⑤ 多出来的副本并入或分出(x + x → 2x)→
⑥ 实在配不上的淡出淡入。中文按文字内容配对。替换语义与 `Transform` 相同。

选项:`partMap`、`transformMismatches`(配不上的也按顺序直接变形)、`matchAcrossSizes`(缺省 true)、
`duplicates`('merge' / 'fade')、`fadeLag`(缺省 0.3)、`fadeScale`(缺省 0.8)。详见 [docs/explainer-vocabulary.md](docs/explainer-vocabulary.md)。

### 5.5 编排:组合动画

| 写法 | 效果 |
| --- | --- |
| `new AnimationGroup([a, b, c])` | 同时开始,时长取最长的 |
| `new LaggedStart([a, b, c], { lagRatio: 0.3 })` | 错峰:上一个播到 30% 时下一个开始(缺省 0.2) |
| `new Succession([a, b, c])` | 一个接一个,首尾相接 |
| `new Wait(0.5)` | 在组里留一段停顿 |

```ts
await scene.play(new LaggedStart(dots.map((d) => new FadeIn(d)), { lagRatio: 0.25 })); // 依次出场
await scene.play(new Succession([new MoveTo(p, A), new Wait(0.3), new MoveTo(p, B)])); // 第二段从 A 出发
await scene.play(new Succession([new Transform(a, b), new Transform(b, c)]));          // 连续变形
```

- 组合动画本身也是动画,可以互相嵌套。组的时长缺省是子动画排出来的总长;指定 `runTime` 则整条时间轴按比例伸缩。
  组的 `rateFunc` 缺省 `linear`(扭曲的是整条时间轴),子动画各自的缓动照常生效。
- `AnimationGroup` / `LaggedStart` 一开始就 begin 全部子动画:入场动画会先把各自的对象藏好,轮到时才出现。
- `Succession` 轮到谁才 begin 谁(捕获那一刻的状态),连续移动、连续变形才能首尾相接;
  也因此排在后面的入场对象在轮到之前保持原样 —— 要一直藏着就先把 `opacity` 设为 0,或者改用 `LaggedStart(…, { lagRatio: 1 })`。
- 每个子动画走到自己的终点就单独收尾(终态精确);某个子动画出错时,其余的照常收尾,`play` 以第一个错误 reject。

### 5.6 强调

| 写法 | 效果 |
| --- | --- |
| `new Indicate(m)` | 高亮:绕几何中心放大 1.2 倍并染上强调色,再回到原样 |
| `new Circumscribe(m)` | 圈出:沿外围画一圈矩形(或 `shape: 'circle'`),再收回 |
| `new Flash(m)` | 闪一下:一圈短光芒向外掠过 |
| `new Wiggle(m)` | 摆动:左右摆几下、微微放大 |

```ts
await scene.play(new Indicate(formula));
await scene.play(new Circumscribe(result, { shape: 'circle', buff: 12 }));
await scene.play(new Flash(axes, { at: axes.toLocal(2, 4) }));   // 在数据点 (2, 4) 闪一下
await scene.play(new Indicate(term), new Circumscribe(term));    // 可以叠在一起同时播

const law = new Tex('\\class{lhs}{a^2 + b^2} = \\class{rhs}{c^2}');
await scene.play(new Indicate(law, { part: 'rhs' }));            // 只强调公式里的某一项
```

- 都是渲染期的临时效果:不改对象的位置、缩放、样式,播完精确回到原样;能和正在移动的对象、updater 驱动的对象同时用。
- 颜色缺省按背景挑(亮底橙、暗底琥珀黄),`color` 可以指定;`Indicate` 给容器整组染色,公式里 `\textcolor` 显式上色的部分保持原色。
- `part`(`\class` 起的名字)四种都支持:高亮 / 摆动只动那一项,圈出 / 闪一下以那一项为准;名字写错时报错会列出现有的部分。
- 圈与光芒画在对象的父坐标系里、跟着对象走,不往场景里加对象。
- 选项:`Indicate { scaleFactor, color, part }`、`Circumscribe { shape, buff, color, strokeWidth, fadeOut, part }`、
  `Flash { at, radius, lineLength, lineCount, color, strokeWidth, timeWidth, part }`、`Wiggle { scaleFactor, rotationAngle, wiggles, part }`。

### 5.7 换色与线宽:ColorTo

```ts
await scene.play(new ColorTo(term, '#e11d48'));                              // 简写:描边与文字色一起变
await scene.play(new ColorTo(curve, { stroke: '#2563eb', strokeWidth: 6 })); // 颜色 + 线宽
await scene.play(new ColorTo(region, { fill: null }));                       // 填充淡出
```

- 颜色在 OKLab 里插值;终态等于对每个叶子 `setStyle(目标)`,各叶子从当前画出来的颜色出发(开始不跳色)。
- 简写 `color` 只给原本有填充的叶子换填充色(保留原来的透明度):给整组换色时,线条、坐标轴不会突然被填满。具体键优先于简写。
- 持久的高亮用 `ColorTo`,一闪而过的用 `Indicate`。

### 5.8 外部参数与 updater

```ts
const t = new ValueTracker(0.5);
const stop = scene.addUpdater(() => tangent.setX(t.getValue()));  // 每帧按参数重算
await scene.play(new TweenValue(t, 2.5, { runTime: 3 }));        // 切线沿曲线滑过去
stop();
```

- updater 在 `play` / `wait` 期间每帧先于动画插值调用,签名 `(scene, dt)`;暂停时不跑。
- 常见用法:读 `ValueTracker` 重算几何(切线、角、数值 `Label`)、`Trace.addPoint` 画轨迹、3D 曲面 `resample`。

### 5.9 缓动函数

`linear`、`smooth`(缺省)、`easeIn`、`easeOut`、`easeInOut`,以及:

- `thereAndBack`:去而复返(`Indicate` 的缺省);`thereAndBackWithPause(停顿比例)`:在顶点停一会儿;
- `wiggle(t, 次数)`:左右摆动;`rushInto` / `rushFrom`:冲向终点 / 冲出起点;`doubleSmooth`:中途停一下;
- `squish(缓动, a, b)`:把缓动压进 `[a, b]` 这段时间(之前停在起点、之后停在终点)。

自定义缓动就是 `(t: number) => number`,`f(0) = 0`、`f(1) = 1` 时终态精确。

### 5.10 自定义动画

```ts
class Pulse extends Animation {
  private base = 1;
  override begin(): void { this.base = this.mobject.scale; }          // 捕获初态
  interpolate(alpha: number): void { this.mobject.scale = this.base * (1 + 0.2 * Math.sin(alpha * Math.PI)); }
  override finish(): void { this.mobject.scale = this.base; }          // 终态精确
}
```

- 绑定对象的继承 `Animation`,不绑定对象的(外部参数、镜头)继承 `BasePlayable`。
- `interpolate` 收到的进度已经过缓动;`finish` 缺省按 `interpolate(rateFunc(1))` 收尾。
- `begin(context)` 的 `PlayContext` 提供 `worldMatrix(对象)` 与 `styleOf(对象)`,需要世界位置、所在位置样式的动画用得上。

## 6. 相机与取景

```ts
const camera = scene.getCamera();                          // 机位 { x, y, zoom }:getView / setView
scene.fitObjects([axes, graph], 40);                       // 立即取景
await scene.playFit([formula], { pad: 30, runTime: 1.5 }); // 运镜取景(目标每帧按视口重算)
await scene.play(new CameraMove(camera, { x: 200, zoom: 2 })); // 运镜到指定机位(缩放按对数补间)
const follow = createCameraFollow(camera, dot, { damping: 4, centerOffset: scene.safeAreaCenterOffset });
scene.addUpdater(follow);                                  // 镜头跟随
```

- `CameraMove` 的目标也可以是函数(每帧重新求值);`createCameraFollow` 的目标是场景根对象或返回世界坐标的函数
  (嵌套在变换过的容器里的对象请传函数)。
- `camera` 的 `x` / `y` / `zoom` 只接受有限值,`zoom` 自动钳进 `[minZoom, maxZoom]`;`screenToWorld` / `worldToScreen` 做坐标换算。
- 截图:`scene.renderTo(ctx, { width: 1920, height: 1080 })` 按目标分辨率重新绘制(不是拷贝像素),矢量内容直接清晰。

## 7. 3D

软件投影画进 2D 画布(透视 + 平面明暗 + 隐藏线),和 2D 图元混排。

```ts
const cube = new Cube(70);                                              // 线框:可见边实线、隐藏边虚线
const ball = new Sphere(42).setStyle({ fill: '#93c5fd' });              // 设了 fill 就按深度排序填色 + 明暗
const torus = new ParametricSurface(torusParam(28, 12), { uSegs: 28, vSegs: 18 });
const blob = new ImplicitSurface(sphereToTorusField(36, 30, 12), { bounds: 58, resolution: 22, params: [0] });

await scene.play(new Spin3D(cube, 1, { runTime: 4 }));                  // 自转一圈
const view = new Projection3D({ rotX: -0.45, rotY: 0.6 });              // 共享视角
cube.setProjection(view);
ball.setProjection(view);
await scene.play(new Orbit3D(view, 1));                                 // 整组一起转
await scene.play(new ParamMorph(blob, [1], { runTime: 3 }));            // 参数形变(曲面按参数重采样)
```

- 立体:`Cube(size)`、`Cuboid(w, h, d)`、`Pyramid(底边, 高)`、`Tetrahedron(r)`、`TriangularPrism(r, h)`、`Cylinder(r, h, 分段)`、`Cone(r, h, 分段)`、`Sphere(r)`。
- 参数曲面:`new ParametricSurface(fn, { uSegs, vSegs, uRange, vRange, params, sided })`,预设 `sphereParam`、`torusParam`、`mobiusParam`、`kleinParam`、
  `sphereTorusHomotopy`(同伦形变,配 `ParamMorph`),以及 `sphereSurface(r)`。
- 隐式曲面:`new ImplicitSurface(field, { bounds, resolution, params })`,距离场 `sdSphere`、`sdTorus`、`sphereToTorusField`,marching tetrahedra 重建网格。
- 自定义网格:`new Mesh3D(顶点[], 面[])`,`setVertices` / `setVertexAt` 改几何;`MorphTo(mesh, 目标顶点)` 顶点补间。
- 坐标系:x 向右、y 向下、z 朝向观察者,角度一律弧度(只有 `Spin3D` / `Orbit3D` 的 `turns` 是圈数);实体、距离场与参数曲面预设都以 y 为对称轴。
- 法线:实体用 Newell 法线按「面心 − 顶点重心」定向(对任意凸体精确);参数曲面用四边形对角线叉积加全局朝向(极点处不退化);
  隐式曲面用三角形绕序叉积(marching tetrahedra 保证绕序朝外)。
- 隐藏线只做背面剔除(透视正确),对封闭可定向曲面才成立。开放或不可定向的曲面(莫比乌斯带、克莱因瓶、马鞍面、被包围盒截开的隐式曲面)按双面画:
  线框全画实线、填充按朝向观察者打光。参数曲面在构造时按网格缝判定,其余网格按拓扑判定;都可用 `sided` 选项覆盖。
- 参数曲面采样遇到 NaN(`sin(r)/r` 在 r = 0 这类可去奇点)会向定义域内侧挪万分之一格重取;±Infinity 视为真正的极点:构造时抛错,`resample` 时沿用上一次的位置并告警一次。
- 隐式曲面每次 `resample()` 重建网格:`resolution: 22` 每帧形变约 4 毫秒,调到 40 约 15 毫秒(node 实测 JS 开销)。
  参数不变时 `resample(params)` 是空操作;场函数读了外部状态时用不带参数的 `resample()` 强制重建。

## 8. 影片

影片 = 分段清单 + 播放器。分段是最小叙事单位:一个布景 + 一条时间线 + 若干字幕。完整教程见 [docs/segment-authoring.md](docs/segment-authoring.md)。

**写一个分段**(`src/film/` 下,引擎从 `../engine` 拿,模板从 `./film` 拿):

```ts
import { Axes, Create, FadeIn, FunctionGraph, Tex } from '../engine';
import { directedSegment } from './film';

export const slopeSegment = directedSegment(
  '斜率',   // 分段名(进度条提示、报错信息里显示)
  6,        // duration(秒):必须等于脚本实际时间线
  [
    { start: 0.3, end: 2.8, text: '先画坐标系,再画一条直线。' },
    { start: 3.0, end: 5.8, text: '斜率就是它倾斜的程度。' },
  ],
  async (env) => {
    const axes = new Axes([0, 5], [0, 4], 360, 280);
    const line = new FunctionGraph((x) => 0.6 * x + 0.5, axes);
    const k = new Tex('k = \\frac{\\Delta y}{\\Delta x}').setStyle({ fontSize: 40 }).moveTo({ x: 0, y: 200 });
    env.scene.add(axes, line, k);
    env.scene.fitObjects([axes, line, k], 40);
    await env.play(new FadeIn(axes));                 // 0~1
    await env.play(new Create(line, { runTime: 1.5 })); // 1~2.5
    await env.play(new FadeIn(k));                    // 2.5~3.5
    await env.wait(2.5);                              // 3.5~6
  },
);
```

- **用 `env.play` / `env.wait`**(不要直接调 `scene.play`):分段被跳过或销毁时它们抛取消哨兵,脚本直接结束。
  长段同步搭建之后可以加一句 `env.checkpoint()`;`env.isCancelled()` 很少需要。
- **`duration` 必须等于脚本实际时间线**(±0.25 秒):进度条、跳转、字幕钳位、导出进度都信任它。字幕 `[start, end)` 左闭右开、不重叠。
  `node scripts/test.mjs content` 把每个分段完整干跑一遍,核对时长与字幕。
- 其它模板:`cardSegment({ name, title | titleTex, heading | headingTex, narration, holdSeconds, … })`(标题 / 章节 / 片尾卡,时长 = 1 + `holdSeconds`);
  `helpers.ts` 里有 `listSegment`(逐条列点)、`chapterCard`(章节卡)、`plotIntro`(坐标系开场)、`fadeSequence`、`sweep`、`tangentProbe`、
  `tex` / `label` / `stage` / `hide` / `unrevealed` 等布景助手,窄屏分支用 `isNarrow(scene)` 与 `sideColumn`。
- 章节:分段带 `marker: 'chapter'` 与 `chapter: '短标题'` 时,进度条上标出大刻度和章名。

**接进影片、播放**:

```ts
import { runFilm } from './film';

export const myFilm = [titleCard, slopeSegment, endCard];   // 分段清单
const controller = runFilm(canvas, myFilm, { loop: false, onEnded: () => showReplayButton() });
controller.seekToTime(12.5);  // 跳到全片 12.5 秒(精确到段内);seekTo(i) 按段跳
controller.setPaused(true);
controller.getState();        // { mode, index, segment, position, total, paused, exporting, … }
controller();                 // = dispose()
```

- 选项:`transition`(转场单边时长,缺省 0.6 秒)、`transitionColor`、`loop`(缺省 true)、`subtitles` / `subtitleStyle`、`progress` / `progressStyle`、
  `onSegment` / `onPausedChange` / `onEnded` / `onError`,以及测试注入用的 `clock` / `exportEnv` / `offlineEnv`。
- 字幕是 DOM 字幕条 + 常驻的视觉隐藏播报区;进度条可点击、可键盘操作(见 [1](#1-跑起来))。
- 把影片挂到页面上:在 `SCENES` 里加一项 `kind: 'film'`,`load` 里 `fromFilm(runFilm(canvas, 清单, { onPausedChange: hooks.onPausedChange }))`,
  再加 `preview: filmPreview(…)` 就支持 `?preview=`(照 `derivatives` 那一项写)。

**自己建 Scene 的分段**:分段句柄即场景句柄(`SegmentHandle` = `RecordableSceneHandle` 去掉 `exportVideo`,再加 `done`)。
播放器在画布尺寸变化时调 `resize(context)`,带着按新字号重算的字幕安全区,句柄要先更新安全区;
离线导出与预览经 `SegmentContext` 传入 `clock` 与 `viewport`,要原样传给 `SceneOptions`。用 `segments.ts` 模板写的分段自动处理好,
自己建 Scene 的照 `scenes/pythagoras.ts` 写。

**单帧预览**:`/?scene=derivatives&preview=480` 看第 480 秒;程序里 `previewFrameAt(segments, seconds, canvas)` 返回
`{ index, offset, name, subtitle, position }`(只挂目标段、虚拟时钟干跑到位、画一帧即释放,与离线导出同一套步进)。
时间线工具:`filmDuration`、`segmentAtTime`、`segmentIndexAt`、`segmentTicks`、`subtitleAt`。

## 9. 导出视频

```ts
const handle = controller.exportVideo({
  mode: 'auto',           // 'auto'(缺省)| 'offline' | 'realtime'
  fps: 30,                // 离线导出帧率
  maxLongEdge: 1920,      // 长边上限(竖屏限高)
  mimeType: 'video/mp4',  // 缺省自动(MP4 优先)
  onProgress: (sec, total) => updateProgressBar(sec / total), // 按片内位置报进度
});
const blob = await handle.done;   // handle.mode 是实际走的路;handle.cancel() 随时取消
```

`'auto'`:浏览器的 WebCodecs 编得了所选容器就离线,否则退回实时录制。两条路共用同一套合成:
每帧按「主画面(contain 适配,已含公式)→ 转场白闪 → 字幕」画进导出画布,字幕与预览同一套样式
(文字区最宽为画面宽的 80%,拉丁词整体换行、中日韩文字逐字换行);进度条不进成片。成片总是从第 0 段、白场淡入开始。

**离线逐帧渲染**(`'offline'`,有 WebCodecs 时的缺省)

- 另起一套无界面的播放器实例,在离屏画布上用虚拟时钟逐帧推进,合成好的帧交给 WebCodecs 编码(mediabunny 封装,首次导出时才按需加载)。
- 时间戳按帧号精确给出(第 i 帧 = i / fps),与墙钟无关:比实时快、不掉帧,**切到后台标签页也照样导出**(每帧用 MessageChannel 让出)。
- 不占用预览:导出期间预览照常播放、跳转、暂停、换画幅;成片按开始导出时的画幅与字幕样式出。
- 容器:MP4 依次试 H.264 → HEVC → AV1 → VP9,WebM 依次试 VP9 → VP8 → AV1;成片 `Blob.type` 是实际编出来的格式。
  成片长边直接取上限:内容是矢量,放大不糊。
- 显式 `mode: 'offline'` 时:没有 WebCodecs 报 `'unsupported'`,编不了所选容器报 `'unsupported-mime'`;`'auto'` 遇到这两种情况改走实时录制。

**实时录制**(`'realtime'`,没有 WebCodecs 时的回退)

- `captureStream(30)` + `MediaRecorder` 墙钟实时录一遍,合成节流到约 30fps。导出期间跳转、暂停、横竖屏重建都被锁定。
- **页面必须保持在前台**,切到后台会直接中止并报错。看门狗每秒检查编码链路(画布被污染、轨道结束、持续静音、编码器自停、长时间不交数据),出问题立即带错收尾。
- 导出尺寸按画布 backing 等比缩小,长边默认不超过 1920,奇数边补成偶数(H.264 要求)。

**共同约定**

- 同一时间只允许一个导出(`getState().exporting`);`onProgress` 按片内位置报进度(转场不计);`cancel()` 立即停止并释放编码器,播放器销毁时以 `'disposed'` 中止。
- 失败 / 取消都以 `FilmError` reject,宿主按 `code` 分支(`'cancelled'`、`'unsupported'`、`'unsupported-mime'`、`'tainted'`、`'encoder'`、`'overrun'`……,完整列表见 [docs/api.md](docs/api.md)),
  `message` 是给用户看的中文说明;显式指定的容器不支持时直接失败,不静默换格式。

## 10. 开发与测试

```bash
npm run typecheck           # tsc -b(含 scripts/*.mjs 的 checkJs)
npm run lint                # oxlint(依赖环、分层导入)+ scripts/check-imports.mjs(含纯类型 import 的依赖环)
npm test                    # 跑 src 下全部 *.test.ts
node scripts/test.mjs film  # 只跑路径包含关键字的测试文件(可给多个)
npm run test:runner         # 测试运行器自测
npm run check               # typecheck + lint + test + test:runner
npm run build               # 类型检查 + 生产构建
npm run bench               # 性能基线(与 scripts/bench.baseline.json 比对)
npm run bench -- --save     # 存成新基线(--strict 下退化超 25% 失败)
```

- 用例跑在 Vite 的 SSR 模块加载器里(`scripts/test.mjs`),极简测试壳在 `src/testing/harness.ts`(`suite` / `equal` / `ok` / `close` / `throws` / `quiet`)。
  单条用例默认 10 秒超时(`TEST_TIMEOUT` 可调),失败栈映射回源码行号;漏接的 rejection 记成当时那条用例的失败。
- 断言绘制:`fakeCtx()` 是记录调用的假 2D 上下文,`stateAt(calls, 'stroke', 'strokeStyle')` 取画某一笔时的样式;
  端到端:`installDomStub()` 装上 rAF / 时钟 / 画布桩,`dom.frame(16)` 推一帧,真实地跑 `scene.play`。
- 公式在 node 里走的就是真实的 MathJax 排版,测试直接断言字形路径与尺寸。
- 注意:测试运行器只剥类型、不查类型,类型错误要靠 `npm run typecheck`;同步死循环会堵住事件循环,单测超时拦不住。
- 性能基线跑的是 CPU 侧(排版 / 插值 / 合成 / 曲面提取),看相对变化,不看绝对毫秒;改了排版、帧泵、合成、预览快进就跑一遍。
- oxlint 的类型感知规则(`no-floating-promises` 等)需要 `oxlint-tsgolint` + `--type-aware`,目前没有启用。

## 11. 目录与分层

```
src/
  App.tsx / main.tsx  # 宿主:挂画布、工具条、导出按钮(薄视图)
  sceneRegistry.ts    # 场景注册表 + App 的纯逻辑(场景解析、下载文件名、错误文案…),可单测
  engine/             # 引擎本体:不依赖 React,也不知道 film / scenes / export 的存在
    mobjects/         # MObject、Group、PathShape 与 2D 图元、坐标系与函数图像、Tex、标注图元
                      #   (annotations 花括号与角、numberLine 数轴与网格、plots 面积/黎曼/切线、vectorField、charts)
    mobjects3d/       # Mesh3D、立体、参数曲面、共享视角
    implicit/         # 距离场 + marching tetrahedra 隐式曲面
    animations/       # Playable、缓动、基础动画、Transform、Write、TransformMatchingTex、
                      #   composition 组合、emphasis 强调、styleTween 换色、3D 动画、ValueTracker
    camera/           # Camera(世界↔屏幕)、CameraMove、镜头跟随
    layout/           # 行列容器 Layout
    renderer/         # CanvasRenderer;fontEvents(网页字体加载完成事件)
    path/             # 矢量路径:三次贝塞尔、SVG path 解析、弧长截取、变形对齐、通用绘制、书写节奏
    math/             # 公式排版:MathJax(TeX → SVG,轻量 DOM)→ 字形路径、命名部分与结构信息
    color.ts          # 颜色解析/格式化/OKLab 插值/强调色
    scene/            # Scene(组装根)、FramePump(帧泵)、PointerController(指针/键盘)、framing(取景)
    theme/            # Theme、样式解析与预设
    index.ts          # 公共 API,外部只从这里 import
  film/               # 影片播放器与内容
    film.ts           # runFilm 组装根(影片层唯一出口)
    driver.ts         # 分段调度状态机;offline.ts 离线逐帧导出;preview.ts 单帧预览与段内快进
    chrome.ts         # DOM 白闪、字幕条、进度条(只从状态渲染,不回读 DOM)
    segments.ts       # 分段模板:directedSegment、cardSegment;helpers.ts 内容助手
    transition.ts / timeline.ts / types.ts
    program.ts / derivatives.ts / rules.ts / mvt.ts / applications.ts / advanced.ts / topology.ts  # 内容脚本
  export/             # 导出层:实时录制、看门狗、合成、选项与错误模型;离线编码端(encoder.ts)与离线环境
  scenes/             # 单场景 demo(总览、勾股、讲解词汇演示)、画廊、场景句柄契约
  testing/            # 极简测试壳、假 2D 上下文、DOM / 导出桩、bench 负载定义
docs/                 # 分段教程、API 速查、讲解词汇详解
scripts/              # test.mjs 测试运行器、selftest.mjs、check-imports.mjs、bench.mjs
```

依赖方向是单向的:

```
app(App / sceneRegistry)→ film → scenes → engine
app、film、scenes(仅类型)→ export(底层,不依赖任何其它层)
```

分层由 oxlint 的 `no-restricted-imports` 检查(含 `import type` 与动态 `import()`);依赖环由 oxlint 的 `import/no-cycle` 查值 import,
纯类型 import 形成的环由 `scripts/check-imports.mjs` 补上。engine 只从 `src/engine/index.ts` 进,film 只从 `src/film/film.ts` 进,
没在出口文件里的都是内部实现。

## 12. 已知取舍

- 3D 是画家算法 + 每面一个法线,没有 z-buffer:相互穿插的面会穿帮;隐藏线只是背面剔除,非凸的封闭曲面(环面内侧)被自身遮挡的边仍画实线。
- `Projection3D` 可以让一组网格共享视角,但投影仍以**每个网格自身的原点**为灭点,并排的两个立体不是严格的单点透视。
- 离线导出的成片整个放在内存里(MP4 fast start):9 分钟长片按约 6 Mbps 估算最坏几百 MB,收尾时短暂翻倍;离线渲染与预览共用主线程,导出期间预览可能掉帧。
- 公式的排版风格来自 MathJax 的 TeX 字体;中文靠画布文字,字宽按一个字号估计。
- `Layout` 不压缩子元素,超长时允许溢出(center / end 与 CSS 一样向两侧 / 起始侧溢出),由调用方保证尺寸。
- `Transform` 是逐点线性插值(与 Manim 相同):相对转角很大时中途会先缩再展开;配对按顺序(按字形身份配对用 `TransformMatchingTex`),
  两组数量不同时多出来的从中心长出来,而不是按比例复制。变形期间 `Layout` 的裁剪与边框不画,祖先容器的不透明度不参与插值。
- 强调动画的着色不影响公式里 `\textcolor` 显式上色的部分(指定 `part` 时除外)与变形中的覆盖层。

## 13. 更多文档

- [docs/segment-authoring.md](docs/segment-authoring.md):从零写一个分段(模板、时长契约、单帧预览调试)。
- [docs/explainer-vocabulary.md](docs/explainer-vocabulary.md):讲解词汇详解(编排、强调、换色、标注图元、按结构推导的全部选项与示例)。
- [docs/api.md](docs/api.md):API 速查(各层出口、关键签名、导出错误码、命令)。
