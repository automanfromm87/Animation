import { close, equal, ok, suite } from '../../testing/harness';
import { Orbit3D } from '../animations/animations3d';
import { FadeIn } from '../animations/primitives';
import { Group } from '../mobjects/Group';
import type { MObject } from '../mobjects/MObject';
import { lightTheme } from '../theme/presets';
import type { DrawRecord } from './drawRecorder.testutil';
import { recordingCtx } from './drawRecorder.testutil';
import { Axes3D } from './Axes3D';
import { Line3D } from './lines3d';
import { Mesh3D } from './Mesh3D';
import { occlusionIndexFor } from './occlusion';
import type { HiddenStyle3D } from './occlusion';
import { ParametricSurface } from './ParametricSurface';
import { Projection3D } from './Projection3D';
import { Cube, Pyramid, Sphere } from './solids';
import { Space3D } from './Space3D';
import type { Vec3 } from './vec3';

function draw(...objects: MObject[]): DrawRecord {
  const rec = recordingCtx();
  for (const m of objects) {
    m.render(rec.ctx, lightTheme);
  }
  return rec;
}

/** 正视(rotX = rotY = 0,视距 700)下边长 100 的填色立方体。 */
function frontCube(view = new Projection3D({ rotX: 0, rotY: 0, viewDistance: 700 })): Cube {
  return new Cube(100, { projection: view }).setStyle({ fill: '#bfdbfe' });
}

/** 穿过立方体中心、沿 x 的线:被前表面挡住的区间是 |x| <= 50·700/650。 */
function throughLine(cube: Mesh3D, hidden?: HiddenStyle3D): Line3D {
  return new Line3D({ x: -150, y: 0, z: 0 }, { x: 150, y: 0, z: 0 }, {
    projection: cube.getProjection(),
    occluders: [cube],
    hidden,
  });
}

/** z = 0 平面上边长 100 的开放平板(双面,不填色;遮挡测试要挡住东西时自己 setStyle 填色)。 */
function plateXY(view: Projection3D): Mesh3D {
  const verts: Vec3[] = [];
  const n = 4;
  for (let j = 0; j <= n; j++) {
    for (let i = 0; i <= n; i++) {
      verts.push({ x: (i - n / 2) * 25, y: (j - n / 2) * 25, z: 0 });
    }
  }
  const faces: number[][] = [];
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * (n + 1) + i;
      faces.push([a, a + 1, a + n + 2, a + n + 1]);
    }
  }
  return new Mesh3D(verts, faces, { projection: view });
}

/** 固定种子的线性同余发生器,返回 [0, 1)。 */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

const EDGE = (50 * 700) / 650;

export default suite('3D 线条的遮挡', [
  [
    '透视边界:穿过立方体的线恰好分三段(看得见 / 挡住 / 看得见),分界在 150 ∓ 53.846',
    () => {
      const cube = frontCube();
      const runs = throughLine(cube).visibilityRuns();
      equal(runs.length, 3, `段数不对:${JSON.stringify(runs)}`);
      equal(runs[0]?.k, 0);
      equal(runs[1]?.k, 1);
      equal(runs[2]?.k, 0);
      close(runs[0]?.from ?? NaN, 0, 1e-12);
      close(runs[0]?.to ?? NaN, 150 - EDGE, 0.1);
      close(runs[1]?.to ?? NaN, 150 + EDGE, 0.1);
      close(runs[2]?.to ?? NaN, 300, 1e-12);
    },
  ],
  [
    '画法:dashed 画淡虚线、faded 调淡、none 不画、shown 一条实线',
    () => {
      const cube = frontCube();
      const dashed = draw(throughLine(cube)).strokes;
      equal(dashed.length, 2, '先画被挡的一组,再画看得见的一组');
      equal(dashed[0]?.dash.join(','), '5,4');
      close(dashed[0]?.alpha ?? NaN, 0.35, 1e-12);
      equal(dashed[1]?.dashed, false);
      equal(dashed[1]?.alpha, 1);
      equal(dashed[1]?.segments.length, 2, '看得见的是两段');
      const faded = draw(throughLine(cube, 'faded')).strokes;
      equal(faded.length, 2);
      equal(faded[0]?.dashed, false);
      close(faded[0]?.alpha ?? NaN, 0.35, 1e-12);
      const none = draw(throughLine(cube, 'none')).strokes;
      equal(none.length, 1);
      equal(none[0]?.segments.length, 2);
      const shown = draw(throughLine(cube, 'shown')).strokes;
      equal(shown.length, 1);
      equal(shown[0]?.segments.length, 1);
      // 作者自己设了虚线:被挡部分沿用它,看得见的部分也照常虚线。
      const custom = throughLine(cube).setStyle({ dash: [2, 2] });
      const strokes = draw(custom).strokes;
      equal(strokes[0]?.dash.join(','), '2,2');
      equal(strokes[1]?.dash.join(','), '2,2');
    },
  ],
  [
    '表面上的点不自遮挡(沿前表面、沿可见棱);背面的棱整段被挡',
    () => {
      const cube = frontCube();
      const view = cube.getProjection();
      const onFace = new Line3D({ x: -40, y: 10, z: 50 }, { x: 40, y: -10, z: 50 }, {
        projection: view,
        occluders: [cube],
      });
      const r1 = onFace.visibilityRuns();
      equal(r1.length, 1);
      equal(r1[0]?.k, 0);
      const edge = new Line3D({ x: -50, y: -50, z: 50 }, { x: 50, y: -50, z: 50 }, {
        projection: view,
        occluders: [cube],
      });
      equal(edge.visibilityRuns().every((r) => r.k === 0), true);
      const back = new Line3D({ x: -50, y: -50, z: -50 }, { x: 50, y: -50, z: -50 }, {
        projection: view,
        occluders: [cube],
      });
      const r3 = back.visibilityRuns();
      equal(r3.length, 1);
      equal(r3[0]?.k, 1);
    },
  ],
  [
    '深度容差:表面后 1 个单位的点,容差 1.5 看得见、0.5 被挡',
    () => {
      const cube = frontCube();
      const view = cube.getProjection();
      const make = (depthTolerance: number): Line3D =>
        new Line3D({ x: -5, y: 0, z: 49 }, { x: 5, y: 0, z: 49 }, {
          projection: view,
          occluders: [cube],
          depthTolerance,
        });
      equal(make(1.5).visibilityRuns()[0]?.k, 0);
      equal(make(0.5).visibilityRuns()[0]?.k, 1);
    },
  ],
  [
    '双面曲面(开放平板,填色):正反两面都挡住板后的点',
    () => {
      const front = new Projection3D({ rotX: 0, rotY: 0 });
      const plate = plateXY(front).setStyle({ fill: '#ccc' });
      const behind = new Line3D({ x: -20, y: 0, z: -20 }, { x: 20, y: 0, z: -20 }, {
        projection: front,
        occluders: [plate],
      });
      equal(behind.visibilityRuns()[0]?.k, 1);
      const reverse = new Projection3D({ rotX: 0, rotY: Math.PI });
      const plate2 = plateXY(reverse).setStyle({ fill: '#ccc' });
      const other = new Line3D({ x: -20, y: 0, z: 20 }, { x: 20, y: 0, z: 20 }, {
        projection: reverse,
        occluders: [plate2],
      });
      equal(other.visibilityRuns()[0]?.k, 1, '从背面看,板另一侧的点也该被挡');
      const inFront = new Line3D({ x: -20, y: 0, z: 20 }, { x: 20, y: 0, z: 20 }, {
        projection: front,
        occluders: [plate],
      });
      equal(inFront.visibilityRuns()[0]?.k, 0);
    },
  ],
  [
    '遮挡强度随网格 opacity:0 不遮挡;0.4 时实线 α 0.6 + 淡虚线 α 0.14;FadeIn 过程平滑',
    () => {
      const cube = frontCube();
      cube.opacity = 0;
      const line = throughLine(cube);
      equal(line.visibilityRuns().length, 1);
      equal(line.visibilityRuns()[0]?.k, 0);
      cube.opacity = 0.4;
      const runs = line.visibilityRuns();
      close(runs[1]?.k ?? NaN, 0.4, 1e-12);
      const strokes = draw(line).strokes;
      equal(strokes.length, 3);
      close(strokes[0]?.alpha ?? NaN, 0.6, 1e-12);
      equal(strokes[0]?.dashed, false);
      close(strokes[1]?.alpha ?? NaN, 0.14, 1e-12);
      equal(strokes[1]?.dashed, true);
      equal(strokes[2]?.alpha, 1);
      const fade = new FadeIn(cube);
      fade.begin();
      fade.interpolate(0.25);
      close(line.visibilityRuns()[1]?.k ?? NaN, cube.opacity, 1e-12);
    },
  ],
  [
    '视角实例不同:告警一次、该网格不参与;画框不同:告警一次、仍参与',
    () => {
      const cube = frontCube();
      const line = new Line3D({ x: -150, y: 0, z: 0 }, { x: 150, y: 0, z: 0 }, {
        projection: new Projection3D({ rotX: 0, rotY: 0, viewDistance: 700 }),
        occluders: [cube],
      });
      const warnings: string[] = [];
      const original = console.warn;
      console.warn = (msg: unknown) => {
        warnings.push(String(msg));
      };
      try {
        equal(line.visibilityRuns().length, 1);
        draw(line);
        equal(warnings.length, 1, `应只告警一次:${warnings.join(' | ')}`);
        ok(warnings[0]?.includes('Projection3D') ?? false);
        const shifted = throughLine(cube);
        cube.moveTo({ x: 30, y: 0 });
        equal(shifted.visibilityRuns().length, 3, '画框不同也照样按同一画框计算');
        shifted.visibilityRuns();
        equal(warnings.length, 2);
        ok(warnings[1]?.includes('画框') ?? false);
      } finally {
        console.warn = original;
      }
    },
  ],
  [
    '缓存失效:setVertices 缩小立方体、Orbit3D 转视角后,分界按新几何 / 新视角',
    () => {
      const cube = frontCube();
      const line = throughLine(cube);
      close(line.visibilityRuns()[0]?.to ?? NaN, 150 - EDGE, 0.1);
      cube.setVertices(cube.vertices.map((v) => ({ x: v.x / 2, y: v.y / 2, z: v.z / 2 })));
      const small = (25 * 700) / 675;
      close(line.visibilityRuns()[0]?.to ?? NaN, 150 - small, 0.1);
      const view = cube.getProjection();
      const orbit = new Orbit3D(view, 1);
      orbit.begin();
      orbit.interpolate(0.1);
      const after = line.visibilityRuns();
      // 与一套全新的(没有缓存的)立方体 + 线条在同一视角下的结果一致。
      const fresh = new Projection3D({ rotX: 0, rotY: view.rotY, viewDistance: 700 });
      const cube2 = new Cube(50, { projection: fresh });
      const expected = throughLine(cube2).visibilityRuns();
      equal(after.length, expected.length);
      after.forEach((r, i) => {
        close(r.from, expected[i]?.from ?? NaN, 1e-9);
        close(r.to, expected[i]?.to ?? NaN, 1e-9);
        equal(r.k, expected[i]?.k);
      });
      ok(Math.abs((after[0]?.to ?? 0) - (150 - small)) > 0.5, '转了视角分界应该变');
    },
  ],
  [
    '屏幕网格加速与逐个三角形暴力测试结果一致(经纬球 + 200 个固定种子的点)',
    () => {
      const view = new Projection3D({ rotX: -0.5, rotY: 0.8, viewDistance: 500 });
      const sphere = new Sphere({ radius: 80, projection: view });
      const index = occlusionIndexFor(sphere);
      ok(index.triangleCount > 100, `三角形太少:${index.triangleCount}`);
      const rand = lcg(12345);
      let hidden = 0;
      for (let i = 0; i < 200; i++) {
        const p = { x: (rand() - 0.5) * 240, y: (rand() - 0.5) * 240, z: (rand() - 0.5) * 240 };
        const v = view.toView(p);
        const q = view.project(p);
        const fast = index.hides(v.x, v.y, v.z, q.x, q.y, 1.5);
        const brute = index.hides(v.x, v.y, v.z, q.x, q.y, 1.5, true);
        equal(fast, brute, `第 ${i} 个点 (${p.x}, ${p.y}, ${p.z}) 结果不一致`);
        if (fast) {
          hidden += 1;
        }
      }
      ok(hidden > 20 && hidden < 180, `被挡的点数不合理:${hidden}`);
      equal(occlusionIndexFor(sphere), index, '视角与几何都没变应复用索引');
    },
  ],
  [
    '近平面钳制区里的点当作看得见,不抛错',
    () => {
      const view = new Projection3D({ rotX: 0, rotY: 0, viewDistance: 700 });
      const cube = new Cube(100, { projection: view }).setStyle({ fill: '#ccc' });
      // z = 650:d − z = 50 < d·nearRatio = 140,投影不是透视。
      const near = new Line3D({ x: -20, y: 0, z: 650 }, { x: 20, y: 0, z: 650 }, {
        projection: view,
        occluders: [cube],
      });
      const runs = near.visibilityRuns();
      equal(runs.length, 1);
      equal(runs[0]?.k, 0);
      // 穿过视点的线:不抛错,画得出来。
      const through = new Line3D({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 900 }, {
        projection: view,
        occluders: [cube],
      });
      draw(through);
      ok(through.visibilityRuns().length >= 1);
    },
  ],
  [
    '箭头按箭尖处的遮挡调淡(被挡住的箭尖 α = 0.35)',
    () => {
      const cube = frontCube();
      const arrow = new Line3D({ x: -150, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }, {
        projection: cube.getProjection(),
        occluders: [cube],
        tips: 'end',
      });
      const rec = draw(arrow);
      equal(rec.fills.length, 1);
      close(rec.fillAlphas[0] ?? NaN, 0.35, 1e-12);
    },
  ],
  [
    '半透明填色只挡一部分:alpha 0.15 的平面后面,实线 α 0.85 + 淡虚线 α 0.0525;容器继承的填色画过一次后生效',
    () => {
      const view = new Projection3D({ rotX: 0, rotY: 0 });
      const quad = (): Mesh3D =>
        new Mesh3D(
          [
            { x: -60, y: -60, z: 50 },
            { x: 60, y: -60, z: 50 },
            { x: 60, y: 60, z: 50 },
            { x: -60, y: 60, z: 50 },
          ],
          [[0, 1, 2, 3]],
          { projection: view },
        );
      const veil = quad().setStyle({ fill: 'rgba(234, 88, 12, 0.15)' });
      const line = new Line3D({ x: -50, y: 0, z: 0 }, { x: 50, y: 0, z: 0 }, {
        projection: view,
        occluders: [veil],
      });
      const runs = line.visibilityRuns();
      equal(runs.length, 1);
      close(runs[0]?.k ?? NaN, 0.15, 1e-9);
      const strokes = draw(line).strokes;
      equal(strokes.length, 2);
      close(strokes[0]?.alpha ?? NaN, 0.85, 1e-9);
      equal(strokes[0]?.dashed, false);
      close(strokes[1]?.alpha ?? NaN, 0.15 * 0.35, 1e-9);
      equal(strokes[1]?.dashed, true);
      // 网格自身 opacity 与填充色的 alpha 相乘。
      veil.opacity = 0.5;
      close(line.visibilityRuns()[0]?.k ?? NaN, 0.075, 1e-9);
      // 填色来自容器:没画过时按自身样式(不填色的开放平面不挡),画过一次后按解析出的填色。
      const plain = quad();
      const group = new Group().setStyle({ fill: 'rgba(0, 0, 0, 0.5)' });
      group.add(plain);
      line.setOccluders([plain]);
      equal(line.visibilityRuns()[0]?.k, 0);
      draw(group);
      close(line.visibilityRuns()[0]?.k ?? NaN, 0.5, 1e-9);
    },
  ],
  [
    '不填色的开放曲面不挡(它自己的边全是实线);不填色的封闭线框照样全挡(棱锥里的高线画虚线)',
    () => {
      const view = new Projection3D({ rotX: 0, rotY: 0 });
      const wire = plateXY(view);
      const behind = new Line3D({ x: -20, y: 0, z: -20 }, { x: 20, y: 0, z: -20 }, {
        projection: view,
        occluders: [wire],
      });
      const runs = behind.visibilityRuns();
      equal(runs.length, 1);
      equal(runs[0]?.k, 0);
      equal(draw(behind).strokes.filter((s) => s.dashed).length, 0);
      // 数学坐标系 + 不填色的高斯鼓包 + 坐标轴:轴不画虚线,与曲面自己的实线边一致。
      const math = Projection3D.math();
      const space = new Space3D(math);
      const axes = new Axes3D({ x: [-2, 2], y: [-2, 2], z: [-1, 2], unit: 60, labels: false });
      const f = (x: number, y: number): number => Math.exp(-(x * x + y * y));
      const bump = new ParametricSurface((u, v) => axes.point(u, v, f(u, v)), {
        uRange: [-2, 2],
        vRange: [-2, 2],
        uSegs: 24,
        vSegs: 24,
      });
      space.add(bump, axes);
      const rec = draw(space);
      for (const axis of [axes.xAxis, axes.yAxis, axes.zAxis]) {
        ok(axis.visibilityRuns().every((r) => r.k === 0), '开放线框不该挡住轴');
      }
      equal(rec.strokes.filter((s) => s.dashed).length, 0);
      // 封闭线框(棱锥):体内的高线整段被挡,画淡虚线。
      const tilted = new Projection3D({ rotX: -0.4, rotY: 0.5 });
      const pyramid = new Pyramid(80, 85, { projection: tilted });
      const height = new Line3D({ x: 0, y: -42.5, z: 0 }, { x: 0, y: 42.5, z: 0 }, {
        projection: tilted,
        occluders: [pyramid],
      });
      ok(height.visibilityRuns().some((r) => r.k === 1), '棱锥里的高线应被挡');
      ok(draw(height).strokes.some((s) => s.dashed), '被挡的高线应画成虚线');
    },
  ],
  [
    '深度容差按面的法向量:斜着看曲面上的截线不冒假虚线(设计 §10 的鼓包 + 截线)',
    () => {
      const f = (x: number, y: number): number => Math.exp(-(x * x + y * y));
      const cases: Array<{ azimuth: number; elevation: number; along: 'x' | 'y'; c: number }> = [
        { azimuth: 2.5, elevation: 0.45, along: 'x', c: 0.55 },
        { azimuth: Math.PI / 6, elevation: 0.25, along: 'y', c: 0.3 },
      ];
      for (const { azimuth, elevation, along, c } of cases) {
        const view = Projection3D.math({ azimuth, elevation });
        const space = new Space3D(view);
        const axes = new Axes3D({ x: [-2, 2], y: [-2, 2], z: [-1, 2], unit: 60, labels: false });
        const surface = new ParametricSurface((u, v) => axes.point(u, v, f(u, v)), {
          uRange: [-2, 2],
          vRange: [-2, 2],
          uSegs: 24,
          vSegs: 24,
        }).setStyle({ fill: '#bfdbfe', strokeWidth: 0.5 });
        const slice =
          along === 'x'
            ? axes.curve((t) => ({ x: t, y: c, z: f(t, c) }), [-2, 2])
            : axes.curve((t) => ({ x: c, y: t, z: f(c, t) }), [-2, 2]);
        space.add(surface, axes, slice);
        draw(space);
        const runs = slice.visibilityRuns();
        equal(runs.length, 1, `截线被切成了 ${runs.length} 段:${JSON.stringify(runs)}`);
        equal(runs[0]?.k, 0);
      }
    },
  ],
  [
    '掠射角下真正挡在前面的面照样挡住(法向容差的余弦有下限)',
    () => {
      const view = new Projection3D({ rotX: 0, rotY: 0, viewDistance: 700 });
      // 过原点、法向与视线夹角的余弦只有 0.05 的平板;点在它后面沿视线 20、沿法向只有 1。
      const cos = 0.05;
      const sin = Math.sqrt(1 - cos * cos);
      const corner = (a: number, b: number): Vec3 => ({ x: b * cos, y: a, z: -b * sin });
      const slab = new Mesh3D(
        [corner(-40, -40), corner(-40, 40), corner(40, 40), corner(40, -40)],
        [[0, 1, 2, 3]],
        { projection: view },
      ).setStyle({ fill: '#ccc' });
      const line = new Line3D({ x: 0, y: -5, z: -20 }, { x: 0, y: 5, z: -20 }, {
        projection: view,
        occluders: [slab],
      });
      const runs = line.visibilityRuns();
      equal(runs.length, 1);
      equal(runs[0]?.k, 1);
    },
  ],
]);
