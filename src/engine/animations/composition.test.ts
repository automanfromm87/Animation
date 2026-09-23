import { installDomStub } from '../../testing/domStub';
import { close, equal, ok, suite, throws } from '../../testing/harness';
import { Circle, Dot, Square } from '../mobjects/shapes';
import { Scene } from '../scene/Scene';
import { lightTheme } from '../theme/presets';
import type { PlayContext } from './Animation';
import { BasePlayable } from './Animation';
import { AnimationGroup, LaggedStart, Succession, Wait } from './composition';
import { FadeIn, MoveTo } from './primitives';
import type { RateFunction } from './rateFunctions';
import { linear, smooth, thereAndBack } from './rateFunctions';
import { Transform } from './transform';

/** 记录生命周期的探针动画。 */
class Probe extends BasePlayable {
  readonly values: number[] = [];
  begins = 0;
  finishes = 0;
  contexts: Array<PlayContext | undefined> = [];
  readonly name: string;
  private readonly log: string[];
  private readonly failOn: 'begin' | 'interpolate' | null;

  constructor(
    name: string,
    runTime: number,
    log: string[],
    rateFunc: RateFunction = linear,
    failOn: 'begin' | 'interpolate' | null = null,
  ) {
    super({ runTime, rateFunc });
    this.name = name;
    this.log = log;
    this.failOn = failOn;
  }

  override begin(context?: PlayContext): void {
    this.log.push(`${this.name}:begin`);
    this.contexts.push(context);
    if (this.failOn === 'begin') {
      throw new Error(`${this.name} begin 失败`);
    }
    this.begins += 1;
  }

  interpolate(alpha: number): void {
    if (this.failOn === 'interpolate') {
      throw new Error(`${this.name} interpolate 失败`);
    }
    this.values.push(alpha);
  }

  override finish(): void {
    this.log.push(`${this.name}:finish`);
    this.finishes += 1;
    super.finish();
  }

  get lastValue(): number | undefined {
    return this.values[this.values.length - 1];
  }
}

export default suite('组合动画 AnimationGroup / LaggedStart / Succession', [
  [
    '时间轴:同时开始取最长;按前一个的时长比例错开;LaggedStart 缺省 0.2;Succession 首尾相接;runTime 整体伸缩',
    () => {
      const log: string[] = [];
      const g = new AnimationGroup([new Probe('a', 1, log), new Probe('b', 2, log)]);
      equal(g.runTime, 2);
      equal(g.rateFunc, linear, '组缺省线性:扭曲整条时间轴的是组的缓动');
      const lagged = new AnimationGroup(
        [new Probe('a', 1, log), new Probe('b', 2, log), new Probe('c', 1, log)],
        { lagRatio: 0.5 },
      );
      // 开始于 0、0.5、1.5,结束于 1、2.5、2.5。
      equal(lagged.naturalRunTime, 2.5);
      close(new LaggedStart([1, 1, 1].map((t, i) => new Probe(`p${i}`, t, log))).runTime, 1.4, 1e-12);
      equal(new Succession([new Probe('a', 1, log), new Probe('b', 2, log)]).runTime, 3);
      const stretched = new AnimationGroup([new Probe('a', 1, log)], { runTime: 4 });
      equal(stretched.runTime, 4);
      equal(stretched.naturalRunTime, 1);
      equal(new AnimationGroup([]).runTime, 0, '空组时长为 0');
    },
  ],
  [
    'AnimationGroup / LaggedStart:开始时按顺序 begin 全部;各自走到终点单独 finish,不等整组',
    () => {
      const log: string[] = [];
      const [a, b, c] = ['a', 'b', 'c'].map((n) => new Probe(n, 1, log));
      if (!a || !b || !c) {
        throw new Error('unreachable');
      }
      const g = new LaggedStart([a, b, c], { lagRatio: 0.5 });
      equal(g.runTime, 2);
      g.begin();
      equal(log.join(' '), 'a:begin b:begin c:begin');
      g.interpolate(0.25); // 组内 0.5 秒
      close(a.lastValue ?? NaN, 0.5, 1e-12);
      equal(b.values.length, 0, '还没轮到的不插值');
      g.interpolate(0.6); // 组内 1.2 秒:a 已经走完
      equal(a.finishes, 1, 'a 走到终点就该单独收尾');
      close(b.lastValue ?? NaN, 0.7, 1e-12);
      close(c.lastValue ?? NaN, 0.2, 1e-12);
      g.interpolate(0.6);
      equal(b.values.length, 1, '进度没变不重复插值');
      g.finish();
      equal([a.finishes, b.finishes, c.finishes].join(','), '1,1,1', '每个恰好收尾一次');
    },
  ],
  [
    'LaggedStart 实际对象:FadeIn 开始时全部藏起来、依次淡入,终态精确',
    () => {
      const dots = [new Dot(), new Dot(), new Dot()];
      const g = new LaggedStart(
        dots.map((d) => new FadeIn(d, { rateFunc: linear })),
        { lagRatio: 0.5 },
      );
      g.begin();
      equal(dots.map((d) => d.opacity).join(','), '0,0,0', '入场动画开始时就把各自的对象藏好');
      g.interpolate(0.25);
      close(dots[0]?.opacity ?? NaN, 0.5, 1e-12);
      equal(dots[1]?.opacity, 0);
      g.finish();
      equal(dots.map((d) => d.opacity).join(','), '1,1,1');
    },
  ],
  [
    'Succession:轮到才 begin,同一对象先移到 A 再移到 B 首尾相接',
    () => {
      const dot = new Dot();
      const s = new Succession([
        new MoveTo(dot, { x: 100, y: 0 }, { rateFunc: linear }),
        new MoveTo(dot, { x: 100, y: 100 }, { rateFunc: linear }),
      ]);
      equal(s.runTime, 2);
      s.begin();
      s.interpolate(0.25);
      equal(dot.position.x, 50);
      equal(dot.position.y, 0);
      s.interpolate(0.75); // 组内 1.5 秒:第一段已经收尾,第二段从 (100, 0) 出发
      equal(dot.position.x, 100, '第二段应当从第一段的终点出发');
      close(dot.position.y, 50, 1e-12);
      s.finish();
      equal(dot.position.x, 100);
      equal(dot.position.y, 100);

      // 不插值直接收尾(runTime 0 / 跳到结尾):按顺序 begin + finish,终态照样对。
      const d2 = new Dot();
      const jump = new Succession([
        new MoveTo(d2, { x: 10, y: 0 }),
        new MoveTo(d2, { x: 10, y: 10 }),
      ]);
      jump.begin();
      jump.finish();
      equal(d2.position.x, 10);
      equal(d2.position.y, 10);
    },
  ],
  [
    'Succession 里连续变形 A → B → C:第二段在 B 显示出来之后才开始',
    () => {
      const a = new Square(40);
      const b = new Circle(20);
      const c = new Square(10);
      const s = new Succession([
        new Transform(a, b, { rateFunc: linear }),
        new Transform(b, c, { rateFunc: linear }),
      ]);
      s.begin();
      equal(b.opacity, 0, '第一段开始时藏起 B');
      equal(c.opacity, 1, '第二段还没开始,C 保持原样');
      s.interpolate(0.75);
      equal(a.opacity, 0, '第一段收尾藏起 A');
      ok(b.getMorphOverlay() !== null, '第二段由 B 画变形覆盖');
      equal(c.opacity, 0);
      s.finish();
      equal(a.opacity, 0);
      equal(b.opacity, 0);
      equal(c.opacity, 1);
      equal(b.getMorphOverlay(), null);
    },
  ],
  [
    '子动画自己的缓动照常生效;组的缓动扭曲整条时间轴',
    () => {
      const log: string[] = [];
      const p = new Probe('p', 1, log, smooth);
      const g = new AnimationGroup([p]);
      g.begin();
      g.interpolate(0.25);
      close(p.lastValue ?? NaN, smooth(0.25), 1e-12);
      const q = new Probe('q', 1, log);
      const warped = new AnimationGroup([q], { rateFunc: smooth });
      equal(warped.rateFunc, smooth);
    },
  ],
  [
    '嵌套与 Wait:Succession 里放组和停顿,PlayContext 一路传给子动画',
    () => {
      const log: string[] = [];
      const p1 = new Probe('p1', 1, log);
      const p2 = new Probe('p2', 1, log);
      const p3 = new Probe('p3', 1, log);
      const s = new Succession([new AnimationGroup([p1, p2]), new Wait(0.5), p3]);
      equal(s.runTime, 2.5);
      const context: PlayContext = {
        worldMatrix: () => null,
        styleOf: (m) => m.getStyle(lightTheme),
      };
      s.begin(context);
      equal(p1.contexts[0], context);
      s.interpolate(1.2 / 2.5);
      equal(p3.begins, 0, '停顿期间第三段还没开始');
      equal(p1.finishes, 1);
      s.interpolate(1.6 / 2.5);
      equal(p3.begins, 1);
      equal(p3.contexts[0], context, '轮到时才 begin 的也拿到同一个场景信息');
      close(p3.lastValue ?? NaN, 0.1, 1e-9);
      equal(new Wait(0.5).runTime, 0.5);
      equal(new Wait().runTime, 1);
    },
  ],
  [
    '时长为 0 的子动画一到开始时刻就完成',
    () => {
      const log: string[] = [];
      const zero = new Probe('zero', 0, log);
      const g = new AnimationGroup([zero, new Probe('one', 1, log)]);
      g.begin();
      equal(zero.finishes, 1, '从 0 开始的零时长子动画 begin 时就完成');
      const log2: string[] = [];
      const mid = new Probe('mid', 0, log2);
      const s = new Succession([new Probe('a', 1, log2), mid, new Probe('b', 1, log2)]);
      s.begin();
      s.interpolate(0.4);
      equal(mid.begins, 0);
      s.interpolate(0.6);
      equal(log2.join(' '), 'a:begin a:finish mid:begin mid:finish b:begin', '按顺序:前一个收尾后才开始下一个');
    },
  ],
  [
    '参数校验:lagRatio 非法、同一个实例出现两次都抛错',
    () => {
      const log: string[] = [];
      throws(() => new AnimationGroup([], { lagRatio: -1 }), 'lagRatio 负数');
      throws(() => new LaggedStart([], { lagRatio: Number.NaN }), 'lagRatio NaN');
      const p = new Probe('p', 1, log);
      throws(() => new AnimationGroup([p, p]), '重复实例');
    },
  ],
  [
    'begin 阶段抛错:已经开始的先收尾,还没开始的不碰,错误抛给调用方',
    () => {
      const log: string[] = [];
      const ok1 = new Probe('ok1', 1, log);
      const bad = new Probe('bad', 1, log, linear, 'begin');
      const ok2 = new Probe('ok2', 1, log);
      const g = new AnimationGroup([ok1, bad, ok2]);
      throws(() => g.begin(), '应当把 begin 的错误抛出去');
      equal(ok1.finishes, 1, '已经开始的应当收尾');
      equal(ok2.begins, 0, '后面的不该开始');
    },
  ],
  [
    'Succession 中途 begin 抛错:插值时抛出;收尾时其余子动画照常完成,再抛出同一个错误',
    () => {
      const log: string[] = [];
      const first = new Probe('first', 1, log);
      const bad = new Probe('bad', 1, log, linear, 'begin');
      const last = new Probe('last', 1, log);
      const s = new Succession([first, bad, last]);
      s.begin();
      let caught: unknown = null;
      try {
        s.interpolate(0.5); // 组内 1.5 秒
      } catch (e) {
        caught = e;
      }
      ok(caught instanceof Error && caught.message.includes('bad'), '插值时应当抛出 bad 的错误');
      equal(first.finishes, 1);
      let again: unknown = null;
      try {
        s.finish();
      } catch (e) {
        again = e;
      }
      equal(again, caught, '收尾时再抛出同一个错误(Scene.play 据此 reject)');
      equal(last.finishes, 1, '坏掉的那个不影响后面的收尾');
      equal(bad.finishes, 0, '从没开始的不收尾');
    },
  ],
  [
    '插值抛错的子动画之后的帧不再碰它,组收尾时再给它一次 finish',
    () => {
      const log: string[] = [];
      const bad = new Probe('bad', 1, log, linear, 'interpolate');
      const good = new Probe('good', 1, log);
      const g = new AnimationGroup([bad, good]);
      g.begin();
      throws(() => g.interpolate(0.5));
      close(good.lastValue ?? NaN, 0.5, 1e-12, '同一帧里别的子动画照常插值');
      throws(() => g.interpolate(0.6), '错误一直带着,直到重新 begin');
      throws(() => g.finish());
      equal(bad.finishes, 1, '收尾时给出过错的也调一次 finish');
      equal(good.finishes, 1);
    },
  ],
  [
    '往回走的组时间:已经收尾的子动画重新插值;往返型缓动收尾停在起点',
    () => {
      const log: string[] = [];
      const p = new Probe('p', 1, log);
      const g = new AnimationGroup([p], { rateFunc: thereAndBack });
      g.begin();
      g.interpolate(1);
      equal(p.finishes, 1);
      g.interpolate(0.5);
      close(p.lastValue ?? NaN, 0.5, 1e-12, '往回走时重新插值');
      g.interpolate(1);
      equal(p.finishes, 2, '再次走到头要重新收尾,不能停在往回走的那一帧');
      g.interpolate(0.5);
      g.finish();
      equal(p.lastValue, 0, 'thereAndBack(1)=0:收尾停在组时间 0');
      equal(p.finishes, 2, '没有走到头就不再收尾');
    },
  ],
  [
    '重播:再次 begin 时重置状态',
    () => {
      const dot = new Dot();
      const g = new AnimationGroup([new MoveTo(dot, { x: 10, y: 0 })]);
      g.begin();
      g.finish();
      dot.moveTo({ x: 0, y: 0 });
      g.begin();
      g.interpolate(0.5);
      ok(dot.position.x > 0 && dot.position.x < 10, '第二次播放应当从头插值');
      g.finish();
      equal(dot.position.x, 10);
    },
  ],
  [
    'Scene.play 端到端:LaggedStart 按错峰排出的总长播放,播完每个对象都在终点',
    async () => {
      const dom = installDomStub();
      try {
        const scene = new Scene(dom.canvas(), { theme: lightTheme });
        const dots = [new Dot(), new Dot(), new Dot()];
        scene.add(...dots);
        let done = false;
        void scene
          .play(
            new LaggedStart(
              dots.map((d, i) => new MoveTo(d, { x: 100, y: i * 10 }, { runTime: 0.2 })),
              { lagRatio: 0.5 },
            ),
          )
          .then(() => {
            done = true;
          });
        // 总长 0.2 + 2 × 0.1 = 0.4 秒:0.3 秒时还没播完,最后一个还在路上。
        for (let i = 0; i < 19; i++) {
          dom.frame(16);
          await dom.flush();
        }
        ok(!done, '0.3 秒时不该播完');
        equal(dots[0]?.position.x, 100, '第一个早已到终点');
        const lastX = dots[2]?.position.x ?? NaN;
        ok(lastX > 0 && lastX < 100, `最后一个应当在路上,实际 x=${lastX}`);
        for (let i = 0; i < 20 && !done; i++) {
          dom.frame(16);
          await dom.flush();
        }
        ok(done, '动画没有结束');
        equal(dots.map((d) => `${d.position.x},${d.position.y}`).join(' '), '100,0 100,10 100,20');
        scene.dispose();
      } finally {
        dom.restore();
      }
    },
  ],
]);
