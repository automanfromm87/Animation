import { close, equal, ok, suite, throws } from '../../testing/harness';
import { Orbit3D } from '../animations/animations3d';
import { Create, FadeTransform, MoveTo, ScaleTo } from '../animations/primitives';
import { worldBoundsInScene } from '../mobjects/bounds';
import { Group } from '../mobjects/Group';
import type { MObject } from '../mobjects/MObject';
import { Label } from '../mobjects/shapes';
import type { Bounds } from '../mobjects/types';
import { boxBoundsInParent } from '../mobjects/types';
import { lightTheme } from '../theme/presets';
import type { DrawRecord } from './drawRecorder.testutil';
import { recordingCtx } from './drawRecorder.testutil';
import { Anchor3D, Dot3D } from './Anchor3D';
import type { HiddenStyle3D } from './occlusion';
import { Projection3D } from './Projection3D';
import { Cube } from './solids';
import { Space3D } from './Space3D';

function draw(...objects: MObject[]): DrawRecord {
  const rec = recordingCtx();
  for (const m of objects) {
    m.render(rec.ctx, lightTheme);
  }
  return rec;
}

/** 字号设在自己身上的 Label(node 下宽 = 字数 × 字号 × 0.6,确定性)。 */
function label(text: string, size = 20): Label {
  return new Label(text).setStyle({ fontSize: size });
}

/** 在父坐标系里的包围盒(算上自己的 position / scale / rotation)。 */
function parentBounds(m: MObject): Bounds {
  return boxBoundsInParent(m.getBox(), m.position, m.scale, m.rotation);
}

function center(m: MObject): { x: number; y: number } {
  const b = m.getBox();
  return { x: b.center.x, y: b.center.y };
}

export default suite('Anchor3D', [
  [
    '包围盒中心 = 锚点投影 + offset;Orbit3D 插值后不需要 updater 就到了新投影',
    () => {
      const view = new Projection3D({ rotX: -0.4, rotY: 0.3 });
      const p = { x: 60, y: -30, z: 40 };
      const anchor = new Anchor3D(label('P'), p, { projection: view, offset: { x: 0, y: -18 } });
      const q = view.project(p);
      const c = center(anchor);
      close(c.x, q.x, 1e-9);
      close(c.y, q.y - 18, 1e-9);
      const orbit = new Orbit3D(view, 1);
      orbit.begin();
      orbit.interpolate(0.3);
      const q2 = view.project(p);
      ok(Math.abs(q2.x - q.x) > 1, '视角没变?');
      const c2 = center(anchor);
      close(c2.x, q2.x, 1e-9);
      close(c2.y, q2.y - 18, 1e-9);
      close(anchor.projected().x, q2.x, 1e-12);
    },
  ],
  [
    '世界包围盒跟着投影(Transform / 取景依赖它);moveTo 挪整个画框',
    () => {
      const view = new Projection3D({ rotX: -0.2, rotY: 0.5 });
      const text = label('A');
      const p = { x: -40, y: 20, z: 10 };
      const anchor = new Anchor3D(text, p, { projection: view });
      const root = new Group().add(anchor);
      const q = view.project(p);
      const b = worldBoundsInScene([root], [text]);
      ok(b !== null);
      close(((b?.minX ?? 0) + (b?.maxX ?? 0)) / 2, q.x, 1e-9);
      close(((b?.minY ?? 0) + (b?.maxY ?? 0)) / 2, q.y, 1e-9);
      anchor.moveTo({ x: 100, y: 50 });
      const b2 = worldBoundsInScene([root], [text]);
      close(((b2?.minX ?? 0) + (b2?.maxX ?? 0)) / 2, q.x + 100, 1e-9);
      close(((b2?.minY ?? 0) + (b2?.maxY ?? 0)) / 2, q.y + 50, 1e-9);
      // 与网格 project(p, frame) 的结果一致:和网格放同一位置就对得上。
      const cube = new Cube(80, { projection: view }).moveTo({ x: 100, y: 50 });
      const onMesh = view.project(p, cube);
      close(((b2?.minX ?? 0) + (b2?.maxX ?? 0)) / 2, onMesh.x, 1e-9);
    },
  ],
  [
    'away:顶点字母沿「底面中心 → 顶点」的投影方向往外推,近边离锚点 = gap',
    () => {
      const view = new Projection3D({ rotX: -0.4, rotY: 0.5 });
      const corner = { x: 80, y: 75, z: 80 };
      const base = { x: 0, y: 75, z: 0 };
      const text = label('A', 20); // 12 × 20
      const anchor = new Anchor3D(text, corner, { projection: view, away: base, gap: 8 });
      const q = view.project(corner);
      const o = view.project(base);
      const len = Math.hypot(q.x - o.x, q.y - o.y);
      const dx = (q.x - o.x) / len;
      const dy = (q.y - o.y) / len;
      const reach = (Math.abs(dx) * 12 + Math.abs(dy) * 20) / 2;
      const c = center(anchor);
      close(c.x, q.x + dx * (8 + reach), 1e-9);
      close(c.y, q.y + dy * (8 + reach), 1e-9);
      // 盒子不压锚点:锚点在盒外。
      const b = anchor.getBox();
      ok(
        Math.abs(q.x - b.center.x) >= b.size.w / 2 - 1e-9 || Math.abs(q.y - b.center.y) >= b.size.h / 2 - 1e-9,
        '字压在锚点上了',
      );
    },
  ],
  [
    '内容自己的 position 是额外偏移:MoveTo(label)、FadeTransform(label) 的位移不被同步覆盖',
    () => {
      const view = new Projection3D({ rotX: 0, rotY: 0 });
      const text = label('x');
      const anchor = new Anchor3D(text, { x: 30, y: 40, z: 0 }, { projection: view, away: { x: 0, y: 0, z: 0 } });
      const c0 = center(anchor);
      const move = new MoveTo(text, { x: 5, y: -7 });
      move.begin();
      move.finish();
      const c1 = center(anchor);
      close(c1.x - c0.x, 5, 1e-9);
      close(c1.y - c0.y, -7, 1e-9);
      text.moveTo({ x: 0, y: 0 });
      const fade = new FadeTransform(text, 'y', { shift: 12 });
      fade.begin();
      fade.interpolate(0.25); // 旧串上浮 6
      const c2 = center(anchor);
      close(c2.y - c0.y, -6, 1e-9);
      fade.finish();
      equal(text.text, 'y');
      close(center(anchor).y, c0.y, 1e-9);
    },
  ],
  [
    '遮挡:锚点在填色立方体背后,faded → 文字 α 0.35;none → 不画;shown(缺省)→ 1',
    () => {
      const view = new Projection3D({ rotX: 0, rotY: 0 });
      const cube = new Cube(100, { projection: view }).setStyle({ fill: '#ddd' });
      const behind = { x: 0, y: 0, z: -80 };
      const make = (hidden?: HiddenStyle3D): Anchor3D =>
        new Anchor3D(label('Q'), behind, { projection: view, occluders: [cube], hidden });
      const faded = make('faded');
      equal(faded.occlusion(), 1);
      const t1 = draw(faded).texts;
      equal(t1.length, 1);
      close(t1[0]?.alpha ?? NaN, 0.35, 1e-12);
      equal(draw(make('none')).texts.length, 0);
      const shown = make();
      equal(shown.occlusion(), 0);
      equal(draw(shown).texts[0]?.alpha, 1);
      // 锚点在前面:不受影响。
      const front = new Anchor3D(label('F'), { x: 0, y: 0, z: 80 }, {
        projection: view,
        occluders: [cube],
        hidden: 'none',
      });
      equal(draw(front).texts[0]?.alpha, 1);
    },
  ],
  [
    'Create(anchor) 可用(Label 逐字写出);Dot3D 画出一个实心点,颜色随 stroke',
    () => {
      const view = new Projection3D({ rotX: 0, rotY: 0 });
      const anchor = new Anchor3D(label('abcd'), { x: 0, y: 0, z: 0 }, { projection: view });
      ok(anchor.supportsReveal);
      const create = new Create(anchor);
      create.begin();
      create.interpolate(0.5);
      equal(draw(anchor).texts[0]?.text, 'ab');
      create.finish();
      equal(draw(anchor).texts[0]?.text, 'abcd');
      const dot = new Dot3D({ x: 10, y: 0, z: 0 }, { projection: view, radius: 4 });
      dot.setStyle({ stroke: '#123456' });
      const rec = draw(dot);
      equal(rec.fills.length, 1);
      equal(rec.fills[0], '#123456');
      equal(rec.strokes.length, 0);
      const b = dot.getBox();
      close(b.size.w, 8, 1e-9);
      close(b.center.x, 10, 1e-9);
      throws(() => new Dot3D({ x: 0, y: 0, z: 0 }, { radius: -1 }));
    },
  ],
  [
    '锚点被改成 NaN:告警一次、不画、包围盒为零',
    () => {
      const anchor = new Anchor3D(label('N'), { x: 0, y: 0, z: 0 });
      anchor.point = { x: NaN, y: 0, z: 0 };
      let warns = 0;
      const original = console.warn;
      console.warn = () => {
        warns += 1;
      };
      try {
        equal(draw(anchor).texts.length, 0);
        equal(anchor.getBox().size.w, 0);
        draw(anchor);
      } finally {
        console.warn = original;
      }
      equal(warns, 1);
      anchor.setPoint({ x: 1, y: 2, z: 3 });
      equal(draw(anchor).texts.length, 1);
      throws(() => anchor.setPoint({ x: 0, y: Infinity, z: 0 }));
    },
  ],
  [
    '加入自己抛错(环检测经钉子组仍生效);add / remove / content 作用于内容',
    () => {
      const first = label('a');
      const anchor = new Anchor3D(first, { x: 0, y: 0, z: 0 });
      throws(() => anchor.add(anchor));
      const outer = new Group().add(anchor);
      throws(() => anchor.add(outer));
      equal(anchor.content, first);
      const second = label('b');
      anchor.add(second);
      equal(draw(anchor).texts.length, 2);
      anchor.remove(first);
      equal(anchor.content, second);
      equal(draw(anchor).texts.length, 1);
      throws(() => new Anchor3D(label('c'), { x: NaN, y: 0, z: 0 }));
      throws(() => new Anchor3D(label('c'), { x: 0, y: 0, z: 0 }, { offset: { x: NaN, y: 0 } }));
      throws(() => new Anchor3D(label('c'), { x: 0, y: 0, z: 0 }, { gap: -1 }));
      throws(() => new Anchor3D(label('c'), { x: 0, y: 0, z: 0 }, { hidden: 'x' as HiddenStyle3D }));
    },
  ],
  [
    '自己的 scale / rotation 绕锚点作用:ScaleTo(dot3d, 2) 点变大、仍钉在原处;放大的字照样离锚点 gap',
    () => {
      const view = new Projection3D({ rotX: 0, rotY: 0 });
      const dot = new Dot3D({ x: 80, y: -40, z: 0 }, { projection: view, radius: 5 });
      const grow = new ScaleTo(dot, 2);
      grow.begin();
      grow.finish();
      equal(dot.scale, 2);
      const b = parentBounds(dot);
      close((b.minX + b.maxX) / 2, 80, 1e-9);
      close((b.minY + b.maxY) / 2, -40, 1e-9);
      close(b.maxX - b.minX, 20, 1e-9);
      dot.rotation = Math.PI / 3;
      const r = parentBounds(dot);
      close((r.minX + r.maxX) / 2, 80, 1e-9);
      close((r.minY + r.maxY) / 2, -40, 1e-9);
      dot.moveTo({ x: 10, y: 5 });
      const m = parentBounds(dot);
      close((m.minX + m.maxX) / 2, 90, 1e-9, 'position 仍是画框原点');
      close((m.minY + m.maxY) / 2, -35, 1e-9);
      // away 的字放大后近边仍离锚点 gap:往右推时近边是左边。
      const text = label('A', 20); // 12 × 20
      const anchor = new Anchor3D(text, { x: 50, y: 0, z: 0 }, {
        projection: view,
        away: { x: 0, y: 0, z: 0 },
        gap: 8,
      });
      anchor.scale = 2;
      const a = parentBounds(anchor);
      close(a.minX, 58, 1e-9);
      close(a.maxX - a.minX, 24, 1e-9);
      close((a.minY + a.maxY) / 2, 0, 1e-9);
    },
  ],
  [
    '放大 / 转动 Anchor3D 不算挪了画框:Space3D 不告警,遮挡的画框检查也不告警',
    () => {
      const view = new Projection3D({ rotX: 0, rotY: 0 });
      const space = new Space3D(view);
      const cube = new Cube(100).setStyle({ fill: '#ddd' });
      const dot = new Dot3D({ x: 0, y: 0, z: -80 }, { hidden: 'faded' });
      space.add(cube, dot);
      dot.scale = 1.5;
      dot.rotation = 0.2;
      const warnings: string[] = [];
      const original = console.warn;
      console.warn = (msg: unknown) => {
        warnings.push(String(msg));
      };
      try {
        draw(space);
      } finally {
        console.warn = original;
      }
      equal(warnings.length, 0, warnings.join(' | '));
      equal(dot.occlusion(), 1, '锚点仍按同一画框判定被立方体挡住');
    },
  ],
]);
