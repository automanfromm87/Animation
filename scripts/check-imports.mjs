// 依赖环检查(含纯类型 import)。
// oxlint 的 import/no-cycle 不看 `import type`,而类型环一样说明分层坏了
// (两个模块互相知道对方的内部契约)。这里把 src 下所有相对 import / export from /
// 动态 import() 连成图,用 Tarjan 找强连通分量,有环就列出来并以 1 退出。
// 说明符用 TypeScript 自己的扫描器(ts.preProcessFile)提取:注释、字符串里的 import 字样不算。
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, 'src');
const SOURCE = /\.(ts|tsx)$/;

/**
 * @param {string} dir
 * @param {string[]} [out]
 * @returns {string[]}
 */
function sources(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      sources(path, out);
    } else if (entry.isFile() && SOURCE.test(entry.name)) {
      out.push(path);
    }
  }
  return out;
}

/**
 * 相对说明符 → 真实文件(省略扩展名、目录 index)。
 * @param {string} from
 * @param {string} spec
 * @returns {string | null}
 */
function resolveSpecifier(from, spec) {
  const base = resolve(dirname(from), spec);
  const candidates = [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')];
  for (const c of candidates) {
    if (existsSync(c) && statSync(c).isFile() && SOURCE.test(c)) {
      return c;
    }
  }
  return null;
}

const files = sources(SRC);
/** @type {Map<string, string[]>} */
const graph = new Map();
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  /** @type {string[]} */
  const deps = [];
  for (const ref of ts.preProcessFile(text, true, true).importedFiles) {
    if (!ref.fileName.startsWith('.')) {
      continue;
    }
    const target = resolveSpecifier(file, ref.fileName);
    if (target && target !== file) {
      deps.push(target);
    }
  }
  graph.set(file, deps);
}

// Tarjan 强连通分量(迭代写法,不怕深递归)。
let counter = 0;
/** @type {Map<string, number>} */
const index = new Map();
/** @type {Map<string, number>} */
const low = new Map();
/** @type {string[]} */
const stack = [];
const onStack = new Set();
/** @type {string[][]} */
const cycles = [];
for (const root of graph.keys()) {
  if (index.has(root)) {
    continue;
  }
  /** @type {Array<{ node: string; next: number }>} */
  const work = [{ node: root, next: 0 }];
  index.set(root, counter);
  low.set(root, counter);
  counter += 1;
  stack.push(root);
  onStack.add(root);
  while (work.length > 0) {
    const frame = work[work.length - 1];
    if (!frame) {
      break;
    }
    const deps = graph.get(frame.node) ?? [];
    if (frame.next < deps.length) {
      const dep = deps[frame.next] ?? '';
      frame.next += 1;
      if (!index.has(dep)) {
        index.set(dep, counter);
        low.set(dep, counter);
        counter += 1;
        stack.push(dep);
        onStack.add(dep);
        work.push({ node: dep, next: 0 });
      } else if (onStack.has(dep)) {
        low.set(frame.node, Math.min(low.get(frame.node) ?? 0, index.get(dep) ?? 0));
      }
      continue;
    }
    work.pop();
    const parent = work[work.length - 1];
    if (parent) {
      low.set(parent.node, Math.min(low.get(parent.node) ?? 0, low.get(frame.node) ?? 0));
    }
    if (low.get(frame.node) === index.get(frame.node)) {
      /** @type {string[]} */
      const component = [];
      let member;
      do {
        member = stack.pop();
        if (member !== undefined) {
          onStack.delete(member);
          component.push(member);
        }
      } while (member !== undefined && member !== frame.node);
      if (component.length > 1) {
        cycles.push(component);
      }
    }
  }
}

if (cycles.length > 0) {
  console.error(`✗ 发现 ${cycles.length} 个依赖环(含纯类型 import):`);
  for (const cycle of cycles) {
    console.error(`  - ${cycle.map((f) => relative(ROOT, f)).sort().join(' ⇄ ')}`);
  }
  process.exitCode = 1;
} else {
  console.log(`✓ 依赖图无环(${files.length} 个模块,含纯类型 import)`);
}
