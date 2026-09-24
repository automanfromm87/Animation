import { close, equal, ok, suite, throws } from '../../testing/harness';
import { Projection3D } from '../mobjects3d/Projection3D';
import { Orbit3D, ViewTo } from './animations3d';
import { linear } from './rateFunctions';

export default suite('animations3d', [
  [
    'ViewTo:只动给出的键,其它视角参数不变;finish 精确落到目标',
    () => {
      const view = new Projection3D({ rotX: -0.4, rotY: 0.5, viewDistance: 700 });
      const tilt = new ViewTo(view, { rotX: -1.2 }, { rateFunc: linear });
      tilt.begin();
      tilt.interpolate(0.5);
      close(view.rotX, -0.8, 1e-12);
      equal(view.rotY, 0.5);
      equal(view.viewDistance, 700);
      tilt.finish();
      equal(view.rotX, -1.2);
      const zoom = new ViewTo(view, { viewDistance: 400, rotY: 2 });
      zoom.begin();
      zoom.finish();
      equal(view.viewDistance, 400);
      equal(view.rotY, 2);
      equal(view.rotX, -1.2);
    },
  ],
  [
    'ViewTo:azimuth / elevation 换算成 rotY / rotX(与 Projection3D 的数学视角一致)',
    () => {
      const view = Projection3D.math();
      const move = new ViewTo(view, { azimuth: 1.0, elevation: 0.2 });
      move.begin();
      move.finish();
      close(view.azimuth, 1.0, 1e-12);
      close(view.elevation, 0.2, 1e-12);
      close(view.rotY, -1.0 - Math.PI / 2, 1e-12);
      close(view.rotX, -0.2, 1e-12);
      // 起点在 begin 捕获:构造之后、播放之前视角变了,从新位置出发。
      const later = new ViewTo(view, { elevation: 0.6 }, { rateFunc: linear });
      view.elevation = 0;
      later.begin();
      later.interpolate(0.5);
      close(view.elevation, 0.3, 1e-12);
    },
  ],
  [
    'ViewTo:没有键、键冲突、非有限值都抛错',
    () => {
      const view = new Projection3D();
      throws(() => new ViewTo(view, {}));
      throws(() => new ViewTo(view, { rotY: 1, azimuth: 1 }));
      throws(() => new ViewTo(view, { rotX: 1, elevation: 1 }));
      throws(() => new ViewTo(view, { rotX: NaN }));
      throws(() => new ViewTo(view, { viewDistance: Infinity }));
    },
  ],
  [
    'ViewTo 的 azimuth 取最短路径:Orbit3D 转过整圈后回到课本视角不倒着转;rotY 照字面',
    () => {
      const view = Projection3D.math();
      const orbit = new Orbit3D(view, 1);
      orbit.begin();
      orbit.finish();
      close(view.azimuth, Math.PI / 6, 1e-9);
      const before = view.rotY;
      const back = new ViewTo(view, { azimuth: Math.PI / 6 }, { rateFunc: linear });
      back.begin();
      back.interpolate(0.5);
      close(view.rotY, before, 1e-9);
      back.finish();
      ok(Math.abs(view.rotY - before) <= Math.PI, `转了 ${view.rotY - before} 弧度`);
      close(view.azimuth, Math.PI / 6, 1e-9);
      // 跨过 ±π:方位 3 → −3 只转 2π − 6 ≈ 0.283,而不是倒转 6 弧度。
      view.azimuth = 3;
      const start = view.rotY;
      const cross = new ViewTo(view, { azimuth: -3 }, { rateFunc: linear });
      cross.begin();
      cross.finish();
      close(Math.abs(view.rotY - start), 2 * Math.PI - 6, 1e-9);
      close(view.azimuth, -3, 1e-9);
      // 两圈 Orbit3D 之后也一样。
      const twice = new Orbit3D(view, 2);
      twice.begin();
      twice.finish();
      const again = view.rotY;
      const home = new ViewTo(view, { azimuth: 1 });
      home.begin();
      home.finish();
      ok(Math.abs(view.rotY - again) <= Math.PI, `转了 ${view.rotY - again} 弧度`);
      close(view.azimuth, 1, 1e-9);
      // rotY 照字面线性补间:要整圈环绕就直接给 rotY。
      const spin = new ViewTo(view, { rotY: view.rotY + 4 * Math.PI });
      const from = view.rotY;
      spin.begin();
      spin.finish();
      close(view.rotY - from, 4 * Math.PI, 1e-9);
    },
  ],
]);
