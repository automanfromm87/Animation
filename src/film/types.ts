import type { LiveAudioEnv } from '../audio/live';
import type { FrameClock } from '../engine';
import type { OfflineEnv } from '../export/offlineEnv';
import type { RecorderEnv } from '../export/recorder';
import type { ExportHandle, ExportOptions } from '../export/types';
import type { RecordableSceneHandle, SceneContext } from '../scenes/types';

/**
 * 分段句柄 = 可录制的场景句柄 + done。场景(scenes/)返回的句柄补上 done 就能直接当分段用。
 * - dispose:提前终止并清理。播放器保证每个句柄恰好调用一次;dispose 后 done 未必 resolve,播放器用 race 兜底。
 * - resize(context):context 是按新尺寸重算的上下文(字幕安全区随字号变),句柄应据此更新安全区。
 * - getElapsed:本段已播时长(秒),与分段内部动画同一时钟。字幕与进度条都跟它走,后台停帧时三者一起停。
 * - setPaused:暂停/恢复本段时间线(自动播放的动画必须可暂停,WCAG 2.2.2)。
 */
export interface SegmentHandle extends Omit<RecordableSceneHandle, 'exportVideo'> {
  /** 分段播完 resolve;出错 reject(播放器记录后切到下一段)。 */
  readonly done: Promise<void>;
  /**
   * 干跑开关(可选):打开后时间线照常推进,只跳过栅格化。
   * 单帧预览 / 段内跳转快进时用;没有它也能快进,只是每步都画、慢一些。
   */
  readonly setDryRun?: (dry: boolean) => void;
  /** 立刻重画当前状态(帧泵空闲时直接画,不经过时钟)。快进收尾补最后一画用。 */
  readonly render?: () => void;
}

/** 单条字幕。时间相对分段开始(秒),[start, end) 左闭右开,不要重叠。 */
export interface Subtitle {
  start: number;
  end: number;
  text: string;
  /** 台词 id(配音按它对号入座);普通分段不写时按「分段id/序号」。 */
  id?: string;
}

/** 本段要播的一段音频(时间相对本段开头,秒)。 */
export interface VoiceClip {
  /** 唯一标识(诊断、重排时认出同一段)。 */
  readonly id: string;
  /** 解析好的地址。 */
  readonly url: string;
  /** 从本段第几秒开始播。 */
  readonly start: number;
  /** 最多播多久(文件先放完就先结束)。 */
  readonly duration: number;
  /** 从文件的第几秒开始读(一个长文件管好几段时用)。 */
  readonly offset: number;
}

/** 分段的配音:prepareVoice 按时间表挂上。 */
export interface SegmentVoice {
  readonly clips: readonly VoiceClip[];
}

/** 播放器传给分段的上下文(与场景上下文是同一个契约)。 */
export type SegmentContext = SceneContext;

export interface Segment {
  readonly name: string;
  /**
   * 稳定 id(配音时间表按它对号入座),和显示名分开 —— 改名不影响配音。
   * 不写时配音按分段名对应。
   */
  readonly id?: string;
  /**
   * 分段时长(秒)。它不只是估算:进度条刻度、点击跳转的定位、字幕与进度的时钟钳位
   * 都以它为准,所以必须与分段实际的时间线一致(内容测试会逐段校验)。
   */
  readonly duration: number;
  /** 分段字幕(相对时间),缺省无字幕。 */
  readonly subtitles?: Subtitle[];
  /** 进度条刻度:章节卡标 'chapter'(大刻度),缺省普通小刻度。 */
  readonly marker?: 'chapter' | 'segment';
  /** 章节短标题(如 '求导法则'),有则在进度条上标出章名。 */
  readonly chapter?: string;
  /** 配音(prepareVoice 挂上):播放时按段内时刻出声,导出时混进音轨。 */
  readonly voice?: SegmentVoice;
  play(canvas: HTMLCanvasElement, context?: SegmentContext): SegmentHandle;
}

/** 播放器的声音选项。 */
export interface FilmAudioOptions {
  /** 播放环境(音频上下文、取文件、页面可见性),缺省浏览器实现。测试注入。 */
  env?: LiveAudioEnv;
}

export interface SubtitleStyle {
  /** 字号(px),缺省随画布宽度在 14~20 之间取。 */
  fontSize?: number;
  /** 字体,缺省继承页面字体。 */
  fontFamily?: string;
  /** 文字颜色,默认白色。 */
  color?: string;
  /** 底板颜色,默认半透明黑。 */
  background?: string;
  /**
   * 字幕块底边距画面底边的距离(px)。
   * 缺省随画布宽度在 24~36 之间取,并且至少比底部进度条占块高 10px(有章名时约 48)。
   */
  bottom?: number;
}

export interface ProgressStyle {
  /** 高度 px,默认 3。 */
  height?: number;
  /** 填充色,默认墨色。 */
  color?: string;
  /** 轨道色,默认淡灰。 */
  background?: string;
  /** 贴顶还是贴底,默认 'bottom'。贴顶时字幕不再为进度条让位。 */
  position?: 'top' | 'bottom';
}

/** 播放器报告的分段错误发生在哪个阶段。 */
export type SegmentErrorPhase = 'start' | 'play';

export interface FilmOptions {
  /** 转场单边时长(秒),默认 0.6。段之间:淡出旧段 -> 切段 -> 淡入新段。 */
  transition?: number;
  /** 转场颜色,默认跟主题背景(浅色闪白)。 */
  transitionColor?: string;
  /** 整片循环,默认 true。 */
  loop?: boolean;
  /** 分段开始回调(章节挂钩)。回调抛错只记日志,不影响播放。 */
  onSegment?: (index: number, segment: Segment) => void;
  /** 显示字幕,默认 true(有字幕的分段才显示)。 */
  subtitles?: boolean;
  subtitleStyle?: SubtitleStyle;
  /** 显示底部进度条,默认 true。 */
  progress?: boolean;
  progressStyle?: ProgressStyle;
  /**
   * 暂停状态变化回调。
   * 播放器自己也有暂停入口(进度条上的空格键),宿主的按钮靠它保持同步,
   * 否则按钮文案与 aria 状态会和实际播放状态说反。
   */
  onPausedChange?: (paused: boolean) => void;
  /** loop:false 时整片播完的回调。 */
  onEnded?: () => void;
  /**
   * 分段出错回调(起播抛错 / done reject)。不传时写 console.error。
   * 播放器总会跳过出错的分段继续播放。
   */
  onError?: (error: unknown, info: { segment: string; phase: SegmentErrorPhase }) => void;
  /**
   * 帧时钟(与 SceneOptions.clock 同一接口),缺省用浏览器的 rAF / performance.now。
   * 播放器自己的帧循环用它,并经 SegmentContext.clock 交给分段创建的 Scene —— 整部片子一套时间。
   */
  clock?: FrameClock;
  /** 录制器用到的浏览器能力(MediaRecorder、画布创建、页面可见性),缺省取全局。测试或非浏览器宿主注入用。 */
  exportEnv?: RecorderEnv;
  /**
   * 离线导出用到的能力(离屏画布、视频编码端、让出任务),缺省取浏览器实现(要有 WebCodecs)。
   * 测试注入假编码端,离线驱动的完整流程在 node 里也能跑。
   */
  offlineEnv?: OfflineEnv;
  /** 配音播放(分段挂了 voice 时才有声音;浏览器要用户点一下才允许出声,见 setAudioEnabled)。 */
  audio?: FilmAudioOptions;
}

/** 播放器状态快照。 */
export interface FilmState {
  mode: 'playing' | 'paused' | 'exporting' | 'ended' | 'disposed';
  /** 当前(或最后一个)分段序号。 */
  index: number;
  /** 当前分段名(分段之间为 null)。 */
  segment: string | null;
  /** 本段已播秒数(钳在 [0, duration])。 */
  segmentElapsed: number;
  /** 全片位置(秒)。 */
  position: number;
  /** 全片时长(秒)。 */
  total: number;
  paused: boolean;
  /** 有导出在进行(离线或实时)。离线导出不锁预览,mode 照常是 playing / paused。 */
  exporting: boolean;
  /** 配音:available 表示片子里有音频;enabled 表示正在出声(用户开过声音)。 */
  audio: { available: boolean; enabled: boolean };
}

/** 播放器控制器:可调用(= dispose,兼容旧写法),也带具名方法。 */
export interface FilmController {
  (): void;
  /** 停止播放并释放全部资源(DOM 覆盖层、监听、当前分段、进行中的导出)。 */
  dispose(): void;
  /** 跳到第 index 段(0 起),越界自动夹紧;非有限值忽略;实时录制期间忽略。 */
  seekTo(index: number): void;
  /** 跳到全片 seconds 处(秒),精确到段内;越界夹紧,非有限值忽略;实时录制期间忽略。 */
  seekToTime(seconds: number): void;
  /** 暂停/恢复播放。实时录制期间暂停请求被忽略(离线导出不占用预览,照常能停)。 */
  setPaused(paused: boolean): void;
  /**
   * 导出整部片子,字幕/转场合成进视频。缺省离线逐帧渲染(浏览器支持 WebCodecs 时),
   * 否则从头实时录制一遍;见 ExportOptions.mode。
   */
  exportVideo(options?: ExportOptions): ExportHandle;
  getState(): FilmState;
  /**
   * 开 / 关声音。浏览器的自动播放策略要求第一次开声音发生在用户操作(点击)里,
   * 所以请在按钮的点击回调里同步调用它。片子里没有音频时是空操作。
   */
  setAudioEnabled(enabled: boolean): void;
}
