import type { PlayContext, Playable } from '../animations/Animation';
import { Camera } from '../camera/Camera';
import type { CameraView } from '../camera/Camera';
import { CameraMove } from '../camera/cameraMoves';
import type { WorldBounds } from '../mobjects/bounds';
import { worldBoundsInScene } from '../mobjects/bounds';
import type { MObject } from '../mobjects/MObject';
import { NO_STYLE } from '../mobjects/MObject';
import type { MeasureContext, Point, Size } from '../mobjects/types';
import type { Affine } from '../path/path';
import { multiplyAffine, similarityAffine } from '../path/path';
import { CanvasRenderer } from '../renderer/CanvasRenderer';
import { onFontsLoaded } from '../renderer/fontEvents';
import type { StyleOverride, Theme } from '../theme/Theme';
import { lightTheme } from '../theme/presets';
import { FramePump } from './FramePump';
import type { Insets } from './framing';
import {
  computeFitView,
  safeAreaCenterOffset,
  sanitizeInset,
  usableViewport,
} from './framing';
import { PointerController } from './PointerController';
import type {
  PlayFitOptions,
  SafeArea,
  SceneOptions,
  SceneUpdater,
} from './types';

export type {
  PlayFitOptions,
  SafeArea,
  SceneOptions,
  SceneUpdater,
  SceneViewport,
  UpdaterScene,
} from './types';

function currentPixelRatio(): number {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio : 1;
  return Number.isFinite(dpr) && dpr > 0 ? dpr : 1;
}

function finiteBounds(b: WorldBounds): boolean {
  return (
    Number.isFinite(b.minX) &&
    Number.isFinite(b.minY) &&
    Number.isFinite(b.maxX) &&
    Number.isFinite(b.maxY)
  );
}

function sameView(a: CameraView, b: CameraView): boolean {
  const eps = 1e-9;
  return (
    Math.abs(a.x - b.x) <= eps * Math.max(1, Math.abs(b.x)) &&
    Math.abs(a.y - b.y) <= eps * Math.max(1, Math.abs(b.y)) &&
    Math.abs(a.zoom - b.zoom) <= eps * Math.max(1, Math.abs(b.zoom))
  );
}

/** 上次取景:包围盒、边距;按对象取景时还记着对象(字体加载后能重算包围盒)与落下的机位。 */
interface FitRecord {
  bounds: WorldBounds;
  pad: number;
  objects?: readonly MObject[];
  /**
   * 取景时各对象包围盒的中心(世界坐标)。字体就绪后只在对象没被挪动时重取景:
   * 字体只改尺寸不改位置,中心变了说明对象被动画/脚本挪过,镜头不该跟着跳。
   */
  centers?: readonly Point[];
  /** 取景落下的机位。镜头之后被挪过(拖拽、别的运镜),就不再自动重取景。 */
  view?: CameraView;
}

/**
 * Scene: 时间线 + 播放器 + 无限画布交互。
 * 持有 MObject 列表(世界坐标)和当前 Theme,通过 play() 驱动一组
 * Playable 并逐帧渲染。帧循环(FramePump)、指针交互(PointerController)、
 * 取景计算(framing)各自独立,Scene 负责把它们组装起来。
 */
export class Scene {
  private readonly canvas: HTMLCanvasElement;
  private readonly renderer: CanvasRenderer;
  private readonly camera: Camera;
  private readonly pump: FramePump;
  private readonly pointer: PointerController;
  private readonly mobjects: MObject[] = [];
  private readonly updaters: SceneUpdater[] = [];
  private theme: Theme;
  private safeArea: Insets = { top: 0, bottom: 0, left: 0, right: 0 };
  private disposed = false;
  /** 干跑中:draw() 直接返回,时间线推进不受影响。 */
  private dryRun = false;
  /** 上次 fit 取景的记录,resize / 字体加载完成后重算机位用。 */
  private lastFit: FitRecord | null = null;
  /** 视口不可用(画布隐藏、尺寸为 0)时推迟的取景,等尺寸就绪再应用。 */
  private fitPending = false;
  /** 正在进行的 playFit 运镜数。它们的目标每帧重算,resize 时不能再把机位拍到终点。 */
  private fitMoves = 0;
  /** 视口的 css 尺寸与像素比。有 ResizeObserver 时由它维护,绘制路径不读 DOM 布局。 */
  private cssWidth = 0;
  private cssHeight = 0;
  private pixelRatio = 1;
  private resizeObserver: ResizeObserver | null = null;
  /** 固定视口(离屏渲染):不读 DOM 尺寸、不挂 ResizeObserver。 */
  private readonly fixedViewport: { width: number; height: number; pixelRatio: number } | null;
  private readonly unsubscribers: Array<() => void> = [];
  private stopWatchingPixelRatio: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement, options?: SceneOptions) {
    this.canvas = canvas;
    this.theme = options?.theme ?? lightTheme;
    this.camera = new Camera(options?.camera);
    const vp = options?.viewport;
    this.fixedViewport = vp
      ? {
          width: Math.max(0, Number.isFinite(vp.width) ? vp.width : 0),
          height: Math.max(0, Number.isFinite(vp.height) ? vp.height : 0),
          pixelRatio:
            vp.pixelRatio !== undefined && Number.isFinite(vp.pixelRatio) && vp.pixelRatio > 0
              ? vp.pixelRatio
              : 1,
        }
      : null;
    this.renderer = new CanvasRenderer(canvas);
    this.pump = new FramePump(
      {
        beforeTimelines: (dt) => this.runUpdaters(dt),
        draw: () => this.draw(),
      },
      options?.clock,
    );
    this.pointer = new PointerController(canvas, {
      camera: this.camera,
      viewport: () => this.getViewportSize(),
      changed: () => this.pump.requestRender(),
    });
    this.syncViewport();
    // 网页字体晚到:Label 量出来的尺寸会变,一次性排版的容器与按对象取的景要重算。
    this.unsubscribers.push(onFontsLoaded(() => this.measurementsChanged()));
    if (this.fixedViewport) {
      return;
    }
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObserver = new ResizeObserver(() => {
        if (!this.disposed && this.syncViewport()) {
          this.draw();
        }
      });
      this.resizeObserver.observe(canvas);
    }
    this.watchPixelRatio();
  }

  getCamera(): Camera {
    return this.camera;
  }

  /** 当前视口 css 尺寸(画布隐藏时为 0),分段按它判断横竖屏排版。 */
  getViewportSize(): Size {
    return { w: this.cssWidth, h: this.cssHeight };
  }

  /** 已播放的累计时长(秒)。只在 play/wait 推进时累加,与动画同一时钟。 */
  getElapsed(): number {
    return this.pump.getElapsed();
  }

  /**
   * 暂停/恢复整条时间线。
   * 暂停期间 updater 不跑、动画不推进、getElapsed() 不涨;
   * 恢复后接着原进度继续,不会跳过暂停的那段。
   * (自动播放的动画需要可暂停,这是 WCAG 2.2.2 的要求。)
   */
  setPaused(paused: boolean): void {
    this.pump.setPaused(paused);
  }

  isPaused(): boolean {
    return this.pump.isPaused();
  }

  /**
   * 干跑开关:打开后时间线照常推进(updater、插值、完成态),只跳过栅格化。
   * 单帧预览 / 段内跳转快进几百上千帧时用,最后关掉再画一次就是目标帧。
   * 注意干跑期间连 syncViewport 都不做:快进时画布尺寸不会变,省掉每帧的布局读取。
   */
  setDryRun(dry: boolean): void {
    this.dryRun = dry;
  }

  getTheme(): Theme {
    return this.theme;
  }

  setTheme(theme: Theme): void {
    this.theme = theme;
    this.render();
  }

  /** 当前主题的文本度量上下文,取景与 Layout 排版都应该用它。 */
  measureContext(): MeasureContext {
    return { fontSize: this.theme.fontSize, fontFamily: this.theme.fontFamily };
  }

  /**
   * 按当前主题排布一个容器。
   * 直接调 `layout.layout()` 会回落到硬编码的兜底字号,换主题后量与画对不上。
   */
  layout(node: { layout(context?: MeasureContext): void }): void {
    node.layout(this.measureContext());
  }

  /** 开关手动交互。影片式场景可锁定,避免拖拽与程序化运镜打架。 */
  setInteractionEnabled(enabled: boolean): void {
    this.pointer.setEnabled(enabled);
  }

  /**
   * 设置安全区(屏幕 css 像素)。缺省字段保持不变(合并语义,与 Camera.setView 一致);
   * 要整体归零用 clearSafeArea()。后续取景都会把内容框进可用区。非有限/负数按 0。
   */
  setSafeArea(safe: SafeArea): void {
    if (safe.top !== undefined) {
      this.safeArea.top = sanitizeInset(safe.top);
    }
    if (safe.bottom !== undefined) {
      this.safeArea.bottom = sanitizeInset(safe.bottom);
    }
    if (safe.left !== undefined) {
      this.safeArea.left = sanitizeInset(safe.left);
    }
    if (safe.right !== undefined) {
      this.safeArea.right = sanitizeInset(safe.right);
    }
  }

  /** 清除安全区(四边归零)。 */
  clearSafeArea(): void {
    this.safeArea = { top: 0, bottom: 0, left: 0, right: 0 };
  }

  /**
   * 可用区中心相对视口中心的偏移(css 像素)。
   * 传给 createCameraFollow 的 centerOffset,被跟随的对象就和取景镜头一样落在可用区中心。
   */
  readonly safeAreaCenterOffset = (): Point =>
    safeAreaCenterOffset(this.getViewportSize(), this.safeArea);

  /**
   * 缩放平移到刚好框住世界矩形(含边距),尊重安全区。
   * @deprecated 四个同类型位置参数很容易写反顺序而且不会报错,改用 {@link fitBounds}。
   */
  fitView(
    minX: number,
    minY: number,
    maxX: number,
    maxY: number,
    pad = 0,
  ): void {
    if (!(maxX >= minX) || !(maxY >= minY)) {
      console.warn(
        `Scene.fitView: 收到反向矩形(x ${minX}..${maxX}, y ${minY}..${maxY}),参数顺序是 (minX, minY, maxX, maxY)`,
      );
    }
    this.fitBounds({ minX, minY, maxX, maxY }, pad);
  }

  /**
   * 缩放平移到刚好框住给定世界包围盒(含边距),尊重安全区。
   * 非有限的包围盒被忽略;画布隐藏(尺寸为 0)时先记下,等尺寸就绪再取景。
   */
  fitBounds(bounds: WorldBounds, pad = 0): void {
    if (!finiteBounds(bounds)) {
      console.warn('Scene.fitBounds: 包围盒含非有限值,已忽略', bounds);
      return;
    }
    this.fitTo({ bounds: { ...bounds }, pad });
  }

  /** 记下取景并落位;画布隐藏(尺寸为 0)时先挂起,等尺寸就绪再落。 */
  private fitTo(fit: FitRecord): void {
    this.lastFit = fit;
    if (!usableViewport(this.getViewportSize())) {
      this.fitPending = true;
      return;
    }
    this.applyLastFit();
    this.render();
  }

  /**
   * 算出框住世界包围盒的机位(不应用),尊重安全区:
   * 按可用区尺寸算缩放,内容中心落到可用区中心。零内缩时与直接 fit 一致。
   */
  computeFitView(bounds: WorldBounds, pad = 0): CameraView {
    return computeFitView(this.camera, bounds, pad, this.getViewportSize(), this.safeArea);
  }

  /**
   * 瞬时框住给定对象(含边距)。嵌套在变换过的容器里的对象也按真实世界位置算。空列表时不动。
   * 字体稍后加载完成、对象尺寸变了时,只要镜头没被挪过就按新尺寸重取景。
   */
  fitObjects(objects: readonly MObject[], pad = 0): void {
    const b = this.worldBoundsOf(objects);
    if (!b) {
      return;
    }
    if (!finiteBounds(b)) {
      console.warn('Scene.fitObjects: 包围盒含非有限值,已忽略', b);
      return;
    }
    this.fitTo({ bounds: b, pad, objects: [...objects], centers: this.objectCenters(objects) });
  }

  /** 算出框住给定对象的机位(不应用),尊重安全区。空列表时返回当前机位。 */
  getFitView(objects: readonly MObject[], pad = 0): CameraView {
    const b = this.worldBoundsOf(objects);
    return b ? this.computeFitView(b, pad) : this.camera.getView();
  }

  /**
   * 运镜到刚好框住给定对象,尊重安全区。空列表时直接 resolve。
   * 目标每帧按当前视口重算:运镜途中画布尺寸变了,落点跟着新取景走。
   * 画布隐藏(尺寸为 0)期间镜头原地不动、时长照走,尺寸就绪后直接落到取景位。
   */
  playFit(objects: readonly MObject[], options?: PlayFitOptions): Promise<void> {
    const b = this.worldBoundsOf(objects);
    if (!b || !finiteBounds(b)) {
      return Promise.resolve();
    }
    const pad = options?.pad ?? 0;
    // 记进 lastFit,否则之后的 resizeAndRefit() 会把镜头弹回上一次 fit 的取景。
    const fit: FitRecord = {
      bounds: b,
      pad,
      objects: [...objects],
      centers: this.objectCenters(objects),
    };
    this.lastFit = fit;
    this.fitMoves += 1;
    const target = (): Partial<CameraView> => {
      if (!usableViewport(this.getViewportSize())) {
        this.fitPending = true;
        return {};
      }
      return this.computeFitView(fit.bounds, pad);
    };
    return this.play(new CameraMove(this.camera, target, options)).finally(() => {
      this.fitMoves -= 1;
      if (this.lastFit === fit && usableViewport(this.getViewportSize())) {
        this.fitPending = false;
        fit.view = this.camera.getView();
      }
    });
  }

  /** 加入场景根对象。已在场景里的对象会被忽略(重复加入会画两遍)。 */
  add(...mobjects: MObject[]): this {
    for (const m of mobjects) {
      if (!this.mobjects.includes(m)) {
        this.mobjects.push(m);
      }
    }
    return this;
  }

  /** 移除场景根对象(全部匹配项)。 */
  remove(...mobjects: MObject[]): this {
    for (let i = this.mobjects.length - 1; i >= 0; i--) {
      const m = this.mobjects[i];
      if (m !== undefined && mobjects.includes(m)) {
        this.mobjects.splice(i, 1);
      }
    }
    return this;
  }

  /** 注册逐帧 updater(比如读取 ValueTracker 重算曲面),返回注销函数。 */
  addUpdater(updater: SceneUpdater): () => void {
    this.updaters.push(updater);
    return () => this.removeUpdater(updater);
  }

  removeUpdater(updater: SceneUpdater): void {
    const index = this.updaters.indexOf(updater);
    if (index >= 0) {
      this.updaters.splice(index, 1);
    }
  }

  /**
   * 渲染一帧。帧泵在跑时合并到本帧末尾,避免同一帧画多次;
   * 否则立即绘制。dispose 之后是空操作。
   */
  render(): void {
    if (this.disposed) {
      return;
    }
    if (this.pump.running) {
      this.pump.markDirty();
      return;
    }
    this.draw();
  }

  /**
   * 按画布当前 css 尺寸重设分辨率并立即重画。
   * 尺寸变化会把 backing store 清空,必须当场补画,否则这一帧会以空白上屏。
   */
  resize(): void {
    if (this.disposed) {
      return;
    }
    this.syncViewport();
    this.draw();
  }

  /**
   * 重设分辨率并按上次 fit 重取景,只画一次(无记录则只重设分辨率)。
   * 只给播片模板用;可交互场景尺寸变化不碰机位,调 resize() 即可。
   */
  resizeAndRefit(): void {
    if (this.disposed) {
      return;
    }
    this.syncViewport();
    // playFit 运镜途中不直接落机位:那会先闪到终点一帧、下一帧又被插值拉回。
    // 运镜的目标每帧按新视口重算,落地时自然就是新的取景。
    if (this.fitMoves === 0) {
      this.applyLastFit();
    }
    // 走在 resize 路径上,必须立即生效。
    this.draw();
  }

  /**
   * 按目标分辨率把当前这一帧重新画进任意 2D 上下文(坐标为目标像素,忽略 ctx 现有变换)。
   * 目标矩形与视口长宽比不一致时按 contain 居中摆放(不拉伸)。放大截图也是清晰的。
   */
  renderTo(
    ctx: CanvasRenderingContext2D,
    options?: { x?: number; y?: number; width?: number; height?: number },
  ): void {
    if (this.disposed) {
      return;
    }
    this.renderer.renderInto(
      ctx,
      {
        x: options?.x ?? 0,
        y: options?.y ?? 0,
        width: options?.width ?? this.canvas.width,
        height: options?.height ?? this.canvas.height,
      },
      this.mobjects,
      this.theme,
      this.camera,
      this.cssWidth,
      this.cssHeight,
    );
  }

  /**
   * 同时播放一组动画,时长取其中最长的 runTime,全部播完后 resolve。
   * 每个动画到了自己的 runTime 就单独收尾,不会被同批更长的动画拖着逐帧重复插值。
   * 某个 begin() 抛错时:已开始的先收尾,返回的 Promise 以该错误 reject。
   * begin() 在调用时同步执行(初始画面立即呈现),拿到的 PlayContext 能查对象的世界变换与样式。
   */
  play(...playables: Playable[]): Promise<void> {
    if (this.disposed || playables.length === 0) {
      return Promise.resolve();
    }
    const begun: Playable[] = [];
    try {
      for (const playable of playables) {
        playable.begin(this.playContext);
        begun.push(playable);
      }
    } catch (e) {
      for (const p of begun) {
        try {
          p.finish();
        } catch {
          // 收尾失败不再掩盖真正的错误。
        }
      }
      this.render();
      return Promise.reject(e);
    }
    // 非有限/非正时长按「立即完成」:单个 NaN 不能把整批拖到终态。
    const runTimes = playables.map((p) =>
      Number.isFinite(p.runTime) && p.runTime > 0 ? p.runTime : 0,
    );
    const total = runTimes.reduce((a, b) => Math.max(a, b), 0);
    const finished = playables.map(() => false);
    const finishOne = (i: number): void => {
      const p = playables[i];
      if (p && !finished[i]) {
        finished[i] = true;
        p.finish();
      }
    };
    this.render();
    const settle = (): void => {
      if (this.disposed) {
        return;
      }
      playables.forEach((_, i) => finishOne(i));
      this.render();
    };
    const run = (): Promise<void> => {
      if (this.disposed) {
        return Promise.resolve();
      }
      if (total <= 0) {
        settle();
        return Promise.resolve();
      }
      return this.pump
        .animateFor(total, (elapsed) => {
          for (let i = 0; i < playables.length; i++) {
            const p = playables[i];
            const runTime = runTimes[i] ?? 0;
            if (!p || finished[i]) {
              continue;
            }
            if (runTime <= 0 || elapsed >= runTime) {
              finishOne(i);
            } else {
              p.interpolate(p.rateFunc(elapsed / runTime));
            }
          }
        })
        .then(settle);
    };
    return run();
  }

  /**
   * 保持场景 alive 若干秒:updater 照跑、每帧重绘,只是没有新动画。
   * seconds 为 Infinity 时一直等到 dispose(常驻 updater 的场景可以这么写);NaN/负数按 0。
   */
  wait(seconds: number): Promise<void> {
    const s =
      seconds === Infinity ? Infinity : Number.isFinite(seconds) ? Math.max(0, seconds) : 0;
    if (this.disposed || s <= 0) {
      return Promise.resolve();
    }
    return this.pump.animateFor(s, () => undefined);
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    // 先放行挂起的 play/wait:上层 async 时间线(以及它的清理代码)不能永远悬着。
    this.pump.dispose();
    this.pointer.dispose();
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.stopWatchingPixelRatio?.();
    this.stopWatchingPixelRatio = null;
    for (const unsubscribe of this.unsubscribers) {
      unsubscribe();
    }
    this.unsubscribers.length = 0;
    this.mobjects.length = 0;
    this.updaters.length = 0;
    this.lastFit = null;
  }

  /** begin 用的场景信息:对象在场景图里的世界变换、所在位置解析出的样式。 */
  private readonly playContext: PlayContext = {
    worldMatrix: (m) => this.locate(m)?.matrix ?? null,
    styleOf: (m) => m.getStyle(this.theme, this.locate(m)?.inherited),
  };

  /** 沿场景图找到对象第一次出现的位置:组合祖先与它自己的变换,累积容器传下来的样式。 */
  private locate(target: MObject): { matrix: Affine; inherited: Readonly<StyleOverride> } | null {
    const visiting = new Set<MObject>();
    const visit = (
      node: MObject,
      parent: Affine,
      inherited: Readonly<StyleOverride>,
    ): { matrix: Affine; inherited: Readonly<StyleOverride> } | null => {
      if (visiting.has(node)) {
        return null;
      }
      const here = multiplyAffine(
        parent,
        similarityAffine(node.position.x, node.position.y, node.scale, node.rotation),
      );
      if (node === target) {
        return { matrix: here, inherited };
      }
      const children = node.getChildren();
      if (children.length === 0) {
        return null;
      }
      visiting.add(node);
      const childInherited = node.childInheritedStyle(inherited);
      for (const child of children) {
        const hit = visit(child, here, childInherited);
        if (hit) {
          return hit;
        }
      }
      visiting.delete(node);
      return null;
    };
    for (const root of this.mobjects) {
      const hit = visit(root, [1, 0, 0, 1, 0, 0], NO_STYLE);
      if (hit) {
        return hit;
      }
    }
    return null;
  }

  private worldBoundsOf(objects: readonly MObject[]): WorldBounds | null {
    return worldBoundsInScene(this.mobjects, objects, this.measureContext());
  }

  private applyLastFit(): void {
    const f = this.lastFit;
    if (!f || !usableViewport(this.getViewportSize())) {
      return;
    }
    this.fitPending = false;
    this.camera.setView(this.computeFitView(f.bounds, f.pad));
    f.view = this.camera.getView();
  }

  /**
   * 字体加载完成:同样的内容量出来的尺寸可能变了。一次性排版的容器重排,
   * 按对象取的景按新包围盒重取,再补画一帧。都只在「排好/取好之后没被动过」时才重算,
   * 不和用户拖拽、程序化运镜抢。
   */
  private measurementsChanged(): void {
    if (this.disposed) {
      return;
    }
    // 先判定能不能重取景(镜头与目标对象自取景后都没被动过),再重排:
    // 重排本身挪动的对象属于这次字体变化,重取景要把它算进去。
    const f = this.lastFit;
    const refit =
      f?.objects !== undefined &&
      this.fitMoves === 0 &&
      this.allInScene(f.objects) &&
      (!f.view || sameView(this.camera.getView(), f.view)) &&
      this.samePoints(this.objectCenters(f.objects), f.centers);
    for (const m of [...this.mobjects]) {
      try {
        m.onMeasurementsChanged();
      } catch (e) {
        console.error('[Scene] 字体就绪后重排抛错', e);
      }
    }
    if (refit && f?.objects) {
      const b = this.worldBoundsOf(f.objects);
      if (b && finiteBounds(b)) {
        f.bounds = b;
        if (usableViewport(this.getViewportSize())) {
          this.applyLastFit();
        } else {
          this.fitPending = true;
        }
      }
    }
    this.pump.requestRender();
  }

  /** 各对象世界包围盒的中心;测不出来的记 NaN(比较时一律当作「动过」)。 */
  private objectCenters(objects: readonly MObject[]): Point[] {
    return objects.map((o) => {
      const b = this.worldBoundsOf([o]);
      return b && finiteBounds(b)
        ? { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 }
        : { x: Number.NaN, y: Number.NaN };
    });
  }

  private samePoints(a: readonly Point[], b: readonly Point[] | undefined): boolean {
    if (!b || a.length !== b.length) {
      return false;
    }
    return a.every((p, i) => {
      const q = b[i];
      const eps = (v: number): number => 1e-9 * Math.max(1, Math.abs(v));
      return (
        q !== undefined &&
        Math.abs(p.x - q.x) <= eps(q.x) &&
        Math.abs(p.y - q.y) <= eps(q.y)
      );
    });
  }

  /** 这些对象是否都还在场景图里。取景目标被移走后,字体就绪时不再按它们重取景。 */
  private allInScene(objects: readonly MObject[]): boolean {
    const wanted = new Set(objects);
    const seen = new Set<MObject>();
    const stack = [...this.mobjects];
    while (stack.length > 0 && wanted.size > 0) {
      const node = stack.pop();
      if (!node || seen.has(node)) {
        continue;
      }
      seen.add(node);
      wanted.delete(node);
      stack.push(...node.getChildren());
    }
    return wanted.size === 0;
  }

  /**
   * 像素比变了(窗口拖到另一块屏、浏览器缩放)而 css 尺寸没变时 ResizeObserver 不会触发,
   * 静态场景会一直按旧像素比发糊:用 resolution 媒体查询盯住它,变了就重设分辨率重画。
   */
  private watchPixelRatio(): void {
    if (typeof matchMedia !== 'function' || this.disposed) {
      return;
    }
    const query = matchMedia(`(resolution: ${this.pixelRatio}dppx)`);
    const onChange = (): void => {
      query.removeEventListener('change', onChange);
      this.stopWatchingPixelRatio = null;
      if (this.disposed) {
        return;
      }
      if (this.syncViewport()) {
        this.draw();
      }
      this.watchPixelRatio();
    };
    query.addEventListener('change', onChange);
    this.stopWatchingPixelRatio = () => query.removeEventListener('change', onChange);
  }

  /** 快照迭代:updater 内部自注销不会漏跑后一个;单个抛错只掐掉它自己。 */
  private runUpdaters(dt: number): boolean {
    for (const updater of [...this.updaters]) {
      try {
        updater(this, dt);
      } catch (e) {
        console.error('[Scene] updater 抛错,已移除', e);
        this.removeUpdater(updater);
      }
    }
    // updater 里可能直接把场景 dispose 掉,这之后不能再画。
    return !this.disposed;
  }

  private draw(): void {
    if (this.disposed || this.dryRun) {
      return;
    }
    // 没有 ResizeObserver(node 测试、老浏览器)时每帧兜底同步尺寸;
    // 有的话只在像素比变了(窗口拖到另一块屏)时才读布局。固定视口不读 DOM。
    if (!this.fixedViewport && (!this.resizeObserver || currentPixelRatio() !== this.pixelRatio)) {
      this.syncViewport();
    }
    this.renderer.render(
      this.mobjects,
      this.theme,
      this.camera,
      this.cssWidth,
      this.cssHeight,
      this.pixelRatio,
    );
  }

  /** 读画布 css 尺寸与像素比(固定视口时用给定值),同步 backing store。返回是否有变化。 */
  private syncViewport(): boolean {
    const fixed = this.fixedViewport;
    const w = fixed ? fixed.width : this.canvas.clientWidth;
    const h = fixed ? fixed.height : this.canvas.clientHeight;
    const dpr = fixed ? fixed.pixelRatio : currentPixelRatio();
    const changed = w !== this.cssWidth || h !== this.cssHeight || dpr !== this.pixelRatio;
    this.cssWidth = w;
    this.cssHeight = h;
    this.pixelRatio = dpr;
    this.renderer.setPixelSize(w * dpr, h * dpr);
    // playFit 运镜途中不落机位:它的目标每帧按新视口重算,会自己落到取景位。
    if (changed && this.fitPending && this.fitMoves === 0) {
      this.applyLastFit();
    }
    return changed;
  }
}
