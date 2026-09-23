import { installDomStub } from '../testing/domStub';
import type { DomStub, StubCanvas } from '../testing/domStub';
import { installExportStub, installResizeObserverStub } from '../testing/exportStub';
import type { ExportStub, StubElement } from '../testing/exportStub';
import { equal, ok, suite } from '../testing/harness';
import type { Segment, SegmentHandle } from './film';
import { runFilm } from './film';
import { createDomChrome } from './chrome';
import { SUBTITLE_DEFAULTS, planFilm, resolveSubtitleVisual } from './timeline';

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
          labelPx: 12,
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
          labelPx: 12,
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
]);
