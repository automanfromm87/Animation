import { createFakeCtx } from '../testing/fakeCtx';
import { equal, ok, suite } from '../testing/harness';
import type { SubtitleVisual } from './composite';
import { compositeFrame, wrapSubtitle } from './composite';

interface LoggedCall {
  op: string;
  fillStyle?: unknown;
  smoothing?: unknown;
  args?: number[];
  text?: string;
}

/** 记录调用与关键状态的 ctx;drawImage / roundRect 照抄浏览器的抛错条件(抛错的调用不进日志)。 */
function strictCtx(log: LoggedCall[]): CanvasRenderingContext2D {
  return createFakeCtx({
    record: false,
    overrides: {
      drawImage: (img: { width: number; height: number }) => {
        if (!img || img.width <= 0 || img.height <= 0) {
          throw new Error('InvalidStateError: source canvas has zero dimension');
        }
      },
      roundRect: (_x: number, _y: number, _w: number, _h: number, r: number) => {
        if (typeof r === 'number' && r < 0) {
          throw new RangeError('radii must be non-negative');
        }
      },
    },
    onCall: (call, state) => {
      if (call.op.startsWith('=')) {
        return;
      }
      log.push(
        call.op === 'drawImage'
          ? { op: call.op, smoothing: state['imageSmoothingQuality'] }
          : {
              op: call.op,
              fillStyle: state['fillStyle'],
              args: call.args,
              ...(typeof call.value === 'string' ? { text: call.value } : {}),
            },
      );
    },
  }).ctx;
}

function visual(over: Partial<SubtitleVisual> = {}): SubtitleVisual {
  return {
    fontPx: 18,
    fontFamily: 'serif',
    color: '#ff0',
    background: '#003',
    padX: 16,
    padY: 6,
    radius: 8,
    lineHeight: 1.35,
    bottomPx: 40,
    maxWidthRatio: 0.8,
    ...over,
  };
}

const measureCtx = (): CanvasRenderingContext2D =>
  ({
    font: '16px serif',
    measureText: (t: string) => ({ width: t.length * 8 }),
  }) as unknown as CanvasRenderingContext2D;

export default suite('导出合成', [
  [
    '换行:拉丁词不被拆开,CJK 逐字断,行首不放句读标点',
    () => {
      const ctx = measureCtx();
      // 每行最多 10 个字符宽(80px)。
      const latin = wrapSubtitle('the derivative measures change', ctx, 80);
      equal(latin.join('|'), 'the|derivative|measures|change', '拉丁词被拆开了');
      // 第 11 个字符是逗号:不能落到第二行行首,也不能挂在第一行末尾超宽 ——
      // 浏览器会把「十，」一起换到下一行。
      const text = '一二三四五六七八九十，乙丙丁';
      const cjk = wrapSubtitle(text, ctx, 80);
      equal(cjk.join(' / '), '一二三四五六七八九 / 十，乙丙丁');
      ok(cjk.every((l) => l.length <= 10), `有行超宽:${cjk.join(' / ')}`);
    },
  ],
  [
    '换行:中文逐字可断(不按词切:「小车」「直线」中间浏览器也能断行)',
    () => {
      // 每行 5 个字宽(40px):逐字断是 5/5/5/1,按词断会变成 5/5/4/2。
      const lines = wrapSubtitle('小车沿直线运动位置随时间变化规律', measureCtx(), 40);
      equal(lines.map((l) => l.length).join(','), '5,5,5,1', `按词断行了:${lines.join(' / ')}`);
    },
  ],
  [
    '换行:连字符之前不断(之后可以),开头标点不留在行尾,f′(ξ) 这种串内部不断',
    () => {
      const ctx = measureCtx();
      // 每行 8 个字宽(64px)。「位置-时间」:连字符不能到行首,只能跟「置」一起走。
      const hyphen = wrapSubtitle('这是它的位置-时间图像', ctx, 64);
      ok(!hyphen.some((l) => l.startsWith('-')), `连字符跑到行首:${hyphen.join(' / ')}`);
      equal(hyphen.join(''), '这是它的位置-时间图像');
      const latin = wrapSubtitle('position-time graph', ctx, 80);
      equal(latin.join(' / '), 'position- / time graph', '拉丁词应在连字符之后断行');
      // 「使 f′(ξ) 等于 0」:左括号不能留在行尾,f′(ξ) 整体换行。
      const paren = wrapSubtitle('这时使 f′(ξ) 等于 0', ctx, 64);
      ok(!paren.some((l) => l.endsWith('(')), `左括号留在了行尾:${paren.join(' / ')}`);
      ok(paren.some((l) => l.includes('f′(ξ)')), `f′(ξ) 被拆开了:${paren.join(' / ')}`);
    },
  ],
  [
    '换行:单个片段比一整行还宽时按字符硬断;结果被缓存',
    () => {
      const ctx = measureCtx();
      const long = wrapSubtitle('abcdefghijklmnopqrstuvwxyz', ctx, 80);
      ok(long.length >= 3, `长串没有硬断:${long.join(' / ')}`);
      ok(long.every((l) => l.length <= 10), `有行超宽:${long.join(' / ')}`);
      equal(wrapSubtitle('abcdefghijklmnopqrstuvwxyz', ctx, 80), long, '同参数应命中缓存');
    },
  ],
  [
    '字幕按共享的视觉样式画:底板色与文字色来自 visual,而不是写死的黑底白字',
    () => {
      const log: Array<{ op: string; fillStyle?: unknown }> = [];
      compositeFrame(strictCtx(log), 1920, 1080, {
        main: { width: 1920, height: 1080 } as HTMLCanvasElement,
        mainRect: { x: 0, y: 0, w: 1920, h: 1080 },
        scale: 1,
        veilAlpha: 0,
        veilColor: '#fff',
        subtitle: { text: '一条字幕', visual: visual() },
      });
      equal(log.find((l) => l.op === 'roundRect')?.fillStyle, '#003');
      equal(log.find((l) => l.op === 'fillText')?.fillStyle, '#ff0');
    },
  ],
  [
    '字幕按「画面宽 × maxWidthRatio」折行;折了行的底板撑满最大宽度、单行收缩到文字宽(与 DOM 的 fit-content 同口径);行距 = 字号 × lineHeight',
    () => {
      const frame = (text: string, log: LoggedCall[]): void =>
        compositeFrame(strictCtx(log), 400, 300, {
          main: { width: 400, height: 300 } as HTMLCanvasElement,
          mainRect: { x: 0, y: 0, w: 400, h: 300 },
          scale: 1,
          veilAlpha: 0,
          veilColor: '#fff',
          subtitle: { text, visual: visual() },
        });
      // 假 ctx 每字 8px;最大文字宽 400 × 0.8 = 320px = 40 字。
      const long: LoggedCall[] = [];
      frame('长'.repeat(60), long);
      const texts = long.filter((l) => l.op === 'fillText');
      equal(texts.map((l) => l.text?.length).join(','), '40,20', '折行宽度不是画面宽的 80%');
      const dy = (texts[1]?.args?.[1] ?? 0) - (texts[0]?.args?.[1] ?? 0);
      ok(Math.abs(dy - 18 * 1.35) < 1e-9, `行距 ${dy} 不是字号 × lineHeight`);
      // 拉丁词整词折行,每行只有 32 字宽(256px)、行尾留白:底板仍按最大宽度 320px 撑满。
      const words: LoggedCall[] = [];
      frame('abcdefghij '.repeat(6).trim(), words);
      equal(
        words.filter((l) => l.op === 'fillText').map((l) => l.text?.length).join(','),
        '32,32',
      );
      equal(words.find((l) => l.op === 'roundRect')?.args?.[2], 320 + 16 * 2, '折行后的底板应撑满最大宽度');
      const short: LoggedCall[] = [];
      frame('短'.repeat(10), short);
      equal(short.find((l) => l.op === 'roundRect')?.args?.[2], 80 + 16 * 2, '单行底板应收缩到文字宽');
    },
  ],
  [
    '缩小主画面时用高质量插值',
    () => {
      const log: Array<{ op: string; smoothing?: unknown }> = [];
      compositeFrame(strictCtx(log), 960, 540, {
        main: { width: 3840, height: 2160 } as HTMLCanvasElement,
        mainRect: { x: 0, y: 0, w: 960, h: 540 },
        scale: 0.5,
        veilAlpha: 0,
        veilColor: '#fff',
        subtitle: null,
      });
      equal(log.find((l) => l.op === 'drawImage')?.smoothing, 'high');
    },
  ],
  [
    '主画布 0 尺寸时只填底色,不抛错',
    () => {
      const log: Array<{ op: string }> = [];
      compositeFrame(strictCtx(log), 1920, 1080, {
        main: { width: 0, height: 0 } as HTMLCanvasElement,
        mainRect: { x: 0, y: 0, w: 1920, h: 1080 },
        scale: 1,
        veilAlpha: 0,
        veilColor: '#fff',
        subtitle: null,
      });
      equal(log.filter((l) => l.op === 'drawImage').length, 0);
      ok(log.some((l) => l.op === 'fillRect'), '底色也没填');
    },
  ],
  [
    '字幕圆角半径被夹紧,负半径不会抛 RangeError',
    () => {
      const log: Array<{ op: string }> = [];
      // scale 极小时 8*scale 趋近 0;矩形本身也可能比圆角还窄。
      compositeFrame(strictCtx(log), 400, 300, {
        main: { width: 10, height: 10 } as HTMLCanvasElement,
        mainRect: { x: 0, y: 0, w: 4, h: 3 },
        scale: 0.002,
        veilAlpha: 0,
        veilColor: '#fff',
        subtitle: { text: '一段很长的中文字幕用来逼出换行与极小的可用宽度', visual: visual({ radius: -5 }) },
      });
      ok(log.some((l) => l.op === 'roundRect'), '圆角矩形没画');
    },
  ],
]);
