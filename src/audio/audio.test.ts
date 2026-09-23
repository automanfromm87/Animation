import { close, equal, ok, suite } from '../testing/harness';
import { AudioLibrary } from './library';
import { LiveClipPlayer } from './live';
import { clampPlanes, mixWindow } from './mix';
import { FakeAudioContext, fakeAudio, fakeLoader } from './testing';
import type { DecodedAudio, PlacedClip } from './types';

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
};

function clip(key: string, at: number, duration: number, offset = 0, url = key): PlacedClip {
  return { key, url, at, offset, duration };
}

export default suite('声音层:混音、加载、实时对账', [
  [
    '混音:片段落在窗口里的正确位置,偏移从文件第 offset 秒读,超出窗口的部分下一块接着混',
    () => {
      const sr = 100;
      // 文件内容 = 下标(方便看读的是哪一段)。
      const audio = fakeAudio(2, sr, 1, (_c, i) => i);
      const planes = [new Float32Array(100)]; // 窗口 [1, 2) 秒
      mixWindow(planes, sr, 1, [clip('a', 1.5, 10, 0.2)], () => audio);
      equal(planes[0]?.[49], 0, '片段开始之前是静音');
      equal(planes[0]?.[50], 20, '1.5 秒处读文件第 0.2 秒(第 20 个采样)');
      equal(planes[0]?.[99], 69);
      const next = [new Float32Array(100)]; // 窗口 [2, 3)
      mixWindow(next, sr, 2, [clip('a', 1.5, 10, 0.2)], () => audio);
      equal(next[0]?.[0], 70, '下一块从断开的地方接上');
      // 文件 200 个采样(2 秒),从第 0.2 秒读起:时间轴 3.3 秒处放完。
      const last = [new Float32Array(100)]; // 窗口 [3, 4)
      mixWindow(last, sr, 3, [clip('a', 1.5, 10, 0.2)], () => audio);
      equal(last[0]?.[29], 199, '文件最后一个采样');
      equal(last[0]?.[30], 0, '放完之后是静音');
    },
  ],
  [
    '混音:duration 截断;单声道复制到两个声道;音量系数;采样率不同时插值;几段叠加后收进 ±1',
    () => {
      const sr = 100;
      const mono = fakeAudio(1, sr, 1, () => 0.4);
      const planes = [new Float32Array(100), new Float32Array(100)];
      mixWindow(planes, sr, 0, [{ ...clip('a', 0.1, 0.2), gain: 0.5 }], () => mono);
      close(planes[0]?.[10] ?? NaN, 0.2, 1e-6, '音量 0.5');
      close(planes[1]?.[10] ?? NaN, 0.2, 1e-6, '单声道复制到右声道');
      equal(planes[0]?.[30], 0, '只播 0.2 秒');
      const slow = fakeAudio(1, 50, 1, (_c, i) => i); // 50Hz 的文件放进 100Hz 的输出
      const out = [new Float32Array(10)];
      mixWindow(out, sr, 0, [clip('b', 0, 1)], () => slow);
      close(out[0]?.[1] ?? NaN, 0.5, 1e-6, '两个采样之间线性插值');
      close(out[0]?.[4] ?? NaN, 2, 1e-6);
      const loud = [new Float32Array(10)];
      mixWindow(loud, sr, 0, [clip('x', 0, 1), clip('y', 0, 1)], () => fakeAudio(1, sr, 1, () => 0.8));
      close(loud[0]?.[0] ?? NaN, 1.6, 1e-6, '叠加');
      clampPlanes(loud);
      equal(loud[0]?.[0], 1, '收进 ±1');
    },
  ],
  [
    '音频库:同一地址只取一次(并发共用);取不到的报一次错、按 null(静音)处理;release 之后重新取',
    async () => {
      const loader = fakeLoader({ 'a.m4a': fakeAudio(1) });
      const errors: string[] = [];
      const lib = new AudioLibrary(loader, (url) => errors.push(url));
      const [x, y] = await Promise.all([lib.load('a.m4a'), lib.load('a.m4a')]);
      ok(x !== null && x === y);
      equal(loader.calls.length, 1, '只取一次');
      equal(lib.peek('a.m4a'), x);
      equal(await lib.load('missing.m4a'), null);
      equal(await lib.load('missing.m4a'), null);
      equal(errors.join(','), 'missing.m4a', '失败只报一次');
      ok(lib.hasFailed('missing.m4a'));
      lib.release('a.m4a');
      equal(lib.peek('a.m4a'), null);
      await lib.load('a.m4a');
      equal(loader.calls.filter((u) => u === 'a.m4a').length, 2, 'release 之后重新取');
    },
  ],
  [
    '实时对账:进行中的片段从正确位置起播;即将开始的按音频时钟准时排;暂停全停;时间轴跳走重排',
    async () => {
      const table: Record<string, DecodedAudio> = { 'a.m4a': fakeAudio(5), 'b.m4a': fakeAudio(5) };
      const loader = fakeLoader(table);
      const ctx = new FakeAudioContext((bytes) => loader.decode(bytes));
      const lib = new AudioLibrary(loader);
      await lib.load('a.m4a');
      await lib.load('b.m4a');
      const player = new LiveClipPlayer(ctx, lib, {});
      ctx.currentTime = 10;
      const clips = [clip('a', 1, 3, 0.5, 'a.m4a'), clip('b', 2.1, 3, 0, 'b.m4a')];
      player.sync(clips, 2, true);
      const a = ctx.nodes[0];
      equal(a?.started?.when, 10, 'a 进行中:立刻起播');
      close(a?.started?.offset ?? NaN, 1.5, 1e-9, '文件偏移 0.5 + 已播 1 秒');
      close(a?.started?.duration ?? NaN, 2, 1e-9, '还剩 2 秒');
      const b = ctx.nodes[1];
      close(b?.started?.when ?? NaN, 10.1, 1e-9, 'b 0.1 秒后开始:按音频时钟排好');
      equal(player.activeCount, 2);
      ctx.currentTime = 10.5;
      player.sync(clips, 2.5, true);
      equal(ctx.nodes.length, 2, '同步着就不重排');
      player.sync(clips, 2.5, false);
      ok(a?.stopped && b?.stopped, '暂停全停');
      player.sync(clips, 3.5, true);
      const restarted = ctx.nodes[2];
      close(restarted?.started?.offset ?? NaN, 3, 1e-9, '恢复后从 3.5 秒对应的位置起播');
      ctx.currentTime = 11;
      player.sync(clips, 1.2, true); // 往回跳(段内跳转)
      ok(restarted?.stopped, '偏差超过容忍就停掉重排');
      const jumped = ctx.nodes.find((n, i) => i > 2 && n.buffer === table['a.m4a']);
      close(jumped?.started?.offset ?? NaN, 0.7, 1e-9);
    },
  ],
  [
    '实时对账:音频还没解好时先去取、之后晚起也在对的位置;文件已放完的不起播;片段不在了就停',
    async () => {
      const table: Record<string, DecodedAudio> = { 'a.m4a': fakeAudio(2) };
      const loader = fakeLoader(table);
      const ctx = new FakeAudioContext((bytes) => loader.decode(bytes));
      const lib = new AudioLibrary(loader);
      const player = new LiveClipPlayer(ctx, lib, {});
      const clips = [clip('a', 0, 10, 0, 'a.m4a')];
      player.sync(clips, 0.2, true);
      equal(ctx.nodes.length, 0, '没解好先不响');
      equal(loader.calls.length, 1, '但已经去取了');
      await flush();
      player.sync(clips, 0.6, true);
      close(ctx.nodes[0]?.started?.offset ?? NaN, 0.6, 1e-9, '解好后按当时的位置起播');
      player.sync([], 0.7, true);
      ok(ctx.nodes[0]?.stopped, '片段不在了(切段)就停');
      player.sync(clips, 3, true);
      equal(ctx.nodes.length, 1, '文件只有 2 秒:3 秒处不起播');
    },
  ],
]);
