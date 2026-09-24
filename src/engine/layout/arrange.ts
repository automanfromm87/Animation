import type { CameraView } from '../camera/Camera';
import { MObject } from '../mobjects/MObject';
import type { Bounds, MeasureContext, Point } from '../mobjects/types';
import { boxBoundsInParent } from '../mobjects/types';
import type { Scene } from '../scene/Scene';

/**
 * 排版助手(Manim 的 next_to / align_to / arrange):全部按**视觉外接盒**算,只平移(fitWidth / fitWithin 例外,改 scale)。
 * 组的原点不在内容中心也照样对 —— 实现统一是「量外接盒 → m.shift(dx, dy)」,从不 moveTo 原点。
 *
 * 约定:
 * - m 与作为参照的对象必须在**同一个父坐标系**下(都是场景根,或同一个 Group 的兄弟)。跨容器时传 Bounds。
 *   MObject 不知道自己的父节点,所以这一条没法在运行时检查。
 * - 一次性:和 Layout 不同,网页字体晚到后不会自动重摆(Label 宽度可能变,Tex 不受影响)。
 * - 文字按 context 量:字号设在对象自身(tex() / label() 都是)时与 context 无关;
 *   容器设了字号的子元素要传 scene.measureContext()。缺省按兜底字号 28。
 */

/** 四个方向(y 向下:'down' 是屏幕下方)。 */
export type Side = 'left' | 'right' | 'up' | 'down';
/** 交叉轴对齐:start = 左 / 上,end = 右 / 下。 */
export type CrossAlign = 'start' | 'center' | 'end';
/** 参照物:对象(取它在父空间的外接盒)、矩形,或一个点(当作零尺寸矩形)。 */
export type LayoutTarget = MObject | Bounds | Point;

/** 缺省间距(世界单位)。 */
const DEFAULT_BUFF = 16;

function finiteBounds(b: Bounds): boolean {
  return (
    Number.isFinite(b.minX) &&
    Number.isFinite(b.minY) &&
    Number.isFinite(b.maxX) &&
    Number.isFinite(b.maxY)
  );
}

function requireFiniteBounds(fn: string, what: string, b: Bounds): Bounds {
  if (!finiteBounds(b)) {
    throw new Error(`${fn}:${what}的外接盒含非有限值(坐标算出了 NaN?)`);
  }
  return b;
}

function requireFinite(fn: string, what: string, v: number): number {
  if (!Number.isFinite(v)) {
    throw new Error(`${fn}:${what}必须是有限数,收到 ${v}`);
  }
  return v;
}

function requirePositive(fn: string, what: string, v: number): number {
  if (!(v > 0) || !Number.isFinite(v)) {
    throw new Error(`${fn}:${what}必须是正的有限数,收到 ${v}`);
  }
  return v;
}

function isBounds(t: Bounds | Point): t is Bounds {
  return 'minX' in t;
}

/** m 在父坐标系里的视觉外接盒:本地盒经自身 position / scale / rotation 变换(含旋转角点)。 */
export function boundsOf(m: MObject, context?: MeasureContext): Bounds {
  return boxBoundsInParent(m.getBox(context), m.position, m.scale, m.rotation);
}

/** 参照物的外接盒(对象 / 矩形 / 点),含非有限值时抛错。 */
function targetBounds(fn: string, target: LayoutTarget, context?: MeasureContext): Bounds {
  if (target instanceof MObject) {
    return requireFiniteBounds(fn, '目标', boundsOf(target, context));
  }
  const b = isBounds(target)
    ? { minX: target.minX, minY: target.minY, maxX: target.maxX, maxY: target.maxY }
    : { minX: target.x, minY: target.y, maxX: target.x, maxY: target.y };
  return requireFiniteBounds(fn, '目标', b);
}

function centerOf(b: Bounds): Point {
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

/** 交叉轴上把 [lo, hi] 对齐到 [tlo, thi] 要平移的量。 */
function crossShift(align: CrossAlign, lo: number, hi: number, tlo: number, thi: number): number {
  if (align === 'start') {
    return tlo - lo;
  }
  if (align === 'end') {
    return thi - hi;
  }
  return (tlo + thi) / 2 - (lo + hi) / 2;
}

/** 平移 m,让它的外接盒中心落在 p(组的原点不在中心时用它,不用 moveTo)。返回 m。 */
export function centerAt<T extends MObject>(m: T, p: Point, context?: MeasureContext): T {
  requireFinite('centerAt', '目标点 x ', p.x);
  requireFinite('centerAt', '目标点 y ', p.y);
  const c = centerOf(requireFiniteBounds('centerAt', '对象', boundsOf(m, context)));
  m.shift(p.x - c.x, p.y - c.y);
  return m;
}

export interface NextToOptions {
  /** 两盒间距(世界单位),缺省 16;可以为负(故意压一点)。 */
  buff?: number;
  /** 交叉轴对齐,缺省 'center'。 */
  align?: CrossAlign;
  context?: MeasureContext;
}

/**
 * Manim 的 next_to:把 m 摆到 target 的 side 一侧,外接盒相距 buff,交叉轴按 align 对齐。只平移 m。
 * 第 4 个参数可以直接写间距数字、第 5 个写 context,与旧版 README §6.9 的复制片段 `nextTo(b, a, side, buff, ctx)` 兼容。
 * align 对 left / right 是纵向(start = 顶对齐),对 up / down 是横向(start = 左对齐)。返回 m。
 */
export function nextTo<T extends MObject>(
  m: T,
  target: LayoutTarget,
  side: Side,
  options?: number | NextToOptions,
  context?: MeasureContext,
): T {
  const o: NextToOptions = typeof options === 'number' ? { buff: options } : (options ?? {});
  const ctx = o.context ?? context;
  if (target === m) {
    throw new Error('nextTo:不能以对象自己为参照');
  }
  const buff = requireFinite('nextTo', '间距 buff ', o.buff ?? DEFAULT_BUFF);
  const align = o.align ?? 'center';
  const t = targetBounds('nextTo', target, ctx);
  const b = requireFiniteBounds('nextTo', '对象', boundsOf(m, ctx));
  let dx = 0;
  let dy = 0;
  if (side === 'left' || side === 'right') {
    dx = side === 'right' ? t.maxX + buff - b.minX : t.minX - buff - b.maxX;
    dy = crossShift(align, b.minY, b.maxY, t.minY, t.maxY);
  } else {
    dy = side === 'down' ? t.maxY + buff - b.minY : t.minY - buff - b.maxY;
    dx = crossShift(align, b.minX, b.maxX, t.minX, t.maxX);
  }
  m.shift(dx, dy);
  return m;
}

/** 对齐哪条边(或中线)。 */
export type AlignEdge = 'left' | 'right' | 'top' | 'bottom' | 'centerX' | 'centerY';

/** Manim 的 align_to:平移 m,让它外接盒的某条边(或中线)与 target 的同一条边对齐。只动一个方向。返回 m。 */
export function alignTo<T extends MObject>(
  m: T,
  target: LayoutTarget,
  edge: AlignEdge,
  context?: MeasureContext,
): T {
  if (target === m) {
    throw new Error('alignTo:不能以对象自己为参照');
  }
  const t = targetBounds('alignTo', target, context);
  const b = requireFiniteBounds('alignTo', '对象', boundsOf(m, context));
  switch (edge) {
    case 'left':
      m.shift(t.minX - b.minX, 0);
      break;
    case 'right':
      m.shift(t.maxX - b.maxX, 0);
      break;
    case 'top':
      m.shift(0, t.minY - b.minY);
      break;
    case 'bottom':
      m.shift(0, t.maxY - b.maxY);
      break;
    case 'centerX':
      m.shift((t.minX + t.maxX) / 2 - (b.minX + b.maxX) / 2, 0);
      break;
    case 'centerY':
      m.shift(0, (t.minY + t.maxY) / 2 - (b.minY + b.maxY) / 2);
      break;
  }
  return m;
}

export interface ArrangeOptions {
  /** 排列方向,缺省 'right'(横排,从左到右);'down' 竖排从上到下;'left' / 'up' 反向。 */
  direction?: Side;
  /** 相邻外接盒间距(世界单位),缺省 16。 */
  buff?: number;
  /** 交叉轴对齐,缺省 'center'。 */
  align?: CrossAlign;
  /** 排好后整排外接盒的中心;缺省 = 排列前这些对象外接盒并集的中心(整排原地重排)。 */
  at?: Point;
  context?: MeasureContext;
}

/**
 * Manim 的 arrange:按数组顺序一个接一个排(外接盒首尾相距 buff),交叉轴对齐,整排中心落在 at。
 * 只 shift 各对象(组的原点无所谓);对象保持各自独立(可以分别 FadeIn、各自进 stage),与固定尺寸的 Layout 容器互补。
 * 各对象要在同一个父坐标系下。返回整排的外接盒;空数组返回 null、什么都不做。
 */
export function arrange(objects: readonly MObject[], options?: ArrangeOptions): Bounds | null {
  if (objects.length === 0) {
    return null;
  }
  if (new Set(objects).size !== objects.length) {
    throw new Error('arrange:同一个对象出现了两次');
  }
  const ctx = options?.context;
  const direction = options?.direction ?? 'right';
  const buff = requireFinite('arrange', '间距 buff ', options?.buff ?? DEFAULT_BUFF);
  const align = options?.align ?? 'center';
  const boxes = objects.map((m) => requireFiniteBounds('arrange', '对象', boundsOf(m, ctx)));
  const horizontal = direction === 'left' || direction === 'right';
  // 交叉轴的参照:所有盒子并集在交叉轴上的范围(start / end 对齐到最靠边的那个)。
  let crossLo = Infinity;
  let crossHi = -Infinity;
  let union: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const b of boxes) {
    crossLo = Math.min(crossLo, horizontal ? b.minY : b.minX);
    crossHi = Math.max(crossHi, horizontal ? b.maxY : b.maxX);
    union = {
      minX: Math.min(union.minX, b.minX),
      minY: Math.min(union.minY, b.minY),
      maxX: Math.max(union.maxX, b.maxX),
      maxY: Math.max(union.maxY, b.maxY),
    };
  }
  const at = options?.at ?? centerOf(union);
  requireFinite('arrange', '中心 at.x ', at.x);
  requireFinite('arrange', '中心 at.y ', at.y);
  // 先在以 0 为起点的主轴上排好(沿 direction 前进),再整体平移到 at。
  const sign = direction === 'right' || direction === 'down' ? 1 : -1;
  const placed: Bounds[] = [];
  let cursor = 0;
  boxes.forEach((b, i) => {
    const w = horizontal ? b.maxX - b.minX : b.maxY - b.minY;
    const lo = sign > 0 ? cursor : cursor - w;
    const mainShift = lo - (horizontal ? b.minX : b.minY);
    const cross = crossShift(
      align,
      horizontal ? b.minY : b.minX,
      horizontal ? b.maxY : b.maxX,
      crossLo,
      crossHi,
    );
    const dx = horizontal ? mainShift : cross;
    const dy = horizontal ? cross : mainShift;
    placed.push({ minX: b.minX + dx, minY: b.minY + dy, maxX: b.maxX + dx, maxY: b.maxY + dy });
    cursor = sign > 0 ? lo + w + buff : lo - buff;
    objects[i]?.shift(dx, dy);
  });
  let row: Bounds = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const b of placed) {
    row = {
      minX: Math.min(row.minX, b.minX),
      minY: Math.min(row.minY, b.minY),
      maxX: Math.max(row.maxX, b.maxX),
      maxY: Math.max(row.maxY, b.maxY),
    };
  }
  const c = centerOf(row);
  const ox = at.x - c.x;
  const oy = at.y - c.y;
  for (const m of objects) {
    m.shift(ox, oy);
  }
  return { minX: row.minX + ox, minY: row.minY + oy, maxX: row.maxX + ox, maxY: row.maxY + oy };
}

/** 只缩不放:外接盒超过 maxWidth × maxHeight 时按较小的比例缩 scale,绕外接盒中心缩(位置不跳)。 */
function shrinkToFit(
  fn: string,
  m: MObject,
  maxWidth: number,
  maxHeight: number,
  context?: MeasureContext,
): void {
  const b = requireFiniteBounds(fn, '对象', boundsOf(m, context));
  const w = b.maxX - b.minX;
  const h = b.maxY - b.minY;
  const k = Math.min(w > maxWidth ? maxWidth / w : 1, h > maxHeight ? maxHeight / h : 1);
  if (!(k < 1)) {
    return;
  }
  const before = centerOf(b);
  m.scale *= k;
  const after = centerOf(boundsOf(m, context));
  m.shift(before.x - after.x, before.y - after.y);
}

/**
 * 只缩不放:外接盒宽超过 maxWidth 时把 scale 乘以 maxWidth / 宽,绕外接盒中心缩(位置不跳)。
 * 竖屏里放不下的长公式用它收一收。外接盒宽为 0 时什么都不做。返回 m。
 */
export function fitWidth<T extends MObject>(m: T, maxWidth: number, context?: MeasureContext): T {
  shrinkToFit('fitWidth', m, requirePositive('fitWidth', '最大宽度 ', maxWidth), Infinity, context);
  return m;
}

/** 同 fitWidth,宽高都限制(取两者中更小的比例)。返回 m。 */
export function fitWithin<T extends MObject>(
  m: T,
  maxWidth: number,
  maxHeight: number,
  context?: MeasureContext,
): T {
  shrinkToFit(
    'fitWithin',
    m,
    requirePositive('fitWithin', '最大宽度 ', maxWidth),
    requirePositive('fitWithin', '最大高度 ', maxHeight),
    context,
  );
  return m;
}

/**
 * 把 m 推回矩形 rect(父空间,四周内缩 margin,缺省 0)里:超出哪边就往回平移多少。
 * 某个方向比可用区还大时在该方向居中并返回 false;放得下返回 true。
 * 想让标签留在画面里(推近 / 重新取景之后别半截露在边上),rect 用 visibleWorldBounds:
 * `keepInside(b, visibleWorldBounds(scene, { view: scene.getFitView([sq], 20) }) ?? rect, 8)` —— m 要是场景根对象。
 */
export function keepInside(
  m: MObject,
  rect: Bounds,
  margin = 0,
  context?: MeasureContext,
): boolean {
  requireFinite('keepInside', '边距 margin ', margin);
  const r = requireFiniteBounds('keepInside', '区域', rect);
  const inner: Bounds = {
    minX: r.minX + margin,
    minY: r.minY + margin,
    maxX: r.maxX - margin,
    maxY: r.maxY - margin,
  };
  const b = requireFiniteBounds('keepInside', '对象', boundsOf(m, context));
  let fits = true;
  const axis = (lo: number, hi: number, ilo: number, ihi: number): number => {
    if (hi - lo > ihi - ilo) {
      fits = false;
      return (ilo + ihi) / 2 - (lo + hi) / 2;
    }
    if (lo < ilo) {
      return ilo - lo;
    }
    if (hi > ihi) {
      return ihi - hi;
    }
    return 0;
  };
  const dx = axis(b.minX, b.maxX, inner.minX, inner.maxX);
  const dy = axis(b.minY, b.maxY, inner.minY, inner.maxY);
  if (dx !== 0 || dy !== 0) {
    m.shift(dx, dy);
  }
  return fits;
}

export interface VisibleBoundsOptions {
  /** 扣掉安全区(有字幕的影片分段底部那一带),缺省 true —— 就是取景的可用区;false 为整个视口。 */
  safe?: boolean;
  /** 按这个机位算,缺省当前机位。运镜之前想知道终点的可见区,传 scene.getFitView(对象, pad)(playFit 落到的就是它)。 */
  view?: CameraView;
  /** 四周再内缩的屏幕 css 像素(留点呼吸),缺省 0。 */
  marginPx?: number;
}

/**
 * 画面里看得见的世界矩形(场景根的坐标系):视口(缺省再扣掉安全区)按机位换算到世界。
 * 配合 keepInside 把字拉回画面、配合 nextTo / arrange 贴着画边摆。视口为 0(画布隐藏)时返回 null。
 * 一次性:机位或视口变了(运镜、转竖屏)要重新取。
 */
export function visibleWorldBounds(scene: Scene, options?: VisibleBoundsOptions): Bounds | null {
  const vp = scene.getViewportSize();
  if (!(vp.w > 0 && vp.h > 0) || !Number.isFinite(vp.w) || !Number.isFinite(vp.h)) {
    return null;
  }
  const view = options?.view ?? scene.getCamera().getView();
  requirePositive('visibleWorldBounds', '机位的 zoom ', view.zoom);
  requireFinite('visibleWorldBounds', '机位的 x ', view.x);
  requireFinite('visibleWorldBounds', '机位的 y ', view.y);
  const margin = requireFinite('visibleWorldBounds', '边距 marginPx ', options?.marginPx ?? 0);
  const safe = options?.safe === false ? { top: 0, bottom: 0, left: 0, right: 0 } : scene.getSafeArea();
  // 屏幕 → 世界(同 Camera.screenToWorld,机位可以是还没落下的运镜终点)。
  const toWorldX = (sx: number): number => (sx - vp.w / 2) / view.zoom + view.x;
  const toWorldY = (sy: number): number => (sy - vp.h / 2) / view.zoom + view.y;
  let minX = toWorldX(safe.left + margin);
  let maxX = toWorldX(vp.w - safe.right - margin);
  let minY = toWorldY(safe.top + margin);
  let maxY = toWorldY(vp.h - safe.bottom - margin);
  // 安全区 + 边距比视口还大:缩成可用区中心的一条线 / 一个点,不给反向矩形。
  if (maxX < minX) {
    minX = maxX = (minX + maxX) / 2;
  }
  if (maxY < minY) {
    minY = maxY = (minY + maxY) / 2;
  }
  return { minX, minY, maxX, maxY };
}
