import type { Rgba } from '../color';
import { parseColor } from '../color';

/**
 * SVG 的颜色与颜料值:CSS 命名色(内置表)、#hex、rgb()/rgba()、hsl()/hsla()、
 * none / transparent / currentColor、url(#id) [后备]。
 * 自己解析而不交给画布:node 干跑与浏览器必须得到同一个结果。
 */

/** 148 个 CSS 命名色(含 rebeccapurple)。 */
const NAMED_TABLE =
  'aliceblue:f0f8ff,antiquewhite:faebd7,aqua:00ffff,aquamarine:7fffd4,azure:f0ffff,beige:f5f5dc,' +
  'bisque:ffe4c4,black:000000,blanchedalmond:ffebcd,blue:0000ff,blueviolet:8a2be2,brown:a52a2a,' +
  'burlywood:deb887,cadetblue:5f9ea0,chartreuse:7fff00,chocolate:d2691e,coral:ff7f50,' +
  'cornflowerblue:6495ed,cornsilk:fff8dc,crimson:dc143c,cyan:00ffff,darkblue:00008b,darkcyan:008b8b,' +
  'darkgoldenrod:b8860b,darkgray:a9a9a9,darkgreen:006400,darkgrey:a9a9a9,darkkhaki:bdb76b,' +
  'darkmagenta:8b008b,darkolivegreen:556b2f,darkorange:ff8c00,darkorchid:9932cc,darkred:8b0000,' +
  'darksalmon:e9967a,darkseagreen:8fbc8f,darkslateblue:483d8b,darkslategray:2f4f4f,' +
  'darkslategrey:2f4f4f,darkturquoise:00ced1,darkviolet:9400d3,deeppink:ff1493,deepskyblue:00bfff,' +
  'dimgray:696969,dimgrey:696969,dodgerblue:1e90ff,firebrick:b22222,floralwhite:fffaf0,' +
  'forestgreen:228b22,fuchsia:ff00ff,gainsboro:dcdcdc,ghostwhite:f8f8ff,gold:ffd700,goldenrod:daa520,' +
  'gray:808080,green:008000,greenyellow:adff2f,grey:808080,honeydew:f0fff0,hotpink:ff69b4,' +
  'indianred:cd5c5c,indigo:4b0082,ivory:fffff0,khaki:f0e68c,lavender:e6e6fa,lavenderblush:fff0f5,' +
  'lawngreen:7cfc00,lemonchiffon:fffacd,lightblue:add8e6,lightcoral:f08080,lightcyan:e0ffff,' +
  'lightgoldenrodyellow:fafad2,lightgray:d3d3d3,lightgreen:90ee90,lightgrey:d3d3d3,lightpink:ffb6c1,' +
  'lightsalmon:ffa07a,lightseagreen:20b2aa,lightskyblue:87cefa,lightslategray:778899,' +
  'lightslategrey:778899,lightsteelblue:b0c4de,lightyellow:ffffe0,lime:00ff00,limegreen:32cd32,' +
  'linen:faf0e6,magenta:ff00ff,maroon:800000,mediumaquamarine:66cdaa,mediumblue:0000cd,' +
  'mediumorchid:ba55d3,mediumpurple:9370db,mediumseagreen:3cb371,mediumslateblue:7b68ee,' +
  'mediumspringgreen:00fa9a,mediumturquoise:48d1cc,mediumvioletred:c71585,midnightblue:191970,' +
  'mintcream:f5fffa,mistyrose:ffe4e1,moccasin:ffe4b5,navajowhite:ffdead,navy:000080,oldlace:fdf5e6,' +
  'olive:808000,olivedrab:6b8e23,orange:ffa500,orangered:ff4500,orchid:da70d6,palegoldenrod:eee8aa,' +
  'palegreen:98fb98,paleturquoise:afeeee,palevioletred:db7093,papayawhip:ffefd5,peachpuff:ffdab9,' +
  'peru:cd853f,pink:ffc0cb,plum:dda0dd,powderblue:b0e0e6,purple:800080,rebeccapurple:663399,' +
  'red:ff0000,rosybrown:bc8f8f,royalblue:4169e1,saddlebrown:8b4513,salmon:fa8072,sandybrown:f4a460,' +
  'seagreen:2e8b57,seashell:fff5ee,sienna:a0522d,silver:c0c0c0,skyblue:87ceeb,slateblue:6a5acd,' +
  'slategray:708090,slategrey:708090,snow:fffafa,springgreen:00ff7f,steelblue:4682b4,tan:d2b48c,' +
  'teal:008080,thistle:d8bfd8,tomato:ff6347,turquoise:40e0d0,violet:ee82ee,wheat:f5deb3,' +
  'white:ffffff,whitesmoke:f5f5f5,yellow:ffff00,yellowgreen:9acd32';

let namedColors: Map<string, Rgba> | null = null;

function named(name: string): Rgba | undefined {
  if (!namedColors) {
    namedColors = new Map();
    for (const entry of NAMED_TABLE.split(',')) {
      const [key, hex] = entry.split(':');
      const v = parseInt(hex ?? '0', 16);
      namedColors.set(key ?? '', { r: (v >> 16) & 255, g: (v >> 8) & 255, b: v & 255, a: 1 });
    }
  }
  return namedColors.get(name);
}

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** 色相:缺省度,可带 deg / rad / grad / turn。 */
function parseHue(token: string): number | null {
  const m = /^(.*?)(deg|rad|grad|turn)?$/i.exec(token.trim());
  const body = m?.[1] ?? '';
  if (!NUMBER.test(body)) {
    return null;
  }
  const v = Number(body);
  switch ((m?.[2] ?? 'deg').toLowerCase()) {
    case 'rad':
      return (v * 180) / Math.PI;
    case 'grad':
      return v * 0.9;
    case 'turn':
      return v * 360;
    default:
      return v;
  }
}

/** 百分比(hsl 的 s、l;CSS Color 4 也允许不带 % 的数)→ 0..1。 */
function parsePercent(token: string): number | null {
  const t = token.trim();
  const body = t.endsWith('%') ? t.slice(0, -1) : t;
  if (!NUMBER.test(body)) {
    return null;
  }
  return Math.max(0, Math.min(1, Number(body) / 100));
}

function parseAlphaToken(token: string | undefined): number | null {
  if (token === undefined) {
    return 1;
  }
  const t = token.trim();
  const pct = t.endsWith('%');
  const body = pct ? t.slice(0, -1) : t;
  if (!NUMBER.test(body)) {
    return null;
  }
  return Math.max(0, Math.min(1, pct ? Number(body) / 100 : Number(body)));
}

function hslToRgba(h: number, s: number, l: number, a: number): Rgba {
  const hue = (((h % 360) + 360) % 360) / 360;
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const channel = (t0: number): number => {
    let t = t0;
    if (t < 0) {
      t += 1;
    }
    if (t > 1) {
      t -= 1;
    }
    if (t < 1 / 6) {
      return p + (q - p) * 6 * t;
    }
    if (t < 1 / 2) {
      return q;
    }
    if (t < 2 / 3) {
      return p + (q - p) * (2 / 3 - t) * 6;
    }
    return p;
  };
  return {
    r: channel(hue + 1 / 3) * 255,
    g: channel(hue) * 255,
    b: channel(hue - 1 / 3) * 255,
    a,
  };
}

function parseHsl(value: string): Rgba | null {
  const m = /^hsla?\(([^)]*)\)$/i.exec(value);
  if (!m) {
    return null;
  }
  const inner = (m[1] ?? '').trim();
  let parts: string[];
  let alpha: string | undefined;
  if (inner.includes(',')) {
    parts = inner.split(',');
    if (parts.length === 4) {
      alpha = parts.pop();
    }
  } else {
    const [channels, a] = inner.split('/');
    parts = (channels ?? '').trim().split(/\s+/);
    alpha = a;
  }
  if (parts.length !== 3) {
    return null;
  }
  const h = parseHue(parts[0] ?? '');
  const s = parsePercent(parts[1] ?? '');
  const l = parsePercent(parts[2] ?? '');
  const a = parseAlphaToken(alpha);
  if (h === null || s === null || l === null || a === null) {
    return null;
  }
  return hslToRgba(h, s, l, a);
}

/**
 * 解析颜色值(color、stop-color、fill 里的颜色部分)。
 * transparent 为全透明黑;currentColor、none、url() 不在这里处理(返回 null)。
 */
export function parseSvgColor(value: string): Rgba | null {
  const v = value.trim();
  if (!v) {
    return null;
  }
  const lower = v.toLowerCase();
  if (lower === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  const hit = named(lower);
  if (hit) {
    return hit;
  }
  if (v.startsWith('#') || /^rgba?\(/i.test(v)) {
    return parseColor(v);
  }
  if (/^hsla?\(/i.test(v)) {
    return parseHsl(v);
  }
  return null;
}

/** 解析出的颜料值(还没按继承链、不透明度落地)。 */
export type SvgPaintValue =
  | { readonly kind: 'none' }
  | { readonly kind: 'current' }
  | { readonly kind: 'color'; readonly rgba: Rgba }
  | { readonly kind: 'url'; readonly id: string; readonly fallback: SvgPaintValue | null };

/**
 * 解析 fill / stroke 的值。认不出返回 null(调用方按「没写」处理并计入 unsupported)。
 * url(#id) 只认同文件内的引用;url(other.svg#id) 当成引用不存在(走后备,没有后备就是 none)。
 */
export function parseSvgPaint(value: string): SvgPaintValue | null {
  const v = value.trim();
  const lower = v.toLowerCase();
  if (lower === 'none' || lower === 'transparent') {
    return { kind: 'none' };
  }
  if (lower === 'currentcolor') {
    return { kind: 'current' };
  }
  const url = /^url\(\s*(['"]?)([^'")]*)\1\s*\)\s*(.*)$/i.exec(v);
  if (url) {
    const ref = (url[2] ?? '').trim();
    const rest = (url[3] ?? '').trim();
    const fallback = rest ? parseSvgPaint(rest) : null;
    const id = ref.startsWith('#') ? ref.slice(1) : '';
    return { kind: 'url', id, fallback: fallback && fallback.kind !== 'url' ? fallback : null };
  }
  const rgba = parseSvgColor(v);
  return rgba ? { kind: 'color', rgba } : null;
}
