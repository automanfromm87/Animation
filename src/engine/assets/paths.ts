import { AssetError } from './errors';

/**
 * 资源地址:规范化(缓存键)与种类推断。注册表与加载器共用,单独成模块避免两者互相 import。
 */

export type AssetKind = 'image' | 'svg';

const PROTOCOL = /^[a-zA-Z][a-zA-Z0-9+.-]*:/;

/** 带协议(http: https: data: blob:)或协议相对(//host/…)的地址:原样使用,不当成 public/ 下的路径。 */
export function isUrlSrc(src: string): boolean {
  return PROTOCOL.test(src) || src.startsWith('//');
}

/** 去掉查询串与 #。 */
export function pathPart(src: string): string {
  const cut = src.search(/[?#]/);
  return cut < 0 ? src : src.slice(0, cut);
}

/**
 * 地址规范化(缓存键):
 * - 带协议的(http: https: data: blob:)与协议相对的原样(去首尾空白);
 * - 其余一律当成相对 public/ 的路径:去掉开头的 './' 与 '/',折叠 '.' / '..'(越出根目录抛 AssetError('bad-path')),
 *   前面补 '/'。所以 '/img/a.png'、'img/a.png'、'./img/a.png' 是同一个资源;查询串与 # 保留。
 * 页面部署在子路径(Vite base)时,加载器按 BASE_URL 拼真正的地址,作者照样写 '/img/a.png'。
 */
export function normalizeAssetSrc(src: string): string {
  const s = String(src).trim();
  if (isUrlSrc(s)) {
    return s;
  }
  const path = pathPart(s);
  const rest = s.slice(path.length);
  const out: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') {
      continue;
    }
    if (seg === '..') {
      if (out.length === 0) {
        throw new AssetError('bad-path', src, `资源地址「${src}」越出了 public/ 目录`);
      }
      out.pop();
      continue;
    }
    out.push(seg);
  }
  if (out.length === 0) {
    throw new AssetError('bad-path', src, `资源地址「${src}」是空的:要写 public/ 下的文件路径,如 '/img/earth.png'`);
  }
  return `/${out.join('/')}${rest}`;
}

/** 按地址推断种类:.svg(忽略查询串)与 data:image/svg+xml → 'svg',其余 'image'。 */
export function assetKindOf(src: string): AssetKind {
  const s = String(src).trim();
  if (/^data:image\/svg\+xml[;,]/i.test(s)) {
    return 'svg';
  }
  if (/^data:/i.test(s)) {
    return 'image';
  }
  return /\.svg$/i.test(pathPart(s)) ? 'svg' : 'image';
}

/** 报错里对种类的称呼。 */
export function kindName(kind: AssetKind): string {
  return kind === 'svg' ? 'SVG' : '图片';
}
