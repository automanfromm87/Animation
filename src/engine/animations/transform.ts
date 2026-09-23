import { lerpColor } from '../color';
import type { MObject, MorphOverlay } from '../mobjects/MObject';
import type { Point } from '../mobjects/types';
import { lerp } from '../mobjects/types';
import type { PathLayer, PathPaint } from '../path/draw';
import { alignPaths, collapsePath, lerpPath } from '../path/morph';
import type { Affine, PathData } from '../path/path';
import { IDENTITY_AFFINE, invertAffine, multiplyAffine } from '../path/path';
import type { AnimationOptions, PlayContext } from './Animation';
import { Animation } from './Animation';
import type { Piece } from './family';
import { collectPieces, ownMatrix, pieceCenter, piecesCenter, subtreeHas } from './family';

export type TransformOptions = AnimationOptions;

/**
 * 一对对齐好的层:from 逐点插值到 to,颜料与不透明度同步插值。
 * @internal 形状变形家族共用。
 */
export interface MorphPair {
  readonly from: PathData;
  readonly to: PathData;
  readonly fromPaint: PathPaint;
  readonly toPaint: PathPaint;
  readonly fromOpacity: number;
  readonly toOpacity: number;
}

/**
 * 变形期间交叉淡化的非路径部分(画布文字):源的淡出,目标的淡入。
 * @internal 形状变形家族共用。
 */
export interface Residual {
  readonly piece: Piece;
  readonly fadeIn: boolean;
}

/**
 * 被 Transform 藏起来的对象当时的不透明度。下一次 Transform 把它当目标换回来时照这个恢复,
 * 来回变形(方 → 圆 → 方)才不会把原来半透明的对象恢复成全不透明。
 */
const hiddenOpacity = new WeakMap<MObject, number>();

function lerpDash(
  a: readonly number[] | undefined,
  b: readonly number[] | undefined,
  t: number,
): readonly number[] | undefined {
  if (a && b && a.length === b.length && a.length > 0) {
    return a.map((v, i) => lerp(v, b[i] ?? v, t));
  }
  return t < 0.5 ? a : b;
}

/**
 * 颜料插值:颜色在 OKLab 里插,null(不填 / 不描)与颜色之间按透明度淡入淡出。
 * 一边没有描边时线宽取另一边的 —— 有无之间靠颜色淡入淡出,而不是线宽从 0 长出来。
 * @internal 形状变形家族共用。
 */
export function lerpPaint(a: PathPaint, b: PathPaint, t: number): PathPaint {
  if (t <= 0) {
    return a;
  }
  if (t >= 1) {
    return b;
  }
  const strokeA = a.stroke !== null && a.strokeWidth > 0;
  const strokeB = b.stroke !== null && b.strokeWidth > 0;
  return {
    fill: lerpColor(a.fill, b.fill, t),
    stroke: lerpColor(strokeA ? a.stroke : null, strokeB ? b.stroke : null, t),
    strokeWidth:
      strokeA && strokeB ? lerp(a.strokeWidth, b.strokeWidth, t) : strokeA ? a.strokeWidth : b.strokeWidth,
    dash: lerpDash(a.dash, b.dash, t),
  };
}

/**
 * 两侧的片按顺序配对(组按子元素先序),片内的层也按顺序配对。
 * 没有对应物的层塌成对面那一片(没有就对面整体)的中心:多出来的从那里长出来,少掉的缩回那里。
 * @internal 形状变形家族共用。
 */
export function pairPieces(
  src: readonly Piece[],
  tgt: readonly Piece[],
  srcCenter: Point,
  tgtCenter: Point,
): MorphPair[] {
  const pairs: MorphPair[] = [];
  const count = Math.max(src.length, tgt.length);
  for (let i = 0; i < count; i++) {
    const a = src[i];
    const b = tgt[i];
    const growFrom = a ? pieceCenter(a) : srcCenter;
    const shrinkTo = b ? pieceCenter(b) : tgtCenter;
    const la: readonly PathLayer[] = a?.layers ?? [];
    const lb: readonly PathLayer[] = b?.layers ?? [];
    const fromOpacity = a?.opacity ?? b?.opacity ?? 1;
    const toOpacity = b?.opacity ?? fromOpacity;
    for (let j = 0; j < Math.max(la.length, lb.length); j++) {
      const x = la[j];
      const y = lb[j];
      if (x && y) {
        const [from, to] = alignPaths(x.path, y.path);
        pairs.push({ from, to, fromPaint: x.paint, toPaint: y.paint, fromOpacity, toOpacity });
      } else if (x) {
        const [from, to] = alignPaths(x.path, collapsePath(x.path, shrinkTo.x, shrinkTo.y));
        pairs.push({ from, to, fromPaint: x.paint, toPaint: x.paint, fromOpacity, toOpacity });
      } else if (y) {
        const [from, to] = alignPaths(collapsePath(y.path, growFrom.x, growFrom.y), y.path);
        pairs.push({ from, to, fromPaint: y.paint, toPaint: y.paint, fromOpacity, toOpacity });
      }
    }
  }
  return pairs;
}

/**
 * 按进度交叉淡化非路径部分(源的淡出、目标的淡入)。
 * @internal 形状变形家族共用。
 */
export function drawResiduals(
  ctx: CanvasRenderingContext2D,
  residuals: readonly Residual[],
  alpha: number,
): void {
  const base = ctx.globalAlpha;
  for (const { piece, fadeIn } of residuals) {
    const k = piece.opacity * (fadeIn ? alpha : 1 - alpha);
    if (!(k > 0)) {
      continue;
    }
    ctx.save();
    try {
      ctx.globalAlpha = Math.min(1, base * k);
      const [a, b, c, d, e, f] = piece.matrix;
      ctx.transform(a, b, c, d, e, f);
      piece.mobject.drawMorphResidual(ctx, piece.style);
    } finally {
      ctx.restore();
    }
  }
}

/**
 * 一次变形的方案(几何在源的本地坐标里):按进度(已缓动)给出源这一帧的覆盖层。
 * @internal 形状变形家族共用:子类覆盖 planMorph 换配对方式,开始/结束的藏与显沿用 Transform。
 */
export interface MorphPlan {
  overlay(alpha: number): MorphOverlay;
}

/**
 * Transform:形状变形(替换语义,相当于 Manim 的 ReplacementTransform)。
 * 源逐点变成目标 —— 位置、大小、旋转、形状、描边/填充颜色、线宽、不透明度一起插值;
 * 开始时把目标藏起来(记下它的不透明度),结束时藏起源、按记下的不透明度显示目标,终态精确。
 * 两个对象都要已经在场景里(目标可以先把 opacity 设为 0,开始时本来也会藏起它);
 * 可以在不同的容器里,按各自的世界变换换算。
 *
 * - 组对组:子元素按先序一一配对,多出来的从对面对应那一片的中心长出来(少掉的缩回去);
 * - 公式:逐个字形变形,\text 里的中文这类画布文字交叉淡化;
 * - 变形期间由源画一层覆盖(不往场景里加临时对象),源与目标的子树都不能互相包含。
 */
export class Transform extends Animation {
  readonly target: MObject;
  private plan: MorphPlan | null = null;
  private startOpacity = 1;
  private endOpacity = 1;
  /** 源的变换不可逆(缩放为 0),没法在它的坐标系里变形:退化成交叉淡化。 */
  private crossfade = false;
  /** begin 之后、finish 之前:这时再 begin(中途重播)沿用第一次记下的初值,源的不透明度已被插到一半。 */
  private active = false;

  constructor(source: MObject, target: MObject, options?: TransformOptions) {
    super(source, options);
    if (source === target) {
      throw new Error(`${this.title}:源和目标不能是同一个对象`);
    }
    this.target = target;
  }

  /** 报错信息里的动画名。 */
  protected get title(): string {
    return 'Transform';
  }

  /**
   * 规划变形:两侧摊成片、配对,返回按进度给出覆盖层的方案(子类覆盖它换配对方式)。
   * 几何都在源的本地坐标里;relative 把目标的本地坐标换到源的本地坐标。
   * 可以抛错:此时对象的状态还没动过。
   */
  protected planMorph(
    source: MObject,
    target: MObject,
    relative: Affine,
    context: PlayContext | undefined,
  ): MorphPlan {
    const src = collectPieces(source, IDENTITY_AFFINE, context, (m, style) => m.pathLayers(style));
    const tgt = collectPieces(target, relative, context, (m, style) => m.pathLayers(style));
    const pairs = pairPieces(
      src,
      tgt,
      piecesCenter(src, { x: 0, y: 0 }),
      piecesCenter(tgt, { x: relative[4], y: relative[5] }),
    );
    const residuals: Residual[] = [
      ...src.map((piece) => ({ piece, fadeIn: false })),
      ...tgt.map((piece) => ({ piece, fadeIn: true })),
    ];
    return {
      overlay: (alpha) => ({
        layers: pairs.map((p) => ({
          path: lerpPath(p.from, p.to, alpha),
          paint: lerpPaint(p.fromPaint, p.toPaint, alpha),
        })),
        alphas: pairs.map((p) => lerp(p.fromOpacity, p.toOpacity, alpha)),
        extra: residuals.length > 0 ? (ctx) => drawResiduals(ctx, residuals, alpha) : undefined,
      }),
    };
  }

  override begin(context?: PlayContext): void {
    const source = this.mobject;
    const target = this.target;
    if (subtreeHas(source, target) || subtreeHas(target, source)) {
      throw new Error(`${this.title}:源和目标不能互相包含`);
    }
    let sourceWorld: Affine;
    let targetWorld: Affine;
    if (context) {
      const s = context.worldMatrix(source);
      const t = context.worldMatrix(target);
      if (!s || !t) {
        throw new Error(
          `${this.title}:${s ? '目标' : '源'}对象不在场景里 —— 两个都要先 scene.add(目标开始时会被自动藏起来,结束时再显示)`,
        );
      }
      sourceWorld = s;
      targetWorld = t;
    } else {
      // 没有场景信息(单独调用):按两者挂在同一个父节点下算。
      sourceWorld = ownMatrix(source);
      targetWorld = ownMatrix(target);
    }
    // 先把可能抛错的几何都算完,再动对象的状态:begin 抛错时场景里的东西原样不变。
    const inverse = invertAffine(sourceWorld);
    const plan = inverse
      ? this.planMorph(source, target, multiplyAffine(inverse, targetWorld), context)
      : null;
    this.plan = plan;
    this.crossfade = plan === null;
    if (!this.active) {
      this.startOpacity = source.opacity;
    }
    this.active = true;
    const stashed = hiddenOpacity.get(target);
    // 目标已经藏着(预先置 0,或被上一次变形藏起来):按记下的不透明度恢复,没有记录按 1。
    this.endOpacity =
      target.opacity > 0 ? target.opacity : stashed !== undefined && stashed > 0 ? stashed : 1;
    hiddenOpacity.set(target, this.endOpacity);
    target.opacity = 0;
    if (this.crossfade) {
      source.setMorphOverlay(null);
    } else {
      this.interpolate(0);
    }
  }

  override interpolate(alpha: number): void {
    const source = this.mobject;
    if (this.crossfade || !this.plan) {
      source.opacity = this.startOpacity * (1 - alpha);
      this.target.opacity = lerp(0, this.endOpacity, alpha);
      return;
    }
    source.setMorphOverlay(this.plan.overlay(alpha));
    source.opacity = lerp(this.startOpacity, this.endOpacity, alpha);
  }

  /**
   * 终态(按 rateFunc(1)):走完时撤掉覆盖层、藏起源、显示目标;
   * 往返型缓动回到 0 时恢复开始时的样子(源照常显示,目标仍藏着);其余进度停在那一帧(与 Create 一致)。
   */
  override finish(): void {
    const a = this.rateFunc(1);
    const source = this.mobject;
    this.active = false;
    if (!(a < 1)) {
      source.setMorphOverlay(null);
      if (this.startOpacity > 0) {
        hiddenOpacity.set(source, this.startOpacity);
      } else {
        hiddenOpacity.delete(source);
      }
      source.opacity = 0;
      this.target.opacity = this.endOpacity;
      hiddenOpacity.delete(this.target);
    } else if (a <= 0) {
      source.setMorphOverlay(null);
      source.opacity = this.startOpacity;
      this.target.opacity = 0;
    } else {
      this.interpolate(a);
    }
  }
}
