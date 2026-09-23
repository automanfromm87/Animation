import { close, equal, ok, quiet, suite, throws } from '../../testing/harness';
import type { MObject } from '../mobjects/MObject';
import { Circle, Label } from '../mobjects/shapes';
import { Tex } from '../mobjects/tex';
import type { Resamplable } from '../mobjects3d/Mesh3D';
import { Cube } from '../mobjects3d/solids';
import { normalizeRunTime } from './Animation';
import { MorphTo, ParamMorph } from './animations3d';
import { FadeIn, FadeOut, FadeTransform, MoveTo, RotateTo, ScaleTo } from './primitives';
import { linear } from './rateFunctions';
import { TweenValue, ValueTracker } from './tracker';

/** 记录 resample 调用的可重采样假对象。 */
function resamplable(initial: number[]): MObject & Resamplable & { calls: number[][] } {
  const c = new Circle(1) as unknown as MObject & Resamplable & { calls: number[][]; params: number[] };
  c.calls = [];
  c.params = [...initial];
  c.getParams = () => [...c.params];
  c.resample = (p: readonly number[]) => {
    c.calls.push([...p]);
    c.params = [...p];
  };
  return c;
}

export default suite('动画原语', [
  [
    'runTime 规范化:NaN / 负数按 0(立即完成),缺省 1',
    async () => {
      await quiet(() => {
        equal(normalizeRunTime(Number.NaN), 0);
        equal(normalizeRunTime(-1), 0);
        equal(normalizeRunTime(Infinity), 0);
      });
      equal(normalizeRunTime(undefined), 1);
      equal(normalizeRunTime(2.5), 2.5);
      await quiet(() => {
        equal(new FadeIn(new Circle(1), { runTime: Number.NaN }).runTime, 0);
      });
    },
  ],
  [
    'FadeIn 淡到 to(或当前值,0 时按 1);FadeOut 从当前值淡到 0',
    () => {
      const c = new Circle(1);
      c.opacity = 0.5;
      const fin = new FadeIn(c, { to: 0.8 });
      fin.begin();
      equal(c.opacity, 0);
      fin.interpolate(0.5);
      close(c.opacity, 0.4, 1e-9);
      fin.finish();
      close(c.opacity, 0.8, 1e-9);
      const out = new FadeOut(c);
      out.begin();
      out.interpolate(0.25);
      close(c.opacity, 0.6, 1e-9);
      out.finish();
      equal(c.opacity, 0);
    },
  ],
  [
    'MoveTo 动画期间原地改写自己的点对象,不与别的对象共用 position',
    () => {
      const shared = { x: 0, y: 0 };
      const a = new Circle(1);
      const b = new Circle(1);
      a.position = shared;
      b.position = shared;
      const move = new MoveTo(a, { x: 10, y: 0 }, { rateFunc: linear });
      move.begin();
      move.interpolate(0.5);
      const p = a.position;
      move.interpolate(0.7);
      ok(a.position === p, '每帧都分配了新的点对象');
      close(a.position.x, 7, 1e-9);
      equal(b.position.x, 0, '原地改写波及了共用同一个点对象的兄弟');
      move.finish();
      equal(a.position.x, 10);
    },
  ],
  [
    'ScaleTo / RotateTo / TweenValue 终态精确',
    () => {
      const c = new Circle(1);
      const s = new ScaleTo(c, 3);
      s.begin();
      s.finish();
      equal(c.scale, 3);
      const r = new RotateTo(c, Math.PI);
      r.begin();
      r.finish();
      equal(c.rotation, Math.PI);
      const tracker = new ValueTracker(2);
      const tw = new TweenValue(tracker, 0.3, { rateFunc: linear });
      tw.begin();
      tw.interpolate(0.5);
      close(tracker.getValue(), 1.15, 1e-9);
      tw.finish();
      equal(tracker.getValue(), 0.3);
    },
  ],
  [
    'FadeTransform:前半段旧串上浮淡出,中点换串,终态为新串、原位、原不透明度',
    () => {
      const t = new Tex('a');
      t.moveTo({ x: 5, y: 10 });
      t.opacity = 0.9;
      const ft = new FadeTransform(t, 'b', { rateFunc: linear, shift: 12 });
      ft.begin();
      ft.interpolate(0.25);
      equal(t.getText(), 'a');
      close(t.position.y, 10 - 6, 1e-9);
      close(t.opacity, 0.45, 1e-9);
      ft.interpolate(0.75);
      equal(t.getText(), 'b');
      close(t.position.y, 10 + 6, 1e-9);
      ft.finish();
      equal(t.getText(), 'b');
      equal(t.position.x, 5);
      equal(t.position.y, 10);
      close(t.opacity, 0.9, 1e-9);
      const label = new Label('旧');
      const lf = new FadeTransform(label, '新');
      lf.begin();
      lf.finish();
      equal(label.text, '新');
    },
  ],
  [
    'ParamMorph:缺省从当前参数出发;同一 alpha 不重复重采样;旧写法仍可用',
    () => {
      const surf = resamplable([0.2]);
      const pm = new ParamMorph(surf, [1], { rateFunc: linear });
      pm.begin();
      pm.interpolate(0.5);
      close(surf.calls[0]?.[0] ?? -1, 0.6, 1e-9);
      pm.interpolate(1);
      pm.interpolate(1);
      pm.finish();
      equal(surf.calls.length, 2, '终态之后还在重复重采样');
      const legacy = new ParamMorph(surf, [0], [0.5], { rateFunc: linear });
      legacy.begin();
      legacy.interpolate(0.5);
      close(surf.calls[surf.calls.length - 1]?.[0] ?? -1, 0.25, 1e-9);
      throws(() => new ParamMorph(surf, [0, 1], [1], {}));
      const mismatch = new ParamMorph(surf, [1, 2]);
      throws(() => mismatch.begin());
    },
  ],
  [
    'MorphTo 在 begin 校验顶点数(构造到播放之间网格可能被重建)',
    () => {
      const cube = new Cube(10);
      const ok8 = new MorphTo(cube, cube.vertices.map((v) => ({ x: v.x * 2, y: v.y, z: v.z })));
      ok8.begin();
      ok8.finish();
      equal(cube.vertices[0]?.x, -10);
      const bad = new MorphTo(cube, [{ x: 0, y: 0, z: 0 }]);
      throws(() => bad.begin());
    },
  ],
]);
