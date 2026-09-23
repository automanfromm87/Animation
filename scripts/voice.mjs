// 配音工具:导出台词稿(交给配音方)、按实测音频排时间表、校验时间表(配音方交回来之后)。
// 用 Vite 的 SSR 模块加载器直接跑 src 下的 TS(与 scripts/test.mjs 同一套解析规则),
// 分段干跑用 src/testing/domStub 的 DOM 桩,不需要浏览器。
//
// 用法:
//   npm run voice:script -- <影片> [--out 文件]                  导出台词稿 JSON(缺省打印到标准输出)
//   npm run voice:layout -- <台词稿.json> <实测.json> [--out 文件]  按实测音频排时间表(配音方的参考实现)
//   npm run voice:check -- <影片> <时间表.json>                   校验时间表;有错误时退出码 1
//
// <影片> 是 src/film/catalog.ts 里的名字(与页面 ?scene= 一致):film / derivatives / topology / voice-demo。
// 实测 JSON:{ "<分段id>": { "<台词id>": { "duration": 秒, "marks": { "<标记>": 句内秒数 }, "audio": "文件" } } }
import { createServer } from 'vite';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** @typedef {{ level: 'error' | 'warning'; message: string; segment?: string; line?: string }} Problem */

const USAGE = `用法:
  npm run voice:script -- <影片> [--out 文件]
  npm run voice:layout -- <台词稿.json> <实测.json> [--out 文件]
  npm run voice:check -- <影片> <时间表.json>`;

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  console.error(message);
  process.exit(2);
}

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {string[]} */
  const positional = [];
  /** @type {string | null} */
  let out = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '--out') {
      out = argv[i + 1] ?? fail('--out 后面要跟文件名');
      i += 1;
    } else if (arg.startsWith('--out=')) {
      out = arg.slice('--out='.length);
    } else if (arg.startsWith('--')) {
      fail(`不认识的选项 ${arg}\n${USAGE}`);
    } else {
      positional.push(arg);
    }
  }
  return { positional, out };
}

/**
 * @param {string} path
 * @returns {unknown}
 */
function readJson(path) {
  if (!existsSync(path)) {
    fail(`找不到文件 ${path}`);
  }
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (e) {
    fail(`${path} 不是合法的 JSON:${e instanceof Error ? e.message : String(e)}`);
  }
}

/**
 * @param {string | null} out
 * @param {unknown} data
 * @param {string} what
 */
function emit(out, data, what) {
  const text = `${JSON.stringify(data, null, 2)}\n`;
  if (out === null) {
    process.stdout.write(text);
    return;
  }
  const path = resolve(process.cwd(), out);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  console.error(`已写出${what}:${path}`);
}

const [command, ...rest] = process.argv.slice(2);
if (command !== 'script' && command !== 'layout' && command !== 'check') {
  fail(USAGE);
}
const { positional, out } = parseArgs(rest);

const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  // 只用 ssrLoadModule,不需要 HMR socket 和文件监听。
  server: { middlewareMode: true, ws: false, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true },
});

let exitCode = 0;
try {
  const load = (/** @type {string} */ path) => server.ssrLoadModule(path);
  const [catalog, voiceScript, voiceCheck, stub, offlineEnv] = await Promise.all([
    load('/src/film/catalog.ts'),
    load('/src/film/voiceScript.ts'),
    load('/src/film/voiceCheck.ts'),
    load('/src/testing/domStub.ts'),
    load('/src/export/offlineEnv.ts'),
  ]);
  const dryRun = {
    createCanvas: () => stub.createStubCanvas(),
    createYielder: offlineEnv.messageChannelYielder,
  };

  /**
   * 影片内容先在正常环境里加载好(动态 import 走 Vite),再装 DOM 桩干跑。
   * @template T
   * @param {() => Promise<T>} body
   * @returns {Promise<T>}
   */
  const withDom = async (body) => {
    const dom = stub.installDomStub();
    try {
      return await body();
    } finally {
      dom.restore();
    }
  };

  if (command === 'script') {
    const [film] = positional;
    if (film === undefined) {
      fail(USAGE);
    }
    const segments = await catalog.loadFilm(film).catch((/** @type {unknown} */ e) =>
      fail(e instanceof Error ? e.message : String(e)),
    );
    const { script, problems } = await withDom(() => voiceScript.buildVoiceScript(film, segments, dryRun));
    if (problems.length > 0) {
      console.error(voiceCheck.formatProblems(problems));
    }
    emit(out, script, '台词稿');
    const lines = script.segments.reduce(
      (/** @type {number} */ n, /** @type {{ lines: unknown[] }} */ s) => n + s.lines.length,
      0,
    );
    console.error(`《${film}》:${script.segments.length} 段,${lines} 句`);
    exitCode = problems.some((/** @type {Problem} */ p) => p.level === 'error') ? 1 : 0;
  } else if (command === 'layout') {
    const [scriptPath, measuredPath] = positional;
    if (scriptPath === undefined || measuredPath === undefined) {
      fail(USAGE);
    }
    const script = readJson(resolve(process.cwd(), scriptPath));
    const measured = readJson(resolve(process.cwd(), measuredPath));
    const { sheet, problems } = voiceScript.layoutSheet(script, measured);
    if (problems.length > 0) {
      console.error(voiceCheck.formatProblems(problems));
    }
    emit(out, sheet, '时间表');
    exitCode = problems.some((/** @type {Problem} */ p) => p.level === 'error') ? 1 : 0;
  } else {
    const [film, sheetPath] = positional;
    if (film === undefined || sheetPath === undefined) {
      fail(USAGE);
    }
    const segments = await catalog.loadFilm(film).catch((/** @type {unknown} */ e) =>
      fail(e instanceof Error ? e.message : String(e)),
    );
    const absolute = resolve(process.cwd(), sheetPath);
    const raw = readJson(absolute);
    // 音频路径相对时间表所在目录;写成网址的不查(可能在别的服务器上)。
    const audioExists = (/** @type {string} */ file) =>
      /^[a-z][a-z0-9+.-]*:/i.test(file) || existsSync(isAbsolute(file) ? file : resolve(dirname(absolute), file));
    const problems = await withDom(() => voiceCheck.checkVoiceSheet(segments, raw, dryRun, { audioExists }));
    const errors = problems.filter((/** @type {Problem} */ p) => p.level === 'error').length;
    if (problems.length > 0) {
      console.log(voiceCheck.formatProblems(problems));
    }
    console.log(
      errors > 0
        ? `\n${errors} 个错误,${problems.length - errors} 个提醒:时间表还不能交付`
        : problems.length > 0
          ? `\n没有错误,${problems.length} 个提醒`
          : '✓ 时间表没有问题',
    );
    exitCode = errors > 0 ? 1 : 0;
  }
} finally {
  await server.close();
}
process.exitCode = exitCode;
