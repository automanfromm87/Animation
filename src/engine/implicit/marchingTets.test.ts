import { close, equal, ok, suite } from '../../testing/harness';
import { polygonize } from './marchingTets';
import { sdSphere, sdTorus, sphereToTorusField } from './sdf';

/** 统计每条边被几个面共用。闭合曲面上应该全是 2。 */
function edgeUse(faces: readonly number[][], vertexCount: number): Map<number, number> {
  const stride = vertexCount + 1;
  const use = new Map<number, number>();
  for (const face of faces) {
    for (let k = 0; k < face.length; k++) {
      const a = face[k] ?? 0;
      const b = face[(k + 1) % face.length] ?? 0;
      const key = a < b ? a * stride + b : b * stride + a;
      use.set(key, (use.get(key) ?? 0) + 1);
    }
  }
  return use;
}

const sphere = polygonize((x, y, z) => sdSphere(x, y, z, 30), 50, 20);
const torus = polygonize((x, y, z) => sdTorus(x, y, z, 30, 12), 50, 22);

export default suite('marchingTets', [
  [
    '球面等值面闭合:没有边界边,也没有非流形边',
    () => {
      const use = edgeUse(sphere.faces, sphere.vertices.length);
      let boundary = 0;
      let nonManifold = 0;
      for (const count of use.values()) {
        if (count === 1) {
          boundary += 1;
        } else if (count > 2) {
          nonManifold += 1;
        }
      }
      equal(boundary, 0, `${boundary} 条边界边`);
      equal(nonManifold, 0, `${nonManifold} 条非流形边`);
    },
  ],
  [
    '环面等值面同样闭合(亏格 1 也不能有破口)',
    () => {
      const use = edgeUse(torus.faces, torus.vertices.length);
      let boundary = 0;
      for (const count of use.values()) {
        if (count === 1) {
          boundary += 1;
        }
      }
      equal(boundary, 0, `${boundary} 条边界边`);
    },
  ],
  [
    '输出是索引网格而不是三角汤(顶点被复用)',
    () => {
      ok(sphere.faces.length > 100, '样本太小,测不出什么');
      ok(
        sphere.vertices.length < sphere.faces.length * 3 * 0.4,
        `顶点没有被复用:${sphere.vertices.length} 顶点 / ${sphere.faces.length} 面`,
      );
    },
  ],
  [
    '所有顶点都落在等值面上(线性插值精度内)',
    () => {
      let worst = 0;
      for (const v of sphere.vertices) {
        worst = Math.max(worst, Math.abs(Math.hypot(v.x, v.y, v.z) - 30));
      }
      ok(worst < 1.5, `最大偏差 ${worst}`);
    },
  ],
  [
    '没有退化三角形',
    () => {
      for (const [a, b, c] of sphere.faces) {
        ok(a !== b && b !== c && a !== c, `退化面 ${a},${b},${c}`);
      }
    },
  ],
  [
    '欧拉示性数:球面 V-E+F = 2,环面 = 0',
    () => {
      const sV = sphere.vertices.length;
      const sE = edgeUse(sphere.faces, sV).size;
      close(sV - sE + sphere.faces.length, 2, 0);
      const tV = torus.vertices.length;
      const tE = edgeUse(torus.faces, tV).size;
      close(tV - tE + torus.faces.length, 0, 0);
    },
  ],
  [
    '场里出现 ±Infinity 时不产出 NaN 顶点',
    () => {
      const result = polygonize(
        (x, y, z) => Math.log(Math.hypot(x, y, z)) - Math.log(30),
        70,
        22,
      );
      for (const v of result.vertices) {
        ok(
          Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z),
          '出现了非有限顶点',
        );
      }
    },
  ],
  [
    'resolution 必须是正整数,否则立刻抛错而不是静默出垃圾网格',
    () => {
      let threw = 0;
      for (const bad of [0, -3, 22.5, NaN]) {
        try {
          polygonize((x) => x, 50, bad);
        } catch {
          threw += 1;
        }
      }
      equal(threw, 4);
    },
  ],
  [
    'resolution 大到棱缓存吃掉上百 MB 时直接抛错',
    () => {
      let threw = false;
      try {
        polygonize((x, y, z) => Math.hypot(x, y, z) - 1, 50, 600);
      } catch {
        threw = true;
      }
      ok(threw, '600 分辨率应该被挡住(2.2 亿个网格点)');
    },
  ],
  [
    '跨调用复用缓冲不串结果:大-小-大交替调用,结果与首次一致',
    () => {
      const field = (x: number, y: number, z: number): number => sdTorus(x, y, z, 30, 12);
      const first = polygonize(field, 50, 22);
      polygonize((x, y, z) => sdSphere(x, y, z, 20), 50, 9);
      const again = polygonize(field, 50, 22);
      equal(again.vertices.length, first.vertices.length);
      equal(again.faces.length, first.faces.length);
      equal(JSON.stringify(again.faces), JSON.stringify(first.faces));
    },
  ],
  [
    '场函数里递归调用 polygonize(重入)也不串结果',
    () => {
      const inner = { count: 0 };
      const result = polygonize(
        (x, y, z) => {
          if (inner.count === 0) {
            inner.count = polygonize((a, b, c) => sdSphere(a, b, c, 10), 20, 6).faces.length;
          }
          return sdSphere(x, y, z, 30);
        },
        50,
        20,
      );
      equal(result.faces.length, sphere.faces.length);
      ok(inner.count > 0);
    },
  ],
  [
    '三角形绕序统一:右手法线一律指向场值增大的一侧,且没有零面积面',
    () => {
      const homotopy = sphereToTorusField(36, 30, 12);
      const cases: ReadonlyArray<
        readonly [string, (x: number, y: number, z: number) => number, number, number]
      > = [
        ['球 res16', (x, y, z) => sdSphere(x, y, z, 30), 50, 16],
        // res20 的格点恰好落在 r=30 上,专门盯住「交点落在格点」那条退化路径。
        ['球 res20', (x, y, z) => sdSphere(x, y, z, 30), 50, 20],
        ['球 res30', (x, y, z) => sdSphere(x, y, z, 30), 50, 30],
        [
          '立方 res20',
          (x, y, z) => Math.max(Math.abs(x), Math.abs(y), Math.abs(z)) - 25,
          50,
          20,
        ],
        ['环 res20', (x, y, z) => sdTorus(x, y, z, 30, 12), 50, 20],
        ['同伦 t=0', (x, y, z) => homotopy(x, y, z, [0]), 58, 22],
        ['同伦 t=0.5', (x, y, z) => homotopy(x, y, z, [0.5]), 58, 22],
        ['同伦 t=1', (x, y, z) => homotopy(x, y, z, [1]), 58, 22],
      ];
      for (const [name, field, bounds, res] of cases) {
        const mesh = polygonize(field, bounds, res);
        const step = (bounds * 2) / res;
        const areaEps = step * step * 1e-9;
        const eps = step * 0.1;
        let wrong = 0;
        let degenerate = 0;
        for (const face of mesh.faces) {
          const a = mesh.vertices[face[0] ?? -1];
          const b = mesh.vertices[face[1] ?? -1];
          const c = mesh.vertices[face[2] ?? -1];
          if (!a || !b || !c) {
            continue;
          }
          const ux = b.x - a.x;
          const uy = b.y - a.y;
          const uz = b.z - a.z;
          const wx = c.x - a.x;
          const wy = c.y - a.y;
          const wz = c.z - a.z;
          const nx = uy * wz - uz * wy;
          const ny = uz * wx - ux * wz;
          const nz = ux * wy - uy * wx;
          // 零面积面的叉积是 0,点积必然是 0:那是退化,不是绕序错。
          if (Math.hypot(nx, ny, nz) <= areaEps) {
            degenerate += 1;
            continue;
          }
          const cx = (a.x + b.x + c.x) / 3;
          const cy = (a.y + b.y + c.y) / 3;
          const cz = (a.z + b.z + c.z) / 3;
          const gx = field(cx + eps, cy, cz) - field(cx - eps, cy, cz);
          const gy = field(cx, cy + eps, cz) - field(cx, cy - eps, cz);
          const gz = field(cx, cy, cz + eps) - field(cx, cy, cz - eps);
          if (nx * gx + ny * gy + nz * gz < 0) {
            wrong += 1;
          }
        }
        equal(wrong, 0, `${name}:${wrong}/${mesh.faces.length} 个面绕序反了`);
        equal(degenerate, 0, `${name}:${degenerate} 个零面积面`);
      }
    },
  ],
  [
    '有向半边全部成对:绕序一致的闭合网格不该有落单的半边',
    () => {
      for (const [name, field, bounds, res] of [
        ['球 res20', (x: number, y: number, z: number) => sdSphere(x, y, z, 30), 50, 20],
        ['环 res22', (x: number, y: number, z: number) => sdTorus(x, y, z, 30, 12), 50, 22],
      ] as const) {
        const mesh = polygonize(field, bounds, res);
        const half = new Set<string>();
        for (const [i, j, k] of mesh.faces) {
          half.add(`${i},${j}`);
          half.add(`${j},${k}`);
          half.add(`${k},${i}`);
        }
        let unpaired = 0;
        for (const key of half) {
          const [p, q] = key.split(',');
          if (!half.has(`${q},${p}`)) {
            unpaired += 1;
          }
        }
        equal(unpaired, 0, `${name}:${unpaired} 条半边没配对`);
      }
    },
  ],
]);
