import { Label } from '../engine';
import { isFilmError } from '../export/types';
import { flushTasks } from '../testing/domStub';
import { installExportStub } from '../testing/exportStub';
import type { ExportStub, StubElement } from '../testing/exportStub';
import { equal, ok, suite } from '../testing/harness';
import { directedSegment } from './segments';
import { formatFilmTime } from './storyboard';
import type { StoryboardView, StoryboardViewEnv, StoryboardViewInit } from './storyboardView';
import { mountStoryboard } from './storyboardView';
import type { Segment } from './types';

/**
 * 故事板视图用例:DOM 由导出桩提供(能记属性、textContent、remove),
 * 渲染核心照常在桩画布上跑真分段;定时器由用例手动触发,让出用 flushTasks。
 */

function scripted(name: string, duration: number, text?: string): Segment {
  return directedSegment(name, duration, text ? [{ start: 0, end: duration, text }] : [], async (env) => {
    env.scene.add(new Label('hi'));
    await env.wait(duration);
  });
}

interface Timers {
  pending: Array<{ id: number; fn: () => void; ms: number }>;
  fire(): void;
}

function manualTimers(): Timers & Pick<StoryboardViewEnv, 'setTimer' | 'clearTimer'> {
  let next = 1;
  const t: Timers & Pick<StoryboardViewEnv, 'setTimer' | 'clearTimer'> = {
    pending: [],
    fire() {
      const due = t.pending;
      t.pending = [];
      for (const p of due) {
        p.fn();
      }
    },
    setTimer: (fn, ms) => {
      const id = next++;
      t.pending.push({ id, fn, ms });
      return id;
    },
    clearTimer: (id) => {
      t.pending = t.pending.filter((p) => p.id !== id);
    },
  };
  return t;
}

interface Harness {
  ex: ExportStub;
  container: StubElement & HTMLElement;
  timers: ReturnType<typeof manualTimers>;
  size: { width: number; height: number };
  canvases: () => number;
  mount(extra?: Partial<StoryboardViewInit>): StoryboardView;
}

async function withView(body: (h: Harness) => Promise<void>): Promise<void> {
  const ex = installExportStub();
  try {
    const container = document.createElement('section') as unknown as StubElement & HTMLElement;
    const timers = manualTimers();
    const size = { width: 1280, height: 720 };
    let canvases = 0;
    let clock = 0;
    const env: StoryboardViewEnv = {
      createCanvas: () => {
        canvases += 1;
        return document.createElement('canvas') as HTMLCanvasElement;
      },
      yieldTask: flushTasks,
      setTimer: timers.setTimer,
      clearTimer: timers.clearTimer,
      fontsReady: async () => undefined,
      now: () => {
        clock += 250;
        return clock;
      },
    };
    await body({
      ex,
      container,
      timers,
      size,
      canvases: () => canvases,
      mount: (extra) =>
        mountStoryboard({
          container,
          segments: [scripted('开场', 4, '第一句'), scripted('推导', 4, '第二句')],
          spec: '1,2,6',
          stageSize: () => ({ ...size }),
          title: '短片',
          previewHref: (s) => `/?scene=film&preview=${s}`,
          env,
          ...extra,
        }),
    });
  } finally {
    ex.restore();
  }
}

const byTag = (ex: ExportStub, tag: string): StubElement[] => ex.created().filter((el) => el.tagName === tag);
const items = (ex: ExportStub): StubElement[] => byTag(ex, 'LI').filter((el) => el.getAttribute('data-state') !== null);
const statusText = (ex: ExportStub): string =>
  ex.created().find((el) => el.tagName === 'SPAN' && el.getAttribute('aria-hidden') === 'true')?.textContent ?? '';
const liveText = (ex: ExportStub): string => ex.findByAttr('role', 'status')?.textContent ?? '';
/** 视图自己的根节点(aria-busy 写在它上面)。 */
const roots = (ex: ExportStub): StubElement[] => ex.created().filter((el) => el.getAttribute('data-storyboard') !== null);
const busy = (ex: ExportStub, nth = 0): string | null => roots(ex)[nth]?.getAttribute('aria-busy') ?? null;

export default suite('film 故事板视图', [
  [
    '挂载:每帧一格、链接到单帧预览;出齐后状态、说明、格子状态都更新',
    async () => {
      await withView(async (h) => {
        const view = h.mount();
        equal(view.plan.frames.length, 3);
        const lis = items(h.ex);
        equal(lis.length, 3);
        ok(lis.every((li) => li.getAttribute('data-state') === 'pending'));
        const links = byTag(h.ex, 'A');
        equal(links.map((a) => a.getAttribute('href')).join(','), '/?scene=film&preview=1,/?scene=film&preview=2,/?scene=film&preview=6');
        equal(links[2]?.getAttribute('aria-label'), `打开 ${formatFilmTime(6)} 的单帧预览`);
        equal(busy(h.ex), 'true');
        equal(h.container.getAttribute('aria-busy'), null, '不碰宿主容器的属性');
        ok(statusText(h.ex).includes('渲染中 0/3'), statusText(h.ex));
        equal(liveText(h.ex), '开始渲染故事板,共 3 帧');
        const result = await view.idle();
        equal(JSON.stringify(result), JSON.stringify({ done: 3, failed: 0, aborted: false }));
        ok(statusText(h.ex).includes('已出齐 3 帧'), statusText(h.ex));
        ok(statusText(h.ex).includes('按 1280×720 排版'), statusText(h.ex));
        ok(statusText(h.ex).includes('故事板 · 短片 · 3 帧'), statusText(h.ex));
        ok(liveText(h.ex).includes('已出齐 3 帧'), liveText(h.ex));
        equal(busy(h.ex), 'false');
        ok(lis.every((li) => li.getAttribute('data-state') === 'done'));
        const strongs = byTag(h.ex, 'STRONG').map((el) => el.textContent);
        equal(strongs.join(','), '0:01.0,0:02.0,0:06.0');
        const spans = byTag(h.ex, 'SPAN').map((el) => el.textContent);
        ok(spans.includes(' · 第 2/2 段 · 推导'), spans.join('|'));
        ok(spans.includes('段内 2.0s / 4.0s'), spans.join('|'));
        const subs = byTag(h.ex, 'DIV').map((el) => el.textContent);
        ok(subs.includes('第一句') && subs.includes('第二句'), subs.join('|'));
        // 缩略图按 16:9 的 640×360 出。
        const thumbs = byTag(h.ex, 'CANVAS').slice(0, 3) as unknown as HTMLCanvasElement[];
        ok(thumbs.every((c) => c.width === 640 && c.height === 360), thumbs.map((c) => `${c.width}x${c.height}`).join(','));
        view.dispose();
      });
    },
  ],
  [
    'resize:尺寸不变不排定时器;变了防抖重画(新一轮按新比例排版),尺寸变回去就撤掉',
    async () => {
      await withView(async (h) => {
        const view = h.mount();
        await view.idle();
        const grid = byTag(h.ex, 'OL')[0];
        ok(grid?.style['gridTemplateColumns']?.includes('338px') === true, grid?.style['gridTemplateColumns']);
        view.resize();
        equal(h.timers.pending.length, 0, '尺寸没变不该重画');
        h.size.width = 720;
        h.size.height = 1280;
        view.resize();
        equal(h.timers.pending.length, 1);
        equal(h.timers.pending[0]?.ms, 200);
        // 防抖:再来一次只留一个定时器。
        view.resize();
        equal(h.timers.pending.length, 1);
        const before = h.canvases();
        h.timers.fire();
        ok(statusText(h.ex).includes('按 720×1280 排版'), statusText(h.ex));
        ok(items(h.ex).every((li) => li.getAttribute('data-state') === 'pending'), '新一轮开始时格子回到待出');
        const result = await view.idle();
        equal(result?.done, 3);
        equal(h.canvases(), before + 1, '新一轮建一张主画布');
        ok(grid?.style['gridTemplateColumns']?.includes('150px') === true, grid?.style['gridTemplateColumns']);
        const thumbs = byTag(h.ex, 'CANVAS').slice(0, 3) as unknown as HTMLCanvasElement[];
        ok(thumbs.every((c) => c.width === 360 && c.height === 640), thumbs.map((c) => `${c.width}x${c.height}`).join(','));
        // 变了又变回来:撤掉还没到点的重画。
        h.size.width = 1000;
        view.resize();
        equal(h.timers.pending.length, 1);
        h.size.width = 720;
        view.resize();
        equal(h.timers.pending.length, 0);
        view.dispose();
      });
    },
  ],
  [
    '渲染中 dispose:本轮中止、不再改格子,视图建的节点全部删掉,定时器清掉',
    async () => {
      await withView(async (h) => {
        let n = 0;
        let view: StoryboardView | null = null;
        view = h.mount({
          env: {
            yieldTask: async () => {
              n += 1;
              if (n === 40) {
                view?.dispose();
              }
              await flushTasks();
            },
            fontsReady: async () => undefined,
            setTimer: h.timers.setTimer,
            clearTimer: h.timers.clearTimer,
          },
        });
        h.size.width = 999;
        const result = await view.idle();
        equal(result?.aborted, true);
        const lis = items(h.ex);
        const states = lis.map((li) => li.getAttribute('data-state'));
        ok(states.includes('pending'), `中止后还在改格子:${states.join(',')}`);
        // 视图建的节点 = 除了宿主容器和渲染用的离屏主画布(不进文档)以外的全部。
        const own = h.ex.created().filter((el) => el !== h.container && !(el.tagName === 'CANVAS' && !el.getAttribute('aria-hidden')));
        ok(own.length > 10, `视图建的节点数不对:${own.length}`);
        const left = own.filter((el) => !el.removed).map((el) => el.tagName);
        equal(left.join(','), '', '有节点没删掉');
        equal(h.container.getAttribute('aria-busy'), null, 'dispose 不碰宿主容器的属性');
        view.resize();
        equal(h.timers.pending.length, 0, 'dispose 之后 resize 不再排重画');
        view.dispose();
      });
    },
  ],
  [
    '解析与取帧的提示显示在页头;舞台尺寸为 0 时按 1280×720 并写明',
    async () => {
      await withView(async (h) => {
        h.size.width = 0;
        h.size.height = 0;
        const view = h.mount({ spec: '3,abc,99' });
        const notes = byTag(h.ex, 'LI')
          .filter((el) => el.getAttribute('data-state') === null)
          .map((el) => el.textContent);
        ok(notes.some((t) => t.includes('“abc”')), notes.join('|'));
        ok(notes.some((t) => t.includes('99 秒超出片长 8 秒')), notes.join('|'));
        ok(statusText(h.ex).includes('舞台尺寸为 0,按 1280×720 排版'), statusText(h.ex));
        await view.idle();
        const flags = byTag(h.ex, 'SPAN').map((el) => el.textContent);
        ok(flags.some((t) => t.includes('超出片长(99.0s),按片尾')), flags.join('|'));
        view.dispose();
      });
    },
  ],
  [
    '下载按钮:没给 download 或画布没有 toBlob 就不建;有就等出齐再启用,点了交一张 PNG',
    async () => {
      await withView(async (h) => {
        const plain = h.mount({ download: () => undefined });
        equal(byTag(h.ex, 'BUTTON').length, 0, '桩画布没有 toBlob,不该有按钮');
        await plain.idle();
        plain.dispose();
      });
      await withView(async (h) => {
        const blobs: Blob[] = [];
        const types: string[] = [];
        let sheets = 0;
        const view = h.mount({
          download: (b) => blobs.push(b),
          env: {
            createCanvas: () => {
              const c = document.createElement('canvas') as HTMLCanvasElement;
              (c as unknown as { toBlob: HTMLCanvasElement['toBlob'] }).toBlob = (cb, type) => {
                sheets += 1;
                types.push(String(type));
                cb(new Blob([], { type: String(type) }));
              };
              return c;
            },
            yieldTask: flushTasks,
            fontsReady: async () => undefined,
            setTimer: h.timers.setTimer,
            clearTimer: h.timers.clearTimer,
          },
        });
        const button = byTag(h.ex, 'BUTTON')[0] as (StubElement & { disabled?: boolean }) | undefined;
        ok(button !== undefined, '应当有下载按钮');
        equal(button?.textContent, '下载整张 PNG');
        equal(button?.disabled, true, '渲染中不能下载');
        await view.idle();
        equal(button?.disabled, false);
        button?.dispatch('click');
        await flushTasks();
        equal(sheets, 1);
        equal(types[0], 'image/png');
        equal(blobs.length, 1);
        const direct = await view.sheet();
        equal(direct.type, 'image/png');
        view.dispose();
      });
    },
  ],
  [
    '没有 toBlob 时 sheet() 以 unsupported 拒绝;空清单同步抛 no-segments 且不建节点',
    async () => {
      await withView(async (h) => {
        const view = h.mount();
        await view.idle();
        let code = '';
        await view.sheet().catch((e: unknown) => {
          code = isFilmError(e, 'unsupported') ? 'unsupported' : String(e);
        });
        equal(code, 'unsupported');
        view.dispose();
        const before = h.ex.created().length;
        let thrown = '';
        try {
          h.mount({ segments: [] });
        } catch (e) {
          thrown = isFilmError(e, 'no-segments') ? 'no-segments' : String(e);
        }
        equal(thrown, 'no-segments');
        equal(h.ex.created().length, before);
      });
    },
  ],
  [
    'refresh 立刻重画;overlay 的 notes 进说明',
    async () => {
      await withView(async (h) => {
        const view = h.mount({ spec: '1', overlay: () => ({ notes: ['字幕压到公式'] }) });
        await view.idle();
        ok(byTag(h.ex, 'SPAN').some((el) => el.textContent.includes('字幕压到公式')));
        const before = h.canvases();
        view.refresh();
        await view.idle();
        equal(h.canvases(), before + 1);
        view.dispose();
      });
    },
  ],
  [
    'StrictMode / 热更新:同一容器里先后两个视图,旧的在新的渲染中释放,不改新视图的 aria-busy 和节点',
    async () => {
      await withView(async (h) => {
        const first = h.mount();
        const second = h.mount();
        equal(roots(h.ex).length, 2);
        first.dispose();
        equal(roots(h.ex)[0]?.removed, true);
        equal(roots(h.ex)[1]?.removed, false);
        equal(busy(h.ex, 1), 'true', '旧视图释放后新视图还在渲染');
        const result = await second.idle();
        equal(result?.done, 3);
        equal(busy(h.ex, 1), 'false');
        second.dispose();
      });
    },
  ],
  [
    '渲染到一半换画幅:旧一轮中止、之后不再画格子,新一轮按新尺寸出齐,检查器只看到新尺寸',
    async () => {
      await withView(async (h) => {
        let n = 0;
        let switched = false;
        let view: StoryboardView | null = null;
        const seen: Array<{ switched: boolean; css: string; thumb: string }> = [];
        view = h.mount({
          overlay: (o) => {
            seen.push({ switched, css: `${o.cssWidth}x${o.cssHeight}`, thumb: `${o.rect.w}x${o.rect.h}` });
          },
          env: {
            yieldTask: async () => {
              n += 1;
              // 第一帧(1 秒,30 步)出完、正往第二帧推的时候换成竖屏,并让防抖到点。
              if (n === 45 && view) {
                switched = true;
                h.size.width = 720;
                h.size.height = 1280;
                view.resize();
                h.timers.fire();
              }
              await flushTasks();
            },
            fontsReady: async () => undefined,
            setTimer: h.timers.setTimer,
            clearTimer: h.timers.clearTimer,
          },
        });
        const firstPass = view.idle();
        const first = await firstPass;
        equal(first?.aborted, true, '旧一轮应当中止');
        equal(first?.done, 1);
        const second = await view.idle();
        equal(JSON.stringify(second), JSON.stringify({ done: 3, failed: 0, aborted: false }));
        const after = seen.filter((s) => s.switched);
        equal(after.length, 3, `换画幅后检查器被调了 ${after.length} 次`);
        ok(after.every((s) => s.css === '720x1280' && s.thumb === '360x640'), JSON.stringify(after));
        equal(seen.filter((s) => !s.switched).length, 1);
        ok(items(h.ex).every((li) => li.getAttribute('data-state') === 'done'));
        const thumbs = byTag(h.ex, 'CANVAS').slice(0, 3) as unknown as HTMLCanvasElement[];
        ok(thumbs.every((c) => c.width === 360 && c.height === 640), thumbs.map((c) => `${c.width}x${c.height}`).join(','));
        ok(statusText(h.ex).includes('按 720×1280 排版') && statusText(h.ex).includes('已出齐 3 帧'), statusText(h.ex));
        equal(busy(h.ex), 'false');
        view.dispose();
      });
    },
  ],
  [
    '预览链接:resize() 每次都重新取地址(画幅写在地址里,尺寸没变也要跟上)',
    async () => {
      await withView(async (h) => {
        let aspect = 'full';
        const view = h.mount({ previewHref: (s) => `/?scene=film&aspect=${aspect}&preview=${s}` });
        const links = (): string => byTag(h.ex, 'A').map((a) => a.getAttribute('href')).join(',');
        ok(links().startsWith('/?scene=film&aspect=full&preview=1,'), links());
        await view.idle();
        aspect = 'w9h16';
        view.resize();
        equal(h.timers.pending.length, 0, '尺寸没变不重画');
        equal(links(), '/?scene=film&aspect=w9h16&preview=1,/?scene=film&aspect=w9h16&preview=2,/?scene=film&aspect=w9h16&preview=6');
        view.dispose();
      });
    },
  ],
  [
    '脚本提前结束:链接的读屏文案同时说计划时刻和画面停的时刻,说明里标出来',
    async () => {
      await withView(async (h) => {
        const short = directedSegment('短', 10, [], async (env) => {
          env.scene.add(new Label('x'));
          await env.wait(3);
        });
        const view = h.mount({ segments: [short], spec: '5,' });
        await view.idle();
        const link = byTag(h.ex, 'A')[0];
        equal(link?.getAttribute('href'), '/?scene=film&preview=5');
        equal(link?.getAttribute('aria-label'), `打开 0:05.0 的单帧预览(画面停在 0:03.0)`);
        ok(byTag(h.ex, 'SPAN').some((el) => el.textContent.includes('脚本 3.0s 就结束了(声明 10.0s)')));
        view.dispose();
      });
    },
  ],
]);
