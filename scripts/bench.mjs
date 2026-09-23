// 性能基线:跑 src/testing/bench.ts 里定义的负载,计时并与基线比对。
// node + 假 ctx 跑的是 CPU 侧(排版/插值/合成/曲面提取),不含 GPU 光栅 ——
// 回归信号看「相对变化」而不是绝对毫秒数;绝对帧率去浏览器里看。
//
// 用法:
//   npm run bench                    全部跑一遍,与基线比对(只报告,不失败)
//   npm run bench -- render          只跑名字含 render 的
//   npm run bench -- --save          把这次结果存成新基线
//   npm run bench -- --strict        任一负载比基线慢 25% 以上就 exit 2
//   npm run bench -- --rounds=50     每个负载固定跑 50 轮(默认自适应到约 1 秒)
import { createServer } from 'vite';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE = join(ROOT, 'scripts', 'bench.baseline.json');
const STRICT_LIMIT = 0.25;

const args = process.argv.slice(2);
const save = args.includes('--save');
const strict = args.includes('--strict');
const roundsArg = args.find((a) => a.startsWith('--rounds='));
const fixedRounds = roundsArg ? Math.max(1, Number(roundsArg.slice('--rounds='.length)) || 0) : 0;
const filters = args.filter((a) => !a.startsWith('--'));

/**
 * @param {number[]} xs
 * @returns {number}
 */
const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const hi = s[mid] ?? 0;
  if (s.length % 2 === 1) {
    return hi;
  }
  return (hi + (s[mid - 1] ?? 0)) / 2;
};

/**
 * 预热 2 轮,再采到约 1 秒(或固定轮数),返回每轮毫秒的中位数。
 * @param {() => unknown | Promise<unknown>} fn
 */
async function measure(fn) {
  await fn();
  await fn();
  const samples = [];
  if (fixedRounds > 0) {
    for (let i = 0; i < fixedRounds; i++) {
      const t0 = performance.now();
      await fn();
      samples.push(performance.now() - t0);
    }
    return median(samples);
  }
  const deadline = performance.now() + 1000;
  for (let i = 0; i < 200; i++) {
    const t0 = performance.now();
    await fn();
    samples.push(performance.now() - t0);
    if (performance.now() > deadline && samples.length >= 5) {
      break;
    }
  }
  return median(samples);
}

const server = await createServer({
  root: ROOT,
  logLevel: 'error',
  server: { middlewareMode: true, ws: false, hmr: false, watch: null },
  optimizeDeps: { noDiscovery: true },
});

try {
  const mod = await server.ssrLoadModule('/src/testing/bench.ts');
  /** @type {Array<{ name: string; create: () => (() => unknown | Promise<unknown>) }>} */
  const all = mod.BENCHMARKS ?? [];
  const benches = all.filter(
    (b) => filters.length === 0 || filters.some((k) => b.name.includes(k)),
  );
  if (benches.length === 0) {
    console.error(filters.length > 0 ? `没有匹配 ${filters.join(' / ')} 的负载` : '没有定义任何负载');
    process.exitCode = 1;
  } else {
    /** @type {Record<string, number>} */
    const results = {};
    for (const b of benches) {
      const fn = b.create();
      const ms = await measure(fn);
      results[b.name] = ms;
      console.log(`${b.name}: ${ms.toFixed(2)} ms/轮 (${(1000 / ms).toFixed(1)} 轮/秒)`);
    }
    if (save) {
      writeFileSync(
        BASELINE,
        JSON.stringify(
          { node: process.version, date: new Date().toISOString(), results },
          null,
          2,
        ) + '\n',
      );
      console.log(`\n基线已存到 scripts/bench.baseline.json`);
    } else if (existsSync(BASELINE)) {
      const base = JSON.parse(readFileSync(BASELINE, 'utf8')).results ?? {};
      let regressed = false;
      console.log('');
      for (const [name, ms] of Object.entries(results)) {
        if (!(base[name] > 0)) {
          console.log(`${name}: 新负载(无基线)`);
          continue;
        }
        const delta = (ms - base[name]) / base[name];
        const arrow = delta > 0.05 ? '▲慢' : delta < -0.05 ? '▼快' : '＝持平';
        console.log(`${name}: ${arrow} ${(delta * 100).toFixed(1)}% (基线 ${base[name].toFixed(2)}ms)`);
        if (delta > STRICT_LIMIT) {
          regressed = true;
        }
      }
      if (regressed && strict) {
        console.error(`\n有负载比基线慢超过 ${STRICT_LIMIT * 100}%,--strict 下失败`);
        process.exitCode = 2;
      }
    } else {
      console.log('\n没有基线文件,加 --save 存一份(这是第一次跑)');
    }
  }
} finally {
  await server.close();
}
