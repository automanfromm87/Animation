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
}

/** 浏览器环境:要有 document(建离屏画布)与 WebCodecs(编码)。缺一样返回 null,调用方退回实时录制。 */
export function browserOfflineEnv(): OfflineEnv | null {
  if (typeof document === 'undefined' || !webCodecsAvailable()) {
    return null;
  }
  return {
    createCanvas: () => document.createElement('canvas'),
    encoder: mediabunnyEncoder,
    createYielder: messageChannelYielder,
  };
}
