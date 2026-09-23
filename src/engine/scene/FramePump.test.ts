import { close, equal, ok, suite } from '../../testing/harness';
import type { FrameClock } from './FramePump';
import { FramePump, STALL_DT } from './FramePump';

/** 手动推进的时钟:frame(ms) 推进时间并跑掉排队的回调。 */
function manualClock(): FrameClock & { frame(ms: number): void; pending(): number } {
  let now = 1000;
  let nextId = 1;
  let queue = new Map<number, (t: number) => void>();
  return {
    now: () => now,
    request: (cb) => {
      const id = nextId++;
      queue.set(id, cb);
      return id;
    },
    cancel: (id) => {
      queue.delete(id);
    },
    frame(ms) {
      now += ms;
      const due = queue;
      queue = new Map();
      for (const cb of due.values()) {
        cb(now);
      }
    },
    pending: () => queue.size,
  };
}

function setup(): {
  pump: FramePump;
  clock: ReturnType<typeof manualClock>;
  draws: () => number;
  dts: number[];
} {
  const clock = manualClock();
  let draws = 0;
  const dts: number[] = [];
  const pump = new FramePump(
    {
      beforeTimelines: (dt) => {
        dts.push(dt);
        return true;
      },
      draw: () => {
        draws += 1;
      },
    },
    clock,
  );
  return { pump, clock, draws: () => draws, dts };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

export default suite('帧泵', [
  [
    '时间线按墙钟推进,到点 resolve;跑空后多泵一帧再停',
    async () => {
      const { pump, clock } = setup();
      let done = false;
      const seen: number[] = [];
      void pump.animateFor(0.1, (e) => seen.push(e)).then(() => {
        done = true;
      });
      for (let i = 0; i < 7; i++) {
        clock.frame(20);
        await flush();
      }
      ok(done);
      close(seen[seen.length - 1] ?? -1, 0.1, 1e-9);
      ok(seen.every((e, i) => i === 0 || e >= (seen[i - 1] ?? 0)), '已过时长不单调');
      clock.frame(20);
      clock.frame(20);
      equal(clock.pending(), 0, '跑空后还在空转');
      equal(pump.running, false);
    },
  ],
  [
    'updater 拿到的 dt 与时间线同一步长;停摆超过 0.5 秒的部分整体后移',
    async () => {
      const { pump, clock, dts } = setup();
      let last = 0;
      void pump.animateFor(10, (e) => {
        last = e;
      });
      clock.frame(250);
      clock.frame(250);
      close(dts[0] ?? 0, 0.25, 1e-9, '慢帧上 updater 不该被截到 0.1 秒');
      close(last, 0.5, 1e-9);
      clock.frame(5000); // 切后台回来
      close(dts[2] ?? 0, STALL_DT, 1e-9);
      close(last, 0.5 + STALL_DT, 1e-9, '停摆不应让时间线一步跳过');
      close(pump.getElapsed(), 0.5 + STALL_DT, 1e-9);
      pump.dispose();
    },
  ],
  [
    '暂停冻结时间线与播放时钟,恢复后接着原进度',
    async () => {
      const { pump, clock } = setup();
      let last = 0;
      void pump.animateFor(10, (e) => {
        last = e;
      });
      clock.frame(100);
      pump.setPaused(true);
      clock.frame(1000);
      clock.frame(1000);
      close(last, 0.1, 1e-9);
      pump.setPaused(false);
      clock.frame(100);
      close(last, 0.2, 1e-9);
      close(pump.getElapsed(), 0.2, 1e-9);
      pump.dispose();
    },
  ],
  [
    '空闲时的重绘请求合并成一帧,不推时间也不跑 updater',
    () => {
      const { pump, clock, draws, dts } = setup();
      pump.requestRender();
      pump.requestRender();
      pump.requestRender();
      equal(draws(), 0);
      clock.frame(16);
      equal(draws(), 1);
      equal(dts.length, 0);
      equal(pump.getElapsed(), 0);
    },
  ],
  [
    'dispose 放行挂起的时间线;dispose 之后注册的时间线立即 resolve',
    async () => {
      const { pump, clock } = setup();
      let a = false;
      void pump.animateFor(10, () => undefined).then(() => {
        a = true;
      });
      clock.frame(16);
      pump.dispose();
      await flush();
      ok(a, '挂起的时间线没有被放行');
      let b = false;
      void pump.animateFor(10, () => undefined).then(() => {
        b = true;
      });
      await flush();
      ok(b, 'dispose 之后注册的时间线永远悬着');
      equal(clock.pending(), 0);
    },
  ],
  [
    'Infinity 时长一直跑到 dispose',
    async () => {
      const { pump, clock } = setup();
      let done = false;
      void pump.animateFor(Infinity, () => undefined).then(() => {
        done = true;
      });
      for (let i = 0; i < 100; i++) {
        clock.frame(100);
      }
      await flush();
      ok(!done);
      pump.dispose();
      await flush();
      ok(done);
    },
  ],
  [
    '插值抛错只终止那一条时间线,帧泵照常运转',
    async () => {
      const { pump, clock } = setup();
      const { error } = console;
      console.error = (): void => undefined;
      let other = 0;
      let failed = false;
      try {
        void pump
          .animateFor(1, () => {
            throw new Error('boom');
          })
          .then(() => {
            failed = true;
          });
        void pump.animateFor(1, (e) => {
          other = e;
        });
        clock.frame(100);
        clock.frame(100);
        await flush();
      } finally {
        console.error = error;
      }
      ok(failed, '抛错的时间线没有被结束');
      close(other, 0.2, 1e-9);
      pump.dispose();
    },
  ],
  [
    '串行 await 的多段时间线承接上一段的超调:20 段 × 0.5 秒总共就是 10 秒,不越拖越长',
    async () => {
      const { pump, clock } = setup();
      const starts: number[] = [];
      let finished = false;
      void (async () => {
        for (let i = 0; i < 20; i++) {
          let first = true;
          await pump.animateFor(0.5, (elapsed) => {
            if (first) {
              first = false;
              starts.push(elapsed);
            }
          });
        }
        finished = true;
      })();
      // 帧长 16.7ms 不整除 500ms:每段结束都有不到一帧的超调。
      for (let i = 0; i < 700 && !finished; i++) {
        clock.frame(1000 / 60);
        await flush();
      }
      ok(finished);
      close(pump.getElapsed(), 10, 1000 / 60 / 1000 + 1e-9, `播放时钟 ${pump.getElapsed()} 秒`);
      // 每段第一帧的进度都带着上一段的超调(旧实现从注册时刻起算,第一帧恒为一整帧)。
      ok(starts.slice(1).some((e) => Math.abs(e - 1 / 60) > 1e-6), '后续各段没有承接超调');
      pump.dispose();
    },
  ],
  [
    '首帧就结束的时间线让帧泵停下后紧接着再播:承接超调,但播放时钟不重复计那段超调',
    async () => {
      const { pump, clock } = setup();
      await (async () => {
        const job = pump.animateFor(0.005, () => undefined);
        clock.frame(16);
        await flush();
        await job;
      })();
      let first = -1;
      void pump.animateFor(1, (elapsed) => {
        if (first < 0) {
          first = elapsed;
        }
      });
      clock.frame(16);
      close(pump.getElapsed(), 0.032, 1e-9, '播放时钟把上一段的超调又计了一遍');
      close(first, 0.016 + 0.011, 1e-9, '新时间线没有承接上一段的超调');
      pump.dispose();
    },
  ],
  [
    '承接只对紧跟着的注册有效:帧泵停了很久之后才来的时间线从当下起算',
    async () => {
      const { pump, clock } = setup();
      await (async () => {
        const job = pump.animateFor(0.01, () => undefined);
        clock.frame(16);
        await flush();
        await job;
      })();
      // 帧泵跑完收尾帧后停下;过了很久(10 秒)才注册下一段。
      clock.frame(16);
      for (let i = 0; i < 10; i++) {
        clock.frame(1000);
      }
      let first = -1;
      void pump.animateFor(1, (elapsed) => {
        if (first < 0) {
          first = elapsed;
        }
      });
      clock.frame(16);
      close(first, 0.016, 1e-9, '从很久以前的终点起跑,第一帧就跳到了终态');
      pump.dispose();
    },
  ],
]);
