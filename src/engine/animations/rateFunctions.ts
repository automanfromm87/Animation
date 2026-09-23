/** 缓动函数: 输入线性时间 t (0..1),输出插值进度 alpha (0..1)。 */

export type RateFunction = (t: number) => number;

export function linear(t: number): number {
  return t;
}

/** smoothstep,Manim 默认风格,两头慢中间快。 */
export function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

export function easeIn(t: number): number {
  return t * t;
}

export function easeOut(t: number): number {
  return 1 - (1 - t) * (1 - t);
}

export function easeInOut(t: number): number {
  return t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
}

/**
 * 去而复返:前半程 smooth 到 1,后半程 smooth 回 0(f(0)=f(1)=0、f(0.5)=1)。
 * 强调类动画(Indicate)用它:结束时回到原状。
 */
export function thereAndBack(t: number): number {
  return smooth(t < 0.5 ? 2 * t : 2 * (1 - t));
}

/** 去而复返、在顶点停一会儿:pauseRatio 是停顿占总时长的比例(0..1,缺省 1/3)。 */
export function thereAndBackWithPause(pauseRatio = 1 / 3): RateFunction {
  const p = Math.max(0, Math.min(1, pauseRatio));
  const ramp = (1 - p) / 2;
  return (t) => {
    if (ramp <= 0) {
      return t > 0 && t < 1 ? 1 : 0;
    }
    if (t < ramp) {
      return smooth(t / ramp);
    }
    if (t <= 1 - ramp) {
      return 1;
    }
    return smooth((1 - t) / ramp);
  };
}

/** 左右摆动 wiggles 个半周期、振幅先增后减(f(0)=f(1)=0,取值在 -1..1)。Wiggle 用。 */
export function wiggle(t: number, wiggles = 2): number {
  return thereAndBack(t) * Math.sin(wiggles * Math.PI * t);
}

/** 起步慢、冲到终点(smooth 的前半段拉满)。 */
export function rushInto(t: number): number {
  return 2 * smooth(t / 2);
}

/** 冲出起点、缓缓停下(smooth 的后半段拉满)。 */
export function rushFrom(t: number): number {
  return 2 * smooth(t / 2 + 0.5) - 1;
}

/** 两段 smooth:前半程到 0.5 时停一下再走完。 */
export function doubleSmooth(t: number): number {
  return t < 0.5 ? 0.5 * smooth(2 * t) : 0.5 * (1 + smooth(2 * t - 1));
}

/**
 * 把缓动压进 [a, b] 这一段时间:之前停在 f(0)、之后停在 f(1)。
 * 组合动画里让某个子动画只在总时长的一部分里进行时用。
 */
export function squish(rate: RateFunction, a: number, b: number): RateFunction {
  return (t) => {
    if (t <= a) {
      return rate(0);
    }
    if (t >= b || !(b > a)) {
      return rate(1);
    }
    return rate((t - a) / (b - a));
  };
}
