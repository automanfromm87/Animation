import { suite, throws } from '../../../src/testing/harness';

export default suite('运行器自测 · 未处理拒绝', [
  [
    '误把异步函数交给 throws:报出误用,进程不崩',
    () => {
      throws(async () => {
        throw new Error('异步抛错');
      });
    },
  ],
  [
    '漏接的 rejection 记成这条用例的失败',
    () => {
      void Promise.reject(new Error('漏接的 rejection'));
    },
  ],
  ['无辜的同步用例:不该替上一条背锅', () => undefined],
]);
