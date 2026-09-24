import { close, equal, ok, suite, throws } from '../../testing/harness';
import { Orbit3D, ParamMorph, Spin3D } from '../animations/animations3d';
import { Create } from '../animations/primitives';
import { thereAndBack } from '../animations/rateFunctions';
import { Group } from '../mobjects/Group';
import type { MObject } from '../mobjects/MObject';
import { lightTheme } from '../theme/presets';
import type { DrawRecord, Segment2D } from './drawRecorder.testutil';
import { recordingCtx } from './drawRecorder.testutil';
import { Axes3D } from './Axes3D';
import { Arrow3D, Line3D, ParametricCurve3D, Polyline3D } from './lines3d';
import { Projection3D } from './Projection3D';
import { Cube } from './solids';
import type { Tips3D } from './Stroke3D';
import type { Vec3 } from './vec3';

function draw(...objects: MObject[]): DrawRecord {
  const rec = recordingCtx();
  for (const m of objects) {
    m.render(rec.ctx, lightTheme);
  }
  return rec;
}

/** 全部描边线段(按记录顺序拼起来)。 */
function allSegments(rec: DrawRecord): Segment2D[] {
  return rec.strokes.flatMap((s) => s.segments);
}

function first<T>(list: readonly T[], what = '元素'): T {
  const v = list[0];
  if (v === undefined) {
    throw new Error(`没有${what}`);
  }
  return v;
}

function last<T>(list: readonly T[], what = '元素'): T {
  const v = list[list.length - 1];
  if (v === undefined) {
    throw new Error(`没有${what}`);
  }
  return v;
}

/** 线段组的起点与终点(假设首尾相接)。 */
function ends(segs: readonly Segment2D[]): { x0: number; y0: number; x1: number; y1: number } {
  const a = first(segs, '线段');
  const b = last(segs, '线段');
  return { x0: a[0], y0: a[1], x1: b[2], y1: b[3] };
}

function cubeEdgeIsDrawn(cube: Cube, a: Vec3, b: Vec3): boolean {
  const view = cube.getProjection();
  const pa = view.project(a);
  const pb = view.project(b);
  const rec = draw(cube);
  return allSegments(rec).some(
    ([x1, y1, x2, y2]) =>
      (x1 === pa.x && y1 === pa.y && x2 === pb.x && y2 === pb.y) ||
      (x1 === pb.x && y1 === pb.y && x2 === pa.x && y2 === pa.y),
  );
}

export default suite('3D 线条', [
  [
    'Line3D 画出的端点就是两端的投影,与共用视角的立方体棱逐位重合',
    () => {
      const view = new Projection3D({ rotX: -0.4, rotY: 0.7 });
      const cube = new Cube(100, { projection: view });
      const a = { x: -50, y: -50, z: 50 };
      const b = { x: 50, y: -50, z: 50 };
      const line = new Line3D(a, b, { projection: view });
      const e = ends(allSegments(draw(line)));
      const pa = view.project(a);
      const pb = view.project(b);
      equal(e.x0, pa.x);
      equal(e.y0, pa.y);
      equal(e.x1, pb.x);
      equal(e.y1, pb.y);
      ok(cubeEdgeIsDrawn(cube, a, b), '立方体的这条棱应与线条端点逐位一致');
    },
  ],
  [
    '视角变化:Orbit3D / Spin3D 插值后线条跟着网格走,不需要 updater',
    () => {
      const view = new Projection3D({ rotX: -0.3, rotY: 0.2 });
      const cube = new Cube(100, { projection: view });
      const a = { x: 50, y: 50, z: -50 };
      const b = { x: 50, y: -50, z: -50 };
      const line = new Line3D(a, b, { projection: view });
      const before = ends(allSegments(draw(line)));
      const orbit = new Orbit3D(view, 1);
      orbit.begin();
      orbit.interpolate(0.25);
      close(view.rotY, 0.2 + Math.PI / 2, 1e-12);
      const after = ends(allSegments(draw(line)));
      ok(Math.abs(after.x0 - before.x0) > 1, '视角转了,线条却没动');
      equal(after.x0, view.project(a).x);
      equal(after.y1, view.project(b).y);
      ok(cubeEdgeIsDrawn(cube, a, b), 'Orbit3D 后线条应仍与棱重合');
      const spin = new Spin3D(cube, 0.5);
      spin.begin();
      spin.interpolate(0.3);
      const spun = ends(allSegments(draw(line)));
      equal(spun.x0, view.project(a).x);
      ok(cubeEdgeIsDrawn(cube, a, b), 'Spin3D 转的是共用的视角,线条跟着动');
    },
  ],
  [
    '虚线 style.dash 照常生效;线宽 0 时不描边,Line3D 的箭头也不画,Arrow3D 的箭头照画',
    () => {
      const view = new Projection3D({ rotX: 0, rotY: 0 });
      const line = new Line3D({ x: -50, y: 0, z: 0 }, { x: 50, y: 0, z: 0 }, { projection: view });
      line.setStyle({ dash: [6, 4] });
      const rec = draw(line);
      equal(rec.strokes.length, 1);
      equal(first(rec.strokes).dash.join(','), '6,4');
      const tipped = new Line3D({ x: -50, y: 0, z: 0 }, { x: 50, y: 0, z: 0 }, { tips: 'end' });
      tipped.setStyle({ strokeWidth: 0 });
      const none = draw(tipped);
      equal(none.strokes.length, 0);
      equal(none.fills.length, 0);
      const arrow = new Arrow3D({ x: -50, y: 0, z: 0 }, { x: 50, y: 0, z: 0 });
      arrow.setStyle({ strokeWidth: 0, stroke: '#ff0000' });
      const heads = draw(arrow);
      equal(heads.strokes.length, 0);
      equal(heads.fills.length, 1);
      equal(first(heads.fills), '#ff0000');
    },
  ],
  [
    'Create 按 3D 弧长生长:透视下长到一半时笔尖在 3D 中点的投影,不在 2D 中点',
    () => {
      const view = new Projection3D({ rotX: 0, rotY: 0, viewDistance: 400 });
      const line = new Line3D({ x: -100, y: 0, z: -200 }, { x: 100, y: 0, z: 200 }, { projection: view });
      const create = new Create(line);
      create.begin();
      equal(draw(line).strokes.length, 0, '刚开始什么都不画');
      create.interpolate(0.5);
      const half = ends(allSegments(draw(line)));
      close(half.x0, -200 / 3, 1e-9);
      close(half.x1, 0, 1e-9);
      close(half.y1, 0, 1e-9);
      create.finish();
      equal(line.getRevealFraction(), null);
      const full = ends(allSegments(draw(line)));
      close(full.x1, 200, 1e-9);
      const back = new Create(line, { rateFunc: thereAndBack });
      back.begin();
      back.interpolate(0.6);
      back.finish();
      equal(line.getRevealFraction(), 0);
      equal(draw(line).strokes.length, 0, '往返缓动收尾回到「没画出来」');
    },
  ],
  [
    '箭头跟着笔尖走:杆只画到箭底;短箭头头宽同比例收缩;两端箭头从一开始就在',
    () => {
      const view = new Projection3D({ rotX: 0, rotY: 0 });
      const arrow = new Arrow3D({ x: -100, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, { projection: view });
      arrow.setRevealFraction(0.5);
      const rec = draw(arrow);
      const shaft = ends(allSegments(rec));
      close(shaft.x1, -14, 1e-9);
      const head = first(rec.fillPaths, '箭头');
      const tip = first(head, '箭头边');
      close(tip[0], 0, 1e-9);
      close(tip[1], 0, 1e-9);
      const ys = head.map((s) => s[1]).sort((p, q) => p - q);
      close(first(ys), -5, 1e-9);
      close(last(ys), 5, 1e-9);
      // 短箭头(7 < 头长 14):头长 7、半宽 2.5。
      const short = new Arrow3D({ x: 0, y: 0, z: 0 }, { x: 7, y: 0, z: 0 }, { projection: view });
      const sh = first(draw(short).fillPaths, '箭头');
      const shy = sh.map((s) => s[1]).sort((p, q) => p - q);
      close(first(shy), -2.5, 1e-9);
      close(last(shy), 2.5, 1e-9);
      const xs = sh.map((s) => s[0]);
      close(Math.min(...xs), 0, 1e-9);
      // 'both':长到一点点时两头各有一个小箭头。
      const both = new Line3D({ x: -100, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, {
        projection: view,
        tips: 'both' as Tips3D,
      });
      both.setRevealFraction(0.05);
      const b = draw(both);
      equal(b.fills.length, 2, '两端箭头都应在');
      const startHead = b.fillPaths[1] ?? [];
      close(first(startHead, '起点箭头')[0], -100, 1e-9);
      // 生长正好停在断口上:箭头长在断口前那一笔的末端,朝前指。
      const broken = new ParametricCurve3D(
        (t) => ({ x: t, y: 0, z: Math.abs(t - 50) < 1 ? NaN : 0 }),
        [0, 100],
        { samples: 10, projection: view, tips: 'end' },
      );
      close(broken.length(), 80, 1e-9);
      broken.setRevealFraction(0.5);
      const bh = first(draw(broken).fillPaths, '断口处的箭头');
      close(first(bh, '箭头边')[0], 40, 1e-9);
      close(Math.min(...bh.map((seg) => seg[0])), 26, 1e-9);
    },
  ],
  [
    'Polyline3D:闭合时画出闭合边、生长绕一圈;非有限点抛错且 setPoints 失败后保持原样;空点列不抛错',
    () => {
      const view = new Projection3D({ rotX: 0, rotY: 0 });
      const square: Vec3[] = [
        { x: 0, y: 0, z: 0 },
        { x: 100, y: 0, z: 0 },
        { x: 100, y: 100, z: 0 },
        { x: 0, y: 100, z: 0 },
      ];
      const poly = new Polyline3D(square, { projection: view, closed: true });
      close(poly.length(), 400, 1e-9);
      const segs = allSegments(draw(poly));
      equal(segs.length, 4, '闭合的正方形应有 4 条边');
      ok(
        segs.some(([x1, y1, x2, y2]) => x1 === 0 && y1 === 100 && x2 === 0 && y2 === 0),
        '缺少闭合边',
      );
      poly.setRevealFraction(0.875);
      const grown = ends(allSegments(draw(poly)));
      close(grown.x1, 0, 1e-9);
      close(grown.y1, 50, 1e-9);
      const open = new Polyline3D(square, { projection: view });
      close(open.length(), 300, 1e-9);
      throws(() => new Polyline3D([{ x: 0, y: 0, z: NaN }]));
      throws(() => poly.setPoints([{ x: 0, y: 0, z: 0 }, { x: Infinity, y: 0, z: 0 }]));
      equal(poly.points.length, 4, 'setPoints 失败后应保持原样');
      const empty = new Polyline3D([]);
      equal(draw(empty).strokes.length, 0);
      equal(empty.length(), 0);
      equal(empty.pointAt(0.5), null);
    },
  ],
  [
    'ParametricCurve3D:samples + 1 个点;NaN 处断笔;全 NaN 告警一次;参数校验',
    () => {
      const view = new Projection3D({ rotX: 0, rotY: 0 });
      const curve = new ParametricCurve3D((t) => ({ x: t, y: 0, z: 0 }), [0, 100], {
        samples: 10,
        projection: view,
      });
      equal(curve.points.length, 11);
      const gap = new ParametricCurve3D(
        (t) => ({ x: t, y: 0, z: Math.abs(t - 50) < 1 ? NaN : 0 }),
        [0, 100],
        { samples: 10, projection: view },
      );
      const segs = allSegments(draw(gap));
      equal(segs.length, 8, '中间一个 NaN 点去掉相邻两段');
      ok(
        !segs.some(([x1, , x2]) => x1 < 50 && x2 > 50),
        'NaN 处应断笔,不能有跨过去的线段',
      );
      let warns = 0;
      const original = console.warn;
      console.warn = () => {
        warns += 1;
      };
      try {
        const dead = new ParametricCurve3D(() => ({ x: NaN, y: 0, z: 0 }), [0, 1]);
        dead.resample();
        equal(draw(dead).strokes.length, 0);
      } finally {
        console.warn = original;
      }
      equal(warns, 1, '全是非有限值应只告警一次');
      throws(() => new ParametricCurve3D((t) => ({ x: t, y: 0, z: 0 }), [0, 1], { samples: 2.5 }));
      throws(() => new ParametricCurve3D((t) => ({ x: t, y: 0, z: 0 }), [0, 1], { samples: 0 }));
      throws(() => new ParametricCurve3D((t) => ({ x: t, y: 0, z: 0 }), [1, 1]));
      throws(() => new ParametricCurve3D((t) => ({ x: t, y: 0, z: 0 }), [0, NaN]));
    },
  ],
  [
    'ParametricCurve3D:resample 同参空操作、无参强制;ParamMorph 驱动;pointAt 在 3D 弧长中点',
    () => {
      let calls = 0;
      const helix = new ParametricCurve3D(
        (t, params) => {
          calls += 1;
          const r = 40 + 20 * (params[0] ?? 0);
          return { x: r * Math.cos(t), y: -10 * t, z: r * Math.sin(t) };
        },
        [0, Math.PI * 4],
        { samples: 40, params: [0] },
      );
      equal(calls, 41);
      helix.resample([0]);
      equal(calls, 41, '同参应是空操作');
      helix.resample();
      equal(calls, 82, '不传参数应强制重采');
      const x0 = helix.points[0]?.x ?? NaN;
      const morph = new ParamMorph(helix, [1]);
      morph.begin();
      morph.interpolate(1);
      close(helix.points[0]?.x ?? NaN, 60, 1e-9);
      ok(Math.abs(x0 - 60) > 1, 'ParamMorph 后点列应变化');
      equal(helix.getParams()[0], 1);
      const straight = new ParametricCurve3D((t) => ({ x: t * t, y: 0, z: 0 }), [0, 10], { samples: 50 });
      const mid = straight.pointAt(0.5);
      ok(mid !== null);
      close(mid?.x ?? NaN, 50, 1e-9);
    },
  ],
  [
    'getBox 随视角变化且包住箭头;getCullRadius 盖住每个投影点(含箭头角点)',
    () => {
      const view = new Projection3D({ rotX: -0.2, rotY: 0.3, viewDistance: 500 });
      const arrow = new Arrow3D({ x: -80, y: 30, z: -60 }, { x: 70, y: -40, z: 90 }, { projection: view });
      const b1 = arrow.getBox();
      const rec = draw(arrow);
      const pts: Array<[number, number]> = [];
      for (const s of [...allSegments(rec), ...rec.fillPaths.flat()]) {
        pts.push([s[0], s[1]], [s[2], s[3]]);
      }
      const eps = 1e-9;
      for (const [x, y] of pts) {
        ok(
          x >= b1.center.x - b1.size.w / 2 - eps &&
            x <= b1.center.x + b1.size.w / 2 + eps &&
            y >= b1.center.y - b1.size.h / 2 - eps &&
            y <= b1.center.y + b1.size.h / 2 + eps,
          `点 (${x}, ${y}) 不在包围盒里`,
        );
      }
      const r = arrow.getCullRadius();
      for (const [x, y] of pts) {
        ok(Math.hypot(x, y) <= r + eps, `剔除半径 ${r} 小于点到原点的距离 ${Math.hypot(x, y)}`);
      }
      view.rotY += 1.2;
      const b2 = arrow.getBox();
      ok(Math.abs(b2.size.w - b1.size.w) > 1 || Math.abs(b2.center.x - b1.center.x) > 1, '包围盒没随视角变化');
      equal(new Line3D({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 0 }).getBox().size.w, 0);
    },
  ],
  [
    'toPath / pathLayers:当前视角的投影快照(杆到箭底 + 箭头三角形)',
    () => {
      const view = new Projection3D({ rotX: 0, rotY: 0 });
      const arrow = new Arrow3D({ x: 0, y: 0, z: 0 }, { x: 100, y: 0, z: 0 }, { projection: view });
      const layers = arrow.pathLayers(arrow.getStyle(lightTheme));
      equal(layers.length, 2);
      equal(layers[0]?.path.subpaths.length, 1);
      const shaft = layers[0]?.path.subpaths[0]?.points ?? [];
      close(shaft[shaft.length - 2] ?? NaN, 86, 1e-9);
      equal(layers[1]?.path.subpaths[0]?.closed, true);
      equal(arrow.toPath().subpaths.length, 2);
      const poly = new Polyline3D(
        [
          { x: 0, y: 0, z: 0 },
          { x: 10, y: 0, z: 0 },
          { x: 10, y: 10, z: 0 },
        ],
        { closed: true, projection: view },
      );
      equal(poly.toPath().subpaths[0]?.closed, true, '闭合折线的快照是闭合子路径');
    },
  ],
  [
    '构造校验:tips / hidden 非法、headLength 负数、端点非有限都抛错;容器 setStyle 改得动线宽',
    () => {
      const a = { x: 0, y: 0, z: 0 };
      const b = { x: 1, y: 0, z: 0 };
      throws(() => new Line3D(a, b, { tips: 'start' as Tips3D }));
      throws(() => new Line3D(a, b, { hidden: 'ghost' as 'shown' }));
      throws(() => new Line3D(a, b, { headLength: -1 }));
      throws(() => new Line3D(a, b, { depthTolerance: NaN }));
      throws(() => new Line3D({ x: NaN, y: 0, z: 0 }, b));
      throws(() => new Arrow3D(a, { x: 0, y: Infinity, z: 0 }));
      const line = new Line3D({ x: -10, y: 0, z: 0 }, { x: 10, y: 0, z: 0 });
      const group = new Group().add(line).setStyle({ strokeWidth: 5 });
      const rec = recordingCtx();
      group.render(rec.ctx, lightTheme);
      equal(first(rec.strokes).lineWidth, 5);
      // 端点被改成非有限:静默不画。
      line.end = { x: NaN, y: 0, z: 0 };
      equal(draw(line).strokes.length, 0);
    },
  ],
  [
    'ParametricCurve3D:0/0 型可去奇点挪一点重取,不在峰顶断开;±Infinity 仍断笔;axes.curve 的函数返回空值按断笔处理',
    () => {
      const axes = new Axes3D({ labels: false });
      const sinc = axes.curve((t) => ({ x: t, y: 0, z: Math.sin(3 * t) / (3 * t) }), [-2, 2]);
      const peak = sinc.points[60];
      ok(peak !== undefined && Number.isFinite(peak.y), '采样点正好落在 t = 0 上,不该断笔');
      close(peak?.y ?? NaN, axes.point(0, 0, 1).y, 1e-3);
      equal(sinc.points.every((p) => Number.isFinite(p.x + p.y + p.z)), true);
      // 最后一个采样点往回挪(区间内侧)。
      const edge = new ParametricCurve3D((t) => ({ x: t, y: 0, z: t >= 1 ? NaN : 0 }), [0, 1], { samples: 4 });
      ok(Number.isFinite(edge.points[4]?.z ?? NaN), '终点处的 NaN 应往回挪一点重取');
      // 真正的极点(±Infinity)不挪,照样断笔。
      const pole = new ParametricCurve3D((t) => ({ x: t, y: 1 / t, z: 0 }), [-1, 1], { samples: 4 });
      ok(Number.isNaN(pole.points[2]?.y ?? 0), '1/t 在 t = 0 是极点,应断笔');
      // 采样函数漏写 return:按无定义处理,不抛 TypeError。
      const sloppy = axes.curve(
        (t) => (t < 0 ? { x: t, y: 0, z: 0 } : (undefined as unknown as Vec3)),
        [-1, 1],
        { samples: 4 },
      );
      ok(Number.isFinite(sloppy.points[0]?.x ?? NaN));
      ok(Number.isNaN(sloppy.points[4]?.x ?? 0));
    },
  ],
]);
