import { close, equal, ok, suite } from '../../testing/harness';
import type { PathLayer } from './draw';
import { pathLength } from './measure';
import { PathBuilder } from './path';
import { defaultLagRatio, staggered, writeStep } from './write';

const square = new PathBuilder().rect(0, 0, 10, 10).build();

export default suite('逐字书写的节奏', [
  [
    'staggered:第一片从 0 开始,最后一片恰好在 alpha=1 写完;lag 为 0 时同时写',
    () => {
      const n = 7;
      const lag = 0.2;
      equal(staggered(0, 0, n, lag), 0);
      ok(staggered(0.01, 0, n, lag) > 0);
      equal(staggered(0.3, n - 1, n, lag), 0, '最后一片不该这么早开始');
      equal(staggered(1, n - 1, n, lag), 1, '终态必须精确为 1');
      ok(staggered(0.999, n - 1, n, lag) < 1);
      // 片长 1 / (1 + 6·0.2) ≈ 0.4545,第 i 片起点 i·0.2·片长。
      const span = 1 / (1 + (n - 1) * lag);
      close(staggered(span * lag * 3 + span / 2, 3, n, lag), 0.5, 1e-12);
      equal(staggered(0.5, 4, n, 0), 0.5, 'lag 为 0 时所有片同步');
      equal(staggered(Number.NaN, 0, n, lag), 0);
    },
  ],
  [
    'defaultLagRatio:片越多挨得越紧,最多 0.2',
    () => {
      equal(defaultLagRatio(1), 0.2);
      equal(defaultLagRatio(10), 0.2);
      equal(defaultLagRatio(40), 0.1);
    },
  ],
  [
    'writeStep:有填充的层前半程描轮廓(填充色、给定线宽),后半程填充淡入、轮廓淡出;u>=1 原样返回',
    () => {
      const glyph: PathLayer = {
        path: square,
        paint: { fill: '#ff0000', stroke: null, strokeWidth: 0 },
        outlineWidth: 0.5,
      };
      equal(writeStep(glyph, 0, 2), null);
      const early = writeStep(glyph, 0.25, 2);
      equal(early?.paint.fill, null);
      equal(early?.paint.stroke, '#ff0000');
      equal(early?.paint.strokeWidth, 0.5, '层给了 outlineWidth 就用它');
      close(pathLength(early?.path ?? square), 20, 1e-6, '前半程的 u=0.25 应描出一半周长');
      const late = writeStep(glyph, 0.75, 2);
      equal(late?.path, square);
      equal(late?.paint.fill, 'rgba(255, 0, 0, 0.5)');
      equal(late?.paint.stroke, 'rgba(255, 0, 0, 0.5)');
      ok(writeStep(glyph, 1, 2) === glyph, '写完必须就是原来的层');
      const noHint = writeStep({ path: square, paint: glyph.paint }, 0.25, 2);
      equal(noHint?.paint.strokeWidth, 2, '没给 outlineWidth 用调用方的线宽');
    },
  ],
  [
    'writeStep:只描边的层全程按弧长生长;原本就有描边的填充层,轮廓用自己的描边且不淡出',
    () => {
      const line: PathLayer = { path: square, paint: { fill: null, stroke: '#000000', strokeWidth: 3 } };
      close(pathLength(writeStep(line, 0.5, 1)?.path ?? square), 20, 1e-6);
      equal(writeStep(line, 0.5, 1)?.paint, line.paint);
      const invisible: PathLayer = { path: square, paint: { fill: null, stroke: null, strokeWidth: 0 } };
      equal(writeStep(invisible, 0.5, 1), null);
      const both: PathLayer = { path: square, paint: { fill: '#00ff00', stroke: '#000000', strokeWidth: 3 } };
      const early = writeStep(both, 0.2, 1);
      equal(early?.paint.stroke, '#000000');
      equal(early?.paint.strokeWidth, 3);
      const late = writeStep(both, 0.9, 1);
      equal(late?.paint.stroke, '#000000', '自己的描边不该淡出');
      equal(late?.paint.fill, 'rgba(0, 255, 0, 0.8)');
    },
  ],
]);
