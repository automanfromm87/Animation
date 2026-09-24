import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { probeEncodableContainers } from './export/encoder';
import type { ExportHandle } from './export/types';
import {
  SCENES,
  aspectSearch,
  downloadName,
  exportAudioMessage,
  exportErrorMessage,
  isUserCancel,
  previewSearch,
  progressPercent,
  resolveAspect,
  resolvePreviewSeconds,
  resolveSceneId,
  resolveStoryboardParam,
  supportedFormats,
} from './sceneRegistry';
import type { AspectMode, ExportFormat, SceneId } from './sceneRegistry';
import type { SceneEntry, SceneHandle } from './scenes/types';
import './App.css';

const ASPECT_MODES: Array<{ id: AspectMode; label: string }> = [
  { id: 'full', label: '全屏' },
  { id: 'w16h9', label: '16:9' },
  { id: 'w4h3', label: '4:3' },
  { id: 'w9h16', label: '9:16' },
];

const FORMAT_LABELS: Record<ExportFormat, string> = {
  auto: '自动',
  'video/mp4': 'MP4',
  'video/webm': 'WebM',
};

const REDUCED_MOTION_QUERY = '(prefers-reduced-motion: reduce)';

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia?.(REDUCED_MOTION_QUERY).matches === true;
}

/** 触发浏览器下载,两分钟后回收 blob URL(「另存为」对话框可能停留很久)。 */
function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  // Firefox 要求锚点在文档里才会触发下载。
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 刻意不在卸载时取消:取消等于永远不 revoke,而回调不碰组件状态,卸载后执行也安全。
  window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const handleRef = useRef<SceneHandle | null>(null);
  const exportRef = useRef<ExportHandle | null>(null);
  // 只把 id 放进 state,条目每次渲染重新查表:热更新后注册表是新对象,
  // 挂载 effect 的依赖随之变化,重挂载的才是新代码。
  const [sceneId] = useState<SceneId>(() =>
    typeof window === 'undefined' ? 'overview' : resolveSceneId(window.location.search),
  );
  // 拓宽到接口:注册表是 as const,overview/pythagoras 条目上根本没有 preview 键,
  // 不拓宽连 `scene.preview !== undefined` 都写不过类型检查。
  const scene: SceneEntry = SCENES[sceneId];
  // 单帧预览模式:只画 ?preview= 秒那一帧,不播放(只有影片条目支持)。
  const [previewSeconds] = useState<number | null>(() =>
    typeof window === 'undefined' ? null : resolvePreviewSeconds(window.location.search),
  );
  const previewing = previewSeconds !== null && scene.preview !== undefined;
  // 故事板模式:一页铺满缩略图(只有影片条目支持)。单帧预览优先:两个参数都在时按 ?preview= 走
  // (缩略图点进去的地址本来就不带 storyboard)。
  const [storyboardParam] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : resolveStoryboardParam(window.location.search),
  );
  const storyboarding = !previewing && storyboardParam !== null && scene.storyboard !== undefined;
  const storyboardRef = useRef<HTMLElement | null>(null);
  // 画幅从地址里的 &aspect= 起步(刷新、从单帧预览返回故事板都不丢),换了再写回地址。
  const [aspect, setAspect] = useState<AspectMode>(() =>
    typeof window === 'undefined' ? 'full' : resolveAspect(window.location.search),
  );
  // 下载联系表时按当时的画幅起文件名;挂载 effect 不依赖画幅(换画幅只重画,不重挂),只能经 ref 读。
  const aspectRef = useRef<AspectMode>(aspect);
  /** 当前场景的句柄支持导出(还要浏览器有能导的格式才显示导出)。 */
  const [exportable, setExportable] = useState(false);
  const [formats, setFormats] = useState<ExportFormat[]>(() => supportedFormats());
  const [exportFormat, setExportFormat] = useState<ExportFormat>('auto');
  /** 导出进度(整数百分比),null 表示没在导出。 */
  const [exportPct, setExportPct] = useState<number | null>(null);
  /** 这次导出的方式:离线渲染不占用预览,实时录制要独占预览(锁住暂停与画幅)。 */
  const [exportMode, setExportMode] = useState<ExportHandle['mode'] | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  /** 导出完成后要用户看一眼的提示(比如成片没带上配音、为什么)。 */
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  /** 给读屏的导出状态播报(开始、每 10%、完成、取消)。 */
  const [exportStatus, setExportStatus] = useState('');
  const announcedRef = useRef(-1);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  /** 场景有配音(有才显示声音开关)。 */
  const [audioAvailable, setAudioAvailable] = useState(false);
  /** 声音开着。浏览器要求第一次出声发生在用户操作里,所以默认关着,由用户点开。 */
  const [audioOn, setAudioOn] = useState(false);
  // 场景重挂载(StrictMode / HMR)后新句柄要接上当前的暂停态,
  // 又不想把 paused 放进挂载 effect 的依赖里(那会重建整个场景)。
  const pausedRef = useRef(false);
  const exporting = exportPct !== null;
  const canExport = exportable && formats.length > 0;
  const lockPreview = exporting && exportMode !== 'offline';

  useEffect(() => {
    document.title = previewing
      ? `${scene.title} · 预览 ${previewSeconds}s · Mini Manim`
      : storyboarding
        ? `${scene.title} · 故事板 · Mini Manim`
        : `${scene.title} · Mini Manim`;
  }, [scene.title, previewing, previewSeconds, storyboarding]);

  useEffect(() => {
    aspectRef.current = aspect;
    // 画幅写进地址(replaceState,不进历史):缩略图点进去的 ?preview= 带着它,
    // 按返回键重新载入的故事板也还是这个画幅。
    // 只在画幅真变了时改写:别把刚打开的 &storyboard 规范化成 &storyboard=。
    if (resolveAspect(window.location.search) !== aspect) {
      window.history.replaceState(
        window.history.state,
        '',
        `${window.location.pathname}${aspectSearch(window.location.search, aspect)}${window.location.hash}`,
      );
    }
    // 故事板缩略图的链接要跟着新地址走:舞台尺寸没变时 ResizeObserver 不会通知,这里补一次
    // (尺寸也没变就只刷新链接、不重画)。
    if (storyboarding) {
      handleRef.current?.resize();
    }
  }, [aspect, storyboarding]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    let cancelled = false;
    let handle: SceneHandle | null = null;
    let observer: ResizeObserver | null = null;
    setLoadError(null);
    const previewMount = previewing && previewSeconds !== null ? scene.preview : undefined;
    const storyboardMount = storyboarding ? scene.storyboard : undefined;
    // 故事板铺在 <section class="storyboard"> 里(storyboarding 时它和画布在同一次提交里渲染出来)。
    const startStoryboard = (
      mount: NonNullable<SceneEntry['storyboard']>,
      param: string,
    ): Promise<SceneHandle> => {
      const container = storyboardRef.current;
      if (!container) {
        return Promise.reject(new Error('故事板容器没有挂上'));
      }
      return mount(param, {
        container,
        title: scene.title,
        // 按当前画幅下舞台会有的尺寸排版:隐藏的 .stage 还在文档流里,量它就行(画幅的 CSS 只写一处)。
        // 画幅切换 / 窗口变化由下面同一个 ResizeObserver 通知,故事板防抖整页重画。
        stageSize: () => ({ width: canvas.clientWidth, height: canvas.clientHeight }),
        previewHref: (seconds) =>
          `${window.location.pathname}${previewSearch(window.location.search, seconds)}${window.location.hash}`,
        download: (blob) =>
          triggerDownload(blob, downloadName(sceneId, `storyboard-${aspectRef.current}`, blob.type || 'image/png')),
      });
    };
    const mounted: Promise<SceneHandle> =
      previewMount && previewSeconds !== null
        ? previewMount(canvas, previewSeconds)
        : storyboardMount && storyboardParam !== null
          ? startStoryboard(storyboardMount, storyboardParam)
          : scene.load().then((mount) => {
              const reducedMotion = prefersReducedMotion();
              const h = mount(canvas, {
                // 播放器自己也能暂停(进度条上的空格键),按钮状态必须跟着走。
                onPausedChange: (value) => {
                  pausedRef.current = value;
                  setPaused(value);
                },
                reducedMotion,
              });
              // 偏好减少动态效果时,演示场景先停着,由用户决定何时播放(影片有自己的播放控制)。
              if (reducedMotion && scene.kind === 'scene' && !pausedRef.current) {
                pausedRef.current = true;
                setPaused(true);
              }
              return h;
            });
    mounted
      .then((h) => {
        // 挂载与卸载竞速:先挂好、后卸载的,cleanup 里会 dispose 它;
        // cleanup 已经跑过才挂好的(StrictMode 的第一次挂载、HMR)没人再管,这里当场释放 ——
        // 否则旧实例接着在同一张画布 / 同一个故事板容器里画。
        handle = h;
        if (cancelled) {
          h.dispose();
          return;
        }
        handleRef.current = handle;
        setExportable(typeof handle.exportVideo === 'function');
        setAudioAvailable(handle.audioAvailable?.() === true);
        setAudioOn(false);
        handle.setPaused?.(pausedRef.current);
        // 画幅切换只改 .frame 的 CSS 尺寸,不会触发 window resize,必须观察 canvas 自身。
        if (typeof ResizeObserver !== 'undefined') {
          const target = handle;
          observer = new ResizeObserver(() => target.resize());
          observer.observe(canvas);
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          console.error('[App] 场景加载失败', e);
          setLoadError(`场景加载失败:${e instanceof Error ? e.message : String(e)}`);
        }
      });
    return () => {
      cancelled = true;
      observer?.disconnect();
      exportRef.current?.cancel();
      exportRef.current = null;
      handle?.dispose();
      handleRef.current = null;
      setExportable(false);
      setAudioAvailable(false);
      setExportPct(null);
      setExportMode(null);
    };
  }, [scene, previewing, previewSeconds, storyboarding, storyboardParam, sceneId]);

  // 离线导出(WebCodecs)能编的容器要异步探测(会按需加载编码库):场景能导出时才探,探到后并进下拉框。
  useEffect(() => {
    if (!exportable) {
      return;
    }
    let cancelled = false;
    probeEncodableContainers()
      .then((offline) => {
        if (!cancelled) {
          setFormats(supportedFormats(undefined, offline));
        }
      })
      .catch((e: unknown) => console.error('[App] 探测离线导出格式失败', e));
    return () => {
      cancelled = true;
    };
  }, [exportable]);

  // 播放途中打开「减少动态效果」同样先停下,由用户决定何时继续(只管演示场景;影片有自己的播放控制)。
  useEffect(() => {
    if (scene.kind !== 'scene' || typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
      return;
    }
    const query = window.matchMedia(REDUCED_MOTION_QUERY);
    const onChange = (e: MediaQueryListEvent): void => {
      if (e.matches && !pausedRef.current) {
        pausedRef.current = true;
        setPaused(true);
        handleRef.current?.setPaused?.(true);
      }
    };
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, [scene.kind]);

  // 刷新/关页会丢掉进行中的导出(离线渲染能切到后台继续,页面一关照样白做);导出期间拦一下。
  useEffect(() => {
    if (!exporting) {
      return;
    }
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      e.preventDefault();
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [exporting]);

  const startExport = (): void => {
    const exportVideo = handleRef.current?.exportVideo;
    if (!exportVideo || exportRef.current) {
      return;
    }
    // 离线渲染期间预览可以照常换画幅,成片仍是开始时的画幅:文件名按开始时的起。
    const exportAspect = aspect;
    setExportError(null);
    setExportNotice(null);
    setExportPct(0);
    announcedRef.current = 0;
    /** 开始时的导出方式;离线中途改走实时录制时提示一次。 */
    let startMode: ExportHandle['mode'] | null = null;
    let switched = false;
    // 实时录制会让播放器自己打开声音(把配音录进去),失败/取消时声音也可能已经开了:按钮按播放器的实际状态对齐。
    const syncAudioOn = (): void => {
      const on = handleRef.current?.audioEnabled?.();
      if (on !== undefined) {
        setAudioOn(on);
      }
    };
    // 实时录制时播放器会自己恢复播放并通过 onPausedChange 同步按钮,这里不必手动取消暂停。
    const handle = exportVideo({
      mimeType: exportFormat === 'auto' ? undefined : exportFormat,
      onProgress: (done, total) => {
        const pct = progressPercent(done, total);
        setExportPct(pct);
        // auto 模式编码器编不了(或带不上配音)时会改走实时录制:方式以句柄当下报告的为准。
        const mode = exportRef.current?.mode ?? null;
        setExportMode(mode);
        if (mode === 'realtime' && startMode === 'offline' && !switched) {
          switched = true;
          syncAudioOn();
          setExportStatus('改为实时录制:全片会实时播放一遍,请保持页面在前台');
        }
        const bucket = Math.floor(pct / 10) * 10;
        if (bucket > announcedRef.current) {
          announcedRef.current = bucket;
          setExportStatus(`${mode === 'offline' ? '已渲染' : '已导出'} ${bucket}%`);
        }
      },
    });
    exportRef.current = handle;
    startMode = handle.mode;
    setExportMode(handle.mode);
    syncAudioOn();
    // 离线是逐帧渲染(快慢与播放无关、可切到后台),实时是跟着播放录一遍。
    setExportStatus(handle.mode === 'offline' ? '开始渲染视频' : '开始导出');
    handle.done
      .then(
        (blob) => {
          // 只认当前这次导出:旧导出的回调不能清掉新导出的状态。
          if (exportRef.current !== handle) {
            return;
          }
          exportRef.current = null;
          setExportPct(null);
          setExportMode(null);
          syncAudioOn();
          triggerDownload(blob, downloadName(sceneId, exportAspect, blob.type));
          const message = exportAudioMessage(handle.audio);
          // 读屏只听常驻的播报区:原因一并在那里播报,可见提示不再另设 live region(新插入的播报区不一定被读)。
          setExportStatus(message.announce);
          setExportNotice(message.notice);
        },
        (err: unknown) => {
          if (exportRef.current !== handle) {
            return;
          }
          exportRef.current = null;
          setExportPct(null);
          setExportMode(null);
          syncAudioOn();
          if (isUserCancel(err)) {
            setExportStatus('导出已取消');
          } else {
            setExportStatus('');
            setExportError(exportErrorMessage(err));
          }
        },
      )
      .catch((e: unknown) => console.error('[App] 处理导出结果时出错', e));
  };

  // 取消只发请求,状态由 done 的 reject 回调统一复位(收带窗口期的取消也走这条路)。
  const cancelExport = (): void => {
    exportRef.current?.cancel();
  };

  const onExportClick = (e: MouseEvent<HTMLButtonElement>): void => {
    if (!exporting) {
      startExport();
    } else if (e.detail <= 1) {
      // 双击「导出」的第二下会落在同一位置的「取消」上:只认单击。
      cancelExport();
    }
  };

  // 必须在点击回调里同步调用:浏览器只允许用户操作之后开始出声。
  const toggleAudio = (): void => {
    const next = !audioOn;
    handleRef.current?.setAudioEnabled?.(next);
    setAudioOn(next);
  };

  const togglePaused = (): void => {
    const next = !paused;
    setPaused(next);
    pausedRef.current = next;
    handleRef.current?.setPaused?.(next);
  };

  return (
    <main className={`demo ${aspect}${storyboarding ? ' storyboarding' : ''}`}>
      <h1 className="visually-hidden">{scene.title}</h1>
      {/* 故事板模式下舞台只用来量尺寸(visibility:hidden,仍占位),对读屏隐藏。 */}
      <div className="frame" {...(storyboarding ? { 'aria-hidden': true } : {})}>
        <canvas
          ref={canvasRef}
          className="stage"
          {...(previewing
            ? {
                role: 'img',
                'aria-label': `静态预览:${scene.title}第 ${previewSeconds} 秒`,
              }
            : scene.interactive
              ? {
                  tabIndex: 0,
                  role: 'application',
                  'aria-roledescription': '可交互画布',
                  'aria-label': `数学动画:${scene.title}。拖拽或方向键平移,滚轮或加减号缩放`,
                }
              : { role: 'img', 'aria-label': `数学动画:${scene.title}` })}
        />
      </div>
      {storyboarding && (
        <section ref={storyboardRef} className="storyboard" aria-label={`故事板:${scene.title}`} />
      )}
      <div className="hud">
        <div className="toolbar">
          <fieldset className="aspect-bar">
            <legend className="visually-hidden">画幅</legend>
            {ASPECT_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={aspect === m.id}
                // 实时录制中途改画幅会让成片出现黑边/重新取景,直接禁用更清楚;
                // 离线渲染按开始时的画幅出片,预览随便换。
                disabled={lockPreview}
                onClick={() => setAspect(m.id)}
              >
                {m.label}
              </button>
            ))}
          </fieldset>
          {previewing ? (
            <output className="preview-badge">
              静态预览 {previewSeconds}s · 改 ?preview= 切帧
            </output>
          ) : storyboarding ? (
            <output className="preview-badge">故事板 · 改 &amp;storyboard= 换帧</output>
          ) : (
            <div className="action-bar">
              {/*
                自动播放的动画必须能暂停(WCAG 2.2.2)。
                文案随状态变化就不要再加 aria-pressed:两者叠加会让读屏播报
                「播放,已按下」这种自相矛盾的组合。
              */}
              <button
                type="button"
                aria-label={paused ? '继续播放' : '暂停播放'}
                disabled={lockPreview}
                onClick={togglePaused}
              >
                {paused ? '播放' : '暂停'}
              </button>
              {audioAvailable && (
                <button
                  type="button"
                  aria-label={audioOn ? '关闭配音' : '开启配音'}
                  disabled={lockPreview}
                  onClick={toggleAudio}
                >
                  {audioOn ? '关闭声音' : '开启声音'}
                </button>
              )}
            </div>
          )}
          {canExport && (
            <div className="action-bar">
              {formats.length > 2 && (
                <select
                  aria-label="导出格式"
                  value={exportFormat}
                  disabled={exporting}
                  onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                >
                  {formats.map((f) => (
                    <option key={f} value={f}>
                      {FORMAT_LABELS[f]}
                    </option>
                  ))}
                </select>
              )}
              {/* 始终是同一个按钮:导出/取消互换时焦点不丢,读屏也不会失去位置。 */}
              <button type="button" onClick={onExportClick}>
                {exporting ? `取消 ${exportPct}%` : '导出'}
              </button>
            </div>
          )}
        </div>
        {exportNotice !== null && (
          <div className="export-notice">
            {/* 只是可见提示:读屏已经从下面常驻的播报区听到同一段话。 */}
            <span>{exportNotice}</span>
            <button type="button" aria-label="关闭提示" onClick={() => setExportNotice(null)}>
              ×
            </button>
          </div>
        )}
        {(exportError ?? loadError) !== null && (
          <div className="export-error" role="alert">
            <span>{exportError ?? loadError}</span>
            <button
              type="button"
              aria-label="关闭错误提示"
              onClick={() => {
                setExportError(null);
                setLoadError(null);
              }}
            >
              ×
            </button>
          </div>
        )}
      </div>
      {/* <output> 自带 status 角色,读屏会礼貌地播报导出进度。 */}
      <output className="visually-hidden" aria-live="polite">
        {exportStatus}
      </output>
    </main>
  );
}

export default App;
