/** Theme: 控制最终渲染效果的唯一来源。Renderer 用它刷背景、解样式。 */

export interface Theme {
  readonly name: string;
  // 画布样式:背景 + 网格 + 坐标轴,由 Renderer 直接消费。
  readonly background: string;
  readonly showGrid: boolean;
  readonly gridColor: string;
  readonly gridSpacing: number;
  readonly showAxes: boolean;
  readonly axesColor: string;
  // MObject 默认样式:与自身覆盖合并后使用。fill 为 null 表示默认不填充。
  readonly stroke: string;
  readonly fill: string | null;
  readonly strokeWidth: number;
  /** 全局不透明度系数,乘在每个叶子对象上。 */
  readonly opacity: number;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly textColor: string;
}

/**
 * MObject 上的局部样式覆盖,优先级高于 Theme。fill 可设为 null 表示不填充。
 *
 * 刻意不含 opacity:不透明度只有 MObject.opacity 一条通道(FadeIn/FadeOut 驱动的就是它),
 * 主题 opacity 作为全局系数乘在叶子上。两条通道并存时,
 * setStyle({ opacity: 0 }) 藏起来的对象 FadeIn 永远抬不起来。
 */
export interface StyleOverride {
  stroke?: string;
  fill?: string | null;
  strokeWidth?: number;
  fontFamily?: string;
  fontSize?: number;
  textColor?: string;
  /** 描边虚线:交替的线段/间隔长度(本地单位),空数组为实线。 */
  dash?: readonly number[];
}

/** 解析后的完整样式,Renderer 只认这个。 */
export interface ResolvedStyle {
  stroke: string;
  fill: string | null;
  strokeWidth: number;
  /** 主题不透明度 × 对象自身 opacity(不含父容器累积,那部分已在 globalAlpha 里)。 */
  opacity: number;
  fontFamily: string;
  fontSize: number;
  textColor: string;
  dash: readonly number[];
}

/** 全部可覆盖的样式键(遍历/合并用)。 */
export const STYLE_KEYS = [
  'stroke',
  'fill',
  'strokeWidth',
  'fontFamily',
  'fontSize',
  'textColor',
  'dash',
] as const satisfies ReadonlyArray<keyof StyleOverride>;

export type StyleKey = (typeof STYLE_KEYS)[number];

const SOLID: readonly number[] = Object.freeze([]);

/** 第一个不是 undefined 的值。fill 允许显式 null,所以不能用 ??。 */
function pick<T>(own: T | undefined, inherited: T | undefined, fallback: T | undefined, theme: T): T {
  if (own !== undefined) {
    return own;
  }
  if (inherited !== undefined) {
    return inherited;
  }
  return fallback !== undefined ? fallback : theme;
}

/**
 * 合并规则:自身 setStyle > 容器链继承 > 子类构造期默认值 > Theme。
 * 写进调用方提供的 out:渲染热路径复用同一个缓冲,避免每帧每对象的样式分配。
 */
export function resolveStyleInto(
  theme: Theme,
  out: ResolvedStyle,
  own?: Readonly<StyleOverride>,
  inherited?: Readonly<StyleOverride>,
  defaults?: Readonly<StyleOverride>,
): ResolvedStyle {
  out.stroke = pick(own?.stroke, inherited?.stroke, defaults?.stroke, theme.stroke);
  out.fill = pick(own?.fill, inherited?.fill, defaults?.fill, theme.fill);
  out.strokeWidth = pick(
    own?.strokeWidth,
    inherited?.strokeWidth,
    defaults?.strokeWidth,
    theme.strokeWidth,
  );
  out.opacity = theme.opacity;
  out.fontFamily = pick(own?.fontFamily, inherited?.fontFamily, defaults?.fontFamily, theme.fontFamily);
  out.fontSize = pick(own?.fontSize, inherited?.fontSize, defaults?.fontSize, theme.fontSize);
  out.textColor = pick(own?.textColor, inherited?.textColor, defaults?.textColor, theme.textColor);
  out.dash = pick(own?.dash, inherited?.dash, defaults?.dash, SOLID);
  return out;
}

/** 同 resolveStyleInto,但返回新对象。 */
export function resolveStyle(
  theme: Theme,
  override?: Readonly<StyleOverride>,
): ResolvedStyle {
  return resolveStyleInto(
    theme,
    {
      stroke: theme.stroke,
      fill: theme.fill,
      strokeWidth: theme.strokeWidth,
      opacity: theme.opacity,
      fontFamily: theme.fontFamily,
      fontSize: theme.fontSize,
      textColor: theme.textColor,
      dash: SOLID,
    },
    override,
  );
}

/** 把 source 里有值的键写进 target(undefined 忽略),返回是否写入了任何键。 */
export function assignStyle(target: StyleOverride, source: Readonly<StyleOverride>): boolean {
  let changed = false;
  const out = target as Record<StyleKey, unknown>;
  for (const key of STYLE_KEYS) {
    const value = source[key];
    if (value !== undefined) {
      out[key] = key === 'dash' ? Object.freeze([...(value as readonly number[])]) : value;
      changed = true;
    }
  }
  return changed;
}
