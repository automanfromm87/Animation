import type { MObject } from '../mobjects/MObject';
import type { PathLayer } from '../path/draw';
import { IDENTITY_AFFINE } from '../path/path';
import { defaultLagRatio, staggered, writeStep } from '../path/write';
import type { AnimationOptions, PlayContext } from './Animation';
import { Animation } from './Animation';
import type { Piece } from './family';
import { collectPieces, matrixScale } from './family';

export interface WriteOptions extends AnimationOptions {
  /**
   * 相邻两片开始书写的错开量(占每片时长的比例,0 为同时写)。
   * 缺省按片数取:片越多挨得越紧,最多 0.2(与 Manim 的 Write 一致)。
   */
  lagRatio?: number;
}

/** 书写的一个时段:一层几何;null 表示没有几何的片(画布文字)自己占的时段。 */
interface WriteSlot {
  readonly layer: PathLayer;
  readonly opacity: number;
  /** 层没给 outlineWidth 时临时轮廓的线宽(宿主坐标)。 */
  readonly outlineWidth: number;
}

/** 一片的画布文字部分:跟着这片占的时段 [first, last] 一起淡入。 */
interface WriteText {
  readonly piece: Piece;
  readonly first: number;
  readonly last: number;
}

/**
 * Write:把对象「写」出来。每一片(公式的每个字形、图形的每条路径)先按弧长描出轮廓,
 * 再淡入填充,片与片错峰;只描边的线条全程按弧长生长。组按子元素先序展开;
 * 画布文字(\text 里的中文、Label)在自己那一片的时段里淡入。
 * 不改对象的变换与不透明度;结束时撤掉覆盖层、按原样绘制,终态精确。
 */
export class Write extends Animation {
  private readonly lagRatio: number | undefined;
  private slots: Array<WriteSlot | null> = [];
  private texts: WriteText[] = [];
  private lag = 0;

  constructor(mobject: MObject, options?: WriteOptions) {
    super(mobject, options);
    const lag = options?.lagRatio;
    if (lag !== undefined && !(Number.isFinite(lag) && lag >= 0)) {
      throw new Error(`Write 的 lagRatio 需要非负有限数,收到 ${lag}`);
    }
    this.lagRatio = lag;
  }

  override begin(context?: PlayContext): void {
    const pieces = collectPieces(this.mobject, IDENTITY_AFFINE, context, (m, style) =>
      m.writeLayers(style),
    );
    const slots: Array<WriteSlot | null> = [];
    const texts: WriteText[] = [];
    for (const piece of pieces) {
      const first = slots.length;
      const width = piece.style.strokeWidth > 0 ? piece.style.strokeWidth : 1;
      const outlineWidth = width * matrixScale(piece.matrix);
      for (const layer of piece.layers) {
        slots.push({ layer, opacity: piece.opacity, outlineWidth });
      }
      if (piece.layers.length === 0) {
        slots.push(null);
      }
      texts.push({ piece, first, last: slots.length - 1 });
    }
    this.slots = slots;
    this.texts = texts;
    this.lag = this.lagRatio ?? defaultLagRatio(slots.length);
    this.interpolate(0);
  }

  override interpolate(alpha: number): void {
    const count = this.slots.length;
    if (count === 0) {
      return;
    }
    const layers: PathLayer[] = [];
    const alphas: number[] = [];
    this.slots.forEach((slot, i) => {
      if (!slot) {
        return;
      }
      const step = writeStep(slot.layer, staggered(alpha, i, count, this.lag), slot.outlineWidth);
      if (step) {
        layers.push(step);
        alphas.push(slot.opacity);
      }
    });
    const texts = this.texts;
    const lag = this.lag;
    this.mobject.setMorphOverlay({
      layers,
      alphas,
      extra: (ctx) => {
        const base = ctx.globalAlpha;
        for (const { piece, first, last } of texts) {
          const u = (staggered(alpha, first, count, lag) + staggered(alpha, last, count, lag)) / 2;
          const k = piece.opacity * u;
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
      },
    });
  }

  /** 终态(按 rateFunc(1)):写完就撤掉覆盖层;往返型缓动停在对应的进度上(与 Create 一致)。 */
  override finish(): void {
    const a = this.rateFunc(1);
    if (!(a < 1)) {
      this.mobject.setMorphOverlay(null);
    } else {
      this.interpolate(a);
    }
  }
}
