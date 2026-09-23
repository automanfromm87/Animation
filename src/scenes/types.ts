import type { FrameClock, SafeArea, SceneViewport } from '../engine';
import type { ExportHandle, ExportOptions } from '../export/types';

/**
 * 宿主按当前画布尺寸算好、交给场景的上下文。App 直接挂载场景时不传;
 * 影片播放器把场景当分段播放时传(字幕安全区随字号变,帧时钟可由测试替换)。
 */
export interface SceneContext {
  /** 字幕安全区(屏幕像素)。场景应设到 Scene 上,内容自动避让。 */
  readonly safeArea?: SafeArea;
  /** 帧时钟。场景创建 Scene 时应传给 SceneOptions.clock,整部片子才走同一套时间。 */
  readonly clock?: FrameClock;
  /**
   * 固定视口(离线导出在离屏画布上渲染时传):场景创建 Scene 时应传给 SceneOptions.viewport,
   * 按给定的 css 尺寸排版、按给定像素比出图,而不是去读画布的 DOM 尺寸。
   */
  readonly viewport?: SceneViewport;
}

/**
 * App 挂载一个场景后拿到的统一句柄。
 * 四个入口(总览、勾股、两部影片)都返回它,App 才能一视同仁地
 * 接 ResizeObserver、暂停、导出,而不用给每个入口写一套分支。
 * 成员都是函数类型属性:App 会把它们取出来单独调用,实现方必须自己绑定好 this。
 */
export interface SceneHandle {
  /** 卸载并释放全部资源(事件监听、rAF)。 */
  readonly dispose: () => void;
  /**
   * 画布 CSS 尺寸变化后重设分辨率(必要时重取景)。
   * 带 context 时(影片播放器)先按新上下文更新安全区;App 直接挂载时不带。
   */
  readonly resize: (context?: SceneContext) => void;
  /** 暂停/恢复(自动播放的动画必须可暂停)。 */
  readonly setPaused?: (paused: boolean) => void;
  /** 有它就说明这个场景支持导出视频;App 挂载后据此决定是否显示导出按钮。 */
  readonly exportVideo?: (options?: ExportOptions) => ExportHandle;
}

/** 既能直接挂到 App、也能被影片播放器当成一个分段录制的场景句柄。 */
export interface RecordableSceneHandle extends SceneHandle {
  /** 已播时长(秒),与动画同一时钟。 */
  readonly getElapsed: () => number;
  readonly setPaused: (paused: boolean) => void;
}

/** 宿主(App)提供给场景的环境。 */
export interface SceneHooks {
  /** 场景内部改变了暂停状态(影片进度条上的空格键)时通知宿主,按钮状态才不会说反。 */
  onPausedChange(paused: boolean): void;
  /** 用户偏好减少动态效果(prefers-reduced-motion)。 */
  readonly reducedMotion: boolean;
}

/** 把场景挂到画布上。 */
export type SceneMount = (canvas: HTMLCanvasElement, hooks: SceneHooks) => SceneHandle;

/** 场景注册表的一项。 */
export interface SceneEntry {
  readonly title: string;
  /** 'film' 是自带进度条与暂停的叙事影片;'scene' 是演示场景。 */
  readonly kind: 'scene' | 'film';
  /** 画布支持手动平移缩放(指针与键盘)。 */
  readonly interactive: boolean;
  /** 懒加载场景模块并返回挂载函数:没打开的场景不进首屏包。 */
  readonly load: () => Promise<SceneMount>;
  /**
   * 单帧静态预览(只有影片有):把 seconds 处的帧画到画布上,不播放。
   * 句柄没有暂停/导出;resize 会重画同一帧(防抖)。
   */
  readonly preview?: (canvas: HTMLCanvasElement, seconds: number) => Promise<SceneHandle>;
}
