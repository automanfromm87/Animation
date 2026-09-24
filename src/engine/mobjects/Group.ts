import type { RevealPace } from '../path/pace';
import type { ResolvedStyle, StyleOverride, Theme } from '../theme/Theme';
import { assignStyle } from '../theme/Theme';
import { MObject, NO_STYLE, swapInheritedTint } from './MObject';
import type { Bounds, Box, MeasureContext } from './types';
import { FALLBACK_MEASURE, boxBoundsInParent, boxFromSize, unionBounds } from './types';

/** root 的子树里是否含有 target(不含 root 自己)。环检测用。 */
function subtreeContains(root: MObject, target: MObject): boolean {
  const stack = [...root.getChildren()];
  const seen = new Set<MObject>();
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined || seen.has(node)) {
      continue;
    }
    if (node === target) {
      return true;
    }
    seen.add(node);
    stack.push(...node.getChildren());
  }
  return false;
}

/**
 * Group: MObject 容器,自身变换作用于所有子元素。
 * setStyle 在渲染时作用于整棵子树(Group 自己不绘制,样式要落到叶子上才有意义),
 * 但抢不走子元素自己设过的键;中间容器设过的键挡住祖先的同名键。
 * 不透明度是整组的:opacity 乘进累积 alpha,不参与样式继承。
 */
export class Group extends MObject {
  private readonly children: MObject[] = [];
  /** 向下传的继承样式缓存:上游对象与自身样式版本都没变就复用,每帧零分配。 */
  private inheritBase: Readonly<StyleOverride> | null = null;
  private inheritVersion = -1;
  private inheritMerged: Readonly<StyleOverride> = NO_STYLE;

  /**
   * 加入子元素。已在本容器里的对象会被忽略(重复加入会画两遍、占两个 Layout 槽位);
   * 加入自己或自己的祖先会抛错(形成环,渲染与量尺寸都会无限递归)。
   */
  add(...mobjects: MObject[]): this {
    for (const m of mobjects) {
      if (m === this || subtreeContains(m, this)) {
        throw new Error('Group.add:不能加入容器自身或它的祖先(会形成环)');
      }
      if (!this.children.includes(m)) {
        this.children.push(m);
      }
    }
    return this;
  }

  remove(...mobjects: MObject[]): this {
    // 原地删除:getChildren() 返回的是活视图,不能换数组。
    for (let i = this.children.length - 1; i >= 0; i--) {
      const child = this.children[i];
      if (child !== undefined && mobjects.includes(child)) {
        this.children.splice(i, 1);
      }
    }
    return this;
  }

  /** 子元素的活视图(不要直接修改,用 add/remove)。 */
  override getChildren(): readonly MObject[] {
    return this.children;
  }

  override childMeasureContext(context?: MeasureContext): MeasureContext | undefined {
    const { fontSize, fontFamily } = this.styleOverride;
    if (fontSize === undefined && fontFamily === undefined) {
      return context;
    }
    const base = context ?? FALLBACK_MEASURE;
    return {
      fontSize: fontSize ?? base.fontSize,
      fontFamily: fontFamily ?? base.fontFamily,
    };
  }

  /** 传给子元素的继承样式:上游继承 ⊕ 自身 setStyle(自身优先)。 */
  override childInheritedStyle(
    inherited: Readonly<StyleOverride>,
  ): Readonly<StyleOverride> {
    if (this.styleVersion === 0) {
      return inherited;
    }
    if (this.inheritBase !== inherited || this.inheritVersion !== this.styleVersion) {
      const merged: StyleOverride = { ...inherited };
      assignStyle(merged, this.styleOverride);
      this.inheritBase = inherited;
      this.inheritVersion = this.styleVersion;
      this.inheritMerged = merged;
    }
    return this.inheritMerged;
  }

  override getBox(context?: MeasureContext): Box {
    // 子盒按各自 position/scale/rotation 合并到本地坐标系(含旋转角点)。
    const inner = this.childMeasureContext(context);
    let acc: Bounds | null = null;
    for (const child of this.children) {
      const b = boxBoundsInParent(
        child.getBox(inner),
        child.position,
        child.scale,
        child.rotation,
      );
      acc = acc === null ? b : unionBounds(acc, b);
    }
    if (acc === null) {
      return boxFromSize(0, 0);
    }
    return {
      size: { w: acc.maxX - acc.minX, h: acc.maxY - acc.minY },
      center: { x: (acc.minX + acc.maxX) / 2, y: (acc.minY + acc.maxY) / 2 },
    };
  }

  override onMeasurementsChanged(): void {
    for (const child of [...this.children]) {
      child.onMeasurementsChanged();
    }
  }

  override getCullRadius(theme?: Theme, inherited?: Readonly<StyleOverride>): number {
    const childInherited = theme ? this.childInheritedStyle(inherited ?? NO_STYLE) : undefined;
    let radius = 0;
    for (const child of this.children) {
      const r = child.getCullRadius(theme, childInherited);
      if (!Number.isFinite(r)) {
        return Infinity;
      }
      radius = Math.max(
        radius,
        Math.hypot(child.position.x, child.position.y) + r * Math.abs(child.scale),
      );
    }
    return radius;
  }

  override get supportsReveal(): boolean {
    return (
      this.children.length > 0 &&
      this.children.every((c) => c.supportsReveal)
    );
  }

  override setRevealFraction(f: number | null, pace: RevealPace | null = null): this {
    this.revealFraction = f;
    this.revealPace = pace;
    // 笔速连同比例一起往下传:每个叶子按自己的形状换算(直线仍是匀速)。
    for (const child of this.children) {
      child.setRevealFraction(f, pace);
    }
    return this;
  }

  override render(
    ctx: CanvasRenderingContext2D,
    theme: Theme,
    parentOpacity = 1,
    inherited: Readonly<StyleOverride> = NO_STYLE,
  ): void {
    // 整组透明度:乘进累积值传给子元素(主题 opacity 由叶子各乘一次,这里不乘)。
    const acc = Math.min(1, this.opacity * parentOpacity);
    if (!(acc > 0)) {
      return;
    }
    const childInherited = this.childInheritedStyle(inherited);
    ctx.save();
    try {
      ctx.translate(this.position.x, this.position.y);
      ctx.rotate(this.rotation);
      ctx.scale(this.scale, this.scale);
      this.applyEmphasisTransform(ctx);
      ctx.globalAlpha = acc;
      const morph = this.getMorphOverlay();
      if (morph) {
        // 变形期间整组画成覆盖层;叶子本该各乘一次的主题透明度这里补上。
        ctx.globalAlpha = Math.min(1, acc * theme.opacity);
        this.paintMorph(ctx, morph);
      } else {
        this.renderChildren(ctx, theme, acc, inherited, childInherited);
      }
    } finally {
      ctx.restore();
    }
    this.drawAdornments(ctx, theme, parentOpacity);
  }

  /** 按顺序画子元素;自己挂着强调着色时,画子树期间把它换成生效的着色。 */
  private renderChildren(
    ctx: CanvasRenderingContext2D,
    theme: Theme,
    acc: number,
    inherited: Readonly<StyleOverride>,
    childInherited: Readonly<StyleOverride>,
  ): void {
    const tint = this.ownEmphasisTint();
    const previous = tint ? swapInheritedTint(tint) : null;
    try {
      this.beforeChildren(ctx, theme, inherited);
      try {
        for (const child of this.children) {
          child.render(ctx, theme, acc, childInherited);
        }
      } finally {
        this.afterChildren(ctx, theme, inherited);
      }
    } finally {
      // 子元素抛错也要交还:着色不能漏到之后画的对象上。
      if (tint) {
        swapInheritedTint(previous);
      }
    }
  }

  /**
   * 子元素绘制前的钩子(变换与 globalAlpha 已设好)。
   * inherited 是本容器收到的继承样式(不含自身覆盖)。
   */
  protected beforeChildren(
    _ctx: CanvasRenderingContext2D,
    _theme: Theme,
    _inherited: Readonly<StyleOverride>,
  ): void {
    // 默认什么都不画。
  }

  /** 子元素绘制后的钩子(即使子元素抛错也会调用,与 beforeChildren 成对)。 */
  protected afterChildren(
    _ctx: CanvasRenderingContext2D,
    _theme: Theme,
    _inherited: Readonly<StyleOverride>,
  ): void {
    // 默认什么都不画。
  }

  protected override drawShape(
    _ctx: CanvasRenderingContext2D,
    _style: ResolvedStyle,
  ): void {
    // Group 在 render() 里直接渲染子元素,不会走到这里。
  }
}
