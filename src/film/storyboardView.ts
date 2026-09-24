import { FilmError, describeError } from '../export/types';
import { waitForWebFonts } from './preview';
import type { StoryboardCaption, StoryboardFrame, StoryboardPlan, StoryboardSpec } from './storyboard';
import {
  formatFilmTime,
  parseStoryboardSpec,
  planStoryboard,
  storyboardCaption,
  thumbnailLongEdge,
  thumbnailMinWidth,
  thumbnailSize,
} from './storyboard';
import type {
  RenderStoryboardResult,
  StoryboardFilmOptions,
  StoryboardFrameResult,
  StoryboardOverlay,
} from './storyboardRender';
import { composeStoryboardSheet, renderStoryboard, resolveStoryboardVisuals } from './storyboardRender';
import { planFilm } from './timeline';
import type { Segment } from './types';

/**
 * 故事板视图:一页铺满缩略图(按导出成片合成),说明写清时刻、段、段内秒数、字幕,点缩略图打开单帧预览。
 * 与 chrome.ts 一样自己建节点、写内联样式(不在 film 与宿主 CSS 之间建类名契约);
 * 文字一律 textContent,属性用 setAttribute。
 * 排版尺寸 = 宿主量到的舞台 css 尺寸(当前画幅下播放器画布会有的尺寸),变了就防抖整页重画。
 */

/** 注入点(测试用);缺省全取浏览器。 */
export interface StoryboardViewEnv {
  /** 缺省 document.createElement。 */
  readonly createElement?: (tag: string) => HTMLElement;
  /** 缺省 document.createElement('canvas')。缩略图、主画面、联系表都用它建。 */
  readonly createCanvas?: () => HTMLCanvasElement;
  /** 缺省每轮一个 messageChannelYielder。 */
  readonly yieldTask?: () => Promise<void>;
  /** 缺省 setTimeout / clearTimeout(防抖用)。 */
  readonly setTimer?: (fn: () => void, ms: number) => unknown;
  readonly clearTimer?: (id: unknown) => void;
  /** 缺省 waitForWebFonts。 */
  readonly fontsReady?: () => Promise<void>;
  /** 缺省 performance.now,只用于「用时」文案。 */
  readonly now?: () => number;
}

export interface StoryboardViewInit {
  /**
   * 宿主给的空容器(可滚动)。视图在里面建一个自己的根节点(页头、提示、网格都在它下面,
   * aria-busy 也写在它上面),dispose 时只删自己建的节点,不碰容器本身的属性 ——
   * StrictMode / 热更新时同一个容器里前后两个视图交替,旧视图释放不会改掉新视图的状态。
   */
  readonly container: HTMLElement;
  readonly segments: readonly Segment[];
  /** URL 里 storyboard= 的原文,或已解析好的规格。 */
  readonly spec: string | StoryboardSpec;
  /** 舞台 css 尺寸(每轮开头读一次,缓存在这一轮里)。 */
  readonly stageSize: () => { readonly width: number; readonly height: number };
  /** 片名(页头与联系表标题)。 */
  readonly title?: string;
  /**
   * 某时刻的单帧预览地址;不给就不包链接。每轮重画、每次 resize() 都重新取一遍
   * (地址里带着画幅之类的页面状态,变了链接要跟着变)。
   */
  readonly previewHref?: (seconds: number) => string;
  /** 下载整张 PNG;不给(或画布没有 toBlob)就不显示下载按钮。 */
  readonly download?: (blob: Blob) => void;
  /** 布局检查器挂钩:每张缩略图合成完调一次,可以描红框、往说明里加字。 */
  readonly overlay?: StoryboardOverlay;
  /** 宿主给 runFilm 的外观选项(现在的 filmEntry 不传)。 */
  readonly film?: StoryboardFilmOptions;
  /** 舞台尺寸变了多久后重画(毫秒),缺省 200。 */
  readonly debounceMs?: number;
  readonly env?: StoryboardViewEnv;
}

export interface StoryboardView {
  /** 这页的取帧计划(与尺寸无关,挂载时算一次)。 */
  readonly plan: StoryboardPlan;
  /** 舞台尺寸可能变了:与当前这一轮的尺寸(取整)不同才防抖重画。缩略图的预览链接每次都重新取。 */
  resize(): void;
  /** 不比较尺寸,立刻整页重画(中止进行中的一轮)。 */
  refresh(): void;
  /** 当前这一轮出完 / 中止后 resolve;没有进行中的轮次时 resolve 上一轮的结果(一轮都没跑过就是 null)。 */
  idle(): Promise<RenderStoryboardResult | null>;
  /** 整张联系表 PNG(已出的帧 + 占位)。环境没有 toBlob / 画布给不出 blob 时 reject FilmError('unsupported')。 */
  sheet(): Promise<Blob>;
  /** 中止渲染、清定时器、删掉自己建的节点。幂等。 */
  dispose(): void;
}

/** 视觉隐藏但读屏可达。 */
const VISUALLY_HIDDEN =
  'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;' +
  'overflow:hidden;clip-path:inset(50%);white-space:nowrap;';
const BUTTON_CSS =
  'font:inherit;font-size:12px;padding:4px 10px;border-radius:6px;' +
  'border:1px solid rgba(255,255,255,0.25);background:rgba(0,0,0,0.55);color:#fff;cursor:pointer;';
/** 提示与标记的琥珀色(深底上对比度 > 10:1)。 */
const FLAG_COLOR = '#f5c56b';
const PENDING_OPACITY = '0.35';
const DEFAULT_DEBOUNCE_MS = 200;

interface Item {
  readonly frame: StoryboardFrame;
  readonly li: HTMLElement;
  /** 点进单帧预览的链接(没给 previewHref 为 null)。 */
  readonly link: HTMLElement | null;
  readonly canvas: HTMLCanvasElement;
  readonly time: HTMLElement;
  readonly segment: HTMLElement;
  readonly local: HTMLElement;
  readonly flags: HTMLElement;
  readonly subtitle: HTMLElement;
  state: 'pending' | 'done' | 'failed';
  caption: StoryboardCaption;
}

/**
 * 挂一页故事板,立即返回(第一轮在后台逐帧出)。
 * 同步抛:segments 为空(FilmError('no-segments'))。渲染中的意外只写页头和 console.error,不抛。
 */
export function mountStoryboard(init: StoryboardViewInit): StoryboardView {
  const env = init.env ?? {};
  const createElement = env.createElement ?? ((tag: string): HTMLElement => document.createElement(tag));
  const createCanvas = env.createCanvas ?? ((): HTMLCanvasElement => document.createElement('canvas'));
  const setTimer = env.setTimer ?? ((fn: () => void, ms: number): unknown => setTimeout(fn, ms));
  const clearTimer =
    env.clearTimer ?? ((id: unknown): void => clearTimeout(id as ReturnType<typeof setTimeout>));
  const fontsReady = env.fontsReady ?? waitForWebFonts;
  const now =
    env.now ?? ((): number => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const debounceMs = init.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  const { container, segments } = init;

  const parsed = typeof init.spec === 'string' ? parseStoryboardSpec(init.spec) : { spec: init.spec, notes: [] };
  // 空清单在这里同步抛,什么节点都还没建。
  const plan = planStoryboard(segments, parsed.spec, {
    ...(init.film?.transition !== undefined ? { transition: init.film.transition } : {}),
  });
  const frames = plan.frames;
  const count = frames.length;

  const created: HTMLElement[] = [];
  const make = (tag: string): HTMLElement => {
    const el = createElement(tag);
    created.push(el);
    return el;
  };

  // 视图自己的根节点:aria-busy 写在这里,不写宿主容器(容器可能同时装着前后两个视图)。
  const root = make('div');
  root.setAttribute('data-storyboard', '');
  const setBusy = (busy: boolean): void => {
    root.setAttribute('aria-busy', busy ? 'true' : 'false');
  };

  // ---- 页头:可见状态(对读屏隐藏)+ 播报区(只在开始 / 出齐 / 失败时写)+ 下载按钮
  const header = make('div');
  header.style.cssText =
    'display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin:0 0 8px;font-size:13px;';
  const status = make('span');
  status.setAttribute('aria-hidden', 'true');
  header.appendChild(status);
  const live = make('span');
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  live.style.cssText = VISUALLY_HIDDEN;
  header.appendChild(live);
  root.appendChild(header);

  const hint = make('p');
  hint.style.cssText = 'margin:0 0 12px;font-size:12px;color:#9a9a9a;';
  hint.textContent =
    '与导出成片同一合成(白场、字幕、进度条)' +
    (init.previewHref ? ';点缩略图打开该时刻的单帧预览(只画主画面)。' : '。');
  root.appendChild(hint);

  const allNotes = [...parsed.notes, ...plan.notes];
  if (allNotes.length > 0) {
    const list = make('ul');
    list.setAttribute('aria-label', '提示');
    list.style.cssText = `margin:0 0 12px;padding-left:18px;font-size:12px;color:${FLAG_COLOR};`;
    for (const note of allNotes) {
      const li = make('li');
      li.textContent = note;
      list.appendChild(li);
    }
    root.appendChild(list);
  }

  // ---- 网格:每帧一格,说明先按计划值填上,出图后按实际值改
  const grid = make('ol');
  // list-style:none 会让 Safari 的读屏丢掉列表语义,显式补上。
  grid.setAttribute('role', 'list');
  grid.setAttribute('aria-label', '缩略图');
  grid.style.cssText = 'list-style:none;margin:0;padding:0;display:grid;gap:16px 12px;';
  const items: Item[] = frames.map((frame): Item => {
    const li = make('li');
    li.setAttribute('data-state', 'pending');
    li.style.cssText = `opacity:${PENDING_OPACITY};transition:opacity .2s;min-width:0;`;
    const figure = make('figure');
    figure.style.cssText = 'margin:0;';
    const canvas = createCanvas();
    created.push(canvas);
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.cssText = 'display:block;width:100%;height:auto;border-radius:4px;background:#2a2a2a;';
    let link: HTMLElement | null = null;
    if (init.previewHref) {
      link = make('a');
      link.setAttribute('aria-label', linkLabel(frame, null));
      link.style.cssText = 'display:block;border-radius:4px;';
      link.appendChild(canvas);
      figure.appendChild(link);
    } else {
      figure.appendChild(canvas);
    }
    const cap = make('figcaption');
    cap.style.cssText = 'margin-top:6px;font-size:12px;line-height:1.4;color:#cfcfcf;overflow-wrap:anywhere;';
    const row1 = make('div');
    const time = make('strong');
    time.style.cssText = 'color:#fff;font-variant-numeric:tabular-nums;';
    const segment = make('span');
    row1.appendChild(time);
    row1.appendChild(segment);
    const row2 = make('div');
    const local = make('span');
    const flags = make('span');
    flags.style.cssText = `color:${FLAG_COLOR};`;
    row2.appendChild(local);
    row2.appendChild(flags);
    const subtitle = make('div');
    subtitle.style.cssText =
      'color:#fff;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;';
    cap.appendChild(row1);
    cap.appendChild(row2);
    cap.appendChild(subtitle);
    figure.appendChild(cap);
    li.appendChild(figure);
    grid.appendChild(li);
    const item: Item = {
      frame,
      li,
      link,
      canvas,
      time,
      segment,
      local,
      flags,
      subtitle,
      state: 'pending',
      caption: storyboardCaption(frame, plan.segmentCount),
    };
    showCaption(item, item.caption);
    return item;
  });
  root.appendChild(grid);
  container.appendChild(root);

  /** 重新取一遍预览链接(地址里的画幅等页面状态可能变了)。 */
  const refreshLinks = (): void => {
    const href = init.previewHref;
    if (!href) {
      return;
    }
    for (const item of items) {
      item.link?.setAttribute('href', href(item.frame.preview));
    }
  };
  refreshLinks();

  // 下载按钮:给了 download、画布能 toBlob 才有(缩略图画布就是同一种画布)。
  const canBlob = items[0] !== undefined && typeof items[0].canvas.toBlob === 'function';
  let button: HTMLButtonElement | null = null;
  if (init.download && canBlob) {
    const b = make('button') as HTMLButtonElement;
    button = b;
    b.setAttribute('type', 'button');
    b.textContent = '下载整张 PNG';
    b.style.cssText = BUTTON_CSS;
    b.disabled = true;
    b.addEventListener('click', () => {
      if (rendering || disposed) {
        return;
      }
      b.disabled = true;
      view
        .sheet()
        .then((blob) => {
          init.download?.(blob);
        })
        .catch((e: unknown) => {
          console.error('[storyboard] 联系表生成失败', e);
          if (!disposed) {
            setStatus(`联系表生成失败:${describeError(e)}`);
          }
        })
        .finally(() => {
          b.disabled = rendering || disposed;
        });
    });
    header.appendChild(b);
  }

  // ---- 轮次:每次(重)画开一轮,新一轮让旧一轮在下一步停下
  let gen = 0;
  let disposed = false;
  let rendering = false;
  let timer: unknown = null;
  /** 当前这一轮按的舞台尺寸(取整后的原值,0 也照记;比较用)。 */
  let passStage: { width: number; height: number } | null = null;
  let thumb = { width: 0, height: 0 };
  let current: Promise<RenderStoryboardResult | null> | null = null;
  let statusPrefix = '';

  const readStage = (): { width: number; height: number } => {
    let s: { readonly width: number; readonly height: number };
    try {
      s = init.stageSize();
    } catch {
      s = { width: 0, height: 0 };
    }
    const r = (v: number): number => (Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0);
    return { width: r(s.width), height: r(s.height) };
  };
  const readFont = (): string => {
    if (typeof getComputedStyle !== 'function') {
      return 'sans-serif';
    }
    try {
      const v: unknown = getComputedStyle(container).fontFamily;
      return typeof v === 'string' && v !== '' ? v : 'sans-serif';
    } catch {
      return 'sans-serif';
    }
  };
  function setStatus(text: string): void {
    status.textContent = text;
  }
  const announce = (text: string): void => {
    live.textContent = text;
  };
  const clearPending = (): void => {
    if (timer !== null) {
      clearTimer(timer);
      timer = null;
    }
  };

  const runPass = async (
    g: number,
    stage: { width: number; height: number },
  ): Promise<RenderStoryboardResult> => {
    const abort = (): boolean => disposed || g !== gen;
    const started = now();
    let done = 0;
    let failed = 0;
    const progressText = (): string => `${statusPrefix} · 渲染中 ${done + failed}/${count}`;
    try {
      // 中文回退字要等网页字体:缩略图只画一次。字体没等到也照画,不卡住整页。
      await fontsReady().catch(() => undefined);
      if (abort()) {
        return { done: 0, failed: 0, aborted: true };
      }
      const font = readFont();
      const filmPlan = planFilm(segments, init.film);
      const visuals = resolveStoryboardVisuals(segments, filmPlan, stage.width, font, init.film);
      const onFrame = (r: StoryboardFrameResult): void => {
        if (abort()) {
          return;
        }
        const item = items[r.frame.n];
        if (!item) {
          return;
        }
        item.state = r.status;
        item.li.setAttribute('data-state', r.status);
        item.li.style.opacity = '1';
        item.caption = storyboardCaption(r.frame, plan.segmentCount, r);
        showCaption(item, item.caption);
        item.link?.setAttribute('aria-label', linkLabel(item.frame, item.caption));
        if (r.status === 'done') {
          done += 1;
        } else {
          failed += 1;
        }
        setStatus(progressText());
      };
      const result = await renderStoryboard({
        segments,
        frames,
        plan: filmPlan,
        cssWidth: stage.width,
        cssHeight: stage.height,
        thumbWidth: thumb.width,
        thumbHeight: thumb.height,
        visuals,
        target: (f) => (items[f.n] as Item).canvas,
        createCanvas,
        onFrame,
        shouldAbort: abort,
        ...(init.overlay ? { overlay: init.overlay } : {}),
        ...(env.yieldTask ? { yieldTask: env.yieldTask } : {}),
      });
      if (!abort()) {
        const seconds = ((now() - started) / 1000).toFixed(1);
        const summary =
          result.failed > 0
            ? `已出完 ${count} 帧(${result.failed} 帧失败,原因见说明),用时 ${seconds} 秒`
            : `已出齐 ${count} 帧,用时 ${seconds} 秒`;
        setStatus(`${statusPrefix} · ${summary}`);
        announce(`故事板${summary}`);
      }
      return result;
    } catch (e) {
      if (!abort()) {
        console.error('[storyboard] 渲染失败', e);
        setStatus(`${statusPrefix} · 故事板渲染失败:${describeError(e)}`);
        announce(`故事板渲染失败:${describeError(e)}`);
      }
      return { done, failed: count - done, aborted: false };
    } finally {
      if (!abort()) {
        rendering = false;
        setBusy(false);
        if (button) {
          button.disabled = false;
        }
      }
    }
  };

  const startPass = (): void => {
    if (disposed) {
      return;
    }
    gen += 1;
    const g = gen;
    clearPending();
    const measured = readStage();
    passStage = measured;
    const fallback = !(measured.width > 0 && measured.height > 0);
    const stage = fallback ? { width: 1280, height: 720 } : measured;
    thumb = thumbnailSize(stage.width, stage.height, thumbnailLongEdge(count));
    grid.style.gridTemplateColumns =
      `repeat(auto-fill,minmax(min(100%,${thumbnailMinWidth(stage.width, stage.height)}px),1fr))`;
    refreshLinks();
    for (const item of items) {
      item.state = 'pending';
      item.li.setAttribute('data-state', 'pending');
      item.li.style.opacity = PENDING_OPACITY;
      item.link?.setAttribute('aria-label', linkLabel(item.frame, null));
      // 改尺寸顺带清空画布,露出占位底色;CSS 的 aspect-ratio 让没出图的格子也按新比例占位。
      item.canvas.width = thumb.width;
      item.canvas.height = thumb.height;
      item.canvas.style.aspectRatio = `${thumb.width} / ${thumb.height}`;
    }
    rendering = true;
    if (button) {
      button.disabled = true;
    }
    setBusy(true);
    const titlePart = init.title !== undefined && init.title !== '' ? ` · ${init.title}` : '';
    const layoutPart = fallback
      ? '舞台尺寸为 0,按 1280×720 排版'
      : `按 ${stage.width}×${stage.height} 排版`;
    statusPrefix = `故事板${titlePart} · ${count} 帧 · ${layoutPart}`;
    setStatus(`${statusPrefix} · 渲染中 0/${count}`);
    announce(`开始渲染故事板,共 ${count} 帧`);
    current = runPass(g, stage);
  };

  const view: StoryboardView = {
    plan,
    resize(): void {
      if (disposed) {
        return;
      }
      refreshLinks();
      const s = readStage();
      if (passStage && s.width === passStage.width && s.height === passStage.height) {
        // 尺寸又变回当前这一轮的:撤掉还没到点的重画(App 挂上 ResizeObserver 时也会先回调一次)。
        clearPending();
        return;
      }
      clearPending();
      timer = setTimer(() => {
        timer = null;
        startPass();
      }, debounceMs);
    },
    refresh(): void {
      startPass();
    },
    idle(): Promise<RenderStoryboardResult | null> {
      return current ?? Promise.resolve(null);
    },
    sheet(): Promise<Blob> {
      let canvas: HTMLCanvasElement;
      try {
        canvas = composeStoryboardSheet(
          items.map((item) => ({
            canvas: item.state === 'done' ? item.canvas : null,
            caption: item.caption,
          })),
          {
            createCanvas,
            thumbWidth: thumb.width,
            thumbHeight: thumb.height,
            fontFamily: readFont(),
            ...(init.title !== undefined ? { title: init.title } : {}),
          },
        );
      } catch (e) {
        return Promise.reject(e);
      }
      const release = (): void => {
        canvas.width = 0;
        canvas.height = 0;
      };
      if (typeof canvas.toBlob !== 'function') {
        release();
        return Promise.reject(new FilmError('unsupported', '当前环境不能把画布存成 PNG'));
      }
      return new Promise<Blob>((resolve, reject) => {
        try {
          canvas.toBlob((blob) => {
            release();
            if (blob) {
              resolve(blob);
            } else {
              reject(new FilmError('unsupported', '浏览器没能把联系表存成 PNG(画面可能太大)'));
            }
          }, 'image/png');
        } catch (e) {
          release();
          reject(e);
        }
      });
    },
    dispose(): void {
      if (disposed) {
        return;
      }
      disposed = true;
      gen += 1;
      clearPending();
      for (const el of created) {
        el.remove();
      }
      // 缩略图画布不等 GC,立刻还掉像素缓冲。
      for (const item of items) {
        item.canvas.width = 0;
        item.canvas.height = 0;
      }
    },
  };

  startPass();
  return view;
}

/**
 * 缩略图链接的读屏文案:去的是计划时刻;出图后画面停的时刻不一样(脚本提前结束)时两个都说。
 */
function linkLabel(frame: StoryboardFrame, caption: StoryboardCaption | null): string {
  const planned = formatFilmTime(frame.position);
  return caption && caption.time !== planned
    ? `打开 ${planned} 的单帧预览(画面停在 ${caption.time})`
    : `打开 ${planned} 的单帧预览`;
}

/** 把说明写进一格:时刻 · 段 / 段内秒数 + 标记 / 字幕(两行截断,title 放全文)。 */
function showCaption(item: Item, c: StoryboardCaption): void {
  item.time.textContent = c.time;
  item.segment.textContent = ` · ${c.segment}`;
  item.local.textContent = c.local;
  item.flags.textContent = c.flags.length > 0 ? ` · ${c.flags.join(';')}` : '';
  item.subtitle.textContent = c.subtitle;
  item.subtitle.setAttribute('title', c.subtitle);
  item.li.setAttribute('title', c.label);
}
