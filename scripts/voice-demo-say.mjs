// 参考实现:外部配音方怎么把台词稿变成「音频 + 时间表」—— 这里用 macOS 自带的语音合成(say)演示。
// 真配音方把第 2 步换成自己的 TTS / 录音即可,其余照抄;规则见 docs/voice.md。
//
// 用法:
//   npm run voice:demo                          合成演示片 voice-demo 的配音,写进 public/voice/voice-demo/
//   npm run voice:demo -- --voice Tingting      指定声音(say -v '?' 列出可用的;缺省挑一个中文声音)
//   npm run voice:demo -- --rate 220            语速(say -r,每分钟字数)
//   npm run voice:demo -- --film film           给别的片子配(固定时长的片子要求每句放得进字幕窗口)
//   npm run voice:demo -- --out-dir 目录        输出目录(缺省 public/voice/<影片>/)
//   npm run voice:demo -- --dry-run             不合成,按草稿时长假装量出来,只验证流程(不写音频)
//
// 流程:
//   1. 导出台词稿:node scripts/voice.mjs script <影片> --out <临时目录>/script.json
//   2. 逐句合成:say -f 台词.txt -o 句.aiff → afinfo 量时长 → afconvert 转 AAC(.m4a)
//      句中标记:单独合成「标记前的文字」量时长,当作那个词在句中的时刻(近似,够用)
//   3. 写实测:<临时目录>/measured.json
//   4. 排时间表:node scripts/voice.mjs layout script.json measured.json --out <输出目录>/timing.json
//   5. 校验:node scripts/voice.mjs check <影片> <输出目录>/timing.json
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const VOICE_CLI = join(ROOT, 'scripts', 'voice.mjs');
/** 合成结果短于这个就当失败(没有语音权限、沙箱里拿不到语音服务时会合成出空文件)。 */
const MIN_SECONDS = 0.05;

const HELP = `用法:
  npm run voice:demo [-- --voice 声音] [--rate 语速] [--film 影片] [--out-dir 目录] [--dry-run]`;

/**
 * @param {string} message
 * @returns {never}
 */
function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/** @param {string[]} argv */
function parseArgs(argv) {
  /** @type {{ voice: string | null; rate: number | null; film: string; outDir: string | null; dryRun: boolean }} */
  const o = { voice: null, rate: null, film: 'voice-demo', outDir: null, dryRun: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? '';
    const value = () => {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) {
        fail(`${arg} 后面要跟一个值\n${HELP}`);
      }
      i += 1;
      return v;
    };
    if (arg === '--voice') {
      o.voice = value();
    } else if (arg === '--rate') {
      const rate = Number(value());
      if (!(Number.isFinite(rate) && rate > 0)) {
        fail('--rate 要一个正数(每分钟字数)');
      }
      o.rate = rate;
    } else if (arg === '--film') {
      o.film = value();
    } else if (arg === '--out-dir') {
      o.outDir = value();
    } else if (arg === '--dry-run') {
      o.dryRun = true;
    } else if (arg === '--help' || arg === '-h') {
      console.log(HELP);
      process.exit(0);
    } else {
      fail(`不认识的参数 ${arg}\n${HELP}`);
    }
  }
  return o;
}

/**
 * 调配音工具(scripts/voice.mjs)的一个子命令,返回退出码。
 * @param {string[]} args
 */
function voiceCli(args) {
  const r = spawnSync(process.execPath, [VOICE_CLI, ...args], { stdio: 'inherit', cwd: ROOT });
  if (r.error) {
    fail(`运行 voice.mjs 失败:${r.error.message}`);
  }
  return r.status ?? 1;
}

/**
 * 挑一个中文声音:指定了就用指定的,否则 Tingting 优先,再其次任意 zh_CN、zh_*。
 * @param {string | null} wanted
 */
function pickVoice(wanted) {
  let listing = '';
  try {
    listing = execFileSync('say', ['-v', '?'], { encoding: 'utf8' });
  } catch (e) {
    fail(`调不了 say(这个参考实现需要 macOS):${e instanceof Error ? e.message : String(e)}`);
  }
  /** @type {Array<{ name: string; locale: string }>} */
  const voices = [];
  for (const line of listing.split('\n')) {
    const m = line.match(/^(.*?)\s+([a-z]{2}_[A-Za-z]{2,})\s+#/);
    if (m && m[1] && m[2]) {
      voices.push({ name: m[1].trim(), locale: m[2] });
    }
  }
  if (wanted !== null) {
    const hit = voices.find((v) => v.name === wanted) ?? voices.find((v) => v.name.startsWith(wanted));
    if (!hit) {
      fail(`没有名为「${wanted}」的声音;可用的中文声音:${voices.filter((v) => v.locale.startsWith('zh')).map((v) => v.name).join('、') || '(无)'}`);
    }
    return hit.name;
  }
  const pick =
    voices.find((v) => /^Ting-?ting/i.test(v.name)) ??
    voices.find((v) => v.locale === 'zh_CN') ??
    voices.find((v) => v.locale.startsWith('zh'));
  if (!pick) {
    fail('系统里没有中文声音:在「系统设置 → 辅助功能 → 朗读内容 → 系统声音」里下载一个(比如 Tingting)');
  }
  return pick.name;
}

/**
 * afinfo 量音频时长(秒)。
 * @param {string} file
 */
function durationOf(file) {
  const out = execFileSync('afinfo', [file], { encoding: 'utf8' });
  const m = out.match(/estimated duration:\s*([\d.]+)\s*sec/);
  return m ? Number(m[1]) : 0;
}

/**
 * 合成一段话到 aiff,返回时长。合成出空文件时报错退出(沙箱、没有语音权限)。
 * @param {string} text
 * @param {string} aiff
 * @param {string} voice
 * @param {number | null} rate
 */
function synth(text, aiff, voice, rate) {
  const txt = `${aiff}.txt`;
  writeFileSync(txt, text, 'utf8');
  execFileSync('say', ['-v', voice, ...(rate !== null ? ['-r', String(rate)] : []), '-f', txt, '-o', aiff]);
  const seconds = durationOf(aiff);
  if (!(seconds >= MIN_SECONDS)) {
    fail(`「${text}」合成出来只有 ${seconds} 秒:语音合成没有工作(在沙箱里?没有语音权限?)。请在自己的终端里运行`);
  }
  return seconds;
}

const MARK = /<mark\s+name\s*=\s*["']([^"']+)["']\s*\/?>/g;

/** @param {string} text */
function stripMarks(text) {
  return text.replace(MARK, '');
}

/**
 * 标记之前的文字(去掉标签)。
 * @param {string} text
 * @param {string} mark
 */
function textBeforeMark(text, mark) {
  for (const m of text.matchAll(MARK)) {
    if (m[1] === mark) {
      return stripMarks(text.slice(0, m.index ?? 0));
    }
  }
  return '';
}

/**
 * 文件名:序号 + 台词 id(非 ASCII 字符换掉,网址里不用转义)。
 * @param {number} si
 * @param {number} li
 * @param {string} id
 */
function fileBase(si, li, id) {
  const slug = id.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '');
  return `${String(si + 1).padStart(2, '0')}-${String(li + 1).padStart(2, '0')}${slug !== '' ? `-${slug}` : ''}`;
}

const options = parseArgs(process.argv.slice(2));
if (!options.dryRun && process.platform !== 'darwin') {
  fail('这个参考实现用的是 macOS 自带的 say 与 afconvert;别的系统请换成自己的 TTS(流程照抄),或加 --dry-run 只验证流程');
}
const outDir = resolve(
  ROOT,
  options.outDir ?? (options.dryRun ? join(tmpdir(), `voice-${options.film}-dry-run`) : join('public', 'voice', options.film)),
);
const work = mkdtempSync(join(tmpdir(), 'voice-demo-'));
// fail() 走 process.exit,不会经过 finally:临时目录在进程退出时统一清掉。
process.on('exit', () => rmSync(work, { recursive: true, force: true }));
let exitCode = 0;
try {
  // 1. 台词稿。
  const scriptPath = join(work, 'script.json');
  if (voiceCli(['script', options.film, '--out', scriptPath]) !== 0) {
    fail('导出台词稿失败(见上面的报错)');
  }
  /** @type {{ segments: Array<{ id: string; kind: string; lines: Array<{ id: string; text: string; plain: string; marks: string[]; draft: { start: number; end: number; marks?: Record<string, number> } }> }> }} */
  const script = JSON.parse(readFileSync(scriptPath, 'utf8'));

  // 2. 逐句合成、量时长;3. 写实测。
  mkdirSync(outDir, { recursive: true });
  const voice = options.dryRun ? null : pickVoice(options.voice);
  console.log(options.dryRun ? '\n不合成(--dry-run):按草稿时长假装量出来' : `\n用声音「${voice}」合成:`);
  /** @type {Record<string, Record<string, { duration: number; marks?: Record<string, number>; audio?: string }>>} */
  const measured = {};
  script.segments.forEach((segment, si) => {
    /** @type {Record<string, { duration: number; marks?: Record<string, number>; audio?: string }>} */
    const byLine = {};
    segment.lines.forEach((line, li) => {
      const spoken = line.plain.trim();
      if (spoken === '') {
        return;
      }
      if (voice === null) {
        // 假装量出来:时长与标记都照草稿(timed 段的草稿标记在台词稿里)。
        /** @type {Record<string, number>} */
        const marks = {};
        for (const [name, at] of Object.entries(line.draft.marks ?? {})) {
          marks[name] = Math.max(0, at - line.draft.start);
        }
        byLine[line.id] = {
          duration: Math.max(0.5, line.draft.end - line.draft.start),
          ...(Object.keys(marks).length > 0 ? { marks } : {}),
        };
        return;
      }
      const base = fileBase(si, li, line.id);
      const aiff = join(work, `${base}.aiff`);
      const duration = synth(spoken, aiff, voice, options.rate);
      /** @type {Record<string, number>} */
      const marks = {};
      line.marks.forEach((mark, mi) => {
        const before = textBeforeMark(line.text, mark).trim();
        marks[mark] =
          before === '' ? 0 : Math.min(duration, synth(before, join(work, `${base}-m${mi}.aiff`), voice, options.rate));
      });
      const file = `${base}.m4a`;
      execFileSync('afconvert', ['-f', 'm4af', '-d', 'aac', aiff, join(outDir, file)]);
      byLine[line.id] = { duration, ...(line.marks.length > 0 ? { marks } : {}), audio: file };
      console.log(`  ${segment.id} / ${line.id}  ${duration.toFixed(2)} 秒  ${spoken}`);
    });
    measured[segment.id] = byLine;
  });
  const measuredPath = join(work, 'measured.json');
  writeFileSync(measuredPath, `${JSON.stringify(measured, null, 2)}\n`);

  // 4. 排时间表;5. 校验。
  const timingPath = join(outDir, 'timing.json');
  console.log('');
  const laid = voiceCli(['layout', scriptPath, measuredPath, '--out', timingPath]);
  console.log('');
  const checked = voiceCli(['check', options.film, timingPath]);
  exitCode = laid !== 0 || checked !== 0 ? 1 : 0;
  const shown = relative(ROOT, outDir).startsWith('..') ? outDir : relative(ROOT, outDir);
  console.log(
    exitCode === 0
      ? `\n✓ 完成:音频与时间表在 ${shown}/。${options.dryRun ? '' : '打开演示页听一听(页面右上角「开启声音」)。'}`
      : `\n时间表有问题(见上),需要调整后重跑。输出在 ${shown}/`,
  );
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exitCode = exitCode;
