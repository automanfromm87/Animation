import type { FilmErrorCode } from './types';

/** 看门狗检查间隔(毫秒,按时间而不是按帧数:60Hz 与 144Hz 屏的检测延迟才一致)。 */
export const WATCHDOG_INTERVAL_MS = 1000;
/**
 * 轨道静音要持续这么久才判失败。
 * Chrome 的帧监控在主线程卡顿约 0.8 秒后会把捕获轨道短暂置为 muted,
 * 下一次监控检查才解除 —— 单次采样撞上这个窗口不代表链路坏了。
 */
export const MUTED_GRACE_MS = 2000;
/** 来过数据之后,这么久没有新数据块就判编码器断供。 */
export const DATA_STALL_MS = 8000;

/** 编码链路健康快照(看门狗输入)。拿不到的字段填 null / 'unknown',不当成故障。 */
export interface RecorderHealth {
  mimeType: string;
  /** MediaRecorder.state,拿不到时为 'unknown'。 */
  recorderState: string;
  trackState: 'live' | 'ended' | 'unknown';
  /** 轨道已经连续静音的毫秒数;没静音为 0,拿不到为 null。 */
  mutedMs: number | null;
  /** MediaStream.active;拿不到为 null。 */
  streamActive: boolean | null;
  /** 导出画布是否被跨源污染;探不出来为 null。 */
  tainted: boolean | null;
  frames: number;
  chunkCount: number;
  /** 距上次收到数据的毫秒数;从没收到过为 null。 */
  msSinceData: number | null;
}

export interface StallDiagnosis {
  code: FilmErrorCode;
  message: string;
}

/**
 * 编码链路健康检查:返回 null 表示正常,否则返回失败原因。
 * captureStream / MediaRecorder 的静默断流(画布被污染、轨道结束、编码器自停、数据断供)
 * 都不抛错不报,只能靠轮询状态抓 —— 抓到就几秒内响亮失败,而不是录完才交出空文件。
 * 「从没收到过数据」不判失败:timeslice 首块本来就要等,MP4 分片更是按关键帧才出。
 */
export function diagnoseRecorderStall(h: RecorderHealth): StallDiagnosis | null {
  const diag =
    `mime=${h.mimeType},recorder=${h.recorderState},track=${h.trackState},` +
    `mutedMs=${h.mutedMs ?? 'n/a'},tainted=${h.tainted ?? 'n/a'},` +
    `合成${h.frames}帧,数据${h.chunkCount}块`;
  // 放最前:画布被污染后轨道照样 live、不静音,编码器也照样 recording,
  // 下面几条一条都抓不到 —— 只是再也没有帧送进编码器。
  if (h.tainted === true) {
    return {
      code: 'tainted',
      message: `导出中断:导出画布被跨源内容污染,浏览器已停止向编码器送帧(${diag})`,
    };
  }
  if (h.trackState === 'ended' || h.streamActive === false) {
    return { code: 'track-ended', message: `导出中断:视频捕获轨道已结束(${diag})` };
  }
  if (h.mutedMs !== null && h.mutedMs >= MUTED_GRACE_MS) {
    return { code: 'track-muted', message: `导出中断:视频捕获轨道持续静音(${diag})` };
  }
  if (h.recorderState === 'inactive') {
    return { code: 'recorder-stopped', message: `导出中断:编码器意外停止(${diag})` };
  }
  if (h.chunkCount > 0 && h.msSinceData !== null && h.msSinceData > DATA_STALL_MS) {
    return {
      code: 'stalled',
      message: `导出中断:编码器 ${DATA_STALL_MS / 1000} 秒没交数据(${diag})`,
    };
  }
  return null;
}

/**
 * 画布是否已被跨源内容污染(origin-clean 被清掉)。
 * 被污染的 canvas 上 captureStream 会静默停止出帧:轨道照样 live、不静音、不报错,
 * 编码器只收到开头那一帧 —— 除了主动探测没有任何信号。
 *
 * 不直接对源画布 getImageData:Chrome 对加速画布读回两次就会把它降成 CPU 渲染,
 * 而导出画布每帧都要 drawImage 一张高分辨率主画布。改为把源的一个像素画进 1x1 探针再读探针:
 * 污染随 drawImage 传播,getImageData 只落在探针上。注意把 GPU 画布画进 CPU 探针本身
 * 仍可能触发一次整纹理读回(毫秒级),所以只按看门狗节奏每秒探一次。
 *
 * probe 可复用:干净时反复用同一张;一旦被污染它也永远脏了,但那时导出已经失败。
 * 返回 null 表示探不出来(没有 DOM、拿不到上下文、或抛的不是安全错误)。
 */
export function isCanvasTainted(
  source: HTMLCanvasElement,
  probe?: HTMLCanvasElement,
): boolean | null {
  if (!probe && typeof document === 'undefined') {
    return null;
  }
  try {
    const target = probe ?? document.createElement('canvas');
    target.width = 1;
    target.height = 1;
    const ctx = target.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
      return null;
    }
    ctx.drawImage(source, 0, 0, 1, 1, 0, 0, 1, 1);
    ctx.getImageData(0, 0, 1, 1);
    return false;
  } catch (e) {
    return (e as { name?: unknown } | null)?.name === 'SecurityError' ? true : null;
  }
}
