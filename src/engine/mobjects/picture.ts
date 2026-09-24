import type { ImageAsset } from '../assets/registry';
import { getImage } from '../assets/registry';
import type { ResolvedStyle } from '../theme/Theme';
import { MObject } from './MObject';
import type { Box } from './types';
import { boxFromSize } from './types';

/** width、height 都给时怎么放。 */
export type PictureFit = 'contain' | 'cover' | 'fill';

export interface PictureOptions {
  /** 显示宽度(世界单位)。只给 width:高按原图宽高比。 */
  width?: number;
  /** 显示高度。只给 height:宽按比例。 */
  height?: number;
  /**
   * width、height 都给时怎么放(只给一个或都不给时无意义):
   * 'contain'(缺省)等比塞进 width×height,对象就是塞进去之后的大小;
   * 'cover' 等比铺满、裁掉溢出(对象恰好 width×height);'fill' 拉伸成 width×height。
   */
  fit?: PictureFit;
  /** 缩放时平滑(缺省 true;像素画传 false)。 */
  smoothing?: boolean;
}

/** 显示尺寸 + drawImage 的源矩形(原图像素)。 */
interface PictureGeometry {
  readonly w: number;
  readonly h: number;
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
}

const FITS: readonly PictureFit[] = ['contain', 'cover', 'fill'];

function requireSize(name: string, value: number | undefined): number | undefined {
  if (value !== undefined && !(Number.isFinite(value) && value > 0)) {
    throw new Error(`Picture 的 ${name} 需要正的有限数,收到 ${value}`);
  }
  return value;
}

/** 按选项算显示尺寸与源矩形(见 PictureOptions)。 */
function pictureGeometry(nw: number, nh: number, options: Pick<PictureOptions, 'width' | 'height' | 'fit'>): PictureGeometry {
  const W = requireSize('width', options.width);
  const H = requireSize('height', options.height);
  const fit = options.fit ?? 'contain';
  if (!FITS.includes(fit)) {
    throw new Error(`Picture 的 fit 只能是 ${FITS.join(' / ')},收到 ${String(fit)}`);
  }
  const whole = { sx: 0, sy: 0, sw: nw, sh: nh };
  if (W === undefined && H === undefined) {
    return { w: nw, h: nh, ...whole };
  }
  if (H === undefined) {
    return { w: W ?? nw, h: ((W ?? nw) * nh) / nw, ...whole };
  }
  if (W === undefined) {
    return { w: (H * nw) / nh, h: H, ...whole };
  }
  if (fit === 'fill') {
    return { w: W, h: H, ...whole };
  }
  if (fit === 'contain') {
    const k = Math.min(W / nw, H / nh);
    return { w: nw * k, h: nh * k, ...whole };
  }
  // cover:等比铺满,源矩形居中裁。
  const k = Math.max(W / nw, H / nh);
  const sw = W / k;
  const sh = H / k;
  return { w: W, h: H, sx: (nw - sw) / 2, sy: (nh - sh) / 2, sw, sh };
}

/**
 * Picture:位图图元。source 是预加载过的路径(public/ 下,如 '/img/earth.png')或 loadImage 拿到的资源。
 * 以自身原点为中心画(按 width 等比缩放);都不给尺寸时按原图像素(1 像素 = 1 世界单位)。
 * 相机、自身变换、透明度(FadeIn / FadeOut、组透明度)都照常生效。
 *
 * - Create:从左往右擦出(按源矩形裁,不用 clip);要先 unrevealed 收起。
 * - Write:在自己的时段里淡入(变形动画对没有路径的对象一律交叉淡化)。
 * - ColorTo / Indicate 的着色对位图不起作用(Indicate 的放大照常)。
 * - node 干跑里没有像素(source 为 null):量尺寸、取景照常,只是不画。
 */
export class Picture extends MObject {
  readonly asset: ImageAsset;
  /** 可写:缩放时是否平滑。 */
  smoothing: boolean;
  private geometry: PictureGeometry;

  constructor(source: string | ImageAsset, options: PictureOptions = {}) {
    super();
    this.asset = typeof source === 'string' ? getImage(source) : source;
    this.smoothing = options.smoothing ?? true;
    this.geometry = pictureGeometry(this.asset.width, this.asset.height, options);
  }

  /** 显示尺寸(世界单位,未乘 scale)。 */
  get width(): number {
    return this.geometry.w;
  }

  get height(): number {
    return this.geometry.h;
  }

  /** 原图像素尺寸。 */
  get naturalWidth(): number {
    return this.asset.width;
  }

  get naturalHeight(): number {
    return this.asset.height;
  }

  /** 改显示尺寸(规则同构造);返回 this。要做动画用 ScaleTo。 */
  setSize(options: Pick<PictureOptions, 'width' | 'height' | 'fit'>): this {
    this.geometry = pictureGeometry(this.asset.width, this.asset.height, options);
    return this;
  }

  /** 擦出:从左往右。 */
  override get supportsReveal(): boolean {
    return true;
  }

  override getBox(): Box {
    return boxFromSize(this.geometry.w, this.geometry.h);
  }

  override getCullRadius(): number {
    return Math.hypot(this.geometry.w, this.geometry.h) / 2;
  }

  protected override drawShape(ctx: CanvasRenderingContext2D, _style: ResolvedStyle): void {
    const src = this.asset.source;
    if (!src) {
      return;
    }
    const r = this.revealed();
    const k = r ?? 1;
    const g = this.geometry;
    // 0 宽的源矩形什么都不画(老浏览器会抛 IndexSizeError)。
    if (!(k * g.sw > 1e-9) || !(g.h > 0)) {
      return;
    }
    // 状态由 MObject.render 的 save/restore 兜住,不会漏给下一个对象。
    ctx.imageSmoothingEnabled = this.smoothing;
    if (this.smoothing) {
      ctx.imageSmoothingQuality = 'high';
    }
    ctx.drawImage(src, g.sx, g.sy, g.sw * k, g.sh, -g.w / 2, -g.h / 2, g.w * k, g.h);
  }
}
