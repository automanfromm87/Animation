import { close, equal, fakeCtx, ok, suite, throws } from '../../testing/harness';
import { Create } from '../animations/primitives';
import { Transform } from '../animations/transform';
import { pathBounds } from '../path/path';
import { lightTheme } from '../theme/presets';
import { Axes, FunctionGraph, frameToLocal, localToFrame, stepMultiples } from './graphs';
import type { MObject } from './MObject';
import { NumberLine, NumberPlane } from './numberLine';
import { Label } from './shapes';
import { Tex } from './tex';
import { boxBoundsInParent } from './types';

function parentBox(m: MObject): { minX: number; minY: number; maxX: number; maxY: number } {
  return boxBoundsInParent(m.getBox(), m.position, m.scale, m.rotation);
}

function centerX(m: MObject): number {
  const b = parentBox(m);
  return (b.minX + b.maxX) / 2;
}

function subpathCount(m: MObject | null): number {
  return m?.toPath()?.subpaths.length ?? 0;
}

export default suite('标注图元:数轴与坐标网格', [
  [
    'stepMultiples:步长整数倍、两端吸收浮点误差;非法输入给空数组,太多给 null',
    () => {
      equal(stepMultiples(-1, 1, 0.5)?.join(','), '-1,-0.5,0,0.5,1');
      equal(stepMultiples(0.05, 0.3, 0.1)?.length, 3);
      equal(stepMultiples(0, 1, 0)?.length, 0);
      equal(stepMultiples(0, NaN, 1)?.length, 0);
      equal(stepMultiples(0, 1e6, 1, 100), null);
      equal(stepMultiples(3, 1, 1)?.length, 0);
    },
  ],
  [
    'frameToLocal / localToFrame 互逆,与 Axes.toLocal 一致',
    () => {
      const axes = new Axes([-2, 6], [1, 5], 320, 160);
      const p = frameToLocal([-2, 6], [1, 5], 320, 160, 3, 2);
      const q = axes.toLocal(3, 2);
      close(p.x, q.x);
      close(p.y, q.y);
      const back = localToFrame([-2, 6], [1, 5], 320, 160, p);
      close(back.x, 3, 1e-12);
      close(back.y, 2, 1e-12);
    },
  ],
  [
    'NumberLine:n2p / p2n 以中点为原点线性映射,互逆;竖直数轴朝上',
    () => {
      const line = new NumberLine([-5, 5, 1], { length: 400, numbers: false });
      close(line.n2p(-5).x, -200);
      close(line.n2p(5).x, 200);
      close(line.n2p(0).x, 0);
      close(line.n2p(2.5).y, 0);
      close(line.p2n({ x: 100, y: 37 }), 2.5, 1e-12);
      const up = new NumberLine([0, 10, 2], { length: 200, vertical: true, numbers: false });
      close(up.n2p(10).y, -100);
      close(up.n2p(0).y, 100);
      close(up.n2p(10).x, 0);
      close(up.p2n({ x: -30, y: -50 }), 7.5, 1e-12);
    },
  ],
  [
    'NumberLine 刻度:落在步长整数倍上,一个刻度一条子路径,刻度线以轴线为中心',
    () => {
      const line = new NumberLine([0, 2, 0.5], { length: 200, tickSize: 12, numbers: false });
      equal(line.tickValues.length, 5);
      close(line.tickValues[3] ?? NaN, 1.5, 1e-12);
      equal(subpathCount(line.tickMarks), 5);
      const b = pathBounds(line.tickMarks?.toPath() ?? { subpaths: [] });
      close(b?.minY ?? NaN, -6);
      close(b?.maxY ?? NaN, 6);
      close(b?.minX ?? NaN, -100);
      close(b?.maxX ?? NaN, 100);
      const bare = new NumberLine([0, 2, 0.5], { ticks: false, numbers: false });
      equal(bare.tickMarks, null);
    },
  ],
  [
    'NumberLine 数字:每个刻度一个,摆在刻度下方留出间距、横向对准刻度;负数让数字本身对准',
    () => {
      const line = new NumberLine([-2, 2, 1], { length: 200, tickSize: 10, numberGap: 6 });
      equal(line.numberLabels.length, 5);
      ok(line.numberLabels.every((m) => m instanceof Tex));
      const zero = line.numberLabels[2] as MObject;
      close(centerX(zero), 0, 1e-9);
      close(parentBox(zero).minY, 5 + 6, 1e-9);
      const two = line.numberLabels[4] as MObject;
      close(centerX(two), 100, 1e-9);
      // "−1" 连同负号的中心在刻度左边:数字 1 对准刻度,负号探出去。
      const minusOne = line.numberLabels[1] as MObject;
      ok(centerX(minusOne) < -50 - 1, `负数没有左移:${centerX(minusOne)}`);
      const bare = new Tex('1');
      bare.setStyle({ fontSize: 18 });
      close(parentBox(minusOne).maxX, -50 + bare.getBox().size.w / 2, 1e-9);
      // 字体加载完成(度量变了)时重新摆放。
      const placed = { ...minusOne.position };
      minusOne.moveTo({ x: 999, y: 999 });
      line.onMeasurementsChanged();
      close(minusOne.position.x, placed.x, 1e-12);
      close(minusOne.position.y, placed.y, 1e-12);
    },
  ],
  [
    'NumberLine 数字:exclude、指定数值、Label 排版与自定义格式',
    () => {
      const line = new NumberLine([-2, 2, 1], { exclude: [0] });
      equal(line.numberLabels.length, 4);
      const picked = new NumberLine([0, 10, 1], {
        numbers: [0, 5, 10],
        labelKind: 'label',
        format: (v) => `${v}%`,
      });
      equal(picked.numberLabels.length, 3);
      ok(picked.numberLabels.every((m) => m instanceof Label));
      equal((picked.numberLabels[1] as Label).text, '5%');
      const neg = new NumberLine([-1, 1, 1], { labelKind: 'label' });
      equal((neg.numberLabels[0] as Label).text, '−1');
      // 竖直数轴:数字在左侧,右边缘离轴线 tickSize/2 + gap。
      const up = new NumberLine([0, 2, 1], { vertical: true, length: 100 });
      close(parentBox(up.numberLabels[1] as MObject).maxX, -5 - 6, 1e-9);
      const top = parentBox(up.numberLabels[2] as MObject);
      close((top.minY + top.maxY) / 2, -50, 1e-9);
    },
  ],
  [
    'NumberLine 箭头:画在区间外侧(不压住最末的刻度),both 两端都有',
    () => {
      const plain = new NumberLine([0, 4, 1], { length: 200, numbers: false });
      const b0 = pathBounds(plain.line.toPath());
      close(b0?.maxX ?? NaN, 100);
      const end = new NumberLine([0, 4, 1], { length: 200, numbers: false, tips: 'end' });
      const b1 = pathBounds(end.line.toPath());
      ok((b1?.maxX ?? 0) > 100 + 9, '箭头应伸出最末的刻度');
      close(b1?.minX ?? NaN, -100);
      equal(end.line.pathLayers(end.line.getStyle(lightTheme))[1]?.path.subpaths.length, 1);
      const both = new NumberLine([0, 4, 1], { length: 200, numbers: false, tips: 'both' });
      const b2 = pathBounds(both.line.toPath());
      ok((b2?.minX ?? 0) < -100 - 9);
      equal(both.line.pathLayers(both.line.getStyle(lightTheme))[1]?.path.subpaths.length, 2);
    },
  ],
  [
    'NumberLine 参数校验',
    () => {
      throws(() => new NumberLine([1, 1, 1]));
      throws(() => new NumberLine([0, 1, 0]));
      throws(() => new NumberLine([0, 1, -1]));
      throws(() => new NumberLine([0, 1, 1e-6]));
      throws(() => new NumberLine([0, NaN, 1]));
      throws(() => new NumberLine([0, 1], { length: 0 }));
      throws(() => new NumberLine([0, 1], { fontSize: -1 }));
      throws(() => new NumberLine([0, 1], { tickSize: -1 }));
      throws(() => new NumberLine([0, 1], { tips: 'start' as never }));
      // 不画刻度、不标数字时,再密的步长也不需要展开。
      equal(new NumberLine([0, 1, 1e-6], { ticks: false, numbers: false }).tickValues.length, 0);
    },
  ],
  [
    'NumberLine 能用于 Create(刻度依次出现)与 Transform',
    () => {
      const line = new NumberLine([0, 10, 1], { length: 200 });
      const create = new Create(line);
      create.begin();
      create.interpolate(0.5);
      const { calls, ctx } = fakeCtx();
      line.tickMarks?.render(ctx, lightTheme);
      const drawn = calls.filter((c) => c.op === 'moveTo').length;
      ok(drawn >= 5 && drawn <= 7, `生长一半时应画出大约一半的刻度,实际 ${drawn}`);
      create.finish();
      const t = new Transform(line, new NumberLine([0, 5, 1], { length: 100 }));
      t.begin();
      t.interpolate(0.3);
      ok((line.getMorphOverlay()?.layers.length ?? 0) > 3);
      t.finish();
    },
  ],
  [
    'NumberPlane:c2p / p2c 与 Axes 同一套映射;可以直接当 FunctionGraph 的坐标系',
    () => {
      const plane = new NumberPlane([-4, 4], [-3, 3], 320, 240);
      const axes = new Axes([-4, 4], [-3, 3], 320, 240);
      const p = plane.c2p(1.5, -2);
      close(p.x, axes.toLocal(1.5, -2).x);
      close(p.y, axes.toLocal(1.5, -2).y);
      const back = plane.p2c(p);
      close(back.x, 1.5, 1e-12);
      close(back.y, -2, 1e-12);
      const graph = new FunctionGraph((x) => x / 2, plane, 8);
      const q = graph.points[8];
      close(q?.x ?? NaN, plane.c2p(4, 2).x);
      close(q?.y ?? NaN, plane.c2p(4, 2).y);
    },
  ],
  [
    'NumberPlane 网格:主网格落在步长整数倍上,次网格在中间且不与主网格重复',
    () => {
      const plane = new NumberPlane([-2, 2], [-1, 1, 0.5], 200, 100);
      // 竖线 x = -2..2 共 5 条,横线 y = -1..1 步长 0.5 共 5 条。
      equal(subpathCount(plane.majorGrid), 10);
      // 次网格(细分 2):竖线 4 条、横线 4 条。
      equal(subpathCount(plane.minorGrid), 8);
      const none = new NumberPlane([-2, 2], [-1, 1], 200, 100, { minorDivisions: 1 });
      equal(none.minorGrid, null);
      const b = pathBounds(plane.majorGrid.toPath());
      close(b?.minX ?? NaN, -100);
      close(b?.maxY ?? NaN, 50);
      throws(() => new NumberPlane([-2, 2], [-1, 1], 200, 100, { minorDivisions: 0 }));
      throws(() => new NumberPlane([-2, 2], [-1, 1], 200, 100, { minorDivisions: 1.5 }));
      throws(() => new NumberPlane([-2, 2], [1, 1], 200, 100));
      throws(() => new NumberPlane([-2, 2], [-1, 1], 0, 100));
      throws(() => new NumberPlane([0, 1e6], [-1, 1], 200, 100));
    },
  ],
  [
    'NumberPlane 坐标轴:过原点;零点不在区间里时贴到较近的边;原点的数字不标',
    () => {
      const plane = new NumberPlane([-4, 4], [-3, 3], 320, 240, { numbers: true });
      close(plane.xAxis?.position.y ?? NaN, 0);
      close(plane.yAxis?.position.x ?? NaN, 0);
      equal(plane.xAxis?.numberLabels.length, 8);
      equal(plane.yAxis?.numberLabels.length, 6);
      const shifted = new NumberPlane([1, 5], [2, 6], 200, 200);
      close(shifted.xAxis?.position.y ?? NaN, 100);
      close(shifted.yAxis?.position.x ?? NaN, -100);
      const negative = new NumberPlane([-5, -1], [-6, -2], 200, 200);
      close(negative.xAxis?.position.y ?? NaN, -100);
      close(negative.yAxis?.position.x ?? NaN, 100);
      const bare = new NumberPlane([-1, 1], [-1, 1], 100, 100, { axes: false });
      equal(bare.xAxis, null);
      equal(bare.getChildren().length, 2);
    },
  ],
  [
    'NumberPlane 能用于 Create(网格线同时长出来)与 Transform',
    () => {
      const plane = new NumberPlane([-2, 2], [-2, 2], 200, 200);
      const create = new Create(plane);
      create.begin();
      create.interpolate(0.5);
      const { calls, ctx } = fakeCtx();
      plane.majorGrid.render(ctx, lightTheme);
      equal(calls.filter((c) => c.op === 'moveTo').length, 10, '所有网格线应同时在长');
      create.finish();
      const t = new Transform(plane, new NumberPlane([-1, 1], [-1, 1], 100, 100));
      t.begin();
      t.interpolate(0.5);
      ok((plane.getMorphOverlay()?.layers.length ?? 0) > 2);
      t.finish();
    },
  ],
]);
