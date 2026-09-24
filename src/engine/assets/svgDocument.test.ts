import { close, equal, ok, suite } from '../../testing/harness';
import type { PathBounds, PathData } from '../path/path';
import { pathBounds } from '../path/path';
import { parseDeclarations, parseStyleSheet } from './css';
import { AssetError } from './errors';
import { parseSvgColor } from './svgColor';
import type { SvgDocument, SvgGroupNode, SvgNode, SvgShapeNode } from './svgDocument';
import { parseSvgDocument, svgArtboard, svgIntrinsicSize, svgWithIntrinsicSize, unsupportedWarning } from './svgDocument';
import { evenOddAsNonZero, parseLength, parseTransform, viewBoxTransform } from './svgGeometry';

function shapesOf(nodes: readonly SvgNode[], out: SvgShapeNode[] = []): SvgShapeNode[] {
  for (const n of nodes) {
    if (n.type === 'shape') {
      out.push(n);
    } else {
      shapesOf(n.children, out);
    }
  }
  return out;
}

function shapes(doc: SvgDocument): SvgShapeNode[] {
  return shapesOf(doc.children);
}

function only(text: string): SvgShapeNode {
  const list = shapes(parseSvgDocument(text));
  equal(list.length, 1, `期望 1 个形状,实际 ${list.length}`);
  const s = list[0];
  if (!s) {
    throw new Error('没有形状');
  }
  return s;
}

function boundsOf(path: PathData): PathBounds {
  const b = pathBounds(path);
  ok(b !== null, '路径是空的');
  return b ?? { minX: NaN, minY: NaN, maxX: NaN, maxY: NaN };
}

function sameBounds(actual: PathData, want: PathBounds, tol = 1e-9, what = '包围盒'): void {
  const b = boundsOf(actual);
  close(b.minX, want.minX, tol, `${what} minX:${b.minX}`);
  close(b.minY, want.minY, tol, `${what} minY:${b.minY}`);
  close(b.maxX, want.maxX, tol, `${what} maxX:${b.maxX}`);
  close(b.maxY, want.maxY, tol, `${what} maxY:${b.maxY}`);
}

function svg(body: string, attrs = 'viewBox="0 0 100 100"'): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
}

function fillColor(s: SvgShapeNode): string {
  return s.fill.kind === 'color' ? s.fill.color : s.fill.kind;
}

/** nonzero 绕数:按采样把三次段折成线段,数有向穿越。 */
function winding(path: PathData, x: number, y: number): number {
  let w = 0;
  for (const sub of path.subpaths) {
    const p = sub.points;
    const pts: Array<[number, number]> = [[p[0] ?? 0, p[1] ?? 0]];
    for (let i = 2; i + 5 < p.length; i += 6) {
      const x0 = p[i - 2] ?? 0;
      const y0 = p[i - 1] ?? 0;
      for (let k = 1; k <= 16; k++) {
        const t = k / 16;
        const u = 1 - t;
        pts.push([
          u * u * u * x0 + 3 * u * u * t * (p[i] ?? 0) + 3 * u * t * t * (p[i + 2] ?? 0) + t * t * t * (p[i + 4] ?? 0),
          u * u * u * y0 + 3 * u * u * t * (p[i + 1] ?? 0) + 3 * u * t * t * (p[i + 3] ?? 0) + t * t * t * (p[i + 5] ?? 0),
        ]);
      }
    }
    for (let i = 0; i < pts.length; i++) {
      const [ax, ay] = pts[i] ?? [0, 0];
      const [bx, by] = pts[(i + 1) % pts.length] ?? [0, 0];
      const cross = (bx - ax) * (y - ay) - (x - ax) * (by - ay);
      if (ay <= y && by > y && cross > 0) {
        w += 1;
      } else if (ay > y && by <= y && cross < 0) {
        w -= 1;
      }
    }
  }
  return w;
}

function parseFails(text: string): AssetError | null {
  try {
    parseSvgDocument(text, 'cat.svg');
  } catch (e) {
    return e instanceof AssetError ? e : null;
  }
  return null;
}

export default suite('资源 · SVG 文档解析', [
  [
    '形状 → 路径:rect(圆角规范与钳制)、circle、ellipse、line、polyline、polygon、path',
    () => {
      sameBounds(only(svg('<rect x="10" y="20" width="30" height="40"/>')).path, { minX: 10, minY: 20, maxX: 40, maxY: 60 });
      const rounded = only(svg('<rect width="40" height="20" ry="5"/>'));
      sameBounds(rounded.path, { minX: 0, minY: 0, maxX: 40, maxY: 20 });
      // 只给 ry:rx 同值,起点在 (rx, 0)。
      equal(rounded.path.subpaths[0]?.points[0], 5);
      // rx 超过半宽被钳到半宽:左右两个半圆,没有零长直边。
      const pill = only(svg('<rect width="20" height="10" rx="50" ry="5"/>'));
      sameBounds(pill.path, { minX: 0, minY: 0, maxX: 20, maxY: 10 });
      equal(pill.path.subpaths[0]?.points[0], 10);
      const circle = only(svg('<circle cx="50" cy="40" r="10"/>'));
      equal(circle.path.subpaths[0]?.points[0], 60);
      equal(circle.path.subpaths[0]?.points[1], 40);
      equal(circle.path.subpaths[0]?.closed, true);
      sameBounds(circle.path, { minX: 40, minY: 30, maxX: 60, maxY: 50 }, 1e-6);
      sameBounds(only(svg('<ellipse cx="0" cy="0" rx="20" ry="5"/>')).path, { minX: -20, minY: -5, maxX: 20, maxY: 5 }, 1e-6);
      const line = only(svg('<line x1="0" y1="0" x2="10" y2="5" fill="red" stroke="red"/>'));
      equal(line.fill.kind, 'none', 'line 永远不填充');
      const poly = only(svg('<polyline points="0,0 10,0 10,10 5"/>'));
      equal(poly.path.subpaths[0]?.points.length, 2 + 6 * 2, '奇数个坐标丢掉最后一个');
      equal(poly.path.subpaths[0]?.closed, false);
      equal(poly.fill.kind, 'ink', 'polyline 按规范也会被缺省填充');
      equal(only(svg('<polygon points="0 0 10 0 10 10"/>')).path.subpaths[0]?.closed, true);
      sameBounds(only(svg('<path d="M10 10 h20 v5 z"/>')).path, { minX: 10, minY: 10, maxX: 30, maxY: 15 });
      // 不画的形状不产生部件。
      equal(shapes(parseSvgDocument(svg('<rect width="0" height="5"/><circle r="0"/><polyline points="1 2"/>'))).length, 0);
    },
  ],
  [
    'transform:顺序、rotate 绕点、matrix、skewX、嵌套组合成;非法的整个忽略并计数',
    () => {
      sameBounds(
        only(svg('<g transform="translate(10,20)"><rect transform="rotate(90)" width="10" height="5"/></g>')).path,
        { minX: 5, minY: 20, maxX: 10, maxY: 30 },
      );
      sameBounds(only(svg('<rect x="60" y="50" width="0.000001" height="0.000001" transform="rotate(90 50 50)"/>')).path, {
        minX: 49.999999,
        minY: 60,
        maxX: 50,
        maxY: 60.000001,
      }, 1e-9);
      sameBounds(only(svg('<rect width="1" height="1" transform="matrix(2 0 0 3 1 1)"/>')).path, { minX: 1, minY: 1, maxX: 3, maxY: 4 });
      const skew = parseTransform('skewX(45)');
      ok(skew !== null);
      close(skew?.[2] ?? 0, 1, 1e-12);
      const m = parseTransform('translate(10) scale(2, 3)');
      equal(m?.join(','), '2,0,0,3,10,0');
      equal(parseTransform('translate(10'), null);
      equal(parseTransform('rotate(1 2)'), null);
      const doc = parseSvgDocument(svg('<rect width="10" height="10" transform="translate(10"/>'));
      sameBounds(shapes(doc)[0]?.path ?? { subpaths: [] }, { minX: 0, minY: 0, maxX: 10, maxY: 10 });
      equal(doc.unsupported.join(' | '), '非法 transform×1');
    },
  ],
  [
    '长度单位与百分比',
    () => {
      close(parseLength('10mm', 'x', null) ?? NaN, 37.79527559, 1e-6);
      equal(parseLength('1in', 'x', null), 96);
      equal(parseLength('3pt', 'x', null), 4);
      equal(parseLength('50%', 'x', null), null);
      equal(parseLength('50%', 'y', { w: 200, h: 100 }), 50);
      equal(parseLength('1furlong', 'x', null), null);
      const doc = parseSvgDocument(svg('<rect width="50%" height="25%"/>', 'viewBox="0 0 200 100"'));
      sameBounds(shapes(doc)[0]?.path ?? { subpaths: [] }, { minX: 0, minY: 0, maxX: 100, maxY: 25 });
    },
  ],
  [
    '画板与原始尺寸:viewBox、width/height(带单位)、只给一个、%、内容兜底、非法 viewBox',
    () => {
      const size = (attrs: string, body = ''): string => {
        const s = svgIntrinsicSize(parseSvgDocument(svg(body, attrs)));
        return s ? `${Math.round(s.width * 1000) / 1000}x${Math.round(s.height * 1000) / 1000}` : 'null';
      };
      equal(size('viewBox="0 0 64 32"'), '64x32');
      equal(size('width="1in" height="48pt" viewBox="0 0 10 10"'), '96x64');
      equal(size('width="200" viewBox="0 0 100 50"'), '200x100');
      equal(size('height="10" viewBox="0 0 100 50"'), '20x10');
      equal(size('width="100%" viewBox="0 0 30 10"'), '30x10');
      equal(size('', '<rect x="10" y="10" width="40" height="20"/>'), '50x30', '没有 viewBox 也没有尺寸:从原点量到内容右下角');
      equal(size('', '<rect x="-40" y="-30" width="20" height="10"/>'), '20x10', '内容全在负半轴:紧包围盒');
      equal(size(''), 'null');
      const bad = parseSvgDocument(svg('<rect width="5" height="5"/>', 'viewBox="0 0 0 10"'));
      equal(bad.viewBox, null);
      ok(bad.unsupported.includes('非法 viewBox×1'));
      // 画板映射:负半轴内容平移到左上角。
      const board = svgArtboard(parseSvgDocument(svg('<rect x="-40" y="-30" width="20" height="10"/>', '')));
      equal(board?.transform.join(','), '1,0,0,1,40,30');
    },
  ],
  [
    'preserveAspectRatio:各 align、meet / slice、none',
    () => {
      const vb = { x: 0, y: 0, width: 100, height: 50 };
      equal(viewBoxTransform(vb, 200, 200, { align: 'xMidYMid', slice: false }).join(','), '2,0,0,2,0,50');
      equal(viewBoxTransform(vb, 200, 200, { align: 'xMinYMin', slice: false }).join(','), '2,0,0,2,0,0');
      equal(viewBoxTransform(vb, 200, 200, { align: 'xMaxYMax', slice: false }).join(','), '2,0,0,2,0,100');
      equal(viewBoxTransform(vb, 200, 200, { align: 'xMidYMid', slice: true }).join(','), '4,0,0,4,-100,0');
      equal(viewBoxTransform(vb, 200, 200, { align: 'none', slice: false }).join(','), '2,0,0,4,0,0');
      equal(viewBoxTransform({ x: 10, y: 5, width: 10, height: 10 }, 20, 20, { align: 'xMidYMid', slice: false }).join(','), '2,0,0,2,-20,-10');
      const doc = parseSvgDocument(svg('', 'width="200" height="200" viewBox="0 0 100 50" preserveAspectRatio="xMinYMax meet"'));
      equal(svgArtboard(doc)?.transform.join(','), '2,0,0,2,0,100');
    },
  ],
  [
    '层叠:呈现属性 < <style>(特异性、先后)< style="";继承与 inherit',
    () => {
      const sheet = '<style>.a{fill:blue} #x{fill:green} rect{fill:yellow} .b{fill:red}</style>';
      equal(fillColor(only(svg(`${sheet}<rect class="a" fill="black" width="1" height="1"/>`))), 'rgb(0, 0, 255)');
      equal(fillColor(only(svg(`${sheet}<rect id="x" class="a" width="1" height="1"/>`))), 'rgb(0, 128, 0)');
      equal(fillColor(only(svg(`${sheet}<rect class="a" style="fill: #000 !important" width="1" height="1"/>`))), 'rgb(0, 0, 0)');
      equal(fillColor(only(svg(`${sheet}<rect class="a b" width="1" height="1"/>`))), 'rgb(255, 0, 0)', '同特异性后者优先');
      equal(fillColor(only(svg(`${sheet}<rect width="1" height="1"/>`))), 'rgb(255, 255, 0)');
      equal(fillColor(only(svg('<g fill="red"><rect width="1" height="1"/></g>'))), 'rgb(255, 0, 0)');
      equal(fillColor(only(svg('<g fill="red"><g fill="blue"><rect fill="inherit" width="1" height="1"/></g></g>'))), 'rgb(0, 0, 255)');
      // 根元素上的呈现属性同样往下继承。
      equal(fillColor(only(svg('<rect width="1" height="1"/>', 'viewBox="0 0 1 1" fill="#00ff00"'))), 'rgb(0, 255, 0)');
      // 复合选择器 tag.class#id。
      equal(fillColor(only(svg('<style>rect.a#k{fill:red}</style><rect id="k" class="a" width="1" height="1"/>'))), 'rgb(255, 0, 0)');
      // 不支持的选择器忽略并计数,其余照常。
      const doc = parseSvgDocument(svg('<style>g > rect { fill: red } .a, g rect { fill: blue } @media print { rect { fill: green } }</style><rect class="a" width="1" height="1"/>'));
      equal(fillColor(shapes(doc)[0] as SvgShapeNode), 'rgb(0, 0, 255)');
      equal(doc.unsupported.join(' | '), 'CSS 选择器「g > rect」×1 | CSS 选择器「g rect」×1 | @media×1');
    },
  ],
  [
    'CSS 声明与样式表小件:注释、!important、括号里的分号',
    () => {
      const d = parseDeclarations('fill: url("data:x;y") ; /* c */ Stroke-Width : 2px !important;;bad');
      equal(d.get('fill'), 'url("data:x;y")');
      equal(d.get('stroke-width'), '2px');
      equal(d.size, 2);
      const sheet = parseStyleSheet('<!-- @charset "utf-8"; .a,.b{fill:red} -->');
      equal(sheet.rules.length, 2);
      equal(sheet.unsupported.length, 0);
    },
  ],
  [
    '颜色:命名色、hsl()、#rgba、transparent、currentColor、没写 fill → 墨色',
    () => {
      equal(fillColor(only(svg('<rect fill="red" width="1" height="1"/>'))), 'rgb(255, 0, 0)');
      equal(fillColor(only(svg('<rect fill="RebeccaPurple" width="1" height="1"/>'))), 'rgb(102, 51, 153)');
      equal(fillColor(only(svg('<rect fill="hsl(120,100%,25%)" width="1" height="1"/>'))), 'rgb(0, 128, 0)');
      equal(fillColor(only(svg('<rect fill="hsla(240 100% 50% / 50%)" width="1" height="1"/>'))), 'rgba(0, 0, 255, 0.5)');
      equal(fillColor(only(svg('<rect fill="#0f08" width="1" height="1"/>'))), 'rgba(0, 255, 0, 0.533)');
      equal(only(svg('<rect fill="transparent" stroke="red" width="1" height="1"/>')).fill.kind, 'none');
      const ink = only(svg('<rect fill="currentColor" stroke="currentColor" width="1" height="1"/>'));
      equal(ink.fill.kind, 'ink');
      equal(ink.stroke.kind, 'ink');
      const implicit = only(svg('<rect width="1" height="1"/>'));
      equal(implicit.fill.kind, 'ink', '整条链都没写 fill:跟随墨色');
      equal(implicit.stroke.kind, 'none', 'stroke 缺省不描边');
      equal(fillColor(only(svg('<g color="blue"><rect fill="currentColor" width="1" height="1"/></g>'))), 'rgb(0, 0, 255)');
      equal(parseSvgColor('nonsense'), null);
      const bad = parseSvgDocument(svg('<rect fill="nonsense" width="1" height="1"/>'));
      equal(shapes(bad)[0]?.fill.kind, 'ink', '认不出的颜色当没写');
      equal(bad.unsupported.join(' | '), '颜色「nonsense」×1');
    },
  ],
  [
    '不透明度:opacity 逐级相乘(不继承),fill-opacity 继承,都烘焙进颜色 / 墨色 alpha',
    () => {
      equal(fillColor(only(svg('<g opacity="0.5"><rect fill="#f00" opacity="0.5" width="1" height="1"/></g>'))), 'rgba(255, 0, 0, 0.25)');
      equal(fillColor(only(svg('<g fill-opacity="0.5"><rect fill="red" width="1" height="1"/></g>'))), 'rgba(255, 0, 0, 0.5)');
      equal(fillColor(only(svg('<rect fill="red" fill-opacity="50%" opacity=".5" width="1" height="1"/>'))), 'rgba(255, 0, 0, 0.25)');
      const ink = only(svg('<g opacity="0.5"><rect width="1" height="1"/></g>'));
      ok(ink.fill.kind === 'ink' && ink.fill.alpha === 0.5);
    },
  ],
  [
    '线宽跟着变换缩放;non-scaling-stroke;虚线;线帽 / 线连 / miterLimit 缺省',
    () => {
      equal(only(svg('<rect stroke="red" stroke-width="3" transform="scale(2)" width="1" height="1"/>')).strokeWidth, 6);
      equal(only(svg('<rect stroke="red" stroke-width="3" transform="scale(2, 8)" width="1" height="1"/>')).strokeWidth, 12);
      const ns = only(svg('<rect stroke="red" stroke-width="3" vector-effect="non-scaling-stroke" transform="scale(2)" width="1" height="1"/>'));
      equal(ns.strokeWidth, 3);
      equal(ns.nonScalingStroke, true);
      const dashed = only(svg('<g transform="scale(2)"><line x2="10" stroke="red" stroke-dasharray="1 2 3"/></g>'));
      equal(dashed.dash?.join(','), '2,4,6,2,4,6');
      equal(only(svg('<line x2="1" stroke="red" stroke-dasharray="1,-2"/>')).dash, null);
      equal(only(svg('<line x2="1" stroke="red" stroke-dasharray="0 0"/>')).dash, null);
      const d = only(svg('<line x2="1" stroke="red"/>'));
      equal(`${d.lineCap}/${d.lineJoin}/${d.miterLimit}`, 'butt/miter/4');
      const r = only(svg('<line x2="1" stroke="red" stroke-linecap="round" stroke-linejoin="arcs" stroke-miterlimit="8"/>'));
      equal(`${r.lineCap}/${r.lineJoin}/${r.miterLimit}`, 'round/miter/8');
      equal(only(svg('<g stroke-width="4"><line x2="1" stroke="red"/></g>')).strokeWidth, 4, 'stroke-width 继承');
    },
  ],
  [
    'evenodd:同向的同心方框 → 内框反向,nonzero 结果等于 evenodd;nonzero 原样',
    () => {
      const d = 'M0 0 H100 V100 H0 Z M25 25 H75 V75 H25 Z M40 40 H60 V60 H40 Z';
      const eo = only(svg(`<path fill-rule="evenodd" fill="red" d="${d}"/>`)).path;
      equal(winding(eo, 10, 10) !== 0, true, '外环里:填充');
      equal(winding(eo, 30, 30), 0, '洞里:不填');
      equal(winding(eo, 50, 50) !== 0, true, '洞里的岛:填充');
      const nz = only(svg(`<path fill="red" d="${d}"/>`)).path;
      equal(winding(nz, 30, 30) !== 0, true, 'nonzero 原样:同向方框洞也被填上');
      // 已经是正确朝向的 evenodd 不改(同一个对象)。
      const ok2 = evenOddAsNonZero(eo);
      equal(ok2, eo);
    },
  ],
  [
    '<use> / <defs> / <symbol>:平移副本、引用组、环跳过、实例内部 id 不登记',
    () => {
      const doc = parseSvgDocument(
        svg(
          '<defs><circle id="c" r="5" fill="red"/><g id="pair"><rect id="inner" width="2" height="2"/></g>' +
            '<symbol id="sym" viewBox="0 0 10 10"><rect width="10" height="10"/></symbol></defs>' +
            '<use id="u1" href="#c" x="10" y="20"/><use xlink:href="#pair" transform="translate(50 0)"/>' +
            '<use href="#sym" x="0" y="80" width="20" height="20"/>' +
            '<g id="loop"><use href="#loop"/></g><use href="#nope"/>',
        ),
      );
      const list = shapes(doc);
      equal(list.length, 3);
      sameBounds(list[0]?.path ?? { subpaths: [] }, { minX: 5, minY: 15, maxX: 15, maxY: 25 }, 1e-6);
      equal(fillColor(list[0] as SvgShapeNode), 'rgb(255, 0, 0)');
      sameBounds(list[1]?.path ?? { subpaths: [] }, { minX: 50, minY: 0, maxX: 52, maxY: 2 });
      equal(list[1]?.id, null, '实例内部的 id 不登记');
      sameBounds(list[2]?.path ?? { subpaths: [] }, { minX: 0, minY: 80, maxX: 20, maxY: 100 });
      const first = doc.children[0] as SvgGroupNode;
      equal(first.tag, 'use');
      equal(first.id, 'u1');
      ok(doc.unsupported.includes('<use> 循环引用×1'), doc.unsupported.join(' | '));
      ok(doc.unsupported.includes('<use> 引用不存在×1'), doc.unsupported.join(' | '));
    },
  ],
  [
    '<use> 引用链指数爆炸:按形状 / 元素上限截断,不会卡死',
    () => {
      let defs = '<rect id="l0" width="1" height="1"/>';
      for (let i = 1; i <= 8; i++) {
        defs += `<g id="l${i}">${Array.from({ length: 10 }, () => `<use href="#l${i - 1}"/>`).join('')}</g>`;
      }
      const t0 = Date.now();
      const doc = parseSvgDocument(svg(`<defs>${defs}</defs><use href="#l8"/>`));
      ok(Date.now() - t0 < 5000, '解析应当很快结束');
      equal(shapes(doc).length, 20000);
      ok(doc.unsupported.some((u) => u.startsWith('形状超过 20000 个')), doc.unsupported.join(' | '));
    },
  ],
  [
    '渐变按中点单色近似;url(#缺失) 用后备色',
    () => {
      const doc = parseSvgDocument(
        svg(
          '<defs><linearGradient id="g"><stop offset="0" stop-color="red"/><stop offset="100%" style="stop-color:blue"/></linearGradient>' +
            '<linearGradient id="h" href="#g"/></defs>' +
            '<rect fill="url(#g)" width="1" height="1"/><rect fill="url(\'#h\')" width="1" height="1"/>' +
            '<rect fill="url(#missing) #0f0" width="1" height="1"/><rect id="gone" fill="url(#missing)" width="1" height="1"/>',
        ),
      );
      const list = shapes(doc);
      equal(fillColor(list[0] as SvgShapeNode), 'rgb(128, 0, 128)');
      equal(fillColor(list[1] as SvgShapeNode), 'rgb(128, 0, 128)', '沿 href 继承 stops');
      equal(fillColor(list[2] as SvgShapeNode), 'rgb(0, 255, 0)');
      equal(list[3]?.fill.kind, 'none', '引用不存在又没有后备:不填充(带 id 所以留着)');
      equal(doc.unsupported.join(' | '), '渐变(按中点单色近似)×2');
    },
  ],
  [
    '不支持的内容汇总:文字、图像、裁剪等;编辑器元数据静默',
    () => {
      const doc = parseSvgDocument(
        svg(
          '<title>t</title><desc>d</desc><metadata/><sodipodi:namedview/><text>a</text><text>b</text>' +
            '<image href="x.png"/><rect clip-path="url(#c)" filter="none" width="1" height="1"/>',
        ),
        'rocket.svg',
      );
      equal(doc.unsupported.join(' | '), '<text>×2(文字请用 Label / Tex 叠在插画上) | <image>×1(位图请用 Picture 叠在插画上) | clip-path 属性×1');
      equal(
        unsupportedWarning(doc),
        '[svg] 「rocket.svg」里有不支持的内容,已忽略:<text>×2(文字请用 Label / Tex 叠在插画上)、<image>×1(位图请用 Picture 叠在插画上)、clip-path 属性×1',
      );
      equal(unsupportedWarning(parseSvgDocument(svg('<rect width="1" height="1"/>'))), null);
    },
  ],
  [
    'display:none 跳过子树;visibility:hidden 只跳过形状本身',
    () => {
      const doc = parseSvgDocument(
        svg(
          '<g display="none"><rect id="a" width="1" height="1"/></g>' +
            '<g visibility="hidden"><rect id="b" width="1" height="1"/><rect id="c" visibility="visible" width="1" height="1"/></g>' +
            '<rect id="d" style="display:none" width="1" height="1"/>',
        ),
      );
      equal(shapes(doc).map((s) => s.id).join(','), 'c');
    },
  ],
  [
    '<switch> 渲染第一个条件成立的子元素;嵌套 <svg> 叠 viewBox 映射',
    () => {
      const doc = parseSvgDocument(
        svg(
          '<switch><foreignObject requiredExtensions="http://ns.adobe.com/AdobeIllustrator/10.0/"/>' +
            '<g id="first"><rect width="1" height="1"/></g><g id="second"><rect width="1" height="1"/></g></switch>' +
            '<svg x="50" y="50" width="20" height="20" viewBox="0 0 10 10"><rect width="10" height="10"/></svg>',
        ),
      );
      const list = shapes(doc);
      equal(list.length, 2);
      const sw = doc.children[0] as SvgGroupNode;
      equal(sw.tag, 'switch');
      equal((sw.children[0] as SvgGroupNode).id, 'first');
      sameBounds(list[1]?.path ?? { subpaths: [] }, { minX: 50, minY: 50, maxX: 70, maxY: 70 });
    },
  ],
  [
    '错误:根不是 <svg>、XML 残缺 → AssetError(parse),消息带行号',
    () => {
      const html = parseFails('<html><body/></html>');
      equal(html?.code, 'parse');
      equal(html?.message, 'SVG「cat.svg」解析失败:根元素是 <html>,不是 <svg>');
      const broken = parseFails('<svg>\n\n<g>\n</svg>');
      equal(broken?.code, 'parse');
      ok(broken?.message.startsWith('SVG「cat.svg」解析失败:第 4 行') ?? false, broken?.message);
    },
  ],
  [
    '图标样本(内联源码):只有 viewBox、带 rx 的 rect、fill="none" 的 circle、round 线帽',
    () => {
      const doc = parseSvgDocument(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="12" fill="#141414"/>' +
          '<circle cx="22" cy="32" r="12" fill="none" stroke="#f5f5f5" stroke-width="3"/>' +
          '<path d="M22 32 L32 26" stroke="#7fb2ff" stroke-width="3" stroke-linecap="round"/>' +
          '<path d="M34 32 C38 20 42 20 46 32 S54 44 58 32" fill="none" stroke="#7fb2ff" stroke-width="3" stroke-linecap="round"/></svg>',
      );
      const list = shapes(doc);
      equal(list.length, 4);
      equal(svgIntrinsicSize(doc)?.width, 64);
      equal(list[1]?.fill.kind, 'none');
      equal(list[2]?.lineCap, 'round');
      equal(doc.unsupported.length, 0);
    },
  ],
  [
    '什么都不画的形状不进树(Material 图标的隐形边框、完全透明的);带 id 的保留;画板仍按它们兜底',
    () => {
      const icon = parseSvgDocument(
        svg('<path d="M0 0h24v24H0z" fill="none"/><path d="M12 2 L22 22 H2 Z"/>', 'viewBox="0 0 24 24"'),
      );
      equal(shapes(icon).length, 1, 'Material 图标开头的隐形边框没有进树');
      equal(icon.unsupported.length, 0);
      const quiet = parseSvgDocument(
        svg(
          '<rect width="10" height="10" fill="#fff" fill-opacity="0"/><rect width="10" height="10" fill="red" opacity="0"/>' +
            '<circle r="3" cx="5" cy="5" fill="none" stroke="#000" stroke-width="0"/><g><rect class="bg" width="10" height="10" fill="none"/></g>',
        ),
      );
      equal(shapes(quiet).length, 0, '全透明、线宽 0 的都算不画;只装着它们的匿名组也没了');
      equal(quiet.children.length, 0);
      const kept = only(svg('<rect id="hit" width="10" height="10" fill="none"/>'));
      equal(kept.id, 'hit');
      equal(kept.fill.kind, 'none');
      // 没有 viewBox、没有尺寸:隐形的边框矩形照样定出画板。
      const framed = parseSvgDocument(svg('<rect width="40" height="30" fill="none"/><rect x="5" y="5" width="10" height="10"/>', ''));
      equal(shapes(framed).length, 1);
      equal(svgIntrinsicSize(framed)?.width, 40);
    },
  ],
  [
    '整个落在画板外的形状不进树(浏览器裁掉根视口外的内容);跨边的、带 id 的保留;描边伸进画板的算在内',
    () => {
      const doc = parseSvgDocument(
        svg(
          '<rect width="100" height="100" fill="#eee"/><circle cx="400" cy="50" r="10"/>' +
            '<circle cx="100" cy="50" r="10"/><circle id="later" cx="-300" cy="50" r="10"/>' +
            '<line x1="10" y1="-2" x2="50" y2="-2" stroke="#000" stroke-width="6"/><line x1="10" y1="-40" x2="50" y2="-40" stroke="#000"/>',
        ),
      );
      const list = shapes(doc);
      equal(list.length, 4, list.map((l) => l.tag).join(','));
      equal(list[2]?.id, 'later');
      equal(list[3]?.tag, 'line', '几何在画板外、描边伸进画板:保留(另一条整个在外,丢掉)');
      // meet 的留白也看得见:viewBox 外、画板内的不丢。
      const letterbox = parseSvgDocument(
        svg('<rect x="-40" y="0" width="10" height="10"/>', 'width="200" height="100" viewBox="0 0 100 100"'),
      );
      equal(shapes(letterbox).length, 1);
      // 画板靠内容兜底时什么都不丢。
      equal(shapes(parseSvgDocument(svg('<rect x="500" y="500" width="10" height="10"/>', ''))).length, 1);
    },
  ],
  [
    'clip-path:只盖住整个画板的单个矩形(Figma 导出)不算不支持;真正裁东西的仍计数',
    () => {
      const figma = parseSvgDocument(
        svg(
          '<g clip-path="url(#clip0_1_2)"><path d="M2 2 H22 V22 Z" fill="#111"/></g>' +
            '<defs><clipPath id="clip0_1_2"><rect width="24" height="24" fill="white"/></clipPath></defs>',
          'width="24" height="24" viewBox="0 0 24 24" fill="none"',
        ),
      );
      equal(figma.unsupported.length, 0, figma.unsupported.join(' | '));
      equal(shapes(figma).length, 1);
      const shifted = parseSvgDocument(
        svg(
          '<g transform="translate(-10 -10)" clip-path="url(#c)"><rect x="10" y="10" width="24" height="24"/></g>' +
            '<clipPath id="c"><rect x="10" y="10" width="24" height="24"/></clipPath>',
          'viewBox="0 0 24 24"',
        ),
      );
      equal(shifted.unsupported.length, 0, '裁剪框在引用者的用户坐标里(含它自己的 transform)');
      const partial = parseSvgDocument(
        svg('<g clip-path="url(#c)"><rect width="24" height="24"/></g><clipPath id="c"><rect width="12" height="24"/></clipPath>', 'viewBox="0 0 24 24"'),
      );
      equal(partial.unsupported.join(' | '), 'clip-path 属性×1');
      const round = parseSvgDocument(
        svg('<g clip-path="url(#c)"><rect width="24" height="24"/></g><clipPath id="c"><rect width="24" height="24" rx="4"/></clipPath>', 'viewBox="0 0 24 24"'),
      );
      equal(round.unsupported.join(' | '), 'clip-path 属性×1', '圆角裁剪会裁掉四角');
      const circle = parseSvgDocument(
        svg('<g clip-path="url(#c)"><rect width="24" height="24"/></g><clipPath id="c"><circle r="100"/></clipPath>', 'viewBox="0 0 24 24"'),
      );
      equal(circle.unsupported.join(' | '), 'clip-path 属性×1');
    },
  ],
  [
    '当位图用时去掉 <foreignObject> 与 <switch> 里 requiredExtensions 的分支(与插画画的一致)',
    () => {
      const text =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><switch>' +
        '<foreignObject requiredExtensions="http://ns.adobe.com/AdobeIllustrator/10.0/" x="0" y="0" width="1" height="1"><i:pgfRef/></foreignObject>' +
        '<g i:extraneous="self"><rect width="10" height="10"/></g></switch>' +
        '<foreignObject width="5" height="5"><div xmlns="http://www.w3.org/1999/xhtml">hi</div></foreignObject><circle r="1"/></svg>';
      const out = svgWithIntrinsicSize(text, 10, 10);
      ok(!out.includes('foreignObject') && !out.includes('pgfRef') && !out.includes('<div'), out);
      ok(out.includes('<switch><g i:extraneous="self"><rect width="10" height="10"/></g></switch>'), out);
      ok(out.endsWith('<circle r="1"/></svg>'), out);
      equal(shapes(parseSvgDocument(out)).length, 2);
    },
  ],
  [
    '当位图用时写回原始尺寸:改根元素 width/height,缺 viewBox 时补上',
    () => {
      const a = svgWithIntrinsicSize('<?xml version="1.0"?>\n<svg viewBox="0 0 10 5" width="100%"><rect/></svg>', 10, 5);
      equal(a, '<?xml version="1.0"?>\n<svg viewBox="0 0 10 5" xmlns="http://www.w3.org/2000/svg" width="10" height="5"><rect/></svg>');
      const b = svgWithIntrinsicSize('<svg xmlns="http://www.w3.org/2000/svg"><rect x="-4" y="-2" width="4" height="2"/></svg>', 4, 2);
      ok(b.includes('viewBox="-4 -2 4 2"') && b.includes('width="4" height="2"'), b);
      const doc = parseSvgDocument(b);
      equal(svgIntrinsicSize(doc)?.width, 4);
    },
  ],
]);
