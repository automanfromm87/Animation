import { Group } from '../mobjects/Group';
import type { MObject } from '../mobjects/MObject';
import { NO_STYLE } from '../mobjects/MObject';
import type { StyleOverride, Theme } from '../theme/Theme';
import { Anchor3D } from './Anchor3D';
import { Mesh3D } from './Mesh3D';
import { isAutoOccludable } from './occlusion';
import type { AutoOccludable } from './occlusion';
import { Projection3D, hasProjection } from './Projection3D';
import { Stroke3D } from './Stroke3D';

const NO_MESHES: readonly Mesh3D[] = Object.freeze([]);

/** 子树里有没有满足 test 的对象(含自己)。 */
function subtreeHas(m: MObject, test: (node: MObject) => boolean): boolean {
  const stack: MObject[] = [m];
  const seen = new Set<MObject>();
  while (stack.length > 0) {
    const node = stack.pop();
    if (node === undefined || seen.has(node)) {
      continue;
    }
    seen.add(node);
    if (test(node)) {
      return true;
    }
    stack.push(...node.getChildren());
  }
  return false;
}

/** 绘制层:含网格的 0,含线条的 1,其它(标注、2D)2。 */
function layerOf(m: MObject): number {
  if (subtreeHas(m, (node) => node instanceof Mesh3D)) {
    return 0;
  }
  return subtreeHas(m, (node) => node instanceof Stroke3D) ? 1 : 2;
}

/**
 * Space3D:一个 3D 空间(一个灭点)。放进来的网格、线条、标注:
 * 1) 一律用空间的视角(add 时递归设好,每次 render 再检查一遍,晚加进嵌套组的也跟上);
 * 2) 顶层子元素按「含网格的 → 含线条的 → 其它(标注、2D)」稳定排序,网格总先画
 *    (只在 add 时排;往已加入的嵌套组里再加网格不会重排);
 * 3) 没显式给 occluders 的线条 / 标注 / 刻度,自动被空间里的全部网格遮挡。
 * 空间自己的 position 是灭点;里面的 3D 对象应留在 (0, 0),要挪就挪整个空间(不在原点会告警一次)。
 * 并排的两个立体各放一个 Space3D(可以共用同一个 Projection3D)。
 * 网格不能 Create,所以 Create(space) 不行;对里面的线条单独 Create。
 */
export class Space3D extends Group {
  private projection: Projection3D;
  /** 上次发布的自动遮挡表:内容没变就复用同一个数组。 */
  private published: readonly Mesh3D[] = NO_MESHES;
  private readonly warnedFrame = new WeakSet<MObject>();

  constructor(projection?: Projection3D) {
    super();
    this.projection = projection ?? new Projection3D();
  }

  getProjection(): Projection3D {
    return this.projection;
  }

  /** 换视角:空间里的全部 3D 对象一起换。 */
  setProjection(projection: Projection3D): this {
    this.projection = projection;
    this.prepare(false);
    return this;
  }

  /** 空间里的全部网格(深度优先,按子元素顺序)。 */
  meshes(): Mesh3D[] {
    const out: Mesh3D[] = [];
    const visit = (m: MObject): void => {
      if (m instanceof Mesh3D) {
        out.push(m);
        return;
      }
      for (const child of m.getChildren()) {
        visit(child);
      }
    };
    for (const child of this.getChildren()) {
      visit(child);
    }
    return out;
  }

  /** 加入后按层稳定重排(网格 → 线条 → 其它),并把视角、自动遮挡设好。 */
  override add(...mobjects: MObject[]): this {
    super.add(...mobjects);
    const children = [...this.getChildren()];
    const layers = new Map(children.map((c) => [c, layerOf(c)] as const));
    const sorted = children
      .map((c, i) => ({ c, i }))
      .sort((a, b) => (layers.get(a.c) ?? 2) - (layers.get(b.c) ?? 2) || a.i - b.i)
      .map((e) => e.c);
    if (sorted.some((c, i) => c !== children[i])) {
      super.remove(...children);
      super.add(...sorted);
    }
    this.prepare(false);
    return this;
  }

  /** 移走的子树清掉自动遮挡表(它们不在这个空间里了)。 */
  override remove(...mobjects: MObject[]): this {
    const removed = mobjects.filter((m) => this.getChildren().includes(m));
    super.remove(...mobjects);
    for (const m of removed) {
      this.walk(m, (node) => {
        if (isAutoOccludable(node)) {
          node.setAutoOccluders(NO_MESHES);
        }
      });
    }
    this.prepare(false);
    return this;
  }

  override render(
    ctx: CanvasRenderingContext2D,
    theme: Theme,
    parentOpacity = 1,
    inherited: Readonly<StyleOverride> = NO_STYLE,
  ): void {
    this.prepare(true);
    super.render(ctx, theme, parentOpacity, inherited);
  }

  /**
   * 一次遍历:统一视角、收集网格与可自动遮挡的对象、发布自动遮挡表;
   * checkFrames 时再检查 3D 对象是否都在空间原点(相对空间的累计变换是恒等)。
   */
  private prepare(checkFrames: boolean): void {
    const meshes: Mesh3D[] = [];
    const targets: AutoOccludable[] = [];
    const visit = (m: MObject, x: number, y: number, scale: number, rotation: number): void => {
      const cos = Math.cos(rotation);
      const sin = Math.sin(rotation);
      const px = x + (m.position.x * cos - m.position.y * sin) * scale;
      const py = y + (m.position.x * sin + m.position.y * cos) * scale;
      const s = scale * m.scale;
      const r = rotation + m.rotation;
      if (hasProjection(m)) {
        if (m.getProjection() !== this.projection) {
          m.setProjection(this.projection);
        }
        // Anchor3D 自己的 scale / rotation 绕锚点作用在内容上,不属于画框,只看累计到它为止的变换。
        const own = m instanceof Anchor3D;
        const fs = own ? scale : s;
        const fr = own ? rotation : r;
        if (checkFrames && (px !== 0 || py !== 0 || fs !== 1 || fr !== 0) && !this.warnedFrame.has(m)) {
          this.warnedFrame.add(m);
          console.warn(
            `[Space3D] ${m.constructor.name} 不在空间原点:Space3D 以自己的原点为灭点,要挪就挪整个 Space3D`,
          );
        }
      }
      if (m instanceof Mesh3D) {
        meshes.push(m);
      }
      if (isAutoOccludable(m)) {
        targets.push(m);
      }
      for (const child of m.getChildren()) {
        visit(child, px, py, s, r);
      }
    };
    for (const child of this.getChildren()) {
      visit(child, 0, 0, 1, 0);
    }
    const prev = this.published;
    if (prev.length !== meshes.length || meshes.some((m, i) => m !== prev[i])) {
      this.published = Object.freeze(meshes);
    }
    for (const t of targets) {
      t.setAutoOccluders(this.published);
    }
  }

  private walk(m: MObject, visit: (node: MObject) => void): void {
    visit(m);
    for (const child of m.getChildren()) {
      this.walk(child, visit);
    }
  }
}
