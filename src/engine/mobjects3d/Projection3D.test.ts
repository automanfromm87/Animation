import { close, equal, ok, suite } from '../../testing/harness';
import { Projection3D } from './Projection3D';
import { Cube } from './solids';

export default suite('Projection3D', [
  [
    '非有限值被忽略,保留旧值(共享状态被写坏会让整组立体消失)',
    () => {
      const p = new Projection3D();
      p.rotX = NaN;
      close(p.rotX, -0.45, 1e-12);
      p.rotY = Infinity;
      close(p.rotY, 0.6, 1e-12);
      p.viewDistance = NaN;
      equal(p.viewDistance, 700);
      p.nearRatio = NaN;
      close(p.nearRatio, 0.2, 1e-12);
      equal(new Projection3D({ nearRatio: NaN }).nearRatio, 0.2);
    },
  ],
  [
    'viewDistance 至少为 1,nearRatio 钳在 [0.01, 1]',
    () => {
      const p = new Projection3D();
      p.viewDistance = -5;
      equal(p.viewDistance, 1);
      p.nearRatio = 0;
      close(p.nearRatio, 0.01, 1e-12);
      p.nearRatio = 5;
      equal(p.nearRatio, 1);
    },
  ],
  [
    '写坏共享视角不会让立体凭空消失',
    () => {
      const p = new Projection3D();
      const cube = new Cube(1400).setProjection(p);
      p.nearRatio = NaN;
      p.viewDistance = 0;
      const box = cube.getBox();
      ok(Number.isFinite(box.size.w) && box.size.w > 0, `包围盒坏了:${box.size.w}`);
      ok(
        Number.isFinite(cube.getCullRadius()) && cube.getCullRadius() > 0,
        '剔除半径坏了',
      );
    },
  ],
]);
