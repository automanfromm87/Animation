import { close, equal, suite } from '../../testing/harness';
import { boxFromPoints, boxFromSize, expandBox, lerp, lerpPoint } from './types';

export default suite('mobjects/types', [
  [
    '空点集返回零盒,不会产生 ±Infinity 尺寸',
    () => {
      const box = boxFromPoints([]);
      equal(box.size.w, 0);
      equal(box.size.h, 0);
      equal(box.center.x, 0);
      equal(box.center.y, 0);
    },
  ],
  [
    '含非有限坐标的点整点跳过(不会污染包围盒)',
    () => {
      const box = boxFromPoints([
        { x: 0, y: 0 },
        { x: NaN, y: 10 },
        { x: 10, y: Infinity },
        { x: 4, y: 4 },
      ]);
      equal(box.size.w, 4);
      equal(box.size.h, 4);
      equal(box.center.x, 2);
      equal(box.center.y, 2);
    },
  ],
  [
    '全是非有限点时退化成零盒',
    () => {
      const box = boxFromPoints([
        { x: NaN, y: NaN },
        { x: Infinity, y: 1 },
      ]);
      equal(box.size.w, 0);
      equal(box.size.h, 0);
    },
  ],
  [
    'expandBox 四周均匀外扩且中心不变',
    () => {
      const box = expandBox({ size: { w: 10, h: 6 }, center: { x: 3, y: -2 } }, 5);
      equal(box.size.w, 20);
      equal(box.size.h, 16);
      equal(box.center.x, 3);
      equal(box.center.y, -2);
    },
  ],
  [
    'boxFromSize 居中',
    () => {
      const box = boxFromSize(8, 4);
      equal(box.center.x, 0);
      equal(box.center.y, 0);
    },
  ],
  [
    'lerp / lerpPoint 端点精确',
    () => {
      equal(lerp(2, 8, 0), 2);
      equal(lerp(2, 8, 1), 8);
      close(lerp(2, 8, 0.25), 3.5);
      const p = lerpPoint({ x: 0, y: 0 }, { x: 4, y: -8 }, 0.5);
      equal(p.x, 2);
      equal(p.y, -4);
    },
  ],
]);
