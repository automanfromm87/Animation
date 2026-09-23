import { close, equal, suite } from '../../testing/harness';
import { Camera } from '../camera/Camera';
import { NO_INSETS, computeFitView, safeAreaCenterOffset, sanitizeInset } from './framing';

const BOX = { minX: -100, minY: -50, maxX: 100, maxY: 50 };

export default suite('取景', [
  [
    '零安全区时等同直接框住',
    () => {
      const cam = new Camera();
      const v = computeFitView(cam, BOX, 0, { w: 400, h: 200 }, NO_INSETS);
      close(v.x, 0, 1e-9);
      close(v.y, 0, 1e-9);
      close(v.zoom, 2, 1e-9);
    },
  ],
  [
    '底部安全区:按可用区缩放,内容中心落到可用区中心',
    () => {
      const cam = new Camera();
      const safe = { top: 0, bottom: 100, left: 0, right: 0 };
      const v = computeFitView(cam, BOX, 0, { w: 400, h: 200 }, safe);
      // 可用区 400×100,缩放受高度限制 = 1;可用区中心在视口中心上方 50px。
      close(v.zoom, 1, 1e-9);
      close(v.y, 50, 1e-9);
      const off = safeAreaCenterOffset({ w: 400, h: 200 }, safe);
      close(off.y, -50, 1e-9);
      close(off.x, 0, 1e-9);
    },
  ],
  [
    '非有限包围盒或 0 尺寸视口:返回当前机位,不会越取景越漂',
    () => {
      const cam = new Camera({ x: 3, y: 4, zoom: 2 });
      const safe = { top: 0, bottom: 100, left: 0, right: 0 };
      const bad = { minX: Number.NaN, minY: 0, maxX: 1, maxY: 1 };
      for (let i = 0; i < 3; i++) {
        const v = computeFitView(cam, bad, 0, { w: 400, h: 200 }, safe);
        cam.setView(v);
      }
      equal(cam.y, 4);
      equal(cam.zoom, 2);
      const hidden = computeFitView(cam, BOX, 0, { w: 0, h: 0 }, NO_INSETS);
      equal(hidden.zoom, 2);
    },
  ],
  [
    '安全区数值消毒:NaN / 负数按 0',
    () => {
      equal(sanitizeInset(Number.NaN), 0);
      equal(sanitizeInset(-5), 0);
      equal(sanitizeInset(Infinity), 0);
      equal(sanitizeInset(12), 12);
    },
  ],
]);
