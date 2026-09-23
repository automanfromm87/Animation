import { equal, suite } from '../../../src/testing/harness';

// 运行器自测的夹具(scripts/selftest.mjs 用 TEST_ROOT 指过来跑),不在 src 的常规测试里。
export default suite('运行器自测 · 通过', [['正常用例', () => equal(1 + 1, 2)]]);
