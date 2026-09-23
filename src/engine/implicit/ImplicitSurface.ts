import type { ResolvedStyle } from '../theme/Theme';
import type { MeshView, Resamplable } from '../mobjects3d/Mesh3D';
import { Mesh3D, newellNormalAt, normalizeAt, sameParams } from '../mobjects3d/Mesh3D';
import type { Projection3D } from '../mobjects3d/Projection3D';
import type { EdgeTopology } from '../mobjects3d/topology';
import { BOUNDARY, NON_MANIFOLD } from '../mobjects3d/topology';
import { polygonize } from './marchingTets';
import type { FieldFn } from './sdf';

export interface ImplicitSurfaceOptions {
  bounds?: number;
  /** 每边体素数,必须是正整数。越大越细也越慢(场求值 O(res³))。 */
  resolution?: number;
  params?: readonly number[];
  /** 共享视角;缺省每个网格各持一份。 */
  projection?: Projection3D;
}

/**
 * ImplicitSurface:隐式曲面,用 marching tetrahedra 从距离场重建网格。
 * 场混合可表达亏格变化等真拓扑形变。
 * 只画轮廓(剪影 + 边界)而不是全部内边,避免糊成实心。
 * 法线直接取三角形绕序的叉积:polygonize 保证绕序朝向场值增大的一侧(体外)。
 * 有填充时轮廓线在画家循环里紧跟它所属的正面描上,被更近的面遮住的部分会被盖掉;
 * 无填充时没有面可以遮挡,轮廓一律实线画出(自遮挡的那段也会画出来)。
 */
export class ImplicitSurface extends Mesh3D implements Resamplable {
  private readonly field: FieldFn;
  private readonly bounds: number;
  private readonly resolution: number;
  private params: number[];
  private sampled = false;
  /** 逐帧复用:轮廓边按「所属正面」分桶(CSR)。 */
  private bucketStart = new Int32Array(0);
  private bucketEdges = new Int32Array(0);

  constructor(field: FieldFn, options?: ImplicitSurfaceOptions) {
    super([], [], options?.projection);
    this.field = field;
    this.bounds = options?.bounds ?? 70;
    this.resolution = options?.resolution ?? 22;
    if (!Number.isInteger(this.resolution) || this.resolution < 1) {
      throw new Error(
        `ImplicitSurface 的 resolution 需要正整数,收到 ${this.resolution}`,
      );
    }
    if (!(this.bounds > 0) || !Number.isFinite(this.bounds)) {
      throw new Error(`ImplicitSurface 的 bounds 需要正有限数,收到 ${this.bounds}`);
    }
    this.params = [...(options?.params ?? [0])];
    this.rebuild();
  }

  getParams(): number[] {
    return [...this.params];
  }

  /**
   * 按新参数重建网格;参数与当前逐元素相等时是空操作。
   * 不传参数则按当前参数强制重建(场函数读了外部状态、参数没变时用)。
   * 单双面由基类按新拓扑自动重判:曲面被包围盒截开时从破口能看到背面。
   */
  resample(params?: readonly number[]): void {
    if (params) {
      if (this.sampled && sameParams(params, this.params)) {
        return;
      }
      this.params = [...params];
    }
    this.rebuild();
  }

  /** 三角形绕序的叉积法线,不翻转(polygonize 已统一朝外)。 */
  protected override computeFaceNormals(
    normals: Float64Array,
    centers: Float64Array,
  ): void {
    const verts = this.vertices;
    const faces = this.faces;
    for (let f = 0; f < faces.length; f++) {
      newellNormalAt(faces[f] ?? [], verts, normals, centers, f * 3);
      normalizeAt(normals, f * 3);
    }
  }

  protected override drawShape(
    ctx: CanvasRenderingContext2D,
    style: ResolvedStyle,
  ): void {
    if (this.vertices.length === 0 || this.faces.length === 0) {
      return;
    }
    const view = this.updateView();
    const strokeOn = style.strokeWidth > 0;
    if (style.fill === null) {
      if (strokeOn) {
        this.strokeAllContours(ctx, style, view);
      }
      return;
    }
    if (!strokeOn) {
      this.paintFaces(ctx, style, view, false);
      return;
    }
    const topo = this.bucketContours(view);
    const start = this.bucketStart;
    const list = this.bucketEdges;
    const proj = view.proj;
    ctx.lineCap = 'round';
    this.paintFaces(ctx, style, view, false, (f) => {
      const from = start[f] ?? 0;
      const to = start[f + 1] ?? from;
      if (from === to) {
        return;
      }
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = style.strokeWidth;
      ctx.beginPath();
      for (let k = from; k < to; k++) {
        const e = list[k] ?? 0;
        const a = topo.ends[e * 2] ?? 0;
        const b = topo.ends[e * 2 + 1] ?? 0;
        ctx.moveTo(proj[a * 2] ?? 0, proj[a * 2 + 1] ?? 0);
        ctx.lineTo(proj[b * 2] ?? 0, proj[b * 2 + 1] ?? 0);
      }
      ctx.stroke();
    });
  }

  private rebuild(): void {
    const { vertices, faces } = polygonize(
      (x, y, z) => this.field(x, y, z, this.params),
      this.bounds,
      this.resolution,
    );
    this.replaceGeometry(vertices, faces);
    this.sampled = true;
  }

  /**
   * 这条边此刻是不是轮廓:边界边恒是;两侧面一前一后的是剪影。
   * 返回它所属的「正面」(边界边返回唯一那个面),不是轮廓返回 -1。
   */
  private contourOwner(topo: EdgeTopology, view: MeshView, e: number): number {
    const fa = topo.faceA[e] ?? -1;
    const fb = topo.faceB[e] ?? NON_MANIFOLD;
    if (fa < 0 || fb === NON_MANIFOLD) {
      return -1;
    }
    if (fb === BOUNDARY) {
      return fa;
    }
    const frontA = view.front[fa] === 1;
    const frontB = view.front[fb] === 1;
    if (frontA === frontB) {
      return -1;
    }
    return frontA ? fa : fb;
  }

  /** 轮廓边按所属正面分桶,供画家循环在画完那个面后紧跟着描线。 */
  private bucketContours(view: MeshView): EdgeTopology {
    const topo = this.edgeTopology();
    const faceCount = view.faceCount;
    if (this.bucketStart.length < faceCount + 1) {
      this.bucketStart = new Int32Array(faceCount + 1);
    }
    if (this.bucketEdges.length < topo.edgeCount) {
      this.bucketEdges = new Int32Array(topo.edgeCount);
    }
    const start = this.bucketStart;
    start.fill(0, 0, faceCount + 1);
    for (let e = 0; e < topo.edgeCount; e++) {
      const owner = this.contourOwner(topo, view, e);
      if (owner >= 0) {
        start[owner + 1] = (start[owner + 1] ?? 0) + 1;
      }
    }
    for (let f = 0; f < faceCount; f++) {
      start[f + 1] = (start[f + 1] ?? 0) + (start[f] ?? 0);
    }
    // 第二遍填桶:借 start[f] 当游标,填完再整体右移一格恢复成起点表。
    for (let e = 0; e < topo.edgeCount; e++) {
      const owner = this.contourOwner(topo, view, e);
      if (owner >= 0) {
        const slot = start[owner] ?? 0;
        this.bucketEdges[slot] = e;
        start[owner] = slot + 1;
      }
    }
    for (let f = faceCount; f > 0; f--) {
      start[f] = start[f - 1] ?? 0;
    }
    start[0] = 0;
    return topo;
  }

  private strokeAllContours(
    ctx: CanvasRenderingContext2D,
    style: ResolvedStyle,
    view: MeshView,
  ): void {
    const topo = this.edgeTopology();
    const proj = view.proj;
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = style.strokeWidth;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (let e = 0; e < topo.edgeCount; e++) {
      if (this.contourOwner(topo, view, e) < 0) {
        continue;
      }
      const a = topo.ends[e * 2] ?? 0;
      const b = topo.ends[e * 2 + 1] ?? 0;
      ctx.moveTo(proj[a * 2] ?? 0, proj[a * 2 + 1] ?? 0);
      ctx.lineTo(proj[b * 2] ?? 0, proj[b * 2 + 1] ?? 0);
    }
    ctx.stroke();
  }
}
