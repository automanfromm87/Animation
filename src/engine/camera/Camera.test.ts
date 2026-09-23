import { close, equal, ok, suite } from '../../testing/harness';
import { Camera } from './Camera';

const VW = 1280;
const VH = 720;

export default suite('Camera', [
  [
    'screenToWorld 与 worldToScreen 互逆',
    () => {
      const cam = new Camera({ x: 37, y: -12, zoom: 2.5 });
      for (const [sx, sy] of [
        [0, 0],
        [640, 360],
        [1279, 719],
      ] as const) {
        const w = cam.screenToWorld(sx, sy, VW, VH);
        const back = cam.worldToScreen(w.x, w.y, VW, VH);
        close(back.x, sx, 1e-9);
        close(back.y, sy, 1e-9);
      }
    },
  ],
  [
    'zoomAt 保持锚点下的世界点不动',
    () => {
      const cam = new Camera({ zoom: 1 });
      const before = cam.screenToWorld(300, 200, VW, VH);
      cam.zoomAt(300, 200, VW, VH, 3.7);
      const after = cam.screenToWorld(300, 200, VW, VH);
      close(after.x, before.x, 1e-9);
      close(after.y, before.y, 1e-9);
    },
  ],
  [
    'zoom 被钳进 [minZoom, maxZoom]',
    () => {
      const cam = new Camera({ minZoom: 0.5, maxZoom: 4 });
      cam.zoom = 100;
      equal(cam.zoom, 4);
      cam.zoom = 0.001;
      equal(cam.zoom, 0.5);
    },
  ],
  [
    '写入 0 / NaN 不会污染相机(panBy 之后仍然有限)',
    () => {
      const cam = new Camera();
      cam.zoom = 0;
      ok(cam.zoom > 0, 'zoom 必须保持正数');
      cam.zoom = NaN;
      ok(Number.isFinite(cam.zoom), 'NaN 应被忽略');
      cam.panBy(5, 5);
      ok(Number.isFinite(cam.x) && Number.isFinite(cam.y), '机位必须保持有限');
      cam.setView({ x: NaN, y: Infinity });
      ok(Number.isFinite(cam.x) && Number.isFinite(cam.y), '非有限值应被忽略');
    },
  ],
  [
    'computeFitBounds 框住矩形且不放大超过 maxZoom',
    () => {
      const cam = new Camera({ maxZoom: 10 });
      const view = cam.computeFitBounds(
        { minX: -100, minY: -50, maxX: 100, maxY: 50 },
        { w: VW, h: VH },
      );
      equal(view.x, 0);
      equal(view.y, 0);
      // 200x100 的内容进 1280x720:min(1280/200, 720/100) = 6.4,受宽度限制。
      close(view.zoom, 6.4, 1e-9);
    },
  ],
  [
    'computeFitBounds 收到非有限包围盒或 0 尺寸视口时整体回落到当前机位(缩放也不变)',
    () => {
      const cam = new Camera({ x: 5, y: 6, zoom: 2 });
      const nan = cam.computeFitBounds({ minX: NaN, minY: NaN, maxX: NaN, maxY: NaN }, { w: VW, h: VH });
      equal(nan.x, 5);
      equal(nan.y, 6);
      // 以前这里会跳到 maxZoom(10):一个 NaN 盒把镜头推到最大缩放。
      equal(nan.zoom, 2);
      const hidden = cam.computeFitBounds({ minX: 0, minY: 0, maxX: 10, maxY: 10 }, { w: 0, h: 0 });
      equal(hidden.zoom, 2);
    },
  ],
  [
    '构造选项消毒:NaN / Infinity / 非正的缩放区间回落到默认值,缩放始终有限',
    () => {
      for (const opts of [
        { minZoom: NaN },
        { maxZoom: NaN },
        { minZoom: Infinity },
        { maxZoom: Infinity },
        { minZoom: -1, maxZoom: 0 },
        { zoom: NaN, x: NaN, y: Infinity },
      ]) {
        const cam = new Camera(opts);
        ok(Number.isFinite(cam.zoom) && cam.zoom > 0, `zoom=${cam.zoom} for ${JSON.stringify(opts)}`);
        ok(Number.isFinite(cam.minZoom) && Number.isFinite(cam.maxZoom), JSON.stringify(opts));
        ok(cam.minZoom <= cam.maxZoom);
        const p = cam.worldToScreen(10, 10, VW, VH);
        ok(Number.isFinite(p.x) && Number.isFinite(p.y), '坐标换算出现非有限值');
      }
    },
  ],
  [
    'applyTo 支持目标原点偏移(按目标分辨率重渲染到别的画布)',
    () => {
      const cam = new Camera({ x: 10, y: 20, zoom: 2 });
      const calls: number[][] = [];
      const ctx = {
        setTransform: (...a: number[]) => {
          calls.push(a);
        },
      } as unknown as CanvasRenderingContext2D;
      cam.applyTo(ctx, 3, 100, 50, 7, 9);
      const [a, , , d, e, f] = calls[0] ?? [];
      equal(a, 6);
      equal(d, 6);
      // 世界点 (10, 20) 应落在目标上的视口中心:原点偏移 + 像素比 × 半视口。
      close((e ?? 0) + 10 * 6, 7 + 3 * 50, 1e-9);
      close((f ?? 0) + 20 * 6, 9 + 3 * 25, 1e-9);
    },
  ],
]);
