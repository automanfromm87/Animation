import { close, equal, fakeCtx, ok, suite } from '../../testing/harness';
import {
  EMPTY_PATH,
  PathBuilder,
  alignPaths,
  collapsePath,
  drawPath,
  invertAffine,
  lerpPath,
  multiplyAffine,
  parseSvgPath,
  partialPath,
  pathBounds,
  pathLength,
  segmentCount,
  similarityAffine,
  totalSegments,
  transformPath,
} from './index';
import type { PathData } from './index';

function circle(r: number): PathData {
  return new PathBuilder().arc(0, 0, r, 0, Math.PI * 2).close().build();
}

function square(side: number): PathData {
  const h = side / 2;
  return new PathBuilder().rect(-h, -h, side, side).build();
}

/** 子路径终点。 */
function endOf(path: PathData): [number, number] {
  const sub = path.subpaths[path.subpaths.length - 1];
  const p = sub?.points ?? [];
  return [p[p.length - 2] ?? NaN, p[p.length - 1] ?? NaN];
}

export default suite('矢量路径', [
  [
    '构造器:直线升阶成三分点控制点的三次段;close 补闭合段;rect 是闭合的四段',
    () => {
      const line = new PathBuilder().moveTo(0, 0).lineTo(30, 0).build();
      equal(line.subpaths[0]?.points.join(','), '0,0,10,0,20,0,30,0');
      const tri = new PathBuilder().moveTo(0, 0).lineTo(10, 0).lineTo(0, 10).close().build();
      equal(segmentCount(tri.subpaths[0] ?? { points: [], closed: false }), 3);
      ok(tri.subpaths[0]?.closed);
      const [x, y] = endOf(tri);
      equal(x, 0);
      equal(y, 0);
      equal(totalSegments(square(10)), 4);
    },
  ],
  [
    '圆弧:整圆 4 段,段上各点离圆心的误差小于万分之三个半径',
    () => {
      const c = circle(100);
      equal(totalSegments(c), 4);
      const p = c.subpaths[0]?.points ?? [];
      let worst = 0;
      for (let i = 2; i + 5 < p.length; i += 6) {
        for (let k = 1; k < 10; k++) {
          const t = k / 10;
          const u = 1 - t;
          const bx =
            u * u * u * (p[i - 2] ?? 0) +
            3 * u * u * t * (p[i] ?? 0) +
            3 * u * t * t * (p[i + 2] ?? 0) +
            t * t * t * (p[i + 4] ?? 0);
          const by =
            u * u * u * (p[i - 1] ?? 0) +
            3 * u * u * t * (p[i + 1] ?? 0) +
            3 * u * t * t * (p[i + 3] ?? 0) +
            t * t * t * (p[i + 5] ?? 0);
          worst = Math.max(worst, Math.abs(Math.hypot(bx, by) - 100));
        }
      }
      ok(worst < 0.03, `最大误差 ${worst}`);
      // canvas 语义:逆时针画 90°。
      const arc = new PathBuilder().arc(0, 0, 10, 0, -Math.PI / 2, true).build();
      const [ex, ey] = endOf(arc);
      close(ex, 0, 1e-9);
      close(ey, -10, 1e-9);
    },
  ],
  [
    'SVG path 解析:绝对/相对命令、隐式重复、H/V、S/T 反射、Z 闭合、椭圆弧',
    () => {
      const p = parseSvgPath('M10 10 20 10 20 20 z m5 5 h10 v10 H5Z');
      equal(p.subpaths.length, 2);
      // 第一条:两条边 + 闭合段;第二条:h、v、H 三条边 + 闭合段。
      equal(totalSegments(p), 3 + 4);
      ok(p.subpaths.every((s) => s.closed));
      const sub2 = p.subpaths[1]?.points ?? [];
      // 相对 m 从闭合后的当前点(10,10)出发。
      equal(sub2[0], 15);
      equal(sub2[1], 15);
      // T 反射上一个 Q 的控制点:M0 0 Q10 10 20 0 T40 0 的第二段控制点在 (30,-10)。
      const qt = parseSvgPath('M0 0Q10 10 20 0T40 0');
      const q2 = qt.subpaths[0]?.points ?? [];
      // 二次升阶:c1 = p0 + 2/3 (q - p0) = (20,0) + 2/3·(10,-10)。
      close(q2[8] ?? NaN, 20 + (2 / 3) * 10, 1e-9);
      close(q2[9] ?? NaN, (-2 / 3) * 10, 1e-9);
      // 紧凑数字写法:负号与小数点都能当分隔符。
      const compact = parseSvgPath('M-1-2L.5.5');
      equal(compact.subpaths[0]?.points.slice(0, 2).join(','), '-1,-2');
      const [cx, cy] = endOf(compact);
      equal(cx, 0.5);
      equal(cy, 0.5);
      // 半圆弧:终点精确,中点在半径 10 的圆上。
      const arc = parseSvgPath('M-10 0A10 10 0 0 1 10 0');
      const [ax, ay] = endOf(arc);
      equal(ax, 10);
      equal(ay, 0);
      const b = pathBounds(arc);
      close(b?.minY ?? NaN, -10, 1e-6);
    },
  ],
  [
    'MathJax 字形路径(Q/T 为主)能完整解析,非法内容停在出错处',
    () => {
      const glyph = parseSvgPath(
        'M52 289Q59 331 106 386T222 442Q257 442 286 424T329 379Q371 442 430 442Q467 442 494 420T522 361Q522 332 508 314T481 292T458 288Q439 288 427 299T415 328Q415 374 465 391Q454 404 425 404Q412 404 406 402Q368 386 350 336Q290 115 290 78Q290 50 306 38T341 26Q378 26 414 59T463 140Q466 150 469 151T485 153H489Q504 153 504 145Q504 144 502 134Q486 77 440 33T333 -11Q263 -11 227 52Q186 -10 133 -10H127Q78 -10 57 16T35 71Q35 103 54 123T99 143Q142 143 142 101Q142 81 130 66T107 46T94 41L91 40Q91 39 97 36T113 29T132 26Q168 26 194 71Q203 87 217 139T245 247T261 313Q266 340 266 352Q266 380 251 392T217 404Q177 404 142 372T93 290Q91 281 88 280T72 278H58Q52 284 52 289Z',
      );
      ok(glyph.subpaths[0]?.closed);
      ok(totalSegments(glyph) > 40);
      const b = pathBounds(glyph);
      ok(b !== null && b.minX >= 30 && b.maxX <= 530, '字形包围盒不对');
      const broken = parseSvgPath('M0 0L10 0L oops 20');
      equal(totalSegments(broken), 1);
    },
  ],
  [
    '紧包围盒含曲线极值点,不是控制点凸包',
    () => {
      const bump = new PathBuilder().moveTo(0, 0).cubicTo(0, 100, 100, 100, 100, 0).build();
      const b = pathBounds(bump);
      close(b?.maxY ?? NaN, 75, 1e-9);
      equal(pathBounds(EMPTY_PATH), null);
    },
  ],
  [
    '弧长:直线精确;贝塞尔圆的弧长与密集折线逼近一致(求积误差远小于四段近似本身的 1.4e-4)',
    () => {
      close(pathLength(new PathBuilder().moveTo(0, 0).lineTo(3, 4).build()), 5, 1e-12);
      const c = circle(50);
      const len = pathLength(c);
      ok(Math.abs(len - 2 * Math.PI * 50) / (2 * Math.PI * 50) < 3e-4, `圆周 ${len}`);
      // 密集折线逼近同一条贝塞尔曲线:误差只剩弦长近似的 O(1/n²)。
      const p = c.subpaths[0]?.points ?? [];
      let poly = 0;
      for (let i = 2; i + 5 < p.length; i += 6) {
        let px = p[i - 2] ?? 0;
        let py = p[i - 1] ?? 0;
        for (let k = 1; k <= 2000; k++) {
          const t = k / 2000;
          const u = 1 - t;
          const x =
            u * u * u * (p[i - 2] ?? 0) + 3 * u * u * t * (p[i] ?? 0) + 3 * u * t * t * (p[i + 2] ?? 0) + t * t * t * (p[i + 4] ?? 0);
          const y =
            u * u * u * (p[i - 1] ?? 0) + 3 * u * u * t * (p[i + 1] ?? 0) + 3 * u * t * t * (p[i + 3] ?? 0) + t * t * t * (p[i + 5] ?? 0);
          poly += Math.hypot(x - px, y - py);
          px = x;
          py = y;
        }
      }
      ok(Math.abs(len - poly) / poly < 1e-6, `求积 ${len} vs 折线 ${poly}`);
    },
  ],
  [
    '按弧长截取:半条直线停在中点;跨子路径累计;完整包含的子路径保留闭合标记',
    () => {
      const line = new PathBuilder().moveTo(0, 0).lineTo(100, 0).build();
      const [hx] = endOf(partialPath(line, 0, 0.5));
      close(hx, 50, 1e-6);
      const half = partialPath(circle(10), 0, 0.5);
      const [cx, cy] = endOf(half);
      close(cx, -10, 1e-3);
      close(cy, 0, 1e-3);
      equal(half.subpaths[0]?.closed, false);
      // 两个等长的闭合正方形:前 75% = 第一个完整(闭合)+ 第二个的一半。
      const two = new PathBuilder().rect(0, 0, 10, 10).rect(20, 0, 10, 10).build();
      const cut = partialPath(two, 0, 0.75);
      equal(cut.subpaths.length, 2);
      ok(cut.subpaths[0]?.closed);
      ok(!cut.subpaths[1]?.closed);
      ok(partialPath(two, 0, 1) === two, '完整区间应原样返回');
      equal(partialPath(two, 0.5, 0.5).subpaths.length, 0);
    },
  ],
  [
    '变形对齐:段数与子路径数对齐,插值端点精确;闭合形状按绕向与起点对齐',
    () => {
      const [a, b] = alignPaths(square(20), circle(10));
      equal(totalSegments(a), totalSegments(b));
      ok(lerpPath(a, b, 0) === a && lerpPath(a, b, 1) === b, '端点应精确返回');
      const mid = lerpPath(a, b, 0.5);
      equal(totalSegments(mid), totalSegments(a));
      // 子路径数不同:少的一方补塌成一点的子路径,位于自身包围盒中心。
      const one = square(10);
      const twoSquares = new PathBuilder().rect(-5, -5, 10, 10).rect(50, 50, 10, 10).build();
      const [pa, pb] = alignPaths(one, twoSquares);
      equal(pa.subpaths.length, 2);
      equal(pb.subpaths.length, 2);
      const extra = pa.subpaths[1]?.points ?? [];
      ok(extra.every((v) => v === 0), '补出来的子路径应塌在源的中心');
      // 绕向相反:目标被反过来,起点转到离源起点最近处。
      const cw = new PathBuilder().moveTo(0, 0).lineTo(10, 0).lineTo(10, 10).lineTo(0, 10).close().build();
      const ccw = new PathBuilder().moveTo(10, 10).lineTo(10, 0).lineTo(0, 0).lineTo(0, 10).close().build();
      const [, aligned] = alignPaths(cw, ccw);
      const pts = aligned.subpaths[0]?.points ?? [];
      equal(pts[0], 0);
      equal(pts[1], 0);
    },
  ],
  [
    '绕向相反时只反单条子路径的一方:带洞图形(外圈 + 反向的洞)的洞保持反向,终态前不会被填上',
    () => {
      const cw = (x: number, y: number, s: number): PathBuilder =>
        new PathBuilder().moveTo(x, y).lineTo(x + s, y).lineTo(x + s, y + s).lineTo(x, y + s).close();
      // 目标:外圈顺时针 + 洞逆时针(非零环绕规则下挖空)。
      const ring = cw(0, 0, 30)
        .moveTo(10, 10)
        .lineTo(10, 20)
        .lineTo(20, 20)
        .lineTo(20, 10)
        .close()
        .build();
      const area = (pts: readonly number[]): number => {
        let a = 0;
        for (let i = 0; i + 3 < pts.length; i += 6) {
          const j = i + 6 < pts.length ? i + 6 : i;
          a += (pts[i] ?? 0) * (pts[j + 1] ?? 0) - (pts[j] ?? 0) * (pts[i + 1] ?? 0);
        }
        return a;
      };
      // 源:两个都顺时针的方块。第二对绕向相反,但目标有两条子路径 → 不反(反了洞就被填上)。
      const two = cw(0, 0, 30).moveTo(10, 10).lineTo(20, 10).lineTo(20, 20).lineTo(10, 20).close().build();
      const [, b] = alignPaths(two, ring);
      ok(area(b.subpaths[1]?.points ?? []) < 0, '洞被反成了顺时针');
      // 源只有一条子路径时反源那一方(单条子路径反向不改变填充)。
      const hole = new PathBuilder().moveTo(10, 10).lineTo(10, 20).lineTo(20, 20).lineTo(20, 10).close().build();
      const [a2, b2] = alignPaths(hole, ring);
      ok(area(b2.subpaths[1]?.points ?? []) < 0, '目标的洞不该被反');
      ok(area(a2.subpaths[0]?.points ?? []) > 0, '单条子路径的源应当被反过来去配目标的外圈');
    },
  ],
  [
    'collapsePath:结构不变、所有点塌到一处;与原路径对齐后逐点一一对应',
    () => {
      const sq = square(10);
      const dot = collapsePath(sq, 3, 4);
      equal(dot.subpaths.length, 1);
      ok(dot.subpaths[0]?.closed);
      equal(dot.subpaths[0]?.points.length, sq.subpaths[0]?.points.length);
      ok((dot.subpaths[0]?.points ?? []).every((v, i) => v === (i % 2 === 0 ? 3 : 4)));
      const [a, b] = alignPaths(dot, sq);
      equal(totalSegments(a), totalSegments(b));
      ok(lerpPath(a, b, 1) === b);
    },
  ],
  [
    '仿射矩阵:相似变换、复合与求逆互相抵消;变换路径逐点作用',
    () => {
      const m = similarityAffine(10, 20, 2, Math.PI / 2);
      const inv = invertAffine(m);
      ok(inv !== null);
      const id = multiplyAffine(m, inv ?? m);
      close(id[0], 1, 1e-12);
      close(id[3], 1, 1e-12);
      close(id[4], 0, 1e-12);
      const moved = transformPath(new PathBuilder().moveTo(1, 0).lineTo(2, 0).build(), m);
      const p = moved.subpaths[0]?.points ?? [];
      close(p[0] ?? NaN, 10, 1e-12);
      close(p[1] ?? NaN, 22, 1e-12);
      equal(invertAffine([0, 0, 0, 0, 1, 1]), null);
    },
  ],
  [
    '通用绘制:先填后描;线宽 0 不描;虚线生效;生长只画前一截',
    () => {
      const { ctx, calls } = fakeCtx();
      drawPath(ctx, square(10), { fill: '#f00', stroke: '#000', strokeWidth: 2, dash: [4, 2] });
      const ops = calls.map((c) => c.op);
      ok(ops.indexOf('fill') < ops.indexOf('stroke'), '描边应压在填充上');
      equal(ops.filter((o) => o === 'bezierCurveTo').length, 4);
      ok(calls.some((c) => c.op === 'setLineDash'));
      const thin = fakeCtx();
      drawPath(thin.ctx, square(10), { fill: null, stroke: '#000', strokeWidth: 0 });
      ok(!thin.calls.some((c) => c.op === 'stroke'), '线宽 0 不该描边(画布会沿用旧线宽画发丝线)');
      const grow = fakeCtx();
      drawPath(grow.ctx, square(10), { fill: null, stroke: '#000', strokeWidth: 1 }, 0.5);
      equal(grow.calls.filter((c) => c.op === 'bezierCurveTo').length, 2);
      ok(!grow.calls.some((c) => c.op === 'closePath'), '截断的路径不该闭合');
    },
  ],
]);
