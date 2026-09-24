import { SVG_DEFAULT_SIZE, parseSvgDocument, svgIntrinsicSize } from './svgDocument';

/**
 * 从文件头读位图的原始尺寸(node 干跑用:不解码像素,只量尺寸)。
 * PNG、GIF、JPEG、WebP、BMP、AVIF/HEIF,以及 SVG(与浏览器加载器同一套尺寸规则)。
 * 与浏览器一致:JPEG 的 EXIF 方向是 5–8(手机竖拍)时宽高互换(浏览器按 from-image 摆正);
 * SVG 什么尺寸都量不出(比如只有 <text>)时按 300×150。
 */

export interface ImageSize {
  readonly width: number;
  readonly height: number;
  readonly format: string;
}

function u16be(b: Uint8Array, i: number): number {
  return ((b[i] ?? 0) << 8) | (b[i + 1] ?? 0);
}

function u16le(b: Uint8Array, i: number): number {
  return (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8);
}

function u24le(b: Uint8Array, i: number): number {
  return (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16);
}

function u32le(b: Uint8Array, i: number): number {
  return ((b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16) | ((b[i + 3] ?? 0) << 24)) >>> 0;
}

function u32be(b: Uint8Array, i: number): number {
  return (((b[i] ?? 0) << 24) >>> 0) + (((b[i + 1] ?? 0) << 16) | ((b[i + 2] ?? 0) << 8) | (b[i + 3] ?? 0));
}

function i32le(b: Uint8Array, i: number): number {
  return (b[i] ?? 0) | ((b[i + 1] ?? 0) << 8) | ((b[i + 2] ?? 0) << 16) | ((b[i + 3] ?? 0) << 24);
}

function ascii(b: Uint8Array, i: number, n: number): string {
  let s = '';
  for (let k = 0; k < n; k++) {
    s += String.fromCharCode(b[i + k] ?? 0);
  }
  return s;
}

function sized(width: number, height: number, format: string): ImageSize | null {
  return width > 0 && height > 0 && Number.isFinite(width) && Number.isFinite(height) ? { width, height, format } : null;
}

function png(b: Uint8Array): ImageSize | null {
  if (b.length < 24 || ascii(b, 12, 4) !== 'IHDR') {
    return null;
  }
  return sized(u32be(b, 16), u32be(b, 20), 'png');
}

function gif(b: Uint8Array): ImageSize | null {
  return b.length < 10 ? null : sized(u16le(b, 6), u16le(b, 8), 'gif');
}

/**
 * APP1 段里 EXIF 的方向(IFD0 的 0x0112 标签,1–8);不是 EXIF 或没写返回 1。
 * [start, end) 是段内容(长度字段之后):'Exif\0\0' + TIFF 头(字节序 II / MM、42、IFD0 偏移)+ IFD0 各 12 字节的条目。
 */
function exifOrientation(b: Uint8Array, start: number, end: number): number {
  if (end - start < 14 || ascii(b, start, 6) !== 'Exif\0\0') {
    return 1;
  }
  const tiff = start + 6;
  const order = ascii(b, tiff, 2);
  const le = order === 'II';
  if (!le && order !== 'MM') {
    return 1;
  }
  const u16 = (i: number): number => (le ? u16le(b, i) : u16be(b, i));
  if (u16(tiff + 2) !== 42) {
    return 1;
  }
  const ifd = tiff + (le ? u32le(b, tiff + 4) : u32be(b, tiff + 4));
  if (ifd + 2 > end) {
    return 1;
  }
  const count = u16(ifd);
  for (let k = 0; k < count; k++) {
    const entry = ifd + 2 + k * 12;
    if (entry + 12 > end) {
      break;
    }
    if (u16(entry) === 0x0112) {
      // SHORT 值左对齐放在值字段的前两个字节里(两种字节序都是)。
      const v = u16(entry + 8);
      return v >= 1 && v <= 8 ? v : 1;
    }
  }
  return 1;
}

/** JPEG:扫段找 SOF0–SOF15(跳过 DHT C4、JPG C8、DAC CC);路上遇到 EXIF(APP1)记下方向。 */
function jpeg(b: Uint8Array): ImageSize | null {
  let orientation = 1;
  let i = 2;
  while (i + 3 < b.length) {
    if (b[i] !== 0xff) {
      return null;
    }
    // 标记前可以有任意多个填充 0xFF。
    while (b[i + 1] === 0xff && i + 2 < b.length) {
      i += 1;
    }
    const marker = b[i + 1] ?? 0;
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) {
      return null;
    }
    const length = u16be(b, i + 2);
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      if (i + 9 > b.length) {
        return null;
      }
      const w = u16be(b, i + 7);
      const h = u16be(b, i + 5);
      // 方向 5–8 要转 90°:显示出来的宽高互换。
      return orientation >= 5 ? sized(h, w, 'jpeg') : sized(w, h, 'jpeg');
    }
    if (length < 2) {
      return null;
    }
    if (marker === 0xe1 && orientation === 1) {
      orientation = exifOrientation(b, i + 4, Math.min(b.length, i + 2 + length));
    }
    i += 2 + length;
  }
  return null;
}

function webp(b: Uint8Array): ImageSize | null {
  const chunk = ascii(b, 12, 4);
  if (chunk === 'VP8 ') {
    return b.length < 30 ? null : sized(u16le(b, 26) & 0x3fff, u16le(b, 28) & 0x3fff, 'webp');
  }
  if (chunk === 'VP8L') {
    if (b.length < 25) {
      return null;
    }
    const b0 = b[21] ?? 0;
    const b1 = b[22] ?? 0;
    const b2 = b[23] ?? 0;
    const b3 = b[24] ?? 0;
    return sized(1 + (((b1 & 0x3f) << 8) | b0), 1 + (((b3 & 0xf) << 10) | (b2 << 2) | ((b1 & 0xc0) >> 6)), 'webp');
  }
  if (chunk === 'VP8X') {
    return b.length < 30 ? null : sized(1 + u24le(b, 24), 1 + u24le(b, 27), 'webp');
  }
  return null;
}

function bmp(b: Uint8Array): ImageSize | null {
  if (b.length < 26) {
    return null;
  }
  const header = i32le(b, 14);
  if (header === 12) {
    return sized(u16le(b, 18), u16le(b, 20), 'bmp');
  }
  return sized(Math.abs(i32le(b, 18)), Math.abs(i32le(b, 22)), 'bmp');
}

/** AVIF / HEIF(ISO BMFF):找第一个 ispe(图像空间尺寸)盒。 */
function isobmff(b: Uint8Array): ImageSize | null {
  const brand = ascii(b, 8, 4);
  const format = brand.startsWith('avi') ? 'avif' : 'heif';
  const end = Math.min(b.length - 12, 1 << 16);
  for (let i = 12; i < end; i++) {
    if (b[i] === 0x69 && ascii(b, i, 4) === 'ispe') {
      return sized(u32be(b, i + 8), u32be(b, i + 12), format);
    }
  }
  return null;
}

function svg(b: Uint8Array): ImageSize | null {
  let text: string;
  try {
    text = new TextDecoder('utf-8').decode(b);
  } catch {
    return null;
  }
  if (!text.replace(/^\uFEFF/, '').trimStart().startsWith('<')) {
    return null;
  }
  try {
    const size = svgIntrinsicSize(parseSvgDocument(text)) ?? SVG_DEFAULT_SIZE;
    return sized(size.width, size.height, 'svg');
  } catch {
    return null;
  }
}

/** 从文件头读原始尺寸;认不出格式(或文件头残缺)返回 null。 */
export function imageSizeFromBytes(bytes: Uint8Array): ImageSize | null {
  const b = bytes;
  if (b.length >= 8 && b[0] === 0x89 && ascii(b, 1, 3) === 'PNG') {
    return png(b);
  }
  if (b.length >= 6 && (ascii(b, 0, 6) === 'GIF87a' || ascii(b, 0, 6) === 'GIF89a')) {
    return gif(b);
  }
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) {
    return jpeg(b);
  }
  if (b.length >= 12 && ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WEBP') {
    return webp(b);
  }
  if (b.length >= 2 && b[0] === 0x42 && b[1] === 0x4d) {
    return bmp(b);
  }
  if (b.length >= 12 && ascii(b, 4, 4) === 'ftyp') {
    return isobmff(b);
  }
  return svg(b);
}
