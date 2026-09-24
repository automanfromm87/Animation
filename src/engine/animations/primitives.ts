import type { MObject } from '../mobjects/MObject';
import type { Point } from '../mobjects/types';
import { lerp } from '../mobjects/types';
import type { PaceOptions, RevealPace } from '../path/pace';
import { resolvePace } from '../path/pace';
import type { AnimationOptions } from './Animation';
import { Animation, BasePlayable } from './Animation';

export interface FadeInOptions extends AnimationOptions {
  /**
   * 淡入到的不透明度。缺省取对象当前值;当前值为 0(预先藏起来的对象)时按 1,
   * 这样「先置 0 再 FadeIn」这个最自然的写法不会变成 0→0 的空动画。
   */
  to?: number;
}

export class FadeIn extends Animation {
  private targetOpacity = 1;
  private readonly to: number | undefined;

  constructor(mobject: MObject, options?: FadeInOptions) {
    super(mobject, options);
    this.to = options?.to;
  }

  override begin(): void {
    this.targetOpacity =
      this.to ?? (this.mobject.opacity > 0 ? this.mobject.opacity : 1);
    this.mobject.opacity = 0;
  }

  override interpolate(alpha: number): void {
    this.mobject.opacity = this.targetOpacity * alpha;
  }
}

export class FadeOut extends Animation {
  private startOpacity = 1;

  override begin(): void {
    this.startOpacity = this.mobject.opacity;
  }

  override interpolate(alpha: number): void {
    this.mobject.opacity = this.startOpacity * (1 - alpha);
  }
}

export class MoveTo extends Animation {
  private start: Point = { x: 0, y: 0 };
  /** 动画期间对象持有的位置点:逐帧原地改写,不每帧分配新对象。 */
  private current: Point = { x: 0, y: 0 };
  private readonly target: Point;

  constructor(mobject: MObject, target: Point, options?: AnimationOptions) {
    super(mobject, options);
    this.target = { ...target };
  }

  override begin(): void {
    this.start = { ...this.mobject.position };
    // 换成自己的点对象再原地改:position 可能和别的对象共用同一个 Point。
    this.current = { ...this.start };
  }

  override interpolate(alpha: number): void {
    this.current.x = lerp(this.start.x, this.target.x, alpha);
    this.current.y = lerp(this.start.y, this.target.y, alpha);
    this.mobject.position = this.current;
  }
}

export class ScaleTo extends Animation {
  private startScale = 1;
  private readonly targetScale: number;

  constructor(mobject: MObject, targetScale: number, options?: AnimationOptions) {
    super(mobject, options);
    this.targetScale = targetScale;
  }

  override begin(): void {
    this.startScale = this.mobject.scale;
  }

  override interpolate(alpha: number): void {
    this.mobject.scale = lerp(this.startScale, this.targetScale, alpha);
  }
}

/** RotateTo:把 rotation 补间到目标角(弧度,不取最短路径)。 */
export class RotateTo extends Animation {
  private startRotation = 0;
  private readonly targetRotation: number;

  constructor(mobject: MObject, targetRotation: number, options?: AnimationOptions) {
    super(mobject, options);
    this.targetRotation = targetRotation;
  }

  override begin(): void {
    this.startRotation = this.mobject.rotation;
  }

  override interpolate(alpha: number): void {
    this.mobject.rotation = lerp(this.startRotation, this.targetRotation, alpha);
  }
}

/** 子树里第一个不支持描边生长的对象(自身或某个后代),全都支持返回 null。 */
function firstUnrevealable(m: MObject): MObject | null {
  if (m.supportsReveal) {
    return null;
  }
  const children = m.getChildren();
  if (children.length === 0) {
    return m;
  }
  for (const child of children) {
    const bad = firstUnrevealable(child);
    if (bad) {
      return bad;
    }
  }
  return m;
}

/** Create 的选项:时长、缓动与笔速(pace: 'curvature' 弯处放慢、直处加快,总时长不变)。 */
export interface CreateOptions extends AnimationOptions, PaceOptions {}

/**
 * Create:描边生长(把图形画出来)。
 * 只支持 supportsReveal 的 MObject;Group 要求所有子元素都支持。
 * 检查放在 begin:构造时还空着、播放前才填满的 Group 也能用。
 * 笔速只影响按弧长描出来的部分(多边形、曲线、函数图像、SVG 路径、公式字形的轮廓),
 * 每个叶子按自己的形状换算(直线、圆、圆弧与匀速完全一样);椭圆按角度扫、尖端本来就慢,不变;
 * 圆点长大、扇形扫开、箭头、文字逐字出现这类自有长法不受影响。
 */
export class Create extends Animation {
  /** 笔速(null 为按弧长匀速);构造时校验,选项写错在 new 的时候就报。 */
  private readonly pace: RevealPace | null;

  constructor(mobject: MObject, options?: CreateOptions) {
    super(mobject, options);
    this.pace = resolvePace('Create', options);
  }

  override begin(): void {
    const bad = firstUnrevealable(this.mobject);
    if (bad) {
      const what = bad === this.mobject ? '对象本身' : '其中的子元素';
      throw new Error(
        `Create 需要支持描边生长的对象:${what}(${bad.constructor.name})不支持`,
      );
    }
    this.mobject.setRevealFraction(0, this.pace);
  }

  override interpolate(alpha: number): void {
    this.mobject.setRevealFraction(alpha, this.pace);
  }

  override finish(): void {
    // 与基类契约一致按 rateFunc(1) 收尾:往返型缓动结束时应当回到「没画出来」。
    // 停在半途时保留笔速,定格的画面与最后一帧一致;画完就连笔速一起撤掉。
    const a = this.rateFunc(1);
    if (a >= 1) {
      this.mobject.setRevealFraction(null);
    } else {
      this.mobject.setRevealFraction(Math.max(0, a), this.pace);
    }
  }
}

/** 可以读写文本内容的对象(Label 与 Tex 都实现)。 */
export interface TextLike {
  getText(): string;
  setText(text: string): unknown;
}

export interface FadeTransformOptions extends AnimationOptions {
  /** 新旧交替时的垂直 drift(世界单位),默认 12。 */
  shift?: number;
}

/**
 * FadeTransform:文本交替(旧的上浮淡出,新的自下浮现,中点换串)。
 * 支持任何 TextLike 的 MObject(Tex、Label);终态精确(新串、不透明度、原位)。
 */
export class FadeTransform extends BasePlayable {
  private readonly target: MObject & TextLike;
  private readonly to: string;
  private readonly shift: number;
  private from = '';
  private startX = 0;
  private startY = 0;
  private startOpacity = 1;
  private readonly current: Point = { x: 0, y: 0 };

  constructor(target: MObject & TextLike, to: string, options?: FadeTransformOptions) {
    super(options);
    this.target = target;
    this.to = to;
    this.shift = options?.shift ?? 12;
  }

  override begin(): void {
    this.from = this.target.getText();
    this.startX = this.target.position.x;
    this.startY = this.target.position.y;
    this.startOpacity = this.target.opacity > 0 ? this.target.opacity : 1;
  }

  interpolate(alpha: number): void {
    const first = alpha < 0.5;
    // setText 对同值是 no-op,不会每帧把公式重新排一遍。
    this.target.setText(first ? this.from : this.to);
    const t = first ? alpha * 2 : (alpha - 0.5) * 2;
    this.target.opacity = this.startOpacity * (first ? 1 - t : t);
    this.current.x = this.startX;
    this.current.y = first ? this.startY - this.shift * t : this.startY + this.shift * (1 - t);
    this.target.position = this.current;
  }

  override finish(): void {
    super.finish();
    // 终态交还一个独立的点对象,之后对象被别的动画原地改写也不会互相牵连。
    this.target.position = { ...this.current };
  }
}
