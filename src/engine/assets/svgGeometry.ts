import type { Affine, PathData, Subpath } from '../path/path';
import { EMPTY_PATH, IDENTITY_AFFINE, PathBuilder, multiplyAffine, polylinePath } from '../path/path';

/**
 * SVG 几何:长度单位、transform 列表、viewBox / preserveAspectRatio 映射、
 * 基本形状 → 路径,以及把 evenodd 填充换成等价的 nonzero 朝向。
 * 全部是纯函数,node 与浏览器结果一致。
 */

/** 百分比长度的参照视口(用户单位)。 */
export interface Viewport {
  readonly w: number;
  readonly h: number;
}

export interface ViewBox {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export type SvgAlign =
  | 'none'
  | 'xMinYMin'
  | 'xMidYMin'
  | 'xMaxYMin'
  | 'xMinYMid'
  | 'xMidYMid'
  | 'xMaxYMid'
  | 'xMinYMax'
  | 'xMidYMax'
  | 'xMaxYMax';

export interface AspectRatio {
  readonly align: SvgAlign;
  readonly slice: boolean;
}

export const DEFAULT_ASPECT: AspectRatio = Object.freeze({ align: 'xMidYMid', slice: false });

/** 绝对单位 → px(CSS 96dpi);em / ex 按 16px 字号估。 */
const UNIT_PX: Readonly<Record<string, number>> = {
  px: 1,
  pt: 4 / 3,
  pc: 16,
  mm: 96 / 25.4,
  cm: 96 / 2.54,
  in: 96,
  em: 16,
  ex: 8,
};

const LENGTH = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?)\s*([a-zA-Z]+|%)?$/;

export type LengthAxis = 'x' | 'y' | 'other';

/**
 * 解析长度。% 相对 viewport(x 向用宽、y 向用高、其它用 √((w²+h²)/2)),没有 viewport 时返回 null。
 * 语法错误、未知单位返回 null。
 */
export function parseLength(
  value: string | undefined,
  axis: LengthAxis,
  viewport: Viewport | null,
): number | null {
  if (value === undefined) {
    return null;
  }
  const m = LENGTH.exec(value.trim());
  if (!m) {
    return null;
  }
  const v = Number(m[1]);
  const unit = (m[2] ?? 'px').toLowerCase();
  if (unit === '%') {
    if (!viewport) {
      return null;
    }
    const ref =
      axis === 'x'
        ? viewport.w
        : axis === 'y'
          ? viewport.h
          : Math.sqrt((viewport.w * viewport.w + viewport.h * viewport.h) / 2);
    return (v / 100) * ref;
  }
  const k = UNIT_PX[unit];
  return k === undefined || !Number.isFinite(v) ? null : v * k;
}

const NUMBER_TOKEN = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/g;

/** 数列(逗号 / 空白分隔,容忍 "1-2" 这种紧凑写法)。 */
export function parseNumbers(value: string | undefined): number[] {
  if (!value) {
    return [];
  }
  return (value.match(NUMBER_TOKEN) ?? []).map(Number).filter(Number.isFinite);
}

/** √|det|:线宽、虚线跟着变换缩放的比例。 */
export function affineScale(m: Affine): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

export function translateAffine(x: number, y: number): Affine {
  return [1, 0, 0, 1, x, y];
}

export function scaleAffine(sx: number, sy: number): Affine {
  return [sx, 0, 0, sy, 0, 0];
}

function rotateAffine(deg: number): Affine {
  const a = (deg * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  return [cos, sin, -sin, cos, 0, 0];
}

const TRANSFORM_ITEM = /\s*(matrix|translate|scale|rotate|skewX|skewY)\s*\(([^)]*)\)\s*,?/y;

/**
 * 解析 transform 列表(从左往右右乘:写在前面的最后作用)。空串是单位阵;语法错误返回 null
 * (规范:整个属性当没写)。
 */
export function parseTransform(value: string): Affine | null {
  const s = value.trim();
  let m: Affine = IDENTITY_AFFINE;
  let i = 0;
  while (i < s.length) {
    TRANSFORM_ITEM.lastIndex = i;
    const hit = TRANSFORM_ITEM.exec(s);
    if (!hit) {
      return null;
    }
    i = TRANSFORM_ITEM.lastIndex;
    const args = (hit[2] ?? '').trim();
    const nums = parseNumbers(args);
    if (args && nums.length === 0) {
      return null;
    }
    const [a = 0, b, c, d, e, f] = nums;
    let t: Affine;
    switch (hit[1]) {
      case 'matrix':
        if (nums.length !== 6) {
          return null;
        }
        t = [a, b ?? 0, c ?? 0, d ?? 0, e ?? 0, f ?? 0];
        break;
      case 'translate':
        if (nums.length < 1 || nums.length > 2) {
          return null;
        }
        t = translateAffine(a, b ?? 0);
        break;
      case 'scale':
        if (nums.length < 1 || nums.length > 2) {
          return null;
        }
        t = scaleAffine(a, b ?? a);
        break;
      case 'rotate':
        if (nums.length === 1) {
          t = rotateAffine(a);
        } else if (nums.length === 3) {
          const cx = b ?? 0;
          const cy = c ?? 0;
          t = multiplyAffine(
            multiplyAffine(translateAffine(cx, cy), rotateAffine(a)),
            translateAffine(-cx, -cy),
          );
        } else {
          return null;
        }
        break;
      case 'skewX':
        if (nums.length !== 1) {
          return null;
        }
        t = [1, 0, Math.tan((a * Math.PI) / 180), 1, 0, 0];
        break;
      case 'skewY':
        if (nums.length !== 1) {
          return null;
        }
        t = [1, Math.tan((a * Math.PI) / 180), 0, 1, 0, 0];
        break;
      default:
        return null;
    }
    m = multiplyAffine(m, t);
  }
  return m.every(Number.isFinite) ? m : null;
}

/** viewBox="x y w h"。没写返回 null;写了但非法(个数不对、宽高 ≤ 0)返回 'invalid'。 */
export function parseViewBox(value: string | undefined): ViewBox | null | 'invalid' {
  if (value === undefined || !value.trim()) {
    return null;
  }
  const nums = parseNumbers(value);
  const [x = 0, y = 0, width = 0, height = 0] = nums;
  if (nums.length !== 4 || !(width > 0) || !(height > 0)) {
    return 'invalid';
  }
  return { x, y, width, height };
}

const ALIGNS: ReadonlySet<string> = new Set([
  'none',
  'xMinYMin',
  'xMidYMin',
  'xMaxYMin',
  'xMinYMid',
  'xMidYMid',
  'xMaxYMid',
  'xMinYMax',
  'xMidYMax',
  'xMaxYMax',
]);

/** preserveAspectRatio="[defer] <align> [meet|slice]",缺省 xMidYMid meet。 */
export function parseAspectRatio(value: string | undefined): AspectRatio {
  if (!value) {
    return DEFAULT_ASPECT;
  }
  const tokens = value.trim().split(/\s+/).filter((t) => t !== 'defer');
  const align = tokens[0] ?? 'xMidYMid';
  if (!ALIGNS.has(align)) {
    return DEFAULT_ASPECT;
  }
  return { align: align as SvgAlign, slice: tokens[1] === 'slice' };
}

/** viewBox 映射到 (0, 0, width, height) 视口的矩阵(SVG 规范的算法)。 */
export function viewBoxTransform(vb: ViewBox, width: number, height: number, aspect: AspectRatio): Affine {
  let sx = width / vb.width;
  let sy = height / vb.height;
  if (aspect.align === 'none') {
    return [sx, 0, 0, sy, -vb.x * sx, -vb.y * sy];
  }
  const s = aspect.slice ? Math.max(sx, sy) : Math.min(sx, sy);
  sx = s;
  sy = s;
  let tx = -vb.x * s;
  let ty = -vb.y * s;
  const align = aspect.align;
  if (align.startsWith('xMid')) {
    tx += (width - vb.width * s) / 2;
  } else if (align.startsWith('xMax')) {
    tx += width - vb.width * s;
  }
  if (align.endsWith('YMid')) {
    ty += (height - vb.height * s) / 2;
  } else if (align.endsWith('YMax')) {
    ty += height - vb.height * s;
  }
  return [s, 0, 0, s, tx, ty];
}

/** 画椭圆四分之一段用的控制柄比例(4/3·tan(π/8))。 */
const KAPPA = 0.5522847498307936;

/**
 * 矩形(可带圆角)。圆角按规范:只给一个半径另一个同值,钳到半宽、半高。
 * 从 (x + rx, y) 起顺时针;宽或高不是正数时不画。
 */
export function rectPath(x: number, y: number, w: number, h: number, rxIn: number | null, ryIn: number | null): PathData {
  if (!(w > 0) || !(h > 0)) {
    return EMPTY_PATH;
  }
  let rx = rxIn !== null && rxIn > 0 ? rxIn : null;
  let ry = ryIn !== null && ryIn > 0 ? ryIn : null;
  rx ??= ry ?? 0;
  ry ??= rx;
  rx = Math.min(rx, w / 2);
  ry = Math.min(ry, h / 2);
  if (!(rx > 0) || !(ry > 0)) {
    return new PathBuilder().rect(x, y, w, h).build();
  }
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  const r = x + w;
  const bottom = y + h;
  const b = new PathBuilder().moveTo(x + rx, y);
  const line = (tx: number, ty: number, fx: number, fy: number): void => {
    // 圆角占满半边时直边长度为 0:不补零长段(弧长表与 Create 的节奏都不该有空段)。
    if (Math.abs(tx - fx) > 1e-12 || Math.abs(ty - fy) > 1e-12) {
      b.lineTo(tx, ty);
    }
  };
  line(r - rx, y, x + rx, y);
  b.cubicTo(r - rx + kx, y, r, y + ry - ky, r, y + ry);
  line(r, bottom - ry, r, y + ry);
  b.cubicTo(r, bottom - ry + ky, r - rx + kx, bottom, r - rx, bottom);
  line(x + rx, bottom, r - rx, bottom);
  b.cubicTo(x + rx - kx, bottom, x, bottom - ry + ky, x, bottom - ry);
  line(x, y + ry, x, bottom - ry);
  b.cubicTo(x, y + ry - ky, x + rx - kx, y, x + rx, y);
  return b.close().build();
}

/** 椭圆(圆):从 (cx + rx, cy) 沿角度增大方向(屏幕上顺时针)四段,闭合。任一半径不是正数时不画。 */
export function ellipsePath(cx: number, cy: number, rx: number, ry: number): PathData {
  if (!(rx > 0) || !(ry > 0)) {
    return EMPTY_PATH;
  }
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  return new PathBuilder()
    .moveTo(cx + rx, cy)
    .cubicTo(cx + rx, cy + ky, cx + kx, cy + ry, cx, cy + ry)
    .cubicTo(cx - kx, cy + ry, cx - rx, cy + ky, cx - rx, cy)
    .cubicTo(cx - rx, cy - ky, cx - kx, cy - ry, cx, cy - ry)
    .cubicTo(cx + kx, cy - ry, cx + rx, cy - ky, cx + rx, cy)
    .close()
    .build();
}

export function linePath(x1: number, y1: number, x2: number, y2: number): PathData {
  return new PathBuilder().moveTo(x1, y1).lineTo(x2, y2).build();
}

/** polyline / polygon 的 points:数对,奇数个丢掉最后一个;不到两个点不画。 */
export function pointsPath(value: string | undefined, closed: boolean): PathData {
  const nums = parseNumbers(value);
  const pts: Array<{ x: number; y: number }> = [];
  for (let i = 0; i + 1 < nums.length; i += 2) {
    pts.push({ x: nums[i] ?? 0, y: nums[i + 1] ?? 0 });
  }
  return polylinePath(pts, closed);
}

// ---------------------------------------------------------------------------
// evenodd → nonzero

/** 子路径按控制多边形细分成折线(每段 8 个采样点)。 */
function flatten(sub: Subpath): number[] {
  const p = sub.points;
  const out: number[] = [p[0] ?? 0, p[1] ?? 0];
  for (let i = 2; i + 5 < p.length; i += 6) {
    const x0 = p[i - 2] ?? 0;
    const y0 = p[i - 1] ?? 0;
    const x1 = p[i] ?? 0;
    const y1 = p[i + 1] ?? 0;
    const x2 = p[i + 2] ?? 0;
    const y2 = p[i + 3] ?? 0;
    const x3 = p[i + 4] ?? 0;
    const y3 = p[i + 5] ?? 0;
    for (let k = 1; k <= 8; k++) {
      const t = k / 8;
      const u = 1 - t;
      const a = u * u * u;
      const b = 3 * u * u * t;
      const c = 3 * u * t * t;
      const d = t * t * t;
      out.push(a * x0 + b * x1 + c * x2 + d * x3, a * y0 + b * y1 + c * y2 + d * y3);
    }
  }
  return out;
}

/** 折线(隐式闭合)的有向面积(鞋带公式)。 */
function signedArea(poly: readonly number[]): number {
  let area = 0;
  const n = poly.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    area += (poly[i * 2] ?? 0) * (poly[j * 2 + 1] ?? 0) - (poly[j * 2] ?? 0) * (poly[i * 2 + 1] ?? 0);
  }
  return area / 2;
}

/** 点是否在折线(隐式闭合)内:奇偶射线测试。 */
function insidePolygon(poly: readonly number[], x: number, y: number): boolean {
  let inside = false;
  const n = poly.length / 2;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i * 2] ?? 0;
    const yi = poly[i * 2 + 1] ?? 0;
    const xj = poly[j * 2] ?? 0;
    const yj = poly[j * 2 + 1] ?? 0;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** 反转子路径的点序:三次段 [p0, c1, c2, p1] 反成 [p1, c2, c1, p0],闭合标记不变。 */
export function reverseSubpath(sub: Subpath): Subpath {
  const p = sub.points;
  const segs = Math.floor((p.length - 2) / 6);
  const out: number[] = [p[segs * 6] ?? 0, p[segs * 6 + 1] ?? 0];
  for (let k = segs - 1; k >= 0; k--) {
    const o = k * 6;
    out.push(p[o + 4] ?? 0, p[o + 5] ?? 0, p[o + 2] ?? 0, p[o + 3] ?? 0, p[o] ?? 0, p[o + 1] ?? 0);
  }
  return { points: out, closed: sub.closed };
}

/** 超过这个子路径数就不做嵌套判断(O(n²))。 */
export const EVENODD_SUBPATH_LIMIT = 500;

/**
 * 重排子路径朝向,使 nonzero 填充的结果等于 evenodd:嵌套深度(被几条别的子路径包着)为偶数的取正向、
 * 奇数的取反向。子路径互不相交时精确;自相交 / 互相交叉的(一笔画的五角星)无法用朝向表达,只能近似。
 * 子路径太多(> EVENODD_SUBPATH_LIMIT)时原样返回。
 */
export function evenOddAsNonZero(path: PathData): PathData {
  const subs = path.subpaths;
  if (subs.length < 2 || subs.length > EVENODD_SUBPATH_LIMIT) {
    return path;
  }
  const polys = subs.map(flatten);
  let changed = false;
  const out = subs.map((sub, i) => {
    const poly = polys[i] ?? [];
    const area = signedArea(poly);
    if (!(Math.abs(area) > 1e-12) || poly.length < 6) {
      return sub;
    }
    // 第一段的中点(在自己的边界上,子路径互不相交时它在别的子路径里 ⇔ 整条都在里面)。
    const k = Math.min(8, poly.length / 2 - 1);
    const mx = poly[k] ?? 0;
    const my = poly[k + 1] ?? 0;
    let depth = 0;
    polys.forEach((other, j) => {
      if (j !== i && other.length >= 6 && insidePolygon(other, mx, my)) {
        depth += 1;
      }
    });
    const wantPositive = depth % 2 === 0;
    if (area > 0 === wantPositive) {
      return sub;
    }
    changed = true;
    return reverseSubpath(sub);
  });
  return changed ? { subpaths: out } : path;
}
