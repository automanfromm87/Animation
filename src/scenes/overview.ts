import {
  CameraMove,
  Circle,
  Label,
  Mesh3D,
  MorphTo,
  Orbit3D,
  ParamMorph,
  Projection3D,
  RotateTo,
  ScaleTo,
  Scene,
  Transform,
  TweenValue,
  ValueTracker,
  Write,
  createCameraFollow,
  lightTheme,
} from '../engine';
import { createGallery, layoutGallery } from './gallery';
import type { Gallery } from './gallery';
import type { SceneHandle } from './types';
import { TURNS, buildUnitParts, drawUnitAt } from './unitCircle';

const UNIT_SWEEP_SECONDS = 10;
const UNIT_HOLD_SECONDS = 1.2;

export interface OverviewOptions {
  /** 用户偏好减少动态效果:跳过开场运镜巡游,相机一开始就交给手动操作。 */
  reducedMotion?: boolean;
}

/**
 * 总览页:世界坐标固定布局,相机框住全部内容。
 * 顶部单位圆生正弦(独立时钟持续扫描),
 * 下部画廊(脉动/旋转/曲面形变/形状变形与书写循环)。拖拽/方向键平移,滚轮/加减号缩放。
 *
 * 画廊循环与开场运镜并发:Scene 只有一条帧泵,并发时间线不会重复渲染。
 */
export function runOverviewScene(
  canvas: HTMLCanvasElement,
  options?: OverviewOptions,
): SceneHandle {
  const scene = new Scene(canvas, { theme: lightTheme });
  const { items, sphere, genus, homotopy, square, formula } = createGallery();
  const captions = items.map((item) => {
    const caption = new Label(item.name);
    caption.setStyle({ fontSize: 13 });
    return caption;
  });
  const gallery: Gallery = { items, captions };
  const shapes = items.map((item) => item.shape);
  // 所有立体共用一套视角:旋转那一幕用一个 Orbit3D 带动整组,
  // 新增一个立体对象也不用再记得往动画数组里补一条。
  const view3d = new Projection3D();
  const flatShapes = shapes.filter((s) => !(s instanceof Mesh3D));
  for (const s of shapes) {
    if (s instanceof Mesh3D) {
      s.setProjection(view3d);
    }
  }

  const tracker = new ValueTracker(0);
  const unit = buildUnitParts(scene);
  const gb = layoutGallery(gallery);
  // 与方块来回变形的圆:摆在方块的格子里,平时藏着(Transform 开始时换上、结束时交还)。
  const circle = new Circle(38);
  circle.opacity = 0;
  circle.moveTo(square.position);
  scene.add(...shapes, ...captions, circle);
  const ub = unit.bounds;
  const worldBox = {
    minX: Math.min(gb.minX, ub.minX),
    minY: Math.min(gb.minY, ub.minY),
    maxX: Math.max(gb.maxX, ub.maxX),
    maxY: Math.max(gb.maxY, ub.maxY),
  };
  scene.fitBounds(worldBox, 30);

  let unitTh = 0;
  let holdLeft = 0;
  scene.addUpdater((_, dt): void => {
    if (holdLeft > 0) {
      holdLeft -= dt;
      if (holdLeft <= 0) {
        unitTh = 0;
        drawUnitAt(unit, 0);
      }
      return;
    }
    unitTh += (dt * TURNS) / UNIT_SWEEP_SECONDS;
    if (unitTh >= TURNS) {
      unitTh = TURNS;
      holdLeft = UNIT_HOLD_SECONDS;
    }
    drawUnitAt(unit, unitTh);
  });

  // 同伦曲面跟着 tracker 重采样(参数不变时 resample 本身是空操作)。
  const removeHomotopy = scene.addUpdater((): void => {
    homotopy.resample([tracker.getValue()]);
  });

  const sphereBase = sphere.vertices.map((v) => ({ ...v }));
  const cucumber = sphereBase.map((v) => ({ x: v.x * 0.75, y: v.y * 1.5, z: v.z * 0.75 }));

  let cancelled = false;
  const loop = async (): Promise<void> => {
    while (!cancelled) {
      await scene.play(...shapes.map((s) => new ScaleTo(s, 1.2, { runTime: 1 })));
      await scene.wait(0.3);
      await scene.play(...shapes.map((s) => new ScaleTo(s, 1, { runTime: 1 })));
      await scene.wait(0.3);
      await scene.play(
        new Orbit3D(view3d, 1, { runTime: 2.4 }),
        ...flatShapes.map(
          (s) => new RotateTo(s, s.rotation + Math.PI * 2, { runTime: 2.2 }),
        ),
      );
      await scene.wait(0.3);
      await scene.play(
        new ParamMorph(genus, [1], { runTime: 4 }),
        new TweenValue(tracker, 1, { runTime: 4 }),
        new MorphTo(sphere, cucumber, { runTime: 4 }),
      );
      await scene.wait(0.5);
      await scene.play(
        new ParamMorph(genus, [0], { runTime: 4 }),
        new TweenValue(tracker, 0, { runTime: 4 }),
        new MorphTo(sphere, sphereBase, { runTime: 4 }),
      );
      await scene.wait(0.5);
      // 形状变形:方块变成圆再变回来;变回来的同时把公式重新写一遍。
      await scene.play(new Transform(square, circle, { runTime: 1.2 }));
      await scene.wait(0.4);
      await scene.play(
        new Transform(circle, square, { runTime: 1.2 }),
        new Write(formula, { runTime: 2 }),
      );
      await scene.wait(0.8);
    }
  };
  // dispose 之后 play/wait 立即 resolve,循环靠 cancelled 退出。
  void loop().catch((e: unknown) => {
    if (!cancelled) {
      console.error('[overview] 画廊循环出错', e);
    }
  });

  // 开场运镜(一次性):全景停留 -> 推近到单位圆 -> 跟随动点扫一圈 -> 拉回全景。
  // 巡游期间锁定手动交互(否则拖拽/缩放会被每帧改写的机位抢回去),结束后交还给用户;
  // 暂停期间巡游不推进,交互临时放开,恢复播放时再锁上。
  const camera = scene.getCamera();
  let touring = false;
  const tour = async (): Promise<void> => {
    touring = true;
    scene.setInteractionEnabled(scene.isPaused());
    try {
      await scene.wait(1);
      if (cancelled) {
        return;
      }
      // 走 Scene 的取景 API:它尊重安全区。
      const close = scene.computeFitView(
        {
          minX: unit.cx - 150,
          minY: unit.cy - 150,
          maxX: unit.cx + 150,
          maxY: unit.cy + 150,
        },
        20,
      );
      await scene.play(
        new CameraMove(camera, { x: unit.cx, y: unit.cy, zoom: close.zoom }, { runTime: 2 }),
      );
      if (cancelled) {
        return;
      }
      unitTh = 0;
      holdLeft = 0;
      drawUnitAt(unit, 0);
      const stopFollow = scene.addUpdater(
        createCameraFollow(camera, unit.dot, {
          damping: 5,
          centerOffset: scene.safeAreaCenterOffset,
        }),
      );
      await scene.wait(UNIT_SWEEP_SECONDS + UNIT_HOLD_SECONDS);
      stopFollow();
      if (cancelled) {
        return;
      }
      // 目标每帧按当前视口重算:运镜途中改了画幅,也会落在新视口的全景机位上。
      await scene.play(
        new CameraMove(camera, () => scene.computeFitView(worldBox, 30), { runTime: 2 }),
      );
    } finally {
      touring = false;
      if (!cancelled) {
        scene.setInteractionEnabled(true);
      }
    }
  };
  if (!options?.reducedMotion) {
    void tour().catch((e: unknown) => {
      if (!cancelled) {
        console.error('[overview] 开场运镜出错', e);
      }
    });
  }

  return {
    dispose: () => {
      cancelled = true;
      removeHomotopy();
      scene.dispose();
    },
    // 无限画布:尺寸变化只改视口,世界布局与机位都不动(巡游的收尾运镜自己会按新视口取景)。
    resize: () => scene.resize(),
    setPaused: (value: boolean) => {
      scene.setPaused(value);
      if (touring) {
        scene.setInteractionEnabled(value);
      }
    },
  };
}
