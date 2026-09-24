import type { Bounds } from '../mobjects/types';
import type { InspectOptions, LayoutFrame, LayoutItem } from './inspect';
import { inspectScene } from './inspect';
import type { Scene } from '../scene/Scene';

/**
 * 版面规则:给一帧的屏幕盒(inspectSnapshot 的结果)找出出画、文字互压、压刻度、压遮挡区、字太小、(可选)线穿文字。
 * 纯函数,单帧,只读 frame 里截获的数据(不读活对象);给了 1/30 秒之后的一帧(next)就能分辨「镜头在动 / 对象在淡入淡出」,
 * 这类瞬态一律降为 info —— 持续的问题在动画结束后的采样里会以静止状态再出现一次。
 * 互压、压刻度、线穿文字只看两块东西的相对位置:镜头怎么动都挪不开它们,所以不按「镜头在动」降级。
 */

export type LayoutIssueKind =
  /** 文字(含刻度数字)部分出画。 */
  | 'out-of-frame'
  /** 看得见(不透明度 > 0)的文字整个在画外。 */
  | 'offscreen'
  /** 两块文字互压。 */
  | 'text-overlap'
  /** 文字压住坐标轴刻度数字 / 轴名。 */
  | 'text-over-tick'
  /** 线从文字中间穿过(可选检查)。 */
  | 'text-over-stroke'
  /** 被字幕条盖住。 */
  | 'under-subtitle'
  /** 被进度条占块盖住。 */
  | 'under-progress-bar'
  /** 屏幕字号太小。 */
  | 'text-too-small';

export type LayoutSeverity = 'error' | 'warning' | 'info';

/** 这一帧的运动状态:给了 next 才判;fading / camera 属于瞬态。 */
export type LayoutMotion = 'still' | 'moving' | 'fading' | 'camera';

/** 画面上盖着内容的区域(字幕条、进度条),屏幕 css 像素。 */
export interface LayoutZone {
  readonly kind: 'subtitle' | 'progress-bar';
  /** 写进消息里的名字:「字幕条」「进度条」。 */
  readonly label: string;
  readonly rect: Bounds;
}

export interface LayoutIssue {
  readonly kind: LayoutIssueKind;
  readonly severity: LayoutSeverity;
  /** 不看运动时的级别:severity 因为「镜头在动 / 淡入淡出」降成 info 之前的那个(跨时间聚合时,长时间运镜要用它封顶)。 */
  readonly baseSeverity: LayoutSeverity;
  readonly motion: LayoutMotion;
  /** 涉及的对象(1 或 2 个;压刻度时第二个是被压得最多的那个刻度项)。 */
  readonly items: readonly LayoutItem[];
  readonly zone?: LayoutZone;
  /** 问题区域(屏幕 css 像素):交叠区 / 出画对象露在画里的那部分 / 文字本身。缩略图画红框用它。 */
  readonly region: Bounds;
  /** 量值(css px,越大越严重):出画距离、交叠区短边、字太小时差下限多少(下限 − 屏幕字号)。排序与挑「最严重的一帧」用。 */
  readonly amount: number;
  /** 压刻度 / 刻度字太小时涉及的刻度文字,如 ['1', '1.5', '2']。 */
  readonly ticks?: readonly string[];
  /** 中文一句话,如「Tex「x_{n+1}…」压住坐标轴刻度 1、1.5、2(交叠 23.8×10.0 px)」。 */
  readonly message: string;
}

export interface LayoutCheckOptions {
  /** 遮挡区(字幕条、进度条),缺省无。 */
  zones?: readonly LayoutZone[];
  /** 1/30 秒之后同一场景的一帧:用来判断镜头在动、对象在淡入淡出(这类问题降为 info)。缺省当作静止。 */
  next?: LayoutFrame;
  /** 检查线穿文字,缺省 false(结果恒为 info)。 */
  strokes?: boolean;
  /** 出画容差 px,缺省 1。 */
  edgeTolerancePx?: number;
  /** 交叠判定:交叠区宽、高都要大于它(px),缺省 2。 */
  overlapPx?: number;
  /** 文字最小屏幕字号 px,缺省 12;0 关闭。 */
  minTextPx?: number;
  /** 刻度数字(与标注徽标里的字)最小屏幕字号 px,缺省 6;0 关闭。 */
  minTickPx?: number;
}

/** 出画超过它(px)直接算错误级。 */
const OUT_OF_FRAME_ERROR_PX = 8;
/** 露在画里的比例低于它算错误级。 */
const OUT_OF_FRAME_ERROR_VISIBLE = 0.9;
/** 两块字里任一块比它淡,互压降为提醒(淡出 / 半透明的装饰字)。 */
const DIM_OPACITY = 0.5;
/** 运动判定:机位平移超过它(屏幕 px)算镜头在动。 */
const CAMERA_PAN_PX = 0.25;
/** 运动判定:缩放相对变化超过它算镜头在动。 */
const CAMERA_ZOOM_RATIO = 1e-3;
/** 运动判定:不透明度 / 生长比例变化超过它算在淡入淡出。 */
const FADE_EPS = 0.004;
/** 运动判定:屏幕盒四边位移之和超过它(px)算在移动。 */
const MOVE_PX = 0.5;
/** 与机位无关的类别:两块东西跟着镜头一起动,运镜既挪不开、也造不出它们的相对位置。 */
const CAMERA_INDEPENDENT: ReadonlySet<LayoutIssueKind> = new Set<LayoutIssueKind>([
  'text-overlap',
  'text-over-tick',
  'text-over-stroke',
]);
/** 线穿文字:文字盒左右各收 12%、上下各收 18%(字形不会填满整个盒子)。 */
const STROKE_CORE_X = 0.12;
const STROKE_CORE_Y = 0.18;

const W = (b: Bounds): number => b.maxX - b.minX;
const H = (b: Bounds): number => b.maxY - b.minY;
const area = (b: Bounds): number => Math.max(0, W(b)) * Math.max(0, H(b));

function inter(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.max(a.minX, b.minX),
    minY: Math.max(a.minY, b.minY),
    maxX: Math.min(a.maxX, b.maxX),
    maxY: Math.min(a.maxY, b.maxY),
  };
}

function unionOf(a: Bounds, b: Bounds): Bounds {
  return {
    minX: Math.min(a.minX, b.minX),
    minY: Math.min(a.minY, b.minY),
    maxX: Math.max(a.maxX, b.maxX),
    maxY: Math.max(a.maxY, b.maxY),
  };
}

const px = (v: number): string => v.toFixed(1);
const size = (b: Bounds): string => `${px(W(b))}×${px(H(b))} px`;

/** 描述后面接中文:以「」收尾的描述直接接,类名这类西文描述空一格。 */
function said(label: string, rest: string): string {
  return label.endsWith('」') ? `${label}${rest}` : `${label} ${rest}`;
}

/** 交叠区宽高都超过阈值才算压上。 */
function overlaps(a: Bounds, b: Bounds, threshold: number): Bounds | null {
  const i = inter(a, b);
  return W(i) > threshold && H(i) > threshold ? i : null;
}

const RANK: Readonly<Record<LayoutSeverity, number>> = { error: 2, warning: 1, info: 0 };

/** 两个级别里更严重的那个。 */
export function maxSeverity(a: LayoutSeverity, b: LayoutSeverity): LayoutSeverity {
  return RANK[a] >= RANK[b] ? a : b;
}

/** 级别排序值:error 2、warning 1、info 0。 */
export function severityRank(s: LayoutSeverity): number {
  return RANK[s];
}

/**
 * 路径在屏幕上是否穿过矩形 r:每段三次贝塞尔取 4 个子点连成折线,逐段 Liang–Barsky 裁剪。
 * 用截获时取好的 item.path(已按生长截短);没有路径(对象没有 toPath、或截获时没取)时返回 null。
 */
function strokeHits(item: LayoutItem, r: Bounds, frame: LayoutFrame): boolean | null {
  const path = item.path;
  if (!path) {
    return null;
  }
  const { x, y, rotation, scale } = item.transform;
  const c = Math.cos(rotation) * scale;
  const s = Math.sin(rotation) * scale;
  const z = frame.view.zoom;
  const vx = frame.view.x;
  const vy = frame.view.y;
  const hw = frame.viewport.w / 2;
  const hh = frame.viewport.h / 2;
  const sx = (px0: number, py0: number): number => (x + px0 * c - py0 * s - vx) * z + hw;
  const sy = (px0: number, py0: number): number => (y + px0 * s + py0 * c - vy) * z + hh;
  const segmentHits = (ax: number, ay: number, bx: number, by: number): boolean => {
    let t0 = 0;
    let t1 = 1;
    const dx = bx - ax;
    const dy = by - ay;
    const clip = (p: number, q: number): boolean => {
      if (p === 0) {
        return q >= 0;
      }
      const t = q / p;
      if (p < 0) {
        if (t > t1) {
          return false;
        }
        if (t > t0) {
          t0 = t;
        }
      } else {
        if (t < t0) {
          return false;
        }
        if (t < t1) {
          t1 = t;
        }
      }
      return true;
    };
    return (
      clip(-dx, ax - r.minX) &&
      clip(dx, r.maxX - ax) &&
      clip(-dy, ay - r.minY) &&
      clip(dy, r.maxY - ay) &&
      t0 <= t1
    );
  };
  for (const sub of path.subpaths) {
    const pts = sub.points;
    const x0 = pts[0] ?? 0;
    const y0 = pts[1] ?? 0;
    let ax = sx(x0, y0);
    let ay = sy(x0, y0);
    if (pts.length <= 2 && ax >= r.minX && ax <= r.maxX && ay >= r.minY && ay <= r.maxY) {
      return true;
    }
    for (let i = 2; i + 5 < pts.length; i += 6) {
      const p0x = pts[i - 2] ?? 0;
      const p0y = pts[i - 1] ?? 0;
      const c1x = pts[i] ?? 0;
      const c1y = pts[i + 1] ?? 0;
      const c2x = pts[i + 2] ?? 0;
      const c2y = pts[i + 3] ?? 0;
      const p1x = pts[i + 4] ?? 0;
      const p1y = pts[i + 5] ?? 0;
      for (let q = 1; q <= 4; q++) {
        const u = q / 4;
        const v = 1 - u;
        const bx = v * v * v * p0x + 3 * v * v * u * c1x + 3 * v * u * u * c2x + u * u * u * p1x;
        const by = v * v * v * p0y + 3 * v * v * u * c1y + 3 * v * u * u * c2y + u * u * u * p1y;
        const nx = sx(bx, by);
        const ny = sy(bx, by);
        if (segmentHits(ax, ay, nx, ny)) {
          return true;
        }
        ax = nx;
        ay = ny;
      }
    }
  }
  return false;
}

/** 出画方向(中文),取越出最多的那一边。 */
function overflowSide(r: Bounds, vw: number, vh: number): string {
  const sides: Array<[string, number]> = [
    ['左', -r.minX],
    ['右', r.maxX - vw],
    ['上', -r.minY],
    ['下', r.maxY - vh],
  ];
  let best = sides[0] ?? ['左', 0];
  for (const s of sides) {
    if (s[1] > best[1]) {
      best = s;
    }
  }
  return best[0];
}

/**
 * 找一帧里的版面问题。视口为 0 时返回 []。
 * 结果按级别降序、再按量值降序。
 *
 * | 类别 | 判定 | 级别 |
 * | --- | --- | --- |
 * | out-of-frame | 文字越出视口超过容差,还露着一部分 | 越出 ≥ 8 px 或露出 < 90% → error,否则 warning;刻度数字一律 warning |
 * | offscreen | 看得见的文字整个在画外 | info |
 * | text-overlap | 两块文字(不同对象)的墨迹盒交叠区宽高都 > overlapPx | error;任一块不透明度 < 0.5 → warning |
 * | text-over-tick | 文字压住坐标轴刻度数字 / 轴名(同一文字 × 同一坐标轴合并一条) | warning |
 * | under-subtitle / under-progress-bar | 文字进了遮挡区 | 文字 error,刻度数字 warning;图形的线进了遮挡区 info |
 * | text-too-small | 屏幕字号 < minTextPx(刻度 / 徽标 < minTickPx,同一坐标轴合并) | warning |
 * | text-over-stroke | (strokes: true)线从文字中间穿过 | info |
 *
 * 给了 next 时:镜头在动 → motion 'camera',涉及的对象在淡入淡出 / 生长 / 消失 → 'fading',这两种一律降为 info
 * (原级别留在 baseSeverity);只在移动 → 'moving'(保留原级别,跨时间聚合时再看它持续了多久)。
 * 互压 / 压刻度 / 线穿文字只比两块东西的相对位置(世界坐标),镜头在动不算,不会因为运镜降级。
 */
export function findLayoutIssues(frame: LayoutFrame, options?: LayoutCheckOptions): LayoutIssue[] {
  const vw = frame.viewport.w;
  const vh = frame.viewport.h;
  if (!(vw > 0 && vh > 0)) {
    return [];
  }
  const edge = options?.edgeTolerancePx ?? 1;
  const ov = options?.overlapPx ?? 2;
  const minTextPx = options?.minTextPx ?? 12;
  const minTickPx = options?.minTickPx ?? 6;
  const next = options?.next;
  const out: LayoutIssue[] = [];

  const camera =
    next !== undefined &&
    (Math.abs(next.view.x - frame.view.x) * frame.view.zoom > CAMERA_PAN_PX ||
      Math.abs(next.view.y - frame.view.y) * frame.view.zoom > CAMERA_PAN_PX ||
      Math.abs(next.view.zoom / frame.view.zoom - 1) > CAMERA_ZOOM_RATIO);
  const nextByKey = new Map<string, LayoutItem>();
  for (const item of next?.items ?? []) {
    nextByKey.set(item.key, item);
  }
  const edgeDelta = (a: Bounds, b: Bounds): number =>
    Math.abs(a.minX - b.minX) + Math.abs(a.maxX - b.maxX) + Math.abs(a.minY - b.minY) + Math.abs(a.maxY - b.maxY);
  /**
   * relative:只看对象自己在世界里动没动(换算成屏幕 px 比阈值),不看镜头 —— 与机位无关的类别用它。
   * 否则看屏幕盒:镜头在动就是 'camera'。
   */
  const motionOf = (items: readonly LayoutItem[], relative: boolean): LayoutMotion => {
    if (!next) {
      return 'still';
    }
    if (camera && !relative) {
      return 'camera';
    }
    let moving = false;
    for (const item of items) {
      const n = nextByKey.get(item.key);
      if (
        !n ||
        Math.abs(n.opacity - item.opacity) > FADE_EPS ||
        Math.abs(n.reveal - item.reveal) > FADE_EPS
      ) {
        return 'fading';
      }
      const d = relative ? edgeDelta(n.world, item.world) * frame.view.zoom : edgeDelta(n.rect, item.rect);
      if (d > MOVE_PX) {
        moving = true;
      }
    }
    return moving ? 'moving' : 'still';
  };
  const add = (
    issue: Omit<LayoutIssue, 'motion' | 'severity' | 'baseSeverity'> & { severity: LayoutSeverity },
    motionItems: readonly LayoutItem[] = issue.items,
  ): void => {
    const motion = motionOf(motionItems, CAMERA_INDEPENDENT.has(issue.kind));
    out.push({
      ...issue,
      motion,
      baseSeverity: issue.severity,
      severity: motion === 'camera' || motion === 'fading' ? 'info' : issue.severity,
    });
  };

  const view: Bounds = { minX: 0, minY: 0, maxX: vw, maxY: vh };
  // 零面积的字(空串)不参与任何规则。
  const texts = frame.items.filter((i) => i.kind !== 'graphic' && area(i.rect) > 0);
  const words = texts.filter((i) => i.kind === 'text');
  const ticks = texts.filter((i) => i.kind === 'tick-label');
  const graphics = frame.items.filter((i) => i.kind === 'graphic');

  // 出画 / 整个在画外。
  for (const t of texts) {
    const r = t.rect;
    const overflow = Math.max(-r.minX, r.maxX - vw, -r.minY, r.maxY - vh);
    if (!(overflow > edge)) {
      continue;
    }
    const inside = inter(r, view);
    const visible = area(inside) / area(r);
    if (!(visible > 0)) {
      add({
        kind: 'offscreen',
        severity: 'info',
        items: [t],
        region: r,
        amount: overflow,
        message: said(t.label, `整个在画外(越出${overflowSide(r, vw, vh)}边 ${px(overflow)} px)却没藏起来`),
      });
      continue;
    }
    const severe = overflow >= OUT_OF_FRAME_ERROR_PX || visible < OUT_OF_FRAME_ERROR_VISIBLE;
    add({
      kind: 'out-of-frame',
      severity: t.kind === 'tick-label' ? 'warning' : severe ? 'error' : 'warning',
      items: [t],
      region: inside,
      amount: overflow,
      message: said(t.label, `出画 ${px(overflow)} px(${overflowSide(r, vw, vh)}边),只看得见 ${Math.round(visible * 100)}%`),
    });
  }

  // 字太小:文字逐个,刻度按坐标轴合并。
  if (minTextPx > 0 || minTickPx > 0) {
    const tickGroups = new Map<string, LayoutItem[]>();
    for (const t of texts) {
      if (!(t.fontPx > 0) || area(inter(t.rect, view)) <= 0) {
        continue;
      }
      const small = t.kind === 'tick-label' || t.part === 'badge';
      const min = small ? minTickPx : minTextPx;
      if (!(min > 0) || !(t.fontPx < min)) {
        continue;
      }
      if (t.kind === 'tick-label') {
        const list = tickGroups.get(t.objectKey) ?? [];
        list.push(t);
        tickGroups.set(t.objectKey, list);
        continue;
      }
      add({
        kind: 'text-too-small',
        severity: 'warning',
        items: [t],
        region: inter(t.rect, view),
        // 越小越严重:量值取「差下限多少」,排序与挑最严重的一帧才会挑到最小的那一帧。
        amount: min - t.fontPx,
        message: said(t.label, `屏幕字号只有 ${px(t.fontPx)} px(下限 ${min} px)`),
      });
    }
    for (const list of tickGroups.values()) {
      let smallest = list[0];
      let region: Bounds | null = null;
      for (const t of list) {
        if (smallest === undefined || t.fontPx < smallest.fontPx) {
          smallest = t;
        }
        const r = inter(t.rect, view);
        region = region ? unionOf(region, r) : r;
      }
      if (!smallest || !region) {
        continue;
      }
      add({
        kind: 'text-too-small',
        severity: 'warning',
        items: [smallest],
        region,
        amount: minTickPx - smallest.fontPx,
        ticks: list.map((t) => t.text ?? ''),
        message: `坐标轴刻度数字屏幕字号只有 ${px(smallest.fontPx)} px(下限 ${minTickPx} px)`,
      });
    }
  }

  // 两块文字互压。
  for (let i = 0; i < words.length; i++) {
    const a = words[i];
    if (!a) {
      continue;
    }
    for (let j = i + 1; j < words.length; j++) {
      const b = words[j];
      if (!b || a.object === b.object) {
        continue;
      }
      const hit = overlaps(a.ink, b.ink, ov);
      if (!hit) {
        continue;
      }
      add({
        kind: 'text-overlap',
        severity: Math.min(a.opacity, b.opacity) < DIM_OPACITY ? 'warning' : 'error',
        items: [a, b],
        region: hit,
        amount: Math.min(W(hit), H(hit)),
        message: `${said(a.label, '与')} ${said(b.label, `互压(交叠 ${size(hit)})`)}`,
      });
    }
  }

  // 文字压刻度:同一文字 × 同一坐标轴合并成一条。
  for (const t of words) {
    const byAxes = new Map<string, Array<{ tick: LayoutItem; hit: Bounds }>>();
    for (const k of ticks) {
      if (k.object === t.object) {
        continue;
      }
      const hit = overlaps(t.ink, k.ink, ov);
      if (!hit) {
        continue;
      }
      const list = byAxes.get(k.objectKey) ?? [];
      list.push({ tick: k, hit });
      byAxes.set(k.objectKey, list);
    }
    for (const list of byAxes.values()) {
      let worst = list[0];
      let region: Bounds | null = null;
      for (const e of list) {
        if (worst === undefined || Math.min(W(e.hit), H(e.hit)) > Math.min(W(worst.hit), H(worst.hit))) {
          worst = e;
        }
        region = region ? unionOf(region, e.hit) : e.hit;
      }
      if (!worst || !region) {
        continue;
      }
      // x、y 两轴都有「0」这类同名刻度:报告里只列一次。
      const names = [...new Set(list.map((e) => e.tick.text ?? ''))];
      const onlyNames = list.every((e) => e.tick.part?.startsWith('name:'));
      add(
        {
          kind: 'text-over-tick',
          severity: 'warning',
          items: [t, worst.tick],
          region,
          amount: Math.min(W(worst.hit), H(worst.hit)),
          ticks: names,
          message: said(t.label, `压住坐标轴${onlyNames ? '轴名' : '刻度'} ${names.join('、')}(最多交叠 ${size(worst.hit)})`),
        },
        [t, ...list.map((e) => e.tick)],
      );
    }
  }

  // 遮挡区:字幕条、进度条。
  for (const zone of options?.zones ?? []) {
    for (const t of texts) {
      const hit = overlaps(t.ink, zone.rect, ov);
      if (!hit) {
        continue;
      }
      add({
        kind: zone.kind === 'subtitle' ? 'under-subtitle' : 'under-progress-bar',
        severity: t.kind === 'tick-label' ? 'warning' : 'error',
        items: [t],
        zone,
        region: hit,
        amount: Math.min(W(hit), H(hit)),
        message: said(t.label, `被${zone.label}盖住(交叠 ${size(hit)})`),
      });
    }
    for (const g of graphics) {
      // 水平 / 竖直的线外接盒是扁的:先按「碰到」粗筛,再看路径真的穿没穿过;没有路径的按外接盒交叠算。
      const touch = inter(g.rect, zone.rect);
      if (!(W(touch) >= 0 && H(touch) >= 0)) {
        continue;
      }
      // 网格、坐标面这类铺满全屏的图形进遮挡区是常态,一律 info。
      const crossed = strokeHits(g, zone.rect, frame);
      const hit = crossed === null ? overlaps(g.rect, zone.rect, ov) : crossed ? touch : null;
      if (!hit) {
        continue;
      }
      add({
        kind: zone.kind === 'subtitle' ? 'under-subtitle' : 'under-progress-bar',
        severity: 'info',
        items: [g],
        zone,
        region: hit,
        amount: Math.min(W(hit), H(hit)),
        message: said(g.label, `的线条进了${zone.label}`),
      });
    }
  }

  // 线穿文字(可选,恒为 info)。
  if (options?.strokes) {
    for (const t of words) {
      const r = t.rect;
      const core: Bounds = {
        minX: r.minX + W(r) * STROKE_CORE_X,
        maxX: r.maxX - W(r) * STROKE_CORE_X,
        minY: r.minY + H(r) * STROKE_CORE_Y,
        maxY: r.maxY - H(r) * STROKE_CORE_Y,
      };
      for (const g of graphics) {
        if (g.object === t.object) {
          continue;
        }
        const i = inter(g.rect, core);
        if (!(W(i) >= 0 && H(i) >= 0) || strokeHits(g, core, frame) !== true) {
          continue;
        }
        add({
          kind: 'text-over-stroke',
          severity: 'info',
          items: [t, g],
          region: core,
          amount: 0,
          message: `${said(g.label, '的线从')} ${said(t.label, '中间穿过')}`,
        });
      }
    }
  }

  out.sort((a, b) => RANK[b.severity] - RANK[a.severity] || b.amount - a.amount);
  return out;
}

/**
 * 场景的便利入口:inspectScene + findLayoutIssues。
 * 遮挡区(字幕条、进度条)由调用方按自己的画面传进 zones;场景已销毁或视口为 0 时返回 []。
 */
export function findSceneLayoutIssues(
  scene: Scene,
  options?: LayoutCheckOptions & InspectOptions,
): LayoutIssue[] {
  const frame = inspectScene(scene, options);
  return frame ? findLayoutIssues(frame, options) : [];
}
