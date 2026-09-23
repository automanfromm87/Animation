import {
  close,
  equal,
  fakeCtx,
  ok,
  stateAt,
  suite,
  throws,
} from '../../testing/harness';
import type { FakeCtxCall } from '../../testing/harness';
import { Create } from '../animations/primitives';
import { Cube } from '../mobjects3d/solids';
import { PathBuilder, pathBounds } from '../path/path';
import { resolveStyle } from '../theme/Theme';
import { lightTheme } from '../theme/presets';
import { Group } from './Group';
import type { MObject } from './MObject';
import {
  Annotation,
  Arc,
  Arrow,
  Circle,
  Dot,
  Label,
  Line,
  Polygon,
  Rectangle,
  Sector,
  Square,
  Star,
  SvgPath,
  Triangle,
} from './shapes';

/** 渲染一个对象,返回记录下来的画布调用。 */
function draw(m: MObject): FakeCtxCall[] {
  const { ctx, calls } = fakeCtx();
  m.render(ctx, lightTheme);
  return calls;
}

/** 第 nth 次 stroke 时的描边色。 */
function strokeColor(calls: readonly FakeCtxCall[], nth = 0): unknown {
  return stateAt(calls, 'stroke', 'strokeStyle', nth);
}

function count(calls: readonly FakeCtxCall[], op: string): number {
  return calls.filter((c) => c.op === op).length;
}

/** 路径各段的端点(moveTo 的点与每段 bezierCurveTo 的终点)。 */
function segmentEnds(calls: readonly FakeCtxCall[]): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (const c of calls) {
    if (c.op === 'moveTo') {
      out.push([c.args[0] ?? NaN, c.args[1] ?? NaN]);
    } else if (c.op === 'bezierCurveTo') {
      out.push([c.args[4] ?? NaN, c.args[5] ?? NaN]);
    }
  }
  return out;
}

/**
 * 生长中的 Arc/Sector 画出来的扫角:沿圆周上的端点逐段累加转角(每段不超过 90°,不会绕错圈)。
 * 扇形的两条半径端点在圆心,不在圆周上,不计。
 */
function sweepAt(shape: Arc | Sector, f: number): number {
  shape.setRevealFraction(f);
  const onArc = segmentEnds(draw(shape)).filter(([x, y]) => Math.hypot(x, y) > shape.radius / 2);
  let sweep = 0;
  for (let i = 1; i < onArc.length; i++) {
    const [x0 = 0, y0 = 0] = onArc[i - 1] ?? [];
    const [x1 = 0, y1 = 0] = onArc[i] ?? [];
    let d = Math.atan2(y1, x1) - Math.atan2(y0, x0);
    d -= Math.round(d / (Math.PI * 2)) * Math.PI * 2;
    sweep += d;
  }
  return onArc.length > 0 ? sweep : NaN;
}

export default suite('shapes', [
  [
    'Rectangle / Square 支持 Create 生长',
    () => {
      ok(new Rectangle(10, 10).supportsReveal);
      ok(new Square(10).supportsReveal);
      const anim = new Create(new Square(90), { runTime: 1 });
      anim.begin();
      anim.interpolate(0.5);
      anim.finish();
      ok(true);
    },
  ],
  [
    'Create:空 Group 可以先构造、播放前再填满;不支持生长的对象在 begin 时点名报错',
    () => {
      const g = new Group();
      const anim = new Create(g);
      g.add(new Circle(5), new Line({ x: 0, y: 0 }, { x: 1, y: 1 }));
      anim.begin();
      anim.finish();
      const bad = new Group().add(new Circle(5), new Annotation('A'));
      let message = '';
      try {
        new Create(bad).begin();
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      ok(message.includes('Annotation'), `报错没有点名不支持的子元素:${message}`);
    },
  ],
  [
    'Create.finish 遵守 rateFunc(1):往返缓动结束时回到「没画出来」',
    () => {
      const c = new Circle(10);
      const anim = new Create(c, { rateFunc: (t) => 4 * t * (1 - t) });
      anim.begin();
      anim.finish();
      equal(c.getRevealFraction(), 0);
      const normal = new Create(c);
      normal.begin();
      normal.finish();
      equal(c.getRevealFraction(), null);
    },
  ],
  [
    'Triangle 的包围盒用真实顶点,不是外接圆',
    () => {
      const tri = new Triangle(44);
      const box = tri.getBox();
      // 正三角形外接圆半径 44,高 = 1.5R,宽 = √3·R。
      close(box.size.h, 44 * 1.5, 1e-9);
      close(box.size.w, 44 * Math.sqrt(3), 1e-9);
      ok(Math.abs(box.center.y) > 1, '中心相对原点应有偏移');
    },
  ],
  [
    '扇形的包围盒贴合真实弧段,不是整圆',
    () => {
      const sector = new Sector(42, 0, Math.PI / 2);
      const box = sector.getBox();
      close(box.size.w, 42, 1e-9);
      close(box.size.h, 42, 1e-9);
      close(box.center.x, 21, 1e-9);
      close(box.center.y, 21, 1e-9);
    },
  ],
  [
    '跨越 90° 极值点的圆弧仍然被完整框住',
    () => {
      const arc = new Arc(10, -Math.PI / 4, Math.PI / 4);
      const box = arc.getBox();
      close(box.center.x + box.size.w / 2, 10, 1e-9);
    },
  ],
  [
    'endAngle 比 startAngle 小超过一整圈时,盒仍覆盖真实扫过的弧',
    () => {
      const box = new Arc(50, 0, -Math.PI * 3).getBox();
      close(box.size.w, 100, 1e-6);
      ok(box.size.h > 45, `高度塌成了 ${box.size.h}`);
      const sector = new Sector(50, 0, -Math.PI * 3).getBox();
      ok(sector.size.h > 45, `扇形高度塌成了 ${sector.size.h}`);
    },
  ],
  [
    'Arc/Sector 反向或超一圈时,生长扫角随进度单调增加并与最终形状一致',
    () => {
      // 0 → -π/2 实际是沿正方向扫 3π/2(3/4 圆)。以前 f 很小时 canvas 会画近乎整圆再往回缩。
      const arc = new Arc(40, 0, -Math.PI / 2);
      let prev = -1;
      for (const f of [0.05, 0.5, 0.95]) {
        const sweep = sweepAt(arc, f);
        ok(sweep > prev, `扫角没有单调增加:f=${f} sweep=${sweep}`);
        close(sweep, 1.5 * Math.PI * f, 1e-9);
        prev = sweep;
      }
      // 超一圈按整圆:f=2/3 时还没画完。
      const over = new Arc(40, 0, 3 * Math.PI);
      close(sweepAt(over, 2 / 3), (4 * Math.PI) / 3, 1e-9);
      close(sweepAt(new Sector(40, 0, -Math.PI / 2), 0.5), 0.75 * Math.PI, 1e-9);
    },
  ],
  [
    '负半径在构造期就被拒绝(不会等到 ctx.arc 抛 IndexSizeError 打死帧循环)',
    () => {
      throws(() => new Circle(-10));
      throws(() => new Arc(-1));
      throws(() => new Rectangle(Number.NaN, 20));
      throws(() => new Line({ x: 0, y: Number.NaN }, { x: 1, y: 1 }));
    },
  ],
  [
    '半径被动画写成负数时绘制端钳住,不抛错',
    () => {
      const circle = new Circle(10);
      circle.radius = -5;
      const calls = draw(circle);
      equal(count(calls, 'bezierCurveTo'), 0, '钳到 0 的圆不该画出任何轮廓');
      equal(count(calls, 'stroke') + count(calls, 'fill'), 0);
      circle.radius = 10;
      equal(count(draw(circle), 'bezierCurveTo'), 4, '半径改回来之后路径缓存没有跟着更新');
    },
  ],
  [
    'strokeWidth 为 0 时 Line / Arrow / Arc / Circle 都不描边(不留发丝线)',
    () => {
      for (const m of [
        new Line({ x: 0, y: 0 }, { x: 10, y: 0 }),
        new Arrow({ x: 0, y: 0 }, { x: 10, y: 0 }),
        new Arc(10),
        new Circle(10),
      ]) {
        m.setStyle({ strokeWidth: 0 });
        equal(count(draw(m), 'stroke'), 0, `${m.constructor.name} 仍然描了边`);
      }
    },
  ],
  [
    'Arrow 的包围盒覆盖宽箭头的整个头部',
    () => {
      const arrow = new Arrow({ x: 0, y: 0 }, { x: 100, y: 0 });
      arrow.headLength = 5;
      arrow.headWidth = 40;
      const box = arrow.getBox();
      ok(box.size.h >= 40, `头宽 40 的箭头盒高只有 ${box.size.h}`);
      ok(arrow.getCullRadius() >= 100 + 20);
    },
  ],
  [
    'Annotation 的包围盒覆盖锚点与徽标',
    () => {
      const ann = new Annotation('A', { offset: { x: 30, y: -30 } });
      const box = ann.getBox();
      ok(box.size.w >= 30);
      ok(box.size.h >= 30);
    },
  ],
  [
    'Polygon:闭合多边形可填充,折线只描边;生长沿周长推进',
    () => {
      const pts = [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ];
      const tri = new Polygon(pts).setStyle({ fill: '#eee' });
      ok(tri.supportsReveal);
      const closed = draw(tri);
      equal(count(closed, 'fill'), 1);
      equal(count(closed, 'closePath'), 1);
      const open = draw(new Polygon(pts, { closed: false }));
      equal(count(open, 'fill'), 0);
      equal(count(open, 'closePath'), 0);
      // 折线 2 段等长,f=0.5 时按弧长正好画到第二个顶点。
      const growing = new Polygon(pts, { closed: false });
      growing.setRevealFraction(0.5);
      const segments = draw(growing).filter((c) => c.op === 'bezierCurveTo');
      equal(segments.length, 1);
      close(segments[0]?.args[4] ?? NaN, 10, 1e-9);
      close(segments[0]?.args[5] ?? NaN, 0, 1e-9);
      // 闭合多边形生长中还没合拢:只描边、不填充、不闭合。
      tri.setRevealFraction(0.5);
      const partial = draw(tri);
      equal(count(partial, 'fill'), 0);
      equal(count(partial, 'closePath'), 0);
      tri.setRevealFraction(null);
      const box = tri.getBox();
      equal(box.size.w, 10);
      throws(() => new Polygon([{ x: Number.NaN, y: 0 }]));
    },
  ],
  [
    'Group.setStyle 在渲染时作用于子树,后加入的子元素也继承',
    () => {
      const g = new Group();
      const a = new Circle(10);
      g.add(a);
      g.setStyle({ stroke: '#e11' });
      const b = new Circle(20);
      g.add(b);
      const calls = draw(g);
      equal(strokeColor(calls, 0), '#e11');
      equal(strokeColor(calls, 1), '#e11', '后加入的子元素也应继承');
      // 子元素自己的样式没被写脏:脱离容器时还是主题色。
      equal(a.getStyle(lightTheme).stroke, lightTheme.stroke);
    },
  ],
  [
    '容器样式抢不走子元素自己设过的键',
    () => {
      const g = new Group();
      const child = new Label('x').setStyle({ textColor: '#child', fontSize: 48 });
      g.setStyle({ textColor: '#container', fontSize: 20 });
      g.add(child);
      const calls = draw(g);
      equal(stateAt(calls, 'fillText', 'fillStyle'), '#child', '子元素自设的颜色被容器抢走了');
      ok(String(stateAt(calls, 'fillText', 'font')).startsWith('48px'), '子元素自设的字号被容器抢走了');
      const plain = new Label('y');
      g.add(plain);
      const calls2 = draw(g);
      equal(stateAt(calls2, 'fillText', 'fillStyle', 1), '#container', '没设过的键应该继承容器的');
      ok(String(stateAt(calls2, 'fillText', 'font', 1)).startsWith('20px'));
    },
  ],
  [
    '容器可以反复改自己的样式,子树跟着变',
    () => {
      const g = new Group();
      g.add(new Circle(10));
      g.setStyle({ stroke: '#a' });
      equal(strokeColor(draw(g)), '#a');
      g.setStyle({ stroke: '#b' });
      equal(strokeColor(draw(g)), '#b', '继承样式缓存没有随容器样式失效');
    },
  ],
  [
    'setStyle 忽略 undefined,不会把已有值抹回主题默认',
    () => {
      const c = new Circle(10).setStyle({ fontSize: 48 });
      c.setStyle({ fontSize: undefined });
      equal(c.getStyle(lightTheme).fontSize, 48);
    },
  ],
  [
    'Group 的 opacity 作用于整组,不进子元素自己的样式',
    () => {
      const g = new Group();
      const child = new Circle(10);
      g.add(child);
      g.opacity = 0.3;
      equal(child.getStyle(lightTheme).opacity, 1);
      const calls = draw(g);
      close(Number(stateAt(calls, 'stroke', 'globalAlpha')), 0.3, 1e-9);
    },
  ],
  [
    '不透明度为 NaN 或越界时:NaN 不画,超过 1 钳到 1',
    () => {
      const c = new Circle(10);
      c.opacity = Number.NaN;
      equal(draw(c).length, 0, 'NaN 透明度的对象被画出来了');
      c.opacity = 1.5;
      close(Number(stateAt(draw(c), 'stroke', 'globalAlpha')), 1, 1e-9);
    },
  ],
  [
    '三层嵌套:中间容器设过的键挡住祖先',
    () => {
      const outer = new Group();
      const mid = new Group();
      const leaf = new Circle(10);
      mid.add(leaf);
      mid.setStyle({ stroke: '#MID' });
      outer.add(mid);
      outer.setStyle({ stroke: '#OUTER', fill: '#F00' });
      const calls = draw(outer);
      equal(strokeColor(calls), '#MID', '祖先的值绕过中间容器刷到了叶子');
      equal(stateAt(calls, 'fill', 'fillStyle'), '#F00', '中间容器没挡的键应该照常传到底');
    },
  ],
  [
    '移出容器后按自身/主题样式画,不带走旧容器的配色',
    () => {
      const g = new Group();
      const c = new Circle(10);
      g.setStyle({ stroke: '#aaa' });
      g.add(c);
      equal(strokeColor(draw(g)), '#aaa');
      g.remove(c);
      equal(strokeColor(draw(c)), lightTheme.stroke);
      const mine = new Circle(10).setStyle({ stroke: '#mine' });
      g.add(mine);
      g.remove(mine);
      equal(strokeColor(draw(mine)), '#mine');
    },
  ],
  [
    '构造默认样式经过容器往返后还在(3D 网格默认线宽 2)',
    () => {
      const cube = new Cube(50);
      const g = new Group().setStyle({ strokeWidth: 5 });
      g.add(cube);
      equal(stateAt(draw(g), 'stroke', 'lineWidth'), 5);
      g.remove(cube);
      equal(stateAt(draw(cube), 'stroke', 'lineWidth'), 2, '默认线宽被往返抹掉了');
    },
  ],
  [
    '同一对象挂在两个容器下各自按所在位置解析;从一个容器移出不影响另一个',
    () => {
      const g1 = new Group().setStyle({ stroke: 'red' });
      const g2 = new Group().setStyle({ stroke: 'blue' });
      const c = new Circle(10);
      g1.add(c);
      g2.add(c);
      equal(strokeColor(draw(g1)), 'red');
      equal(strokeColor(draw(g2)), 'blue');
      g1.remove(c);
      equal(strokeColor(draw(g2)), 'blue', '从 g1 移出后 g2 里的样式被回滚了');
      equal(count(draw(g1), 'stroke'), 0);
    },
  ],
  [
    '虚线是可继承的样式键:容器设 dash,子元素的描边都变虚线',
    () => {
      const g = new Group().setStyle({ dash: [4, 2] });
      g.add(new Line({ x: 0, y: 0 }, { x: 10, y: 0 }), new Circle(5));
      const dashes = draw(g).filter((c) => c.op === 'setLineDash');
      equal(dashes.length, 2);
      equal(JSON.stringify(dashes[0]?.value), '[4,2]');
      // 旧写法 line.dash = [...] 仍然可用。
      const line = new Line({ x: 0, y: 0 }, { x: 1, y: 0 });
      line.dash = [6, 5];
      equal(JSON.stringify(draw(line).find((c) => c.op === 'setLineDash')?.value), '[6,5]');
    },
  ],
  [
    '重复加入同一容器只保留一份;remove 之后不留残影',
    () => {
      const g = new Group();
      const c = new Circle(5);
      g.add(c, c);
      equal(g.getChildren().length, 1);
      g.remove(c);
      equal(g.getChildren().length, 0);
    },
  ],
  [
    '加入自身或祖先会形成环,直接拒绝',
    () => {
      const outer = new Group();
      const inner = new Group();
      outer.add(inner);
      throws(() => outer.add(outer));
      throws(() => inner.add(outer));
    },
  ],
  [
    'Group.getChildren 是活视图,remove 之后仍然有效',
    () => {
      const g = new Group();
      const a = new Circle(1);
      const b = new Circle(2);
      g.add(a, b);
      const kids = g.getChildren();
      g.remove(a);
      equal(kids.length, 1);
      equal(kids[0], b);
    },
  ],
  [
    'Group 剔除半径覆盖所有子元素',
    () => {
      const g = new Group();
      const a = new Circle(10);
      a.moveTo({ x: 100, y: 0 });
      g.add(a);
      ok(g.getCullRadius() >= 110);
    },
  ],
  [
    'drawShape 抛错时 save/restore 依然成对',
    () => {
      const bad = new Circle(5);
      (bad as unknown as { drawShape: () => void }).drawShape = () => {
        throw new Error('boom');
      };
      const { ctx, calls } = fakeCtx();
      throws(() => bad.render(ctx, lightTheme));
      equal(count(calls, 'save'), count(calls, 'restore'));
    },
  ],
  [
    'Label 支持 Create:逐字写出,字在最终位置出现;Dot 从圆心长大',
    () => {
      const label = new Label('一二三四');
      ok(label.supportsReveal);
      label.setRevealFraction(0.5);
      const partial = draw(label).find((c) => c.op === 'fillText');
      equal(partial?.value, '一二');
      equal(partial?.args[0], -(4 * 8) / 2, '部分文字没有落在最终位置(左端对齐到整串的左端)');
      label.setRevealFraction(null);
      equal(draw(label).find((c) => c.op === 'fillText')?.value, '一二三四');
      const dot = new Dot(10);
      ok(dot.supportsReveal);
      dot.setRevealFraction(0.25);
      // 圆周上的端点离圆心都是 2.5(控制点的坐标分量也不超过半径)。
      const reach = Math.max(...segmentEnds(draw(dot)).map(([x, y]) => Math.hypot(x, y)));
      close(reach, 2.5, 1e-9);
      const d = new Group().add(new Label('x'), new Circle(3));
      ok(d.supportsReveal, '含 Label 的组应当可以 Create 了');
    },
  ],
  [
    '多参数构造器支持选项对象写法,与位置参数等价',
    () => {
      const a1 = new Arc(30, 0.5, 2);
      const a2 = new Arc({ radius: 30, startAngle: 0.5, endAngle: 2 });
      equal(a2.radius, a1.radius);
      equal(a2.endAngle, a1.endAngle);
      const sec = new Sector({ radius: 20 });
      equal(sec.endAngle, Math.PI / 2);
      const star = new Star({ points: 6, outerRadius: 40 });
      equal(star.points.length, 12);
      equal(star.innerRadius, 22);
    },
  ],
  [
    'Group.getBox:子元素的位置、缩放与旋转都并入外接盒;空组为 0',
    () => {
      const scaled = new Rectangle(20, 10);
      scaled.scale = 2;
      scaled.moveTo({ x: 10, y: 0 });
      const turned = new Rectangle(40, 10);
      turned.rotation = Math.PI / 2;
      const box = new Group().add(scaled, turned).getBox();
      close(box.size.w, 40, 1e-9);
      close(box.size.h, 40, 1e-9);
      close(box.center.x, 10, 1e-9);
      close(box.center.y, 0, 1e-9);
      const empty = new Group().getBox();
      equal(empty.size.w, 0);
      equal(empty.size.h, 0);
    },
  ],
  [
    'PathShape:几何参数不变时复用同一条路径(Path2D 与弧长表跟着命中),参数一改就重建',
    () => {
      const c = new Circle(10);
      const p = c.toPath();
      ok(c.toPath() === p, '同样的半径每次都重建了路径');
      c.radius = 20;
      ok(c.toPath() !== p);
      close(pathBounds(c.toPath())?.maxX ?? NaN, 20, 1e-9);
      equal(c.getCullRadius(), 20);
      const line = new Line({ x: 0, y: 0 }, { x: 10, y: 0 });
      const lp = line.toPath();
      line.end.x = 30;
      ok(line.toPath() !== lp, '原地改端点坐标后路径没有重建');
      const poly = new Polygon([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 10 },
      ]);
      const pp = poly.toPath();
      poly.setPoints([
        { x: 0, y: 0 },
        { x: 40, y: 0 },
        { x: 0, y: 40 },
      ]);
      ok(poly.toPath() !== pp);
      equal(poly.getCullRadius(), 40);
      const star = new Star(5, 40, 20);
      ok(star.toPath() === star.toPath(), '只读顶点的图元应当只建一次路径');
    },
  ],
  [
    'SvgPath:SVG 路径串或 PathData 直接成图元,支持样式、Create 与包围盒',
    () => {
      const s = new SvgPath('M0 0 L40 0 L40 20 Z').setStyle({ fill: '#abcdef' });
      ok(s.supportsReveal);
      const box = s.getBox();
      close(box.size.w, 40, 1e-9);
      close(box.size.h, 20, 1e-9);
      close(box.center.x, 20, 1e-9);
      close(s.getCullRadius(), Math.hypot(40, 20), 1e-9);
      const full = draw(s);
      equal(count(full, 'fill'), 1);
      equal(count(full, 'stroke'), 1);
      equal(count(full, 'closePath'), 1);
      // 周长 40 + 20 + √2000 ≈ 104.7:一半还在第二条边上,截断的路径不闭合。
      s.setRevealFraction(0.5);
      const half = draw(s);
      equal(count(half, 'closePath'), 0);
      const ends = segmentEnds(half);
      const [lx = NaN, ly = NaN] = ends[ends.length - 1] ?? [];
      close(lx, 40, 1e-6);
      ok(ly > 10 && ly < 20, `半程终点 ${ly}`);
      s.setRevealFraction(null);
      s.setPath(new PathBuilder().moveTo(0, 0).lineTo(5, 5).build());
      close(s.getBox().size.w, 5, 1e-9);
    },
  ],
  [
    '圆从 12 点钟方向顺时针扫出(边扫边填);矩形从左上角顺时针;生长按弧长推进',
    () => {
      const c = new Circle(10).setStyle({ fill: '#abcdef' });
      c.setRevealFraction(0.25);
      const calls = draw(c);
      const ends = segmentEnds(calls);
      const [sx = NaN, sy = NaN] = ends[0] ?? [];
      const [ex = NaN, ey = NaN] = ends[ends.length - 1] ?? [];
      close(sx, 0, 1e-9);
      close(sy, -10, 1e-9);
      close(ex, 10, 1e-9);
      close(ey, 0, 1e-9);
      equal(count(calls, 'fill'), 1, '生长中的圆应按扫过的部分填充');
      const r = new Rectangle(20, 10);
      // 周长 60,1/3 恰好是整条上边。
      r.setRevealFraction(1 / 3);
      const re = segmentEnds(draw(r));
      equal(JSON.stringify(re[0]), JSON.stringify([-10, -5]));
      const [rx = NaN, ry = NaN] = re[re.length - 1] ?? [];
      close(rx, 10, 1e-6);
      close(ry, -5, 1e-6);
    },
  ],
  [
    '箭头按两层给出几何:杆描边、头用描边色填满;线宽为 0 时只画头',
    () => {
      const arrow = new Arrow({ x: 0, y: 0 }, { x: 100, y: 0 });
      const layers = arrow.pathLayers(resolveStyle(lightTheme, { stroke: '#ee1111' }));
      equal(layers.length, 2);
      equal(layers[0]?.paint.fill, null);
      equal(layers[0]?.paint.stroke, '#ee1111');
      equal(layers[1]?.paint.fill, '#ee1111');
      equal(layers[1]?.paint.stroke, null);
      close(pathBounds(layers[1]?.path ?? { subpaths: [] })?.maxX ?? NaN, 100, 1e-9);
      arrow.setStyle({ strokeWidth: 0 });
      const calls = draw(arrow);
      equal(count(calls, 'fill'), 1);
      equal(count(calls, 'stroke'), 0);
      // 生长中箭头跟着笔尖走。
      arrow.setRevealFraction(0.5);
      const tip = Math.max(...segmentEnds(draw(arrow)).map(([x]) => x));
      close(tip, 50, 1e-9);
    },
  ],
  [
    'Annotation 的线条部分可以变形/书写:引导线、目标圆点、徽标圈三层;字单独交叉淡化',
    () => {
      const style = resolveStyle(lightTheme, { fill: '#ffffff' });
      const ann = new Annotation('A', { offset: { x: 30, y: 0 } });
      const layers = ann.pathLayers(style);
      equal(layers.length, 3);
      close(pathBounds(layers[0]?.path ?? { subpaths: [] })?.maxX ?? NaN, 30 - 11, 1e-9);
      equal(layers[1]?.paint.fill, lightTheme.stroke, '目标圆点用描边色填满');
      equal(layers[2]?.paint.fill, '#ffffff');
      ann.showLeader = false;
      ann.showDot = false;
      equal(ann.pathLayers(style).length, 1);
      const { ctx, calls } = fakeCtx();
      ann.drawMorphResidual(ctx, style);
      equal(calls.filter((c) => c.op === 'fillText').map((c) => c.value).join(''), 'A');
      equal(count(calls, 'stroke') + count(calls, 'arc'), 0, '交叉淡化的只有字');
    },
  ],
]);
