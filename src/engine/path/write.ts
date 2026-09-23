import { lerpColor } from '../color';
import type { PathLayer } from './draw';
import { partialPath } from './measure';

/**
 * 逐字书写(Write)与公式描边生长共用的节奏:每一片先按弧长描出轮廓、再淡入填充
 * (DrawBorderThenFill),片与片之间错峰。
 */

/** 缺省错峰:片越多挨得越紧,最多错开每片时长的 20%(与 Manim 的 Write 一致)。 */
export function defaultLagRatio(count: number): number {
  return Math.min(4 / Math.max(1, count), 0.2);
}

/**
 * 第 index 片(共 count 片)在总进度 alpha 时的自身进度(0..1)。
 * 每片时长相同,相邻两片的起点错开 lagRatio 个片长,最后一片恰好在 alpha=1 时写完。
 */
export function staggered(alpha: number, index: number, count: number, lagRatio: number): number {
  if (alpha >= 1) {
    return 1;
  }
  const lag = Number.isFinite(lagRatio) && lagRatio > 0 ? lagRatio : 0;
  const span = 1 / (1 + Math.max(0, count - 1) * lag);
  const u = (alpha - index * lag * span) / span;
  return u > 0 ? Math.min(1, u) : 0;
}

/**
 * 一片在自身进度 u 时该画成的样子:u<=0 什么都不画(null),u>=1 就是这一层本身(终态精确)。
 * - 只描边的层:全程按弧长生长;
 * - 有填充的层:前半程按弧长描轮廓(有描边就用描边,没有就用填充色、outlineWidth 线宽),
 *   后半程填充淡入、临时轮廓淡出(本来就有的描边保持不变)。
 * fallbackWidth 是层没给 outlineWidth 时的轮廓线宽。
 */
export function writeStep(layer: PathLayer, u: number, fallbackWidth: number): PathLayer | null {
  if (!(u > 0)) {
    return null;
  }
  if (u >= 1) {
    return layer;
  }
  const { path, paint } = layer;
  const stroked = paint.stroke !== null && paint.strokeWidth > 0;
  if (paint.fill === null) {
    return stroked ? { path: partialPath(path, 0, u), paint } : null;
  }
  const outline = stroked ? paint.stroke : paint.fill;
  const width = stroked ? paint.strokeWidth : (layer.outlineWidth ?? fallbackWidth);
  if (u < 0.5) {
    return {
      path: partialPath(path, 0, u * 2),
      paint: { fill: null, stroke: outline, strokeWidth: width, dash: paint.dash },
    };
  }
  const k = u * 2 - 1;
  return {
    path,
    paint: {
      fill: lerpColor(null, paint.fill, k),
      stroke: stroked ? paint.stroke : lerpColor(outline, null, k),
      strokeWidth: width,
      dash: paint.dash,
    },
  };
}
