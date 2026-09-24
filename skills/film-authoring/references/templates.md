# 片子模板索引

12 个现成的起点,完整代码都在 `README.md` 第 4 节对应小节的折叠块里(`<details>` 展开,代码块第一行是 `// src/film/tpl….ts`)。
用法:`grep -n '^### 4.6' README.md` 定位 → 把折叠块里的代码存成表中的文件 → 按 SKILL.md「注册新片」登记(键用表中的) → `/?scene=<键>` 试跑 → 复制成自己的片名再改。

## 怎么选:观众看完要记住什么

| README 小节 | 观众要记住的 | 文件(`src/film/`) | 键 | 整部片子 | 示例 |
| --- | --- | --- | --- | --- | --- |
| 4.2 一分钟概念短片 | 一个画面 | `tplConcept.ts` | `tplconcept` | `tplConceptFilm` | 圆面积:扇形切开重排,越切越细 |
| 4.3 几何证明片 | 一条逻辑链 | `tplProof.ts` | `tplproof` | `tplProofFilm` | 三角形内角和:拖动观察 → 平行线证明 |
| 4.4 公式推导片 | 一串式子怎么变过来 | `tplDerive.ts` | `tplderive` | `tplDeriveFilm` | 配方法解 x² + 6x = 7 |
| 4.5 函数图像探索片 | 一个参数管什么 | `tplExplore.ts` | `tplexplore` | `tplExploreFilm` | y = ax² 扫 a;切线探针 |
| 4.6 极限与逼近片 | 一个量逼近到哪里 | `tplLimit.ts` | `tpllimit` | `tplLimitFilm` | 左右端点矩形夹逼 ∫₀¹x² = 1/3 |
| 4.7 对比与误区片 | 一个「不要这样做」 | `tplCompare.ts` | `tplcompare` | `tplCompareFilm` | (a+b)² ≠ a² + b²:反例 + 图 |
| 4.8 习题讲解片 | 一道题的解法 | `tplQuiz.ts` | `tplquiz` | `tplQuizFilm` | 选择题:题干 → 选项 → 思考 7 秒 → 揭晓 → 解析 |
| 4.9 三分钟章节短片 | 一个主题的三四个要点 | `tplChapters.ts` | `tplchapters` | `tplChaptersFilm` | 圆周率:三章,画面段与列表段交替 |
| 4.10 十分钟完整一集 | 一整集 | `tplEpisode.ts` | `tplepisode` | `tplEpisodeFilm` | 用其他模板导出的分段拼成五章 |
| 4.11 配音驱动短片 | 按台词踩点 | `tplVoice.ts` | `tplvoice` | `tplVoiceFilm` | 高斯求和:timedSegment + mark |
| 4.12 3D 直观片 | 立体的东西 | `tpl3d.ts` | `tpl3d` | `tpl3dFilm` | 圆锥 : 球 : 圆柱 = 1 : 2 : 3 |
| 4.13 镜头套路速查 | 只想拍某一个镜头 | `tplShots.ts` | `tplshots` | `tplShotsFilm` | 割线逼近、联动双视图、牛顿法、原像… |

依赖:4.10 import 了 4.2–4.8、4.12 的分段(那些文件要在 `src/film/` 里,不必登记);4.11 含 timedSegment,不进 `content.test.ts`,照 README 5.5 另写测试。

## 各模板要点

**4.2 一分钟概念短片**(50–65 秒,内容段 ≤ 3、每段 12–17 秒)——「切开 → 重排 → 取极限」类直观。多块图形 `MoveTo` + `RotateTo` 分批入列,`Create` 虚线轮廓,`Brace` 量边。易错:字幕别比画面说得多(16 块只是「近似」);`RotateTo` 按绝对角度补间、不走最短路。

**4.3 几何证明片**(50–90 秒)——先 `sweep` 拖动顶点让观众看到「和始终 180°」,再作辅助线证明。搬角用**先藏的替身** + `Transform`(源会被置为透明);合起来用同时 `Indicate`,结论 `ColorTo` 绿 + `Circumscribe` +「证毕」。每步依据(内错角相等…)进字幕。

**4.4 公式推导片**(40–100 秒,一段 2–3 步,超过 6 步拆段)——`TransformMatchingTex` 相同项平移、新项淡入;上方灰字写每步理由(≤ 8 字),换形前停 2.5–3.5 秒。链上每一步都要一起 `stage`、后面的先 `hide`;变形后对目标做后续动画。整块对应用 `\class{名}{…}` 起同名。

**4.5 函数图像探索片**(50–90 秒)——会动的曲线(不闭合 `Polygon` 逐帧 `setPoints`;`FunctionGraph` 建好不能改)+ 不动的对照虚线 + 实时读数(`label` + `toFixed`)。每段:主扫 4–5 秒 → 反向扫 → 回到关键值 1.5–2 秒 → 结论。结论要对着画面停住的值,范围说准(a > 0)。

**4.6 极限与逼近片**(50–90 秒)——`RiemannRectangles` + `RiemannTo` 逐次加细(n 翻倍,每次 1.2 秒,之后停 1.5–2),读数同播;夹逼 + 差趋于 0 才说明极限存在。面积、矩形要加进坐标系的组。割线 → 切线用 4.13 的 `secantSegment`(h 扫到 0.03,不能到 0)。

**4.7 对比与误区片**(40–80 秒)——先反例(两栏 `columnList` 代入,等号 `FadeTransform` 成 ≠ 并变红),再用图指出错在哪(多出的 2ab `ColorTo` 粉)。话别太绝对(「一般不成立」)。字幕不写「右边那幅图」——竖屏会变上下;左右并排在 `isNarrow` 分支里改上下叠放。

**4.8 习题讲解片**——`quizSegment(spec)` 工厂:题干 FadeIn 1 → 停 1.5 → 选项各 0.8 → 计时条 `sweep` + `linear` 6.5 秒 → 揭晓(✓、`ColorTo` 绿 / 灰)→ 停 4.5,共 17.9 秒(4 个选项 18.7)。提示放思考后半段;答案字幕晚于揭晓,不先说后演。选项、✓、计时条先 `hide`。

**4.9 三分钟章节短片**(2–3 分钟)——片头 → 目录 `listSegment` → 三章 ×(`chapterCard` + 1–4 段)→ 片尾;讲一段、歇一段(画面段 15–21 秒,列表段 11–13 秒)。章名别写「第一章」(进度条自动编号)。现成的段可以整章拼进来。

**4.10 十分钟完整一集**(8–10 分钟)——长片是拼出来的:片头 + 提要 + 5 ×(章节卡 + 现成的段 + 一道题)+ 小结 + 片尾。五章串成一条线,提要和章节卡小字说出这条线。易错:接续上一段末帧的段不能拆开;分段名(即缺省配音 id)不能重名;同名导出用 `as` 改名。

**4.11 配音驱动短片**——`timedSegment`:台词带稳定 id,要对齐的词前插 `<mark name="k"/>`;脚本用 `untilLine` / `untilMark` 踩点,跟着台词伸缩的动画用 `playUntil({ end: id } / { line: id, mark: 'k' }, 动画)` / `playThrough(id, 动画)` 写「在哪儿收住」(不拿 `remaining` 算时长);末尾自己 `await env.wait(3)`。流程:`voice:script` → 配音方交音频 + measured.json → `voice:layout` → 放进 `public/voice/<voiceId>/` → `voice:check`(README §10)。

**4.12 3D 直观片**——`Projection3D({ rotX: -0.45, rotY: 0.6 })` 让几个网格共用视角,`Orbit3D(view, 圈数, { runTime })` 整组转;立体 `Cube` / `Cylinder` / `Cone` / `Sphere` / `Pyramid`…,曲面 `ParametricSurface`(`resample([参数])` 变形)。网格一律 `FadeIn`(不能 `Create`);网格之间不遮挡;圆的立体转起来看不出变化,转方的。要坐标轴、空间曲线、顶点字母:`Axes3D` / `Line3D` / `ParametricCurve3D` / `Anchor3D` 和网格放进同一个 `Space3D`(README 9.6,完整例子《圆柱螺旋线》),线条能 `Create`,被挡住的部分自动画虚线;俯仰、换方位用 `ViewTo`。

## 镜头套路(README 4.13 有完整表)

| 套路 | 主要 API | 典型时长 |
| --- | --- | --- |
| 片头卡 / 章节卡 / 片尾卡 | `cardSegment`、`chapterCard` | 5 / 7 / 4–6 |
| 目录、提要、列点小结、公式表 | `listSegment`(居中);左对齐 `columnList({ align: 'start' })` + `fadeSequence` | 9–18 |
| 坐标系开场 + 标注 | `makePlot` + `plotIntro`(3.5)+ `Dot(7)` + `tex` | 16 |
| 割线逼近切线 | `drawAt(h)` + `sweep({ from: 3, to: 0.03, runTime: 9 })`,最后换切线 1.2 | 19–20 |
| 数值逼近表 / 读数换形 | `listSegment`(gap 1.5);`FadeTransform(读数, 新文字)` | 11–17.5 |
| 公式原地演化 / 按结构推导 | `FadeTransform`(1.5,前停 3–3.5)/ `TransformMatchingTex`(1.3) | 15–17 |
| 切线探针扫动 | `tangentProbe` + `sweep`(主扫 5–10 + 回扫 1.5–2) | 18–21 |
| 联动双视图 | 一个 `drawAt(x)` 同时改图形与图像上的点、读数;主扫 `linear`,回到最优值再下结论 | 18.5–21 |
| 图 + 侧栏推导 | `sideColumn(scene, n)` + `isNarrow` + `fadeSequence` | 15–21 |
| 逐次逼近(叠加 → 替换) | `FadeOut(旧)` + `FadeIn(新)` 0.8 | 15–25 |
| 迭代构造(牛顿法) | 每步 `Create(切线, 1.5)` + `FadeIn(垂线、落点, 1)`,停 1 | 19–20 |
| 习题 | `quizSegment` | 17.9 |
| 集合 / 映射示意图 | `Ellipse` / `Circle` / `Arrow` 用 `Create` 1–1.2,关注的集合填 `#dbeafe` | 9–10.5 |
| 按台词踩点 | `timedSegment` + `untilLine` / `untilMark` / `playUntil` / `playThrough` | 每句 3–6 |
| 高亮圈注 | `Indicate` / `Circumscribe`(`{ part }` 配 `\class{名}{…}`);持久变色 `ColorTo` | 各约 1 |
| 黎曼和加细 | `RiemannTo`(1.2,之后停 1–1.5) | — |
| 运镜 | `scene.playFit(对象[], { runTime: 2 })` 与 `env.play(Create…)` 放进同一个 `Promise.all`,之后 `env.checkpoint()` | 2–2.2 |
| 3D 旋转展示 | `Orbit3D` / `ParamMorph`;俯仰、换方位用 `ViewTo`(约 3) | 2.4 / 4 |
