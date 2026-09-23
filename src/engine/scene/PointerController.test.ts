import { close, equal, ok, suite } from '../../testing/harness';
import { Camera } from '../camera/Camera';
import { PointerController } from './PointerController';

type Handler = (e: unknown) => void;

/** 能派发事件的假画布。 */
function fakeCanvas(): HTMLCanvasElement & {
  fire(type: string, e: Record<string, unknown>): { prevented: boolean };
  listeners: Map<string, Handler>;
} {
  const listeners = new Map<string, Handler>();
  const canvas = {
    style: {} as Record<string, string>,
    listeners,
    addEventListener: (type: string, fn: Handler) => listeners.set(type, fn),
    removeEventListener: (type: string) => listeners.delete(type),
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
    hasPointerCapture: () => false,
    fire(type: string, e: Record<string, unknown>) {
      const result = { prevented: false };
      listeners.get(type)?.({
        pointerType: 'touch',
        button: 0,
        deltaMode: 0,
        ...e,
        preventDefault: () => {
          result.prevented = true;
        },
      });
      return result;
    },
  };
  return canvas as unknown as HTMLCanvasElement & {
    fire(type: string, e: Record<string, unknown>): { prevented: boolean };
    listeners: Map<string, Handler>;
  };
}

function setup(): {
  canvas: ReturnType<typeof fakeCanvas>;
  camera: Camera;
  changes: () => number;
  pc: PointerController;
} {
  const canvas = fakeCanvas();
  const camera = new Camera();
  let changes = 0;
  const pc = new PointerController(canvas, {
    camera,
    viewport: () => ({ w: 800, h: 600 }),
    changed: () => {
      changes += 1;
    },
  });
  return { canvas, camera, changes: () => changes, pc };
}

const at = (pointerId: number, x: number, y: number): Record<string, unknown> => ({
  pointerId,
  offsetX: x,
  offsetY: y,
});

export default suite('指针交互', [
  [
    '单指拖拽平移相机',
    () => {
      const { canvas, camera, changes } = setup();
      canvas.fire('pointerdown', at(1, 100, 100));
      canvas.fire('pointermove', at(1, 130, 90));
      close(camera.x, -30, 1e-9);
      close(camera.y, 10, 1e-9);
      equal(changes(), 1);
    },
  ],
  [
    '双指张开放大,缩放锚在两指中点',
    () => {
      const { canvas, camera } = setup();
      canvas.fire('pointerdown', at(1, 300, 300));
      canvas.fire('pointerdown', at(2, 500, 300));
      canvas.fire('pointermove', at(2, 700, 300));
      close(camera.zoom, 2, 1e-9);
    },
  ],
  [
    '三指时移动的手指位置照样更新,抬起一指回到双指不跳',
    () => {
      const { canvas, camera } = setup();
      canvas.fire('pointerdown', at(1, 100, 100));
      canvas.fire('pointerdown', at(2, 200, 100));
      canvas.fire('pointerdown', at(3, 300, 100));
      canvas.fire('pointermove', at(2, 260, 100)); // 三指:不做手势
      const before = camera.getView();
      canvas.fire('pointerup', at(3, 300, 100));
      // 回到双指后原地不动的一次 move:距离与中点都没变,相机不能动。
      canvas.fire('pointermove', at(2, 260, 100));
      const after = camera.getView();
      close(after.zoom, before.zoom, 1e-9, '用了陈旧位置,缩放猛跳');
      close(after.x, before.x, 1e-9);
    },
  ],
  [
    'lostpointercapture 清掉残留指针:之后的单指拖拽不会被当成捏合',
    () => {
      const { canvas, camera } = setup();
      canvas.fire('pointerdown', at(1, 0, 0));
      canvas.fire('lostpointercapture', at(1, 0, 0));
      canvas.fire('pointerdown', at(2, 100, 100));
      canvas.fire('pointermove', at(2, 110, 100));
      close(camera.zoom, 1, 1e-9);
      close(camera.x, -10, 1e-9);
    },
  ],
  [
    '滚轮按 deltaMode 折算:行模式一格与约 16px 像素滚动等效',
    () => {
      const a = setup();
      a.canvas.fire('wheel', { offsetX: 400, offsetY: 300, deltaY: -48, deltaMode: 0 });
      const b = setup();
      const r = b.canvas.fire('wheel', { offsetX: 400, offsetY: 300, deltaY: -3, deltaMode: 1 });
      close(b.camera.zoom, a.camera.zoom, 1e-9);
      ok(r.prevented, '滚轮应阻止页面滚动');
      ok(b.camera.zoom > 1);
    },
  ],
  [
    '键盘:方向键平移、加减号以视口中心缩放,带修饰键不拦截',
    () => {
      const { canvas, camera } = setup();
      const left = canvas.fire('keydown', { key: 'ArrowLeft' });
      ok(left.prevented);
      close(camera.x, -40, 1e-9);
      canvas.fire('keydown', { key: '+' });
      close(camera.zoom, 1.2, 1e-9);
      const ctrl = canvas.fire('keydown', { key: '+', ctrlKey: true });
      ok(!ctrl.prevented, 'Ctrl+加号是浏览器缩放,不能拦');
      close(camera.zoom, 1.2, 1e-9);
      canvas.fire('keydown', { key: 'a' });
      close(camera.zoom, 1.2, 1e-9);
    },
  ],
  [
    '关闭交互:忽略输入并交还 touch-action;dispose 摘掉全部监听',
    () => {
      const { canvas, camera, pc } = setup();
      equal(canvas.style.touchAction, 'none');
      pc.setEnabled(false);
      equal(canvas.style.touchAction, '');
      canvas.fire('pointerdown', at(1, 0, 0));
      canvas.fire('pointermove', at(1, 50, 0));
      canvas.fire('keydown', { key: 'ArrowLeft' });
      close(camera.x, 0, 1e-9);
      pc.dispose();
      equal(canvas.listeners.size, 0);
    },
  ],
]);
