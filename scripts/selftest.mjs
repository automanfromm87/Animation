// 测试运行器自测:用 TEST_ROOT 把 scripts/test.mjs 指到 fixtures,核对它对各类失败的报告。
// 运行器守着 npm run check,它自己出错(丢报告、错误归属、超时不退出)时没有别的东西能发现。
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const run = spawnSync(process.execPath, [join(ROOT, 'scripts/test.mjs')], {
  cwd: ROOT,
  env: { ...process.env, TEST_ROOT: 'scripts/fixtures/runner', TEST_TIMEOUT: '300' },
  encoding: 'utf8',
  // 夹具里挂起的用例会留下定时器:运行器不主动退出的话,这里会被超时杀掉。
  timeout: 30_000,
});
const out = `${run.stdout ?? ''}${run.stderr ?? ''}`;

/** @type {Array<[boolean, string]>} */
const checks = [
  [run.signal === null, `运行器没有自己退出(被 ${run.signal} 杀掉):挂起用例留下的定时器吊住了进程`],
  [run.status === 1, `有失败时应以 1 退出(实际 ${run.status})`],
  [out.includes('2/6 通过'), '汇总行应为 2/6 通过(夹具 6 条用例:2 条通过、4 条失败,按用例计数)'],
  [/b-fail\.test\.ts:\d+/.test(out), '断言失败应打印测试文件里的那一帧'],
  [out.includes('传入的是异步函数,请用 rejects'), '误把异步函数交给 throws 应报出误用'],
  [
    out.includes('漏接的 rejection 记成这条用例的失败(未处理的 rejection)'),
    '漏接的 rejection 应记成当时那条用例的失败,而不是杀掉进程',
  ],
  [!out.includes('无辜的同步用例:不该替上一条背锅(未处理的 rejection)'), '漏接的 rejection 被记到了后面的用例头上'],
  [out.includes('因超时中止'), '挂起的用例应按超时失败并中止'],
];
const failed = checks.filter(([ok]) => !ok);
if (failed.length > 0) {
  console.error('✗ 测试运行器自测失败:');
  for (const [, message] of failed) {
    console.error(`  - ${message}`);
  }
  console.error('\n--- 运行器输出 ---\n' + out);
  process.exitCode = 1;
} else {
  console.log(`✓ 测试运行器自测通过(${checks.length} 项)`);
}
