import type { Camera } from '../camera/Camera';
import type { MObject } from '../mobjects/MObject';
import { NO_STYLE } from '../mobjects/MObject';
import type { Theme } from '../theme/Theme';

/** 视锥剔除的余量(屏幕 css 像素,按当前缩放换算成世界单位),吸收描边、箭头等超出外接圆的部分。 */
const CULL_MARGIN_PX = 48;

/** 目标上的矩形(目标像素)。 */
export interface TargetRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * CanvasRenderer:Theme 在这里决定最终渲染效果。
 * 背景为屏幕空间;网格/坐标轴画在世界空间,跟随相机;公式与其它图元一样是矢量,
 * 在场景图遍历时画进同一张画布。
 * backing store 的像素尺寸由 Scene 管理(setPixelSize),绘制路径不读 DOM 布局。
 */
export class CanvasRenderer {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  /** 绘制抛过错的对象,只报一次,不每帧刷屏。 */
  private readonly reported = new WeakSet<MObject>();

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('拿不到 Canvas 2D 上下文');
    }
    this.ctx = ctx;
  }

  /** 设定 backing store 像素尺寸;真的变了才写(写 width/height 会清空画布),返回是否变化。 */
  setPixelSize(width: number, height: number): boolean {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (this.canvas.width === w && this.canvas.height === h) {
      return false;
    }
    this.canvas.width = w;
    this.canvas.height = h;
    return true;
  }

  /** 把场景画满自己的画布。vw/vh 是视口的 css 尺寸,pixelRatio 是 backing 像素 / css 像素。 */
  render(
    mobjects: readonly MObject[],
    theme: Theme,
    camera: Camera,
    vw: number,
    vh: number,
    pixelRatio: number,
  ): void {
    this.draw(this.ctx, pixelRatio, 0, 0, mobjects, theme, camera, vw, vh);
  }

  /**
   * 按目标分辨率把场景重新画进任意 2D 上下文(contain 适配、居中,只画在目标矩形内)。
   * 与拷贝主画布像素不同,放大截图也是清晰的(公式同样是矢量)。
   */
  renderInto(
    ctx: CanvasRenderingContext2D,
    rect: TargetRect,
    mobjects: readonly MObject[],
    theme: Theme,
    camera: Camera,
    vw: number,
    vh: number,
  ): void {
    if (!(vw > 0 && vh > 0 && rect.width > 0 && rect.height > 0)) {
      return;
    }
    const k = Math.min(rect.width / vw, rect.height / vh);
    const dw = vw * k;
    const dh = vh * k;
    const ox = rect.x + (rect.width - dw) / 2;
    const oy = rect.y + (rect.height - dh) / 2;
    ctx.save();
    try {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.beginPath();
      ctx.rect(ox, oy, dw, dh);
      ctx.clip();
      this.draw(ctx, k, ox, oy, mobjects, theme, camera, vw, vh);
    } finally {
      ctx.restore();
    }
  }

  private draw(
    ctx: CanvasRenderingContext2D,
    pixelRatio: number,
    originX: number,
    originY: number,
    mobjects: readonly MObject[],
    theme: Theme,
    camera: Camera,
    vw: number,
    vh: number,
  ): void {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.fillStyle = theme.background;
    ctx.fillRect(originX, originY, vw * pixelRatio, vh * pixelRatio);
    camera.applyTo(ctx, pixelRatio, vw, vh, originX, originY);
    this.drawWorldDecorations(ctx, vw, vh, theme, camera);
    const min = camera.screenToWorld(0, 0, vw, vh);
    const max = camera.screenToWorld(vw, vh, vw, vh);
    const margin = CULL_MARGIN_PX / camera.zoom;
    const minX = min.x - margin;
    const minY = min.y - margin;
    const maxX = max.x + margin;
    const maxY = max.y + margin;
    for (const mobject of mobjects) {
      // 保守外接圆剔除:半径为 Infinity 的对象一律照画。
      const radius = mobject.getCullRadius(theme, NO_STYLE) * Math.abs(mobject.scale);
      if (Number.isFinite(radius)) {
        const { x, y } = mobject.position;
        if (
          x + radius < minX ||
          x - radius > maxX ||
          y + radius < minY ||
          y - radius > maxY
        ) {
          continue;
        }
      }
      // 每个顶层对象各自隔离:一个自定义 MObject 抛错,不能连带其它对象和整帧一起丢掉。
      ctx.save();
      try {
        mobject.render(ctx, theme);
      } catch (e) {
        if (!this.reported.has(mobject)) {
          this.reported.add(mobject);
          console.error('[CanvasRenderer] 对象绘制抛错,已跳过(同一对象只报一次)', mobject, e);
        }
      } finally {
        ctx.restore();
      }
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
  }

  /**
   * 世界空间网格 + 原点坐标轴,只画视口可见范围。
   * 线宽按 1/zoom 换算,屏幕上恒定细线;拉远时网格自动抽稀。
   */
  private drawWorldDecorations(
    ctx: CanvasRenderingContext2D,
    vw: number,
    vh: number,
    theme: Theme,
    camera: Camera,
  ): void {
    const min = camera.screenToWorld(0, 0, vw, vh);
    const max = camera.screenToWorld(vw, vh, vw, vh);
    if (theme.showGrid && theme.gridSpacing > 0) {
      let step = theme.gridSpacing;
      while ((max.x - min.x) / step > 400 || (max.y - min.y) / step > 400) {
        step *= 2;
      }
      ctx.save();
      ctx.strokeStyle = theme.gridColor;
      ctx.lineWidth = 1 / camera.zoom;
      ctx.beginPath();
      // 按整数下标遍历:坐标极大时 x += step 会原地踏步(步长小于半个 ULP)。
      const x1 = Math.floor(max.x / step);
      for (let k = Math.ceil(min.x / step); k <= x1; k++) {
        ctx.moveTo(k * step, min.y);
        ctx.lineTo(k * step, max.y);
      }
      const y1 = Math.floor(max.y / step);
      for (let k = Math.ceil(min.y / step); k <= y1; k++) {
        ctx.moveTo(min.x, k * step);
        ctx.lineTo(max.x, k * step);
      }
      ctx.stroke();
      ctx.restore();
    }
    if (theme.showAxes) {
      ctx.save();
      ctx.strokeStyle = theme.axesColor;
      ctx.lineWidth = 1.5 / camera.zoom;
      ctx.beginPath();
      if (min.y <= 0 && 0 <= max.y) {
        ctx.moveTo(min.x, 0);
        ctx.lineTo(max.x, 0);
      }
      if (min.x <= 0 && 0 <= max.x) {
        ctx.moveTo(0, min.y);
        ctx.lineTo(0, max.y);
      }
      ctx.stroke();
      ctx.restore();
    }
  }
}
