/**
 * 最小 XML 解析(给 SVG 用):元素、属性、文本、CDATA、注释、处理指令、DOCTYPE(收内部实体)。
 * node 与浏览器用同一份 —— 不用 DOMParser:两套解析会让 node 干跑与浏览器的结果不一致。
 * 不校验命名空间、不做 DTD 校验;出错抛 Error(消息带行号),调用方包成 AssetError('parse')。
 */

export interface XmlText {
  readonly text: string;
}

export interface XmlElement {
  /** 元素名:原样大小写,去掉 'svg:' 前缀(其它前缀保留,调用方据此忽略编辑器私有元素)。 */
  readonly name: string;
  /** 源码里的原名(带前缀)。 */
  readonly rawName: string;
  /** 属性(实体已解码;属性名原样,xlink:href 保留前缀)。没有原型,取不到的键就是 undefined。 */
  readonly attrs: Readonly<Record<string, string>>;
  readonly children: readonly XmlNode[];
  /** 开始标签所在行(从 1 起)。 */
  readonly line: number;
  /** 开始标签在源码里的区间 [start, openEnd)(含尖括号)。 */
  readonly start: number;
  readonly openEnd: number;
  /** 整个元素在源码里的结束位置(闭合标签的 > 之后;自闭合时等于 openEnd)。 */
  readonly end: number;
  readonly selfClosing: boolean;
}

export type XmlNode = XmlElement | XmlText;

export function isXmlElement(node: XmlNode): node is XmlElement {
  return 'name' in node;
}

/** 元素的直接文本内容(文本与 CDATA 拼起来)。 */
export function xmlTextContent(el: XmlElement): string {
  let out = '';
  for (const child of el.children) {
    if (!isXmlElement(child)) {
      out += child.text;
    }
  }
  return out;
}

interface MutableElement {
  name: string;
  rawName: string;
  attrs: Record<string, string>;
  children: XmlNode[];
  line: number;
  start: number;
  openEnd: number;
  end: number;
  selfClosing: boolean;
}

const BUILTIN_ENTITIES: ReadonlyArray<readonly [string, string]> = [
  ['amp', '&'],
  ['lt', '<'],
  ['gt', '>'],
  ['quot', '"'],
  ['apos', "'"],
];

const NAME = /[A-Za-z_:][-A-Za-z0-9_:.]*/y;
const ATTR_NAME = /[^\s=/>"']+/y;
const UNQUOTED_VALUE = /[^\s>]+/y;
const ENTITY_REF = /&(#x[0-9a-fA-F]+|#[0-9]+|[A-Za-z_][-A-Za-z0-9_.]*);/g;
const ENTITY_DECL = /<!ENTITY\s+([A-Za-z_][-A-Za-z0-9_.]*)\s+(?:"([^"]*)"|'([^']*)')\s*>/g;

/** 行号表:第 k 个换行符的位置,按位置二分出行号。 */
function lineIndex(source: string): (offset: number) => number {
  const breaks: number[] = [];
  for (let i = source.indexOf('\n'); i >= 0; i = source.indexOf('\n', i + 1)) {
    breaks.push(i);
  }
  return (offset) => {
    let lo = 0;
    let hi = breaks.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((breaks[mid] ?? Infinity) < offset) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }
    return lo + 1;
  };
}

function isSpace(c: string | undefined): boolean {
  return c === ' ' || c === '\n' || c === '\t' || c === '\r';
}

/** 解析出根元素;出错抛 Error(`第 N 行 …`)。 */
export function parseXml(source: string): XmlElement {
  const src = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const n = src.length;
  const lineAt = lineIndex(src);
  const entities = new Map<string, string>(BUILTIN_ENTITIES);
  const decode = (text: string): string =>
    text.includes('&')
      ? text.replace(ENTITY_REF, (whole, ref: string) => {
          if (ref.startsWith('#')) {
            const code = ref[1] === 'x' ? parseInt(ref.slice(2), 16) : parseInt(ref.slice(1), 10);
            return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
          }
          return entities.get(ref) ?? whole;
        })
      : text;
  const fail = (offset: number, what: string): never => {
    throw new Error(`第 ${lineAt(offset)} 行 ${what}`);
  };

  const stack: MutableElement[] = [];
  let root: MutableElement | null = null;
  let i = 0;
  const addText = (text: string): void => {
    const top = stack[stack.length - 1];
    if (top && text.length > 0) {
      top.children.push({ text });
    }
  };

  while (i < n) {
    const lt = src.indexOf('<', i);
    if (lt < 0) {
      addText(decode(src.slice(i)));
      break;
    }
    if (lt > i) {
      addText(decode(src.slice(i, lt)));
    }
    if (src.startsWith('<!--', lt)) {
      const end = src.indexOf('-->', lt + 4);
      if (end < 0) {
        fail(lt, '注释没有闭合');
      }
      i = end + 3;
      continue;
    }
    if (src.startsWith('<![CDATA[', lt)) {
      const end = src.indexOf(']]>', lt + 9);
      if (end < 0) {
        fail(lt, 'CDATA 没有闭合');
      }
      addText(src.slice(lt + 9, end));
      i = end + 3;
      continue;
    }
    if (src.startsWith('<?', lt)) {
      const end = src.indexOf('?>', lt + 2);
      if (end < 0) {
        fail(lt, '处理指令 <? 没有闭合');
      }
      i = end + 2;
      continue;
    }
    if (src.startsWith('<!', lt)) {
      // DOCTYPE(可带 [...] 内部子集)或其它声明:扫到配对的 '>'。
      let depth = 0;
      let j = lt + 2;
      for (; j < n; j++) {
        const c = src[j];
        if (c === '[') {
          depth += 1;
        } else if (c === ']') {
          depth -= 1;
        } else if (c === '>' && depth <= 0) {
          break;
        }
      }
      if (j >= n) {
        fail(lt, '<! 声明没有闭合');
      }
      const decl = src.slice(lt, j + 1);
      for (const m of decl.matchAll(ENTITY_DECL)) {
        const key = m[1] ?? '';
        if (!entities.has(key)) {
          entities.set(key, m[2] ?? m[3] ?? '');
        }
      }
      i = j + 1;
      continue;
    }
    if (src[lt + 1] === '/') {
      const gt = src.indexOf('>', lt + 2);
      if (gt < 0) {
        fail(lt, '闭合标签没有 >');
      }
      const name = src.slice(lt + 2, gt).trim();
      const top = stack.pop();
      if (!top) {
        fail(lt, `多出来的闭合标签 </${name}>`);
      } else if (top.rawName !== name) {
        fail(lt, `闭合标签 </${name}> 与第 ${top.line} 行的 <${top.rawName}> 不配对`);
      } else {
        top.end = gt + 1;
      }
      i = gt + 1;
      continue;
    }
    // 开始标签。
    NAME.lastIndex = lt + 1;
    const nameMatch = NAME.exec(src);
    if (!nameMatch) {
      fail(lt, '标签语法错误(< 后面不是元素名)');
    }
    const rawName = nameMatch?.[0] ?? '';
    const attrs: Record<string, string> = Object.create(null) as Record<string, string>;
    let j = lt + 1 + rawName.length;
    let selfClosing = false;
    for (;;) {
      while (isSpace(src[j])) {
        j += 1;
      }
      if (j >= n) {
        fail(lt, `<${rawName}> 的开始标签没有 >`);
      }
      if (src[j] === '>') {
        j += 1;
        break;
      }
      if (src[j] === '/' && src[j + 1] === '>') {
        selfClosing = true;
        j += 2;
        break;
      }
      ATTR_NAME.lastIndex = j;
      const attrMatch = ATTR_NAME.exec(src);
      if (!attrMatch) {
        fail(j, `<${rawName}> 的属性语法错误`);
      }
      const attrName = attrMatch?.[0] ?? '';
      j += attrName.length;
      while (isSpace(src[j])) {
        j += 1;
      }
      let value = '';
      if (src[j] === '=') {
        j += 1;
        while (isSpace(src[j])) {
          j += 1;
        }
        const quote = src[j];
        if (quote === '"' || quote === "'") {
          const end = src.indexOf(quote, j + 1);
          if (end < 0) {
            fail(j, `<${rawName}> 的属性 ${attrName} 引号没有闭合`);
          }
          value = src.slice(j + 1, end);
          j = end + 1;
        } else {
          // 容错:无引号的值读到空白或 >。
          UNQUOTED_VALUE.lastIndex = j;
          const m = UNQUOTED_VALUE.exec(src);
          value = m?.[0] ?? '';
          if (value.endsWith('/') && src[j + value.length] === '>') {
            value = value.slice(0, -1);
          }
          j += value.length;
        }
      }
      if (!(attrName in attrs)) {
        attrs[attrName] = decode(value);
      }
    }
    const el: MutableElement = {
      name: rawName.startsWith('svg:') ? rawName.slice(4) : rawName,
      rawName,
      attrs,
      children: [],
      line: lineAt(lt),
      start: lt,
      openEnd: j,
      end: j,
      selfClosing,
    };
    const parent = stack[stack.length - 1];
    if (parent) {
      parent.children.push(el);
    } else if (root) {
      fail(lt, `根元素之后还有元素 <${rawName}>`);
    } else {
      root = el;
    }
    if (!selfClosing) {
      stack.push(el);
    }
    i = j;
  }
  const open = stack[stack.length - 1];
  if (open) {
    throw new Error(`第 ${open.line} 行 <${open.rawName}> 没有闭合`);
  }
  if (!root) {
    throw new Error('文件里没有元素');
  }
  return root;
}
