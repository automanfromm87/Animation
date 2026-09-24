// 版面检查:在 node 里把影片的每个分段干跑一遍(横屏 1280×720 + 竖屏 405×720,每 0.5 秒 + 段尾采样),
// 找出文字出画、两块字互压、压住坐标轴刻度、被字幕条 / 进度条盖住、字太小、字幕折行超出安全区。
// 用 Vite 的 SSR 模块加载器直接跑 src 下的 TS(与 scripts/test.mjs、voice.mjs 同一套解析规则),不需要浏览器。
// node 里没有真实字体度量:Label 按「中文 1em、其余 0.6em」估宽,取景与检查用同一套。
//
// 用法:
//   npm run layout:check -- <影片> [--viewports 1280x720,405x720] [--interval 0.5] [--segment <序号或分段名>]...
//                              [--strokes] [--all] [--json <文件>] [--scene <场景键>] [--base <地址前缀>] [--no-fail]
//
// <影片> 是 src/film/catalog.ts 里的名字:film / derivatives / topology / voice-demo。
// public/voice/<影片>/timing.json 存在就按配音时间表排时长(与页面一致),否则 timedSegment 按草稿时间。
// --strokes 另查「线从字中间穿过」(信息级);--all 连信息级(运镜途中、淡入淡出时的瞬态)一起列出。
// 退出码:有错误级问题、或有分段没查成(起播抛错 / 播放出错 / 截不到绘制)→ 1(--no-fail 时 0);用法错误 → 2。
import { createServer } from 'vite';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const USAGE = `用法:
  npm run layout:check -- <影片> [--viewports 1280x720,405x720] [--interval 0.5] [--segment <序号或分段名>]...
                             [--strokes] [--all] [--json <文件>] [--scene <场景键>] [--base <地址前缀>] [--no-fail]`;

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  console.error(message);
  process.exit(2);
}

/**
 * @param {string} raw
 * @returns {Array<{ width: number; height: number }>}
 */
function parseViewports(raw) {
  const list = raw.split(',').map((part) => {
    const m = /^\s*(\d+)\s*[x×]\s*(\d+)\s*$/.exec(part);
    if (!m) {
      fail(`--viewports 的格式是 1280x720,405x720,收到「${part}」`);
    }
    const width = Number(m[1]);
    const height = Number(m[2]);
    if (!(width > 0 && height > 0)) {
      fail(`画幅必须是正数,收到「${part}」`);
    }
    return { width, height };
  });
  if (list.length === 0) {
    fail('--viewports 至少要一种画幅');
  }
  return list;
}

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {string[]} */
  const positional = [];
  /** @type {string[]} */
  const segments = [];
  const opts = {
    /** @type {Array<{ width: number; height: number }> | null} */
    viewports: null,
    interval: 0.5,
    strokes: false,
    all: false,
    /** @type {string | null} */
    json: null,
    /** @type {string | null} */
    scene: null,
    base: '',
    noFail: false,
  };
  /**
   * @param {number} i
   * @param {string} name
   */
  const value = (i, name) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) {
      fail(`${name} 后面要跟一个值\n${USAGE}`);
    }
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    if (arg === '--viewports') {
      opts.viewports = parseViewports(value(i, arg));
      i += 1;
    } else if (arg === '--interval') {
      const v = Number(value(i, arg));
      if (!(v > 0) || !Number.isFinite(v)) {
        fail('--interval 必须是正数(秒)');
      }
      opts.interval = v;
      i += 1;
    } else if (arg === '--segment') {
      segments.push(value(i, arg));
      i += 1;
    } else if (arg === '--json') {
      opts.json = value(i, arg);
      i += 1;
    } else if (arg === '--scene') {
      opts.scene = value(i, arg);
      i += 1;
    } else if (arg === '--base') {
      opts.base = value(i, arg);
      i += 1;
    } else if (arg === '--strokes') {
      opts.strokes = true;
    } else if (arg === '--all') {
      opts.all = true;
    } else if (arg === '--no-fail') {
      opts.noFail = true;
    } else if (arg.startsWith('--')) {
      fail(`不认识的选项 ${arg}\n${USAGE}`);
    } else {
      positional.push(arg);
    }
  }
  return { positional, segments, opts };
}

const { positional, segments: segmentArgs, opts } = parseArgs(process.argv.slice(2));
const [film] = positional;
if (film === undefined || positional.length > 1) {
  fail(USAGE);
}

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
  const [catalog, voice, layout, stub, offlineEnv, registry] = await Promise.all([
    load('/src/film/catalog.ts'),
    load('/src/film/voice.ts'),
    load('/src/film/layoutCheck.ts'),
    load('/src/testing/domStub.ts'),
    load('/src/export/offlineEnv.ts'),
    load('/src/sceneRegistry.ts'),
  ]);
  const env = {
    createCanvas: () => stub.createStubCanvas(),
    createYielder: offlineEnv.messageChannelYielder,
  };
  const raw = await catalog.loadFilm(film).catch((/** @type {unknown} */ e) =>
    fail(e instanceof Error ? e.message : String(e)),
  );

  // 场景键(?scene=):--scene 优先;否则片名本身、再试去掉连字符(voice-demo → voicedemo)。
  /** @param {string} key */
  const isFilmScene = (key) => Object.hasOwn(registry.SCENES, key) && registry.SCENES[key]?.kind === 'film';
  const squashed = film.replace(/[^a-z0-9]/gi, '');
  const sceneKey = opts.scene ?? (isFilmScene(film) ? film : isFilmScene(squashed) ? squashed : null);

  const dom = stub.installDomStub();
  try {
    // 配音:有时间表按它排时长与字幕(与页面一致),否则 timedSegment 干跑排草稿。
    const sheetPath = resolve(ROOT, 'public/voice', film, 'timing.json');
    let problems = 0;
    const onProblem = () => {
      problems += 1;
    };
    const prepared = existsSync(sheetPath)
      ? await voice.prepareVoice(raw, {
          sheet: JSON.parse(readFileSync(sheetPath, 'utf8')),
          audioBase: `http://localhost/voice/${film}/`,
          dryRun: env,
          onProblem,
        })
      : await voice.prepareVoice(raw, { dryRun: env, onProblem });
    if (problems > 0) {
      console.error(`(配音准备报了 ${problems} 个问题,详见 npm run voice:check)`);
    }
    /** @type {Array<{ name: string }>} */
    const segs = prepared.segments;

    /** @type {number[] | undefined} */
    let only;
    if (segmentArgs.length > 0) {
      only = segmentArgs.map((s) => {
        const n = Number(s);
        const index = /^\d+$/.test(s) && n < segs.length ? n : segs.findIndex((g) => g.name === s);
        if (index < 0) {
          fail(`《${film}》里没有分段「${s}」(写序号 0–${segs.length - 1} 或分段名)`);
        }
        return index;
      });
    }

    const report = await layout.checkFilmLayout(segs, {
      env,
      interval: opts.interval,
      ...(opts.viewports ? { viewports: opts.viewports } : {}),
      ...(only ? { segments: only } : {}),
      check: { strokes: opts.strokes },
      // 进度只在终端里刷一行(重定向到文件时不刷屏)。
      onProgress: (/** @type {number} */ done, /** @type {number} */ total) => {
        if (!process.stderr.isTTY) {
          return;
        }
        process.stderr.write(`\r版面检查 ${done}/${total}`);
        if (done === total) {
          process.stderr.write('\n');
        }
      },
    });
    console.log(
      layout.formatLayoutReport(report, {
        film,
        sceneKey,
        base: opts.base,
        minSeverity: opts.all ? 'info' : 'warning',
      }),
    );
    if (opts.json !== null) {
      const out = resolve(process.cwd(), opts.json);
      mkdirSync(dirname(out), { recursive: true });
      writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
      console.error(`已写出完整报告:${out}`);
    }
    const errors = report.issues.filter((/** @type {{ severity: string }} */ i) => i.severity === 'error').length;
    // 没查成的分段不能当「干净」:CI 里要和错误级问题一样拦下。
    const unchecked = report.failures.length;
    if (unchecked > 0) {
      console.error(`有 ${unchecked} 处分段没查成(见上面「没查成的分段」),按失败退出`);
    }
    exitCode = (errors > 0 || unchecked > 0) && !opts.noFail ? 1 : 0;
  } finally {
    dom.restore();
  }
} finally {
  await server.close();
}
process.exitCode = exitCode;
