import {
  Axes,
  Create,
  Dot,
  FadeIn,
  FunctionGraph,
  Group,
  Label,
  Layout,
  Line,
  Tex,
  TweenValue,
  ValueTracker,
  lightTheme,
} from '../engine';
import type {
  LayoutAlign,
  MObject,
  MeasureContext,
  Playable,
  Point,
  RateFunction,
  RealFunction,
  Scene,
  TexOptions,
} from '../engine';
import { cardSegment, directedSegment } from './segments';
import type { SegmentEnv } from './segments';
import type { Segment, Subtitle } from './types';

// ---------------------------------------------------------------------------
// 构造与布景

/** 公式:建对象 + 字号 + 位置一步到位。 */
export function tex(source: string, fontSize: number, at?: Point, options?: TexOptions): Tex {
  const t = new Tex(source, options);
  t.setStyle({ fontSize });
  if (at) {
    t.moveTo(at);
  }
  return t;
}

/** 文字标签:建对象 + 字号 + 位置一步到位。 */
export function label(text: string, fontSize: number, at?: Point): Label {
  const l = new Label(text);
  l.setStyle({ fontSize });
  if (at) {
    l.moveTo(at);
  }
  return l;
}

/**
 * 先藏起来(opacity = 0),之后用 FadeIn 抬出来。
 * 只藏「会被 FadeIn 的那一层」:藏到子元素上,FadeIn(组) 抬不起来。
 */
export function hide(...objects: MObject[]): void {
  for (const m of objects) {
    m.opacity = 0;
  }
}

/** 先收起描边(revealFraction = 0),之后用 Create 画出来。Create 不碰 opacity。 */
export function unrevealed(...objects: MObject[]): void {
  for (const m of objects) {
    m.setRevealFraction(0);
  }
}

/** 一组对象各自淡入(同播)。 */
export function fadeIns(objects: readonly MObject[], runTime: number): FadeIn[] {
  return objects.map((m) => new FadeIn(m, { runTime }));
}

/**
 * 布景:加进场景,并按同一批对象取景。
 * fitExtra 只参与取景、不进场景(比如运动全程的包络占位)。
 */
export function stage(
  scene: Scene,
  objects: readonly MObject[],
  pad: number,
  fitExtra: readonly MObject[] = [],
): void {
  scene.add(...objects);
  scene.fitObjects([...objects, ...fitExtra], pad);
}

// ---------------------------------------------------------------------------
// 坐标系

export interface PlotOptions {
  xRange: readonly [number, number];
  yRange: readonly [number, number];
  /** 坐标框尺寸(世界单位)。 */
  width: number;
  height: number;
  fn: RealFunction;
  /** 曲线采样数,默认 200。 */
  samples?: number;
  /** 整组的位置。 */
  at: Point;
}

export interface PlotEnv {
  plot: Group;
  axes: Axes;
  curve: FunctionGraph;
  /** 数学坐标 -> 世界坐标。 */
  W(x: number, y: number): Point;
}

/**
 * 坐标系 + 函数图像 + 世界坐标换算,一套带走。
 * 坐标轴初始是藏起来的、曲线初始是收起的:用 plotIntro 把它们显示出来。
 */
export function makePlot(o: PlotOptions): PlotEnv {
  const axes = new Axes(o.xRange, o.yRange, o.width, o.height);
  const curve = new FunctionGraph(o.fn, axes, o.samples ?? 200);
  const plot = new Group();
  plot.add(axes, curve);
  plot.moveTo({ ...o.at });
  hide(axes);
  unrevealed(curve);
  const W = (x: number, y: number): Point => {
    const p = axes.toLocal(x, y);
    return { x: plot.position.x + p.x, y: plot.position.y + p.y };
  };
  return { plot, axes, curve, W };
}

/**
 * 时间量命名与引擎一致:动画时长叫 runTime,动画之后的停留叫 holdSeconds(同 cardSegment / listSegment)。
 */
export interface PlotIntroOptions {
  /** 坐标轴淡入时长(秒),默认 1。 */
  axesRunTime?: number;
  /** 曲线描出时长(秒),默认 2.5。 */
  curveRunTime?: number;
  /** 开场之后的停留(秒),默认 1。 */
  holdSeconds?: number;
  /** 与开场同播的其它动画。 */
  with?: readonly Playable[];
}

/** 坐标系开场:坐标轴淡入 + 曲线描出(可带同播动画),然后停顿。 */
export async function plotIntro(
  env: SegmentEnv,
  p: PlotEnv,
  options?: PlotIntroOptions,
): Promise<void> {
  await env.play(
    new FadeIn(p.axes, { runTime: options?.axesRunTime ?? 1 }),
    new Create(p.curve, { runTime: options?.curveRunTime ?? 2.5 }),
    ...(options?.with ?? []),
  );
  const holdSeconds = options?.holdSeconds ?? 1;
  if (holdSeconds > 0) {
    await env.wait(holdSeconds);
  }
}

// ---------------------------------------------------------------------------
// 时间线(分段被取消时 env.play / env.wait 抛取消哨兵,由分段模板吞掉)

export interface FadeSequenceOptions {
  /** 每项淡入时长(秒)。 */
  runTime: number;
  /** 每项之后的停顿(秒,最后一项之后也停)。 */
  gap: number;
}

/** 逐个淡入一串对象。 */
export async function fadeSequence(
  env: SegmentEnv,
  items: readonly MObject[],
  o: FadeSequenceOptions,
): Promise<void> {
  for (const m of items) {
    await env.play(new FadeIn(m, { runTime: o.runTime }));
    await env.wait(o.gap);
  }
}

export interface SweepOptions {
  from: number;
  to: number;
  runTime: number;
  /** 按参数值重画(逐帧调用)。 */
  draw: (value: number) => void;
  rateFunc?: RateFunction;
}

/**
 * 参数扫描:注册 updater 逐帧调 draw,把值从 from 补间到 to,结束后注销并落终态。
 * 内容脚本里「切点滑动」这类镜头都走它。
 */
export async function sweep(env: SegmentEnv, o: SweepOptions): Promise<void> {
  const tracker = new ValueTracker(o.from);
  o.draw(o.from);
  const stop = env.scene.addUpdater(() => {
    o.draw(tracker.getValue());
  });
  try {
    await env.play(
      new TweenValue(
        tracker,
        o.to,
        o.rateFunc ? { runTime: o.runTime, rateFunc: o.rateFunc } : { runTime: o.runTime },
      ),
    );
  } finally {
    stop();
  }
  o.draw(o.to);
}

// ---------------------------------------------------------------------------
// 常用部件

export interface TangentProbeOptions {
  /** 数学坐标 -> 世界坐标。 */
  W(x: number, y: number): Point;
  f: RealFunction;
  fp: RealFunction;
  /** 切线两端夹在这个定义域内,不会伸出坐标框。 */
  clamp: readonly [number, number];
  /** 切线半长(数学坐标单位)。 */
  halfSpan: number;
  /** 读数相对切点的偏移。 */
  readoutOffset?: Point;
  /** 读数文案,默认 `k = <f'(a)>`。 */
  format?: (a: number) => string;
}

export interface TangentProbe {
  dot: Dot;
  tangent: Line;
  readout: Label;
  /** 三件套,方便一次性 add / fitObjects / 淡入。 */
  parts: MObject[];
  drawAt(a: number): void;
}

/**
 * 「切点 + 切线 + 斜率读数」探针。
 * 这一组在内容脚本里重复出现了五六次,统一到这里,语义调整只改一处。
 */
export function tangentProbe(options: TangentProbeOptions): TangentProbe {
  const { W, f, fp, clamp, halfSpan } = options;
  const offset = options.readoutOffset ?? { x: 0, y: -40 };
  const format = options.format ?? ((a: number) => `k = ${fp(a).toFixed(2)}`);
  const dot = new Dot(7);
  const tangent = new Line({ x: 0, y: 0 }, { x: 1, y: 1 });
  const readout = label(format(clamp[0]), 22);
  const drawAt = (a: number): void => {
    const d = W(a, f(a));
    dot.moveTo(d);
    const xa = Math.max(clamp[0], a - halfSpan);
    const xb = Math.min(clamp[1], a + halfSpan);
    tangent.start = W(xa, f(a) + fp(a) * (xa - a));
    tangent.end = W(xb, f(a) + fp(a) * (xb - a));
    readout.moveTo({ x: d.x + offset.x, y: d.y + offset.y });
    readout.text = format(a);
  };
  return { dot, tangent, readout, parts: [dot, tangent, readout], drawAt };
}

/** 当前视口是否竖版(9:16 这类),内容脚本据此换排版。 */
export function isNarrow(scene: Scene): boolean {
  const { w, h } = scene.getViewportSize();
  return w < h;
}

/**
 * 侧栏(横屏)/下栏(竖屏)的公式列坐标。
 * 以前每段各抄一份魔数数组,两种基线混用;统一到这里后整列上下调整只改一处。
 */
export function sideColumn(
  scene: Scene,
  count: number,
): { colX: number; colYs: number[] } {
  const narrow = isNarrow(scene);
  const step = 70;
  const first = narrow ? 60 : -((count - 1) * step) / 2;
  return {
    colX: narrow ? 0 : 250,
    colYs: Array.from({ length: count }, (_, i) => first + i * step),
  };
}

// ---------------------------------------------------------------------------
// 列表与卡片

export interface ListEntry {
  node: MObject;
  fontSize: number;
}

export interface ColumnListOptions {
  gap?: number;
  padding?: number;
  /** 行内对齐,默认居中;目录式列表传 'start' 让左缘齐平。 */
  align?: LayoutAlign;
  /** 容器最小宽度,用来复刻固定宽度的旧排版。 */
  minWidth?: number;
  context?: MeasureContext;
}

/** 纵向公式/文字列表,按最大字号统一量尺寸,内部一致。 */
export function columnList(
  entries: readonly ListEntry[],
  options?: ColumnListOptions,
): Layout {
  const gap = options?.gap ?? 14;
  const padding = options?.padding ?? 12;
  const align = options?.align ?? 'center';
  const minWidth = options?.minWidth ?? 0;
  if (entries.length === 0) {
    // 空列表不能让 Math.max 产出 -Infinity —— 那会让整个场景的机位变成 NaN。
    return new Layout(Math.max(minWidth, padding * 2), padding * 2, {
      direction: 'column',
      gap,
      padding,
      justify: 'center',
      align,
    });
  }
  let fs = 0;
  for (const e of entries) {
    fs = Math.max(fs, e.fontSize);
  }
  const ctx: MeasureContext = options?.context ?? {
    fontSize: fs,
    fontFamily: lightTheme.fontFamily,
  };
  let widest = 0;
  let totalHeight = 0;
  for (const e of entries) {
    const box = e.node.getBox(ctx);
    widest = Math.max(widest, box.size.w);
    totalHeight += box.size.h;
  }
  const col = new Layout(
    Math.max(minWidth, widest + padding * 2),
    totalHeight + gap * (entries.length - 1) + padding * 2,
    {
      direction: 'column',
      gap,
      padding,
      justify: 'center',
      align,
    },
  );
  for (const e of entries) {
    col.place(e.node);
  }
  col.layout(ctx);
  return col;
}

/** 列表条目的两个常用构造。 */
export function texLine(s: string, fontSize: number): ListEntry {
  return { node: tex(s, fontSize), fontSize };
}

export function labelLine(s: string, fontSize: number): ListEntry {
  return { node: label(s, fontSize), fontSize };
}

export interface ListSegmentOptions {
  name: string;
  duration: number;
  subtitles: Subtitle[];
  /** 条目用工厂传入:MObject 是可变的,在模块作用域建一份会被多次播放复用。 */
  entries: () => ListEntry[];
  /** 每条淡入之后的停顿(秒)。每条淡入 1 秒。 */
  gap: number;
  /** 全部出现之后的停留(秒)。 */
  holdSeconds: number;
}

/**
 * 纯列表分段:居中一列条目,逐条淡入,最后停留。
 * 小结 / 数表 / 记号 / 提要 / 公式表都是这个形状,统一到这里。
 * 时间线 = 条目数 × (1 + gap) + holdSeconds。
 */
export function listSegment(o: ListSegmentOptions): Segment {
  return directedSegment(o.name, o.duration, o.subtitles, async (env) => {
    const { scene } = env;
    const built = o.entries();
    const col = columnList(built, { context: scene.measureContext() });
    col.moveTo({ x: 0, y: 0 });
    const items = built.map((e) => e.node);
    hide(...items);
    stage(scene, [col], 30);
    await fadeSequence(env, items, { runTime: 1, gap: o.gap });
    await env.wait(o.holdSeconds);
  });
}

export interface ChapterCardOptions {
  name: string;
  /** 章名(大标题,同时是进度条上的章节短标题)。 */
  title: string;
  /** 章名下面的一行小字。 */
  heading: string;
  /** 字幕解说。 */
  narration: string;
  /** 开场动画之后的停留(秒),默认 6。 */
  holdSeconds?: number;
}

/** 章节卡:大标题 + 横线 + 一行小字。时长由 cardSegment 推导(开场 1 秒 + 停留)。 */
export function chapterCard(o: ChapterCardOptions): Segment {
  return cardSegment({
    name: o.name,
    title: o.title,
    heading: o.heading,
    narration: o.narration,
    holdSeconds: o.holdSeconds ?? 6,
    marker: 'chapter',
    chapter: o.title,
  });
}
