import type { AudioLoader, DecodedAudio } from './types';

/**
 * 音频库:按地址取文件、解码、缓存。同一地址只取一次(并发请求共用一个 Promise);
 * 取不到或解不开时报一次错、之后按静音处理 —— 缺一个文件不能让整部片子出错。
 */
export class AudioLibrary {
  private readonly loader: AudioLoader;
  private readonly onError: (url: string, error: unknown) => void;
  private readonly pending = new Map<string, Promise<DecodedAudio | null>>();
  private readonly ready = new Map<string, DecodedAudio>();
  private readonly failed = new Set<string>();

  constructor(loader: AudioLoader, onError?: (url: string, error: unknown) => void) {
    this.loader = loader;
    this.onError =
      onError ??
      ((url, error) => {
        console.warn(`[audio] 音频加载失败,按静音处理:${url}`, error);
      });
  }

  /** 取并解码(缓存);失败 resolve 为 null。 */
  load(url: string): Promise<DecodedAudio | null> {
    const hit = this.pending.get(url);
    if (hit) {
      return hit;
    }
    const promise = (async (): Promise<DecodedAudio | null> => {
      try {
        const bytes = await this.loader.fetch(url);
        const decoded = await this.loader.decode(bytes);
        this.ready.set(url, decoded);
        return decoded;
      } catch (e) {
        this.failed.add(url);
        this.onError(url, e);
        return null;
      }
    })();
    this.pending.set(url, promise);
    return promise;
  }

  /** 已经解好的直接给;还没好(或失败)为 null。不会触发加载。 */
  peek(url: string): DecodedAudio | null {
    return this.ready.get(url) ?? null;
  }

  /** 这个地址加载失败过。 */
  hasFailed(url: string): boolean {
    return this.failed.has(url);
  }

  /** 丢掉缓存(离线导出用完一段就还掉内存);之后再要会重新加载。 */
  release(url: string): void {
    this.pending.delete(url);
    this.ready.delete(url);
    this.failed.delete(url);
  }
}
