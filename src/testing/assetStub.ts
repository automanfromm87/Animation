/**
 * 资源加载桩:把注册表的加载器换成内存里的一张表(不碰文件、不碰网络)。
 * 用完一定要 restore():它把加载器换回缺省并清空缓存,不影响后面的用例。
 */

import { AssetError } from '../engine/assets/errors';
import type { AssetLoader, LoadedImage } from '../engine/assets/loaders';
import { normalizeAssetSrc } from '../engine/assets/paths';
import { setAssetLoader } from '../engine/assets/registry';
import { SVG_DEFAULT_SIZE, parseSvgDocument, svgIntrinsicSize } from '../engine/assets/svgDocument';

/** 桩位图:drawImage 收到的就是它,断言时比对 stub 地址。 */
export interface StubImageSource {
  readonly stub: string;
  readonly width: number;
  readonly height: number;
}

export interface AssetStubOptions {
  /** 地址 → 原始尺寸(地址规范化后比对)。source 是可断言的假对象 { stub: 地址, width, height }。 */
  images?: Readonly<Record<string, { width: number; height: number }>>;
  /** 地址 → 文本(SVG)。按位图加载 SVG 地址时尺寸从文本解析。 */
  texts?: Readonly<Record<string, string>>;
  /** 返回 HTTP 404 的地址(没列在 images / texts 里的地址本来也是 404)。 */
  missing?: readonly string[];
  /** 模拟网络延迟(毫秒,setTimeout);缺省 0 = 下一个宏任务。 */
  delayMs?: number;
}

export interface AssetStub {
  /** 加载器收到的请求(规范化地址,按顺序)。 */
  readonly requests: readonly string[];
  /** 事后补文件(模拟作者把漏掉的文件放进 public/)。 */
  addImage(src: string, width: number, height: number): void;
  addText(src: string, text: string): void;
  restore(): void;
}

function normalizedTable<T>(table: Readonly<Record<string, T>> | undefined): Map<string, T> {
  const out = new Map<string, T>();
  for (const [k, v] of Object.entries(table ?? {})) {
    out.set(normalizeAssetSrc(k), v);
  }
  return out;
}

export function installAssetStub(options: AssetStubOptions = {}): AssetStub {
  const images = normalizedTable(options.images);
  const texts = normalizedTable(options.texts);
  const missing = new Set((options.missing ?? []).map(normalizeAssetSrc));
  const requests: string[] = [];
  const delay = (): Promise<void> =>
    new Promise((resolve) => {
      setTimeout(resolve, options.delayMs ?? 0);
    });
  const notFound = (src: string, what: string): AssetError =>
    new AssetError('http', src, `${what}「${src}」取不到:HTTP 404(文件应放在 public${src})`);
  const loader: AssetLoader = {
    async loadImage(src): Promise<LoadedImage> {
      requests.push(src);
      await delay();
      const size = missing.has(src) ? undefined : images.get(src);
      if (size) {
        const source: StubImageSource = { stub: src, width: size.width, height: size.height };
        return { source: source as unknown as CanvasImageSource, width: size.width, height: size.height };
      }
      const text = missing.has(src) ? undefined : texts.get(src);
      if (text !== undefined) {
        const svgSize = svgIntrinsicSize(parseSvgDocument(text, src)) ?? SVG_DEFAULT_SIZE;
        const source: StubImageSource = { stub: src, ...svgSize };
        return { source: source as unknown as CanvasImageSource, ...svgSize };
      }
      throw notFound(src, '图片');
    },
    async loadText(src): Promise<string> {
      requests.push(src);
      await delay();
      const text = missing.has(src) ? undefined : texts.get(src);
      if (text === undefined) {
        throw notFound(src, 'SVG');
      }
      return text;
    },
  };
  setAssetLoader(loader);
  return {
    requests,
    addImage(src, width, height) {
      const key = normalizeAssetSrc(src);
      missing.delete(key);
      images.set(key, { width, height });
    },
    addText(src, text) {
      const key = normalizeAssetSrc(src);
      missing.delete(key);
      texts.set(key, text);
    },
    restore() {
      setAssetLoader(null);
    },
  };
}
