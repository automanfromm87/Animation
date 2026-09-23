/**
 * 3D 测试用的绘制记录器:按 canvas 语义跟踪路径与状态,
 * 记下每次 stroke 的线段(连同当时是否虚线)和每次 fill 的颜色与路径。
 */
export type Segment2D = readonly [number, number, number, number];

export interface StrokeRecord {
  dashed: boolean;
  strokeStyle: string;
  lineWidth: number;
  segments: Segment2D[];
}

export interface DrawRecord {
  ctx: CanvasRenderingContext2D;
  strokes: StrokeRecord[];
  fills: string[];
  /** 与 fills 一一对应:每次 fill 时的路径线段。 */
  fillPaths: Segment2D[][];
  /** 按调用顺序的 fill / stroke 序列。 */
  ops: Array<'fill' | 'stroke'>;
}

interface State {
  dashed: boolean;
  strokeStyle: string;
  fillStyle: string;
  lineWidth: number;
  globalAlpha: number;
  lineCap: string;
}

export function recordingCtx(): DrawRecord {
  const strokes: StrokeRecord[] = [];
  const fills: string[] = [];
  const fillPaths: Segment2D[][] = [];
  const ops: Array<'fill' | 'stroke'> = [];
  let state: State = {
    dashed: false,
    strokeStyle: '#000',
    fillStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
    lineCap: 'butt',
  };
  const stack: State[] = [];
  let path: Array<[number, number, number, number]> = [];
  let last: [number, number] | null = null;
  let subStart: [number, number] | null = null;
  const ctx = {
    get strokeStyle() {
      return state.strokeStyle;
    },
    set strokeStyle(v: string) {
      state.strokeStyle = v;
    },
    get fillStyle() {
      return state.fillStyle;
    },
    set fillStyle(v: string) {
      state.fillStyle = v;
    },
    get lineWidth() {
      return state.lineWidth;
    },
    set lineWidth(v: number) {
      state.lineWidth = v;
    },
    get globalAlpha() {
      return state.globalAlpha;
    },
    set globalAlpha(v: number) {
      state.globalAlpha = v;
    },
    get lineCap() {
      return state.lineCap;
    },
    set lineCap(v: string) {
      state.lineCap = v;
    },
    save() {
      stack.push({ ...state });
    },
    restore() {
      state = stack.pop() ?? state;
    },
    setLineDash(dash: number[]) {
      state.dashed = dash.length > 0;
    },
    getTransform() {
      return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
    },
    // 变换只影响设备坐标,这里记录的是局部坐标,全部当空操作。
    translate() {},
    rotate() {},
    scale() {},
    setTransform() {},
    beginPath() {
      path = [];
      last = null;
      subStart = null;
    },
    moveTo(x: number, y: number) {
      last = [x, y];
      subStart = [x, y];
    },
    lineTo(x: number, y: number) {
      if (last) {
        path.push([last[0], last[1], x, y]);
      }
      last = [x, y];
    },
    closePath() {
      if (last && subStart) {
        path.push([last[0], last[1], subStart[0], subStart[1]]);
        last = [subStart[0], subStart[1]];
      }
    },
    stroke() {
      ops.push('stroke');
      strokes.push({
        dashed: state.dashed,
        strokeStyle: state.strokeStyle,
        lineWidth: state.lineWidth,
        segments: path.map((s) => [...s] as const),
      });
    },
    fill() {
      ops.push('fill');
      fills.push(state.fillStyle);
      fillPaths.push(path.map((s) => [...s] as const));
    },
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, strokes, fills, fillPaths, ops };
}
