export interface Point {
  x: number;
  y: number;
}

/**
 * 线性插值。t===1 时直接返回 b:`a + (b-a)*1` 在浮点下未必逐位等于 b,
 * 而动画的终态精确性(以及依赖「机位是否等于目标」的取景判定)需要它精确。
 */
export function lerp(a: number, b: number, t: number): number {
  if (t === 1) {
    return b;
  }
  return a + (b - a) * t;
}

export function lerpPoint(from: Point, to: Point, t: number): Point {
  return { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) };
}

export interface Size {
  w: number;
  h: number;
}

/** 测量上下文:文本类 MObject 测尺寸需要的字号信息。 */
export interface MeasureContext {
  fontSize: number;
  fontFamily: string;
}

/**
 * 没有 MeasureContext 时的兜底字号/字体(与 lightTheme 一致)。
 * mobjects 层不依赖 theme/presets,所以唯一的一份定义放在这里。
 * 正常路径请通过 Scene.measureContext() 把当前主题的字号传下来。
 */
export const FALLBACK_MEASURE: Readonly<MeasureContext> = Object.freeze({
  fontSize: 28,
  fontFamily: 'Georgia, "Times New Roman", serif',
});

let measureGen = 0;

/**
 * 文本度量代号:网页字体加载完成这类「同样的内容量出来的尺寸可能变了」的时刻递增。
 * 一次性排版的消费方(Layout、Scene 的取景)记下当时的代号,变了就知道该重算。
 */
export function measureGeneration(): number {
  return measureGen;
}

/** 渲染层在字体加载完成时调用;mobjects 层只读代号。 */
export function bumpMeasureGeneration(): void {
  measureGen += 1;
}

/** 轴对齐矩形(min/max 形式)。 */
export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/**
 * 本地盒经 position/scale/rotation(先缩放、再旋转、再平移,与 MObject.render 一致)
 * 变换后的轴对齐外接矩形。负 scale 等价于转 180°,角点数学自然覆盖。
 * Group.getBox、worldBoundsOf、Layout 共用这一份,不再各写各的角点变换。
 */
export function boxBoundsInParent(
  box: Box,
  position: Point,
  scale: number,
  rotation: number,
): Bounds {
  const hw = box.size.w / 2;
  const hh = box.size.h / 2;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let k = 0; k < 4; k++) {
    const gx = (box.center.x + (k & 1 ? hw : -hw)) * scale;
    const gy = (box.center.y + (k & 2 ? hh : -hh)) * scale;
    const x = position.x + gx * cos - gy * sin;
    const y = position.y + gx * sin + gy * cos;
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  }
  return { minX, minY, maxX, maxY };
}

/** 两个矩形的并集(写回 into)。 */
export function unionBounds(into: Bounds, b: Bounds): Bounds {
  into.minX = Math.min(into.minX, b.minX);
  into.minY = Math.min(into.minY, b.minY);
  into.maxX = Math.max(into.maxX, b.maxX);
  into.maxY = Math.max(into.maxY, b.maxY);
  return into;
}

/** 点集到原点的最大距离(剔除半径用),跳过非有限点。 */
export function maxPointRadius(points: readonly Point[]): number {
  let r = 0;
  for (const p of points) {
    if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
      r = Math.max(r, Math.hypot(p.x, p.y));
    }
  }
  return r;
}

/**
 * 本地包围盒。size 为未乘 scale 的尺寸;
 * center 为包围盒中心相对 position 的偏移(大多居中为 0,Line/Group 等不对称)。
 */
export interface Box {
  size: Size;
  center: Point;
}

/** 居中盒。 */
export function boxFromSize(w: number, h: number): Box {
  return { size: { w, h }, center: { x: 0, y: 0 } };
}

/** 点集包围盒,跳过非有限坐标;空集返回零盒。 */
export function boxFromPoints(points: readonly Point[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (Number.isFinite(p.x) && Number.isFinite(p.y)) {
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x);
      maxY = Math.max(maxY, p.y);
    }
  }
  if (minX === Infinity) {
    return boxFromSize(0, 0);
  }
  return {
    size: { w: maxX - minX, h: maxY - minY },
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
  };
}

/** 四周均匀外扩(中心不变)。 */
export function expandBox(box: Box, pad: number): Box {
  return {
    size: { w: box.size.w + pad * 2, h: box.size.h + pad * 2 },
    center: { ...box.center },
  };
}
