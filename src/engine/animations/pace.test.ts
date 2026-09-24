import type { FakeCtxCall } from '../../testing/harness';
import { close, equal, fakeCtx, ok, suite, throws } from '../../testing/harness';
import { Axes, FunctionGraph } from '../mobjects/graphs';
import { Group } from '../mobjects/Group';
import type { MObject } from '../mobjects/MObject';
import { Circle, Ellipse, Line, Polygon, SvgPath } from '../mobjects/shapes';
import { Tex } from '../mobjects/tex';
import { pathLength } from '../path/measure';
import { pacedFraction, resolvePace } from '../path/pace';
import type { PathData, Subpath } from '../path/path';
import { EMPTY_PATH } from '../path/path';
import { lightTheme } from '../theme/presets';
import { Create } from './primitives';
import { linear, thereAndBack } from './rateFunctions';
import { Write } from './write';

/** 渲染一帧,把记录下来的 moveTo / bezierCurveTo 还原成路径(node 里没有 Path2D,drawPath 逐段描)。 */
function drawn(m: MObject): { path: PathData; calls: FakeCtxCall[] } {
  const { ctx, calls } = fakeCtx();
  m.render(ctx, lightTheme);
  const subpaths: Subpath[] = [];
  let points: number[] = [];
  for (const c of calls) {
    if (c.op === 'moveTo') {
      if (points.length > 2) {
        subpaths.push({ points, closed: false });
      }
      points = [c.args[0] ?? 0, c.args[1] ?? 0];
    } else if (c.op === 'bezierCurveTo') {
      points.push(...c.args);
    }
  }
  if (points.length > 2) {
    subpaths.push({ points, closed: false });
  }
  return { path: { subpaths }, calls };
}

const CURVE = resolvePace('测试', { pace: 'curvature' });

/** 一个带两个直角的 U 形折线(开放,不填充)。 */
function uShape(): Polygon {
  return new Polygon(
    [
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 120, y: 20 },
      { x: 20, y: 20 },
    ],
    { closed: false },
  );
}

export default suite('Create / Write 的笔速', [
  [
    'Create pace: curvature:revealFraction 仍是进度,画出来的长度按笔速换算;缺省匀速不变',
    () => {
      const shape = uShape();
      const anim = new Create(shape, { pace: 'curvature', rateFunc: linear });
      anim.begin();
      anim.interpolate(0.3);
      equal(shape.getRevealFraction(), 0.3);
      equal(shape.getRevealPace()?.mode, 'curvature');
      const L = pathLength(shape.toPath());
      const expected = L * pacedFraction(shape.toPath(), 0.3, shape.getRevealPace());
      close(pathLength(drawn(shape).path), expected, 1e-6);
      ok(Math.abs(expected - 0.3 * L) > 0.01 * L, '有拐角的折线在 0.3 处应当偏离匀速');
      const plain = uShape();
      const uniform = new Create(plain, { rateFunc: linear });
      uniform.begin();
      uniform.interpolate(0.3);
      equal(plain.getRevealPace(), null);
      close(pathLength(drawn(plain).path), 0.3 * L, 1e-6);
      // 只给强度也算按曲率。
      const strong = uShape();
      const s = new Create(strong, { paceStrength: 4, rateFunc: linear });
      s.begin();
      equal(strong.getRevealPace()?.strength, 4);
    },
  ],
  [
    '组:同一个笔速传给每个子元素,各按自己的形状换算(直线仍匀速)',
    () => {
      const shape = uShape();
      const line = new Line({ x: 0, y: 50 }, { x: 100, y: 50 });
      const group = new Group().add(shape, line);
      const anim = new Create(group, { pace: 'curvature', rateFunc: linear });
      anim.begin();
      anim.interpolate(0.3);
      ok(shape.getRevealPace() !== null && shape.getRevealPace() === line.getRevealPace());
      close(pathLength(drawn(line).path), 30, 1e-6, '直线按匀速');
      close(
        pathLength(drawn(shape).path),
        pathLength(shape.toPath()) * pacedFraction(shape.toPath(), 0.3, shape.getRevealPace()),
        1e-6,
      );
    },
  ],
  [
    '收尾撤掉笔速;往返缓动停在进度 0 时保留;之后直接设比例不残留笔速',
    () => {
      const shape = uShape();
      const anim = new Create(shape, { pace: 'curvature' });
      anim.begin();
      anim.interpolate(0.5);
      anim.finish();
      equal(shape.getRevealFraction(), null);
      equal(shape.getRevealPace(), null);
      const back = new Create(shape, { pace: 'curvature', rateFunc: thereAndBack });
      back.begin();
      back.finish();
      equal(shape.getRevealFraction(), 0);
      equal(shape.getRevealPace()?.mode, 'curvature');
      shape.setRevealFraction(0.5);
      equal(shape.getRevealPace(), null, '直接设比例应回到匀速');
    },
  ],
  [
    '圆(曲率处处相同)按曲率与匀速画得一模一样;椭圆不看笔速,按角度扫,尖端本来就比按曲率还慢',
    () => {
      const a = new Circle(40);
      const b = new Circle(40);
      a.setRevealFraction(0.37, CURVE);
      b.setRevealFraction(0.37);
      equal(JSON.stringify(drawn(a).calls), JSON.stringify(drawn(b).calls));
      const e = new Ellipse(90, 30);
      const plain = new Ellipse(90, 30);
      const anim = new Create(e, { pace: 'curvature', paceStrength: 4, rateFunc: linear });
      anim.begin();
      for (const alpha of [0.1, 0.25, 0.4, 0.8]) {
        anim.interpolate(alpha);
        plain.setRevealFraction(alpha);
        equal(JSON.stringify(drawn(e).calls), JSON.stringify(drawn(plain).calls), `alpha=${alpha}`);
      }
      // 尖端(3 点钟,进度 0.25)与侧边(6 点钟,进度 0.5)的笔速之比 = 长轴 / 短轴 = 3,
      // 比同一路径按曲率的最大强度(约 2.7 倍)还多:打开笔速不会让尖端反而变快。
      const lengthAt = (f: number): number => {
        plain.setRevealFraction(f);
        return pathLength(drawn(plain).path);
      };
      const tip = lengthAt(0.255) - lengthAt(0.245);
      const flank = lengthAt(0.505) - lengthAt(0.495);
      close(flank / tip, 3, 0.05);
      const path = e.toPath();
      const strongest = resolvePace('测试', { paceStrength: 4 });
      const paced = (f: number): number => pacedFraction(path, f, strongest);
      const pacedRatio = (paced(0.505) - paced(0.495)) / (paced(0.255) - paced(0.245));
      ok(pacedRatio > 1.5, `按曲率时尖端也该慢一些:${pacedRatio}`);
      ok(flank / tip > pacedRatio, `角度扫的尖端减速 ${flank / tip} 应多于按曲率的 ${pacedRatio}`);
    },
  ],
  [
    '函数图像按曲率描(波峰处慢),坐标轴(全是直线)不受影响',
    () => {
      const axes = new Axes([-2 * Math.PI, 2 * Math.PI], [-1.5, 1.5], 600, 200);
      const paced = new FunctionGraph(Math.sin, axes);
      const plain = new FunctionGraph(Math.sin, axes);
      const anim = new Create(paced, { pace: 'curvature', rateFunc: linear });
      anim.begin();
      anim.interpolate(0.4);
      plain.setRevealFraction(0.4);
      const L = pathLength(paced.toPath());
      const lp = pathLength(drawn(paced).path);
      close(lp, L * pacedFraction(paced.toPath(), 0.4, CURVE), 1e-6);
      close(pathLength(drawn(plain).path), 0.4 * L, 1e-6);
      ok(Math.abs(lp - 0.4 * L) > 1e-3 * L, `函数图像在 0.4 处应偏离匀速:${lp} vs ${0.4 * L}`);
      const a = new Axes([0, 4], [0, 3], 300, 200);
      const b = new Axes([0, 4], [0, 3], 300, 200);
      a.setRevealFraction(0.6, CURVE);
      b.setRevealFraction(0.6);
      equal(JSON.stringify(drawn(a).calls), JSON.stringify(drawn(b).calls));
    },
  ],
  [
    'Tex 的 Create 带笔速:字形轮廓按笔速描,画完与匀速的终态一致',
    () => {
      const t = new Tex('S').setStyle({ fontSize: 40 });
      const u = new Tex('S').setStyle({ fontSize: 40 });
      const paced = new Create(t, { pace: 'curvature', rateFunc: linear });
      const plain = new Create(u, { rateFunc: linear });
      paced.begin();
      plain.begin();
      paced.interpolate(0.3);
      plain.interpolate(0.3);
      const lp = pathLength(drawn(t).path);
      const lu = pathLength(drawn(u).path);
      ok(lp > 0 && lu > 0 && Math.abs(lp - lu) > 1e-3 * lu, `带笔速应描出不同长度:${lp} vs ${lu}`);
      paced.finish();
      plain.finish();
      equal(JSON.stringify(drawn(t).calls), JSON.stringify(drawn(u).calls));
    },
  ],
  [
    'Write 带笔速:每片的轮廓按笔速换算,片与片的错峰不变',
    () => {
      const svg = new SvgPath('M0 0 L100 0 L100 10 L0 10');
      const w = new Write(svg, { pace: 'curvature', rateFunc: linear });
      w.begin();
      w.interpolate(0.4);
      const layer = svg.getMorphOverlay()?.layers[0];
      const path = svg.toPath();
      close(pathLength(layer?.path ?? EMPTY_PATH), pathLength(path) * pacedFraction(path, 0.4, CURVE), 1e-6);
      // lagRatio 1:两片首尾相接,第二片在 alpha = 0.75 时自身进度 0.5。
      const first = new SvgPath('M0 0 L50 0 L50 50');
      const second = new SvgPath('M0 0 L50 0 L50 50');
      const group = new Group().add(first, second);
      const wg = new Write(group, { pace: 'curvature', lagRatio: 1, rateFunc: linear });
      wg.begin();
      wg.interpolate(0.75);
      const layers = group.getMorphOverlay()?.layers ?? [];
      equal(layers.length, 2);
      const p2 = second.toPath();
      close(pathLength(layers[1]?.path ?? EMPTY_PATH), pathLength(p2) * pacedFraction(p2, 0.5, CURVE), 1e-6);
      ok(layers[0]?.path === first.toPath(), '第一片已经写完,原样');
      wg.finish();
      equal(group.getMorphOverlay(), null);
    },
  ],
  [
    'Write 公式带笔速:同一时刻在写的字形与匀速相同(错峰不变),只是各自的轮廓描到不同位置',
    () => {
      const make = (): Tex => new Tex('a+S=2').setStyle({ fontSize: 40 });
      const t = make();
      const u = make();
      const paced = new Write(t, { pace: 'curvature', rateFunc: linear });
      const plain = new Write(u, { rateFunc: linear });
      paced.begin();
      plain.begin();
      let differs = false;
      for (const alpha of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        paced.interpolate(alpha);
        plain.interpolate(alpha);
        const lp = t.getMorphOverlay()?.layers ?? [];
        const lu = u.getMorphOverlay()?.layers ?? [];
        equal(lp.length, lu.length, `alpha=${alpha} 时在写的片数应相同`);
        lp.forEach((layer, i) => {
          const other = lu[i];
          equal(layer.paint.fill, other?.paint.fill, '同一片处在同一阶段(描轮廓 / 淡入填充)');
          const a = pathLength(layer.path);
          const b = pathLength(other?.path ?? EMPTY_PATH);
          if (Math.abs(a - b) > 1e-3 * Math.max(a, b)) {
            differs = true;
          }
        });
      }
      ok(differs, '至少有一片的轮廓按笔速描到了不同的位置');
      paced.finish();
      equal(t.getMorphOverlay(), null);
    },
  ],
  [
    'Create / Write 构造时校验笔速选项',
    () => {
      throws(() => new Create(new Circle(1), { pace: 'bogus' as never }));
      throws(() => new Create(new Circle(1), { paceStrength: -1 }));
      throws(() => new Write(new Circle(1), { pace: 'uniform', paceStrength: 2 }));
      throws(() => new Write(new Circle(1), { paceStrength: 9 }));
    },
  ],
]);
