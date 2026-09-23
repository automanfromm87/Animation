import type { PathData } from './path';
import { PathBuilder } from './path';

const NUMBER = /[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?/y;
const SEPARATOR = /[\s,]*/y;

/**
 * 端点参数化的椭圆弧(SVG 规范 F.6)→ 三次贝塞尔,每段不超过 90°。
 * 半径不够跨过两端点时按规范等比放大;半径为 0 退化成直线。
 */
function arcTo(
  b: PathBuilder,
  x1: number,
  y1: number,
  rxIn: number,
  ryIn: number,
  angleDeg: number,
  largeArc: boolean,
  sweep: boolean,
  x2: number,
  y2: number,
): void {
  if (x1 === x2 && y1 === y2) {
    return;
  }
  let rx = Math.abs(rxIn);
  let ry = Math.abs(ryIn);
  if (rx === 0 || ry === 0) {
    b.lineTo(x2, y2);
    return;
  }
  const phi = (angleDeg * Math.PI) / 180;
  const cos = Math.cos(phi);
  const sin = Math.sin(phi);
  const dx = (x1 - x2) / 2;
  const dy = (y1 - y2) / 2;
  const x1p = cos * dx + sin * dy;
  const y1p = -sin * dx + cos * dy;
  const lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
  if (lambda > 1) {
    const s = Math.sqrt(lambda);
    rx *= s;
    ry *= s;
  }
  const num = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
  const den = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
  const coef = (largeArc === sweep ? -1 : 1) * Math.sqrt(Math.max(0, den > 0 ? num / den : 0));
  const cxp = (coef * rx * y1p) / ry;
  const cyp = (-coef * ry * x1p) / rx;
  const cx = cos * cxp - sin * cyp + (x1 + x2) / 2;
  const cy = sin * cxp + cos * cyp + (y1 + y2) / 2;
  const angle = (ux: number, uy: number, vx: number, vy: number): number =>
    Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy);
  const ux = (x1p - cxp) / rx;
  const uy = (y1p - cyp) / ry;
  const vx = (-x1p - cxp) / rx;
  const vy = (-y1p - cyp) / ry;
  const theta1 = angle(1, 0, ux, uy);
  let delta = angle(ux, uy, vx, vy);
  if (!sweep && delta > 0) {
    delta -= Math.PI * 2;
  } else if (sweep && delta < 0) {
    delta += Math.PI * 2;
  }
  const pieces = Math.max(1, Math.ceil(Math.abs(delta) / (Math.PI / 2) - 1e-9));
  const step = delta / pieces;
  const k = (4 / 3) * Math.tan(step / 4);
  const map = (px: number, py: number): [number, number] => [
    cx + cos * rx * px - sin * ry * py,
    cy + sin * rx * px + cos * ry * py,
  ];
  let t = theta1;
  for (let i = 0; i < pieces; i++) {
    const t2 = t + step;
    const ca = Math.cos(t);
    const sa = Math.sin(t);
    const cb = Math.cos(t2);
    const sb = Math.sin(t2);
    const [c1x, c1y] = map(ca - k * sa, sa + k * ca);
    const [c2x, c2y] = map(cb + k * sb, sb - k * cb);
    const [ex, ey] = i === pieces - 1 ? [x2, y2] : map(cb, sb);
    b.cubicTo(c1x, c1y, c2x, c2y, ex, ey);
    t = t2;
  }
}

/**
 * 解析 SVG path 的 d 属性(M L H V C S Q T A Z,含相对命令与隐式重复)。
 * 遇到非法内容就停在那里,返回已解析的部分(与浏览器「渲染到出错处为止」一致)。
 */
export function parseSvgPath(d: string): PathData {
  const b = new PathBuilder();
  let i = 0;
  let cmd = '';
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;
  // 上一段的控制点(S / T 的反射用)与它来自哪类命令。
  let lastCx = 0;
  let lastCy = 0;
  let lastKind: 'C' | 'Q' | '' = '';
  const skip = (): void => {
    SEPARATOR.lastIndex = i;
    SEPARATOR.exec(d);
    i = SEPARATOR.lastIndex;
  };
  const num = (): number | null => {
    skip();
    NUMBER.lastIndex = i;
    const m = NUMBER.exec(d);
    if (!m) {
      return null;
    }
    i = NUMBER.lastIndex;
    return Number(m[0]);
  };
  const flag = (): boolean | null => {
    skip();
    const c = d[i];
    if (c === '0' || c === '1') {
      i += 1;
      return c === '1';
    }
    return null;
  };
  const nums = (count: number): number[] | null => {
    const out: number[] = [];
    for (let k = 0; k < count; k++) {
      const v = num();
      if (v === null) {
        return null;
      }
      out.push(v);
    }
    return out;
  };
  for (;;) {
    skip();
    if (i >= d.length) {
      break;
    }
    const c = d[i] ?? '';
    if (/[MmLlHhVvCcSsQqTtAaZz]/.test(c)) {
      cmd = c;
      i += 1;
      if (cmd === 'Z' || cmd === 'z') {
        b.close();
        x = startX;
        y = startY;
        lastKind = '';
        continue;
      }
    } else if (cmd === '' || cmd === 'Z' || cmd === 'z') {
      break;
    }
    const rel = cmd === cmd.toLowerCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    switch (cmd.toUpperCase()) {
      case 'M': {
        const v = nums(2);
        if (!v) {
          return b.build();
        }
        x = ox + (v[0] ?? 0);
        y = oy + (v[1] ?? 0);
        startX = x;
        startY = y;
        b.moveTo(x, y);
        // M 之后隐式重复的坐标对按 L 处理。
        cmd = rel ? 'l' : 'L';
        lastKind = '';
        break;
      }
      case 'L': {
        const v = nums(2);
        if (!v) {
          return b.build();
        }
        x = ox + (v[0] ?? 0);
        y = oy + (v[1] ?? 0);
        b.lineTo(x, y);
        lastKind = '';
        break;
      }
      case 'H': {
        const v = num();
        if (v === null) {
          return b.build();
        }
        x = ox + v;
        b.lineTo(x, y);
        lastKind = '';
        break;
      }
      case 'V': {
        const v = num();
        if (v === null) {
          return b.build();
        }
        y = oy + v;
        b.lineTo(x, y);
        lastKind = '';
        break;
      }
      case 'C': {
        const v = nums(6);
        if (!v) {
          return b.build();
        }
        const [c1x, c1y, c2x, c2y, ex, ey] = v.map((n, k) => n + (k % 2 === 0 ? ox : oy));
        b.cubicTo(c1x ?? 0, c1y ?? 0, c2x ?? 0, c2y ?? 0, ex ?? 0, ey ?? 0);
        lastCx = c2x ?? 0;
        lastCy = c2y ?? 0;
        x = ex ?? 0;
        y = ey ?? 0;
        lastKind = 'C';
        break;
      }
      case 'S': {
        const v = nums(4);
        if (!v) {
          return b.build();
        }
        const c1x = lastKind === 'C' ? 2 * x - lastCx : x;
        const c1y = lastKind === 'C' ? 2 * y - lastCy : y;
        const c2x = ox + (v[0] ?? 0);
        const c2y = oy + (v[1] ?? 0);
        const ex = ox + (v[2] ?? 0);
        const ey = oy + (v[3] ?? 0);
        b.cubicTo(c1x, c1y, c2x, c2y, ex, ey);
        lastCx = c2x;
        lastCy = c2y;
        x = ex;
        y = ey;
        lastKind = 'C';
        break;
      }
      case 'Q': {
        const v = nums(4);
        if (!v) {
          return b.build();
        }
        const qx = ox + (v[0] ?? 0);
        const qy = oy + (v[1] ?? 0);
        const ex = ox + (v[2] ?? 0);
        const ey = oy + (v[3] ?? 0);
        b.quadTo(qx, qy, ex, ey);
        lastCx = qx;
        lastCy = qy;
        x = ex;
        y = ey;
        lastKind = 'Q';
        break;
      }
      case 'T': {
        const v = nums(2);
        if (!v) {
          return b.build();
        }
        const qx = lastKind === 'Q' ? 2 * x - lastCx : x;
        const qy = lastKind === 'Q' ? 2 * y - lastCy : y;
        const ex = ox + (v[0] ?? 0);
        const ey = oy + (v[1] ?? 0);
        b.quadTo(qx, qy, ex, ey);
        lastCx = qx;
        lastCy = qy;
        x = ex;
        y = ey;
        lastKind = 'Q';
        break;
      }
      case 'A': {
        const r = nums(3);
        const large = r ? flag() : null;
        const sw = large !== null ? flag() : null;
        const end = sw !== null ? nums(2) : null;
        if (!r || large === null || sw === null || !end) {
          return b.build();
        }
        const ex = ox + (end[0] ?? 0);
        const ey = oy + (end[1] ?? 0);
        arcTo(b, x, y, r[0] ?? 0, r[1] ?? 0, r[2] ?? 0, large, sw, ex, ey);
        x = ex;
        y = ey;
        lastKind = '';
        break;
      }
      default:
        return b.build();
    }
  }
  return b.build();
}
