import { lerpColor } from '../color';
import type { TexLayout, TexPrimitive, TexText } from '../math/typeset';
import { textAdvance, typesetTex } from '../math/typeset';
import type { PathLayer } from '../path/draw';
import { drawPath } from '../path/draw';
import type { Affine, PathData } from '../path/path';
import { concatPaths, pathBounds, transformPath } from '../path/path';
import { defaultLagRatio, staggered, writeStep } from '../path/write';
import type { ResolvedStyle, StyleOverride, Theme } from '../theme/Theme';
import type { EmphasisEffect, EmphasisTint } from './MObject';
import { MObject, emphasisColor } from './MObject';
import type { Bounds, Box, MeasureContext } from './types';
import { FALLBACK_MEASURE, boxFromSize, unionBounds } from './types';

export interface TexOptions {
  /** 行间公式(独占一块、更大更舒展),默认 false 为行内。 */
  displayMode?: boolean;
}

/** 1 秒内换源超过这么多次,多半是把逐帧变化的读数写成了 Tex(每个新串都要重新排版)。 */
const CHURN_LIMIT = 20;
/** 书写/生长时字形临时轮廓的线宽(em):比笔画细得多,只勾个边。 */
const OUTLINE_EM = 0.03;

/** 同色的填充图元合成一条路径:每帧每种颜色只 fill 一次,Path2D 按路径对象缓存。 */
interface FillGroup {
  color: string | null;
  path: PathData;
}

const fillGroups = new WeakMap<TexLayout, FillGroup[]>();

function groupFills(layout: TexLayout): FillGroup[] {
  const hit = fillGroups.get(layout);
  if (hit) {
    return hit;
  }
  const byColor = new Map<string | null, PathData[]>();
  for (const p of layout.primitives) {
    if (p.kind === 'fill') {
      const list = byColor.get(p.color);
      if (list) {
        list.push(p.path);
      } else {
        byColor.set(p.color, [p.path]);
      }
    }
  }
  const groups = [...byColor].map(([color, paths]) => ({ color, path: concatPaths(paths) }));
  fillGroups.set(layout, groups);
  return groups;
}

/** 一个图元的几何(按 m 放大):字形、分数线一层填充,描边图元一层描边;画布文字没有几何,为 null。 */
function primitiveLayer(p: TexPrimitive, textColor: string, m: Affine, scale: number): PathLayer | null {
  if (p.kind === 'fill') {
    return {
      path: transformPath(p.path, m),
      paint: { fill: p.color ?? textColor, stroke: null, strokeWidth: 0 },
      outlineWidth: OUTLINE_EM * scale,
    };
  }
  if (p.kind === 'stroke') {
    return {
      path: transformPath(p.path, m),
      paint: { fill: null, stroke: p.color ?? textColor, strokeWidth: p.width * scale },
    };
  }
  return null;
}

/**
 * 逐图元的分层几何(按 scale 放大;scale 为 1 时路径原样复用,弧长表等缓存都还在)。
 * 每个字形、分数线一层,描边图元一层;画布文字不在其中。
 */
function glyphLayers(layout: TexLayout, textColor: string, scale: number): PathLayer[] {
  const m: Affine = [scale, 0, 0, scale, 0, 0];
  const layers: PathLayer[] = [];
  for (const p of layout.primitives) {
    const layer = primitiveLayer(p, textColor, m, scale);
    if (layer) {
      layers.push(layer);
    }
  }
  return layers;
}

/**
 * 画一个文字图元:在它的 matrix 下按 font 画,原点是基线起点(排版坐标,调用方已按字号缩放)。
 * @internal 公式绘制与按结构变形共用。
 */
export function drawTexText(
  ctx: CanvasRenderingContext2D,
  p: Pick<TexText, 'text' | 'matrix' | 'font' | 'color'>,
  textColor: string,
): void {
  ctx.save();
  const [a, b, c, d, e, f] = p.matrix;
  ctx.transform(a, b, c, d, e, f);
  ctx.font = p.font;
  ctx.fillStyle = p.color ?? textColor;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(p.text, 0, 0);
  ctx.restore();
}

const FONT_PX = /(\d+(?:\.\d+)?)px/;

/**
 * 画布文字图元的包围盒(排版坐标)。没有轮廓可量:宽按 textAdvance 估(全角字 1em,
 * 按它自己的字号 —— MathJax 已按排版字宽选好了字号),高取基线以上 0.8em、以下 0.2em,
 * 再经它的摆放矩阵换过来。
 */
function textBounds(p: TexText): Bounds {
  const size = Number(p.font.match(FONT_PX)?.[1] ?? 0);
  const w = textAdvance(p.text) * size;
  const [a, b, c, d, e, f] = p.matrix;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of [
    [0, -0.8 * size],
    [w, -0.8 * size],
    [0, 0.2 * size],
    [w, 0.2 * size],
  ] as const) {
    const px = a * x + c * y + e;
    const py = b * x + d * y + f;
    minX = Math.min(minX, px);
    maxX = Math.max(maxX, px);
    minY = Math.min(minY, py);
    maxY = Math.max(maxY, py);
  }
  return { minX, minY, maxX, maxY };
}

const partBoundsCache = new WeakMap<TexLayout, Map<string, Bounds | null>>();

/** 命名部分的包围盒(排版坐标,按排版结果缓存);没有这个部分或它是空的返回 null。 */
function partBounds(layout: TexLayout, name: string): Bounds | null {
  let byName = partBoundsCache.get(layout);
  if (!byName) {
    byName = new Map();
    partBoundsCache.set(layout, byName);
  }
  const hit = byName.get(name);
  if (hit !== undefined) {
    return hit;
  }
  let acc: Bounds | null = null;
  for (const i of layout.parts.get(name) ?? []) {
    const p = layout.primitives[i];
    const b = !p ? null : p.kind === 'text' ? textBounds(p) : pathBounds(p.path);
    if (b) {
      acc = acc ? unionBounds(acc, b) : { minX: b.minX, minY: b.minY, maxX: b.maxX, maxY: b.maxY };
    }
  }
  byName.set(name, acc);
  return acc;
}

/** 单独画一个图元(排版坐标);tint 不为 null 时颜色朝强调色混合(显式上过色的也一样)。 */
function drawPrimitive(
  ctx: CanvasRenderingContext2D,
  p: TexPrimitive,
  textColor: string,
  tint: EmphasisTint | null,
): void {
  const base = p.color ?? textColor;
  const color = tint && tint.amount > 0 ? (lerpColor(base, emphasisColor(tint), tint.amount) ?? base) : base;
  if (p.kind === 'fill') {
    drawPath(ctx, p.path, { fill: color, stroke: null, strokeWidth: 0 });
  } else if (p.kind === 'stroke') {
    drawPath(ctx, p.path, { fill: null, stroke: color, strokeWidth: p.width });
  } else {
    drawTexText(ctx, { text: p.text, matrix: p.matrix, font: p.font, color }, textColor);
  }
}

/**
 * Tex:LaTeX 公式 MObject。MathJax 排版成字形轮廓,在场景图遍历到它时按矢量画进画布 ——
 * 与其它图元一样遵守添加顺序、祖先容器的裁剪(含旋转)、透明度与变换,任意缩放都清晰。
 * 尺寸同步可得:getBox 立刻就是真实排版尺寸,不依赖 DOM,也不用等字体加载。
 * 字号走 Theme/容器/自身的 fontSize(世界单位),颜色走 textColor;公式里的 \color 优先。
 * \text 里 MathJax 字体没有的字(中文)用画布文字画,它们不参与形状变形(变形时交叉淡化)。
 * 支持 Create:逐个字形先描轮廓、再填充(与 Write 同一个节奏)。
 * 用法: scene.add(new Tex('\\frac{1}{2}'))。
 */
export class Tex extends MObject {
  private source: string;
  readonly displayMode: boolean;
  private layoutFor: string | null = null;
  private layoutValue: TexLayout | null = null;
  /** 换源频率统计:逐帧改公式时告警一次。 */
  private churnStart = 0;
  private churnCount = 0;
  private churnWarned = false;

  constructor(tex: string, options?: TexOptions) {
    super();
    this.source = tex;
    this.displayMode = options?.displayMode ?? false;
  }

  get tex(): string {
    return this.source;
  }

  setTex(tex: string): this {
    if (tex !== this.source) {
      this.source = tex;
      this.noteChurn();
    }
    return this;
  }

  getText(): string {
    return this.source;
  }

  setText(text: string): this {
    return this.setTex(text);
  }

  /** 当前内容的排版结果(实例上缓存一份,全局还有一层按源码的缓存)。 */
  layout(): TexLayout {
    if (this.layoutFor !== this.source || !this.layoutValue) {
      this.layoutValue = typesetTex(this.source, this.displayMode);
      this.layoutFor = this.source;
    }
    return this.layoutValue;
  }

  /** TeX 语法错误的说明(公式照样显示成红字);没有错误为 null。 */
  get error(): string | null {
    return this.layout().error;
  }

  override getBox(context?: MeasureContext): Box {
    const fontSize =
      this.styleOverride.fontSize ?? context?.fontSize ?? FALLBACK_MEASURE.fontSize;
    const l = this.layout();
    return boxFromSize(l.width * fontSize, l.height * fontSize);
  }

  /**
   * 以自身原点为圆心的外接半径(排版尺寸精确已知,不必放余量)。
   * 字号按传入的样式上下文解析(渲染器剔除时会传,容器改了字号也跟得上);
   * 没有上下文时只认自己设过的字号,否则不参与剔除。
   */
  override getCullRadius(theme?: Theme, inherited?: Readonly<StyleOverride>): number {
    const fontSize = theme
      ? this.getStyle(theme, inherited).fontSize
      : this.styleOverride.fontSize;
    if (fontSize === undefined || !(fontSize > 0) || !Number.isFinite(fontSize)) {
      return Infinity;
    }
    const l = this.layout();
    return (Math.hypot(l.width, l.height) / 2) * fontSize;
  }

  /** 字形轮廓(填充几何,本地坐标)。中文这类画布文字没有轮廓,不在其中。 */
  override toPath(style?: ResolvedStyle): PathData {
    const fontSize =
      style?.fontSize ?? this.styleOverride.fontSize ?? FALLBACK_MEASURE.fontSize;
    return transformPath(this.layout().outline, [fontSize, 0, 0, fontSize, 0, 0]);
  }

  /** 逐个字形一层(按当前字号),形状变形与逐字书写用;画布文字交叉淡化(drawMorphResidual)。 */
  override pathLayers(style: ResolvedStyle): PathLayer[] {
    const fontSize = style.fontSize;
    if (!(fontSize > 0) || !Number.isFinite(fontSize)) {
      return [];
    }
    return glyphLayers(this.layout(), style.textColor, fontSize);
  }

  /**
   * 逐图元的几何(本地坐标,按当前字号),下标与 layout().primitives 一一对应:
   * 字形、线条各一层,画布文字为 null。按式子结构变形用它把每个字形连同身份、所在部分一起取出来。
   */
  primitiveLayers(style: ResolvedStyle): Array<PathLayer | null> {
    const fontSize = style.fontSize;
    const layout = this.layout();
    if (!(fontSize > 0) || !Number.isFinite(fontSize)) {
      return layout.primitives.map(() => null);
    }
    const m: Affine = [fontSize, 0, 0, fontSize, 0, 0];
    return layout.primitives.map((p) => primitiveLayer(p, style.textColor, m, fontSize));
  }

  /**
   * 命名部分(\class{名字}{…} / \cssId{名字}{…})的分层几何(本地坐标,按字号),强调公式里的某一项用;
   * 没有这个部分返回空数组。style 是所在位置解析出的样式(PlayContext.styleOf,或 getStyle(theme))。
   */
  partLayers(name: string, style: ResolvedStyle): PathLayer[] {
    const indices = this.layout().parts.get(name);
    if (!indices) {
      return [];
    }
    const layers = this.primitiveLayers(style);
    const out: PathLayer[] = [];
    for (const i of indices) {
      const layer = layers[i];
      if (layer) {
        out.push(layer);
      }
    }
    return out;
  }

  /** 公式里有哪些命名部分(按第一次出现的阅读顺序)。 */
  get partNames(): string[] {
    return [...this.layout().parts.keys()];
  }

  /**
   * 命名部分(\class{名字}{…})的包围盒(本地坐标,按字号;画布文字按排版时的字宽估算),
   * 字号的取法与 getBox 相同。没有这个部分(或它是空的)返回 null。圈出、闪一下公式里的某一项用。
   */
  getPartBox(name: string, context?: MeasureContext): Box | null {
    const b = partBounds(this.layout(), name);
    if (!b) {
      return null;
    }
    const k = this.styleOverride.fontSize ?? context?.fontSize ?? FALLBACK_MEASURE.fontSize;
    return {
      size: { w: (b.maxX - b.minX) * k, h: (b.maxY - b.minY) * k },
      center: { x: ((b.minX + b.maxX) / 2) * k, y: ((b.minY + b.maxY) / 2) * k },
    };
  }

  /** 变形期间交叉淡化的只有画布文字(\text 里的中文)。 */
  override drawMorphResidual(ctx: CanvasRenderingContext2D, style: ResolvedStyle): void {
    const fontSize = style.fontSize;
    if (!(fontSize > 0) || !Number.isFinite(fontSize)) {
      return;
    }
    ctx.save();
    ctx.scale(fontSize, fontSize);
    for (const p of this.layout().primitives) {
      if (p.kind === 'text') {
        drawTexText(ctx, p, style.textColor);
      }
    }
    ctx.restore();
  }

  override get supportsReveal(): boolean {
    return true;
  }

  protected override drawShape(ctx: CanvasRenderingContext2D, style: ResolvedStyle): void {
    const fontSize = style.fontSize;
    if (!(fontSize > 0) || !Number.isFinite(fontSize)) {
      return;
    }
    const layout = this.layout();
    // 排版坐标以「1px 字号」为单位,整体放大到字号(MObject.render 的 save/restore 兜着)。
    ctx.scale(fontSize, fontSize);
    const r = this.revealed();
    if (r !== null) {
      this.drawRevealed(ctx, layout, style.textColor, r);
      return;
    }
    const emphases = this.partEmphases();
    if (emphases.length > 0) {
      this.drawWithPartEmphasis(ctx, layout, style.textColor, emphases);
      return;
    }
    for (const group of groupFills(layout)) {
      drawPath(ctx, group.path, { fill: group.color ?? style.textColor, stroke: null, strokeWidth: 0 });
    }
    for (const p of layout.primitives) {
      if (p.kind === 'stroke') {
        drawPath(ctx, p.path, { fill: null, stroke: p.color ?? style.textColor, strokeWidth: p.width });
      } else if (p.kind === 'text') {
        drawTexText(ctx, p, style.textColor);
      }
    }
  }

  /**
   * 有命名部分在强调(Indicate 这类动画指定了 part)时的画法:其余图元照常逐个画,
   * 强调的部分画在最上面 —— 绕自己的中心缩放 / 旋转,颜色朝强调色混合。
   * 同一个图元落在几个强调部分里时,归最后挂上的那个。
   */
  private drawWithPartEmphasis(
    ctx: CanvasRenderingContext2D,
    layout: TexLayout,
    textColor: string,
    emphases: readonly EmphasisEffect[],
  ): void {
    const owner: Array<EmphasisEffect | undefined> = [];
    for (const effect of emphases) {
      for (const i of layout.parts.get(effect.part ?? '') ?? []) {
        owner[i] = effect;
      }
    }
    layout.primitives.forEach((p, i) => {
      if (owner[i] === undefined) {
        drawPrimitive(ctx, p, textColor, null);
      }
    });
    for (const effect of emphases) {
      const b = partBounds(layout, effect.part ?? '');
      if (!b) {
        continue;
      }
      const k = effect.scale ?? 1;
      const rotation = effect.rotation ?? 0;
      ctx.save();
      try {
        if (Number.isFinite(k) && Number.isFinite(rotation) && (k !== 1 || rotation !== 0)) {
          const cx = (b.minX + b.maxX) / 2;
          const cy = (b.minY + b.maxY) / 2;
          ctx.translate(cx, cy);
          ctx.rotate(rotation);
          ctx.scale(k, k);
          ctx.translate(-cx, -cy);
        }
        layout.primitives.forEach((p, i) => {
          if (owner[i] === effect) {
            drawPrimitive(ctx, p, textColor, effect.tint ?? null);
          }
        });
      } finally {
        ctx.restore();
      }
    }
  }

  /**
   * 生长中(Create):图元按排版顺序错峰,字形先描轮廓再填充,画布文字在自己的时段里淡入。
   * 描轮廓的快慢跟随 Create 的笔速(每个字形各按自己的形状换算)。
   */
  private drawRevealed(
    ctx: CanvasRenderingContext2D,
    layout: TexLayout,
    textColor: string,
    f: number,
  ): void {
    const layers = glyphLayers(layout, textColor, 1);
    const count = layout.primitives.length;
    const lag = defaultLagRatio(count);
    let next = 0;
    layout.primitives.forEach((p, i) => {
      const u = staggered(f, i, count, lag);
      if (p.kind === 'text') {
        if (u > 0) {
          ctx.save();
          ctx.globalAlpha *= u;
          drawTexText(ctx, p, textColor);
          ctx.restore();
        }
        return;
      }
      const layer = layers[next++];
      const step = layer ? writeStep(layer, u, OUTLINE_EM, this.revealPace) : null;
      if (step) {
        drawPath(ctx, step.path, step.paint);
      }
    });
  }

  private noteChurn(): void {
    if (this.churnWarned || typeof performance === 'undefined') {
      return;
    }
    const now = performance.now();
    if (now - this.churnStart > 1000) {
      this.churnStart = now;
      this.churnCount = 0;
    }
    this.churnCount += 1;
    if (this.churnCount > CHURN_LIMIT) {
      this.churnWarned = true;
      console.warn(
        `[Tex] 公式内容 1 秒内变了 ${this.churnCount} 次:每个新串都要重新排版,逐帧变化的读数请用 Label。`,
        this.source,
      );
    }
  }
}
