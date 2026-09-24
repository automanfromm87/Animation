#!/usr/bin/env node
// 影片核验(film-authoring skill 自带):不改动仓库,在临时副本里
//   类型检查(tsc -p tsconfig.app.json)→ oxlint → 把影片文件导出的分段 / 分段清单逐个干跑,
//   核对「声明时长 vs 实际时间线」(±0.25 秒)、字幕区间 / 长度 / 语速、运行中报错(与 src/film/content.test.ts 同一套标准)。
// timedSegment 先经 prepareVoice(没有时间表 → 干跑排草稿)再审。不用先注册影片。
//
// 用法(在仓库根目录):
//   node skills/film-authoring/scripts/check-film.mjs src/film/myFilm.ts [更多 .ts]
//   node skills/film-authoring/scripts/check-film.mjs README.md        # 核验 markdown 里以 `// src/...ts` 开头的完整示例
// 结果:打印汇总;详细报告写到 <副本>/readme-verify-report.json。退出码:0 全过,1 有问题。
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../..');
const argv = process.argv.slice(2);
let copy = null;
const mds = [];
const tsFiles = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--copy') {
    copy = argv[++i];
  } else if (/\.tsx?$/.test(argv[i])) {
    const abs = path.resolve(argv[i]);
    const rel = path.relative(REPO, abs).split(path.sep).join('/');
    if (!rel.startsWith('src/') || !fs.existsSync(abs)) {
      console.error(`找不到 ${argv[i]}(要是仓库 src/ 下已存在的 .ts 文件)`);
      process.exit(2);
    }
    tsFiles.push(rel);
  } else {
    mds.push(path.resolve(argv[i]));
  }
}
if (mds.length === 0 && tsFiles.length === 0) {
  console.error('用法:node skills/film-authoring/scripts/check-film.mjs src/film/myFilm.ts [...] | README.md');
  process.exit(2);
}
copy ??= fs.mkdtempSync(path.join(os.tmpdir(), 'film-check-'));

const run = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 << 20, ...opts });

// 1. 干净的副本(node_modules 链回主仓库)。
fs.mkdirSync(copy, { recursive: true });
let r = run('rsync', ['-a', '--delete', '--exclude', 'node_modules', '--exclude', '.git', '--exclude', 'dist', `${REPO}/`, `${copy}/`]);
if (r.status !== 0) {
  console.error(r.stderr);
  process.exit(2);
}
if (!fs.existsSync(path.join(copy, 'node_modules'))) {
  fs.symlinkSync(path.join(REPO, 'node_modules'), path.join(copy, 'node_modules'));
}

// 2. 抽代码块。
const problems = [];
const blocks = [];
let unchecked = 0;
for (const md of mds) {
  const text = fs.readFileSync(md, 'utf8');
  const re = /```(?:ts|typescript|tsx)\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(text))) {
    const body = m[1];
    const line = text.slice(0, m.index).split('\n').length;
    const head = /^\/\/\s*(src\/[\w/.-]+\.tsx?)\b/.exec(body);
    if (!head) {
      unchecked += 1;
      continue;
    }
    blocks.push({ md: path.basename(md), line, file: head[1], body });
  }
}
const seen = new Map();
for (const b of blocks) {
  if (seen.has(b.file)) {
    problems.push(`${b.md}:${b.line} 与 ${seen.get(b.file)} 写的是同一个文件 ${b.file}(每个完整示例要用不同的文件名)`);
    continue;
  }
  seen.set(b.file, `${b.md}:${b.line}`);
  if (fs.existsSync(path.join(REPO, b.file))) {
    problems.push(`${b.md}:${b.line} 的 ${b.file} 是仓库里已有的文件(示例只能写新文件,改已有文件请用不带路径头的片段)`);
    continue;
  }
  const dest = path.join(copy, b.file);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, b.body);
  b.written = true;
}
const written = blocks.filter((b) => b.written);
for (const f of tsFiles) {
  written.push({ md: '(文件)', line: 0, file: f, body: '', written: true });
}

// 3. 类型检查。
const tsc = run('npx', ['tsc', '-p', 'tsconfig.app.json'], { cwd: copy });
const tscOut = (tsc.stdout + tsc.stderr).split('\n').filter((l) => l.trim() !== '');
const tscErrors = tscOut.filter((l) => /error TS\d+/.test(l));

// 4. lint(只看示例文件)。
let lintOut = [];
if (written.length > 0) {
  const lint = run('npx', ['oxlint', '--deny-warnings', ...written.map((b) => b.file)], { cwd: copy });
  if (lint.status !== 0) {
    lintOut = (lint.stdout + lint.stderr).split('\n').filter((l) => l.trim() !== '');
  }
}

// 5. 干跑审计:生成一个临时测试,审所有示例模块导出的分段。
const reportPath = path.join(copy, 'readme-verify-report.json');
const filmModules = written.filter((b) => b.file.startsWith('src/') && !/\.test\.tsx?$/.test(b.file));
const testFile = path.join(copy, 'src/film/__readme_verify.test.ts');
const rel = (f) => {
  let p = path.relative(path.join(copy, 'src/film'), path.join(copy, f)).replace(/\.tsx?$/, '');
  if (!p.startsWith('.')) {
    p = `./${p}`;
  }
  return p;
};
fs.writeFileSync(
  testFile,
  `import { writeFileSync } from 'node:fs';
import { createStubCanvas, installDomStub } from '../testing/domStub';
import { ok, suite } from '../testing/harness';
import { messageChannelYielder } from '../export/offlineEnv';
import type { Segment } from './types';
import { prepareVoice } from './voice';
import type { DryRunEnv } from './voice';
${filmModules.map((b, i) => `import * as m${i} from '${rel(b.file)}';`).join('\n')}

const MODULES: Array<[string, Record<string, unknown>]> = [
${filmModules.map((b, i) => `  ['${b.file}', m${i} as unknown as Record<string, unknown>],`).join('\n')}
];
const FPS = 60;
const TOL = 0.25;
const dryRunEnv: DryRunEnv = { createCanvas: () => createStubCanvas(), createYielder: messageChannelYielder };
const isSeg = (v: unknown): v is Segment =>
  typeof v === 'object' && v !== null && typeof (v as Segment).play === 'function' && typeof (v as Segment).duration === 'number';

async function dryRun(segment: Segment): Promise<{ settled: boolean; elapsed: number; errors: string[] }> {
  const dom = installDomStub();
  const errors: string[] = [];
  const { error } = console;
  console.error = (...args: unknown[]): void => {
    errors.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
  };
  try {
    const handle = segment.play(dom.canvas(), {});
    let settled = false;
    handle.done.then(
      () => {
        settled = true;
      },
      (e: unknown) => {
        settled = true;
        errors.push(e instanceof Error ? e.message : String(e));
      },
    );
    const limit = (segment.duration + 5) * FPS;
    for (let i = 0; i < limit && !settled; i++) {
      dom.frame(1000 / FPS);
      await dom.flush();
    }
    const elapsed = handle.getElapsed();
    handle.dispose();
    return { settled, elapsed, errors };
  } finally {
    console.error = error;
    dom.restore();
  }
}

export default suite('README 示例', [
  [
    '示例导出的分段:时长、字幕、运行错误',
    async () => {
      const report: Array<Record<string, unknown>> = [];
      const failures: string[] = [];
      for (const [file, mod] of MODULES) {
        const groups: Array<[string, Segment[]]> = [];
        for (const [name, value] of Object.entries(mod)) {
          if (isSeg(value)) {
            groups.push([name, [value]]);
          } else if (Array.isArray(value) && value.length > 0 && value.every(isSeg)) {
            groups.push([name, value]);
          }
        }
        if (groups.length === 0) {
          report.push({ file, note: '没有导出分段(只做了类型检查)' });
          continue;
        }
        const done = new Set<Segment>();
        // 清单优先(整部片子一起 prepareVoice),单独导出的分段再各审一次(已审过的跳过)。
        groups.sort((a, b) => b[1].length - a[1].length);
        for (const [name, segs] of groups) {
          const todo = segs.filter((s) => !done.has(s));
          if (todo.length === 0) {
            continue;
          }
          todo.forEach((s) => done.add(s));
          let prepared: readonly Segment[] = todo;
          const dom = installDomStub();
          try {
            prepared = (await prepareVoice(todo, { dryRun: dryRunEnv, onProblem: () => undefined })).segments;
          } catch (e) {
            failures.push(\`\${file} \${name}: prepareVoice 失败:\${e instanceof Error ? e.message : String(e)}\`);
          } finally {
            dom.restore();
          }
          let total = 0;
          for (const seg of prepared) {
            const r = await dryRun(seg);
            total += seg.duration;
            const entry: Record<string, unknown> = {
              file,
              export: name,
              segment: seg.name,
              duration: seg.duration,
              actual: Number(r.elapsed.toFixed(3)),
              subtitles: (seg.subtitles ?? []).length,
            };
            const bad: string[] = [];
            const warn: string[] = [];
            if (!r.settled) bad.push(\`duration + 5 秒内没有结束(已播 \${r.elapsed.toFixed(2)})\`);
            if (r.errors.length > 0) bad.push(\`运行中报错:\${r.errors[0]}\`);
            if (Math.abs(r.elapsed - seg.duration) > TOL) bad.push(\`声明 \${seg.duration} 秒,实际 \${r.elapsed.toFixed(2)} 秒\`);
            let prevEnd = 0;
            for (const s of seg.subtitles ?? []) {
              if (!(s.start >= 0 && s.end > s.start)) bad.push(\`字幕区间非法 \${s.start}–\${s.end}「\${s.text}」\`);
              if (s.start < prevEnd - 1e-9) bad.push(\`字幕重叠/乱序 \${s.start}「\${s.text}」\`);
              if (s.end > Math.min(seg.duration, r.elapsed) + 0.05) bad.push(\`字幕「\${s.text}」晚于分段结束\`);
              const secs = s.end - s.start;
              const chars = Array.from(s.text.replace(/\\s/g, '')).length;
              if (chars > 20) warn.push(\`字幕偏长(\${chars} 字,单行建议 ≤ 20)「\${s.text}」\`);
              if (secs > 0 && chars / secs > 4.5) warn.push(\`字幕偏快(\${(chars / secs).toFixed(1)} 字/秒,建议 ≤ 4.5)「\${s.text}」\`);
              prevEnd = s.end;
            }
            if (warn.length > 0) {
              entry['warnings'] = warn;
            }
            if (bad.length > 0) {
              entry['problems'] = bad;
              failures.push(\`\${file} › \${name} › \${seg.name}: \${bad.join(';')}\`);
            }
            report.push(entry);
          }
          report.push({ file, export: name, segments: prepared.length, totalSeconds: Number(total.toFixed(2)) });
        }
      }
      writeFileSync(${JSON.stringify(reportPath)}, JSON.stringify(report, null, 2));
      ok(failures.length === 0, failures.join('\\n'));
    },
  ],
]);
`,
);
const test = run('node', ['scripts/test.mjs', '__readme_verify'], { cwd: copy, env: { ...process.env, TEST_TIMEOUT: '600000' } });
const testOut = (test.stdout + test.stderr).split('\n');

// 6. 汇总。
console.log(`\n== 影片核验:${[...tsFiles, ...mds.map((m) => path.basename(m))].join(', ')}`);
console.log(`核验的文件 ${written.length} 个(${written.map((b) => b.file).join(', ') || '无'})${mds.length > 0 ? `;markdown 里不带路径头、未编译的代码块 ${unchecked} 个` : ''}`);
for (const p of problems) console.log(`✗ ${p}`);
console.log(tscErrors.length === 0 ? '✓ 类型检查通过' : `✗ 类型检查 ${tscErrors.length} 个错误:\n  ${tscErrors.join('\n  ')}`);
console.log(lintOut.length === 0 ? '✓ oxlint 通过' : `✗ oxlint:\n  ${lintOut.join('\n  ')}`);
const passed = test.status === 0;
if (fs.existsSync(reportPath)) {
  const rep = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  for (const e of rep) {
    if (e.segment) {
      const flag = e.problems ? '✗' : '✓';
      console.log(`  ${flag} ${e.file} › ${e.export} › ${e.segment}:声明 ${e.duration}s / 实际 ${e.actual}s,字幕 ${e.subtitles} 条${e.problems ? `\n      ✗ ${e.problems.join('\n      ✗ ')}` : ''}${e.warnings ? `\n      提醒:${e.warnings.join('\n      提醒:')}` : ''}`);
    } else if (e.totalSeconds !== undefined) {
      console.log(`  · ${e.file} › ${e.export}:${e.segments} 段,合计 ${e.totalSeconds}s`);
    } else if (e.note) {
      console.log(`  · ${e.file}:${e.note}`);
    }
  }
}
if (!passed) {
  console.log(`✗ 干跑审计未通过:\n${testOut.filter((l) => /✗|期望|错误|Error|error|声明|字幕/.test(l)).slice(0, 60).join('\n')}`);
} else {
  console.log('✓ 干跑审计通过');
}
const allOk = problems.length === 0 && tscErrors.length === 0 && lintOut.length === 0 && passed;
console.log(allOk ? '\n全部通过' : '\n有问题,见上');
fs.rmSync(copy, { recursive: true, force: true });
process.exit(allOk ? 0 : 1);
