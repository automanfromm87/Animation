import { equal, ok, suite } from '../../testing/harness';
import type { XmlElement } from './xml';
import { isXmlElement, parseXml, xmlTextContent } from './xml';

function elements(el: XmlElement): XmlElement[] {
  return el.children.filter(isXmlElement);
}

function parseError(source: string): string {
  try {
    parseXml(source);
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
  return '';
}

export default suite('资源 · XML 解析', [
  [
    '元素、属性(单双引号、无引号容错)、自闭合与嵌套',
    () => {
      const root = parseXml(`<svg a="1" b='two' c=3 d>\n  <g id="x"><rect/></g>\n  <circle r="5"/>\n</svg>`);
      equal(root.name, 'svg');
      equal(root.attrs['a'], '1');
      equal(root.attrs['b'], 'two');
      equal(root.attrs['c'], '3');
      equal(root.attrs['d'], '');
      const kids = elements(root);
      equal(kids.length, 2);
      equal(kids[0]?.name, 'g');
      equal(kids[0]?.attrs['id'], 'x');
      equal(elements(kids[0] as XmlElement)[0]?.name, 'rect');
      equal(kids[1]?.selfClosing, true);
      equal(kids[1]?.line, 3);
    },
  ],
  [
    '属性表没有原型:取不到的键是 undefined',
    () => {
      const root = parseXml('<svg/>');
      equal(root.attrs['constructor'], undefined);
      equal(root.attrs['toString'], undefined);
    },
  ],
  [
    '实体(内置、数字、DOCTYPE 内部实体),认不出的原样保留',
    () => {
      const root = parseXml(
        `<?xml version="1.0"?>\n<!DOCTYPE svg [\n  <!ENTITY ns_svg "http://www.w3.org/2000/svg">\n]>\n` +
          `<svg xmlns="&ns_svg;" t="&amp;&lt;&gt;&quot;&apos;&#x41;&#66;&unknown;"/>`,
      );
      equal(root.attrs['xmlns'], 'http://www.w3.org/2000/svg');
      equal(root.attrs['t'], `&<>"'AB&unknown;`);
    },
  ],
  [
    '注释、处理指令、BOM 跳过;文本与 CDATA',
    () => {
      const root = parseXml('\uFEFF<!-- hi --><?xml-stylesheet x?><svg><style><![CDATA[.a{fill:red}]]></style><title>A &amp; B</title></svg>');
      const [style, title] = elements(root);
      equal(xmlTextContent(style as XmlElement), '.a{fill:red}');
      equal(xmlTextContent(title as XmlElement), 'A & B');
    },
  ],
  [
    'svg: 前缀去掉,xlink:href 保留前缀,记下原名与开始标签区间',
    () => {
      const src = '<svg:svg xmlns:svg="http://www.w3.org/2000/svg"><svg:use xlink:href="#a"/></svg:svg>';
      const root = parseXml(src);
      equal(root.name, 'svg');
      equal(root.rawName, 'svg:svg');
      equal(src.slice(root.start, root.openEnd), '<svg:svg xmlns:svg="http://www.w3.org/2000/svg">');
      const use = elements(root)[0];
      equal(use?.name, 'use');
      equal(use?.attrs['xlink:href'], '#a');
    },
  ],
  [
    '错误带行号:没闭合、不配对、根之后多余元素、空文件',
    () => {
      const unclosed = parseError('<svg>\n<g>\n</svg>');
      ok(unclosed.includes('第 3 行') && unclosed.includes('不配对'), unclosed);
      const open = parseError('<svg>\n  <g>');
      ok(open.includes('第 2 行') && open.includes('<g> 没有闭合'), open);
      const extra = parseError('<svg/>\n<svg/>');
      ok(extra.includes('第 2 行') && extra.includes('根元素之后'), extra);
      ok(parseError('   ').includes('没有元素'));
      ok(parseError('<svg a="1></svg>').includes('引号没有闭合'));
      ok(parseError('<svg><!-- oops </svg>').includes('注释没有闭合'));
    },
  ],
]);
