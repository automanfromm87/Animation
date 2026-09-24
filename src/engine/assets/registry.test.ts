import { installAssetStub } from '../../testing/assetStub';
import { equal, ok, rejects, suite } from '../../testing/harness';
import { Illustration } from '../mobjects/illustration';
import { AssetError } from './errors';
import { nodeAssetLoader, webAssetLoader } from './loaders';
import { assetKindOf, normalizeAssetSrc } from './paths';
import type { ImageAsset, SvgAsset } from './registry';
import {
  clearAssets,
  createImageAsset,
  getImage,
  getSvg,
  isAssetReady,
  loadImage,
  loadSvg,
  preloadAssets,
  setAssetLoader,
} from './registry';

const TEXT_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>hi</text><rect width="5" height="5"/></svg>';
const PLAIN_SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 10"><rect width="20" height="10"/></svg>';

/** 同步调用应当抛 AssetError,返回它(没抛返回 null)。 */
function assetErrorOf(fn: () => unknown): AssetError | null {
  try {
    fn();
  } catch (e) {
    return e instanceof AssetError ? e : null;
  }
  return null;
}

async function rejection(p: Promise<unknown>): Promise<AssetError | null> {
  try {
    await p;
  } catch (e) {
    return e instanceof AssetError ? e : null;
  }
  return null;
}

/** node 内置模块里测试用到的那一点(app 的 tsconfig 没有 node 类型)。 */
interface NodeFs {
  mkdtempSync(prefix: string): string;
  mkdirSync(path: string, options: { recursive: boolean }): unknown;
  writeFileSync(path: string, data: string | Uint8Array): void;
  rmSync(path: string, options: { recursive: boolean; force: boolean }): void;
}

/** 在临时目录里摆一个 public/ 目录(不依赖仓库里的真实素材),用完删掉。 */
async function withPublicDir(files: Readonly<Record<string, string | Uint8Array>>, body: (root: string) => Promise<void>): Promise<void> {
  const proc = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } }).process;
  const fs = proc?.getBuiltinModule?.('node:fs') as NodeFs | undefined;
  const os = proc?.getBuiltinModule?.('node:os') as { tmpdir(): string } | undefined;
  const path = proc?.getBuiltinModule?.('node:path') as { join(...parts: string[]): string; dirname(p: string): string } | undefined;
  if (!fs || !os || !path) {
    throw new Error('测试需要 node 的 process.getBuiltinModule');
  }
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mini-manim-assets-'));
  try {
    for (const [name, data] of Object.entries(files)) {
      const file = path.join(root, name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, data);
    }
    await body(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

/** 开发服务器对不存在的文件回的网页(Vite 的 index.html)。 */
const INDEX_HTML = '<!doctype html>\n<html lang="zh"><head><title>mini-manim</title></head><body><div id="root"></div></body></html>';

/** 捕获 console.warn(不打到输出里)。 */
async function captureWarn(body: () => Promise<void> | void): Promise<unknown[][]> {
  const warns: unknown[][] = [];
  const { warn } = console;
  console.warn = (...args: unknown[]): void => {
    warns.push(args);
  };
  try {
    await body();
  } finally {
    console.warn = warn;
  }
  return warns;
}

export default suite('资源 · 注册表与加载器', [
  [
    '地址规范化与种类推断',
    () => {
      equal(normalizeAssetSrc('/img/a.png'), '/img/a.png');
      equal(normalizeAssetSrc('img/a.png'), '/img/a.png');
      equal(normalizeAssetSrc('./img/../img/./a.png?v=2#x'), '/img/a.png?v=2#x');
      equal(normalizeAssetSrc(' https://cdn.test/a.png '), 'https://cdn.test/a.png');
      equal(normalizeAssetSrc('data:image/png;base64,AAAA'), 'data:image/png;base64,AAAA');
      equal(assetErrorOf(() => normalizeAssetSrc('../package.json'))?.code, 'bad-path');
      equal(assetErrorOf(() => normalizeAssetSrc('/'))?.code, 'bad-path');
      equal(assetKindOf('/svg/cat.SVG?v=1'), 'svg');
      equal(assetKindOf('data:image/svg+xml,<svg/>'), 'svg');
      equal(assetKindOf('data:image/png;base64,AAAA'), 'image');
      equal(assetKindOf('/img/a.png'), 'image');
    },
  ],
  [
    '缓存:同一地址只请求一次;并发共用一个 Promise;不同写法是同一条目',
    async () => {
      const stub = installAssetStub({ images: { '/img/a.png': { width: 200, height: 100 } } });
      try {
        const p1 = loadImage('/img/a.png');
        const p2 = loadImage('img/a.png');
        equal(p1, p2, '在途时共用一个 Promise');
        const a = await p1;
        const b = await loadImage('./img/a.png');
        equal(a, b);
        equal(stub.requests.length, 1);
        equal(a.width, 200);
        equal(a.src, '/img/a.png');
        equal(getImage('img/a.png'), a);
        ok(isAssetReady('/img/a.png'));
        ok(!isAssetReady('/img/a.png', 'svg'));
      } finally {
        stub.restore();
      }
    },
  ],
  [
    '同步取用:没加载 → not-loaded;加载中 → loading;种类不符 → kind-mismatch',
    async () => {
      const stub = installAssetStub({ texts: { '/svg/cat.svg': PLAIN_SVG }, delayMs: 5 });
      try {
        const missing = assetErrorOf(() => getImage('/img/earth.png'));
        equal(missing?.code, 'not-loaded');
        ok(missing?.message.includes("await loadImage('/img/earth.png')") ?? false, missing?.message);
        ok(missing?.message.includes('时间线会错位') ?? false);
        equal(assetErrorOf(() => getSvg('/svg/x.svg'))?.message.includes('loadSvg') ?? false, true);
        const pending = loadSvg('/svg/cat.svg');
        const loading = assetErrorOf(() => getSvg('/svg/cat.svg'));
        equal(loading?.code, 'loading');
        ok(loading?.message.includes('漏了 await') ?? false);
        await pending;
        equal(getSvg('/svg/cat.svg').document.viewBox?.width, 20);
        const mismatch = assetErrorOf(() => getImage('/svg/cat.svg'));
        equal(mismatch?.code, 'kind-mismatch');
        ok(mismatch?.message.includes("as: 'image'") ?? false, mismatch?.message);
      } finally {
        stub.restore();
      }
    },
  ],
  [
    '失败不缓存:404 之后把文件补上,重试成功',
    async () => {
      const stub = installAssetStub({ missing: ['/img/late.png'] });
      try {
        const e = await rejection(loadImage('/img/late.png'));
        equal(e?.code, 'http');
        ok(e?.message.includes('public/img/late.png') ?? false, e?.message);
        ok(!isAssetReady('/img/late.png'));
        stub.addImage('/img/late.png', 10, 20);
        equal((await loadImage('/img/late.png')).height, 20);
        equal(stub.requests.length, 2);
      } finally {
        stub.restore();
      }
    },
  ],
  [
    'preloadAssets:种类推断、as 覆盖、按输入顺序返回;一个失败抛原错误,多个抛 batch',
    async () => {
      const stub = installAssetStub({
        images: { '/img/a.png': { width: 4, height: 2 } },
        texts: { '/svg/b.svg': PLAIN_SVG },
      });
      try {
        const [a, b, c] = await preloadAssets(['/img/a.png', '/svg/b.svg', { src: '/svg/b.svg', as: 'image' }]);
        // 字面量数组:返回逐项类型精确的元组(下面几行本身就是类型检查,推断错了 tsc 不过)。
        const image: ImageAsset = a;
        const vector: SvgAsset = b;
        const bitmap: ImageAsset = c;
        equal(image.kind, 'image');
        equal(vector.kind, 'svg');
        equal(bitmap.kind, 'image');
        equal(bitmap.width, 20, 'SVG 当位图用:尺寸按 SVG 自己的规则');
        ok(isAssetReady('/svg/b.svg', 'image') && isAssetReady('/svg/b.svg', 'svg'));
        const one = await rejection(preloadAssets(['/img/a.png', '/img/nope.png']));
        equal(one?.code, 'http');
        // 地址形态推断:查询串 / # 之前的扩展名、大小写、data:;非字面量的数组退回 Asset。
        stub.addText('/svg/q.svg?v=2#top', PLAIN_SVG);
        stub.addText('/svg/Q.SVG', PLAIN_SVG);
        stub.addImage('/img/pic?name=x.svg', 3, 3);
        const [q, upper, notSvg] = await preloadAssets(['/svg/q.svg?v=2#top', { src: '/svg/Q.SVG' }, '/img/pic?name=x.svg']);
        const qa: SvgAsset = q;
        const up: SvgAsset = upper;
        const pic: ImageAsset = notSvg;
        equal(qa.document.viewBox?.width, 20);
        equal(up.kind, 'svg');
        equal(pic.kind, 'image', '查询串里的 .svg 不算扩展名');
        const dynamic: string[] = ['/img/a.png'];
        const loose = await preloadAssets(dynamic);
        equal(loose[0]?.kind, 'image');
        const many = await rejection(preloadAssets(['/img/x.png', '/svg/y.svg', '/img/a.png']));
        equal(many?.code, 'batch');
        equal(many?.failures.length, 2);
        ok(many?.message.startsWith('有 2 个资源没能加载:\n· 图片「/img/x.png」') ?? false, many?.message);
        ok(many?.message.includes('· SVG「/svg/y.svg」取不到') ?? false, many?.message);
      } finally {
        stub.restore();
      }
    },
  ],
  [
    'SVG 解析失败 → parse;加载器抛的普通错误被包成 AssetError',
    async () => {
      const stub = installAssetStub({ texts: { '/svg/bad.svg': '<svg><g></svg>' } });
      try {
        const e = await rejection(loadSvg('/svg/bad.svg'));
        equal(e?.code, 'parse');
        ok(e?.message.startsWith('SVG「/svg/bad.svg」解析失败:') ?? false, e?.message);
      } finally {
        stub.restore();
      }
      setAssetLoader({
        loadImage: () => Promise.reject(new Error('boom')),
        loadText: () => Promise.reject(new Error('boom')),
      });
      try {
        const e = await rejection(loadImage('/img/a.png'));
        equal(e?.code, 'network');
        ok(e?.message.includes('boom') ?? false);
        setAssetLoader({ loadImage: async () => ({ source: null, width: 0, height: 5 }), loadText: async () => '' });
        equal((await rejection(loadImage('/img/z.png')))?.code, 'size');
      } finally {
        setAssetLoader(null);
      }
    },
  ],
  [
    '代次:加载途中清缓存,旧加载完成后不写进新缓存(但仍交给当初的调用方)',
    async () => {
      const stub = installAssetStub({ images: { '/img/a.png': { width: 1, height: 1 } }, delayMs: 5 });
      try {
        const p = loadImage('/img/a.png');
        clearAssets();
        const asset = await p;
        equal(asset.width, 1);
        ok(!isAssetReady('/img/a.png'), '清缓存之后在途的旧加载不该写回');
      } finally {
        stub.restore();
      }
    },
  ],
  [
    '不支持的内容每份资源只告警一次(之后再建多少个插画都不说)',
    async () => {
      const stub = installAssetStub({ texts: { '/svg/t.svg': TEXT_SVG } });
      try {
        const warns = await captureWarn(async () => {
          const asset = await loadSvg('/svg/t.svg');
          await loadSvg('/svg/t.svg');
          for (let i = 0; i < 5; i++) {
            new Illustration(asset, { width: 100 });
            new Illustration('/svg/t.svg', { width: 50 + i });
          }
        });
        equal(warns.length, 1);
        equal(String(warns[0]?.[0]), '[svg] 「/svg/t.svg」里有不支持的内容,已忽略:<text>×1(文字请用 Label / Tex 叠在插画上)');
      } finally {
        stub.restore();
      }
    },
  ],
  [
    '缺省 node 加载器能找到项目的 public/(冒烟:只看 /favicon.svg 能读出来,不管它长什么样)',
    async () => {
      setAssetLoader(nodeAssetLoader());
      try {
        const svg = await loadSvg('/favicon.svg');
        equal(svg.kind, 'svg');
        const img = await loadImage('/favicon.svg');
        equal(img.source, null, 'node 里只量尺寸');
        ok(img.width > 0 && img.height > 0);
      } finally {
        setAssetLoader(null);
      }
    },
  ],
  [
    'node 加载器:从 public/ 读文件、只量尺寸;子目录与百分号编码;404 提示 public;越界路径 bad-path;data: 自己解',
    async () => {
      const logo = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 32"><rect width="64" height="32"/></svg>';
      const badge = '<svg xmlns="http://www.w3.org/2000/svg"><text>NEW</text></svg>';
      await withPublicDir({ 'svg/logo.svg': logo, 'img/my badge.svg': badge }, async (root) => {
        setAssetLoader(nodeAssetLoader({ root }));
        try {
          const svg = await loadSvg('/svg/logo.svg');
          equal(svg.document.viewBox?.width, 64);
          const img = await loadImage('svg/logo.svg');
          equal(img.source, null);
          equal(`${img.width}x${img.height}`, '64x32');
          const text = await loadImage('/img/my%20badge.svg');
          equal(`${text.width}x${text.height}`, '300x150', '量不出尺寸的 SVG 当位图:300×150,与浏览器加载器一致');
          const missing = await rejection(loadImage('/nope.png'));
          equal(missing?.code, 'http');
          ok(missing?.message.includes('public') ?? false, missing?.message);
          equal((await rejection(loadImage('/%2e%2e/package.json')))?.code, 'bad-path');
        } finally {
          setAssetLoader(null);
        }
      });
      setAssetLoader(nodeAssetLoader());
      try {
        const inline = await loadSvg(`data:image/svg+xml,${encodeURIComponent('<svg viewBox="0 0 8 4"/>')}`);
        equal(inline.document.viewBox?.height, 4);
        // 1×1 PNG(base64)。
        const png = await loadImage(
          'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
        );
        equal(`${png.width}x${png.height}`, '1x1');
        equal((await rejection(loadImage('blob:http://x/1')))?.code, 'network');
      } finally {
        setAssetLoader(null);
      }
    },
  ],
  [
    '浏览器加载器:按 base 拼地址、CORS 取字节、404 / 跨源网络错误的说明、createImageBitmap 失败退回 <img>',
    async () => {
      const requested: Array<{ url: string; init: RequestInit | undefined }> = [];
      const images: Array<{ src: string }> = [];
      const blobs: Blob[] = [];
      let bitmapFails = false;
      const loader = webAssetLoader({
        base: 'https://app.test/sub/',
        origin: 'https://app.test',
        fetch: async (url, init) => {
          requested.push({ url, init });
          if (url.includes('missing')) {
            return new Response('no', { status: 404 });
          }
          if (url.startsWith('https://cdn.other')) {
            throw new TypeError('Failed to fetch');
          }
          if (url.endsWith('.svg')) {
            return new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 15"><rect width="30" height="15"/></svg>', {
              headers: { 'content-type': 'image/svg+xml' },
            });
          }
          return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
        },
        createImageBitmap: async () => {
          if (bitmapFails) {
            throw new Error('nope');
          }
          return { width: 64, height: 48, close: () => undefined } as unknown as ImageBitmap;
        },
        createImage: () => {
          const img = { src: '', crossOrigin: null, decoding: 'auto', naturalWidth: 7, naturalHeight: 5, decode: async () => undefined };
          images.push(img);
          return img as unknown as HTMLImageElement;
        },
        createObjectURL: (blob) => {
          blobs.push(blob);
          return `blob:https://app.test/${blobs.length}`;
        },
      });
      const png = await loader.loadImage('/img/a.png');
      equal(requested[0]?.url, 'https://app.test/sub/img/a.png');
      equal(requested[0]?.init?.mode, 'cors');
      equal(`${png.width}x${png.height}`, '64x48');
      bitmapFails = true;
      const fallback = await loader.loadImage('/img/b.png');
      equal(`${fallback.width}x${fallback.height}`, '7x5', 'createImageBitmap 失败 → <img>');
      equal(images[0]?.src, 'blob:https://app.test/1');
      // SVG 当位图:尺寸来自 SVG 文本(不是 naturalWidth),并写回根元素。
      const svg = await loader.loadImage('/svg/c.svg');
      equal(`${svg.width}x${svg.height}`, '30x15');
      const sizedText = await blobs[1]?.text();
      ok(sizedText?.includes('width="30" height="15"') ?? false, sizedText);
      equal(await loader.loadText('/svg/c.svg').then((t) => t.includes('viewBox')), true);
      const notFound = await rejection(loader.loadImage('/img/missing.png'));
      equal(notFound?.code, 'http');
      equal(notFound?.message, '图片「/img/missing.png」取不到:HTTP 404(文件应放在 public/img/missing.png)');
      const cors = await rejection(loader.loadImage('https://cdn.other/x.png'));
      equal(cors?.code, 'network');
      ok(cors?.message.includes('CORS') ?? false, cors?.message);
      await rejects(() => loader.loadText('/svg/missing.svg'));
    },
  ],
  [
    '浏览器加载器:开发服务器拿 index.html(200)顶替不存在的文件时按 404 报,不报「根元素是 <html>」「解码失败」',
    async () => {
      let contentType: string | null = 'text/html; charset=utf-8';
      const loader = webAssetLoader({
        base: 'https://app.test/',
        origin: 'https://app.test',
        // 没有 content-type 时用字节体(字符串体会被自动标成 text/plain)。
        fetch: async () =>
          contentType
            ? new Response(INDEX_HTML, { headers: { 'content-type': contentType } })
            : new Response(new TextEncoder().encode(INDEX_HTML)),
        createImageBitmap: async () => {
          throw new Error('不该走到解码');
        },
        createImage: () => {
          throw new Error('不该走到解码');
        },
        createObjectURL: () => 'blob:x',
      });
      for (const header of ['text/html; charset=utf-8', null]) {
        contentType = header;
        const svg = await rejection(loader.loadText('/svg/cat.svg'));
        equal(svg?.code, 'http', `content-type ${String(header)}`);
        ok(svg?.message.startsWith('SVG「/svg/cat.svg」取不到:HTTP 404(文件应放在 public/svg/cat.svg;') ?? false, svg?.message);
        ok(svg?.message.includes('index.html') ?? false, svg?.message);
        const png = await rejection(loader.loadImage('/img/earth.png'));
        equal(png?.code, 'http', `content-type ${String(header)}`);
        ok(png?.message.startsWith('图片「/img/earth.png」取不到:HTTP 404(文件应放在 public/img/earth.png;') ?? false, png?.message);
        const asImage = await rejection(loader.loadImage('/svg/cat.svg'));
        equal(asImage?.code, 'http', 'SVG 当位图用同样认得出');
      }
      contentType = 'text/html';
      const remote = await rejection(loader.loadImage('https://cdn.test/x.png'));
      equal(remote?.code, 'http');
      ok(remote?.message.includes('不是图片') ?? false, remote?.message);
      // 地址本来就是网页时不拦(虽然当资源用照样会在解析时报错)。
      equal(await loader.loadText('/pages/about.html'), INDEX_HTML);
    },
  ],
  [
    '浏览器加载器:SVG 当位图解码后探一次画布污染,会污染就在预加载时报 tainted',
    async () => {
      let clean = false;
      const loader = webAssetLoader({
        base: 'https://app.test/',
        origin: 'https://app.test',
        fetch: async () =>
          new Response('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 2"><rect width="4" height="2"/></svg>', {
            headers: { 'content-type': 'image/svg+xml' },
          }),
        createImage: () =>
          ({ src: '', crossOrigin: null, decoding: 'auto', naturalWidth: 4, naturalHeight: 2, decode: async () => undefined }) as unknown as HTMLImageElement,
        createObjectURL: () => 'blob:x',
        isOriginClean: () => clean,
      });
      const tainted = await rejection(loader.loadImage('/svg/logo.svg'));
      equal(tainted?.code, 'tainted');
      ok(tainted?.message.includes('Illustration') ?? false, tainted?.message);
      clean = true;
      equal((await loader.loadImage('/svg/logo.svg')).width, 4);
    },
  ],
  [
    'createImageAsset:尺寸非法抛错;node 里不做探针直接包',
    () => {
      equal(assetErrorOf(() => createImageAsset({} as CanvasImageSource, 0, 5))?.code, 'size');
      const a = createImageAsset({} as CanvasImageSource, 3, 4, 'gen');
      equal(`${a.src} ${a.width}x${a.height}`, 'gen 3x4');
      ok(Object.isFrozen(a));
    },
  ],
]);
