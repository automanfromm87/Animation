import type { Mesh3DOptions, Vec3 } from './Mesh3D';
import { Mesh3D, requirePositiveSize } from './Mesh3D';

/** 分段数必须是 >= 3 的整数,否则会静默生成空壳网格(什么都不画)。 */
function requireSegments(name: string, segments: number): number {
  if (!Number.isInteger(segments) || segments < 3) {
    throw new Error(`${name} 需要至少 3 段,收到 ${segments}`);
  }
  return segments;
}

function boxVertices(hx: number, hy: number, hz: number): Vec3[] {
  return [
    { x: -hx, y: -hy, z: -hz },
    { x: hx, y: -hy, z: -hz },
    { x: hx, y: hy, z: -hz },
    { x: -hx, y: hy, z: -hz },
    { x: -hx, y: -hy, z: hz },
    { x: hx, y: -hy, z: hz },
    { x: hx, y: hy, z: hz },
    { x: -hx, y: hy, z: hz },
  ];
}

const BOX_FACES: number[][] = [
  [4, 5, 6, 7],
  [0, 1, 2, 3],
  [0, 3, 7, 4],
  [1, 2, 6, 5],
  [0, 1, 5, 4],
  [3, 2, 6, 7],
];

export class Cube extends Mesh3D {
  constructor(size = 70, options?: Mesh3DOptions) {
    const h = requirePositiveSize('Cube 的 size', size) / 2;
    super(boxVertices(h, h, h), BOX_FACES, options);
  }
}

export class Cuboid extends Mesh3D {
  constructor(width = 90, height = 60, depth = 50, options?: Mesh3DOptions) {
    super(
      boxVertices(
        requirePositiveSize('Cuboid 的 width', width) / 2,
        requirePositiveSize('Cuboid 的 height', height) / 2,
        requirePositiveSize('Cuboid 的 depth', depth) / 2,
      ),
      BOX_FACES,
      options,
    );
  }
}

/** 四棱锥:底面在 y = +height/2,尖顶朝上(-y)。 */
export class Pyramid extends Mesh3D {
  constructor(baseSize = 80, height = 85, options?: Mesh3DOptions) {
    const h = requirePositiveSize('Pyramid 的 baseSize', baseSize) / 2;
    const half = requirePositiveSize('Pyramid 的 height', height) / 2;
    super(
      [
        { x: -h, y: half, z: -h },
        { x: h, y: half, z: -h },
        { x: h, y: half, z: h },
        { x: -h, y: half, z: h },
        { x: 0, y: -half, z: 0 },
      ],
      [
        [0, 1, 2, 3],
        [0, 1, 4],
        [1, 2, 4],
        [2, 3, 4],
        [3, 0, 4],
      ],
      options,
    );
  }
}

export class Tetrahedron extends Mesh3D {
  constructor(radius = 60, options?: Mesh3DOptions) {
    const s = requirePositiveSize('Tetrahedron 的 radius', radius) / Math.sqrt(3);
    super(
      [
        { x: s, y: s, z: s },
        { x: s, y: -s, z: -s },
        { x: -s, y: s, z: -s },
        { x: -s, y: -s, z: s },
      ],
      [
        [0, 1, 2],
        [0, 3, 1],
        [0, 2, 3],
        [1, 3, 2],
      ],
      options,
    );
  }
}

/** 三棱柱:三角截面在 xz 平面,沿 y 轴拉伸 height(与其它立体一样以 y 为轴)。 */
export class TriangularPrism extends Mesh3D {
  constructor(radius = 50, height = 60, options?: Mesh3DOptions) {
    requirePositiveSize('TriangularPrism 的 radius', radius);
    const hy = requirePositiveSize('TriangularPrism 的 height', height) / 2;
    const ring: Array<{ x: number; z: number }> = [];
    for (let i = 0; i < 3; i++) {
      const angle = -Math.PI / 2 + (i * Math.PI * 2) / 3;
      ring.push({ x: Math.cos(angle) * radius, z: Math.sin(angle) * radius });
    }
    const vertices: Vec3[] = [
      ...ring.map((p) => ({ x: p.x, y: hy, z: p.z })),
      ...ring.map((p) => ({ x: p.x, y: -hy, z: p.z })),
    ];
    super(
      vertices,
      [
        [0, 1, 2],
        [3, 4, 5],
        [0, 1, 4, 3],
        [1, 2, 5, 4],
        [2, 0, 3, 5],
      ],
      options,
    );
  }
}

function ringVertices(radius: number, y: number, segments: number): Vec3[] {
  const points: Vec3[] = [];
  for (let i = 0; i < segments; i++) {
    const angle = (i * Math.PI * 2) / segments;
    points.push({ x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius });
  }
  return points;
}

/** 旋转体(圆柱/圆锥)的选项。 */
export interface RevolvedOptions extends Mesh3DOptions {
  radius?: number;
  height?: number;
  /** 圆周分段数(>= 3 的整数)。 */
  segments?: number;
}

/** 圆柱:轴为 y。 */
export class Cylinder extends Mesh3D {
  constructor(options: RevolvedOptions);
  constructor(radius?: number, height?: number, segments?: number, options?: Mesh3DOptions);
  constructor(a: number | RevolvedOptions = 40, h = 80, seg = 24, options?: Mesh3DOptions) {
    const o: RevolvedOptions =
      typeof a === 'object' ? a : { ...options, radius: a, height: h, segments: seg };
    const radius = o.radius ?? 40;
    const height = o.height ?? 80;
    const segments = o.segments ?? 24;
    requirePositiveSize('Cylinder 的 radius', radius);
    requireSegments('Cylinder', segments);
    const hy = requirePositiveSize('Cylinder 的 height', height) / 2;
    const bottom = ringVertices(radius, hy, segments);
    const top = ringVertices(radius, -hy, segments);
    const vertices = [...bottom, ...top];
    const faces: number[][] = [];
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      faces.push([i, next, segments + next, segments + i]);
    }
    faces.push(top.map((_, i) => segments + i));
    faces.push(bottom.map((_, i) => i));
    super(vertices, faces, o);
  }
}

/** 圆锥:轴为 y,底面在 y = +height/2,尖顶朝上(-y)。 */
export class Cone extends Mesh3D {
  constructor(options: RevolvedOptions);
  constructor(radius?: number, height?: number, segments?: number, options?: Mesh3DOptions);
  constructor(a: number | RevolvedOptions = 45, h = 85, seg = 24, options?: Mesh3DOptions) {
    const o: RevolvedOptions =
      typeof a === 'object' ? a : { ...options, radius: a, height: h, segments: seg };
    const radius = o.radius ?? 45;
    const height = o.height ?? 85;
    const segments = o.segments ?? 24;
    requirePositiveSize('Cone 的 radius', radius);
    requirePositiveSize('Cone 的 height', height);
    requireSegments('Cone', segments);
    const base = ringVertices(radius, height / 2, segments);
    const vertices = [...base, { x: 0, y: -height / 2, z: 0 }];
    const apex = segments;
    const faces: number[][] = [];
    for (let i = 0; i < segments; i++) {
      const next = (i + 1) % segments;
      faces.push([apex, i, next]);
    }
    faces.push(base.map((_, i) => i));
    super(vertices, faces, o);
  }
}

/** 经纬球:极轴为 y(北极在 -y)。 */
export interface SphereOptions extends Mesh3DOptions {
  radius?: number;
  /** 经线方向(绕极轴)分段数,>= 3 的整数。 */
  lonSegments?: number;
  /** 纬线方向(极到极)分段数,>= 3 的整数。 */
  latSegments?: number;
}

export class Sphere extends Mesh3D {
  constructor(options: SphereOptions);
  constructor(
    radius?: number,
    lonSegments?: number,
    latSegments?: number,
    options?: Mesh3DOptions,
  );
  constructor(
    a: number | SphereOptions = 48,
    lon = 24,
    lat = 16,
    options?: Mesh3DOptions,
  ) {
    const o: SphereOptions =
      typeof a === 'object' ? a : { ...options, radius: a, lonSegments: lon, latSegments: lat };
    const radius = o.radius ?? 48;
    const lonSegments = o.lonSegments ?? 24;
    const latSegments = o.latSegments ?? 16;
    requirePositiveSize('Sphere 的 radius', radius);
    requireSegments('Sphere 的 lonSegments', lonSegments);
    requireSegments('Sphere 的 latSegments', latSegments);
    const vertices: Vec3[] = [];
    for (let j = 0; j <= latSegments; j++) {
      const theta = (j * Math.PI) / latSegments;
      const ringRadius = radius * Math.sin(theta);
      const y = -radius * Math.cos(theta);
      for (let i = 0; i < lonSegments; i++) {
        const phi = (i * Math.PI * 2) / lonSegments;
        vertices.push({
          x: ringRadius * Math.cos(phi),
          y,
          z: ringRadius * Math.sin(phi),
        });
      }
    }
    const faces: number[][] = [];
    for (let j = 0; j < latSegments; j++) {
      for (let i = 0; i < lonSegments; i++) {
        const next = (i + 1) % lonSegments;
        faces.push([
          j * lonSegments + i,
          j * lonSegments + next,
          (j + 1) * lonSegments + next,
          (j + 1) * lonSegments + i,
        ]);
      }
    }
    super(vertices, faces, o);
  }
}
