import { installDomStub } from '../../testing/domStub';
import { close, equal, fakeCtx, ok, suite, throws } from '../../testing/harness';
import type { FakeCtxCall } from '../../testing/harness';
import { Group } from '../mobjects/Group';
import type { MObject } from '../mobjects/MObject';
import { NO_STYLE } from '../mobjects/MObject';
import { Circle, Square } from '../mobjects/shapes';
import { Tex } from '../mobjects/tex';
import type { Point } from '../mobjects/types';
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
import type { TransformMatchingTexOptions } from './transformMatching';
import { TransformMatchingTex, alignInOrder, pairNearest } from './transformMatching';

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

const NO_BOUNDS: PathBounds = { minX: NaN, minY: NaN, maxX: NaN, maxY: NaN };

function boundsOf(path: PathData | undefined): PathBounds {
  const b = path ? pathBounds(path) : null;
  ok(b !== null, '路径是空的');
  return b ?? NO_BOUNDS;
}

function sameBounds(a: PathBounds | null, b: PathBounds | null, tol = 1e-6): boolean {
  return (
    a !== null &&
    b !== null &&
    Math.abs(a.minX - b.minX) < tol &&
    Math.abs(a.minY - b.minY) < tol &&
    Math.abs(a.maxX - b.maxX) < tol &&
    Math.abs(a.maxY - b.maxY) < tol
  );
}

/** 公式逐图元的包围盒(按亮色主题的样式,平移 shift;画布文字为 null)。 */
function glyphBounds(t: Tex, shift: Point = { x: 0, y: 0 }): Array<PathBounds | null> {
  return t.primitiveLayers(t.getStyle(lightTheme)).map((layer) => {
    const b = layer ? pathBounds(layer.path) : null;
    return b
      ? { minX: b.minX + shift.x, minY: b.minY + shift.y, maxX: b.maxX + shift.x, maxY: b.maxY + shift.y }
      : null;
  });
}

interface TrackView {
  from: PathData;
  to: PathData;
  start: PathBounds;
  end: PathBounds;
  startAlpha: number;
  endAlpha: number;
}

/** 覆盖层里每一层在进度 0 与 1 时的样子(interpolate 之后停在 1)。 */
function tracksOf(anim: TransformMatchingTex, host: MObject): TrackView[] {
  anim.interpolate(0);
  const o0 = host.getMorphOverlay();
  anim.interpolate(1);
  const o1 = host.getMorphOverlay();
  ok(o0 !== null && o1 !== null, '变形期间应当挂着覆盖层');
  return (o0?.layers ?? []).map((layer, i) => {
    const to = o1?.layers[i]?.path ?? layer.path;
    return {
      from: layer.path,
      to,
      start: boundsOf(layer.path),
      end: boundsOf(to),
      startAlpha: o0?.alphas?.[i] ?? 1,
      endAlpha: o1?.alphas?.[i] ?? 1,
    };
  });
}

/**
 * 把轨迹写成配对代码(排好序,空格分隔):
 * i→j 源第 i 个图元移到目标第 j 个;i→∅ 淡出;∅→j 淡入;i→j(并) 并入目标 j 并淡出;i(分)→j 从源 i 分出、淡入。
 */
function codes(tracks: readonly TrackView[], src: Tex, tgt: Tex, shift: Point): string {
  const a = glyphBounds(src);
  const b = glyphBounds(tgt, shift);
  const find = (list: Array<PathBounds | null>, x: PathBounds): number => list.findIndex((y) => sameBounds(x, y));
  return tracks
    .map((t) => {
      const i = find(a, t.start);
      const j = find(b, t.end);
      if (t.startAlpha > 0 && t.endAlpha > 0) {
        return `${i < 0 ? '?' : i}→${j < 0 ? '?' : j}`;
      }
      if (t.endAlpha === 0) {
        return j >= 0 ? `${i}→${j}(并)` : `${i < 0 ? '?' : i}→∅`;
      }
      return i >= 0 ? `${i}(分)→${j}` : `∅→${j < 0 ? '?' : j}`;
    })
    .sort()
    .join(' ');
}

/** 路径 to 是 from 整体平移了 (dx, dy)。 */
function isTranslation(from: PathData, to: PathData, dx: number, dy: number): boolean {
  if (from.subpaths.length !== to.subpaths.length) {
    return false;
  }
  return from.subpaths.every((sub, s) => {
    const q = to.subpaths[s]?.points ?? [];
    return (
      q.length === sub.points.length &&
      sub.points.every((v, k) => Math.abs((q[k] ?? NaN) - v - (k % 2 === 0 ? dx : dy)) < 1e-9)
    );
  });
}

function center(b: PathBounds): Point {
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

/** 同一父节点下的一对公式:目标平移 shift,字号 20。 */
function pair(src: string, tgt: string, shift: Point, options?: TransformMatchingTexOptions) {
  const a = new Tex(src).setStyle({ fontSize: 20 });
  const b = new Tex(tgt).setStyle({ fontSize: 20 });
  b.moveTo(shift);
  const anim = new TransformMatchingTex(a, b, { rateFunc: linear, ...options });
  anim.begin();
  return { a, b, anim, tracks: tracksOf(anim, a), code: () => codes(tracksOf(anim, a), a, b, shift) };
}

/** 画一遍覆盖层的附加部分(画布文字),返回每次 fillText 时的文字、不透明度与摆放矩阵的平移。 */
function textDraws(host: MObject): Array<{ text: unknown; alpha: number; x: number; y: number }> {
  const { ctx, calls } = fakeCtx();
  host.getMorphOverlay()?.extra?.(ctx);
  const out: Array<{ text: unknown; alpha: number; x: number; y: number }> = [];
  let alpha = 1;
  let last: FakeCtxCall | null = null;
  for (const c of calls) {
    if (c.op === '=globalAlpha') {
      alpha = Number(c.value);
    } else if (c.op === 'transform') {
      last = c;
    } else if (c.op === 'fillText') {
      out.push({ text: c.value, alpha, x: last?.args[4] ?? NaN, y: last?.args[5] ?? NaN });
    }
  }
  return out;
}

export default suite('按式子结构变形 TransformMatchingTex', [
  [
    '移项 a²+b²=c² → a²=c²−b²:相同的项逐点平移到目标位置(纯位移,终点精确),+ 淡出、− 淡入',
    () => {
      const shift = { x: 30, y: 80 };
      const { a, b, anim, tracks, code } = pair('a^2+b^2=c^2', 'a^2=c^2-b^2', shift);
      equal(b.opacity, 0, '开始时应藏起目标');
      // 源:a 2 + b 2 = c 2;目标:a 2 = c 2 − b 2。
      equal(code(), '0→0 1→1 2→∅ 3→6 4→7 5→2 6→3 7→4 ∅→5');
      const src = glyphBounds(a);
      const tgt = glyphBounds(b, shift);
      for (const t of tracks.filter((x) => x.startAlpha > 0 && x.endAlpha > 0)) {
        const d = { x: center(t.end).x - center(t.start).x, y: center(t.end).y - center(t.start).y };
        ok(isTranslation(t.from, t.to, d.x, d.y), '同一字形应当是纯平移');
      }
      // b 从第 3 个移到第 6 个:中途正好在两者中点。
      const bTrack = tracks.find((t) => sameBounds(t.start, src[3] ?? null));
      anim.interpolate(0.5);
      const mid = a.getMorphOverlay()?.layers[tracks.indexOf(bTrack as TrackView)]?.path;
      const want = center(src[3] ?? NO_BOUNDS);
      const there = center(tgt[6] ?? NO_BOUNDS);
      close(center(boundsOf(mid)).x, (want.x + there.x) / 2, 1e-9);
      close(center(boundsOf(mid)).y, (want.y + there.y) / 2, 1e-9);
      anim.finish();
      equal(a.getMorphOverlay(), null);
      equal(a.opacity, 0);
      equal(b.opacity, 1);
    },
  ],
  [
    '配不上的:源的缩小淡出占 [0, 1−fadeLag],目标的从小淡入占 [fadeLag, 1];fadeLag 0、fadeScale 1 时全程同时、不缩放',
    () => {
      const shift = { x: 0, y: 60 };
      const { a, b, anim, code } = pair('x=1', 'x=2', shift);
      equal(code(), '0→0 1→1 2→∅ ∅→2');
      const one = glyphBounds(a)[2] ?? NO_BOUNDS;
      const two = glyphBounds(b, shift)[2] ?? NO_BOUNDS;
      const layerOf = (alpha: number, of: PathBounds, scale: number) => {
        anim.interpolate(alpha);
        const o = a.getMorphOverlay();
        const i = (o?.layers ?? []).findIndex((l) => {
          const c = center(boundsOf(l.path));
          return Math.abs(c.x - center(of).x) < 1e-9 && Math.abs(c.y - center(of).y) < 1e-9 &&
            Math.abs(boundsOf(l.path).maxX - boundsOf(l.path).minX - (of.maxX - of.minX) * scale) < 1e-9;
        });
        ok(i >= 0, `进度 ${alpha} 时找不到缩放 ${scale} 的那一层`);
        return o?.alphas?.[i] ?? NaN;
      };
      close(layerOf(0, one, 1), 1, 1e-12, '淡出的一开始完整显示');
      close(layerOf(0, two, 0.8), 0, 1e-12, '淡入的一开始从 0.8 倍、看不见');
      close(layerOf(0.35, one, 0.9), 0.5, 1e-12, '淡出走到一半:缩到 0.9、半透明');
      close(layerOf(0.35, two, 0.8 + 0.2 * (0.05 / 0.7)), 0.05 / 0.7, 1e-12, '淡入刚开始');
      close(layerOf(0.3, two, 0.8), 0, 1e-12, 'fadeLag 之前淡入的还没出现');
      close(layerOf(0.7, one, 0.8), 0, 1e-12, '1 − fadeLag 时淡出的已经消失');
      close(layerOf(1, two, 1), 1, 1e-12);
      anim.finish();
      const flat = pair('x=1', 'x=2', shift, { fadeLag: 0, fadeScale: 1 });
      flat.anim.interpolate(0.5);
      const o = flat.a.getMorphOverlay();
      const alphas = (o?.layers ?? []).map((l, i) => ({ b: boundsOf(l.path), k: o?.alphas?.[i] }));
      ok(alphas.some((x) => sameBounds(x.b, one) && x.k === 0.5), '淡出的应在原地、一半不透明');
      ok(alphas.some((x) => sameBounds(x.b, two) && x.k === 0.5), '淡入的应在原地、一半不透明');
    },
  ],
  [
    '同名 \\class 整体对应:部分里先按身份配、剩下的强行变形(不淡出淡入);partMap 给部分改名',
    () => {
      const shift = { x: 0, y: 60 };
      // 源:x + 1 = y;目标:y = x 2 分数线。
      const tagged = pair('\\class{t}{x+1}=y', 'y=\\class{t}{\\frac{x}{2}}', shift);
      equal(tagged.code(), '0→2 1→3 2→4 3→1 4→0', '部分 t 里 + 变成 2、1 变成分数线,其余平移');
      ok(tagged.tracks.every((t) => t.startAlpha === 1 && t.endAlpha === 1), '整体对应的部分里不该有淡入淡出');
      const plain = pair('x+1=y', 'y=\\frac{x}{2}', shift);
      equal(plain.code(), '0→2 1→∅ 2→∅ 3→1 4→0 ∅→3 ∅→4', '不起名时 +、1 淡出,2 与分数线淡入');
      const renamed = pair('\\class{A}{x+1}=y', 'y=\\class{B}{\\frac{x}{2}}', shift, {
        partMap: { A: 'B' },
      });
      equal(renamed.code(), '0→2 1→3 2→4 3→1 4→0');
      const unmapped = pair('\\class{A}{x+1}=y', 'y=\\class{B}{\\frac{x}{2}}', shift);
      equal(unmapped.code(), plain.code(), '名字对不上就当没起名');
      // partMap 只认自己的键:原型上的名字(constructor)不能被当成改名,照样按同名部分对应。
      const proto = pair('\\class{constructor}{x+1}=y', 'y=\\class{constructor}{\\frac{x}{2}}', shift, {
        partMap: {},
      });
      equal(proto.code(), '0→2 1→3 2→4 3→1 4→0');
    },
  ],
  [
    '顺序交叉的项就近配(a+b → b+a 全是平移);多出来的同一符号并入 / 分出,duplicates: fade 时原地淡化',
    () => {
      const shift = { x: 0, y: 60 };
      equal(pair('a+b', 'b+a', shift).code(), '0→2 1→1 2→0');
      // 源:x + x;目标:2 x。第二个 x 飞进目标的 x 并淡出。
      const merge = pair('x+x', '2x', shift);
      equal(merge.code(), '0→1 1→∅ 2→1(并) ∅→0');
      const mergeTrack = merge.tracks.find((t) => t.endAlpha === 0 && sameBounds(t.start, glyphBounds(merge.a)[2] ?? null));
      merge.anim.interpolate(0.5);
      const k = merge.a.getMorphOverlay()?.alphas?.[merge.tracks.indexOf(mergeTrack as TrackView)];
      close(k ?? NaN, 0.5, 1e-12, '并入的副本边走边淡');
      equal(pair('x+x', '2x', shift, { duplicates: 'fade' }).code(), '0→1 1→∅ 2→∅ ∅→0');
      // 反过来:目标多出来的 x 从源的 x 分出来。
      equal(pair('2x', 'x+x', shift).code(), '0→∅ 1(分)→2 1→0 ∅→1');
      // 保序配对有好几种一样长的配法时取挪得最少的:前面的 a + a 原地不动,多出来的 + a 从最近的副本分出来。
      equal(pair('a+a', 'a+a+a', shift).code(), '0→0 1(分)→3 1→1 2(分)→4 2→2');
      equal(pair('a+a+a', 'a+a', shift).code(), '0→0 1→1 2→2 3→1(并) 4→2(并)');
    },
  ],
  [
    '同一符号换了字号也配对(缩放着移过去,x² → 2ˣ);matchAcrossSizes: false 时只配同字号的',
    () => {
      const shift = { x: 0, y: 60 };
      const swap = pair('x^2', '2^x', shift);
      equal(swap.code(), '0→1 1→0');
      const xTrack = swap.tracks.find((t) => sameBounds(t.start, glyphBounds(swap.a)[0] ?? null));
      ok(xTrack !== undefined);
      if (xTrack) {
        const ratio = (xTrack.end.maxX - xTrack.end.minX) / (xTrack.start.maxX - xTrack.start.minX);
        close(ratio, 0.707, 0.01, 'x 应缩到上标大小');
      }
      equal(pair('x^2', '2^x', shift, { matchAcrossSizes: false }).code(), '0→∅ 1→∅ ∅→0 ∅→1');
    },
  ],
  [
    '配对的两步:保序配对取最多的对数、一样多时取挪得最少的;剩下的同键就近配',
    () => {
      const at = (key: string, x: number): { key: string; rel: Point } => ({ key, rel: { x, y: 0 } });
      const key = (g: { key: string }): string => g.key;
      const run = (pairs: ReadonlyArray<readonly [number, number]>): string => JSON.stringify(pairs);
      // 只能配上一对:x 挪 1 比 y 挪 2 近。
      equal(run(alignInOrder([at('y', 0), at('x', 1)], [at('x', 0), at('y', 2)], key)), '[[1,0]]');
      // 同一个 x 有两处可去:去原地那一处。
      equal(run(alignInOrder([at('x', 10)], [at('x', 0), at('x', 10)], key)), '[[0,1]]');
      equal(run(alignInOrder([at('x', 0), at('x', 10)], [at('x', 10)], key)), '[[1,0]]');
      // 对数优先于距离:a b 两对都要配上,哪怕各挪得远一些。
      equal(run(alignInOrder([at('a', 0), at('b', 1)], [at('a', 5), at('b', 6), at('a', 0)], key)), '[[0,0],[1,1]]');
      equal(run(alignInOrder([], [at('a', 0)], key)), '[]');
      // 规模太大(超过一百万格)时退成顺序贪心:照样保序、一一对应。
      const many = (n: number) => Array.from({ length: n }, (_, i) => at('x', i));
      const big = alignInOrder(many(1100), many(1000), key);
      equal(big.length, 1000);
      ok(big.every(([i, j], k) => i === k && j === k), '贪心配对应当一一对应、保序');
      // 交叉的就近配:谁离得近谁先配,一个只配一次。
      equal(run(pairNearest([at('x', 0), at('x', 10)], [at('x', 9), at('x', 1)], key)), '[[0,1],[1,0]]');
      equal(run(pairNearest([at('x', 0), at('y', 3)], [at('x', 5)], key)), '[[0,0]]');
    },
  ],
  [
    '整组一样的子式先当成一个整体配、大的先配:指数跟着底数走,根式整块挪',
    () => {
      const shift = { x: 0, y: 60 };
      // x² + x → x + x²:x² 整块挪到右边(而不是底数留在原地、指数单飞)。
      equal(pair('x^2+x', 'x+x^2', shift).code(), '0→2 1→3 2→1 3→0');
      // 源:x 2 √ 横线 + x 2;目标:x 2 + x 2 √ 横线。整个根式先配上,里面的 x² 不会被外面的 x² 抢走。
      equal(pair('\\sqrt{x^2}+x^2', 'x^2+\\sqrt{x^2}', shift).code(), '0→3 1→4 2→5 3→6 4→2 5→0 6→1');
    },
  ],
  [
    'transformMismatches:配不上的按阅读顺序强行变形(类似 Transform),多出来的从对面中心长出来',
    () => {
      const shift = { x: 0, y: 60 };
      equal(pair('x=1', 'x=2', shift, { transformMismatches: true }).code(), '0→0 1→1 2→2');
      const grow = pair('x=1', 'x=2+3', shift, { transformMismatches: true });
      equal(grow.code(), '0→0 1→1 2→2 ?→3 ?→4', '多出来的两个从一点长出来');
      const born = grow.tracks.filter((t) => t.start.minX === t.start.maxX);
      equal(born.length, 2);
      ok(born.every((t) => t.startAlpha === 1), '长出来的不靠淡入');
    },
  ],
  [
    '\\text 里的中文按文字内容配对(平移过去),配不上的交叉淡化',
    () => {
      const shift = { x: 10, y: 60 };
      const moved = pair('\\text{速度}=v', 'v=\\text{速度}', shift);
      const at0 = (moved.anim.interpolate(0), textDraws(moved.a));
      const at1 = (moved.anim.interpolate(1), textDraws(moved.a));
      moved.anim.interpolate(0.5);
      const mid = textDraws(moved.a);
      equal(mid.map((d) => d.text).join(''), '速度');
      mid.forEach((d, i) => {
        close(d.alpha, 1, 1e-12, '配上的文字不透明度不变');
        close(d.x, ((at0[i]?.x ?? NaN) + (at1[i]?.x ?? NaN)) / 2, 1e-9, '中途在两者中点');
        close(d.y, ((at0[i]?.y ?? NaN) + (at1[i]?.y ?? NaN)) / 2, 1e-9);
      });
      ok((at1[0]?.x ?? 0) > (at0[0]?.x ?? 0) + 20, '「速」应从左边挪到右边');
      const swapped = pair('\\text{速度}', '\\text{路程}', shift);
      swapped.anim.interpolate(0.35);
      const fades = textDraws(swapped.a);
      equal(fades.map((d) => d.text).join(''), '速度路程');
      close(fades[0]?.alpha ?? NaN, 0.5, 1e-12, '源的文字在淡出');
      close(fades[2]?.alpha ?? NaN, 0.05 / 0.7, 1e-12, '目标的文字在淡入');
      equal(swapped.tracks.length, 0, '文字没有路径层');
    },
  ],
  [
    '终态精确、可重放:结束时源藏起、目标按原不透明度显示;中途重新 begin 从头开始;来回变恢复原来的不透明度',
    () => {
      const shift = { x: 0, y: 60 };
      const a = new Tex('\\frac{a}{b}=c').setStyle({ fontSize: 20 });
      a.opacity = 0.8;
      const b = new Tex('a=bc').setStyle({ fontSize: 20 });
      b.moveTo(shift);
      b.opacity = 0.6;
      const there = new TransformMatchingTex(a, b, { rateFunc: linear });
      there.begin();
      there.interpolate(0.4);
      there.begin();
      const again = a.getMorphOverlay();
      const src = glyphBounds(a);
      ok(
        (again?.layers ?? []).every((l, i) => (again?.alphas?.[i] ?? 1) === 0 || src.some((s) => sameBounds(s, boundsOf(l.path)))),
        '重新 begin 后应回到源的样子',
      );
      close(a.opacity, 0.8, 1e-12);
      there.interpolate(1);
      const end = a.getMorphOverlay();
      const tgt = glyphBounds(b, shift);
      const visible = (end?.layers ?? []).filter((_, i) => (end?.alphas?.[i] ?? 1) > 0);
      equal(visible.length, tgt.length, '走完时看得见的层与目标图元一一对应');
      ok(visible.every((l) => tgt.some((t) => sameBounds(t, boundsOf(l.path)))), '走完时每一层都落在目标的图元上');
      there.finish();
      equal(a.getMorphOverlay(), null);
      equal(a.opacity, 0);
      equal(b.opacity, 0.6);
      const back = new TransformMatchingTex(b, a);
      back.begin();
      back.finish();
      equal(a.opacity, 0.8, '被藏起来的源应恢复到藏之前的不透明度');
      equal(b.opacity, 0);
      // 往返型缓动:结束时回到开始的样子。
      const pingpong = new TransformMatchingTex(a, b, { rateFunc: (x) => 4 * x * (1 - x) });
      pingpong.begin();
      pingpong.finish();
      equal(a.getMorphOverlay(), null);
      equal(a.opacity, 0.8);
      equal(b.opacity, 0);
    },
  ],
  [
    '误用:源与目标相同、互相包含、有场景信息时不在场景里,以及不合法的选项,都直接报错',
    () => {
      const t = new Tex('x');
      throws(() => new TransformMatchingTex(t, t));
      const inner = new Tex('y');
      const g = new Group().add(inner);
      throws(() => new TransformMatchingTex(g, inner).begin());
      const a = new Tex('a');
      const b = new Tex('b');
      throws(() => new TransformMatchingTex(a, b).begin(sceneContext([a])), '目标不在场景里应当报错');
      throws(() => new TransformMatchingTex(a, b).begin(sceneContext([b])), '源不在场景里应当报错');
      equal(b.opacity, 1, 'begin 抛错时不该已经把目标藏起来');
      let message = '';
      try {
        new TransformMatchingTex(a, b).begin(sceneContext([a]));
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      ok(message.startsWith('TransformMatchingTex:'), `报错应带动画名:${message}`);
      for (const bad of [
        { fadeLag: 1 },
        { fadeLag: -0.1 },
        { fadeLag: Number.NaN },
        { fadeScale: -1 },
        { duplicates: 'nope' },
        { partMap: { a: 1 } },
      ]) {
        throws(() => new TransformMatchingTex(a, b, bad as unknown as TransformMatchingTexOptions), JSON.stringify(bad));
      }
    },
  ],
  [
    '组:公式叶子按结构配对,非公式的叶子按顺序变形(圆变方,同 Transform)',
    () => {
      const shift = { x: 0, y: 60 };
      const ta = new Tex('x+1').setStyle({ fontSize: 20 });
      const tb = new Tex('1+x').setStyle({ fontSize: 20 });
      const src = new Group().add(ta, new Circle(10).moveTo({ x: 40, y: 0 }));
      const tgt = new Group().add(tb, new Square(20).moveTo({ x: 40, y: 0 }));
      tgt.moveTo(shift);
      const anim = new TransformMatchingTex(src, tgt, { rateFunc: linear });
      anim.begin();
      const tracks = tracksOf(anim, src);
      equal(tracks.length, 4);
      equal(codes(tracks.slice(0, 3), ta, tb, shift), '0→2 1→1 2→0');
      const shape = tracks[3];
      ok(sameBounds(shape?.start ?? null, { minX: 30, minY: -10, maxX: 50, maxY: 10 }), '圆的起点');
      ok(sameBounds(shape?.end ?? null, { minX: 30, minY: 50, maxX: 50, maxY: 70 }), '方的终点');
      anim.finish();
      equal(src.opacity, 0);
      equal(tgt.opacity, 1);
    },
  ],
  [
    '不同容器:按各自的世界变换与继承的字号换算,走完时源坐标系里的每一层换回世界就是目标的字形',
    () => {
      const ga = new Group();
      ga.moveTo({ x: 100, y: 50 });
      ga.scale = 2;
      const a = new Tex('a+b').setStyle({ fontSize: 20 });
      ga.add(a);
      const gb = new Group().setStyle({ fontSize: 30 });
      gb.moveTo({ x: -200, y: 0 });
      gb.rotation = Math.PI / 6;
      const b = new Tex('b+a');
      gb.add(b);
      const context = sceneContext([ga, gb]);
      const anim = new TransformMatchingTex(a, b, { rateFunc: linear });
      anim.begin(context);
      anim.interpolate(1);
      const sourceWorld = context.worldMatrix(a) ?? IDENTITY_AFFINE;
      const targetWorld = context.worldMatrix(b) ?? IDENTITY_AFFINE;
      const want = b.primitiveLayers(context.styleOf(b)).map((l) => (l ? pathBounds(transformPath(l.path, targetWorld)) : null));
      const got = (a.getMorphOverlay()?.layers ?? []).map((l) => pathBounds(transformPath(l.path, sourceWorld)));
      equal(got.length, 3);
      ok(got.every((g) => want.some((w) => sameBounds(g, w, 1e-6))), '世界坐标里的终点应与目标的字形重合');
      anim.finish();
      equal(a.opacity, 0);
      equal(b.opacity, 1);
    },
  ],
  [
    'Scene.play 端到端:推导一步,播放中挂着覆盖层,播完终态精确',
    async () => {
      const dom = installDomStub();
      try {
        const canvas = dom.canvas();
        const scene = new Scene(canvas, { theme: lightTheme });
        const a = new Tex('\\class{lhs}{2x}+3=7');
        const holder = new Group().add(a);
        holder.moveTo({ x: -50, y: 0 });
        const b = new Tex('\\class{lhs}{2x}=7-3');
        b.moveTo({ x: 0, y: 80 });
        scene.add(holder, b);
        let done = false;
        void scene.play(new TransformMatchingTex(a, b, { runTime: 0.2 })).then(() => {
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
