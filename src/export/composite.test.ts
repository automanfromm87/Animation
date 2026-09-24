import { createFakeCtx } from '../testing/fakeCtx';
import { equal, ok, suite } from '../testing/harness';
import type { ExportProgress, ProgressVisual, SubtitleVisual } from './composite';
import { compositeFrame, wrapSubtitle } from './composite';

interface LoggedCall {
  op: string;
  fillStyle?: unknown;
  font?: unknown;
  alpha?: unknown;
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
              font: state['font'],
              alpha: state['globalAlpha'],
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

/** 进度条样式:几何数值与播放器默认值一致,颜色各不相同,方便从日志里认出是哪一笔。 */
function barVisual(over: Partial<ProgressVisual> = {}): ProgressVisual {
  return {
    position: 'bottom',
    blockPx: 38,
    trackPx: 3,
    color: '#111',
    background: '#ddd',
    tickColor: '#888',
    tickWidthPx: 2,
    tickPx: 8,
    chapterTickPx: 14,
    labelPx: 14,
    labelOffsetPx: 20,
    labelGapPx: 6,
    labelColor: '#555',
    labelFontFamily: 'Songti SC',
    ticks: [
      { frac: 0, chapter: true, label: '一 · 引子' },
      { frac: 0.5, chapter: false, label: null },
    ],
    ...over,
  };
}

interface BarFrameInit {
  EW?: number;
  EH?: number;
  mainRect?: { x: number; y: number; w: number; h: number };
  scale?: number;
  veilAlpha?: number;
  subtitle?: { text: string; visual: SubtitleVisual } | null;
}

/** 合成一帧带进度条的画面,返回调用日志。 */
function barFrame(progress: ExportProgress | null, init: BarFrameInit = {}): LoggedCall[] {
  const log: LoggedCall[] = [];
  const EW = init.EW ?? 1280;
  const EH = init.EH ?? 720;
  compositeFrame(strictCtx(log), EW, EH, {
    main: { width: EW, height: EH } as HTMLCanvasElement,
    mainRect: init.mainRect ?? { x: 0, y: 0, w: EW, h: EH },
    scale: init.scale ?? 1,
    veilAlpha: init.veilAlpha ?? 0,
    veilColor: '#fff',
    subtitle: init.subtitle ?? null,
    progress,
  });
  return log;
}

/** 像真画布一样:解析不了的颜色(这里用 CSS 变量代表)赋给 fillStyle 时静默忽略,保留上一个值。 */
function colorStrictCtx(log: LoggedCall[]): CanvasRenderingContext2D {
  const inner = strictCtx(log) as unknown as Record<string | symbol, unknown>;
  return new Proxy(inner, {
    get: (obj, prop) => obj[prop],
    set: (obj, prop, value) => {
      if (!(prop === 'fillStyle' && typeof value === 'string' && value.startsWith('var('))) {
        obj[prop] = value;
      }
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

/** 进度条那一段的调用:合成链里只有进度条会 clip,clip 之后的都是它画的。 */
function barOps(log: readonly LoggedCall[]): LoggedCall[] {
  const i = log.findIndex((l) => l.op === 'clip');
  return i < 0 ? [] : log.slice(i + 1);
}

const rects = (ops: readonly LoggedCall[], fillStyle?: string): string[] =>
  ops
    .filter((l) => l.op === 'fillRect' && (fillStyle === undefined || l.fillStyle === fillStyle))
    .map((l) => (l.args ?? []).join(','));

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
        progress: null,
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
          progress: null,
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
        progress: null,
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
        progress: null,
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
        progress: null,
      });
      ok(log.some((l) => l.op === 'roundRect'), '圆角矩形没画');
    },
  ],
  [
    '进度条(贴底、scale 1):先 clip 到主画面,再按共享样式画轨道 -> 填充 -> 刻度 -> 章名',
    () => {
      const log = barFrame({ value: 0.25, visual: barVisual() });
      const clipAt = log.findIndex((l) => l.op === 'clip');
      ok(clipAt > 0, '进度条没有 clip');
      equal(log[clipAt - 1]?.op, 'rect', 'clip 之前应先 rect 出主画面');
      equal(log[clipAt - 1]?.args?.join(','), '0,0,1280,720');
      equal(rects(log.slice(0, clipAt), '#ddd').length, 0, '轨道画在了 clip 之前');
      const ops = barOps(log);
      // 轨道 3px 贴底;填充 = 1280 × 0.25;章节刻度 14px 高、墨色;普通刻度 8px 高、刻度色。
      equal(
        rects(ops).join(' | '),
        '0,717,1280,3 | 0,717,320,3 | 0,706,2,14 | 640,712,2,8',
        `进度条几何不对:${rects(ops).join(' | ')}`,
      );
      equal(rects(ops, '#ddd').join(' | '), '0,717,1280,3', '轨道应用 background');
      equal(rects(ops, '#111').join(' | '), '0,717,320,3 | 0,706,2,14', '填充与章节刻度应用 color');
      equal(rects(ops, '#888').join(' | '), '640,712,2,8', '普通刻度应用 tickColor');
      const texts = ops.filter((l) => l.op === 'fillText');
      equal(texts.length, 1, 'label 为 null 的刻度不该画章名');
      equal(texts[0]?.text, '一 · 引子');
      // x = 刻度左边缘 + labelGap;y = 底边 - (labelOffset + 字号/2) = 720 - 27。
      equal(texts[0]?.args?.join(','), '6,693');
      equal(texts[0]?.fillStyle, '#555');
      equal(texts[0]?.font, '14px Songti SC');
      equal(
        log.filter((l) => l.op === 'save').length,
        log.filter((l) => l.op === 'restore').length,
        'save / restore 不配对',
      );
    },
  ],
  [
    '进度条贴顶:几何上下镜像(轨道 y=0、刻度从顶边往下、章名中线 y=27);上下黑边时贴的是主画面的边',
    () => {
      const top = barOps(barFrame({ value: 0.25, visual: barVisual({ position: 'top' }) }));
      equal(rects(top).join(' | '), '0,0,1280,3 | 0,0,320,3 | 0,0,2,14 | 640,0,2,8');
      equal(top.find((l) => l.op === 'fillText')?.args?.join(','), '6,27');
      // 主画面在导出帧里 y=90..630:贴顶贴 90、贴底贴 630,而不是导出帧的 0 / 720。
      const mainRect = { x: 0, y: 90, w: 1280, h: 540 };
      const boxedTop = barOps(barFrame({ value: 0, visual: barVisual({ position: 'top' }) }, { mainRect }));
      equal(rects(boxedTop).join(' | '), '0,90,1280,3 | 0,90,2,14 | 640,90,2,8');
      equal(boxedTop.find((l) => l.op === 'fillText')?.args?.join(','), '6,117');
      const boxedBottom = barOps(barFrame({ value: 0, visual: barVisual() }, { mainRect }));
      equal(rects(boxedBottom).join(' | '), '0,627,1280,3 | 0,616,2,14 | 640,622,2,8');
      equal(boxedBottom.find((l) => l.op === 'fillText')?.args?.join(','), '6,603');
    },
  ],
  [
    '左右黑边 + 缩放:clip 到主画面,轨道/刻度按 css 像素 × scale 落到整像素,章名字号与位置按 scale 缩放',
    () => {
      const log = barFrame(
        { value: 0.5, visual: barVisual() },
        { mainRect: { x: 160, y: 0, w: 960, h: 720 }, scale: 0.75 },
      );
      const clipAt = log.findIndex((l) => l.op === 'clip');
      equal(log[clipAt - 1]?.args?.join(','), '160,0,960,720', 'clip 应是主画面而不是整帧');
      const ops = barOps(log);
      // 轨道 3 × 0.75 = 2.25 -> 2;章节刻度 14 × 0.75 = 10.5 -> 11;普通刻度 8 × 0.75 = 6;
      // 刻度宽 max(1, round(2 × 0.75)) = 2;中点刻度 x = 160 + 0.5 × 960 = 640。
      equal(rects(ops, '#ddd').join(' | '), '160,718,960,2');
      equal(rects(ops, '#111').join(' | '), '160,718,480,2 | 160,709,2,11');
      equal(rects(ops, '#888').join(' | '), '640,714,2,6');
      ok(
        ops.filter((l) => l.op === 'fillRect').every((l) => (l.args ?? []).every(Number.isInteger)),
        `矩形没有对齐整像素:${rects(ops).join(' | ')}`,
      );
      const label = ops.find((l) => l.op === 'fillText');
      // x = 160 + 6 × 0.75;y = 720 - (20 + 7) × 0.75。
      equal(label?.args?.join(','), '164.5,699.75');
      equal(label?.font, '10.5px Songti SC');
    },
  ],
  [
    '极小缩放下轨道、刻度至少 1 像素(不会缩没)',
    () => {
      const ops = barOps(
        barFrame({ value: 0, visual: barVisual() }, { EW: 256, EH: 144, scale: 0.2 }),
      );
      // 轨道 0.6 -> 1;章节刻度 2.8 -> 3;普通刻度 1.6 -> 2;刻度宽 0.4 -> 1。
      equal(rects(ops).join(' | '), '0,143,256,1 | 0,141,1,3 | 128,142,1,2');
    },
  ],
  [
    '层叠顺序:转场白闪与字幕底板在进度条之下(进度条最后画)',
    () => {
      const log = barFrame(
        { value: 0.5, visual: barVisual() },
        { veilAlpha: 0.5, subtitle: { text: '一条字幕', visual: visual() } },
      );
      const veilAt = log.findIndex((l) => l.op === 'fillRect' && l.alpha === 0.5);
      const subAt = log.findIndex((l) => l.op === 'roundRect');
      const trackAt = log.findIndex((l) => l.op === 'fillRect' && l.fillStyle === '#ddd');
      ok(veilAt >= 0 && subAt >= 0 && trackAt >= 0, `缺笔:白闪 ${veilAt}、字幕 ${subAt}、轨道 ${trackAt}`);
      ok(veilAt < trackAt, '进度条被白闪盖住了');
      ok(subAt < trackAt, '进度条被字幕底板盖住了');
      const lastText = log.filter((l) => l.op === 'fillText').at(-1);
      equal(lastText?.text, '一 · 引子', '章名应是最后画的字');
    },
  ],
  [
    '填充比例夹紧到 [0,1]:超过 1 画满,负数与 NaN 不画填充;轨道照画',
    () => {
      const vis = barVisual({ ticks: [] });
      const full = barOps(barFrame({ value: 1.7, visual: vis }));
      equal(rects(full, '#111').join(' | '), '0,717,1280,3', '超过 1 应画满而不是溢出');
      for (const value of [-1, Number.NaN, 0]) {
        const ops = barOps(barFrame({ value, visual: vis }));
        equal(rects(ops, '#111').length, 0, `value=${value} 不该画填充`);
        equal(rects(ops, '#ddd').join(' | '), '0,717,1280,3', `value=${value} 轨道没画`);
      }
      equal(full.filter((l) => l.op === 'fillText').length, 0, '没有刻度就不该有章名');
    },
  ],
  [
    'scale 为 0 / NaN / 负数或主画面 0 尺寸时不画进度条,也不抛错',
    () => {
      const bar: ExportProgress = { value: 0.5, visual: barVisual() };
      for (const scale of [0, Number.NaN, -1]) {
        const log = barFrame(bar, { scale });
        ok(!log.some((l) => l.op === 'clip'), `scale=${scale} 仍在画进度条`);
        equal(rects(log).join(' | '), '0,0,1280,720', `scale=${scale} 只该有底色`);
        equal(log.filter((l) => l.op === 'fillText').length, 0);
      }
      const empty = barFrame(bar, { mainRect: { x: 0, y: 0, w: 0, h: 720 } });
      ok(!empty.some((l) => l.op === 'clip'), '主画面 0 宽仍在画进度条');
    },
  ],
  [
    'trackPx 为 0:不画轨道与填充,刻度与章名照画',
    () => {
      const ops = barOps(barFrame({ value: 0.5, visual: barVisual({ trackPx: 0 }) }));
      equal(rects(ops, '#ddd').length, 0, '轨道不该画');
      equal(rects(ops, '#111').join(' | '), '0,706,2,14', '只该剩章节刻度(没有填充)');
      equal(rects(ops, '#888').join(' | '), '640,712,2,8');
      equal(ops.filter((l) => l.op === 'fillText').length, 1);
    },
  ],
  [
    '章名只画 label 非 null 的刻度(与是否章节刻度无关);全部为 null 时一个字也不画',
    () => {
      const ops = barOps(
        barFrame({
          value: 0,
          visual: barVisual({
            ticks: [
              { frac: 0, chapter: true, label: '一 · 甲' },
              { frac: 0.25, chapter: false, label: null },
              { frac: 0.5, chapter: false, label: '二 · 乙' },
              { frac: 0.75, chapter: true, label: null },
            ],
          }),
        }),
      );
      const texts = ops.filter((l) => l.op === 'fillText');
      equal(texts.map((l) => `${l.text}@${l.args?.join(',')}`).join(' | '), '一 · 甲@6,693 | 二 · 乙@646,693');
      equal(rects(ops, '#111').join(' | '), '0,706,2,14 | 960,706,2,14', '没有章名的章节刻度也要画大刻度');
      equal(rects(ops, '#888').join(' | '), '320,712,2,8 | 640,712,2,8');
      const bare = barOps(
        barFrame({
          value: 0,
          visual: barVisual({
            ticks: [
              { frac: 0, chapter: true, label: null },
              { frac: 0.5, chapter: false, label: null },
            ],
          }),
        }),
      );
      equal(bare.filter((l) => l.op === 'fillText').length, 0);
      equal(rects(bare).length, 3, '轨道 + 两个刻度');
    },
  ],
  [
    '进度条颜色画布解析不了(CSS 变量、拼错)时画成透明,不沿用上一个 fillStyle(不会冒出一条黑线或把填充画成轨道色)',
    () => {
      const log: LoggedCall[] = [];
      compositeFrame(colorStrictCtx(log), 1280, 720, {
        main: { width: 1280, height: 720 } as HTMLCanvasElement,
        mainRect: { x: 0, y: 0, w: 1280, h: 720 },
        scale: 1,
        veilAlpha: 0,
        veilColor: '#fff',
        subtitle: null,
        progress: { value: 0.5, visual: barVisual({ background: 'var(--track)', color: 'var(--brand)' }) },
      });
      const ops = barOps(log);
      equal(rects(ops, 'rgba(0,0,0,0)').join(' | '), '0,717,1280,3 | 0,717,640,3 | 0,706,2,14', '认不得的颜色应当画成透明');
      equal(rects(ops, '#000').length, 0, '沿用了画布默认的黑色');
      equal(rects(ops, '#fff').length, 0, '沿用了底色');
      equal(rects(ops, '#888').join(' | '), '640,712,2,8', '认得的颜色照常画');
    },
  ],
]);
