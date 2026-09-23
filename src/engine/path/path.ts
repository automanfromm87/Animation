/**
 * 矢量路径:一切可变形、可描边生长的图形的共同表示(公式字形、圆、多边形、函数图像……)。
 * 每条子路径 = 起点 + 若干三次贝塞尔段;直线与二次曲线都升阶成三次,
 * 这样任意两条路径都能逐点对齐、插值(形状变形),也能按弧长截取(描边生长)。
 * PathData 视为不可变:缓存(弧长表、Path2D)都按对象身份挂靠,改点请生成新的 PathData。
 */

/** 一条子路径。points = [x0, y0, (c1x, c1y, c2x, c2y, x, y) × 段数]。 */
export interface Subpath {
  readonly points: readonly number[];
  /** 闭合:最后一个端点与起点重合(构造时已补上闭合段),填充与描边都按闭合处理。 */
  readonly closed: boolean;
}

export interface PathData {
  readonly subpaths: readonly Subpath[];
}

/** 仿射矩阵 [a, b, c, d, e, f]:x' = a·x + c·y + e,y' = b·x + d·y + f(与 canvas setTransform 同序)。 */
export type Affine = readonly [number, number, number, number, number, number];

export const IDENTITY_AFFINE: Affine = [1, 0, 0, 1, 0, 0];

export const EMPTY_PATH: PathData = Object.freeze({ subpaths: Object.freeze([]) });

/** 子路径的段数。 */
export function segmentCount(sub: Subpath): number {
  return Math.max(0, Math.floor((sub.points.length - 2) / 6));
}

/** 所有子路径的总段数。 */
export function totalSegments(path: PathData): number {
  let n = 0;
  for (const sub of path.subpaths) {
    n += segmentCount(sub);
  }
  return n;
}

export function isEmptyPath(path: PathData): boolean {
  return totalSegments(path) === 0;
}

/** m1 ∘ m2:先做 m2,再做 m1。 */
export function multiplyAffine(m1: Affine, m2: Affine): Affine {
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

/** 逆矩阵;奇异时返回 null。 */
export function invertAffine(m: Affine): Affine | null {
  const [a, b, c, d, e, f] = m;
  const det = a * d - b * c;
  if (!(Math.abs(det) > 1e-300) || !Number.isFinite(det)) {
    return null;
  }
  return [d / det, -b / det, -c / det, a / det, (c * f - d * e) / det, (b * e - a * f) / det];
}

/** position / scale / rotation(先缩放、再旋转、再平移,与 MObject.render 一致)对应的矩阵。 */
export function similarityAffine(x: number, y: number, scale: number, rotation: number): Affine {
  const cos = Math.cos(rotation) * scale;
  const sin = Math.sin(rotation) * scale;
  return [cos, sin, -sin, cos, x, y];
}

export function transformPath(path: PathData, m: Affine): PathData {
  const [a, b, c, d, e, f] = m;
  if (a === 1 && b === 0 && c === 0 && d === 1 && e === 0 && f === 0) {
    return path;
  }
  return {
    subpaths: path.subpaths.map((sub) => {
      const src = sub.points;
      const out = new Array<number>(src.length);
      for (let i = 0; i + 1 < src.length; i += 2) {
        const x = src[i] ?? 0;
        const y = src[i + 1] ?? 0;
        out[i] = a * x + c * y + e;
        out[i + 1] = b * x + d * y + f;
      }
      return { points: out, closed: sub.closed };
    }),
  };
}

export function concatPaths(paths: readonly PathData[]): PathData {
  if (paths.length === 1 && paths[0]) {
    return paths[0];
  }
  const subpaths: Subpath[] = [];
  for (const p of paths) {
    subpaths.push(...p.subpaths);
  }
  return { subpaths };
}

/**
 * 路径构造器,接口贴近 canvas:moveTo / lineTo / quadTo / cubicTo / arc / rect / close。
 * 直线升阶成控制点在三分点的三次段,二次曲线精确升阶。
 */
export class PathBuilder {
  private readonly done: Subpath[] = [];
  private points: number[] = [];
  private startX = 0;
  private startY = 0;
  private lastX = 0;
  private lastY = 0;
  private open = false;

  moveTo(x: number, y: number): this {
    this.flush(false);
    this.points = [x, y];
    this.startX = x;
    this.startY = y;
    this.lastX = x;
    this.lastY = y;
    this.open = true;
    return this;
  }

  lineTo(x: number, y: number): this {
    if (!this.open) {
      return this.moveTo(x, y);
    }
    const x0 = this.lastX;
    const y0 = this.lastY;
    return this.cubicTo(
      x0 + (x - x0) / 3,
      y0 + (y - y0) / 3,
      x0 + ((x - x0) * 2) / 3,
      y0 + ((y - y0) * 2) / 3,
      x,
      y,
    );
  }

  quadTo(cx: number, cy: number, x: number, y: number): this {
    if (!this.open) {
      this.moveTo(this.lastX, this.lastY);
    }
    const x0 = this.lastX;
    const y0 = this.lastY;
    return this.cubicTo(
      x0 + ((cx - x0) * 2) / 3,
      y0 + ((cy - y0) * 2) / 3,
      x + ((cx - x) * 2) / 3,
      y + ((cy - y) * 2) / 3,
      x,
      y,
    );
  }

  cubicTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number): this {
    if (!this.open) {
      this.moveTo(this.lastX, this.lastY);
    }
    this.points.push(c1x, c1y, c2x, c2y, x, y);
    this.lastX = x;
    this.lastY = y;
    return this;
  }

  /**
   * 圆弧(canvas 语义:y 向下,角度增大为顺时针;anticlockwise 反向)。
   * 已有子路径时先连一条直线到弧起点,否则从弧起点开新子路径。每段不超过 90°。
   */
  arc(cx: number, cy: number, r: number, a0: number, a1: number, anticlockwise = false): this {
    let sweep = a1 - a0;
    if (!anticlockwise && sweep < 0) {
      sweep = sweep % (Math.PI * 2) + Math.PI * 2;
    } else if (anticlockwise && sweep > 0) {
      sweep = (sweep % (Math.PI * 2)) - Math.PI * 2;
    }
    if (Math.abs(a1 - a0) >= Math.PI * 2) {
      sweep = anticlockwise ? -Math.PI * 2 : Math.PI * 2;
    }
    const sx = cx + r * Math.cos(a0);
    const sy = cy + r * Math.sin(a0);
    if (this.open) {
      this.lineTo(sx, sy);
    } else {
      this.moveTo(sx, sy);
    }
    const pieces = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2) - 1e-9));
    const step = sweep / pieces;
    const k = (4 / 3) * Math.tan(step / 4);
    let a = a0;
    for (let i = 0; i < pieces; i++) {
      const b = a + step;
      const cosA = Math.cos(a);
      const sinA = Math.sin(a);
      const cosB = Math.cos(b);
      const sinB = Math.sin(b);
      this.cubicTo(
        cx + r * (cosA - k * sinA),
        cy + r * (sinA + k * cosA),
        cx + r * (cosB + k * sinB),
        cy + r * (sinB - k * cosB),
        cx + r * cosB,
        cy + r * sinB,
      );
      a = b;
    }
    return this;
  }

  rect(x: number, y: number, w: number, h: number): this {
    return this.moveTo(x, y).lineTo(x + w, y).lineTo(x + w, y + h).lineTo(x, y + h).close();
  }

  /**
   * 闭合当前子路径:终点不在起点时补一条闭合直线段;
   * 只差浮点误差(整圆弧转回 2π 时 sin 不是精确的 0)就把终点吸到起点上,不补零长段。
   */
  close(): this {
    if (!this.open) {
      return this;
    }
    const n = this.points.length;
    if (n > 2) {
      const tol = 1e-9 * Math.max(1, Math.abs(this.startX), Math.abs(this.startY));
      if (Math.abs(this.lastX - this.startX) <= tol && Math.abs(this.lastY - this.startY) <= tol) {
        this.points[n - 2] = this.startX;
        this.points[n - 1] = this.startY;
      } else {
        this.lineTo(this.startX, this.startY);
      }
    }
    this.flush(true);
    this.lastX = this.startX;
    this.lastY = this.startY;
    return this;
  }

  build(): PathData {
    this.flush(false);
    return { subpaths: this.done.slice() };
  }

  private flush(closed: boolean): void {
    if (this.open && this.points.length > 2) {
      this.done.push({ points: this.points, closed });
    }
    this.points = [];
    this.open = false;
  }
}

/** 从折线点列造路径(相邻点之间直线段)。少于两个点返回空路径。 */
export function polylinePath(
  points: ReadonlyArray<{ x: number; y: number }>,
  closed = false,
): PathData {
  const first = points[0];
  if (!first || points.length < 2) {
    return EMPTY_PATH;
  }
  const b = new PathBuilder().moveTo(first.x, first.y);
  for (let i = 1; i < points.length; i++) {
    const p = points[i];
    if (p) {
      b.lineTo(p.x, p.y);
    }
  }
  if (closed) {
    b.close();
  }
  return b.build();
}

/** 三次贝塞尔一维分量在 [0,1] 内的极值参数。 */
function cubicExtrema(p0: number, p1: number, p2: number, p3: number, out: number[]): void {
  const a = -p0 + 3 * p1 - 3 * p2 + p3;
  const b = 2 * (p0 - 2 * p1 + p2);
  const c = p1 - p0;
  if (Math.abs(a) < 1e-12) {
    if (Math.abs(b) > 1e-12) {
      const t = -c / b;
      if (t > 0 && t < 1) {
        out.push(t);
      }
    }
    return;
  }
  const disc = b * b - 4 * a * c;
  if (disc < 0) {
    return;
  }
  const sq = Math.sqrt(disc);
  for (const t of [(-b + sq) / (2 * a), (-b - sq) / (2 * a)]) {
    if (t > 0 && t < 1) {
      out.push(t);
    }
  }
}

function cubicAt(p0: number, p1: number, p2: number, p3: number, t: number): number {
  const u = 1 - t;
  return u * u * u * p0 + 3 * u * u * t * p1 + 3 * u * t * t * p2 + t * t * t * p3;
}

export interface PathBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

/** 紧包围盒(含曲线极值点,不是控制点凸包)。空路径返回 null。 */
export function pathBounds(path: PathData): PathBounds | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  const include = (x: number, y: number): void => {
    if (Number.isFinite(x) && Number.isFinite(y)) {
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    }
  };
  const ts: number[] = [];
  for (const sub of path.subpaths) {
    const p = sub.points;
    if (p.length < 2) {
      continue;
    }
    include(p[0] ?? NaN, p[1] ?? NaN);
    for (let i = 2; i + 5 < p.length; i += 6) {
      const x0 = p[i - 2] ?? 0;
      const y0 = p[i - 1] ?? 0;
      const x1 = p[i] ?? 0;
      const y1 = p[i + 1] ?? 0;
      const x2 = p[i + 2] ?? 0;
      const y2 = p[i + 3] ?? 0;
      const x3 = p[i + 4] ?? 0;
      const y3 = p[i + 5] ?? 0;
      include(x3, y3);
      ts.length = 0;
      cubicExtrema(x0, x1, x2, x3, ts);
      cubicExtrema(y0, y1, y2, y3, ts);
      for (const t of ts) {
        include(cubicAt(x0, x1, x2, x3, t), cubicAt(y0, y1, y2, y3, t));
      }
    }
  }
  return minX === Infinity ? null : { minX, minY, maxX, maxY };
}

/** 以原点为圆心的保守外接半径(控制点凸包包住曲线,取控制点最远距离)。 */
export function maxPathRadius(path: PathData): number {
  let r = 0;
  for (const sub of path.subpaths) {
    const p = sub.points;
    for (let i = 0; i + 1 < p.length; i += 2) {
      const d = Math.hypot(p[i] ?? 0, p[i + 1] ?? 0);
      if (Number.isFinite(d)) {
        r = Math.max(r, d);
      }
    }
  }
  return r;
}
