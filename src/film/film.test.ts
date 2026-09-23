import { equal, ok, suite } from '../testing/harness';
import type { Segment } from './film';
import { filmDuration, segmentIndexAt, segmentTicks, subtitleAt } from './film';
import {
  BAR_BLOCK_PLAIN_PX,
  BAR_BLOCK_WITH_CHAPTERS_PX,
  chapterNumeral,
  nextChapterIndex,
  planFilm,
  resolveSubtitleVisual,
  segmentAtTime,
  segmentStarts,
  subtitleSafeBottom,
} from './timeline';

function seg(name: string, duration: number, extra: Partial<Segment> = {}): Segment {
  return {
    name,
    duration,
    play: () => {
      throw new Error('not used');
    },
    ...extra,
  };
}

const SEGMENTS: Segment[] = [seg('a', 10), seg('b', 20), seg('c', 30)];

export default suite('film 时间线', [
  [
    'filmDuration 求和,segmentStarts 给出各段起点',
    () => {
      equal(filmDuration(SEGMENTS), 60);
      equal(filmDuration([]), 0);
      equal(segmentStarts(SEGMENTS).join(','), '0,10,30');
    },
  ],
  [
    'segmentTicks 给出各段起点比例',
    () => {
      const ticks = segmentTicks(SEGMENTS);
      equal(ticks.length, 3);
      equal(ticks[0], 0);
      equal(ticks[1], 10 / 60);
      equal(ticks[2], 30 / 60);
    },
  ],
  [
    'segmentIndexAt 按比例定位并在两端夹紧,非有限值落在第 0 段',
    () => {
      equal(segmentIndexAt(SEGMENTS, -1), 0);
      equal(segmentIndexAt(SEGMENTS, 0), 0);
      equal(segmentIndexAt(SEGMENTS, 0.1), 0);
      equal(segmentIndexAt(SEGMENTS, 0.25), 1);
      equal(segmentIndexAt(SEGMENTS, 0.9), 2);
      equal(segmentIndexAt(SEGMENTS, 2), 2);
      equal(segmentIndexAt(SEGMENTS, Number.NaN), 0);
    },
  ],
  [
    'subtitleAt 左闭右开,空隙返回空串',
    () => {
      const subs = [
        { start: 0, end: 2, text: '甲' },
        { start: 3, end: 5, text: '乙' },
      ];
      equal(subtitleAt(subs, 0), '甲');
      equal(subtitleAt(subs, 1.99), '甲');
      equal(subtitleAt(subs, 2), '');
      equal(subtitleAt(subs, 3), '乙');
      equal(subtitleAt(subs, 5), '');
      equal(subtitleAt([], 1), '');
    },
  ],
  [
    '排片:有章名时进度条占块更高;关闭进度条占块为 0',
    () => {
      equal(planFilm(SEGMENTS).barBlockPx, BAR_BLOCK_PLAIN_PX);
      const chaptered = [seg('卡', 5, { marker: 'chapter', chapter: '起' }), seg('正', 5)];
      equal(planFilm(chaptered).barBlockPx, BAR_BLOCK_WITH_CHAPTERS_PX);
      equal(planFilm(SEGMENTS, { progress: false }).barBlockPx, 0);
    },
  ],
  [
    '字幕视觉:底部进度条时让出占块,顶部进度条不让;显式样式优先',
    () => {
      // 带章名的进度条占块 38px:贴底时字幕至少抬到 48,贴顶时按常规 36。
      const chaptered = [seg('卡', 5, { marker: 'chapter', chapter: '起' }), seg('正', 5)];
      const bottomPlan = planFilm(chaptered);
      const topPlan = planFilm(chaptered, { progressStyle: { position: 'top' } });
      const bottom = resolveSubtitleVisual(1280, undefined, bottomPlan, 'serif');
      const top = resolveSubtitleVisual(1280, undefined, topPlan, 'serif');
      equal(bottom.bottomPx, BAR_BLOCK_WITH_CHAPTERS_PX + 10, '底部进度条要让出占块');
      equal(top.bottomPx, 36, '顶部进度条不该推高字幕');
      const custom = resolveSubtitleVisual(
        1280,
        { color: '#ff0', background: '#003', fontSize: 30, bottom: 99, fontFamily: 'Kai' },
        bottomPlan,
        'serif',
      );
      equal(custom.color, '#ff0');
      equal(custom.background, '#003');
      equal(custom.fontPx, 30);
      equal(custom.bottomPx, 99);
      equal(custom.fontFamily, 'Kai');
      ok(subtitleSafeBottom(custom) > 99 + 30, '安全区要盖住整个字幕块');
    },
  ],
  [
    '章节编号:前九章中文数字,之后阿拉伯数字',
    () => {
      equal(chapterNumeral(0), '一');
      equal(chapterNumeral(8), '九');
      equal(chapterNumeral(9), '10');
    },
  ],
  [
    'nextChapterIndex 双向找下一个章节卡',
    () => {
      const list = [
        seg('c1', 1, { marker: 'chapter' }),
        seg('a', 1),
        seg('c2', 1, { marker: 'chapter' }),
        seg('b', 1),
      ];
      equal(nextChapterIndex(list, 0, 1), 2);
      equal(nextChapterIndex(list, 3, -1), 2);
      equal(nextChapterIndex(list, 2, 1), null);
    },
  ],
  [
    'segmentAtTime 按秒定位到段与段内偏移,越界夹紧',
    () => {
      // a:0~10 b:10~30 c:30~60
      const starts = segmentStarts(SEGMENTS);
      const at = (t: number): string => {
        const r = segmentAtTime(SEGMENTS, starts, 60, t);
        return `${r.index}:${r.offset}`;
      };
      equal(at(0), '0:0');
      equal(at(9.5), '0:9.5');
      equal(at(10), '1:0');
      equal(at(29), '1:19');
      equal(at(30), '2:0');
      equal(at(60), '2:30');
      equal(at(99), '2:30');
      equal(at(-3), '0:0');
      equal(at(Number.NaN), '0:0');
      equal(JSON.stringify(segmentAtTime([], [], 0, 5)), '{"index":0,"offset":0}');
    },
  ],
]);
