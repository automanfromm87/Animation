import { compositeFrame } from '../export/composite';
import type { ProgressVisual } from '../export/composite';
import { createFakeCtx } from '../testing/fakeCtx';
import { equal, ok, suite } from '../testing/harness';
import {
  PROGRESS_DEFAULTS,
  chapterNumeral,
  planFilm,
  progressFraction,
  progressLabelPx,
  resolveProgressVisual,
} from './timeline';
import type { FilmOptions, ProgressStyle, Segment, SegmentHandle } from './types';

/** 只带排片信息的分段:解析样式用不到起播,真被播放就是逻辑错了。 */
function seg(
  name: string,
  duration: number,
  extra: { marker?: 'chapter' | 'segment'; chapter?: string } = {},
): Segment {
  return {
    name,
    duration,
    ...extra,
    play(): SegmentHandle {
      throw new Error(`解析进度条样式不该起播分段 ${name}`);
    },
  };
}

/** 按播放器的口径解析:先排片,再用同一份 progressStyle 解析样式。 */
function resolve(
  segments: readonly Segment[],
  options: FilmOptions = {},
  viewportWidth = 1280,
  fontFamily = 'Songti SC',
): ProgressVisual | null {
  return resolveProgressVisual(
    segments,
    options.progressStyle,
    planFilm(segments, options),
    viewportWidth,
    fontFamily,
  );
}

function mustResolve(
  segments: readonly Segment[],
  options: FilmOptions = {},
  viewportWidth = 1280,
): ProgressVisual {
  const v = resolve(segments, options, viewportWidth);
  if (!v) {
    throw new Error('进度条开着却解析出 null');
  }
  return v;
}

const withStyle = (progressStyle: ProgressStyle): FilmOptions => ({ progressStyle });

export default suite('film 时间线:进度条样式', [
  [
    'resolveProgressVisual:播放器没开进度条(progress:false 或片长为 0)时为 null',
    () => {
      const segs = [seg('A', 2), seg('B', 3)];
      ok(resolve(segs) !== null, '默认应开进度条');
      equal(resolve(segs, { progress: false }), null, 'progress:false 仍解析出了进度条');
      equal(resolve([seg('A', 0), seg('B', 0)]), null, '片长为 0 仍解析出了进度条');
      equal(resolve([]), null, '空清单仍解析出了进度条');
    },
  ],
  [
    '刻度比例 = 段起点 / 总时长(按声明时长);大刻度只跟 marker === "chapter" 走',
    () => {
      const v = mustResolve([
        seg('A', 2, { marker: 'chapter', chapter: '起' }),
        seg('B', 3, { marker: 'segment' }),
        seg('C', 5),
      ]);
      equal(v.ticks.map((t) => t.frac).join(','), '0,0.2,0.5');
      equal(v.ticks.map((t) => t.chapter).join(','), 'true,false,false');
    },
  ],
  [
    '章名跟 chapter 字段走(没有 marker 也标),按出现顺序编号;marker 为 chapter 但没有章名的只画大刻度',
    () => {
      const v = mustResolve([
        seg('A', 1, { marker: 'chapter', chapter: '引子' }),
        seg('B', 1, { chapter: '极限' }),
        seg('C', 1, { marker: 'chapter' }),
        seg('D', 1, { marker: 'segment', chapter: '导数' }),
      ]);
      equal(
        v.ticks.map((t) => String(t.label)).join(' | '),
        '一 · 引子 | 二 · 极限 | null | 三 · 导数',
      );
      equal(v.ticks.map((t) => t.chapter).join(','), 'true,false,true,false');
    },
  ],
  [
    '章名编号:前九章用中文数字 一…九,第十章起用阿拉伯数字(不会悄悄没了编号)',
    () => {
      const segs = Array.from({ length: 11 }, (_, i) => seg(`S${i}`, 1, { chapter: `c${i}` }));
      const labels = mustResolve(segs).ticks.map((t) => t.label);
      equal(
        labels.join(' | '),
        '一 · c0 | 二 · c1 | 三 · c2 | 四 · c3 | 五 · c4 | 六 · c5 | 七 · c6 | 八 · c7 | 九 · c8 | 10 · c9 | 11 · c10',
      );
      equal(chapterNumeral(0), '一');
      equal(chapterNumeral(8), '九');
      equal(chapterNumeral(9), '10');
    },
  ],
  [
    '默认样式等于 PROGRESS_DEFAULTS(与改造前 DOM 进度条写死的数值一致),章名字体取传入的 fontFamily',
    () => {
      const v = mustResolve([seg('A', 2, { chapter: '起' }), seg('B', 2)]);
      for (const [key, value] of Object.entries(PROGRESS_DEFAULTS)) {
        equal(v[key as keyof typeof PROGRESS_DEFAULTS], value, `${key} 不是默认值`);
      }
      // 这些数值原来写死在 chrome.ts 里:改成共享样式后预览的外观不能变。
      equal(PROGRESS_DEFAULTS.trackPx, 3);
      equal(PROGRESS_DEFAULTS.color, '#1a1a1a');
      equal(PROGRESS_DEFAULTS.background, 'rgba(0,0,0,0.12)');
      equal(PROGRESS_DEFAULTS.tickColor, 'rgba(0,0,0,0.35)');
      equal(PROGRESS_DEFAULTS.tickWidthPx, 2);
      equal(PROGRESS_DEFAULTS.tickPx, 8);
      equal(PROGRESS_DEFAULTS.chapterTickPx, 14);
      equal(PROGRESS_DEFAULTS.labelOffsetPx, 20);
      equal(PROGRESS_DEFAULTS.labelGapPx, 6);
      equal(PROGRESS_DEFAULTS.labelColor, 'rgba(0,0,0,0.55)');
      equal(v.position, 'bottom');
      equal(v.labelFontFamily, 'Songti SC');
    },
  ],
  [
    'progressStyle 覆盖高度 / 填充色 / 轨道色 / 位置;刻度色等其余字段仍是默认值',
    () => {
      const segs = [seg('A', 2), seg('B', 2)];
      const v = mustResolve(
        segs,
        withStyle({ height: 5, color: '#c00', background: '#eee', position: 'top' }),
      );
      equal(v.trackPx, 5);
      equal(v.color, '#c00');
      equal(v.background, '#eee');
      equal(v.position, 'top');
      equal(v.tickColor, PROGRESS_DEFAULTS.tickColor);
      equal(v.labelColor, PROGRESS_DEFAULTS.labelColor);
      // 高度 0 是合法值(只留刻度),不能被当成「没写」回落到 3。
      equal(mustResolve(segs, withStyle({ height: 0 })).trackPx, 0);
    },
  ],
  [
    '非法高度(NaN / 负数 / Infinity)回落到默认 3',
    () => {
      const segs = [seg('A', 2), seg('B', 2)];
      for (const height of [Number.NaN, -1, Number.POSITIVE_INFINITY]) {
        equal(mustResolve(segs, withStyle({ height })).trackPx, 3, `height=${height} 没有回落`);
      }
    },
  ],
  [
    '章名字号 labelPx = progressLabelPx(画布宽):1280 -> 14、600 -> 10,夹在 [10,14];非正宽度按 1280 算',
    () => {
      const segs = [seg('A', 2, { chapter: '起' }), seg('B', 2)];
      equal(mustResolve(segs, {}, 1280).labelPx, 14);
      equal(mustResolve(segs, {}, 600).labelPx, 10);
      equal(mustResolve(segs, {}, 1000).labelPx, 11);
      equal(mustResolve(segs, {}, 0).labelPx, 14);
      for (const vw of [1280, 600, 1000, 0, 3000, Number.NaN]) {
        equal(mustResolve(segs, {}, vw).labelPx, progressLabelPx(vw), `vw=${vw}`);
      }
      equal(progressLabelPx(3000), 14);
    },
  ],
  [
    'blockPx = plan.barBlockPx:有章名 38、没有 18(只标了 marker 没有章名也算没有)',
    () => {
      const chaptered = [seg('A', 2, { chapter: '起' }), seg('B', 2)];
      const plain = [seg('A', 2, { marker: 'chapter' }), seg('B', 2)];
      equal(mustResolve(chaptered).blockPx, 38);
      equal(mustResolve(chaptered).blockPx, planFilm(chaptered).barBlockPx);
      equal(mustResolve(plain).blockPx, 18);
      equal(mustResolve(plain).blockPx, planFilm(plain).barBlockPx);
    },
  ],
  [
    'progressFraction:位置 / 总时长,夹紧到 [0,1];总时长 <= 0 或任一值非有限时为 0',
    () => {
      equal(progressFraction(5, 10), 0.5);
      equal(progressFraction(0, 10), 0);
      equal(progressFraction(10, 10), 1);
      equal(progressFraction(15, 10), 1, '超过片尾应夹到 1');
      equal(progressFraction(-3, 10), 0, '负位置应夹到 0');
      equal(progressFraction(5, 0), 0);
      equal(progressFraction(5, -1), 0);
      equal(progressFraction(Number.NaN, 10), 0);
      equal(progressFraction(Number.POSITIVE_INFINITY, 10), 0);
      equal(progressFraction(5, Number.NaN), 0);
    },
  ],
  [
    '解析出的样式直接喂给导出合成:成片里的进度条就是 DOM 那套默认几何与颜色',
    () => {
      const segs = [
        seg('A', 4, { marker: 'chapter', chapter: '引子' }),
        seg('B', 4),
        seg('C', 8, { marker: 'chapter', chapter: '导数' }),
      ];
      const visual = mustResolve(segs);
      const log: Array<{ op: string; fillStyle: unknown; font: unknown; args: number[]; text?: string }> = [];
      const { ctx } = createFakeCtx({
        record: false,
        onCall: (call, state) => {
          if (!call.op.startsWith('=')) {
            log.push({
              op: call.op,
              fillStyle: state['fillStyle'],
              font: state['font'],
              args: call.args,
              ...(typeof call.value === 'string' ? { text: call.value } : {}),
            });
          }
        },
      });
      compositeFrame(ctx, 1280, 720, {
        main: { width: 1280, height: 720 } as HTMLCanvasElement,
        mainRect: { x: 0, y: 0, w: 1280, h: 720 },
        scale: 1,
        veilAlpha: 0,
        veilColor: '#fff',
        subtitle: null,
        progress: { value: progressFraction(4, 16), visual },
      });
      const bar = log.slice(log.findIndex((l) => l.op === 'clip') + 1);
      equal(
        bar
          .filter((l) => l.op === 'fillRect')
          .map((l) => `${l.args.join(',')}@${String(l.fillStyle)}`)
          .join(' | '),
        [
          '0,717,1280,3@rgba(0,0,0,0.12)',
          '0,717,320,3@#1a1a1a',
          '0,706,2,14@#1a1a1a',
          '320,712,2,8@rgba(0,0,0,0.35)',
          '640,706,2,14@#1a1a1a',
        ].join(' | '),
      );
      const texts = bar.filter((l) => l.op === 'fillText');
      equal(
        texts.map((l) => `${l.text}@${l.args.join(',')}`).join(' | '),
        '一 · 引子@6,693 | 二 · 导数@646,693',
      );
      ok(texts.every((l) => l.fillStyle === 'rgba(0,0,0,0.55)'), '章名颜色不是默认值');
      ok(texts.every((l) => l.font === '14px Songti SC'), `章名字体不对:${String(texts[0]?.font)}`);
    },
  ],
]);
