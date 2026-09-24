import type { Point } from '../mobjects/types';
import type { Vec3 } from './vec3';

/** 非有限值一律忽略,保留旧值:rotX/rotY 是动画热路径,不做范围钳位。 */
function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/** 一个 3D 点投影后的结果。 */
export interface ProjectedPoint {
  /** 投影后的 2D 坐标:不给 frame 时是对象本地坐标(与网格绘制同一份),给了就是 frame 父坐标系里的坐标。 */
  x: number;
  y: number;
  /** 视图空间深度(旋转后的 z,越大越靠近观众),与 MeshView.rot 的 z 一致。 */
  depth: number;
  /** 透视缩放系数 d / max(d·nearRatio, d − depth)。 */
  scale: number;
}

/** 画框:任何 MObject 结构上都满足(这里不 import MObject,免得 3D 视角依赖场景图)。 */
export interface ProjectionFrame {
  readonly position: Point;
  readonly scale: number;
  readonly rotation?: number;
}

/**
 * @internal 一个视角版本下的投影常数(三角函数与近平面下限),热路径逐点投影共用。
 * 与 Mesh3D.updateView 用的是同一组表达式,投影结果逐位一致。
 */
export interface ViewConstants {
  readonly cosX: number;
  readonly sinX: number;
  readonly cosY: number;
  readonly sinY: number;
  /** viewDistance(>= 1)。 */
  readonly d: number;
  /** d · nearRatio:透视分母的下限。 */
  readonly minDenom: number;
}

/**
 * Projection3D:一组网格共享的 3D 视角。
 *
 * 默认每个 Mesh3D 各持一份(行为与单独设置 rotX/rotY 时一样);
 * 把同一个实例交给多个网格,它们就共用同一套视角,
 * 一个 Orbit3D 动画即可驱动整组,不必给每个网格各播一个 Spin3D。
 * 反过来也要注意:共享之后对其中**任何一个**网格播 Spin3D 都会带动整组。
 * 3D 线条(Line3D、曲线、Axes3D)与 Anchor3D 标注也持有它,和网格共用一个实例,
 * 视角一变下一次绘制就一起跟着变,不需要 updater。
 *
 * 所有字段都走带校验的访问器:它是共享可写状态,
 * 一个网格写进 NaN 会让共用这套视角的整组立体静默消失。
 *
 * 已知取舍:投影仍以**每个对象自身的原点**为灭点(MObject 在自己的局部
 * 坐标系里绘制),所以并排摆放的两个立体各有各的灭点,不是严格的单点透视。
 * 线条、标注同样以自身原点为灭点:要和网格对得上,就放在同一个父节点、同样的位置
 * (最省心是都放进同一个 Space3D)。
 * 要做到统一灭点需要让渲染层把世界坐标传进 drawShape,那是另一层改动。
 */
export class Projection3D {
  private rotXValue = -0.45;
  private rotYValue = 0.6;
  private viewDistanceValue = 700;
  private nearRatioValue = 0.2;
  private versionValue = 0;
  private constantsCache: ViewConstants | null = null;
  private constantsFor = -1;

  constructor(options?: {
    rotX?: number;
    rotY?: number;
    viewDistance?: number;
    nearRatio?: number;
  }) {
    if (options?.rotX !== undefined) {
      this.rotX = options.rotX;
    }
    if (options?.rotY !== undefined) {
      this.rotY = options.rotY;
    }
    if (options?.viewDistance !== undefined) {
      this.viewDistance = options.viewDistance;
    }
    if (options?.nearRatio !== undefined) {
      this.nearRatio = options.nearRatio;
    }
  }

  /**
   * 数学坐标系(右手系、z 朝上,见 mathPoint)的课本视角:
   * 缺省 azimuth = π/6、elevation = 0.45,此时数学 X 轴朝左下、Y 轴朝右、Z 轴朝正上。
   * 等价于 new Projection3D({ rotX: −elevation, rotY: −azimuth − π/2, … })。
   * Manim 的 set_camera_orientation(phi, theta) 对应 elevation = π/2 − phi、azimuth = theta。
   */
  static math(options?: {
    azimuth?: number;
    elevation?: number;
    viewDistance?: number;
    nearRatio?: number;
  }): Projection3D {
    const view = new Projection3D({
      viewDistance: options?.viewDistance,
      nearRatio: options?.nearRatio,
    });
    view.azimuth = options?.azimuth ?? Math.PI / 6;
    view.elevation = options?.elevation ?? 0.45;
    return view;
  }

  /**
   * @internal 视角参数**真正变化**时 +1(同值赋值、被忽略的非有限值都不变)。
   * 按视角缓存的派生量(3D 线条的遮挡索引)拿它当键。
   */
  get version(): number {
    return this.versionValue;
  }

  /** 绕 X 轴的相机仰角(弧度)。 */
  get rotX(): number {
    return this.rotXValue;
  }

  set rotX(value: number) {
    this.rotXValue = this.changed(this.rotXValue, finiteOr(value, this.rotXValue));
  }

  /** 绕 Y 轴的自转角(弧度)。 */
  get rotY(): number {
    return this.rotYValue;
  }

  set rotY(value: number) {
    this.rotYValue = this.changed(this.rotYValue, finiteOr(value, this.rotYValue));
  }

  /** 视距:越小透视越强。至少为 1。 */
  get viewDistance(): number {
    return this.viewDistanceValue;
  }

  set viewDistance(value: number) {
    this.viewDistanceValue = this.changed(
      this.viewDistanceValue,
      Number.isFinite(value) ? Math.max(1, value) : this.viewDistanceValue,
    );
  }

  /** 近平面比例:投影放大系数的上界为 1 / nearRatio。钳在 [0.01, 1]。 */
  get nearRatio(): number {
    return this.nearRatioValue;
  }

  set nearRatio(value: number) {
    this.nearRatioValue = this.changed(
      this.nearRatioValue,
      Number.isFinite(value) ? Math.min(1, Math.max(0.01, value)) : this.nearRatioValue,
    );
  }

  /**
   * 数学视角(z 朝上,见 mathPoint):观察者所在方向从数学 +X 轴绕 +Z 逆时针量的角(弧度)。
   * 就是 rotY 换个说法:rotY = −azimuth − π/2。Orbit3D(rotY 增大)在数学视角里是 azimuth 减小,
   * 从 +Z 往下看物体逆时针转。读出的值折回 (−π, π](Orbit3D 转过几圈 rotY 会累加 2π 的倍数,
   * 方位本身是周期的);写入任意有限值都行,非有限值忽略。
   */
  get azimuth(): number {
    const turn = Math.PI * 2;
    const raw = 0 - this.rotYValue - Math.PI / 2;
    const wrapped = raw - turn * Math.ceil((raw - Math.PI) / turn);
    // 折回结果是 −0 时换成 +0(比较时 Object.is 会被 −0 绊倒)。
    return wrapped === 0 ? 0 : wrapped;
  }

  set azimuth(value: number) {
    this.rotY = 0 - value - Math.PI / 2;
  }

  /** 数学视角:视线仰角(弧度,正值从上往下看)。就是 rotX 换个说法:rotX = −elevation。非有限值忽略。 */
  get elevation(): number {
    return 0 - this.rotXValue;
  }

  set elevation(value: number) {
    this.rotX = 0 - value;
  }

  /** 旋转到视图空间(先 rotY 再 rotX),等于 rotateVec(p, rotX, rotY)。 */
  toView(p: Readonly<Vec3>): Vec3 {
    const c = this.constants();
    const x1 = p.x * c.cosY + p.z * c.sinY;
    const z1 = -p.x * c.sinY + p.z * c.cosY;
    return { x: x1, y: p.y * c.cosX - z1 * c.sinX, z: p.y * c.sinX + z1 * c.cosX };
  }

  /**
   * 透视投影,公式与网格绘制(Mesh3D.updateView)逐项相同。
   * frame(通常直接传网格本身)给出时,结果是「这个 3D 点在 frame 的父坐标系里画在哪」:
   * frame.position + R(frame.rotation)·(frame.scale·(x, y)),与 MObject.render 同一顺序。
   * 非有限输入返回非有限结果,不抛错(热路径)。
   */
  project(p: Readonly<Vec3>, frame?: ProjectionFrame): ProjectedPoint {
    const c = this.constants();
    const x1 = p.x * c.cosY + p.z * c.sinY;
    const z1 = -p.x * c.sinY + p.z * c.cosY;
    const y = p.y * c.cosX - z1 * c.sinX;
    const z = p.y * c.sinX + z1 * c.cosX;
    const s = c.d / Math.max(c.minDenom, c.d - z);
    let x = x1 * s;
    let yy = y * s;
    if (frame) {
      const k = frame.scale;
      const r = frame.rotation ?? 0;
      const gx = x * k;
      const gy = yy * k;
      const cos = Math.cos(r);
      const sin = Math.sin(r);
      x = frame.position.x + gx * cos - gy * sin;
      yy = frame.position.y + gx * sin + gy * cos;
    }
    return { x, y: yy, depth: z, scale: s };
  }

  /** @internal 当前视角的投影常数(按 version 缓存,逐点投影不再重算三角函数)。 */
  constants(): ViewConstants {
    const hit = this.constantsCache;
    if (hit && this.constantsFor === this.versionValue) {
      return hit;
    }
    const d = this.viewDistanceValue;
    const value: ViewConstants = {
      cosX: Math.cos(this.rotXValue),
      sinX: Math.sin(this.rotXValue),
      cosY: Math.cos(this.rotYValue),
      sinY: Math.sin(this.rotYValue),
      d,
      minDenom: d * this.nearRatioValue,
    };
    this.constantsCache = value;
    this.constantsFor = this.versionValue;
    return value;
  }

  /** 新旧值不同(Object.is)时版本 +1,返回新值。 */
  private changed(previous: number, next: number): number {
    if (!Object.is(previous, next)) {
      this.versionValue += 1;
    }
    return next;
  }
}

/** 持有视角、能换视角的对象(网格、3D 线条、标注、坐标轴)。鸭子类型:这里不依赖任何图元。 */
export interface HasProjection {
  getProjection(): Projection3D;
  setProjection(projection: Projection3D): unknown;
}

/** 对象是否持有可换的视角(Space3D 统一视角用)。 */
export function hasProjection(m: object): m is HasProjection {
  const o = m as Partial<HasProjection>;
  return typeof o.getProjection === 'function' && typeof o.setProjection === 'function';
}
