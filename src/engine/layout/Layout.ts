import { Group } from '../mobjects/Group';
import type { MObject } from '../mobjects/MObject';
import type { Box, MeasureContext } from '../mobjects/types';
import {
  FALLBACK_MEASURE,
  boxBoundsInParent,
  boxFromSize,
  measureGeneration,
} from '../mobjects/types';
import type { ResolvedStyle, StyleOverride, Theme } from '../theme/Theme';
import { resolveStyleInto } from '../theme/Theme';

export type LayoutDirection = 'row' | 'column';
export type LayoutAlign = 'start' | 'center' | 'end';
export type LayoutJustify =
  | 'start'
  | 'center'
  | 'end'
  | 'space-between'
  | 'space-around';

/** 边框样式。缺省字段跟随容器解析出的样式(那也是子元素会继承的样式)。 */
export interface LayoutFrameStyle {
  stroke?: string;
  strokeWidth?: number;
}

export interface LayoutOptions {
  direction?: LayoutDirection;
  gap?: number;
  padding?: number;
  justify?: LayoutJustify;
  align?: LayoutAlign;
  /**
   * 显示容器边框(调试/演示用),默认 false。
   * 传对象可以单独指定边框颜色/线宽 —— 用 setStyle 改会连带改掉所有子元素。
   */
  frame?: boolean | LayoutFrameStyle;
  /**
   * 超出容器的子元素裁掉,默认 false(跟 CSS overflow 默认可见一致)。
   * 公式与图形走同一条画布裁剪,旋转的容器也按旋转后的框裁。
   */
  clip?: boolean;
}

interface MeasuredItem {
  child: MObject;
  /** 外接盒中心相对 child.position 的偏移(父空间,已含子元素自身的缩放旋转)。 */
  ox: number;
  oy: number;
  /** 主轴/交叉轴占位。被拉伸的子容器记 0 基准。 */
  main: number;
  cross: number;
  /** 主轴下限:被拉伸的子容器不小于自身内容尺寸,其余等于 main。 */
  minMain: number;
  flex: number;
  /** 会被拉伸填满槽位的子容器;quarter 表示它转了奇数个 90°(宽高互换)。 */
  stretch: boolean;
  quarter: boolean;
}

/** 排布给子元素定下的变换。 */
interface Placement {
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

/** 最近一次 layout() 的参数与结果:字体加载完成后据此判断能否、怎样重排。 */
interface LayoutRecord {
  context: MeasureContext | undefined;
  generation: number;
  placed: Map<MObject, Placement>;
}

function requireSize(name: string, value: number): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`Layout 的 ${name} 需要一个非负有限数,收到 ${value}`);
  }
  return value;
}

function finiteOrZero(v: number): number {
  return Number.isFinite(v) ? v : 0;
}

/** 旋转是否为 90° 的整数倍:0 = 轴向不变,1 = 宽高互换,-1 = 斜着(不能拉伸填满轴对齐槽位)。 */
function quarterTurn(rotation: number): 0 | 1 | -1 {
  if (Math.abs(Math.sin(rotation)) < 1e-9) {
    return 0;
  }
  if (Math.abs(Math.cos(rotation)) < 1e-9) {
    return 1;
  }
  return -1;
}

/**
 * Layout:固定尺寸的容器,内部按行/列自动排布。
 * 用法: place() 逐个放入子元素(可带 flex),再调一次 layout() 算完位置。
 * 嵌套 Layout 会递归排布;带 flex 的子 Layout 会拉伸填满分到的槽位
 * (基准记 0,等价于 CSS 的 flex-basis:0,重排幂等、不会越排越宽;
 * 但不小于自身内容尺寸,类比 CSS flex 项默认的 min-width:auto —— 兄弟已经溢出时它保住内容,整体继续溢出)。
 * 子元素超长时允许溢出(不压缩),由调用方保证尺寸;
 * center/end 溢出时分别向两侧/起始侧溢出,space-* 溢出时退化为 start/center。
 * 排布是一次性的:子元素内容变了(文本、公式)要重新调 layout()。
 * 例外是字体加载完成导致的尺寸变化:排好之后没人挪过子元素的容器会按原参数自动重排。
 */
export class Layout extends Group {
  width: number;
  height: number;
  readonly direction: LayoutDirection;
  readonly gap: number;
  readonly padding: number;
  readonly justify: LayoutJustify;
  readonly align: LayoutAlign;
  /** 边框样式,null 表示不画边框。 */
  readonly frame: Readonly<LayoutFrameStyle> | null;
  readonly clip: boolean;
  private readonly flexes = new Map<MObject, number>();
  private laidOut: LayoutRecord | null = null;
  /** 边框的样式缓冲(每帧复用)。 */
  private readonly frameStyle: ResolvedStyle = {
    stroke: '#000',
    fill: null,
    strokeWidth: 1,
    opacity: 1,
    fontFamily: 'serif',
    fontSize: 16,
    textColor: '#000',
    dash: [],
  };

  constructor(width: number, height: number, options?: LayoutOptions) {
    super();
    this.width = requireSize('width', width);
    this.height = requireSize('height', height);
    this.direction = options?.direction ?? 'row';
    // 与 padding 同一口径:负数与非有限值按 0(CSS 的 gap 也不接受负值)。
    this.gap = Math.max(0, finiteOrZero(options?.gap ?? 0));
    this.padding = Math.max(0, finiteOrZero(options?.padding ?? 0));
    this.justify = options?.justify ?? 'start';
    this.align = options?.align ?? 'center';
    const frame = options?.frame;
    this.frame = frame === true ? {} : frame ? { ...frame } : null;
    this.clip = options?.clip ?? false;
  }

  setSize(width: number, height: number): this {
    this.width = requireSize('width', width);
    this.height = requireSize('height', height);
    return this;
  }

  /** 放入子元素,flex > 0 按比例分剩余主轴空间。已在容器里的子元素只更新 flex,不会重复占槽。 */
  place(child: MObject, flex = 0): this {
    this.add(child);
    this.flexes.set(child, Number.isFinite(flex) && flex > 0 ? flex : 0);
    return this;
  }

  /** 改一个子元素的 flex。不是本容器子元素的对象被忽略(不留幽灵条目)。 */
  setFlex(child: MObject, flex: number): this {
    if (this.getChildren().includes(child)) {
      this.flexes.set(child, Number.isFinite(flex) && flex > 0 ? flex : 0);
    }
    return this;
  }

  getFlex(child: MObject): number {
    return this.flexes.get(child) ?? 0;
  }

  override remove(...mobjects: MObject[]): this {
    super.remove(...mobjects);
    for (const m of mobjects) {
      this.flexes.delete(m);
    }
    return this;
  }

  override getBox(): Box {
    return boxFromSize(this.width, this.height);
  }

  override getCullRadius(theme?: Theme, inherited?: Readonly<StyleOverride>): number {
    const own = Math.hypot(this.width, this.height) / 2;
    if (this.clip) {
      // 子元素被裁到容器框内,自身盒就是严格上界。
      return own;
    }
    // 不裁剪时子元素允许溢出,必须取子树的保守上界,否则会把还看得见的内容剔掉。
    return Math.max(own, super.getCullRadius(theme, inherited));
  }

  protected override beforeChildren(ctx: CanvasRenderingContext2D): void {
    if (this.clip) {
      // 与 afterChildren 的 restore 成对:边框要在撤掉裁剪之后画。
      ctx.save();
      ctx.beginPath();
      ctx.rect(-this.width / 2, -this.height / 2, this.width, this.height);
      ctx.clip();
    }
  }

  protected override afterChildren(
    ctx: CanvasRenderingContext2D,
    theme: Theme,
    inherited: Readonly<StyleOverride>,
  ): void {
    if (this.clip) {
      // 先撤裁剪再画框:描边骑在框线上,裁着画会丢掉外侧半条线宽。
      ctx.restore();
    }
    if (!this.frame) {
      return;
    }
    const style = resolveStyleInto(
      theme,
      this.frameStyle,
      this.styleOverride,
      inherited,
      this.defaultStyle,
    );
    const lineWidth = this.frame.strokeWidth ?? style.strokeWidth;
    if (!(lineWidth > 0)) {
      return;
    }
    ctx.save();
    // 叶子会在自己的 render 里乘一次 theme.opacity,容器自绘的边框要显式补上这一乘,
    // 否则主题不透明度 ≠ 1 时边框比内容实。
    ctx.globalAlpha *= theme.opacity;
    ctx.strokeStyle = this.frame.stroke ?? style.stroke;
    ctx.lineWidth = lineWidth;
    ctx.strokeRect(-this.width / 2, -this.height / 2, this.width, this.height);
    ctx.restore();
  }

  /** 这个子元素会不会被拉伸填满槽位(带 flex 的子 Layout,且只转了 90° 的整数倍)。 */
  private stretches(child: MObject): child is Layout {
    const k = Math.abs(child.scale);
    return (
      this.getFlex(child) > 0 &&
      child instanceof Layout &&
      quarterTurn(child.rotation) >= 0 &&
      k > 0 &&
      Number.isFinite(k)
    );
  }

  /** 子元素在父空间里的外接盒尺寸(含自身缩放旋转);会被拉伸的子容器按它的内容尺寸算。 */
  private footprint(child: MObject, ctx: MeasureContext): { w: number; h: number } {
    if (this.stretches(child)) {
      const k = Math.abs(child.scale);
      const own = child.intrinsicSize(ctx);
      return quarterTurn(child.rotation) === 1
        ? { w: own.h * k, h: own.w * k }
        : { w: own.w * k, h: own.h * k };
    }
    const b = boxBoundsInParent(child.getBox(ctx), { x: 0, y: 0 }, child.scale, child.rotation);
    return { w: finiteOrZero(b.maxX - b.minX), h: finiteOrZero(b.maxY - b.minY) };
  }

  /**
   * 不拉伸时的内容尺寸:主轴 = 子元素占位之和 + 间距,交叉轴 = 最大占位,都含内边距。
   * 被拉伸时它是下限(类比 CSS flex 项的 min-width:auto)。
   */
  intrinsicSize(context?: MeasureContext): { w: number; h: number } {
    const ctx = this.childMeasureContext(context) ?? FALLBACK_MEASURE;
    const horizontal = this.direction === 'row';
    const kids = this.getChildren();
    let main = this.gap * Math.max(0, kids.length - 1) + this.padding * 2;
    let cross = 0;
    for (const child of kids) {
      const { w, h } = this.footprint(child, ctx);
      main += horizontal ? w : h;
      cross = Math.max(cross, horizontal ? h : w);
    }
    cross += this.padding * 2;
    return horizontal ? { w: main, h: cross } : { w: cross, h: main };
  }

  /**
   * 文本度量变了(字体加载完成):排好之后没人挪过子元素的容器按原参数重排;
   * 手动挪过(或正被动画改位置)的保持原样,不和调用方抢。
   */
  override onMeasurementsChanged(): void {
    const last = this.laidOut;
    const generation = measureGeneration();
    if (last && last.generation !== generation) {
      if (this.untouched()) {
        this.layout(last.context);
      } else {
        last.generation = generation;
      }
    }
    super.onMeasurementsChanged();
  }

  /**
   * 排好之后子元素有没有被挪动、缩放、旋转过(正在播的 MoveTo/ScaleTo 也算)。
   * 会被本容器一并重排的嵌套 Layout 也要没被动过,否则重排会抹掉里面的改动。
   */
  private untouched(): boolean {
    const last = this.laidOut;
    if (!last) {
      return false;
    }
    const kids = this.getChildren();
    return (
      kids.length === last.placed.size &&
      kids.every((c) => {
        const p = last.placed.get(c);
        return (
          p !== undefined &&
          p.x === c.position.x &&
          p.y === c.position.y &&
          p.scale === c.scale &&
          p.rotation === c.rotation &&
          (!(c instanceof Layout) || c.untouched())
        );
      })
    );
  }

  /**
   * 主轴槽位。flex 项基准为 0(被拉伸的子容器)或自身尺寸,按 flex 比例分剩余空间;
   * 分到的比下限(内容尺寸)还小就冻结在下限,剩下的空间再分给其余 flex 项
   * (CSS 解析弹性长度时处理 min 违例的做法)。
   */
  private resolveSlots(items: readonly MeasuredItem[], available: number): number[] {
    const frozen = new Set<number>();
    for (;;) {
      let used = 0;
      let flexSum = 0;
      items.forEach((it, i) => {
        if (frozen.has(i)) {
          used += it.minMain;
        } else {
          used += it.main;
          flexSum += it.flex;
        }
      });
      const unit = flexSum > 0 ? Math.max(0, available - used) / flexSum : 0;
      const violators: number[] = [];
      items.forEach((it, i) => {
        if (!frozen.has(i) && it.flex > 0 && it.main + unit * it.flex < it.minMain) {
          violators.push(i);
        }
      });
      if (violators.length === 0) {
        return items.map((it, i) =>
          frozen.has(i) ? it.minMain : it.main + (it.flex > 0 ? unit * it.flex : 0),
        );
      }
      for (const i of violators) {
        frozen.add(i);
      }
    }
  }

  /** 执行一次排布。context 缺省时用兜底字号测文本(建议传 scene.measureContext())。 */
  layout(context?: MeasureContext): void {
    const ctx = this.childMeasureContext(context) ?? FALLBACK_MEASURE;
    const kids = this.getChildren();
    this.laidOut = { context, generation: measureGeneration(), placed: new Map() };
    if (kids.length === 0) {
      return;
    }
    const horizontal = this.direction === 'row';
    const pad = this.padding;
    const innerMain = Math.max(0, (horizontal ? this.width : this.height) - pad * 2);
    const innerCross = Math.max(0, (horizontal ? this.height : this.width) - pad * 2);
    const items: MeasuredItem[] = kids.map((child) => {
      const flex = this.getFlex(child);
      // 会被拉伸的子容器基准记 0:否则上一次拉伸后的尺寸成了下一次的下限,只涨不缩。
      // 只在转了 90° 整数倍时拉伸:斜着的矩形填不满一个轴对齐的槽位。
      const stretch = this.stretches(child);
      // 外接盒含子元素自身的缩放(负缩放 = 转 180°)与旋转,槽位按它分配。
      const b = boxBoundsInParent(child.getBox(ctx), { x: 0, y: 0 }, child.scale, child.rotation);
      const w = finiteOrZero(b.maxX - b.minX);
      const h = finiteOrZero(b.maxY - b.minY);
      const main = stretch ? 0 : horizontal ? w : h;
      let minMain = main;
      if (stretch) {
        const own = this.footprint(child, ctx);
        minMain = horizontal ? own.w : own.h;
      }
      return {
        child,
        ox: finiteOrZero((b.minX + b.maxX) / 2),
        oy: finiteOrZero((b.minY + b.maxY) / 2),
        main,
        cross: stretch ? 0 : horizontal ? h : w,
        minMain,
        flex,
        stretch,
        quarter: quarterTurn(child.rotation) === 1,
      };
    });
    const count = items.length;
    const baseGaps = this.gap * (count - 1);
    const slots = this.resolveSlots(items, innerMain - baseGaps);
    const totalSlotted = slots.reduce((s, v) => s + v, 0);
    // 可为负(溢出)。center/end 按有符号余量摆,溢出时与 CSS 一样向两侧/起始侧溢出。
    const slack = innerMain - totalSlotted - baseGaps;
    let cursor = pad;
    let step = this.gap;
    switch (this.justify) {
      case 'center':
        cursor = pad + slack / 2;
        break;
      case 'end':
        cursor = pad + slack;
        break;
      case 'space-between':
        // 溢出或只有一项时等同 start(CSS 规则)。
        if (slack > 0 && count > 1) {
          step = this.gap + slack / (count - 1);
        }
        break;
      case 'space-around':
        // 溢出时等同 center(CSS 规则)。
        if (slack > 0) {
          const edge = slack / (count * 2);
          cursor = pad + edge;
          step = this.gap + edge * 2;
        } else {
          cursor = pad + slack / 2;
        }
        break;
      default:
        break;
    }
    items.forEach((it, i) => {
      const slot = slots[i] ?? it.main;
      const { child } = it;
      let mainSize = it.main;
      let crossCenter: number;
      let ox = it.ox;
      let oy = it.oy;
      if (it.stretch && child instanceof Layout) {
        // 槽位是父空间尺寸:除掉子容器自身的缩放;转了 90° 时宽高互换。
        const k = Math.abs(child.scale);
        const along = slot / k;
        const across = innerCross / k;
        const alongIsWidth = horizontal !== it.quarter;
        child.setSize(alongIsWidth ? along : across, alongIsWidth ? across : along);
        child.layout(ctx);
        mainSize = slot;
        crossCenter = pad + innerCross / 2;
        // Layout 的盒以自身原点为中心,缩放旋转后中心仍在原点。
        ox = 0;
        oy = 0;
      } else {
        if (child instanceof Layout) {
          child.layout(ctx);
        }
        switch (this.align) {
          case 'start':
            crossCenter = pad + it.cross / 2;
            break;
          case 'end':
            crossCenter = pad + innerCross - it.cross / 2;
            break;
          default:
            crossCenter = pad + innerCross / 2;
            break;
        }
      }
      // 内容贴槽起始,交叉轴按 align。
      const mainCenter = cursor + mainSize / 2;
      const lx = horizontal ? mainCenter : crossCenter;
      const ly = horizontal ? crossCenter : mainCenter;
      // 布局空间(左上原点) -> 本地空间(中心原点),再让外接盒中心落到槽位中心。
      child.position = {
        x: lx - this.width / 2 - ox,
        y: ly - this.height / 2 - oy,
      };
      this.laidOut?.placed.set(child, {
        x: child.position.x,
        y: child.position.y,
        scale: child.scale,
        rotation: child.rotation,
      });
      cursor += slot + step;
    });
  }
}
