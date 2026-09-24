import { Create, Indicate, Write, loadImage, loadSvg } from '../engine';
import { directedSegment } from './segments';
import type { Segment } from './types';
import { illustration, picture, stage, unrevealed } from './helpers';

/**
 * 测试夹具:照作者的写法在影片模块顶层 await 资源(node 里由缺省的 node 加载器取),
 * 分段脚本里用资源句柄同步构造。content 测试、check-film、voice 工具都是静态 / 动态 import 影片模块,
 * 顶层 await 让它们零接线地等到资源。
 * 资源用 data: 地址内嵌在这里,不依赖 public/ 里的产品素材(换 favicon 不该让测试挂掉);
 * 缺省加载器从 public/ 读文件由注册表测试的冒烟用例覆盖。
 */
const LOGO = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#141414"/>' +
    '<circle cx="22" cy="32" r="12" fill="none" stroke="#f5f5f5" stroke-width="3"/>' +
    '<path d="M34 32 C38 20 42 20 46 32 S54 44 58 32" fill="none" stroke="#7fb2ff" stroke-width="3" stroke-linecap="round"/></svg>',
)}`;

export const LOGO_SVG = await loadSvg(LOGO);
/** 同一个 SVG 当位图用(node 里只量尺寸,不画)。 */
export const LOGO_IMAGE = await loadImage(LOGO);

const intro = directedSegment('资源夹具', 4, [{ start: 0, end: 3, text: '图片与插画' }], async (env) => {
  const logo = illustration(LOGO_SVG, 160, { x: -120, y: 0 });
  const pic = picture(LOGO_IMAGE, 120, { x: 120, y: 0 });
  unrevealed(logo, pic);
  stage(env.scene, [logo, pic], 40);
  await env.play(new Create(logo, { runTime: 1 }), new Create(pic, { runTime: 1 }));
  await env.play(new Indicate(logo.parts[0] ?? logo, { runTime: 1 }));
  await env.play(new Write(logo, { runTime: 1 }));
  await env.wait(1);
});

export const assetFilm: Segment[] = [intro];
