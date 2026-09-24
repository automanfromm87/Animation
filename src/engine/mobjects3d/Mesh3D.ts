import type { ResolvedStyle, StyleOverride, Theme } from '../theme/Theme';
import { MObject, NO_STYLE } from '../mobjects/MObject';
import type { Box } from '../mobjects/types';
import { boxFromSize } from '../mobjects/types';
import { Projection3D } from './Projection3D';
import {
  HIDDEN_ALPHA,
  HIDDEN_DASH,
  LIGHT,
  SHADE_LEVELS,
  colorAlpha,
  shadeTableFor,
} from './shading';
import type { EdgeTopology } from './topology';
import { buildEdgeTopology, isClosedOrientable } from './topology';
import type { Vec3 } from './vec3';

export { shadeColor } from './shading';
// Vec3 与 rotateVec 挪到了无依赖的 vec3.ts(Projection3D 也要用,不能反过来 import 这里);
// 这里再导出,旧的 import 路径不变。
export type { Vec3 } from './vec3';
export { rotateVec } from './vec3';

/** 当前变换下 1 设备像素对应的局部长度;拿不到变换(测试桩)就按 1。 */
function devicePixel(ctx: CanvasRenderingContext2D): number {
  const m = typeof ctx.getTransform === 'function' ? ctx.getTransform() : null;
  const scale = m ? Math.hypot(m.a, m.b) : 0;
  return scale > 0 && Number.isFinite(scale) ? 1 / scale : 1;
}

/**
 * 面是否朝向视点(透视正确):n·(eye − c) > 0,eye = (0, 0, d)。
 * 正交近似 n.z > 0 在透视下会把「法线略朝前、但视线已擦到背面」的面判成正面,
 * 于是它的远边被画成实线,穿进前面的面里。
 */
function facesEye(
  nx: number,
  ny: number,
  nz: number,
  cx: number,
  cy: number,
  cz: number,
  viewDistance: number,
): boolean {
  return nz * (viewDistance - cz) - nx * cx - ny * cy > 0;
}

/**
 * Newell 法线(未单位化)写进 normals[o..o+2],面心写进 centers[o..o+2]。
 * 对任意平面多边形都精确,极点处两个顶点重合的四边形也不退化。
 */
export function newellNormalAt(
  face: readonly number[],
  verts: ReadonlyArray<Readonly<Vec3>>,
  normals: Float64Array,
  centers: Float64Array,
  o: number,
): void {
  let nx = 0;
  let ny = 0;
  let nz = 0;
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let count = 0;
  for (let k = 0; k < face.length; k++) {
    const a = verts[face[k] ?? -1];
    const b = verts[face[(k + 1) % face.length] ?? -1];
    if (!a || !b) {
      continue;
    }
    nx += (a.y - b.y) * (a.z + b.z);
    ny += (a.z - b.z) * (a.x + b.x);
    nz += (a.x - b.x) * (a.y + b.y);
    cx += a.x;
    cy += a.y;
    cz += a.z;
    count += 1;
  }
  normals[o] = nx;
  normals[o + 1] = ny;
  normals[o + 2] = nz;
  const inv = count > 0 ? 1 / count : 0;
  centers[o] = cx * inv;
  centers[o + 1] = cy * inv;
  centers[o + 2] = cz * inv;
}

/** 就地单位化 out[o..o+2] 并乘上 sign;零向量/非有限置 0(退化面既不朝前也不打光)。 */
export function normalizeAt(out: Float64Array, o: number, sign = 1): void {
  const x = out[o] ?? 0;
  const y = out[o + 1] ?? 0;
  const z = out[o + 2] ?? 0;
  const len = Math.hypot(x, y, z);
  if (!(len > 0) || !Number.isFinite(len)) {
    out[o] = 0;
    out[o + 1] = 0;
    out[o + 2] = 0;
    return;
  }
  const s = sign / len;
  out[o] = x * s;
  out[o + 1] = y * s;
  out[o + 2] = z * s;
}

/** 可按参数重采样的曲面,ParamMorph 动画的驱动目标。同一组参数再次 resample 应是空操作。 */
export interface Resamplable {
  resample(params: readonly number[]): void;
  getParams(): number[];
}

/** 实体构造的可选项。 */
export interface Mesh3DOptions {
  /** 共享视角;缺省每个网格各持一份。 */
  projection?: Projection3D;
  /**
   * 单面还是双面。'auto'(默认)按拓扑判断:封闭且可定向(isClosedOrientable)为单面,
   * 开放、不可定向的为双面 —— 线框不分虚实、背面翻向观察者打光。
   * 按拓扑判定,几何形变不会改变结论;replaceGeometry 换了拓扑才重判。
   */
  sided?: 'auto' | 'one' | 'two';
}

/**
 * 每帧一次的视图缓存:旋转后顶点、投影点,以及每个面的旋转后法线、中心、朝向。
 * 填充与线框两遍共用,不再各算一遍法线。
 */
export interface MeshView {
  readonly vertexCount: number;
  readonly faceCount: number;
  /** 旋转后顶点,长度 3V。 */
  readonly rot: Float64Array;
  /** 投影点,长度 2V。 */
  readonly proj: Float64Array;
  /** 旋转后的面单位法线,长度 3F(退化面为 0 向量)。 */
  readonly normal: Float64Array;
  /** 旋转后的面中心,长度 3F。 */
  readonly center: Float64Array;
  /** 1 = 面朝视点(透视正确)。 */
  readonly front: Uint8Array;
}

/** 非有限坐标会让整个网格消失(包围盒、排序全被 NaN 污染),构造与改顶点都拦下。 */
function requireFiniteVertex(i: number, x: number, y: number, z: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    throw new Error(`Mesh3D 第 ${i} 个顶点坐标不是有限数:(${x}, ${y}, ${z})`);
  }
}

/** 构造期校验:越界/非整数下标会静默画成一根乱线,非有限坐标会让整个网格消失。 */
function validateGeometry(
  vertices: readonly Vec3[],
  faces: ReadonlyArray<readonly number[]>,
): void {
  vertices.forEach((v, i) => requireFiniteVertex(i, v.x, v.y, v.z));
  faces.forEach((face, f) => {
    if (face.length < 3) {
      throw new Error(`Mesh3D 第 ${f} 个面至少需要 3 个顶点,收到 ${face.length} 个`);
    }
    for (const vi of face) {
      if (!Number.isInteger(vi) || vi < 0 || vi >= vertices.length) {
        throw new Error(
          `Mesh3D 第 ${f} 个面引用了非法顶点下标 ${String(vi)}(共 ${vertices.length} 个顶点)`,
        );
      }
    }
  });
}

/**
 * Mesh3D:3D 网格体基类。
 * 子类给出顶点 + 面片索引,基类负责旋转、透视投影、明暗与隐藏线。
 * 默认数学透视图风格:无填充,可见边实线、隐藏边虚线;
 * 若 setStyle 指定了 fill,则按深度排序填色 + 平面明暗(画家算法)。
 * 隐藏线只做背面剔除:对封闭、可定向的曲面才成立,凹处的自遮挡不处理;
 * 开放/不可定向的曲面(twoSided,默认按拓扑自动判定)边一律画实线。
 * 网格之间互不遮挡;3D 线条与标注(Line3D、Anchor3D……)可以被列为 occluders 的网格遮挡,
 * 它们借 occlusionView() 读同一份视图缓存,自己判断哪一段被挡住。
 */
export class Mesh3D extends MObject {
  private verts: Vec3[];
  private faceList: number[][];
  /** 视角参数。默认每个网格各持一份;setProjection 可以让一组网格共用一套。 */
  private projection: Projection3D;
  /** 拓扑版本:replaceGeometry 时递增,边表据此重建。 */
  private topologyVersion = 0;
  /** 形状版本:顶点位置有任何变化都递增,法线、面心、包围半径据此重算。 */
  private shapeVersion = 0;
  private topology: EdgeTopology | null = null;
  private topologyBuiltFor = -1;
  private boundRadius = 0;
  private boundBuiltFor = -1;
  private objNormal = new Float64Array(0);
  private objCenter = new Float64Array(0);
  private normalsBuiltFor = -1;
  // 逐帧复用的缓冲:几千个面也不产生临时对象。
  private rotBuf = new Float64Array(0);
  private projBuf = new Float64Array(0);
  private normalBuf = new Float64Array(0);
  private centerBuf = new Float64Array(0);
  private frontBuf = new Uint8Array(0);
  private depthBuf = new Float64Array(0);
  private orderBuf = new Uint32Array(0);
  private edgeSolidBuf = new Uint8Array(0);
  private readonly sided: 'auto' | 'one' | 'two';
  /** 'auto' 的判定结果与它对应的拓扑版本。 */
  private autoTwoSided = false;
  private sidedFor = -1;
  /** 最近一次 render 解析出的填充色(含容器继承,3D 线条的遮挡强度用);还没画过为 undefined。 */
  private renderedFill: string | null | undefined = undefined;

  /** 第三个参数也接受单独一个 Projection3D(旧写法)。 */
  constructor(
    vertices: readonly Vec3[],
    faces: ReadonlyArray<readonly number[]>,
    options?: Mesh3DOptions | Projection3D,
  ) {
    super();
    validateGeometry(vertices, faces);
    const opts: Mesh3DOptions =
      options instanceof Projection3D ? { projection: options } : (options ?? {});
    // 拷贝:否则 Cube/Cuboid 会共享同一份 BOX_FACES,改一个就改了全部。
    this.verts = vertices.map((v) => ({ x: v.x, y: v.y, z: v.z }));
    this.faceList = faces.map((f) => [...f]);
    this.projection = opts.projection ?? new Projection3D();
    this.sided = opts.sided ?? 'auto';
    // 用 setDefaultStyle 而不是 setStyle:后者会把 strokeWidth 登记成「自设键」,
    // 容器的 setStyle({strokeWidth}) 从此再也改不动 3D 网格的线宽。
    this.setDefaultStyle({ strokeWidth: 2 });
  }

  /** 顶点(只读视图)。改顶点走 setVertices / setVertexAt,缓存才会跟着失效。 */
  get vertices(): ReadonlyArray<Readonly<Vec3>> {
    return this.verts;
  }

  /** 面片顶点下标(只读视图)。 */
  get faces(): ReadonlyArray<readonly number[]> {
    return this.faceList;
  }

  /** 共享视角:把同一个 Projection3D 交给多个网格,一个动画就能驱动整组。 */
  setProjection(projection: Projection3D): this {
    this.projection = projection;
    return this;
  }

  getProjection(): Projection3D {
    return this.projection;
  }

  get rotX(): number {
    return this.projection.rotX;
  }

  set rotX(value: number) {
    this.projection.rotX = value;
  }

  get rotY(): number {
    return this.projection.rotY;
  }

  set rotY(value: number) {
    this.projection.rotY = value;
  }

  get viewDistance(): number {
    return this.projection.viewDistance;
  }

  set viewDistance(value: number) {
    this.projection.viewDistance = value;
  }

  /** @internal 3D 线条遮挡用:几何版本(顶点或拓扑任何变化都会变)。 */
  get geometryVersion(): number {
    return this.shapeVersion;
  }

  /**
   * @internal 3D 线条遮挡用:当前视角下的视图缓存(与绘制同一份投影)与单双面。
   * 返回的缓冲是网格逐帧复用的:调用方只能当场读完,不能留存。
   */
  occlusionView(): { view: MeshView; twoSided: boolean } {
    return { view: this.updateView(), twoSided: this.twoSided };
  }

  /**
   * @internal 3D 线条遮挡用:这个网格挡住身后线条的强度 0..1(0 = 不挡)。
   * 填色时 = 自身 opacity × 填充色的 alpha:低 alpha 的半透明截面只「挡」掉相应的一部分,
   * 身后的线不会比网格本身看起来更不透明。不填色时:双面(开放)曲面是 0 ——
   * 它自己的边一律画实线、没有隐藏边,透过网格看到的轴也不该画成虚线;
   * 单面(封闭)线框照样全挡,与它自己的背面棱画淡虚线一致(棱锥里的高线画虚线)。
   * 填充色取最近一次 render 解析出的值(含容器继承;Space3D 里网格先画,就是这一帧的),
   * 还没画过时退回自身 setStyle / 构造默认的 fill。只看网格自身,不看祖先组的透明度。
   */
  occlusionStrength(): number {
    const k = Math.min(1, Math.max(0, this.opacity));
    if (!(k > 0)) {
      return 0;
    }
    const fill = this.renderedFill !== undefined ? this.renderedFill : this.ownFill();
    if (fill === null) {
      return this.twoSided ? 0 : k;
    }
    const alpha = colorAlpha(fill);
    return Number.isFinite(alpha) ? k * Math.min(1, Math.max(0, alpha)) : k;
  }

  /** 记下这一帧解析出的填充色(与 MObject.render 的解析同一优先级:自身 > 容器链 > 构造默认 > 主题)。 */
  override render(
    ctx: CanvasRenderingContext2D,
    theme: Theme,
    parentOpacity = 1,
    inherited: Readonly<StyleOverride> = NO_STYLE,
  ): void {
    this.renderedFill = firstDefined(
      this.styleOverride.fill,
      inherited.fill,
      this.defaultStyle.fill,
      theme.fill,
    );
    super.render(ctx, theme, parentOpacity, inherited);
  }

  /** 没画过时的填充色:自身 setStyle,其次构造默认,都没有就是不填色。 */
  private ownFill(): string | null {
    return firstDefined(this.styleOverride.fill, this.defaultStyle.fill, null);
  }

  /** 按当前 rotX/rotY 旋转并透视投影后的 2D 包围盒(与实际绘制共用同一份投影)。 */
  override getBox(): Box {
    if (this.verts.length === 0) {
      return boxFromSize(0, 0);
    }
    const { proj, vertexCount } = this.updateView();
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < vertexCount; i++) {
      const px = proj[i * 2] ?? NaN;
      const py = proj[i * 2 + 1] ?? NaN;
      if (!Number.isFinite(px) || !Number.isFinite(py)) {
        continue;
      }
      minX = Math.min(minX, px);
      minY = Math.min(minY, py);
      maxX = Math.max(maxX, px);
      maxY = Math.max(maxY, py);
    }
    if (minX === Infinity) {
      return boxFromSize(0, 0);
    }
    return {
      size: { w: maxX - minX, h: maxY - minY },
      center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2 },
    };
  }

  override getCullRadius(): number {
    if (this.boundBuiltFor !== this.shapeVersion) {
      let maxLen = 0;
      for (const v of this.verts) {
        const len = Math.hypot(v.x, v.y, v.z);
        if (Number.isFinite(len)) {
          maxLen = Math.max(maxLen, len);
        }
      }
      this.boundBuiltFor = this.shapeVersion;
      this.boundRadius = maxLen;
    }
    const d = this.viewDistance; // Projection3D 已保证 >= 1
    // 投影放大系数的上界:顶点最靠近视点时的 d / max(d*nearRatio, d - r)。
    const scaleMax = d / Math.max(d * this.projection.nearRatio, d - this.boundRadius);
    return this.boundRadius * scaleMax;
  }

  /** 原位更新全部顶点(数量必须一致,否则抛错),供形变动画逐帧调用。 */
  setVertices(vertices: readonly Vec3[]): this {
    if (vertices.length !== this.verts.length) {
      throw new Error(
        `setVertices 需要 ${this.verts.length} 个顶点,收到 ${vertices.length} 个`,
      );
    }
    // 先整体校验再写:中途抛错不能留下半新半旧的网格。
    vertices.forEach((v, i) => requireFiniteVertex(i, v.x, v.y, v.z));
    for (let i = 0; i < vertices.length; i++) {
      const src = vertices[i];
      const dst = this.verts[i];
      if (src && dst) {
        dst.x = src.x;
        dst.y = src.y;
        dst.z = src.z;
      }
    }
    this.markGeometryChanged();
    return this;
  }

  /**
   * 原位写单个顶点,形变动画的零分配路径。缓存按版本号惰性失效,
   * 逐点调用上千次也只在下次用到时重算一遍。
   */
  setVertexAt(index: number, x: number, y: number, z: number): this {
    const v = this.verts[index];
    if (!v) {
      throw new RangeError(`setVertexAt 的下标 ${index} 越界(共 ${this.verts.length} 个顶点)`);
    }
    requireFiniteVertex(index, x, y, z);
    v.x = x;
    v.y = y;
    v.z = z;
    this.shapeVersion += 1;
    return this;
  }

  /**
   * 让法线、面心、包围半径等缓存失效(拓扑不变时不会重建边表)。
   * setVertices / setVertexAt 已自动调用;只有子类绕过它们直接改几何时才需要手动调。
   */
  markGeometryChanged(): void {
    this.shapeVersion += 1;
  }

  /**
   * 替换整体几何(顶点 + 面片),供隐式曲面重建网格。
   * 直接接管传入的数组(调用方之后不要再改它们),省掉上万个顶点的深拷贝。
   */
  protected replaceGeometry(vertices: Vec3[], faces: number[][]): void {
    this.verts = vertices;
    this.faceList = faces;
    this.topologyVersion += 1;
    this.shapeVersion += 1;
  }

  /**
   * 双面曲面(开放或不可定向):背面也看得见,线框不分虚实、背面按翻转后的法线打光。
   * 按构造选项 sided;'auto' 按当前拓扑判定并缓存到下次 replaceGeometry。
   */
  protected get twoSided(): boolean {
    if (this.sided !== 'auto') {
      return this.sided === 'two';
    }
    if (this.sidedFor !== this.topologyVersion) {
      this.autoTwoSided = !isClosedOrientable(this.edgeTopology(), this.faceList, this.verts);
      this.sidedFor = this.topologyVersion;
    }
    return this.autoTwoSided;
  }

  /**
   * 计算物体空间面法线(单位向量,写进 normals[3f..3f+2])与面心(centers)。
   * 几何变化后调用一次,结果跨帧复用。
   * 默认:Newell 法线,按「面心 − 顶点重心」定向。凸体的顶点重心一定在体内,
   * 所以定向对任何凸体都正确;方向本身来自面的几何,与顶点分布、绕序都无关
   * (旧的「面心 − 体心」伪法线在圆锥这类顶点分布不均的凸体上会偏十几度)。
   */
  protected computeFaceNormals(normals: Float64Array, centers: Float64Array): void {
    const verts = this.verts;
    let gx = 0;
    let gy = 0;
    let gz = 0;
    for (const v of verts) {
      gx += v.x;
      gy += v.y;
      gz += v.z;
    }
    const inv = verts.length > 0 ? 1 / verts.length : 0;
    gx *= inv;
    gy *= inv;
    gz *= inv;
    for (let f = 0; f < this.faceList.length; f++) {
      const o = f * 3;
      newellNormalAt(this.faceList[f] ?? [], verts, normals, centers, o);
      const outward =
        (normals[o] ?? 0) * ((centers[o] ?? 0) - gx) +
        (normals[o + 1] ?? 0) * ((centers[o + 1] ?? 0) - gy) +
        (normals[o + 2] ?? 0) * ((centers[o + 2] ?? 0) - gz);
      normalizeAt(normals, o, outward < 0 ? -1 : 1);
    }
  }

  /** 第 index 个面的物体空间单位法线(子类与测试用)。 */
  protected objectFaceNormal(index: number): Vec3 {
    this.ensureNormals();
    const o = index * 3;
    return {
      x: this.objNormal[o] ?? 0,
      y: this.objNormal[o + 1] ?? 0,
      z: this.objNormal[o + 2] ?? 0,
    };
  }

  /** 唯一边表 + 面到边的索引 + 邻接面。拓扑只在 replaceGeometry 后重建。 */
  protected edgeTopology(): EdgeTopology {
    const cached = this.topology;
    if (cached && this.topologyBuiltFor === this.topologyVersion) {
      return cached;
    }
    const topo = buildEdgeTopology(this.faceList, this.verts.length);
    this.topology = topo;
    this.topologyBuiltFor = this.topologyVersion;
    return topo;
  }

  protected override drawShape(
    ctx: CanvasRenderingContext2D,
    style: ResolvedStyle,
  ): void {
    if (this.verts.length === 0 || this.faceList.length === 0) {
      return;
    }
    const view = this.updateView();
    if (style.fill !== null) {
      this.paintFaces(ctx, style, view, true);
    } else {
      this.drawWireframe(ctx, style, view);
    }
  }

  /** 旋转、投影全部顶点,并算出每个面的旋转后法线、中心与朝向。每帧调用一次。 */
  protected updateView(): MeshView {
    this.ensureNormals();
    const n = this.verts.length;
    const faceCount = this.faceList.length;
    if (this.rotBuf.length < n * 3) {
      this.rotBuf = new Float64Array(n * 3);
      this.projBuf = new Float64Array(n * 2);
    }
    if (this.normalBuf.length < faceCount * 3) {
      this.normalBuf = new Float64Array(faceCount * 3);
      this.centerBuf = new Float64Array(faceCount * 3);
      this.frontBuf = new Uint8Array(faceCount);
    }
    const rot = this.rotBuf;
    const proj = this.projBuf;
    const cosY = Math.cos(this.rotY);
    const sinY = Math.sin(this.rotY);
    const cosX = Math.cos(this.rotX);
    const sinX = Math.sin(this.rotX);
    const d = this.viewDistance; // Projection3D 已保证 >= 1
    const minDenom = d * this.projection.nearRatio;
    for (let i = 0; i < n; i++) {
      const v = this.verts[i];
      if (!v) {
        continue;
      }
      const x1 = v.x * cosY + v.z * sinY;
      const z1 = -v.x * sinY + v.z * cosY;
      const y = v.y * cosX - z1 * sinX;
      const z = v.y * sinX + z1 * cosX;
      rot[i * 3] = x1;
      rot[i * 3 + 1] = y;
      rot[i * 3 + 2] = z;
      // 近平面用比例下限而不是固定 1:顶点越过视点时缩放系数最多到 1/nearRatio,
      // 不会暴涨成横穿画布的长线。
      const s = d / Math.max(minDenom, d - z);
      proj[i * 2] = x1 * s;
      proj[i * 2 + 1] = y * s;
    }
    const on = this.objNormal;
    const oc = this.objCenter;
    const normal = this.normalBuf;
    const center = this.centerBuf;
    const front = this.frontBuf;
    for (let f = 0; f < faceCount; f++) {
      const o = f * 3;
      const nx0 = on[o] ?? 0;
      const ny0 = on[o + 1] ?? 0;
      const nz0 = on[o + 2] ?? 0;
      const nz1 = -nx0 * sinY + nz0 * cosY;
      const nx = nx0 * cosY + nz0 * sinY;
      const ny = ny0 * cosX - nz1 * sinX;
      const nz = ny0 * sinX + nz1 * cosX;
      const cx0 = oc[o] ?? 0;
      const cy0 = oc[o + 1] ?? 0;
      const cz0 = oc[o + 2] ?? 0;
      const cz1 = -cx0 * sinY + cz0 * cosY;
      const cx = cx0 * cosY + cz0 * sinY;
      const cy = cy0 * cosX - cz1 * sinX;
      const cz = cy0 * sinX + cz1 * cosX;
      normal[o] = nx;
      normal[o + 1] = ny;
      normal[o + 2] = nz;
      center[o] = cx;
      center[o + 1] = cy;
      center[o + 2] = cz;
      front[f] = facesEye(nx, ny, nz, cx, cy, cz, d) ? 1 : 0;
    }
    return { vertexCount: n, faceCount, rot, proj, normal, center, front };
  }

  /** 沿面的顶点在投影平面上描出闭合路径。 */
  private tracePath(
    ctx: CanvasRenderingContext2D,
    face: readonly number[],
    proj: Float64Array,
  ): void {
    const first = face[0] ?? 0;
    ctx.beginPath();
    ctx.moveTo(proj[first * 2] ?? 0, proj[first * 2 + 1] ?? 0);
    for (let k = 1; k < face.length; k++) {
      const vi = face[k] ?? first;
      ctx.lineTo(proj[vi * 2] ?? 0, proj[vi * 2 + 1] ?? 0);
    }
    ctx.closePath();
  }

  /**
   * 实体渲染:按深度远近填色 + 平面明暗(画家算法)。
   * strokeFaces 为 false 时只填色(三角汤避免画出剖分对角线)。
   * 面边不描线时(strokeFaces 为 false 或线宽为 0),用同色、约 1 设备像素的描边
   * 盖住相邻面之间的抗锯齿缝;半透明时不补 —— 每条边会被叠两遍透明度,浮出一张网格纹。
   * afterFace 在每个面画完之后调用:子类借它把属于这个面的轮廓线紧跟着描上,
   * 被更近的面遮住的那一段自然会被后画的面盖掉。
   */
  protected paintFaces(
    ctx: CanvasRenderingContext2D,
    style: ResolvedStyle,
    view: MeshView,
    strokeFaces: boolean,
    afterFace?: (faceIndex: number) => void,
  ): void {
    const faceCount = view.faceCount;
    if (this.depthBuf.length < faceCount) {
      this.depthBuf = new Float64Array(faceCount);
      this.orderBuf = new Uint32Array(faceCount);
    }
    const depth = this.depthBuf;
    const order = this.orderBuf;
    let count = 0;
    for (let f = 0; f < faceCount; f++) {
      const face = this.faceList[f];
      if (!face || face.length < 3) {
        continue;
      }
      const z = view.center[f * 3 + 2] ?? 0;
      // 非有限深度会让比较器失去全序,单个 NaN 就能打乱整份画家算法排序。
      depth[f] = Number.isFinite(z) ? z : -Infinity;
      order[count] = f;
      count += 1;
    }
    order.subarray(0, count).sort((a, b) => {
      const da = depth[a] ?? 0;
      const db = depth[b] ?? 0;
      return da < db ? -1 : da > db ? 1 : 0;
    });
    const fill = style.fill;
    const table = fill === null ? null : shadeTableFor(fill);
    const twoSided = this.twoSided;
    const strokeOn = strokeFaces && style.strokeWidth > 0;
    const opaque = fill !== null && ctx.globalAlpha >= 1 && colorAlpha(fill) >= 1;
    const seamWidth = opaque && !strokeOn ? devicePixel(ctx) : 0;
    for (let k = 0; k < count; k++) {
      const f = order[k] ?? 0;
      const face = this.faceList[f];
      if (!face) {
        continue;
      }
      this.tracePath(ctx, face, view.proj);
      if (fill !== null) {
        const o = f * 3;
        // 双面曲面看到的是背面时,按朝向观察者的那一侧打光。
        const flip = twoSided && view.front[f] !== 1 ? -1 : 1;
        const lit =
          flip *
          ((view.normal[o] ?? 0) * LIGHT.x +
            (view.normal[o + 1] ?? 0) * LIGHT.y +
            (view.normal[o + 2] ?? 0) * LIGHT.z);
        const intensity = 0.35 + 0.65 * Math.max(0, lit);
        const shade = table ? (table[Math.round(intensity * SHADE_LEVELS)] ?? fill) : fill;
        ctx.fillStyle = shade;
        ctx.fill();
        if (seamWidth > 0) {
          ctx.strokeStyle = shade;
          ctx.lineWidth = seamWidth;
          ctx.stroke();
        }
      }
      if (strokeOn) {
        ctx.strokeStyle = style.stroke;
        ctx.lineWidth = style.strokeWidth;
        ctx.stroke();
      }
      afterFace?.(f);
    }
  }

  /** 线框:被任一正面共用的边画实线,其余画淡虚线;双面曲面全部实线。 */
  protected drawWireframe(
    ctx: CanvasRenderingContext2D,
    style: ResolvedStyle,
    view: MeshView,
  ): void {
    if (!(style.strokeWidth > 0)) {
      return;
    }
    const topo = this.edgeTopology();
    const edgeCount = topo.edgeCount;
    if (this.edgeSolidBuf.length < edgeCount) {
      this.edgeSolidBuf = new Uint8Array(edgeCount);
    }
    const solid = this.edgeSolidBuf;
    let hidden = 0;
    if (this.twoSided) {
      solid.fill(1, 0, edgeCount);
    } else {
      solid.fill(0, 0, edgeCount);
      for (let f = 0; f < view.faceCount; f++) {
        if (view.front[f] !== 1) {
          continue;
        }
        const from = topo.faceStart[f] ?? 0;
        const to = topo.faceStart[f + 1] ?? from;
        for (let k = from; k < to; k++) {
          solid[topo.faceEdges[k] ?? 0] = 1;
        }
      }
      for (let e = 0; e < edgeCount; e++) {
        if (solid[e] !== 1) {
          hidden += 1;
        }
      }
    }
    const proj = view.proj;
    const strokeEdges = (want: number): void => {
      ctx.beginPath();
      for (let e = 0; e < edgeCount; e++) {
        if (solid[e] !== want) {
          continue;
        }
        const a = topo.ends[e * 2] ?? 0;
        const b = topo.ends[e * 2 + 1] ?? 0;
        ctx.moveTo(proj[a * 2] ?? 0, proj[a * 2 + 1] ?? 0);
        ctx.lineTo(proj[b * 2] ?? 0, proj[b * 2 + 1] ?? 0);
      }
      ctx.stroke();
    };
    if (hidden > 0) {
      // 隐藏边:在已累积的 alpha 上再乘系数,父级 Group 的淡入淡出才跟得上。
      ctx.save();
      ctx.globalAlpha = ctx.globalAlpha * HIDDEN_ALPHA;
      ctx.strokeStyle = style.stroke;
      ctx.lineWidth = style.strokeWidth;
      ctx.setLineDash(HIDDEN_DASH as number[]);
      strokeEdges(0);
      ctx.restore();
    }
    ctx.strokeStyle = style.stroke;
    ctx.lineWidth = style.strokeWidth;
    strokeEdges(1);
  }

  private ensureNormals(): void {
    const size = this.faceList.length * 3;
    if (this.normalsBuiltFor === this.shapeVersion && this.objNormal.length === size) {
      return;
    }
    if (this.objNormal.length !== size) {
      this.objNormal = new Float64Array(size);
      this.objCenter = new Float64Array(size);
    }
    this.computeFaceNormals(this.objNormal, this.objCenter);
    this.normalsBuiltFor = this.shapeVersion;
  }
}

/** 实体/曲面尺寸参数:必须是正有限数,否则会静默生成退化网格。 */
export function requirePositiveSize(name: string, value: number): number {
  if (!Number.isFinite(value) || !(value > 0)) {
    throw new Error(`${name} 需要正有限数,收到 ${value}`);
  }
  return value;
}

/** 两组参数逐元素相等(resample 的同参空操作判定)。 */
export function sameParams(a: readonly number[], b: readonly number[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  for (let i = 0; i < a.length; i++) {
    if (!Object.is(a[i], b[i])) {
      return false;
    }
  }
  return true;
}

/** 第一个不是 undefined 的填充色(fill 允许显式 null 表示不填充,所以不能用 ??)。 */
function firstDefined(...values: Array<string | null | undefined>): string | null {
  for (const v of values) {
    if (v !== undefined) {
      return v;
    }
  }
  return null;
}
