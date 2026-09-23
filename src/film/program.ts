import { runPythagorasScene } from '../scenes/pythagoras';
import { cardSegment } from './segments';
import type { Segment, SegmentContext } from './types';

// 卡片模板已移到 segments.ts;这里保留旧的导出路径,内容脚本不必跟着改 import。
export type { CardBuild } from './segments';
export { runCard } from './segments';

const titleCard: Segment = cardSegment({
  name: '片头',
  title: '勾股定理',
  titleSize: 64,
  headingTex: 'a^2 + b^2 = c^2',
  narration: '今天,我们证明勾股定理',
  holdSeconds: 4,
  lineHalfWidth: 120,
});

const outroCard: Segment = cardSegment({
  name: '片尾',
  title: 'Q.E.D.',
  heading: '下一集 · 三角函数',
  narration: '感谢观看,下一集讲三角函数',
  holdSeconds: 3,
});

const pythagorasSegment: Segment = {
  name: '勾股定理',
  duration: 21.5,
  subtitles: [
    { start: 0.2, end: 3.6, text: '一个直角三角形,三条边分别叫 a、b、c' },
    { start: 3.8, end: 6.6, text: '以每条边为一边,向外作正方形' },
    { start: 6.6, end: 10.6, text: '三个正方形的面积,是 a²、b² 和 c²' },
    { start: 10.8, end: 13.8, text: '当三边是 3、4、5:3² 加 4²,等于 5²' },
    { start: 13.8, end: 16.3, text: '也就是 9 加 16,等于 25' },
    { start: 16.3, end: 20.5, text: '直角边平方之和,等于斜边平方' },
  ],
  play(canvas, context?: SegmentContext) {
    let resolveDone!: () => void;
    let rejectDone!: (e: unknown) => void;
    const done = new Promise<void>((resolve, reject) => {
      resolveDone = resolve;
      rejectDone = reject;
    });
    // 场景时间线出错必须让 done 落定(reject),否则播放器会永远停在这一段上,导出也收不了带。
    const handle = runPythagorasScene(canvas, {
      once: true,
      onDone: () => resolveDone(),
      onError: (e) => rejectDone(e),
      safeArea: context?.safeArea,
      clock: context?.clock,
      viewport: context?.viewport,
    });
    // 场景句柄与分段句柄是同一份契约(resize 也收新上下文),补上 done 即可。
    return { ...handle, done };
  },
};

/** 样片清单:片头 + 正片 + 片尾。10 分钟 = 照这个密度堆到 sum(duration) ≈ 600。 */
export const pythagorasFilm: Segment[] = [titleCard, pythagorasSegment, outroCard];
