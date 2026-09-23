import {
  Angle,
  Annotation,
  Arc,
  AreaUnderCurve,
  Arrow,
  Axes,
  BarChart,
  Brace,
  Circle,
  Cone,
  Cube,
  Cuboid,
  Cylinder,
  Dot,
  Ellipse,
  FunctionGraph,
  Group,
  ImplicitSurface,
  Label,
  Layout,
  Line,
  NumberLine,
  NumberPlane,
  ParametricCurve2D,
  ParametricSurface,
  Polygon,
  Pyramid,
  Rectangle,
  RegularPolygon,
  RiemannRectangles,
  RightAngle,
  SecantLine,
  Sector,
  Sphere,
  Square,
  Star,
  TangentLine,
  Tetrahedron,
  Tex,
  Triangle,
  TriangularPrism,
  VectorField,
  cosFn,
  expFn,
  kleinParam,
  lissajousFn,
  logFn,
  mobiusParam,
  sinFn,
  sincFn,
  sphereTorusHomotopy,
  sphereToTorusField,
  spiralFn,
  tanFn,
  torusParam,
} from '../engine';
import type { Bounds, MObject } from '../engine';

export interface GalleryItem {
  name: string;
  shape: MObject;
}

export interface Gallery {
  items: GalleryItem[];
  captions: Label[];
}

/**
 * 画廊内容 + 总览动画要单独驱动的几件的类型化句柄。
 * 以前按屏幕标题字符串去找,标题一改(比如翻译)整套画廊动画就静默失效。
 */
export interface GalleryContents {
  items: GalleryItem[];
  sphere: Sphere;
  genus: ImplicitSurface;
  homotopy: ParametricSurface;
  /** 与圆来回变形(Transform)的方块。 */
  square: Square;
  /** 逐字书写(Write)的公式。 */
  formula: Tex;
}

/** 坐标系 + 曲线打包成一个画廊项,两者都以组原点为中心。 */
function plotItem(name: string, axes: Axes, curve: MObject): GalleryItem {
  const group = new Group();
  group.add(axes, curve);
  return { name, shape: group };
}

function funcItem(
  name: string,
  xRange: [number, number],
  yRange: [number, number],
  w: number,
  h: number,
  fn: (x: number) => number,
  samples?: number,
): GalleryItem {
  const axes = new Axes(xRange, yRange, w, h);
  return plotItem(name, axes, new FunctionGraph(fn, axes, samples));
}

function paramItem(
  name: string,
  xRange: [number, number],
  yRange: [number, number],
  w: number,
  h: number,
  fn: (t: number) => [number, number],
  tRange: [number, number],
  samples?: number,
): GalleryItem {
  const axes = new Axes(xRange, yRange, w, h);
  return plotItem(name, axes, new ParametricCurve2D(fn, axes, tRange, samples));
}

function labeledTriangleItem(): GalleryItem {
  const group = new Group();
  const tri = new Triangle(36);
  group.add(tri);
  const names = ['A', 'B', 'C'];
  tri.points.forEach((p, i) => {
    const ann = new Annotation(names[i] ?? '');
    ann.moveTo({ x: p.x, y: p.y });
    const len = Math.hypot(p.x, p.y) || 1;
    ann.offset = { x: (p.x / len) * 22, y: (p.y / len) * 22 };
    group.add(ann);
  });
  const center = new Annotation('O', { offset: { x: 0, y: 30 } });
  group.add(center);
  return { name: 'Labels', shape: group };
}

function formulaTex(): Tex {
  const tex = new Tex('\\frac{-b\\pm\\sqrt{b^2-4ac}}{2a}');
  tex.setStyle({ fontSize: 24 });
  return tex;
}

function layoutItem(): GalleryItem {
  const root = new Layout(150, 100, {
    direction: 'row',
    gap: 8,
    padding: 8,
    align: 'center',
    frame: true,
  });
  const col = new Layout(40, 80, {
    direction: 'column',
    gap: 6,
    padding: 4,
    align: 'center',
    frame: true,
  });
  col.place(new Rectangle(40, 20));
  col.place(new Dot(8));
  root.place(new Circle(16));
  root.place(col, 1);
  root.place(new Triangle(18));
  root.layout();
  return { name: 'Layout', shape: root };
}

/** 公式 + 下方带说明的花括号。 */
function braceItem(): GalleryItem {
  const group = new Group();
  const tex = new Tex('a^2+b^2');
  tex.setStyle({ fontSize: 26 });
  tex.moveTo({ x: 0, y: -14 });
  group.add(tex, Brace.for(tex, 'down', { label: 'c^2', fontSize: 20, depth: 11 }));
  return { name: 'Brace', shape: group };
}

/** 直角三角形:直角符号 + 带 θ 的角标。 */
function angleItem(): GalleryItem {
  const group = new Group();
  const a = { x: -48, y: 30 };
  const b = { x: 48, y: 30 };
  const c = { x: -48, y: -34 };
  group.add(
    new Polygon([a, b, c]),
    new RightAngle(a, b, c, { size: 11 }),
    new Angle(b, c, a, { radius: 26, label: '\\theta', fontSize: 18 }),
  );
  return { name: 'Angle', shape: group };
}

/** 数轴上的一个点。 */
function numberLineItem(): GalleryItem {
  const line = new NumberLine([-2, 2, 1], { length: 140, fontSize: 14, tips: 'both' });
  const dot = new Dot(5);
  dot.moveTo(line.n2p(0.5));
  line.add(dot);
  return { name: 'NumberLine', shape: line };
}

/** 坐标网格上的函数图像。 */
function numberPlaneItem(): GalleryItem {
  const plane = new NumberPlane([-3, 3], [-2, 2], 132, 92);
  plane.add(new FunctionGraph((x) => Math.sin(x) * 1.5, plane));
  return { name: 'NumberPlane', shape: plane };
}

/** 曲线下面积 + 黎曼矩形。 */
function riemannItem(): GalleryItem {
  const axes = new Axes([0, 4], [0, 3], 132, 70, { x: '', y: '' });
  const f = (x: number): number => 0.15 * x * x * x - 0.9 * x * x + 1.2 * x + 1.2;
  const group = new Group();
  group.add(
    axes,
    new AreaUnderCurve(axes, f, [0, 4]),
    new RiemannRectangles(axes, f, [0, 4], { n: 8, sample: 'mid' }),
    new FunctionGraph(f, axes),
  );
  return { name: 'Riemann', shape: group };
}

/** 切线与割线。 */
function tangentItem(): GalleryItem {
  const axes = new Axes([-2, 2], [-1, 3], 132, 80, { x: '', y: '' });
  const f = (x: number): number => 0.6 * x * x;
  const tangent = new TangentLine(axes, f, 1, { length: 90 });
  const secant = new SecantLine(axes, f, -1.5, 1, { extend: 14 });
  secant.setStyle({ dash: [5, 4], strokeWidth: 2 });
  const dot = new Dot(4);
  dot.moveTo(tangent.point ?? { x: 0, y: 0 });
  const group = new Group();
  group.add(axes, new FunctionGraph(f, axes), secant, tangent, dot);
  return { name: 'Tangent', shape: group };
}

/** 旋转场,按模长着色。 */
function vectorFieldItem(): GalleryItem {
  const plane = new NumberPlane([-3, 3], [-2, 2], 132, 92, { minorDivisions: 1 });
  plane.add(
    new VectorField(plane, (x, y) => [-y, x], {
      xRange: [-2.5, 2.5, 1],
      yRange: [-1.5, 1.5, 1],
      colors: ['#3b82f6', '#ef4444'],
    }),
  );
  return { name: 'VectorField', shape: plane };
}

function barChartItem(): GalleryItem {
  return {
    name: 'BarChart',
    shape: new BarChart([3, 5, 2, 4], {
      labels: ['A', 'B', 'C', 'D'],
      width: 120,
      height: 70,
      fontSize: 12,
    }),
  };
}

export function createGallery(): GalleryContents {
  const sphere = new Sphere(42);
  const genus = new ImplicitSurface(sphereToTorusField(36, 30, 12), {
    bounds: 58,
    resolution: 22,
    params: [0],
  });
  const homotopy = new ParametricSurface(sphereTorusHomotopy(38, 28, 12), {
    uSegs: 26,
    vSegs: 18,
    params: [0],
  });
  const square = new Square(68);
  const formula = formulaTex();
  const items: GalleryItem[] = [
    { name: 'Circle', shape: new Circle(36) },
    { name: 'Ellipse', shape: new Ellipse(50, 30) },
    { name: 'Rectangle', shape: new Rectangle(96, 60) },
    { name: 'Square', shape: square },
    { name: 'Triangle', shape: new Triangle(44) },
    { name: 'Pentagon', shape: new RegularPolygon(5, 42) },
    { name: 'Hexagon', shape: new RegularPolygon(6, 42) },
    { name: 'Star', shape: new Star(5, 44, 19) },
    { name: 'Line', shape: new Line({ x: -48, y: 0 }, { x: 48, y: 0 }) },
    { name: 'Arrow', shape: new Arrow({ x: -48, y: 0 }, { x: 48, y: 0 }) },
    { name: 'Arc', shape: new Arc(38, Math.PI * 0.1, Math.PI * 1.6) },
    { name: 'Sector', shape: new Sector(42, 0, Math.PI / 2) },
    { name: 'Dot', shape: new Dot(11) },
    { name: 'Cube', shape: new Cube(56) },
    { name: 'Cuboid', shape: new Cuboid(78, 50, 44) },
    { name: 'Pyramid', shape: new Pyramid(68, 72) },
    { name: 'Tetrahedron', shape: new Tetrahedron(52) },
    { name: 'Prism', shape: new TriangularPrism(44, 50) },
    { name: 'Cylinder', shape: new Cylinder(32, 68) },
    { name: 'Cone', shape: new Cone(38, 72) },
    { name: 'Sphere', shape: sphere },
    {
      name: 'Torus',
      shape: new ParametricSurface(torusParam(28, 12), { uSegs: 28, vSegs: 18 }),
    },
    {
      name: 'Mobius',
      shape: new ParametricSurface(mobiusParam(28, 9), {
        uSegs: 40,
        vSegs: 8,
        vRange: [-1, 1],
      }),
    },
    {
      name: 'Klein',
      shape: new ParametricSurface(kleinParam(13), {
        uSegs: 18,
        vSegs: 12,
      }).setStyle({ strokeWidth: 1 }),
    },
    { name: 'Genus', shape: genus },
    { name: 'Homotopy', shape: homotopy },
    funcItem('Sin', [-Math.PI * 2, Math.PI * 2], [-1.5, 1.5], 132, 92, sinFn),
    funcItem('Cos', [-Math.PI * 2, Math.PI * 2], [-1.5, 1.5], 132, 92, cosFn),
    funcItem('Tan', [-Math.PI, Math.PI], [-3, 3], 132, 92, tanFn, 240),
    funcItem('Exp', [-2, 2], [-0.5, 8], 132, 92, expFn),
    funcItem('Log', [-0.5, 5], [-3, 2], 132, 92, logFn),
    funcItem('Sinc', [-Math.PI * 3, Math.PI * 3], [-0.5, 1.2], 132, 92, sincFn, 260),
    paramItem('Spiral', [-5, 5], [-5, 5], 112, 100, spiralFn(0.35), [0, Math.PI * 4], 300),
    paramItem(
      'Lissajous',
      [-3.5, 3.5],
      [-3.5, 3.5],
      112,
      100,
      lissajousFn(3, 2, Math.PI / 2, 3),
      [0, Math.PI * 2],
      300,
    ),
    labeledTriangleItem(),
    { name: 'Formula', shape: formula },
    layoutItem(),
    braceItem(),
    angleItem(),
    numberLineItem(),
    numberPlaneItem(),
    riemannItem(),
    tangentItem(),
    vectorFieldItem(),
    barChartItem(),
  ];
  return { items, sphere, genus, homotopy, square, formula };
}

/**
 * 网格布局:世界坐标固定网格,与屏幕尺寸无关。返回内容包围盒。
 * items 与 captions 一一对应,长度必须相同。
 */
export function layoutGallery(gallery: Gallery): Bounds {
  const { items, captions } = gallery;
  if (items.length !== captions.length) {
    throw new Error(
      `layoutGallery: items(${items.length}) 与 captions(${captions.length}) 数量必须一致`,
    );
  }
  const cols = 7;
  const cellW = 190;
  const cellH = 170;
  const originX = (-cols * cellW) / 2;
  const originY = 80;
  const rows = Math.ceil(items.length / cols);
  items.forEach((item, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const cx = originX + col * cellW + cellW / 2;
    const cy = originY + row * cellH + cellH / 2;
    // moveTo 摆的是对象原点,而扇形/三角形这类图元的视觉中心相对原点有偏移;
    // 反向补偿一下,格子里才是真的居中(不然 Sector 会整个落到右下象限)。
    const box = item.shape.getBox();
    const s = item.shape.scale;
    item.shape.moveTo({ x: cx - box.center.x * s, y: cy - box.center.y * s });
    captions[i]?.moveTo({ x: cx, y: cy + 56 });
  });
  return {
    minX: originX,
    minY: originY,
    maxX: originX + cols * cellW,
    maxY: originY + rows * cellH,
  };
}
