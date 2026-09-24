import { createStubCanvas } from '../../testing/domStub';
import { close, equal, ok, suite, throws } from '../../testing/harness';
import { Group } from '../mobjects/Group';
import { Rectangle } from '../mobjects/shapes';
import type { Bounds } from '../mobjects/types';
import { Scene } from '../scene/Scene';
import {
  alignTo,
  arrange,
  boundsOf,
  centerAt,
  fitWidth,
  fitWithin,
  keepInside,
  nextTo,
  visibleWorldBounds,
} from './arrange';

/** 内容偏在右下的组:原点 (0, 0),内容是中心 (100, 50) 的 40×20 矩形。 */
function offsetGroup(): Group {
  const r = new Rectangle(40, 20);
  r.moveTo({ x: 100, y: 50 });
  return new Group().add(r);
}

function sameBounds(a: Bounds, b: Bounds, tol = 1e-9): void {
  close(a.minX, b.minX, tol, `minX:期望 ${b.minX},实际 ${a.minX}`);
  close(a.minY, b.minY, tol, `minY:期望 ${b.minY},实际 ${a.minY}`);
  close(a.maxX, b.maxX, tol, `maxX:期望 ${b.maxX},实际 ${a.maxX}`);
  close(a.maxY, b.maxY, tol, `maxY:期望 ${b.maxY},实际 ${a.maxY}`);
}

export default suite('排版助手', [
  [
    'boundsOf:原点不在中心的组、缩放、旋转都按视觉外接盒',
    () => {
      const g = offsetGroup();
      sameBounds(boundsOf(g), { minX: 80, minY: 40, maxX: 120, maxY: 60 });
      g.scale = 2;
      sameBounds(boundsOf(g), { minX: 160, minY: 80, maxX: 240, maxY: 120 });
      const r = new Rectangle(40, 20);
      r.rotation = Math.PI / 2;
      sameBounds(boundsOf(r), { minX: -10, minY: -20, maxX: 10, maxY: 20 }, 1e-9);
    },
  ],
  [
    'nextTo:四个方向 + buff,以视觉外接盒相距',
    () => {
      const a = new Rectangle(100, 40);
      const b = new Rectangle(20, 10);
      nextTo(b, a, 'right', 10);
      sameBounds(boundsOf(b), { minX: 60, minY: -5, maxX: 80, maxY: 5 });
      nextTo(b, a, 'left', 10);
      sameBounds(boundsOf(b), { minX: -80, minY: -5, maxX: -60, maxY: 5 });
      nextTo(b, a, 'down');
      sameBounds(boundsOf(b), { minX: -10, minY: 36, maxX: 10, maxY: 46 });
      nextTo(b, a, 'up', { buff: 4 });
      sameBounds(boundsOf(b), { minX: -10, minY: -34, maxX: 10, maxY: -24 });
    },
  ],
  [
    'nextTo:目标是原点不在中心的组,移动的也是组',
    () => {
      const target = offsetGroup();
      const mover = offsetGroup();
      nextTo(mover, target, 'down', 8);
      const t = boundsOf(target);
      const m = boundsOf(mover);
      close(m.minY, t.maxY + 8);
      close((m.minX + m.maxX) / 2, (t.minX + t.maxX) / 2);
    },
  ],
  [
    'nextTo:目标是点或矩形;交叉轴 start / end 对齐',
    () => {
      const b = new Rectangle(20, 10);
      nextTo(b, { x: 0, y: 0 }, 'right', 5);
      sameBounds(boundsOf(b), { minX: 5, minY: -5, maxX: 25, maxY: 5 });
      const box: Bounds = { minX: 0, minY: 0, maxX: 100, maxY: 60 };
      nextTo(b, box, 'right', { buff: 0, align: 'start' });
      sameBounds(boundsOf(b), { minX: 100, minY: 0, maxX: 120, maxY: 10 });
      nextTo(b, box, 'down', { buff: 0, align: 'end' });
      sameBounds(boundsOf(b), { minX: 80, minY: 60, maxX: 100, maxY: 70 });
      nextTo(b, box, 'up', { buff: 2, align: 'start' });
      sameBounds(boundsOf(b), { minX: 0, minY: -12, maxX: 20, maxY: -2 });
    },
  ],
  [
    'nextTo:与旧版 README 复制片段同一种调用(第 4 参数写数字、第 5 参数写 context)',
    () => {
      const a = new Rectangle(10, 10);
      const b = new Rectangle(10, 10);
      const ret = nextTo(b, a, 'right', 20, { fontSize: 20, fontFamily: 'serif' });
      equal(ret, b, '返回 m,可以链式');
      close(boundsOf(b).minX, 25);
    },
  ],
  [
    'nextTo:目标含 NaN、buff 非有限、以自己为参照都抛错',
    () => {
      const a = new Rectangle(10, 10);
      const b = new Rectangle(10, 10);
      const bad = new Rectangle(10, 10);
      bad.position = { x: NaN, y: 0 };
      throws(() => nextTo(b, bad, 'right'), 'NaN 目标应抛错');
      throws(() => nextTo(b, a, 'right', NaN), 'NaN 间距应抛错');
      throws(() => nextTo(b, b, 'right'), '以自己为参照应抛错');
      throws(() => nextTo(b, { x: Infinity, y: 0 }, 'right'), '非有限的点应抛错');
    },
  ],
  [
    'alignTo:六条边',
    () => {
      const box: Bounds = { minX: 0, minY: 0, maxX: 100, maxY: 60 };
      const m = new Rectangle(20, 10);
      m.moveTo({ x: 300, y: 300 });
      alignTo(m, box, 'left');
      close(boundsOf(m).minX, 0);
      close(boundsOf(m).minY, 295, 1e-9, '只动一个方向');
      alignTo(m, box, 'right');
      close(boundsOf(m).maxX, 100);
      alignTo(m, box, 'top');
      close(boundsOf(m).minY, 0);
      alignTo(m, box, 'bottom');
      close(boundsOf(m).maxY, 60);
      alignTo(m, box, 'centerX');
      close(m.position.x, 50);
      alignTo(m, box, 'centerY');
      close(m.position.y, 30);
      throws(() => alignTo(m, m, 'left'));
    },
  ],
  [
    'arrange:横排,混合尺寸,相邻外接盒间距恰为 buff,整排原地居中',
    () => {
      const a = new Rectangle(20, 10);
      const b = new Rectangle(40, 30);
      const c = offsetGroup();
      a.moveTo({ x: 0, y: 0 });
      b.moveTo({ x: 0, y: 0 });
      const before = [a, b, c].map((m) => boundsOf(m));
      let ux = 0;
      let uy = 0;
      {
        const minX = Math.min(...before.map((x) => x.minX));
        const maxX = Math.max(...before.map((x) => x.maxX));
        const minY = Math.min(...before.map((x) => x.minY));
        const maxY = Math.max(...before.map((x) => x.maxY));
        ux = (minX + maxX) / 2;
        uy = (minY + maxY) / 2;
      }
      const row = arrange([a, b, c], { buff: 10 });
      ok(row !== null);
      const [ba, bb, bc] = [a, b, c].map((m) => boundsOf(m));
      if (!ba || !bb || !bc || !row) {
        return;
      }
      close(bb.minX - ba.maxX, 10);
      close(bc.minX - bb.maxX, 10);
      close((ba.minY + ba.maxY) / 2, (bb.minY + bb.maxY) / 2, 1e-9, '交叉轴居中对齐');
      close((row.minX + row.maxX) / 2, ux, 1e-9, '整排中心保持原并集中心');
      close((row.minY + row.maxY) / 2, uy, 1e-9);
      close(row.maxX - row.minX, 20 + 40 + 40 + 20);
    },
  ],
  [
    'arrange:竖排 / 反向 / start 对齐 / 指定中心',
    () => {
      const a = new Rectangle(20, 10);
      const b = new Rectangle(40, 30);
      arrange([a, b], { direction: 'down', buff: 5, align: 'start', at: { x: 0, y: 0 } });
      const ba = boundsOf(a);
      const bb = boundsOf(b);
      close(bb.minY - ba.maxY, 5);
      close(ba.minX, bb.minX, 1e-9, 'start = 左对齐');
      close((ba.minY + bb.maxY) / 2, 0);
      arrange([a, b], { direction: 'left', buff: 5, at: { x: 100, y: 0 } });
      ok(boundsOf(a).minX > boundsOf(b).maxX, "'left':第一个在最右");
      close(boundsOf(a).minX - boundsOf(b).maxX, 5);
      arrange([a, b], { direction: 'up', buff: 0 });
      close(boundsOf(b).maxY, boundsOf(a).minY, 1e-9, "'up':第一个在最下");
    },
  ],
  [
    'arrange:空数组返回 null,重复对象抛错',
    () => {
      equal(arrange([]), null);
      const a = new Rectangle(10, 10);
      throws(() => arrange([a, a]));
    },
  ],
  [
    'centerAt:组的外接盒中心落到指定点',
    () => {
      const g = offsetGroup();
      centerAt(g, { x: 0, y: 0 });
      sameBounds(boundsOf(g), { minX: -20, minY: -10, maxX: 20, maxY: 10 });
      equal(g.position.x, -100, '移动的是原点,不是内容');
    },
  ],
  [
    'fitWidth / fitWithin:只缩不放,外接盒中心不动',
    () => {
      const g = offsetGroup();
      fitWidth(g, 20);
      const b = boundsOf(g);
      close(b.maxX - b.minX, 20);
      close((b.minX + b.maxX) / 2, 100);
      close((b.minY + b.maxY) / 2, 50);
      const s = g.scale;
      fitWidth(g, 1000);
      equal(g.scale, s, '放得下时不放大');
      const r = new Rectangle(100, 100);
      fitWithin(r, 80, 20);
      close(r.scale, 0.2);
      throws(() => fitWidth(r, 0));
      throws(() => fitWithin(r, 10, -1));
      const empty = new Group();
      fitWidth(empty, 5);
      equal(empty.scale, 1, '零宽不动');
    },
  ],
  [
    'keepInside:越界推回;比区域大时居中并返回 false',
    () => {
      const view: Bounds = { minX: -100, minY: -50, maxX: 100, maxY: 50 };
      const m = new Rectangle(40, 20);
      m.moveTo({ x: 95, y: -48 });
      equal(keepInside(m, view, 5), true);
      sameBounds(boundsOf(m), { minX: 55, minY: -45, maxX: 95, maxY: -25 });
      const wide = new Rectangle(300, 20);
      wide.moveTo({ x: 40, y: 45 });
      equal(keepInside(wide, view), false);
      close(wide.position.x, 0, 1e-9, '放不下的方向居中');
      close(boundsOf(wide).maxY, 50, 1e-9, '放得下的方向照样推回');
    },
  ],
  [
    'visibleWorldBounds:视口按机位换到世界,缺省扣掉安全区;可按运镜终点算;配 keepInside 把字拉回画面',
    () => {
      const scene = new Scene(createStubCanvas(), { viewport: { width: 400, height: 300 } });
      try {
        scene.getCamera().setView({ x: 10, y: 20, zoom: 2 });
        sameBounds(visibleWorldBounds(scene, { safe: false }) as Bounds, { minX: -90, minY: -55, maxX: 110, maxY: 95 });
        scene.setSafeArea({ bottom: 60 });
        const safe = scene.getSafeArea();
        equal(safe.bottom, 60);
        equal(safe.top, 0);
        safe.bottom = 999;
        equal(scene.getSafeArea().bottom, 60, 'getSafeArea 给的是拷贝');
        sameBounds(visibleWorldBounds(scene) as Bounds, { minX: -90, minY: -55, maxX: 110, maxY: 65 }, 1e-9);
        sameBounds(visibleWorldBounds(scene, { marginPx: 10 }) as Bounds, { minX: -85, minY: -50, maxX: 105, maxY: 60 });
        // 运镜之前按终点算:getFitView 给的就是 playFit 会落到的机位。
        const target = new Rectangle(100, 60);
        const end = visibleWorldBounds(scene, { view: scene.getFitView([target], 0) }) as Bounds;
        close(end.maxX - end.minX, 100, 1e-6, '宽度正好框住 100 宽的目标(按宽取景)');
        close((end.minX + end.maxX) / 2, 0, 1e-6);
        ok(end.minY <= -30 && end.maxY >= 30, '可用区里框得下目标的高');
        // 推近之后半截露在边上的字拉回可见区里。
        const b = new Rectangle(20, 10);
        b.moveTo({ x: 60, y: 0 });
        equal(keepInside(b, end, 4), true);
        close(boundsOf(b).maxX, end.maxX - 4, 1e-9);
        // 安全区比视口还大:缩成一条线,不给反向矩形。
        scene.setSafeArea({ top: 200, bottom: 200 });
        const squeezed = visibleWorldBounds(scene) as Bounds;
        equal(squeezed.minY, squeezed.maxY);
        throws(() => visibleWorldBounds(scene, { marginPx: Number.NaN }));
        throws(() => visibleWorldBounds(scene, { view: { x: 0, y: 0, zoom: 0 } }));
      } finally {
        scene.dispose();
      }
      const hidden = new Scene(createStubCanvas(), { viewport: { width: 0, height: 0 } });
      equal(visibleWorldBounds(hidden), null, '画布隐藏时返回 null');
      hidden.dispose();
    },
  ],
]);
