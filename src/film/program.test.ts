import { Scene } from '../engine';
import type { SafeArea } from '../engine';
import { installDomStub } from '../testing/domStub';
import type { DomStub } from '../testing/domStub';
import { equal, ok, suite } from '../testing/harness';
import { pythagorasFilm } from './program';
import type { Segment } from './types';

/** 勾股正片分段:场景句柄直接当分段句柄用,错误与上下文要一路接到播放器。 */
async function withStub(body: (dom: DomStub) => Promise<void>): Promise<void> {
  const dom = installDomStub();
  try {
    await body(dom);
  } finally {
    dom.restore();
  }
}

function mainSegment(): Segment {
  const seg = pythagorasFilm.find((s) => s.name === '勾股定理');
  if (!seg) {
    throw new Error('找不到勾股正片分段');
  }
  return seg;
}

export default suite('勾股短片分段', [
  [
    '场景时间线出错:错误经 onError 接到分段的 done 上(reject),播放器才能跳过这一段、导出才能收带',
    () =>
      withStub(async (dom) => {
        const original = Scene.prototype.play;
        Scene.prototype.play = function (): Promise<void> {
          return Promise.reject(new Error('时间线炸了'));
        };
        try {
          const handle = mainSegment().play(dom.canvas(), {});
          let outcome = 'pending';
          handle.done.then(
            () => {
              outcome = 'resolved';
            },
            (e: unknown) => {
              outcome = e instanceof Error ? e.message : String(e);
            },
          );
          for (let i = 0; i < 5; i++) {
            dom.frame(16);
            await dom.flush();
          }
          equal(outcome, '时间线炸了', '时间线的错误没有让 done 落定');
          handle.dispose();
        } finally {
          Scene.prototype.play = original;
        }
      }),
  ],
  [
    'resize 带新上下文时先换安全区再重取景;不带上下文(App 直接挂载)时不动安全区',
    () =>
      withStub(async (dom) => {
        const original = Scene.prototype.setSafeArea;
        const calls: SafeArea[] = [];
        Scene.prototype.setSafeArea = function (this: Scene, safe: SafeArea): void {
          calls.push(safe);
          original.call(this, safe);
        };
        try {
          const handle = mainSegment().play(dom.canvas(), { safeArea: { bottom: 87 } });
          ok(calls.some((c) => c.bottom === 87), '起播时没有用上下文里的安全区');
          calls.length = 0;
          // 画布变窄:字幕字号变小,播放器按新尺寸重算出更矮的安全区。
          handle.resize({ safeArea: { bottom: 71 } });
          equal(JSON.stringify(calls), '[{"bottom":71}]', '新上下文的安全区被丢掉了');
          handle.resize();
          equal(calls.length, 1, '不带上下文的 resize 不该改安全区');
          handle.dispose();
        } finally {
          Scene.prototype.setSafeArea = original;
        }
      }),
  ],
]);
