import { colorAlpha, fadeColor, lerpColor } from '../color';
import { Group } from '../mobjects/Group';
import type { MObject } from '../mobjects/MObject';
import { NO_STYLE } from '../mobjects/MObject';
import { lerp } from '../mobjects/types';
import type { ResolvedStyle, StyleOverride } from '../theme/Theme';
import { lightTheme } from '../theme/presets';
import type { AnimationOptions, PlayContext } from './Animation';
import { Animation } from './Animation';

/** ColorTo 的目标样式。没写的键保持不变。 */
export interface ColorTarget {
  /**
   * 简写:描边、文字色都变成它;原本有填充的叶子,填充也变成它,
   * 原本不填充的仍不填充 —— 给整组换色时,线条、坐标轴不会突然被填满。
   * 描边与填充各自保留原来的透明度(半透明的网格线、SVG 插画里半透明的阴影换色后仍是半透明)。
   * 与下面的具体键同时给时,具体键优先。
   */
  color?: string;
  stroke?: string;
  /** null 表示淡出到不填充。 */
  fill?: string | null;
  textColor?: string;
  /** 线宽,非负有限数。 */
  strokeWidth?: number;
}

/** 一个叶子要补间的样式:from 是开始时画出来的样子,to 是终态(只含要改的键)。 */
interface Track {
  readonly leaf: MObject;
  readonly from: ResolvedStyle;
  readonly to: StyleOverride;
}

/** 对象树里的叶子与它们在所在位置解析出的样式(按绘制顺序)。空 Group 不算叶子。 */
function leavesOf(root: MObject, context: PlayContext | undefined): Array<[MObject, ResolvedStyle]> {
  const out: Array<[MObject, ResolvedStyle]> = [];
  const visiting = new Set<MObject>();
  const visit = (node: MObject, inherited: Readonly<StyleOverride>): void => {
    const children = node.getChildren();
    if (children.length > 0 || node instanceof Group) {
      if (visiting.has(node)) {
        return;
      }
      visiting.add(node);
      const childInherited = node.childInheritedStyle(inherited);
      for (const child of children) {
        visit(child, childInherited);
      }
      visiting.delete(node);
      return;
    }
    out.push([node, context ? context.styleOf(node) : node.getStyle(lightTheme, inherited)]);
  };
  // 单独调用(没有场景信息)时从 root 起按脱离容器解析;有场景信息时各叶子按所在位置解析。
  visit(root, NO_STYLE);
  return out;
}

/** 按叶子当前的样式算出它的终态(只含要改的键)。 */
function targetFor(target: Readonly<ColorTarget>, from: ResolvedStyle): StyleOverride {
  const to: StyleOverride = {};
  if (target.stroke !== undefined) {
    to.stroke = target.stroke;
  } else if (target.color !== undefined) {
    to.stroke = fadeColor(target.color, colorAlpha(from.stroke));
  }
  const text = target.textColor ?? target.color;
  if (text !== undefined) {
    to.textColor = text;
  }
  if (target.fill !== undefined) {
    to.fill = target.fill;
  } else if (target.color !== undefined && from.fill !== null) {
    to.fill = fadeColor(target.color, colorAlpha(from.fill));
  }
  if (target.strokeWidth !== undefined) {
    to.strokeWidth = target.strokeWidth;
  }
  return to;
}

/**
 * ColorTo:把对象的颜色、线宽补间到目标(颜色在 OKLab 里插值,感知均匀;null 填充按透明度淡入淡出)。
 * 终态等于对每个叶子 setStyle(目标):容器对其中每个叶子生效,各叶子从自己当前画出来的样子出发
 * (主题、容器继承、构造默认都算上),不会在开始的一帧跳色。
 * 用法:new ColorTo(term, '#e11d48')、new ColorTo(curve, { stroke: '#2563eb', strokeWidth: 6 })。
 */
export class ColorTo extends Animation {
  private readonly target: Readonly<ColorTarget>;
  private tracks: Track[] = [];

  constructor(mobject: MObject, target: string | ColorTarget, options?: AnimationOptions) {
    super(mobject, options);
    const t: ColorTarget = typeof target === 'string' ? { color: target } : { ...target };
    const width = t.strokeWidth;
    if (width !== undefined && !(Number.isFinite(width) && width >= 0)) {
      throw new RangeError(`ColorTo:strokeWidth 需要非负有限数,收到 ${width}`);
    }
    this.target = t;
  }

  override begin(context?: PlayContext): void {
    this.tracks = leavesOf(this.mobject, context).map(([leaf, style]) => ({
      leaf,
      from: { ...style },
      to: targetFor(this.target, style),
    }));
  }

  override interpolate(alpha: number): void {
    for (const { leaf, from, to } of this.tracks) {
      const now: StyleOverride = {};
      if (to.stroke !== undefined) {
        now.stroke = lerpColor(from.stroke, to.stroke, alpha) ?? to.stroke;
      }
      if (to.textColor !== undefined) {
        now.textColor = lerpColor(from.textColor, to.textColor, alpha) ?? to.textColor;
      }
      if (to.fill !== undefined) {
        now.fill = lerpColor(from.fill, to.fill, alpha);
      }
      if (to.strokeWidth !== undefined) {
        now.strokeWidth = Math.max(0, lerp(from.strokeWidth, to.strokeWidth, alpha));
      }
      leaf.setStyle(now);
    }
  }
}
