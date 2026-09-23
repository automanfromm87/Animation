/**
 * 极简测试壳。
 * 用它而不是 vitest/jest,是为了不给这个只依赖 MathJax 的引擎再加一层测试工具链:
 * 用例跑在 Vite 的 SSR 模块加载器里(scripts/test.mjs),
 * 解析规则与 app 完全一致,不需要额外的 transform 配置。
 */

import { createFakeCtx } from './fakeCtx';
import type { FakeCtx, FakeCtxCall, FakeCtxOptions } from './fakeCtx';

export type TestFn = () => void | Promise<void>;

export interface Suite {
  name: string;
  tests: Array<readonly [string, TestFn]>;
}

export function suite(
  name: string,
  tests: Array<readonly [string, TestFn]>,
): Suite {
  return { name, tests };
}

export class AssertionError extends Error {
  constructor(message?: string) {
    super(message);
    // 不设 name 的话实例的 name 是 'Error',runner 里「断言失败只打一行」的分支永远不生效。
    this.name = 'AssertionError';
  }
}

export function ok(value: unknown, message = '期望为真'): void {
  if (!value) {
    throw new AssertionError(message);
  }
}

export function equal<T>(actual: T, expected: T, message?: string): void {
  if (!Object.is(actual, expected)) {
    throw new AssertionError(
      message ?? `期望 ${String(expected)},实际 ${String(actual)}`,
    );
  }
}

export function close(
  actual: number,
  expected: number,
  tolerance = 1e-9,
  message?: string,
): void {
  if (!(Math.abs(actual - expected) <= tolerance)) {
    throw new AssertionError(
      message ?? `期望 ${expected} ± ${tolerance},实际 ${actual}`,
    );
  }
}

/** 临时静音 console.error / console.warn:用例故意走错误路径时,别把真实失败信息淹掉。 */
export async function quiet(body: () => Promise<void> | void): Promise<void> {
  const { error, warn } = console;
  console.error = (): void => undefined;
  console.warn = (): void => undefined;
  try {
    await body();
  } finally {
    console.error = error;
    console.warn = warn;
  }
}

export function throws(fn: () => unknown, message = '期望抛错'): void {
  let result: unknown;
  try {
    result = fn();
  } catch {
    return;
  }
  // 异步函数不会同步抛错:断言会误报「没抛」。先把它的 reject 接住 ——
  // 没人接的 rejection 会被 node 当成未处理拒绝直接杀掉进程,整份报告都丢了。
  if (result !== null && typeof result === 'object' && 'then' in result) {
    const thenable = result as { then: (ok: unknown, err: (e: unknown) => void) => unknown };
    try {
      thenable.then(undefined, () => undefined);
    } catch {
      // then 本身坏掉也不影响下面报出误用。
    }
    throw new AssertionError(`${message}(传入的是异步函数,请用 rejects)`);
  }
  throw new AssertionError(message);
}

/** 期望 fn 返回的 Promise 被 reject。 */
export async function rejects(
  fn: () => Promise<unknown>,
  message = '期望 reject',
): Promise<void> {
  try {
    await fn();
  } catch {
    return;
  }
  throw new AssertionError(message);
}

export type { FakeCtx, FakeCtxCall, FakeCtxOptions } from './fakeCtx';

/** 记录绘制调用的假 2D 上下文,用来断言「画到了哪里」。 */
export function fakeCtx(options?: FakeCtxOptions): FakeCtx {
  return createFakeCtx(options);
}

/** 第 n 次(从 0 起)调用 op 之前,最近一次给 prop 赋的值。断言「画的时候用的是什么样式」。 */
export function stateAt(
  calls: readonly FakeCtxCall[],
  op: string,
  prop: string,
  nth = 0,
): unknown {
  let seen = -1;
  let value: unknown;
  for (const c of calls) {
    if (c.op === `=${prop}`) {
      value = c.value;
    } else if (c.op === op) {
      seen += 1;
      if (seen === nth) {
        return value;
      }
    }
  }
  return undefined;
}
