import type { Rgba } from '../color';
import { formatColor } from '../color';
import type { Affine, PathBounds, PathData } from '../path/path';
import { IDENTITY_AFFINE, invertAffine, isEmptyPath, multiplyAffine, pathBounds, transformPath } from '../path/path';
import { parseSvgPath } from '../path/svgPath';
import type { CssRule, Declarations } from './css';
import { matchRules, parseDeclarations, parseStyleSheet } from './css';
import { AssetError } from './errors';
import type { SvgPaintValue } from './svgColor';
import { parseSvgColor, parseSvgPaint } from './svgColor';
import type { AspectRatio, ViewBox, Viewport } from './svgGeometry';
import {
  EVENODD_SUBPATH_LIMIT,
  affineScale,
  ellipsePath,
  evenOddAsNonZero,
  linePath,
  parseAspectRatio,
  parseLength,
  parseTransform,
  parseViewBox,
  pointsPath,
  rectPath,
  translateAffine,
  viewBoxTransform,
} from './svgGeometry';
import type { XmlElement } from './xml';
import { isXmlElement, parseXml, xmlTextContent } from './xml';

export type { AspectRatio, SvgAlign, ViewBox } from './svgGeometry';

/**
 * SVG 文档 → 与显示尺寸无关的中间表示(IR):形状已转成路径、祖先与自身 transform 已烘焙进几何、
 * 层叠与继承已落地成每个形状的颜料。Illustration 按显示尺寸从它现建图元;资源缓存里只存一份。
 *
 * 纯函数、不告警(告警由调用方按 unsupported 汇总一次)。node 与浏览器用同一份解析,结果一致。
 */

/** 落地后的颜料。 */
export type SvgPaint =
  | { readonly kind: 'none' }
  /** 规范化的 rgb()/rgba(),已乘 opacity × fill/stroke-opacity。 */
  | { readonly kind: 'color'; readonly color: string }
  /** currentColor(且没写 color)或整条祖先链都没写 fill:跟随插画的墨色(textColor),alpha 是要乘上的不透明度。 */
  | { readonly kind: 'ink'; readonly alpha: number };

export type SvgShapeTag = 'path' | 'rect' | 'circle' | 'ellipse' | 'line' | 'polyline' | 'polygon';

export interface SvgShapeNode {
  readonly type: 'shape';
  readonly tag: SvgShapeTag;
  /** SVG 的 id(<use> 实例内部的为 null)。 */
  readonly id: string | null;
  readonly classes: readonly string[];
  /** 根用户坐标(祖先与自身 transform 已烘焙);evenodd 已换成 nonzero 等价朝向。 */
  readonly path: PathData;
  readonly fill: SvgPaint;
  readonly stroke: SvgPaint;
  /** 根用户坐标下的线宽(已乘 √|det CTM|;non-scaling-stroke 时为原值,单位是画板像素)。 */
  readonly strokeWidth: number;
  /** 虚线(与线宽同一单位),null 为实线。 */
  readonly dash: readonly number[] | null;
  readonly lineCap: CanvasLineCap;
  readonly lineJoin: CanvasLineJoin;
  readonly miterLimit: number;
  readonly nonScalingStroke: boolean;
}

export type SvgGroupTag = 'g' | 'a' | 'use' | 'svg' | 'switch';

export interface SvgGroupNode {
  readonly type: 'group';
  readonly tag: SvgGroupTag;
  readonly id: string | null;
  readonly classes: readonly string[];
  readonly children: readonly SvgNode[];
}

export type SvgNode = SvgShapeNode | SvgGroupNode;

export interface SvgDocument {
  /** 报错与告警里显示的名字(地址,或「内联 SVG」)。 */
  readonly label: string;
  /** 根 <svg> 的 width / height 换算成 px;百分比或没写为 null。 */
  readonly width: number | null;
  readonly height: number | null;
  readonly viewBox: ViewBox | null;
  readonly preserveAspectRatio: AspectRatio;
  readonly children: readonly SvgNode[];
  /**
   * 全部形状的紧包围盒(根用户坐标),没有形状为 null。
   * 含没进树的形状(没有颜料的、整个落在画板外的):没有 viewBox 时画板按它兜底,隐形的边框矩形正好定出画板。
   */
  readonly contentBounds: PathBounds | null;
  /** 不支持的内容汇总(「<text>×2(…)」「clip-path 属性×4」),空数组 = 全部支持。 */
  readonly unsupported: readonly string[];
}

/** 画板:原始尺寸(px)+ 根用户坐标 → 画板像素坐标 (0..width, 0..height) 的映射。 */
export interface SvgArtboard {
  readonly width: number;
  readonly height: number;
  readonly transform: Affine;
}

// ---------------------------------------------------------------------------
// 层叠用的状态

/** 继承链上还没落地的颜料。default = 整条链都没写。 */
type PaintSpec =
  | { readonly kind: 'default' }
  | { readonly kind: 'none' }
  | { readonly kind: 'current' }
  | { readonly kind: 'color'; readonly rgba: Rgba };

/** 继承属性的计算值。 */
interface Inherited {
  readonly fill: PaintSpec;
  readonly fillOpacity: number;
  readonly fillRule: 'nonzero' | 'evenodd';
  readonly stroke: PaintSpec;
  readonly strokeOpacity: number;
  readonly strokeWidth: number;
  readonly dash: readonly number[] | null;
  readonly lineCap: CanvasLineCap;
  readonly lineJoin: CanvasLineJoin;
  readonly miterLimit: number;
  readonly color: Rgba | null;
  readonly visible: boolean;
}

const INITIAL: Inherited = {
  fill: { kind: 'default' },
  fillOpacity: 1,
  fillRule: 'nonzero',
  stroke: { kind: 'default' },
  strokeOpacity: 1,
  strokeWidth: 1,
  dash: null,
  lineCap: 'butt',
  lineJoin: 'miter',
  miterLimit: 4,
  color: null,
  visible: true,
};

interface State {
  readonly ctm: Affine;
  readonly style: Inherited;
  /** 祖先(含自己)opacity 之积。 */
  readonly opacity: number;
  readonly viewport: Viewport;
  /** 在 <use> 实例里:内部的 id 不登记。 */
  readonly instancing: boolean;
  /** 正在展开的元素(祖先链与被引用者),<use> 环检测用。 */
  readonly chain: ReadonlySet<XmlElement>;
  readonly depth: number;
}

/** 呈现属性(可以写成元素属性,优先级最低)。 */
const PRESENTATION_ATTRS = [
  'fill',
  'fill-opacity',
  'fill-rule',
  'stroke',
  'stroke-width',
  'stroke-opacity',
  'stroke-dasharray',
  'stroke-dashoffset',
  'stroke-linecap',
  'stroke-linejoin',
  'stroke-miterlimit',
  'color',
  'visibility',
  'display',
  'opacity',
  'vector-effect',
  'clip-path',
  'mask',
  'filter',
  'marker-start',
  'marker-mid',
  'marker-end',
  'mix-blend-mode',
  'paint-order',
] as const;

/** 有视觉效果但不支持的属性,值不是这里的「无效果」值时计入 unsupported。 */
const UNSUPPORTED_PROPS: ReadonlyMap<string, readonly string[]> = new Map([
  ['clip-path', ['none']],
  ['mask', ['none']],
  ['filter', ['none']],
  ['marker-start', ['none']],
  ['marker-mid', ['none']],
  ['marker-end', ['none']],
  ['stroke-dashoffset', ['0', '0px']],
  ['mix-blend-mode', ['normal']],
  ['paint-order', ['normal', 'fill', 'fill stroke', 'fill stroke markers', 'normal markers']],
  ['transform', ['none']],
]);

const SHAPE_TAGS: ReadonlySet<string> = new Set(['path', 'rect', 'circle', 'ellipse', 'line', 'polyline', 'polygon']);

/** 不直接渲染、也不必告警的元素(被引用时才起作用,或纯元数据)。 */
const SILENT_TAGS: ReadonlySet<string> = new Set([
  'defs',
  'symbol',
  'style',
  'title',
  'desc',
  'metadata',
  'linearGradient',
  'radialGradient',
  'stop',
  'clipPath',
  'mask',
  'pattern',
  'marker',
  'filter',
  'script',
  'view',
  'cursor',
  'font-face',
]);

/** 不支持的元素的补充说明。 */
const UNSUPPORTED_NOTES: Readonly<Record<string, string>> = {
  '<text>': '文字请用 Label / Tex 叠在插画上',
  '<image>': '位图请用 Picture 叠在插画上',
};

/** 展开 <use> 的最大嵌套层数;形状、元素总数上限(防止 <use> 引用链指数爆炸)。 */
const MAX_DEPTH = 64;
const MAX_SHAPES = 20000;
const MAX_ELEMENTS = 200000;

/** SVG 量不出尺寸时的缺省(CSS 替换元素的缺省尺寸 300×150):当位图用时的原始尺寸,浏览器与 node 一致。 */
export const SVG_DEFAULT_SIZE: { readonly width: number; readonly height: number } = { width: 300, height: 150 };

/** 没有视口信息时百分比的参照。 */
const FALLBACK_VIEWPORT: Viewport = { w: SVG_DEFAULT_SIZE.width, h: SVG_DEFAULT_SIZE.height };

/** clip-path 的 url(#id) 引用。 */
const CLIP_URL = /^url\(\s*(['"]?)#([^'")\s]+)\1\s*\)$/;

function clamp01(v: number): number {
  return v >= 1 ? 1 : v > 0 ? v : 0;
}

/** 不透明度值:数或百分比,钳到 0..1;非法返回 null。 */
function parseOpacity(value: string): number | null {
  const t = value.trim();
  const pct = t.endsWith('%');
  const v = Number(pct ? t.slice(0, -1) : t);
  if (!t || !Number.isFinite(v)) {
    return null;
  }
  return clamp01(pct ? v / 100 : v);
}

function classList(el: XmlElement): string[] {
  const c = el.attrs['class'];
  return c ? c.trim().split(/\s+/).filter(Boolean) : [];
}

function hrefOf(el: XmlElement): string | undefined {
  return el.attrs['href'] ?? el.attrs['xlink:href'];
}

// ---------------------------------------------------------------------------
// 解析器

class SvgParser {
  private readonly ids = new Map<string, XmlElement>();
  private readonly rules: CssRule[] = [];
  private readonly unsupportedCounts = new Map<string, number>();
  private readonly root: XmlElement;
  /**
   * 根视口在根用户坐标里看得见的范围(浏览器按它裁剪根 <svg>);画板要靠内容兜底时为 null。
   * 整个落在它外面的形状不进树(否则 Create 会给看不见的部件排时段,剔除半径也被撑大)。
   */
  private readonly visible: PathBounds | null;
  private shapeCount = 0;
  private elementCount = 0;
  private overflow = false;
  /** 形状的紧包围盒(根用户坐标;含没进树的)。 */
  bounds: PathBounds | null = null;

  constructor(root: XmlElement, visible: PathBounds | null) {
    this.root = root;
    this.visible = visible;
    let order = 0;
    const index = (el: XmlElement): void => {
      const id = el.attrs['id'];
      if (id && !this.ids.has(id)) {
        this.ids.set(id, el);
      }
      if (el.name === 'style') {
        const sheet = parseStyleSheet(xmlTextContent(el), order);
        order += sheet.rules.length;
        this.rules.push(...sheet.rules);
        for (const item of sheet.unsupported) {
          this.note(item);
        }
      }
      for (const child of el.children) {
        if (isXmlElement(child)) {
          index(child);
        }
      }
    };
    index(root);
  }

  note(item: string): void {
    this.unsupportedCounts.set(item, (this.unsupportedCounts.get(item) ?? 0) + 1);
  }

  unsupported(): string[] {
    return [...this.unsupportedCounts].map(([key, n]) => {
      const note = UNSUPPORTED_NOTES[key];
      return `${key}×${n}${note ? `(${note})` : ''}`;
    });
  }

  /** 元素的层叠声明:呈现属性 < 样式表(特异性、先后)< style 属性。 */
  private declarations(el: XmlElement): Declarations {
    const decls: Declarations = new Map();
    for (const prop of PRESENTATION_ATTRS) {
      const v = el.attrs[prop];
      if (v !== undefined && v.trim()) {
        decls.set(prop, v.trim());
      }
    }
    if (this.rules.length > 0) {
      const matched = matchRules(this.rules, { name: el.name, id: el.attrs['id'] ?? null, classes: classList(el) });
      for (const [k, v] of matched) {
        decls.set(k, v);
      }
    }
    const style = el.attrs['style'];
    if (style) {
      for (const [k, v] of parseDeclarations(style)) {
        decls.set(k, v);
      }
    }
    return decls;
  }

  /** url(#id) 引用的颜料:渐变按中点单色近似,其它引用不支持(走后备,没有就是 none)。 */
  private resolveUrl(paint: Extract<SvgPaintValue, { kind: 'url' }>, color: Rgba | null): PaintSpec | null {
    const target = paint.id ? this.ids.get(paint.id) : undefined;
    const fallback = (): PaintSpec => (paint.fallback ? this.toSpec(paint.fallback, color) ?? { kind: 'none' } : { kind: 'none' });
    if (!target) {
      return fallback();
    }
    if (target.name === 'linearGradient' || target.name === 'radialGradient') {
      this.note('渐变(按中点单色近似)');
      const mid = this.gradientMidpoint(target, color);
      return mid ? { kind: 'color', rgba: mid } : { kind: 'none' };
    }
    this.note(`<${target.name}> 颜料`);
    return fallback();
  }

  private toSpec(paint: SvgPaintValue, color: Rgba | null): PaintSpec | null {
    switch (paint.kind) {
      case 'none':
        return { kind: 'none' };
      case 'current':
        return { kind: 'current' };
      case 'color':
        return { kind: 'color', rgba: paint.rgba };
      case 'url':
        return this.resolveUrl(paint, color);
    }
  }

  /** 渐变在 offset 0.5 处的颜色(两侧 stop 线性插值,含 stop-opacity;没有 stop 时沿 href 找)。 */
  private gradientMidpoint(gradient: XmlElement, color: Rgba | null): Rgba | null {
    let el: XmlElement | undefined = gradient;
    let stops: XmlElement[] = [];
    for (let hop = 0; el && hop < 8; hop++) {
      stops = el.children.filter((c): c is XmlElement => isXmlElement(c) && c.name === 'stop');
      if (stops.length > 0) {
        break;
      }
      const href = hrefOf(el);
      el = href?.startsWith('#') ? this.ids.get(href.slice(1)) : undefined;
    }
    if (stops.length === 0) {
      return null;
    }
    let last = 0;
    const list = stops.map((stop) => {
      const decls = this.declarations(stop);
      const raw = stop.attrs['offset'] ?? '0';
      const offset = Math.max(last, clamp01(parseOpacity(raw) ?? 0));
      last = offset;
      // 呈现属性优先级最低:样式表与 style="" 里没写才看属性。
      const colorValue = decls.get('stop-color') ?? stop.attrs['stop-color'] ?? 'black';
      const rgba =
        colorValue.toLowerCase() === 'currentcolor'
          ? (color ?? { r: 0, g: 0, b: 0, a: 1 })
          : (parseSvgColor(colorValue) ?? { r: 0, g: 0, b: 0, a: 1 });
      const opacity = parseOpacity(decls.get('stop-opacity') ?? stop.attrs['stop-opacity'] ?? '1') ?? 1;
      return { offset, rgba: { ...rgba, a: rgba.a * opacity } };
    });
    const first = list[0];
    const end = list[list.length - 1];
    if (!first || !end) {
      return null;
    }
    if (0.5 <= first.offset) {
      return first.rgba;
    }
    if (0.5 >= end.offset) {
      return end.rgba;
    }
    for (let i = 0; i + 1 < list.length; i++) {
      const a = list[i];
      const b = list[i + 1];
      if (a && b && a.offset <= 0.5 && 0.5 <= b.offset) {
        const t = b.offset > a.offset ? (0.5 - a.offset) / (b.offset - a.offset) : 1;
        return {
          r: a.rgba.r + (b.rgba.r - a.rgba.r) * t,
          g: a.rgba.g + (b.rgba.g - a.rgba.g) * t,
          b: a.rgba.b + (b.rgba.b - a.rgba.b) * t,
          a: a.rgba.a + (b.rgba.a - a.rgba.a) * t,
        };
      }
    }
    return end.rgba;
  }

  /**
   * 按声明算出元素的计算样式。返回继承属性、自身 opacity、display、vector-effect。
   */
  computeStyle(
    el: XmlElement,
    parent: State,
  ): { style: Inherited; opacity: number; display: boolean; nonScaling: boolean } {
    const decls = this.declarations(el);
    const s: { -readonly [K in keyof Inherited]: Inherited[K] } = { ...parent.style };
    let opacity = 1;
    let display = true;
    let nonScaling = false;
    // color 先算:同一元素上的 currentColor 要用它。
    const colorValue = decls.get('color');
    if (colorValue !== undefined && colorValue !== 'inherit' && colorValue.toLowerCase() !== 'currentcolor') {
      const rgba = parseSvgColor(colorValue);
      if (rgba) {
        s.color = rgba;
      } else {
        this.note(`颜色「${colorValue}」`);
      }
    }
    for (const [prop, value] of decls) {
      if (value === 'inherit') {
        continue;
      }
      if (prop === 'clip-path' && this.isNoopClip(value, el, parent)) {
        continue;
      }
      const skip = UNSUPPORTED_PROPS.get(prop);
      if (skip) {
        if (!skip.includes(value.trim().toLowerCase())) {
          this.note(prop === 'transform' ? 'CSS transform' : `${prop} 属性`);
        }
        continue;
      }
      switch (prop) {
        case 'fill':
        case 'stroke': {
          const paint = parseSvgPaint(value);
          const spec = paint ? this.toSpec(paint, s.color) : null;
          if (spec) {
            s[prop] = spec;
          } else {
            this.note(`颜色「${value}」`);
          }
          break;
        }
        case 'fill-opacity':
        case 'stroke-opacity': {
          const v = parseOpacity(value);
          if (v !== null) {
            s[prop === 'fill-opacity' ? 'fillOpacity' : 'strokeOpacity'] = v;
          }
          break;
        }
        case 'fill-rule':
          if (value === 'evenodd' || value === 'nonzero') {
            s.fillRule = value;
          }
          break;
        case 'stroke-width': {
          const v = parseLength(value, 'other', parent.viewport);
          if (v !== null && v >= 0) {
            s.strokeWidth = v;
          }
          break;
        }
        case 'stroke-dasharray':
          s.dash = this.parseDash(value, parent.viewport);
          break;
        case 'stroke-linecap':
          if (value === 'butt' || value === 'round' || value === 'square') {
            s.lineCap = value;
          }
          break;
        case 'stroke-linejoin':
          if (value === 'round' || value === 'bevel') {
            s.lineJoin = value;
          } else if (value === 'miter' || value === 'miter-clip' || value === 'arcs') {
            s.lineJoin = 'miter';
          }
          break;
        case 'stroke-miterlimit': {
          const v = Number(value);
          if (Number.isFinite(v) && v >= 1) {
            s.miterLimit = v;
          }
          break;
        }
        case 'visibility':
          if (value === 'visible') {
            s.visible = true;
          } else if (value === 'hidden' || value === 'collapse') {
            s.visible = false;
          }
          break;
        case 'opacity': {
          const v = parseOpacity(value);
          if (v !== null) {
            opacity = v;
          }
          break;
        }
        case 'display':
          display = value !== 'none';
          break;
        case 'vector-effect':
          nonScaling = value === 'non-scaling-stroke';
          break;
        default:
          break;
      }
    }
    return { style: s, opacity, display, nonScaling };
  }

  /**
   * 不起作用的 clip-path:引用的 <clipPath> 里只有一个不带圆角的 <rect>,而且它盖住了整个根视口
   * (Figma 导出把全部内容包进 <g clip-path="url(#clip0…)">,裁剪框就是画板)。这种裁剪画不画都一样,
   * 不计入「不支持」—— 否则每个 Figma 图标都告警。其它 clip-path 仍按不支持处理(忽略并告警)。
   */
  private isNoopClip(value: string, el: XmlElement, parent: State): boolean {
    const region = this.visible;
    const m = CLIP_URL.exec(value.trim());
    const clip = m?.[2] ? this.ids.get(m[2]) : undefined;
    if (!region || !clip || clip.name !== 'clipPath') {
      return false;
    }
    const units = clip.attrs['clipPathUnits']?.trim();
    if (units !== undefined && units !== 'userSpaceOnUse') {
      return false;
    }
    const shapes = clip.children.filter(
      (c): c is XmlElement => isXmlElement(c) && !['title', 'desc', 'metadata'].includes(c.name),
    );
    const rect = shapes[0];
    if (shapes.length !== 1 || !rect || rect.name !== 'rect') {
      return false;
    }
    const vp = parent.viewport;
    const radius = (attr: string, axis: 'x' | 'y'): number => {
      const v = rect.attrs[attr];
      return v === undefined || v.trim() === 'auto' ? 0 : (parseLength(v, axis, vp) ?? 0);
    };
    if (radius('rx', 'x') > 0 || radius('ry', 'y') > 0) {
      return false;
    }
    // userSpaceOnUse:裁剪框在引用它的元素的用户坐标里(含元素自己的 transform),再叠 clipPath 与 rect 自己的。
    const own = (e: XmlElement): Affine => parseTransform(e.attrs['transform'] ?? '') ?? IDENTITY_AFFINE;
    const ctm = multiplyAffine(multiplyAffine(multiplyAffine(parent.ctm, own(el)), own(clip)), own(rect));
    if (Math.abs(ctm[1]) > 1e-9 || Math.abs(ctm[2]) > 1e-9) {
      return false; // 转过的矩形:外接盒不等于它本身
    }
    const len = (attr: string, axis: 'x' | 'y'): number => parseLength(rect.attrs[attr], axis, vp) ?? 0;
    const box = pathBounds(
      transformPath(rectPath(len('x', 'x'), len('y', 'y'), len('width', 'x'), len('height', 'y'), null, null), ctm),
    );
    const eps = 1e-6 * Math.max(1, region.maxX - region.minX, region.maxY - region.minY);
    return (
      box !== null &&
      box.minX <= region.minX + eps &&
      box.minY <= region.minY + eps &&
      box.maxX >= region.maxX - eps &&
      box.maxY >= region.maxY - eps
    );
  }

  /** stroke-dasharray:none / 含负数 / 全 0 → 实线;奇数个重复一遍。 */
  private parseDash(value: string, viewport: Viewport): readonly number[] | null {
    if (value.trim() === 'none') {
      return null;
    }
    const parts = value.split(/[\s,]+/).filter(Boolean);
    const nums: number[] = [];
    for (const part of parts) {
      const v = parseLength(part, 'other', viewport);
      if (v === null || v < 0) {
        return null;
      }
      nums.push(v);
    }
    if (nums.length === 0 || nums.every((v) => v === 0)) {
      return null;
    }
    return nums.length % 2 === 1 ? [...nums, ...nums] : nums;
  }

  /** 元素自身的 transform 属性(非法时当没写并计入 unsupported)。 */
  private ownTransform(el: XmlElement): Affine {
    const t = el.attrs['transform'];
    if (t === undefined) {
      return IDENTITY_AFFINE;
    }
    const m = parseTransform(t);
    if (!m) {
      this.note('非法 transform');
      return IDENTITY_AFFINE;
    }
    return m;
  }

  renderChildren(el: XmlElement, state: State): SvgNode[] {
    const out: SvgNode[] = [];
    for (const child of el.children) {
      if (!isXmlElement(child)) {
        continue;
      }
      const node = this.renderElement(child, state);
      if (node) {
        out.push(node);
      }
    }
    return out;
  }

  private renderElement(el: XmlElement, state: State): SvgNode | null {
    const name = el.name;
    if (name.includes(':') || SILENT_TAGS.has(name)) {
      // 编辑器私有元素(sodipodi:*、inkscape:*)、只在被引用时起作用的元素。
      return null;
    }
    if (this.overflow) {
      return null;
    }
    if (SHAPE_TAGS.has(name)) {
      return this.renderShape(el, state);
    }
    switch (name) {
      case 'g':
      case 'a':
        return this.renderGroup(el, state, name, IDENTITY_AFFINE, null);
      case 'switch': {
        // 只渲染第一个能渲染的子元素。
        return this.renderGroup(el, state, 'switch', IDENTITY_AFFINE, null, true);
      }
      case 'svg':
        return this.renderViewport(el, state, null);
      case 'use':
        return this.renderUse(el, state);
      default:
        this.note(`<${name}>`);
        return null;
    }
  }

  /** 子状态:叠加变换、计算样式;display:none 返回 null。 */
  private enter(el: XmlElement, state: State, extra: Affine): { next: State; nonScaling: boolean } | null {
    this.elementCount += 1;
    if (this.elementCount > MAX_ELEMENTS) {
      if (!this.overflow) {
        this.overflow = true;
        this.note(`元素超过 ${MAX_ELEMENTS} 个(其余已忽略)`);
      }
      return null;
    }
    const { style, opacity, display, nonScaling } = this.computeStyle(el, state);
    if (!display) {
      return null;
    }
    const chain = new Set(state.chain);
    chain.add(el);
    return {
      next: {
        ctm: multiplyAffine(state.ctm, multiplyAffine(this.ownTransform(el), extra)),
        style,
        opacity: state.opacity * opacity,
        viewport: state.viewport,
        instancing: state.instancing,
        chain,
        depth: state.depth + 1,
      },
      nonScaling,
    };
  }

  private groupNode(el: XmlElement, state: State, tag: SvgGroupTag, children: SvgNode[]): SvgGroupNode | null {
    const id = state.instancing ? null : (el.attrs['id'] ?? null);
    // 空的匿名组没有意义;带 id 的保留(可以按 id 取来往里加东西)。
    if (children.length === 0 && id === null) {
      return null;
    }
    return { type: 'group', tag, id, classes: classList(el), children };
  }

  private renderGroup(
    el: XmlElement,
    state: State,
    tag: SvgGroupTag,
    extra: Affine,
    viewport: Viewport | null,
    firstOnly = false,
  ): SvgGroupNode | null {
    const entered = this.enter(el, state, extra);
    if (!entered) {
      return null;
    }
    const next = viewport ? { ...entered.next, viewport } : entered.next;
    let children: SvgNode[];
    if (firstOnly) {
      children = [];
      for (const child of el.children) {
        // 条件处理:我们不支持任何扩展,写了 requiredExtensions 的分支(Illustrator 的 <foreignObject>)跳过。
        if (isXmlElement(child) && !child.name.includes(':') && !child.attrs['requiredExtensions']?.trim()) {
          const node = this.renderElement(child, next);
          if (node) {
            children.push(node);
          }
          break;
        }
      }
    } else {
      children = this.renderChildren(el, next);
    }
    return this.groupNode(el, state, tag, children);
  }

  /**
   * 视口元素(嵌套 <svg>,或 <use> 引用的 <svg> / <symbol>):平移到 (x, y),有 viewBox 时再叠 viewBox 映射;不裁剪。
   * use 不为 null 时 width / height 以 <use> 上写的优先,x / y 已经在 <use> 自己的平移里。
   */
  private renderViewport(content: XmlElement, state: State, use: XmlElement | null): SvgGroupNode | null {
    const vp = state.viewport;
    const size = (attr: 'width' | 'height', axis: 'x' | 'y'): number =>
      parseLength(use?.attrs[attr], axis, vp) ?? parseLength(content.attrs[attr], axis, vp) ?? (axis === 'x' ? vp.w : vp.h);
    const w = size('width', 'x');
    const h = size('height', 'y');
    const x = use ? 0 : (parseLength(content.attrs['x'], 'x', vp) ?? 0);
    const y = use ? 0 : (parseLength(content.attrs['y'], 'y', vp) ?? 0);
    const vbRaw = parseViewBox(content.attrs['viewBox']);
    if (vbRaw === 'invalid') {
      this.note('非法 viewBox');
    }
    const vb = vbRaw === 'invalid' ? null : vbRaw;
    let extra: Affine = translateAffine(x, y);
    if (vb && w > 0 && h > 0) {
      extra = multiplyAffine(extra, viewBoxTransform(vb, w, h, parseAspectRatio(content.attrs['preserveAspectRatio'])));
    }
    const viewport: Viewport = vb ? { w: vb.width, h: vb.height } : { w: w > 0 ? w : vp.w, h: h > 0 ? h : vp.h };
    return this.renderGroup(content, state, 'svg', extra, viewport);
  }

  private renderUse(el: XmlElement, state: State): SvgGroupNode | null {
    const href = hrefOf(el);
    const target = href?.startsWith('#') ? this.ids.get(href.slice(1)) : undefined;
    if (!target) {
      this.note('<use> 引用不存在');
      return null;
    }
    if (state.chain.has(target) || target === el || state.depth > MAX_DEPTH) {
      this.note('<use> 循环引用');
      return null;
    }
    const vp = state.viewport;
    const x = parseLength(el.attrs['x'], 'x', vp) ?? 0;
    const y = parseLength(el.attrs['y'], 'y', vp) ?? 0;
    const entered = this.enter(el, state, translateAffine(x, y));
    if (!entered) {
      return null;
    }
    const inner: State = { ...entered.next, instancing: true };
    let node: SvgNode | null;
    if (target.name === 'symbol' || target.name === 'svg') {
      node = this.renderViewport(target, inner, el);
    } else if (SILENT_TAGS.has(target.name)) {
      this.note(`<use> 引用 <${target.name}>`);
      node = null;
    } else {
      node = this.renderElement(target, inner);
    }
    return this.groupNode(el, state, 'use', node ? [node] : []);
  }

  private shapePath(el: XmlElement, tag: SvgShapeTag, vp: Viewport): PathData {
    const len = (attr: string, axis: 'x' | 'y' | 'other'): number => parseLength(el.attrs[attr], axis, vp) ?? 0;
    const optLen = (attr: string, axis: 'x' | 'y'): number | null => {
      const v = el.attrs[attr];
      return v === undefined || v.trim() === 'auto' ? null : parseLength(v, axis, vp);
    };
    switch (tag) {
      case 'path':
        return parseSvgPath(el.attrs['d'] ?? '');
      case 'rect':
        return rectPath(len('x', 'x'), len('y', 'y'), len('width', 'x'), len('height', 'y'), optLen('rx', 'x'), optLen('ry', 'y'));
      case 'circle': {
        const r = len('r', 'other');
        return ellipsePath(len('cx', 'x'), len('cy', 'y'), r, r);
      }
      case 'ellipse': {
        let rx = optLen('rx', 'x');
        let ry = optLen('ry', 'y');
        rx ??= ry;
        ry ??= rx;
        return ellipsePath(len('cx', 'x'), len('cy', 'y'), rx ?? 0, ry ?? 0);
      }
      case 'line':
        return linePath(len('x1', 'x'), len('y1', 'y'), len('x2', 'x'), len('y2', 'y'));
      case 'polyline':
        return pointsPath(el.attrs['points'], false);
      case 'polygon':
        return pointsPath(el.attrs['points'], true);
    }
  }

  /** 继承链上的颜料 → 落地颜料(乘不透明度)。完全透明的按 none(隐形的边框、点击区)。 */
  private landPaint(spec: PaintSpec, color: Rgba | null, alpha: number, defaultInk: boolean): SvgPaint {
    const none: SvgPaint = { kind: 'none' };
    const colored = (rgba: Rgba): SvgPaint => {
      const a = rgba.a * alpha;
      return a > 0 ? { kind: 'color', color: formatColor({ ...rgba, a }) } : none;
    };
    switch (spec.kind) {
      case 'none':
        return none;
      case 'default':
        return defaultInk && alpha > 0 ? { kind: 'ink', alpha } : none;
      case 'current':
        return color ? colored(color) : alpha > 0 ? { kind: 'ink', alpha } : none;
      case 'color':
        return colored(spec.rgba);
    }
  }

  private renderShape(el: XmlElement, state: State): SvgShapeNode | null {
    const entered = this.enter(el, state, IDENTITY_AFFINE);
    if (!entered || !entered.next.style.visible) {
      return null;
    }
    const { next, nonScaling } = entered;
    const tag = el.name as SvgShapeTag;
    const local = this.shapePath(el, tag, state.viewport);
    if (isEmptyPath(local)) {
      return null;
    }
    if (this.shapeCount >= MAX_SHAPES) {
      this.overflow = true;
      this.note(`形状超过 ${MAX_SHAPES} 个(其余已忽略)`);
      return null;
    }
    this.shapeCount += 1;
    const s = next.style;
    const fill = tag === 'line' ? ({ kind: 'none' } as const) : this.landPaint(s.fill, s.color, s.fillOpacity * next.opacity, true);
    const stroke = this.landPaint(s.stroke, s.color, s.strokeOpacity * next.opacity, false);
    let path = transformPath(local, next.ctm);
    if (fill.kind !== 'none' && s.fillRule === 'evenodd' && path.subpaths.length >= 2) {
      if (path.subpaths.length > EVENODD_SUBPATH_LIMIT) {
        this.note('evenodd 子路径过多(按 nonzero 填充)');
      } else {
        path = evenOddAsNonZero(path);
      }
    }
    const k = nonScaling ? 1 : affineScale(next.ctm);
    const b = pathBounds(path);
    if (b) {
      this.bounds = this.bounds
        ? {
            minX: Math.min(this.bounds.minX, b.minX),
            minY: Math.min(this.bounds.minY, b.minY),
            maxX: Math.max(this.bounds.maxX, b.maxX),
            maxY: Math.max(this.bounds.maxY, b.maxY),
          }
        : { ...b };
    }
    const id = state.instancing ? null : (el.attrs['id'] ?? null);
    const width = s.strokeWidth * k;
    const stroked = stroke.kind !== 'none' && width > 0;
    // 什么都不画的形状(Material 图标开头的 <path d="M0 0h24v24H0z" fill="none"/>、设计工具导出的边框矩形)
    // 与整个落在画板外的形状不进树:否则 Create / Write 给它们也排一段,画面上白白停着。
    // 带 id 的保留(作者可能按 id 取来上色、移进画面)。
    if (id === null) {
      if (fill.kind === 'none' && !stroked) {
        return null;
      }
      // 描边向外伸出的余量:半个线宽,尖角(miter)与方头按最坏情况放大。
      const pad = stroked ? (width / 2) * Math.max(s.miterLimit, Math.SQRT2) : 0;
      const r = this.visible;
      if (
        r &&
        b &&
        (b.maxX + pad < r.minX || b.minX - pad > r.maxX || b.maxY + pad < r.minY || b.minY - pad > r.maxY)
      ) {
        return null;
      }
    }
    return {
      type: 'shape',
      tag,
      id,
      classes: classList(el),
      path,
      fill,
      stroke,
      strokeWidth: s.strokeWidth * k,
      dash: s.dash ? s.dash.map((d) => d * k) : null,
      lineCap: s.lineCap,
      lineJoin: s.lineJoin,
      miterLimit: s.miterLimit,
      nonScalingStroke: nonScaling,
    };
  }

  /** 根元素的起始状态(根自己的呈现属性与 style 也要层叠下去)。 */
  rootState(viewport: Viewport): State | null {
    const base: State = {
      ctm: IDENTITY_AFFINE,
      style: INITIAL,
      opacity: 1,
      viewport,
      instancing: false,
      chain: new Set(),
      depth: 0,
    };
    const { style, opacity, display } = this.computeStyle(this.root, base);
    if (!display) {
      return null;
    }
    return { ...base, style, opacity, chain: new Set([this.root]) };
  }
}

/**
 * 根视口在根用户坐标里看得见的范围:画板 (0..w, 0..h) 反映射回去(meet 时比 viewBox 宽,slice 时窄)。
 * 画板要靠内容包围盒兜底(没有 viewBox 又缺尺寸)时为 null —— 那样什么都看得见。
 */
function visibleRegion(
  width: number | null,
  height: number | null,
  viewBox: ViewBox | null,
  aspect: AspectRatio,
): PathBounds | null {
  const board = svgArtboard({
    label: '',
    width: width !== null && width >= 0 ? width : null,
    height: height !== null && height >= 0 ? height : null,
    viewBox,
    preserveAspectRatio: aspect,
    children: [],
    contentBounds: null,
    unsupported: [],
  });
  const inverse = board && board.width > 0 && board.height > 0 ? invertAffine(board.transform) : null;
  if (!board || !inverse) {
    return null;
  }
  return pathBounds(transformPath(rectPath(0, 0, board.width, board.height, null, null), inverse));
}

/**
 * 解析 SVG 源码。语法错误、根不是 <svg> 抛 AssetError('parse', label, …)。
 * @param label 报错里显示的名字,缺省「内联 SVG」
 */
export function parseSvgDocument(text: string, label = '内联 SVG'): SvgDocument {
  let root: XmlElement;
  try {
    root = parseXml(text);
  } catch (e) {
    throw new AssetError('parse', label, `SVG「${label}」解析失败:${e instanceof Error ? e.message : String(e)}`, {
      cause: e,
    });
  }
  if (root.name !== 'svg') {
    throw new AssetError('parse', label, `SVG「${label}」解析失败:根元素是 <${root.rawName}>,不是 <svg>`);
  }
  const width = parseLength(root.attrs['width'], 'x', null);
  const height = parseLength(root.attrs['height'], 'y', null);
  const vbRaw = parseViewBox(root.attrs['viewBox']);
  const viewBox = vbRaw === 'invalid' ? null : vbRaw;
  const aspect = parseAspectRatio(root.attrs['preserveAspectRatio']);
  const parser = new SvgParser(root, visibleRegion(width, height, viewBox, aspect));
  if (vbRaw === 'invalid') {
    parser.note('非法 viewBox');
  }
  const viewport: Viewport = viewBox
    ? { w: viewBox.width, h: viewBox.height }
    : width !== null && height !== null && width > 0 && height > 0
      ? { w: width, h: height }
      : FALLBACK_VIEWPORT;
  const state = parser.rootState(viewport);
  const children = state ? parser.renderChildren(root, state) : [];
  return {
    label,
    width: width !== null && width >= 0 ? width : null,
    height: height !== null && height >= 0 ? height : null,
    viewBox,
    preserveAspectRatio: aspect,
    children,
    contentBounds: parser.bounds,
    unsupported: parser.unsupported(),
  };
}

/**
 * 画板:原始尺寸与「根用户坐标 → 画板像素」的映射。
 * - width、height 都有 → 用它们;只有一个且有 viewBox → 另一个按 viewBox 比例;都没有但有 viewBox → viewBox 的宽高;
 * - 没有 viewBox:缺的尺寸按内容包围盒从原点量起(maxX / maxY;都 ≤ 0 时用紧包围盒,并把它平移到画板左上角);
 * - 什么都量不出(没有尺寸、没有 viewBox、没有形状)返回 null。
 * 有 viewBox 时按 preserveAspectRatio 映射进画板。
 */
export function svgArtboard(doc: SvgDocument): SvgArtboard | null {
  const vb = doc.viewBox;
  let w = doc.width;
  let h = doc.height;
  if (vb) {
    if (w === null && h === null) {
      w = vb.width;
      h = vb.height;
    } else if (w === null) {
      w = ((h ?? 0) * vb.width) / vb.height;
    } else if (h === null) {
      h = (w * vb.height) / vb.width;
    }
    const width = w ?? 0;
    const height = h ?? 0;
    return {
      width,
      height,
      transform: width > 0 && height > 0 ? viewBoxTransform(vb, width, height, doc.preserveAspectRatio) : IDENTITY_AFFINE,
    };
  }
  const b = doc.contentBounds;
  if (w !== null && h !== null) {
    return { width: w, height: h, transform: IDENTITY_AFFINE };
  }
  if (!b) {
    return null;
  }
  // 内容兜底:从原点量起;内容全在负半轴时用紧包围盒并平移过去。
  const fromOrigin = b.maxX > 0 && b.maxY > 0;
  const shift = fromOrigin ? IDENTITY_AFFINE : translateAffine(-b.minX, -b.minY);
  return {
    width: w ?? (fromOrigin ? b.maxX : b.maxX - b.minX),
    height: h ?? (fromOrigin ? b.maxY : b.maxY - b.minY),
    transform: shift,
  };
}

/** 画板原始尺寸(px);什么都量不出返回 null。 */
export function svgIntrinsicSize(doc: SvgDocument): { width: number; height: number } | null {
  const board = svgArtboard(doc);
  return board ? { width: board.width, height: board.height } : null;
}

/** 不支持的内容的告警文案(每份文档只告警一次,由调用方决定时机);全部支持返回 null。 */
export function unsupportedWarning(doc: SvgDocument): string | null {
  return doc.unsupported.length > 0
    ? `[svg] 「${doc.label}」里有不支持的内容,已忽略:${doc.unsupported.join('、')}`
    : null;
}

/**
 * 把 SVG 源码的根元素 width / height 改成给定像素值(没有 viewBox 时补上画板的 viewBox),其余原样。
 * 浏览器把 SVG 当位图解码时,原始尺寸由它自己定(没写 width/height 时各家不一);
 * 改写后解码出来的位图尺寸与 svgIntrinsicSize 一致,drawImage 的源矩形才对得上。
 * 同时删掉 <foreignObject>(Safari 画含它的 SVG 会污染画布)与 <switch> 里写了 requiredExtensions 的分支
 * (Illustrator「保留编辑功能」导出的私有数据)—— 与 Illustration 画出来的内容一致。
 */
export function svgWithIntrinsicSize(text: string, width: number, height: number): string {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const root = parseXml(src);
  const attrs: Record<string, string> = {};
  for (const [k, v] of Object.entries(root.attrs)) {
    if (k !== 'width' && k !== 'height') {
      attrs[k] = v;
    }
  }
  if (!('viewBox' in attrs) || parseViewBox(attrs['viewBox']) === 'invalid') {
    const doc = parseSvgDocument(src);
    const board = svgArtboard(doc);
    if (board) {
      // 画板映射是纯平移(没有 viewBox 时):画板左上角在用户坐标里的位置。
      attrs['viewBox'] = `${-board.transform[4]} ${-board.transform[5]} ${board.width} ${board.height}`;
    }
  }
  if (!('xmlns' in attrs)) {
    attrs['xmlns'] = 'http://www.w3.org/2000/svg';
  }
  attrs['width'] = String(width);
  attrs['height'] = String(height);
  const escape = (v: string): string =>
    v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const tag =
    `<${root.rawName}` +
    Object.entries(attrs)
      .map(([k, v]) => ` ${k}="${escape(v)}"`)
      .join('') +
    (root.selfClosing ? '/>' : '>');
  // 要删的元素(文档顺序、互不嵌套:删掉的元素不再往里找)。
  const cuts: XmlElement[] = [];
  const collect = (el: XmlElement): void => {
    for (const child of el.children) {
      if (!isXmlElement(child)) {
        continue;
      }
      if (child.name === 'foreignObject' || (el.name === 'switch' && child.attrs['requiredExtensions']?.trim())) {
        cuts.push(child);
      } else {
        collect(child);
      }
    }
  };
  collect(root);
  let out = src.slice(0, root.start) + tag;
  let at = root.openEnd;
  for (const cut of cuts) {
    out += src.slice(at, cut.start);
    at = cut.end;
  }
  return out + src.slice(at);
}
