import type { AudioLibrary } from './library';
import type { DecodedAudio, PlacedClip } from './types';

/**
 * 实时播放:Web Audio 的最小子集 + 按时间轴对账的片段播放器。
 * 时间轴位置(秒)由调用方每帧给出 —— 画面时间线是基准,声音跟着它走:
 * 暂停、跳转、切段、切后台回来都只是「此刻该响哪些、从哪里响」的问题,每帧对一次账就都对上了。
 */

/** AudioBufferSourceNode 的子集。 */
export interface LiveBufferSource {
  buffer: unknown;
  onended: (() => void) | null;
  connect(node: unknown): void;
  disconnect(): void;
  start(when: number, offset: number, duration?: number): void;
  stop(when?: number): void;
}

/** GainNode 的子集。 */
export interface LiveGain {
  readonly gain: { value: number };
  connect(node: unknown): void;
  disconnect(node?: unknown): void;
}

/** AudioContext 的子集。 */
export interface LiveAudioContext {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: unknown;
  resume(): Promise<void>;
  suspend(): Promise<void>;
  close(): Promise<void>;
  createBufferSource(): LiveBufferSource;
  createGain(): LiveGain;
  decodeAudioData(bytes: ArrayBuffer): Promise<DecodedAudio>;
  /** 实时录制时把声音接进录制的媒体流(没有就录不到声音)。 */
  createMediaStreamDestination?(): { readonly stream: MediaStream };
}

/** 播放环境:浏览器实现见 browserLiveAudioEnv;测试注入假实现。 */
export interface LiveAudioEnv {
  /** 新建音频上下文。第一次必须发生在用户操作(点击)里,浏览器才允许出声。 */
  createContext(): LiveAudioContext | null;
  fetch(url: string): Promise<ArrayBuffer>;
  /** 页面是否在后台。 */
  hidden(): boolean;
  /** 订阅页面可见性变化,返回退订函数。 */
  onVisibilityChange(listener: () => void): () => void;
}

/** 浏览器环境;没有 Web Audio 时返回 null(片子照常播,只是没有声音)。调用时才取全局。 */
export function browserLiveAudioEnv(): LiveAudioEnv | null {
  const g = globalThis as unknown as {
    AudioContext?: new () => LiveAudioContext;
    webkitAudioContext?: new () => LiveAudioContext;
  };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  if (!Ctor || typeof fetch === 'undefined' || typeof document === 'undefined') {
    return null;
  }
  return {
    createContext: () => {
      try {
        return new Ctor();
      } catch (e) {
        console.warn('[audio] 创建音频上下文失败,没有声音', e);
        return null;
      }
    },
    fetch: async (url) => {
      // 跨域的音频要对方开 CORS:否则连字节都读不到,更没法解码与混音。
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res.arrayBuffer();
    },
    hidden: () => document.hidden,
    onVisibilityChange: (listener) => {
      document.addEventListener('visibilitychange', listener);
      return () => document.removeEventListener('visibilitychange', listener);
    },
  };
}

/** 提前这么久把即将开始的片段排进音频时钟(采样级准时起播,不受帧间隔影响)。 */
const LOOKAHEAD = 0.25;
/** 实际播放位置和时间轴差出这么多就重排(帧抖动 ≈ 16ms,远小于它)。 */
const DRIFT = 0.1;

interface Voice {
  readonly clip: PlacedClip;
  readonly node: LiveBufferSource;
  /** 片段内第 clipPos 秒在音频时钟的 ctxTime 时刻播出(未来起播时 clipPos 为 0)。 */
  readonly ctxTime: number;
  readonly clipPos: number;
}

/**
 * 片段播放器:sync(片段, 时间轴位置, 是否在播) 每帧调用一次。
 * 该响没响的补上(从正确的位置起),响着但偏了的重排,不该响的停掉;音频没解好的先跳过,解好后晚起也在对的位置。
 */
export class LiveClipPlayer {
  private readonly ctx: LiveAudioContext;
  private readonly library: AudioLibrary;
  private readonly output: unknown;
  private readonly voices = new Map<string, Voice>();

  constructor(ctx: LiveAudioContext, library: AudioLibrary, output: unknown) {
    this.ctx = ctx;
    this.library = library;
    this.output = output;
  }

  /** 正在响(或已排定)的片段数。 */
  get activeCount(): number {
    return this.voices.size;
  }

  sync(clips: readonly PlacedClip[], t: number, playing: boolean): void {
    if (!playing || !Number.isFinite(t)) {
      this.stopAll();
      return;
    }
    const now = this.ctx.currentTime;
    const wanted = new Set<string>();
    for (const clip of clips) {
      const end = clip.at + Math.max(0, clip.duration);
      if (t >= end || t < clip.at - LOOKAHEAD) {
        continue;
      }
      const buffer = this.library.peek(clip.url);
      if (!buffer) {
        // 还没解好:先去取,这一帧跳过(解好之后的某一帧会从当时的正确位置起播)。
        if (!this.library.hasFailed(clip.url)) {
          void this.library.load(clip.url);
        }
        continue;
      }
      const into = t - clip.at; // 此刻应在片段内的位置(负数表示还没到)
      if (clip.offset + Math.max(0, into) >= buffer.duration) {
        continue; // 文件已经放完
      }
      wanted.add(clip.key);
      const current = this.voices.get(clip.key);
      if (current) {
        const actual = now - current.ctxTime + current.clipPos;
        if (Math.abs(actual - into) <= DRIFT) {
          continue;
        }
        this.stop(clip.key);
      }
      this.start(clip, buffer, into, now);
    }
    for (const key of [...this.voices.keys()]) {
      if (!wanted.has(key)) {
        this.stop(key);
      }
    }
  }

  stopAll(): void {
    for (const key of [...this.voices.keys()]) {
      this.stop(key);
    }
  }

  private start(clip: PlacedClip, buffer: DecodedAudio, into: number, now: number): void {
    const node = this.ctx.createBufferSource();
    node.buffer = buffer;
    node.connect(this.output);
    const clipPos = Math.max(0, into);
    const when = into < 0 ? now - into : now;
    const remaining = Math.max(0, clip.duration - clipPos);
    const voice: Voice = { clip, node, ctxTime: when, clipPos };
    node.onended = () => {
      if (this.voices.get(clip.key) === voice) {
        this.voices.delete(clip.key);
        node.disconnect();
      }
    };
    try {
      node.start(when, clip.offset + clipPos, remaining);
    } catch (e) {
      node.disconnect();
      console.warn('[audio] 起播失败', clip.url, e);
      return;
    }
    this.voices.set(clip.key, voice);
  }

  private stop(key: string): void {
    const voice = this.voices.get(key);
    if (!voice) {
      return;
    }
    this.voices.delete(key);
    voice.node.onended = null;
    try {
      voice.node.stop();
    } catch {
      // 还没起播 / 已经停了:都无所谓。
    }
    voice.node.disconnect();
  }
}
