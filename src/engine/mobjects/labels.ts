import type { MObject } from './MObject';
import { Label } from './shapes';
import { Tex } from './tex';
import type { MeasureContext, Point } from './types';
import { boxBoundsInParent } from './types';

/**
 * 标注图元(花括号、角标、数轴、图表……)共用的说明文字工具。内部模块,不在引擎总出口里。
 */

/** 字符串说明排成什么:'tex' 按 LaTeX 公式排(矢量字形,能变形),'label' 用画布文字(逐帧改读数也便宜)。 */
export type LabelKind = 'tex' | 'label';

/**
 * 字符串 → 说明文字对象。字号直接设在它自己身上:
 * 说明要按确定的尺寸摆到尖角 / 刻度外侧,字号跟着容器变的话摆好的位置就对不上了。
 */
export function makeLabel(text: string, kind: LabelKind, fontSize: number): MObject {
  const label = kind === 'tex' ? new Tex(text) : new Label(text);
  label.setStyle({ fontSize });
  return label;
}

/** 画布文字里的负号换成真正的减号(U+2212):连字符太短,和数学排版的负号对不齐。 */
export function typographicMinus(text: string): string {
  return text.replace(/^-/, '−');
}

/**
 * 把 label 摆到 anchor 沿 dir(单位向量)方向的外侧:包围盒离 anchor 最近的一边与它相距 gap,
 * 另一个方向上居中对齐 anchor。包围盒按 label 自身的缩放、旋转换算到父空间;
 * context 是量文字尺寸用的字号上下文(字号设在 label 自己身上时用不到)。
 */
export function placeOutside(
  label: MObject,
  anchor: Point,
  dir: Point,
  gap: number,
  context?: MeasureContext,
): void {
  const b = boxBoundsInParent(label.getBox(context), { x: 0, y: 0 }, label.scale, label.rotation);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  const reach = (Math.abs(dir.x) * (b.maxX - b.minX) + Math.abs(dir.y) * (b.maxY - b.minY)) / 2;
  label.moveTo({
    x: anchor.x + dir.x * (gap + reach) - cx,
    y: anchor.y + dir.y * (gap + reach) - cy,
  });
}

/** 正的有限数,否则抛错(name 写进报错里)。 */
export function requirePositive(name: string, value: number): number {
  if (!Number.isFinite(value) || !(value > 0)) {
    throw new Error(`${name} 需要一个正的有限数,收到 ${value}`);
  }
  return value;
}

/** 有限数,否则抛错。 */
export function requireFinite(name: string, value: number): number {
  if (!Number.isFinite(value)) {
    throw new Error(`${name} 需要一个有限数,收到 ${value}`);
  }
  return value;
}

/** 数值区间 [min, max]:两端有限且 max > min,否则抛错。返回拷贝。 */
export function requireRange(
  name: string,
  range: readonly [number, number] | readonly [number, number, number?],
): [number, number] {
  const [min, max] = range;
  if (!Number.isFinite(min) || !Number.isFinite(max) || !(max > min)) {
    throw new Error(`${name} 需要有限且 max > min 的区间,收到 [${min}, ${max}]`);
  }
  return [min, max];
}
