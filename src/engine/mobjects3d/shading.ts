import type { Rgba } from '../color';
import { parseColor as parseColorValue } from '../color';

/**
 * 3D 面片明暗:颜色解析(engine/color,结果缓存)与按亮度分级的色表。
 * 每帧上千个面只查表,不再逐面跑正则、拼 rgb() 字符串。
 */
const warnedColors = new Set<string>();

/** 解析填充色;解析不了的告警一次(立体面片将不做明暗)。 */
function parseColor(color: string): Rgba | null {
  const rgba = parseColorValue(color);
  if (!rgba && !warnedColors.has(color)) {
    warnedColors.add(color);
    console.warn(`[Mesh3D] 无法解析填充色「${color}」,立体面片将不做明暗`);
  }
  return rgba;
}

function formatShade(c: Rgba, intensity: number): string {
  const t = Math.max(0, Math.min(1, intensity));
  const r = Math.round(c.r * t);
  const g = Math.round(c.g * t);
  const b = Math.round(c.b * t);
  return c.a >= 1
    ? `rgb(${r}, ${g}, ${b})`
    : `rgba(${r}, ${g}, ${b}, ${Math.round(c.a * 1000) / 1000})`;
}

/** 按 intensity(0..1) 缩放颜色明暗,保持 alpha 不变。解析失败时原样返回。 */
export function shadeColor(color: string, intensity: number): string {
  const rgba = parseColor(color);
  return rgba ? formatShade(rgba, intensity) : color;
}

/** 颜色的 alpha(0..1);解析不了按不透明算。 */
export function colorAlpha(color: string): number {
  return parseColor(color)?.a ?? 1;
}

/** 明暗色表的级数:每帧上千个面只查表,不再逐面解析颜色、拼字符串。 */
export const SHADE_LEVELS = 64;
const SHADE_TABLE_LIMIT = 16;
const shadeTables = new Map<string, readonly string[] | null>();

export function shadeTableFor(color: string): readonly string[] | null {
  const hit = shadeTables.get(color);
  if (hit !== undefined) {
    shadeTables.delete(color);
    shadeTables.set(color, hit);
    return hit;
  }
  const rgba = parseColor(color);
  const table = rgba
    ? Array.from({ length: SHADE_LEVELS + 1 }, (_, i) => formatShade(rgba, i / SHADE_LEVELS))
    : null;
  shadeTables.set(color, table);
  while (shadeTables.size > SHADE_TABLE_LIMIT) {
    const oldest = shadeTables.keys().next();
    if (oldest.done) {
      break;
    }
    shadeTables.delete(oldest.value);
  }
  return table;
}

/** 固定光源:左上前方(单位向量)。 */
export const LIGHT = (() => {
  const x = -0.35;
  const y = -0.55;
  const z = 0.75;
  const len = Math.hypot(x, y, z);
  return { x: x / len, y: y / len, z: z / len };
})();
