import {
  Create,
  FadeIn,
  FadeOut,
  FadeTransform,
  Group,
  Label,
  Layout,
  Line,
  Polygon,
  Rectangle,
  Scene,
  Tex,
  lightTheme,
} from '../engine';
import type { FrameClock, MObject, Point, SafeArea, SceneViewport } from '../engine';
import type { RecordableSceneHandle, SceneContext } from './types';

/** 闭合四边形:一个图元(Create 沿周长描出来,需要时也能填充)。 */
function quad(p1: Point, p2: Point, p3: Point, p4: Point): Polygon {
  return new Polygon([p1, p2, p3, p4]);
}

/** 收集所有叶子(重置透明度用)。 */
function leavesOf(root: MObject): MObject[] {
  const children = root.getChildren();
  if (children.length === 0) {
    return [root];
  }
  return children.flatMap(leavesOf);
}

export interface PythagorasOptions {
  /** 只播一遍就结束(影片分段用),默认 false 无限循环。 */
  once?: boolean;
  /** 自然播完回调;dispose 取消不调。 */
  onDone?: () => void;
  /** 时间线出错回调(dispose 之后的错误不报)。影片分段靠它让 done 落定,而不是永远挂着。 */
  onError?: (error: unknown) => void;
  /** 字幕安全区(影片播放器传入)。 */
  safeArea?: SafeArea;
  /** 帧时钟(影片播放器传入,缺省浏览器时钟)。 */
  clock?: FrameClock;
  /** 固定视口(离线导出在离屏画布上渲染时传入)。 */
  viewport?: SceneViewport;
}

/**
 * 勾股定理(3-4-5):标题 -> 直角三角形(画出来) -> 三边正方形(画出来)
 * -> 数字验证(公式变换) -> 全景。约 22 秒一遍,默认自动循环。
 * 播片期间锁定手动交互。每个镜头都用 playFit 取景:画幅变了,
 * 运镜途中的目标与停住的机位都会按新视口重新框住内容。
 */
export function runPythagorasScene(
  canvas: HTMLCanvasElement,
  options?: PythagorasOptions,
): RecordableSceneHandle {
  const scene = new Scene(canvas, {
    theme: lightTheme,
    ...(options?.clock ? { clock: options.clock } : {}),
    ...(options?.viewport ? { viewport: options.viewport } : {}),
  });
  scene.setInteractionEnabled(false);
  scene.setSafeArea(options?.safeArea ?? {});

  // 直角在 A,两条直角边 120(a) 与 160(b),斜边 200(c)。
  const A = { x: 0, y: 0 };
  const B = { x: 160, y: 0 };
  const C = { x: 0, y: -120 };
  // 斜边正方形的外法向:必须垂直于 BC=(-160,-120) 且模长等于边长 200,
  // 方向背离 A。(120,-160)·(-160,-120) = 0 ✓,|(120,-160)| = 200 ✓。
  const n = { x: 120, y: -160 };
  const Bp = { x: B.x + n.x, y: B.y + n.y };
  const Cp = { x: C.x + n.x, y: C.y + n.y };

  // 标题:Layout 横排 [中文名, 公式]。
  const titleFont = { fontSize: 30, fontFamily: lightTheme.fontFamily };
  const titleName = new Label('勾股定理');
  titleName.setStyle({ fontSize: 30 });
  const titleFormula = new Tex('a^2 + b^2 = c^2');
  titleFormula.setStyle({ fontSize: 30 });
  const titleW =
    titleName.getBox(titleFont).size.w +
    titleFormula.getBox(titleFont).size.w +
    16 +
    16;
  const title = new Layout(titleW, 52, {
    direction: 'row',
    gap: 16,
    padding: 8,
    justify: 'center',
    align: 'center',
  });
  title.place(titleName);
  title.place(titleFormula);
  title.layout(titleFont);
  // 摆在 c² 正方形(最高点 y = -280)之上,不压图。
  title.moveTo({ x: 60, y: -330 });

  // 三角形三边(生长) + 直角标记与边名(淡入)。
  const triGroup = new Group();
  triGroup.add(new Line(A, B), new Line(B, C), new Line(C, A));
  const corner = new Rectangle(14, 14);
  corner.moveTo({ x: 7, y: -7 });
  const labelA = new Tex('a');
  labelA.setStyle({ fontSize: 24 });
  labelA.moveTo({ x: 16, y: -60 });
  const labelB = new Tex('b');
  labelB.setStyle({ fontSize: 24 });
  labelB.moveTo({ x: 80, y: -16 });
  const labelC = new Tex('c');
  labelC.setStyle({ fontSize: 24 });
  labelC.moveTo({ x: 71, y: -53 });
  const triRest = new Group();
  triRest.add(corner, labelA, labelB, labelC);
  const tri = new Group();
  tri.add(triGroup, triRest);

  // 三个正方形 + 面积标注。
  const sqB = quad(A, B, { x: 160, y: 160 }, { x: 0, y: 160 });
  const sqBLabel = new Tex('b^2');
  sqBLabel.setStyle({ fontSize: 26 });
  sqBLabel.moveTo({ x: 80, y: 80 });
  const sqA = quad(A, C, { x: -120, y: -120 }, { x: -120, y: 0 });
  const sqALabel = new Tex('a^2');
  sqALabel.setStyle({ fontSize: 26 });
  sqALabel.moveTo({ x: -60, y: -60 });
  const sqC = quad(B, C, Cp, Bp);
  const sqCLabel = new Tex('c^2');
  sqCLabel.setStyle({ fontSize: 26 });
  // 新正方形 B C Cp Bp 的中心。
  sqCLabel.moveTo({ x: 140, y: -140 });

  // 数字验证。
  const equation = new Tex('3^2 + 4^2 = 5^2');
  equation.setStyle({ fontSize: 34 });
  equation.moveTo({ x: 60, y: 215 });

  const film = new Group();
  film.add(title, tri, sqB, sqBLabel, sqA, sqALabel, sqC, sqCLabel, equation);
  scene.add(film);

  // 每个镜头的取景对象:机位从包围盒推导,内容再多也不会出画。
  const triRoots: MObject[] = [tri];
  const sqRoots: MObject[] = [tri, sqB, sqBLabel, sqA, sqALabel, sqC, sqCLabel];
  const eqRoots: MObject[] = [sqB, sqBLabel, equation];
  const allRoots: MObject[] = [film];
  const resetLeaves = leavesOf(film);
  for (const l of resetLeaves) {
    l.opacity = 0;
  }

  scene.fitObjects(allRoots, 20);
  scene.render();

  /** 显示(Create 不碰 opacity,生长类图元必须先抬回不透明)。 */
  const reveal = (...roots: MObject[]): void => {
    for (const r of roots) {
      r.opacity = 1;
      for (const l of leavesOf(r)) {
        l.opacity = 1;
      }
    }
  };

  let cancelled = false;
  const maxRounds = options?.once ? 1 : Number.POSITIVE_INFINITY;
  const loop = async (): Promise<void> => {
    for (let round = 0; round < maxRounds && !cancelled; round++) {
      scene.fitObjects(allRoots, 20);
      film.opacity = 1;
      for (const l of resetLeaves) {
        l.opacity = 0;
      }
      scene.render();
      reveal(title);
      await scene.play(new FadeIn(title, { runTime: 1.2 }));
      if (cancelled) {
        return;
      }
      await scene.wait(0.4);
      reveal(tri);
      await Promise.all([
        scene.playFit(triRoots, { pad: 20, runTime: 2.2 }),
        scene.play(
          new Create(triGroup, { runTime: 2 }),
          new FadeIn(triRest, { runTime: 1.5 }),
        ),
      ]);
      if (cancelled) {
        return;
      }
      await scene.wait(0.6);
      // 先拉到正方形全景,再逐个画出来。
      reveal(sqB, sqBLabel);
      await Promise.all([
        scene.playFit(sqRoots, { pad: 20, runTime: 2 }),
        scene.play(
          new Create(sqB, { runTime: 1.5 }),
          new FadeIn(sqBLabel, { runTime: 1.2 }),
        ),
      ]);
      if (cancelled) {
        return;
      }
      await scene.wait(0.3);
      for (const [sq, label] of [
        [sqA, sqALabel],
        [sqC, sqCLabel],
      ] as const) {
        reveal(sq, label);
        await scene.play(
          new Create(sq, { runTime: 1.5 }),
          new FadeIn(label, { runTime: 1.2 }),
        );
        if (cancelled) {
          return;
        }
        await scene.wait(0.3);
      }
      await scene.wait(0.5);
      reveal(equation);
      await Promise.all([
        scene.playFit(eqRoots, { pad: 20, runTime: 2 }),
        scene.play(new FadeIn(equation, { runTime: 1.5 })),
      ]);
      if (cancelled) {
        return;
      }
      await scene.wait(1);
      await scene.play(
        new FadeTransform(equation, '9 + 16 = 25', { runTime: 1 }),
      );
      if (cancelled) {
        return;
      }
      await scene.wait(1.5);
      await scene.playFit(allRoots, { pad: 20, runTime: 2.2 });
      if (cancelled) {
        return;
      }
      await scene.wait(2);
      await scene.play(new FadeOut(film, { runTime: 1 }));
      if (cancelled) {
        return;
      }
      equation.setTex('3^2 + 4^2 = 5^2');
    }
    if (!cancelled) {
      options?.onDone?.();
    }
  };
  void loop().catch((e: unknown) => {
    if (cancelled) {
      return;
    }
    if (options?.onError) {
      options.onError(e);
    } else {
      console.error('[pythagoras] 时间线出错', e);
    }
  });

  return {
    dispose: () => {
      cancelled = true;
      scene.dispose();
    },
    // 停住时按当前镜头重新取景;运镜途中由运镜自己按新视口改目标。
    // 影片播放器会带上按新尺寸重算的上下文:字幕字号随画布宽度变,安全区要先跟着换。
    resize: (context?: SceneContext) => {
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
