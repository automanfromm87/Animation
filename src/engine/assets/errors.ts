/**
 * 资源(图片、SVG)加载与取用的错误。单独成模块:注册表、加载器、解析器、图元都依赖它,不成环。
 */

export type AssetErrorCode =
  /** 同步取用时缓存里没有(没预加载)。 */
  | 'not-loaded'
  /** 同步取用时还在加载(模块顶层漏了 await)。 */
  | 'loading'
  /** 按另一种类加载过(比如 SVG 按插画预加载,却当位图用)。 */
  | 'kind-mismatch'
  /** 路径越出 public/、空串。 */
  | 'bad-path'
  /** 服务器返回非 2xx(node:文件不存在)。 */
  | 'http'
  /** 网络错误,或跨源地址没开 CORS。 */
  | 'network'
  /** 字节解不成图像(格式不支持、文件损坏)。 */
  | 'decode'
  /** SVG 解析失败。 */
  | 'parse'
  /** 量不出原始尺寸。 */
  | 'size'
  /** createImageAsset 收到会污染画布的图像。 */
  | 'tainted'
  /** preloadAssets 多项失败(failures 里是各项)。 */
  | 'batch';

export interface AssetErrorOptions {
  readonly cause?: unknown;
  readonly failures?: readonly AssetError[];
}

export class AssetError extends Error {
  readonly code: AssetErrorCode;
  /** 作者写的地址(规范化前的原样;batch 时为 '')。 */
  readonly src: string;
  /** batch 时的各项失败;其余为空数组。 */
  readonly failures: readonly AssetError[];

  constructor(code: AssetErrorCode, src: string, message: string, options?: AssetErrorOptions) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'AssetError';
    this.code = code;
    this.src = src;
    this.failures = options?.failures ?? [];
  }
}

export function isAssetError(e: unknown): e is AssetError {
  return e instanceof AssetError;
}
