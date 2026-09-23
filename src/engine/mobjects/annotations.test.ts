import { close, equal, fakeCtx, ok, suite, throws } from '../../testing/harness';
import { Create } from '../animations/primitives';
import { Transform } from '../animations/transform';
import { Write } from '../animations/write';
import type { PathData } from '../path/path';
import { pathBounds } from '../path/path';
import { lightTheme } from '../theme/presets';
import type { MObject } from './MObject';
import { Angle, AngleArc, Brace, BraceShape, RightAngle } from './annotations';
import { Line, Rectangle } from './shapes';
import { Tex } from './tex';
import type { Point } from './types';
import { boxBoundsInParent } from './types';

function bounds(path: PathData): { minX: number; minY: number; maxX: number; maxY: number } {
  const b = pathBounds(path);
  if (!b) {
    throw new Error('路径是空的');
  }
  return b;
}

/** 渲染一遍,收集画出来的路径点(对象都在原点,记录的就是本地坐标)。 */
function drawnPoints(m: MObject): Point[] {
  const { calls, ctx } = fakeCtx();
  m.render(ctx, lightTheme);
  const pts: Point[] = [];
  for (const c of calls) {
    if (c.op === 'moveTo' || c.op === 'lineTo' || c.op === 'bezierCurveTo') {
      for (let i = 0; i + 1 < c.args.length; i += 2) {
        pts.push({ x: c.args[i] ?? NaN, y: c.args[i + 1] ?? NaN });
      }
    }
  }
  return pts;
}

/** 路径的全部点(端点与控制点),保留 6 位小数、排好序,比较形状是否相同。 */
function pointKeys(path: PathData, keep: (x: number, y: number) => boolean, dx = 0): string[] {
  const out: string[] = [];
  for (const sub of path.subpaths) {
    for (let i = 0; i + 1 < sub.points.length; i += 2) {
      const x = sub.points[i] ?? NaN;
      const y = sub.points[i + 1] ?? NaN;
      if (keep(x, y)) {
        out.push(`${(x - dx).toFixed(6)},${y.toFixed(6)}`);
      }
    }
  }
  return out.sort();
}

/** 父空间里的外接盒。 */
function parentBox(m: MObject): { minX: number; minY: number; maxX: number; maxY: number } {
  return boxBoundsInParent(m.getBox(), m.position, m.scale, m.rotation);
}

export default suite('标注图元:花括号与角', [
  [
    'BraceShape:水平括号正好占满 [0, L] × [0, depth],尖角在正中、朝右手侧(画布里朝下)',
    () => {
      const brace = new BraceShape({ x: 0, y: 0 }, { x: 100, y: 0 });
      const b = bounds(brace.toPath());
      close(b.minX, 0, 1e-9);
      close(b.maxX, 100, 1e-9);
      close(b.minY, 0, 1e-9);
      close(b.maxY, 14, 1e-9);
      close(brace.tip.x, 50);
      close(brace.tip.y, 14);
      // 左右对称:x 坐标关于 50 镜像后点集不变。
      const path = brace.toPath();
      const mirrored = {
        subpaths: path.subpaths.map((s) => ({
          ...s,
          points: s.points.map((v, i) => (i % 2 === 0 ? 100 - v : v)),
        })),
      };
      equal(pointKeys(path, () => true).join(';'), pointKeys(mirrored, () => true).join(';'));
    },
  ],
  [
    'BraceShape:竖着摆时尖角朝前进方向的右手侧;斜着摆时外接盒跟着旋转',
    () => {
      const down = new BraceShape({ x: 0, y: 0 }, { x: 0, y: 100 });
      const b = bounds(down.toPath());
      close(b.minX, -14, 1e-9);
      close(b.maxX, 0, 1e-9);
      close(b.minY, 0, 1e-9);
      close(b.maxY, 100, 1e-9);
      close(down.tip.x, -14);
      close(down.tip.y, 50);
      const up = new BraceShape({ x: 0, y: 100 }, { x: 0, y: 0 });
      close(up.tip.x, 14);
      const diag = new BraceShape({ x: 0, y: 0 }, { x: 60, y: 80 }, { depth: 10 });
      close(Math.hypot(diag.tip.x - 30, diag.tip.y - 40), 10, 1e-9);
      // 右手侧:(0.6, 0.8) 的右手法向是 (-0.8, 0.6)。
      close(diag.normal.x, -0.8, 1e-12);
      close(diag.normal.y, 0.6, 1e-12);
    },
  ],
  [
    'BraceShape:任意长度都匀称 —— 卷钩与尖角形状不随长度变,只有直段伸长',
    () => {
      const short = new BraceShape({ x: 0, y: 0 }, { x: 100, y: 0 }).toPath();
      const long = new BraceShape({ x: 0, y: 0 }, { x: 300, y: 0 }).toPath();
      // 左端卷钩(x ≤ 16 的点)完全相同。
      const endShort = pointKeys(short, (x) => x <= 16);
      ok(endShort.length > 4, '左端没有取到点');
      equal(endShort.join(';'), pointKeys(long, (x) => x <= 16).join(';'));
      // 尖角附近(离中点 8 以内)平移后完全相同。
      const tipShort = pointKeys(short, (x) => Math.abs(x - 50) <= 8, 50);
      ok(tipShort.length > 4, '尖角附近没有取到点');
      equal(tipShort.join(';'), pointKeys(long, (x) => Math.abs(x - 150) <= 8, 150).join(';'));
    },
  ],
  [
    'BraceShape:短到放不下卷钩和尖角时横向压缩,深度不变',
    () => {
      const tiny = new BraceShape({ x: 0, y: 0 }, { x: 10, y: 0 });
      const b = bounds(tiny.toPath());
      close(b.minX, 0, 1e-9);
      close(b.maxX, 10, 1e-9);
      close(b.maxY, 14, 1e-9);
      close(b.minY, 0, 1e-9);
      // 两端重合:没有轮廓。
      equal(new BraceShape({ x: 5, y: 5 }, { x: 5, y: 5 }).toPath().subpaths.length, 0);
    },
  ],
  [
    'BraceShape 生长:尖角始终在最终位置,先按比例长大再向两端展开',
    () => {
      const brace = new BraceShape({ x: 0, y: 0 }, { x: 200, y: 0 });
      brace.setRevealFraction(0.05);
      const small = drawnPoints(brace);
      const sx = small.map((p) => p.x);
      const sy = small.map((p) => p.y);
      close(Math.max(...sy), 14, 1e-9);
      close((Math.min(...sx) + Math.max(...sx)) / 2, 100, 1e-9);
      // 200 × 0.05 = 10 < 自然长度 30.8:整体按比例缩小(深度也小)。
      close(Math.max(...sx) - Math.min(...sx), 10, 1e-9);
      ok(Math.min(...sy) > 5, `缩小时深度也该变浅,最浅处 ${Math.min(...sy)}`);
      brace.setRevealFraction(0.5);
      const half = drawnPoints(brace);
      close(Math.min(...half.map((p) => p.x)), 50, 1e-9);
      close(Math.max(...half.map((p) => p.x)), 150, 1e-9);
      close(Math.min(...half.map((p) => p.y)), 0, 1e-9);
    },
  ],
  [
    'BraceShape:没设 fill 时用描边色填满、不描边;书写轮廓按臂粗取细线',
    () => {
      const brace = new BraceShape({ x: 0, y: 0 }, { x: 100, y: 0 });
      brace.setStyle({ stroke: '#e11d48' });
      const [layer] = brace.pathLayers(brace.getStyle(lightTheme));
      equal(layer?.paint.fill, '#e11d48');
      equal(layer?.paint.stroke, null);
      ok((layer?.outlineWidth ?? 0) > 0 && (layer?.outlineWidth ?? 9) < 2);
      brace.setStyle({ fill: '#2563eb' });
      equal(brace.pathLayers(brace.getStyle(lightTheme))[0]?.paint.fill, '#2563eb');
    },
  ],
  [
    'Brace.for:按目标在父空间里的外接盒放在四个方向上,留 buff 间距',
    () => {
      const rect = new Rectangle(100, 40);
      rect.moveTo({ x: 200, y: 100 });
      const down = Brace.for(rect, 'down');
      close(down.shape.from.x, 150);
      close(down.shape.to.x, 250);
      close(down.shape.from.y, 126);
      close(down.tip.x, 200);
      close(down.tip.y, 140);
      const up = Brace.for(rect, 'up', { buff: 10 });
      close(up.tip.x, 200);
      close(up.tip.y, 100 - 20 - 10 - 14);
      const left = Brace.for(rect, 'left');
      close(left.tip.x, 150 - 6 - 14);
      close(left.tip.y, 100);
      const right = Brace.for(rect, 'right');
      close(right.tip.x, 250 + 6 + 14);
      close(right.tip.y, 100);
      // 目标旋转 90°:外接盒宽高互换。
      rect.rotation = Math.PI / 2;
      const turned = Brace.for(rect, 'down');
      close(turned.shape.to.x - turned.shape.from.x, 40, 1e-9);
      throws(() => Brace.for(rect, 'middle' as never));
    },
  ],
  [
    'Brace 说明:摆在尖角外侧留出间距、横向居中;换端点时跟着走',
    () => {
      const brace = new Brace({ x: 0, y: 0 }, { x: 120, y: 0 }, { label: 'x+1', labelGap: 5 });
      ok(brace.label instanceof Tex);
      const label = brace.label as MObject;
      let b = parentBox(label);
      close(b.minY, 14 + 5, 1e-9);
      close((b.minX + b.maxX) / 2, 60, 1e-9);
      // 竖着的括号:说明在左边(尖角朝左),右边缘离尖角 5。
      brace.setEnds({ x: 0, y: 0 }, { x: 0, y: 100 });
      b = parentBox(label);
      close(b.maxX, -14 - 5, 1e-9);
      close((b.minY + b.maxY) / 2, 50, 1e-9);
      // 字体加载完成(度量变了)时重新摆放。
      label.moveTo({ x: 999, y: 999 });
      brace.onMeasurementsChanged();
      close(parentBox(label).maxX, -14 - 5, 1e-9);
      // 任意 MObject 当说明:按它自己的包围盒摆放。
      const box = new Rectangle(30, 10);
      const withBox = new Brace({ x: 0, y: 0 }, { x: 100, y: 0 }, { label: box });
      equal(withBox.label, box);
      close(parentBox(box).minY, 14 + 6, 1e-9);
      ok(withBox.getChildren().includes(box));
    },
  ],
  [
    'Brace 参数校验:depth、thickness、labelGap、fontSize、端点都要合法',
    () => {
      throws(() => new BraceShape({ x: 0, y: 0 }, { x: 10, y: 0 }, { depth: 0 }));
      throws(() => new BraceShape({ x: 0, y: 0 }, { x: 10, y: 0 }, { thickness: -1 }));
      throws(() => new BraceShape({ x: NaN, y: 0 }, { x: 10, y: 0 }));
      throws(() => new Brace({ x: 0, y: 0 }, { x: 10, y: 0 }, { labelGap: -1 }));
      throws(() => new Brace({ x: 0, y: 0 }, { x: 10, y: 0 }, { label: 'a', fontSize: 0 }));
      throws(() => Brace.for(new Rectangle(10, 10), 'down', { buff: -2 }));
      // public 字段被改坏也不崩,只是不画。
      const brace = new BraceShape({ x: 0, y: 0 }, { x: 10, y: 0 });
      brace.depth = NaN;
      equal(brace.toPath().subpaths.length, 0);
    },
  ],
  [
    'Brace 能用于 Create / Write / Transform',
    () => {
      const a = new Brace({ x: 0, y: 0 }, { x: 100, y: 0 }, { label: 'a' });
      const b = new Brace({ x: 0, y: 50 }, { x: 60, y: 90 }, { label: 'b' });
      ok(a.supportsReveal);
      const create = new Create(a);
      create.begin();
      create.interpolate(0.5);
      ok(drawnPoints(a).length > 0);
      create.finish();
      equal(a.shape.getRevealFraction(), null);
      const write = new Write(a);
      write.begin();
      write.interpolate(0.5);
      ok((a.getMorphOverlay()?.layers.length ?? 0) > 0);
      write.finish();
      const t = new Transform(a, b);
      t.begin();
      t.interpolate(0.5);
      ok((a.getMorphOverlay()?.layers.length ?? 0) > 1, '括号与说明都该参与变形');
      t.finish();
      equal(a.getMorphOverlay(), null);
      equal(b.opacity, 1);
    },
  ],
  [
    'AngleArc:缺省走小于 180° 的那一侧,换射线顺序只改扫向;reflex 走另一侧',
    () => {
      const v = { x: 0, y: 0 };
      const arc = new AngleArc(v, { x: 10, y: 0 }, { x: 0, y: 10 });
      close(arc.startAngle, 0);
      close(arc.sweep, Math.PI / 2);
      let b = bounds(arc.toPath());
      close(b.minX, 0, 1e-9);
      close(b.minY, 0, 1e-9);
      close(b.maxX, 24, 1e-6);
      close(b.maxY, 24, 1e-6);
      const back = new AngleArc(v, { x: 0, y: 10 }, { x: 10, y: 0 });
      close(back.sweep, -Math.PI / 2);
      close(back.value, Math.PI / 2);
      const reflex = new AngleArc(v, { x: 10, y: 0 }, { x: 0, y: 10 }, {
        reflex: true,
        radius: 10,
      });
      close(reflex.sweep, -Math.PI * 1.5);
      b = bounds(reflex.toPath());
      close(b.minX, -10, 1e-3);
      close(b.minY, -10, 1e-3);
      close(b.maxX, 10, 1e-9);
      close(b.maxY, 10, 1e-9);
      // 平分线指向画出来的那一侧。
      close(reflex.bisector.x, -Math.SQRT1_2, 1e-12);
      close(reflex.bisector.y, -Math.SQRT1_2, 1e-12);
      // 外角:b 那条边反向延长,与原角互补(45° → 135°),扫向朝延长线。
      const inner = new AngleArc(v, { x: 10, y: 0 }, { x: 10, y: 10 });
      close(inner.value, Math.PI / 4, 1e-12);
      const outer = new AngleArc(v, { x: 10, y: 0 }, { x: 10, y: 10 }, { exterior: true });
      close(outer.sweep, (-3 * Math.PI) / 4, 1e-12);
      close(outer.bisector.y, -Math.sin((3 * Math.PI) / 8), 1e-12);
    },
  ],
  [
    'Angle 说明:落在角平分线上、弧的外侧(离顶点至少 半径 + 间距)',
    () => {
      const angle = new Angle({ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 0, y: 50 }, {
        label: '\\theta',
        radius: 30,
        labelGap: 4,
      });
      close(angle.degrees, 90, 1e-9);
      const b = parentBox(angle.label as MObject);
      const cx = (b.minX + b.maxX) / 2;
      const cy = (b.minY + b.maxY) / 2;
      // 中心在平分线 y = x 上。
      close(cx, cy, 1e-9);
      ok(cx > 0);
      // 盒子朝顶点的那个角离顶点的投影距离 = 半径 + 间距。
      close((b.minX + b.minY) / Math.SQRT2, 30 + 4, 1e-9);
    },
  ],
  [
    'Angle.fromLines:顶点是两直线交点,射线指向离交点较远的一端;按线段自身的变换换算;平行时报错',
    () => {
      const l1 = new Line({ x: -10, y: 0 }, { x: 40, y: 0 });
      const l2 = new Line({ x: 0, y: -10 }, { x: 0, y: 30 });
      const angle = Angle.fromLines(l1, l2);
      close(angle.arc.vertex.x, 0, 1e-12);
      close(angle.arc.vertex.y, 0, 1e-12);
      close(angle.arc.a.x, 40);
      close(angle.arc.b.y, 30);
      close(angle.degrees, 90, 1e-9);
      l2.moveTo({ x: 15, y: 0 });
      const shifted = Angle.fromLines(l1, l2);
      close(shifted.arc.vertex.x, 15, 1e-12);
      throws(() => Angle.fromLines(l1, new Line({ x: 0, y: 5 }, { x: 10, y: 5 })));
    },
  ],
  [
    'Angle / RightAngle 参数校验:射线上的点不能与顶点重合,半径与边长非负',
    () => {
      throws(() => new Angle({ x: 0, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 0 }));
      throws(() => new AngleArc({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { radius: -1 }));
      throws(() => new Angle({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { labelGap: -1 }));
      throws(() => new RightAngle({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }));
      throws(() => new RightAngle({ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { size: -3 }));
    },
  ],
  [
    'RightAngle:沿两条射线各取 size 的小方块折线',
    () => {
      const mark = new RightAngle({ x: 5, y: 5 }, { x: 50, y: 5 }, { x: 5, y: -40 }, { size: 10 });
      const p = mark.toPath().subpaths[0]?.points ?? [];
      close(p[0] ?? NaN, 15);
      close(p[1] ?? NaN, 5);
      close(p[6] ?? NaN, 15);
      close(p[7] ?? NaN, -5);
      close(p[12] ?? NaN, 5);
      close(p[13] ?? NaN, -5);
      equal(mark.toPath().subpaths[0]?.closed, false);
      // 斜着的两条射线:拐角 = 顶点 + 两条边向量之和。
      const tilted = new RightAngle({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: -10, y: 10 }, {
        size: 5 * Math.SQRT2,
      });
      const q = tilted.toPath().subpaths[0]?.points ?? [];
      close(q[6] ?? NaN, 0, 1e-12);
      close(q[7] ?? NaN, 10, 1e-12);
    },
  ],
  [
    'Angle / RightAngle 能用于 Create 与 Transform;setPoints 后说明跟着走',
    () => {
      const angle = new Angle({ x: 0, y: 0 }, { x: 50, y: 0 }, { x: 0, y: 50 }, { label: 'a' });
      const before = parentBox(angle.label as MObject);
      angle.setPoints({ x: 100, y: 0 }, { x: 150, y: 0 }, { x: 100, y: 50 });
      close(parentBox(angle.label as MObject).minX - before.minX, 100, 1e-9);
      (angle.label as MObject).moveTo({ x: -999, y: 0 });
      angle.onMeasurementsChanged();
      close(parentBox(angle.label as MObject).minX - before.minX, 100, 1e-9);
      const create = new Create(angle);
      create.begin();
      create.interpolate(0.5);
      ok(drawnPoints(angle).length > 0);
      create.finish();
      const mark = new RightAngle({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 });
      const t = new Transform(mark, new AngleArc({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }));
      t.begin();
      t.interpolate(0.5);
      equal(mark.getMorphOverlay()?.layers.length, 1);
      t.finish();
    },
  ],
]);
