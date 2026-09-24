/**
 * 3D 坐标约定(全库一致):x 向右、y 向下(与 Canvas 一致)、z 指向观察者,角度一律弧度。
 * 视点在旋转后坐标系的 (0, 0, viewDistance),朝 -z 看。
 * 轴对称的立体、距离场与参数曲面预设都以 y 为对称轴。
 * 作为物理空间它是左手系;课本上的右手系、z 朝上的坐标用 mathPoint 换算。
 * 这个模块没有依赖:Projection3D、Mesh3D 与 3D 线条都从这里取 Vec3,不会成环。
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/**
 * 先绕 Y 轴转 rotY(物体自转),再绕 X 轴转 rotX(相机仰角)。
 * 顺序不能反:反过来 rotY 会变成绕世界 Y 轴的方位角,
 * Spin3D 就不是原地转台旋转而是「俯视/仰视来回翻」。
 */
export function rotateVec(v: Readonly<Vec3>, rotX: number, rotY: number): Vec3 {
  const cosY = Math.cos(rotY);
  const sinY = Math.sin(rotY);
  const x1 = v.x * cosY + v.z * sinY;
  const z1 = -v.x * sinY + v.z * cosY;
  const cosX = Math.cos(rotX);
  const sinX = Math.sin(rotX);
  return {
    x: x1,
    y: v.y * cosX - z1 * sinX,
    z: v.y * sinX + z1 * cosX,
  };
}

/**
 * 数学坐标(右手系、z 朝上)→ 引擎坐标:(x, y, z) ↦ (x, −z, −y) · unit。
 * 行列式为 −1,正好把右手系画成屏幕上看起来的右手系;内置立体以引擎 y 为轴,
 * 换到数学坐标里正好沿 Z 立着(圆锥尖朝 +Z)。
 * 写成 `0 - z * unit`:不产生 −0(比较坐标时 Object.is 会被 −0 绊倒)。
 * 热路径,不校验:非有限输入原样产出非有限输出。
 */
export function mathPoint(x: number, y: number, z: number, unit = 1): Vec3 {
  return { x: 0 + x * unit, y: 0 - z * unit, z: 0 - y * unit };
}

/** 三个分量都是有限数。 */
export function isFiniteVec3(p: Readonly<Vec3>): boolean {
  return Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
}

/** 有限坐标的拷贝,否则抛错(name 写进报错里)。 */
export function requireFiniteVec3(name: string, p: Readonly<Vec3>): Vec3 {
  if (!isFiniteVec3(p)) {
    throw new Error(`${name} 需要有限坐标,收到 (${p.x}, ${p.y}, ${p.z})`);
  }
  return { x: p.x, y: p.y, z: p.z };
}
