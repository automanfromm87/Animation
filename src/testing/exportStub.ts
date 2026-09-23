import type { RecorderEnv } from '../export/recorder';
import type { StubCanvas } from './domStub';
import { createFakeCtx } from './fakeCtx';

/** 桩里的 DOM 元素:能记属性、挂监听、派发事件,足够驱动播放器的 chrome。 */
export interface StubElement {
  tagName: string;
  style: Record<string, string>;
  textContent: string;
  isConnected: boolean;
  removed: boolean;
  attributes: Map<string, string>;
  getAttribute(name: string): string | null;
  /** 派发一个事件给这个元素上注册的监听。 */
  dispatch(type: string, event?: Record<string, unknown>): void;
  listenerCount(type: string): number;
}

/** 导出画布上的一次绘制调用(只记录被 captureStream 的那张)。 */
export interface ExportOp {
  op: string;
  /** 数字实参(坐标、尺寸)。 */
  args: number[];
  fillStyle: unknown;
  font: unknown;
  globalAlpha: unknown;
  text?: string;
}

/** 导出桩:document / MediaRecorder / captureStream / Blob 的最小实现。 */
export interface ExportStub {
  /** 导出画布上 drawImage 被调用的次数(= 成功合成的帧数)。 */
  composited(): number;
  /** recorder.start / stop 各被调了几次。 */
  starts(): number;
  stops(): number;
  /** 给画布造一个父节点,让播放器创建白闪/字幕/进度条那套 DOM。返回这个父节点。 */
  mountedCanvas(base: StubCanvas & HTMLCanvasElement): StubElement;
  /** 播放器创建过的全部元素(按创建顺序)。 */
  created(): StubElement[];
  /** 按属性找元素(比如 role=slider)。 */
  findByAttr(name: string, value: string): StubElement | undefined;
  /** 模拟切到后台/回到前台(会派发 visibilitychange)。 */
  setHidden(hidden: boolean): void;
  /** document 上某类监听当前的数量。 */
  docListenerCount(type: string): number;
  /** 录制中交一块数据。 */
  emitChunk(size: number): void;
  /** 让编码器报错。 */
  fireRecorderError(error: unknown): void;
  /** 改捕获轨道状态。 */
  setTrack(state: { muted?: boolean; readyState?: 'live' | 'ended' }): void;
  /** 捕获轨道被 stop 的次数。 */
  tracksStopped(): number;
  /** 最近一次 captureStream 出来的流里现有的轨道(含加进去的配音音轨)。 */
  streamTracks(): unknown[];
  /** 每次建 MediaRecorder 时收到的选项(按创建顺序)。 */
  recorderOptions(): Array<Record<string, unknown>>;
  /** 导出画布有没有被摘掉。 */
  exportCanvasRemoved(): boolean;
  /** 导出画布上的绘制记录。 */
  exportOps(): ExportOp[];
  /**
   * asyncStop 时交付所有「已 stop、onstop 还没来」的编码器(模拟之后某个任务里才到的 onstop)。
   * 由测试显式调用,收带时机与微任务/宏任务的调度先后无关。返回交付了几个。
   */
  deliverStops(): number;
  /** 录制环境:直接注入 ExportRecorder / runFilm,不经全局。 */
  readonly env: RecorderEnv;
  /** installExportStub 装上的全局还原回去(createExportStub 的是空操作)。 */
  restore(): void;
}

export interface ExportStubOptions {
  /** recorder 收带时交出的数据块大小(字节)。默认给足,不触发空成片检查。 */
  chunkSize?: number;
  /** 模拟被跨源污染的画布:所有画布的 getImageData 都抛 SecurityError。 */
  tainted?: boolean;
  /** 支持的容器列表;缺省什么都支持。 */
  supportedTypes?: readonly string[];
  /**
   * 收带是否异步:stop() 之后 onstop 不会自己来,要等测试调 deliverStops()
   * (真实 MediaRecorder 的 onstop 在之后的任务里才来)。
   */
  asyncStop?: boolean;
  /** 返回 true 时导出画布的 drawImage 抛错(合成失败注入)。 */
  throwOnDraw?: () => boolean;
  /** 编码器报告的实际类型(recorder.mimeType);缺省等于请求值。 */
  recorderMimeType?: string;
  /** 捕获流是否提供 getVideoTracks / active(缺省不提供,贴近「拿不到」的环境)。 */
  exposeTrack?: boolean;
  /** 捕获流没有 addTrack(加不了配音音轨的环境)。 */
  noAddTrack?: boolean;
}

type Listener = (e: unknown) => void;

/** 桩里的数据块/成片:只关心字节数与类型。 */
class StubBlob {
  size: number;
  type: string;
  constructor(parts: ReadonlyArray<{ size?: number }>, o?: { type?: string }) {
    this.size = parts.reduce((sum, part) => sum + (part.size ?? 0), 0);
    this.type = o?.type ?? '';
  }
}

interface ExportFakes {
  stub: Omit<ExportStub, 'restore'>;
  /** installExportStub 要装到 globalThis 上的那几样。 */
  globals: Record<'document' | 'MediaRecorder' | 'Blob' | 'getComputedStyle', unknown>;
}

function buildExportFakes(options?: ExportStubOptions): ExportFakes {
  const chunkSize = options?.chunkSize ?? 4_000_000;
  const tainted = options?.tainted ?? false;
  let composited = 0;
  let starts = 0;
  let stops = 0;
  let tracksStopped = 0;
  let exportCanvasRemoved = false;
  const created: StubElement[] = [];
  const exportOps: ExportOp[] = [];
  const docListeners = new Map<string, Set<Listener>>();
  const track: { muted: boolean; readyState: 'live' | 'ended' } = {
    muted: false,
    readyState: 'live',
  };
  /** 正在录制的编码器(emitChunk / fireRecorderError 发给它们)。 */
  const liveRecorders = new Set<StubRecorder>();
  /** 最近一次捕获流的轨道表;每次建录制器时的选项。 */
  let lastStreamTracks: unknown[] = [];
  const recorderOptions: Array<Record<string, unknown>> = [];
  /** asyncStop 时已 stop、等待交付 onstop 的收尾动作。 */
  let pendingStops: Array<() => void> = [];

  const makeEl = (tag: string): Record<string, unknown> => {
    const attributes = new Map<string, string>();
    const listeners = new Map<string, Set<Listener>>();
    let captured = false;
    const el: Record<string, unknown> = {
      tagName: tag.toUpperCase(),
      style: new Proxy({} as Record<string, string>, {
        get: (o, p) => (typeof p === 'string' ? (o[p] ?? '') : undefined),
        set: (o, p, v: string) => {
          if (typeof p === 'string') {
            o[p] = v;
          }
          return true;
        },
      }),
      textContent: '',
      isConnected: true,
      removed: false,
      attributes,
      appendChild: (c: unknown) => c,
      removeChild: (c: unknown) => c,
      addEventListener: (type: string, fn: Listener) => {
        let set = listeners.get(type);
        if (!set) {
          set = new Set();
          listeners.set(type, set);
        }
        set.add(fn);
      },
      removeEventListener: (type: string, fn: Listener) => {
        listeners.get(type)?.delete(fn);
      },
      setAttribute: (name: string, value: string) => {
        attributes.set(name, String(value));
      },
      getAttribute: (name: string) => attributes.get(name) ?? null,
      getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 24 }),
      clientWidth: 1280,
      clientHeight: 720,
      offsetWidth: 40,
      offsetHeight: 24,
      dispatch: (type: string, event: Record<string, unknown> = {}) => {
        const e = { preventDefault: () => undefined, ...event };
        for (const fn of [...(listeners.get(type) ?? [])]) {
          fn(e);
        }
      },
      listenerCount: (type: string) => listeners.get(type)?.size ?? 0,
      remove: () => {
        el['removed'] = true;
        el['isConnected'] = false;
        if (captured) {
          exportCanvasRemoved = true;
        }
      },
    };
    if (tag === 'canvas') {
      el['width'] = 1280;
      el['height'] = 720;
      el['getContext'] = () =>
        createFakeCtx({
          record: false,
          ...(tainted
            ? {
                overrides: {
                  getImageData: () => {
                    throw new DOMException(
                      'The canvas has been tainted by cross-origin data.',
                      'SecurityError',
                    );
                  },
                },
              }
            : {}),
          onCall: (call, state) => {
            // 只记导出画布(captureStream 过的那块)上的方法调用。
            if (!captured || call.op.startsWith('=')) {
              return;
            }
            if (call.op === 'drawImage') {
              if (options?.throwOnDraw?.()) {
                throw new Error('合成探针抛错');
              }
              composited += 1;
            }
            exportOps.push({
              op: call.op,
              args: call.args,
              fillStyle: state['fillStyle'],
              font: state['font'],
              globalAlpha: state['globalAlpha'],
              ...(typeof call.value === 'string' ? { text: call.value } : {}),
            });
          },
        }).ctx;
      el['captureStream'] = () => {
        captured = true;
        const tracks: unknown[] = [
          {
            kind: 'video',
            stop: () => {
              tracksStopped += 1;
            },
          },
        ];
        lastStreamTracks = tracks;
        const stream: Record<string, unknown> = {
          getTracks: () => [...tracks],
        };
        if (!options?.noAddTrack) {
          stream['addTrack'] = (t: unknown) => {
            tracks.push(t);
          };
        }
        if (options?.exposeTrack) {
          stream['getVideoTracks'] = () => [track];
          Object.defineProperty(stream, 'active', {
            get: () => track.readyState === 'live',
          });
        }
        return stream;
      };
    }
    created.push(el as unknown as StubElement);
    return el;
  };

  class StubRecorder {
    static isTypeSupported(type: string): boolean {
      return options?.supportedTypes ? options.supportedTypes.includes(type) : true;
    }
    state = 'inactive';
    mimeType: string;
    ondataavailable: ((e: { data: unknown }) => void) | null = null;
    onstop: (() => void) | null = null;
    onerror: ((e: unknown) => void) | null = null;
    constructor(_stream: unknown, o: { mimeType: string }) {
      this.mimeType = options?.recorderMimeType ?? o.mimeType;
      recorderOptions.push({ ...o });
    }
    start(): void {
      starts += 1;
      this.state = 'recording';
      liveRecorders.add(this);
    }
    stop(): void {
      stops += 1;
      this.state = 'inactive';
      liveRecorders.delete(this);
      const finish = (): void => {
        this.ondataavailable?.({ data: new StubBlob([{ size: chunkSize }]) });
        this.onstop?.();
      };
      if (options?.asyncStop) {
        pendingStops.push(finish);
      } else {
        finish();
      }
    }
  }

  const doc = {
    createElement: makeEl,
    body: { appendChild: () => undefined, removeChild: () => undefined },
    hidden: false,
    compatMode: 'CSS1Compat',
    addEventListener: (type: string, fn: Listener) => {
      let set = docListeners.get(type);
      if (!set) {
        set = new Set();
        docListeners.set(type, set);
      }
      set.add(fn);
    },
    removeEventListener: (type: string, fn: Listener) => {
      docListeners.get(type)?.delete(fn);
    },
  };
  const env: RecorderEnv = {
    MediaRecorder: StubRecorder as unknown as RecorderEnv['MediaRecorder'],
    createCanvas: () => makeEl('canvas') as unknown as HTMLCanvasElement,
    attach: () => undefined,
    hidden: () => doc.hidden,
    onVisibilityChange: (listener) => {
      doc.addEventListener('visibilitychange', listener);
      return () => doc.removeEventListener('visibilitychange', listener);
    },
    makeBlob: (chunks, type) =>
      new StubBlob(chunks as ReadonlyArray<{ size?: number }>, { type }) as unknown as Blob,
  };

  const stub: Omit<ExportStub, 'restore'> = {
    composited: () => composited,
    starts: () => starts,
    stops: () => stops,
    mountedCanvas(base) {
      const parent = makeEl('div');
      (base as unknown as Record<string, unknown>)['parentElement'] = parent;
      return parent as unknown as StubElement;
    },
    created: () => [...created],
    findByAttr: (name, value) => created.find((el) => el.getAttribute(name) === value),
    setHidden(hidden) {
      doc.hidden = hidden;
      for (const fn of [...(docListeners.get('visibilitychange') ?? [])]) {
        fn({ type: 'visibilitychange' });
      }
    },
    docListenerCount: (type) => docListeners.get(type)?.size ?? 0,
    emitChunk(size) {
      for (const r of [...liveRecorders]) {
        r.ondataavailable?.({ data: { size } });
      }
    },
    fireRecorderError(error) {
      for (const r of [...liveRecorders]) {
        r.onerror?.({ type: 'error', error });
      }
    },
    setTrack(state) {
      if (state.muted !== undefined) {
        track.muted = state.muted;
      }
      if (state.readyState !== undefined) {
        track.readyState = state.readyState;
      }
    },
    tracksStopped: () => tracksStopped,
    streamTracks: () => [...lastStreamTracks],
    recorderOptions: () => recorderOptions.map((o) => ({ ...o })),
    exportCanvasRemoved: () => exportCanvasRemoved,
    exportOps: () => [...exportOps],
    deliverStops() {
      const due = pendingStops;
      pendingStops = [];
      for (const finish of due) {
        finish();
      }
      return due.length;
    },
    env,
  };
  return {
    stub,
    globals: {
      document: doc,
      MediaRecorder: StubRecorder,
      Blob: StubBlob,
      getComputedStyle: () => ({ position: 'relative', fontFamily: 'serif' }),
    },
  };
}

/** 只建桩、不碰全局:把 stub.env 注入 ExportRecorder / runFilm 的 exportEnv 即可。 */
export function createExportStub(options?: ExportStubOptions): ExportStub {
  return { ...buildExportFakes(options).stub, restore: () => undefined };
}

/**
 * 建桩并装到全局(document / MediaRecorder / Blob / getComputedStyle):
 * 播放器的覆盖层 DOM 与缺省录制环境都从全局取。用完必须 restore()。
 */
export function installExportStub(options?: ExportStubOptions): ExportStub {
  const { stub, globals } = buildExportFakes(options);
  const g = globalThis as unknown as Record<string, unknown>;
  const keys = Object.keys(globals) as Array<keyof typeof globals>;
  const saved = keys.map((k) => [k, g[k]] as const);
  for (const k of keys) {
    g[k] = globals[k];
  }
  return {
    ...stub,
    restore() {
      for (const [k, v] of saved) {
        g[k] = v;
      }
    },
  };
}

type ResizeCallback = (entries: Array<{ contentRect: { width: number; height: number } }>) => void;

export interface ResizeObserverStub {
  /** 改画布 css 尺寸并通知观察它的回调(与浏览器一样把 contentRect 交给回调)。 */
  resize(target: { clientWidth: number; clientHeight: number }, width: number, height: number): void;
  /** 当前活着的观察者数量(disconnect 之后应归零)。 */
  active(): number;
  restore(): void;
}

/** ResizeObserver 桩:播放器靠它得知画布尺寸变化与横竖屏翻转。 */
export function installResizeObserverStub(): ResizeObserverStub {
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = g['ResizeObserver'];
  const observers = new Set<{ cb: ResizeCallback; targets: Set<unknown> }>();
  g['ResizeObserver'] = class {
    private readonly entry: { cb: ResizeCallback; targets: Set<unknown> };
    constructor(cb: ResizeCallback) {
      this.entry = { cb, targets: new Set() };
      observers.add(this.entry);
    }
    observe(t: unknown): void {
      this.entry.targets.add(t);
    }
    disconnect(): void {
      observers.delete(this.entry);
    }
  };
  return {
    resize(target, width, height) {
      target.clientWidth = width;
      target.clientHeight = height;
      for (const o of [...observers]) {
        if (o.targets.has(target)) {
          o.cb([{ contentRect: { width, height } }]);
        }
      }
    },
    active: () => observers.size,
    restore() {
      g['ResizeObserver'] = saved;
    },
  };
}
