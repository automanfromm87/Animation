/** 非有限值一律忽略,保留旧值:rotX/rotY 是动画热路径,不做范围钳位。 */
function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

/**
 * Projection3D:一组网格共享的 3D 视角。
 *
 * 默认每个 Mesh3D 各持一份(行为与单独设置 rotX/rotY 时一样);
 * 把同一个实例交给多个网格,它们就共用同一套视角,
 * 一个 Orbit3D 动画即可驱动整组,不必给每个网格各播一个 Spin3D。
 * 反过来也要注意:共享之后对其中**任何一个**网格播 Spin3D 都会带动整组。
 *
 * 所有字段都走带校验的访问器:它是共享可写状态,
 * 一个网格写进 NaN 会让共用这套视角的整组立体静默消失。
 *
 * 已知取舍:投影仍以**每个网格自身的原点**为灭点(MObject 在自己的局部
 * 坐标系里绘制),所以并排摆放的两个立体各有各的灭点,不是严格的单点透视。
 * 要做到统一灭点需要让渲染层把世界坐标传进 drawShape,那是另一层改动。
 */
export class Projection3D {
  private rotXValue = -0.45;
  private rotYValue = 0.6;
  private viewDistanceValue = 700;
  private nearRatioValue = 0.2;

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

  /** 绕 X 轴的相机仰角(弧度)。 */
  get rotX(): number {
    return this.rotXValue;
  }

  set rotX(value: number) {
    this.rotXValue = finiteOr(value, this.rotXValue);
  }

  /** 绕 Y 轴的自转角(弧度)。 */
  get rotY(): number {
    return this.rotYValue;
  }

  set rotY(value: number) {
    this.rotYValue = finiteOr(value, this.rotYValue);
  }

  /** 视距:越小透视越强。至少为 1。 */
  get viewDistance(): number {
    return this.viewDistanceValue;
  }

  set viewDistance(value: number) {
    this.viewDistanceValue = Number.isFinite(value)
      ? Math.max(1, value)
      : this.viewDistanceValue;
  }

  /** 近平面比例:投影放大系数的上界为 1 / nearRatio。钳在 [0.01, 1]。 */
  get nearRatio(): number {
    return this.nearRatioValue;
  }

  set nearRatio(value: number) {
    this.nearRatioValue = Number.isFinite(value)
      ? Math.min(1, Math.max(0.01, value))
      : this.nearRatioValue;
  }
}
