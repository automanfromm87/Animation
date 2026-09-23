import type { SubtitleVisual } from '../export/composite';
import type { FilmPlan } from './timeline';
import { chapterNumeral, nextChapterIndex, segmentIndexAt, segmentTicks } from './timeline';
import type { ProgressStyle, Segment } from './types';

/** 播放器覆盖层的层级(公式已画进 canvas,不占层级)。 */
const Z_VEIL = 1;
const Z_SUBTITLE = 2;
const Z_PROGRESS = 3;

/** 视觉隐藏但读屏可达(常驻文档流,内容变化才会被播报)。 */
const VISUALLY_HIDDEN =
  'position:absolute;width:1px;height:1px;margin:-1px;padding:0;border:0;' +
  'overflow:hidden;clip-path:inset(50%);white-space:nowrap;';

/** 每帧渲染 chrome 所需的全部状态。导出合成读的是同一份,而不是回读 DOM。 */
export interface ChromeState {
  /** 转场白闪不透明度(0~1)。 */
  veilAlpha: number;
  /** 当前字幕文本,空串表示不显示。 */
  subtitle: string;
  /** 全片进度(0~1)。 */
  progress: number;
  /** 当前分段序号。 */
  index: number;
}

export interface ChromeCallbacks {
  /** 用户要求跳到第 target 段(方向键 / 章节键)。 */
  seek(target: number): void;
  /**
   * 用户要求跳到全片 seconds 处(点击进度条)。有它点击就精确到秒,
   * 没有就退回按段跳(老宿主兼容)。
   */
  seekTime?: (seconds: number) => void;
  /** 用户按空格 / K 切换暂停。 */
  togglePause(): void;
}

export interface FilmChrome {
  render(state: ChromeState): void;
  /** 视口尺寸变化:字幕字号/底距、章名字号、提示位置。 */
  relayout(visual: SubtitleVisual, labelPx: number): void;
  /** 实时录制期间禁用进度条的跳转(aria-disabled);空格暂停同样被播放器拒绝。 */
  setSeekEnabled(enabled: boolean): void;
  /** 字幕实际使用的字体(DOM 继承来的计算值),导出合成要用同一个;无 DOM 时为 null。 */
  readonly fontFamily: string | null;
  dispose(): void;
}

/** 没有宿主 DOM(测试桩、离屏画布)时的空实现。 */
export const NULL_CHROME: FilmChrome = {
  render: () => undefined,
  relayout: () => undefined,
  setSeekEnabled: () => undefined,
  fontFamily: null,
  dispose: () => undefined,
};

export interface DomChromeOptions {
  parent: HTMLElement;
  segments: readonly Segment[];
  plan: FilmPlan;
  veilColor: string;
  visual: SubtitleVisual;
  labelPx: number;
  progressStyle?: ProgressStyle;
  /** 显式指定了字体时写到字幕条上;否则继承页面字体。 */
  explicitFontFamily: boolean;
  callbacks: ChromeCallbacks;
}

const fmtTime = (sec: number): string =>
  `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/** 白闪层 + 字幕条(含读屏播报区)+ 可点击/可键盘操作的进度刻度尺。 */
export function createDomChrome(o: DomChromeOptions): FilmChrome {
  const { parent, segments, plan } = o;
  const created: HTMLElement[] = [];
  const make = (tag: string): HTMLElement => {
    const el = document.createElement(tag);
    created.push(el);
    return el;
  };
  // 覆盖层要相对画布容器定位;改过的 position 在 dispose 时还原。
  let restoredPosition: string | null = null;
  if (getComputedStyle(parent).position === 'static') {
    restoredPosition = parent.style.position;
    parent.style.position = 'relative';
  }

  const veil = make('div');
  veil.style.cssText =
    `position:absolute;inset:0;background:${o.veilColor};` +
    `opacity:1;pointer-events:none;z-index:${Z_VEIL};`;
  parent.appendChild(veil);

  // 字幕视觉条对读屏隐藏;解说由常驻的视觉隐藏 live region 播报 ——
  // 用 display:none 反复隐藏/显示的元素,读屏往往把「出现」当成新节点而不播报。
  // 居中用 left/right 撑满 + fit-content + 左右自动外边距:收缩适配的可用宽度是整个容器,
  // max-width:80% 才真正生效(left:50% + translateX(-50%) 会把可用宽度砍掉一半,约 50% 处就折行)。
  // content-box:80% 量的是文字区、内边距在外,与导出按「画面宽 × 0.8」折行是同一口径;
  // 宿主页面常见的全局 border-box 不能改掉它。超长的词按字符断开,与导出的硬断一致。
  const sub = make('div');
  sub.setAttribute('aria-hidden', 'true');
  sub.style.cssText =
    'position:absolute;left:0;right:0;margin:0 auto;width:fit-content;box-sizing:content-box;' +
    'overflow-wrap:anywhere;display:none;' +
    `pointer-events:none;text-align:center;z-index:${Z_SUBTITLE};`;
  parent.appendChild(sub);
  const live = make('div');
  live.setAttribute('role', 'status');
  live.setAttribute('aria-live', 'polite');
  live.style.cssText = VISUALLY_HIDDEN;
  parent.appendChild(live);

  let visual = o.visual;
  const applyVisual = (): void => {
    const s = sub.style;
    s.fontSize = `${visual.fontPx}px`;
    s.lineHeight = String(visual.lineHeight);
    s.bottom = `${visual.bottomPx}px`;
    s.color = visual.color;
    s.background = visual.background;
    s.padding = `${visual.padY}px ${visual.padX}px`;
    s.borderRadius = `${visual.radius}px`;
    s.maxWidth = `${visual.maxWidthRatio * 100}%`;
    if (o.explicitFontFamily) {
      s.fontFamily = visual.fontFamily;
    }
  };
  applyVisual();
  const computedFamily = getComputedStyle(sub).fontFamily;
  const fontFamily = typeof computedFamily === 'string' && computedFamily !== '' ? computedFamily : null;

  // ---- 进度刻度尺
  let bar: HTMLElement | null = null;
  let fill: HTMLElement | null = null;
  let tip: HTMLElement | null = null;
  const labels: HTMLElement[] = [];
  let seekEnabled = true;
  let current = 0;
  const pos = o.progressStyle?.position ?? 'bottom';
  const tipOffset = (): number =>
    pos === 'bottom'
      ? Math.round(visual.bottomPx + visual.fontPx * visual.lineHeight + visual.padY * 2 + 8)
      : plan.barBlockPx + 4;

  if (plan.progressOn) {
    const h = o.progressStyle?.height ?? 3;
    const ink = o.progressStyle?.color ?? '#1a1a1a';
    const b = make('div');
    bar = b;
    b.style.cssText =
      `position:absolute;left:0;right:0;${pos}:0;height:${plan.barBlockPx}px;` +
      `cursor:pointer;z-index:${Z_PROGRESS};`;
    // 键盘与读屏可达:进度条是一个可聚焦的 slider,方向键切段。
    b.tabIndex = 0;
    b.setAttribute('role', 'slider');
    b.setAttribute('aria-label', '分段进度');
    b.setAttribute('aria-valuemin', '0');
    b.setAttribute('aria-valuemax', String(segments.length - 1));
    b.setAttribute('aria-valuenow', '0');
    const t = make('div');
    tip = t;
    t.style.cssText =
      `position:absolute;${pos}:${tipOffset()}px;transform:translateX(-50%);display:none;` +
      'pointer-events:none;white-space:nowrap;' +
      'font-size:12px;color:#fff;background:rgba(0,0,0,0.65);' +
      'padding:4px 10px;border-radius:6px;';
    b.appendChild(t);
    const fracAt = (clientX: number): number => {
      const rect = b.getBoundingClientRect();
      return Math.min(1, Math.max(0, (clientX - rect.left) / Math.max(1, rect.width)));
    };
    const indexAt = (clientX: number): number => segmentIndexAt(segments, fracAt(clientX));
    b.addEventListener('click', (e: MouseEvent) => {
      if (!seekEnabled) {
        return;
      }
      if (o.callbacks.seekTime) {
        o.callbacks.seekTime(fracAt(e.clientX) * plan.total);
        return;
      }
      o.callbacks.seek(indexAt(e.clientX));
    });
    b.addEventListener('keydown', (e: KeyboardEvent) => {
      // 带修饰键的组合留给浏览器/读屏(Ctrl+K、Alt+方向键……),不劫持。
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }
      let target: number;
      switch (e.key) {
        case 'ArrowRight':
        case 'ArrowUp':
          target = current + 1;
          break;
        case 'ArrowLeft':
        case 'ArrowDown':
          target = current - 1;
          break;
        case 'Home':
          target = 0;
          break;
        case 'End':
          target = segments.length - 1;
          break;
        case 'PageDown':
          target = nextChapterIndex(segments, current, 1) ?? segments.length - 1;
          break;
        case 'PageUp':
          target = nextChapterIndex(segments, current, -1) ?? 0;
          break;
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          o.callbacks.togglePause();
          return;
        default:
          return;
      }
      e.preventDefault();
      const clamped = Math.max(0, Math.min(segments.length - 1, target));
      // 已经在边界上(最后一段按 →/End、第一段按 ←/Home)不重播当前段。
      if (seekEnabled && clamped !== current) {
        o.callbacks.seek(clamped);
      }
    });
    // 用 pointer 事件而不是 mouse:触屏上章名提示也能出来。
    b.addEventListener('pointermove', (e: PointerEvent) => {
      const i = indexAt(e.clientX);
      const seg = segments[i];
      if (!seg) {
        return;
      }
      t.textContent = `${seg.name} ${fmtTime(fracAt(e.clientX) * plan.total)} / ${fmtTime(plan.total)}`;
      const rect = b.getBoundingClientRect();
      const x = Math.min(
        Math.max(e.clientX - rect.left, 70),
        Math.max(70, rect.width - 70),
      );
      t.style.left = `${x}px`;
      t.style.display = '';
    });
    const hideTip = (): void => {
      t.style.display = 'none';
    };
    b.addEventListener('pointerleave', hideTip);
    b.addEventListener('pointercancel', hideTip);
    const track = make('div');
    track.style.cssText =
      `position:absolute;left:0;right:0;${pos}:0;height:${h}px;` +
      `background:${o.progressStyle?.background ?? 'rgba(0,0,0,0.12)'};`;
    const f = make('div');
    fill = f;
    f.style.cssText =
      `position:absolute;left:0;${pos}:0;height:${h}px;width:0%;background:${ink};`;
    b.appendChild(track);
    b.appendChild(f);
    const ticks = segmentTicks(segments);
    let chapterNo = 0;
    segments.forEach((s, i) => {
      const frac = (ticks[i] ?? 0) * 100;
      const isChapter = s.marker === 'chapter';
      const tick = make('div');
      tick.style.cssText =
        `position:absolute;${pos}:0;left:${frac.toFixed(3)}%;width:2px;` +
        `height:${isChapter ? 14 : 8}px;` +
        `background:${isChapter ? ink : 'rgba(0,0,0,0.35)'};`;
      b.appendChild(tick);
      if (s.chapter !== undefined) {
        const label = make('div');
        label.textContent = `${chapterNumeral(chapterNo)} · ${s.chapter}`;
        chapterNo += 1;
        label.style.cssText =
          `position:absolute;${pos}:20px;left:calc(${frac.toFixed(3)}% + 6px);` +
          `font-size:${o.labelPx}px;line-height:1;white-space:nowrap;` +
          'color:rgba(0,0,0,0.55);';
        b.appendChild(label);
        labels.push(label);
      }
    });
    parent.appendChild(b);
  }

  // 只在值变化时写 DOM:这条路径每帧都走。
  let shownVeil = '';
  let shownSubtitle = '';
  let shownProgress = '';
  let shownIndex = -1;
  return {
    render(state: ChromeState): void {
      const opacity = state.veilAlpha.toFixed(3);
      if (opacity !== shownVeil) {
        shownVeil = opacity;
        veil.style.opacity = opacity;
      }
      if (state.subtitle !== shownSubtitle) {
        shownSubtitle = state.subtitle;
        if (state.subtitle === '') {
          sub.style.display = 'none';
        } else {
          sub.textContent = state.subtitle;
          sub.style.display = '';
        }
        live.textContent = state.subtitle;
      }
      if (fill) {
        const width = `${(Math.min(1, Math.max(0, state.progress)) * 100).toFixed(2)}%`;
        if (width !== shownProgress) {
          shownProgress = width;
          fill.style.width = width;
        }
      }
      if (state.index !== shownIndex) {
        shownIndex = state.index;
        current = Math.max(0, state.index);
        bar?.setAttribute('aria-valuenow', String(current));
        bar?.setAttribute('aria-valuetext', segments[current]?.name ?? '');
      }
    },
    relayout(next: SubtitleVisual, labelPx: number): void {
      visual = next;
      applyVisual();
      const px = `${labelPx}px`;
      for (const label of labels) {
        label.style.fontSize = px;
      }
      if (tip) {
        tip.style[pos] = `${tipOffset()}px`;
      }
    },
    setSeekEnabled(enabled: boolean): void {
      seekEnabled = enabled;
      if (bar) {
        bar.setAttribute('aria-disabled', enabled ? 'false' : 'true');
        bar.style.cursor = enabled ? 'pointer' : 'not-allowed';
      }
    },
    fontFamily,
    dispose(): void {
      for (const el of created) {
        el.remove();
      }
      if (restoredPosition !== null) {
        parent.style.position = restoredPosition;
      }
    },
  };
}
