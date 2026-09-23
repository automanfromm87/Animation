import type { LiveAudioContext, LiveAudioEnv, LiveBufferSource, LiveGain } from './live';
import type { AudioLoader, DecodedAudio } from './types';

/**
 * 声音层的测试替身(node 里没有 Web Audio):假解码音频、假加载器、假音频上下文。
 * 只给测试用,不进应用代码路径。
 */

/** 造一段解码好的音频:每个采样的值由 fill(声道, 下标) 给出(缺省全 0.5)。 */
export function fakeAudio(
  seconds: number,
  sampleRate = 1000,
  channels = 1,
  fill: (channel: number, index: number) => number = () => 0.5,
): DecodedAudio {
  const length = Math.round(seconds * sampleRate);
  const data = Array.from({ length: channels }, (_, c) => {
    const arr = new Float32Array(length);
    for (let i = 0; i < length; i++) {
      arr[i] = fill(c, i);
    }
    return arr;
  });
  return {
    sampleRate,
    length,
    numberOfChannels: channels,
    duration: length / sampleRate,
    getChannelData: (channel) => data[channel] ?? new Float32Array(length),
  };
}

/** 按地址给音频的假加载器;表里没有的地址加载失败。calls 记录取过哪些地址。 */
export function fakeLoader(table: Record<string, DecodedAudio>): AudioLoader & { calls: string[] } {
  const calls: string[] = [];
  const bytesToUrl = new Map<ArrayBuffer, string>();
  return {
    calls,
    fetch: async (url) => {
      calls.push(url);
      if (!table[url]) {
        throw new Error(`404 ${url}`);
      }
      const bytes = new ArrayBuffer(8);
      bytesToUrl.set(bytes, url);
      return bytes;
    },
    decode: async (bytes) => {
      const url = bytesToUrl.get(bytes);
      const audio = url ? table[url] : undefined;
      if (!audio) {
        throw new Error('decode failed');
      }
      return audio;
    },
  };
}

export interface FakeSourceNode extends LiveBufferSource {
  readonly started: { when: number; offset: number; duration: number | undefined } | null;
  readonly stopped: boolean;
}

/** 假音频上下文:currentTime 手动推进;记录每个节点怎么起播、有没有停。 */
export class FakeAudioContext implements LiveAudioContext {
  currentTime = 0;
  state = 'suspended';
  readonly destination = { kind: 'destination' };
  readonly nodes: FakeSourceNode[] = [];
  closed = false;
  resumes = 0;
  suspends = 0;
  private readonly decoded: (bytes: ArrayBuffer) => Promise<DecodedAudio>;

  constructor(decode: (bytes: ArrayBuffer) => Promise<DecodedAudio>) {
    this.decoded = decode;
  }

  resume(): Promise<void> {
    this.resumes += 1;
    this.state = 'running';
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.suspends += 1;
    this.state = 'suspended';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closed = true;
    this.state = 'closed';
    return Promise.resolve();
  }

  createBufferSource(): LiveBufferSource {
    const node = {
      buffer: null as unknown,
      onended: null as (() => void) | null,
      started: null as FakeSourceNode['started'],
      stopped: false,
      connect: () => undefined,
      disconnect: () => undefined,
      start(when: number, offset: number, duration?: number) {
        node.started = { when, offset, duration };
      },
      stop() {
        node.stopped = true;
      },
    };
    this.nodes.push(node);
    return node;
  }

  createGain(): LiveGain {
    return { gain: { value: 1 }, connect: () => undefined, disconnect: () => undefined };
  }

  decodeAudioData(bytes: ArrayBuffer): Promise<DecodedAudio> {
    return this.decoded(bytes);
  }

  /** 还在响(起播了、没停、没自然结束)的节点。 */
  live(): FakeSourceNode[] {
    return this.nodes.filter((n) => n.started !== null && !n.stopped);
  }
}

/** 假播放环境:createContext 返回同一个 FakeAudioContext;可见性可以手动切换。 */
export function fakeLiveEnv(table: Record<string, DecodedAudio>): LiveAudioEnv & {
  ctx: FakeAudioContext;
  setHidden(hidden: boolean): void;
  contexts: number;
} {
  const loader = fakeLoader(table);
  const listeners = new Set<() => void>();
  let hidden = false;
  const env = {
    ctx: new FakeAudioContext((bytes) => loader.decode(bytes)),
    contexts: 0,
    createContext: () => {
      env.contexts += 1;
      return env.ctx;
    },
    fetch: (url: string) => loader.fetch(url),
    hidden: () => hidden,
    onVisibilityChange: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setHidden: (value: boolean) => {
      hidden = value;
      for (const l of listeners) {
        l();
      }
    },
  };
  return env;
}
