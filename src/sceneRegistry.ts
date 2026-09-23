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
  film: {
    title: '勾股定理短片',
    kind: 'film',
    interactive: false,
    load: async () => {
      const [{ runFilm }, { pythagorasFilm }] = await Promise.all([
        import('./film/film'),
        import('./film/program'),
      ]);
      return (canvas, hooks) =>
        fromFilm(runFilm(canvas, pythagorasFilm, { onPausedChange: hooks.onPausedChange }));
    },
    preview: filmPreview(async () => (await import('./film/program')).pythagorasFilm),
  },
  derivatives: {
    title: '导数长片',
    kind: 'film',
    interactive: false,
    load: async () => {
      const [{ runFilm }, { derivativesFilm }] = await Promise.all([
        import('./film/film'),
        import('./film/derivatives'),
      ]);
      return (canvas, hooks) =>
        fromFilm(runFilm(canvas, derivativesFilm, { onPausedChange: hooks.onPausedChange }));
    },
    preview: filmPreview(async () => (await import('./film/derivatives')).derivativesFilm),
  },
  topology: {
    title: '拓扑学基础',
    kind: 'film',
    interactive: false,
    load: async () => {
      const [{ runFilm }, { topologyFilm }] = await Promise.all([
        import('./film/film'),
        import('./film/topology'),
      ]);
      return (canvas, hooks) =>
        fromFilm(runFilm(canvas, topologyFilm, { onPausedChange: hooks.onPausedChange }));
    },
    preview: filmPreview(async () => (await import('./film/topology')).topologyFilm),
  },
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

/** 下载文件名:场景 + 画幅 + 本地时间戳,扩展名跟随实际编码出来的格式。 */
export function downloadName(
  sceneId: SceneId,
  aspect: string,
  mimeType: string,
  now: Date = new Date(),
): string {
  const ext = mimeType.includes('mp4') ? 'mp4' : 'webm';
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

/** 进度 → 整数百分比(按钮只显示整数,整数不变就不触发重渲染)。 */
export function progressPercent(done: number, total: number): number {
  if (!(total > 0) || !Number.isFinite(done)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.floor((done / total) * 100)));
}
