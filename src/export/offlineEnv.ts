import type { AudioLoader } from '../audio/types';
import type { EncoderFactory } from './encoder';
import { mediabunnyEncoder, webCodecsAvailable } from './encoder';

/** 让出当前任务的工具:每帧让出一次,Promise 链(分段脚本、驱动)与编码器回调才能推进。 */
export interface TaskYielder {
  yieldTask(): Promise<void>;
  /** 释放占用的资源(会话结束时调用)。 */
  close(): void;
}

/**
 * MessageChannel 让出:消息任务不受后台标签页的定时器节流(setTimeout 在后台至少 1 秒一次,
 * 那样几万帧要导几个小时)。环境没有 MessageChannel 时才退回 setTimeout。
 */
export function messageChannelYielder(): TaskYielder {
  if (typeof MessageChannel === 'undefined') {
    return {
      yieldTask: () =>
        new Promise<void>((resolve) => {
          setTimeout(resolve, 0);
        }),
      close: () => undefined,
    };
  }
  const channel = new MessageChannel();
  const waiting: Array<() => void> = [];
  channel.port1.onmessage = (): void => {
    waiting.shift()?.();
  };
  return {
    yieldTask: () =>
      new Promise<void>((resolve) => {
        waiting.push(resolve);
        channel.port2.postMessage(0);
      }),
    close: () => {
      channel.port1.onmessage = null;
      channel.port1.close();
      channel.port2.close();
      // 还在等的让出直接放行,不能让会话悬着。
      for (const resolve of waiting.splice(0)) {
        resolve();
      }
    },
  };
}

/** 离线导出的音轨:48kHz 立体声(单声道配音两边都有)。解码与编码都按它。 */
export const EXPORT_AUDIO_SAMPLE_RATE = 48000;
export const EXPORT_AUDIO_CHANNELS = 2;

/**
 * 离线导出用到的环境能力。缺省由 browserOfflineEnv() 给出浏览器实现;
 * 测试(或非浏览器宿主)注入自己的实现,离线驱动的完整流程在 node 里也能跑。
 */
export interface OfflineEnv {
  /** 新建一张离屏画布(分段渲染用、导出合成用),不挂进文档。 */
  createCanvas(): HTMLCanvasElement;
  /** 视频编码端工厂。 */
  readonly encoder: EncoderFactory;
  /** 每次会话新建一个让出工具。 */
  createYielder(): TaskYielder;
  /**
   * 取配音文件并按导出采样率(EXPORT_AUDIO_SAMPLE_RATE)解码。
   * 没有就混不了配音:auto 模式改走实时录制(录得进时),否则照常出片、配音报告为 dropped。
   */
  readonly audio?: AudioLoader;
}

/** OfflineAudioContext 的构造器子集(按目标采样率解码用)。 */
type OfflineAudioContextCtor = new (
  channels: number,
  length: number,
  sampleRate: number,
) => { decodeAudioData(bytes: ArrayBuffer): Promise<AudioBuffer> };

/**
 * 浏览器的配音解码:fetch(跨域的音频要对方开 CORS)+ OfflineAudioContext 按导出采样率解码 ——
 * 重采样交给浏览器(质量比自己插值好)。缺 OfflineAudioContext 或 fetch 时返回 undefined。
 */
export function browserOfflineAudioLoader(): AudioLoader | undefined {
  const g = globalThis as unknown as {
    OfflineAudioContext?: OfflineAudioContextCtor;
    webkitOfflineAudioContext?: OfflineAudioContextCtor;
  };
  const Ctor = g.OfflineAudioContext ?? g.webkitOfflineAudioContext;
  if (!Ctor || typeof fetch === 'undefined') {
    return undefined;
  }
  let decoder: { decodeAudioData(bytes: ArrayBuffer): Promise<AudioBuffer> } | null = null;
  return {
    fetch: async (url) => {
      const res = await fetch(url, { mode: 'cors' });
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      return res.arrayBuffer();
    },
    decode: (bytes) => {
      // 解码不需要渲染:一个 1 帧长的上下文反复用就行。
      decoder ??= new Ctor(EXPORT_AUDIO_CHANNELS, 1, EXPORT_AUDIO_SAMPLE_RATE);
      return decoder.decodeAudioData(bytes);
    },
  };
}

/** 浏览器环境:要有 document(建离屏画布)与 WebCodecs(编码)。缺一样返回 null,调用方退回实时录制。 */
export function browserOfflineEnv(): OfflineEnv | null {
  if (typeof document === 'undefined' || !webCodecsAvailable()) {
    return null;
  }
  const audio = browserOfflineAudioLoader();
  return {
    createCanvas: () => document.createElement('canvas'),
    encoder: mediabunnyEncoder,
    createYielder: messageChannelYielder,
    ...(audio ? { audio } : {}),
  };
}
