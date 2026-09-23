import { highlightColor } from '../color';
import type { EmphasisEffect, MObject } from '../mobjects/MObject';
import { Tex } from '../mobjects/tex';
import type { Box, MeasureContext, Point } from '../mobjects/types';
import { boxBoundsInParent, lerp } from '../mobjects/types';
import { drawPath } from '../path/draw';
import { partialPath } from '../path/measure';
import type { PathData } from '../path/path';
import { PathBuilder } from '../path/path';
import type { Theme } from '../theme/Theme';
import { lightTheme } from '../theme/presets';
import type { AnimationOptions, PlayContext } from './Animation';
import { Animation } from './Animation';
import { linear, smooth, thereAndBack, wiggle } from './rateFunctions';

/**
 * 强调动画:高亮(Indicate)、摆动(Wiggle)、圈出(Circumscribe)、闪一下(Flash)。
 * 都是渲染期的临时效果(见 MObject.setEmphasis):不改对象的位置、缩放、样式,
 * 所以能和同时进行的移动、updater 共存;结束时总是精确回到原状(与 rateFunc 在终点的值无关)。
 * 颜色缺省按背景挑(亮底橙、暗底琥珀黄)。
 */

/** 对象在所在位置的文本度量(量公式、文字的包围盒要用字号)。 */
function measureOf(m: MObject, context?: PlayContext): MeasureContext {
  const style = context ? context.styleOf(m) : m.getStyle(lightTheme);
  return { fontSize: style.fontSize, fontFamily: style.fontFamily };
}

/**
 * 强调的目标范围在本地坐标里的包围盒:part 为 undefined 时是整个对象,
 * 否则是公式里的这个命名部分(\class{名字}{…})。只有公式认得部分;名字不存在时列出现有的。
 */
function targetBox(title: string, m: MObject, part: string | undefined, context?: PlayContext): Box {
  const measure = measureOf(m, context);
  if (part === undefined) {
    return m.getBox(measure);
  }
  if (!(m instanceof Tex)) {
    throw new Error(`${title}:part 只对公式(Tex)有效,这个对象是 ${m.constructor.name}`);
  }
  const box = m.getPartBox(part, measure);
  if (!box) {
    const names = m.partNames;
    throw new Error(
      `${title}:公式里没有名为「${part}」的部分(用 \\class{${part}}{…} 标出来)` +
        (names.length > 0 ? `;现有的部分:${names.join('、')}` : ''),
    );
  }
  return box;
}

/** 效果只作用于某个部分时带上 part(整个对象时不带这个键)。 */
function scoped(effect: EmphasisEffect, part: string | undefined): EmphasisEffect {
  return part === undefined ? effect : { ...effect, part };
}

function clamp01(v: number): number {
  return v >= 1 ? 1 : v > 0 ? v : 0;
}

function positive(name: string, value: number): number {
  if (!(Number.isFinite(value) && value > 0)) {
    throw new RangeError(`${name} 需要正的有限数,收到 ${value}`);
  }
  return value;
}

function nonNegative(name: string, value: number): number {
  if (!(Number.isFinite(value) && value >= 0)) {
    throw new RangeError(`${name} 需要非负有限数,收到 ${value}`);
  }
  return value;
}

/** 本地点经对象自身变换(先缩放、再旋转、再平移)到父坐标。 */
function toParent(m: MObject, p: Point): Point {
  const cos = Math.cos(m.rotation);
  const sin = Math.sin(m.rotation);
  const x = p.x * m.scale;
  const y = p.y * m.scale;
  return { x: m.position.x + x * cos - y * sin, y: m.position.y + x * sin + y * cos };
}

export interface IndicateOptions extends AnimationOptions {
  /** 放大到的倍数(绕对象的几何中心),缺省 1.2。 */
  scaleFactor?: number;
  /** 强调色,缺省按背景挑。 */
  color?: string;
  /** 只高亮公式里的这个命名部分(\class{名字}{…}):绕这一部分的中心放大、只染它。 */
  part?: string;
}

/**
 * Indicate:高亮一下 —— 对象绕几何中心放大并染上强调色,再回到原样。
 * rateFunc 描述的是强调的程度(缺省 thereAndBack:去而复返)。
 * 容器整组一起染色;公式里用 \textcolor 显式上色的部分保持原色。
 * 指定 part 时只高亮公式里的那一项(那一项里显式上过色的也一起染)。
 */
export class Indicate extends Animation {
  readonly scaleFactor: number;
  private readonly color: string | null;
  private readonly part: string | undefined;
  private pivot: Point = { x: 0, y: 0 };

  constructor(mobject: MObject, options?: IndicateOptions) {
    super(mobject, { ...options, rateFunc: options?.rateFunc ?? thereAndBack });
    this.scaleFactor = positive('Indicate:scaleFactor', options?.scaleFactor ?? 1.2);
    this.color = options?.color ?? null;
    this.part = options?.part;
  }

  override begin(context?: PlayContext): void {
    this.pivot = targetBox('Indicate', this.mobject, this.part, context).center;
  }

  override interpolate(alpha: number): void {
    this.mobject.setEmphasis(
      this,
      scoped(
        {
          scale: lerp(1, this.scaleFactor, alpha),
          pivot: this.pivot,
          tint: { color: this.color, amount: clamp01(alpha) },
        },
        this.part,
      ),
    );
  }

  override finish(): void {
    this.mobject.setEmphasis(this, null);
  }
}

export interface WiggleOptions extends AnimationOptions {
  /** 摆动期间放大到的倍数,缺省 1.1。 */
  scaleFactor?: number;
  /** 摆动的最大角度(弧度),缺省 0.02π(3.6°)。 */
  rotationAngle?: number;
  /** 来回摆几下(半周期数),缺省 6。 */
  wiggles?: number;
  /** 只摆公式里的这个命名部分(\class{名字}{…})。 */
  part?: string;
}

/** Wiggle:绕几何中心左右摆几下、微微放大,再回到原样。缺省 2 秒、线性时间。 */
export class Wiggle extends Animation {
  private readonly scaleFactor: number;
  private readonly rotationAngle: number;
  private readonly wiggles: number;
  private readonly part: string | undefined;
  private pivot: Point = { x: 0, y: 0 };

  constructor(mobject: MObject, options?: WiggleOptions) {
    super(mobject, {
      ...options,
      runTime: options?.runTime ?? 2,
      rateFunc: options?.rateFunc ?? linear,
    });
    this.scaleFactor = positive('Wiggle:scaleFactor', options?.scaleFactor ?? 1.1);
    const angle = options?.rotationAngle ?? 0.02 * Math.PI;
    if (!Number.isFinite(angle)) {
      throw new RangeError(`Wiggle:rotationAngle 需要有限数,收到 ${angle}`);
    }
    this.rotationAngle = angle;
    this.wiggles = positive('Wiggle:wiggles', options?.wiggles ?? 6);
    this.part = options?.part;
  }

  override begin(context?: PlayContext): void {
    this.pivot = targetBox('Wiggle', this.mobject, this.part, context).center;
  }

  override interpolate(alpha: number): void {
    this.mobject.setEmphasis(
      this,
      scoped(
        {
          scale: lerp(1, this.scaleFactor, thereAndBack(clamp01(alpha))),
          rotation: wiggle(clamp01(alpha), this.wiggles) * this.rotationAngle,
          pivot: this.pivot,
        },
        this.part,
      ),
    );
  }

  override finish(): void {
    this.mobject.setEmphasis(this, null);
  }
}

export interface CircumscribeOptions extends AnimationOptions {
  /** 圈的形状:'rectangle'(缺省,外接矩形)或 'circle'(外接圆)。 */
  shape?: 'rectangle' | 'circle';
  /** 圈与对象包围盒之间的留白(父坐标单位),缺省 10。 */
  buff?: number;
  /** 颜色,缺省按背景挑。 */
  color?: string;
  /** 线宽,缺省按主题。 */
  strokeWidth?: number;
  /** 后半程整圈淡出;缺省 false:从起点开始收回,像一笔划过去。 */
  fadeOut?: boolean;
  /** 只圈公式里的这个命名部分(\class{名字}{…})。 */
  part?: string;
}

/**
 * Circumscribe:圈出 —— 前半程沿对象外围画一圈(矩形或圆),后半程收回(或淡出)。
 * 圈画在对象的父坐标系里,跟着对象移动;不往场景里加对象。缺省 1 秒,两个半程各自 smooth。
 */
export class Circumscribe extends Animation {
  private readonly shape: 'rectangle' | 'circle';
  private readonly buff: number;
  private readonly color: string | null;
  private readonly strokeWidth: number | null;
  private readonly fadeOut: boolean;
  private readonly part: string | undefined;
  private box: Box = { size: { w: 0, h: 0 }, center: { x: 0, y: 0 } };
  /** 上一帧的圈(按父坐标里的外接矩形缓存,对象不动就不重建,弧长表也跟着复用)。 */
  private cacheKey = '';
  private cachePath: PathData | null = null;

  constructor(mobject: MObject, options?: CircumscribeOptions) {
    super(mobject, { ...options, rateFunc: options?.rateFunc ?? linear });
    const shape = options?.shape ?? 'rectangle';
    if (shape !== 'rectangle' && shape !== 'circle') {
      throw new Error(`Circumscribe:shape 只能是 'rectangle' 或 'circle',收到 ${String(shape)}`);
    }
    this.shape = shape;
    this.buff = nonNegative('Circumscribe:buff', options?.buff ?? 10);
    this.color = options?.color ?? null;
    this.strokeWidth =
      options?.strokeWidth === undefined
        ? null
        : positive('Circumscribe:strokeWidth', options.strokeWidth);
    this.fadeOut = options?.fadeOut ?? false;
    this.part = options?.part;
  }

  override begin(context?: PlayContext): void {
    this.box = targetBox('Circumscribe', this.mobject, this.part, context);
    this.cacheKey = '';
    this.cachePath = null;
  }

  override interpolate(alpha: number): void {
    const a = clamp01(alpha);
    let from = 0;
    let to = 1;
    let fade = 1;
    if (a < 0.5) {
      to = smooth(a * 2);
    } else if (this.fadeOut) {
      fade = 1 - smooth(a * 2 - 1);
    } else {
      from = smooth(a * 2 - 1);
    }
    this.mobject.setEmphasis(this, {
      adorn: (ctx, theme) => this.draw(ctx, theme, from, to, fade),
    });
  }

  override finish(): void {
    this.mobject.setEmphasis(this, null);
  }

  /** 当前的圈(父坐标)。 */
  framePath(): PathData {
    const m = this.mobject;
    const b = boxBoundsInParent(this.box, m.position, m.scale, m.rotation);
    const key = `${b.minX},${b.minY},${b.maxX},${b.maxY}`;
    if (this.cachePath && key === this.cacheKey) {
      return this.cachePath;
    }
    const pad = this.buff;
    const builder = new PathBuilder();
    if (this.shape === 'circle') {
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      const r = Math.hypot(b.maxX - b.minX, b.maxY - b.minY) / 2 + pad;
      // 从正上方起、顺时针一整圈。
      builder.arc(cx, cy, r, -Math.PI / 2, (Math.PI * 3) / 2).close();
    } else {
      // 从左上角起、顺时针。
      builder.rect(b.minX - pad, b.minY - pad, b.maxX - b.minX + pad * 2, b.maxY - b.minY + pad * 2);
    }
    this.cacheKey = key;
    this.cachePath = builder.build();
    return this.cachePath;
  }

  private draw(
    ctx: CanvasRenderingContext2D,
    theme: Theme,
    from: number,
    to: number,
    fade: number,
  ): void {
    if (!(fade > 0) || !(to > from)) {
      return;
    }
    const path = partialPath(this.framePath(), from, to);
    ctx.globalAlpha *= fade;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    drawPath(ctx, path, {
      fill: null,
      stroke: this.color ?? highlightColor(theme.background),
      strokeWidth: this.strokeWidth ?? theme.strokeWidth,
    });
  }
}

export interface FlashOptions extends AnimationOptions {
  /** 闪光中心(对象本地坐标,比如 axes.toLocal(1, 2)),缺省对象的几何中心。 */
  at?: Point;
  /** 光芒内端到中心的距离(父坐标单位)。缺省:以几何中心为心时取对象外接半径 + 6,指定 at 时取 10。 */
  radius?: number;
  /** 每道光芒的长度(父坐标单位),缺省取内半径的一半(至少 14)。 */
  lineLength?: number;
  /** 光芒道数,缺省 12。 */
  lineCount?: number;
  /** 颜色,缺省按背景挑。 */
  color?: string;
  /** 线宽,缺省按主题。 */
  strokeWidth?: number;
  /** 每道光芒同时可见的一截占全长的比例,缺省 1(先从内端长出、再从内端收走)。 */
  timeWidth?: number;
  /** 以公式里这个命名部分(\class{名字}{…})的中心为心(没给 at 时)。 */
  part?: string;
}

/**
 * Flash:闪一下 —— 从一点向四周射出一圈短光芒,光芒向外掠过后消失。
 * 画在对象的父坐标系里,中心跟着对象移动;不往场景里加对象。缺省 1 秒、smooth。
 */
export class Flash extends Animation {
  private readonly at: Point | null;
  private readonly radiusOption: number | null;
  private readonly lineLengthOption: number | null;
  private readonly lineCount: number;
  private readonly color: string | null;
  private readonly strokeWidth: number | null;
  private readonly timeWidth: number;
  private readonly part: string | undefined;
  private center: Point = { x: 0, y: 0 };
  private radius = 10;
  private lineLength = 14;

  constructor(mobject: MObject, options?: FlashOptions) {
    super(mobject, options);
    this.at = options?.at ? { ...options.at } : null;
    this.radiusOption =
      options?.radius === undefined ? null : nonNegative('Flash:radius', options.radius);
    this.lineLengthOption =
      options?.lineLength === undefined ? null : positive('Flash:lineLength', options.lineLength);
    const count = options?.lineCount ?? 12;
    if (!(Number.isInteger(count) && count > 0)) {
      throw new RangeError(`Flash:lineCount 需要正整数,收到 ${count}`);
    }
    this.lineCount = count;
    this.color = options?.color ?? null;
    this.strokeWidth =
      options?.strokeWidth === undefined ? null : positive('Flash:strokeWidth', options.strokeWidth);
    this.timeWidth = positive('Flash:timeWidth', options?.timeWidth ?? 1);
    this.part = options?.part;
  }

  override begin(context?: PlayContext): void {
    const m = this.mobject;
    if (this.at) {
      this.center = this.at;
      this.radius = this.radiusOption ?? 10;
    } else {
      const box = targetBox('Flash', m, this.part, context);
      this.center = box.center;
      const reach = (Math.hypot(box.size.w, box.size.h) / 2) * Math.abs(m.scale);
      this.radius = this.radiusOption ?? reach + 6;
    }
    this.lineLength = this.lineLengthOption ?? Math.max(14, this.radius / 2);
  }

  override interpolate(alpha: number): void {
    const tw = this.timeWidth;
    const upper = clamp01(alpha * (1 + tw));
    const lower = clamp01(alpha * (1 + tw) - tw);
    this.mobject.setEmphasis(this, {
      adorn: (ctx, theme) => this.draw(ctx, theme, lower, upper),
    });
  }

  override finish(): void {
    this.mobject.setEmphasis(this, null);
  }

  /** 光芒的中心(父坐标,跟着对象当前的变换)。 */
  flashCenter(): Point {
    return toParent(this.mobject, this.center);
  }

  private draw(ctx: CanvasRenderingContext2D, theme: Theme, lower: number, upper: number): void {
    if (!(upper > lower)) {
      return;
    }
    const c = this.flashCenter();
    const r0 = this.radius + this.lineLength * lower;
    const r1 = this.radius + this.lineLength * upper;
    ctx.beginPath();
    for (let k = 0; k < this.lineCount; k++) {
      const angle = (k / this.lineCount) * Math.PI * 2;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      ctx.moveTo(c.x + r0 * cos, c.y + r0 * sin);
      ctx.lineTo(c.x + r1 * cos, c.y + r1 * sin);
    }
    ctx.strokeStyle = this.color ?? highlightColor(theme.background);
    ctx.lineWidth = this.strokeWidth ?? theme.strokeWidth;
    ctx.lineCap = 'round';
    ctx.stroke();
  }
}
