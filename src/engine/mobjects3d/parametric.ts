import type { Vec3 } from './Mesh3D';

/**
 * 参数曲面的采样函数。
 * 可以挂上 uRange/vRange 声明自己的推荐定义域,ParametricSurface 会优先采用它,
 * 使用方不必记住「球面的 v 只到 π」这种约束。
 * 坐标约定同 Mesh3D:y 向下,预设曲面都以 y 为对称轴(与 Sphere/Cylinder/sdTorus 一致)。
 */
export interface ParamFn {
  (u: number, v: number, params: number[]): Vec3;
  uRange?: readonly [number, number];
  vRange?: readonly [number, number];
}

/** 给采样函数挂上推荐定义域。 */
function withDomain(
  fn: (u: number, v: number, params: number[]) => Vec3,
  domain: { uRange?: readonly [number, number]; vRange?: readonly [number, number] },
): ParamFn {
  return Object.assign(fn, domain);
}

/**
 * 球面,u 为经度 [0, 2π],v 为极角 [0, π](v = 0 是北极,在 -y 方向)。
 * 定义域已挂在函数上,直接 `new ParametricSurface(sphereParam(r))` 即可;
 * 也可以用 ParametricSurface 导出的 sphereSurface() 预设。
 */
export function sphereParam(radius: number): ParamFn {
  return withDomain(
    (u, v) => ({
      x: radius * Math.sin(v) * Math.cos(u),
      y: -radius * Math.cos(v),
      z: radius * Math.sin(v) * Math.sin(u),
    }),
    { vRange: [0, Math.PI] },
  );
}

/** 环面(主环在 xz 平面,轴为 y),u 绕主环 [0, 2π],v 绕管 [0, 2π]。 */
export function torusParam(mainRadius: number, tubeRadius: number): ParamFn {
  return (u, v) => ({
    x: (mainRadius + tubeRadius * Math.cos(v)) * Math.cos(u),
    y: tubeRadius * Math.sin(v),
    z: (mainRadius + tubeRadius * Math.cos(v)) * Math.sin(u),
  });
}

/** 莫比乌斯带(中心圆在 xz 平面),u [0, 2π],v 为带宽方向 [-1, 1] 缩放后。 */
export function mobiusParam(radius: number, halfWidth: number): ParamFn {
  return withDomain(
    (u, v) => {
      const w = v * halfWidth;
      const c = Math.cos(u / 2);
      const s = Math.sin(u / 2);
      return {
        x: (radius + w * c) * Math.cos(u),
        y: w * s,
        z: (radius + w * c) * Math.sin(u),
      };
    },
    { vRange: [-1, 1] },
  );
}

/**
 * 克莱因瓶标准浸入(「瓶子」形,长轴为 y),u ∈ [0, π]、v ∈ [0, 2π]。
 * 这组公式满足 f(u + π, v) = f(u, π − v):u 走满 [0, 2π] 会把整个瓶子覆盖两遍、
 * 两份的法线还相反,所以定义域只取一半;u = π 那条缝按 v 反向粘回 u = 0
 * (网格要对齐就让 vSegs 取偶数)。
 * 原始公式的包围盒中心在 (0.1532, 2.1031, 0),这里先平移到原点再乘 scale,
 * 与库内其它几何「以自身原点为中心」的约定一致(否则布局/取景都会偏)。
 * 平移后 x ≈ ±1.67、y ≈ ±2.10、z ≈ ±0.73,再乘 scale。
 */
const KLEIN_CENTER = { x: 0.1532, y: 2.1031 };

export function kleinParam(scale: number): ParamFn {
  return withDomain(
    (u, v) => {
      const cu = Math.cos(u);
      const su = Math.sin(u);
      const cv = Math.cos(v);
      const sv = Math.sin(v);
      const cu2 = cu * cu;
      const cu4 = cu2 * cu2;
      const cu6 = cu4 * cu2;
      const x =
        (-2 / 15) *
        cu *
        (3 * cv -
          30 * su +
          90 * cu4 * su -
          60 * cu6 * su +
          5 * cu * cv * su);
      const y =
        (-1 / 15) *
        su *
        (3 * cv -
          3 * cu2 * cv -
          48 * cu4 * cv +
          48 * cu6 * cv -
          60 * su +
          5 * cu * cv * su -
          5 * cu2 * cu * cv * su -
          80 * cu4 * cu * cv * su +
          80 * cu6 * cu * cv * su);
      const z = (2 / 15) * (3 + 5 * cu * su) * sv;
      return {
        x: (x - KLEIN_CENTER.x) * scale,
        y: (y - KLEIN_CENTER.y) * scale,
        z: z * scale,
      };
    },
    { uRange: [0, Math.PI] },
  );
}

/**
 * 球面到环面的同伦,params[0] = t ∈ [0, 1]。
 * 网格 u/v ∈ [0, 2π],球端把 v 折成极角 [0, π]。
 */
export function sphereTorusHomotopy(
  sphereRadius: number,
  mainRadius: number,
  tubeRadius: number,
): ParamFn {
  const sphere = sphereParam(sphereRadius);
  const torus = torusParam(mainRadius, tubeRadius);
  return (u, v, params) => {
    const t = params[0] ?? 0;
    const a = sphere(u, v / 2, params);
    const b = torus(u, v, params);
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
    };
  };
}
