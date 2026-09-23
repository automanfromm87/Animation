import { close, equal, fakeCtx, ok, stateAt, suite, throws } from '../../testing/harness';
import { Group } from '../mobjects/Group';
import type { MObject } from '../mobjects/MObject';
import { Circle, Label } from '../mobjects/shapes';
import { Tex } from '../mobjects/tex';
import type { PathLayer } from '../path/draw';
import { pathLength } from '../path/measure';
import { lightTheme } from '../theme/presets';
import { linear } from './rateFunctions';
import { Write } from './write';

function layersOf(m: MObject): readonly PathLayer[] {
  return m.getMorphOverlay()?.layers ?? [];
}

function draw(m: MObject): ReturnType<typeof fakeCtx>['calls'] {
  const { ctx, calls } = fakeCtx();
  m.render(ctx, lightTheme);
  return calls;
}

export default suite('逐字书写 Write', [
  [
    '公式:字形先描轮廓再填充、错峰书写;开始时什么都没有,结束后撤掉覆盖层按原样画',
    () => {
      const tex = new Tex('a+b').setStyle({ fontSize: 20 });
      const w = new Write(tex, { rateFunc: linear });
      w.begin();
      equal(layersOf(tex).length, 0, '开始时不该画出任何东西');
      equal(draw(tex).filter((c) => c.op === 'fill' || c.op === 'stroke').length, 0);
      w.interpolate(0.2);
      const early = layersOf(tex);
      ok(early.length > 0 && early.length < 3, `错峰:α=0.2 时应只写到前几个字形,实际 ${early.length}`);
      ok(early.every((l) => l.paint.fill === null && l.paint.stroke !== null), '前段只描轮廓');
      close(early[0]?.paint.strokeWidth ?? NaN, 20 * 0.03, 1e-12, '轮廓线宽按字号取');
      w.interpolate(0.9);
      ok(layersOf(tex).some((l) => l.paint.fill !== null), '后段应当在填充');
      w.finish();
      equal(tex.getMorphOverlay(), null);
      equal(draw(tex).filter((c) => c.op === 'fill').length, 1, '写完应回到同色合并一次 fill');
      equal(tex.opacity, 1, '不改不透明度');
    },
  ],
  [
    '只描边的图形全程按弧长生长;有填充的先描边再填充',
    () => {
      const ring = new Circle(10);
      const w = new Write(ring, { rateFunc: linear });
      w.begin();
      w.interpolate(0.5);
      const half = layersOf(ring)[0];
      close(pathLength(half?.path ?? { subpaths: [] }), pathLength(ring.toPath()) / 2, 1e-6);
      w.finish();
      const disc = new Circle(10).setStyle({ fill: '#ff0000' });
      const wf = new Write(disc, { rateFunc: linear });
      wf.begin();
      wf.interpolate(0.25);
      equal(layersOf(disc)[0]?.paint.fill, null);
      wf.interpolate(0.75);
      equal(layersOf(disc)[0]?.paint.fill, 'rgba(255, 0, 0, 0.5)');
      equal(layersOf(disc)[0]?.paint.stroke, lightTheme.stroke, '自己的描边保持不变');
      wf.finish();
      equal(disc.getMorphOverlay(), null);
    },
  ],
  [
    '组按子元素先序展开;没有几何的 Label 在自己的时段里淡入',
    () => {
      const label = new Label('hi');
      const circle = new Circle(10);
      const group = new Group().add(circle, label);
      const w = new Write(group, { rateFunc: linear, lagRatio: 1 });
      w.begin();
      // lagRatio 1:两片首尾相接,圆占前一半,Label 占后一半。
      w.interpolate(0.25);
      equal(draw(group).filter((c) => c.op === 'fillText').length, 0, 'Label 还没轮到');
      w.interpolate(0.75);
      const calls = draw(group);
      equal(calls.find((c) => c.op === 'fillText')?.value, 'hi');
      close(Number(stateAt(calls, 'fillText', 'globalAlpha')), 0.5, 1e-12);
      w.finish();
      equal(group.getMorphOverlay(), null);
    },
  ],
  [
    'lagRatio 必须是非负有限数;往返型缓动停在对应进度上(与 Create 一致);空组什么都不做',
    () => {
      throws(() => new Write(new Circle(1), { lagRatio: -1 }));
      throws(() => new Write(new Circle(1), { lagRatio: Number.NaN }));
      const c = new Circle(10);
      const back = new Write(c, { rateFunc: (x) => 4 * x * (1 - x) });
      back.begin();
      back.finish();
      ok(c.getMorphOverlay() !== null, '停在进度 0,覆盖层应还在(什么都不画)');
      equal(layersOf(c).length, 0);
      const empty = new Group();
      const we = new Write(empty);
      we.begin();
      we.finish();
      equal(empty.getMorphOverlay(), null);
    },
  ],
]);
