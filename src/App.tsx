import { useEffect, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { probeEncodableContainers } from './export/encoder';
import type { ExportHandle } from './export/types';
import {
  SCENES,
  downloadName,
  exportErrorMessage,
  isUserCancel,
  progressPercent,
  resolvePreviewSeconds,
  resolveSceneId,
  supportedFormats,
} from './sceneRegistry';
import type { ExportFormat, SceneId } from './sceneRegistry';
import type { SceneEntry, SceneHandle } from './scenes/types';
import './App.css';

type AspectMode = 'full' | 'w16h9' | 'w4h3' | 'w9h16';

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
  const [aspect, setAspect] = useState<AspectMode>('full');
  /** 当前场景的句柄支持导出(还要浏览器有能导的格式才显示导出)。 */
  const [exportable, setExportable] = useState(false);
  const [formats, setFormats] = useState<ExportFormat[]>(() => supportedFormats());
  const [exportFormat, setExportFormat] = useState<ExportFormat>('auto');
  /** 导出进度(整数百分比),null 表示没在导出。 */
  const [exportPct, setExportPct] = useState<number | null>(null);
  /** 这次导出的方式:离线渲染不占用预览,实时录制要独占预览(锁住暂停与画幅)。 */
  const [exportMode, setExportMode] = useState<ExportHandle['mode'] | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  /** 给读屏的导出状态播报(开始、每 10%、完成、取消)。 */
  const [exportStatus, setExportStatus] = useState('');
  const announcedRef = useRef(-1);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paused, setPaused] = useState(false);
  // 场景重挂载(StrictMode / HMR)后新句柄要接上当前的暂停态,
  // 又不想把 paused 放进挂载 effect 的依赖里(那会重建整个场景)。
  const pausedRef = useRef(false);
  const exporting = exportPct !== null;
  const canExport = exportable && formats.length > 0;
  const lockPreview = exporting && exportMode !== 'offline';

  useEffect(() => {
    document.title = previewing
      ? `${scene.title} · 预览 ${previewSeconds}s · Mini Manim`
      : `${scene.title} · Mini Manim`;
  }, [scene.title, previewing, previewSeconds]);

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
    const mounted: Promise<SceneHandle> =
      previewMount && previewSeconds !== null
        ? previewMount(canvas, previewSeconds)
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
        // 挂载与卸载竞速时照样先收下句柄:cleanup 里会 dispose 它。
        handle = h;
        if (cancelled) {
          return;
        }
        handleRef.current = handle;
        setExportable(typeof handle.exportVideo === 'function');
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
      setExportPct(null);
      setExportMode(null);
    };
  }, [scene, previewing, previewSeconds]);

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
    setExportPct(0);
    announcedRef.current = 0;
    // 实时录制时播放器会自己恢复播放并通过 onPausedChange 同步按钮,这里不必手动取消暂停。
    const handle = exportVideo({
      mimeType: exportFormat === 'auto' ? undefined : exportFormat,
      onProgress: (done, total) => {
        const pct = progressPercent(done, total);
        setExportPct(pct);
        // auto 模式编码器编不了时会改走实时录制:方式以句柄当下报告的为准。
        const mode = exportRef.current?.mode ?? null;
        setExportMode(mode);
        const bucket = Math.floor(pct / 10) * 10;
        if (bucket > announcedRef.current) {
          announcedRef.current = bucket;
          setExportStatus(`${mode === 'offline' ? '已渲染' : '已导出'} ${bucket}%`);
        }
      },
    });
    exportRef.current = handle;
    setExportMode(handle.mode);
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
          triggerDownload(blob, downloadName(sceneId, exportAspect, blob.type));
          setExportStatus('导出完成,已开始下载');
        },
        (err: unknown) => {
          if (exportRef.current !== handle) {
            return;
          }
          exportRef.current = null;
          setExportPct(null);
          setExportMode(null);
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

  const togglePaused = (): void => {
    const next = !paused;
    setPaused(next);
    pausedRef.current = next;
    handleRef.current?.setPaused?.(next);
  };

  return (
    <main className={`demo ${aspect}`}>
      <h1 className="visually-hidden">{scene.title}</h1>
      <div className="frame">
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
