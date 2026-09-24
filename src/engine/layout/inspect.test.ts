import { createStubCanvas } from '../../testing/domStub';
import { close, equal, ok, suite } from '../../testing/harness';
import { Axes } from '../mobjects/graphs';
import { worldBoundsInScene } from '../mobjects/bounds';
import { Group } from '../mobjects/Group';
import { Annotation, Circle, Label, Rectangle } from '../mobjects/shapes';
import { Tex } from '../mobjects/tex';
import type { Bounds } from '../mobjects/types';
import { boxBoundsInParent } from '../mobjects/types';
import { CanvasRenderer } from '../renderer/CanvasRenderer';
import { Scene } from '../scene/Scene';
import { axesTextBoxes, captureRender, describeObject, inspectScene, inspectSnapshot } from './inspect';
import type { LayoutFrame, LayoutItem } from './inspect';
import { Layout } from './Layout';

function makeScene(): { scene: Scene; canvas: ReturnType<typeof createStubCanvas> } {
  const canvas = createStubCanvas();
  const scene = new Scene(canvas, { viewport: { width: 400, height: 300 } });
  scene.getCamera().setView({ x: 0, y: 0, zoom: 2 });
  return { scene, canvas };
}

function frameOf(scene: Scene): LayoutFrame {
  const f = inspectScene(scene);
  if (!f) {
    throw new Error('inspectScene 返回了 null');
  }
  return f;
}

function itemFor(frame: LayoutFrame, pred: (i: LayoutItem) => boolean): LayoutItem | undefined {
  return frame.items.find(pred);
}

function sameBounds(a: Bounds, b: Bounds, tol = 1e-9): void {
  close(a.minX, b.minX, tol, `minX:期望 ${b.minX},实际 ${a.minX}`);
  close(a.minY, b.minY, tol, `minY:期望 ${b.minY},实际 ${a.minY}`);
  close(a.maxX, b.maxX, tol, `maxX:期望 ${b.maxX},实际 ${a.maxX}`);
  close(a.maxY, b.maxY, tol, `maxY:期望 ${b.maxY},实际 ${a.maxY}`);
}

function union(list: readonly Bounds[]): Bounds {
  return list.reduce((acc, b) => ({
    minX: Math.min(acc.minX, b.minX),
    minY: Math.min(acc.minY, b.minY),
    maxX: Math.max(acc.maxX, b.maxX),
    maxY: Math.max(acc.maxY, b.maxY),
  }));
}

export default suite('版面检查 · 屏幕盒', [
  [
    '已知机位下 Label / Tex 的屏幕盒、屏幕字号与手算一致',
    () => {
      const { scene } = makeScene();
      const l = new Label('ab').setStyle({ fontSize: 10 });
      l.moveTo({ x: 10, y: 20 });
      const t = new Tex('x^2').setStyle({ fontSize: 30 });
      t.moveTo({ x: -40, y: 0 });
      scene.add(l, t);
      scene.getCamera().setView({ x: 5, y: -5, zoom: 2 });
      const f = frameOf(scene);
      const li = itemFor(f, (i) => i.object === l);
      ok(li, '没收到 Label');
      if (!li) {
        return;
      }
      equal(li.kind, 'text');
      equal(li.label, 'Label「ab」');
      equal(li.text, 'ab');
      // node 里 Label 宽 = 2 × 10 × 0.6 = 12,高 10;世界 [4, 16] × [15, 25]。
      sameBounds(li.world, { minX: 4, minY: 15, maxX: 16, maxY: 25 });
      sameBounds(li.rect, { minX: (4 - 5) * 2 + 200, minY: (15 + 5) * 2 + 150, maxX: (16 - 5) * 2 + 200, maxY: (25 + 5) * 2 + 150 });
      equal(li.fontPx, 20);
      // 墨迹盒:Label 的 em 框上下各内缩 12%(屏幕盒高 20 → 各 2.4)。
      sameBounds(li.ink, { minX: li.rect.minX, minY: li.rect.minY + 2.4, maxX: li.rect.maxX, maxY: li.rect.maxY - 2.4 }, 1e-9);
      const ti = itemFor(f, (i) => i.object === t);
      ok(ti, '没收到 Tex');
      if (!ti) {
        return;
      }
      equal(ti.label, 'Tex「x^2」');
      sameBounds(ti.world, boxBoundsInParent(t.getBox(), t.position, 1, 0));
      equal(ti.fontPx, 60);
      sameBounds(ti.ink, ti.rect, 0);
      equal(f.viewport.w, 400);
      equal(f.view.zoom, 2);
      scene.dispose();
    },
  ],
  [
    '嵌套 Group 的缩放 / 旋转 / 容器字号与 worldBoundsInScene 一致',
    () => {
      const { scene } = makeScene();
      const inner = new Label('中文');
      inner.moveTo({ x: 10, y: 0 });
      const g = new Group().add(inner);
      g.setStyle({ fontSize: 18 });
      g.moveTo({ x: 50, y: 0 });
      g.scale = 2;
      g.rotation = Math.PI / 2;
      const outer = new Group().add(g);
      outer.moveTo({ x: -20, y: 30 });
      scene.add(outer);
      const item = itemFor(frameOf(scene), (i) => i.object === inner);
      ok(item);
      const expected = worldBoundsInScene([outer], [inner], scene.measureContext());
      ok(expected);
      if (item && expected) {
        sameBounds(item.world, expected, 1e-9);
        close(item.fontPx, 18 * 2 * 2, 1e-9, '字号按容器继承 × 累积缩放 × zoom');
        close(item.transform.rotation, Math.PI / 2);
      }
      scene.dispose();
    },
  ],
  [
    '看不见的不收:透明、父组透明、生长为 0、变形中、不在场景里;不透明度累积',
    () => {
      const { scene } = makeScene();
      const hidden = new Label('a');
      hidden.opacity = 0;
      const inHidden = new Label('b');
      const hiddenGroup = new Group().add(inHidden);
      hiddenGroup.opacity = 0;
      const unrevealed = new Circle(10);
      unrevealed.setRevealFraction(0);
      const morphing = new Label('c');
      morphing.setMorphOverlay({ layers: [] });
      const dim = new Label('d');
      dim.opacity = 0.5;
      const dimGroup = new Group().add(dim);
      dimGroup.opacity = 0.5;
      const half = new Circle(10);
      half.setRevealFraction(0.5);
      const outside = new Label('不在场景里');
      scene.add(hidden, hiddenGroup, unrevealed, morphing, dimGroup, half);
      const f = frameOf(scene);
      for (const m of [hidden, inHidden, unrevealed, morphing, outside]) {
        ok(!f.items.some((i) => i.object === m), `不该收 ${String((m as Label).text ?? m.constructor.name)}`);
      }
      const di = itemFor(f, (i) => i.object === dim);
      close(di?.opacity ?? -1, 0.25);
      const hi = itemFor(f, (i) => i.object === half);
      equal(hi?.kind, 'graphic');
      equal(hi?.reveal, 0.5);
      equal(inspectScene(scene, { graphics: false })?.items.some((i) => i.kind === 'graphic'), false, 'graphics:false 不收图形');
      scene.dispose();
    },
  ],
  [
    'Layout({ clip: true }) 外的部分被裁掉,整个在外的不收',
    () => {
      const { scene } = makeScene();
      scene.getCamera().setView({ x: 0, y: 0, zoom: 1 });
      const box = new Layout(100, 40, { clip: true });
      const cut = new Rectangle(80, 20);
      cut.moveTo({ x: 40, y: 0 });
      const gone = new Rectangle(10, 10);
      gone.moveTo({ x: 200, y: 0 });
      box.add(cut, gone);
      scene.add(box);
      const f = frameOf(scene);
      const ci = itemFor(f, (i) => i.object === cut);
      ok(ci);
      if (ci) {
        // 世界 [0, 80] 裁到容器 [-50, 50] → 屏幕 [200, 250]。
        sameBounds(ci.rect, { minX: 200, minY: 140, maxX: 250, maxY: 160 });
        sameBounds(ci.world, { minX: 0, minY: -10, maxX: 80, maxY: 10 }, 1e-9);
      }
      ok(!f.items.some((i) => i.object === gone));
      scene.dispose();
    },
  ],
  [
    'Axes:刻度数字与轴名成为 tick-label 项;文字框 ∪ 线框 == getBox(防漂移)',
    () => {
      const configs: Array<[readonly [number, number], readonly [number, number], number, number]> = [
        [[-1, 3], [-2, 5], 300, 200],
        [[0.5, 4.5], [1, 9], 240, 180],
        [[-9, -1], [-3, -0.5], 200, 120],
        [[-0.001, 0.002], [100, 1000], 260, 160],
      ];
      for (const [xr, yr, w, h] of configs) {
        const axes = new Axes(xr, yr, w, h, { x: 't', y: '' });
        const boxes = axesTextBoxes(axes);
        ok(boxes.some((b) => b.part === 'name:x'), '有 x 轴名');
        ok(!boxes.some((b) => b.part === 'name:y'), '空轴名不收');
        const frameBox: Bounds = { minX: -w / 2, minY: -h / 2 - 3.5, maxX: w / 2 + 3.5, maxY: h / 2 };
        const all = union([frameBox, ...boxes.map((b) => b.box)]);
        const own = axes.getBox();
        sameBounds(all, {
          minX: own.center.x - own.size.w / 2,
          minY: own.center.y - own.size.h / 2,
          maxX: own.center.x + own.size.w / 2,
          maxY: own.center.y + own.size.h / 2,
        }, 1e-9);
      }
      const { scene } = makeScene();
      const axes = new Axes([-1, 3], [-2, 5], 300, 200);
      axes.moveTo({ x: 10, y: 0 });
      scene.add(axes);
      const f = frameOf(scene);
      const ticks = f.items.filter((i) => i.kind === 'tick-label');
      ok(ticks.length > 5, '刻度项太少');
      const one = ticks.find((i) => i.part === 'x:1');
      ok(one, '没有 x 刻度 1');
      equal(one?.label, 'Axes 刻度「1」');
      equal(one?.text, '1');
      equal(one?.objectKey, one?.key.split(':')[0]);
      equal(one?.fontPx, 20, '刻度字号 10 × zoom 2');
      if (one) {
        // 刻度数字的盒是 1.25 倍行高,墨迹上下各内缩 20%。
        const h = one.rect.maxY - one.rect.minY;
        close(one.ink.minY, one.rect.minY + h * 0.2, 1e-9);
        close(one.ink.maxY, one.rect.maxY - h * 0.2, 1e-9);
      }
      ok(ticks.some((i) => i.part === 'name:y' && i.label === 'Axes 轴名「y」'));
      ok(f.items.some((i) => i.object === axes && i.kind === 'graphic'), '坐标轴本身是图形项');
      axes.setRevealFraction(0.6);
      const fading = frameOf(scene).items.filter((i) => i.kind === 'tick-label');
      close(fading[0]?.opacity ?? -1, 0.2, 1e-9, '生长后半程刻度字淡入');
      axes.setRevealFraction(0.4);
      equal(frameOf(scene).items.filter((i) => i.kind === 'tick-label').length, 0, '前半程没有刻度字');
      scene.dispose();
    },
  ],
  [
    'Annotation:徽标里的字是 text 项(part badge),字号 = 徽标半径',
    () => {
      const { scene } = makeScene();
      const a = new Annotation('A', { offset: { x: 20, y: -20 }, badgeRadius: 10 });
      scene.add(a);
      const f = frameOf(scene);
      const badge = itemFor(f, (i) => i.part === 'badge');
      ok(badge);
      equal(badge?.kind, 'text');
      equal(badge?.label, 'Annotation「A」');
      equal(badge?.fontPx, 20);
      sameBounds(badge?.world ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 }, { minX: 10, minY: -30, maxX: 30, maxY: -10 });
      scene.dispose();
    },
  ],
  [
    'captureRender:没画返回 null;draw:false 不真的画;抛错后原型方法已恢复;可嵌套',
    () => {
      const render = CanvasRenderer.prototype.render;
      const renderInto = CanvasRenderer.prototype.renderInto;
      equal(captureRender(() => undefined), null);
      const { scene, canvas } = makeScene();
      scene.add(new Circle(10));
      const before = canvas.ops.length;
      const snap = captureRender(() => scene.render(), { draw: false });
      ok(snap, '没截到');
      equal(canvas.ops.length, before, 'draw:false 时画布上什么都没画');
      equal(snap?.roots.length, 1);
      equal(snap?.viewport.w, 400);
      equal(snap?.view.zoom, 2);
      const drawn = captureRender(() => scene.render());
      ok(drawn && canvas.ops.length > before, 'draw 缺省为 true:照常绘制');
      let threw = false;
      try {
        captureRender(() => {
          throw new Error('boom');
        });
      } catch {
        threw = true;
      }
      ok(threw);
      equal(CanvasRenderer.prototype.render, render, '抛错后 render 已恢复');
      equal(CanvasRenderer.prototype.renderInto, renderInto, '抛错后 renderInto 已恢复');
      let innerSnap: unknown = null;
      const outerSnap = captureRender(() => {
        innerSnap = captureRender(() => scene.render(), { draw: true });
      }, { draw: false });
      ok(innerSnap !== null && outerSnap !== null, '嵌套时内外层都截到');
      equal(CanvasRenderer.prototype.render, render);
      scene.dispose();
      equal(inspectScene(scene), null, '已销毁的场景返回 null');
    },
  ],
  [
    'inspectSnapshot 直接吃截获的一帧;视口为 0 的场景 inspectScene 返回 null',
    () => {
      const zero = new Scene(createStubCanvas(), { viewport: { width: 0, height: 0 } });
      equal(inspectScene(zero), null);
      zero.dispose();
      const { scene } = makeScene();
      scene.add(new Label('x'));
      const snap = captureRender(() => scene.render(), { draw: false });
      ok(snap);
      if (snap) {
        equal(inspectSnapshot(snap).items.length, 1);
        equal(inspectSnapshot(snap, { minOpacity: 1 }).items.length, 0, 'minOpacity 生效');
      }
      scene.dispose();
    },
  ],
  [
    '图形的路径在截获那一刻取好(生长中已截短):之后对象变了,帧里的路径不变;paths: false 不取',
    () => {
      const { scene } = makeScene();
      const box = new Rectangle(100, 50);
      const growing = new Circle(20);
      growing.setRevealFraction(0.5);
      scene.add(box, growing, new Label('字'));
      const frame = frameOf(scene);
      const boxItem = itemFor(frame, (i) => i.object === box);
      const pathBefore = boxItem?.path;
      ok(pathBefore, '图形项带路径');
      box.width = 10;
      ok(box.toPath() !== pathBefore, '对象的路径已经换了');
      equal(boxItem?.path, pathBefore, '帧里的还是截获时的');
      const ring = itemFor(frame, (i) => i.object === growing);
      ok(ring?.path && ring.path !== growing.toPath(), '生长到一半:截短过的路径');
      equal(itemFor(frame, (i) => i.kind === 'text')?.path, undefined, '文字项不带路径');
      const bare = inspectScene(scene, { paths: false });
      equal(itemFor(bare as LayoutFrame, (i) => i.object === box)?.path, undefined);
      scene.dispose();
    },
  ],
  [
    'describeObject:图形报引擎类名(按原型链找,不靠 constructor.name —— 压缩后那是 e、t)',
    () => {
      equal(describeObject(new Circle(3)), 'Circle');
      equal(describeObject(new Rectangle(3, 4)), 'Rectangle');
      equal(describeObject(new Axes([0, 1], [0, 1], 10, 10)), 'Axes');
      // 模拟压缩:类名是 e 的作者子类 → 报它最近的引擎父类。
      const e = class extends Rectangle {};
      Object.defineProperty(e, 'name', { value: 'e' });
      equal(describeObject(new e(3, 4)), 'Rectangle');
      equal(describeObject(new Label('读数')), 'Label「读数」');
      equal(describeObject(new Tex('x^2')), 'Tex「x^2」');
    },
  ],
]);
