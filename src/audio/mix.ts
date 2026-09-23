import type { DecodedAudio, PlacedClip } from './types';

/**
 * 离线混音:把时间轴窗口 [t0, t0 + 帧数 / sampleRate) 里的片段叠加进 planes(每声道一个 Float32Array)。
 * 窗口按顺序一块块混,内存只占一块;导出时跟着视频帧往前推。
 *
 * - 片段声道少于输出:最后一个声道复制到其余声道(单声道配音 → 立体声两边都有);多于输出:取前几个声道。
 * - 采样率不同时线性插值(浏览器按目标采样率解码时不会走到这里,只是兜底)。
 * - 超出文件长度的部分当静音;叠加后可能超过 ±1,由 clampPlanes 收尾。
 */
export function mixWindow(
  planes: readonly Float32Array[],
  sampleRate: number,
  t0: number,
  clips: readonly PlacedClip[],
  bufferOf: (url: string) => DecodedAudio | null,
): void {
  const frames = planes[0]?.length ?? 0;
  if (frames === 0 || !(sampleRate > 0)) {
    return;
  }
  const t1 = t0 + frames / sampleRate;
  for (const clip of clips) {
    const start = clip.at;
    const end = clip.at + Math.max(0, clip.duration);
    if (!(end > t0) || !(start < t1)) {
      continue;
    }
    const buffer = bufferOf(clip.url);
    if (!buffer || buffer.length === 0 || buffer.numberOfChannels === 0) {
      continue;
    }
    const gain = clip.gain ?? 1;
    // 窗口内的采样区间(输出坐标)。
    const i0 = Math.max(0, Math.round((start - t0) * sampleRate));
    const i1 = Math.min(frames, Math.round((end - t0) * sampleRate));
    if (!(i1 > i0)) {
      continue;
    }
    const ratio = buffer.sampleRate / sampleRate;
    // 输出第 i 个采样对应文件里的位置(文件采样坐标)。
    const base = (clip.offset + (t0 - start)) * buffer.sampleRate;
    planes.forEach((plane, ch) => {
      const src = buffer.getChannelData(Math.min(ch, buffer.numberOfChannels - 1));
      for (let i = i0; i < i1; i++) {
        const pos = base + i * ratio;
        const a = Math.floor(pos);
        if (a < 0 || a >= src.length) {
          continue;
        }
        const f = pos - a;
        const s0 = src[a] ?? 0;
        const sample = f === 0 ? s0 : s0 + ((src[a + 1] ?? 0) - s0) * f;
        plane[i] = (plane[i] ?? 0) + sample * gain;
      }
    });
  }
}

/** 把叠加后的采样收进 [-1, 1](几段配音重叠时防止编码器削波爆音)。 */
export function clampPlanes(planes: readonly Float32Array[]): void {
  for (const plane of planes) {
    for (let i = 0; i < plane.length; i++) {
      const v = plane[i] ?? 0;
      if (v > 1) {
        plane[i] = 1;
      } else if (v < -1) {
        plane[i] = -1;
      }
    }
  }
}
