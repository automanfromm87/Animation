import type { FilmErrorCode } from './types';

/** 自动选容器时的候选顺序:mp4 优先(播放器兼容性最好),缺席退 webm。 */
const AUTO_MIME_CANDIDATES = [
  'video/mp4',
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8',
  'video/webm',
] as const;

/**
 * 带配音时的候选:WebM 显式写上 Opus —— 只写视频编码的类型串遇上带音轨的流,
 * 有的浏览器会拒绝或丢掉声音。mp4 让浏览器自己配音频编码。
 */
const AUTO_MIME_CANDIDATES_WITH_AUDIO = [
  'video/mp4',
  'video/webm;codecs=vp9,opus',
  'video/webm;codecs=vp8,opus',
  'video/webm',
] as const;

/**
 * 选容器。显式指定而浏览器不支持时返回错误码,而不是悄悄换格式 ——
 * 用户在界面上选了 WebM,拿到的却是 MP4,这种意外比明确失败更糟。
 * isTypeSupported 抛错按「不支持」处理。
 */
export function pickMimeType(
  want: string | undefined,
  isTypeSupported: (type: string) => boolean,
  options?: { readonly audio?: boolean },
): { mimeType: string; error: FilmErrorCode | null } {
  const supported = (t: string): boolean => {
    try {
      return isTypeSupported(t);
    } catch {
      return false;
    }
  };
  if (want !== undefined && want !== '') {
    return supported(want)
      ? { mimeType: want, error: null }
      : { mimeType: '', error: 'unsupported-mime' };
  }
  for (const c of options?.audio ? AUTO_MIME_CANDIDATES_WITH_AUDIO : AUTO_MIME_CANDIDATES) {
    if (supported(c)) {
      return { mimeType: c, error: null };
    }
  }
  return { mimeType: '', error: 'unsupported' };
}

/** 默认导出长边(像素)。 */
export const DEFAULT_MAX_LONG_EDGE = 1920;

/**
 * 导出画幅:按长边上限等比缩小(不放大),再取偶数 ——
 * H.264 编码器要求偶数分辨率,奇数会直接 onerror。
 */
export function exportSize(
  backingWidth: number,
  backingHeight: number,
  maxLongEdge: number = DEFAULT_MAX_LONG_EDGE,
): { width: number; height: number } {
  const bw = backingWidth > 0 ? backingWidth : 1280;
  const bh = backingHeight > 0 ? backingHeight : 720;
  const cap = Number.isFinite(maxLongEdge) ? Math.max(320, maxLongEdge) : DEFAULT_MAX_LONG_EDGE;
  const k = Math.min(1, cap / Math.max(bw, bh));
  const even = (v: number): number => Math.max(2, Math.round(v / 2) * 2);
  return { width: even(bw * k), height: even(bh * k) };
}

export interface MainRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * 主画面在导出帧里的 contain 矩形 + 「css 像素 -> 导出像素」比例。
 * 每帧按当前 backing 尺寸重算:中途改画幅只会加黑边,不会被拉伸变形。
 * cssWidth 必须由调用方缓存传入 —— 在合成热路径里读 clientWidth 会强制同步布局。
 */
export function exportGeometry(
  sourceWidth: number,
  sourceHeight: number,
  cssWidth: number,
  exportWidth: number,
  exportHeight: number,
): { rect: MainRect; scale: number } {
  const sw = sourceWidth || 1;
  const sh = sourceHeight || 1;
  const k = Math.min(exportWidth / sw, exportHeight / sh);
  const w = Math.max(1, Math.round(sw * k));
  const h = Math.max(1, Math.round(sh * k));
  const css = cssWidth > 0 ? cssWidth : sw;
  return {
    rect: {
      x: Math.round((exportWidth - w) / 2),
      y: Math.round((exportHeight - h) / 2),
      w,
      h,
    },
    scale: w / Math.max(1, css),
  };
}

/** 少于这个帧数就认定合成端没出帧。 */
export const MIN_EXPORT_FRAMES = 10;
/**
 * 「编码器几乎没收到帧」的字节下限:一个关键帧的余量 + 每秒 1 KB。
 * VBR 编码器对静止画面几乎不出数据,门槛不能按码率算,否则低动态的正常成片会被误杀;
 * 但真正断供时(比如画布被污染,整片只有开头一帧)成片只有几 KB,远低于这条线。
 */
export const MIN_OUTPUT_BASE_BYTES = 16 * 1024;
export const MIN_OUTPUT_BYTES_PER_SECOND = 1024;

export interface OutputSample {
  frames: number;
  seconds: number;
  bytes: number;
}

/**
 * 收带校验。两种「空成片」分开报,因为病灶完全不在一处:
 * 合成端没画几帧(合成循环出了问题),或合成端正常而编码器几乎没收到东西(捕获/编码那一侧)。
 */
export function validateOutput(o: OutputSample): 'empty-output' | 'encoder-starved' | null {
  if (o.frames < MIN_EXPORT_FRAMES) {
    return 'empty-output';
  }
  const floor = MIN_OUTPUT_BASE_BYTES + o.seconds * MIN_OUTPUT_BYTES_PER_SECOND;
  if (o.seconds > 1 && o.bytes < floor) {
    return 'encoder-starved';
  }
  return null;
}

/** 失败消息里附带的链路统计,好把病灶落到合成端还是编码端。 */
export function outputStats(
  o: OutputSample & { mimeType: string; width: number; height: number; chunks: number },
): string {
  return (
    `mime=${o.mimeType},${o.width}x${o.height},` +
    `合成 ${o.frames} 帧 / 录制 ${o.seconds.toFixed(1)} 秒 / ` +
    `${o.chunks} 个数据块 / ${Math.round(o.bytes / 1024)} KB`
  );
}

/** 捕获帧率。captureStream 按它采样,合成再快也是白做。 */
export const CAPTURE_FPS = 30;
/**
 * 合成的最小间隔:比 1/30 秒略短一点,吸收 rAF 时间戳抖动。
 * 60Hz 屏每 2 帧合成一次,120Hz 每 4 帧,144Hz 每 5 帧 —— 都落在约 30fps。
 */
export const COMPOSITE_MIN_INTERVAL_MS = 1000 / CAPTURE_FPS - 1000 / 240;

/** 这一帧要不要合成(显示刷新率高于捕获帧率时跳过多余的合成)。 */
export function shouldComposite(now: number, lastCompositeAt: number): boolean {
  return !(now - lastCompositeAt < COMPOSITE_MIN_INTERVAL_MS);
}
