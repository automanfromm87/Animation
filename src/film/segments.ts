import { Create, FadeIn, Label, Line, Scene, Tex, lightTheme } from '../engine';
import type { Camera, MObject, Playable } from '../engine';
import type { Segment, SegmentContext, SegmentHandle, Subtitle } from './types';

/**
 * 分段被取消(跳转/销毁)后,env.play / env.wait 抛出的私有哨兵。
 * directedSegment / runCard 会吞掉它,所以内容脚本不必在每个 await 之后写 `if (isCancelled()) return`。
 * 刻意不导出:外部代码不该捕获它,也不该自己抛。
 */
class SegmentCancelled extends Error {
  constructor() {
    super('segment cancelled');
    this.name = 'SegmentCancelled';
  }
}

/**
 * Scene -> SegmentHandle 的统一适配。
 * resize 收到新的上下文时同步更新安全区(字幕字号随画布宽度变,安全区也要跟着变),
 * 再重设分辨率并按上次 fit 重取景(一次画完,不画两遍)。
 */
export function sceneSegmentHandle(
  scene: Scene,
  done: Promise<void>,
  onDispose?: () => void,
): SegmentHandle {
  return {
    done,
    setDryRun: (dry: boolean) => scene.setDryRun(dry),
    render: () => scene.render(),
    dispose: () => {
      onDispose?.();
      scene.dispose();
    },
    resize: (context?: SegmentContext) => {
      if (context) {
        scene.clearSafeArea();
        scene.setSafeArea(context.safeArea ?? {});
      }
      scene.resizeAndRefit();
    },
    getElapsed: () => scene.getElapsed(),
    setPaused: (value: boolean) => scene.setPaused(value),
  };
}

/**
 * 影片分段的标准 Scene:浅色主题、锁定手动交互、套上字幕安全区,用播放器的帧时钟;
 * 离线导出时还带固定视口(离屏画布没有 DOM 尺寸可读)。
 */
function filmScene(canvas: HTMLCanvasElement, context?: SegmentContext): Scene {
  const scene = new Scene(canvas, {
    theme: lightTheme,
    ...(context?.clock ? { clock: context.clock } : {}),
    ...(context?.viewport ? { viewport: context.viewport } : {}),
  });
  scene.setInteractionEnabled(false);
  scene.setSafeArea(context?.safeArea ?? {});
  return scene;
}

export interface SegmentEnv {
  scene: Scene;
  /** @deprecated 等同 scene.getCamera()。 */
  camera: Camera;
  /** 分段是否已被取消(跳转/销毁)。用 env.play / env.wait 时通常不需要手动判断。 */
  isCancelled(): boolean;
  /** 同 scene.play;分段被取消后抛出取消哨兵,后面的脚本不再执行。 */
  play(...playables: Playable[]): Promise<void>;
  /** 同 scene.wait;取消后同样抛哨兵。 */
  wait(seconds: number): Promise<void>;
  /** 取消检查点:已取消就抛哨兵。用在不经过 play/wait 的长段同步搭建之后。 */
  checkpoint(): void;
}

export interface DirectedSegmentOptions {
  /** 稳定 id(配音时间表按它对应;不写时按分段名)。 */
  id?: string;
  marker?: 'chapter' | 'segment';
  chapter?: string;
}

/**
 * 挂载一个导演式脚本:建好标准 Scene 与 env,跑 direct,取消(跳转/销毁)时吞掉哨兵。
 * directedSegment 与 timedSegment 共用;timedSegment 在 env 上扩展提示点再交给脚本。
 */
export function playDirected(
  canvas: HTMLCanvasElement,
  context: SegmentContext | undefined,
  direct: (env: SegmentEnv) => Promise<void>,
): SegmentHandle {
  const scene = filmScene(canvas, context);
  let cancelled = false;
  const guard = (): void => {
    if (cancelled) {
      throw new SegmentCancelled();
    }
  };
  const env: SegmentEnv = {
    scene,
    camera: scene.getCamera(),
    isCancelled: () => cancelled,
    play: async (...playables) => {
      guard();
      await scene.play(...playables);
      guard();
    },
    wait: async (seconds) => {
      guard();
      await scene.wait(seconds);
      guard();
    },
    checkpoint: guard,
  };
  const done = (async (): Promise<void> => {
    try {
      await direct(env);
    } catch (e) {
      if (!(e instanceof SegmentCancelled)) {
        throw e;
      }
    }
  })();
  return sceneSegmentHandle(scene, done, () => {
    cancelled = true;
  });
}

/**
 * directedSegment:导演式分段。direct 里布景 + 写时间线,播完 resolve 即结束。
 * 模板负责 Scene 创建/安全区/锁定交互/取消/dispose 收尾。
 * 推荐在脚本里用 env.play / env.wait:取消时它们直接抛哨兵结束脚本。
 */
export function directedSegment(
  name: string,
  duration: number,
  subtitles: Subtitle[],
  direct: (env: SegmentEnv) => Promise<void>,
  options?: DirectedSegmentOptions,
): Segment {
  return {
    name,
    duration,
    subtitles,
    ...(options?.id !== undefined ? { id: options.id } : {}),
    ...(options?.marker !== undefined ? { marker: options.marker } : {}),
    ...(options?.chapter !== undefined ? { chapter: options.chapter } : {}),
    play(canvas, context?) {
      return playDirected(canvas, context, direct);
    },
  };
}

export interface CardBuild {
  /** 开场动画(同播)。FadeIn 会自己把对象从 0 抬到目标不透明度。 */
  show: Playable[];
  holdSeconds: number;
}

/**
 * 卡片段模板:一个 Scene,播一组开场动画,停留,结束。
 * build 抛错时先释放 Scene 再抛:Scene 构造时已经挂上了画布监听,不释放就泄漏。
 */
export function runCard(
  canvas: HTMLCanvasElement,
  build: (scene: Scene) => CardBuild,
  context?: SegmentContext,
): SegmentHandle {
  const scene = filmScene(canvas, context);
  let built: CardBuild;
  try {
    built = build(scene);
  } catch (e) {
    scene.dispose();
    throw e;
  }
  const { show, holdSeconds } = built;
  let cancelled = false;
  const done = (async (): Promise<void> => {
    await scene.play(...show);
    if (cancelled) {
      return;
    }
    await scene.wait(holdSeconds);
  })();
  return sceneSegmentHandle(scene, done, () => {
    cancelled = true;
  });
}

/** 卡片开场动画的时长(秒)。卡片段的时长 = 它 + holdSeconds。 */
export const CARD_INTRO_SECONDS = 1;

export interface CardSegmentOptions {
  name: string;
  /** 第一行大标题(文字)。与 titleTex 二选一。 */
  title?: string;
  /** 第一行大标题(公式,TeX)。与 title 二选一。 */
  titleTex?: string;
  /** 标题字号,默认 56。 */
  titleSize?: number;
  /** 三行的纵向位置(世界单位):标题默认 -44,横线默认 4,第二行默认 48。 */
  titleY?: number;
  lineY?: number;
  headingY?: number;
  /** 第二行文字。与 headingTex 二选一。 */
  heading?: string;
  /** 第二行公式(TeX)。与 heading 二选一。 */
  headingTex?: string;
  /** 第二行字号,默认文字 24、公式 36。 */
  headingSize?: number;
  /** 字幕解说(整段显示)。 */
  narration: string;
  /** 开场动画之后的停留时长(秒)。 */
  holdSeconds: number;
  /** 标题与第二行之间横线的半长(世界单位),默认 100。 */
  lineHalfWidth?: number;
  marker?: 'chapter' | 'segment';
  /** 章节短标题(进度条上显示)。 */
  chapter?: string;
}

/**
 * 标题卡 / 章节卡 / 片尾卡:大标题 + 横线 + 第二行,开场 1 秒同时淡入/画线,然后停留。
 * 时长由脚本推导(CARD_INTRO_SECONDS + holdSeconds),不再手写一个和实际时间线对不上的数字。
 */
export function cardSegment(o: CardSegmentOptions): Segment {
  const duration = CARD_INTRO_SECONDS + o.holdSeconds;
  return {
    name: o.name,
    duration,
    subtitles: [{ start: 0.3, end: duration, text: o.narration }],
    ...(o.marker !== undefined ? { marker: o.marker } : {}),
    ...(o.chapter !== undefined ? { chapter: o.chapter } : {}),
    play(canvas, context?) {
      return runCard(
        canvas,
        (scene) => {
          if ((o.title === undefined) === (o.titleTex === undefined)) {
            throw new Error(`卡片「${o.name}」需要 title 与 titleTex 二选一`);
          }
          const title = o.titleTex !== undefined ? new Tex(o.titleTex) : new Label(o.title ?? '');
          title.setStyle({ fontSize: o.titleSize ?? 56 });
          title.moveTo({ x: 0, y: o.titleY ?? -44 });
          const half = o.lineHalfWidth ?? 100;
          const lineY = o.lineY ?? 4;
          const line = new Line({ x: -half, y: lineY }, { x: half, y: lineY });
          const parts: MObject[] = [title, line];
          const show: Playable[] = [
            new FadeIn(title, { runTime: CARD_INTRO_SECONDS }),
            new Create(line, { runTime: CARD_INTRO_SECONDS }),
          ];
          const second =
            o.headingTex !== undefined
              ? new Tex(o.headingTex)
              : o.heading !== undefined
                ? new Label(o.heading)
                : null;
          if (second) {
            second.setStyle({
              fontSize: o.headingSize ?? (o.headingTex !== undefined ? 36 : 24),
            });
            second.moveTo({ x: 0, y: o.headingY ?? 48 });
            parts.push(second);
            show.push(new FadeIn(second, { runTime: CARD_INTRO_SECONDS }));
          }
          scene.add(...parts);
          scene.fitObjects(parts, 40);
          return { show, holdSeconds: o.holdSeconds };
        },
        context,
      );
    },
  };
}
