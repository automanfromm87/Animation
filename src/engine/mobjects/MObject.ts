import { colorAlpha, fadeColor, highlightColor, lerpColor } from '../color';
import type { PathLayer } from '../path/draw';
import { drawPath } from '../path/draw';
import type { PathData } from '../path/path';
import type { ResolvedStyle, StyleOverride, Theme } from '../theme/Theme';
import { assignStyle, resolveStyleInto } from '../theme/Theme';
import type { Box, MeasureContext, Point } from './types';
import { boxFromSize } from './types';

export type { PathLayer } from '../path/draw';

/**
 * 变形覆盖:形状变形(Transform)、逐字书写(Write)期间代替对象正常绘制的内容。
 * layers 按顺序画(本地坐标,乘对象自身的透明度;alphas 是各层额外的不透明度系数,缺省 1),
 * extra 在其后画(不能变形的画布文字在这里交叉淡化)。
 */
export interface MorphOverlay {
  readonly layers: readonly PathLayer[];
  readonly alphas?: readonly number[];
  readonly extra?: (ctx: CanvasRenderingContext2D) => void;
}

/**
 * 着色:描边、填充、文字色朝 color 混合 amount(0..1)。color 为 null 时用按背景挑的强调色。
 * @internal 强调动画用的协议。
 */
export interface EmphasisTint {
  readonly color: string | null;
  readonly amount: number;
}

/**
 * 强调效果:Indicate / Circumscribe / Flash 这类强调动画播放期间,渲染时临时叠加的缩放 / 旋转、
 * 着色与装饰。不改对象的持久状态(位置、缩放、样式),撤掉即复原 ——
 * 所以能和同时进行的移动、updater 共存。同一对象可以同时挂几个(按挂上的顺序叠加)。
 * @internal 强调动画用的协议,不是给调用方的 API。
 */
export interface EmphasisEffect {
  /** 叠加在自身变换之后、绕本地点 pivot 的缩放(缺省 1)与旋转(弧度,缺省 0)。 */
  readonly scale?: number;
  readonly rotation?: number;
  readonly pivot?: Point;
  /**
   * 着色,整棵子树一起(子树里自己挂着的着色优先)。
   * 公式里用 \textcolor 显式上色的部分、变形覆盖层不受影响。
   */
  readonly tint?: EmphasisTint;
  /**
   * 画在对象之后的装饰(圈注、光芒),在对象的父坐标系里画;
   * globalAlpha 已设为父级累积透明度 × 主题透明度,ctx 状态由调用方 save/restore。
   */
  readonly adorn?: (ctx: CanvasRenderingContext2D, theme: Theme) => void;
  /**
   * 只作用于公式里的这个命名部分(\class{名字}{…}):缩放 / 旋转绕这一部分自己的中心(pivot 不用),
   * 着色只染这一部分。由认得部分的子类(Tex)自己画;对象整体的变换与着色不受它影响。
   */
  readonly part?: string;
}

/** 渲染子树期间生效的祖先着色。渲染是同步的,模块级变量就够;Group.render 进出子树时切换。 */
let inheritedTint: EmphasisTint | null = null;

/** 正在渲染的主题背景(着色没指定颜色时按它挑强调色)。MObject.render 在画之前设好。 */
let renderBackground = '#ffffff';

/**
 * @internal 着色实际用的颜色:指定了就用它,否则按正在渲染的背景挑强调色。
 * 只在渲染期间(drawShape 里)调用才有意义。
 */
export function emphasisColor(tint: EmphasisTint): string {
  return tint.color ?? highlightColor(renderBackground);
}

/**
 * @internal Group.render 用:渲染子元素前换上自己的着色,返回之前的值,渲染完交还。
 */
export function swapInheritedTint(tint: EmphasisTint | null): EmphasisTint | null {
  const previous = inheritedTint;
  inheritedTint = tint;
  return previous;
}

/** 把着色混进解析好的样式(渲染缓冲,下一帧重新解析)。填充保留原来的透明度。 */
function tintStyle(style: ResolvedStyle, tint: EmphasisTint, background: string): void {
  const k = tint.amount;
  if (!(k > 0)) {
    return;
  }
  const color = tint.color ?? highlightColor(background);
  style.stroke = lerpColor(style.stroke, color, k) ?? style.stroke;
  style.textColor = lerpColor(style.textColor, color, k) ?? style.textColor;
  if (style.fill !== null) {
    style.fill = lerpColor(style.fill, fadeColor(color, colorAlpha(style.fill)), k) ?? style.fill;
  }
}

/** 没有容器样式时向下传的空覆盖。冻结:任何人都不能往里写。 */
export const NO_STYLE: Readonly<StyleOverride> = Object.freeze({});

/** 叶子节点共享的空子元素表,getChildren 不必每次分配。 */
const NO_CHILDREN: readonly MObject[] = Object.freeze([]);

/** styleBuffer 初值用的实线。 */
const NO_STYLE_DASH: readonly number[] = Object.freeze([]);

/** 带变形覆盖层期间的剔除半径:不参与剔除。 */
const NEVER_CULL = (): number => Infinity;

/**
 * MObject: 场景中一切可见元素的基类。
 * 持有几何变换 (position/scale/rotation) + 透明度 + 局部样式覆盖。
 * render() 是模板方法: 解析样式 -> 应用变换 -> 调用子类 drawShape()。
 *
 * 样式在渲染时按「自身 > 容器链 > 构造默认 > 主题」解析(拉模型):
 * 容器不再把样式复制进子元素,所以移出容器不需要回滚,
 * 同一个对象挂在两个容器下也各自按所在位置解析。
 */
export abstract class MObject {
  position: Point = { x: 0, y: 0 };
  scale = 1;
  rotation = 0;
  /** 不透明度(唯一的透明度通道,FadeIn/FadeOut 驱动它)。 */
  opacity = 1;
  /**
   * 渐进显示比例(Create 动画用),null = 完整显示。
   * 只有 supportsReveal 的子类会在 drawShape 里响应它。
   * 走 setRevealFraction 读写,Group 才能把它传给子元素。
   */
  protected revealFraction: number | null = null;
  /** 自己 setStyle 设过的样式(最高优先级)。 */
  protected styleOverride: StyleOverride = {};
  /** 子类构造期的默认样式:低于容器继承,高于主题。 */
  protected readonly defaultStyle: StyleOverride = {};
  /** setStyle 真正写入过的次数;容器据此缓存向下传的继承样式。0 表示从没设过。 */
  protected styleVersion = 0;
  /** 变形覆盖(Transform / Write 播放期间),null 表示正常绘制。 */
  private morph: MorphOverlay | null = null;
  /** 强调效果(按挂上它的动画区分),没有为 null。 */
  private effects: Map<object, EmphasisEffect> | null = null;
  /** 实例上是否临时遮住了 getCullRadius(变形覆盖或强调效果期间)。 */
  private cullShadowed = false;
  /** render 期间复用的样式缓冲,避免每帧每对象的对象分配。 */
  private readonly styleBuffer: ResolvedStyle = {
    stroke: '#000',
    fill: null,
    strokeWidth: 1,
    opacity: 1,
    fontFamily: 'serif',
    fontSize: 16,
    textColor: '#000',
    dash: NO_STYLE_DASH,
  };

  /** 是否支持描边生长(Create),默认不支持。 */
  get supportsReveal(): boolean {
    return false;
  }

  getRevealFraction(): number | null {
    return this.revealFraction;
  }

  setRevealFraction(f: number | null): this {
    this.revealFraction = f;
    return this;
  }

  /** 有效生长比例:null 表示完整绘制(含 f>=1 与非法值)。 */
  revealed(): number | null {
    const f = this.revealFraction;
    if (f === null || !(f < 1)) {
      return null;
    }
    return Math.max(0, f);
  }

  /**
   * 设置样式覆盖。值为 undefined 的键会被忽略(`{ fontSize: opts?.size }`
   * 这种写法不会把已有值抹掉);fill 可以显式设成 null 表示不填充。
   * 容器上的样式在渲染时作用于整棵子树,但抢不走子元素自己设过的键。
   */
  setStyle(override: Readonly<StyleOverride>): this {
    if (assignStyle(this.styleOverride, override)) {
      this.styleVersion += 1;
    }
    return this;
  }

  /**
   * 子类构造期的默认样式:容器的样式能覆盖它,移出容器后它又回来。
   * 构造函数里**不要**用 setStyle 设默认值 —— 那会把这个键锁死,容器从此再也改不动。
   */
  protected setDefaultStyle(override: Readonly<StyleOverride>): void {
    assignStyle(this.defaultStyle, override);
  }

  /** 自身样式覆盖的只读视图(不含容器继承与构造默认)。 */
  getStyleOverride(): Readonly<StyleOverride> {
    return this.styleOverride;
  }

  /**
   * 解析后的样式:Theme + 构造默认 + inherited(容器链传下来的,缺省为无) + 自身覆盖,
   * opacity 乘上自身透明度。不传 inherited 即「脱离容器时」的样式 ——
   * 容器继承取决于对象挂在哪里,只有遍历场景图时才知道。
   */
  getStyle(theme: Theme, inherited?: Readonly<StyleOverride>): ResolvedStyle {
    const style = resolveStyleInto(
      theme,
      { ...this.styleBuffer },
      this.styleOverride,
      inherited,
      this.defaultStyle,
    );
    style.opacity *= this.opacity;
    return style;
  }

  /**
   * 传给子元素的继承样式。叶子原样返回;容器叠加自身 setStyle(见 Group)。
   * @internal 场景图遍历(渲染、预取、剔除)用的容器协议,不是给调用方的 API。
   */
  childInheritedStyle(inherited: Readonly<StyleOverride>): Readonly<StyleOverride> {
    return inherited;
  }

  moveTo(point: Point): this {
    this.position = { ...point };
    return this;
  }

  shift(dx: number, dy: number): this {
    this.position = { x: this.position.x + dx, y: this.position.y + dy };
    return this;
  }

  /**
   * 文本度量变了(字体加载完成,同样的内容量出来的尺寸可能不同了)。
   * 一次性排版的容器(Layout)借此重排;容器把通知传给子元素。Scene 在字体就绪时调用。
   */
  onMeasurementsChanged(): void {
    // 叶子没有依赖度量的缓存状态。
  }

  /** 子元素(容器类覆写)。统一的场景图遍历入口。 */
  getChildren(): readonly MObject[] {
    return NO_CHILDREN;
  }

  /**
   * 子元素量尺寸用的文本上下文。叶子原样返回;容器用自身 fontSize/fontFamily
   * 覆盖上游,与渲染时的样式继承保持一致(否则量出来的盒和画出来的字对不上)。
   * @internal 容器量尺寸(getBox、Layout 排版)用的协议,不是给调用方的 API。
   */
  childMeasureContext(context?: MeasureContext): MeasureContext | undefined {
    return context;
  }

  /**
   * 本地包围盒(未乘 scale)。布局系统用它量尺寸摆位置,
   * 默认零盒,子类按几何覆盖。文本类用 context 的字号测量。
   */
  getBox(_context?: MeasureContext): Box {
    return boxFromSize(0, 0);
  }

  /**
   * 画出来的矢量几何(本地坐标,不含自身 position/scale/rotation):形状变形、逐字书写用。
   * 不能表示成路径的对象返回 null(默认)。style 是渲染时解析出的样式 ——
   * 公式的大小取决于字号;不传时按自身设置与兜底字号。
   */
  toPath(_style?: ResolvedStyle): PathData | null {
    return null;
  }

  /**
   * 形状变形用的分层几何(本地坐标)。缺省:有 toPath 就按样式的填充/描边成一层;
   * 没有(文字这类)返回空数组 —— 这种对象在变形里只能交叉淡化。
   */
  pathLayers(style: ResolvedStyle): PathLayer[] {
    const path = this.toPath(style);
    return path
      ? [
          {
            path,
            paint: {
              fill: style.fill,
              stroke: style.stroke,
              strokeWidth: style.strokeWidth,
              dash: style.dash,
            },
          },
        ]
      : [];
  }

  /**
   * 逐字书写(Write)用的分片:每片各自先描轮廓、再淡入填充,片与片之间错峰。
   * 缺省与 pathLayers 相同;公式按字形分片。
   */
  writeLayers(style: ResolvedStyle): PathLayer[] {
    return this.pathLayers(style);
  }

  /**
   * 变形期间交叉淡化的非路径部分(画布文字)。缺省:不能表示成路径的对象整个画一遍,
   * 能表示成路径的什么都不画。ctx 已在对象本地坐标,globalAlpha 由调用方设好。
   * @internal 变形动画用的协议,不是给调用方的 API。
   */
  drawMorphResidual(ctx: CanvasRenderingContext2D, style: ResolvedStyle): void {
    if (this.toPath(style) === null) {
      this.drawShape(ctx, style);
    }
  }

  /**
   * @internal 变形动画用:设置 / 清除代替正常绘制的覆盖层。
   * 覆盖层期间对象不参与剔除 —— 变形中的内容可能远在自身外接圆之外(目标在别处),
   * 按自身位置剔掉会让整段变形看不见。
   */
  setMorphOverlay(overlay: MorphOverlay | null): void {
    this.morph = overlay;
    this.syncCullShadow();
  }

  /** 当前的变形覆盖(没有为 null)。 */
  getMorphOverlay(): MorphOverlay | null {
    return this.morph;
  }

  /**
   * @internal 强调动画用:挂上 / 更新 / 撤掉 owner(通常是动画自己)名下的强调效果。
   * 挂着效果期间对象不参与剔除(放大、光芒、圈注都可能超出自身外接圆)。
   */
  setEmphasis(owner: object, effect: EmphasisEffect | null): void {
    if (effect) {
      (this.effects ??= new Map()).set(owner, effect);
    } else if (this.effects) {
      this.effects.delete(owner);
      if (this.effects.size === 0) {
        this.effects = null;
      }
    }
    this.syncCullShadow();
  }

  /** @internal owner 名下当前的强调效果(没有为 null)。 */
  getEmphasis(owner: object): EmphasisEffect | null {
    return this.effects?.get(owner) ?? null;
  }

  /**
   * 变形覆盖或强调效果期间不参与剔除。各子类都覆盖了 getCullRadius,基类拦不住,
   * 所以在实例上临时遮住它(容器问子元素时同样拿到 Infinity),都撤掉时恢复原型上的实现。
   */
  private syncCullShadow(): void {
    const shadow = this.morph !== null || this.effects !== null;
    if (shadow && !this.cullShadowed) {
      Object.defineProperty(this, 'getCullRadius', {
        value: NEVER_CULL,
        configurable: true,
        writable: true,
      });
      this.cullShadowed = true;
    } else if (!shadow && this.cullShadowed) {
      Reflect.deleteProperty(this, 'getCullRadius');
      this.cullShadowed = false;
    }
  }

  /**
   * 生效的着色:自己挂着的(取最强的一个),没有就沿用祖先的。
   * @internal 渲染(MObject.render / Group.render)用。
   */
  protected emphasisTint(): EmphasisTint | null {
    let best: EmphasisTint | null = null;
    if (this.effects) {
      for (const effect of this.effects.values()) {
        if (effect.part !== undefined) {
          continue;
        }
        const tint = effect.tint;
        if (tint && tint.amount > 0 && (best === null || tint.amount > best.amount)) {
          best = tint;
        }
      }
    }
    return best ?? inheritedTint;
  }

  /** 自己挂着的着色(不含祖先的);Group 渲染子元素时据此切换。 */
  protected ownEmphasisTint(): EmphasisTint | null {
    const tint = this.emphasisTint();
    return tint === inheritedTint ? null : tint;
  }

  /** 只作用于某个命名部分的强调效果(按挂上的顺序);认得部分的子类(Tex)在 drawShape 里自己画。 */
  protected partEmphases(): EmphasisEffect[] {
    if (!this.effects) {
      return [];
    }
    return [...this.effects.values()].filter((effect) => effect.part !== undefined);
  }

  /** 叠加强调效果的缩放 / 旋转(在自身变换之后调用)。 */
  protected applyEmphasisTransform(ctx: CanvasRenderingContext2D): void {
    if (!this.effects) {
      return;
    }
    for (const effect of this.effects.values()) {
      const k = effect.scale ?? 1;
      const r = effect.rotation ?? 0;
      if (effect.part !== undefined || (k === 1 && r === 0) || !Number.isFinite(k) || !Number.isFinite(r)) {
        continue;
      }
      const px = effect.pivot?.x ?? 0;
      const py = effect.pivot?.y ?? 0;
      ctx.translate(px, py);
      ctx.rotate(r);
      ctx.scale(k, k);
      ctx.translate(-px, -py);
    }
  }

  /**
   * 画强调效果的装饰(在父坐标系,自身变换已经撤掉之后调用)。
   * parentOpacity 是祖先累积的不透明度;装饰不乘对象自己的不透明度。
   */
  protected drawAdornments(
    ctx: CanvasRenderingContext2D,
    theme: Theme,
    parentOpacity: number,
  ): void {
    if (!this.effects) {
      return;
    }
    const alpha = Math.min(1, theme.opacity * parentOpacity);
    if (!(alpha > 0)) {
      return;
    }
    for (const effect of this.effects.values()) {
      if (!effect.adorn) {
        continue;
      }
      ctx.save();
      try {
        ctx.globalAlpha = alpha;
        effect.adorn(ctx, theme);
      } finally {
        ctx.restore();
      }
    }
  }

  /** 画变形覆盖(render 与 Group.render 共用)。每层 save/restore:虚线不能漏给下一层。 */
  protected paintMorph(ctx: CanvasRenderingContext2D, overlay: MorphOverlay): void {
    const base = ctx.globalAlpha;
    overlay.layers.forEach((layer, i) => {
      const k = overlay.alphas?.[i] ?? 1;
      if (!(k > 0)) {
        return;
      }
      ctx.save();
      ctx.globalAlpha = Math.min(1, base * k);
      drawPath(ctx, layer.path, layer.paint);
      ctx.restore();
    });
    overlay.extra?.(ctx);
  }

  /**
   * 视锥剔除用的本地外接半径(以自身原点为圆心,未乘 scale)。
   * 必须是保守上界。返回 Infinity(默认)表示不参与剔除,一律绘制。
   * theme / inherited 是渲染时的样式上下文(渲染器从顶层传入、容器往下传),
   * 尺寸取决于解析后样式(字号)的对象据此计算;不传时只能按自身设置保守估计。
   */
  getCullRadius(_theme?: Theme, _inherited?: Readonly<StyleOverride>): number {
    return Infinity;
  }

  /**
   * 绘制自己。parentOpacity 是祖先容器累积的不透明度,inherited 是容器链传下来的样式。
   * save/restore 包在 try/finally 里:drawShape 抛错也不会留下不平衡的画布状态栈
   * (否则祖先 Layout 的裁剪会串到之后所有帧)。
   */
  render(
    ctx: CanvasRenderingContext2D,
    theme: Theme,
    parentOpacity = 1,
    inherited: Readonly<StyleOverride> = NO_STYLE,
  ): void {
    const alpha = Math.min(1, theme.opacity * this.opacity * parentOpacity);
    // 写成 !(alpha > 0):NaN 也按不可见处理。画布会忽略非法的 globalAlpha 赋值,
    // 沿用上一个对象的值,那样 NaN 透明度的对象反而会被画出来。
    if (!(alpha > 0)) {
      return;
    }
    const style = resolveStyleInto(
      theme,
      this.styleBuffer,
      this.styleOverride,
      inherited,
      this.defaultStyle,
    );
    style.opacity *= this.opacity;
    const tint = this.emphasisTint();
    if (tint) {
      tintStyle(style, tint, theme.background);
    }
    renderBackground = theme.background;
    ctx.save();
    try {
      ctx.translate(this.position.x, this.position.y);
      ctx.rotate(this.rotation);
      ctx.scale(this.scale, this.scale);
      this.applyEmphasisTransform(ctx);
      ctx.globalAlpha = alpha;
      if (this.morph) {
        this.paintMorph(ctx, this.morph);
      } else {
        this.drawShape(ctx, style);
      }
    } finally {
      ctx.restore();
    }
    this.drawAdornments(ctx, theme, parentOpacity);
  }

  protected abstract drawShape(
    ctx: CanvasRenderingContext2D,
    style: ResolvedStyle,
  ): void;
}
