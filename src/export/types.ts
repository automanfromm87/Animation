/**
 * 导出层的对外类型:选项、句柄、错误模型。
 * 不依赖 film / scenes / engine —— 宿主(App、场景句柄)只从这里拿类型,
 * 依赖方向才是 app → film → export,而不是 scenes ⇄ film 互相引用。
 */

/**
 * 导出方式。
 * - 'offline':离线逐帧渲染 + WebCodecs 编码。虚拟时钟按帧推进,时间戳精确,比实时快,
 *   切到后台也照样导出,不占用正在播放的预览。
 * - 'realtime':墙钟实时录制(captureStream + MediaRecorder)。页面必须保持在前台,全片要实时播完。
 * - 'auto'(缺省):浏览器能用 WebCodecs 编出所选容器就离线,否则退回实时录制。
 */
export type ExportMode = 'auto' | 'offline' | 'realtime';

/** 导出选项。 */
export interface ExportOptions {
  /** 导出方式,缺省 'auto'。 */
  mode?: ExportMode;
  /** 离线导出的帧率,缺省 30(实时录制固定按捕获帧率 30)。 */
  fps?: number;
  /**
   * 导出长边上限(像素,默认 1920),按画布 backing 等比缩小、不放大。
   * 竖屏(9:16)时限制的是高度 —— 只限宽度会在高清屏上导出 1188×2112 这类超出编码器档位的画幅。
   */
  maxLongEdge?: number;
  /** @deprecated 旧名,等同 maxLongEdge(横屏时两者含义一致)。 */
  maxWidth?: number;
  /**
   * 指定容器(如 'video/mp4')。浏览器不支持时直接失败(code 'unsupported-mime'),
   * 不再静默换成别的格式;缺省自动选(mp4 优先,缺席退 webm)。
   */
  mimeType?: string;
  /**
   * 导出进度回调:当前影片位置(秒)与全片时长(秒)。
   * 反映的是片内位置而不是墙钟,转场的淡入淡出不计入。回调抛错只记一次日志,不影响导出。
   */
  onProgress?: (filmSeconds: number, totalSeconds: number) => void;
  /** 成片带不带配音,缺省带(片子里有配音时)。 */
  audio?: boolean;
}

/** 导出句柄。 */
export interface ExportHandle {
  /** 导出完 resolve 视频 Blob(类型是实际编出来的格式);失败/取消 reject 一个 FilmError。 */
  readonly done: Promise<Blob>;
  /**
   * 请求的容器/编码(失败句柄为空串)。离线导出要等编码器探测完才知道具体编码,
   * 实际格式以成片 Blob 的 type 为准。
   */
  readonly mimeType: string;
  /** 实际走的导出方式。auto 模式下离线编码器探测失败会改走实时录制,这个值随之变化。 */
  readonly mode: 'offline' | 'realtime';
  /** 取消导出(播放继续)。收带窗口期内取消同样生效:done 会 reject 'cancelled'。 */
  cancel(): void;
}

/** 导出失败的原因码。宿主按 code 分支,不要匹配 message 文案。 */
export type FilmErrorCode =
  /** 用户取消。宿主通常静默处理。 */
  | 'cancelled'
  /** 播放器在导出途中被销毁。 */
  | 'disposed'
  /** 已经有一次导出在进行。 */
  | 'busy'
  /** 影片没有分段。 */
  | 'no-segments'
  /** 环境不支持录制(无 MediaRecorder / document,或没有任何可用容器)。 */
  | 'unsupported'
  /** 显式指定的容器浏览器不支持。 */
  | 'unsupported-mime'
  /** 导出画布 / 捕获流 / 编码器初始化失败。 */
  | 'init'
  /** 编码器报错(MediaRecorder onerror)。 */
  | 'recorder'
  /** 实时录制期间页面被切到后台(离线导出不受影响)。 */
  | 'hidden'
  /** 合成连续失败。 */
  | 'composite'
  /** 导出画布被跨源内容污染,浏览器停止送帧。 */
  | 'tainted'
  /** 捕获轨道 / 流已结束。 */
  | 'track-ended'
  /** 捕获轨道持续静音(不出帧)。 */
  | 'track-muted'
  /** 编码器自己停了。 */
  | 'recorder-stopped'
  /** 编码器长时间没交数据。 */
  | 'stalled'
  /** 收带后发现合成端几乎没出帧。 */
  | 'empty-output'
  /** 收带后发现编码器几乎没收到帧。 */
  | 'encoder-starved'
  /** 所有分段都启动失败。 */
  | 'segments-failed'
  /** 播放器驱动异常退出。 */
  | 'crashed'
  /** 离线导出的编码器初始化 / 编码 / 收尾失败。 */
  | 'encoder'
  /** 离线导出时影片远远超出声明的总时长还没播完(某段的时间线停不下来)。 */
  | 'overrun';

/** 导出(以及播放器驱动)失败时 reject 的错误。message 是给用户看的中文说明。 */
export class FilmError extends Error {
  readonly code: FilmErrorCode;
  /** 诊断细节(浏览器原始报错、链路快照等),给日志/排查用。 */
  readonly detail: string | undefined;

  constructor(code: FilmErrorCode, message: string, detail?: string) {
    super(message);
    this.name = 'FilmError';
    this.code = code;
    this.detail = detail;
  }
}

/** 类型守卫:给了 code 时还要求原因码一致。 */
export function isFilmError(e: unknown, code?: FilmErrorCode): e is FilmError {
  return e instanceof FilmError && (code === undefined || e.code === code);
}

/** 把任意抛出物收成一行诊断文本。 */
export function describeError(e: unknown): string {
  if (e instanceof Error) {
    return e.name && e.name !== 'Error' ? `${e.name}: ${e.message}` : e.message;
  }
  return String(e);
}
