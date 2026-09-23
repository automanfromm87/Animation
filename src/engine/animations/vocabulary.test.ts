import { installDomStub } from '../../testing/domStub';
import { equal, ok, suite } from '../../testing/harness';
import { Brace, Angle } from '../mobjects/annotations';
import { BarChart, BarChartTo } from '../mobjects/charts';
import { FunctionGraph } from '../mobjects/graphs';
import { Group } from '../mobjects/Group';
import type { MObject } from '../mobjects/MObject';
import { NumberPlane } from '../mobjects/numberLine';
import { AreaUnderCurve, RiemannRectangles, RiemannTo, TangentLine } from '../mobjects/plots';
import { Tex } from '../mobjects/tex';
import { VectorField } from '../mobjects/vectorField';
import { Scene } from '../scene/Scene';
import { lightTheme } from '../theme/presets';
import type { Playable } from './Animation';
import { AnimationGroup, LaggedStart, Succession, Wait } from './composition';
import { Circumscribe, Flash, Indicate, Wiggle } from './emphasis';
import { Create, FadeIn } from './primitives';
import { ColorTo } from './styleTween';
import { TransformMatchingTex } from './transformMatching';

/** 在假画布上把一组动画播完;渲染器吞掉的绘制错误(console.error)也算失败。 */
async function playAll(build: (scene: Scene) => Playable[][]): Promise<void> {
  const dom = installDomStub();
  const errors: unknown[] = [];
  const original = console.error;
  console.error = (...args: unknown[]) => {
    errors.push(args);
  };
  try {
    const scene = new Scene(dom.canvas(), { theme: lightTheme });
    for (const batch of build(scene)) {
      let done = false;
      let failure: unknown = null;
      scene.play(...batch).then(
        () => {
          done = true;
        },
        (e: unknown) => {
          failure = e;
          done = true;
        },
      );
      for (let i = 0; i < 2000 && !done; i++) {
        dom.frame(16);
        await dom.flush();
      }
      ok(done, '动画没有播完');
      if (failure) {
        throw failure;
      }
    }
    scene.dispose();
  } finally {
    console.error = original;
    dom.restore();
  }
  equal(errors.length, 0, `播放 / 绘制中出了错:${errors.map((e) => String(e)).join(' | ')}`);
}

function noEmphasis(objects: readonly MObject[], owners: readonly object[]): boolean {
  return objects.every((m) => owners.every((o) => m.getEmphasis(o) === null));
}

export default suite('讲解词汇组合使用(端到端)', [
  [
    '坐标网格 + 曲线 + 面积 + 切线 + 向量场错峰画出;闪一下数据点、圈出面积、高亮切线',
    async () => {
      const plane = new NumberPlane([-3, 3], [-2, 4], 360, 300, { numbers: true });
      const f = (x: number): number => (x * x) / 2;
      const graph = new FunctionGraph(f, plane);
      const area = new AreaUnderCurve(plane, f, [0, 2]);
      const tangent = new TangentLine(plane, f, 1, { length: 120 });
      const field = new VectorField(plane, (x, y) => [-y, x], { colors: ['#3b82f6', '#ef4444'] });
      plane.add(field, graph, area, tangent);
      const flash = new Flash(plane, { at: plane.c2p(1, f(1)), runTime: 0.3 });
      const circ = new Circumscribe(area, { runTime: 0.3 });
      const ind = new Indicate(tangent, { runTime: 0.3 });
      await playAll((scene) => {
        scene.add(plane);
        return [
          [new LaggedStart([plane, field, graph, area, tangent].map((m) => new Create(m, { runTime: 0.3 })), { lagRatio: 0.3 })],
          [flash, circ, ind],
          [new Wiggle(graph, { runTime: 0.3 })],
        ];
      });
      ok(noEmphasis([plane, area, tangent], [flash, circ, ind]), '强调全部撤掉');
      equal(area.getRevealFraction(), null, 'Create 收尾后完整显示');
    },
  ],
  [
    '推导:花括号标注 → 高亮其中一项 → 按结构变形两步 → 圈出结果',
    async () => {
      const step1 = new Tex('\\class{lhs}{2x + 3} = 7').setStyle({ fontSize: 32 });
      const step2 = new Tex('2x = 7 - 3').setStyle({ fontSize: 32 });
      const step3 = new Tex('x = 2').setStyle({ fontSize: 32 });
      const brace = Brace.for(step1, 'down', { label: '\\text{左边}' });
      const ind = new Indicate(step1, { part: 'lhs', runTime: 0.3 });
      const circ = new Circumscribe(step3, { runTime: 0.3 });
      await playAll((scene) => {
        scene.add(step1, step2, step3, brace);
        return [
          [new Create(brace, { runTime: 0.3 }), ind],
          [
            new Succession([
              new TransformMatchingTex(step1, step2, { runTime: 0.3 }),
              new Wait(0.1),
              new TransformMatchingTex(step2, step3, { runTime: 0.3 }),
            ]),
          ],
          [circ],
        ];
      });
      equal(step1.opacity, 0);
      equal(step2.opacity, 0);
      equal(step3.opacity, 1, '推导的终点显示出来');
      ok(noEmphasis([step1, step3], [ind, circ]));
    },
  ],
  [
    '黎曼和细分 + 换色、柱状图补间、角标错峰出现,全部在一个 AnimationGroup 里',
    async () => {
      const plane = new NumberPlane([0, 4], [0, 4], 240, 240);
      const rects = new RiemannRectangles(plane, (x) => Math.sqrt(x) + 1, [0, 3], { n: 4 });
      plane.add(rects);
      const chart = new BarChart([1, 3, 2], { labels: ['甲', '乙', '丙'], showValues: true });
      chart.moveTo({ x: 300, y: 0 });
      const angle = new Angle({ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 40, y: -60 }, { label: '\\theta' });
      const holder = new Group().add(angle);
      holder.moveTo({ x: -300, y: 0 });
      holder.opacity = 0;
      await playAll((scene) => {
        scene.add(plane, chart, holder);
        return [
          [
            new AnimationGroup([
              new Succession([new RiemannTo(rects, { n: 12 }, { runTime: 0.3 }), new ColorTo(rects, '#16a34a', { runTime: 0.2 })]),
              new BarChartTo(chart, [2, 1, 4], { runTime: 0.4 }),
              new LaggedStart([new FadeIn(holder, { runTime: 0.2 }), new Create(angle, { runTime: 0.3 })]),
            ]),
          ],
        ];
      });
      equal(chart.values.join(','), '2,1,4', '柱状图终值精确');
      equal(holder.opacity, 1);
    },
  ],
]);
