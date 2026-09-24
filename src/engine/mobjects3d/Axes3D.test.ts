import { close, equal, ok, suite, throws } from '../../testing/harness';
import { Orbit3D } from '../animations/animations3d';
import { Create } from '../animations/primitives';
import type { MObject } from '../mobjects/MObject';
import type { Bounds } from '../mobjects/types';
import { boxBoundsInParent } from '../mobjects/types';
import { lightTheme } from '../theme/presets';
import type { DrawRecord } from './drawRecorder.testutil';
import { recordingCtx } from './drawRecorder.testutil';
import type { Anchor3D } from './Anchor3D';
import { Axes3D } from './Axes3D';
import { Projection3D } from './Projection3D';
import { Cube } from './solids';

function draw(...objects: MObject[]): DrawRecord {
  const rec = recordingCtx();
  for (const m of objects) {
    m.render(rec.ctx, lightTheme);
  }
  return rec;
}

/** 刻度数字相对刻度点的单位方向(本地坐标)。 */
function numberSide(axes: Axes3D, anchor: Anchor3D): [number, number] {
  const q = axes.getProjection().project(anchor.point);
  const b = anchor.getBox();
  const dx = b.center.x - q.x;
  const dy = b.center.y - q.y;
  const len = Math.hypot(dx, dy);
  return [dx / len, dy / len];
}

/** 子元素在坐标轴本地坐标里的包围盒。 */
function boundsOf(m: MObject): Bounds {
  return boxBoundsInParent(m.getBox(), m.position, m.scale, m.rotation);
}

function overlaps(a: Bounds, b: Bounds): boolean {
  return a.minX < b.maxX && b.minX < a.maxX && a.minY < b.maxY && b.minY < a.maxY;
}

/** 只有刻度(没有轴名)的坐标轴:便于数刻度线段。 */
function bareAxes(options?: ConstructorParameters<typeof Axes3D>[0]): Axes3D {
  return new Axes3D({ labels: false, labelKind: 'label', ...options });
}

export default suite('Axes3D', [
  [
    'point / toMath 往返(math 与 engine 两种坐标系);math 下 z 朝上即引擎 y < 0',
    () => {
      const math = bareAxes({ unit: 30 });
      const p = math.point(1, 2, 3);
      equal(p.x, 30);
      equal(p.y, -90);
      equal(p.z, -60);
      const back = math.toMath(p);
      close(back.x, 1, 1e-12);
      close(back.y, 2, 1e-12);
      close(back.z, 3, 1e-12);
      ok(math.point(0, 0, 1).y < 0);
      const engine = bareAxes({ frame: 'engine', unit: 10 });
      const e = engine.point(1, -2, 3);
      equal(e.x, 10);
      equal(e.y, -20);
      equal(e.z, 30);
      const eb = engine.toMath(e);
      close(eb.y, -2, 1e-12);
      equal(math.frame, 'math');
      equal(engine.frame, 'engine');
    },
  ],
  [
    '缺省(math + 课本视角):X 轴端点在左下、Y 在右、Z 在正上',
    () => {
      const axes = new Axes3D();
      const view = axes.getProjection();
      close(view.azimuth, Math.PI / 6, 1e-12);
      const x = view.project(axes.xAxis.end);
      const y = view.project(axes.yAxis.end);
      const z = view.project(axes.zAxis.end);
      ok(x.x < 0 && x.y > 0, `X 应在左下:(${x.x}, ${x.y})`);
      ok(y.x > 0, `Y 应在右:(${y.x}, ${y.y})`);
      ok(z.y < 0 && Math.abs(z.x) < 1e-9, `Z 应在正上:(${z.x}, ${z.y})`);
      // 箭头画在区间外侧:轴线比 [−3, 3] 长出 (9 + 4) 个本地单位。
      close(axes.zAxis.length(), 6 * 40 + 13, 1e-9);
      equal(axes.xAxis.tips, 'end');
    },
  ],
  [
    '刻度:去掉 0,[−3, 3, 1] 每轴 6 个;区间 / 步长非法、刻度过多抛错;ticks: false 不建',
    () => {
      const axes = bareAxes();
      equal(axes.tickCount, 18);
      const rec = draw(axes);
      // 三条轴各一笔 + 一组刻度(18 条短线)。
      const tickStroke = rec.strokes.find((s) => s.segments.length === 18);
      ok(tickStroke !== undefined, '没找到 18 条刻度线');
      for (const [x1, y1, x2, y2] of tickStroke?.segments ?? []) {
        close(Math.hypot(x2 - x1, y2 - y1), 8, 1e-9);
      }
      equal(bareAxes({ x: [0, 4, 2] }).tickCount, 2 + 6 + 6);
      throws(() => bareAxes({ x: [3, -3] }));
      throws(() => bareAxes({ y: [0, 1, 0] }));
      throws(() => bareAxes({ z: [0, 1, -1] }));
      throws(() => bareAxes({ x: [0, 2000, 1] }));
      throws(() => bareAxes({ unit: 0 }));
      throws(() => bareAxes({ frame: 'screen' as 'math' }));
      throws(() => bareAxes({ tickSize: -1 }));
      const noTicks = bareAxes({ ticks: false });
      equal(noTicks.tickCount, 0);
      equal(noTicks.getChildren().length, 3);
    },
  ],
  [
    '轴名:三个 Anchor3D 在轴端外侧;空串不建;labels: false 一个不建',
    () => {
      const axes = new Axes3D({ labelKind: 'label' });
      equal(axes.axisLabels.length, 3);
      const view = axes.getProjection();
      const origin = view.project(axes.point(0, 0, 0));
      [axes.xAxis, axes.yAxis, axes.zAxis].forEach((line, i) => {
        const tip = view.project(line.end);
        const b = axes.axisLabels[i]?.getBox();
        ok(b !== undefined);
        const tipDist = Math.hypot(tip.x - origin.x, tip.y - origin.y);
        const labelDist = Math.hypot((b?.center.x ?? 0) - origin.x, (b?.center.y ?? 0) - origin.y);
        ok(labelDist > tipDist, `第 ${i} 个轴名没在轴端外侧`);
      });
      equal(new Axes3D({ labels: { y: '' }, labelKind: 'label' }).axisLabels.length, 2);
      equal(new Axes3D({ labels: false }).axisLabels.length, 0);
      const custom = new Axes3D({ labels: { x: 't' }, labelKind: 'label' });
      const texts = draw(custom).texts.map((t) => t.text).sort();
      equal(texts.join(','), 't,y,z');
    },
  ],
  [
    'setProjection / setOccluders 连带全部零件;Create(axes) 可用;curve() 的点 = point(fn(t))',
    () => {
      const axes = new Axes3D({ labelKind: 'label', numbers: true });
      const view = new Projection3D({ rotX: -0.2, rotY: 0.4 });
      axes.setProjection(view);
      equal(axes.getProjection(), view);
      equal(axes.xAxis.getProjection(), view);
      equal(axes.axisLabels[2]?.getProjection(), view);
      equal(axes.numberAnchors[0]?.getProjection(), view);
      const cube = new Cube(60, { projection: view });
      axes.setOccluders([cube]);
      equal(axes.zAxis.getOccluders()?.[0], cube);
      equal(axes.axisLabels[0]?.getOccluders()?.[0], cube);
      axes.setOccluders(null);
      equal(axes.yAxis.getOccluders(), null);
      ok(axes.supportsReveal, 'Create(axes) 需要整棵子树都能生长');
      const create = new Create(axes);
      create.begin();
      create.interpolate(0.5);
      const half = draw(axes);
      ok(half.strokes.length > 0);
      create.finish();
      equal(axes.getRevealFraction(), null);
      const f = (t: number): number => t * t;
      const curve = axes.curve((t) => ({ x: t, y: 0, z: f(t) }), [-1, 1], { samples: 4 });
      equal(curve.getProjection(), view);
      const p1 = curve.points[1];
      const expected = axes.point(-0.5, 0, 0.25);
      close(p1?.x ?? NaN, expected.x, 1e-12);
      close(p1?.y ?? NaN, expected.y, 1e-12);
      close(p1?.z ?? NaN, expected.z, 1e-12);
    },
  ],
  [
    '轴正对观众(投影方向退化)时不画那条轴的刻度,不抛错',
    () => {
      const view = new Projection3D({ rotX: 0, rotY: 0 });
      const axes = bareAxes({ frame: 'engine', projection: view });
      const rec = draw(axes);
      const ticks = rec.strokes.find((s) => s.segments.length === 12);
      ok(ticks !== undefined, 'z 轴正对观众,只该画 x、y 两轴共 12 条刻度');
    },
  ],
  [
    '刻度数字:每个刻度一个,摆在刻度外侧(不压刻度点);Label 的负号换成真正的减号',
    () => {
      const axes = bareAxes({ numbers: true, labelKind: 'label' });
      equal(axes.numberAnchors.length, 18);
      const view = axes.getProjection();
      const texts = draw(axes).texts.map((t) => t.text);
      ok(texts.includes('−3'), `负号没换成减号:${texts.join(' ')}`);
      ok(!texts.includes('0'), '原点不该有数字');
      for (const anchor of axes.numberAnchors) {
        const q = view.project(anchor.point);
        const b = anchor.getBox();
        const inside =
          Math.abs(q.x - b.center.x) < b.size.w / 2 - 1e-6 &&
          Math.abs(q.y - b.center.y) < b.size.h / 2 - 1e-6;
        ok(!inside, '刻度数字压在刻度点上了');
      }
    },
  ],
  [
    '被曲面挡住的轴段画淡虚线(显式 occluders)',
    () => {
      const view = new Projection3D({ rotX: 0, rotY: 0, viewDistance: 700 });
      const axes = bareAxes({ frame: 'engine', projection: view, ticks: false, tips: 'none', unit: 50 });
      const cube = new Cube(100, { projection: view }).setStyle({ fill: '#eee' });
      axes.setOccluders([cube]);
      const runs = axes.xAxis.visibilityRuns();
      equal(runs.length, 3);
      equal(runs[1]?.k, 1);
      const rec = draw(axes);
      ok(rec.strokes.some((s) => s.dashed), '被挡的部分应画成虚线');
    },
  ],
  [
    '刻度数字环绕一整圈都不换边:每一步的摆放方向只转一点点(math 与 engine 两种坐标系)',
    () => {
      for (const frame of ['math', 'engine'] as const) {
        const axes = new Axes3D({ numbers: true, labelKind: 'label', labels: false, frame });
        const view = axes.getProjection();
        const orbit = new Orbit3D(view, 1);
        orbit.begin();
        let prev = axes.numberAnchors.map((a) => numberSide(axes, a));
        let worst = 0;
        for (let step = 1; step <= 720; step++) {
          orbit.interpolate(step / 720);
          const cur = axes.numberAnchors.map((a) => numberSide(axes, a));
          cur.forEach(([x, y], i) => {
            const [px, py] = prev[i] ?? [x, y];
            worst = Math.max(worst, Math.acos(Math.min(1, Math.max(-1, x * px + y * py))));
          });
          prev = cur;
        }
        ok(worst < 0.1, `${frame}:刻度数字一步转了 ${worst} 弧度(跳到轴的另一边了?)`);
      }
    },
  ],
  [
    '刻度数字不重叠:课本视角下挤不下的这一帧不画,画出来的数字彼此、与轴名都不相交',
    () => {
      for (const unit of [40, 25]) {
        const axes = new Axes3D({ numbers: true, labelKind: 'label', unit });
        const shown = axes.layoutNumbers();
        ok(shown.length >= 9 && shown.length < 18, `unit ${unit}:画了 ${shown.length} 个数字`);
        const boxes = [...shown, ...axes.axisLabels].map(boundsOf);
        for (let i = 0; i < boxes.length; i++) {
          for (let j = i + 1; j < boxes.length; j++) {
            const a = boxes[i];
            const b = boxes[j];
            ok(a !== undefined && b !== undefined && !overlaps(a, b), `unit ${unit}:第 ${i}、${j} 个字重叠`);
          }
        }
        // 每条轴两端的数字总在(从两端往里排)。
        const texts = draw(axes).texts.map((t) => t.text);
        equal(texts.length, shown.length + 3, '画出来的字 = 排开后的数字 + 三个轴名');
        ok(texts.filter((t) => t === '3').length === 3 && texts.filter((t) => t === '−3').length === 3);
      }
      // 摊得开时一个都不少。
      const roomy = new Axes3D({ numbers: true, labelKind: 'label', unit: 90 });
      equal(roomy.layoutNumbers().length, 18);
    },
  ],
]);
