import { ImplicitSurface, Label, ParametricSurface, Sphere, Square, Tex } from '../engine';
import { installDomStub } from '../testing/domStub';
import { equal, ok, quiet, suite, throws } from '../testing/harness';
import { createGallery, layoutGallery } from './gallery';
import { runOverviewScene } from './overview';
import { runPythagorasScene } from './pythagoras';
import { buildUnitParts, drawUnitAt, TURNS } from './unitCircle';
import { runVocabularyScene } from './vocabulary';

export default suite('场景', [
  [
    '画廊 45 件,总览要单独驱动的几件以类型化句柄给出',
    () => {
      const g = createGallery();
      equal(g.items.length, 45);
      ok(g.sphere instanceof Sphere);
      ok(g.genus instanceof ImplicitSurface);
      ok(g.homotopy instanceof ParametricSurface);
      ok(g.items.some((i) => i.shape === g.sphere));
      ok(g.items.some((i) => i.shape === g.genus));
      ok(g.items.some((i) => i.shape === g.homotopy));
      ok(g.square instanceof Square);
      ok(g.formula instanceof Tex);
      ok(g.items.some((i) => i.shape === g.square));
      ok(g.items.some((i) => i.shape === g.formula));
      // 标注图元的演示都能直接 Create。
      const annotated = ['Brace', 'Angle', 'NumberLine', 'NumberPlane', 'Riemann', 'Tangent'];
      for (const name of [...annotated, 'VectorField', 'BarChart']) {
        ok(g.items.find((i) => i.name === name)?.shape.supportsReveal, `${name} 不支持 Create`);
      }
    },
  ],
  [
    'layoutGallery:数量不一致直接报错;每件的包围盒中心落在自己格子中心',
    () => {
      const { items } = createGallery();
      throws(() => layoutGallery({ items, captions: [] }));
      const captions = items.map((i) => new Label(i.name));
      const bounds = layoutGallery({ items, captions });
      ok(bounds.maxX > bounds.minX && bounds.maxY > bounds.minY);
      for (const item of items.slice(0, 8)) {
        const box = item.shape.getBox();
        const cx = item.shape.position.x + box.center.x * item.shape.scale;
        // 格宽 190:中心坐标对 190 取模应落在半格处。
        const offset = (((cx - bounds.minX) % 190) + 190) % 190;
        ok(Math.abs(offset - 95) < 1e-6, `${item.name} 没有居中:${offset}`);
      }
    },
  ],
  [
    '单位圆读数用 Label 而不是逐帧换内容的 Tex;轨迹回扫时清空重建',
    () => {
      const dom = installDomStub();
      try {
        const scene = { add: () => undefined } as unknown as Parameters<typeof buildUnitParts>[0];
        const parts = buildUnitParts(scene);
        ok(parts.coord instanceof Label);
        ok(!parts.all.some((m) => m instanceof Tex && m === (parts.coord as unknown)));
        drawUnitAt(parts, TURNS / 2);
        const half = parts.trace.length;
        drawUnitAt(parts, TURNS / 4);
        ok(parts.trace.length < half, '回扫时轨迹没有重建');
        equal(parts.coord.text.includes('-0.00'), false);
      } finally {
        dom.restore();
      }
    },
  ],
  [
    '总览:开场巡游期间锁定手动交互,减少动态效果时跳过巡游',
    () => {
      const dom = installDomStub();
      try {
        const canvas = dom.canvas();
        const handle = runOverviewScene(canvas);
        // 巡游一开始就把 touch-action 交还给页面(交互关闭)。
        equal(canvas.style.touchAction ?? '', '');
        // 暂停时巡游不推进,交互临时放开;恢复播放时再锁上。
        handle.setPaused?.(true);
        equal(canvas.style.touchAction, 'none', '巡游途中暂停,手动交互应放开');
        handle.setPaused?.(false);
        equal(canvas.style.touchAction ?? '', '', '恢复播放后巡游继续,交互应重新锁上');
        handle.dispose();
        const calm = runOverviewScene(canvas, { reducedMotion: true });
        equal(canvas.style.touchAction, 'none', '减少动态效果时交互应一开始就开着');
        calm.dispose();
      } finally {
        dom.restore();
      }
    },
  ],
  [
    '总览画廊循环跑完一整轮(含方块 ⇄ 圆变形与公式书写)不报错',
    async () => {
      const dom = installDomStub();
      const { error } = console;
      const errors: unknown[] = [];
      console.error = (...args: unknown[]): void => {
        errors.push(args);
      };
      try {
        const handle = runOverviewScene(dom.canvas(), { reducedMotion: true });
        // 一轮约 18.7 秒(脉动、旋转、两段曲面形变、两段 Transform + Write),多跑一点进入第二轮。
        for (let i = 0; i < 20 * 20; i++) {
          dom.frame(50);
          await dom.flush();
        }
        handle.dispose();
      } finally {
        console.error = error;
        dom.restore();
      }
      equal(errors.length, 0, `循环里报错了:${String(errors[0])}`);
    },
  ],
  [
    '勾股分段:只播一遍时 onDone 恰好调用一次;dispose 之后不再回调',
    async () => {
      const dom = installDomStub();
      try {
        let done = 0;
        const handle = runPythagorasScene(dom.canvas(), {
          once: true,
          onDone: () => {
            done += 1;
          },
        });
        for (let i = 0; i < 26 * 60 && done === 0; i++) {
          dom.frame(1000 / 60);
          await dom.flush();
        }
        equal(done, 1, '一遍播完 onDone 没有恰好调用一次');
        ok(handle.getElapsed() > 20 && handle.getElapsed() < 23, `一遍时长 ${handle.getElapsed()}`);
        handle.dispose();
        let late = 0;
        await quiet(async () => {
          const again = runPythagorasScene(dom.canvas(), {
            once: true,
            onDone: () => {
              late += 1;
            },
          });
          dom.frame(16);
          await dom.flush();
          again.dispose();
          for (let i = 0; i < 60; i++) {
            dom.frame(1000 / 60);
            await dom.flush();
          }
        });
        equal(late, 0, 'dispose 之后仍然回调了 onDone');
      } finally {
        dom.restore();
      }
    },
  ],
  [
    '讲解词汇演示:一遍播完不报错、onDone 恰好一次;dispose 之后不再回调',
    async () => {
      const dom = installDomStub();
      const errors: unknown[] = [];
      const error = console.error;
      console.error = (...args: unknown[]) => {
        errors.push(args);
      };
      try {
        let done = 0;
        let failure: unknown = null;
        const handle = runVocabularyScene(dom.canvas(), {
          once: true,
          onDone: () => {
            done += 1;
          },
          onError: (e) => {
            failure = e;
          },
        });
        for (let i = 0; i < 200 * 20 && done === 0 && failure === null; i++) {
          dom.frame(50);
          await dom.flush();
        }
        if (failure) {
          throw failure;
        }
        equal(done, 1, '一遍播完 onDone 没有恰好调用一次');
        const elapsed = handle.getElapsed();
        ok(elapsed > 60 && elapsed < 150, `一遍时长 ${elapsed} 秒`);
        handle.dispose();
        let late = 0;
        const again = runVocabularyScene(dom.canvas(), {
          once: true,
          onDone: () => {
            late += 1;
          },
        });
        dom.frame(16);
        await dom.flush();
        again.dispose();
        for (let i = 0; i < 60; i++) {
          dom.frame(50);
          await dom.flush();
        }
        equal(late, 0, 'dispose 之后仍然回调了 onDone');
      } finally {
        console.error = error;
        dom.restore();
      }
      equal(errors.length, 0, `播放 / 绘制中出了错:${errors.map((e) => String(e)).join(' | ')}`);
    },
  ],
]);
