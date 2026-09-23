import type { Camera } from '../camera/Camera';
import type { Point, Size } from '../mobjects/types';

/** 行模式/页模式滚轮的一「格」折算成像素。 */
const LINE_PX = 16;
/** 每像素滚动量对应的缩放指数。 */
const WHEEL_ZOOM_RATE = 0.0015;
/** 键盘平移步长(css 像素)与每次缩放倍率。 */
const KEY_PAN_PX = 40;
const KEY_ZOOM_STEP = 1.2;

export interface PointerControllerHost {
  readonly camera: Camera;
  /** 视口的 css 尺寸。 */
  viewport(): Size;
  /** 相机被交互改动了,请求重绘。 */
  changed(): void;
}

/**
 * 无限画布交互:单指/鼠标拖拽平移,双指捏合缩放 + 平移,滚轮以指针为锚缩放;
 * 画布获得焦点时(宿主给它 tabIndex)方向键平移、+/- 以视口中心缩放 —— 键盘用户的等价操作。
 * 交互开启时画布设 touch-action:none,否则浏览器会把触摸手势当成页面滚动,
 * 拖几个像素就发 pointercancel。
 */
export class PointerController {
  private readonly canvas: HTMLCanvasElement;
  private readonly host: PointerControllerHost;
  private readonly pointers = new Map<number, Point>();
  private enabled = true;
  private readonly originalTouchAction: string;

  constructor(canvas: HTMLCanvasElement, host: PointerControllerHost) {
    this.canvas = canvas;
    this.host = host;
    this.originalTouchAction = canvas.style?.touchAction ?? '';
    canvas.addEventListener('pointerdown', this.onPointerDown);
    canvas.addEventListener('pointermove', this.onPointerMove);
    canvas.addEventListener('pointerup', this.onPointerUp);
    canvas.addEventListener('pointercancel', this.onPointerUp);
    canvas.addEventListener('lostpointercapture', this.onPointerUp);
    canvas.addEventListener('wheel', this.onWheel, { passive: false });
    canvas.addEventListener('keydown', this.onKeyDown);
    this.applyTouchAction();
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
    if (!enabled) {
      this.pointers.clear();
    }
    this.applyTouchAction();
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  dispose(): void {
    this.canvas.removeEventListener('pointerdown', this.onPointerDown);
    this.canvas.removeEventListener('pointermove', this.onPointerMove);
    this.canvas.removeEventListener('pointerup', this.onPointerUp);
    this.canvas.removeEventListener('pointercancel', this.onPointerUp);
    this.canvas.removeEventListener('lostpointercapture', this.onPointerUp);
    this.canvas.removeEventListener('wheel', this.onWheel);
    this.canvas.removeEventListener('keydown', this.onKeyDown);
    this.pointers.clear();
    if (this.canvas.style) {
      this.canvas.style.touchAction = this.originalTouchAction;
    }
  }

  private applyTouchAction(): void {
    if (this.canvas.style) {
      this.canvas.style.touchAction = this.enabled ? 'none' : this.originalTouchAction;
    }
  }

  private onPointerDown = (e: PointerEvent): void => {
    if (!this.enabled) {
      return;
    }
    if (e.pointerType === 'mouse' && e.button !== 0) {
      return;
    }
    this.pointers.set(e.pointerId, { x: e.offsetX, y: e.offsetY });
    try {
      this.canvas.setPointerCapture(e.pointerId);
    } catch {
      // 指针已失效时忽略:up/cancel/lostpointercapture 照常清理。
    }
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.enabled) {
      return;
    }
    const prev = this.pointers.get(e.pointerId);
    if (!prev) {
      return;
    }
    const cur = { x: e.offsetX, y: e.offsetY };
    const camera = this.host.camera;
    if (this.pointers.size === 1) {
      camera.panBy(cur.x - prev.x, cur.y - prev.y);
      this.host.changed();
    } else if (this.pointers.size === 2) {
      let other: Point | undefined;
      for (const [id, p] of this.pointers) {
        if (id !== e.pointerId) {
          other = p;
        }
      }
      if (other) {
        const prevDist = Math.hypot(prev.x - other.x, prev.y - other.y);
        const curDist = Math.hypot(cur.x - other.x, cur.y - other.y);
        const prevMid = { x: (prev.x + other.x) / 2, y: (prev.y + other.y) / 2 };
        const curMid = { x: (cur.x + other.x) / 2, y: (cur.y + other.y) / 2 };
        camera.panBy(curMid.x - prevMid.x, curMid.y - prevMid.y);
        if (prevDist > 0 && curDist > 0) {
          const { w, h } = this.host.viewport();
          camera.zoomAt(curMid.x, curMid.y, w, h, camera.zoom * (curDist / prevDist));
        }
        this.host.changed();
      }
    }
    // 三指及以上不做手势,但位置照样更新:否则抬起一指回到双指时,
    // 用的是陈旧的上一帧位置,平移缩放会猛跳一下。
    this.pointers.set(e.pointerId, cur);
  };

  private onPointerUp = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    try {
      if (this.canvas.hasPointerCapture(e.pointerId)) {
        this.canvas.releasePointerCapture(e.pointerId);
      }
    } catch {
      // 指针已失效,忽略。
    }
  };

  private onWheel = (e: WheelEvent): void => {
    if (!this.enabled) {
      return;
    }
    e.preventDefault();
    const { w, h } = this.host.viewport();
    // deltaMode:0 像素、1 行、2 页。行模式(部分鼠标/Firefox)一格只有 ~3,不折算几乎不动。
    const unit = e.deltaMode === 1 ? LINE_PX : e.deltaMode === 2 ? h : 1;
    const camera = this.host.camera;
    camera.zoomAt(
      e.offsetX,
      e.offsetY,
      w,
      h,
      camera.zoom * Math.exp(-e.deltaY * unit * WHEEL_ZOOM_RATE),
    );
    this.host.changed();
  };

  private onKeyDown = (e: KeyboardEvent): void => {
    // 带修饰键的组合留给浏览器/系统(Ctrl+加号是页面缩放)。
    if (!this.enabled || e.ctrlKey || e.metaKey || e.altKey) {
      return;
    }
    const camera = this.host.camera;
    const { w, h } = this.host.viewport();
    switch (e.key) {
      case 'ArrowLeft':
        camera.panBy(KEY_PAN_PX, 0);
        break;
      case 'ArrowRight':
        camera.panBy(-KEY_PAN_PX, 0);
        break;
      case 'ArrowUp':
        camera.panBy(0, KEY_PAN_PX);
        break;
      case 'ArrowDown':
        camera.panBy(0, -KEY_PAN_PX);
        break;
      case '+':
      case '=':
        camera.zoomAt(w / 2, h / 2, w, h, camera.zoom * KEY_ZOOM_STEP);
        break;
      case '-':
      case '_':
        camera.zoomAt(w / 2, h / 2, w, h, camera.zoom / KEY_ZOOM_STEP);
        break;
      default:
        return;
    }
    e.preventDefault();
    this.host.changed();
  };
}
