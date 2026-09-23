import { close, equal, ok, suite } from '../../testing/harness';
import type { RateFunction } from './rateFunctions';
import {
  doubleSmooth,
  easeIn,
  easeInOut,
  easeOut,
  linear,
  rushFrom,
  rushInto,
  smooth,
  squish,
  thereAndBack,
  thereAndBackWithPause,
  wiggle,
} from './rateFunctions';

const ALL: Array<readonly [string, RateFunction]> = [
  ['linear', linear],
  ['smooth', smooth],
  ['easeIn', easeIn],
  ['easeOut', easeOut],
  ['easeInOut', easeInOut],
  ['rushInto', rushInto],
  ['rushFrom', rushFrom],
  ['doubleSmooth', doubleSmooth],
];

export default suite('rateFunctions', [
  [
    '端点精确:f(0)=0、f(1)=1(finish() 走 rateFunc(1),这条必须成立)',
    () => {
      for (const [name, f] of ALL) {
        close(f(0), 0, 1e-12, `${name}(0)`);
        close(f(1), 1, 1e-12, `${name}(1)`);
      }
    },
  ],
  [
    '[0,1] 上单调不减',
    () => {
      for (const [name, f] of ALL) {
        let prev = -Infinity;
        for (let i = 0; i <= 100; i++) {
          const v = f(i / 100);
          ok(v >= prev - 1e-12, `${name} 在 t=${i / 100} 处回退了`);
          prev = v;
        }
      }
    },
  ],
  [
    'smooth 关于 0.5 中心对称',
    () => {
      for (let i = 0; i <= 50; i++) {
        const t = i / 100;
        close(smooth(t) + smooth(1 - t), 1, 1e-12);
      }
    },
  ],
  [
    'thereAndBack:两端为 0、中点为 1,关于 0.5 对称',
    () => {
      equal(thereAndBack(0), 0);
      equal(thereAndBack(1), 0);
      equal(thereAndBack(0.5), 1);
      for (let i = 0; i <= 50; i++) {
        const t = i / 100;
        close(thereAndBack(t), thereAndBack(1 - t), 1e-12);
      }
      ok(thereAndBack(0.25) > 0 && thereAndBack(0.25) < 1);
    },
  ],
  [
    'thereAndBackWithPause:顶点停 pauseRatio 那么久,两端为 0',
    () => {
      const f = thereAndBackWithPause(0.5);
      equal(f(0), 0);
      equal(f(1), 0);
      // 上升段 [0, 0.25]、停顿段 [0.25, 0.75]、下降段 [0.75, 1]。
      close(f(0.125), 0.5, 1e-12, '上升段中点');
      equal(f(0.25), 1);
      equal(f(0.5), 1);
      equal(f(0.75), 1);
      close(f(0.875), 0.5, 1e-12, '下降段中点');
      const g = thereAndBackWithPause();
      equal(g(0.4), 1, '缺省停 1/3:0.4 在停顿段里');
      ok(g(0.2) < 1, '缺省停 1/3:0.2 还在上升');
    },
  ],
  [
    'wiggle:两端为 0、有正有负、振幅不超过 1',
    () => {
      equal(wiggle(0), 0);
      close(wiggle(1), 0, 1e-12);
      let pos = false;
      let neg = false;
      for (let i = 0; i <= 200; i++) {
        const v = wiggle(i / 200, 6);
        ok(Math.abs(v) <= 1 + 1e-12);
        pos ||= v > 0.1;
        neg ||= v < -0.1;
      }
      ok(pos && neg, '应当左右都摆到');
    },
  ],
  [
    'doubleSmooth 在中点停在 0.5;squish 把缓动压进一段时间',
    () => {
      equal(doubleSmooth(0.5), 0.5);
      const f = squish(linear, 0.2, 0.6);
      equal(f(0), 0);
      equal(f(0.2), 0);
      close(f(0.4), 0.5, 1e-12);
      equal(f(0.6), 1);
      equal(f(1), 1);
      const g = squish(smooth, 0.5, 0.5);
      equal(g(0.49), 0);
      equal(g(0.51), 1, '空区间:过了就是终点');
    },
  ],
]);
