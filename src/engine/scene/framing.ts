import type { Camera, CameraView } from '../camera/Camera';
import type { Bounds, Point, Size } from '../mobjects/types';

/** 四边内缩(屏幕 css 像素)。 */
export interface Insets {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

export const NO_INSETS: Readonly<Insets> = Object.freeze({ top: 0, bottom: 0, left: 0, right: 0 });

function finiteBounds(b: Bounds): boolean {
  return (
    Number.isFinite(b.minX) &&
    Number.isFinite(b.minY) &&
    Number.isFinite(b.maxX) &&
    Number.isFinite(b.maxY)
  );
}

/** 视口能不能用来取景(隐藏的画布 css 尺寸为 0)。 */
export function usableViewport(viewport: Size): boolean {
  return viewport.w > 0 && viewport.h > 0 && Number.isFinite(viewport.w) && Number.isFinite(viewport.h);
}

/**
 * 算出把世界包围盒(含边距)框进可用区的机位,不应用。
 * 可用区 = 视口减去安全区:按它的尺寸算缩放,内容中心落到可用区中心;零内缩时与直接 fit 一致。
 * 包围盒非有限或视口不可用时返回当前机位 —— 不能让一个 NaN 盒把镜头推偏或每次重取景都漂一点。
 */
export function computeFitView(
  camera: Camera,
  bounds: Bounds,
  pad: number,
  viewport: Size,
  safe: Readonly<Insets>,
): CameraView {
  if (!finiteBounds(bounds) || !usableViewport(viewport)) {
    return camera.getView();
  }
  const { w: vw, h: vh } = viewport;
  const wu = Math.max(1, vw - safe.left - safe.right);
  const hu = Math.max(1, vh - safe.top - safe.bottom);
  const base = camera.computeFitBounds(bounds, { w: wu, h: hu }, pad);
  const ux = safe.left + wu / 2;
  const uy = safe.top + hu / 2;
  return {
    x: base.x - (ux - vw / 2) / base.zoom,
    y: base.y - (uy - vh / 2) / base.zoom,
    zoom: base.zoom,
  };
}

/** 可用区中心相对视口中心的偏移(css 像素)。镜头跟随时让目标落在可用区中心用。 */
export function safeAreaCenterOffset(viewport: Size, safe: Readonly<Insets>): Point {
  const wu = Math.max(1, viewport.w - safe.left - safe.right);
  const hu = Math.max(1, viewport.h - safe.top - safe.bottom);
  return {
    x: safe.left + wu / 2 - viewport.w / 2,
    y: safe.top + hu / 2 - viewport.h / 2,
  };
}

/** 安全区数值消毒:非有限或负数一律按 0,NaN 不能进入取景计算。 */
export function sanitizeInset(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}
