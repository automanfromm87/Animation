import type { MainRect } from './output';

export type { MainRect } from './output';

/**
 * 字幕的视觉样式(css 像素度量)。
 * 播放器解析一次,直播的 DOM 字幕条与导出合成共用同一份 —— 两边各写一套常量,
 * 成片里的字幕迟早会和预览不一样(颜色、行高、内边距各漂各的)。
 */
export interface SubtitleVisual {
  fontPx: number;
  fontFamily: string;
  color: string;
  background: string;
  padX: number;
  padY: number;
  radius: number;
  /** 行高倍数(DOM 端也显式设这个值,而不是 normal)。 */
  lineHeight: number;
  /** 字幕块底边到画面底边的距离。 */
  bottomPx: number;
  /** 文字区最大宽度占画面宽度的比例。 */
  maxWidthRatio: number;
}

/** 导出合成用的字幕。 */
export interface ExportSubtitle {
  text: string;
  visual: SubtitleVisual;
}

export interface CompositeFrame {
  /** 直播主画布(整帧拷贝,公式已画在里面)。 */
  main: HTMLCanvasElement;
  /** 主画面在导出帧里的位置与尺寸(contain 适配)。 */
  mainRect: MainRect;
  /** css 像素 -> 导出像素的比例(= mainRect.w / 主画布的 css 宽)。 */
  scale: number;
  /** 转场白闪不透明度(0~1)。 */
  veilAlpha: number;
  veilColor: string;
  subtitle: ExportSubtitle | null;
}

/** 不能出现在行首的字符(避头):收尾标点、后缀符号。它们跟前一个字粘在一起走。 */
const NO_LINE_START = /^[，。！？、；：,.!?;:)\]}）」』》〉】〕”’…‥%‰℃]/u;
/** 不能出现在行尾的字符(避尾):开头标点。它们跟后一个字粘在一起走。 */
const NO_LINE_END = /[（「『《〈【〔“‘([{]$/u;
/** 中日韩文字:浏览器在这些字的前后都能断行,不按词。 */
const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;
const SPACE = /\s/u;
const LETTER = /\p{L}/u;

/**
 * a、b 两个相邻字符之间能不能断行,按浏览器的口径(UAX #14 的常用子集):
 * 空白之后能断(之前不能);中日韩文字前后能断;连字符之后、字母之前能断(之前不能);
 * 避头/避尾标点跟相邻的字粘住。拉丁词、希腊字母、数字、紧挨着的标点之间都不断 ——
 * 分词器会在 f′(ξ) 这种串的内部切出好几段,浏览器并不在那里断行。
 */
function canBreakBetween(a: string, b: string): boolean {
  if (SPACE.test(b) || NO_LINE_START.test(b) || NO_LINE_END.test(a) || b === '-') {
    return false;
  }
  if (SPACE.test(a) || CJK.test(a) || CJK.test(b)) {
    return true;
  }
  return a === '-' && LETTER.test(b);
}

/** 按可断点切成片段:片段内部不断行,尾随空白留在片段末尾(排版时被行尾修剪掉)。 */
function breakUnits(text: string): string[] {
  const chars = Array.from(text);
  const units: string[] = [];
  let unit = '';
  chars.forEach((ch, i) => {
    unit += ch;
    const next = chars[i + 1];
    if (next !== undefined && canBreakBetween(ch, next)) {
      units.push(unit);
      unit = '';
    }
  });
  if (unit !== '') {
    units.push(unit);
  }
  return units;
}

const wrapCache = new Map<string, string[]>();
const WRAP_CACHE_LIMIT = 64;

/**
 * 字幕换行(maxWidth 为导出像素),断点与浏览器一致:拉丁词整体换行、CJK 逐字换行,
 * 收尾标点连同前一个字一起换到下一行(不挂在行尾超宽),开头标点连同后一个字一起走;
 * 单个片段本身超宽时按字符硬断(对应字幕条的 overflow-wrap:anywhere)。
 * 同一条字幕会连续几百帧反复合成,结果按「字体 + 宽度 + 文本」缓存,不必每帧 O(n²) 地 measureText。
 */
export function wrapSubtitle(
  text: string,
  ctx: CanvasRenderingContext2D,
  maxWidth: number,
): string[] {
  const key = `${ctx.font}|${Math.round(maxWidth)}|${text}`;
  const hit = wrapCache.get(key);
  if (hit) {
    return hit;
  }
  const fits = (s: string): boolean =>
    !(maxWidth > 0) || ctx.measureText(s.trimEnd()).width <= maxWidth;
  const lines: string[] = [];
  let line = '';
  const pushHard = (unit: string): void => {
    // 单个片段比一整行还宽:逐字符塞,满了就断。
    for (const ch of unit) {
      if (line !== '' && !fits(line + ch)) {
        lines.push(line.trimEnd());
        line = ch.trimStart();
      } else {
        line += ch;
      }
    }
  };
  for (const unit of breakUnits(text)) {
    if (line === '' || fits(line + unit)) {
      if (line === '' && !fits(unit)) {
        pushHard(unit);
      } else {
        line += unit;
      }
      continue;
    }
    lines.push(line.trimEnd());
    line = '';
    const rest = unit.trimStart();
    if (fits(rest)) {
      line = rest;
    } else {
      pushHard(rest);
    }
  }
  if (line.trim() !== '') {
    lines.push(line.trimEnd());
  }
  if (wrapCache.size >= WRAP_CACHE_LIMIT) {
    const oldest = wrapCache.keys().next();
    if (!oldest.done) {
      wrapCache.delete(oldest.value);
    }
  }
  wrapCache.set(key, lines);
  return lines;
}

function fillRoundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  // roundRect 半径为负会抛 RangeError,而这是导出合成的每帧热路径:
  // 抛一次就会打断整条合成链。夹紧到 [0, 短边一半] 再画。
  const radius = Math.max(0, Math.min(r, Math.min(Math.abs(w), Math.abs(h)) / 2));
  if (!Number.isFinite(radius)) {
    return;
  }
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, radius);
  ctx.fill();
}

function drawSubtitle(
  ctx: CanvasRenderingContext2D,
  rect: MainRect,
  scale: number,
  sub: ExportSubtitle,
): void {
  const v = sub.visual;
  const fontPx = v.fontPx * scale;
  ctx.save();
  ctx.font = `${fontPx}px ${v.fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const maxWidth = rect.w * v.maxWidthRatio;
  const lines = wrapSubtitle(sub.text, ctx, maxWidth);
  if (lines.length > 0) {
    const padX = v.padX * scale;
    const padY = v.padY * scale;
    const lineH = fontPx * v.lineHeight;
    let widest = 0;
    for (const line of lines) {
      widest = Math.max(widest, ctx.measureText(line).width);
    }
    // 与 DOM 字幕条(width:fit-content + max-width)同一套盒宽:
    // 折了行的块撑满最大宽度,单行块收缩到文字宽。
    const textW = lines.length > 1 ? Math.max(widest, maxWidth) : widest;
    const w = textW + padX * 2;
    const h = lineH * lines.length + padY * 2;
    const x = rect.x + (rect.w - w) / 2;
    const y = rect.y + rect.h - v.bottomPx * scale - h;
    ctx.fillStyle = v.background;
    fillRoundRect(ctx, x, y, w, h, v.radius * scale);
    ctx.fillStyle = v.color;
    lines.forEach((l, i) => {
      ctx.fillText(l, rect.x + rect.w / 2, y + padY + lineH * (i + 0.5));
    });
  }
  ctx.restore();
}

/**
 * 合成一帧:底色 -> 主画面(contain,公式已在画布内) -> 转场白闪 -> 字幕。
 * 与直播层叠顺序一致;进度条不进成片。
 */
export function compositeFrame(
  ctx: CanvasRenderingContext2D,
  EW: number,
  EH: number,
  frame: CompositeFrame,
): void {
  const { mainRect: rect, scale } = frame;
  ctx.save();
  ctx.globalAlpha = 1;
  // 画幅变化时的黑边用转场色填,不留上一帧残影。
  ctx.fillStyle = frame.veilColor;
  ctx.fillRect(0, 0, EW, EH);
  // 高清屏的主画布往往是导出尺寸的 2~3 倍,默认的低质量缩小会让细线闪烁起毛。
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  // 0 尺寸的源画布喂给 drawImage 会抛 InvalidStateError。主画布理论上恒 >= 1
  // (CanvasRenderer.setPixelSize 夹过),但这条链一断整次导出就废了,值得再挡一次。
  if (frame.main.width > 0 && frame.main.height > 0) {
    ctx.drawImage(frame.main, rect.x, rect.y, rect.w, rect.h);
  }
  ctx.restore();
  if (frame.veilAlpha > 0) {
    ctx.save();
    ctx.globalAlpha = Math.min(1, frame.veilAlpha);
    ctx.fillStyle = frame.veilColor;
    ctx.fillRect(0, 0, EW, EH);
    ctx.restore();
  }
  if (frame.subtitle) {
    drawSubtitle(ctx, rect, scale, frame.subtitle);
  }
}
