import { close, equal, ok, suite } from '../../testing/harness';
import { Axes } from '../mobjects/graphs';
import { Label, measureTextWidth } from '../mobjects/shapes';
import { axesTextBoxes } from './inspect';
import { estimateTextWidth, estimatedTextMetricsInstalled, installEstimatedTextMetrics } from './textMetrics';

export default suite('估算文字度量', [
  [
    'estimateTextWidth:中文 1em、其余 0.6em',
    () => {
      equal(estimateTextWidth('导数', 20), 40);
      equal(estimateTextWidth('ab', 10), 12);
      equal(estimateTextWidth('', 10), 0);
    },
  ],
  [
    '装上后 Label 按估算量宽,撤销后恢复原度量',
    () => {
      const l = new Label('中文').setStyle({ fontSize: 20 });
      const before = l.getBox().size.w;
      const original = Label.prototype.getBox;
      const undo = installEstimatedTextMetrics();
      try {
        equal(l.getBox().size.w, 40);
        equal(l.getBox().size.h, 20);
        equal(new Label('ab').getBox({ fontSize: 10, fontFamily: 'serif' }).size.w, 12, '没设字号时用上下文的');
        ok(estimatedTextMetricsInstalled());
      } finally {
        undo();
      }
      equal(Label.prototype.getBox, original, '不动 Label 的原型');
      equal(l.getBox().size.w, before);
      ok(!estimatedTextMetricsInstalled());
    },
  ],
  [
    '坐标轴的中文轴名也按估算量(取景用的 getBox 与检查用的文字框同一套)',
    () => {
      const axes = new Axes([0, 1], [0, 1], 100, 100, { y: '位移' });
      const nameWidth = (): number => {
        const name = axesTextBoxes(axes).find((p) => p.part === 'name:y');
        return name ? name.box.maxX - name.box.minX : NaN;
      };
      const before = nameWidth();
      const boxBefore = axes.getBox().size.w;
      close(before, measureTextWidth('位移', 13, 'serif') * 1.1, 1e-9);
      const undo = installEstimatedTextMetrics();
      try {
        equal(measureTextWidth('位移', 13, 'serif'), 26);
        close(nameWidth(), 26 * 1.1, 1e-9, '两个汉字 13 号 = 26 px(再乘轴名的 1.1)');
        ok(nameWidth() > before, '比 node 的 0.6em 兜底宽');
        ok(axes.getBox().size.w >= boxBefore, 'Axes.getBox 走同一套度量');
      } finally {
        undo();
      }
      close(nameWidth(), before, 1e-9);
    },
  ],
  [
    '嵌套安装只在最外层撤销时恢复;撤销函数调两次无副作用',
    () => {
      const plain = measureTextWidth('中', 10, 'serif');
      const outer = installEstimatedTextMetrics();
      const inner = installEstimatedTextMetrics();
      inner();
      inner();
      equal(measureTextWidth('中', 10, 'serif'), 10, '内层撤销(两次)后外层仍装着');
      ok(estimatedTextMetricsInstalled());
      outer();
      equal(measureTextWidth('中', 10, 'serif'), plain);
      outer();
      equal(measureTextWidth('中', 10, 'serif'), plain);
      ok(!estimatedTextMetricsInstalled());
    },
  ],
]);
