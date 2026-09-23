import { lerpColor } from '../color';
import type { TexText } from '../math/typeset';
import { textAdvance } from '../math/typeset';
import type { MObject, MorphOverlay } from '../mobjects/MObject';
import { Tex, drawTexText } from '../mobjects/tex';
import type { Point } from '../mobjects/types';
import { lerp } from '../mobjects/types';
import type { PathLayer, PathPaint } from '../path/draw';
import { alignPaths, collapsePath, lerpPath } from '../path/morph';
import type { Affine, PathBounds, PathData } from '../path/path';
import { IDENTITY_AFFINE, multiplyAffine, pathBounds, transformPath } from '../path/path';
import type { PlayContext } from './Animation';
import type { Piece } from './family';
import { collectPieces, piecesCenter, transformLayer } from './family';
import type { MorphPair, MorphPlan, Residual, TransformOptions } from './transform';
import { Transform, drawResiduals, lerpPaint, pairPieces } from './transform';

export interface TransformMatchingTexOptions extends TransformOptions {
  /**
   * 部分改名:源里叫 A 的部分对应目标里叫 B 的部分,写成 { A: 'B' }。
   * 部分即 \class{名字}{…} / \cssId{名字}{…} 标出来的子式。
   */
  partMap?: Readonly<Record<string, string>>;
  /**
   * 没配上对的也按阅读顺序强行变形(类似 Transform),而不是淡出、淡入。缺省 false。
   */
  transformMismatches?: boolean;
  /**
   * 同一个符号字号不同也配对(缩放着移过去,比如指数挪下来当系数)。缺省 true;
   * false 时只配同一字形、字号相近的。
   */
  matchAcrossSizes?: boolean;
  /**
   * 同一个符号多出来的副本怎么办:'merge'(缺省)飞向配上对的同一符号并淡出(x + x → 2x 的两个 x 合成一个),
   * 目标多出来的从源里同一符号那里分出来;'fade' 原地淡出、淡入。
   */
  duplicates?: 'merge' | 'fade';
  /**
   * 淡出与淡入错开多少([0, 1)):淡出占进度的 [0, 1 − fadeLag],淡入占 [fadeLag, 1]。
   * 0 为全程同时;缺省 0.3 —— 先走的先淡掉、新来的后出现,中途不挤成一团。
   */
  fadeLag?: number;
  /** 淡出时缩到、淡入时从这个比例开始(绕各自中心);1 为不缩放,缺省 0.8。 */
  fadeScale?: number;
}

/** 画布文字在宿主坐标里的样子。字体归一成 100px、字号并进矩阵:插值时字体串不跳,只有矩阵在变。 */
interface TextPose {
  readonly text: string;
  readonly font: string;
  readonly matrix: Affine;
  readonly color: string;
}

/** 可配对的最小单元:公式里的一个字形、一条线,或一个画布文字。 */
interface Glyph {
  /** 身份键 / 符号键(见 TexPrimitive)。 */
  readonly key: string;
  readonly symbol: string;
  /** 所在的命名部分,外层在前(源一侧已按 partMap 改过名)。 */
  readonly parts: readonly string[];
  /** 所在的结构分组(同一侧内唯一的编号),外层在前。 */
  readonly groups: readonly string[];
  /** 宿主坐标里的几何;画布文字为 null。 */
  readonly layer: PathLayer | null;
  /** 画布文字;字形为 null。 */
  readonly text: TextPose | null;
  /** 所在叶子(公式)的不透明度(根以下累积,见 Piece.opacity)。 */
  readonly opacity: number;
  /** 宿主坐标里的包围盒与中心。 */
  readonly bounds: PathBounds;
  readonly center: Point;
  /** 在自己这一侧的相对位置(左边缘为 0、竖直居中,按这一侧的高度归一):量「就近」用。 */
  rel: Point;
}

/** 一条路径轨迹:进度窗口 [start, end] 内从 from 插到 to。 */
interface Track {
  readonly from: PathData;
  readonly to: PathData;
  readonly fromPaint: PathPaint;
  readonly toPaint: PathPaint;
  readonly fromOpacity: number;
  readonly toOpacity: number;
  readonly start: number;
  readonly end: number;
}

/** 一条文字轨迹:同上,插的是摆放矩阵与颜色。 */
interface TextTrack {
  readonly from: TextPose;
  readonly to: TextPose;
  readonly fromOpacity: number;
  readonly toOpacity: number;
  readonly start: number;
  readonly end: number;
}

type Pair = readonly [number, number];

/** 保序对齐(最长公共子序列)的 DP 规模上限;再大就退成顺序贪心。 */
const ALIGN_LIMIT = 1_000_000;

/** 窗口里的局部进度。全程窗口原样透传(弹性缓动的过冲照样生效),部分窗口夹在 [0, 1]。 */
function local(alpha: number, start: number, end: number): number {
  if (start <= 0 && end >= 1) {
    return alpha;
  }
  if (alpha <= start) {
    return 0;
  }
  if (alpha >= end) {
    return 1;
  }
  return (alpha - start) / (end - start);
}

function lerpAffine(a: Affine, b: Affine, t: number): Affine {
  if (t <= 0) {
    return a;
  }
  if (t >= 1) {
    return b;
  }
  return [
    lerp(a[0], b[0], t),
    lerp(a[1], b[1], t),
    lerp(a[2], b[2], t),
    lerp(a[3], b[3], t),
    lerp(a[4], b[4], t),
    lerp(a[5], b[5], t),
  ];
}

function mapPoint(m: Affine, x: number, y: number): Point {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

function unionBounds(list: readonly PathBounds[]): PathBounds | null {
  if (list.length === 0) {
    return null;
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of list) {
    minX = Math.min(minX, b.minX);
    minY = Math.min(minY, b.minY);
    maxX = Math.max(maxX, b.maxX);
    maxY = Math.max(maxY, b.maxY);
  }
  return { minX, minY, maxX, maxY };
}

function boundsCenter(b: PathBounds): Point {
  return { x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 };
}

/** 一组单元的包围盒中心;一个都没有时用 fallback。 */
function glyphsCenter(glyphs: readonly Glyph[], fallback: Point): Point {
  const b = unionBounds(glyphs.map((g) => g.bounds));
  return b ? boundsCenter(b) : fallback;
}

const PX = /(\d+(?:\.\d+)?)px/;

/** 文字图元 → 宿主坐标里的样子与(估计的)包围盒。toHost 把排版坐标换到宿主坐标(已含字号)。 */
function textPose(
  p: TexText,
  toHost: Affine,
  textColor: string,
): { pose: TextPose; bounds: PathBounds } {
  const px = Number(PX.exec(p.font)?.[1] ?? 100) || 100;
  const matrix = multiplyAffine(multiplyAffine(toHost, p.matrix), [px / 100, 0, 0, px / 100, 0, 0]);
  const advance = textAdvance(p.text) * 100;
  // 归一字号下的字身:基线以上约 0.8、以下约 0.2 个字号。
  const corners = [
    mapPoint(matrix, 0, -80),
    mapPoint(matrix, advance, -80),
    mapPoint(matrix, 0, 20),
    mapPoint(matrix, advance, 20),
  ];
  return {
    pose: { text: p.text, font: p.font.replace(PX, '100px'), matrix, color: p.color ?? textColor },
    bounds: {
      minX: Math.min(...corners.map((c) => c.x)),
      minY: Math.min(...corners.map((c) => c.y)),
      maxX: Math.max(...corners.map((c) => c.x)),
      maxY: Math.max(...corners.map((c) => c.y)),
    },
  };
}

/**
 * 一侧摊平:公式叶子拆成逐个字形 / 线条 / 画布文字(带身份与所在部分),其它叶子原样留给按顺序变形。
 * rename 给部分改名(源一侧按 partMap)。
 */
function collectSide(
  pieces: readonly Piece[],
  rename: (name: string) => string,
): { glyphs: Glyph[]; others: Piece[] } {
  const glyphs: Glyph[] = [];
  const others: Piece[] = [];
  pieces.forEach((piece, n) => {
    const tex = piece.mobject;
    if (!(tex instanceof Tex)) {
      others.push(piece);
      return;
    }
    const fontSize = piece.style.fontSize;
    if (!(fontSize > 0) || !Number.isFinite(fontSize)) {
      return;
    }
    const layers = tex.primitiveLayers(piece.style);
    const toHost = multiplyAffine(piece.matrix, [fontSize, 0, 0, fontSize, 0, 0]);
    tex.layout().primitives.forEach((p, i) => {
      const parts = p.parts.map(rename);
      const groups = p.groups.map((id) => `${n}:${id}`);
      if (p.kind === 'text') {
        const { pose, bounds } = textPose(p, toHost, piece.style.textColor);
        glyphs.push({
          key: p.key,
          symbol: p.symbol,
          parts,
          groups,
          layer: null,
          text: pose,
          opacity: piece.opacity,
          bounds,
          center: boundsCenter(bounds),
          rel: { x: 0, y: 0 },
        });
        return;
      }
      const own = layers[i];
      if (!own) {
        return;
      }
      const layer = transformLayer(own, piece.matrix);
      const bounds = pathBounds(layer.path);
      if (!bounds) {
        return;
      }
      glyphs.push({
        key: p.key,
        symbol: p.symbol,
        parts,
        groups,
        layer,
        text: null,
        opacity: piece.opacity,
        bounds,
        center: boundsCenter(bounds),
        rel: { x: 0, y: 0 },
      });
    });
  });
  // 相对位置:以这一侧的左边缘、竖直中线为原点,按这一侧的高度归一 —— 两个式子不在一处也能比「谁挨着谁」。
  const frame = unionBounds(glyphs.map((g) => g.bounds));
  if (frame) {
    const unit = Math.max(frame.maxY - frame.minY, 1e-9);
    const midY = (frame.minY + frame.maxY) / 2;
    for (const g of glyphs) {
      g.rel = { x: (g.center.x - frame.minX) / unit, y: (g.center.y - midY) / unit };
    }
  }
  return { glyphs, others };
}

/** 能配对的东西(单个字形,或一整组子式):按相对位置量远近。 */
export interface Placed {
  readonly rel: Point;
}

function distance(a: Placed, b: Placed): number {
  return Math.hypot(a.rel.x - b.rel.x, a.rel.y - b.rel.y);
}

/**
 * 保序配对:键相同才能配,配上的对数最多(最长公共子序列),一样多时取相对位置挪得最少的。
 * a、b 都按阅读顺序;返回下标对。
 * @internal 导出给测试用。
 */
export function alignInOrder<T extends Placed>(
  a: readonly T[],
  b: readonly T[],
  keys: (g: T) => string,
): Pair[] {
  const n = a.length;
  const m = b.length;
  if (n === 0 || m === 0) {
    return [];
  }
  const ka = a.map(keys);
  const kb = b.map(keys);
  if (n * m > ALIGN_LIMIT) {
    // 太大:顺序贪心,每个目标配源里下一个同键的。
    const pairs: Pair[] = [];
    let from = 0;
    for (let j = 0; j < m && from < n; j++) {
      for (let i = from; i < n; i++) {
        if (ka[i] === kb[j]) {
          pairs.push([i, j]);
          from = i + 1;
          break;
        }
      }
    }
    return pairs;
  }
  const w = m + 1;
  const count = new Int32Array((n + 1) * w);
  const cost = new Float64Array((n + 1) * w);
  // 0:跳过 a[i-1];1:跳过 b[j-1];2:配对。
  const move = new Uint8Array((n + 1) * w);
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      const up = (i - 1) * w + j;
      const left = i * w + j - 1;
      let bestCount = count[up] ?? 0;
      let bestCost = cost[up] ?? 0;
      let bestMove = 0;
      const lc = count[left] ?? 0;
      const lk = cost[left] ?? 0;
      if (lc > bestCount || (lc === bestCount && lk < bestCost)) {
        bestCount = lc;
        bestCost = lk;
        bestMove = 1;
      }
      if (ka[i - 1] === kb[j - 1]) {
        const diag = (i - 1) * w + j - 1;
        const dc = (count[diag] ?? 0) + 1;
        const dk = (cost[diag] ?? 0) + distance(a[i - 1] as T, b[j - 1] as T);
        if (dc > bestCount || (dc === bestCount && dk < bestCost)) {
          bestCount = dc;
          bestCost = dk;
          bestMove = 2;
        }
      }
      count[i * w + j] = bestCount;
      cost[i * w + j] = bestCost;
      move[i * w + j] = bestMove;
    }
  }
  const pairs: Pair[] = [];
  let i = n;
  let j = m;
  while (i > 0 && j > 0) {
    const mv = move[i * w + j];
    if (mv === 2) {
      pairs.push([i - 1, j - 1]);
      i -= 1;
      j -= 1;
    } else if (mv === 1) {
      j -= 1;
    } else {
      i -= 1;
    }
  }
  return pairs.reverse();
}

/**
 * 保序配完剩下的同键的(挪到了另一边、顺序交叉的):按相对位置就近贪心。
 * @internal 导出给测试用。
 */
export function pairNearest<T extends Placed>(
  a: readonly T[],
  b: readonly T[],
  keys: (g: T) => string,
): Pair[] {
  const byKey = new Map<string, number[]>();
  b.forEach((g, j) => {
    const k = keys(g);
    const list = byKey.get(k);
    if (list) {
      list.push(j);
    } else {
      byKey.set(k, [j]);
    }
  });
  const candidates: Array<{ i: number; j: number; d: number }> = [];
  a.forEach((g, i) => {
    for (const j of byKey.get(keys(g)) ?? []) {
      candidates.push({ i, j, d: distance(g, b[j] as T) });
    }
  });
  candidates.sort((x, y) => x.d - y.d || x.i - y.i || x.j - y.j);
  const usedA = new Set<number>();
  const usedB = new Set<number>();
  const pairs: Pair[] = [];
  for (const { i, j } of candidates) {
    if (!usedA.has(i) && !usedB.has(j)) {
      usedA.add(i);
      usedB.add(j);
      pairs.push([i, j]);
    }
  }
  return pairs;
}

/** 绕 c 缩放路径。 */
function scaleAbout(path: PathData, c: Point, k: number): PathData {
  return transformPath(path, [k, 0, 0, k, c.x * (1 - k), c.y * (1 - k)]);
}

interface MatchSettings {
  readonly matchAcrossSizes: boolean;
  readonly merge: boolean;
  readonly fadeOut: readonly [number, number];
  readonly fadeIn: readonly [number, number];
  readonly fadeScale: number;
}

/** 配对的产物:路径轨迹与文字轨迹。 */
class Tracks {
  readonly paths: Track[] = [];
  readonly texts: TextTrack[] = [];
  private readonly settings: MatchSettings;

  constructor(settings: MatchSettings) {
    this.settings = settings;
  }

  /**
   * a 变成 b(全程):同一字形时就是平移,字号不同时连带缩放,不同字形时逐点变形;
   * 文字只能变成文字(字形与文字之间没法逐点变,各自淡出、淡入)。
   */
  morph(a: Glyph, b: Glyph, fromOpacity = a.opacity, toOpacity = b.opacity): void {
    if (a.layer && b.layer) {
      const [from, to] = alignPaths(a.layer.path, b.layer.path);
      this.paths.push({
        from,
        to,
        fromPaint: a.layer.paint,
        toPaint: b.layer.paint,
        fromOpacity,
        toOpacity,
        start: 0,
        end: 1,
      });
    } else if (a.text && b.text) {
      this.texts.push({ from: a.text, to: b.text, fromOpacity, toOpacity, start: 0, end: 1 });
    } else {
      this.fade(a, false);
      this.fade(b, true);
    }
  }

  /** 塌向 / 从一点长出(按顺序强行变形时没有对应物的)。 */
  collapse(g: Glyph, at: Point, grow: boolean): void {
    if (!g.layer) {
      return;
    }
    const point = collapsePath(g.layer.path, at.x, at.y);
    const [from, to] = grow ? alignPaths(point, g.layer.path) : alignPaths(g.layer.path, point);
    this.paths.push({
      from,
      to,
      fromPaint: g.layer.paint,
      toPaint: g.layer.paint,
      fromOpacity: g.opacity,
      toOpacity: g.opacity,
      start: 0,
      end: 1,
    });
  }

  /** 原地淡出 / 淡入(字形带一点缩放,文字只淡化)。 */
  fade(g: Glyph, fadeIn: boolean): void {
    const settings = this.settings;
    const [start, end] = fadeIn ? settings.fadeIn : settings.fadeOut;
    const fromOpacity = fadeIn ? 0 : g.opacity;
    const toOpacity = fadeIn ? g.opacity : 0;
    if (g.layer) {
      const small = scaleAbout(g.layer.path, g.center, settings.fadeScale);
      this.paths.push({
        from: fadeIn ? small : g.layer.path,
        to: fadeIn ? g.layer.path : small,
        fromPaint: g.layer.paint,
        toPaint: g.layer.paint,
        fromOpacity,
        toOpacity,
        start,
        end,
      });
    } else if (g.text) {
      this.texts.push({ from: g.text, to: g.text, fromOpacity, toOpacity, start, end });
    }
  }

  /** 这一帧的覆盖层:字形轨迹、非公式叶子的配对(全程)、画布文字与交叉淡化的部分。 */
  overlay(alpha: number, pairs: readonly MorphPair[], residuals: readonly Residual[]): MorphOverlay {
    const layers: PathLayer[] = [];
    const alphas: number[] = [];
    for (const t of this.paths) {
      const u = local(alpha, t.start, t.end);
      layers.push({ path: lerpPath(t.from, t.to, u), paint: lerpPaint(t.fromPaint, t.toPaint, u) });
      alphas.push(lerp(t.fromOpacity, t.toOpacity, u));
    }
    for (const p of pairs) {
      layers.push({
        path: lerpPath(p.from, p.to, alpha),
        paint: lerpPaint(p.fromPaint, p.toPaint, alpha),
      });
      alphas.push(lerp(p.fromOpacity, p.toOpacity, alpha));
    }
    const texts = this.texts;
    const extra =
      texts.length > 0 || residuals.length > 0
        ? (ctx: CanvasRenderingContext2D): void => {
            drawTextTracks(ctx, texts, alpha);
            drawResiduals(ctx, residuals, alpha);
          }
        : undefined;
    return { layers, alphas, extra };
  }
}

function drawTextTracks(
  ctx: CanvasRenderingContext2D,
  tracks: readonly TextTrack[],
  alpha: number,
): void {
  const base = ctx.globalAlpha;
  for (const t of tracks) {
    const u = local(alpha, t.start, t.end);
    const k = lerp(t.fromOpacity, t.toOpacity, u);
    if (!(k > 0)) {
      continue;
    }
    const pose = u < 0.5 ? t.from : t.to;
    ctx.save();
    try {
      ctx.globalAlpha = Math.min(1, base * k);
      drawTexText(
        ctx,
        {
          text: pose.text,
          font: pose.font,
          matrix: lerpAffine(t.from.matrix, t.to.matrix, u),
          color: lerpColor(t.from.color, t.to.color, u),
        },
        pose.color,
      );
    } finally {
      ctx.restore();
    }
  }
}

/** 一整组子式(结构分组里还没配上对的全部字形,按阅读顺序)。 */
interface Unit extends Placed {
  readonly members: readonly number[];
  readonly key: string;
}

/**
 * 一侧里成员全都还没配上对的结构分组(至少两个字形),按大小分桶。成员完全相同的嵌套分组只留外层。
 * 分组的范围限于这一批字形(命名部分里配对时,伸出部分之外的成员不算)。
 */
function freeUnits(glyphs: readonly Glyph[], partner: Int32Array): Map<number, Unit[]> {
  const members = new Map<string, number[]>();
  glyphs.forEach((g, i) => {
    for (const id of g.groups) {
      const list = members.get(id);
      if (list) {
        list.push(i);
      } else {
        members.set(id, [i]);
      }
    }
  });
  const seen = new Set<string>();
  const bySize = new Map<number, Unit[]>();
  for (const list of members.values()) {
    const signature = list.join(',');
    if (list.length < 2 || seen.has(signature) || list.some((i) => (partner[i] ?? -1) !== -1)) {
      continue;
    }
    seen.add(signature);
    const units = bySize.get(list.length) ?? [];
    let x = 0;
    let y = 0;
    for (const i of list) {
      x += glyphs[i]?.rel.x ?? 0;
      y += glyphs[i]?.rel.y ?? 0;
    }
    units.push({
      members: list,
      key: list.map((i) => glyphs[i]?.key ?? '').join(' '),
      rel: { x: x / list.length, y: y / list.length },
    });
    bySize.set(list.length, units);
  }
  return bySize;
}

/**
 * 在一组源单元 a 与目标单元 b 之间配对并生成轨迹。
 * 1. 整组相同的子式(结构分组,比如 c²、一整个分式)先当成一个整体配,大的先配 —— 指数跟着底数走;
 * 2. 剩下的字形按身份键保序配,再把同键的就近配上(顺序交叉的:挪到另一边的项);
 * 3. (matchAcrossSizes)符号键再来一轮:同一符号换了字号的;
 * 4. (merge)还剩的同一符号副本并入 / 分出配上对的那一个;
 * 5. 其余:forced 时按阅读顺序强行变形(多的塌向 / 长出于对面的中心,文字交叉淡化),否则淡出、淡入。
 */
function matchGroup(
  a: readonly Glyph[],
  b: readonly Glyph[],
  forced: boolean,
  settings: MatchSettings,
  out: Tracks,
): void {
  const partnerA = new Int32Array(a.length).fill(-1);
  const partnerB = new Int32Array(b.length).fill(-1);
  const link = (i: number, j: number): void => {
    partnerA[i] = j;
    partnerB[j] = i;
  };
  // 1) 整组配对:同样大小的分组之间先保序、再就近。
  const unitsA = freeUnits(a, partnerA);
  const unitsB = freeUnits(b, partnerB);
  const sizes = [...unitsA.keys()].filter((n) => unitsB.has(n)).sort((x, y) => y - x);
  const allFree = (u: Unit, partner: Int32Array): boolean =>
    u.members.every((i) => (partner[i] ?? -1) === -1);
  for (const size of sizes) {
    for (const pass of [alignInOrder, pairNearest]) {
      const la = (unitsA.get(size) ?? []).filter((u) => allFree(u, partnerA));
      const lb = (unitsB.get(size) ?? []).filter((u) => allFree(u, partnerB));
      for (const [x, y] of pass(la, lb, (u) => u.key)) {
        const u = la[x];
        const v = lb[y];
        if (u && v && allFree(u, partnerA) && allFree(v, partnerB)) {
          u.members.forEach((i, k) => link(i, v.members[k] ?? -1));
        }
      }
    }
  }
  // 2)、3) 单个字形:身份键一轮,符号键一轮。
  const round = (keys: (g: Glyph) => string): void => {
    for (const pass of [alignInOrder, pairNearest]) {
      const ia: number[] = [];
      const ib: number[] = [];
      a.forEach((_, i) => {
        if (partnerA[i] === -1) {
          ia.push(i);
        }
      });
      b.forEach((_, j) => {
        if (partnerB[j] === -1) {
          ib.push(j);
        }
      });
      const freeA = ia.map((i) => a[i] as Glyph);
      const freeB = ib.map((j) => b[j] as Glyph);
      for (const [x, y] of pass(freeA, freeB, keys)) {
        link(ia[x] ?? -1, ib[y] ?? -1);
      }
    }
  };
  round((g) => g.key);
  if (settings.matchAcrossSizes) {
    round((g) => g.symbol);
  }
  a.forEach((g, i) => {
    const j = partnerA[i] ?? -1;
    if (j >= 0) {
      out.morph(g, b[j] as Glyph);
    }
  });
  const sameKind = (x: Glyph, y: Glyph): boolean =>
    settings.matchAcrossSizes ? x.symbol === y.symbol : x.key === y.key;
  const nearestPartnered = (
    g: Glyph,
    pool: readonly Glyph[],
    partners: Int32Array,
  ): Glyph | null => {
    let best: Glyph | null = null;
    let bestD = Infinity;
    pool.forEach((h, k) => {
      if ((partners[k] ?? -1) >= 0 && sameKind(g, h)) {
        const d = distance(g, h);
        if (d < bestD) {
          bestD = d;
          best = h;
        }
      }
    });
    return best;
  };
  const restA: Glyph[] = [];
  const restB: Glyph[] = [];
  a.forEach((g, i) => {
    if ((partnerA[i] ?? -1) >= 0) {
      return;
    }
    const into = settings.merge ? nearestPartnered(g, b, partnerB) : null;
    if (into) {
      out.morph(g, into, g.opacity, 0);
    } else {
      restA.push(g);
    }
  });
  b.forEach((g, j) => {
    if ((partnerB[j] ?? -1) >= 0) {
      return;
    }
    const from = settings.merge ? nearestPartnered(g, a, partnerA) : null;
    if (from) {
      out.morph(from, g, 0, g.opacity);
    } else {
      restB.push(g);
    }
  });
  if (!forced) {
    for (const g of restA) {
      out.fade(g, false);
    }
    for (const g of restB) {
      out.fade(g, true);
    }
    return;
  }
  // 强行变形:字形按阅读顺序两两变,多出来的塌向 / 长出于对面这一组的中心;文字没法变成字形,交叉淡化。
  const shapesA = restA.filter((g) => g.layer);
  const shapesB = restB.filter((g) => g.layer);
  const centerA = glyphsCenter(a, glyphsCenter(b, { x: 0, y: 0 }));
  const centerB = glyphsCenter(b, centerA);
  for (let k = 0; k < Math.max(shapesA.length, shapesB.length); k++) {
    const x = shapesA[k];
    const y = shapesB[k];
    if (x && y) {
      out.morph(x, y);
    } else if (x) {
      out.collapse(x, centerB, false);
    } else if (y) {
      out.collapse(y, centerA, true);
    }
  }
  for (const g of restA) {
    if (g.text) {
      out.fade(g, false);
    }
  }
  for (const g of restB) {
    if (g.text) {
      out.fade(g, true);
    }
  }
}

/** 最内层、且对面也有的部分名;没有为 null。 */
function sharedPart(g: Glyph, shared: ReadonlySet<string>): string | null {
  for (let i = g.parts.length - 1; i >= 0; i--) {
    const name = g.parts[i];
    if (name !== undefined && shared.has(name)) {
      return name;
    }
  }
  return null;
}

/**
 * TransformMatchingTex:按式子结构变形(相当于 Manim 的 TransformMatchingTex),推导「移项、约分、代入」的标准画法。
 * 替换语义与 Transform 相同:开始时藏起目标,结束时藏起源、显示目标,终态精确;两个都要已在场景里。
 *
 * - 用 \class{名字}{…}(或 \cssId)给子式起名:两边同名的部分整体对应,部分里先按字形身份配、剩下的按顺序变形;
 * - 其余字形按身份配对 —— 同一字符、字号相近的平移过去(形状一样就是纯位移),顺序尽量保持、交叉的就近配;
 *   同一符号换了字号的缩放着过去;多出来的副本并入 / 分出同一符号(可关);
 * - 配不上的:源的缩小淡出,目标的从小淡入(先出后进,节奏可调);也可以强行按顺序变形;
 * - \text 里的中文按文字内容配对,配不上的交叉淡化;组里非公式的叶子按顺序变形(同 Transform)。
 */
export class TransformMatchingTex extends Transform {
  private readonly partMap: Readonly<Record<string, string>>;
  private readonly transformMismatches: boolean;
  private readonly settings: MatchSettings;

  constructor(source: MObject, target: MObject, options?: TransformMatchingTexOptions) {
    super(source, target, options);
    const lag = options?.fadeLag ?? 0.3;
    if (!(Number.isFinite(lag) && lag >= 0 && lag < 1)) {
      throw new Error(`TransformMatchingTex 的 fadeLag 需要 [0, 1) 里的数,收到 ${lag}`);
    }
    const fadeScale = options?.fadeScale ?? 0.8;
    if (!(Number.isFinite(fadeScale) && fadeScale >= 0)) {
      throw new Error(`TransformMatchingTex 的 fadeScale 需要非负有限数,收到 ${fadeScale}`);
    }
    const duplicates = options?.duplicates ?? 'merge';
    if (duplicates !== 'merge' && duplicates !== 'fade') {
      throw new Error(`TransformMatchingTex 的 duplicates 只能是 'merge' 或 'fade',收到 ${String(duplicates)}`);
    }
    const partMap = options?.partMap ?? {};
    for (const [from, to] of Object.entries(partMap)) {
      if (typeof to !== 'string') {
        throw new Error(`TransformMatchingTex 的 partMap.${from} 需要是部分名(字符串)`);
      }
    }
    this.partMap = partMap;
    this.transformMismatches = options?.transformMismatches ?? false;
    this.settings = {
      matchAcrossSizes: options?.matchAcrossSizes ?? true,
      merge: duplicates === 'merge',
      fadeOut: [0, 1 - lag],
      fadeIn: [lag, 1],
      fadeScale,
    };
  }

  protected override get title(): string {
    return 'TransformMatchingTex';
  }

  protected override planMorph(
    source: MObject,
    target: MObject,
    relative: Affine,
    context: PlayContext | undefined,
  ): MorphPlan {
    // 公式叶子自己拆字形(下面 collectSide),这里只要其它叶子的分层几何。
    const layersOf = (m: MObject, style: Piece['style']): PathLayer[] =>
      m instanceof Tex ? [] : m.pathLayers(style);
    const map = this.partMap;
    const rename = (name: string): string =>
      Object.prototype.hasOwnProperty.call(map, name) ? (map[name] ?? name) : name;
    const src = collectSide(collectPieces(source, IDENTITY_AFFINE, context, layersOf), rename);
    const tgt = collectSide(collectPieces(target, relative, context, layersOf), (name) => name);
    const settings = this.settings;
    const tracks = new Tracks(settings);

    // 1) 两边都有的命名部分整体对应:部分里按身份配,剩下的强行变形。
    const namesA = new Set(src.glyphs.flatMap((g) => g.parts));
    const shared = new Set(tgt.glyphs.flatMap((g) => g.parts).filter((name) => namesA.has(name)));
    const groupA = new Map<string, Glyph[]>();
    const groupB = new Map<string, Glyph[]>();
    const assign = (glyphs: readonly Glyph[], groups: Map<string, Glyph[]>): void => {
      for (const g of glyphs) {
        const name = sharedPart(g, shared);
        if (name !== null) {
          const list = groups.get(name);
          if (list) {
            list.push(g);
          } else {
            groups.set(name, [g]);
          }
        }
      }
    };
    assign(src.glyphs, groupA);
    assign(tgt.glyphs, groupB);
    const grouped = new Set<Glyph>();
    for (const [name, a] of groupA) {
      const b = groupB.get(name);
      // 一边的这个部分里全是更内层的同名部分(已各自配对),这一层没剩东西:剩下的一边回到公共池。
      if (!b) {
        continue;
      }
      matchGroup(a, b, true, settings, tracks);
      for (const g of [...a, ...b]) {
        grouped.add(g);
      }
    }

    // 2) 其余字形按身份配对。
    matchGroup(
      src.glyphs.filter((g) => !grouped.has(g)),
      tgt.glyphs.filter((g) => !grouped.has(g)),
      this.transformMismatches,
      settings,
      tracks,
    );

    // 3) 非公式的叶子:按顺序变形(同 Transform),画布内容交叉淡化。
    const origin = { x: relative[4], y: relative[5] };
    const pairs = pairPieces(
      src.others,
      tgt.others,
      piecesCenter(src.others, glyphsCenter(src.glyphs, { x: 0, y: 0 })),
      piecesCenter(tgt.others, glyphsCenter(tgt.glyphs, origin)),
    );
    const residuals: Residual[] = [
      ...src.others.map((piece) => ({ piece, fadeIn: false })),
      ...tgt.others.map((piece) => ({ piece, fadeIn: true })),
    ];
    return { overlay: (alpha) => tracks.overlay(alpha, pairs, residuals) };
  }
}
