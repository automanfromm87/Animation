import type { AnimationOptions } from '../animations/Animation';
import { BasePlayable } from '../animations/Animation';
import type { MObject } from '../mobjects/MObject';
import type { Point } from '../mobjects/types';
import { lerp } from '../mobjects/types';
import type { Camera, CameraView } from './Camera';

/**
 * 跟随 updater 的签名。
 * 刻意不从 scene 层 import SceneUpdater:camera 目录不依赖 scene 目录,
 * 依赖方向才真正是单向的。参数用 unknown,赋给 Scene.addUpdater(SceneUpdater) 时逆变兼容。
 */
export type CameraFollowUpdater = (scene: unknown, dt: number) => void;

/** 缩放用对数补间,推拉速度才均匀。alpha===1 时精确落到目标。 */
function zoomLerp(from: number, to: number, alpha: number): number {
  const safeFrom = Math.max(from, 1e-6);
  const safeTo = Math.max(to, 1e-6);
  if (alpha === 1) {
    return safeTo;
  }
  return safeFrom * Math.pow(safeTo / safeFrom, alpha);
}

/** 运镜目标:固定机位,或每帧求值的函数(视口变化时目标跟着变,比如按安全区重新取景)。 */
export type CameraTarget = Partial<CameraView> | (() => Partial<CameraView>);

/**
 * CameraMove:把相机平滑运镜到目标机位。
 * 位置线性补间、缩放对数补间;缺省字段保持播放开始时的值。
 * 目标是函数时每帧重新求值:运镜途中画布尺寸变了,落点跟着新取景走,不会停在旧机位上。
 * 用法: scene.play(new CameraMove(camera, { x: 100, zoom: 2 }, { runTime: 2 }))。
 */
export class CameraMove extends BasePlayable {
  private readonly camera: Camera;
  private readonly target: CameraTarget;
  private start: CameraView = { x: 0, y: 0, zoom: 1 };
  private resolved: CameraView = { x: 0, y: 0, zoom: 1 };

  constructor(camera: Camera, target: CameraTarget, options?: AnimationOptions) {
    super(options);
    this.camera = camera;
    this.target = typeof target === 'function' ? target : { ...target };
  }

  private resolveTarget(): CameraView {
    const t = typeof this.target === 'function' ? this.target() : this.target;
    return {
      x: t.x ?? this.start.x,
      y: t.y ?? this.start.y,
      zoom: this.camera.clampZoom(t.zoom ?? this.start.zoom),
    };
  }

  override begin(): void {
    this.start = this.camera.getView();
    this.resolved = this.resolveTarget();
  }

  interpolate(alpha: number): void {
    if (typeof this.target === 'function') {
      this.resolved = this.resolveTarget();
    }
    this.camera.setView({
      x: lerp(this.start.x, this.resolved.x, alpha),
      y: lerp(this.start.y, this.resolved.y, alpha),
      zoom: zoomLerp(this.start.zoom, this.resolved.zoom, alpha),
    });
  }

  override finish(): void {
    // 走一遍缓动而不是直接落终态:非归一化的自定义 rateFunc 才不会在最后一帧跳变。
    const alpha = this.rateFunc(1);
    this.interpolate(alpha);
    if (alpha === 1) {
      // 归一化缓动下终态必须逐位等于目标:取景逻辑会用等值判断识别「停在某个机位」。
      this.camera.setView(this.resolved);
    }
  }
}

/**
 * 跟随目标:一个**场景根对象**(用它的 position),或返回世界坐标的函数。
 * 嵌套在变换过的容器里的对象,position 是父级局部坐标 —— 这种情况请传函数。
 */
export type FollowTarget = MObject | (() => Point);

export interface CameraFollowOptions {
  /** 跟随阻尼(1/秒),越大越紧,默认 4。 */
  damping?: number;
  /** 跟随同时缓动到的缩放,缺省则保持当前缩放。 */
  zoom?: number;
  /**
   * 目标应落在的屏幕位置相对视口中心的偏移(css 像素)。
   * 有字幕安全区时传 scene.safeAreaCenterOffset,被跟随的对象才和取景镜头一样落在可用区中心。
   */
  centerOffset?: () => Point;
}

/**
 * createCameraFollow:返回一个 SceneUpdater,让相机平滑跟随目标。
 * 用法: const stop = scene.addUpdater(createCameraFollow(camera, mover));
 * 不再跟随时调用 stop()。
 */
export function createCameraFollow(
  camera: Camera,
  target: FollowTarget,
  options?: CameraFollowOptions,
): CameraFollowUpdater {
  const damping = Math.max(0, options?.damping ?? 4);
  const targetZoom =
    options?.zoom === undefined ? undefined : camera.clampZoom(options.zoom);
  const offsetOf = options?.centerOffset;
  return (_scene, dt): void => {
    const p = typeof target === 'function' ? target() : target.position;
    const k = 1 - Math.exp(-damping * dt);
    const zoom =
      targetZoom === undefined ? camera.zoom : zoomLerp(camera.zoom, targetZoom, k);
    const off = offsetOf?.();
    // 目标要出现在「视口中心 + 偏移」处:相机中心 = 目标 − 偏移 / 缩放。
    const tx = off ? p.x - off.x / zoom : p.x;
    const ty = off ? p.y - off.y / zoom : p.y;
    camera.setView({ x: lerp(camera.x, tx, k), y: lerp(camera.y, ty, k), zoom });
  };
}
