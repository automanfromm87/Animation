import {
  Axes,
  Circumscribe,
  Create,
  Dot,
  FadeIn,
  FadeOut,
  FunctionGraph,
  Group,
  Indicate,
  Label,
  Line,
  SecantLine,
  TangentLine,
  Tex,
  TweenValue,
  ValueTracker,
  Write,
} from '../engine';
import type { RealFunction } from '../engine';
import { timedSegment } from './timed';
import type { Segment } from './types';

/**
 * 配音演示片《导数就是切线的斜率》:三段 timedSegment,台词带 <mark>,脚本只踩提示点、不写秒数;
 * 跟着台词伸缩的动画用 playUntil / playThrough 写「在哪儿收住」,时长由引擎按目标算。
 * 没有配音时间表时按草稿时间播(没有声音);public/voice/voice-demo/timing.json 到位后
 * 时长、字幕、声音全按时间表来(`npm run voice:demo` 用 macOS 语音合成生成一份)。
 */

const f: RealFunction = (x) => x * x;

/** 坐标系 + y = x² 的曲线(同一个组里:曲线取样得到的是坐标系的本地坐标)。 */
function makePlot(): { axes: Axes; graph: FunctionGraph } {
  const axes = new Axes([-0.5, 2.5], [-0.5, 6.5], 420, 320);
  const graph = new FunctionGraph(f, axes).setStyle({ stroke: '#2563eb', strokeWidth: 4 });
  return { axes, graph };
}

const secantToTangent = timedSegment(
  {
    id: 'secant-to-tangent',
    name: '割线逼近切线',
    marker: 'chapter',
    chapter: '导数的直观',
    lines: [
      { id: 'secant-1', text: '先画一条曲线,y 等于 x 的平方。' },
      { id: 'secant-2', text: '在曲线上取两个点,连起来是一条<mark name="line"/>割线。' },
      { id: 'secant-3', text: '让右边的点一点点靠近左边的点,割线就慢慢变成了<mark name="tangent"/>切线。' },
    ],
  },
  async (env) => {
    const { axes, graph } = makePlot();
    const x1 = 1;
    const tracker = new ValueTracker(2.2);
    const secant = new SecantLine(axes, f, x1, tracker.getValue(), { extend: 60 }).setStyle({
      stroke: '#db2777',
      strokeWidth: 3,
    });
    const p = new Dot(7).moveTo(axes.toLocal(x1, f(x1)));
    const q = new Dot(7).moveTo(axes.toLocal(tracker.getValue(), f(tracker.getValue())));
    const tangent = new TangentLine(axes, f, x1, { length: 260 }).setStyle({ stroke: '#16a34a', strokeWidth: 3 });
    for (const m of [secant, p, q, tangent]) {
      m.opacity = 0;
    }
    axes.setRevealFraction(0);
    graph.setRevealFraction(0);
    const plot = new Group().add(axes, graph, secant, tangent, p, q);
    env.scene.add(plot);
    env.scene.fitObjects([plot], 40);

    await env.untilLine('secant-1');
    await env.play(new Create(axes, { runTime: 1 }));
    await env.playUntil({ end: 'secant-1', min: 0.6 }, new Create(graph)); // 曲线画到这句说完

    await env.untilLine('secant-2');
    await env.play(new FadeIn(p, { runTime: 0.4 }), new FadeIn(q, { runTime: 0.4 }));
    await env.untilMark('secant-2', 'line');
    await env.play(new FadeIn(secant, { runTime: 0.6 }));

    await env.untilLine('secant-3');
    // 右边的点沿曲线滑向左边的点,割线跟着转:在「切线」这个词之前 0.3 秒滑到位(至少滑 1 秒)。
    const stop = env.scene.addUpdater(() => {
      const x2 = tracker.getValue();
      secant.setX(x1, x2);
      q.moveTo(axes.toLocal(x2, f(x2)));
    });
    try {
      await env.playUntil({ line: 'secant-3', mark: 'tangent', lead: 0.3 }, new TweenValue(tracker, x1 + 0.02));
    } finally {
      stop();
    }
    // playUntil 返回时正好说到「切线」。
    await env.play(
      new FadeOut(secant, { runTime: 0.4 }),
      new FadeOut(q, { runTime: 0.4 }),
      new FadeIn(tangent, { runTime: 0.6 }),
    );
    await env.play(new Indicate(tangent));
  },
);

const tangentSlope = timedSegment(
  {
    id: 'tangent-slope',
    name: '切线的斜率',
    lines: [
      { id: 'slope-1', text: '切线有多陡,用它的<mark name="k"/>斜率来衡量。' },
      { id: 'slope-2', text: '斜率等于纵向的变化,除以<mark name="dx"/>横向的变化。' },
      { id: 'slope-3', text: '在 x 等于 1 这一点,斜率正好是 2。' },
    ],
  },
  async (env) => {
    const { axes, graph } = makePlot();
    const tangent = new TangentLine(axes, f, 1, { length: 260 }).setStyle({ stroke: '#16a34a', strokeWidth: 3 });
    const p = new Dot(7).moveTo(axes.toLocal(1, 1));
    // 斜率三角形:从切点向右 Δx = 0.5,再沿切线方向向上 Δy = 1。
    const dy = new Line(axes.toLocal(1.5, 1), axes.toLocal(1.5, 2)).setStyle({ stroke: '#ea580c', strokeWidth: 3 });
    const dx = new Line(axes.toLocal(1, 1), axes.toLocal(1.5, 1)).setStyle({ stroke: '#7c3aed', strokeWidth: 3 });
    dy.setRevealFraction(0);
    dx.setRevealFraction(0);
    const plot = new Group().add(axes, graph, tangent, dx, dy, p);
    const formula = new Tex('k = \\frac{\\class{dy}{\\Delta y}}{\\class{dx}{\\Delta x}}').setStyle({ fontSize: 40 });
    formula.moveTo({ x: 330, y: -40 });
    const answer = new Tex("f'(1) = 2").setStyle({ fontSize: 40 });
    answer.moveTo({ x: 330, y: 60 });
    formula.opacity = 0;
    answer.opacity = 0;
    env.scene.add(plot, formula, answer);
    env.scene.fitObjects([plot, formula, answer], 40);

    await env.untilMark('slope-1', 'k');
    formula.opacity = 1;
    await env.playUntil({ end: 'slope-1', min: 0.8 }, new Write(formula));

    await env.untilLine('slope-2');
    await env.play(new Create(dy, { runTime: 0.8 }), new Indicate(formula, { part: 'dy', runTime: 0.8 }));
    await env.untilMark('slope-2', 'dx');
    await env.play(new Create(dx, { runTime: 0.8 }), new Circumscribe(formula, { part: 'dx', runTime: 1 }));

    await env.untilLine('slope-3');
    await env.play(new FadeIn(answer, { runTime: 0.8 }));
    // 强调约 1 秒(最多 1.2 秒),然后静止到这句说完。
    await env.playUntil({ end: 'slope-3', min: 0.6, max: 1.2 }, new Indicate(answer));
  },
);

const derivative = timedSegment(
  {
    id: 'derivative',
    name: '导数',
    lines: [
      { id: 'derivative-1', text: '把每一点的切线斜率都算出来,就得到一个新的函数。' },
      { id: 'derivative-2', text: '它叫做导数,<mark name="name"/>记作 f 撇 x,这里等于 2x。' },
    ],
  },
  async (env) => {
    const { axes, graph } = makePlot();
    const tracker = new ValueTracker(0.2);
    const tangent = new TangentLine(axes, f, tracker.getValue(), { length: 220 }).setStyle({
      stroke: '#16a34a',
      strokeWidth: 3,
    });
    const p = new Dot(7).moveTo(axes.toLocal(tracker.getValue(), f(tracker.getValue())));
    const plot = new Group().add(axes, graph, tangent, p);
    const readout = new Label('斜率 0.40').setStyle({ fontSize: 26 });
    readout.moveTo({ x: 330, y: -60 });
    const result = new Tex("f'(x) = 2x").setStyle({ fontSize: 44 });
    result.moveTo({ x: 330, y: 40 });
    result.opacity = 0;
    env.scene.add(plot, readout, result);
    env.scene.fitObjects([plot, readout, result], 40);

    // 切点沿曲线滑过去,读数跟着变:整句话说多久就滑多久(至少 1 秒)。
    const stop = env.scene.addUpdater(() => {
      const x = tracker.getValue();
      tangent.setX(x);
      p.moveTo(axes.toLocal(x, f(x)));
      readout.setText(`斜率 ${(2 * x).toFixed(2)}`);
    });
    try {
      await env.playThrough('derivative-1', new TweenValue(tracker, 2.2));
    } finally {
      stop();
    }

    await env.untilMark('derivative-2', 'name');
    result.opacity = 1;
    await env.play(new Write(result, { runTime: 1 }));
    await env.playUntil({ end: 'derivative-2', min: 0.6, max: 1.2 }, new Indicate(result));
  },
);

/** 配音演示片:三段,约 20~30 秒。 */
export const voiceDemoFilm: readonly Segment[] = [secantToTangent, tangentSlope, derivative];
