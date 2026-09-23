/**
 * 测试用的假 2D 上下文(记录调用的 Proxy)。
 * harness 的 fakeCtx、DOM 桩与导出桩都基于它,只写各自的差异部分。
 */

export interface FakeCtxCall {
  /** 方法名;属性赋值记为 '=' + 属性名(如 '=strokeStyle')。 */
  op: string;
  /** 数字实参(坐标、尺寸等)。 */
  args: number[];
  /** 属性赋值的值 / 方法调用的第一个非数字实参(如 setLineDash 的数组、drawImage 的源)。 */
  value?: unknown;
}

/**
 * 画布状态属性的默认值。
 * 不预置的话「读一个还没赋过值的属性」会拿到记录函数,
 * `ctx.globalAlpha * 0.35` 这种写法会静默变成 NaN。
 */
export const CTX_STATE_DEFAULTS: Readonly<Record<string, unknown>> = Object.freeze({
  globalAlpha: 1,
  lineWidth: 1,
  fillStyle: '#000',
  strokeStyle: '#000',
  font: '10px sans-serif',
  textAlign: 'start',
  textBaseline: 'alphabetic',
  imageSmoothingEnabled: true,
  imageSmoothingQuality: 'low',
});

export interface FakeCtxOptions {
  /** 预置或替换的属性/方法(比如会抛错的 getImageData);替换的方法调用同样会被记录。 */
  overrides?: Readonly<Record<string, unknown>>;
  /**
   * 每次方法调用/属性赋值之后的回调,能读到当时的状态(比如 drawImage 时的 fillStyle)。
   * 它抛的错会从那次调用里抛出去,可用来模拟会失败的绘制。
   */
  onCall?: (call: FakeCtxCall, state: Readonly<Record<string, unknown>>) => void;
  /** 是否把调用攒进 calls 数组(长时间跑帧的桩设 false,免得无限增长)。默认 true。 */
  record?: boolean;
}

export interface FakeCtx {
  calls: FakeCtxCall[];
  ctx: CanvasRenderingContext2D;
}

export function createFakeCtx(options?: FakeCtxOptions): FakeCtx {
  const calls: FakeCtxCall[] = [];
  const record = options?.record ?? true;
  const onCall = options?.onCall;
  const state: Record<string, unknown> = {
    measureText: (text: string) => ({ width: String(text).length * 8 }),
    ...CTX_STATE_DEFAULTS,
  };
  const emit = (call: FakeCtxCall): void => {
    if (record) {
      calls.push(call);
    }
    onCall?.(call, state);
  };
  const wrap = (op: string, impl?: (...args: unknown[]) => unknown) =>
    (...args: unknown[]): unknown => {
      const result = impl?.(...args);
      emit({
        op,
        args: args.filter((a): a is number => typeof a === 'number'),
        value: args.find((a) => typeof a !== 'number'),
      });
      return result;
    };
  for (const [key, value] of Object.entries(options?.overrides ?? {})) {
    state[key] =
      typeof value === 'function' ? wrap(key, value as (...args: unknown[]) => unknown) : value;
  }
  const proxy = new Proxy(state, {
    get(obj, prop) {
      // Symbol 键与 then 必须返回 undefined:否则这个假 ctx 是 thenable,
      // 任何 await / Promise.resolve(ctx) 都会永久挂起。
      if (typeof prop !== 'string' || prop === 'then') {
        return undefined;
      }
      if (!(prop in obj)) {
        obj[prop] = wrap(prop);
      }
      return obj[prop];
    },
    set(obj, prop, value) {
      if (typeof prop === 'string') {
        obj[prop] = value;
        emit({ op: `=${prop}`, args: [], value });
      }
      return true;
    },
  });
  return { calls, ctx: proxy as unknown as CanvasRenderingContext2D };
}
