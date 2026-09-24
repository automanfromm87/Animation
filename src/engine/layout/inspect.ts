import type { CameraView } from '../camera/Camera';
import { ImplicitSurface } from '../implicit/ImplicitSurface';
import { Angle, AngleArc, Brace, BraceShape, RightAngle } from '../mobjects/annotations';
import { BarChart } from '../mobjects/charts';
import {
  Axes,
  FunctionGraph,
  ParametricCurve2D,
  Trace,
  formatTick,
  niceStep,
  stepMultiples,
} from '../mobjects/graphs';
import { Group } from '../mobjects/Group';
import { MObject } from '../mobjects/MObject';
import { NumberLine, NumberPlane } from '../mobjects/numberLine';
import { AreaUnderCurve, Bar, RiemannRectangles, SecantLine, TangentLine } from '../mobjects/plots';
import {
  Annotation,
  Arc,
  Arrow,
  Circle,
  Dot,
  Ellipse,
  Label,
  Line,
  PathShape,
  Polygon,
  Rectangle,
  RegularPolygon,
  Sector,
  Square,
  Star,
  SvgPath,
  Triangle,
  measureTextWidth,
} from '../mobjects/shapes';
import { Tex } from '../mobjects/tex';
import type { Bounds, MeasureContext, Size } from '../mobjects/types';
import { FALLBACK_MEASURE, boxBoundsInParent } from '../mobjects/types';
import { VectorField } from '../mobjects/vectorField';
import { Mesh3D } from '../mobjects3d/Mesh3D';
import { ParametricSurface } from '../mobjects3d/ParametricSurface';
import {
  Cone,
  Cube,
  Cuboid,
  Cylinder,
  Pyramid,
  Sphere,
  Tetrahedron,
  TriangularPrism,
} from '../mobjects3d/solids';
import { revealPartial } from '../path/pace';
import type { PathData } from '../path/path';
import { CanvasRenderer } from '../renderer/CanvasRenderer';
import type { Scene } from '../scene/Scene';
import type { Theme } from '../theme/Theme';
import { Layout } from './Layout';

/**
 * 版面检查的「截获 → 屏幕盒」两步:
 * captureRender 截下 Scene 某一次绘制用到的全部输入(根对象、主题、机位、视口),
 * inspectSnapshot 按与渲染相同的变换顺序遍历场景图,算出每个看得见的对象在视口里的屏幕盒。
 * 不读 Scene 的任何私有字段;规则(出画、互压……)在 issues.ts。
 */

/** 一次绘制用到的全部输入(截获时拷贝了根对象数组与机位;对象本身是活的,要在时间线推进之前用完)。 */
export interface RenderSnapshot {
  readonly roots: readonly MObject[];
  readonly theme: Theme;
  readonly view: CameraView;
  /** 视口 css 尺寸。 */
  readonly viewport: Size;
}

export interface CaptureOptions {
  /** 截到之后照常绘制,缺省 true;false 时跳过真正的绘制(画布保持上一帧)。 */
  draw?: boolean;
}

/**
 * 在 trigger 同步执行期间截获 Scene 的绘制(CanvasRenderer.render 与 renderInto 的入参),返回最后一次;没画就返回 null。
 * 只拦同步窗口:trigger 返回(或抛错)时立即恢复,异步代码与别的时刻的绘制不受影响。可嵌套。
 * 注意帧泵在跑时 scene.render() 只是记一笔、并不当场画 —— 用 ManualClock 的场景要在 trigger 里 advanceTo(now()) 推一帧。
 * @internal 诊断用(版面检查、故事板);它依赖 Scene 经由 CanvasRenderer 绘制这一实现细节,有测试钉住。
 */
export function captureRender(trigger: () => void, options?: CaptureOptions): RenderSnapshot | null {
  const proto = CanvasRenderer.prototype;
  const render = proto.render;
  const renderInto = proto.renderInto;
  const draw = options?.draw !== false;
  const got: { snap: RenderSnapshot | null } = { snap: null };
  proto.render = function capturedRender(this: CanvasRenderer, mobjects, theme, camera, vw, vh, pixelRatio) {
    got.snap = { roots: [...mobjects], theme, view: camera.getView(), viewport: { w: vw, h: vh } };
    if (draw) {
      render.call(this, mobjects, theme, camera, vw, vh, pixelRatio);
    }
  };
  proto.renderInto = function capturedRenderInto(this: CanvasRenderer, ctx, rect, mobjects, theme, camera, vw, vh) {
    got.snap = { roots: [...mobjects], theme, view: camera.getView(), viewport: { w: vw, h: vh } };
    if (draw) {
      renderInto.call(this, ctx, rect, mobjects, theme, camera, vw, vh);
    }
  };
  try {
    trigger();
  } finally {
    proto.render = render;
    proto.renderInto = renderInto;
  }
  return got.snap;
}

/** 屏幕盒的种类:文字(Tex / Label / 标注徽标里的字)、坐标轴画的刻度数字与轴名、其余图形。 */
export type LayoutItemKind = 'text' | 'tick-label' | 'graphic';

/** 世界相似变换(均匀缩放 + 旋转 + 平移),与 MObject.render 的变换顺序一致。 */
export interface LayoutTransform {
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scale: number;
}

/** 一个看得见的对象(或对象里的一块字)在这一帧的屏幕盒。 */
export interface LayoutItem {
  /** 同一进程内稳定的身份键:`${对象编号}` 或 `${对象编号}:${part}`(跨帧对比、跨时间合并用)。 */
  readonly key: string;
  /** 所属对象的编号(= key 里冒号之前的部分)。同一个坐标轴的刻度项共享它。 */
  readonly objectKey: string;
  readonly object: MObject;
  /** 对象里的部件:Axes 的 'x:0.5' / 'y:2' / 'name:x' / 'name:y',Annotation 的 'badge'。 */
  readonly part?: string;
  readonly kind: LayoutItemKind;
  /** 读得懂的描述:Tex「a^2」、Label「k = 1.00」、Axes 刻度「0.5」、Axes 轴名「x」、Annotation「A」、图形给类名。 */
  readonly label: string;
  /** 文字内容(TeX 源码 / 文本);图形没有。 */
  readonly text?: string;
  /** 视口 css 像素(左上原点,y 向下);旋转时为外接轴对齐盒;被 clip 的 Layout 裁过。 */
  readonly rect: Bounds;
  /**
   * 字形墨迹的大致范围(屏幕 css 像素),互压 / 压遮挡区按它判:Label 的盒是整个 em 框、刻度数字与轴名的盒是 1.25 倍行高,
   * 上下都有留白,只按盒子判会把「贴得近但没碰上」报成互压。公式的盒是排版出来的紧盒,与 rect 相同;图形也与 rect 相同。
   */
  readonly ink: Bounds;
  /** 世界坐标。 */
  readonly world: Bounds;
  /** 累积不透明度(祖先 × 自身 × 主题;坐标轴生长时刻度字另乘淡入系数)。 */
  readonly opacity: number;
  /** 描边生长比例,1 = 完整。 */
  readonly reveal: number;
  /** 屏幕字号(css px,= 字号 × 累积缩放 × zoom);图形为 0。 */
  readonly fontPx: number;
  /** 世界相似变换(线条命中检查用)。 */
  readonly transform: LayoutTransform;
  /**
   * 图形的路径(本地坐标;生长中的已按 reveal 截短),截获那一刻就取好:线条命中检查只用它、不读活对象
   * (采样之后时间线还会往前走)。null = 对象没有路径(按外接盒算);inspectSnapshot 传 paths: false 时不收(同 null)。文字项没有。
   */
  readonly path?: PathData | null;
}

/** 一帧里所有看得见的对象的屏幕盒。 */
export interface LayoutFrame {
  /** 视口 css 尺寸。 */
  readonly viewport: Size;
  readonly view: CameraView;
  readonly items: readonly LayoutItem[];
}

export interface InspectOptions {
  /** 低于它的累积不透明度当作看不见,缺省 0.02。 */
  minOpacity?: number;
  /** 收图形(遮挡区与线穿文字要用),缺省 true。 */
  graphics?: boolean;
  /** 给图形项取好路径(线条命中检查要用),缺省 true;只用来判运动的前瞻帧可以关掉省事。 */
  paths?: boolean;
}

const IDENTITY: LayoutTransform = { x: 0, y: 0, rotation: 0, scale: 1 };

/** 把子节点的局部变换合进父级(同 bounds.ts)。 */
function compose(parent: LayoutTransform, child: MObject): LayoutTransform {
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

const objectIds = new WeakMap<MObject, number>();
let nextObjectId = 1;

/** 对象在本进程内的稳定编号(版面检查跨帧对比、跨时间合并用)。 */
export function layoutObjectId(m: MObject): number {
  let id = objectIds.get(m);
  if (id === undefined) {
    id = nextObjectId++;
    objectIds.set(m, id);
  }
  return id;
}

/** 报告里的文字太长时截断(完整内容在 item.text 里)。 */
const LABEL_MAX_CHARS = 60;

function clipText(s: string): string {
  const chars = [...s];
  return chars.length > LABEL_MAX_CHARS ? `${chars.slice(0, LABEL_MAX_CHARS - 1).join('')}…` : s;
}

/**
 * 引擎类 → 报告里的类名。不用 constructor.name:生产构建压缩后类名会变成 e、t 这类短名。
 * 按原型链找最近的一个登记过的类(作者自己的子类报它的引擎父类)。
 */
const CLASS_NAMES = new Map<unknown, string>([
  [MObject, 'MObject'],
  [Group, 'Group'],
  [Layout, 'Layout'],
  [PathShape, 'PathShape'],
  [SvgPath, 'SvgPath'],
  [Circle, 'Circle'],
  [Rectangle, 'Rectangle'],
  [Square, 'Square'],
  [Line, 'Line'],
  [Dot, 'Dot'],
  [Polygon, 'Polygon'],
  [Ellipse, 'Ellipse'],
  [RegularPolygon, 'RegularPolygon'],
  [Triangle, 'Triangle'],
  [Star, 'Star'],
  [Arrow, 'Arrow'],
  [Arc, 'Arc'],
  [Sector, 'Sector'],
  [Annotation, 'Annotation'],
  [Axes, 'Axes'],
  [FunctionGraph, 'FunctionGraph'],
  [ParametricCurve2D, 'ParametricCurve2D'],
  [Trace, 'Trace'],
  [BraceShape, 'BraceShape'],
  [Brace, 'Brace'],
  [AngleArc, 'AngleArc'],
  [Angle, 'Angle'],
  [RightAngle, 'RightAngle'],
  [AreaUnderCurve, 'AreaUnderCurve'],
  [Bar, 'Bar'],
  [RiemannRectangles, 'RiemannRectangles'],
  [TangentLine, 'TangentLine'],
  [SecantLine, 'SecantLine'],
  [VectorField, 'VectorField'],
  [BarChart, 'BarChart'],
  [NumberLine, 'NumberLine'],
  [NumberPlane, 'NumberPlane'],
  [Mesh3D, 'Mesh3D'],
  [ParametricSurface, 'ParametricSurface'],
  [ImplicitSurface, 'ImplicitSurface'],
  [Cube, 'Cube'],
  [Cuboid, 'Cuboid'],
  [Pyramid, 'Pyramid'],
  [Tetrahedron, 'Tetrahedron'],
  [TriangularPrism, 'TriangularPrism'],
  [Cylinder, 'Cylinder'],
  [Cone, 'Cone'],
  [Sphere, 'Sphere'],
]);

function className(m: MObject): string {
  for (let proto: unknown = Object.getPrototypeOf(m); proto; proto = Object.getPrototypeOf(proto)) {
    const name = CLASS_NAMES.get((proto as { constructor?: unknown }).constructor);
    if (name !== undefined) {
      return name;
    }
  }
  return 'MObject';
}

/** 对象的中文描述:文字给类型 + 内容,图形给引擎类名。 */
export function describeObject(m: MObject): string {
  if (m instanceof Tex) {
    return `Tex「${clipText(m.tex)}」`;
  }
  if (m instanceof Label) {
    return `Label「${clipText(m.text)}」`;
  }
  return className(m);
}

/** 墨迹内缩(占盒高的比例,上下各一份):Label 的 em 框、坐标轴文字的 1.25 倍行框、标注徽标(圆框里半径大小的字)。 */
const INK_INSET_LABEL = 0.12;
const INK_INSET_LINE = 0.2;
const INK_INSET_BADGE = 0.3;

/** 坐标轴刻度数字的字号(与 graphs.ts 的 TICK_FONT_PX 一致)。 */
const AXES_TICK_PX = 10;
/** 坐标轴轴名的字号(与 graphs.ts 的 LABEL_FONT_PX 一致)。 */
const AXES_NAME_PX = 13;

interface PartBox {
  readonly part: string;
  readonly text: string;
  /** 所属对象的本地坐标。 */
  readonly box: Bounds;
  /** 字号(本地,未乘缩放)。 */
  readonly px: number;
  readonly label: string;
}

/** 以 (x, y) 为锚点、按对齐方式放置的文字框(同 graphs.ts 的 textBounds)。 */
function anchoredBox(
  x: number,
  y: number,
  w: number,
  h: number,
  align: 'left' | 'center' | 'right',
  baseline: 'top' | 'middle' | 'bottom',
): Bounds {
  const minX = align === 'left' ? x : align === 'right' ? x - w : x - w / 2;
  const minY = baseline === 'top' ? y : baseline === 'bottom' ? y - h : y - h / 2;
  return { minX, minY, maxX: minX + w, maxY: minY + h };
}

/**
 * 坐标轴画的刻度数字与轴名的本地文字框。刻度不是子对象(Axes 的私有字段),这里逐行复刻
 * Axes.buildTicks('x', 6) / ('y', 5)、axisOrigin 与 contentBounds 的文字框;
 * 有测试钉住「文字框 ∪ 线框 == axes.getBox()」,graphs.ts 改了算法这里会红。
 * @internal 导出只为测试。
 */
export function axesTextBoxes(axes: Axes): PartBox[] {
  const w = axes.width;
  const h = axes.height;
  const [xMin, xMax] = axes.xRange;
  const [yMin, yMax] = axes.yRange;
  const origin = axes.toLocal(0, 0);
  const x0 = xMin <= 0 && 0 <= xMax ? origin.x : xMax < 0 ? w / 2 : -w / 2;
  const y0 = yMin <= 0 && 0 <= yMax ? origin.y : yMax < 0 ? -h / 2 : h / 2;
  const ticks = (axis: 'x' | 'y', divisions: number): Array<{ pos: number; text: string }> => {
    const [min, max] = axis === 'x' ? axes.xRange : axes.yRange;
    const size = axis === 'x' ? w : h;
    const out: Array<{ pos: number; text: string }> = [];
    const values = stepMultiples(min, max, niceStep((max - min) / divisions));
    if (!values) {
      return out;
    }
    let lastText = '';
    for (const t of values) {
      const local = axis === 'x' ? axes.toLocal(t, 0).x : axes.toLocal(0, t).y;
      if (!Number.isFinite(local) || local < -size / 2 - 1e-6 || local > size / 2 + 1e-6) {
        continue;
      }
      const text = formatTick(t);
      if (text === lastText) {
        continue;
      }
      lastText = text;
      out.push({ pos: local, text });
    }
    return out;
  };
  const family = FALLBACK_MEASURE.fontFamily;
  const lineH = AXES_TICK_PX * 1.25;
  const parts: PartBox[] = [];
  for (const t of ticks('x', 6)) {
    const tw = measureTextWidth(t.text, AXES_TICK_PX, family);
    parts.push({
      part: `x:${t.text}`,
      text: t.text,
      box: anchoredBox(t.pos, y0 + 5, tw, lineH, 'center', 'top'),
      px: AXES_TICK_PX,
      label: `Axes 刻度「${t.text}」`,
    });
  }
  for (const t of ticks('y', 5)) {
    const tw = measureTextWidth(t.text, AXES_TICK_PX, family);
    parts.push({
      part: `y:${t.text}`,
      text: t.text,
      box: anchoredBox(x0 - 5, t.pos, tw, lineH, 'right', 'middle'),
      px: AXES_TICK_PX,
      label: `Axes 刻度「${t.text}」`,
    });
  }
  const nameH = AXES_NAME_PX * 1.25;
  if (axes.xLabel !== '') {
    const lw = measureTextWidth(axes.xLabel, AXES_NAME_PX, family) * 1.1;
    parts.push({
      part: 'name:x',
      text: axes.xLabel,
      box: anchoredBox(w / 2 + 6, y0, lw, nameH, 'left', 'middle'),
      px: AXES_NAME_PX,
      label: `Axes 轴名「${axes.xLabel}」`,
    });
  }
  if (axes.yLabel !== '') {
    const lw = measureTextWidth(axes.yLabel, AXES_NAME_PX, family) * 1.1;
    parts.push({
      part: 'name:y',
      text: axes.yLabel,
      box: anchoredBox(x0, -h / 2 - 6, lw, nameH, 'center', 'bottom'),
      px: AXES_NAME_PX,
      label: `Axes 轴名「${axes.yLabel}」`,
    });
  }
  return parts;
}

function boxOfBounds(b: Bounds): { size: Size; center: { x: number; y: number } } {
  return {
    size: { w: b.maxX - b.minX, h: b.maxY - b.minY },
    center: { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 },
  };
}

function intersect(a: Bounds, b: Bounds): Bounds | null {
  const r = {
    minX: Math.max(a.minX, b.minX),
    minY: Math.max(a.minY, b.minY),
    maxX: Math.min(a.maxX, b.maxX),
    maxY: Math.min(a.maxY, b.maxY),
  };
  return r.maxX >= r.minX && r.maxY >= r.minY ? r : null;
}

/** 此刻的路径(生长中按对象的笔速截取,与画出来的一致);没有路径或取路径抛错返回 null。 */
function pathAt(node: MObject, reveal: number): PathData | null {
  try {
    const path = node.toPath();
    return path && reveal < 1 ? revealPartial(path, reveal, node.getRevealPace()) : path;
  } catch {
    return null;
  }
}

function finite(b: Bounds): boolean {
  return (
    Number.isFinite(b.minX) &&
    Number.isFinite(b.minY) &&
    Number.isFinite(b.maxX) &&
    Number.isFinite(b.maxY)
  );
}

/**
 * 把截获的一帧变成屏幕盒列表:只收看得见的对象(累积不透明度 > minOpacity、生长比例 > 0、没在变形 / 书写中)。
 * 遍历顺序与变换同 MObject.render / worldBoundsInScene;文字沿容器链继承字号量盒。
 * 跳过:变形覆盖进行中的对象(Transform / Write 期间画的是覆盖层,几何不是 getBox,属于瞬态)、强调效果的临时放大。
 */
export function inspectSnapshot(snapshot: RenderSnapshot, options?: InspectOptions): LayoutFrame {
  const minOpacity = options?.minOpacity ?? 0.02;
  const withGraphics = options?.graphics !== false;
  const withPaths = options?.paths !== false;
  const { view, viewport, theme } = snapshot;
  const z = view.zoom;
  const toScreen = (b: Bounds): Bounds => ({
    minX: (b.minX - view.x) * z + viewport.w / 2,
    minY: (b.minY - view.y) * z + viewport.h / 2,
    maxX: (b.maxX - view.x) * z + viewport.w / 2,
    maxY: (b.maxY - view.y) * z + viewport.h / 2,
  });
  const themeOpacity = Number.isFinite(theme.opacity) ? theme.opacity : 1;
  const items: LayoutItem[] = [];
  const visiting = new Set<MObject>();

  /**
   * 本地盒 → 世界盒 + 屏幕盒 + 墨迹盒(都按裁剪框裁过);看不见或含非有限值时返回 null。
   * inkInset 是墨迹上下各内缩的比例(按裁剪前的屏幕盒高算)。
   */
  const place = (
    local: Bounds,
    t: LayoutTransform,
    clip: Bounds | null,
    inkInset = 0,
  ): { world: Bounds; rect: Bounds; ink: Bounds } | null => {
    const world = boxBoundsInParent(boxOfBounds(local), { x: t.x, y: t.y }, t.scale, t.rotation);
    if (!finite(world)) {
      return null;
    }
    const screen = toScreen(world);
    const rect = clip ? intersect(screen, clip) : screen;
    if (!rect) {
      return null;
    }
    const d = (screen.maxY - screen.minY) * inkInset;
    const inset = { minX: screen.minX, minY: screen.minY + d, maxX: screen.maxX, maxY: screen.maxY - d };
    const ink = inkInset > 0 ? (clip ? intersect(inset, clip) : inset) : rect;
    return { world, rect, ink: ink ?? { minX: rect.minX, minY: rect.minY, maxX: rect.minX, maxY: rect.minY } };
  };

  const walk = (
    node: MObject,
    parent: LayoutTransform,
    alpha: number,
    ctx: MeasureContext,
    clip: Bounds | null,
  ): void => {
    if (visiting.has(node)) {
      return;
    }
    const a = Math.min(1, alpha * node.opacity);
    if (!(a * themeOpacity > minOpacity) || node.getMorphOverlay() !== null) {
      return;
    }
    const t = compose(parent, node);
    const kids = node.getChildren();
    if (kids.length > 0) {
      const inner = node.childMeasureContext(ctx) ?? ctx;
      let innerClip = clip;
      if (node instanceof Layout && node.clip) {
        // 裁剪框就是容器自身的 width × height(以原点为中心,同 Layout.beforeChildren)。
        const hw = node.width / 2;
        const hh = node.height / 2;
        const frame = place({ minX: -hw, minY: -hh, maxX: hw, maxY: hh }, t, clip);
        if (!frame) {
          return;
        }
        innerClip = frame.rect;
      }
      visiting.add(node);
      for (const child of kids) {
        walk(child, t, a, inner, innerClip);
      }
      visiting.delete(node);
      return;
    }
    if (node instanceof Group) {
      // 空容器什么都不画。
      return;
    }
    const revealed = node.supportsReveal ? node.revealed() : null;
    const reveal = revealed ?? 1;
    if (!(reveal > 0)) {
      return;
    }
    let local: Bounds;
    try {
      const box = node.getBox(ctx);
      local = {
        minX: box.center.x - box.size.w / 2,
        minY: box.center.y - box.size.h / 2,
        maxX: box.center.x + box.size.w / 2,
        maxY: box.center.y + box.size.h / 2,
      };
    } catch {
      return;
    }
    const opacity = Math.min(1, a * themeOpacity);
    const id = String(layoutObjectId(node));
    const isText = node instanceof Tex || node instanceof Label;
    if (isText || withGraphics) {
      const placed = place(local, t, clip, node instanceof Label ? INK_INSET_LABEL : 0);
      if (placed) {
        const fontSize = isText ? (node.getStyleOverride().fontSize ?? ctx.fontSize) : 0;
        const path = !isText && withPaths ? pathAt(node, reveal) : undefined;
        items.push({
          key: id,
          objectKey: id,
          object: node,
          kind: isText ? 'text' : 'graphic',
          label: describeObject(node),
          ...(isText ? { text: node instanceof Tex ? node.tex : node.text } : {}),
          rect: placed.rect,
          ink: placed.ink,
          world: placed.world,
          opacity,
          reveal,
          fontPx: isText ? fontSize * Math.abs(t.scale) * z : 0,
          transform: t,
          ...(path !== undefined ? { path } : {}),
        });
      }
    }
    // 对象自己画的字:坐标轴的刻度数字与轴名、标注徽标里的字。
    let parts: PartBox[] = [];
    let partOpacity = opacity;
    let partKind: LayoutItemKind = 'text';
    if (node instanceof Axes) {
      parts = axesTextBoxes(node);
      partKind = 'tick-label';
      // 生长时文字在后半程淡入(同 Axes.drawRevealed)。
      partOpacity = revealed === null ? opacity : opacity * Math.max(0, (revealed - 0.5) * 2);
    } else if (node instanceof Annotation) {
      const r = node.badgeRadius;
      const { x, y } = node.offset;
      parts = [
        {
          part: 'badge',
          text: node.text,
          box: { minX: x - r, minY: y - r, maxX: x + r, maxY: y + r },
          px: r,
          label: `Annotation「${clipText(node.text)}」`,
        },
      ];
    }
    if (!(partOpacity > minOpacity)) {
      return;
    }
    for (const p of parts) {
      if (p.text === '') {
        continue;
      }
      const placed = place(p.box, t, clip, partKind === 'tick-label' ? INK_INSET_LINE : INK_INSET_BADGE);
      if (!placed) {
        continue;
      }
      items.push({
        key: `${id}:${p.part}`,
        objectKey: id,
        object: node,
        part: p.part,
        kind: partKind,
        label: p.label,
        text: p.text,
        rect: placed.rect,
        ink: placed.ink,
        world: placed.world,
        opacity: partOpacity,
        reveal,
        fontPx: p.px * Math.abs(t.scale) * z,
        transform: t,
      });
    }
  };

  const root: MeasureContext = { fontSize: theme.fontSize, fontFamily: theme.fontFamily };
  for (const r of snapshot.roots) {
    walk(r, IDENTITY, 1, root, null);
  }
  return { viewport: { w: viewport.w, h: viewport.h }, view: { ...view }, items };
}

/**
 * 自建场景 / 单测的便利入口:截获一次 scene.renderTo(不真的画),再 inspectSnapshot。
 * 帧泵在不在跑都能用(renderTo 不经过帧泵)。场景已销毁或视口为 0 时返回 null。
 */
export function inspectScene(scene: Scene, options?: InspectOptions): LayoutFrame | null {
  const vp = scene.getViewportSize();
  if (!(vp.w > 0 && vp.h > 0)) {
    return null;
  }
  // draw: false 时 renderInto 被拦下,根本不碰这个占位上下文。
  const placeholder = {} as CanvasRenderingContext2D;
  const snap = captureRender(() => scene.renderTo(placeholder, { width: 1, height: 1 }), { draw: false });
  return snap ? inspectSnapshot(snap, options) : null;
}
