import { AssetError } from './errors';
import { imageSizeFromBytes } from './imageSize';
import { assetKindOf, isUrlSrc, pathPart } from './paths';
import { SVG_DEFAULT_SIZE, parseSvgDocument, svgIntrinsicSize, svgWithIntrinsicSize } from './svgDocument';

/**
 * 资源加载器:注册表只通过它取字节。浏览器与 node 各一份,测试可以注入内存加载器(src/testing/assetStub.ts)。
 *
 * 浏览器加载器只走 fetch(mode: 'cors') + Blob 解码:跨源资源没开 CORS 时在预加载阶段就失败(消息说明 CORS),
 * 开了 CORS 的字节进 Blob 再解码,得到的图像源是同源、干净的 —— 画布不可能被我们加载的图片污染,
 * 实时录制的污染看门狗与离线导出的取帧都不会因此出错。
 */

export interface LoadedImage {
  /** 解码好的图像源;node 干跑里为 null(只量尺寸、不画)。 */
  readonly source: CanvasImageSource | null;
  /** 原始尺寸(像素)。 */
  readonly width: number;
  readonly height: number;
}

/** src 已规范化(见 normalizeAssetSrc)。实现应抛 AssetError(其它错误会被注册表包装)。 */
export interface AssetLoader {
  loadImage(src: string): Promise<LoadedImage>;
  loadText(src: string): Promise<string>;
}

function what(kind: 'image' | 'svg'): string {
  return kind === 'svg' ? 'SVG' : '图片';
}

/** note 是补在「文件应放在 public/…」后面的说明(同一对括号里)。 */
function httpError(src: string, kind: 'image' | 'svg', status: string, note = ''): AssetError {
  const local = !isUrlSrc(src);
  const hint = local ? `文件应放在 public${pathPart(src)}${note ? `;${note}` : ''}` : note;
  return new AssetError('http', src, `${what(kind)}「${src}」取不到:${status}${hint ? `(${hint})` : ''}`);
}

/** 地址本身就指向网页(.html / .htm):这时收到网页不算异常。 */
function isHtmlPath(src: string): boolean {
  return /\.html?$/i.test(pathPart(src));
}

/** 文本开头是不是 HTML 文档(跳过 BOM、空白与注释)。 */
function looksLikeHtml(text: string): boolean {
  const head = text.slice(0, 2048).replace(/^\uFEFF/, '').replace(/^(\s|<!--[\s\S]*?-->)+/, '');
  return /^<(!doctype\s+html|html)[\s>]/i.test(head);
}

/**
 * 服务器拿网页顶替了资源:Vite 开发服务器(appType 'spa')、vite preview 与很多静态托管
 * 对不存在的文件回 200 + index.html(fetch 缺省的 Accept 头接受任意类型,正好触发)。
 * 不认出来的话,报错会变成「SVG 根元素是 <html>」「解码失败」,把作者往错的方向引;按 404 报,与 node 干跑一致。
 */
function htmlFallbackError(src: string, kind: 'image' | 'svg'): AssetError {
  return isUrlSrc(src)
    ? httpError(src, kind, `服务器返回的是网页(text/html),不是${what(kind)}`, '地址写错了,或文件不存在')
    : httpError(src, kind, 'HTTP 404', '服务器返回的是网页 index.html —— 开发服务器对不存在的文件会这样回应');
}

function decodeError(src: string, cause?: unknown): AssetError {
  return new AssetError('decode', src, `图片「${src}」解码失败(格式不支持或文件损坏)`, cause === undefined ? undefined : { cause });
}

/**
 * 画布污染探针:把图像画进 1×1 画布再读一个像素,读不了(SecurityError)就是会污染画布
 * (与导出看门狗同一探测法)。node 里、没有画布、读像素因别的原因失败时按干净算。
 */
export function isOriginClean(source: CanvasImageSource): boolean {
  if (isNodeRuntime() || typeof document === 'undefined' || typeof document.createElement !== 'function') {
    return true;
  }
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    const probe = document.createElement('canvas');
    probe.width = 1;
    probe.height = 1;
    ctx = probe.getContext('2d');
  } catch {
    return true;
  }
  if (!ctx || typeof ctx.getImageData !== 'function') {
    return true;
  }
  try {
    ctx.drawImage(source, 0, 0, 1, 1);
    ctx.getImageData(0, 0, 1, 1);
  } catch (e) {
    return (e as { name?: unknown } | null)?.name !== 'SecurityError';
  }
  return true;
}

// ---------------------------------------------------------------------------
// 浏览器

/** 浏览器加载器的依赖(缺省取全局;测试注入假的 fetch / createImageBitmap / <img>)。 */
export interface WebLoaderDeps {
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  createImageBitmap?: (blob: Blob) => Promise<ImageBitmap>;
  createImage?: () => HTMLImageElement;
  createObjectURL?: (blob: Blob) => string;
  /** 本地路径的基准(以 / 结尾),缺省 `new URL(import.meta.env.BASE_URL ?? '/', location.href)`。 */
  base?: string;
  /** 页面的源(判断跨源用),缺省 location.origin。 */
  origin?: string;
  /** 画布污染探针(SVG 当位图解码后查一次),缺省 isOriginClean。 */
  isOriginClean?: (source: CanvasImageSource) => boolean;
}

function defaultBase(): string {
  const env = import.meta.env as { BASE_URL?: unknown } | undefined;
  const baseUrl = typeof env?.BASE_URL === 'string' ? env.BASE_URL : '/';
  const here = typeof location !== 'undefined' ? location.href : 'http://localhost/';
  return new URL(baseUrl, here).href;
}

export function webAssetLoader(deps: WebLoaderDeps = {}): AssetLoader {
  const doFetch = deps.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init));
  // 按 EXIF 方向摆正(手机竖拍的照片宽高互换),与 node 从文件头量的尺寸一致。
  const makeBitmap =
    deps.createImageBitmap ??
    (typeof createImageBitmap === 'function'
      ? (blob: Blob) => createImageBitmap(blob, { imageOrientation: 'from-image' })
      : null);
  const makeImage = deps.createImage ?? (() => new Image());
  const objectUrl = deps.createObjectURL ?? ((blob: Blob) => URL.createObjectURL(blob));
  const originClean = deps.isOriginClean ?? isOriginClean;

  const resolve = (src: string): string => {
    const base = deps.base ?? defaultBase();
    if (isUrlSrc(src)) {
      return new URL(src, base).href;
    }
    // base 以 / 结尾:BASE_URL = '/sub/' 时 '/img/a.png' → '/sub/img/a.png'。
    return new URL(src.slice(1), base.endsWith('/') ? base : `${base}/`).href;
  };

  const isCrossOrigin = (url: string): boolean => {
    const origin = deps.origin ?? (typeof location !== 'undefined' ? location.origin : null);
    try {
      const u = new URL(url);
      if (u.protocol === 'data:' || u.protocol === 'blob:') {
        return false;
      }
      return origin !== null && u.origin !== origin;
    } catch {
      return false;
    }
  };

  const fetchOk = async (src: string, kind: 'image' | 'svg'): Promise<Response> => {
    const url = resolve(src);
    let res: Response;
    try {
      res = await doFetch(url, { mode: 'cors', credentials: 'same-origin' });
    } catch (e) {
      const message = isCrossOrigin(url)
        ? `${what(kind)}「${src}」取不到:网络错误,或对方服务器没开 CORS。跨源图片必须带 Access-Control-Allow-Origin 响应头,` +
          '否则会污染画布、导出失败;也可以把文件下载到 public/ 里。'
        : `${what(kind)}「${src}」取不到:网络错误`;
      throw new AssetError('network', src, message, { cause: e });
    }
    if (!res.ok) {
      throw httpError(src, kind, `HTTP ${res.status}`);
    }
    if (/text\/html/i.test(res.headers.get('content-type') ?? '') && !isHtmlPath(src)) {
      throw htmlFallbackError(src, kind);
    }
    return res;
  };

  /** 服务器没发 content-type 时的兜底:按内容认出顶替资源的网页。 */
  const assertNotHtml = (src: string, kind: 'image' | 'svg', head: string): void => {
    if (!isHtmlPath(src) && looksLikeHtml(head)) {
      throw htmlFallbackError(src, kind);
    }
  };

  /** <img> + blob URL 解码(同源,不污染画布)。 */
  const decodeWithImage = async (src: string, blob: Blob): Promise<HTMLImageElement> => {
    const img = makeImage();
    // blob URL 本来就同源;crossOrigin 只是兜底,万一换成直接的远程地址也会走 CORS 而不是悄悄污染画布。
    img.crossOrigin = 'anonymous';
    img.decoding = 'async';
    img.src = objectUrl(blob);
    try {
      await img.decode();
    } catch (e) {
      throw decodeError(src, e);
    }
    return img;
  };

  return {
    async loadText(src) {
      const res = await fetchOk(src, 'svg');
      const text = await res.text();
      assertNotHtml(src, 'svg', text);
      return text;
    },
    async loadImage(src) {
      const res = await fetchOk(src, 'image');
      const blob = await res.blob();
      if (/svg/i.test(blob.type) || assetKindOf(src) === 'svg') {
        // SVG 当位图:尺寸按我们自己的解析(与 node 一致),并把它写回根元素 ——
        // 不写的话浏览器按自己的规矩定原始尺寸(没写 width/height 时各家不一),drawImage 的源矩形会对不上。
        // 改写时顺手去掉 <foreignObject>(Safari 画这种 SVG 会污染画布)与写了 requiredExtensions 的分支,
        // 与 Illustration 画出来的内容一致。
        const text = await blob.text();
        assertNotHtml(src, 'image', text);
        const size = svgIntrinsicSize(parseSvgDocument(text, src)) ?? SVG_DEFAULT_SIZE;
        const sized = new Blob([svgWithIntrinsicSize(text, size.width, size.height)], { type: 'image/svg+xml' });
        const img = await decodeWithImage(src, sized);
        // 兜底:仍会污染画布的(浏览器对 SVG 位图的规矩各家不一)在预加载时就报,不拖到导出时。
        if (!originClean(img)) {
          throw new AssetError(
            'tainted',
            src,
            `SVG「${src}」当位图画上画布会污染导出(浏览器不许读回这张 SVG 的像素);` +
              '请改用 loadSvg + Illustration 画成矢量,或把它导出成 PNG 再用。',
          );
        }
        return { source: img, width: size.width, height: size.height };
      }
      if (!blob.type || /^text\//i.test(blob.type)) {
        assertNotHtml(src, 'image', await blob.slice(0, 2048).text());
      }
      if (makeBitmap) {
        try {
          const bitmap = await makeBitmap(blob);
          return { source: bitmap, width: bitmap.width, height: bitmap.height };
        } catch {
          // 有的格式 createImageBitmap 不认(老 Safari 的 WebP 之类),退回 <img>。
        }
      }
      const img = await decodeWithImage(src, blob);
      return { source: img, width: img.naturalWidth, height: img.naturalHeight };
    },
  };
}

// ---------------------------------------------------------------------------
// node

/** app 的 tsconfig 没有 node 类型:只声明用到的那一点。 */
interface NodeFsLike {
  readFileSync(path: string): Uint8Array;
  existsSync(path: string): boolean;
}

interface NodePathLike {
  join(...parts: string[]): string;
  resolve(...parts: string[]): string;
  relative(from: string, to: string): string;
  dirname(path: string): string;
  isAbsolute(path: string): boolean;
}

interface NodeProcessLike {
  versions?: { node?: string };
  cwd?: () => string;
  getBuiltinModule?: (id: string) => unknown;
}

function nodeProcess(): NodeProcessLike | undefined {
  return (globalThis as { process?: NodeProcessLike }).process;
}

/**
 * 是否跑在 node 里(测试、干跑脚本)。不能用 typeof document 判断:
 * 测试桩会把 document / window 装到全局。
 */
export function isNodeRuntime(): boolean {
  return typeof nodeProcess()?.versions?.node === 'string';
}

function builtin<T>(id: string): T | null {
  const proc = nodeProcess();
  if (typeof proc?.getBuiltinModule !== 'function') {
    return null;
  }
  try {
    return (proc.getBuiltinModule(id) as T | undefined) ?? null;
  } catch {
    return null;
  }
}

export interface NodeLoaderOptions {
  /**
   * public 目录。缺省:从引擎自己的源文件所在目录往上找第一个含 package.json 的目录(找不到再从 process.cwd() 找),
   * 取其下 public/ —— 与从哪个目录启动脚本无关。
   */
  root?: string;
  /** 取 http(s) 地址用的 fetch,缺省全局的。 */
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}

/** 本模块源文件所在目录(node 里 import.meta.url 是 file: 地址);取不到返回 null。 */
function moduleDir(): string | null {
  const url = builtin<{ fileURLToPath(url: string): string }>('node:url');
  const path = builtin<NodePathLike>('node:path');
  if (!url || !path || !import.meta.url.startsWith('file:')) {
    return null;
  }
  try {
    return path.dirname(url.fileURLToPath(import.meta.url));
  } catch {
    return null;
  }
}

/** data: URL → 字节(base64 或百分号编码)。 */
function dataUrlBytes(src: string): Uint8Array | null {
  const m = /^data:([^,]*?)(;base64)?,(.*)$/is.exec(src);
  if (!m) {
    return null;
  }
  const body = m[3] ?? '';
  try {
    if (m[2]) {
      const bin = atob(body.replace(/\s+/g, ''));
      const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) {
        out[i] = bin.charCodeAt(i);
      }
      return out;
    }
    return new TextEncoder().encode(decodeURIComponent(body));
  } catch {
    return null;
  }
}

/**
 * node 加载器:本地路径从 <项目根>/public/ 读文件,http(s) 走 fetch,data: 自己解。
 * 图片只从文件头量原始尺寸,source 为 null(干跑不画)。
 */
export function nodeAssetLoader(options: NodeLoaderOptions = {}): AssetLoader {
  let root: string | null = options.root ?? null;
  const modules = (src: string, kind: 'image' | 'svg'): { fs: NodeFsLike; path: NodePathLike } => {
    const fs = builtin<NodeFsLike>('node:fs');
    const path = builtin<NodePathLike>('node:path');
    if (!fs || !path) {
      throw new AssetError(
        'network',
        src,
        `${what(kind)}「${src}」取不到:当前环境读不了文件(需要 node ≥ 20.16 的 process.getBuiltinModule)`,
      );
    }
    return { fs, path };
  };
  const publicRoot = (fs: NodeFsLike, path: NodePathLike): string => {
    if (root !== null) {
      return root;
    }
    /** 从 start 往上找第一个含 package.json 的目录。 */
    const projectOf = (start: string): string | null => {
      let dir = path.resolve(start);
      for (let hop = 0; hop < 64; hop++) {
        if (fs.existsSync(path.join(dir, 'package.json'))) {
          return dir;
        }
        const up = path.dirname(dir);
        if (up === dir) {
          return null;
        }
        dir = up;
      }
      return null;
    };
    const cwd = nodeProcess()?.cwd?.() ?? '.';
    const here = moduleDir();
    root = path.join((here !== null ? projectOf(here) : null) ?? projectOf(cwd) ?? path.resolve(cwd), 'public');
    return root;
  };

  const readBytes = async (src: string, kind: 'image' | 'svg'): Promise<Uint8Array> => {
    if (/^data:/i.test(src)) {
      const bytes = dataUrlBytes(src);
      if (!bytes) {
        throw decodeError(src);
      }
      return bytes;
    }
    if (/^(https?:)?\/\//i.test(src)) {
      const doFetch = options.fetch ?? (typeof fetch === 'function' ? fetch : null);
      if (!doFetch) {
        throw new AssetError('network', src, `${what(kind)}「${src}」取不到:当前环境没有 fetch`);
      }
      let res: Response;
      try {
        res = await doFetch(src.startsWith('//') ? `https:${src}` : src);
      } catch (e) {
        throw new AssetError('network', src, `${what(kind)}「${src}」取不到:网络错误`, { cause: e });
      }
      if (!res.ok) {
        throw httpError(src, kind, `HTTP ${res.status}`);
      }
      if (/text\/html/i.test(res.headers.get('content-type') ?? '') && !isHtmlPath(src)) {
        throw htmlFallbackError(src, kind);
      }
      return new Uint8Array(await res.arrayBuffer());
    }
    if (isUrlSrc(src)) {
      throw new AssetError('network', src, `${what(kind)}「${src}」取不到:node 里不支持这种地址`);
    }
    const { fs, path } = modules(src, kind);
    const base = publicRoot(fs, path);
    let rel: string;
    try {
      rel = decodeURIComponent(pathPart(src)).replace(/^\/+/, '');
    } catch {
      rel = pathPart(src).replace(/^\/+/, '');
    }
    const file = path.join(base, rel);
    const back = path.relative(base, file);
    if (back.startsWith('..') || path.isAbsolute(back)) {
      throw new AssetError('bad-path', src, `资源地址「${src}」越出了 public/ 目录`);
    }
    try {
      return fs.readFileSync(file);
    } catch (e) {
      const code = (e as { code?: unknown } | null)?.code;
      if (code === 'ENOENT' || code === 'EISDIR' || code === 'ENOTDIR') {
        // 与浏览器同一句提示(文件应放在 public/…),再补上 node 实际找的绝对路径。
        throw httpError(src, kind, 'HTTP 404', `node 里找不到 ${file}`);
      }
      throw new AssetError('network', src, `${what(kind)}「${src}」取不到:${e instanceof Error ? e.message : String(e)}`, {
        cause: e,
      });
    }
  };

  return {
    async loadText(src) {
      return new TextDecoder('utf-8').decode(await readBytes(src, 'svg'));
    },
    async loadImage(src) {
      const size = imageSizeFromBytes(await readBytes(src, 'image'));
      if (!size) {
        throw decodeError(src);
      }
      return { source: null, width: size.width, height: size.height };
    },
  };
}

/** node(process.versions.node 是字符串)→ nodeAssetLoader,否则 webAssetLoader。 */
export function defaultAssetLoader(): AssetLoader {
  return isNodeRuntime() ? nodeAssetLoader() : webAssetLoader();
}
