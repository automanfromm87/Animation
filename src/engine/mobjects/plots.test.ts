import { close, equal, fakeCtx, ok, suite, throws } from '../../testing/harness';
import { Create } from '../animations/primitives';
import { linear } from '../animations/rateFunctions';
import { Transform } from '../animations/transform';
import { Write } from '../animations/write';
import { pathBounds } from '../path/path';
import { lightTheme } from '../theme/presets';
import { Axes } from './graphs';
import type { MObject } from './MObject';
import { NumberPlane } from './numberLine';
import {
  AreaUnderCurve,
  RiemannRectangles,
  RiemannTo,
  SecantLine,
  TangentLine,
  gradientColor,
  numericDerivative,
} from './plots';

/** 0..4 × 0..4 映射到 400 × 400 的框:本地 x = 100·x − 200,y = 200 − 100·y。 */
function square(): Axes {
  return new Axes([0, 4], [0, 4], 400, 400);
}

function box(m: MObject): { minX: number; minY: number; maxX: number; maxY: number } {
  const b = pathBounds(m.toPath() ?? { subpaths: [] });
  if (!b) {
    throw new Error('路径是空的');
  }
  return b;
}

function drawnXs(m: MObject): number[] {
  const { calls, ctx } = fakeCtx();
  m.render(ctx, lightTheme);
  return calls
    .filter((c) => c.op === 'moveTo' || c.op === 'lineTo' || c.op === 'bezierCurveTo')
    .flatMap((c) => c.args.filter((_, i) => i % 2 === 0));
}

export default suite('标注图元:面积、黎曼和、切线与割线', [
  [
    'AreaUnderCurve:y = x 在 [0, 2] 上围成的三角形;只取区间里的部分',
    () => {
      const axes = square();
      const area = new AreaUnderCurve(axes, (x) => x, [0, 2], { samples: 4 });
      const b = box(area);
      close(b.minX, -200, 1e-9);
      close(b.maxX, 0, 1e-9);
      close(b.minY, 0, 1e-9);
      close(b.maxY, 200, 1e-9);
      equal(area.toPath().subpaths[0]?.closed, true);
      // 区间超出横轴范围:截到范围里。
      const wide = new AreaUnderCurve(axes, () => 1, [-3, 9]);
      close(box(wide).minX, -200, 1e-9);
      close(box(wide).maxX, 200, 1e-9);
      equal(wide.interval[0], 0);
      equal(wide.interval[1], 4);
    },
  ],
  [
    'AreaUnderCurve:函数值截到纵轴范围,无定义处贴着下边界;两条曲线之间也能填',
    () => {
      const axes = square();
      const tall = new AreaUnderCurve(axes, () => 10, [1, 2]);
      close(box(tall).minY, -200, 1e-9);
      const holes = new AreaUnderCurve(axes, (x) => (x < 2 ? NaN : 1), [1, 3], { samples: 4 });
      const pts = holes.toPath().subpaths[0]?.points ?? [];
      // 第一个点(x = 1)无定义,贴在 y = 0(本地 200)。
      close(pts[1] ?? NaN, 200, 1e-9);
      const between = new AreaUnderCurve(axes, () => 3, [0, 1], { bottom: () => 1 });
      const b = box(between);
      close(b.minY, 200 - 300, 1e-9);
      close(b.maxY, 200 - 100, 1e-9);
    },
  ],
  [
    'AreaUnderCurve:缺省半透明填充、不描边;Create 从左往右扫',
    () => {
      const area = new AreaUnderCurve(square(), (x) => x, [0, 4]);
      const [layer] = area.pathLayers(area.getStyle(lightTheme));
      ok(layer?.paint.fill?.startsWith('rgba'), '缺省应是半透明填充');
      equal(layer?.paint.strokeWidth, 0);
      area.setRevealFraction(0.5);
      const xs = drawnXs(area);
      close(Math.max(...xs), 0, 1e-9);
      close(Math.min(...xs), -200, 1e-9);
      throws(() => new AreaUnderCurve(square(), (x) => x, [2, 1]));
      throws(() => new AreaUnderCurve(square(), (x) => x, [0, NaN]));
      throws(() => new AreaUnderCurve(square(), (x) => x, [0, 1], { samples: 0 }));
    },
  ],
  [
    'RiemannRectangles:左 / 右 / 中点取样的高度与黎曼和',
    () => {
      const axes = square();
      const f = (x: number): number => x * x;
      const left = new RiemannRectangles(axes, f, [0, 2], { n: 4, sample: 'left' });
      equal(left.heights.join(','), '0,0.25,1,2.25');
      close(left.dx, 0.5);
      close(left.sum, (0 + 0.25 + 1 + 2.25) * 0.5, 1e-12);
      const right = new RiemannRectangles(axes, f, [0, 2], { n: 4, sample: 'right' });
      equal(right.heights.join(','), '0.25,1,2.25,4');
      const mid = new RiemannRectangles(axes, f, [0, 2], { n: 4, sample: 'mid' });
      equal(mid.heights.join(','), '0.0625,0.5625,1.5625,3.0625');
      equal(mid.rectangles.length, 4);
      equal(mid.getChildren().length, 4);
    },
  ],
  [
    'RiemannRectangles:每个矩形从 x 轴竖到 f(取样点),负值在轴下,高度截到纵轴范围',
    () => {
      const axes = new Axes([0, 4], [-2, 2], 400, 400);
      const rects = new RiemannRectangles(axes, (x) => (x < 2 ? 1 : -9), [0, 4], { n: 2 });
      const [up, down] = rects.rectangles;
      const bu = box(up as MObject);
      close(bu.minX, -200, 1e-9);
      close(bu.maxX, 0, 1e-9);
      close(bu.maxY, 0, 1e-9);
      close(bu.minY, -100, 1e-9);
      const bd = box(down as MObject);
      close(bd.minY, 0, 1e-9);
      close(bd.maxY, 200, 1e-9);
      equal(rects.heights[1], -9);
      // 纵轴范围不含 0:矩形从离 0 最近的那条边(底边)竖起来。
      const lifted = new Axes([0, 4], [1, 5], 400, 400);
      const standing = new RiemannRectangles(lifted, () => 3, [0, 4], { n: 1 });
      const bs = box(standing.rectangles[0] as MObject);
      close(bs.maxY, 200, 1e-9);
      close(bs.minY, 0, 1e-9);
      // 颜色从左到右渐变。
      const fills = rects.rectangles.map(
        (r) => r.pathLayers(r.getStyle(lightTheme))[0]?.paint.fill,
      );
      ok(fills[0] !== fills[1], '两端颜色应不同');
    },
  ],
  [
    'RiemannTo:细分时新矩形从劈开的旧矩形出发,结束时是新的 n',
    () => {
      const axes = square();
      const f = (x: number): number => x;
      const rects = new RiemannRectangles(axes, f, [0, 4], { n: 2, sample: 'left' });
      const old = rects.rectangles.map((r) => box(r as MObject).minY);
      const to = new RiemannTo(rects, { n: 4 }, { rateFunc: linear });
      to.begin();
      equal(rects.rectangles.length, 4);
      equal(rects.getChildren().length, 4);
      const start = rects.rectangles.map((r) => box(r as MObject).minY);
      // 新矩形 0、1 在旧矩形 0 里,2、3 在旧矩形 1 里。
      close(start[0] ?? NaN, old[0] ?? NaN, 1e-9);
      close(start[1] ?? NaN, old[0] ?? NaN, 1e-9);
      close(start[3] ?? NaN, old[1] ?? NaN, 1e-9);
      to.finish();
      equal(rects.n, 4);
      equal(rects.heights.join(','), '0,1,2,3');
      close(box(rects.rectangles[3] as MObject).minY, 200 - 300, 1e-9);
      close(rects.sum, 6, 1e-12);
      // 只换取样方式。
      const again = new RiemannTo(rects, { sample: 'right' });
      again.begin();
      again.finish();
      equal(rects.heights.join(','), '1,2,3,4');
      rects.set({ n: 1, sample: 'mid' });
      equal(rects.heights.join(','), '2');
    },
  ],
  [
    'RiemannRectangles 参数校验',
    () => {
      const axes = square();
      throws(() => new RiemannRectangles(axes, (x) => x, [0, 1], { n: 0 }));
      throws(() => new RiemannRectangles(axes, (x) => x, [0, 1], { n: 2.5 }));
      throws(() => new RiemannRectangles(axes, (x) => x, [0, 1], { sample: 'center' as never }));
      throws(() => new RiemannRectangles(axes, (x) => x, [1, 0]));
      throws(() => new RiemannRectangles(axes, (x) => x, [0, 1], { colors: [] }));
      const rects = new RiemannRectangles(axes, (x) => x, [0, 1]);
      throws(() => new RiemannTo(rects, { n: -1 }));
      // 无定义的取样点高度按 0。
      const holes = new RiemannRectangles(axes, () => NaN, [0, 1], { n: 2 });
      equal(holes.heights.join(','), '0,0');
    },
  ],
  [
    'RiemannRectangles 与面积能用于 Create / Write / Transform',
    () => {
      const plane = new NumberPlane([-2, 2], [-2, 2], 200, 200);
      const rects = new RiemannRectangles(plane, (x) => x, [-2, 2], { n: 4 });
      ok(rects.supportsReveal);
      const create = new Create(rects);
      create.begin();
      create.interpolate(0.5);
      // 从 x 轴往上长:一半时最右边的矩形(高 1)只长到 0.5。
      const grown = pathBounds(drawnRect(rects.rectangles[3] as MObject));
      close(grown?.minY ?? NaN, plane.c2p(0, 0.5).y, 1e-9);
      create.finish();
      const write = new Write(rects);
      write.begin();
      write.interpolate(0.4);
      ok((rects.getMorphOverlay()?.layers.length ?? 0) > 0);
      write.finish();
      const area = new AreaUnderCurve(plane, (x) => x, [-2, 2]);
      const t = new Transform(rects, area);
      t.begin();
      t.interpolate(0.5);
      ok((rects.getMorphOverlay()?.layers.length ?? 0) >= 4);
      t.finish();
    },
  ],
  [
    'numericDerivative:中心差分;一侧无定义时退成单侧;都无定义为 NaN',
    () => {
      close(numericDerivative((x) => x * x, 3), 6, 1e-6);
      close(numericDerivative(Math.sin, 1e6), Math.cos(1e6), 1e-3);
      close(numericDerivative((x) => (x < 0 ? NaN : 2 * x), 0), 2, 1e-6);
      close(numericDerivative((x) => (x > 0 ? NaN : -x), 0), -1, 1e-6);
      ok(Number.isNaN(numericDerivative(() => NaN, 0)));
    },
  ],
  [
    'TangentLine:切点在正中,方向按坐标系换算,长度可配;setX 沿曲线滑动',
    () => {
      // 横纵比例不同:1 个 x 单位 = 100,1 个 y 单位 = 50。
      const axes = new Axes([0, 4], [0, 8], 400, 400);
      const f = (x: number): number => x * x;
      const tangent = new TangentLine(axes, f, 1, { length: 100 });
      close(tangent.slope, 2, 1e-6);
      const p = tangent.point;
      close(p?.x ?? NaN, axes.toLocal(1, 1).x);
      const pts = tangent.toPath().subpaths[0]?.points ?? [];
      const x0 = pts[0] ?? NaN;
      const y0 = pts[1] ?? NaN;
      const x1 = pts[6] ?? NaN;
      const y1 = pts[7] ?? NaN;
      close(Math.hypot(x1 - x0, y1 - y0), 100, 1e-9);
      close((x0 + x1) / 2, p?.x ?? NaN, 1e-9);
      close((y0 + y1) / 2, p?.y ?? NaN, 1e-9);
      // 本地方向:数学方向 (1, 2) → (100, -100),即 45° 向右上。
      close((y1 - y0) / (x1 - x0), -1, 1e-6);
      tangent.setX(2);
      close(tangent.slope, 4, 1e-6);
      close(tangent.x, 2);
      const moved = tangent.toPath().subpaths[0]?.points ?? [];
      close(((moved[0] ?? 0) + (moved[6] ?? 0)) / 2, axes.toLocal(2, 4).x, 1e-9);
      // 无定义处不画。
      const log = new TangentLine(axes, (x) => (x <= 0 ? NaN : Math.log(x)), 1);
      log.setX(-1);
      equal(log.toPath().subpaths.length, 0);
      throws(() => new TangentLine(axes, f, NaN));
      throws(() => tangent.setX(Infinity));
      throws(() => new TangentLine(axes, f, 1, { length: -1 }));
    },
  ],
  [
    'SecantLine:过两个取样点,可两端延长;两点重合不画',
    () => {
      const axes = square();
      const f = (x: number): number => x;
      const secant = new SecantLine(axes, f, 1, 3);
      close(secant.slope, 1, 1e-12);
      const pts = secant.toPath().subpaths[0]?.points ?? [];
      close(pts[0] ?? NaN, axes.toLocal(1, 1).x);
      close(pts[7] ?? NaN, axes.toLocal(3, 3).y);
      const longer = new SecantLine(axes, f, 1, 3, { extend: 10 });
      const lp = longer.toPath().subpaths[0]?.points ?? [];
      const span = Math.hypot((lp[6] ?? 0) - (lp[0] ?? 0), (lp[7] ?? 0) - (lp[1] ?? 0));
      close(span, Math.hypot(200, 200) + 20, 1e-9);
      secant.setX(2, 2);
      equal(secant.toPath().subpaths.length, 0);
      ok(Number.isNaN(secant.slope));
      secant.setX(0, 4);
      equal(secant.x2, 4);
      equal(secant.points?.length, 2);
      throws(() => new SecantLine(axes, f, 0, 1, { extend: -1 }));
      throws(() => secant.setX(NaN, 1));
    },
  ],
  [
    'gradientColor:两端是色标本身,中间在 OKLab 里插值',
    () => {
      equal(gradientColor(['#ff0000', '#0000ff'], 0), '#ff0000');
      equal(gradientColor(['#ff0000', '#0000ff'], 1), '#0000ff');
      equal(gradientColor(['#123456'], 0.7), '#123456');
      ok(gradientColor(['#ff0000', '#00ff00', '#0000ff'], 0.5) !== '#ff0000');
    },
  ],
]);

/** 渲染一个矩形(可能在生长中),把画出来的点收成路径。 */
function drawnRect(m: MObject): { subpaths: Array<{ points: number[]; closed: boolean }> } {
  const { calls, ctx } = fakeCtx();
  m.render(ctx, lightTheme);
  const points = calls
    .filter((c) => c.op === 'moveTo' || c.op === 'bezierCurveTo')
    .flatMap((c) => c.args);
  return { subpaths: [{ points, closed: true }] };
}
