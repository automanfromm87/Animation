import { close, equal, ok, suite } from '../../testing/harness';
import { Group } from './Group';
import { Label, Rectangle, Triangle } from './shapes';
import { worldBoundsInScene, worldBoundsOf } from './bounds';

export default suite('包围盒', [
  [
    'worldBoundsOf:应用自身的平移/缩放/旋转与盒中心偏移',
    () => {
      const r = new Rectangle(20, 10);
      r.moveTo({ x: 100, y: 50 });
      r.scale = 2;
      r.rotation = Math.PI / 2;
      const b = worldBoundsOf([r]);
      ok(b !== null);
      close(b?.minX ?? 0, 90, 1e-9);
      close(b?.maxX ?? 0, 110, 1e-9);
      close(b?.minY ?? 0, 30, 1e-9);
      close(b?.maxY ?? 0, 70, 1e-9);
      const tri = new Triangle(10);
      const tb = worldBoundsOf([tri]);
      // 三角形的盒中心在原点下方:上顶点 y=-10,底边 y=+5。
      close(tb?.minY ?? 0, -10, 1e-9);
      close(tb?.maxY ?? 0, 5, 1e-9);
      equal(worldBoundsOf([]), null);
    },
  ],
  [
    'worldBoundsInScene:组合全部祖先变换;不在场景里的对象按根对象处理',
    () => {
      const outer = new Group();
      outer.moveTo({ x: 1000, y: 0 });
      outer.scale = 2;
      const inner = new Group();
      inner.moveTo({ x: 10, y: 0 });
      inner.rotation = Math.PI / 2;
      const r = new Rectangle(4, 2);
      r.moveTo({ x: 5, y: 0 });
      inner.add(r);
      outer.add(inner);
      const b = worldBoundsInScene([outer], [r]);
      // r 在 inner 里 (5,0) → 转 90° 后 (0,5) → 加 inner 位置 (10,5) → ×2 + (1000,0) = (1020, 10)。
      close(((b?.minX ?? 0) + (b?.maxX ?? 0)) / 2, 1020, 1e-9);
      close(((b?.minY ?? 0) + (b?.maxY ?? 0)) / 2, 10, 1e-9);
      // 转 90° + 放大 2 倍:宽高互换并翻倍。
      close((b?.maxX ?? 0) - (b?.minX ?? 0), 4, 1e-9);
      close((b?.maxY ?? 0) - (b?.minY ?? 0), 8, 1e-9);
      const loose = new Rectangle(2, 2);
      loose.moveTo({ x: 7, y: 7 });
      const lb = worldBoundsInScene([outer], [loose]);
      close(lb?.minX ?? 0, 6, 1e-9);
    },
  ],
  [
    'worldBoundsInScene:文本沿途继承容器的字号来量尺寸',
    () => {
      const g = new Group().setStyle({ fontSize: 50 });
      const label = new Label('字');
      g.add(label);
      const b = worldBoundsInScene([g], [label], { fontSize: 10, fontFamily: 'serif' });
      close((b?.maxY ?? 0) - (b?.minY ?? 0), 50, 1e-9, '没有继承容器字号');
    },
  ],
]);
