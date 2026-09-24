/**
 * SVG 用到的那一小块 CSS:style="" 声明、<style> 样式表里的简单选择器与特异性。
 * 支持 *、tag、.class、#id 及其复合(tag.a.b#id)、逗号列表;
 * 组合符、属性选择器、伪类、@media 等不支持,对应的选择器忽略并计入 unsupported。
 */

/** 声明:属性名(小写)→ 值(去掉 !important 与首尾空白)。 */
export type Declarations = Map<string, string>;

export interface CssSelector {
  readonly tag: string | null;
  readonly id: string | null;
  readonly classes: readonly string[];
  /** (id 数, class 数, tag 数) 压成一个可比较的数。 */
  readonly specificity: number;
}

export interface CssRule {
  readonly selector: CssSelector;
  /** 出现顺序(同特异性时后来者优先)。 */
  readonly order: number;
  readonly declarations: Declarations;
}

export interface StyleSheet {
  readonly rules: readonly CssRule[];
  /** 不支持的内容(「CSS 选择器「g > path」」「@media」),可重复,调用方计数。 */
  readonly unsupported: readonly string[];
}

/** 被匹配的元素:名字、id、class 列表。 */
export interface CssTarget {
  readonly name: string;
  readonly id: string | null;
  readonly classes: readonly string[];
}

function stripComments(text: string): string {
  return text.includes('/*') ? text.replace(/\/\*[\s\S]*?(\*\/|$)/g, ' ') : text;
}

/** 按顶层分隔符切开(括号、引号里的不算):url(data:…;…) 里的分号不能切。 */
function splitTopLevel(text: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let quote: string | null = null;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) {
        quote = null;
      }
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '(') {
      depth += 1;
    } else if (c === ')') {
      depth = Math.max(0, depth - 1);
    } else if (c === sep && depth === 0) {
      out.push(text.slice(start, i));
      start = i + 1;
    }
  }
  out.push(text.slice(start));
  return out;
}

/** 解析声明块(style 属性或规则体)。后写的同名声明覆盖先写的。 */
export function parseDeclarations(text: string): Declarations {
  const out: Declarations = new Map();
  if (!text) {
    return out;
  }
  for (const part of splitTopLevel(stripComments(text), ';')) {
    const colon = part.indexOf(':');
    if (colon <= 0) {
      continue;
    }
    const prop = part.slice(0, colon).trim().toLowerCase();
    const value = part
      .slice(colon + 1)
      .replace(/!\s*important\s*$/i, '')
      .trim();
    if (prop && value) {
      out.set(prop, value);
    }
  }
  return out;
}

const SIMPLE_SELECTOR = /^(\*|[A-Za-z][-\w]*)?((?:[.#][-\w]+)*)$/;

/** 解析一个复合简单选择器;不支持的写法返回 null。 */
export function parseSelector(text: string): CssSelector | null {
  const s = text.trim();
  const m = SIMPLE_SELECTOR.exec(s);
  if (!s || !m) {
    return null;
  }
  const tagPart = m[1];
  const tag = tagPart && tagPart !== '*' ? tagPart : null;
  let id: string | null = null;
  const classes: string[] = [];
  let ids = 0;
  for (const token of (m[2] ?? '').match(/[.#][-\w]+/g) ?? []) {
    if (token.startsWith('#')) {
      if (id !== null && id !== token.slice(1)) {
        // #a#b 永远匹配不上任何元素。
        ids += 1;
        id = '\u0000';
        continue;
      }
      id = token.slice(1);
      ids += 1;
    } else {
      classes.push(token.slice(1));
    }
  }
  return { tag, id, classes, specificity: ids * 10000 + classes.length * 100 + (tag ? 1 : 0) };
}

/** at 规则里静默忽略的(没有视觉影响,或本来就不该在 SVG 里起作用)。 */
const SILENT_AT_RULES = new Set(['charset', 'font-face', 'namespace', 'import', 'page']);

/**
 * 解析样式表。orderBase 让多个 <style> 的规则按文档顺序排下去。
 */
export function parseStyleSheet(text: string, orderBase = 0): StyleSheet {
  const src = stripComments(text).replace(/<!--|-->/g, ' ');
  const rules: CssRule[] = [];
  const unsupported: string[] = [];
  let order = orderBase;
  let i = 0;
  const n = src.length;
  /** 从 open('{' 的位置)跳到配对的 '}' 之后。 */
  const skipBlock = (open: number): number => {
    let depth = 0;
    for (let j = open; j < n; j++) {
      if (src[j] === '{') {
        depth += 1;
      } else if (src[j] === '}') {
        depth -= 1;
        if (depth === 0) {
          return j + 1;
        }
      }
    }
    return n;
  };
  while (i < n) {
    while (i < n && /\s/.test(src[i] ?? '')) {
      i += 1;
    }
    if (i >= n) {
      break;
    }
    if (src[i] === '@') {
      const m = /^@([-\w]+)/.exec(src.slice(i));
      const name = (m?.[1] ?? '').toLowerCase();
      const brace = src.indexOf('{', i);
      const semi = src.indexOf(';', i);
      if (brace >= 0 && (semi < 0 || brace < semi)) {
        i = skipBlock(brace);
      } else {
        i = semi >= 0 ? semi + 1 : n;
      }
      if (!SILENT_AT_RULES.has(name)) {
        unsupported.push(`@${name}`);
      }
      continue;
    }
    const brace = src.indexOf('{', i);
    if (brace < 0) {
      break;
    }
    const close = src.indexOf('}', brace + 1);
    const end = close < 0 ? n : close;
    const selectorText = src.slice(i, brace);
    const declarations = parseDeclarations(src.slice(brace + 1, end));
    i = end + 1;
    for (const part of selectorText.split(',')) {
      const selector = parseSelector(part);
      if (selector) {
        rules.push({ selector, order: order++, declarations });
      } else if (part.trim()) {
        unsupported.push(`CSS 选择器「${part.trim().replace(/\s+/g, ' ')}」`);
      }
    }
  }
  return { rules, unsupported };
}

function matches(selector: CssSelector, el: CssTarget): boolean {
  if (selector.tag !== null && selector.tag !== el.name) {
    return false;
  }
  if (selector.id !== null && selector.id !== el.id) {
    return false;
  }
  return selector.classes.every((c) => el.classes.includes(c));
}

/**
 * 匹配到元素上的样式表声明,按特异性、同特异性按出现顺序层叠(后者覆盖前者)。
 */
export function matchRules(rules: readonly CssRule[], el: CssTarget): Declarations {
  const out: Declarations = new Map();
  if (rules.length === 0) {
    return out;
  }
  const hits = rules.filter((r) => matches(r.selector, el));
  hits.sort((a, b) => a.selector.specificity - b.selector.specificity || a.order - b.order);
  for (const rule of hits) {
    for (const [k, v] of rule.declarations) {
      out.set(k, v);
    }
  }
  return out;
}
