import { close, equal, ok, quiet, suite, throws } from '../../testing/harness';
import { Orbit3D } from '../animations/animations3d';
import { lightTheme } from '../theme/presets';
import type { DrawRecord } from './drawRecorder.testutil';
import { recordingCtx } from './drawRecorder.testutil';
import type { Vec3 } from './Mesh3D';
import { Mesh3D, rotateVec, shadeColor } from './Mesh3D';
import { Projection3D } from './Projection3D';
import {
  Cone,
  Cube,
  Cuboid,
  Cylinder,
  Pyramid,
  Sphere,
  Tetrahedron,
  TriangularPrism,
} from './solids';
import { buildEdgeTopology, isClosedOrientable } from './topology';

/** 投影一个物体空间顶点(与 Mesh3D 的绘制完全一致)。 */
function projectVertex(mesh: Mesh3D, v: Vec3): { x: number; y: number } {
  const r = rotateVec(v, mesh.rotX, mesh.rotY);
  const d = mesh.viewDistance;
  const s = d / Math.max(d * mesh.getProjection().nearRatio, d - r.z);
  return { x: r.x * s, y: r.y * s };
}

/** 把线框里画出的线段按「顶点对」归类成实线/虚线集合。 */
function classifyEdges(mesh: Mesh3D, rec: DrawRecord): { solid: Set<string>; dashed: Set<string> } {
  const pts = mesh.vertices.map((v) => projectVertex(mesh, v));
  const idOf = (x: number, y: number): number =>
    pts.findIndex((p) => Math.abs(p.x - x) < 1e-6 && Math.abs(p.y - y) < 1e-6);
  const solid = new Set<string>();
  const dashed = new Set<string>();
  for (const stroke of rec.strokes) {
    for (const [x1, y1, x2, y2] of stroke.segments) {
      const a = idOf(x1, y1);
      const b = idOf(x2, y2);
      const key = `${Math.min(a, b)}-${Math.max(a, b)}`;
      (stroke.dashed ? dashed : solid).add(key);
    }
  }
  return { solid, dashed };
}

function draw(mesh: Mesh3D): DrawRecord {
  const rec = recordingCtx();
  mesh.render(rec.ctx, lightTheme);
  return rec;
}

class NormalProbe extends Cone {
  normal(i: number): Vec3 {
    return this.objectFaceNormal(i);
  }
}

/** n×n 格的平板(y = 0 平面);flip 时每个面反着绕。 */
function plate(n: number, flip: boolean, sided?: 'auto' | 'one' | 'two'): Mesh3D {
  const verts: Vec3[] = [];
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      verts.push({ x: (i - n / 2) * 20, y: 0, z: (j - n / 2) * 20 });
    }
  }
  const faces: number[][] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      const face = [a, a + 1, a + n + 2, a + n + 1];
      faces.push(flip ? face.reverse() : face);
    }
  }
  return new Mesh3D(verts, faces, sided ? { sided } : undefined);
}

function isTwoSided(mesh: Mesh3D): boolean {
  return (mesh as unknown as { twoSided: boolean }).twoSided;
}

/** 探针:能换掉整体几何(模拟 ImplicitSurface 这类重建网格的子类)。 */
class ReplaceProbe extends Mesh3D {
  swap(vertices: Vec3[], faces: number[][]): void {
    this.replaceGeometry(vertices, faces);
  }
}

export default suite('Mesh3D', [
  [
    '欧拉角顺序是「先绕 Y 自转,再绕 X 抬头」:Y 轴上的点不受 rotY 影响',
    () => {
      // 顺序反了的话,rotX 会先把 (0,1,0) 抬出 Y 轴,rotY 再把它甩开,
      // 于是 Spin3D 变成「翻跟头」而不是原地转台旋转。
      const base = rotateVec({ x: 0, y: 1, z: 0 }, -0.45, 0);
      for (const rotY of [0.6, 1.9, Math.PI, 5.5]) {
        const r = rotateVec({ x: 0, y: 1, z: 0 }, -0.45, rotY);
        close(r.x, base.x, 1e-12);
        close(r.y, base.y, 1e-12);
        close(r.z, base.z, 1e-12);
      }
    },
  ],
  [
    'rotY = π/2 把 +X 转到 -Z',
    () => {
      const r = rotateVec({ x: 1, y: 0, z: 0 }, 0, Math.PI / 2);
      close(r.x, 0, 1e-12);
      close(r.y, 0, 1e-12);
      close(r.z, -1, 1e-12);
    },
  ],
  [
    '构造函数拷贝几何:外部数组之后再改,网格不受影响;两个 Cube 不共享面片表',
    () => {
      const verts: Vec3[] = [
        { x: 0, y: 0, z: 0 },
        { x: 10, y: 0, z: 0 },
        { x: 0, y: 10, z: 0 },
      ];
      const faces = [[0, 1, 2]];
      const mesh = new Mesh3D(verts, faces);
      verts[0]!.x = 999;
      faces[0]![0] = 2;
      equal(mesh.vertices[0]?.x, 0, '顶点被外部数组篡改了');
      equal(mesh.faces[0]?.[0], 0, '面片被外部数组篡改了');
      const a = new Cube(50);
      const b = new Cube(80);
      ok(a.faces !== b.faces && a.faces[0] !== b.faces[0], '两个立方体共享了面片表');
    },
  ],
  [
    '构造期校验:越界/非整数下标、少于 3 个顶点的面、非有限坐标都直接抛错',
    () => {
      const quad: Vec3[] = [
        { x: 0, y: 0, z: 0 },
        { x: 1, y: 0, z: 0 },
        { x: 1, y: 1, z: 0 },
        { x: 0, y: 1, z: 0 },
      ];
      throws(() => new Mesh3D(quad, [[0, 1, 5]]), '越界下标没被挡住');
      throws(() => new Mesh3D(quad, [[0, 1.5, 2]]), '非整数下标没被挡住');
      throws(() => new Mesh3D(quad, [[0, 1]]), '两个顶点的面没被挡住');
      throws(
        () => new Mesh3D([...quad.slice(0, 3), { x: NaN, y: 0, z: 0 }], [[0, 1, 2]]),
        '非有限坐标没被挡住',
      );
      throws(() => new Cube(0), 'Cube(0) 没被挡住');
      throws(() => new Cuboid(10, NaN, 10), 'Cuboid 的 NaN 高度没被挡住');
      throws(() => new Sphere(-3), '负半径球没被挡住');
      throws(() => new Cylinder(10, Infinity), '无穷高圆柱没被挡住');
    },
  ],
  [
    'setVertices 数量不符时抛错',
    () => {
      throws(() => new Cube(10).setVertices([{ x: 0, y: 0, z: 0 }]));
    },
  ],
  [
    'getBox 用与绘制一致的透视投影(不再是正交近似)',
    () => {
      const cube = new Cube(200);
      cube.rotX = 0;
      cube.rotY = 0;
      const box = cube.getBox();
      // 正面在 z=+100 处被放大 700/600,正交近似会报 200。
      close(box.size.w, 200 * (700 / 600), 1e-9);
    },
  ],
  [
    '近平面:顶点正好落在视点上时缩放系数被钳到 1/nearRatio = 5',
    () => {
      // 半边长 700 == viewDistance,不钳位的话 d - v.z = 0,投影发散。
      const cube = new Cube(1400);
      cube.rotX = 0;
      cube.rotY = 0;
      close(cube.getBox().size.w, 1400 * 5, 1e-6);
      ok(cube.getCullRadius() > 0, '剔除半径不能为负(否则物体永远被剔掉)');
    },
  ],
  [
    '剔除半径覆盖每一个投影后顶点(否则会把还看得见的东西剔掉)',
    () => {
      for (const size of [40, 120, 600, 1400, 3000]) {
        const cube = new Cube(size);
        for (const [rotX, rotY] of [
          [-0.45, 0.6],
          [0, 0],
          [1.1, 2.3],
        ] as const) {
          cube.rotX = rotX;
          cube.rotY = rotY;
          const radius = cube.getCullRadius();
          let worst = 0;
          for (const v of cube.vertices) {
            const p = projectVertex(cube, v);
            worst = Math.max(worst, Math.hypot(p.x, p.y));
          }
          ok(radius >= worst - 1e-6, `size=${size}: ${radius} < ${worst}`);
        }
      }
    },
  ],
  [
    '线框按透视正确的朝向分虚实:斜看立方体时,擦边背过去的左面整圈都是虚线',
    () => {
      // rotY = 0.05 时左面法线 z 分量略大于 0(正交近似会判成正面),
      // 但视点在 z=700 处,左面其实已经背过去了:3–0、3–7、4–0 必须是虚线。
      const cube = new Cube(200);
      cube.rotX = 0;
      cube.rotY = 0.05;
      const { solid, dashed } = classifyEdges(cube, draw(cube));
      for (const edge of ['0-3', '3-7', '0-4']) {
        ok(dashed.has(edge) && !solid.has(edge), `${edge} 应为虚线`);
      }
      for (const edge of ['4-5', '5-6', '6-7', '4-7']) {
        ok(solid.has(edge), `正面的 ${edge} 应为实线`);
      }
      equal(solid.size + dashed.size, 12, '立方体应该恰好画出 12 条边');
    },
  ],
  [
    '圆锥侧面法线与解析法线的夹角 < 1°(旧的「面心 − 体心」伪法线偏 12°)',
    () => {
      const r = 38;
      const h = 72;
      const segments = 24;
      const cone = new NormalProbe(r, h, segments);
      let worst = 0;
      for (let i = 0; i < segments; i++) {
        const phi = ((i + 0.5) * Math.PI * 2) / segments;
        const len = Math.hypot(h, r);
        const want = { x: (h * Math.cos(phi)) / len, y: -r / len, z: (h * Math.sin(phi)) / len };
        const n = cone.normal(i);
        const cos = n.x * want.x + n.y * want.y + n.z * want.z;
        worst = Math.max(worst, (Math.acos(Math.min(1, cos)) * 180) / Math.PI);
      }
      ok(worst < 1, `最大偏差 ${worst.toFixed(2)}°`);
    },
  ],
  [
    '所有实体的面法线都朝外(面心 − 体心方向为正)',
    () => {
      const solids: Mesh3D[] = [
        new Cube(50),
        new Cuboid(60, 40, 30),
        new Pyramid(60, 70),
        new Tetrahedron(40),
        new TriangularPrism(30, 40),
        new Cylinder(20, 50, 12),
        new Cone(30, 60, 12),
        new Sphere(30, 12, 8),
      ];
      for (const solid of solids) {
        const probe = solid as unknown as { objectFaceNormal(i: number): Vec3 };
        const verts = solid.vertices;
        const c: Vec3 = { x: 0, y: 0, z: 0 };
        for (const v of verts) {
          c.x += v.x / verts.length;
          c.y += v.y / verts.length;
          c.z += v.z / verts.length;
        }
        solid.faces.forEach((face, i) => {
          const fc = face.reduce(
            (s, vi) => ({
              x: s.x + (verts[vi]?.x ?? 0) / face.length,
              y: s.y + (verts[vi]?.y ?? 0) / face.length,
              z: s.z + (verts[vi]?.z ?? 0) / face.length,
            }),
            { x: 0, y: 0, z: 0 },
          );
          const n = probe.objectFaceNormal(i);
          const d = n.x * (fc.x - c.x) + n.y * (fc.y - c.y) + n.z * (fc.z - c.z);
          ok(d > 0, `${solid.constructor.name} 第 ${i} 个面的法线朝内`);
        });
      }
    },
  ],
  [
    '缓存失效:setVertexAt 自动让包围半径等缓存失效,不必再手动 markGeometryChanged',
    () => {
      const cube = new Cube(100);
      const before = cube.getCullRadius();
      cube.setVertexAt(0, 500, 0, 0);
      ok(cube.getCullRadius() > before * 3, `包围半径没更新:${cube.getCullRadius()}`);
    },
  ],
  [
    'setVertices / setVertexAt 拒绝非有限坐标与越界下标;抛错时网格保持原样',
    () => {
      const cube = new Cube(100);
      const before = cube.vertices.map((v) => ({ x: v.x, y: v.y, z: v.z }));
      throws(() => cube.setVertexAt(0, NaN, 0, 0));
      throws(() => cube.setVertexAt(8, 0, 0, 0));
      throws(() => cube.setVertexAt(-1, 0, 0, 0));
      const bad = before.map((v, i) => (i === 5 ? { ...v, z: Infinity } : { ...v, x: v.x + 1 }));
      throws(() => cube.setVertices(bad));
      cube.vertices.forEach((v, i) => {
        const b = before[i];
        ok(b !== undefined && v.x === b.x && v.y === b.y && v.z === b.z, `第 ${i} 个顶点被改了`);
      });
    },
  ],
  [
    '手搭的开放网格自动按双面画:两种绕序的线框完全一样,全是实线',
    () => {
      for (const flip of [false, true]) {
        const mesh = plate(3, flip);
        equal(isTwoSided(mesh), true);
        const { solid, dashed } = classifyEdges(mesh, draw(mesh));
        equal(dashed.size, 0, `flip=${flip}:开放网格画出了虚线`);
        equal(solid.size, 24, `flip=${flip}:3×3 平板应画 24 条边`);
      }
    },
  ],
  [
    'sided 选项覆盖自动判定',
    () => {
      // 强制单面:平板的虚实回到取决于绕序(证明选项生效)。
      const a = classifyEdges(plate(3, false, 'one'), draw(plate(3, false, 'one')));
      const b = classifyEdges(plate(3, true, 'one'), draw(plate(3, true, 'one')));
      ok(a.dashed.size !== b.dashed.size, '强制单面后两种绕序的线框应当不同');
      // 强制双面:斜看的立方体不再有虚线。
      const cube = new Cube(200, { sided: 'two' });
      cube.rotX = 0;
      cube.rotY = 0.05;
      const { solid, dashed } = classifyEdges(cube, draw(cube));
      equal(dashed.size, 0);
      equal(solid.size, 12);
    },
  ],
  [
    '内置实体(含极点顶点重合的经纬球)自动判为单面',
    () => {
      const solids: Mesh3D[] = [
        new Cube(50),
        new Cuboid(60, 40, 30),
        new Pyramid(60, 70),
        new Tetrahedron(40),
        new TriangularPrism(30, 40),
        new Cylinder(20, 50, 12),
        new Cone(30, 60, 12),
        new Sphere(30, 12, 8),
      ];
      for (const solid of solids) {
        equal(isTwoSided(solid), false, `${solid.constructor.name} 被判成了双面`);
      }
    },
  ],
  [
    'isClosedOrientable:射影平面封闭但不可定向;缺面的立方体不封闭;绕序混乱不影响可定向',
    () => {
      // 射影平面的 6 顶点 10 三角剖分:每条边恰好两个面,但不存在一致的绕向。
      const rp2 = [
        [0, 1, 2], [0, 2, 3], [0, 3, 4], [0, 4, 5], [0, 5, 1],
        [1, 2, 4], [2, 3, 5], [3, 4, 1], [4, 5, 2], [5, 1, 3],
      ];
      const pts = Array.from({ length: 6 }, (_, i) => ({
        x: Math.cos(i),
        y: Math.sin(i),
        z: i * 0.1,
      }));
      equal(isClosedOrientable(buildEdgeTopology(rp2, 6), rp2, pts), false);
      const cube = new Cube(10);
      const faces = cube.faces;
      equal(isClosedOrientable(buildEdgeTopology(faces, 8), faces, cube.vertices), true);
      const open = faces.slice(1);
      equal(isClosedOrientable(buildEdgeTopology(open, 8), open, cube.vertices), false);
      // 四面体翻掉一个面:输入绕序不一致,但一致的绕向仍然存在。
      const tet = new Tetrahedron(10);
      const mixed = tet.faces.map((f, i) => (i === 0 ? [...f].reverse() : [...f]));
      equal(isClosedOrientable(buildEdgeTopology(mixed, 4), mixed, tet.vertices), true);
    },
  ],
  [
    '实体有填充、线宽为 0 时补同色缝;半透明填充或整体淡出时不补',
    () => {
      const cube = new Cube(80);
      cube.setStyle({ fill: '#ffffff', strokeWidth: 0 });
      const rec = draw(cube);
      equal(rec.fills.length, 6);
      equal(rec.strokes.length, 6, '每个面都应补一笔同色描边');
      rec.strokes.forEach((st, i) => equal(st.strokeStyle, rec.fills[i]));
      cube.setStyle({ fill: 'rgba(255, 255, 255, 0.5)' });
      equal(draw(cube).strokes.length, 0, '半透明填充补缝会叠出网格纹');
      cube.setStyle({ fill: '#ffffff' });
      cube.opacity = 0.5;
      equal(draw(cube).strokes.length, 0, '整体淡出时补缝会叠出网格纹');
    },
  ],
  [
    '三棱柱与其它立体一样以 y 为轴',
    () => {
      const prism = new TriangularPrism(30, 40);
      for (const v of prism.vertices) {
        close(Math.abs(v.y), 20, 1e-9);
        close(Math.hypot(v.x, v.z), 30, 1e-9);
      }
    },
  ],
  [
    '缓存失效:replaceGeometry 换了面数后,线框按新拓扑画边',
    () => {
      const tri: Vec3[] = [
        { x: 0, y: 0, z: 0 },
        { x: 40, y: 0, z: 0 },
        { x: 0, y: 40, z: 0 },
        { x: 0, y: 0, z: 40 },
      ];
      const mesh = new ReplaceProbe(tri, [[0, 1, 2]]);
      const count = (): number => {
        const { solid, dashed } = classifyEdges(mesh, draw(mesh));
        return solid.size + dashed.size;
      };
      equal(count(), 3);
      mesh.swap(
        tri.map((v) => ({ ...v })),
        [
          [0, 1, 2],
          [0, 3, 1],
          [0, 2, 3],
          [1, 3, 2],
        ],
      );
      equal(count(), 6, '换成四面体后应该画 6 条边');
    },
  ],
  [
    'shadeColor:支持 3/4/6/8 位 hex 与逗号/空格/百分比 rgb(a),保留 alpha',
    () => {
      equal(shadeColor('#ffffff', 0.5), 'rgb(128, 128, 128)');
      equal(shadeColor('#fff', 1), 'rgb(255, 255, 255)');
      equal(shadeColor('#ffff', 1), 'rgb(255, 255, 255)');
      equal(shadeColor('#80808080', 1), 'rgba(128, 128, 128, 0.502)');
      equal(shadeColor('rgba(200, 100, 50, 0.4)', 0.5), 'rgba(100, 50, 25, 0.4)');
      equal(shadeColor('rgb(200 100 50)', 0.5), 'rgb(100, 50, 25)');
      equal(shadeColor('rgb(200 100 50 / 40%)', 0.5), 'rgba(100, 50, 25, 0.4)');
      equal(shadeColor('rgb(100%, 50%, 0%)', 1), 'rgb(255, 128, 0)');
    },
  ],
  [
    'shadeColor:解析不了(node 里没有画布兜底)时原样返回,并且只告警一次',
    () => {
      const original = console.warn;
      let warned = 0;
      console.warn = (): void => {
        warned += 1;
      };
      try {
        equal(shadeColor('papayawhip', 0.5), 'papayawhip');
        equal(shadeColor('papayawhip', 0.8), 'papayawhip');
      } finally {
        console.warn = original;
      }
      equal(warned, 1, `告警了 ${warned} 次`);
    },
  ],
  [
    'shadeColor:命名色 / hsl() 交给画布规范化;探针按 document 建,换了 document 就重建',
    async () => {
      const g = globalThis as unknown as Record<string, unknown>;
      const had = 'document' in g;
      const saved = g['document'];
      let created = 0;
      const known: Record<string, string> = {
        rebeccapurple: '#663399',
        'hsl(0 100% 50% / 0.5)': 'rgba(255, 0, 0, 0.5)',
      };
      const makeDoc = (): unknown => ({
        createElement: () => {
          created += 1;
          let fill = '#000000';
          const ctx = {
            get fillStyle(): string {
              return fill;
            },
            // 与浏览器一样:认不出的颜色赋值被静默忽略。
            set fillStyle(v: string) {
              const key = v.toLowerCase();
              if (/^#[0-9a-f]{6}$/.test(key)) {
                fill = key;
              } else if (known[key] !== undefined) {
                fill = known[key] ?? fill;
              }
            },
          };
          return { width: 0, height: 0, getContext: () => ctx };
        },
      });
      try {
        g['document'] = makeDoc();
        equal(shadeColor('rebeccapurple', 1), 'rgb(102, 51, 153)');
        equal(shadeColor('hsl(0 100% 50% / 0.5)', 0.5), 'rgba(128, 0, 0, 0.5)');
        equal(created, 1, '同一个 document 只建一次探针');
        g['document'] = makeDoc();
        await quiet(() => {
          equal(shadeColor('mediumseagreen', 1), 'mediumseagreen');
        });
        equal(created, 2, '换了 document 要重建探针');
      } finally {
        if (had) {
          g['document'] = saved;
        } else {
          delete g['document'];
        }
      }
    },
  ],
  [
    '填充模式按色表着色:面越朝光越亮,背光面只剩环境光',
    () => {
      const cube = new Cube(100);
      cube.setStyle({ fill: '#ffffff' });
      const rec = draw(cube);
      equal(rec.fills.length, 6);
      ok(new Set(rec.fills).size > 1, '所有面都是同一个颜色,明暗没生效');
      for (const f of rec.fills) {
        ok(/^rgb\(\d+, \d+, \d+\)$/.test(f), `不是色表里的颜色:${f}`);
      }
    },
  ],
  [
    '空网格不抛错',
    () => {
      const mesh = new Mesh3D([], []);
      equal(mesh.getBox().size.w, 0);
      equal(mesh.getCullRadius(), 0);
      draw(mesh);
    },
  ],
  [
    '默认每个网格各持一份视角,互不影响',
    () => {
      const a = new Cube(50);
      const b = new Cube(50);
      a.rotY = 1.23;
      equal(b.rotY, 0.6, '默认视角被共享了');
    },
  ],
  [
    '实体构造可以直接传入共享视角',
    () => {
      const view = new Projection3D({ rotY: 1 });
      const a = new Cube(40, { projection: view });
      const b = new Sphere(30, 12, 8, { projection: view });
      view.rotY = 2;
      equal(a.rotY, 2);
      equal(b.rotY, 2);
    },
  ],
  [
    '共享 Projection3D:一个 Orbit3D 带动整组',
    () => {
      const view = new Projection3D();
      const meshes = [new Cube(50), new Cube(80), new Cube(30)];
      for (const m of meshes) {
        m.setProjection(view);
      }
      const anim = new Orbit3D(view, 1, { runTime: 1 });
      anim.begin();
      anim.interpolate(0.5);
      for (const m of meshes) {
        close(m.rotY, 0.6 + Math.PI, 1e-12);
      }
      anim.finish();
      for (const m of meshes) {
        close(m.rotY, 0.6 + Math.PI * 2, 1e-12);
      }
    },
  ],
]);
