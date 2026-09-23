/**
 * 引擎公共 API。外部只从这里 import;没列在这里的都是内部实现,可能随时改动。
 */
export type { ResolvedStyle, StyleOverride, Theme } from './theme/Theme';
export { resolveStyle } from './theme/Theme';
export { lightTheme, presetThemes, themeByName } from './theme/presets';

export type { Bounds, Box, MeasureContext, Point, Size } from './mobjects/types';
export {
  boxFromPoints,
  boxFromSize,
  expandBox,
  lerp,
  lerpPoint,
} from './mobjects/types';
export type { MorphOverlay } from './mobjects/MObject';
export { MObject } from './mobjects/MObject';
export { Group } from './mobjects/Group';
export type {
  AnnotationOptions,
  ArcOptions,
  PolygonOptions,
  StarOptions,
} from './mobjects/shapes';
export {
  Annotation,
  Arc,
  Arrow,
  Circle,
  Dot,
  Ellipse,
  Label,
  Line,
  PathShape,
  Polygon,
  Rectangle,
  RegularPolygon,
  Sector,
  Square,
  Star,
  SvgPath,
  Triangle,
} from './mobjects/shapes';
export type { CoordinateSystem, ParamCurve2D, RealFunction } from './mobjects/graphs';
export {
  Axes,
  FunctionGraph,
  ParametricCurve2D,
  Trace,
  cosFn,
  expFn,
  lissajousFn,
  logFn,
  sinFn,
  sincFn,
  spiralFn,
  tanFn,
} from './mobjects/graphs';
export type { TexOptions } from './mobjects/tex';
export { Tex } from './mobjects/tex';
export type { LabelKind } from './mobjects/labels';
export type {
  AngleArcOptions,
  AngleOptions,
  BraceForOptions,
  BraceOptions,
  BraceShapeOptions,
  BraceSide,
  RightAngleOptions,
} from './mobjects/annotations';
export { Angle, AngleArc, Brace, BraceShape, RightAngle } from './mobjects/annotations';
export type {
  NumberLineOptions,
  NumberLineTips,
  NumberPlaneOptions,
  PlaneRange,
} from './mobjects/numberLine';
export { NumberLine, NumberPlane } from './mobjects/numberLine';
export type {
  AreaUnderCurveOptions,
  RiemannRectanglesOptions,
  RiemannSample,
  RiemannToTarget,
  SecantLineOptions,
  TangentLineOptions,
} from './mobjects/plots';
export {
  AreaUnderCurve,
  RiemannRectangles,
  RiemannTo,
  SecantLine,
  TangentLine,
  numericDerivative,
} from './mobjects/plots';
export type { VectorFieldOptions, VectorFunction } from './mobjects/vectorField';
export { VectorField } from './mobjects/vectorField';
export type { BarChartOptions } from './mobjects/charts';
export { BarChart, BarChartTo } from './mobjects/charts';

export type { WorldBounds } from './mobjects/bounds';
export { worldBoundsInScene, worldBoundsOf } from './mobjects/bounds';
export type {
  LayoutAlign,
  LayoutDirection,
  LayoutFrameStyle,
  LayoutJustify,
  LayoutOptions,
} from './layout/Layout';
export { Layout } from './layout/Layout';

export type { RateFunction } from './animations/rateFunctions';
export {
  doubleSmooth,
  easeIn,
  easeInOut,
  easeOut,
  linear,
  rushFrom,
  rushInto,
  smooth,
  squish,
  thereAndBack,
  thereAndBackWithPause,
  wiggle,
} from './animations/rateFunctions';
export type { AnimationOptions, PlayContext, Playable } from './animations/Animation';
export { Animation, BasePlayable } from './animations/Animation';
export type {
  FadeInOptions,
  FadeTransformOptions,
  TextLike,
} from './animations/primitives';
export {
  Create,
  FadeIn,
  FadeOut,
  FadeTransform,
  MoveTo,
  RotateTo,
  ScaleTo,
} from './animations/primitives';
export { MorphTo, Orbit3D, ParamMorph, Spin3D } from './animations/animations3d';
export type { TransformOptions } from './animations/transform';
export { Transform } from './animations/transform';
export type { TransformMatchingTexOptions } from './animations/transformMatching';
export { TransformMatchingTex } from './animations/transformMatching';
export type { WriteOptions } from './animations/write';
export { Write } from './animations/write';
export type { AnimationGroupOptions } from './animations/composition';
export {
  AnimationGroup,
  DEFAULT_LAG_RATIO,
  LaggedStart,
  Succession,
  Wait,
} from './animations/composition';
export type {
  CircumscribeOptions,
  FlashOptions,
  IndicateOptions,
  WiggleOptions,
} from './animations/emphasis';
export { Circumscribe, Flash, Indicate, Wiggle } from './animations/emphasis';
export type { ColorTarget } from './animations/styleTween';
export { ColorTo } from './animations/styleTween';
export { TweenValue, ValueTracker } from './animations/tracker';

export { Projection3D } from './mobjects3d/Projection3D';
export type { Mesh3DOptions, Resamplable, Vec3 } from './mobjects3d/Mesh3D';
export { Mesh3D } from './mobjects3d/Mesh3D';
export type { RevolvedOptions, SphereOptions } from './mobjects3d/solids';
export {
  Cone,
  Cube,
  Cuboid,
  Cylinder,
  Pyramid,
  Sphere,
  Tetrahedron,
  TriangularPrism,
} from './mobjects3d/solids';
export type { ParamFn } from './mobjects3d/parametric';
export {
  kleinParam,
  mobiusParam,
  sphereParam,
  sphereTorusHomotopy,
  torusParam,
} from './mobjects3d/parametric';
export type { ParametricSurfaceOptions } from './mobjects3d/ParametricSurface';
export {
  ParametricSurface,
  sphereSurface,
} from './mobjects3d/ParametricSurface';

export type { FieldFn } from './implicit/sdf';
export { sdSphere, sdTorus, sphereToTorusField } from './implicit/sdf';
export type { ImplicitSurfaceOptions } from './implicit/ImplicitSurface';
export { ImplicitSurface } from './implicit/ImplicitSurface';

export type { CameraOptions, CameraView } from './camera/Camera';
export { Camera } from './camera/Camera';
export type {
  CameraFollowOptions,
  CameraFollowUpdater,
  CameraTarget,
  FollowTarget,
} from './camera/cameraMoves';
export { CameraMove, createCameraFollow } from './camera/cameraMoves';

// 矢量路径:形状变形、描边生长的共同表示;自定义图形可以直接用它构造与绘制。
export type { Affine, PathBounds, PathData, PathLayer, PathPaint, Subpath } from './path';
export {
  EMPTY_PATH,
  PathBuilder,
  alignPaths,
  drawPath,
  lerpPath,
  parseSvgPath,
  partialPath,
  pathBounds,
  pathLength,
  polylinePath,
  transformPath,
} from './path';
export type { Rgba } from './color';
export {
  colorAlpha,
  fadeColor,
  formatColor,
  highlightColor,
  lerpColor,
  parseColor,
} from './color';
export type { TexGroup, TexLayout, TexPrimitive, TexPrimitiveInfo } from './math/typeset';
export { MATH_SCALE, typesetTex } from './math/typeset';
export { onFontsLoaded } from './renderer/fontEvents';

export type { FrameClock } from './scene/FramePump';
export { browserClock } from './scene/FramePump';
export type {
  PlayFitOptions,
  SafeArea,
  SceneOptions,
  SceneUpdater,
  SceneViewport,
  UpdaterScene,
} from './scene/types';
export { Scene } from './scene/Scene';
