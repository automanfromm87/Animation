import type { LiteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import { liteAdaptor } from 'mathjax-full/js/adaptors/liteAdaptor.js';
import type { LiteElement } from 'mathjax-full/js/adaptors/lite/Element.js';
import type { LiteText } from 'mathjax-full/js/adaptors/lite/Text.js';
import type { MathDocument } from 'mathjax-full/js/core/MathDocument.js';
import { RegisterHTMLHandler } from 'mathjax-full/js/handlers/html.js';
import { TeX } from 'mathjax-full/js/input/tex.js';
import 'mathjax-full/js/input/tex/ams/AmsConfiguration.js';
import 'mathjax-full/js/input/tex/base/BaseConfiguration.js';
import 'mathjax-full/js/input/tex/boldsymbol/BoldsymbolConfiguration.js';
import 'mathjax-full/js/input/tex/cancel/CancelConfiguration.js';
import 'mathjax-full/js/input/tex/color/ColorConfiguration.js';
import 'mathjax-full/js/input/tex/html/HtmlConfiguration.js';
import 'mathjax-full/js/input/tex/newcommand/NewcommandConfiguration.js';
import 'mathjax-full/js/input/tex/noundefined/NoUndefinedConfiguration.js';
import { mathjax } from 'mathjax-full/js/mathjax.js';
import { SVG } from 'mathjax-full/js/output/svg.js';
import type { Affine, PathData, Subpath } from '../path/path';
import {
  EMPTY_PATH,
  PathBuilder,
  concatPaths,
  isEmptyPath,
  multiplyAffine,
  pathBounds,
  polylinePath,
  transformPath,
} from '../path/path';
import { parseSvgPath } from '../path/svgPath';

/**
 * 公式排版:MathJax(TeX 输入 + SVG 输出,跑在它自带的轻量 DOM 里,不依赖浏览器)
 * → 字形轮廓路径。字形数据内置在 JS 里:不加载字体文件、不量 DOM、node 里也能排,
 * 尺寸同步可得;画出来是矢量,任意缩放都清晰,也不会像 foreignObject 位图那样污染画布。
 */

/** 与之前 KaTeX(.katex 按 1.21em 排)的视觉大小对齐:同一个 fontSize,公式一样大。 */
export const MATH_SCALE = 1.21;
/**
 * 盒子的最小上伸/下伸(em,相当于一个 \strut):只按字形紧包的话 x 与 b 高度不同,
 * 几个公式按中心排成一行时基线会错位。给个行高下限,简单公式就共用同一条基线。
 */
const MIN_ASCENT = 0.9;
const MIN_DESCENT = 0.3;
/** MathJax 的 TeX 字体按 1000 单位 / em 出图。 */
const UNITS_PER_EM = 1000;
const ERROR_COLOR = '#cc0000';
const CACHE_LIMIT = 512;

/**
 * 图元的结构信息,按式子结构变形(TransformMatchingTex)靠它配对。
 * 图元在 primitives 里的顺序就是阅读顺序(MathJax 的结构顺序:分子、分母、分数线;被开方式、根号)。
 */
export interface TexPrimitiveInfo {
  /**
   * 所在的命名部分,外层在前、最内层在最后:\class{名字}{…} 与 \cssId{名字}{…} 都算
   * (MathJax 内部 mjx- 开头的类名不算)。不在任何命名部分里为空数组。
   */
  readonly parts: readonly string[];
  /**
   * 身份键:同一个字形(同一字符、同一变体)、字号相近才相同 —— 身份键相同的两个图元,
   * 平移过去就能重合。分数线、根号横线这类按所在结构与字号算,不计长短;伸缩出来的延长段不计伸缩量。
   */
  readonly key: string;
  /** 符号键:只认是哪个符号(哪个字符、哪种线),不计字号与变体。 */
  readonly symbol: string;
  /**
   * 所在的结构分组(上下标、分式、根式、括号组、花括号组、表格的行与格…)在 TexLayout.groups 里的下标,
   * 外层在前。按结构变形先把整组一样的子式(比如 c²)当成一个整体配对,不会把指数和底数拆开。
   */
  readonly groups: readonly number[];
}

/** 一个结构分组:MathML 结构名与其中图元的下标(阅读顺序,含嵌套在里面的)。 */
export interface TexGroup {
  readonly node: string;
  readonly members: readonly number[];
}

/** 填充图元(字形轮廓、分数线、根号横线)。color 为 null 表示用文字色。 */
export interface TexFill extends TexPrimitiveInfo {
  readonly kind: 'fill';
  readonly path: PathData;
  readonly color: string | null;
}

/** 描边图元(\cancel 的斜线、\boxed 的框这类)。 */
export interface TexStroke extends TexPrimitiveInfo {
  readonly kind: 'stroke';
  readonly path: PathData;
  readonly width: number;
  readonly color: string | null;
}

/**
 * 文字图元:MathJax 字体里没有的字(\text 里的中文)退回画布文字。
 * 在 matrix 下按 font 画,原点是基线起点;它没有轮廓,变形时只能按文字内容配对或交叉淡化。
 */
export interface TexText extends TexPrimitiveInfo {
  readonly kind: 'text';
  readonly text: string;
  readonly matrix: Affine;
  readonly font: string;
  readonly color: string | null;
}

export type TexPrimitive = TexFill | TexStroke | TexText;

/** 中日韩、全角这类宽字符:MathJax 按一个字宽(文字自己的字号)排。 */
function isWideChar(ch: string): boolean {
  const c = ch.codePointAt(0) ?? 0;
  return (
    (c >= 0x1100 && c <= 0x11ff) ||
    (c >= 0x2e80 && c <= 0xa4cf) ||
    (c >= 0xac00 && c <= 0xd7af) ||
    (c >= 0xf900 && c <= 0xfaff) ||
    (c >= 0xfe30 && c <= 0xfe4f) ||
    (c >= 0xff00 && c <= 0xff60) ||
    (c >= 0x20000 && c <= 0x3fffd)
  );
}

/**
 * 画布文字图元的字宽估计(em,按它自己的字号):宽字符 1em,其余约 0.6em。
 * 画布文字没有轮廓可量,量它占多宽(包围盒、配对时的中心)都按这个估。
 */
export function textAdvance(text: string): number {
  let em = 0;
  for (const ch of text) {
    em += isWideChar(ch) ? 1 : 0.6;
  }
  return em;
}

/** 一条公式的排版结果。坐标以盒中心为原点,单位是「1px 字号」:画的时候再乘字号。 */
export interface TexLayout {
  readonly width: number;
  readonly height: number;
  /** 全部图元,按阅读顺序。 */
  readonly primitives: readonly TexPrimitive[];
  /** 全部填充几何合成的一条路径(不分颜色),形状变形与描边生长用。 */
  readonly outline: PathData;
  /** 命名部分(\class / \cssId 的名字)→ 其中图元在 primitives 里的下标(按阅读顺序,含嵌套在里面的)。 */
  readonly parts: ReadonlyMap<string, readonly number[]>;
  /** 结构分组(见 TexPrimitiveInfo.groups),外层的排在前面。 */
  readonly groups: readonly TexGroup[];
  /** TeX 语法错误的说明(公式照样排出红字),没有错误为 null。 */
  readonly error: string | null;
}

interface MathJaxHandle {
  adaptor: LiteAdaptor;
  doc: MathDocument<LiteElement, LiteText, unknown>;
}

let handle: MathJaxHandle | null = null;

function mathjaxHandle(): MathJaxHandle {
  if (handle) {
    return handle;
  }
  // 中文按字号(884 单位)一个字宽:缺省的 1em 会让每个字后面多出一截空隙。
  const adaptor = liteAdaptor({ cjkCharWidth: 0.884 });
  RegisterHTMLHandler(adaptor);
  const doc = mathjax.document('', {
    InputJax: new TeX({
      packages: ['base', 'ams', 'newcommand', 'noundefined', 'boldsymbol', 'color', 'cancel', 'html'],
    }),
    OutputJax: new SVG({ fontCache: 'none' }),
  }) as unknown as MathDocument<LiteElement, LiteText, unknown>;
  handle = { adaptor, doc };
  return handle;
}

const NUM = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;

/** SVG transform 属性 → 矩阵(translate / scale / rotate / matrix / skewX / skewY,按书写顺序复合)。 */
function parseTransform(value: string | null | undefined): Affine | null {
  if (!value) {
    return null;
  }
  let m: Affine = [1, 0, 0, 1, 0, 0];
  const re = /(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)/g;
  for (const hit of value.matchAll(re)) {
    const args = (hit[2] ?? '').match(NUM)?.map(Number) ?? [];
    const [a0 = 0, a1, a2, a3, a4, a5] = args;
    let t: Affine;
    switch (hit[1]) {
      case 'matrix':
        t = [a0, a1 ?? 0, a2 ?? 0, a3 ?? 1, a4 ?? 0, a5 ?? 0];
        break;
      case 'translate':
        t = [1, 0, 0, 1, a0, a1 ?? 0];
        break;
      case 'scale':
        t = [a0, 0, 0, a1 ?? a0, 0, 0];
        break;
      case 'rotate': {
        const r = (a0 * Math.PI) / 180;
        const cos = Math.cos(r);
        const sin = Math.sin(r);
        const cx = a1 ?? 0;
        const cy = a2 ?? 0;
        t = [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
        break;
      }
      case 'skewX':
        t = [1, 0, Math.tan((a0 * Math.PI) / 180), 1, 0, 0];
        break;
      default:
        t = [1, Math.tan((a0 * Math.PI) / 180), 0, 1, 0, 0];
        break;
    }
    m = multiplyAffine(m, t);
  }
  return m;
}

/** 矩阵的等效缩放(面积缩放的平方根):SVG 用户单位的线宽换算到归一坐标用。 */
function matrixScale(m: Affine): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

function number(value: string | null | undefined, fallback = 0): number {
  const n = Number.parseFloat(value ?? '');
  return Number.isFinite(n) ? n : fallback;
}

/** fill / stroke 属性值:缺省继承;currentColor 原样留着,用到的时候才按当时的 color 解析(CSS 的规矩)。 */
function paint(value: string | null | undefined, inherited: string | null): string | null {
  return value === null || value === undefined || value === '' ? inherited : value;
}

/** 解析颜料:currentColor 与没设过都取 CSS color(\style{color:…} 设的;没有为 null,即文字色)。 */
function resolvePaint(value: string | null, color: string | null): string | null {
  return value === null || value === 'currentColor' ? color : value;
}

/** 根坐标里的轴对齐矩形。 */
interface ClipRect {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

interface WalkState {
  matrix: Affine;
  /** fill / stroke 的原始值(可能是 currentColor);null 为没设过。 */
  fill: string | null;
  stroke: string | null;
  /** CSS color,即 currentColor 的值;null 为文字色。 */
  color: string | null;
  strokeWidth: number;
  fontFamily: string;
  /** 最近一层 MathML 结构(mfrac、msqrt…):分数线、横线的身份按它算。 */
  node: string;
  /** 所在的命名部分,外层在前。 */
  parts: readonly string[];
  /** 嵌套 svg 视口的裁剪框;null 为不裁。 */
  clip: ClipRect | null;
  /** 所在的结构分组(WalkSink.groups 的下标),外层在前。 */
  groups: readonly number[];
}

/** 遍历的产出:图元与结构分组。 */
interface WalkSink {
  readonly primitives: TexPrimitive[];
  readonly groups: Array<{ node: string; members: number[] }>;
}

/** 算作一个结构分组的 MathML 结构:整组相同就能当成一个整体配对的子式。 */
const GROUP_NODES = new Set([
  'mrow',
  'TeXAtom',
  'mstyle',
  'msup',
  'msub',
  'msubsup',
  'mmultiscripts',
  'mfrac',
  'msqrt',
  'mroot',
  'munder',
  'mover',
  'munderover',
  'menclose',
  'mtable',
  'mtr',
  'mtd',
]);

/** 还没挂上结构分组的图元(walk 里统一补上)。 */
type Ungrouped<T> = T extends unknown ? Omit<T, 'groups'> : never;

/** 轮廓指纹(FNV-1a):同一字符的不同变体(大号定界符、行间大运算符)轮廓不同,身份也就不同。 */
function fingerprint(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
}

/** 字号档位(按 0.02 em 取整):上标 0.707、再上一层 0.5 各成一档,相近的字号归到同一档。 */
function sizeBucket(scale: number): number {
  return Math.round(scale * 50);
}

/** 两个方向缩放不同(伸缩定界符、上划线的延长段)。 */
function isStretched(m: Affine): boolean {
  const sx = Math.hypot(m[0], m[1]);
  const sy = Math.hypot(m[2], m[3]);
  return Math.abs(sx - sy) > 1e-3 * Math.max(sx, sy);
}

/** 线段(三次段的控制点都在弦上、不越过端点):展平时只取端点。 */
function isStraight(p: readonly number[], i: number): boolean {
  const x0 = p[i] ?? 0;
  const y0 = p[i + 1] ?? 0;
  const dx = (p[i + 6] ?? 0) - x0;
  const dy = (p[i + 7] ?? 0) - y0;
  const len2 = dx * dx + dy * dy;
  for (const k of [2, 4]) {
    const ux = (p[i + k] ?? 0) - x0;
    const uy = (p[i + k + 1] ?? 0) - y0;
    const dot = ux * dx + uy * dy;
    if (Math.abs(ux * dy - uy * dx) > 1e-9 * Math.max(len2, 1) || dot < 0 || dot > len2) {
      return false;
    }
  }
  return true;
}

interface Pt {
  x: number;
  y: number;
}

/** 子路径展平成折线(曲线段各取 8 个点)。 */
function flatten(sub: Subpath): Pt[] {
  const p = sub.points;
  const out: Pt[] = [{ x: p[0] ?? 0, y: p[1] ?? 0 }];
  for (let i = 0; i + 7 < p.length; i += 6) {
    const steps = isStraight(p, i) ? 1 : 8;
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const u = 1 - t;
      const a = u * u * u;
      const b = 3 * u * u * t;
      const c = 3 * u * t * t;
      const d = t * t * t;
      out.push({
        x: a * (p[i] ?? 0) + b * (p[i + 2] ?? 0) + c * (p[i + 4] ?? 0) + d * (p[i + 6] ?? 0),
        y: a * (p[i + 1] ?? 0) + b * (p[i + 3] ?? 0) + c * (p[i + 5] ?? 0) + d * (p[i + 7] ?? 0),
      });
    }
  }
  return out;
}

/** Sutherland–Hodgman 的一条边:保留 axis 坐标在 bound 这一侧(keepAbove 为 ≥,否则 ≤)的部分。 */
function clipEdge(poly: readonly Pt[], axis: 'x' | 'y', bound: number, keepAbove: boolean): Pt[] {
  const out: Pt[] = [];
  const inside = (q: Pt): boolean => (keepAbove ? q[axis] >= bound : q[axis] <= bound);
  const cross = (a: Pt, b: Pt): Pt => {
    const t = (bound - a[axis]) / (b[axis] - a[axis]);
    return axis === 'x'
      ? { x: bound, y: a.y + (b.y - a.y) * t }
      : { x: a.x + (b.x - a.x) * t, y: bound };
  };
  poly.forEach((cur, i) => {
    const prev = poly[(i + poly.length - 1) % poly.length] ?? cur;
    if (inside(cur)) {
      if (!inside(prev)) {
        out.push(cross(prev, cur));
      }
      out.push(cur);
    } else if (inside(prev)) {
      out.push(cross(prev, cur));
    }
  });
  return out;
}

/**
 * 把填充路径裁进矩形:MathJax 把伸缩定界符、上划线、长箭头的延长段放大后放进嵌套 svg,
 * 靠视口只露出中间一截。每条子路径单独按多边形裁(裁剪框是凸的,非零环绕的结果不变)。
 */
function clipPath(path: PathData, r: ClipRect): PathData {
  const b = pathBounds(path);
  if (!b) {
    return path;
  }
  if (b.minX >= r.minX && b.maxX <= r.maxX && b.minY >= r.minY && b.maxY <= r.maxY) {
    return path;
  }
  if (b.maxX <= r.minX || b.minX >= r.maxX || b.maxY <= r.minY || b.minY >= r.maxY) {
    return EMPTY_PATH;
  }
  const subpaths: Subpath[] = [];
  for (const sub of path.subpaths) {
    let poly = flatten(sub);
    poly = clipEdge(poly, 'x', r.minX, true);
    poly = clipEdge(poly, 'x', r.maxX, false);
    poly = clipEdge(poly, 'y', r.minY, true);
    poly = clipEdge(poly, 'y', r.maxY, false);
    if (poly.length >= 3) {
      subpaths.push(...polylinePath(poly, true).subpaths);
    }
  }
  return { subpaths };
}

/** 嵌套 svg 的视口在根坐标里的矩形;变换带旋转(MathJax 不会产生)时量不出轴对齐的框,不裁。 */
function viewportClip(
  m: Affine,
  x: number,
  y: number,
  w: number,
  h: number,
  outer: ClipRect | null,
): ClipRect | null {
  if (Math.abs(m[1]) > 1e-12 || Math.abs(m[2]) > 1e-12) {
    return outer;
  }
  const x0 = m[0] * x + m[4];
  const x1 = m[0] * (x + w) + m[4];
  const y0 = m[3] * y + m[5];
  const y1 = m[3] * (y + h) + m[5];
  const r = {
    minX: Math.min(x0, x1),
    minY: Math.min(y0, y1),
    maxX: Math.max(x0, x1),
    maxY: Math.max(y0, y1),
  };
  return outer
    ? {
        minX: Math.max(r.minX, outer.minX),
        minY: Math.max(r.minY, outer.minY),
        maxX: Math.min(r.maxX, outer.maxX),
        maxY: Math.min(r.maxY, outer.maxY),
      }
    : r;
}

/** 嵌套 svg 的 viewBox → 视口变换(preserveAspectRatio 缺省 xMidYMid meet;none 为各向拉伸)。 */
function viewportMatrix(
  x: number,
  y: number,
  w: number,
  h: number,
  viewBox: readonly number[] | undefined,
  stretch: boolean,
): Affine {
  const [bx = 0, by = 0, bw = 0, bh = 0] = viewBox ?? [];
  if (!(bw > 0 && bh > 0 && w > 0 && h > 0)) {
    return [1, 0, 0, 1, x, y];
  }
  let sx = w / bw;
  let sy = h / bh;
  if (!stretch) {
    sx = sy = Math.min(sx, sy);
  }
  return [sx, 0, 0, sy, x + (w - bw * sx) / 2 - bx * sx, y + (h - bh * sy) / 2 - by * sy];
}

/** 元素上的命名部分:\class 的类名(可以有多个)与 \cssId 的 id,去掉 MathJax 内部的 mjx- 类。 */
function ownParts(className: string | null, id: string | null): string[] {
  const names = (className ?? '').split(/\s+/).filter((c) => c !== '' && !c.startsWith('mjx-'));
  if (id !== null && id !== '' && !id.startsWith('mjx-')) {
    names.push(id);
  }
  return names;
}

function walk(adaptor: LiteAdaptor, node: LiteElement, state: WalkState, sink: WalkSink): void {
  const kind = adaptor.kind(node);
  const attr = (name: string): string | null => {
    const v = adaptor.getAttribute(node, name);
    return typeof v === 'string' ? v : null;
  };
  const own = parseTransform(attr('transform'));
  const matrix = own ? multiplyAffine(state.matrix, own) : state.matrix;
  const style = attr('style') ?? '';
  const family = /font-family:\s*([^;]+)/.exec(style)?.[1]?.trim();
  const cssColor = /(?:^|;)\s*color:\s*([^;]+)/.exec(style)?.[1]?.trim();
  const mml = attr('data-mml-node');
  const errorNode = mml === 'merror';
  const added = ownParts(attr('class'), attr('id')).filter((name) => !state.parts.includes(name));
  let groups = state.groups;
  if (mml !== null && GROUP_NODES.has(mml)) {
    groups = [...groups, sink.groups.length];
    sink.groups.push({ node: mml, members: [] });
  }
  const next: WalkState = {
    matrix,
    fill: errorNode ? ERROR_COLOR : paint(attr('fill'), state.fill),
    stroke: errorNode ? ERROR_COLOR : paint(attr('stroke'), state.stroke),
    color: cssColor ?? state.color,
    strokeWidth: attr('stroke-width') !== null ? number(attr('stroke-width')) : state.strokeWidth,
    fontFamily: family ?? state.fontFamily,
    node: mml ?? state.node,
    parts: added.length > 0 ? [...state.parts, ...added] : state.parts,
    clip: state.clip,
    groups,
  };
  const out = {
    push(p: Ungrouped<TexPrimitive>): void {
      const index = sink.primitives.length;
      sink.primitives.push({ ...p, groups } as TexPrimitive);
      for (const id of groups) {
        sink.groups[id]?.members.push(index);
      }
    },
  };
  const fillColor = resolvePaint(next.fill, next.color);
  const strokeColor = resolvePaint(next.stroke, next.color);
  const size = sizeBucket(matrixScale(matrix));
  const parts = next.parts;
  const clipped = (path: PathData): PathData => (next.clip ? clipPath(path, next.clip) : path);
  switch (kind) {
    case 'path': {
      const d = attr('d');
      if (!d) {
        return;
      }
      const path = clipped(transformPath(parseSvgPath(d), matrix));
      if (isEmptyPath(path)) {
        return;
      }
      const c = attr('data-c');
      const symbol = c ? `c:${c}` : `path:${next.node}`;
      // 伸缩出来的段(拉长的延长段)不计伸缩量:长短不同的同一种括号、箭头照样认成同一个。
      const key = isStretched(matrix) ? `${symbol}|stretch` : `${symbol}|${fingerprint(d)}|${size}`;
      if (next.fill !== 'none') {
        out.push({ kind: 'fill', path, color: fillColor, parts, key, symbol });
      }
      if (next.strokeWidth > 0 && next.stroke !== 'none') {
        out.push({
          kind: 'stroke',
          path,
          width: next.strokeWidth * matrixScale(matrix),
          color: strokeColor,
          parts,
          key: `stroke:${key}`,
          symbol: `stroke:${symbol}`,
        });
      }
      return;
    }
    case 'rect': {
      // 报错公式的底色块不画:错误信息用红字就够了(与之前 KaTeX 的红字一致)。
      if (attr('data-background') === 'true') {
        return;
      }
      const w = number(attr('width'));
      const h = number(attr('height'));
      if (!(w > 0 && h > 0)) {
        return;
      }
      const rect = transformPath(
        new PathBuilder().rect(number(attr('x')), number(attr('y')), w, h).build(),
        matrix,
      );
      if (next.fill !== 'none') {
        const path = clipped(rect);
        if (!isEmptyPath(path)) {
          const symbol = `rect:${next.node}`;
          out.push({ kind: 'fill', path, color: fillColor, parts, key: `${symbol}|${size}`, symbol });
        }
      }
      // \boxed 这类只描边的框(fill="none";\href 的点击热区既不填也不描,两头都跳过)。
      if (next.strokeWidth > 0 && next.stroke !== 'none') {
        const symbol = `frame:${next.node}`;
        out.push({
          kind: 'stroke',
          path: rect,
          width: next.strokeWidth * matrixScale(matrix),
          color: strokeColor,
          parts,
          key: `${symbol}|${size}`,
          symbol,
        });
      }
      return;
    }
    case 'line': {
      const path = new PathBuilder()
        .moveTo(number(attr('x1')), number(attr('y1')))
        .lineTo(number(attr('x2')), number(attr('y2')))
        .build();
      const symbol = `line:${next.node}`;
      out.push({
        kind: 'stroke',
        path: transformPath(path, matrix),
        width: (next.strokeWidth > 0 ? next.strokeWidth : 40) * matrixScale(matrix),
        color: strokeColor,
        parts,
        key: `${symbol}|${size}`,
        symbol,
      });
      return;
    }
    case 'text': {
      const text = adaptor.textContent(node);
      if (text.trim() === '') {
        return;
      }
      const fontSize = number(attr('font-size'), 884);
      const fontFamily = attr('font-family') ?? next.fontFamily;
      const weight = attr('font-weight') ?? 'normal';
      const fontStyle = attr('font-style') ?? 'normal';
      const symbol = `text:${text}`;
      const em = (fontSize / UNITS_PER_EM) * matrixScale(matrix);
      out.push({
        kind: 'text',
        text,
        matrix: multiplyAffine(matrix, [1, 0, 0, 1, number(attr('x')), number(attr('y'))]),
        font: `${fontStyle} ${weight} ${fontSize}px ${fontFamily}`,
        color: fillColor,
        parts,
        key: `${symbol}|${fontStyle} ${weight} ${fontFamily}|${sizeBucket(em)}`,
        symbol,
      });
      return;
    }
    case 'svg': {
      // 嵌套 svg(伸缩定界符、上划线、长箭头的延长段):按视口换坐标,并把内容裁进视口。
      const x = number(attr('x'));
      const y = number(attr('y'));
      const w = number(attr('width'));
      const h = number(attr('height'));
      next.clip = viewportClip(matrix, x, y, w, h, next.clip);
      const viewBox = attr('viewBox')?.match(NUM)?.map(Number);
      const stretch = attr('preserveAspectRatio') === 'none';
      next.matrix = multiplyAffine(matrix, viewportMatrix(x, y, w, h, viewBox, stretch));
      break;
    }
    default:
      break;
  }
  for (const child of adaptor.childNodes(node)) {
    if (adaptor.kind(child) !== '#text' && adaptor.kind(child) !== '#comment') {
      walk(adaptor, child as LiteElement, next, sink);
    }
  }
}

/** 在树里找第一个 svg 元素。 */
function findSvg(adaptor: LiteAdaptor, node: LiteElement): LiteElement | null {
  if (adaptor.kind(node) === 'svg') {
    return node;
  }
  for (const child of adaptor.childNodes(node)) {
    if (adaptor.kind(child) === '#text') {
      continue;
    }
    const hit = findSvg(adaptor, child as LiteElement);
    if (hit) {
      return hit;
    }
  }
  return null;
}

function findError(adaptor: LiteAdaptor, node: LiteElement): string | null {
  const err = adaptor.getAttribute(node, 'data-mjx-error');
  if (typeof err === 'string' && err !== '') {
    return err;
  }
  for (const child of adaptor.childNodes(node)) {
    if (adaptor.kind(child) === '#text') {
      continue;
    }
    const hit = findError(adaptor, child as LiteElement);
    if (hit) {
      return hit;
    }
  }
  return null;
}

/** 图元整体过一遍仿射(归一化到「盒中心为原点、1px 字号」)。 */
function mapPrimitive(p: TexPrimitive, m: Affine, k: number): TexPrimitive {
  switch (p.kind) {
    case 'fill':
      return { ...p, path: transformPath(p.path, m) };
    case 'stroke':
      return { ...p, path: transformPath(p.path, m), width: p.width * k };
    default:
      return { ...p, matrix: multiplyAffine(m, p.matrix) };
  }
}

function layoutOf(source: string, displayMode: boolean): TexLayout {
  const { adaptor, doc } = mathjaxHandle();
  const root = doc.convert(source, { display: displayMode }) as LiteElement;
  const svg = findSvg(adaptor, root);
  const box = String(adaptor.getAttribute(svg ?? root, 'viewBox') ?? '')
    .match(NUM)
    ?.map(Number) ?? [0, 0, 0, 0];
  const [vx = 0, vy = 0, vw = 0, vh = 0] = box;
  // 先在 SVG 用户单位里收集图元(基线 y = 0、向下为正,1000 单位 / em)。
  const sink: WalkSink = { primitives: [], groups: [] };
  const raw = sink.primitives;
  if (svg) {
    // 从根 svg 的子元素走起:根 svg 的 viewBox 是度量框(下面另算),嵌套的 svg 才是要换坐标、裁剪的视口。
    const start: WalkState = {
      matrix: [1, 0, 0, 1, 0, 0],
      fill: null,
      stroke: null,
      color: null,
      strokeWidth: 0,
      fontFamily: 'serif',
      node: 'math',
      parts: [],
      clip: null,
      groups: [],
    };
    for (const child of adaptor.childNodes(svg)) {
      if (adaptor.kind(child) !== '#text' && adaptor.kind(child) !== '#comment') {
        walk(adaptor, child as LiteElement, start, sink);
      }
    }
  }
  // 度量框:viewBox 的 vy 是基线以上的高度(负值),vy + vh 是基线以下的深度,各自不小于一个 \strut。
  let minX = vx;
  let maxX = vx + vw;
  let minY = -Math.max(-vy / UNITS_PER_EM, MIN_ASCENT) * UNITS_PER_EM;
  let maxY = Math.max((vy + vh) / UNITS_PER_EM, MIN_DESCENT) * UNITS_PER_EM;
  // 并上墨迹框:字形可以伸出自己的度量(j 的钩、积分号的上端、撇号),取景与剔除要包住全部墨迹。
  for (const p of raw) {
    if (p.kind === 'text') {
      continue;
    }
    const b = pathBounds(p.path);
    if (!b) {
      continue;
    }
    const pad = p.kind === 'stroke' ? p.width / 2 : 0;
    minX = Math.min(minX, b.minX - pad);
    maxX = Math.max(maxX, b.maxX + pad);
    minY = Math.min(minY, b.minY - pad);
    maxY = Math.max(maxY, b.maxY + pad);
  }
  const k = MATH_SCALE / UNITS_PER_EM;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const normalize: Affine = [k, 0, 0, k, -cx * k, -cy * k];
  const primitives = raw.map((p) => mapPrimitive(p, normalize, k));
  const fills = primitives.filter((p): p is TexFill => p.kind === 'fill').map((p) => p.path);
  const parts = new Map<string, number[]>();
  primitives.forEach((p, i) => {
    for (const name of p.parts) {
      const list = parts.get(name);
      if (list) {
        list.push(i);
      } else {
        parts.set(name, [i]);
      }
    }
  });
  return {
    width: (maxX - minX) * k,
    height: (maxY - minY) * k,
    primitives,
    outline: concatPaths(fills),
    parts,
    groups: sink.groups,
    error: findError(adaptor, root),
  };
}

/** (displayMode, source) → 排版结果。插入序即 LRU 序。 */
const cache = new Map<string, TexLayout>();

/**
 * 排版一条公式(同步,结果缓存)。语法错误不抛:MathJax 会把错误信息排成红字,
 * error 字段给出说明;未定义的命令按 noundefined 包的规矩显示成红色原文。
 */
export function typesetTex(source: string, displayMode = false): TexLayout {
  const key = `${displayMode ? 'd' : 'i'}|${source}`;
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const layout = layoutOf(source, displayMode);
  cache.set(key, layout);
  if (cache.size > CACHE_LIMIT) {
    const oldest = cache.keys().next();
    if (!oldest.done) {
      cache.delete(oldest.value);
    }
  }
  return layout;
}
