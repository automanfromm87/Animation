/**
 * 声音层:播放、解码、混音只认这里的类型。和导出层一样是底层 ——
 * 不依赖影片、场景、引擎,时间一律是秒。
 */

/** 解码后的音频:AudioBuffer 的只读子集(测试可以直接给普通对象)。 */
export interface DecodedAudio {
  readonly sampleRate: number;
  /** 每声道的采样数。 */
  readonly length: number;
  readonly numberOfChannels: number;
  readonly duration: number;
  getChannelData(channel: number): Float32Array;
}

/**
 * 时间轴上的一段音频:从 at 秒开始,播放文件 url 从 offset 秒起的内容,最多 duration 秒
 * (文件先放完就先结束)。key 唯一标识这一段,重新安排时靠它认出是同一段。
 */
export interface PlacedClip {
  readonly key: string;
  readonly url: string;
  readonly at: number;
  readonly offset: number;
  readonly duration: number;
  /** 音量系数,缺省 1。 */
  readonly gain?: number;
}

/** 取文件与解码。浏览器实现用 fetch + decodeAudioData;测试注入假实现。 */
export interface AudioLoader {
  fetch(url: string): Promise<ArrayBuffer>;
  decode(bytes: ArrayBuffer): Promise<DecodedAudio>;
}
