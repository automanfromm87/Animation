/**
 * 网格边拓扑:唯一无向边表 + 面→边索引 + 每条边的邻接面。
 * 全程 typed array + CSR,不走 Map:隐式曲面每次重采样都要重建一遍,
 * res 40 时上万条边,Map 版本比 marching 本身还慢。
 */
export interface EdgeTopology {
  readonly edgeCount: number;
  /** 唯一边的两个端点(小下标在前),长度 2E。 */
  readonly ends: Int32Array;
  /** faceStart[f]..faceStart[f+1] 是第 f 个面用到的边下标区间(面内已去重)。 */
  readonly faceStart: Int32Array;
  readonly faceEdges: Int32Array;
  /** 每条边的第一个邻接面;-1 表示没有面真正用到它(只出现在折叠的退化面里)。 */
  readonly faceA: Int32Array;
  /** 第二个邻接面;BOUNDARY = 只属于一个面,NON_MANIFOLD = 三个及以上面共用。 */
  readonly faceB: Int32Array;
}

export const BOUNDARY = -1;
export const NON_MANIFOLD = -2;

/** 同一低端顶点下的边数超过它就改用 Map 查重,避免扇形顶点退化成平方复杂度。 */
const LINEAR_SCAN_LIMIT = 32;

/**
 * 从面表构建边拓扑。只认长度 >= 3 的面、跳过越界下标与 a === b 的零长边。
 * 同一个面里重复出现的边只记一次;出现偶数次(退化面 [a,b,a] 这种来回折叠)
 * 不算这个面「用到」它 —— 否则合法的流形边会被挤成三面共用而当成非流形丢掉。
 * 边的身份按无向端点对判定,与面的绕序无关(实体的面表并不保证绕序一致)。
 */
export function buildEdgeTopology(
  faces: ReadonlyArray<readonly number[]>,
  vertexCount: number,
): EdgeTopology {
  const faceCount = faces.length;
  // 1) 合法半边按面序摊平:后面几遍只扫这几个 typed array,不再逐个校验下标。
  let capacity = 0;
  let maxFace = 0;
  for (const face of faces) {
    capacity += face.length;
    maxFace = Math.max(maxFace, face.length);
  }
  const heLo = new Int32Array(capacity);
  const heHi = new Int32Array(capacity);
  const faceHeStart = new Int32Array(faceCount + 1);
  const degree = new Int32Array(vertexCount + 1);
  let halfEdges = 0;
  for (let f = 0; f < faceCount; f++) {
    faceHeStart[f] = halfEdges;
    const face = faces[f];
    if (!face || face.length < 3) {
      continue;
    }
    for (let k = 0; k < face.length; k++) {
      const a = face[k] ?? -1;
      const b = face[k + 1 < face.length ? k + 1 : 0] ?? -1;
      if (
        a === b ||
        !(a >= 0 && a < vertexCount && b >= 0 && b < vertexCount) ||
        !Number.isInteger(a) ||
        !Number.isInteger(b)
      ) {
        continue;
      }
      const lo = a < b ? a : b;
      heLo[halfEdges] = lo;
      heHi[halfEdges] = a < b ? b : a;
      degree[lo] = (degree[lo] ?? 0) + 1;
      halfEdges += 1;
    }
  }
  faceHeStart[faceCount] = halfEdges;
  // 2) CSR:按低端顶点分桶,记下高端顶点与每个半边落在哪个槽。
  const start = new Int32Array(vertexCount + 1);
  for (let v = 0; v < vertexCount; v++) {
    start[v + 1] = (start[v] ?? 0) + (degree[v] ?? 0);
  }
  const cursor = start.slice(0, vertexCount);
  const slotHi = new Int32Array(halfEdges);
  const slotOfHalf = new Int32Array(halfEdges);
  for (let h = 0; h < halfEdges; h++) {
    const lo = heLo[h] ?? 0;
    const slot = cursor[lo] ?? 0;
    cursor[lo] = slot + 1;
    slotHi[slot] = heHi[h] ?? 0;
    slotOfHalf[h] = slot;
  }
  // 3) 每个低端顶点的桶内按高端顶点查重,分配唯一边号。
  const edgeOfSlot = new Int32Array(halfEdges);
  const ends = new Int32Array(halfEdges * 2);
  let edgeCount = 0;
  for (let lo = 0; lo < vertexCount; lo++) {
    const from = start[lo] ?? 0;
    const to = start[lo + 1] ?? from;
    if (to - from > LINEAR_SCAN_LIMIT) {
      const seen = new Map<number, number>();
      for (let s = from; s < to; s++) {
        const hi = slotHi[s] ?? 0;
        let e = seen.get(hi);
        if (e === undefined) {
          e = edgeCount;
          ends[edgeCount * 2] = lo;
          ends[edgeCount * 2 + 1] = hi;
          edgeCount += 1;
          seen.set(hi, e);
        }
        edgeOfSlot[s] = e;
      }
      continue;
    }
    for (let s = from; s < to; s++) {
      const hi = slotHi[s] ?? 0;
      let e = -1;
      for (let p = from; p < s; p++) {
        if (slotHi[p] === hi) {
          e = edgeOfSlot[p] ?? -1;
          break;
        }
      }
      if (e < 0) {
        e = edgeCount;
        ends[edgeCount * 2] = lo;
        ends[edgeCount * 2 + 1] = hi;
        edgeCount += 1;
      }
      edgeOfSlot[s] = e;
    }
  }
  // 4) 逐面:面内去重得到 faceEdges;按出现次数的奇偶登记邻接面。
  const faceStart = new Int32Array(faceCount + 1);
  const faceEdges = new Int32Array(halfEdges);
  const faceA = new Int32Array(edgeCount).fill(-1);
  const faceB = new Int32Array(edgeCount).fill(BOUNDARY);
  const localCount = new Int32Array(Math.max(1, maxFace));
  let written = 0;
  for (let f = 0; f < faceCount; f++) {
    faceStart[f] = written;
    const first = written;
    const hTo = faceHeStart[f + 1] ?? 0;
    for (let h = faceHeStart[f] ?? 0; h < hTo; h++) {
      const e = edgeOfSlot[slotOfHalf[h] ?? 0] ?? 0;
      let at = -1;
      for (let p = first; p < written; p++) {
        if (faceEdges[p] === e) {
          at = p - first;
          break;
        }
      }
      if (at >= 0) {
        localCount[at] = (localCount[at] ?? 0) + 1;
      } else {
        localCount[written - first] = 1;
        faceEdges[written] = e;
        written += 1;
      }
    }
    for (let p = first; p < written; p++) {
      if ((localCount[p - first] ?? 0) % 2 === 0) {
        continue;
      }
      const e = faceEdges[p] ?? 0;
      if ((faceA[e] ?? -1) < 0) {
        faceA[e] = f;
      } else if (faceB[e] === BOUNDARY) {
        faceB[e] = f;
      } else {
        faceB[e] = NON_MANIFOLD;
      }
    }
  }
  faceStart[faceCount] = written;
  return {
    edgeCount,
    ends: ends.slice(0, edgeCount * 2),
    faceStart,
    faceEdges: faceEdges.slice(0, written),
    faceA,
    faceB,
  };
}

/** 面沿 lo→hi 走为 +1,沿 hi→lo 走为 -1。 */
function edgeDirection(face: readonly number[], lo: number, hi: number): number {
  const n = face.length;
  for (let k = 0; k < n; k++) {
    if (face[k] === lo) {
      if (face[(k + 1) % n] === hi) {
        return 1;
      }
      if (face[(k + n - 1) % n] === hi) {
        return -1;
      }
    }
  }
  return 1;
}

/**
 * 网格是否封闭且可定向 —— 背面剔除式的隐藏线只对这种网格成立。
 * 封闭:没有边界边。两端重合的零长边界边不算(经纬球极点上那圈重合顶点之间就是这种边)。
 * 可定向:能给每个面选一个绕向,使相邻两面沿公共边走向相反。
 * 判的是「存在」这样的绕向,与输入绕序无关(实体的面表绕序本就不统一)。
 * 非流形边(三面及以上共用)不参与判定。
 */
export function isClosedOrientable(
  topo: EdgeTopology,
  faces: ReadonlyArray<readonly number[]>,
  verts: ReadonlyArray<{ readonly x: number; readonly y: number; readonly z: number }>,
): boolean {
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (const v of verts) {
    minX = Math.min(minX, v.x);
    minY = Math.min(minY, v.y);
    minZ = Math.min(minZ, v.z);
    maxX = Math.max(maxX, v.x);
    maxY = Math.max(maxY, v.y);
    maxZ = Math.max(maxZ, v.z);
  }
  const diag = Math.hypot(maxX - minX, maxY - minY, maxZ - minZ);
  const tol = Number.isFinite(diag) ? Math.max(1e-12, diag * 1e-9) : 1e-12;
  for (let e = 0; e < topo.edgeCount; e++) {
    if (topo.faceB[e] !== BOUNDARY || (topo.faceA[e] ?? -1) < 0) {
      continue;
    }
    const p = verts[topo.ends[e * 2] ?? -1];
    const q = verts[topo.ends[e * 2 + 1] ?? -1];
    if (
      !p ||
      !q ||
      !(Math.abs(p.x - q.x) <= tol && Math.abs(p.y - q.y) <= tol && Math.abs(p.z - q.z) <= tol)
    ) {
      return false;
    }
  }
  // 沿流形边传播绕向(+1 保持 / -1 翻转),遇到矛盾就是不可定向(莫比乌斯式的扭转)。
  const orient = new Int8Array(faces.length);
  const stack: number[] = [];
  for (let seed = 0; seed < faces.length; seed++) {
    if (orient[seed] !== 0) {
      continue;
    }
    orient[seed] = 1;
    stack.push(seed);
    while (stack.length > 0) {
      const f = stack.pop() ?? 0;
      const face = faces[f] ?? [];
      const to = topo.faceStart[f + 1] ?? 0;
      for (let k = topo.faceStart[f] ?? 0; k < to; k++) {
        const e = topo.faceEdges[k] ?? 0;
        const fa = topo.faceA[e] ?? -1;
        const fb = topo.faceB[e] ?? BOUNDARY;
        if (fa < 0 || fb < 0) {
          continue;
        }
        // 面里出现偶数次的边(折叠的退化面)不登记邻接面,这里也不经由它传播。
        const g = fa === f ? fb : fb === f ? fa : -1;
        if (g < 0) {
          continue;
        }
        const lo = topo.ends[e * 2] ?? 0;
        const hi = topo.ends[e * 2 + 1] ?? 0;
        const want =
          -(orient[f] ?? 1) * edgeDirection(face, lo, hi) * edgeDirection(faces[g] ?? [], lo, hi);
        if (orient[g] === 0) {
          orient[g] = want;
          stack.push(g);
        } else if (orient[g] !== want) {
          return false;
        }
      }
    }
  }
  return true;
}
