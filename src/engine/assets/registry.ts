import { AssetError } from './errors';
import type { AssetLoader, LoadedImage } from './loaders';
import { defaultAssetLoader, isOriginClean } from './loaders';
import type { AssetKind } from './paths';
import { assetKindOf, kindName, normalizeAssetSrc } from './paths';
import type { SvgDocument } from './svgDocument';
import { parseSvgDocument, unsupportedWarning } from './svgDocument';

export type { AssetKind } from './paths';
export { assetKindOf, normalizeAssetSrc } from './paths';

/**
 * 资源注册表:图片与 SVG 的模块级缓存。
 *
 * 影片脚本在虚拟时钟上重放(单帧预览快进、跳转、离线导出另起一套实例、node 干跑):
 * 脚本在两次 play 之间 await 网络,段内时钟停着、外面的时钟在走,时间线就错位了。
 * 所以资源要在分段挂载之前取好 —— 在影片模块顶层 await(loadImage / loadSvg / preloadAssets),
 * 模块被 import 时就等到了,所有入口(直播、预览、导出、测试、干跑工具)零接线;
 * 分段脚本里的构造(Picture / Illustration)是同步的,只查缓存,没预加载就抛清楚的错。
 */

/** 位图资源:解码好的图像源 + 原始尺寸。不可变,所有重放共用。 */
export interface ImageAsset {
  readonly kind: 'image';
  /** 规范化后的地址(缓存键)。createImageAsset 包出来的为它的 label。 */
  readonly src: string;
  /** 原始尺寸(像素,正有限数)。SVG 当位图用时按 SVG 自己的 width/height/viewBox 算,node 与浏览器一致。 */
  readonly width: number;
  readonly height: number;
  /** 解码好的图像源;node 干跑里为 null(只量尺寸、不画)。 */
  readonly source: CanvasImageSource | null;
}

/** SVG 资源:原文 + 解析结果(与显示尺寸无关;每次 new Illustration 按它现建图元)。 */
export interface SvgAsset {
  readonly kind: 'svg';
  readonly src: string;
  readonly text: string;
  readonly document: SvgDocument;
}

export type Asset = ImageAsset | SvgAsset;

/** 显式指定种类(比如把 .svg 当位图用)。 */
export interface AssetRequest {
  readonly src: string;
  readonly as?: AssetKind;
}

type Whitespace = ' ' | '\t' | '\n' | '\r';

/** 类型层面的 pathPart:去掉查询串与 #。 */
type PathOf<S extends string> = S extends `${infer P}?${string}`
  ? PathOf<P>
  : S extends `${infer P}#${string}`
    ? P
    : S;

/**
 * 字面量地址按 assetKindOf 的同一规则推出资源类型(.svg 与 data:image/svg+xml → SvgAsset,其余 → ImageAsset);
 * 推不准的(普通 string、首尾带空白)退回 Asset。
 */
type AssetOfSrc<S extends string> = string extends S
  ? Asset
  : S extends `${Whitespace}${string}` | `${string}${Whitespace}`
    ? Asset
    : Lowercase<S> extends `data:image/svg+xml;${string}` | `data:image/svg+xml,${string}`
      ? SvgAsset
      : Lowercase<S> extends `data:${string}`
        ? ImageAsset
        : Lowercase<PathOf<S>> extends `${string}.svg`
          ? SvgAsset
          : ImageAsset;

/** preloadAssets 的一项请求对应的资源类型:as 写明的按 as,没写的按地址推断。 */
export type AssetOf<R> = R extends string
  ? AssetOfSrc<R>
  : R extends { readonly as: 'svg' }
    ? SvgAsset
    : R extends { readonly as: 'image' }
      ? ImageAsset
      : R extends { readonly as?: undefined; readonly src: infer S extends string }
        ? AssetOfSrc<S>
        : Asset;

/** preloadAssets 的返回:与输入逐项对应的资源元组(字面量数组时各项类型精确,可以直接解构使用)。 */
export type PreloadedAssets<T extends ReadonlyArray<string | AssetRequest>> = {
  -readonly [K in keyof T]: AssetOf<T[K]>;
};

type Entry =
  | { readonly state: 'loading'; readonly promise: Promise<Asset> }
  | { readonly state: 'ready'; readonly asset: Asset };

const cache = new Map<string, Entry>();
/** 换加载器 / 清缓存时自增:在途的旧加载完成后只交给当初的调用方,不写进新缓存。 */
let generation = 0;
let loader: AssetLoader | null = null;

function currentLoader(): AssetLoader {
  loader ??= defaultAssetLoader();
  return loader;
}

function keyOf(kind: AssetKind, normalized: string): string {
  return `${kind} ${normalized}`;
}

function describe(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function positiveSize(v: number): boolean {
  return Number.isFinite(v) && v > 0;
}

async function fetchImage(normalized: string, src: string): Promise<ImageAsset> {
  let loaded: LoadedImage;
  try {
    loaded = await currentLoader().loadImage(normalized);
  } catch (e) {
    throw e instanceof AssetError ? e : new AssetError('network', src, `图片「${src}」取不到:${describe(e)}`, { cause: e });
  }
  if (!positiveSize(loaded.width) || !positiveSize(loaded.height)) {
    throw new AssetError('size', src, `图片「${src}」量不出原始尺寸(收到 ${loaded.width}×${loaded.height})`);
  }
  return Object.freeze({
    kind: 'image' as const,
    src: normalized,
    width: loaded.width,
    height: loaded.height,
    source: loaded.source,
  });
}

async function fetchSvg(normalized: string, src: string): Promise<SvgAsset> {
  let text: string;
  try {
    text = await currentLoader().loadText(normalized);
  } catch (e) {
    throw e instanceof AssetError ? e : new AssetError('network', src, `SVG「${src}」取不到:${describe(e)}`, { cause: e });
  }
  const document = parseSvgDocument(text, src);
  // 每份资源只告警一次:之后再建多少个 Illustration 都不再说。
  const warning = unsupportedWarning(document);
  if (warning) {
    console.warn(warning);
  }
  return Object.freeze({ kind: 'svg' as const, src: normalized, text, document });
}

function load(kind: 'image', src: string): Promise<ImageAsset>;
function load(kind: 'svg', src: string): Promise<SvgAsset>;
function load(kind: AssetKind, src: string): Promise<Asset>;
function load(kind: AssetKind, src: string): Promise<Asset> {
  let normalized: string;
  try {
    normalized = normalizeAssetSrc(src);
  } catch (e) {
    return Promise.reject(e);
  }
  const key = keyOf(kind, normalized);
  const hit = cache.get(key);
  if (hit) {
    return hit.state === 'ready' ? Promise.resolve(hit.asset) : hit.promise;
  }
  const gen = generation;
  const pending: Promise<Asset> = kind === 'image' ? fetchImage(normalized, src) : fetchSvg(normalized, src);
  const promise = pending.then(
    (asset) => {
      if (gen === generation) {
        cache.set(key, { state: 'ready', asset });
      }
      return asset;
    },
    (e: unknown) => {
      // 失败不缓存:下次重试(比如作者把漏掉的文件补上之后)。
      if (gen === generation && cache.get(key)?.state === 'loading') {
        cache.delete(key);
      }
      throw e;
    },
  );
  cache.set(key, { state: 'loading', promise });
  return promise;
}

/**
 * 取位图(缓存;并发请求共用同一个 Promise;失败不缓存,下次重试)。
 * 要取好几个时用 preloadAssets 一次取(或 Promise.all):顶层逐个 await 会排成一串,影片加载时白等。
 */
export function loadImage(src: string): Promise<ImageAsset> {
  return load('image', src);
}

/** 取 SVG 并解析(缓存规则同上;多个一起取同上)。首次解析时若有不支持的内容,console.warn 一次。 */
export function loadSvg(src: string): Promise<SvgAsset> {
  return load('svg', src);
}

function batchMessage(failures: readonly AssetError[]): string {
  return `有 ${failures.length} 个资源没能加载:\n${failures.map((f) => `· ${f.message}`).join('\n')}`;
}

/**
 * 一次预加载一批(并行)。字符串按 assetKindOf 推断种类,对象可用 as 指定。
 * 全部完成后按输入顺序返回:写成字面量数组时返回的是逐项类型精确的元组,可以直接解构当句柄用 ——
 * const [EARTH, CAT] = await preloadAssets(['/img/earth.png', '/svg/cat.svg']) 里 EARTH 是 ImageAsset、CAT 是 SvgAsset。
 * 有失败时等全部落定再抛:只有一个失败就抛那个 AssetError,
 * 多个就抛 AssetError('batch')(message 逐条列出,failures 里是各项)—— 作者一次看全缺了哪些文件。
 */
export async function preloadAssets<const T extends ReadonlyArray<string | AssetRequest>>(
  requests: T,
): Promise<PreloadedAssets<T>> {
  const settled = await Promise.allSettled(
    requests.map((r) => {
      const src = typeof r === 'string' ? r : r.src;
      const kind = typeof r === 'string' ? assetKindOf(r) : (r.as ?? assetKindOf(r.src));
      return load(kind, src);
    }),
  );
  const failures: AssetError[] = [];
  const assets: Asset[] = [];
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') {
      assets.push(s.value);
    } else {
      const r = requests[i];
      const src = typeof r === 'string' ? r : (r?.src ?? '');
      const reason: unknown = s.reason;
      failures.push(reason instanceof AssetError ? reason : new AssetError('network', src, describe(reason), { cause: reason }));
    }
  });
  const only = failures[0];
  if (only && failures.length === 1) {
    throw only;
  }
  if (failures.length > 1) {
    throw new AssetError('batch', '', batchMessage(failures), { failures });
  }
  // 逐项种类与 AssetOf 的推断同一规则(assetKindOf / as),所以这里的断言成立。
  return assets as unknown as PreloadedAssets<T>;
}

function loaderName(kind: AssetKind): string {
  return kind === 'svg' ? 'loadSvg' : 'loadImage';
}

function lookup(kind: 'image', src: string): ImageAsset;
function lookup(kind: 'svg', src: string): SvgAsset;
function lookup(kind: AssetKind, src: string): Asset {
  const normalized = normalizeAssetSrc(src);
  const hit = cache.get(keyOf(kind, normalized));
  if (hit?.state === 'ready') {
    return hit.asset;
  }
  const name = kindName(kind);
  if (hit?.state === 'loading') {
    throw new AssetError(
      'loading',
      src,
      `${name}「${src}」还在加载:${loaderName(kind)} / preloadAssets 前面漏了 await?模块顶层要等它完成再用。`,
    );
  }
  const other: AssetKind = kind === 'svg' ? 'image' : 'svg';
  if (cache.has(keyOf(other, normalized))) {
    const hint =
      kind === 'image'
        ? `「${src}」是按 SVG 插画预加载的;当位图用要 preloadAssets([{ src: '${src}', as: 'image' }])。`
        : `「${src}」是按位图预加载的;当 SVG 插画用要 loadSvg('${src}')(或 preloadAssets([{ src: '${src}', as: 'svg' }]))。`;
    throw new AssetError('kind-mismatch', src, hint);
  }
  throw new AssetError(
    'not-loaded',
    src,
    `${name}「${src}」还没有预加载:在影片模块顶层写 const X = await ${loaderName(kind)}('${src}')` +
      '(或 await preloadAssets([...]))再在脚本里用。分段脚本里不能等网络,否则预览、跳转、导出的时间线会错位。',
  );
}

/** 同步取已加载的位图:没加载抛 'not-loaded',正在加载抛 'loading',按 svg 加载过抛 'kind-mismatch'。 */
export function getImage(src: string): ImageAsset {
  return lookup('image', src);
}

/** 同步取已加载的 SVG(错误同上)。 */
export function getSvg(src: string): SvgAsset {
  return lookup('svg', src);
}

/** 是否已就绪(不抛错)。as 缺省按 assetKindOf。 */
export function isAssetReady(src: string, as?: AssetKind): boolean {
  try {
    return cache.get(keyOf(as ?? assetKindOf(src), normalizeAssetSrc(src)))?.state === 'ready';
  } catch {
    return false;
  }
}

/**
 * 把现成的图像源包成资源(程序生成的离屏画布等),不经缓存、同步。
 * 浏览器里先画进 1×1 探针读一次像素,读不了(跨源污染)立刻抛 AssetError('tainted') —— 不让污染拖到导出时才暴露。
 * @param label 报错与诊断里显示的名字,缺省 '(生成的图像)'
 */
export function createImageAsset(
  source: CanvasImageSource,
  width: number,
  height: number,
  label = '(生成的图像)',
): ImageAsset {
  if (!positiveSize(width) || !positiveSize(height)) {
    throw new AssetError('size', label, `图像「${label}」的尺寸需要正的有限数,收到 ${width}×${height}`);
  }
  if (!isOriginClean(source)) {
    throw new AssetError(
      'tainted',
      label,
      `图像「${label}」来自没开 CORS 的跨源地址,画上画布会污染导出;请用 loadImage 加载(对方需开 CORS)或放进 public/。`,
    );
  }
  return Object.freeze({ kind: 'image' as const, src: label, width, height, source });
}

/**
 * 换加载器(测试、非浏览器宿主)。null 恢复缺省(浏览器 / node 自动选)。
 * 换加载器会清空缓存,并让还在路上的旧加载作废(完成后不写进新缓存)。
 */
export function setAssetLoader(next: AssetLoader | null): void {
  loader = next;
  clearAssets();
}

/** @internal 测试用:清空缓存(同样让在途加载作废)。 */
export function clearAssets(): void {
  generation += 1;
  cache.clear();
}
