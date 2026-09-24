import { close, equal, ok, suite } from '../../testing/harness';
import { lightTheme } from '../theme/presets';
import { recordingCtx } from './drawRecorder.testutil';
import type { Mesh3D } from './Mesh3D';
import { Projection3D } from './Projection3D';
import { Cube, Sphere } from './solids';
import { mathPoint, rotateVec } from './vec3';

/** 网格线框画出的全部线段端点(本地坐标)。 */
function wireEndpoints(mesh: Mesh3D): Array<[number, number]> {
  const rec = recordingCtx();
  mesh.render(rec.ctx, lightTheme);
  const out: Array<[number, number]> = [];
  for (const stroke of rec.strokes) {
    for (const [x1, y1, x2, y2] of stroke.segments) {
      out.push([x1, y1], [x2, y2]);
    }
  }
  return out;
}

const VIEWS = [
  { rotX: -0.45, rotY: 0.6 },
  { rotX: 0.3, rotY: -1.2, viewDistance: 400 },
  { rotX: -1.1, rotY: 2.5, viewDistance: 1200 },
  { rotX: 0, rotY: 0, viewDistance: 300, nearRatio: 0.5 },
];

export default suite('Projection3D', [
  [
    'project() 与网格绘制逐位一致:线框的每个端点都是某个顶点的 project(v)',
    () => {
      for (const options of VIEWS) {
        const view = new Projection3D(options);
        for (const mesh of [new Cube(120, { projection: view }), new Sphere({ radius: 80, projection: view })]) {
          const ends = wireEndpoints(mesh);
          ok(ends.length > 0, '线框没画出来');
          const projected = mesh.vertices.map((v) => view.project(v));
          for (const [x, y] of ends) {
            ok(
              projected.some((q) => q.x === x && q.y === y),
              `端点 (${x}, ${y}) 不是任何顶点的投影(视角 ${JSON.stringify(options)})`,
            );
          }
          // 与手写的「旋转 + 透视」公式一致(README 里 project3D 的那一份)。
          for (const v of mesh.vertices) {
            const r = rotateVec(v, view.rotX, view.rotY);
            const d = view.viewDistance;
            const s = d / Math.max(d * view.nearRatio, d - r.z);
            const q = view.project(v);
            close(q.x, r.x * s, 1e-9);
            close(q.y, r.y * s, 1e-9);
            close(q.depth, r.z, 1e-9);
            close(q.scale, s, 1e-12);
          }
        }
      }
    },
  ],
  [
    'toView 等于 rotateVec(先 rotY 再 rotX)',
    () => {
      const view = new Projection3D({ rotX: 0.7, rotY: -2.1 });
      const p = { x: 13, y: -40, z: 22 };
      const a = view.toView(p);
      const b = rotateVec(p, 0.7, -2.1);
      close(a.x, b.x, 1e-12);
      close(a.y, b.y, 1e-12);
      close(a.z, b.z, 1e-12);
    },
  ],
  [
    'project(p, frame):先缩放、再旋转、再平移(与 MObject.render 同一顺序)',
    () => {
      const view = new Projection3D({ rotX: -0.3, rotY: 0.9 });
      const p = { x: 30, y: -20, z: 45 };
      const local = view.project(p);
      const frame = { position: { x: 100, y: -40 }, scale: 1.5, rotation: 0.4 };
      const q = view.project(p, frame);
      const gx = local.x * 1.5;
      const gy = local.y * 1.5;
      close(q.x, 100 + gx * Math.cos(0.4) - gy * Math.sin(0.4), 1e-9);
      close(q.y, -40 + gx * Math.sin(0.4) + gy * Math.cos(0.4), 1e-9);
      close(q.depth, local.depth, 1e-12);
      // rotation 可省:结构上任何 MObject 都能直接当 frame 传。
      const cube = new Cube(50).moveTo({ x: 7, y: 9 });
      const r = view.project(p, cube);
      close(r.x, local.x + 7, 1e-9);
      close(r.y, local.y + 9, 1e-9);
    },
  ],
  [
    'Projection3D.math():课本视角下数学 X 轴朝左下且朝观众、Y 轴朝右、Z 轴朝正上',
    () => {
      const view = Projection3D.math();
      close(view.azimuth, Math.PI / 6, 1e-12);
      close(view.elevation, 0.45, 1e-12);
      const x = view.project(mathPoint(100, 0, 0));
      const y = view.project(mathPoint(0, 100, 0));
      const z = view.project(mathPoint(0, 0, 100));
      close(x.x, -56.3, 0.1);
      close(x.y, 42.4, 0.1);
      close(x.depth, 78, 0.5);
      close(y.x, 92.6, 0.1);
      close(y.y, 23.2, 0.1);
      close(y.depth, 45, 0.5);
      close(z.x, 0, 1e-9);
      close(z.y, -96.0, 0.1);
      close(z.depth, 43, 0.5);
      // 右手系:屏幕上从 X 到 Y 是逆时针(canvas y 向下,叉积为负)。
      ok(x.x * y.y - x.y * y.x < 0, '数学坐标系在屏幕上不是右手系');
    },
  ],
  [
    'azimuth / elevation 与 rotY / rotX 往返;俯视时 X 朝右、Y 朝上(对齐 Manim 缺省)',
    () => {
      const view = new Projection3D();
      view.azimuth = 1.1;
      close(view.rotY, -1.1 - Math.PI / 2, 1e-12);
      close(view.azimuth, 1.1, 1e-12);
      view.elevation = 0.3;
      close(view.rotX, -0.3, 1e-12);
      close(view.elevation, 0.3, 1e-12);
      view.azimuth = NaN;
      close(view.azimuth, 1.1, 1e-12);
      // 读出的方位折回 (−π, π]:转过几圈的 rotY 读出来仍是同一个方位,读不改 rotY。
      view.rotY = -1.1 - Math.PI / 2 + 6 * Math.PI;
      const rotY = view.rotY;
      close(view.azimuth, 1.1, 1e-9);
      equal(view.rotY, rotY);
      view.azimuth = 4;
      close(view.azimuth, 4 - 2 * Math.PI, 1e-12);
      view.azimuth = -Math.PI;
      close(view.azimuth, Math.PI, 1e-12);
      const top = Projection3D.math({ azimuth: -Math.PI / 2, elevation: Math.PI / 2 });
      const x = top.project(mathPoint(1, 0, 0));
      const y = top.project(mathPoint(0, 1, 0));
      const z = top.project(mathPoint(0, 0, 1));
      ok(x.x > 0.9 && Math.abs(x.y) < 1e-9, `X 应朝右:(${x.x}, ${x.y})`);
      ok(y.y < -0.9 && Math.abs(y.x) < 1e-9, `Y 应朝上:(${y.x}, ${y.y})`);
      ok(z.depth > 0.9, 'Z 应朝观众');
      const custom = Projection3D.math({ viewDistance: 900, nearRatio: 0.3 });
      equal(custom.viewDistance, 900);
      close(custom.nearRatio, 0.3, 1e-12);
    },
  ],
  [
    'version:只在视角参数真正变化时 +1(同值、非有限赋值不变)',
    () => {
      const view = new Projection3D();
      const v0 = view.version;
      view.rotX = -0.45; // 与缺省值相同
      view.rotY = NaN;
      view.viewDistance = 700;
      view.nearRatio = Infinity;
      equal(view.version, v0);
      view.rotY = 1;
      equal(view.version, v0 + 1);
      view.viewDistance = 0.5; // 钳到 1:也是变化
      equal(view.version, v0 + 2);
      view.viewDistance = -3; // 还是 1
      equal(view.version, v0 + 2);
      const c1 = view.constants();
      equal(view.constants(), c1, '同一版本应复用投影常数');
      view.rotX = 0.2;
      const c2 = view.constants();
      ok(c2 !== c1, '版本变了应重算投影常数');
      close(c2.cosX, Math.cos(0.2), 1e-15);
    },
  ],
  [
    'mathPoint:(x, y, z) ↦ (x, −z, −y)·unit,原点不产生 −0',
    () => {
      const p = mathPoint(1, 2, 3, 10);
      equal(p.x, 10);
      equal(p.y, -30);
      equal(p.z, -20);
      const o = mathPoint(0, 0, 0);
      ok(Object.is(o.x, 0) && Object.is(o.y, 0) && Object.is(o.z, 0), '原点出现了 −0');
      const q = mathPoint(-0, 0, 0, 5);
      ok(Object.is(q.x, 0), '−0 输入也应归零');
    },
  ],
  [
    '非有限值被忽略,保留旧值(共享状态被写坏会让整组立体消失)',
    () => {
      const p = new Projection3D();
      p.rotX = NaN;
      close(p.rotX, -0.45, 1e-12);
      p.rotY = Infinity;
      close(p.rotY, 0.6, 1e-12);
      p.viewDistance = NaN;
      equal(p.viewDistance, 700);
      p.nearRatio = NaN;
      close(p.nearRatio, 0.2, 1e-12);
      equal(new Projection3D({ nearRatio: NaN }).nearRatio, 0.2);
    },
  ],
  [
    'viewDistance 至少为 1,nearRatio 钳在 [0.01, 1]',
    () => {
      const p = new Projection3D();
      p.viewDistance = -5;
      equal(p.viewDistance, 1);
      p.nearRatio = 0;
      close(p.nearRatio, 0.01, 1e-12);
      p.nearRatio = 5;
      equal(p.nearRatio, 1);
    },
  ],
  [
    '写坏共享视角不会让立体凭空消失',
    () => {
      const p = new Projection3D();
      const cube = new Cube(1400).setProjection(p);
      p.nearRatio = NaN;
      p.viewDistance = 0;
      const box = cube.getBox();
      ok(Number.isFinite(box.size.w) && box.size.w > 0, `包围盒坏了:${box.size.w}`);
      ok(
        Number.isFinite(cube.getCullRadius()) && cube.getCullRadius() > 0,
        '剔除半径坏了',
      );
    },
  ],
]);
