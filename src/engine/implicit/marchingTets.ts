import type { Vec3 } from '../mobjects3d/Mesh3D';

/**
 * Marching tetrahedra:把每个体素沿主对角线剖成 6 个四面体,
 * 每个四面体按 16 种内外组合查表生成三角形。表格小、无二义性。
 *
 * 输出的是**索引网格**而不是三角汤:表面顶点唯一对应一条网格棱,
 * 按棱复用顶点,顶点数降到 1/6 左右,天然焊接。
 * 这种剖分(Kuhn 剖分)里每条棱都从低端格点沿 7 个方向之一出发
 * ((1,0,0) … (1,1,1)),所以棱缓存直接用「格点 × 7」的 Int32Array 寻址,不走 Map。
 *
 * 三角形绕序统一为「右手法线指向场值增大的一侧(体外)」。
 * 这不是靠查表的绕序保证的(那张表的互补分支并不自洽),
 * 而是在生成每个三角形时按该四面体的内外质心方向当场定向。
 */

/**
 * 网格点上限。棱缓存是 7 × 网格点个 Int32,4M 个点时约 117MB,再大就不值得了
 * (res = 160 已经是 400 万次场求值)。
 */
const MAX_GRID_POINTS = 2 ** 22;

// 体素角点编号 c = x + 2y + 4z:
// c0=(0,0,0) c1=(1,0,0) c2=(0,1,0) c3=(1,1,0)
// c4=(0,0,1) c5=(1,0,1) c6=(0,1,1) c7=(1,1,1)。
// 6 个四面体沿主对角线 (0,7) 剖分体素,赤道环序为 (1,3,2,6,4,5)。
const TETS: ReadonlyArray<readonly [number, number, number, number]> = [
  [0, 7, 1, 3],
  [0, 7, 3, 2],
  [0, 7, 2, 6],
  [0, 7, 6, 4],
  [0, 7, 4, 5],
  [0, 7, 5, 1],
];

// 四面体边编号:0:e01 1:e02 2:e03 3:e12 4:e13 5:e23。
const TET_EDGES: ReadonlyArray<readonly [number, number]> = [
  [0, 1],
  [0, 2],
  [0, 3],
  [1, 2],
  [1, 3],
  [2, 3],
];

// 16 种情况的三角剖分(边索引三元组),bit i = 顶点 i 在内。
const TET_TABLE: ReadonlyArray<ReadonlyArray<readonly [number, number, number]>> = [
  [],
  [[0, 1, 2]],
  [[0, 3, 4]],
  [
    [1, 3, 4],
    [1, 4, 2],
  ],
  [[1, 3, 5]],
  [
    [0, 3, 5],
    [0, 5, 2],
  ],
  [
    [0, 4, 5],
    [0, 5, 1],
  ],
  [[2, 4, 5]],
  [[2, 4, 5]],
  [
    [0, 1, 5],
    [0, 5, 4],
  ],
  [
    [0, 3, 5],
    [0, 5, 2],
  ],
  [[1, 3, 5]],
  [
    [1, 3, 4],
    [1, 4, 2],
  ],
  [[0, 3, 4]],
  [[0, 1, 2]],
  [],
];

/**
 * 每个四面体的每条边:低端角点(按位是高端的子集)与 Kuhn 方向(0..6)。
 * 方向 = 高端角点 xor 低端角点 − 1,即 (dx + 2dy + 4dz) − 1。
 */
const EDGE_LO = new Int8Array(36);
const EDGE_HI = new Int8Array(36);
const EDGE_DIR = new Int8Array(36);
for (let t = 0; t < 6; t++) {
  const tet = TETS[t] ?? [0, 0, 0, 0];
  for (let e = 0; e < 6; e++) {
    const pair = TET_EDGES[e] ?? [0, 0];
    const ca = tet[pair[0]] ?? 0;
    const cb = tet[pair[1]] ?? 0;
    const lo = (ca & cb) === ca ? ca : cb;
    const hi = lo === ca ? cb : ca;
    if ((lo & hi) !== lo || lo === hi) {
      throw new Error('marchingTets: 四面体剖分不是 Kuhn 剖分');
    }
    EDGE_LO[t * 6 + e] = lo;
    EDGE_HI[t * 6 + e] = hi;
    EDGE_DIR[t * 6 + e] = (lo ^ hi) - 1;
  }
}

/** 非有限场值的替身:NaN / +Inf 记为体外,-Inf 记为体内。 */
const FAR_OUTSIDE = 1e30;
const FAR_INSIDE = -1e30;
/** 插值参数贴到棱端点的容差,用来识别「交点落在格点上」。 */
const SNAP_TOL = 1e-9;

export interface PolygonResult {
  vertices: Vec3[];
  faces: number[][];
}

// 跨调用复用的大缓冲(隐式曲面逐帧重采样时不再每次分配几 MB)。重入时退回临时分配。
// 只复用到 SCRATCH_MAX_POINTS 为止:更高的分辨率临时分配、用完即弃,
// 否则跑过一次 res 150 就永久占着一百多 MB。
const SCRATCH_MAX_POINTS = 65 ** 3; // res 64,约 11MB
let scratchValues = new Float64Array(0);
let scratchEdge = new Int32Array(0);
let scratchGrid = new Int32Array(0);
let scratchBusy = false;

/**
 * 提取 field 的零等值面。bounds 为立方体半边长,res 为每边体素数(正整数)。
 * 网格值先缓存,每个体素复用 8 角点,避免重复求值。
 */
export function polygonize(
  field: (x: number, y: number, z: number) => number,
  bounds: number,
  res: number,
): PolygonResult {
  if (!Number.isInteger(res) || res < 1) {
    throw new Error(`polygonize: resolution 需要正整数,收到 ${res}`);
  }
  if (!(bounds > 0) || !Number.isFinite(bounds)) {
    throw new Error(`polygonize: bounds 需要正有限数,收到 ${bounds}`);
  }
  const n = res + 1;
  const plane = n * n;
  const total = plane * n;
  if (total > MAX_GRID_POINTS) {
    throw new Error(
      `polygonize: resolution ${res} 过大(网格点 ${total} 超过上限 ${MAX_GRID_POINTS})`,
    );
  }
  const reuse = !scratchBusy && total <= SCRATCH_MAX_POINTS;
  if (reuse) {
    scratchBusy = true;
  }
  try {
    let values: Float64Array;
    let edgeVertex: Int32Array;
    let gridVertex: Int32Array;
    if (reuse) {
      if (scratchValues.length < total) {
        scratchValues = new Float64Array(total);
        scratchEdge = new Int32Array(total * 7);
        scratchGrid = new Int32Array(total);
      }
      values = scratchValues;
      edgeVertex = scratchEdge;
      gridVertex = scratchGrid;
    } else {
      values = new Float64Array(total);
      edgeVertex = new Int32Array(total * 7);
      gridVertex = new Int32Array(total);
    }
    edgeVertex.fill(-1, 0, total * 7);
    gridVertex.fill(-1, 0, total);
    return march(field, bounds, res, values, edgeVertex, gridVertex);
  } finally {
    if (reuse) {
      scratchBusy = false;
    }
  }
}

function march(
  field: (x: number, y: number, z: number) => number,
  bounds: number,
  res: number,
  values: Float64Array,
  edgeVertex: Int32Array,
  gridVertex: Int32Array,
): PolygonResult {
  const n = res + 1;
  const plane = n * n;
  const step = (bounds * 2) / res;
  for (let k = 0; k < n; k++) {
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const raw = field(-bounds + i * step, -bounds + j * step, -bounds + k * step);
        values[(k * n + j) * n + i] = Number.isFinite(raw)
          ? raw
          : raw < 0
            ? FAR_INSIDE
            : FAR_OUTSIDE;
      }
    }
  }
  // 角点 c 相对体素原点的网格下标偏移。
  const cornerOffset = new Int32Array(8);
  for (let c = 0; c < 8; c++) {
    cornerOffset[c] = (c & 1) + ((c >> 1) & 1) * n + ((c >> 2) & 1) * plane;
  }
  const vertices: Vec3[] = [];
  const faces: number[][] = [];
  const vals = new Float64Array(8);

  /** 体素 (i,j,k) 里第 t 个四面体第 e 条边上的等值点,返回顶点下标(按棱/格点复用)。 */
  const vertexOnEdge = (i: number, j: number, k: number, base: number, slot: number): number => {
    const lo = EDGE_LO[slot] ?? 0;
    const hi = EDGE_HI[slot] ?? 0;
    const dir = EDGE_DIR[slot] ?? 0;
    const gLo = base + (cornerOffset[lo] ?? 0);
    const gHi = base + (cornerOffset[hi] ?? 0);
    const v0 = values[gLo] ?? 0;
    const v1 = values[gHi] ?? 0;
    let t = v0 === v1 ? 0.5 : v0 / (v0 - v1);
    if (!Number.isFinite(t)) {
      t = 0.5;
    }
    t = Math.min(1, Math.max(0, t));
    // 交点落在格点上(场值恰好为 0)时按**格点**缓存而不是按棱缓存:
    // 否则同一个位置会从不同的棱拿到不同的顶点下标,产生「下标不同、坐标重合」
    // 的零面积三角形,既躲过退化检查又破坏半边定向。
    let cacheIndex: number;
    let table: Int32Array;
    if (t <= SNAP_TOL || t >= 1 - SNAP_TOL) {
      // 把 t 吸附到端点:否则同一个格点先后算出的坐标会差一个 ULP。
      t = t <= SNAP_TOL ? 0 : 1;
      table = gridVertex;
      cacheIndex = t === 0 ? gLo : gHi;
    } else {
      table = edgeVertex;
      cacheIndex = gLo * 7 + dir;
    }
    const hit = table[cacheIndex] ?? -1;
    if (hit >= 0) {
      return hit;
    }
    const d = dir + 1;
    const x0 = i + (lo & 1);
    const y0 = j + ((lo >> 1) & 1);
    const z0 = k + ((lo >> 2) & 1);
    const index = vertices.length;
    vertices.push({
      x: -bounds + (x0 + (d & 1) * t) * step,
      y: -bounds + (y0 + ((d >> 1) & 1) * t) * step,
      z: -bounds + (z0 + ((d >> 2) & 1) * t) * step,
    });
    table[cacheIndex] = index;
    return index;
  };

  for (let k = 0; k < res; k++) {
    for (let j = 0; j < res; j++) {
      for (let i = 0; i < res; i++) {
        const base = (k * n + j) * n + i;
        let inside = 0;
        for (let c = 0; c < 8; c++) {
          const value = values[base + (cornerOffset[c] ?? 0)] ?? 0;
          vals[c] = value;
          if (value < 0) {
            inside += 1;
          }
        }
        // 八个角同侧 => 这个体素不含等值面,跳过(实测能跳掉 95% 以上)。
        if (inside === 0 || inside === 8) {
          continue;
        }
        for (let t = 0; t < 6; t++) {
          const tet = TETS[t] ?? [0, 0, 0, 0];
          let index = 0;
          // 这个四面体里「体内质心 -> 体外质心」的方向(体素局部坐标),用来统一三角形绕序。
          let inX = 0;
          let inY = 0;
          let inZ = 0;
          let inN = 0;
          let outX = 0;
          let outY = 0;
          let outZ = 0;
          let outN = 0;
          for (let q = 0; q < 4; q++) {
            const c = tet[q] ?? 0;
            const cx = c & 1;
            const cy = (c >> 1) & 1;
            const cz = (c >> 2) & 1;
            if ((vals[c] ?? 0) < 0) {
              index |= 1 << q;
              inX += cx;
              inY += cy;
              inZ += cz;
              inN += 1;
            } else {
              outX += cx;
              outY += cy;
              outZ += cz;
              outN += 1;
            }
          }
          const tris = TET_TABLE[index];
          if (!tris || tris.length === 0) {
            continue;
          }
          // 表非空即说明内外各至少一个角点。
          const refX = outX / outN - inX / inN;
          const refY = outY / outN - inY / inN;
          const refZ = outZ / outN - inZ / inN;
          for (const tri of tris) {
            const va = vertexOnEdge(i, j, k, base, t * 6 + tri[0]);
            const vb = vertexOnEdge(i, j, k, base, t * 6 + tri[1]);
            const vc = vertexOnEdge(i, j, k, base, t * 6 + tri[2]);
            // 退化三角形(两点落在同一条棱或同一格点上)会污染半边计数,直接丢掉。
            if (va === vb || vb === vc || va === vc) {
              continue;
            }
            const pa = vertices[va];
            const pb = vertices[vb];
            const pc = vertices[vc];
            if (!pa || !pb || !pc) {
              continue;
            }
            const ux = pb.x - pa.x;
            const uy = pb.y - pa.y;
            const uz = pb.z - pa.z;
            const wx = pc.x - pa.x;
            const wy = pc.y - pa.y;
            const wz = pc.z - pa.z;
            const nx = uy * wz - uz * wy;
            const ny = uz * wx - ux * wz;
            const nz = ux * wy - uy * wx;
            // 法线朝体外为正绕序,否则交换两点。
            if (nx * refX + ny * refY + nz * refZ < 0) {
              faces.push([va, vc, vb]);
            } else {
              faces.push([va, vb, vc]);
            }
          }
        }
      }
    }
  }
  return { vertices, faces };
}
