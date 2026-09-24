# API 速查

分层:`app(App/sceneRegistry) → film → scenes → engine`,`export` 是底层(只被依赖)。
`engine` 只从 `src/engine/index.ts` 进,`film` 只从 `src/film/film.ts` 进;
没在出口文件里的都是内部实现。分层与依赖环由 `npm run lint` 卡住。

## engine(渲染与动画)

```ts
import { Circle, Create, FadeIn, Label, Scene, Tex, lightTheme } from '../engine';
```

- **场景** `Scene(canvas, { theme?, camera?, clock?, viewport? })`:
  `add/remove`、`play(...playables)`(同播,`await` 到完)、`wait(秒)`、
  `fitObjects(对象, 边距)` / `playFit` / `computeFitView`(取景,尊重安全区)、
  `setSafeArea`、`addUpdater`、`render()` / `renderTo(ctx, 矩形)`(任意分辨率重画)、
  `setPaused` / `getElapsed`、`resizeAndRefit()`、`setDryRun`(干跑:推进时间线不画画)、`dispose()`。
  时钟注入 `FrameClock`(`browserClock` 默认):测试与离线导出换虚拟时钟,整片一套时间。
- **图元** `MObject` / `Group`:`.moveTo(点)`、`.setStyle({...})`(自身 > 容器链 >
  构造默认 > 主题)、`.opacity`、`getBox()`。`Circle` / `Ellipse` / `Arc` / `Sector` / `Dot`、
  `Rectangle` / `Square`、`Line` / `Arrow` / `Polygon`(多边形/正多边形/三角形)/
  `Star`、`Annotation`、`SvgPath`(SVG `d` 串)、`Label`(文字,逐字 `Create`)。
- **函数** `Axes(xRange, yRange, 宽, 高)`、`FunctionGraph(fn, axes)`、
  `ParametricCurve2D`、`Trace`(轨迹,每帧整体 `setPoints`)。
- **公式** `Tex('...')`:MathJax 排成矢量字形,和图形画在同一张画布上;
  `getBox()` 同步可知;支持 `Create` / `Write`(逐字形描轮廓再填充)。
  逐帧变化的数字用 `Label`(每个新串都重排一次)。
- **动画** `Create`(描边生长)、`FadeIn/FadeOut/FadeTransform`、`MoveTo/RotateTo/ScaleTo`、
  `Transform(源, 目标)`(替换语义:位置/形状/颜色一起变)、`Write`(逐笔书写)、
  `TweenValue` + `ValueTracker`(外部参数)、缓动 `linear/smooth/easeIn/easeOut/easeInOut`。
  自定义:继承 `BasePlayable` 实现 `begin/interpolate/finish`。
- **按结构推导** `TransformMatchingTex(源, 目标, { partMap, transformMismatches, matchAcrossSizes, duplicates, fadeLag, fadeScale })`:
  相同的项平移、变了的才变形;公式里用 `\class{名字}{…}` 标部分(`tex.partNames` / `getPartBox` / `partLayers`)。
- **编排** `AnimationGroup` / `LaggedStart`(`lagRatio` 缺省 0.2)/ `Succession`(轮到才 begin)/ `Wait`。
- **强调** `Indicate` / `Circumscribe` / `Flash` / `Wiggle`(渲染期临时效果,播完精确复原;都支持 `part`);
  **换色** `ColorTo(对象, 颜色 | { stroke, fill, textColor, strokeWidth, color })`;
  缓动另有 `thereAndBack` / `thereAndBackWithPause` / `wiggle` / `rushInto` / `rushFrom` / `doubleSmooth` / `squish`。
- **标注图元** `Brace`(`Brace.for(目标, 方向)`)、`Angle` / `RightAngle`、`NumberLine`、`NumberPlane`(`c2p` / `p2c`)、
  `AreaUnderCurve`、`RiemannRectangles` + `RiemannTo`、`TangentLine` / `SecantLine`、`VectorField`、`BarChart` + `BarChartTo`;
  按坐标系取样的都接受 `CoordinateSystem`(`Axes` 与 `NumberPlane`)。详见 `docs/explainer-vocabulary.md`。
- **相机** `Camera`、`CameraMove`、`createCameraFollow`(跟随)。
- **3D**(软件投影画进 2D 画布)`Mesh3D`、`ParametricSurface`(球/环/莫比乌斯/克莱因)、
  立体(`Cube/Sphere/Cylinder/...`)、`Projection3D`(多网格共享视角)、
  `Orbit3D/Spin3D`、`ImplicitSurface`(`sdSphere/sdTorus` + `polygonize`  marching tetrahedra)。
- **路径** `PathData`/`PathBuilder`/`parseSvgPath`、`partialPath`(按弧长截取,生长动画用)、
  `alignPaths`/`lerpPath`(变形对齐与插值)。
- **排版** `Layout`(行列容器,一次性排布)、`Theme`(浅色 `lightTheme` 等预设)。

## film(播放器与内容)

```ts
import { cardSegment, directedSegment, runFilm } from './film';
import type { Segment } from './film';
```

- **分段** `Segment { name, duration, subtitles?, marker?, chapter?, play(canvas, context?) }`。
  `duration` = 脚本实际时间线(±0.25 秒,内容测试卡);字幕 `[start, end)` 左闭右开、不重叠。
  `cardSegment({...})`(标题卡,时长 = 1 + `holdSeconds`);`directedSegment(名, 时长, 字幕, direct)`:
  `direct(env)` 里 `env.play/env.wait`,取消时抛哨兵,脚本直接结束。
- **播放器** `runFilm(canvas, segments, options)` 返回控制器(可调用 = `dispose`):
  `seekTo(i)`(按段)、`seekToTime(秒)`(精确到段内:重挂 + 快进 + 跟墙钟续播)、
  `setPaused`、`exportVideo(options?)`、`getState()`。
  选项:转场、循环、字幕/进度条样式、`onSegment` / `onError` / `onPausedChange` / `onEnded`、
  时钟与环境注入(`clock` / `exportEnv` / `offlineEnv`,测试用)。
- **配音** `timedSegment({ id, name, lines: [{ id, text }] }, async (env) => …)`:按台词对齐的分段,
  `env.untilLine(id)` / `env.untilMark(lineId, mark)` / `env.remaining(id)` 踩提示点,时长与字幕时间来自配音时间表;
  `prepareVoice(segments, { sheetUrl })` 加载时统一套用(没有时间表时干跑排草稿),产出时长确定的普通分段(`segment.voice.clips`)。
  控制器 `setAudioEnabled(on)`(须在点击回调里调用;实时录制期间关声音被忽略)、`getState().audio`;
  `exportVideo({ audio })` 成片带配音(缺省带),进没进成片看返回句柄的 `audio`。
  外部配音方的接入见 `docs/voice.md`。
- **单帧预览** `previewFrameAt(segments, seconds, canvas)` → `{ index, offset, name, subtitle, position }`:
  只挂目标段、虚拟时钟快进(干跑)到位,画一帧即释放;与离线导出同一套步进。
  页面:`/?scene=derivatives&preview=480` 直接看第 480 秒。
- **内部**:`FilmDriver`(调度状态机)、`timeline`(排片/字幕/刻度纯计算)、
  `transition.Veil`(白闪)、`chrome`(DOM 字幕条/进度条,只渲染状态;进度条按 `ProgressVisual` 搭,
  导出用它解析出的字体与颜色)、
  `offline`(离线导出驱动)。进度条点击精确到秒,方向键按段、PageUp/Down 按章节。

## export(导出层)

```ts
controller.exportVideo({ mode?: 'auto' | 'offline' | 'realtime', fps?, maxLongEdge?, mimeType?, onProgress?, audio?, progress? })
```

- `auto`(默认):WebCodecs 能编就**离线**(虚拟时钟逐帧渲染,比实时快、可后台、不占预览),
  否则退回**实时**(`captureStream` + `MediaRecorder`,前台实时录一遍);片子有配音而离线带不上
  (没有 OfflineAudioContext、编码端编不了音频)、实时录制又录得进(录得了所选容器、接得出录制音轨)时也改走实时。
- `audio`(缺省 true):带配音;`progress`(缺省 true):带进度条,只能关 —— 播放器 `progress: false` 时成片恒不带。
- 返回 `{ done: Promise<Blob>, mimeType, mode, audio, cancel() }`。`audio` 是 `ExportAudioReport
  { status: 'pending' | 'none' | 'off' | 'included' | 'partial' | 'dropped', codec?, reason?, note?, failed? }`,
  done resolve 之后是定论;配音没进成片不算导出失败,宿主应把 `reason` / `note` 告诉用户。失败 reject `FilmError`,
  宿主按 `code` 分支(`cancelled/disposed/busy/no-segments/unsupported/unsupported-mime/init/
  recorder/hidden/composite/tainted/track-ended/track-muted/recorder-stopped/stalled/
  empty-output/encoder-starved/segments-failed/crashed/encoder/overrun`),不要匹配文案,
  诊断细节在 `detail`。
- 合成(`compositeFrame`:主画面 + 白闪 + 字幕 + 进度条)实时/离线共用一套;字幕与进度条的样式
  (`SubtitleVisual` / `ProgressVisual`)由播放器解析一次,DOM 与导出共用;
  看门狗(`watchdog`)盯实时录制的断流(轨道结束/静音/自停/8 秒无数据)。

## scenes / 宿主 / 测试

- `scenes/types`: `SceneHandle { dispose, resize, setPaused?, exportVideo?, audioAvailable?, audioEnabled?, setAudioEnabled? }`(四个入口统一句柄)、
  `SceneContext { safeArea?, clock?, viewport? }`(播放器传给分段的契约,离线/预览靠它复用场景)、
  `SceneEntry { title, kind, interactive, load, preview? }`。
- `sceneRegistry`:?scene= 路由(防原型链污染)、场景懒加载、格式探测(`supportedFormats`:
  MediaRecorder ∪ WebCodecs)、下载命名、错误文案、导出后的配音提示(`exportAudioMessage`)。`?preview=` 只认非负有限数字。
- `App.tsx`:薄视图 —— 画布 + 工具条(画幅/暂停/声音/导出/格式)+ 预览徽标;导出完成后按配音报告显示提示;挂载失败走 `loadError`。
- `testing`:自研小测试壳(`suite/equal/ok/close/quiet`)、`fakeCtx`(记录调用的假 2D 上下文)、
  `domStub`(rAF/时钟/画布桩)、`exportStub`(document/MediaRecorder/ResizeObserver 桩)。
  `node scripts/test.mjs [关键字...]` 按路径过滤;`TEST_TIMEOUT` 调单条超时。

## 命令

```bash
npm run dev                     # 开发服务
npm run build                   # 类型检查 + 生产构建
npm run check                   # typecheck + lint + 全测试 + 运行器自测
npm run bench                   # 性能基线(与 scripts/bench.baseline.json 比对)
npm run bench -- render         # 只跑名字含 render 的负载
npm run bench -- --save         # 存成新基线
npm run bench -- --strict       # 任一负载慢 25% 以上就失败(exit 2)
```

基线跑的是 CPU 侧(排版/插值/合成/曲面提取),不含 GPU:看相对变化,不看绝对毫秒。
绝对帧率去浏览器里看;改了排版/泵/合成/预览快进就跑一遍 bench。
