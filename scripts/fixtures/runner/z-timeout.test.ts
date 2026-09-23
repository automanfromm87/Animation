import { suite } from '../../../src/testing/harness';

export default suite('运行器自测 · 超时', [
  [
    '挂起且留下定时器的用例:按超时失败,报告照样打印,进程也照样退出',
    () =>
      new Promise<void>(() => {
        setInterval(() => undefined, 1000);
      }),
  ],
]);
