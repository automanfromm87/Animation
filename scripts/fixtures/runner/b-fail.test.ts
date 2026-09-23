import { equal, suite } from '../../../src/testing/harness';

export default suite('运行器自测 · 失败', [
  ['断言失败会带上测试文件里的那一帧', () => equal(1, 2, '故意失败')],
]);
