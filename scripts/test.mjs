// 测试运行器:用 Vite 的 SSR 模块加载器直接跑 src 下的 *.test.ts / *.test.tsx。
// 加载项目的 vite.config.ts,解析规则(TS、扩展名省略、路径别名)与 app 完全一致。
//
// 用法:
//   node scripts/test.mjs                 跑全部
//   node scripts/test.mjs film engine/3d  只跑(相对项目根的)路径包含任一关键字的测试文件
//   TEST_TIMEOUT=20000 node scripts/test.mjs   单条用例超时(毫秒,默认 10000)
//   TEST_ROOT=scripts/fixtures/runner node scripts/test.mjs   换一个目录找测试(运行器自测用)
import { createServer } from 'vite';
import { readdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = join(ROOT, process.env.TEST_ROOT || 'src');
const TEST_FILE = /\.test\.tsx?$/;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);
const TIMEOUT_MS = Number(process.env.TEST_TIMEOUT) > 0 ? Number(process.env.TEST_TIMEOUT) : 10_000;

/**
 * @param {string} dir
 * @param {string[]} [out]
 * @returns {string[]}
 */
function findTests(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      // isDirectory() 对指向目录的符号链接返回 false,顺带避免了无限递归。
      if (!SKIP_DIRS.has(entry.name)) {
        findTests(join(dir, entry.name), out);
      }
    } else if (entry.isFile() && TEST_FILE.test(entry.name)) {
      out.push(join(dir, entry.name));
    }
  }
  return out;
}

class TimeoutError extends Error {
  /** @param {number} ms */
  constructor(ms) {
    super(`超时:${ms}ms 内没有结束(挂起的 Promise?)`);
    this.name = 'TimeoutError';
  }
}

/**
 * 给单条用例加期限:挂死的 await 不能拖垮整份报告,更不能让 CI 永远等下去。
 * 注意它只拦得住异步挂起;同步死循环会堵住事件循环,只能靠进程外的超时。
 * @param {() => unknown} fn
 * @param {number} ms
 */
async function runWithTimeout(fn, ms) {
  let timer;
  try {
    await Promise.race([
      Promise.resolve().then(fn),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 断言失败只打一行太难定位:补上它在测试文件里的那一帧。
 * @param {unknown} error
 * @returns {string}
 */
function testFrame(error) {
  const stack = error instanceof Error && typeof error.stack === 'string' ? error.stack : '';
  return stack.split('\n').find((line) => /\.test\.tsx?:\d+/.test(line))?.trim() ?? '';
}

const filters = process.argv.slice(2);
/** 相对项目根的路径(统一成 /):按它过滤,项目放在含关键字的目录下时才不会全部命中。 */
const relativePath = (/** @type {string} */ f) => f.slice(ROOT.length + 1).split('\\').join('/');
const files = findTests(SRC)
  .sort()
  .filter((f) => filters.length === 0 || filters.some((k) => relativePath(f).includes(k)));

if (files.length === 0) {
  console.error(filters.length > 0 ? `没有匹配 ${filters.join(' / ')} 的测试文件` : '没有找到任何 *.test.ts');
  process.exitCode = 1;
} else {
  const server = await createServer({
    root: ROOT,
    logLevel: 'error',
    // 只用 ssrLoadModule,不需要 HMR socket 和文件监听(它们会抢 24678 端口)。
    server: { middlewareMode: true, ws: false, hmr: false, watch: null },
    optimizeDeps: { noDiscovery: true },
  });

  let passed = 0;
  let current = '';
  /** @type {Array<{ suite: string; test: string; error: unknown }>} */
  const failures = [];
  // 万一还是有东西让进程提前退出(比如未处理的顶层 await),至少说出是哪条用例。
  const onExit = () => {
    if (current !== '') {
      console.error(`\n进程在用例「${current}」执行中退出`);
    }
  };
  process.on('exit', onExit);
  /**
   * @param {string} suite
   * @param {string} test
   * @param {unknown} error
   */
  const fail = (suite, test, error) => {
    if (error instanceof Error) {
      // SSR 模块的栈指向转换后的代码,必须在 server.close() 之前修回源码行号。
      server.ssrFixStacktrace(error);
    }
    failures.push({ suite, test, error });
  };

  // 没人接的 rejection(测试里漏了 await、误把异步函数交给 throws)默认会直接杀掉进程,
  // 整份报告都丢。接住它,在用例结束后结算到那条用例头上。
  /** @type {unknown[]} */
  let stray = [];
  /** @param {unknown} reason */
  const onUnhandled = (reason) => {
    stray.push(reason);
  };
  process.on('unhandledRejection', onUnhandled);
  // node 在一个宏任务结束、微任务排空之后才判定 rejection 没人接:
  // 每条用例之后都过一次宏任务边界,它漏接的 rejection 才会在这里冒出来,而不是算到后面的同步用例头上。
  const settleTurn = () => new Promise((r) => setImmediate(r));
  /** 失败的用例数(一条用例既抛错又漏接 rejection 也只算一次)。 */
  let failedTests = 0;

  let aborted = false;
  outer: for (const file of files) {
    const specifier = '/' + relativePath(file);
    let mod;
    try {
      mod = await server.ssrLoadModule(specifier);
    } catch (e) {
      fail(specifier, '<加载模块>', e);
      failedTests += 1;
      continue;
    }
    const suite = mod.default;
    if (!suite || !Array.isArray(suite.tests)) {
      fail(specifier, '<默认导出>', new Error('测试文件必须 export default suite(...)'));
      failedTests += 1;
      continue;
    }
    if (suite.tests.length === 0) {
      fail(suite.name, '<空套件>', new Error('这个测试文件一条用例都没有'));
      failedTests += 1;
      continue;
    }
    // 模块顶层代码漏接的 rejection 记在加载头上,不混进第一条用例。
    await settleTurn();
    if (stray.length > 0) {
      for (const reason of stray) {
        fail(suite.name, '<加载模块>(未处理的 rejection)', reason);
      }
      stray = [];
      failedTests += 1;
    }
    for (const [name, fn] of suite.tests) {
      current = `${suite.name} › ${name}`;
      let ok = true;
      try {
        await runWithTimeout(fn, TIMEOUT_MS);
      } catch (e) {
        ok = false;
        fail(suite.name, name, e);
        if (e instanceof TimeoutError) {
          // 超时的用例没机会跑自己的 finally(restore 桩),全局已被污染,后面的结果不可信。
          failedTests += 1;
          aborted = true;
          break outer;
        }
      }
      await settleTurn();
      for (const reason of stray) {
        ok = false;
        fail(suite.name, `${name}(未处理的 rejection)`, reason);
      }
      stray = [];
      if (ok) {
        passed += 1;
      } else {
        failedTests += 1;
      }
    }
  }
  current = '';
  // 用例之外(模块加载、收尾阶段)冒出来的 rejection 单独记一处失败。
  await settleTurn();
  if (stray.length > 0) {
    for (const reason of stray) {
      fail('<运行器>', '<用例之外>(未处理的 rejection)', reason);
    }
    failedTests += 1;
  }
  process.off('unhandledRejection', onUnhandled);

  await server.close();

  for (const f of failures) {
    const err = f.error;
    console.error(`\n✗ ${f.suite} › ${f.test}`);
    console.error(`  ${err instanceof Error ? err.message : String(err)}`);
    if (err instanceof Error && err.name === 'AssertionError') {
      const frame = testFrame(err);
      if (frame !== '') {
        console.error(`  ${frame}`);
      }
    } else if (err instanceof Error && err.stack) {
      console.error(err.stack);
    }
  }

  const total = passed + failedTests;
  console.log(
    `\n${failedTests === 0 ? '✓' : '✗'} ${passed}/${total} 通过（${files.length} 个测试文件）` +
      (aborted ? ' —— 因超时中止,其余用例未执行' : ''),
  );
  process.off('exit', onExit);
  const code = failedTests === 0 ? 0 : 1;
  process.exitCode = code;
  // 用例留下的定时器、句柄(超时中止的用例尤其常见)不能把进程吊住,CI 会永远等下去:
  // 等 stdout/stderr 真正刷完(直接 process.exit 会截断大批失败明细)再显式退出。
  await new Promise((r) => process.stdout.write('', () => r(undefined)));
  await new Promise((r) => process.stderr.write('', () => r(undefined)));
  process.exit(code);
}
