import { installDomStub } from '../../testing/domStub';
import { close, equal, fakeCtx, ok, stateAt, suite, throws } from '../../testing/harness';
import { lerpColor, parseColor } from '../color';
import { Group } from '../mobjects/Group';
import type { MObject } from '../mobjects/MObject';
import { Circle, Dot, Label, Line } from '../mobjects/shapes';
import { Scene } from '../scene/Scene';
import { lightTheme } from '../theme/presets';
import { linear } from './rateFunctions';
import { ColorTo } from './styleTween';

function strokeOf(m: MObject): unknown {
  const { ctx, calls } = fakeCtx();
  m.render(ctx, lightTheme);
  return stateAt(calls, 'stroke', 'strokeStyle');
}

export default suite('颜色 / 线宽补间 ColorTo', [
  [
    '单个图形:从当前画出来的颜色(主题)出发,中途 OKLab 混色,终态精确等于目标',
    () => {
      const c = new Circle(10);
      const tween = new ColorTo(c, '#ff0000', { rateFunc: linear });
      tween.begin();
      tween.interpolate(0);
      equal(strokeOf(c), lightTheme.stroke, '开始的一帧不跳色');
      tween.interpolate(0.5);
      equal(c.getStyleOverride().stroke, lerpColor(lightTheme.stroke, '#ff0000', 0.5));
      tween.finish();
      equal(c.getStyleOverride().stroke, '#ff0000');
      equal(c.getStyleOverride().textColor, '#ff0000', '简写同时改文字色');
      equal(c.getStyleOverride().fill, undefined, '原本不填充的仍不填充');
    },
  ],
  [
    '简写给有填充的换色时保留原填充的透明度;显式 fill: null 淡出到不填充',
    () => {
      const c = new Circle(10).setStyle({ fill: 'rgba(0, 0, 255, 0.4)' });
      const tween = new ColorTo(c, '#00ff00');
      tween.begin();
      tween.finish();
      const fill = parseColor(String(c.getStyleOverride().fill));
      equal(fill?.g, 255);
      close(fill?.a ?? NaN, 0.4, 1e-9, '透明度保留');

      const d = new Circle(10).setStyle({ fill: '#0000ff' });
      const out = new ColorTo(d, { fill: null }, { rateFunc: linear });
      out.begin();
      out.interpolate(0.5);
      close(parseColor(String(d.getStyleOverride().fill))?.a ?? NaN, 0.5, 1e-9, '按透明度淡出');
      out.finish();
      equal(d.getStyleOverride().fill, null);
    },
  ],
  [
    '线宽补间;具体键优先于简写;非法线宽抛错',
    () => {
      const line = new Line({ x: 0, y: 0 }, { x: 10, y: 0 });
      const tween = new ColorTo(line, { strokeWidth: 9, color: '#ff0000', stroke: '#0000ff' }, { rateFunc: linear });
      tween.begin();
      tween.interpolate(0.5);
      close(line.getStyleOverride().strokeWidth ?? NaN, (lightTheme.strokeWidth + 9) / 2, 1e-12);
      tween.finish();
      equal(line.getStyleOverride().strokeWidth, 9);
      equal(line.getStyleOverride().stroke, '#0000ff', 'stroke 优先于 color');
      equal(line.getStyleOverride().textColor, '#ff0000');
      throws(() => new ColorTo(line, { strokeWidth: -1 }));
      throws(() => new ColorTo(line, { strokeWidth: Number.NaN }));
    },
  ],
  [
    '容器:对每个叶子生效,各自从容器继承来的颜色出发;没填充的叶子不会被填满',
    () => {
      const line = new Line({ x: 0, y: 0 }, { x: 10, y: 0 });
      const disk = new Circle(5).setStyle({ fill: '#00ff00' });
      const dot = new Dot();
      const g = new Group().add(line, disk, dot);
      g.setStyle({ stroke: '#0000ff' });
      const tween = new ColorTo(g, '#ff0000', { rateFunc: linear });
      tween.begin();
      tween.interpolate(0);
      equal(line.getStyleOverride().stroke, '#0000ff', '从容器继承来的颜色出发');
      tween.finish();
      equal(line.getStyleOverride().stroke, '#ff0000');
      equal(line.getStyleOverride().fill, undefined, '线条不会被填满');
      equal(disk.getStyleOverride().fill, '#ff0000');
      equal(dot.getStyleOverride().stroke, '#ff0000', '圆点的填充色跟着描边色');
      equal(Object.keys(g.getStyleOverride()).join(','), 'stroke', '容器自己的样式不动');
    },
  ],
  [
    '文字:改的是文字色',
    () => {
      const label = new Label('hi');
      const tween = new ColorTo(label, { textColor: '#ff0000' });
      tween.begin();
      tween.finish();
      const { ctx, calls } = fakeCtx();
      label.render(ctx, lightTheme);
      equal(stateAt(calls, 'fillText', 'fillStyle'), '#ff0000');
    },
  ],
  [
    'Scene.play 端到端:按场景里的样式出发(容器继承),播完终态精确',
    async () => {
      const dom = installDomStub();
      try {
        const scene = new Scene(dom.canvas(), { theme: lightTheme });
        const c = new Circle(20);
        const holder = new Group().add(c).setStyle({ stroke: '#0000ff' });
        scene.add(holder);
        let done = false;
        const tween = new ColorTo(c, '#ff0000', { runTime: 0.2 });
        void scene.play(tween).then(() => {
          done = true;
        });
        dom.frame(16);
        await dom.flush();
        const mid = parseColor(String(c.getStyleOverride().stroke));
        // 主题描边 #1f2937 的蓝通道只有 55;从容器的纯蓝出发,第一帧还几乎是纯蓝。
        ok(mid !== null && mid.b > 200, `起点应当是容器给的蓝色,实际 ${String(c.getStyleOverride().stroke)}`);
        for (let i = 0; i < 30 && !done; i++) {
          dom.frame(16);
          await dom.flush();
        }
        ok(done);
        equal(c.getStyleOverride().stroke, '#ff0000');
        scene.dispose();
      } finally {
        dom.restore();
      }
    },
  ],
]);
