import type { Bounds, Size } from '../mobjects/types';

export interface CameraOptions {
  x?: number;
  y?: number;
  zoom?: number;
  /** 缩放下限,正有限数,缺省 0.1。 */
  minZoom?: number;
  /** 缩放上限,正有限数,缺省 10。 */
  maxZoom?: number;
}

/** CameraView:相机机位快照,可保存/恢复,也可作为运镜目标。 */
export interface CameraView {
  x: number;
  y: number;
  zoom: number;
}

/** 缩放下限的硬底:0 会让 panBy/screenToWorld 除零并永久污染机位。 */
const ZOOM_FLOOR = 1e-6;

function positiveOr(value: number | undefined, fallback: number): number {
  return value !== undefined && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * Camera:无限画布的视口。MObject 活在世界坐标里,
 * Camera 决定看到哪一块、放大多少。
 * x/y/zoom 都只接受有限值,zoom 还会自动钳进 [minZoom, maxZoom],
 * 构造选项也会消毒,因此外部直接赋值或传坏配置都不会把相机写坏。
 */
export class Camera {
  readonly minZoom: number;
  readonly maxZoom: number;
  private xValue = 0;
  private yValue = 0;
  private zoomValue = 1;

  constructor(options?: CameraOptions) {
    this.minZoom = Math.max(ZOOM_FLOOR, positiveOr(options?.minZoom, 0.1));
    this.maxZoom = Math.max(this.minZoom, positiveOr(options?.maxZoom, 10));
    this.zoomValue = this.clampZoom(1);
    this.x = options?.x ?? 0;
    this.y = options?.y ?? 0;
    this.zoom = options?.zoom ?? 1;
  }

  get x(): number {
    return this.xValue;
  }

  /** 非有限值被忽略(保持原值),避免一次 NaN 永久毁掉机位。 */
  set x(value: number) {
    if (Number.isFinite(value)) {
      this.xValue = value;
    }
  }

  get y(): number {
    return this.yValue;
  }

  set y(value: number) {
    if (Number.isFinite(value)) {
      this.yValue = value;
    }
  }

  get zoom(): number {
    return this.zoomValue;
  }

  set zoom(value: number) {
    this.zoomValue = this.clampZoom(value);
  }

  /** 钳进 [minZoom, maxZoom];非有限值回落到当前缩放。 */
  clampZoom(z: number): number {
    if (!Number.isFinite(z)) {
      return this.zoomValue;
    }
    return Math.max(this.minZoom, Math.min(this.maxZoom, z));
  }

  screenToWorld(
    sx: number,
    sy: number,
    vw: number,
    vh: number,
  ): { x: number; y: number } {
    return {
      x: (sx - vw / 2) / this.zoomValue + this.xValue,
      y: (sy - vh / 2) / this.zoomValue + this.yValue,
    };
  }

  worldToScreen(
    wx: number,
    wy: number,
    vw: number,
    vh: number,
  ): { x: number; y: number } {
    return {
      x: (wx - this.xValue) * this.zoomValue + vw / 2,
      y: (wy - this.yValue) * this.zoomValue + vh / 2,
    };
  }

  /**
   * 把世界变换写入 ctx,之后按世界坐标绘制。
   * pixelRatio 是目标像素 / css 像素(直播为 dpr);originX/Y 是视口左上角在目标上的位置(目标像素),
   * 渲染到别的画布(截图、按目标分辨率重渲染)时用。
   */
  applyTo(
    ctx: CanvasRenderingContext2D,
    pixelRatio: number,
    vw: number,
    vh: number,
    originX = 0,
    originY = 0,
  ): void {
    const z = pixelRatio * this.zoomValue;
    ctx.setTransform(
      z,
      0,
      0,
      z,
      originX + pixelRatio * (vw / 2 - this.xValue * this.zoomValue),
      originY + pixelRatio * (vh / 2 - this.yValue * this.zoomValue),
    );
  }

  /** 以屏幕点为锚缩放,锚点下的世界点保持不动。 */
  zoomAt(sx: number, sy: number, vw: number, vh: number, nextZoom: number): void {
    const before = this.screenToWorld(sx, sy, vw, vh);
    this.zoom = nextZoom;
    const after = this.screenToWorld(sx, sy, vw, vh);
    this.x = this.xValue + before.x - after.x;
    this.y = this.yValue + before.y - after.y;
  }

  panBy(dx: number, dy: number): void {
    this.x = this.xValue - dx / this.zoomValue;
    this.y = this.yValue - dy / this.zoomValue;
  }

  /** 当前机位快照,配合 setView 保存/恢复取景。 */
  getView(): CameraView {
    return { x: this.xValue, y: this.yValue, zoom: this.zoomValue };
  }

  /** 瞬时设置机位(缺省字段保持不变,zoom 自动钳制,非有限值忽略)。 */
  setView(view: Partial<CameraView>): void {
    if (view.x !== undefined) {
      this.x = view.x;
    }
    if (view.y !== undefined) {
      this.y = view.y;
    }
    if (view.zoom !== undefined) {
      this.zoom = view.zoom;
    }
  }

  /**
   * 计算刚好把世界矩形(含边距 pad)框进视口的机位,不应用,供取景/运镜使用。
   * 非有限的包围盒或视口回落到当前机位 —— 一个 NaN 盒不该把镜头推到 maxZoom。
   */
  computeFitBounds(bounds: Bounds, viewport: Size, pad = 0): CameraView {
    const dw = bounds.maxX - bounds.minX;
    const dh = bounds.maxY - bounds.minY;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const p = Number.isFinite(pad) ? pad : 0;
    const usable =
      Number.isFinite(dw) &&
      Number.isFinite(dh) &&
      viewport.w > 0 &&
      viewport.h > 0 &&
      Number.isFinite(viewport.w) &&
      Number.isFinite(viewport.h);
    if (!usable) {
      return this.getView();
    }
    const w = Math.max(1, dw + p * 2);
    const h = Math.max(1, dh + p * 2);
    return {
      x: Number.isFinite(cx) ? cx : this.xValue,
      y: Number.isFinite(cy) ? cy : this.yValue,
      zoom: this.clampZoom(Math.min(viewport.w / w, viewport.h / h)),
    };
  }
}
