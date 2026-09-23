/**
 * 颜色工具:解析(#rgb/#rgba/#rrggbb/#rrggbbaa、rgb()/rgba();命名色与 hsl() 在浏览器里
 * 交给画布规范化)、格式化,以及在 OKLab 里插值 —— 感知均匀,红变绿不会经过一段发灰的泥色。
 */

/** r/g/b 为 0..255,a 为 0..1。 */
export interface Rgba {
  readonly r: number;
  readonly g: number;
  readonly b: number;
  readonly a: number;
}

const HEX_COLOR = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
const RGB_FUNCTION = /^rgba?\(([^)]*)\)$/i;
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i;

/** 颜色通道:数字(0..255)或百分比。 */
function parseChannel(token: string): number | null {
  const pct = token.endsWith('%');
  const body = pct ? token.slice(0, -1) : token;
  if (!NUMBER.test(body)) {
    return null;
  }
  const v = pct ? (Number(body) / 100) * 255 : Number(body);
  return Math.max(0, Math.min(255, v));
}

/** alpha:数字(0..1)或百分比。 */
function parseAlpha(token: string): number | null {
  const pct = token.endsWith('%');
  const body = pct ? token.slice(0, -1) : token;
  if (!NUMBER.test(body)) {
    return null;
  }
  const v = pct ? Number(body) / 100 : Number(body);
  return Math.max(0, Math.min(1, v));
}

/** 解析颜色字面量(hex 与 rgb()/rgba(),逗号或空格分隔、可带 / alpha、可用百分比)。 */
function parseLiteral(color: string): Rgba | null {
  const s = color.trim();
  const hex = s.match(HEX_COLOR);
  if (hex) {
    const raw = hex[1] ?? '';
    const full =
      raw.length <= 4
        ? raw
            .split('')
            .map((c) => c + c)
            .join('')
        : raw;
    const byte = (i: number): number => parseInt(full.slice(i, i + 2), 16);
    return {
      r: byte(0),
      g: byte(2),
      b: byte(4),
      a: full.length === 8 ? byte(6) / 255 : 1,
    };
  }
  const fn = s.match(RGB_FUNCTION);
  if (!fn) {
    return null;
  }
  const inner = (fn[1] ?? '').trim();
  let parts: string[];
  let alphaToken: string | undefined;
  if (inner.includes(',')) {
    parts = inner.split(',').map((t) => t.trim());
    if (parts.length === 4) {
      alphaToken = parts.pop();
    }
  } else {
    const [channels, alpha] = inner.split('/');
    parts = (channels ?? '').trim().split(/\s+/);
    alphaToken = alpha?.trim();
  }
  if (parts.length !== 3) {
    return null;
  }
  const r = parseChannel(parts[0] ?? '');
  const g = parseChannel(parts[1] ?? '');
  const b = parseChannel(parts[2] ?? '');
  const a = alphaToken === undefined ? 1 : parseAlpha(alphaToken);
  if (r === null || g === null || b === null || a === null) {
    return null;
  }
  return { r, g, b, a };
}

let colorProbe: CanvasRenderingContext2D | null = null;
/** 探针所属的 document:换了 document(测试桩装卸、iframe)就重建,不沿用别处的画布。 */
let colorProbeDoc: Document | null = null;

/** 命名色、hsl() 等交给浏览器规范化:canvas 的 fillStyle 读回来一定是 #rrggbb 或 rgba()。 */
function resolveViaCanvas(color: string): Rgba | null {
  if (typeof document === 'undefined') {
    return null;
  }
  if (colorProbeDoc !== document) {
    colorProbeDoc = document;
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    colorProbe = canvas.getContext('2d');
  }
  if (!colorProbe) {
    return null;
  }
  // 非法颜色的赋值会被静默忽略:用两个不同的哨兵各赋一次,读回不一致就说明没解析成功。
  colorProbe.fillStyle = '#000000';
  colorProbe.fillStyle = color;
  const first = String(colorProbe.fillStyle);
  colorProbe.fillStyle = '#ffffff';
  colorProbe.fillStyle = color;
  const second = String(colorProbe.fillStyle);
  return first === second ? parseLiteral(first) : null;
}

const CACHE_LIMIT = 256;
const cache = new Map<string, Rgba>();
/**
 * 解析失败的颜色。按 document 分开记:命名色在 node 里解析不了,
 * 换到带 document 的环境(测试桩装上)就能解析,不能一直记成失败。
 */
const failed = new Set<string>();
let failedDoc: Document | null | undefined;

/** 解析颜色(结果缓存)。解析不了(node 里的命名色、非法值)返回 null。 */
export function parseColor(color: string): Rgba | null {
  const hit = cache.get(color);
  if (hit) {
    return hit;
  }
  const doc = typeof document === 'undefined' ? null : document;
  if (failedDoc !== doc) {
    failedDoc = doc;
    failed.clear();
  }
  if (failed.has(color)) {
    return null;
  }
  const rgba = parseLiteral(color) ?? resolveViaCanvas(color);
  if (!rgba) {
    if (failed.size >= CACHE_LIMIT) {
      failed.clear();
    }
    failed.add(color);
    return null;
  }
  if (cache.size >= CACHE_LIMIT) {
    cache.clear();
  }
  cache.set(color, rgba);
  return rgba;
}

/** 格式化成 rgb(r, g, b) / rgba(r, g, b, a)(通道取整,alpha 保留三位小数)。 */
export function formatColor(c: Rgba): string {
  const r = Math.round(Math.max(0, Math.min(255, c.r)));
  const g = Math.round(Math.max(0, Math.min(255, c.g)));
  const b = Math.round(Math.max(0, Math.min(255, c.b)));
  const a = Math.max(0, Math.min(1, c.a));
  return a >= 1 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${Math.round(a * 1000) / 1000})`;
}

function toLinear(c: number): number {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function fromLinear(v: number): number {
  const c = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.max(0, v) ** (1 / 2.4) - 0.055;
  return c * 255;
}

type Lab = [number, number, number];

function toOklab(c: Rgba): Lab {
  const r = toLinear(c.r);
  const g = toLinear(c.g);
  const b = toLinear(c.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function fromOklab([L, A, B]: Lab, a: number): Rgba {
  const l = (L + 0.3963377774 * A + 0.2158037573 * B) ** 3;
  const m = (L - 0.1055613458 * A - 0.0638541728 * B) ** 3;
  const s = (L - 0.0894841775 * A - 1.291485548 * B) ** 3;
  return {
    r: fromLinear(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: fromLinear(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: fromLinear(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
    a,
  };
}

/**
 * 两个颜色之间插值(OKLab 里插颜色、线性插 alpha)。t≤0 精确返回 a、t≥1 精确返回 b。
 * null 表示「不画」:与颜色之间按同色透明度渐变(淡入淡出),两边都是 null 返回 null。
 * 解析不了的颜色没法插值,在中点处直接切换。
 */
export function lerpColor(a: string | null, b: string | null, t: number): string | null {
  if (t <= 0) {
    return a;
  }
  if (t >= 1) {
    return b;
  }
  if (a === null && b === null) {
    return null;
  }
  const ca = a === null ? null : parseColor(a);
  const cb = b === null ? null : parseColor(b);
  if ((a !== null && !ca) || (b !== null && !cb)) {
    return t < 0.5 ? a : b;
  }
  const from = ca ?? (cb ? { ...cb, a: 0 } : null);
  const to = cb ?? (ca ? { ...ca, a: 0 } : null);
  if (!from || !to) {
    return t < 0.5 ? a : b;
  }
  const la = toOklab(from);
  const lb = toOklab(to);
  const lab: Lab = [
    la[0] + (lb[0] - la[0]) * t,
    la[1] + (lb[1] - la[1]) * t,
    la[2] + (lb[2] - la[2]) * t,
  ];
  return formatColor(fromOklab(lab, from.a + (to.a - from.a) * t));
}

/** 颜色的 alpha(0..1);解析不了按不透明算。 */
export function colorAlpha(color: string): number {
  return parseColor(color)?.a ?? 1;
}

/** 按 alpha 系数把颜色调淡(系数 1 原样返回)。解析不了的颜色原样返回。 */
export function fadeColor(color: string, factor: number): string {
  if (factor >= 1) {
    return color;
  }
  const c = parseColor(color);
  return c ? formatColor({ ...c, a: c.a * Math.max(0, factor) }) : color;
}

/** 相对亮度(0..1,WCAG 的定义)。 */
function luminance(c: Rgba): number {
  return 0.2126 * toLinear(c.r) + 0.7152 * toLinear(c.g) + 0.0722 * toLinear(c.b);
}

/** 亮底上的强调色(橙)与暗底上的(琥珀黄)。 */
const HIGHLIGHT_ON_LIGHT = '#ea580c';
const HIGHLIGHT_ON_DARK = '#fbbf24';

/**
 * 按背景明暗挑的强调色:强调动画(Indicate、Circumscribe、Flash)没指定颜色时用。
 * 亮底用橙、暗底用琥珀黄 —— Manim 那种纯黄放在浅色背景上几乎看不见。解析不了的背景按亮底。
 */
export function highlightColor(background: string): string {
  const c = parseColor(background);
  return c && luminance(c) < 0.18 ? HIGHLIGHT_ON_DARK : HIGHLIGHT_ON_LIGHT;
}
