import { close, equal, ok, suite } from '../../testing/harness';
import { linear, smooth } from '../animations/rateFunctions';
import { Camera } from './Camera';
import { CameraMove, createCameraFollow } from './cameraMoves';

export default suite('运镜', [
  [
    'CameraMove:缩放按对数补间(中点是几何平均),归一化缓动下终态逐位等于目标',
    () => {
      const cam = new Camera({ zoom: 1 });
      const move = new CameraMove(cam, { x: 100, zoom: 4 }, { rateFunc: linear });
      move.begin();
      move.interpolate(0.5);
      close(cam.zoom, 2, 1e-9);
      close(cam.x, 50, 1e-9);
      const exact = new CameraMove(cam, { x: 0.1 + 0.2, zoom: 3 }, { rateFunc: smooth });
      exact.begin();
      exact.finish();
      equal(cam.x, 0.1 + 0.2);
      equal(cam.zoom, 3);
    },
  ],
  [
    'CameraMove:非归一化缓动收尾时不跳变;目标缩放按相机区间钳制',
    () => {
      const cam = new Camera({ zoom: 1, maxZoom: 5 });
      const halfway = new CameraMove(cam, { x: 100 }, { rateFunc: (t) => t * 0.5 });
      halfway.begin();
      halfway.finish();
      close(cam.x, 50, 1e-9, '收尾应落在 rateFunc(1) 处而不是目标');
      const clamp = new CameraMove(cam, { zoom: 100 }, { rateFunc: linear });
      clamp.begin();
      clamp.finish();
      equal(cam.zoom, 5);
    },
  ],
  [
    'CameraMove:目标为函数时每帧重新求值,途中改了目标就落到新目标上',
    () => {
      const cam = new Camera();
      let targetX = 100;
      const move = new CameraMove(cam, () => ({ x: targetX }), { rateFunc: linear });
      move.begin();
      move.interpolate(0.5);
      close(cam.x, 50, 1e-9);
      targetX = 300;
      move.interpolate(0.5);
      close(cam.x, 150, 1e-9);
      move.finish();
      equal(cam.x, 300);
    },
  ],
  [
    '跟随:按阻尼收敛;dt=0 不动;centerOffset 把目标放到可用区中心',
    () => {
      const cam = new Camera();
      const target = { x: 100, y: 0 };
      const follow = createCameraFollow(cam, () => target, { damping: 4 });
      follow(null, 0);
      equal(cam.x, 0);
      for (let i = 0; i < 200; i++) {
        follow(null, 1 / 60);
      }
      close(cam.x, 100, 1e-3);
      const cam2 = new Camera({ zoom: 2 });
      const offset = createCameraFollow(cam2, () => ({ x: 0, y: 0 }), {
        damping: 1000,
        centerOffset: () => ({ x: 0, y: -50 }),
      });
      offset(null, 1);
      // 目标要出现在视口中心上方 50px:相机中心 = 目标 − 偏移/缩放 = +25。
      close(cam2.y, 25, 1e-6);
      ok(Number.isFinite(cam2.x));
    },
  ],
  [
    '跟随同时缓动缩放,目标缩放先钳进相机区间',
    () => {
      const cam = new Camera({ maxZoom: 3 });
      const follow = createCameraFollow(cam, () => ({ x: 0, y: 0 }), { damping: 1000, zoom: 10 });
      follow(null, 1);
      close(cam.zoom, 3, 1e-6);
    },
  ],
]);
