import { close, equal, fakeCtx, ok, stateAt, suite, throws } from '../../testing/harness';
import { Create } from '../animations/primitives';
import { pathBounds, totalSegments } from '../path/path';
import { resolveStyle } from '../theme/Theme';
import { lightTheme } from '../theme/presets';
import { Axes, FunctionGraph, ParametricCurve2D, Trace, tanFn } from './graphs';
import type { CoordinateSystem } from './graphs';
import { Group } from './Group';

/**
 * 抓出 drawShape 里那条「贯穿整个画高」的竖线,也就是 y 轴本身
 * (刻度线也是竖的,但只有 6px 高,按长度就能区分)。
 */
function yAxisX(axes: Axes, height: number): number | null {
  const { calls, ctx } = fakeCtx();
  axes.render(ctx, lightTheme);
  for (let i = 0; i < calls.length - 1; i++) {
    const a = calls[i];
    const b = calls[i + 1];
    if (
      a?.op === 'moveTo' &&
      b?.op === 'lineTo' &&
      a.args[0] === b.args[0] &&
      Math.abs((a.args[1] ?? 0) - (b.args[1] ?? 0)) >= height - 1e-6
    ) {
      return a.args[0] ?? null;
    }
  }
  return null;
}

export default suite('graphs', [
  [
    'Axes 拒绝退化区间(否则 toLocal 除零,整张图静默消失)',
    () => {
      throws(() => new Axes([1, 1], [0, 1], 100, 100));
      throws(() => new Axes([0, 1], [5, 2], 100, 100));
      throws(() => new Axes([0, 1], [0, 1], 0, 100));
    },
  ],
  [
    'Axes 拷贝 range,调用方之后改自己的元组不会让曲线与刻度错位',
    () => {
      const xr: [number, number] = [0, 5];
      const axes = new Axes(xr, [0, 4], 480, 360);
      const before = axes.toLocal(2.5, 0).x;
      xr[1] = 50;
      close(axes.toLocal(2.5, 0).x, before, 1e-12);
    },
  ],
  [
    'toLocal:左下角映射到局部 (-w/2, +h/2),y 轴翻转',
    () => {
      const axes = new Axes([0, 10], [0, 4], 200, 100);
      const lo = axes.toLocal(0, 0);
      close(lo.x, -100);
      close(lo.y, 50);
      const hi = axes.toLocal(10, 4);
      close(hi.x, 100);
      close(hi.y, -50);
    },
  ],
  [
    '区间全为正时 y 轴贴左边框(以前这个分支画反了)',
    () => {
      // x=0 在区间左侧,y 轴就该贴左边框。
      equal(yAxisX(new Axes([1, 10], [0, 100], 400, 300), 300), -200);
    },
  ],
  [
    '区间全为负时 y 轴贴右边框',
    () => {
      equal(yAxisX(new Axes([-10, -1], [0, 100], 400, 300), 300), 200);
    },
  ],
  [
    '区间跨 0 时 y 轴过原点',
    () => {
      equal(yAxisX(new Axes([-1, 3], [0, 10], 400, 300), 300), -100);
    },
  ],
  [
    'FunctionGraph 在 tan 的极点处断笔,不画穿屏直线',
    () => {
      const axes = new Axes([-3, 3], [-100, 100], 400, 300);
      const graph = new FunctionGraph(tanFn, axes, 200);
      let longJumps = 0;
      for (let i = 1; i < graph.points.length; i++) {
        const prev = graph.points[i - 1];
        const cur = graph.points[i];
        if (!prev || !cur || graph.breaks[i]) {
          continue;
        }
        if (
          Number.isFinite(prev.y) &&
          Number.isFinite(cur.y) &&
          Math.abs(cur.y - prev.y) > 150
        ) {
          longJumps += 1;
        }
      }
      equal(longJumps, 0, `还有 ${longJumps} 段跨越极点的连线`);
    },
  ],
  [
    'FunctionGraph 把越界与无定义的采样点记成断点',
    () => {
      const axes = new Axes([-1, 1], [0, 1], 100, 100);
      const graph = new FunctionGraph((x) => (x < 0 ? NaN : x), axes, 10);
      const first = graph.points[0];
      ok(first !== undefined && Number.isNaN(first.x));
      ok(graph.breaks[0] === true);
    },
  ],
  [
    'Trace.getPoints 是快照,改它不会动到内部点列',
    () => {
      const trace = new Trace();
      trace.addPoint({ x: 1, y: 2 });
      const snap = trace.getPoints();
      snap[0]!.x = 999;
      trace.addPoint({ x: 3, y: 4 });
      equal(snap.length, 1);
      equal(trace.getPoints()[0]?.x, 1);
    },
  ],
  [
    '陡峭但连续的过零点不会被误判成极点(以前 tanh 会被劈成两段)',
    () => {
      const axes = new Axes([-1, 1], [-1.2, 1.2], 400, 300);
      const graph = new FunctionGraph((x) => Math.tanh(100 * x), axes, 201);
      let breakCount = 0;
      for (let i = 1; i < graph.breaks.length; i++) {
        if (graph.breaks[i]) {
          breakCount += 1;
        }
      }
      equal(breakCount, 0, `连续曲线上出现了 ${breakCount} 个断口`);
    },
  ],
  [
    '无穷区间不会让构造函数死循环(刻度直接不画)',
    () => {
      // 旧实现在这里会用步长 1 遍历 1e308 量级区间,当场耗尽内存。
      const wide = new Axes([-1e308, 1e308], [0, 1], 400, 300);
      ok(wide instanceof Axes);
      const inf = new Axes([0, Number.MAX_VALUE], [0, 1], 400, 300);
      ok(inf instanceof Axes);
    },
  ],
  [
    'Trace 链式写入',
    () => {
      const trace = new Trace().setPoints([{ x: 0, y: 0 }]).addPoint({ x: 1, y: 1 });
      equal(trace.length, 2);
      equal(trace.clear().length, 0);
    },
  ],
  [
    '刻度循环按整数下标遍历:大偏移不死循环、极小范围不卡顿',
    () => {
      const t0 = Date.now();
      const tiny = new Axes([0, 1e-16], [0, 1], 400, 300);
      const huge = new Axes([1e16, 1e16 + 4], [0, 1], 400, 300);
      ok(Date.now() - t0 < 200, `构造耗时 ${Date.now() - t0}ms`);
      ok(tiny.getBox().size.w > 0 && huge.getBox().size.w > 0);
    },
  ],
  [
    '常见范围的刻度数字正确,-0 不会出现',
    () => {
      const axes = new Axes([-1, 1], [0, 10], 200, 100);
      const { calls, ctx } = fakeCtx();
      axes.render(ctx, lightTheme);
      const texts = calls.filter((c) => c.op === 'fillText').map((c) => String(c.value));
      // x:[-1,1] 分 6 格 → 步长 0.2;y:[0,10] 分 5 格 → 步长 2。
      for (const t of ['-1', '-0.4', '0', '0.6', '1', '2', '10']) {
        ok(texts.includes(t), `缺少刻度 ${t}:${texts.join(' ')}`);
      }
      ok(!texts.includes('-0'));
      ok(!texts.includes('0.30000000000000004'), '浮点残差没有被格式化掉');
    },
  ],
  [
    '包围盒覆盖刻度数字与轴名(取景不裁字)',
    () => {
      const axes = new Axes([1, 10], [0, 100], 200, 100, { x: 'time (s)', y: 'y' });
      const box = axes.getBox();
      const left = box.center.x - box.size.w / 2;
      const right = box.center.x + box.size.w / 2;
      const top = box.center.y - box.size.h / 2;
      ok(left < -100 - 10, 'y 轴刻度数字(贴左边框)伸出了盒子');
      ok(right > 100 + 30, 'x 轴名伸出了盒子');
      ok(top < -50 - 10, 'y 轴名伸出了盒子');
      ok(axes.getCullRadius() >= Math.hypot(right, top) - 1e-6);
    },
  ],
  [
    'strokeWidth 为 0 时函数图像、轨迹与坐标轴都不描边',
    () => {
      const axes = new Axes([0, 1], [0, 1], 100, 100).setStyle({ strokeWidth: 0 });
      const graph = new FunctionGraph((x) => x, axes).setStyle({ strokeWidth: 0 });
      const trace = new Trace()
        .addPoint({ x: 0, y: 0 })
        .addPoint({ x: 1, y: 1 })
        .setStyle({ strokeWidth: 0 });
      for (const m of [axes, graph, trace]) {
        const { calls, ctx } = fakeCtx();
        m.render(ctx, lightTheme);
        equal(calls.filter((c) => c.op === 'stroke').length, 0, `${m.constructor.name} 还在描边`);
      }
      const { calls, ctx } = fakeCtx();
      new FunctionGraph((x) => x, axes).render(ctx, lightTheme);
      equal(stateAt(calls, 'stroke', 'lineWidth'), lightTheme.strokeWidth);
    },
  ],
  [
    'Trace.setPoints 复用点对象,不逐帧分配整条轨迹',
    () => {
      const trace = new Trace();
      trace.setPoints([
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ]);
      const inner = (trace as unknown as { pts: Array<{ x: number }> }).pts;
      const first = inner[0];
      trace.setPoints([
        { x: 5, y: 5 },
        { x: 6, y: 6 },
        { x: 7, y: 7 },
      ]);
      ok(inner[0] === first, '点对象被重新分配了');
      equal(trace.length, 3);
      close(trace.getPoints()[2]?.x ?? 0, 7, 1e-9);
      trace.setPoints([{ x: 1, y: 1 }]);
      equal(trace.length, 1);
    },
  ],
  [
    '函数图像是路径图元:断点处另起子路径、路径只建一次;Create 按弧长生长',
    () => {
      const axes = new Axes([-3, 3], [-100, 100], 400, 300);
      const graph = new FunctionGraph(tanFn, axes, 200);
      const path = graph.toPath();
      ok(path.subpaths.length >= 2, `tan 的极点处应断开,只有 ${path.subpaths.length} 条子路径`);
      ok(path.subpaths.every((sub) => !sub.closed));
      ok(graph.toPath() === path, '采样点只读,路径不该重建');
      const whole = totalSegments(path);
      graph.setRevealFraction(0.5);
      const { calls, ctx } = fakeCtx();
      graph.render(ctx, lightTheme);
      const drawn = calls.filter((c) => c.op === 'bezierCurveTo').length;
      ok(drawn > 0 && drawn < whole, `生长一半画了 ${drawn}/${whole} 段`);
      equal(calls.filter((c) => c.op === 'fill').length, 0, '曲线不该填充');
      const curve = new ParametricCurve2D((t) => [Math.cos(t), Math.sin(t)], new Axes([-2, 2], [-2, 2], 100, 100), [0, Math.PI]);
      const b = pathBounds(curve.toPath());
      close(b?.minY ?? NaN, -25, 1e-9);
    },
  ],
  [
    'Trace:点列一变路径就重建,没变就复用',
    () => {
      const trace = new Trace().addPoint({ x: 0, y: 0 }).addPoint({ x: 10, y: 0 });
      const p = trace.toPath();
      ok(trace.toPath() === p);
      trace.addPoint({ x: 10, y: 10 });
      const q = trace.toPath();
      ok(q !== p);
      equal(totalSegments(q), 2);
      trace.setPoints([
        { x: 0, y: 0 },
        { x: 5, y: 5 },
      ]);
      equal(totalSegments(trace.toPath()), 1);
      equal(totalSegments(trace.clear().toPath()), 0);
    },
  ],
  [
    'Axes 的线条按层给出(两轴、刻度、箭头),刻度数字与轴名单独交叉淡化',
    () => {
      const axes = new Axes([-1, 3], [0, 10], 400, 300);
      const style = resolveStyle(lightTheme);
      const layers = axes.pathLayers(style);
      equal(layers.length, 4);
      equal(layers[0]?.paint.strokeWidth, lightTheme.strokeWidth - 1, '轴线比曲线细一号');
      equal(layers[3]?.paint.fill, lightTheme.stroke, '箭头用描边色填满');
      const b = pathBounds(axes.toPath());
      close(b?.maxX ?? NaN, 200, 1e-9);
      const { calls, ctx } = fakeCtx();
      axes.drawMorphResidual(ctx, style);
      ok(calls.some((c) => c.op === 'fillText' && c.value === '2'));
      equal(calls.filter((c) => c.op === 'stroke' || c.op === 'fill').length, 0, '交叉淡化的只有文字');
      const hidden = axes.pathLayers(resolveStyle(lightTheme, { strokeWidth: 0 }));
      ok(
        hidden.every((l) => l.paint.fill === null && !(l.paint.strokeWidth > 0)),
        '线宽为 0 时线条与箭头都不该画',
      );
    },
  ],
  [
    'Axes 支持 Create:轴线按长度画出来,箭头与文字在后半程淡入',
    () => {
      const axes = new Axes([-1, 3], [0, 10], 400, 300);
      ok(axes.supportsReveal);
      axes.setRevealFraction(0.25);
      let rec = fakeCtx();
      axes.render(rec.ctx, lightTheme);
      // 第一笔是 x 轴(y = 150,纵轴范围从 0 开始,轴贴底边):从 -200 画到 -200 + 400 × 0.25 = -100。
      const firstStroke = rec.calls.findIndex((c) => c.op === 'stroke');
      const xAxis = rec.calls
        .slice(0, firstStroke)
        .filter((c) => c.op === 'moveTo' || c.op === 'bezierCurveTo')
        .flatMap((c) => c.args);
      close(Math.min(...xAxis.filter((_, i) => i % 2 === 0)), -200, 1e-9);
      close(Math.max(...xAxis.filter((_, i) => i % 2 === 0)), -100, 1e-9);
      ok(xAxis.filter((_, i) => i % 2 === 1).every((y) => y === 150));
      equal(rec.calls.filter((c) => c.op === 'fillText').length, 0, '前半程不该有文字');
      axes.setRevealFraction(0.75);
      rec = fakeCtx();
      axes.render(rec.ctx, lightTheme);
      ok(rec.calls.some((c) => c.op === 'fillText'));
      close(Number(stateAt(rec.calls, 'fillText', 'globalAlpha')), 0.5, 1e-12);
      // 坐标系 + 曲线的组整体 Create。
      const plot = new Group().add(axes, new FunctionGraph((x) => x, axes));
      const create = new Create(plot);
      create.begin();
      create.interpolate(0.5);
      create.finish();
      equal(axes.getRevealFraction(), null);
    },
  ],
  [
    'FunctionGraph / ParametricCurve2D 只要一个坐标系(CoordinateSystem),不一定是 Axes',
    () => {
      const coords: CoordinateSystem = {
        xRange: [0, 1],
        yRange: [0, 1],
        width: 100,
        height: 100,
        toLocal: (x, y) => ({ x: x * 100, y: -y * 100 }),
      };
      const graph = new FunctionGraph((x) => x, coords, 4);
      close(graph.points[4]?.x ?? NaN, 100);
      close(graph.points[4]?.y ?? NaN, -100);
      const curve = new ParametricCurve2D((t) => [t, t * t], coords, [0, 1], 2);
      close(curve.points[1]?.y ?? NaN, -25);
    },
  ],
]);
