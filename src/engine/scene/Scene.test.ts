import { countOps, createStubCanvas, flushTasks, installDomStub } from '../../testing/domStub';
import type { DomStub } from '../../testing/domStub';
import { close, equal, fakeCtx, ok, quiet, suite } from '../../testing/harness';
import type { Playable } from '../animations/Animation';
import { Create, FadeIn, MoveTo } from '../animations/primitives';
import { Layout } from '../layout/Layout';
import { Group } from '../mobjects/Group';
import { MObject } from '../mobjects/MObject';
import { Circle, Rectangle } from '../mobjects/shapes';
import { Tex } from '../mobjects/tex';
import type { Box } from '../mobjects/types';
import { boxFromSize } from '../mobjects/types';
import { lightTheme } from '../theme/presets';
import { Scene } from './Scene';

/** 画了几个圆:圆按矢量路径画,每个是一条闭合路径(网格与坐标轴都是开放的直线)。 */
function circlesDrawn(ops: readonly string[]): number {
  return countOps(ops, 'closePath');
}

/**
 * 模拟用网页字体量宽度的文字(比如 Label):字体到之前宽 200,到了之后宽 400。
 * 尺寸取得够大,取景算出的缩放才不会两次都顶到相机上限(10 倍)而看不出变化。
 */
class LateFontText extends MObject {
  static arrived = false;

  override getBox(): Box {
    return boxFromSize(LateFontText.arrived ? 400 : 200, 20);
  }

  protected override drawShape(): void {
    // 只测排版与取景,不画。
  }
}

/** 装一个只有 fonts 的 document;arrive() 让文字变宽并派发 loadingdone。 */
function lateFonts(): { arrive(): void; restore(): void } {
  const g = globalThis as unknown as Record<string, unknown>;
  const had = 'document' in g;
  const saved = g['document'];
  const done: Array<(e: { fontfaces: readonly unknown[] }) => void> = [];
  LateFontText.arrived = false;
  g['document'] = {
    createElement: () => ({ getContext: () => null }),
    fonts: {
      addEventListener: (type: string, fn: (e: { fontfaces: readonly unknown[] }) => void) => {
        if (type === 'loadingdone') {
          done.push(fn);
        }
      },
    },
  };
  return {
    arrive() {
      LateFontText.arrived = true;
      for (const fn of done) {
        fn({ fontfaces: [{}] });
      }
    },
    restore() {
      LateFontText.arrived = false;
      if (had) {
        g['document'] = saved;
      } else {
        delete g['document'];
      }
    },
  };
}

/** 记录 begin/interpolate/finish 调用的 Playable。 */
function probe(runTime: number, log: string[], name: string, throwOnBegin = false): Playable {
  return {
    runTime,
    rateFunc: (t) => t,
    begin: () => {
      if (throwOnBegin) {
        throw new Error(`${name} begin 失败`);
      }
      log.push(`begin:${name}`);
    },
    interpolate: () => {
      log.push(`i:${name}`);
    },
    finish: () => {
      log.push(`finish:${name}`);
    },
  };
}

/** 每个用例独立装一套 DOM 桩,跑完还原,避免相互串。 */
async function withStub(body: (dom: DomStub) => Promise<void>): Promise<void> {
  const dom = installDomStub();
  try {
    await body(dom);
  } finally {
    dom.restore();
  }
}

export default suite('Scene 帧泵', [
  [
    'play 在 runTime 之后 resolve,终态精确',
    () =>
      withStub(async (dom) => {
        const scene = new Scene(dom.canvas(), { theme: lightTheme });
        const c = new Circle(50);
        c.opacity = 0;
        scene.add(c);
        let done = false;
        void scene.play(new FadeIn(c, { runTime: 0.1 })).then(() => {
          done = true;
        });
        for (let i = 0; i < 12; i++) {
          dom.frame(16);
        }
        await dom.flush();
        ok(done, 'play 没有 resolve');
        // FadeIn 对「预先藏起来」的对象要淡入到 1,而不是 0→0。
        equal(c.opacity, 1);
        scene.dispose();
      }),
  ],
  [
    '并发的三条时间线每帧只跑一遍 updater、只渲染一次',
    () =>
      withStub(async (dom) => {
        const canvas = dom.canvas();
        const scene = new Scene(canvas, { theme: lightTheme });
        const c = new Circle(50);
        scene.add(c);
        let updaterCalls = 0;
        scene.addUpdater(() => {
          updaterCalls += 1;
        });
        void scene.play(new MoveTo(c, { x: 10, y: 0 }, { runTime: 1 }));
        void scene.wait(1);
        void scene.play(new MoveTo(c, { x: 20, y: 0 }, { runTime: 1 }));
        // 基线放在注册之后:play() 会同步画一帧把初态显示出来,那次不计入「每帧」。
        const base = countOps(canvas.ops, 'fillRect');
        const frames = 5;
        for (let i = 0; i < frames; i++) {
          dom.frame(16);
        }
        equal(countOps(canvas.ops, 'fillRect') - base, frames, '每帧渲染次数不是 1');
        equal(updaterCalls, frames, 'updater 每帧调用次数不是 1');
        scene.dispose();
      }),
  ],
  [
    'dispose 放行所有挂起的 play/wait,之后不再绘制也不留 rAF',
    () =>
      withStub(async (dom) => {
        const canvas = dom.canvas();
        const scene = new Scene(canvas, { theme: lightTheme });
        const c = new Circle(50);
        scene.add(c);
        let playDone = false;
        let waitDone = false;
        void scene.play(new MoveTo(c, { x: 99, y: 0 }, { runTime: 10 })).then(() => {
          playDone = true;
        });
        void scene.wait(10).then(() => {
          waitDone = true;
        });
        dom.frame(16);
        scene.dispose();
        const after = canvas.ops.length;
        await dom.flush();
        ok(playDone, 'play 的 Promise 悬空了');
        ok(waitDone, 'wait 的 Promise 悬空了');
        dom.frame(16);
        dom.frame(16);
        equal(canvas.ops.length, after, 'dispose 之后还在画');
        equal(dom.pending(), 0, 'dispose 之后还有 rAF 排队');
      }),
  ],
  [
    'dispose 后时间线快速展开:跑完不抛错,也不往画布上写',
    () =>
      withStub(async (dom) => {
        const canvas = dom.canvas();
        const scene = new Scene(canvas, { theme: lightTheme });
        const c = new Circle(50);
        scene.add(c);
        let steps = 0;
        const timeline = (async (): Promise<void> => {
          await scene.play(new MoveTo(c, { x: 1, y: 0 }, { runTime: 5 }));
          steps += 1;
          await scene.wait(5);
          steps += 1;
          await scene.play(new MoveTo(c, { x: 2, y: 0 }, { runTime: 5 }));
          steps += 1;
        })();
        dom.frame(16);
        scene.dispose();
        const after = canvas.ops.length;
        await timeline;
        equal(steps, 3);
        equal(canvas.ops.length, after, 'dispose 之后的快速展开仍在绘制');
      }),
  ],
  [
    '连续 await 的三段时间线不会停摆',
    () =>
      withStub(async (dom) => {
        const scene = new Scene(dom.canvas(), { theme: lightTheme });
        const c = new Circle(50);
        scene.add(c);
        let finished = false;
        const run = (async (): Promise<void> => {
          await scene.play(new MoveTo(c, { x: 1, y: 0 }, { runTime: 0.05 }));
          await scene.wait(0.05);
          await scene.play(new MoveTo(c, { x: 2, y: 0 }, { runTime: 0.05 }));
          finished = true;
        })();
        for (let i = 0; i < 60; i++) {
          dom.frame(16);
          await dom.flush();
        }
        await run;
        ok(finished, '时间线卡住了');
        equal(c.position.x, 2);
        scene.dispose();
      }),
  ],
  [
    '视锥剔除:屏外对象跳过绘制,屏内照画',
    () =>
      withStub(async (dom) => {
        const canvas = dom.canvas();
        const scene = new Scene(canvas, { theme: lightTheme });
        const near = new Circle(20);
        const far = new Circle(20);
        far.moveTo({ x: 100_000, y: 0 });
        scene.add(near, far);
        canvas.ops.length = 0;
        scene.render();
        equal(circlesDrawn(canvas.ops), 1, '剔除结果不对');
        scene.dispose();
      }),
  ],
  [
    'Create 只改 revealFraction,不碰 opacity(内容脚本必须自己抬回来)',
    () =>
      withStub(async () => {
        const c = new Circle(50);
        c.opacity = 0;
        const anim = new Create(c, { runTime: 1 });
        anim.begin();
        anim.interpolate(0.5);
        equal(c.opacity, 0);
        equal(c.getRevealFraction(), 0.5);
        anim.finish();
        equal(c.getRevealFraction(), null);
      }),
  ],
  [
    'updater 内部 dispose 场景不会崩,也不会在这一帧继续画',
    () =>
      withStub(async (dom) => {
        const canvas = dom.canvas();
        const scene = new Scene(canvas, { theme: lightTheme });
        scene.add(new Circle(10));
        void scene.wait(10);
        dom.frame(16);
        const after = canvas.ops.length;
        scene.addUpdater(() => {
          scene.dispose();
        });
        dom.frame(16);
        equal(canvas.ops.length, after, 'updater 里 dispose 之后这一帧还在画');
      }),
  ],
  [
    'dispose 是幂等的',
    () =>
      withStub(async (dom) => {
        const scene = new Scene(dom.canvas(), { theme: lightTheme });
        scene.dispose();
        scene.dispose();
        ok(true);
      }),
  ],
  [
    'updater 抛错不会冻死帧泵:坏 updater 被摘掉,其余时间线继续跑',
    () =>
      withStub(async (dom) => {
        const canvas = dom.canvas();
        const scene = new Scene(canvas, { theme: lightTheme });
        const c = new Circle(50);
        scene.add(c);
        scene.addUpdater(() => {
          throw new Error('坏 updater');
        });
        let done = false;
        void scene.play(new MoveTo(c, { x: 5, y: 0 }, { runTime: 0.05 })).then(() => {
          done = true;
        });
        await quiet(async () => {
          for (let i = 0; i < 10; i++) {
            dom.frame(16);
            await dom.flush();
          }
        });
        ok(done, '一次 updater 抛错就让整个场景永久冻结了');
        equal(c.position.x, 5);
        // 冻死的话 render() 会因为帧泵 running 恒为 true 而变成空操作。
        const before = canvas.ops.length;
        scene.render();
        ok(canvas.ops.length > before, 'render() 失效了');
        scene.dispose();
      }),
  ],
  [
    '非有限时长立即收尾,不会变成推不完的时间线',
    () =>
      withStub(async (dom) => {
        const scene = new Scene(dom.canvas(), { theme: lightTheme });
        const c = new Circle(50);
        scene.add(c);
        let playDone = false;
        let waitDone = false;
        // 非法 runTime 会告警一次,这里是故意的。
        let move: MoveTo | null = null;
        await quiet(() => {
          move = new MoveTo(c, { x: 5, y: 0 }, { runTime: NaN });
        });
        void scene.play(move as unknown as MoveTo).then(() => {
          playDone = true;
        });
        void scene.wait(NaN).then(() => {
          waitDone = true;
        });
        for (let i = 0; i < 5; i++) {
          dom.frame(16);
          await dom.flush();
        }
        ok(playDone, 'runTime=NaN 的 play 永远没结束');
        ok(waitDone, 'wait(NaN) 永远没结束');
        equal(c.position.x, 5, '终态没落准');
        ok(Number.isFinite(c.position.x));
        equal(dom.pending(), 0, '帧泵还在空转');
        scene.dispose();
      }),
  ],
  [
    'resize 会当场重绘:清空 backing store 之后不能留一帧空白',
    () =>
      withStub(async (dom) => {
        const canvas = dom.canvas();
        const scene = new Scene(canvas, { theme: lightTheme });
        scene.add(new Circle(50));
        void scene.wait(10);
        dom.frame(16);
        canvas.clientWidth = 900;
        canvas.clientHeight = 500;
        const before = canvas.ops.length;
        scene.resize();
        ok(canvas.ops.length > before, 'resize 之后本帧没有任何绘制');
        scene.dispose();
      }),
  ],
  [
    'getElapsed 与动画同一时钟:连续多段之后不落后',
    () =>
      withStub(async (dom) => {
        const scene = new Scene(dom.canvas(), { theme: lightTheme });
        const c = new Circle(10);
        scene.add(c);
        const run = (async (): Promise<void> => {
          for (let i = 0; i < 5; i++) {
            await scene.play(
              new MoveTo(c, { x: i, y: 0 }, { runTime: 0.1 }),
            );
          }
        })();
        for (let i = 0; i < 100; i++) {
          dom.frame(16);
          await dom.flush();
        }
        await run;
        // 名义 0.5s。每段都会多跑到帧边界,所以只检查「不小于名义值」。
        ok(
          scene.getElapsed() >= 0.5 - 1e-9,
          `getElapsed 落后了:${scene.getElapsed()}`,
        );
        scene.dispose();
      }),
  ],
  [
    '长时间停摆(切后台)不计进播放时钟,动画也不会一帧跳到终态',
    () =>
      withStub(async (dom) => {
        const scene = new Scene(dom.canvas(), { theme: lightTheme });
        const c = new Circle(10);
        scene.add(c);
        void scene.play(new MoveTo(c, { x: 100, y: 0 }, { runTime: 2 }));
        for (let i = 0; i < 5; i++) {
          dom.frame(16);
        }
        const before = c.position.x;
        // 模拟标签页切走 60 秒。
        dom.frame(60_000);
        ok(
          scene.getElapsed() < 1,
          `停摆被计进了播放时钟:${scene.getElapsed()}`,
        );
        ok(
          c.position.x < 100,
          `动画一帧跳到了终态:${before} -> ${c.position.x}`,
        );
        // 停摆之后仍然能正常播完。
        for (let i = 0; i < 200; i++) {
          dom.frame(16);
          await dom.flush();
        }
        equal(c.position.x, 100);
        scene.dispose();
      }),
  ],
  [
    '暂停:时间不流动,恢复后接着原进度跑(不会跳过暂停的那段)',
    () =>
      withStub(async (dom) => {
        const scene = new Scene(dom.canvas(), { theme: lightTheme });
        const c = new Circle(10);
        scene.add(c);
        let done = false;
        void scene
          .play(new MoveTo(c, { x: 100, y: 0 }, { runTime: 0.32 }))
          .then(() => {
            done = true;
          });
        // 跑到一半
        for (let i = 0; i < 10; i++) {
          dom.frame(16);
        }
        const mid = c.position.x;
        ok(mid > 0 && mid < 100, `中途位置不对:${mid}`);
        scene.setPaused(true);
        ok(scene.isPaused());
        const elapsedAtPause = scene.getElapsed();
        for (let i = 0; i < 30; i++) {
          dom.frame(16);
        }
        equal(c.position.x, mid, '暂停期间动画仍在推进');
        equal(scene.getElapsed(), elapsedAtPause, '暂停期间时钟仍在走');
        ok(!done, '暂停期间动画被判定成播完了');
        scene.setPaused(false);
        for (let i = 0; i < 20; i++) {
          dom.frame(16);
          await dom.flush();
        }
        ok(done, '恢复后动画没有播完');
        equal(c.position.x, 100);
        scene.dispose();
      }),
  ],
  [
    '含公式的场景 play 同步排上第一帧(公式是矢量,没有位图预热)',
    () =>
      withStub(async (dom) => {
        const scene = new Scene(dom.canvas(), { theme: lightTheme });
        scene.add(new Tex('y'));
        for (let i = 0; i < 10 && dom.pending() > 0; i++) {
          dom.frame(16);
          await dom.flush();
        }
        equal(dom.pending(), 0);
        void scene.play(new MoveTo(new Circle(1), { x: 1, y: 0 }, { runTime: 1 }));
        equal(dom.pending(), 1, '应当同步排上第一帧,而不是先等一跳');
        scene.dispose();
      }),
  ],
  [
    '同批动画各自在自己的 runTime 结束时收尾一次,不被更长的动画拖着逐帧重复插值',
    () =>
      withStub(async (dom) => {
        const scene = new Scene(dom.canvas(), { theme: lightTheme });
        const log: string[] = [];
        void scene.play(probe(0.05, log, 'short'), probe(0.3, log, 'long'));
        for (let i = 0; i < 30; i++) {
          dom.frame(16);
          await dom.flush();
        }
        const finishShort = log.indexOf('finish:short');
        ok(finishShort >= 0);
        equal(log.filter((l) => l === 'finish:short').length, 1);
        ok(!log.slice(finishShort).includes('i:short'), 'short 收尾之后还在被插值');
        ok(log.slice(finishShort).includes('i:long'));
        scene.dispose();
      }),
  ],
  [
    '同批里一个非有限 runTime 只让它自己立即完成,其它动画照常播',
    () =>
      withStub(async (dom) => {
        const scene = new Scene(dom.canvas(), { theme: lightTheme });
        const c = new Circle(1);
        const log: string[] = [];
        void scene.play(new MoveTo(c, { x: 100, y: 0 }, { runTime: 1 }), probe(Number.NaN, log, 'nan'));
        dom.frame(16);
        dom.frame(16);
        ok(c.position.x > 0 && c.position.x < 50, `MoveTo 被整批拖到了终态:${c.position.x}`);
        ok(log.includes('finish:nan'));
        scene.dispose();
      }),
  ],
  [
    'begin 抛错:已开始的先收尾,play 以该错误 reject',
    () =>
      withStub(async (dom) => {
        const scene = new Scene(dom.canvas(), { theme: lightTheme });
        const log: string[] = [];
        let error: unknown = null;
        await scene.play(probe(1, log, 'a'), probe(1, log, 'b', true)).catch((e: unknown) => {
          error = e;
        });
        ok(error instanceof Error);
        ok(log.includes('begin:a') && log.includes('finish:a'), '已开始的 a 没有收尾');
        scene.dispose();
      }),
  ],
  [
    'wait(Infinity) 一直等到 dispose',
    () =>
      withStub(async (dom) => {
        const scene = new Scene(dom.canvas(), { theme: lightTheme });
        let done = false;
        void scene.wait(Infinity).then(() => {
          done = true;
        });
        for (let i = 0; i < 50; i++) {
          dom.frame(100);
        }
        await dom.flush();
        ok(!done, 'wait(Infinity) 提前结束了');
        scene.dispose();
        await dom.flush();
        ok(done);
      }),
  ],
  [
    'add 重复对象只保留一份;remove 删掉全部;都能链式调用',
    () =>
      withStub(async (dom) => {
        const canvas = dom.canvas();
        const scene = new Scene(canvas, { theme: lightTheme });
        const c = new Circle(5);
        scene.add(c).add(c);
        canvas.ops.length = 0;
        scene.render();
        equal(circlesDrawn(canvas.ops), 1, '重复加入的对象画了两遍');
        scene.remove(c).render();
        equal(circlesDrawn(canvas.ops), 1);
        scene.dispose();
      }),
  ],
  [
    '一个对象绘制抛错不影响其它对象,画布状态栈保持平衡,且只报一次',
    () =>
      withStub(async (dom) => {
        const canvas = dom.canvas();
        const scene = new Scene(canvas, { theme: lightTheme });
        class Broken extends MObject {
          protected override drawShape(): void {
            throw new Error('boom');
          }
        }
        let reports = 0;
        const { error } = console;
        console.error = (): void => {
          reports += 1;
        };
        try {
          scene.add(new Broken(), new Circle(5));
          canvas.ops.length = 0;
          scene.render();
          scene.render();
        } finally {
          console.error = error;
        }
        equal(circlesDrawn(canvas.ops), 2, '后面的对象被连累没画');
        equal(countOps(canvas.ops, 'save'), countOps(canvas.ops, 'restore'));
        equal(reports, 1);
        scene.dispose();
      }),
  ],
  [
    '非有限包围盒被忽略;安全区 NaN 按 0 处理',
    () =>
      withStub(async (dom) => {
        const scene = new Scene(dom.canvas(), { theme: lightTheme });
        const cam = scene.getCamera();
        cam.setView({ x: 5, y: 6, zoom: 2 });
        await quiet(() => {
          scene.fitBounds({ minX: Number.NaN, minY: 0, maxX: 1, maxY: 1 });
        });
        equal(cam.x, 5);
        equal(cam.zoom, 2);
        scene.setSafeArea({ bottom: Number.NaN });
        scene.fitBounds({ minX: -10, minY: -10, maxX: 10, maxY: 10 });
        ok(Number.isFinite(cam.y) && Number.isFinite(cam.zoom));
        close(cam.y, 0, 1e-9, 'NaN 安全区让取景偏了');
        scene.dispose();
      }),
  ],
  [
    '画布隐藏(尺寸为 0)时推迟取景,尺寸就绪后自动应用',
    () =>
      withStub(async (dom) => {
        const canvas = dom.canvas();
        canvas.clientWidth = 0;
        canvas.clientHeight = 0;
        const scene = new Scene(canvas, { theme: lightTheme });
        const cam = scene.getCamera();
        scene.fitBounds({ minX: 0, minY: 0, maxX: 100, maxY: 100 });
        equal(cam.zoom, 1, '0 尺寸视口不该改机位(会被钳到 minZoom)');
        canvas.clientWidth = 400;
        canvas.clientHeight = 400;
        scene.resize();
        close(cam.zoom, 4, 1e-9);
        close(cam.x, 50, 1e-9);
        scene.dispose();
      }),
  ],
  [
    '嵌套在变换过的容器里的对象按真实世界位置取景',
    () =>
      withStub(async (dom) => {
        const scene = new Scene(dom.canvas(), { theme: lightTheme });
        const g = new Group();
        g.moveTo({ x: 1000, y: 0 });
        g.scale = 2;
        const r = new Rectangle(10, 10);
        g.add(r);
        scene.add(g);
        const v = scene.getFitView([r]);
        close(v.x, 1000, 1e-9, '把父局部坐标当成了世界坐标');
        scene.dispose();
      }),
  ],
  [
    'playFit 运镜途中改画幅:落点按新视口取景,途中也不先闪到终点',
    () =>
      withStub(async (dom) => {
        const canvas = dom.canvas();
        const scene = new Scene(canvas, { theme: lightTheme });
        const target = new Rectangle(100, 100);
        target.moveTo({ x: 300, y: 0 });
        scene.add(target);
        let done = false;
        void scene.playFit([target], { runTime: 0.2 }).then(() => {
          done = true;
        });
        dom.frame(16);
        await dom.flush();
        canvas.clientWidth = 400;
        canvas.clientHeight = 400;
        const beforeResize = scene.getCamera().getView();
        scene.resizeAndRefit();
        const afterResize = scene.getCamera().getView();
        equal(afterResize.zoom, beforeResize.zoom, 'resize 时把机位拍到了终点');
        for (let i = 0; i < 20 && !done; i++) {
          dom.frame(16);
          await dom.flush();
        }
        ok(done);
        close(scene.getCamera().zoom, 4, 1e-9, '落点仍是旧视口的取景');
        scene.dispose();
      }),
  ],
  [
    'renderTo 按目标分辨率重新绘制(不是拷贝主画布像素)',
    () =>
      withStub(async (dom) => {
        const scene = new Scene(dom.canvas(), { theme: lightTheme });
        scene.add(new Circle(10));
        const { ctx, calls } = fakeCtx();
        scene.renderTo(ctx, { width: 2560, height: 1440 });
        ok(calls.some((c) => c.op === 'bezierCurveTo'), '没有在目标上重绘图形');
        ok(!calls.some((c) => c.op === 'drawImage'), '还在拷贝主画布像素');
        equal(calls.filter((c) => c.op === 'save').length, calls.filter((c) => c.op === 'restore').length);
        scene.dispose();
      }),
  ],
  [
    '网页字体加载完成:没人动过的 Layout 按新尺寸重排,按对象取的景按新包围盒重取;镜头被挪过的场景不动',
    () =>
      withStub(async (dom) => {
        const fonts = lateFonts();
        try {
          const build = (): { scene: Scene; tex: LateFontText; box: Rectangle; row: Layout } => {
            const scene = new Scene(dom.canvas(), { theme: lightTheme });
            const row = new Layout(600, 60, { direction: 'row', padding: 0, gap: 10 });
            const tex = new LateFontText();
            const box = new Rectangle(20, 20);
            row.place(tex);
            row.place(box);
            row.layout();
            scene.add(row);
            scene.fitObjects([tex]);
            return { scene, tex, box, row };
          };
          const a = build();
          const b = build();
          const c = build();
          const zoomA = a.scene.getCamera().zoom;
          const boxBefore = a.box.position.x;
          b.scene.getCamera().setView({ x: 5, y: 5, zoom: 3 });
          // c 的取景目标已经移出场景:不该再按看不见的对象重取景。
          const viewC = c.scene.getCamera().getView();
          c.scene.remove(c.row);
          // d 的取景目标之一正被动画挪着走(sweep):镜头不该在字体到货那一帧跳到按新位置算的机位。
          const d = build();
          const dot = new Circle(4);
          d.scene.add(dot);
          d.scene.fitObjects([d.tex, dot]);
          const viewD = d.scene.getCamera().getView();
          dot.moveTo({ x: 250, y: 0 });
          fonts.arrive();
          await dom.flush();
          ok(a.box.position.x > boxBefore, '字体到了公式变宽,Layout 没有重排');
          ok(a.scene.getCamera().zoom < zoomA, '字体到了公式变宽,镜头没有按新包围盒重取景');
          const vb = b.scene.getCamera().getView();
          equal(vb.zoom, 3, '用户挪过的镜头被自动取景拽回去了');
          equal(vb.x, 5);
          equal(c.scene.getCamera().zoom, viewC.zoom, '取景目标已移出场景,却还按它重取景');
          const vd = d.scene.getCamera().getView();
          ok(vd.x === viewD.x && vd.zoom === viewD.zoom, '目标被动画挪动时,镜头在字体到货那一帧跳了');
          a.scene.dispose();
          b.scene.dispose();
          c.scene.dispose();
          d.scene.dispose();
        } finally {
          fonts.restore();
        }
      }),
  ],
  [
    'playFit 遇到隐藏画布(尺寸为 0):镜头原地不动、时长照走;尺寸就绪后直接落到取景位',
    () =>
      withStub(async (dom) => {
        const canvas = dom.canvas();
        canvas.clientWidth = 0;
        canvas.clientHeight = 0;
        const scene = new Scene(canvas, { theme: lightTheme });
        const target = new Rectangle(100, 100);
        target.moveTo({ x: 300, y: 0 });
        scene.add(target);
        let done = false;
        void scene.playFit([target], { runTime: 0.1 }).then(() => {
          done = true;
        });
        for (let i = 0; i < 12 && !done; i++) {
          dom.frame(16);
          await dom.flush();
        }
        ok(done);
        equal(scene.getCamera().zoom, 1, '隐藏画布上把镜头钳到了 minZoom');
        canvas.clientWidth = 400;
        canvas.clientHeight = 400;
        scene.resize();
        close(scene.getCamera().zoom, 4, 1e-9);
        close(scene.getCamera().x, 300, 1e-9);
        scene.dispose();
      }),
  ],
  [
    'renderTo 把公式按矢量画进目标上下文(放大截图照样清晰,不是位图)',
    () =>
      withStub(async (dom) => {
        const scene = new Scene(dom.canvas(), { theme: lightTheme });
        scene.add(new Tex('x^2').setStyle({ fontSize: 20 }));
        const { ctx, calls } = fakeCtx();
        scene.renderTo(ctx, { width: 2560, height: 1440 });
        ok(calls.some((c) => c.op === 'bezierCurveTo'), '公式应按字形轮廓画出');
        ok(!calls.some((c) => c.op === 'drawImage'), '不该再有位图');
        scene.dispose();
      }),
  ],
  [
    '剔除按当下样式解析公式字号:屏外时容器把字号改大、盒伸进视口后照画',
    () =>
      withStub(async (dom) => {
        const canvas = dom.canvas();
        const scene = new Scene(canvas, { theme: lightTheme });
        const group = new Group().add(new Tex('c'));
        group.setStyle({ fontSize: 10 });
        scene.add(group);
        scene.render();
        const inView = countOps(canvas.ops, 'fill');
        ok(inView > 0);
        group.moveTo({ x: 700, y: 0 });
        scene.render();
        equal(countOps(canvas.ops, 'fill'), inView, '屏外的公式应被剔除');
        group.setStyle({ fontSize: 400 });
        scene.render();
        ok(countOps(canvas.ops, 'fill') > inView, '字号变大、盒已伸进视口,却还被剔除');
        scene.dispose();
      }),
  ],
  [
    '像素比变了(窗口拖到另一块屏)而 css 尺寸没变:重设分辨率并按新像素比继续盯',
    () =>
      withStub(async (dom) => {
        const g = globalThis as unknown as Record<string, unknown>;
        const had = 'matchMedia' in g;
        const saved = g['matchMedia'];
        const queries: string[] = [];
        const listeners: Array<() => void> = [];
        g['matchMedia'] = (q: string) => {
          queries.push(q);
          return {
            addEventListener: (_type: string, fn: () => void) => listeners.push(fn),
            removeEventListener: (_type: string, fn: () => void) => {
              const i = listeners.indexOf(fn);
              if (i >= 0) {
                listeners.splice(i, 1);
              }
            },
          };
        };
        try {
          const canvas = dom.canvas();
          const scene = new Scene(canvas, { theme: lightTheme });
          equal(canvas.width, 1280);
          (g['window'] as { devicePixelRatio: number }).devicePixelRatio = 2;
          listeners[0]?.();
          equal(canvas.width, 2560, '像素比变了没有重设分辨率');
          equal(queries[queries.length - 1], '(resolution: 2dppx)');
          scene.dispose();
          equal(listeners.length, 0, 'dispose 后还挂着媒体查询监听');
        } finally {
          if (had) {
            g['matchMedia'] = saved;
          } else {
            delete g['matchMedia'];
          }
        }
      }),
  ],
  [
    '注入时钟:不装任何全局桩也能完整跑完 play(帧只由注入的时钟驱动)',
    async () => {
      const g = globalThis as unknown as Record<string, unknown>;
      equal(g['requestAnimationFrame'], undefined, '全局 rAF 没有还原,本用例失去意义');
      let now = 1000;
      let nextId = 1;
      const queue = new Map<number, (t: number) => void>();
      const clock = {
        now: () => now,
        request: (cb: (t: number) => void) => {
          const id = nextId++;
          queue.set(id, cb);
          return id;
        },
        cancel: (id: number) => {
          queue.delete(id);
        },
      };
      const scene = new Scene(createStubCanvas(), { theme: lightTheme, clock });
      const c = new Circle(1);
      scene.add(c);
      let done = false;
      void scene.play(new MoveTo(c, { x: 10, y: 0 }, { runTime: 0.1 })).then(() => {
        done = true;
      });
      for (let i = 0; i < 20 && !done; i++) {
        now += 16;
        const due = [...queue.values()];
        queue.clear();
        for (const cb of due) {
          cb(now);
        }
        await flushTasks();
      }
      ok(done);
      equal(c.position.x, 10);
      scene.dispose();
    },
  ],
  [
    '已 dispose 的场景 play/wait 立即 resolve 且不启动帧泵',
    () =>
      withStub(async (dom) => {
        const scene = new Scene(dom.canvas(), { theme: lightTheme });
        scene.dispose();
        let done = 0;
        await scene.play(new MoveTo(new Circle(1), { x: 1, y: 1 }, { runTime: 5 }));
        done += 1;
        await scene.wait(5);
        done += 1;
        equal(done, 2);
        equal(dom.pending(), 0);
      }),
  ],
  [
    '干跑:时间线照常推进(updater/插值/完成),只跳过绘制;关掉立刻能画',
    () =>
      withStub(async (dom) => {
        const canvas = dom.canvas();
        const scene = new Scene(canvas, { theme: lightTheme });
        const c = new Circle(50);
        scene.add(c);
        let updaterCalls = 0;
        scene.addUpdater(() => {
          updaterCalls += 1;
        });
        scene.setDryRun(true);
        let done = false;
        void scene.play(new MoveTo(c, { x: 99, y: 0 }, { runTime: 0.05 })).then(() => {
          done = true;
        });
        const base = countOps(canvas.ops, 'fillRect');
        for (let i = 0; i < 5; i++) {
          dom.frame(16);
        }
        await dom.flush();
        equal(countOps(canvas.ops, 'fillRect') - base, 0, '干跑还在画');
        equal(updaterCalls, 5, '干跑没推进 updater');
        equal(done, true, '干跑没推完时间线');
        equal(c.position.x, 99, '干跑没把插值推到终态');
        scene.setDryRun(false);
        scene.render();
        dom.frame(16);
        ok(countOps(canvas.ops, 'fillRect') - base > 0, '关掉干跑还不画');
        scene.dispose();
      }),
  ],
]);
