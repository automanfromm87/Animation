/**
 * 3D 测试用的绘制记录器:按 canvas 语义跟踪路径与状态,
 * 记下每次 stroke 的线段(连同当时的虚线、透明度)、每次 fill 的颜色与路径、每次 fillText 的文字。
 * 变换一律当空操作:记录的是对象本地坐标。贝塞尔段按弦(起点到终点)记。
 */
export type Segment2D = readonly [number, number, number, number];

export interface StrokeRecord {
  dashed: boolean;
  /** 当时的虚线数组(拷贝;实线为空数组)。 */
  dash: number[];
  /** 当时的 globalAlpha。 */
  alpha: number;
  strokeStyle: string;
  lineWidth: number;
  segments: Segment2D[];
}

export interface TextRecord {
  text: string;
  x: number;
  y: number;
  alpha: number;
}

export interface DrawRecord {
  ctx: CanvasRenderingContext2D;
  strokes: StrokeRecord[];
  fills: string[];
  /** 与 fills 一一对应:每次 fill 时的路径线段。 */
  fillPaths: Segment2D[][];
  /** 与 fills 一一对应:每次 fill 时的 globalAlpha。 */
  fillAlphas: number[];
  /** 每次 fillText 的文字、位置与透明度。 */
  texts: TextRecord[];
  /** 按调用顺序的 fill / stroke 序列。 */
  ops: Array<'fill' | 'stroke'>;
}

interface State {
  dash: number[];
  strokeStyle: string;
  fillStyle: string;
  lineWidth: number;
  globalAlpha: number;
  lineCap: string;
  font: string;
  textAlign: string;
  textBaseline: string;
}

export function recordingCtx(): DrawRecord {
  const strokes: StrokeRecord[] = [];
  const fills: string[] = [];
  const fillPaths: Segment2D[][] = [];
  const fillAlphas: number[] = [];
  const texts: TextRecord[] = [];
  const ops: Array<'fill' | 'stroke'> = [];
  let state: State = {
    dash: [],
    strokeStyle: '#000',
    fillStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
    lineCap: 'butt',
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
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
    get font() {
      return state.font;
    },
    set font(v: string) {
      state.font = v;
    },
    get textAlign() {
      return state.textAlign;
    },
    set textAlign(v: string) {
      state.textAlign = v;
    },
    get textBaseline() {
      return state.textBaseline;
    },
    set textBaseline(v: string) {
      state.textBaseline = v;
    },
    save() {
      stack.push({ ...state, dash: [...state.dash] });
    },
    restore() {
      state = stack.pop() ?? state;
    },
    setLineDash(dash: readonly number[]) {
      state.dash = [...dash];
    },
    getLineDash() {
      return [...state.dash];
    },
    measureText(text: string) {
      return { width: [...String(text)].length * 8 };
    },
    fillText(text: string, x: number, y: number) {
      texts.push({ text, x, y, alpha: state.globalAlpha });
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
    bezierCurveTo(_c1x: number, _c1y: number, _c2x: number, _c2y: number, x: number, y: number) {
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
        dashed: state.dash.length > 0,
        dash: [...state.dash],
        alpha: state.globalAlpha,
        strokeStyle: state.strokeStyle,
        lineWidth: state.lineWidth,
        segments: path.map((s) => [...s] as const),
      });
    },
    fill() {
      ops.push('fill');
      fills.push(state.fillStyle);
      fillPaths.push(path.map((s) => [...s] as const));
      fillAlphas.push(state.globalAlpha);
    },
  };
  return {
    ctx: ctx as unknown as CanvasRenderingContext2D,
    strokes,
    fills,
    fillPaths,
    fillAlphas,
    texts,
    ops,
  };
}
