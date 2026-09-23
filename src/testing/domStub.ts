/**
 * 最小 DOM 桩,只为在 node 里把 Scene 的帧泵真实跑起来。
 * 不模拟布局,只提供 requestAnimationFrame / performance.now / devicePixelRatio
 * 和一个记录调用的 2D 上下文 —— 足够断言「这一帧画了几次、画了什么」。
 */

import { createFakeCtx } from './fakeCtx';

interface RafEntry {
  id: number;
  cb: (now: number) => void;
}

export interface StubCanvas {
  clientWidth: number;
  clientHeight: number;
  width: number;
  height: number;
  parentElement: null;
  style: Record<string, string>;
  getContext(): CanvasRenderingContext2D;
  addEventListener(): void;
  removeEventListener(): void;
  setPointerCapture(): void;
  releasePointerCapture(): void;
  hasPointerCapture(): boolean;
  /** 记录下来的 ctx 调用名序列。 */
  readonly ops: string[];
}

export interface DomStub {
  /** 推进一帧,跑掉当前排队的所有 rAF 回调。 */
  frame(dtMs?: number): void;
  /** 让微任务队列跑空(await 链推进)。 */
  flush(): Promise<void>;
  canvas(): StubCanvas & HTMLCanvasElement;
  /** 还没被消费的 rAF 数量。 */
  pending(): number;
  restore(): void;
}

function makeCtx(ops: string[]): CanvasRenderingContext2D {
  // 帧泵断言只关心方法名序列(属性赋值不算),不攒完整调用记录。
  return createFakeCtx({
    record: false,
    onCall: (call) => {
      if (!call.op.startsWith('=')) {
        ops.push(call.op);
      }
    },
  }).ctx;
}

/** 桩画布(记录 ctx 调用名)。不依赖任何全局,注入了时钟的用例可以不装 DOM 桩直接用。 */
export function createStubCanvas(): StubCanvas & HTMLCanvasElement {
  const ops: string[] = [];
  const ctx = makeCtx(ops);
  const canvas: StubCanvas = {
    clientWidth: 1280,
    clientHeight: 720,
    width: 1280,
    height: 720,
    parentElement: null,
    style: {},
    getContext: () => ctx,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    setPointerCapture: () => undefined,
    releasePointerCapture: () => undefined,
    hasPointerCapture: () => false,
    ops,
  };
  return canvas as StubCanvas & HTMLCanvasElement;
}

/**
 * 过一个宏任务边界:微任务队列必然被排空,多深的 await 链都推得动。
 * node 里用 setImmediate(比 setTimeout(0) 快两个数量级,内容时序测试要跑几万帧)。
 */
export function flushTasks(): Promise<void> {
  const immediate = (globalThis as { setImmediate?: (cb: () => void) => void }).setImmediate;
  return new Promise<void>((resolve) => {
    if (immediate) {
      immediate(resolve);
    } else {
      setTimeout(resolve, 0);
    }
  });
}

export function installDomStub(): DomStub {
  const g = globalThis as unknown as Record<string, unknown>;
  const saved = {
    raf: g['requestAnimationFrame'],
    caf: g['cancelAnimationFrame'],
    perf: g['performance'],
    win: g['window'],
  };
  let queue: RafEntry[] = [];
  let nextId = 1;
  // 从 1000 起:真实浏览器的时间戳不会是 0,代码里不该有人拿 0 当「未开始」的哨兵。
  let now = 1000;
  g['requestAnimationFrame'] = (cb: (t: number) => void): number => {
    const id = nextId++;
    queue.push({ id, cb });
    return id;
  };
  g['cancelAnimationFrame'] = (id: number): void => {
    queue = queue.filter((e) => e.id !== id);
  };
  g['performance'] = { now: () => now };
  g['window'] = { devicePixelRatio: 1 };
  return {
    frame(dtMs = 16) {
      now += dtMs;
      const due = queue;
      queue = [];
      for (const e of due) {
        e.cb(now);
      }
    },
    flush: flushTasks,
    canvas: createStubCanvas,
    pending() {
      return queue.length;
    },
    restore() {
      g['requestAnimationFrame'] = saved.raf;
      g['cancelAnimationFrame'] = saved.caf;
      g['performance'] = saved.perf;
      g['window'] = saved.win;
    },
  };
}

/** 统计某个操作被调用了几次。 */
export function countOps(ops: readonly string[], op: string): number {
  let n = 0;
  for (const entry of ops) {
    if (entry === op) {
      n += 1;
    }
  }
  return n;
}
