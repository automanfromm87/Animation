import type { ProgressVisual } from '../export/composite';
import { installDomStub } from '../testing/domStub';
import type { DomStub, StubCanvas } from '../testing/domStub';
import { installExportStub, installResizeObserverStub } from '../testing/exportStub';
import type { ExportStub, StubElement } from '../testing/exportStub';
import { equal, ok, suite } from '../testing/harness';
import type { Segment, SegmentHandle } from './film';
import { runFilm } from './film';
import { createDomChrome } from './chrome';
import {
  BAR_BLOCK_WITH_CHAPTERS_PX,
  PROGRESS_DEFAULTS,
  SUBTITLE_DEFAULTS,
  planFilm,
  resolveProgressVisual,
  resolveSubtitleVisual,
} from './timeline';

/**
 * 覆盖层(白闪 / 字幕 / 进度条)用例:DOM 由导出桩提供,能记属性、派发事件。
 * chrome 只从状态模型渲染,这里断言的是「模型 -> DOM」这一步。
 */
interface Probe extends Segment {
  finish(): void;
  elapsed: number;
}

function probe(name: string, log: string[], duration: number, subtitles?: Segment['subtitles'], extra: Partial<Segment> = {}): Probe {
  let resolveDone: (() => void) | null = null;
  const seg: Probe = {
    name,
    duration,
    elapsed: 0,
    ...(subtitles ? { subtitles } : {}),
    ...extra,
    play(): SegmentHandle {
      log.push(`play:${name}`);
      const done = new Promise<void>((r) => {
        resolveDone = r;
      });
      return {
        done,
        dispose: () => resolveDone?.(),
        resize: () => undefined,
        getElapsed: () => seg.elapsed,
        setPaused: () => undefined,
      };
    },
    finish: () => resolveDone?.(),
  };
  return seg;
}

interface Harness {
  dom: DomStub;
  ex: ExportStub;
  canvas: StubCanvas & HTMLCanvasElement;
  parent: StubElement;
}

async function withChrome(body: (h: Harness) => Promise<void>): Promise<void> {
  const dom = installDomStub();
  const ex = installExportStub();
  try {
    const canvas = dom.canvas();
    const parent = ex.mountedCanvas(canvas);
    await body({ dom, ex, canvas, parent });
  } finally {
    ex.restore();
    dom.restore();
  }
}

async function run(dom: DomStub, frames: number): Promise<void> {
  for (let i = 0; i < frames; i++) {
    dom.frame(16);
    await dom.flush();
  }
}

const byCss = (ex: ExportStub, fragment: string): StubElement | undefined =>
  ex.created().find((el) => String(el.style['cssText'] ?? '').includes(fragment));

const cssOf = (el: StubElement | undefined): string => String(el?.style['cssText'] ?? '');

/** cssText 同时包含全部片段的第一个元素。 */
const byCssAll = (ex: ExportStub, ...fragments: string[]): StubElement | undefined =>
  ex.created().find((el) => fragments.every((f) => cssOf(el).includes(f)));

/** 一眼能认出来的自定义进度条样式:每个字段都和默认值不同,DOM 上看到的就一定来自这份 spec。 */
function customProgress(over: Partial<ProgressVisual> = {}): ProgressVisual {
  return {
    position: 'bottom',
    blockPx: 38,
    trackPx: 5,
    color: '#f00',
    background: '#0f0',
    tickColor: 'rgba(1,2,3,0.4)',
    tickWidthPx: 3,
    tickPx: 8,
    chapterTickPx: 14,
    labelPx: 12,
    labelOffsetPx: 20,
    labelGapPx: 6,
    labelColor: '#123456',
    labelFontFamily: 'monospace',
    ticks: [
      { frac: 0, chapter: true, label: '一 · 甲' },
      { frac: 0.5, chapter: false, label: null },
    ],
    ...over,
  };
}

/** 直接用 createDomChrome 挂一套覆盖层(两段:章节卡 + 普通段)。 */
function mountChrome(parent: StubElement, progress: ProgressVisual | null): ReturnType<typeof createDomChrome> {
  const segs = [
    probe('C', [], 1, undefined, { marker: 'chapter', chapter: '甲' }),
    probe('S', [], 1),
  ];
  const plan = planFilm(segs);
  return createDomChrome({
    parent: parent as unknown as HTMLElement,
    segments: segs,
    plan,
    veilColor: '#fff',
    visual: resolveSubtitleVisual(1280, undefined, plan, 'serif'),
    progress,
    explicitFontFamily: false,
    callbacks: { seek: () => undefined, togglePause: () => undefined },
  });
}

export default suite('film 覆盖层', [
  [
    '字幕跟着分段时钟显示/隐藏,钳在 duration;视觉条对读屏隐藏,播报区同步文本',
    () =>
      withChrome(async ({ dom, ex, canvas }) => {
        const log: string[] = [];
        const seg = probe('A', log, 3, [
          { start: 0, end: 1, text: '甲' },
          { start: 2, end: 5, text: '乙' },
        ]);
        const film = runFilm(canvas, [seg], { transition: 0 });
        const live = ex.findByAttr('role', 'status');
        const visual = ex.findByAttr('aria-hidden', 'true');
        ok(live && visual, '字幕元素没建出来');
        seg.elapsed = 0.5;
        await run(dom, 2);
        equal(visual?.textContent, '甲');
        equal(visual?.style['display'], '');
        equal(live?.textContent, '甲');
        seg.elapsed = 1.5;
        await run(dom, 2);
        equal(visual?.style['display'], 'none');
        equal(live?.textContent, '');
        // 时钟超过 duration 时钳在 duration(=3):仍在「乙」的区间内。
        seg.elapsed = 10;
        await run(dom, 2);
        equal(visual?.textContent, '乙');
        film();
      }),
  ],
  [
    '字幕条的折行口径与导出一致:撑满容器再 fit-content 居中(max-width 才生效)、content-box、行高来自共享样式',
    () =>
      withChrome(async ({ ex, canvas }) => {
        const log: string[] = [];
        const film = runFilm(canvas, [probe('A', log, 3, [{ start: 0, end: 3, text: '甲' }])], {
          transition: 0,
        });
        const box = ex.findByAttr('aria-hidden', 'true');
        const css = String(box?.style['cssText'] ?? '');
        // left:50% + translateX(-50%) 的收缩适配可用宽度只有容器的一半,max-width:80% 形同虚设。
        ok(!css.includes('translateX'), `还在用 translateX 居中:${css}`);
        ok(css.includes('left:0;right:0') && css.includes('width:fit-content'), css);
        ok(css.includes('box-sizing:content-box'), 'max-width 要量文字区,内边距在外(与导出同口径)');
        equal(box?.style['maxWidth'], `${SUBTITLE_DEFAULTS.maxWidthRatio * 100}%`);
        equal(box?.style['lineHeight'], String(SUBTITLE_DEFAULTS.lineHeight));
        film();
      }),
  ],
  [
    '进度条宽度 = (已播完的段 + 本段时钟) / 全片',
    () =>
      withChrome(async ({ dom, ex, canvas }) => {
        const log: string[] = [];
        const a = probe('A', log, 2);
        const b = probe('B', log, 2);
        const film = runFilm(canvas, [a, b], { transition: 0 });
        const fill = byCss(ex, 'width:0%');
        ok(fill, '进度填充条没建出来');
        a.elapsed = 1;
        await run(dom, 2);
        equal(fill?.style['width'], '25.00%');
        a.finish();
        await run(dom, 2);
        b.elapsed = 1;
        await run(dom, 2);
        equal(fill?.style['width'], '75.00%');
        film();
      }),
  ],
  [
    '画布尺寸变化时重设字幕字号与底距',
    () =>
      withChrome(async ({ dom, ex, canvas }) => {
        const ro = installResizeObserverStub();
        try {
          const log: string[] = [];
          const seg = probe('A', log, 3, [{ start: 0, end: 3, text: '甲' }]);
          const film = runFilm(canvas, [seg], { transition: 0 });
          const visual = ex.findByAttr('aria-hidden', 'true');
          equal(visual?.style['fontSize'], '20px');
          ro.resize(canvas as unknown as StubCanvas, 600, 400);
          await run(dom, 1);
          equal(visual?.style['fontSize'], '14px', '字号没有跟着画布宽度变');
          film();
        } finally {
          ro.restore();
        }
      }),
  ],
  [
    '进度条键盘:方向键(含上下)切段、边界不重播、修饰键不劫持、空格暂停、PageDown 跳章',
    () =>
      withChrome(async ({ dom, ex, canvas }) => {
        const log: string[] = [];
        const segs = [
          probe('C1', log, 1, undefined, { marker: 'chapter', chapter: '一' }),
          probe('S', log, 1),
          probe('C2', log, 1, undefined, { marker: 'chapter', chapter: '二' }),
        ];
        const paused: boolean[] = [];
        const film = runFilm(canvas, segs, {
          transition: 0,
          onPausedChange: (p) => paused.push(p),
        });
        await run(dom, 1);
        const slider = ex.findByAttr('role', 'slider');
        ok(slider, '进度条没建出来');
        equal(slider?.getAttribute('aria-label'), '分段进度');
        const key = async (k: string, extra: Record<string, unknown> = {}): Promise<void> => {
          slider?.dispatch('keydown', { key: k, ...extra });
          await run(dom, 2);
        };
        await key('ArrowLeft'); // 已在第一段:不重播
        await key('Home');
        equal(log.join('|'), 'play:C1', `边界键重播了当前段:${log.join('|')}`);
        await key('ArrowRight', { ctrlKey: true }); // 修饰键:留给浏览器
        equal(log.join('|'), 'play:C1');
        await key('ArrowUp');
        equal(log.at(-1), 'play:S');
        await key('PageDown');
        equal(log.at(-1), 'play:C2');
        await key('End'); // 已在最后一段:不重播
        equal(log.filter((l) => l === 'play:C2').length, 1);
        equal(slider?.getAttribute('aria-valuenow'), '2');
        await key(' ');
        equal(paused.join(','), 'true');
        film();
      }),
  ],
  [
    '进度条点击:有 seekTime 就精确到秒;悬停提示显示指向时刻',
    () =>
      withChrome(async ({ ex, parent }) => {
        const segs = [probe('A', [], 2), probe('B', [], 2)];
        const plan = planFilm(segs);
        const visual = resolveSubtitleVisual(1280, undefined, plan, 'serif');
        const seconds: number[] = [];
        let segSeeks = 0;
        const chrome = createDomChrome({
          parent: parent as unknown as HTMLElement,
          segments: segs,
          plan,
          veilColor: '#fff',
          visual,
          progress: resolveProgressVisual(segs, undefined, plan, 1280, 'serif'),
          explicitFontFamily: false,
          callbacks: {
            seek: () => {
              segSeeks += 1;
            },
            seekTime: (s) => seconds.push(s),
            togglePause: () => undefined,
          },
        });
        const slider = ex.findByAttr('role', 'slider');
        ok(slider, '进度条没建出来');
        // 桩进度条宽 1280:点 3/4 处 = 全片 3 秒(B 段内偏移 1)。
        slider?.dispatch('click', { clientX: 960 });
        equal(seconds.join(','), '3');
        equal(segSeeks, 0, '有 seekTime 还走了按段跳');
        slider?.dispatch('pointermove', { clientX: 320 });
        const tip = byCss(ex, 'translateX(-50%)');
        equal(tip?.textContent, 'A 0:01 / 0:04');
        chrome.dispose();
      }),
  ],
  [
    '进度条点击:没有 seekTime 就退回按段跳(老宿主兼容)',
    () =>
      withChrome(async ({ ex, parent }) => {
        const segs = [probe('A', [], 2), probe('B', [], 2)];
        const plan = planFilm(segs);
        const visual = resolveSubtitleVisual(1280, undefined, plan, 'serif');
        const targets: number[] = [];
        const chrome = createDomChrome({
          parent: parent as unknown as HTMLElement,
          segments: segs,
          plan,
          veilColor: '#fff',
          visual,
          progress: resolveProgressVisual(segs, undefined, plan, 1280, 'serif'),
          explicitFontFamily: false,
          callbacks: {
            seek: (t) => targets.push(t),
            togglePause: () => undefined,
          },
        });
        ex.findByAttr('role', 'slider')?.dispatch('click', { clientX: 960 });
        equal(targets.join(','), '1');
        chrome.dispose();
      }),
  ],
  [
    'dispose 摘掉全部覆盖层并还原父节点的 position',
    () =>
      withChrome(async ({ ex, canvas, parent }) => {
        const g = globalThis as unknown as Record<string, unknown>;
        const saved = g['getComputedStyle'];
        g['getComputedStyle'] = () => ({ position: 'static', fontFamily: 'serif' });
        try {
          const log: string[] = [];
          const film = runFilm(canvas, [probe('A', log, 1, [{ start: 0, end: 1, text: '甲' }])], {
            transition: 0,
          });
          equal(parent.style['position'], 'relative');
          const overlay = ex.created().filter((el) => el !== parent);
          ok(overlay.length > 0, '没建覆盖层');
          film();
          ok(overlay.every((el) => el.removed), '有覆盖层没摘掉');
          equal(parent.style['position'], '', '父节点的 position 没还原');
        } finally {
          g['getComputedStyle'] = saved;
        }
      }),
  ],
  [
    'DOM 进度条按共享的 ProgressVisual 搭:轨道/填充/章节刻度/普通刻度/章名的尺寸与颜色都取自 spec',
    () =>
      withChrome(async ({ ex, parent }) => {
        const chrome = mountChrome(parent, customProgress());
        const slider = ex.findByAttr('role', 'slider');
        ok(slider, '进度条没建出来');
        ok(cssOf(slider).includes('bottom:0;height:38px'), `点击区块高度应取 blockPx:${cssOf(slider)}`);
        const track = byCss(ex, 'background:#0f0');
        ok(track, '轨道没建出来');
        ok(cssOf(track).includes('height:5px'), `轨道高度应取 trackPx:${cssOf(track)}`);
        ok(cssOf(track).includes('bottom:0'), cssOf(track));
        const fill = byCss(ex, 'width:0%');
        ok(fill, '填充条没建出来');
        ok(cssOf(fill).includes('background:#f00'), `填充色应取 color:${cssOf(fill)}`);
        ok(cssOf(fill).includes('height:5px'), `填充高度应取 trackPx:${cssOf(fill)}`);
        // 章节刻度:大刻度、填充色。
        const chapterTick = byCss(ex, 'left:0.000%;');
        ok(chapterTick, '章节刻度没建出来');
        ok(cssOf(chapterTick).includes('height:14px'), cssOf(chapterTick));
        ok(cssOf(chapterTick).includes('background:#f00'), cssOf(chapterTick));
        ok(cssOf(chapterTick).includes('width:3px'), `刻度宽应取 tickWidthPx:${cssOf(chapterTick)}`);
        // 普通刻度:小刻度、tickColor。
        const tick = byCss(ex, 'left:50.000%;');
        ok(tick, '普通刻度没建出来');
        ok(cssOf(tick).includes('height:8px'), cssOf(tick));
        ok(cssOf(tick).includes('background:rgba(1,2,3,0.4)'), cssOf(tick));
        // 章名:只有 label 非 null 的刻度才有。
        const labels = ex.created().filter((el) => el.textContent === '一 · 甲');
        equal(labels.length, 1, '章名应当恰好一个');
        const label = labels[0];
        const lc = cssOf(label);
        ok(lc.includes('bottom:20px'), `章名离边距应取 labelOffsetPx:${lc}`);
        ok(lc.includes('left:calc(0.000% + 6px)'), `章名右移应取 labelGapPx:${lc}`);
        ok(lc.includes('font-size:12px'), `章名字号应取 labelPx:${lc}`);
        ok(lc.includes('line-height:1;'), `章名行高 1(导出按行框近边定位):${lc}`);
        ok(lc.includes('color:#123456'), `章名颜色应取 labelColor:${lc}`);
        // 章名继承页面字体,不把 spec 里的 labelFontFamily 写回 DOM(那是从 DOM 读出来给导出用的)。
        ok(!lc.includes('font-family'), lc);
        // 字体来自导出桩的 getComputedStyle。
        equal(chrome.labelFontFamily, 'serif');
        equal(chrome.fontFamily, 'serif');
        chrome.dispose();
      }),
  ],
  [
    "进度条贴顶(position 'top'):区块、轨道、填充、刻度、章名、悬停提示全部改用 top 锚定",
    () =>
      withChrome(async ({ ex, parent }) => {
        const chrome = mountChrome(parent, customProgress({ position: 'top' }));
        const slider = ex.findByAttr('role', 'slider');
        ok(cssOf(slider).includes('top:0;height:38px'), cssOf(slider));
        ok(cssOf(byCss(ex, 'background:#0f0')).includes('top:0;'), '轨道没贴顶');
        ok(cssOf(byCss(ex, 'width:0%')).includes('top:0;'), '填充没贴顶');
        ok(cssOf(byCss(ex, 'left:0.000%;')).includes('top:0;'), '章节刻度没贴顶');
        ok(cssOf(byCss(ex, 'left:50.000%;')).includes('top:0;'), '普通刻度没贴顶');
        const label = ex.created().find((el) => el.textContent === '一 · 甲');
        ok(cssOf(label).includes('top:20px;'), cssOf(label));
        // 贴顶时提示放在区块下方:blockPx + 4。
        ok(byCss(ex, 'top:42px;transform:translateX(-50%)'), '悬停提示没按贴顶定位');
        const stray = ex.created().filter((el) => cssOf(el).includes('bottom:'));
        equal(stray.length, 0, `贴顶时还有元素按 bottom 定位:${stray.map(cssOf).join(' | ')}`);
        chrome.dispose();
      }),
  ],
  [
    'progress: null 不建进度条:没有 slider、没有填充,labelFontFamily 为 null;其余接口照常可调',
    () =>
      withChrome(async ({ ex, parent }) => {
        const chrome = mountChrome(parent, null);
        equal(ex.findByAttr('role', 'slider'), undefined, '关了进度条还建了 slider');
        equal(byCss(ex, 'width:0%'), undefined, '关了进度条还建了填充条');
        equal(chrome.labelFontFamily, null);
        equal(chrome.fontFamily, 'serif', '字幕字体不受进度条开关影响');
        // 没有进度条时 render / relayout / setSeekEnabled 都不能因为缺元素而抛错。
        chrome.render({ veilAlpha: 0, subtitle: '', progress: 0.5, index: 1 });
        chrome.relayout(resolveSubtitleVisual(600, undefined, planFilm([probe('A', [], 1)]), 'serif'), 10);
        chrome.setSeekEnabled(false);
        chrome.dispose();
      }),
  ],
  [
    'relayout(visual, labelPx) 更新章名字号与字幕样式;贴底时悬停提示跟着字幕块上移',
    () =>
      withChrome(async ({ ex, parent }) => {
        const chrome = mountChrome(parent, customProgress());
        const label = ex.created().find((el) => el.textContent === '一 · 甲');
        ok(label, '章名没建出来');
        const plan = planFilm([probe('A', [], 1, undefined, { chapter: '甲' })]);
        const next = { ...resolveSubtitleVisual(600, undefined, plan, 'serif'), fontPx: 30, bottomPx: 50 };
        chrome.relayout(next, 16);
        equal(label?.style['fontSize'], '16px', '章名字号没跟着 relayout 变');
        const sub = ex.findByAttr('aria-hidden', 'true');
        equal(sub?.style['fontSize'], '30px');
        equal(sub?.style['bottom'], '50px');
        const tip = byCss(ex, 'transform:translateX(-50%)');
        const expected = Math.round(50 + 30 * next.lineHeight + next.padY * 2 + 8);
        equal(tip?.style['bottom'], `${expected}px`);
        chrome.dispose();
      }),
  ],
  [
    'runFilm 的 progressStyle(颜色/轨道色/高度)一路传到 DOM 进度条;章名按出现顺序编号',
    () =>
      withChrome(async ({ ex, canvas }) => {
        const segs = [
          probe('C1', [], 1, undefined, { marker: 'chapter', chapter: '甲' }),
          probe('S', [], 1),
          probe('C2', [], 1, undefined, { marker: 'chapter', chapter: '乙' }),
        ];
        const film = runFilm(canvas, segs, {
          transition: 0,
          progressStyle: { color: '#abc', background: '#def', height: 4 },
        });
        const slider = ex.findByAttr('role', 'slider');
        ok(slider, '进度条没建出来');
        ok(cssOf(slider).includes(`height:${BAR_BLOCK_WITH_CHAPTERS_PX}px`), cssOf(slider));
        ok(byCssAll(ex, 'height:4px', 'background:#def'), '轨道没用 progressStyle 的高度/轨道色');
        ok(byCssAll(ex, 'height:4px', 'width:0%', 'background:#abc'), '填充没用 progressStyle 的高度/颜色');
        const chapterTicks = ex
          .created()
          .filter((el) => cssOf(el).includes(`height:${PROGRESS_DEFAULTS.chapterTickPx}px`));
        equal(chapterTicks.length, 2, '章节刻度个数不对');
        ok(chapterTicks.every((el) => cssOf(el).includes('background:#abc')), '章节刻度没用填充色');
        ok(
          byCssAll(ex, `height:${PROGRESS_DEFAULTS.tickPx}px`, `background:${PROGRESS_DEFAULTS.tickColor}`),
          '普通刻度没用默认 tickColor',
        );
        const labels = ex.created().filter((el) => el.textContent.includes(' · '));
        equal(labels.map((el) => el.textContent).join('|'), '一 · 甲|二 · 乙');
        film();
      }),
  ],
  [
    'runFilm 没给 progressStyle 时 DOM 进度条用 PROGRESS_DEFAULTS',
    () =>
      withChrome(async ({ ex, canvas }) => {
        const film = runFilm(canvas, [probe('A', [], 1), probe('B', [], 1)], { transition: 0 });
        ok(
          byCssAll(ex, `height:${PROGRESS_DEFAULTS.trackPx}px`, `background:${PROGRESS_DEFAULTS.background}`),
          '轨道没用默认样式',
        );
        ok(
          byCssAll(ex, 'width:0%', `background:${PROGRESS_DEFAULTS.color}`),
          '填充没用默认颜色',
        );
        film();
      }),
  ],
  [
    'FilmOptions.progress: false 不建进度条(没有 slider / 填充 / 刻度)',
    () =>
      withChrome(async ({ ex, canvas }) => {
        const film = runFilm(
          canvas,
          [probe('C', [], 1, undefined, { marker: 'chapter', chapter: '甲' }), probe('S', [], 1)],
          { transition: 0, progress: false },
        );
        equal(ex.findByAttr('role', 'slider'), undefined, '关了进度条还建了 slider');
        equal(byCss(ex, 'width:0%'), undefined, '关了进度条还建了填充条');
        equal(ex.created().filter((el) => el.textContent.includes(' · ')).length, 0, '关了进度条还建了章名');
        // 字幕条等其余覆盖层照常建。
        ok(ex.findByAttr('role', 'status'), '字幕播报区没建');
        film();
      }),
  ],
  [
    '画布尺寸变化时章名字号跟着画布宽度变(与导出共用 progressLabelPx)',
    () =>
      withChrome(async ({ dom, ex, canvas }) => {
        const ro = installResizeObserverStub();
        try {
          const film = runFilm(
            canvas,
            [probe('C', [], 1, undefined, { marker: 'chapter', chapter: '甲' }), probe('S', [], 1)],
            { transition: 0 },
          );
          const label = ex.created().find((el) => el.textContent === '一 · 甲');
          ok(cssOf(label).includes('font-size:14px'), `宽 1280 时章名 14px:${cssOf(label)}`);
          ro.resize(canvas as unknown as StubCanvas, 600, 400);
          await run(dom, 1);
          equal(label?.style['fontSize'], '10px', '章名字号没有跟着画布宽度变');
          film();
        } finally {
          ro.restore();
        }
      }),
  ],
  [
    '进度条颜色取浏览器解析后的计算值(CSS 变量画布认不得,导出要用 rgb);拿不到计算值时为 null',
    () =>
      withChrome(async ({ parent }) => {
        const g = globalThis as unknown as Record<string, unknown>;
        const saved = g['getComputedStyle'] as (el: StubElement) => Record<string, unknown>;
        // 模拟浏览器:把 CSS 变量解析成具体颜色。
        const resolved: Record<string, string> = { 'var(--brand)': 'rgb(1, 2, 3)', 'var(--track)': 'rgb(4, 5, 6)' };
        g['getComputedStyle'] = (el: StubElement) => {
          const bg = /background:([^;]+);/.exec(el.style['cssText'] ?? '')?.[1];
          return { ...saved(el), ...(bg !== undefined ? { backgroundColor: resolved[bg] ?? bg } : {}) };
        };
        try {
          const chrome = mountChrome(parent, customProgress({ color: 'var(--brand)', background: 'var(--track)' }));
          equal(chrome.progressColors?.color, 'rgb(1, 2, 3)');
          equal(chrome.progressColors?.background, 'rgb(4, 5, 6)');
          chrome.dispose();
        } finally {
          g['getComputedStyle'] = saved;
        }
        // 桩的 getComputedStyle 只给字体:拿不到颜色就不覆盖样式里的原值。
        const plain = mountChrome(parent, customProgress());
        equal(plain.progressColors, null);
        plain.dispose();
        const none = mountChrome(parent, null);
        equal(none.progressColors, null, '没有进度条时没有颜色');
        none.dispose();
      }),
  ],
]);
