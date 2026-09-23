import { installDomStub } from '../../testing/domStub';
import { close, equal, fakeCtx, ok, stateAt, suite, throws } from '../../testing/harness';
import { lerpColor } from '../color';
import { Group } from '../mobjects/Group';
import type { MObject } from '../mobjects/MObject';
import { NO_STYLE } from '../mobjects/MObject';
import { Circle, Label, Rectangle, Square } from '../mobjects/shapes';
import { Tex } from '../mobjects/tex';
import type { PathLayer } from '../path/draw';
import type { Affine, PathBounds, PathData } from '../path/path';
import {
  IDENTITY_AFFINE,
  multiplyAffine,
  pathBounds,
  similarityAffine,
  transformPath,
} from '../path/path';
import { Scene } from '../scene/Scene';
import type { StyleOverride } from '../theme/Theme';
import { lightTheme } from '../theme/presets';
import type { PlayContext } from './Animation';
import { linear } from './rateFunctions';
import { Transform } from './transform';

/** 与 Scene.play 给的 PlayContext 同样的算法:沿场景图组合变换、累积容器样式。 */
function sceneContext(roots: readonly MObject[]): PlayContext {
  const locate = (
    target: MObject,
  ): { matrix: Affine; inherited: Readonly<StyleOverride> } | null => {
    const visit = (
      node: MObject,
      parent: Affine,
      inherited: Readonly<StyleOverride>,
    ): { matrix: Affine; inherited: Readonly<StyleOverride> } | null => {
      const here = multiplyAffine(
        parent,
        similarityAffine(node.position.x, node.position.y, node.scale, node.rotation),
      );
      if (node === target) {
        return { matrix: here, inherited };
      }
      const childInherited = node.childInheritedStyle(inherited);
      for (const child of node.getChildren()) {
        const hit = visit(child, here, childInherited);
        if (hit) {
          return hit;
        }
      }
      return null;
    };
    for (const root of roots) {
      const hit = visit(root, IDENTITY_AFFINE, NO_STYLE);
      if (hit) {
        return hit;
      }
    }
    return null;
  };
  return {
    worldMatrix: (m) => locate(m)?.matrix ?? null,
    styleOf: (m) => m.getStyle(lightTheme, locate(m)?.inherited),
  };
}

function layersOf(m: MObject): readonly PathLayer[] {
  const overlay = m.getMorphOverlay();
  ok(overlay !== null, '变形期间应当挂着覆盖层');
  return overlay?.layers ?? [];
}

function boundsOf(path: PathData | undefined): PathBounds {
  const b = path ? pathBounds(path) : null;
  ok(b !== null, '路径是空的');
  return b ?? { minX: NaN, minY: NaN, maxX: NaN, maxY: NaN };
}

function sameBounds(a: PathBounds, b: PathBounds, tol: number, what: string): void {
  close(a.minX, b.minX, tol, `${what} minX`);
  close(a.minY, b.minY, tol, `${what} minY`);
  close(a.maxX, b.maxX, tol, `${what} maxX`);
  close(a.maxY, b.maxY, tol, `${what} maxY`);
}

export default suite('形状变形 Transform', [
  [
    '同一父节点:位置、大小、形状一起插值;开始时藏起目标,结束时源藏起、目标按原不透明度显示',
    () => {
      const a = new Circle(10).setStyle({ stroke: '#ff0000' });
      const b = new Square(40).setStyle({ stroke: '#0000ff' });
      b.moveTo({ x: 100, y: 0 });
      b.opacity = 0.6;
      const t = new Transform(a, b, { rateFunc: linear });
      t.begin();
      equal(b.opacity, 0, '开始时应藏起目标');
      sameBounds(boundsOf(layersOf(a)[0]?.path), { minX: -10, minY: -10, maxX: 10, maxY: 10 }, 1e-9, '起点');
      t.interpolate(0.5);
      const mid = boundsOf(layersOf(a)[0]?.path);
      close((mid.minX + mid.maxX) / 2, 50, 1e-9, '中途应在两者正中');
      close((mid.minY + mid.maxY) / 2, 0, 1e-9);
      ok(mid.maxX - mid.minX > 20 && mid.maxX - mid.minX < 40, '大小应在两者之间');
      equal(layersOf(a)[0]?.paint.stroke, lerpColor('#ff0000', '#0000ff', 0.5));
      close(a.opacity, 0.8, 1e-12, '不透明度也应插值');
      t.interpolate(1);
      sameBounds(boundsOf(layersOf(a)[0]?.path), { minX: 80, minY: -20, maxX: 120, maxY: 20 }, 1e-9, '终点');
      equal(layersOf(a)[0]?.paint.stroke, '#0000ff');
      t.finish();
      equal(a.getMorphOverlay(), null, '结束后不该留下覆盖层');
      equal(a.opacity, 0);
      equal(b.opacity, 0.6);
      equal(b.position.x, 100, '目标自身的变换不该被动过');
      equal(a.position.x, 0, '源自身的变换不该被动过');
    },
  ],
  [
    '不同父节点:按各自的世界变换换算(平移、缩放、旋转),容器继承来的样式照样生效,线宽跟着缩放',
    () => {
      const ga = new Group();
      ga.moveTo({ x: 100, y: 50 });
      ga.scale = 2;
      const a = new Circle(10);
      a.moveTo({ x: 5, y: 0 });
      ga.add(a);
      const gb = new Group().setStyle({ stroke: '#00ff00', strokeWidth: 4 });
      gb.moveTo({ x: -200, y: 0 });
      gb.rotation = Math.PI / 2;
      const b = new Rectangle(40, 20);
      b.moveTo({ x: 10, y: 0 });
      gb.add(b);
      const context = sceneContext([ga, gb]);
      const t = new Transform(a, b, { rateFunc: linear });
      t.begin(context);
      t.interpolate(1);
      const layer = layersOf(a)[0];
      const sourceWorld = context.worldMatrix(a) ?? IDENTITY_AFFINE;
      // 终点换回世界坐标就是目标在世界里的样子:(10,0) 绕 gb 原点转 90° → (0,10),再平移到 (-200,10);宽高对调。
      sameBounds(
        boundsOf(layer ? transformPath(layer.path, sourceWorld) : undefined),
        { minX: -210, minY: -10, maxX: -190, maxY: 30 },
        1e-6,
        '世界坐标里的终点',
      );
      equal(layer?.paint.stroke, '#00ff00', '容器继承的描边色没生效');
      close(layer?.paint.strokeWidth ?? NaN, 2, 1e-12, '目标线宽 4、源所在坐标系放大 2 倍,覆盖层里应是 2');
      t.finish();
      equal(a.opacity, 0);
      equal(b.opacity, 1);
    },
  ],
  [
    '组对组:子元素按顺序配对,多出来的从对面那一侧的中心长出来,少掉的缩回对面对应那片的中心',
    () => {
      const src = new Group().add(new Circle(10), new Circle(10).moveTo({ x: 30, y: 0 }));
      const tgt = new Group().add(
        new Square(10),
        new Square(10).moveTo({ x: 30, y: 0 }),
        new Square(10).moveTo({ x: 60, y: 0 }),
      );
      tgt.moveTo({ x: 0, y: 100 });
      const grow = new Transform(src, tgt, { rateFunc: linear });
      grow.begin();
      equal(layersOf(src).length, 3);
      sameBounds(boundsOf(layersOf(src)[2]?.path), { minX: 15, minY: 0, maxX: 15, maxY: 0 }, 1e-9, '新片的起点');
      grow.interpolate(1);
      sameBounds(boundsOf(layersOf(src)[2]?.path), { minX: 55, minY: 95, maxX: 65, maxY: 105 }, 1e-9, '新片的终点');
      // 组作为宿主时画覆盖层,不再逐个画子元素。
      const { ctx, calls } = fakeCtx();
      src.render(ctx, lightTheme);
      equal(calls.filter((c) => c.op === 'stroke').length, 3);
      grow.finish();
      equal(src.opacity, 0);
      const shrink = new Transform(tgt, src, { rateFunc: linear });
      shrink.begin();
      shrink.interpolate(1);
      // 第三个方块没有对应物:缩回对面(两个圆)整体的中心 —— 在 tgt 的坐标里是 (15, -100)。
      sameBounds(boundsOf(layersOf(tgt)[2]?.path), { minX: 15, minY: -100, maxX: 15, maxY: -100 }, 1e-9, '缩回点');
      shrink.finish();
      equal(tgt.opacity, 0);
      equal(src.opacity, 1);
    },
  ],
  [
    '组里各子元素自己的不透明度照样生效(源的淡成目标的),整组的不透明度由宿主负责',
    () => {
      const dim = new Circle(10);
      dim.opacity = 0.5;
      const src = new Group().add(dim);
      src.opacity = 0.8;
      const ghost = new Square(10);
      ghost.opacity = 0.2;
      const tgt = new Group().add(ghost);
      const t = new Transform(src, tgt, { rateFunc: linear });
      t.begin();
      close(src.getMorphOverlay()?.alphas?.[0] ?? NaN, 0.5, 1e-12);
      close(src.opacity, 0.8, 1e-12);
      t.interpolate(0.5);
      close(src.getMorphOverlay()?.alphas?.[0] ?? NaN, 0.35, 1e-12);
      close(src.opacity, 0.9, 1e-12, '整组不透明度从 0.8 插到目标组的 1');
      const { ctx, calls } = fakeCtx();
      src.render(ctx, lightTheme);
      close(Number(stateAt(calls, 'stroke', 'globalAlpha')), 0.9 * 0.35, 1e-12);
    },
  ],
  [
    '样式插值:填充 null ↔ 颜色按透明度淡入,线宽插值;一边没有描边时线宽取另一边、颜色淡入',
    () => {
      const a = new Circle(10).setStyle({ stroke: '#ff0000', strokeWidth: 2 });
      const b = new Circle(10).setStyle({ stroke: '#ff0000', fill: '#00ff00', strokeWidth: 6 });
      const t = new Transform(a, b, { rateFunc: linear });
      t.begin();
      t.interpolate(0.5);
      const paint = layersOf(a)[0]?.paint;
      equal(paint?.fill, 'rgba(0, 255, 0, 0.5)');
      close(paint?.strokeWidth ?? NaN, 4, 1e-12);
      t.finish();
      const c = new Circle(10).setStyle({ strokeWidth: 0, fill: '#0000ff' });
      const d = new Circle(10).setStyle({ stroke: '#000000', strokeWidth: 8, fill: null });
      const t2 = new Transform(c, d, { rateFunc: linear });
      t2.begin();
      t2.interpolate(0.5);
      const p2 = layersOf(c)[0]?.paint;
      equal(p2?.strokeWidth, 8, '线宽不该从 0 长出来');
      equal(p2?.stroke, 'rgba(0, 0, 0, 0.5)');
      equal(p2?.fill, 'rgba(0, 0, 255, 0.5)');
      t2.interpolate(1);
      equal(
        JSON.stringify(layersOf(c)[0]?.paint),
        JSON.stringify(d.pathLayers(d.getStyle(lightTheme))[0]?.paint),
        '终点颜料不精确',
      );
    },
  ],
  [
    '终态精确、可重放:方 → 圆 → 方来回变,原本半透明的方块恢复成原来的不透明度',
    () => {
      const sq = new Square(20);
      sq.opacity = 0.7;
      const ci = new Circle(12);
      ci.opacity = 0;
      const there = new Transform(sq, ci);
      const back = new Transform(ci, sq);
      there.begin();
      there.interpolate(0.4);
      there.finish();
      equal(sq.opacity, 0);
      equal(ci.opacity, 1, '预先藏起来的目标应恢复成 1');
      equal(sq.getMorphOverlay(), null);
      back.begin();
      equal(sq.opacity, 0);
      back.finish();
      equal(ci.opacity, 0);
      equal(sq.opacity, 0.7, '被藏起来的方块应恢复到藏之前的不透明度');
      there.begin();
      there.finish();
      equal(sq.opacity, 0);
      equal(ci.opacity, 1);
      equal(ci.getMorphOverlay(), null);
    },
  ],
  [
    '中途重新 begin(重播):沿用第一次记下的不透明度,不把插到一半的值当成初值',
    () => {
      const a = new Circle(10);
      a.opacity = 0.8;
      const b = new Square(20);
      b.opacity = 0.4;
      const t = new Transform(a, b, { rateFunc: linear });
      t.begin();
      t.interpolate(0.5);
      close(a.opacity, 0.6, 1e-12);
      t.begin();
      close(a.opacity, 0.8, 1e-12, '重新开始应回到最初的不透明度');
      t.finish();
      equal(a.opacity, 0);
      equal(b.opacity, 0.4);
      const back = new Transform(b, a);
      back.begin();
      back.finish();
      equal(a.opacity, 0.8, '藏起来时记下的应是最初的不透明度');
    },
  ],
  [
    '公式:逐个字形变形(多出来的字形从源的中心长出来);中文这类画布文字交叉淡化',
    () => {
      const a = new Tex('x').setStyle({ fontSize: 20 });
      const b = new Tex('x+y').setStyle({ fontSize: 20 });
      const t = new Transform(a, b, { rateFunc: linear });
      t.begin();
      equal(layersOf(a).length, 3);
      t.interpolate(1);
      const expected = b.pathLayers(b.getStyle(lightTheme));
      layersOf(a).forEach((layer, i) => {
        sameBounds(boundsOf(layer.path), boundsOf(expected[i]?.path), 1e-9, `第 ${i} 个字形`);
      });
      t.finish();
      const cjk = new Tex('\\text{递减}').setStyle({ fontSize: 20 });
      const plain = new Tex('a').setStyle({ fontSize: 20 });
      const fade = new Transform(cjk, plain, { rateFunc: linear });
      fade.begin();
      fade.interpolate(0.25);
      const { ctx, calls } = fakeCtx();
      cjk.render(ctx, lightTheme);
      equal(calls.filter((c) => c.op === 'fillText').map((c) => c.value).join(''), '递减');
      close(Number(stateAt(calls, 'fillText', 'globalAlpha')), 0.75, 1e-12, '源的中文应当在淡出');
    },
  ],
  [
    '文字对图形:Label 交叉淡出,图形从 Label 的中心长出来',
    () => {
      const label = new Label('hi');
      label.moveTo({ x: 40, y: 0 });
      const circle = new Circle(10);
      const group = new Group().add(label);
      const t = new Transform(group, circle, { rateFunc: linear });
      t.begin();
      const start = boundsOf(layersOf(group)[0]?.path);
      close(start.minX, 40, 1e-9);
      close(start.maxX, 40, 1e-9);
      t.interpolate(0.5);
      const { ctx, calls } = fakeCtx();
      group.render(ctx, lightTheme);
      equal(calls.find((c) => c.op === 'fillText')?.value, 'hi');
      close(Number(stateAt(calls, 'fillText', 'globalAlpha')), 0.5, 1e-12);
    },
  ],
  [
    '误用:源与目标相同、互相包含、有场景信息时不在场景里,都直接报错',
    () => {
      const c = new Circle(5);
      throws(() => new Transform(c, c));
      const inner = new Circle(5);
      const g = new Group().add(inner);
      throws(() => new Transform(g, inner).begin());
      throws(() => new Transform(inner, g).begin());
      const a = new Circle(5);
      const b = new Circle(5);
      throws(() => new Transform(a, b).begin(sceneContext([a])), '目标不在场景里应当报错');
      throws(() => new Transform(a, b).begin(sceneContext([b])), '源不在场景里应当报错');
      class Broken extends Circle {
        override pathLayers(): never {
          throw new Error('boom');
        }
      }
      const broken = new Broken(5);
      throws(() => new Transform(a, broken).begin());
      equal(broken.opacity, 1, 'begin 抛错时不该已经把目标藏起来');
      equal(a.getMorphOverlay(), null);
    },
  ],
  [
    '变形期间源不参与剔除(目标可能在别处),结束后恢复原来的剔除半径',
    () => {
      const a = new Circle(10);
      const b = new Circle(10).moveTo({ x: 5000, y: 0 });
      const holder = new Group().add(a);
      const t = new Transform(a, b);
      t.begin();
      equal(a.getCullRadius(), Infinity);
      equal(holder.getCullRadius(), Infinity, '容器问子元素时也应拿到 Infinity');
      t.finish();
      equal(a.getCullRadius(), 10);
      ok(Number.isFinite(holder.getCullRadius()));
    },
  ],
  [
    '往返型缓动:结束时回到开始时的样子(源照常显示、目标仍藏着);源缩放为 0 时退化成交叉淡化',
    () => {
      const a = new Circle(10);
      a.opacity = 0.9;
      const b = new Circle(20);
      const t = new Transform(a, b, { rateFunc: (x) => 4 * x * (1 - x) });
      t.begin();
      t.finish();
      equal(a.getMorphOverlay(), null);
      equal(a.opacity, 0.9);
      equal(b.opacity, 0);
      const flat = new Circle(10);
      flat.scale = 0;
      const c = new Circle(10);
      c.opacity = 0.5;
      const fade = new Transform(flat, c, { rateFunc: linear });
      fade.begin();
      equal(flat.getMorphOverlay(), null);
      fade.interpolate(0.5);
      close(c.opacity, 0.25, 1e-12);
      fade.finish();
      equal(flat.opacity, 0);
      equal(c.opacity, 0.5);
    },
  ],
  [
    'Scene.play 端到端:不同容器里的两个对象变形,播完终态精确,中途画的是覆盖层',
    async () => {
      const dom = installDomStub();
      try {
        const canvas = dom.canvas();
        const scene = new Scene(canvas, { theme: lightTheme });
        const a = new Square(40);
        const holder = new Group().add(a);
        holder.moveTo({ x: -100, y: 0 });
        const b = new Circle(30);
        b.moveTo({ x: 100, y: 0 });
        scene.add(holder, b);
        let done = false;
        void scene.play(new Transform(a, b, { runTime: 0.2 })).then(() => {
          done = true;
        });
        equal(b.opacity, 0, 'begin 同步执行,目标应当已经藏起来');
        dom.frame(16);
        await dom.flush();
        ok(a.getMorphOverlay() !== null, '播放中应挂着覆盖层');
        for (let i = 0; i < 40 && !done; i++) {
          dom.frame(16);
          await dom.flush();
        }
        ok(done, '动画没有结束');
        equal(a.getMorphOverlay(), null);
        equal(a.opacity, 0);
        equal(b.opacity, 1);
        scene.dispose();
      } finally {
        dom.restore();
      }
    },
  ],
]);
