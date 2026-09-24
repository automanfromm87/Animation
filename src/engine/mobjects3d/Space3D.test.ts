import { installDomStub } from '../../testing/domStub';
import { close, equal, ok, suite } from '../../testing/harness';
import type { Playable } from '../animations/Animation';
import { Orbit3D, ViewTo } from '../animations/animations3d';
import { Create, FadeIn } from '../animations/primitives';
import { Group } from '../mobjects/Group';
import type { MObject } from '../mobjects/MObject';
import { Label } from '../mobjects/shapes';
import { Tex } from '../mobjects/tex';
import { Scene } from '../scene/Scene';
import { lightTheme } from '../theme/presets';
import type { DrawRecord } from './drawRecorder.testutil';
import { recordingCtx } from './drawRecorder.testutil';
import { Anchor3D, Dot3D } from './Anchor3D';
import { Axes3D } from './Axes3D';
import { Line3D, ParametricCurve3D } from './lines3d';
import { ParametricSurface } from './ParametricSurface';
import { Projection3D } from './Projection3D';
import { Cube, Pyramid } from './solids';
import { Space3D } from './Space3D';

function draw(...objects: MObject[]): DrawRecord {
  const rec = recordingCtx();
  for (const m of objects) {
    m.render(rec.ctx, lightTheme);
  }
  return rec;
}

const EDGE = (50 * 700) / 650;

/** 在假画布上把一组动画播完;渲染器吞掉的绘制错误(console.error)也算失败。 */
async function playAll(build: (scene: Scene) => Playable[][]): Promise<void> {
  const dom = installDomStub();
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  try {
    const scene = new Scene(dom.canvas(), { theme: lightTheme });
    for (const batch of build(scene)) {
      let done = false;
      let failure: unknown = null;
      scene.play(...batch).then(
        () => {
          done = true;
        },
        (e: unknown) => {
          failure = e;
          done = true;
        },
      );
      for (let i = 0; i < 2000 && !done; i++) {
        dom.frame(16);
        await dom.flush();
      }
      ok(done, '动画没有播完');
      if (failure) {
        throw failure;
      }
    }
    scene.dispose();
  } finally {
    console.error = original;
    dom.restore();
  }
  equal(errors.length, 0, `播放 / 绘制中出了错:${errors.map((e) => String(e)).join(' | ')}`);
}

export default suite('Space3D', [
  [
    '加入后按层排序:网格 → 线条 → 其它;含网格的嵌套组排在前面;同层保持加入顺序',
    () => {
      const space = new Space3D();
      const line = new Line3D({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
      const cube = new Cube(50);
      const text = new Anchor3D(new Label('A'), { x: 0, y: 0, z: 0 });
      space.add(line, cube, text);
      const order = space.getChildren();
      equal(order[0], cube);
      equal(order[1], line);
      equal(order[2], text);
      const pyramid = new Pyramid(40, 50);
      const nested = new Group().add(pyramid);
      const line2 = new Line3D({ x: 0, y: 0, z: 0 }, { x: 0, y: 10, z: 0 });
      space.add(line2, nested);
      const again = space.getChildren();
      equal(again[0], cube);
      equal(again[1], nested);
      equal(again[2], line);
      equal(again[3], line2);
      equal(again[4], text);
      equal(space.meshes().length, 2);
    },
  ],
  [
    '视角统一:直接与嵌套的子元素都换成空间视角;先加组、再往组里加的对象下一次 render 后也换好',
    () => {
      const view = new Projection3D({ rotX: -0.3, rotY: 0.2 });
      const space = new Space3D(view);
      const cube = new Cube(50);
      const group = new Group();
      const axes = new Axes3D({ labels: false });
      space.add(cube, group, axes);
      equal(cube.getProjection(), view);
      equal(axes.getProjection(), view);
      equal(axes.zAxis.getProjection(), view);
      const late = new Line3D({ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
      group.add(late);
      ok(late.getProjection() !== view);
      draw(space);
      equal(late.getProjection(), view);
      const other = new Projection3D();
      space.setProjection(other);
      equal(cube.getProjection(), other);
      equal(late.getProjection(), other);
    },
  ],
  [
    '自动遮挡:空间里的线不给 occluders 也被网格挡住;显式 [] 关掉;remove 后自动表清空',
    () => {
      const space = new Space3D(new Projection3D({ rotX: 0, rotY: 0, viewDistance: 700 }));
      const cube = new Cube(100).setStyle({ fill: '#bfdbfe' });
      const line = new Line3D({ x: -150, y: 0, z: 0 }, { x: 150, y: 0, z: 0 });
      const off = new Line3D({ x: -150, y: 0, z: 0 }, { x: 150, y: 0, z: 0 }, { occluders: [] });
      space.add(line, off, cube);
      const runs = line.visibilityRuns();
      equal(runs.length, 3);
      close(runs[0]?.to ?? NaN, 150 - EDGE, 0.1);
      equal(off.visibilityRuns().length, 1);
      const rec = draw(space);
      equal(rec.ops[0], 'fill', '网格排在线条前面,应先画');
      space.remove(line);
      equal(line.visibilityRuns().length, 1, '移出空间后不再被自动遮挡');
      line.setOccluders([cube]);
      equal(line.visibilityRuns().length, 3);
    },
  ],
  [
    '3D 对象不在空间原点:告警一次',
    () => {
      const space = new Space3D();
      const cube = new Cube(40).moveTo({ x: 30, y: 0 });
      const group = new Group().add(new Line3D({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 })).moveTo({ x: 0, y: 5 });
      space.add(cube, group, new Label('2D 字随便放').moveTo({ x: 100, y: 100 }));
      const warnings: string[] = [];
      const original = console.warn;
      console.warn = (msg: unknown) => {
        warnings.push(String(msg));
      };
      try {
        draw(space);
        draw(space);
      } finally {
        console.warn = original;
      }
      // 线条还会因为和立方体不在同一画框再告警一次(遮挡检查),这里只数 Space3D 自己的。
      const own = warnings.filter((w) => w.startsWith('[Space3D]'));
      equal(own.length, 2, own.join(' | '));
      ok(own.some((w) => w.includes('Cube')));
      ok(own.some((w) => w.includes('Line3D')));
    },
  ],
  [
    '验收:正四棱锥的高线在体内自动画虚线,顶点字母随 Orbit3D 转动,不写 updater',
    () => {
      const view = new Projection3D({ rotX: -0.4, rotY: 0.5 });
      const space = new Space3D(view).moveTo({ x: 0, y: -30 });
      const a = 160;
      const h = 150;
      const P = { x: 0, y: -h / 2, z: 0 };
      const O = { x: 0, y: h / 2, z: 0 };
      const corners = [
        [-1, 1],
        [1, 1],
        [1, -1],
        [-1, -1],
      ].map(([sx = 0, sz = 0]) => ({ x: (sx * a) / 2, y: h / 2, z: (sz * a) / 2 }));
      const pyramid = new Pyramid(a, h).setStyle({ stroke: '#2563eb' });
      const height = new Line3D(P, O).setStyle({ stroke: '#db2777' });
      const names = corners.map(
        (c, i) => new Anchor3D(new Label('ABCD'[i] ?? '').setStyle({ fontSize: 24 }), c, { away: O, gap: 8 }),
      );
      const apex = new Anchor3D(new Label('P').setStyle({ fontSize: 24 }), P, { offset: { x: 0, y: -18 } });
      space.add(height, ...names, apex, pyramid);
      equal(space.getChildren()[0], pyramid, '网格排到最前');
      const runs = height.visibilityRuns();
      const hiddenLength = runs.filter((r) => r.k === 1).reduce((acc, r) => acc + r.to - r.from, 0);
      ok(hiddenLength > 0.9 * height.length(), `高线在体内应几乎整段被挡:${JSON.stringify(runs)}`);
      const rec = draw(space);
      ok(rec.strokes.some((st) => st.strokeStyle === '#db2777' && st.dashed), '高线应画成虚线');
      const before = apex.getBox().center.x;
      const corner = names[1]?.getBox().center.x ?? NaN;
      const orbit = new Orbit3D(view, 0.25);
      orbit.begin();
      orbit.interpolate(1);
      close(apex.getBox().center.x, before, 1e-9, '尖顶在转轴上,位置不变');
      ok(Math.abs((names[1]?.getBox().center.x ?? NaN) - corner) > 5, '底面的字母应随视角移动');
    },
  ],
  [
    '集成:Space3D(填色曲面 + 坐标轴 + 曲线 + 标注)在场景里依次 Create、Orbit3D、ViewTo,没有绘制错误',
    async () => {
      await playAll((scene) => {
        const view = Projection3D.math();
        const space = new Space3D(view);
        const axes = new Axes3D({ x: [-2, 2], y: [-2, 2], z: [-1, 2], unit: 50, numbers: true });
        const f = (x: number, y: number): number => Math.exp(-(x * x + y * y));
        const surface = new ParametricSurface((u, v) => axes.point(u, v, f(u, v)), {
          uRange: [-2, 2],
          vRange: [-2, 2],
          uSegs: 12,
          vSegs: 12,
        }).setStyle({ fill: '#bfdbfe', strokeWidth: 0.5 });
        const slice = axes.curve((t) => ({ x: t, y: 0, z: f(t, 0) }), [-2, 2]).setStyle({ stroke: '#db2777' });
        const helix = new ParametricCurve3D(
          (t) => axes.point(Math.cos(t), Math.sin(t), t / 6),
          [0, Math.PI * 4],
          { tips: 'end' },
        );
        const peak = new Dot3D(axes.point(0, 0, 1));
        const name = new Anchor3D(new Tex('P'), axes.point(0, 0, 1), { offset: { x: 0, y: -18 } });
        space.add(surface, axes, slice, helix, peak, name);
        for (const m of [axes, slice, helix, peak, name]) {
          m.setRevealFraction(0);
        }
        surface.opacity = 0;
        scene.add(space);
        return [
          [new FadeIn(surface, { runTime: 0.2 })],
          [new Create(axes, { runTime: 0.3 }), new Create(slice, { runTime: 0.3 })],
          [new Create(helix, { runTime: 0.2 }), new Create(peak, { runTime: 0.2 }), new Create(name, { runTime: 0.2 })],
          [new Orbit3D(view, 0.5, { runTime: 0.3 })],
          [new ViewTo(view, { elevation: 1.0, azimuth: 0.2 }, { runTime: 0.3 })],
        ];
      });
    },
  ],
]);
