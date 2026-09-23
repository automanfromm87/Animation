# 讲解动画的词汇

讲清楚一件事,光有「出现 / 消失 / 变形」不够:要能**编排节奏**(错峰出场、一步接一步)、
**指给观众看**(高亮、圈出、闪一下、换色)、**标注**(大括号、角、数轴、坐标网格、面积、切线……),
以及**按式子结构推导**(相同的项平移、变了的部分变形)。这一篇是这些词汇的用法。

全部从 `src/engine/index.ts` 导入;例子里的 `env.play` / `env.wait` 见 [segment-authoring.md](segment-authoring.md)。

## 1. 编排:组合动画

组合动画本身也是一个动画(`Playable`),可以交给 `env.play`,也可以互相嵌套。

| 写法 | 效果 |
| --- | --- |
| `new AnimationGroup([a, b, c])` | 同时开始,时长取最长的 |
| `new LaggedStart([a, b, c], { lagRatio: 0.3 })` | 错峰:上一个播到 30% 时下一个开始(缺省 0.2) |
| `new Succession([a, b, c])` | 一个接一个,首尾相接 |
| `new Wait(0.5)` | 在组里留一段停顿 |

```ts
import { FadeIn, LaggedStart, MoveTo, Succession, Transform, Wait } from '../engine';

// 五个圆点依次淡入(常见写法:map 出一组同类动画)
await env.play(new LaggedStart(dots.map((d) => new FadeIn(d)), { lagRatio: 0.25 }));

// 同一个点:先走到 A、停一下、再走到 B —— Succession 让第二段从 A 出发
await env.play(new Succession([new MoveTo(p, A), new Wait(0.3), new MoveTo(p, B)]));

// 连续变形 a → b → c(三个对象都先 scene.add;b、c 开始时会被自动藏起来)
await env.play(new Succession([new Transform(a, b), new Transform(b, c)]));
```

要点:

- **时长**:缺省是子动画排出来的总长;给组指定 `runTime` 则整条时间轴按比例伸缩。
  组的 `rateFunc` 缺省 `linear`(它扭曲的是整条时间轴),子动画各自的缓动照常生效。
- **LaggedStart / AnimationGroup 一开始就 begin 全部子动画**:`FadeIn` / `Create` / `Transform`
  这类入场动画会先把各自的对象藏好,轮到时才出现 —— 错峰出场直接写就对。
- **Succession 轮到谁才 begin 谁**,捕获的是那一刻的状态,所以连续移动、连续变形能首尾相接。
  也因此排在后面的入场对象在轮到之前保持原样:要一直藏到轮到时,先把它的 `opacity` 设为 0
  (`FadeIn` 会淡入到 1),或者改用 `new LaggedStart([...], { lagRatio: 1 })`。
- 每个子动画走到自己的终点就单独收尾(终态精确);某个子动画出错时,其余的照常收尾,
  `env.play` 以第一个错误 reject。

## 2. 指给观众看:强调动画

| 写法 | 效果 |
| --- | --- |
| `new Indicate(m)` | 高亮:绕几何中心放大 1.2 倍并染上强调色,再回到原样 |
| `new Circumscribe(m)` | 圈出:沿外围画一圈矩形(或 `shape: 'circle'`),再收回 |
| `new Flash(m)` | 闪一下:一圈短光芒向外掠过 |
| `new Wiggle(m)` | 摆动:左右摆几下、微微放大 |

```ts
import { Circumscribe, Flash, Indicate } from '../engine';

await env.play(new Indicate(formula));                                   // 高亮整条公式
await env.play(new Circumscribe(result, { shape: 'circle', buff: 12 })); // 把结果圈出来
await env.play(new Flash(axes, { at: axes.toLocal(2, 4) }));             // 在数据点 (2, 4) 闪一下
await env.play(new Indicate(term), new Circumscribe(term));               // 可以叠在一起同时播

// 只强调公式里的某一项:先用 \class{名字}{…} 标出来
const law = new Tex('\\class{lhs}{a^2 + b^2} = \\class{rhs}{c^2}');
await env.play(new Indicate(law, { part: 'rhs' }));        // 只有 c² 放大、变色
await env.play(new Circumscribe(law, { part: 'lhs' }));    // 圈出左边
```

要点:

- 都是**渲染期的临时效果**:不改对象的位置、缩放、样式,播完一定精确回到原样;
  所以能和正在移动的对象、updater 驱动的对象同时用,也能几种强调叠在同一个对象上。
- **颜色**缺省按背景挑:亮底橙、暗底琥珀黄(Manim 那种纯黄在浅色背景上看不清);`color` 可以指定。
  `Indicate` 给容器整组染色;公式里用 `\textcolor` 显式上色的部分保持原色。
- 圈与光芒画在对象的父坐标系里、跟着对象走,不往场景里加对象。
  线宽缺省按主题;`Flash` 的 `at` 是对象的本地坐标(`axes.toLocal(x, y)` 正好是)。
- **公式里的某一项**:四种强调都接受 `part`(`\class` 起的名字)—— 高亮 / 摆动只动那一项
  (绕它自己的中心,其余照常;那一项里显式上过色的也一起染),圈出 / 闪一下以那一项为准。
  名字写错时报错会列出公式里现有的部分;`part` 只对 `Tex` 有效。
- 常用选项:`Indicate { scaleFactor, color, part }`、`Circumscribe { shape, buff, color, strokeWidth, fadeOut, part }`、
  `Flash { at, radius, lineLength, lineCount, color, strokeWidth, timeWidth, part }`、
  `Wiggle { scaleFactor, rotationAngle, wiggles, part }`。

## 3. 换色与线宽:ColorTo

```ts
import { ColorTo } from '../engine';

await env.play(new ColorTo(term, '#e11d48'));                          // 简写:描边与文字色一起变
await env.play(new ColorTo(curve, { stroke: '#2563eb', strokeWidth: 6 })); // 颜色 + 线宽
await env.play(new ColorTo(region, { fill: null }));                   // 填充淡出
```

- 颜色在 OKLab 里插值(感知均匀,红变绿不会经过一段发灰的泥色);`null` 填充按透明度淡入淡出。
- 终态等于对每个叶子 `setStyle(目标)`:给容器换色时逐个叶子生效,各自从**当前画出来的颜色**出发
  (主题、容器继承、构造默认都算上),开始的一帧不会跳色。
- 简写 `color` 只给原本有填充的叶子换填充色(保留原来的透明度):给整组换色时,线条、坐标轴不会突然被填满。
  具体键(`stroke` / `fill` / `textColor` / `strokeWidth`)优先于简写。
- 想要持久的高亮用 `ColorTo`;一闪而过的用 `Indicate`。

## 4. 标注图元

花括号、角、数轴、坐标网格、面积、切线、向量场、柱状图。全部支持 `Create`、`Write`、`Transform`
(带文字的是装着路径与 `Tex` / `Label` 的组),也都能配合上面的强调动画。

坐标一律是**本地坐标**:标注和被标注的对象放在同一个父节点下;按坐标系取样的图元(曲线、面积、切线、向量场)
直接加进坐标系所在的组(或 `NumberPlane` 本身),坐标系移动、缩放时一起走。
`Axes` 与 `NumberPlane` 都是坐标系(`CoordinateSystem`),下面凡是写 `axes` 的地方两者通用。

### 花括号 Brace

```ts
const tex = new Tex('a^2+b^2').setStyle({ fontSize: 32 });
const brace = Brace.for(tex, 'down', { label: '\\text{两项}' }); // up / down / left / right
scene.add(tex, brace);
await env.play(new Create(brace));                  // 从尖角处展开,说明逐字写出
brace.setEnds({ x: 0, y: 40 }, { x: 200, y: 40 });  // 端点变了,说明跟着走
```

- `new Brace(from, to, options)`:尖角朝「from → to 前进方向的右手侧」(从左往右时朝下)。
- 选项:`depth`(尖角深度,默认 14)、`thickness`(臂粗,默认 depth × 0.2)、`label`(字符串按 Tex 排,或任意 MObject)、
  `labelGap`(默认 6)、`fontSize`(默认 24);`Brace.for` 另有 `buff`(与目标的间距,默认 6)。
- 两端卷钩与尖角的尺寸固定,只伸长直段 —— 任意长度都匀称。只要括号本身、不要说明时用 `BraceShape`。

### 角 Angle / 直角 RightAngle

```ts
// 直角三角形 ABC,直角在 C。参数顺序都是(顶点, 一边上的点, 另一边上的点)
const theta = new Angle(A, B, C, { radius: 28, label: '\\theta' }); // 顶点 A,两边指向 B、C
const right = new RightAngle(C, A, B, { size: 12 });                // 直角符号在 C
const beta = Angle.fromLines(line1, line2, { label: '\\beta' });     // 顶点 = 两直线交点
```

- `reflex: true` 画大于 180° 的一侧;`exterior: true` 画外角(第二条边反向延长,与原角互补)。
- 说明在角平分线上、弧外 `labelGap`(默认 4)处;`theta.degrees` / `theta.value` 取角度。
- 顶点随时间移动:`scene.addUpdater(() => theta.setPoints(v, a, b))`。

### 数轴 NumberLine

```ts
const line = new NumberLine([-5, 5, 1], { length: 400, tips: 'end' });
const dot = new Dot(6).moveTo(line.n2p(2.5));
line.add(dot); // 加进数轴这个组,随数轴移动
```

- 选项:`vertical`、`ticks`、`tickSize`(10)、`numbers`(true / false / 指定数值)、`exclude`、`format`、
  `labelKind`(`'tex'` 默认 / `'label'`)、`fontSize`(18)、`numberGap`(6)、`tips`(`'none'` / `'end'` / `'both'`)。
- `n2p(数值)` → 本地点,`p2n(点)` → 数值。负数让数字本身对准刻度(负号探到左边)。

### 坐标网格 NumberPlane

```ts
const plane = new NumberPlane([-4, 4], [-3, 3, 1], 480, 360, { numbers: true });
plane.add(new FunctionGraph((x) => (x * x) / 4 - 1, plane));
const p = plane.c2p(1, 2); // 数学坐标 → 本地坐标;plane.p2c 反过来
```

- 选项:`minorDivisions`(次网格细分,默认 2,1 为不画)、`axes`、`numbers`、`labelKind`、`fontSize`、
  `tips`、`gridColor`、`minorGridColor`。子元素 `minorGrid`、`majorGrid`、`xAxis`、`yAxis` 可以单独 `setStyle`。

### 曲线下面积与黎曼和

```ts
const area = new AreaUnderCurve(axes, f, [0, 3]);                  // 与 x 轴之间
const between = new AreaUnderCurve(axes, f, [0, 3], { bottom: g }); // 两条曲线之间
const rects = new RiemannRectangles(axes, f, [0, 3], { n: 6, sample: 'mid' }); // left / right / mid
await env.play(new Create(rects));               // 矩形从轴上长出来
await env.play(new RiemannTo(rects, { n: 24 })); // 细分:每个矩形原地劈开,再长到新高度
rects.sum; // 黎曼和
```

- 区间截到横轴范围、函数值截到纵轴范围;负值画在轴下;无定义处高度为 0。
- 面积缺省半透明蓝填充,`Create` 时从左往右扫出来;矩形缺省蓝→绿渐变(`colors` 可改)。

### 切线与割线

```ts
const t = new ValueTracker(0.5);
const tangent = new TangentLine(axes, f, t.getValue(), { length: 160 });
scene.addUpdater(() => tangent.setX(t.getValue()));
await env.play(new TweenValue(t, 2.5, { runTime: 3 }));     // 切线沿曲线滑动
const secant = new SecantLine(axes, f, 1, 3, { extend: 20 }); // secant.setX(1, 1.01) 逼近切线
```

- `tangent.slope` 是数值导数(中心差分,一侧无定义时退成单侧),`tangent.point` 是切点;横纵比例不同时方向照样对。
- 函数在该点无定义时不画。

### 向量场

```ts
const field = new VectorField(plane, (x, y) => [-y, x], { colors: ['#3b82f6', '#ef4444'] });
plane.add(field);
field.setFunction((x, y) => [Math.sin(y), Math.sin(x)]); // 场变了:重新取样一次
```

- 选项:`xRange` / `yRange`(`[min, max, step]`,从 min 起按步长取,缺省约 12 列)、`maxLength`、
  `uniform`(全部等长)、`colors`(按模长着色)、`pivot`(`'middle'` / `'tail'`)。
- 同色箭头合成一条路径,几何只在取样时建一次:几百上千个箭头也不卡。**不要**逐帧新建对象。

### 柱状图

```ts
const chart = new BarChart([3, 5, 2], { labels: ['甲', '乙', '丙'], showValues: true });
await env.play(new Create(chart));                // 柱子从基线长出来
await env.play(new BarChartTo(chart, [4, 1, 6])); // 柱高补间,数值标签跟着变
```

- 选项:`width`(300)、`height`(180)、`range`(缺省含 0)、`colors`、`barRatio`、`labelKind`、`fontSize`、
  `showValues`(true 或格式函数)。柱子个数与数值范围固定;超出范围的柱子会伸出图表。立即换数值用 `setValues`。

## 5. 按式子结构推导:TransformMatchingTex

讲推导最常用的一步:移项、约分、代入、合并同类项。前后两个式子里**没变的项平移过去**,
变了的部分淡出、淡入(或者变形过去)。对应 Manim 的 `TransformMatchingTex`。

```ts
import { Tex, TransformMatchingTex } from '../engine';

const before = new Tex('a^2 + b^2 = c^2');
const after = new Tex('a^2 = c^2 - b^2').moveTo({ x: 0, y: 80 });
scene.add(before, after); // 两个都要先 add;目标开始时会自动藏起来
await env.play(new TransformMatchingTex(before, after, { runTime: 1.5 }));
// 播完:before 藏起(opacity 0),after 按原来的不透明度显示,终态精确
```

替换语义和 `Transform` 一样:开始时藏起目标,结束时藏起源、显示目标;两个对象可以在不同的容器里
(平移、缩放、旋转、继承的字号都会换算)。换回去用 `new TransformMatchingTex(after, before)`,原来的不透明度会恢复。

### 配对规则(按优先级)

1. **命名部分整体对应**。用 `\class{名字}{…}`(或 `\cssId{名字}{…}`)给子式起名,两边同名的部分当成一个整体:
   部分内部先按字形配,剩下的按阅读顺序直接变形,多出来的从对面部分的中心长出来或缩回去。名字不一样时用 `partMap` 改名。
2. **结构相同的整组子式先配**。上下标、分式、根式、括号组两边完全一样时(比如 `c^2`、整个 `\sqrt{x^2}`)整体配对,
   大的先配 —— 指数跟着底数走,不会底数留在原地、指数单独飞走。
3. **单个字形按身份配对**。同一个字形、字号相近的算同一个,平移过去(形状相同就是纯位移)。
   先尽量保持原来的顺序(有多种配法时取挪动最少的),顺序交叉的(移到另一边的项)再就近配。
4. **同一个符号换了字号**(系数变成分母、`x^2` 变成 `2^x`)也会配上,边移动边缩放;`matchAcrossSizes: false` 关掉。
5. **多出来的副本并入或分出**:`x + x → 2x` 里第二个 x 飞进第一个 x 并淡掉;反过来多出来的从同一个符号那里分出来。
   `duplicates: 'fade'` 改为原地淡化。
6. **配不上的**:源的缩小淡出,目标的从小淡入(先淡出、后淡入,中途不挤在一起);
   `transformMismatches: true` 则按阅读顺序直接变形,效果类似 `Transform`。

`\text{…}` 里的中文按文字内容配对、平移过去,配不上的交叉淡化。源和目标也可以是 `Group`:
组里的公式按上面的规则配对,非公式的叶子(圆、方、箭头)按顺序变形,和 `Transform` 一样。

### 选项

| 选项 | 缺省 | 说明 |
| --- | --- | --- |
| `runTime` / `rateFunc` | 1 / smooth | 同其它动画 |
| `partMap` | `{}` | 部分改名:`{ 源里的名字: '目标里的名字' }` |
| `transformMismatches` | `false` | 配不上的也按阅读顺序直接变形,不淡出淡入 |
| `matchAcrossSizes` | `true` | 同一个符号字号不同也配对(边移动边缩放) |
| `duplicates` | `'merge'` | 多出来的同一符号:`'merge'` 并入或分出,`'fade'` 原地淡化 |
| `fadeLag` | `0.3` | [0, 1):淡出占进度 [0, 1 − fadeLag],淡入占 [fadeLag, 1];0 表示同时 |
| `fadeScale` | `0.8` | 淡出缩到、淡入从这个比例开始(以各自中心缩放);1 表示不缩放 |

### 推导示例

```ts
// 解一元一次方程:每一步只动变了的部分
const steps = [
  new Tex('2x + 3 = 7'),
  new Tex('2x = 7 - 3'),       // 3 挪到右边,+ 淡出、− 淡入
  new Tex('2x = 4'),           // 7 − 3 淡出,4 淡入
  new Tex('x = \\frac{4}{2}'), // 系数 2 缩小移到分母,4 移到分子,分数线淡入
  new Tex('x = 2'),
];
scene.add(...steps); // 摆在同一个位置就是「原地推导」:目标开始前会被藏起来,不会重影
for (let i = 1; i < steps.length; i++) {
  await env.play(new TransformMatchingTex(steps[i - 1]!, steps[i]!, { runTime: 1.2 }));
}

// 用 \class 指定对应关系(配方)
const a = new Tex('\\class{sq}{x^2 + 2x + 1} = 0');
const b = new Tex('\\class{square}{(x + 1)^2} = 0');
await env.play(new TransformMatchingTex(a, b, { partMap: { sq: 'square' } }));

// 合并同类项:第二个 x 飞进第一个 x 并淡掉,+ 淡出,2 淡入
const sum = new Tex('x + x');
const twice = new Tex('2x');
scene.add(sum, twice); // 源和目标都要先在场景里(目标开始时会被自动藏起来)
await env.play(new TransformMatchingTex(sum, twice));

// 中文公式:「速度」「路程」「时间」按文字内容配对平移,分数线淡出,× 淡入
const v = new Tex('\\text{速度} = \\frac{\\text{路程}}{\\text{时间}}');
const s = new Tex('\\text{路程} = \\text{速度} \\times \\text{时间}');
scene.add(v, s);
await env.play(new TransformMatchingTex(v, s));
```

### 其它

- 身份按「字形 + 字号」判定,与颜色无关:颜色不同的同一个字形照样配对,颜色渐变过去。
- 起了名的部分还可以单独取:`tex.partNames`(有哪些)、`tex.getPartBox(名字)`(包围盒)、
  `tex.partLayers(名字, 样式)`(分层几何)、`tex.layout().parts.get(名字)`(图元下标)。
- 加入 html 宏包后可以用 `\class`、`\cssId`、`\style`(`\style{color:red}{x}` 的颜色会生效)、`\href`(画布里只显示内容)。
- 顺带修掉的公式渲染问题:上划线、长箭头、`\underbrace`、高括号的延长段之前错位、伸出一截并把盒子撑宽
  (MathJax 的嵌套 svg 视口没有换算坐标与裁剪);`\boxed{…}` 之前画成实心块,现在只描边。
  含这些结构的公式,包围盒尺寸会比以前小(以前是错的)。

## 6. 缓动

除了 `linear / smooth / easeIn / easeOut / easeInOut`,还有:

- `thereAndBack`:去而复返(`Indicate` 的缺省);`thereAndBackWithPause(停顿比例)`:在顶点停一会儿;
- `wiggle(t, 次数)`:左右摆动;`rushInto` / `rushFrom`:冲向终点 / 冲出起点;`doubleSmooth`:中途停一下;
- `squish(缓动, a, b)`:把一个缓动压进 `[a, b]` 这段时间(之前停在起点、之后停在终点)。
