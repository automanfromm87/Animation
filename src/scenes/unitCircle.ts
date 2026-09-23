import { Axes, Circle, Dot, Label, Line, Tex, Trace } from '../engine';
import type { MObject, Scene } from '../engine';

export interface UnitParts {
  cx: number;
  cy: number;
  radius: number;
  axesX0: number;
  axesW: number;
  dot: Dot;
  radiusLine: Line;
  heightSeg: Line;
  proj: Line;
  trace: Trace;
  /**
   * 动点坐标读数。逐帧变化的数字用 Label(画布直接写字),不用 Tex:
   * 每个新串都要重新排版一次公式,逐帧变化就是逐帧排版。
   */
  coord: Label;
  coordShown: string;
  /** 已推进到轨迹里的采样点数,用来只追加增量而不是每帧重建整条线。 */
  traceCount: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  all: MObject[];
}

export const TURNS = Math.PI * 4;
const TRACE_SAMPLES = 240;

/** 保留两位小数,(-0.005, 0.005) 归一成 0.00,避免出现 -0.00。 */
function fmt(v: number): string {
  return Math.abs(v) < 0.005 ? '0.00' : v.toFixed(2);
}

/** 按角度 th 重画动点、半径、高度、投影虚线、正弦轨迹与坐标读数。 */
export function drawUnitAt(parts: UnitParts, th: number): void {
  const {
    cx,
    cy,
    radius,
    axesX0,
    axesW,
    dot,
    radiusLine,
    heightSeg,
    proj,
    trace,
    coord,
  } = parts;
  const px = cx + radius * Math.cos(th);
  const py = cy - radius * Math.sin(th);
  dot.moveTo({ x: px, y: py });
  const shown = `(${fmt(Math.cos(th))}, ${fmt(Math.sin(th))})`;
  coord.moveTo({ x: px, y: py - 30 });
  if (shown !== parts.coordShown) {
    parts.coordShown = shown;
    coord.text = shown;
  }
  radiusLine.start = { x: cx, y: cy };
  radiusLine.end = { x: px, y: py };
  heightSeg.start = { x: px, y: py };
  heightSeg.end = { x: px, y: cy };
  const count = Math.max(
    0,
    Math.min(TRACE_SAMPLES, Math.floor((th / TURNS) * TRACE_SAMPLES)),
  );
  // 只追加新采样点;th 回退(重新扫描)时才清空重建。
  if (count + 1 < parts.traceCount) {
    trace.clear();
    parts.traceCount = 0;
  }
  for (let i = parts.traceCount; i <= count; i++) {
    const t = (i / TRACE_SAMPLES) * TURNS;
    trace.addPoint({
      x: axesX0 + (i / TRACE_SAMPLES) * axesW,
      y: cy - radius * Math.sin(t),
    });
  }
  parts.traceCount = Math.max(parts.traceCount, count + 1);
  proj.start = { x: px, y: py };
  proj.end = { x: axesX0 + (count / TRACE_SAMPLES) * axesW, y: py };
}

/** 世界坐标固定位置搭建单位圆装置(圆 + 波形坐标系 + 动态部件)。 */
export function buildUnitParts(scene: Scene): UnitParts {
  const radius = 90;
  const cx = -350;
  const cy = -160;
  const circle = new Circle(radius);
  circle.moveTo({ x: cx, y: cy });
  const circleAxes = new Axes([-1.3, 1.3], [-1.3, 1.3], 2.6 * radius, 2.6 * radius);
  circleAxes.moveTo({ x: cx, y: cy });
  const axesW = 600;
  const axesX0 = -100;
  const axes = new Axes([0, TURNS], [-1.3, 1.3], axesW, 2.6 * radius);
  axes.moveTo({ x: axesX0 + axesW / 2, y: cy });
  const dot = new Dot(7);
  const radiusLine = new Line({ x: 0, y: 0 }, { x: 0, y: 0 });
  const heightSeg = new Line({ x: 0, y: 0 }, { x: 0, y: 0 });
  heightSeg.setStyle({ strokeWidth: 4 });
  const proj = new Line({ x: 0, y: 0 }, { x: 0, y: 0 });
  proj.setStyle({ dash: [6, 5] });
  const trace = new Trace();
  const label1 = new Label('单位圆');
  label1.setStyle({ fontSize: 16 });
  label1.moveTo({ x: cx, y: cy + 1.3 * radius + 26 });
  const label2 = new Tex('y = \\sin\\theta');
  label2.setStyle({ fontSize: 18 });
  label2.moveTo({ x: axesX0 + axesW / 2, y: cy + 1.3 * radius + 26 });
  const identity = new Tex('x^2 + y^2 = 1');
  identity.setStyle({ fontSize: 18 });
  identity.moveTo({ x: cx, y: cy + 1.3 * radius + 58 });
  const coord = new Label('(1.00, 0.00)');
  coord.setStyle({ fontSize: 15 });
  const parts: UnitParts = {
    cx,
    cy,
    radius,
    axesX0,
    axesW,
    dot,
    radiusLine,
    heightSeg,
    proj,
    trace,
    coord,
    coordShown: '',
    traceCount: 0,
    bounds: {
      minX: cx - 1.3 * radius - 40,
      minY: cy - 1.3 * radius - 30,
      maxX: axesX0 + axesW + 10,
      maxY: cy + 1.3 * radius + 78,
    },
    all: [
      circleAxes,
      circle,
      axes,
      radiusLine,
      heightSeg,
      proj,
      trace,
      dot,
      label1,
      label2,
      identity,
      coord,
    ],
  };
  scene.add(...parts.all);
  drawUnitAt(parts, 0);
  return parts;
}
