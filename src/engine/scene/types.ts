import type { AnimationOptions } from '../animations/Animation';
import type { Camera, CameraOptions } from '../camera/Camera';
import type { MeasureContext, Size } from '../mobjects/types';
import type { Theme } from '../theme/Theme';
import type { FrameClock } from './FramePump';

export interface SceneOptions {
  theme?: Theme;
  /** 相机初值与缩放区间。缺省为 Camera 的默认值(zoom 1,0.1~10)。 */
  camera?: CameraOptions;
  /** 帧时钟。缺省为 requestAnimationFrame + performance.now;测试与离线导出注入自己的时钟。 */
  clock?: FrameClock;
  /**
   * 固定视口(css 尺寸与像素比),给离屏渲染用(离线导出):不读画布的 DOM 尺寸,
   * 也不挂 ResizeObserver / 像素比监听;backing store = css 尺寸 × pixelRatio(缺省 1)。
   */
  viewport?: SceneViewport;
}

export interface SceneViewport {
  width: number;
  height: number;
  pixelRatio?: number;
}

export interface PlayFitOptions extends AnimationOptions {
  pad?: number;
}

/** 安全区(屏幕 css 像素)。fit/playFit 取景会把内容框进可用区,避开字幕条等遮挡。 */
export interface SafeArea {
  top?: number;
  bottom?: number;
  left?: number;
  right?: number;
}

/**
 * updater 能看到的场景视图。
 * 用结构化接口而不是 Scene 具体类,第三方 updater 不必依赖具体实现。
 */
export interface UpdaterScene {
  getCamera(): Camera;
  getViewportSize(): Size;
  getTheme(): Theme;
  measureContext(): MeasureContext;
  render(): void;
}

/**
 * SceneUpdater:play()/wait() 期间每帧调用一次,先于动画插值,可读写场景对象。
 * dt 与时间线同一步长(秒);切后台回来的超长帧按 0.5 秒封顶。
 */
export type SceneUpdater = (scene: UpdaterScene, dt: number) => void;
