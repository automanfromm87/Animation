import type { SvgAsset } from '../assets/registry';
import { getSvg } from '../assets/registry';
import type { SvgArtboard, SvgDocument, SvgGroupNode, SvgGroupTag, SvgNode, SvgShapeNode, SvgShapeTag } from '../assets/svgDocument';
import { parseSvgDocument, svgArtboard, unsupportedWarning } from '../assets/svgDocument';
import { affineScale, scaleAffine, translateAffine } from '../assets/svgGeometry';
import { fadeColor } from '../color';
import type { PathPaint } from '../path/draw';
import { drawPath } from '../path/draw';
import type { Affine, PathBounds, PathData } from '../path/path';
import { IDENTITY_AFFINE, multiplyAffine, pathBounds, transformPath } from '../path/path';
import { defaultLagRatio, staggered, writeStep } from '../path/write';
import type { ResolvedStyle, StyleOverride, Theme } from '../theme/Theme';
import { Group } from './Group';
import type { MorphOverlay } from './MObject';
import { MObject } from './MObject';
import { PathShape } from './shapes';
import type { Box, Point } from './types';
import { boxFromSize } from './types';

/** width、height 都给时怎么放:'contain'(缺省)等比塞进框;'fill' 拉伸(线宽按面积比近似)。 */
export type IllustrationFit = 'contain' | 'fill';

export interface IllustrationOptions {
  /** 画板显示宽度(世界单位)。只给 width:高按画板宽高比。 */
  width?: number;
  height?: number;
  fit?: IllustrationFit;
  /** Create 时部件之间的错峰(与 Write 的 lagRatio 同义,0 = 同时)。缺省按部件数取(同 Write)。 */
  lagRatio?: number;
  /**
   * 按画板裁剪(SVG 里画板外本来看不见),缺省 false:整个落在画板外的形状解析时已经丢掉,
   * 只有跨出画板边的部分会露出来;不裁也方便把部件移出画板做动画。Write / Transform 的覆盖层期间不裁。
   */
  clip?: boolean;
  /** 报错 / 告警里的名字:资源缺省用它的地址,内联源码缺省「内联 SVG」。 */
  label?: string;
}

// ---------------------------------------------------------------------------
// 按显示尺寸烘焙好的几何树(与 MObject 无关,可以跨实例共用)

/** @internal 一个形状部件:几何已按显示尺寸烘焙成世界单位、平移到以自身包围盒中心为原点。 */
export interface BuiltPart {
  readonly kind: 'part';
  readonly node: SvgShapeNode;
  readonly path: PathData;
  /** 在父级(组或插画)坐标里的位置 = 包围盒中心。 */
  readonly position: Point;
  readonly strokeWidth: number;
  readonly dash: readonly number[] | null;
}

/** @internal 一个组:原点 = 子元素外接盒中心。 */
export interface BuiltGroup {
  readonly kind: 'group';
  readonly node: SvgGroupNode;
  readonly children: readonly BuiltNode[];
  readonly position: Point;
}

type BuiltNode = BuiltPart | BuiltGroup;

/** 显示缩放:画板像素 → 世界单位(fill 时两轴不同)。 */
interface DisplayScale {
  readonly sx: number;
  readonly sy: number;
  readonly w: number;
  readonly h: number;
}

/** Write 对没有描边的片的缺省轮廓线宽(世界单位),Create 的轮廓阶段与之一致。 */
const OUTLINE_WIDTH = 1;
/** 每份文档最多缓存几种显示尺寸的几何;内联源码最多缓存几份解析结果。 */
const SIZES_PER_DOCUMENT = 8;
const INLINE_LIMIT = 64;

const treeCache = new WeakMap<SvgDocument, Map<string, readonly BuiltNode[]>>();
const inlineDocs = new Map<string, SvgDocument>();

function unionBounds(a: PathBounds | null, b: PathBounds | null): PathBounds | null {
  if (!a) {
    return b;
  }
  if (!b) {
    return a;
  }
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

function centerOf(b: PathBounds | null): Point {
  return b ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 } : { x: 0, y: 0 };
}

function rebase<T extends BuiltNode>(node: T, c: Point): T {
  return { ...node, position: { x: node.position.x - c.x, y: node.position.y - c.y } };
}

/**
 * 烘焙:M 把根用户坐标映射到插画坐标(原点 = 画板中心),strokeK / nonScalingK 是线宽的缩放。
 * 每个部件与组按自身包围盒中心重新定原点(RotateTo / Indicate 绕自己的中心),位置先按插画坐标记,组里再换成相对。
 */
function bake(
  node: SvgNode,
  m: Affine,
  strokeK: number,
  nonScalingK: number,
): { built: BuiltNode; bounds: PathBounds | null } {
  if (node.type === 'shape') {
    const abs = transformPath(node.path, m);
    const bounds = pathBounds(abs);
    const c = centerOf(bounds);
    const k = node.nonScalingStroke ? nonScalingK : strokeK;
    return {
      built: {
        kind: 'part',
        node,
        path: transformPath(abs, translateAffine(-c.x, -c.y)),
        position: c,
        strokeWidth: node.strokeWidth * k,
        dash: node.dash ? node.dash.map((d) => d * k) : null,
      },
      bounds,
    };
  }
  let bounds: PathBounds | null = null;
  const kids = node.children.map((child) => {
    const r = bake(child, m, strokeK, nonScalingK);
    bounds = unionBounds(bounds, r.bounds);
    return r.built;
  });
  const c = centerOf(bounds);
  return {
    built: { kind: 'group', node, children: kids.map((k) => rebase(k, c)), position: c },
    bounds,
  };
}

/** 按显示尺寸烘焙整棵树(按文档 + 尺寸缓存:重放时每次构造只新建图元,PathData 共用,Path2D 与弧长表都命中)。 */
function bakedTree(doc: SvgDocument, board: SvgArtboard | null, scale: DisplayScale): readonly BuiltNode[] {
  const key = `${scale.sx}|${scale.sy}|${scale.w}|${scale.h}`;
  let sizes = treeCache.get(doc);
  const hit = sizes?.get(key);
  if (hit) {
    return hit;
  }
  const m = multiplyAffine(
    multiplyAffine(translateAffine(-scale.w / 2, -scale.h / 2), scaleAffine(scale.sx, scale.sy)),
    board?.transform ?? IDENTITY_AFFINE,
  );
  const strokeK = affineScale(m);
  const nonScalingK = Math.sqrt(Math.abs(scale.sx * scale.sy));
  const tree = doc.children.map((node) => bake(node, m, strokeK, nonScalingK).built);
  if (!sizes) {
    sizes = new Map();
    treeCache.set(doc, sizes);
  }
  if (sizes.size >= SIZES_PER_DOCUMENT) {
    sizes.clear();
  }
  sizes.set(key, tree);
  return tree;
}

function requirePositive(name: string, value: number | undefined): number | undefined {
  if (value !== undefined && !(Number.isFinite(value) && value > 0)) {
    throw new Error(`Illustration 的 ${name} 需要正的有限数,收到 ${value}`);
  }
  return value;
}

/** 显示尺寸:规则同 Picture(没有 cover)。 */
function displayScale(label: string, vw: number, vh: number, options: IllustrationOptions): DisplayScale {
  const W = requirePositive('width', options.width);
  const H = requirePositive('height', options.height);
  const fit = options.fit ?? 'contain';
  if (fit !== 'contain' && fit !== 'fill') {
    throw new Error(`Illustration 的 fit 只能是 contain / fill,收到 ${String(fit)}`);
  }
  const uniform = (k: number): DisplayScale => ({ sx: k, sy: k, w: vw * k, h: vh * k });
  if (W === undefined && H === undefined) {
    return uniform(1);
  }
  if (H === undefined) {
    if (!(vw > 0)) {
      throw new Error(`插画「${label}」画板宽度为 0,不能按 width 缩放`);
    }
    return uniform((W ?? vw) / vw);
  }
  if (W === undefined) {
    if (!(vh > 0)) {
      throw new Error(`插画「${label}」画板高度为 0,不能按 height 缩放`);
    }
    return uniform(H / vh);
  }
  if (fit === 'fill') {
    return { sx: vw > 0 ? W / vw : 1, sy: vh > 0 ? H / vh : 1, w: W, h: H };
  }
  const k = Math.min(vw > 0 ? W / vw : Infinity, vh > 0 ? H / vh : Infinity);
  if (!Number.isFinite(k)) {
    throw new Error(`插画「${label}」画板宽高都为 0,不能按 width / height 缩放`);
  }
  return uniform(k);
}

/** 内联源码:按字符串缓存解析结果;首次解析时有不支持的内容就告警一次。 */
function inlineDocument(text: string, label: string): SvgDocument {
  const hit = inlineDocs.get(text);
  if (hit) {
    return hit;
  }
  const doc = parseSvgDocument(text, label);
  const warning = unsupportedWarning(doc);
  if (warning) {
    console.warn(warning);
  }
  if (inlineDocs.size >= INLINE_LIMIT) {
    inlineDocs.clear();
  }
  inlineDocs.set(text, doc);
  return doc;
}

// ---------------------------------------------------------------------------
// 图元

/**
 * setRevealFraction 在比例之后的其余参数(Create 传下来的附加信息,比如笔速)。
 * 插画的错峰与有填充部件的 writeStep 都原样往下传,不在这里丢掉:引擎给 Create 加的信息自动传到每个部件。
 */
type RevealExtra = Parameters<MObject['setRevealFraction']> extends [unknown, ...infer R] ? R : [];

/**
 * Create 的错峰:子树叶子按先序,第 i 片取 staggered(f, i, n, lag);f 为 null 时全部复原。
 * 什么都不画的部件(只为按 id 寻址保留的隐形形状)不占时段,直接跟总进度走 —— 否则画面白白停着。
 * 途经的 SVG 组只记自己的比例(不再往下同值下发,免得二次错峰);作者塞进来的普通组先同值下发,叶子随后被覆盖。
 */
function staggerReveal(
  root: SvgGroup | Illustration,
  f: number | null,
  lag: number | undefined,
  extra: RevealExtra,
): void {
  const leaves: MObject[] = [];
  const visit = (node: MObject): void => {
    for (const child of node.getChildren()) {
      if (child instanceof SvgGroup || child instanceof Illustration) {
        markReveal(child, f, extra);
        visit(child);
      } else if (child instanceof Group || child.getChildren().length > 0) {
        child.setRevealFraction(f, ...extra);
        visit(child);
      } else {
        leaves.push(child);
      }
    }
  };
  markReveal(root, f, extra);
  visit(root);
  const idle = (leaf: MObject): boolean => leaf instanceof SvgPart && leaf.drawsNothing;
  const n = leaves.filter((leaf) => !idle(leaf)).length;
  const l = lag ?? defaultLagRatio(n);
  let i = 0;
  for (const leaf of leaves) {
    const own = f === null || idle(leaf) ? f : staggered(f, i++, n, l);
    leaf.setRevealFraction(own, ...extra);
  }
}

/** 错峰途经的 SVG 组:只记自己的比例(MObject 的缺省实现,不往下发)。 */
function markReveal(group: SvgGroup | Illustration, f: number | null, extra: RevealExtra): void {
  MObject.prototype.setRevealFraction.call(group, f, ...extra);
}

/** 线帽 / 线连 / miterLimit(SVG 的线型;画布缺省 butt / miter / 10,SVG 缺省 butt / miter / 4)。 */
interface LineStyle {
  readonly cap: CanvasLineCap;
  readonly join: CanvasLineJoin;
  readonly miterLimit: number;
}

function applyLineStyle(ctx: CanvasRenderingContext2D, line: LineStyle): void {
  ctx.lineCap = line.cap;
  ctx.lineJoin = line.join;
  ctx.miterLimit = line.miterLimit;
}

/**
 * 子树里部件共同的线型:有描边的部件都一样时取它(没有描边的部件时看全部部件),不一致返回 null。
 * Write / Transform 的覆盖层由容器一次画完、路径不带线型,单一线型的图标(几乎所有描边图标集)据此画对;
 * 混用线型的插画在覆盖层期间用画布缺省,覆盖层撤掉后各部件照常。
 */
function commonLineStyle(root: MObject): LineStyle | null {
  const parts: SvgPart[] = [];
  const visit = (node: MObject): void => {
    for (const child of node.getChildren()) {
      if (child instanceof SvgPart) {
        parts.push(child);
      } else {
        visit(child);
      }
    }
  };
  visit(root);
  const stroked = parts.filter((p) => p.stroked);
  const pool = stroked.length > 0 ? stroked : parts;
  const first = pool[0];
  if (!first) {
    return null;
  }
  const same = pool.every(
    (p) => p.lineCap === first.lineCap && p.lineJoin === first.lineJoin && p.miterLimit === first.miterLimit,
  );
  return same ? { cap: first.lineCap, join: first.lineJoin, miterLimit: first.miterLimit } : null;
}

/**
 * SVG 形状部件(path / rect / circle / ellipse / line / polyline / polygon)。只由 Illustration 创建。
 *
 * 颜色:SVG 里写明的颜色就是作者的意图,构造时用 setStyle **有意锁定**(容器的 setStyle 盖不掉,与 CSS 里
 * 元素自身属性优先一致;这与 MObject.setDefaultStyle 的一般建议不同)。线宽同样锁定(不描边的件锁成 0),
 * 要整体改线宽用 ColorTo(illo, { strokeWidth })。currentColor 与没写 fill 的部件跟随墨色(解析出的 textColor):
 * illo.setStyle({ textColor }) 一键换色,ColorTo / Indicate 的着色照常生效。
 * 线帽 / 线连 / miterLimit 在绘制时设(Write / Transform 的覆盖层也是;整幅插画的覆盖层按部件共同的线型)。
 */
export class SvgPart extends PathShape {
  readonly tag: SvgShapeTag;
  /** SVG 里的 id(没有为 null)。 */
  readonly svgId: string | null;
  readonly classNames: readonly string[];
  readonly lineCap: CanvasLineCap;
  readonly lineJoin: CanvasLineJoin;
  readonly miterLimit: number;
  /** @internal SVG 里有描边(线宽大于 0)。 */
  readonly stroked: boolean;
  private readonly line: LineStyle;
  private readonly geometry: PathData;
  /** 最近一次 setRevealFraction 的附加参数,交给 writeStep。 */
  private revealExtra: RevealExtra = [];
  /** 填充 / 描边跟随墨色时要乘的不透明度;不跟随为 null。 */
  private readonly fillInk: number | null;
  private readonly strokeInk: number | null;

  /** @internal 由 Illustration 创建。 */
  constructor(built: BuiltPart) {
    super();
    const node = built.node;
    this.tag = node.tag;
    this.svgId = node.id;
    this.classNames = node.classes;
    this.lineCap = node.lineCap;
    this.lineJoin = node.lineJoin;
    this.miterLimit = node.miterLimit;
    this.stroked = node.stroke.kind !== 'none' && built.strokeWidth > 0;
    this.line = { cap: node.lineCap, join: node.lineJoin, miterLimit: node.miterLimit };
    this.geometry = built.path;
    this.position = { ...built.position };
    const style: StyleOverride = {};
    let fillInk: number | null = null;
    let strokeInk: number | null = null;
    switch (node.fill.kind) {
      case 'color':
        style.fill = node.fill.color;
        break;
      case 'none':
        style.fill = null;
        break;
      case 'ink':
        fillInk = node.fill.alpha;
        break;
    }
    switch (node.stroke.kind) {
      case 'color':
        style.stroke = node.stroke.color;
        style.strokeWidth = built.strokeWidth;
        break;
      case 'none':
        style.strokeWidth = 0;
        break;
      case 'ink':
        style.strokeWidth = built.strokeWidth;
        strokeInk = node.stroke.alpha;
        break;
    }
    if (built.dash) {
      style.dash = built.dash;
    }
    this.fillInk = fillInk;
    this.strokeInk = strokeInk;
    this.setStyle(style);
  }

  protected override buildPath(): PathData {
    return this.geometry;
  }

  /** @internal 当前什么都不画(不填充、线宽 0;作者后来上了色就不算):Create 的错峰不给它排时段。 */
  get drawsNothing(): boolean {
    return this.styleOverride.fill === null && this.styleOverride.strokeWidth === 0;
  }

  override setRevealFraction(f: number | null, ...extra: RevealExtra): this {
    this.revealExtra = extra;
    return super.setRevealFraction(f, ...extra);
  }

  /** 几何构造时给定、不变:只建一次。 */
  protected override pathKey(): string {
    return '';
  }

  /** 实际画出来的填充色:跟随墨色且自己没设过 fill(ColorTo 会设)时从 textColor 派生。 */
  private fillColor(style: ResolvedStyle): string | null {
    return this.fillInk !== null && this.styleOverride.fill === undefined
      ? fadeColor(style.textColor, this.fillInk)
      : style.fill;
  }

  private strokeColor(style: ResolvedStyle): string {
    return this.strokeInk !== null && this.styleOverride.stroke === undefined
      ? fadeColor(style.textColor, this.strokeInk)
      : style.stroke;
  }

  protected override paint(style: ResolvedStyle): PathPaint {
    return {
      fill: this.fillColor(style),
      stroke: this.strokeColor(style),
      strokeWidth: style.strokeWidth,
      dash: style.dash,
    };
  }

  /**
   * 报告实际画出来的颜色(墨色已落地):ColorTo 的起点、Write / Transform 取到的样式都与画面一致,
   * ColorTo(墨色部件, 'red') 从墨色平滑过渡、不会首帧跳色,而且会连填充一起改。
   */
  override getStyle(theme: Theme, inherited?: Readonly<StyleOverride>): ResolvedStyle {
    const s = super.getStyle(theme, inherited);
    const fill = this.fillColor(s);
    const stroke = this.strokeColor(s);
    s.fill = fill;
    s.stroke = stroke;
    return s;
  }

  protected override drawShape(ctx: CanvasRenderingContext2D, style: ResolvedStyle): void {
    // SVG 缺省 butt / miter / miterLimit 4(画布缺省 miterLimit 是 10,必须显式设)。
    applyLineStyle(ctx, this.line);
    const r = this.revealed();
    const paint = this.paint(style);
    if (r === null || paint.fill === null) {
      // 完整绘制,或只描边的件按弧长生长(PathShape.revealPath)。
      super.drawShape(ctx, style);
      return;
    }
    // 有填充的件:与 Tex / Write 同一节奏 —— 前半程描轮廓,后半程填充淡入。
    const step = writeStep(
      { path: this.toPath(), paint },
      r,
      paint.strokeWidth > 0 ? paint.strokeWidth : OUTLINE_WIDTH,
      ...this.revealExtra,
    );
    if (step) {
      drawPath(ctx, step.path, step.paint);
    }
  }

  /** Write / Transform 这个部件时的覆盖层:同样按 SVG 的线型画(在 render 的 save/restore 之内)。 */
  protected override paintMorph(ctx: CanvasRenderingContext2D, overlay: MorphOverlay): void {
    applyLineStyle(ctx, this.line);
    super.paintMorph(ctx, overlay);
  }
}

/** SVG 的 <g> / <a> / <use> / 嵌套 <svg> / <switch>。原点 = 自身内容包围盒中心。 */
export class SvgGroup extends Group {
  readonly tag: SvgGroupTag;
  readonly svgId: string | null;
  readonly classNames: readonly string[];
  private readonly lagRatio: number | undefined;
  /** 覆盖层用的共同线型(首次用到时按子树算;undefined = 还没算)。 */
  private morphLine: LineStyle | null | undefined = undefined;

  /** @internal 由 Illustration 创建(子元素由它加进来)。 */
  constructor(built: BuiltGroup, lagRatio: number | undefined) {
    super();
    this.tag = built.node.tag;
    this.svgId = built.node.id;
    this.classNames = built.node.classes;
    this.lagRatio = lagRatio;
    this.position = { ...built.position };
  }

  /** 空组(只为按 id 寻址保留的)也算支持:Create 在它上面是空操作。 */
  override get supportsReveal(): boolean {
    return this.getChildren().every((c) => c.supportsReveal);
  }

  /** 与 Illustration 相同的错峰:Create(某个 <g>) 也是逐件画出。 */
  override setRevealFraction(f: number | null, ...extra: RevealExtra): this {
    staggerReveal(this, f, this.lagRatio, extra);
    return this;
  }

  protected override paintMorph(ctx: CanvasRenderingContext2D, overlay: MorphOverlay): void {
    if (this.morphLine === undefined) {
      this.morphLine = commonLineStyle(this);
    }
    if (this.morphLine) {
      applyLineStyle(ctx, this.morphLine);
    }
    super.paintMorph(ctx, overlay);
  }
}

export type SvgElementObject = SvgPart | SvgGroup;

/**
 * Illustration:SVG 插画。source 是 SVG 源码(以 '<' 开头,同步解析,不用预加载)、预加载过的路径
 * (public/ 下,如 '/svg/cat.svg'),或 loadSvg 拿到的资源。按 width 等比缩放(或只给 height,或限定框)。
 *
 * 解析成真矢量部件:<g> → SvgGroup,每个形状 → SvgPart(PathShape);几何按显示尺寸烘焙成世界单位,
 * 原点 = 画板中心,每个部件 / 组的原点 = 它自己的包围盒中心(RotateTo(部件) 绕部件中心转)。
 * Create 逐件错峰「先描边再填色」(要先 unrevealed 收起);Write / Transform / FadeIn / ColorTo / Indicate 照常。
 * 部件可按 id(part('tail'))、class(partsWithClass('petal'))、下标(parts[3])取来单独做动画。
 */
export class Illustration extends Group {
  readonly document: SvgDocument;
  /** 报错里显示的名字。 */
  readonly label: string;
  /** 按画板裁剪。 */
  readonly clip: boolean;
  private readonly size: DisplayScale;
  private readonly natural: { readonly w: number; readonly h: number };
  private readonly lagRatio: number | undefined;
  private readonly partList: readonly SvgPart[];
  private readonly elements: readonly SvgElementObject[];
  private readonly idIndex: ReadonlyMap<string, SvgElementObject>;
  /** 覆盖层用的共同线型(首次用到时按子树算;undefined = 还没算)。 */
  private morphLine: LineStyle | null | undefined = undefined;

  constructor(source: string | SvgAsset, options: IllustrationOptions = {}) {
    super();
    let doc: SvgDocument;
    let label: string;
    if (typeof source !== 'string') {
      doc = source.document;
      label = options.label ?? source.src;
    } else if (source.trimStart().startsWith('<')) {
      label = options.label ?? '内联 SVG';
      doc = inlineDocument(source, label);
    } else {
      const asset = getSvg(source);
      doc = asset.document;
      label = options.label ?? source;
    }
    this.document = doc;
    this.label = label;
    this.clip = options.clip ?? false;
    const lag = options.lagRatio;
    if (lag !== undefined && !(Number.isFinite(lag) && lag >= 0)) {
      throw new Error(`Illustration 的 lagRatio 需要非负有限数,收到 ${lag}`);
    }
    this.lagRatio = lag;
    const board = svgArtboard(doc);
    this.natural = { w: board?.width ?? 0, h: board?.height ?? 0 };
    this.size = displayScale(label, this.natural.w, this.natural.h, options);

    const parts: SvgPart[] = [];
    const elements: SvgElementObject[] = [];
    const ids = new Map<string, SvgElementObject>();
    const instantiate = (built: BuiltNode): SvgElementObject => {
      const obj = built.kind === 'part' ? new SvgPart(built) : new SvgGroup(built, lag);
      elements.push(obj);
      if (obj instanceof SvgPart) {
        parts.push(obj);
      }
      const id = built.node.id;
      if (id !== null && !ids.has(id)) {
        ids.set(id, obj);
      }
      if (built.kind === 'group' && obj instanceof SvgGroup) {
        for (const child of built.children) {
          obj.add(instantiate(child));
        }
      }
      return obj;
    };
    for (const built of bakedTree(doc, board, this.size)) {
      this.add(instantiate(built));
    }
    this.partList = parts;
    this.elements = elements;
    this.idIndex = ids;
  }

  /** 画板显示尺寸(世界单位,未乘 scale)。 */
  get width(): number {
    return this.size.w;
  }

  get height(): number {
    return this.size.h;
  }

  /** 画板原始尺寸(SVG 的 width/height,缺省按 viewBox;像素)。 */
  get naturalWidth(): number {
    return this.natural.w;
  }

  get naturalHeight(): number {
    return this.natural.h;
  }

  /** 全部形状部件,文档顺序(构造时的快照;按下标取:illo.parts[3])。 */
  get parts(): readonly SvgPart[] {
    return this.partList;
  }

  /** 文档里出现的 id(文档顺序;<use> 实例内部的 id 不算,只算 <use> 自己的)。 */
  get ids(): readonly string[] {
    return [...this.idIndex.keys()];
  }

  hasPart(id: string): boolean {
    return this.idIndex.has(id);
  }

  /** 按 SVG 的 id 取部件或组;没有就抛错并列出现有 id(最多 20 个)。 */
  part(id: string): SvgElementObject {
    const hit = this.idIndex.get(id);
    if (hit) {
      return hit;
    }
    const all = this.ids;
    const list = all.slice(0, 20).join('、') + (all.length > 20 ? ` 等 ${all.length} 个` : '');
    throw new Error(
      `插画「${this.label}」里没有 id 为「${id}」的部件` + (all.length > 0 ? `;现有:${list}` : '(这份 SVG 里没有任何 id)'),
    );
  }

  /** class 含 name 的部件与组(文档顺序,可能为空)。 */
  partsWithClass(name: string): SvgElementObject[] {
    return this.elements.filter((e) => e.classNames.includes(name));
  }

  /** 画板盒(不是内容的紧包围盒;与 Layout 一样,「width」说的就是它)。 */
  override getBox(): Box {
    return boxFromSize(this.size.w, this.size.h);
  }

  /** 没有任何部件时为 true(Create 是空操作),否则要求子树都支持。 */
  override get supportsReveal(): boolean {
    return this.getChildren().every((c) => c.supportsReveal);
  }

  /** 对子树叶子按先序错峰:第 i 片取 staggered(f, i, n, lag);f 为 null 时全部复原。 */
  override setRevealFraction(f: number | null, ...extra: RevealExtra): this {
    staggerReveal(this, f, this.lagRatio, extra);
    return this;
  }

  /** Write / Transform 整幅插画时的覆盖层:部件线型一致就按它画(圆头线稿不会在书写期间变成平头尖角)。 */
  protected override paintMorph(ctx: CanvasRenderingContext2D, overlay: MorphOverlay): void {
    if (this.morphLine === undefined) {
      this.morphLine = commonLineStyle(this);
    }
    if (this.morphLine) {
      applyLineStyle(ctx, this.morphLine);
    }
    super.paintMorph(ctx, overlay);
  }

  override getCullRadius(theme?: Theme, inherited?: Readonly<StyleOverride>): number {
    const own = Math.hypot(this.size.w, this.size.h) / 2;
    if (this.clip) {
      return own;
    }
    return Math.max(own, super.getCullRadius(theme, inherited));
  }

  protected override beforeChildren(ctx: CanvasRenderingContext2D): void {
    if (this.clip) {
      // 与 afterChildren 的 restore 成对。
      ctx.save();
      ctx.beginPath();
      ctx.rect(-this.size.w / 2, -this.size.h / 2, this.size.w, this.size.h);
      ctx.clip();
    }
  }

  protected override afterChildren(ctx: CanvasRenderingContext2D): void {
    if (this.clip) {
      ctx.restore();
    }
  }
}
