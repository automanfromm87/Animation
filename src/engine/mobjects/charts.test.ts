import { close, equal, fakeCtx, ok, suite, throws } from '../../testing/harness';
import { Create } from '../animations/primitives';
import { linear } from '../animations/rateFunctions';
import { Transform } from '../animations/transform';
import { Write } from '../animations/write';
import { pathBounds } from '../path/path';
import { lightTheme } from '../theme/presets';
import { BarChart, BarChartTo } from './charts';
import type { MObject } from './MObject';
import type { Label } from './shapes';
import { Tex } from './tex';
import { boxBoundsInParent } from './types';

function box(m: MObject): { minX: number; minY: number; maxX: number; maxY: number } {
  const b = pathBounds(m.toPath() ?? { subpaths: [] });
  if (!b) {
    throw new Error('路径是空的');
  }
  return b;
}

function parentBox(m: MObject): { minX: number; minY: number; maxX: number; maxY: number } {
  return boxBoundsInParent(m.getBox(), m.position, m.scale, m.rotation);
}

export default suite('标注图元:柱状图', [
  [
    '柱高按数值范围映射,基线在 0 处;柱子等宽、居中在各自的格子里',
    () => {
      const chart = new BarChart([1, 2, 4], { width: 300, height: 200 });
      equal(chart.range.join(','), '0,4');
      const [a, b, c] = chart.bars.map((m) => box(m));
      close(a?.maxY ?? NaN, 100, 1e-9);
      close(a?.minY ?? NaN, 100 - 50, 1e-9);
      close(b?.minY ?? NaN, 100 - 100, 1e-9);
      close(c?.minY ?? NaN, -100, 1e-9);
      // 每格 100 宽,柱宽 60,居中在 -100、0、100。
      close(((a?.minX ?? 0) + (a?.maxX ?? 0)) / 2, -100, 1e-9);
      close((b?.maxX ?? 0) - (b?.minX ?? 0), 60, 1e-9);
      const base = box(chart.baseline);
      close(base.minY, 100, 1e-9);
      close(base.minX, -150, 1e-9);
      close(base.maxX, 150, 1e-9);
    },
  ],
  [
    '负值的柱子朝下;范围不含 0 时基线贴边;全为 0 时范围不退化',
    () => {
      const chart = new BarChart([2, -2], { width: 200, height: 200 });
      equal(chart.range.join(','), '-2,2');
      close(box(chart.baseline).minY, 0, 1e-9);
      const down = box(chart.bars[1] as MObject);
      close(down.minY, 0, 1e-9);
      close(down.maxY, 100, 1e-9);
      const lifted = new BarChart([5, 6], { range: [4, 8], height: 100 });
      close(box(lifted.baseline).minY, 50, 1e-9);
      close(box(lifted.bars[0] as MObject).minY, 50 - 25, 1e-9);
      const zeros = new BarChart([0, 0]);
      ok(zeros.range[1] > zeros.range[0]);
    },
  ],
  [
    '类别标签在图表下方居中对齐各自的柱子;数值标签在柱顶上方(负值在柱底下方)',
    () => {
      const chart = new BarChart([3, -1], {
        width: 200,
        height: 100,
        labels: ['甲', 'x^2'],
        labelKind: 'tex',
        showValues: true,
      });
      equal(chart.labels.length, 2);
      ok(chart.labels[1] instanceof Tex);
      const lb = parentBox(chart.labels[0] as MObject);
      close((lb.minX + lb.maxX) / 2, -50, 1e-9);
      close(lb.minY, 50 + 8, 1e-9);
      equal(chart.valueLabels.length, 2);
      equal(chart.valueLabels[0]?.text, '3');
      equal(chart.valueLabels[1]?.text, '−1');
      const up = parentBox(chart.valueLabels[0] as Label);
      close(up.maxY, box(chart.bars[0] as MObject).minY - 4, 1e-9);
      chart.valueLabels[0]?.moveTo({ x: 0, y: 999 });
      chart.onMeasurementsChanged();
      const replaced = parentBox(chart.valueLabels[0] as Label);
      close(replaced.maxY, box(chart.bars[0] as MObject).minY - 4, 1e-9);
      const down = parentBox(chart.valueLabels[1] as Label);
      close(down.minY, box(chart.bars[1] as MObject).maxY + 4, 1e-9);
      const custom = new BarChart([0.5], { showValues: (v) => `${v * 100}%` });
      equal(custom.valueLabels[0]?.text, '50%');
    },
  ],
  [
    'setValues 立即换数值;BarChartTo 补间,中途是插值,结束时精确等于目标',
    () => {
      const chart = new BarChart([1, 2], {
        width: 200,
        height: 200,
        range: [0, 4],
        showValues: true,
      });
      chart.setValues([4, 0]);
      close(box(chart.bars[0] as MObject).minY, -100, 1e-9);
      equal(chart.valueLabels[1]?.text, '0');
      throws(() => chart.setValues([1]));
      throws(() => chart.setValues([1, NaN]));
      const tween = new BarChartTo(chart, [2, 2], { rateFunc: linear });
      tween.begin();
      tween.interpolate(0.5);
      equal(chart.values.join(','), '3,1');
      equal(chart.valueLabels[0]?.text, '3');
      tween.finish();
      equal(chart.values.join(','), '2,2');
      close(box(chart.bars[1] as MObject).minY, 0, 1e-9);
      throws(() => new BarChartTo(chart, [1, 2, 3]));
    },
  ],
  [
    '参数校验',
    () => {
      throws(() => new BarChart([]));
      throws(() => new BarChart([1, Infinity]));
      throws(() => new BarChart([1], { barRatio: 0 }));
      throws(() => new BarChart([1], { barRatio: 1.5 }));
      throws(() => new BarChart([1], { range: [3, 1] }));
      throws(() => new BarChart([1], { width: -1 }));
      throws(() => new BarChart([1], { colors: [] }));
    },
  ],
  [
    '能用于 Create(柱子从基线长出来)、Write 与 Transform',
    () => {
      const chart = new BarChart([4], { width: 100, height: 200, labels: ['A'] });
      const create = new Create(chart);
      create.begin();
      create.interpolate(0.5);
      const { calls, ctx } = fakeCtx();
      (chart.bars[0] as MObject).render(ctx, lightTheme);
      const ys = calls
        .filter((c) => c.op === 'moveTo' || c.op === 'bezierCurveTo')
        .flatMap((c) => c.args.filter((_, i) => i % 2 === 1));
      close(Math.min(...ys), 0, 1e-9);
      create.finish();
      const write = new Write(chart);
      write.begin();
      write.interpolate(0.5);
      ok((chart.getMorphOverlay()?.layers.length ?? 0) > 0);
      write.finish();
      const t = new Transform(chart, new BarChart([1, 2], { width: 100, height: 200 }));
      t.begin();
      t.interpolate(0.5);
      ok((chart.getMorphOverlay()?.layers.length ?? 0) >= 2);
      t.finish();
    },
  ],
]);
