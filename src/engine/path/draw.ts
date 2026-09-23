import { partialPath } from './measure';
import type { PathData } from './path';
import { isEmptyPath } from './path';

/** 画一条路径用的颜料。stroke 为 null 或线宽不是正数时不描边,fill 为 null 时不填充。 */
export interface PathPaint {
  fill: string | null;
  stroke: string | null;
  strokeWidth: number;
  dash?: readonly number[];
}

/** 一层矢量几何:路径 + 画它的颜料。形状变形、逐字书写按层插值与绘制。 */
export interface PathLayer {
  readonly path: PathData;
  readonly paint: PathPaint;
  /**
   * 逐字书写时临时轮廓的线宽:只有填充、没有描边的层(字形、圆点)先描一圈轮廓再填充,
   * 缺省按对象样式的线宽。公式按字号给一个细得多的值。
   */
  readonly outlineWidth?: number;
}

/** 在 ctx 上描出路径的几何(beginPath + moveTo / bezierCurveTo / closePath),不填不描。 */
export function tracePath(ctx: CanvasRenderingContext2D, path: PathData): void {
  ctx.beginPath();
  for (const sub of path.subpaths) {
    const p = sub.points;
    if (p.length < 8) {
      continue;
    }
    ctx.moveTo(p[0] ?? 0, p[1] ?? 0);
    for (let i = 2; i + 5 < p.length; i += 6) {
      ctx.bezierCurveTo(
        p[i] ?? 0,
        p[i + 1] ?? 0,
        p[i + 2] ?? 0,
        p[i + 3] ?? 0,
        p[i + 4] ?? 0,
        p[i + 5] ?? 0,
      );
    }
    if (sub.closed) {
      ctx.closePath();
    }
  }
}

/** 静态路径(公式字形、不变的图形)的 Path2D 按对象身份缓存:每帧直接 fill/stroke,不再逐段描。 */
const path2dCache = new WeakMap<PathData, Path2D>();

function toPath2D(path: PathData): Path2D | null {
  if (typeof Path2D === 'undefined') {
    return null;
  }
  const hit = path2dCache.get(path);
  if (hit) {
    return hit;
  }
  const p2d = new Path2D();
  for (const sub of path.subpaths) {
    const p = sub.points;
    if (p.length < 8) {
      continue;
    }
    p2d.moveTo(p[0] ?? 0, p[1] ?? 0);
    for (let i = 2; i + 5 < p.length; i += 6) {
      p2d.bezierCurveTo(
        p[i] ?? 0,
        p[i + 1] ?? 0,
        p[i + 2] ?? 0,
        p[i + 3] ?? 0,
        p[i + 4] ?? 0,
        p[i + 5] ?? 0,
      );
    }
    if (sub.closed) {
      p2d.closePath();
    }
  }
  path2dCache.set(path, p2d);
  return p2d;
}

/**
 * 画一条路径:先填充、再描边(描边压在填充上,与各图元的传统画法一致)。
 * reveal 为 0..1 时只画按弧长的前一截(描边生长),截断时填充也按这一截(canvas 隐式闭合);
 * null 表示完整。ctx 状态(虚线)由调用方的 save/restore 兜住。
 */
export function drawPath(
  ctx: CanvasRenderingContext2D,
  path: PathData,
  paint: PathPaint,
  reveal: number | null = null,
): void {
  const stroke = paint.stroke !== null && paint.strokeWidth > 0;
  // 既不填也不描(比如线宽为 0 的线):连路径都不描,也不截取。
  if (paint.fill === null && !stroke) {
    return;
  }
  const p = reveal === null ? path : partialPath(path, 0, reveal);
  if (isEmptyPath(p)) {
    return;
  }
  const p2d = toPath2D(p);
  if (!p2d) {
    tracePath(ctx, p);
  }
  if (paint.fill !== null) {
    ctx.fillStyle = paint.fill;
    if (p2d) {
      ctx.fill(p2d);
    } else {
      ctx.fill();
    }
  }
  if (stroke) {
    ctx.strokeStyle = paint.stroke ?? '#000';
    ctx.lineWidth = paint.strokeWidth;
    if (paint.dash && paint.dash.length > 0) {
      ctx.setLineDash(paint.dash as number[]);
    }
    if (p2d) {
      ctx.stroke(p2d);
    } else {
      ctx.stroke();
    }
  }
}
