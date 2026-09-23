import { Group } from '../mobjects/Group';
import type { MObject } from '../mobjects/MObject';
import { NO_STYLE } from '../mobjects/MObject';
import type { Point } from '../mobjects/types';
import type { PathLayer } from '../path/draw';
import type { Affine } from '../path/path';
import { multiplyAffine, pathBounds, similarityAffine, transformPath } from '../path/path';
import type { ResolvedStyle, StyleOverride } from '../theme/Theme';
import { lightTheme } from '../theme/presets';
import type { PlayContext } from './Animation';

/**
 * 形状变形(Transform)与逐字书写(Write)共用的对象树展开:把一个对象(可以是整棵 Group)
 * 摊平成按绘制顺序排列的叶子「片」,几何统一换算到做动画的那个对象(宿主)的本地坐标。
 */

/** 对象树里的一个叶子。 */
export interface Piece {
  readonly mobject: MObject;
  /** 叶子本地坐标 → 宿主本地坐标。 */
  readonly matrix: Affine;
  /** 叶子在所在位置解析出的样式。 */
  readonly style: ResolvedStyle;
  /** 根以下(不含根)一路到叶子(含)的不透明度之积;根自己的不透明度由宿主负责。 */
  readonly opacity: number;
  /** 宿主坐标里的分层几何(线宽、虚线已跟着缩放)。 */
  readonly layers: PathLayer[];
}

/** 对象自身的变换(先缩放、再旋转、再平移,与 MObject.render 一致)。 */
export function ownMatrix(m: MObject): Affine {
  return similarityAffine(m.position.x, m.position.y, m.scale, m.rotation);
}

/** 矩阵的线性缩放(面积比的平方根):线宽、虚线长度跟着它缩放。 */
export function matrixScale(m: Affine): number {
  return Math.sqrt(Math.abs(m[0] * m[3] - m[1] * m[2]));
}

function isIdentity(m: Affine): boolean {
  return m[0] === 1 && m[1] === 0 && m[2] === 0 && m[3] === 1 && m[4] === 0 && m[5] === 0;
}

/** 把一层换到另一个坐标系:路径逐点变换,线宽、虚线、书写轮廓线宽按比例缩放。 */
export function transformLayer(layer: PathLayer, m: Affine): PathLayer {
  if (isIdentity(m)) {
    return layer;
  }
  const k = matrixScale(m);
  const { paint } = layer;
  const moved: PathLayer = {
    path: transformPath(layer.path, m),
    paint: {
      fill: paint.fill,
      stroke: paint.stroke,
      strokeWidth: paint.strokeWidth * k,
      dash: paint.dash?.map((d) => d * k),
    },
  };
  return layer.outlineWidth === undefined ? moved : { ...moved, outlineWidth: layer.outlineWidth * k };
}

/** root 的子树里是否含有 target(不含 root 自己)。 */
export function subtreeHas(root: MObject, target: MObject): boolean {
  const stack = [...root.getChildren()];
  const seen = new Set<MObject>();
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined || seen.has(node)) {
      continue;
    }
    if (node === target) {
      return true;
    }
    seen.add(node);
    stack.push(...node.getChildren());
  }
  return false;
}

/**
 * 按绘制顺序(先序)摊平对象树。base 把 root 的本地坐标换到宿主坐标(root 就是宿主时为单位阵)。
 * 样式:有 PlayContext 用场景里解析出的(主题、容器继承都对);单独调用时按亮色主题沿容器链解析。
 * layersOf 取每个叶子的分层几何(pathLayers 或 writeLayers)。空 Group 不产生片。
 */
export function collectPieces(
  root: MObject,
  base: Affine,
  context: PlayContext | undefined,
  layersOf: (m: MObject, style: ResolvedStyle) => PathLayer[],
): Piece[] {
  const pieces: Piece[] = [];
  const visiting = new Set<MObject>();
  const visit = (
    node: MObject,
    matrix: Affine,
    opacity: number,
    inherited: Readonly<StyleOverride>,
  ): void => {
    const children = node.getChildren();
    if (children.length > 0 || node instanceof Group) {
      if (visiting.has(node)) {
        return;
      }
      visiting.add(node);
      const childInherited = node.childInheritedStyle(inherited);
      for (const child of children) {
        visit(child, multiplyAffine(matrix, ownMatrix(child)), opacity * child.opacity, childInherited);
      }
      visiting.delete(node);
      return;
    }
    const style = context ? context.styleOf(node) : node.getStyle(lightTheme, inherited);
    pieces.push({
      mobject: node,
      matrix,
      style,
      opacity,
      layers: layersOf(node, style).map((layer) => transformLayer(layer, matrix)),
    });
  };
  visit(root, base, 1, NO_STYLE);
  return pieces;
}

/** 一组层的包围盒中心;没有可量的几何返回 null。 */
function layersCenter(layers: readonly PathLayer[]): Point | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const layer of layers) {
    const b = pathBounds(layer.path);
    if (b) {
      minX = Math.min(minX, b.minX);
      minY = Math.min(minY, b.minY);
      maxX = Math.max(maxX, b.maxX);
      maxY = Math.max(maxY, b.maxY);
    }
  }
  return minX === Infinity ? null : { x: (minX + maxX) / 2, y: (minY + maxY) / 2 };
}

/** 一片的中心(宿主坐标):有几何按几何,没有(画布文字)按它的包围盒。 */
export function pieceCenter(piece: Piece): Point {
  const hit = layersCenter(piece.layers);
  if (hit) {
    return hit;
  }
  const { center } = piece.mobject.getBox({
    fontSize: piece.style.fontSize,
    fontFamily: piece.style.fontFamily,
  });
  const [a, b, c, d, e, f] = piece.matrix;
  return { x: a * center.x + c * center.y + e, y: b * center.x + d * center.y + f };
}

/** 一侧所有片的几何中心;一片几何都没有时用 fallback。 */
export function piecesCenter(pieces: readonly Piece[], fallback: Point): Point {
  return layersCenter(pieces.flatMap((p) => p.layers)) ?? (pieces[0] ? pieceCenter(pieces[0]) : fallback);
}
