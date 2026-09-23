import type { MObject } from './MObject';
import type { Bounds, MeasureContext, Point } from './types';
import { boxBoundsInParent, unionBounds } from './types';

/** 世界坐标下的轴对齐包围盒。 */
export type WorldBounds = Bounds;

/** 相似变换(均匀缩放 + 旋转 + 平移),与 MObject.render 的变换顺序一致。 */
interface Similarity {
  x: number;
  y: number;
  rotation: number;
  scale: number;
}

const IDENTITY: Similarity = { x: 0, y: 0, rotation: 0, scale: 1 };

/** 把子节点的局部变换合进父级。 */
function compose(parent: Similarity, child: MObject): Similarity {
  const cos = Math.cos(parent.rotation);
  const sin = Math.sin(parent.rotation);
  const sx = child.position.x * parent.scale;
  const sy = child.position.y * parent.scale;
  return {
    x: parent.x + sx * cos - sy * sin,
    y: parent.y + sx * sin + sy * cos,
    rotation: parent.rotation + child.rotation,
    scale: parent.scale * child.scale,
  };
}

function boundsUnder(
  m: MObject,
  parent: Similarity,
  context: MeasureContext | undefined,
): Bounds {
  const t = compose(parent, m);
  const position: Point = { x: t.x, y: t.y };
  return boxBoundsInParent(m.getBox(context), position, t.scale, t.rotation);
}

/**
 * 一组 MObject 的包围盒,只应用各自的 position/scale/rotation ——
 * 也就是把它们都当成场景根对象。嵌套在变换过的容器里的对象请用 worldBoundsInScene。
 * 空列表返回 null。
 */
export function worldBoundsOf(
  mobjects: readonly MObject[],
  context?: MeasureContext,
): WorldBounds | null {
  let acc: Bounds | null = null;
  for (const m of mobjects) {
    const b = boundsUnder(m, IDENTITY, context);
    acc = acc === null ? b : unionBounds(acc, b);
  }
  return acc;
}

/**
 * 真正的世界包围盒:沿场景图(roots 起)找到每个对象第一次出现的位置,
 * 组合全部祖先变换,文本度量也沿途继承容器的字号/字体。
 * 不在场景图里的对象按根对象处理。空列表返回 null。
 */
export function worldBoundsInScene(
  roots: readonly MObject[],
  objects: readonly MObject[],
  context?: MeasureContext,
): WorldBounds | null {
  if (objects.length === 0) {
    return null;
  }
  const wanted = new Set(objects);
  const found = new Map<MObject, { parent: Similarity; context: MeasureContext | undefined }>();
  const visiting = new Set<MObject>();
  const walk = (
    node: MObject,
    parent: Similarity,
    ctx: MeasureContext | undefined,
  ): void => {
    if (found.size === wanted.size || visiting.has(node)) {
      return;
    }
    if (wanted.has(node) && !found.has(node)) {
      found.set(node, { parent, context: ctx });
    }
    const children = node.getChildren();
    if (children.length === 0) {
      return;
    }
    visiting.add(node);
    const here = compose(parent, node);
    const inner = node.childMeasureContext(ctx);
    for (const child of children) {
      walk(child, here, inner);
    }
    visiting.delete(node);
  };
  for (const root of roots) {
    walk(root, IDENTITY, context);
  }
  let acc: Bounds | null = null;
  for (const m of objects) {
    const where = found.get(m);
    const b = boundsUnder(m, where?.parent ?? IDENTITY, where ? where.context : context);
    acc = acc === null ? b : unionBounds(acc, b);
  }
  return acc;
}
