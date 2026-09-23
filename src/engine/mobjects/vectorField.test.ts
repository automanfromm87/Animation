import { close, equal, fakeCtx, ok, suite, throws } from '../../testing/harness';
import { Create } from '../animations/primitives';
import { Transform } from '../animations/transform';
import { Write } from '../animations/write';
import { lightTheme } from '../theme/presets';
import { Axes } from './graphs';
import { NumberPlane } from './numberLine';
import { VectorField } from './vectorField';

function length(a: { tail: { x: number; y: number }; tip: { x: number; y: number } }): number {
  return Math.hypot(a.tip.x - a.tail.x, a.tip.y - a.tail.y);
}

export default suite('标注图元:向量场', [
  [
    '长度按最大模长归一:最长的箭头恰为 maxLength,其余与模长成正比',
    () => {
      const plane = new NumberPlane([-2, 2], [-2, 2], 200, 200);
      const field = new VectorField(plane, (x, y) => [x, y], {
        xRange: [-2, 2, 1],
        yRange: [-2, 2, 1],
        maxLength: 30,
      });
      // 25 个取样点,原点是零向量不画。
      equal(field.count, 24);
      close(field.maxMagnitude, Math.hypot(2, 2), 1e-12);
      const arrows = field.arrows();
      close(Math.max(...arrows.map(length)), 30, 1e-9);
      for (const a of arrows) {
        close(length(a) / 30, a.magnitude / field.maxMagnitude, 1e-9);
      }
    },
  ],
  [
    'uniform:所有箭头一样长;pivot 决定取样点在箭头中点还是尾巴',
    () => {
      const plane = new NumberPlane([-2, 2], [-2, 2], 200, 200);
      const uniform = new VectorField(plane, (x, y) => [x + 3, y], {
        uniform: true,
        maxLength: 20,
      });
      for (const a of uniform.arrows()) {
        close(length(a), 20, 1e-9);
      }
      const single = { xRange: [0, 0, 1], yRange: [0, 0, 1], maxLength: 10 } as const;
      const tail = new VectorField(plane, () => [1, 0], { ...single, pivot: 'tail' });
      const [t] = tail.arrows();
      close(t?.tail.x ?? NaN, 0, 1e-12);
      close(t?.tip.x ?? NaN, 10, 1e-12);
      const middle = new VectorField(plane, () => [1, 0], single);
      const [m] = middle.arrows();
      close(m?.tail.x ?? NaN, -5, 1e-12);
      close(m?.tip.x ?? NaN, 5, 1e-12);
    },
  ],
  [
    '方向按坐标系换算:横纵比例不同时箭头方向跟图一致(y 向上)',
    () => {
      // 1 个 x 单位 = 200,1 个 y 单位 = 100。
      const axes = new Axes([0, 1], [0, 1], 200, 100);
      const field = new VectorField(axes, () => [1, 1], {
        xRange: [0.5, 0.5, 1],
        yRange: [0.5, 0.5, 1],
        maxLength: 10,
      });
      const [a] = field.arrows();
      const dx = (a?.tip.x ?? 0) - (a?.tail.x ?? 0);
      const dy = (a?.tip.y ?? 0) - (a?.tail.y ?? 0);
      close(dy / dx, -0.5, 1e-12);
      ok(dx > 0);
    },
  ],
  [
    '无定义与零向量不画;setFunction 重新取样',
    () => {
      const plane = new NumberPlane([-1, 1], [-1, 1], 100, 100);
      const field = new VectorField(plane, (x) => (x < 0 ? [NaN, 0] : [0, 0]), {
        xRange: [-1, 1, 1],
        yRange: [-1, 1, 1],
      });
      equal(field.count, 0);
      equal(field.toPath().subpaths.length, 0);
      field.setFunction(() => [0, 1]);
      equal(field.count, 9);
      ok(field.toPath().subpaths.length > 0);
    },
  ],
  [
    '按模长着色:16 档颜色各一层杆、一层头,从小到大渐变;不着色时只有两层',
    () => {
      const plane = new NumberPlane([-2, 2], [-2, 2], 200, 200);
      const plain = new VectorField(plane, (x, y) => [x, y]);
      const style = plain.getStyle(lightTheme);
      const layers = plain.pathLayers(style);
      equal(layers.length, 2);
      equal(layers[0]?.paint.stroke, style.stroke);
      equal(layers[1]?.paint.fill, style.stroke);
      const colored = new VectorField(plane, (x, y) => [x, y], { colors: ['#0000ff', '#ff0000'] });
      const cl = colored.pathLayers(colored.getStyle(lightTheme));
      equal(cl.length, 32);
      equal(cl[0]?.paint.stroke, '#0000ff');
      equal(cl[31]?.paint.fill, '#ff0000');
      // 模长最大的四个角落进最后一档;最小的非零模长(0.5 / 2√2 × 15 ≈ 2.65)落在第 3 档,前几档是空的。
      equal(cl[31]?.path.subpaths.length, 4);
      equal(cl[1]?.path.subpaths.length, 0);
      ok((cl[7]?.path.subpaths.length ?? 0) > 0);
      // 几何是缓存的:再取一次还是同一批路径对象(每帧不重建)。
      equal(colored.pathLayers(colored.getStyle(lightTheme))[5]?.path, cl[5]?.path);
    },
  ],
  [
    '缺省取样步长自动取整;参数校验',
    () => {
      const plane = new NumberPlane([-6, 6], [-3, 3], 240, 120);
      // max(12, 6) / 12 = 1 → 步长 1:13 × 7 个取样点(原点为零向量)。
      const field = new VectorField(plane, (x, y) => [x, y]);
      equal(field.count, 13 * 7 - 1);
      // 从区间起点按步长取:[0.5, 3.5, 1] 取到格子中心 0.5、1.5、2.5、3.5。
      const centered = new VectorField(plane, () => [1, 0], {
        xRange: [0.5, 3.5, 1],
        yRange: [0, 0, 1],
        pivot: 'tail',
      });
      equal(
        centered.arrows().map((a) => plane.p2c(a.tail).x.toFixed(6)).join(','),
        '0.500000,1.500000,2.500000,3.500000',
      );
      throws(() => new VectorField(plane, () => [1, 0], { xRange: [-6, 6, 0.001] }));
      throws(() => new VectorField(plane, () => [1, 0], { maxLength: 0 }));
      throws(() => new VectorField(plane, () => [1, 0], { pivot: 'head' as never }));
      throws(() => new VectorField(plane, () => [1, 0], { xRange: [2, 1, 1] }));
      throws(() => new VectorField(plane, () => [1, 0], { xRange: [0, NaN, 1] }));
      throws(() => new VectorField(plane, () => [1, 0], { yRange: [0, 1, -1] }));
    },
  ],
  [
    '能用于 Create(箭头同时从零长出来)、Write 与 Transform',
    () => {
      const plane = new NumberPlane([-2, 2], [-2, 2], 200, 200);
      const field = new VectorField(plane, () => [1, 0], {
        xRange: [0, 0, 1],
        yRange: [0, 0, 1],
        pivot: 'tail',
        maxLength: 40,
      });
      const create = new Create(field);
      create.begin();
      create.interpolate(0.5);
      const { calls, ctx } = fakeCtx();
      field.render(ctx, lightTheme);
      const xs = calls
        .filter((c) => c.op === 'moveTo' || c.op === 'lineTo' || c.op === 'bezierCurveTo')
        .flatMap((c) => c.args.filter((_, i) => i % 2 === 0));
      close(Math.max(...xs), 20, 1e-9);
      create.finish();
      const write = new Write(field);
      write.begin();
      write.interpolate(0.5);
      ok((field.getMorphOverlay()?.layers.length ?? 0) > 0);
      write.finish();
      const other = new VectorField(plane, () => [0, 1], { xRange: [0, 0, 1], yRange: [0, 0, 1] });
      const t = new Transform(field, other);
      t.begin();
      t.interpolate(0.5);
      equal(field.getMorphOverlay()?.layers.length, 2);
      t.finish();
    },
  ],
]);
