import type { ExportAudioReport } from './export/types';
import { FilmError, isFilmError } from './export/types';
import type { FilmController, Segment } from './film/types';
import type { SceneEntry, SceneHandle } from './scenes/types';

/**
 * 场景注册表与 App 的纯逻辑(可单测,不依赖 React)。
 * 场景与影片模块按需懒加载:打开首页不必下载两部影片的内容脚本。
 */

/** runFilm 返回的是「可调用 + 带方法」的控制器,适配成统一的场景句柄。 */
export function fromFilm(controller: FilmController): SceneHandle {
  return {
    dispose: () => controller.dispose(),
    // 播放器自带 ResizeObserver,会驱动当前分段重设分辨率并重取景。
    resize: () => undefined,
    exportVideo: (options) => controller.exportVideo(options),
    setPaused: (paused) => controller.setPaused(paused),
    audioAvailable: () => controller.getState().audio.available,
    audioEnabled: () => controller.getState().audio.enabled,
    setAudioEnabled: (enabled) => controller.setAudioEnabled(enabled),
  };
}

/** 影片配音时间表的地址:public/voice/<影片>/timing.json(没有这个文件就是没配音)。 */
export function voiceSheetUrl(voiceId: string): string {
  const base = typeof import.meta.env?.BASE_URL === 'string' ? import.meta.env.BASE_URL : '/';
  return `${base}voice/${voiceId}/timing.json`;
}

/** 只跑一次的异步加载(失败不缓存,下次重试)。 */
function once<T>(load: () => Promise<T>): () => Promise<T> {
  let cached: Promise<T> | null = null;
  return () => {
    cached ??= load().catch((e: unknown) => {
      cached = null;
      throw e;
    });
    return cached;
  };
}

/**
 * 影片条目:加载内容 → 配音准备(有时间表就按它定时长、字幕、音频;timedSegment 没有时间表时排草稿)
 * → 挂播放器。单帧预览用同一份准备好的分段:时间表可能改了时长,两边的时间轴必须一致。
 */
function filmEntry(
  title: string,
  voiceId: string,
  loadContent: () => Promise<readonly Segment[]>,
): SceneEntry & {
  readonly kind: 'film';
  readonly preview: NonNullable<SceneEntry['preview']>;
  readonly storyboard: NonNullable<SceneEntry['storyboard']>;
} {
  const prepared = once(async (): Promise<readonly Segment[]> => {
    const [{ prepareVoice }, segments] = await Promise.all([import('./film/film'), loadContent()]);
    return (await prepareVoice(segments, { sheetUrl: voiceSheetUrl(voiceId) })).segments;
  });
  return {
    title,
    kind: 'film',
    interactive: false,
    load: async () => {
      const [{ runFilm }, segments] = await Promise.all([import('./film/film'), prepared()]);
      return (canvas, hooks) =>
        fromFilm(runFilm(canvas, segments, { onPausedChange: hooks.onPausedChange }));
    },
    preview: filmPreview(prepared),
    storyboard: filmStoryboard(prepared),
  };
}

/** 场景注册表:URL 的 ?scene= 直接查这里。新增入口只加一项(SceneId 由它推导)。 */
export const SCENES = {
  overview: {
    title: '图形总览',
    kind: 'scene',
    interactive: true,
    load: async () => {
      const { runOverviewScene } = await import('./scenes/overview');
      return (canvas, hooks) =>
        runOverviewScene(canvas, { reducedMotion: hooks.reducedMotion });
    },
  },
  pythagoras: {
    title: '勾股定理',
    kind: 'scene',
    interactive: false,
    load: async () => {
      const { runPythagorasScene } = await import('./scenes/pythagoras');
      return (canvas) => runPythagorasScene(canvas);
    },
  },
  vocabulary: {
    title: '讲解词汇演示',
    kind: 'scene',
    interactive: false,
    load: async () => {
      const { runVocabularyScene } = await import('./scenes/vocabulary');
      return (canvas) => runVocabularyScene(canvas);
    },
  },
  film: filmEntry('勾股定理短片', 'film', async () => (await import('./film/program')).pythagorasFilm),
  derivatives: filmEntry('导数长片', 'derivatives', async () => (await import('./film/derivatives')).derivativesFilm),
  topology: filmEntry('拓扑学基础', 'topology', async () => (await import('./film/topology')).topologyFilm),
  voicedemo: filmEntry('配音演示', 'voice-demo', async () => (await import('./film/voiceDemo')).voiceDemoFilm),
} as const satisfies Readonly<Record<string, SceneEntry>>;

export type SceneId = keyof typeof SCENES;

export const DEFAULT_SCENE: SceneId = 'overview';

/**
 * URL 查询串 → 场景 id。必须用 hasOwn:普通对象字面量继承 Object.prototype,
 * ?scene=constructor / __proto__ / toString 会取到原型链上的属性。
 */
export function resolveSceneId(search: string): SceneId {
  const requested = new URLSearchParams(search).get('scene');
  return requested !== null && Object.hasOwn(SCENES, requested)
    ? (requested as SceneId)
    : DEFAULT_SCENE;
}

/**
 * ?preview= 秒数:有则进单帧静态预览模式。非法值(缺失/非数字/负数)返回 null 走正常播放。
 * 超过片尾由预览自己夹紧到最后一帧。
 */
export function resolvePreviewSeconds(search: string): number | null {
  const raw = new URLSearchParams(search).get('preview');
  if (raw === null || raw.trim() === '') {
    return null;
  }
  const seconds = Number(raw);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

/** 工具条上的画幅(同时是 App 里 <main> 的 CSS 类名)。第一个是缺省。 */
export const ASPECT_IDS = ['full', 'w16h9', 'w4h3', 'w9h16'] as const;
export type AspectMode = (typeof ASPECT_IDS)[number];

/**
 * &aspect= → 画幅;没有或认不出按 'full'。
 * 画幅写在地址里:刷新、从单帧预览返回故事板都还是这个画幅,
 * 故事板缩略图点进去的 ?preview= 也带着它(竖屏排版的问题在竖屏里看)。
 */
export function resolveAspect(search: string): AspectMode {
  const raw = new URLSearchParams(search).get('aspect');
  return ASPECT_IDS.find((id) => id === raw) ?? 'full';
}

/** 把画幅写进查询串('full' 是缺省,删掉参数),其余参数原样保留。有参数时带前导 '?',一个都没有时为空串。 */
export function aspectSearch(search: string, aspect: AspectMode): string {
  const params = new URLSearchParams(search);
  if (aspect === 'full') {
    params.delete('aspect');
  } else {
    params.set('aspect', aspect);
  }
  const text = params.toString();
  return text === '' ? '' : `?${text}`;
}

/**
 * &storyboard= 的原文:有这个参数(值可以为空)就进故事板模式,没有返回 null。
 * 语法由影片层解析(film/storyboard.ts 的 parseStoryboardSpec);写错了在故事板页头提示,不回落正常播放。
 */
export function resolveStoryboardParam(search: string): string | null {
  const params = new URLSearchParams(search);
  return params.has('storyboard') ? (params.get('storyboard') ?? '') : null;
}

/**
 * 点缩略图跳去的单帧预览查询串:去掉 storyboard、写上 preview,其余参数(scene、aspect……)原样保留。返回值带前导 '?'。
 * 秒数由故事板挑好(能还原到同一帧的最短小数),这里只去掉浮点尾巴(最多 6 位小数);非有限 / 负数按 0。
 */
export function previewSearch(search: string, seconds: number): string {
  const params = new URLSearchParams(search);
  params.delete('storyboard');
  const s = Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds * 1e6) / 1e6 : 0;
  params.set('preview', String(s));
  return `?${params.toString()}`;
}

/**
 * 影片条目的故事板挂载:懒加载视图模块,用 filmEntry 同一份准备好的分段(时间轴与播放、预览一致)。
 * 这里不 import 故事板的任何值,主包不多带东西。
 */
function filmStoryboard(
  loadContent: () => Promise<readonly Segment[]>,
): NonNullable<SceneEntry['storyboard']> {
  return async (param, host) => {
    const [{ mountStoryboard }, segments] = await Promise.all([
      import('./film/storyboardView'),
      loadContent(),
    ]);
    const view = mountStoryboard({ ...host, segments, spec: param });
    return { dispose: () => view.dispose(), resize: () => view.resize() };
  };
}

/**
 * 影片条目的静态预览挂载:目标帧画一次,不播放。
 * resize 防抖重画同一帧;重叠的两轮画的是同一帧,谁后画完都一样,不用互斥。
 */
function filmPreview(
  loadContent: () => Promise<readonly Segment[]>,
): (canvas: HTMLCanvasElement, seconds: number) => Promise<SceneHandle> {
  return async (canvas, seconds) => {
    const [{ previewFrameAt }, segments] = await Promise.all([
      import('./film/preview'),
      loadContent(),
    ]);
    await previewFrameAt(segments, seconds, canvas);
    let timer = 0;
    return {
      dispose: () => {
        window.clearTimeout(timer);
      },
      resize: () => {
        window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          previewFrameAt(segments, seconds, canvas).catch((e: unknown) =>
            console.error('[preview] 重渲染失败', e),
          );
        }, 120);
      },
    };
  };
}

export type ExportFormat = 'auto' | 'video/mp4' | 'video/webm';

/** 离线导出(WebCodecs)能编的容器,由 export/encoder 的 probeEncodableContainers 异步探测。 */
export interface OfflineContainers {
  mp4: boolean;
  webm: boolean;
}

/**
 * 当前浏览器能导出的格式:实时录制(MediaRecorder)支持的,并上离线编码能编的。
 * 显式指定的容器两条路都走不通时导出会直接失败,所以下拉框只列真正能导的;
 * 一个都没有时返回空表(不显示导出)。
 */
export function supportedFormats(
  isTypeSupported: ((mime: string) => boolean) | null = typeof MediaRecorder !== 'undefined'
    ? (mime) => MediaRecorder.isTypeSupported(mime)
    : null,
  offline: OfflineContainers | null = null,
): ExportFormat[] {
  const formats = (['video/mp4', 'video/webm'] as const).filter((mime) => {
    if (offline && (mime === 'video/mp4' ? offline.mp4 : offline.webm)) {
      return true;
    }
    if (!isTypeSupported) {
      return false;
    }
    try {
      return isTypeSupported(mime);
    } catch {
      return false;
    }
  });
  return formats.length > 0 ? ['auto', ...formats] : [];
}

/** 下载文件名:场景 + 画幅 + 本地时间戳,扩展名跟随实际编码出来的格式(视频,或故事板联系表的 PNG)。 */
export function downloadName(
  sceneId: SceneId,
  aspect: string,
  mimeType: string,
  now: Date = new Date(),
): string {
  const ext = mimeType.includes('png') ? 'png' : mimeType.includes('mp4') ? 'mp4' : 'webm';
  const pad = (n: number): string => String(n).padStart(2, '0');
  const stamp =
    `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-` +
    `${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  return `${sceneId}-${aspect}-${stamp}.${ext}`;
}

/** 用户主动取消:静默处理,不弹错误。 */
export function isUserCancel(err: unknown): boolean {
  return isFilmError(err, 'cancelled');
}

/** 给用户看的导出失败原因:FilmError 的消息本身就是中文说明,其它异常加上前缀。 */
export function exportErrorMessage(err: unknown): string {
  if (err instanceof FilmError) {
    return err.message;
  }
  const detail = err instanceof Error ? err.message : String(err);
  return `导出失败:${detail}`;
}

/** 地址的文件名部分(提示里列出缺了哪几个配音文件)。地址里有不成对的 % 时原样给,不能抛。 */
function fileName(url: string): string {
  const path = url.split(/[?#]/)[0] ?? url;
  const name = path.slice(path.lastIndexOf('/') + 1);
  try {
    return decodeURIComponent(name) || url;
  } catch {
    return name || url;
  }
}

/**
 * 导出完成后关于配音的说明:status 是状态文案,notice 是要用户看一眼的提示(没有为 null),
 * announce 是给读屏的完整播报(状态 + 提示;读屏只听常驻的那个播报区,原因不能只写在可见提示里)。
 * 配音没能进成片时导出照样算成功(画面是好的),但必须说出来 —— 以前只写一条 console.warn,用户拿到无声的片子也不知道为什么。
 */
export function exportAudioMessage(audio: ExportAudioReport | undefined): {
  status: string;
  notice: string | null;
  announce: string;
} {
  const note = audio?.note !== undefined ? `${audio.note}。` : '';
  let status: string;
  let notice: string | null;
  switch (audio?.status) {
    case 'included':
      status = '导出完成(含配音),已开始下载';
      notice = note !== '' ? `成片含配音。${note}` : null;
      break;
    case 'partial': {
      const failed = audio.failed ?? [];
      const names = failed.slice(0, 3).map(fileName).join('、');
      const more = failed.length > 3 ? ` 等 ${failed.length} 个` : '';
      status = '导出完成,部分配音缺失,已开始下载';
      notice = `成片含配音,但${audio.reason ?? '有配音文件没能加载'}${names !== '' ? `(${names}${more})` : ''}。${note}`;
      break;
    }
    case 'dropped':
      status = '导出完成(没有配音),已开始下载';
      notice = `成片没有配音:${audio.reason !== undefined && audio.reason !== '' ? audio.reason : '原因不明'}。`;
      break;
    default:
      status = '导出完成,已开始下载';
      notice = null;
  }
  return { status, notice, announce: notice !== null ? `${status}。${notice}` : status };
}

/** 进度 → 整数百分比(按钮只显示整数,整数不变就不触发重渲染)。 */
export function progressPercent(done: number, total: number): number {
  if (!(total > 0) || !Number.isFinite(done)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.floor((done / total) * 100)));
}
