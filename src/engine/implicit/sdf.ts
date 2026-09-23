/** FieldFn:有向距离场,params 由调用方定义(比如混合系数 t)。 */
export type FieldFn = (x: number, y: number, z: number, params: number[]) => number;

export function sdSphere(x: number, y: number, z: number, radius: number): number {
  return Math.hypot(x, y, z) - radius;
}

/** 圆环体,主环在 xz 平面,轴向为 y。 */
export function sdTorus(
  x: number,
  y: number,
  z: number,
  mainRadius: number,
  tubeRadius: number,
): number {
  const qx = Math.hypot(x, z) - mainRadius;
  return Math.hypot(qx, y) - tubeRadius;
}

/** 球面到圆环体的场混合,params[0] = t。零等值面在途中改变亏格。 */
export function sphereToTorusField(
  sphereRadius: number,
  mainRadius: number,
  tubeRadius: number,
): FieldFn {
  return (x, y, z, params) => {
    const t = params[0] ?? 0;
    const a = sdSphere(x, y, z, sphereRadius);
    const b = sdTorus(x, y, z, mainRadius, tubeRadius);
    return a + (b - a) * t;
  };
}
