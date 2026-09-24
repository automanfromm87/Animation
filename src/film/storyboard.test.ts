import { close, equal, ok, suite } from '../testing/harness';
import { isFilmError } from '../export/types';
import type { StoryboardFrame, StoryboardSpec } from './storyboard';
import {
  DEFAULT_STORYBOARD_COUNT,
  MAX_STORYBOARD_FRAMES,
  evenStoryboardTimes,
  formatFilmTime,
  formatSegmentList,
  groupFramesBySegment,
  parseStoryboardSpec,
  parseStoryboardTime,
  planStoryboard,
  segmentStoryboardOffsets,
  sheetLayout,
  storyboardCaption,
  thumbnailLongEdge,
  thumbnailMinWidth,
  thumbnailSize,
  veilAlphaAt,
} from './storyboard';
import { segmentAtTime, segmentStarts } from './timeline';
import type { Segment, SegmentHandle, Subtitle } from './types';

/** 只带排片信息的分段:取帧用不到起播,真被播放就是逻辑错了。 */
function seg(name: string, duration: number, subtitles?: Subtitle[]): Segment {
  return {
    name,
    duration,
    ...(subtitles ? { subtitles } : {}),
    play(): SegmentHandle {
      throw new Error(`取帧不该起播分段 ${name}`);
    },
  };
}

const film = (...durations: number[]): Segment[] => durations.map((d, i) => seg(`s${i}`, d));

const specOf = (raw: string | null): StoryboardSpec => parseStoryboardSpec(raw).spec;
const timesOf = (raw: string): readonly number[] => {
  const spec = specOf(raw);
  if (spec.kind !== 'times') {
    throw new Error(`「${raw}」应当解析成时刻列表,实际 ${JSON.stringify(spec)}`);
  }
  return spec.times;
};
const positions = (frames: readonly StoryboardFrame[]): string =>
  frames.map((f) => f.position.toFixed(4)).join(',');

export default suite('film 故事板取帧', [
  [
    '规格语法:空 / 纯整数 / segments',
    () => {
      equal(JSON.stringify(specOf('')), JSON.stringify({ kind: 'even', count: DEFAULT_STORYBOARD_COUNT }));
      equal(JSON.stringify(specOf(null)), JSON.stringify({ kind: 'even', count: 24 }));
      equal(JSON.stringify(specOf('  ')), JSON.stringify({ kind: 'even', count: 24 }));
      equal(JSON.stringify(specOf('12')), JSON.stringify({ kind: 'even', count: 12 }));
      // 纯整数最容易被当成「第几秒」:每次都提示怎么写时刻(秒数满一分钟时给 m:ss 的写法)。
      equal(parseStoryboardSpec('42').notes.join('|'), '按 42 帧均匀取;要看第 42 秒那一帧,写 42s 或 0:42');
      equal(parseStoryboardSpec('75').notes.join('|'), '按 75 帧均匀取;要看第 75 秒那一帧,写 75s 或 1:15');
      equal(parseStoryboardSpec('7').notes.join('|'), '按 7 帧均匀取;要看第 7 秒那一帧,写 7s 或 0:07');
      equal(parseStoryboardSpec('').notes.length, 0, '缺省不提示');
      const zero = parseStoryboardSpec('0');
      equal(JSON.stringify(zero.spec), JSON.stringify({ kind: 'even', count: 24 }));
      equal(zero.notes.length, 1);
      ok(zero.notes[0]?.includes('至少为 1') === true, zero.notes[0]);
      for (const raw of ['segments', 'SEGMENTS', 'segment', ' Segments ']) {
        equal(specOf(raw).kind, 'segments', raw);
      }
      equal(parseStoryboardSpec('segments').notes.length, 0);
    },
  ],
  [
    '规格语法:时刻列表(只有一个纯整数时才是帧数;10s / 10.0 / 0:10 / 10, 都是第 10 秒)',
    () => {
      equal(timesOf('3,10.5,42').join(','), '3,10.5,42');
      for (const raw of ['10s', '10.0', '0:10', '10,', '10S']) {
        equal(timesOf(raw).join(','), '10', raw);
      }
      equal(timesOf('1:05.5').join(','), '65.5');
      for (const raw of ['3，5', '3 5', '3;5', '3；5', '3, 5', '3、5', '3\u30005']) {
        equal(timesOf(raw).join(','), '3,5', raw);
      }
    },
  ],
  [
    '规格语法:中文输入法的全角字符按半角认(数字、冒号、小数点、s、segments)',
    () => {
      equal(timesOf('１０ｓ').join(','), '10');
      equal(timesOf('1：05').join(','), '65');
      equal(timesOf('１：０５．５，４２ｓ').join(','), '65.5,42');
      equal(JSON.stringify(specOf('１２')), JSON.stringify({ kind: 'even', count: 12 }));
      ok(parseStoryboardSpec('１２').notes[0]?.startsWith('按 12 帧均匀取') === true);
      equal(specOf('ｓｅｇｍｅｎｔｓ').kind, 'segments');
      equal(parseStoryboardTime('２．５ｓ'), 2.5);
      equal(parseStoryboardSpec('1：05').notes.length, 0, '全角冒号不该被当成认不出的项');
    },
  ],
  [
    '规格语法:认不出的项丢掉并点名;一个有效时刻都没有按缺省 24 帧;永不抛错',
    () => {
      const mixed = parseStoryboardSpec('3,abc,-2,1:75,7');
      equal(JSON.stringify(mixed.spec), JSON.stringify({ kind: 'times', times: [3, 7] }));
      for (const bad of ['abc', '-2', '1:75']) {
        ok(mixed.notes.some((n) => n.includes(`“${bad}”`)), `提示里没点名 ${bad}:${mixed.notes.join(' | ')}`);
      }
      const none = parseStoryboardSpec('abc');
      equal(JSON.stringify(none.spec), JSON.stringify({ kind: 'even', count: 24 }));
      equal(none.notes.length, 2);
      ok(none.notes[1]?.includes('没有可用的时刻') === true, none.notes[1]);
      for (const raw of [',,,', '::', '1e3', '\u0000', 'NaN', 'Infinity', '9'.repeat(400)]) {
        const r = parseStoryboardSpec(raw);
        ok(r.spec.kind === 'even' || r.spec.kind === 'times', raw);
      }
    },
  ],
  [
    '单个时刻的边界:.5、1:5、1:60、1e3、空串、负数',
    () => {
      equal(parseStoryboardTime('.5'), 0.5);
      equal(parseStoryboardTime('12.5s'), 12.5);
      equal(parseStoryboardTime('1:5'), 65);
      equal(parseStoryboardTime('1:59.9'), 119.9);
      equal(parseStoryboardTime('1:60'), null);
      equal(parseStoryboardTime('1e3'), null);
      equal(parseStoryboardTime(''), null);
      equal(parseStoryboardTime('-3'), null);
      equal(parseStoryboardTime('s'), null);
    },
  ],
  [
    'even:n 个等宽区间的中点',
    () => {
      equal(evenStoryboardTimes(30, 3).join(','), '5,15,25');
      equal(evenStoryboardTimes(0, 3).length, 0);
      equal(evenStoryboardTimes(10, 0).length, 0);
      const three = planStoryboard(film(10, 10, 10), { kind: 'even', count: 3 });
      equal(positions(three.frames), '5.0000,15.0000,25.0000');
      ok(three.frames.every((f) => f.role === 'even'));
      equal(three.frames.map((f) => f.n).join(','), '0,1,2');
      const six = planStoryboard(film(10, 10, 10), { kind: 'even', count: 6 });
      equal(positions(six.frames), '2.5000,7.5000,12.5000,17.5000,22.5000,27.5000');
      equal(three.notes.length, 0);
    },
  ],
  [
    'even:落在段首白场里的推到 转场 + 0.1 之后',
    () => {
      // 5 秒处正好是 b 段的 0 秒(段界属于下一段),推到 0.7。
      const plan = planStoryboard(film(5, 5), { kind: 'even', count: 1 });
      equal(plan.frames.length, 1);
      equal(plan.frames[0]?.index, 1);
      close(plan.frames[0]?.offset ?? -1, 0.7);
      close(plan.frames[0]?.position ?? -1, 5.7);
      // 转场改成 0.2 时推到 0.3。
      const quick = planStoryboard(film(5, 5), { kind: 'even', count: 1 }, { transition: 0.2 });
      close(quick.frames[0]?.offset ?? -1, 0.3);
    },
  ],
  [
    'even:取整后同一时刻的帧合并并提示;超过上限按上限均匀取',
    () => {
      const tiny = planStoryboard(film(0.3, 0.3, 0.3, 0.3), { kind: 'even', count: 24 });
      ok(tiny.frames.length < 24, `没合并:${tiny.frames.length}`);
      equal(tiny.frames.length, 4);
      ok(tiny.notes.some((n) => n.includes('已合并')), tiny.notes.join(' | '));
      const many = planStoryboard(film(100, 100), { kind: 'even', count: 500 });
      equal(many.frames.length, MAX_STORYBOARD_FRAMES);
      ok(many.notes.some((n) => n.includes(`${MAX_STORYBOARD_FRAMES}`)), many.notes.join(' | '));
      // 截的是帧数不是时间:最后一帧仍在片尾附近。
      ok((many.frames[many.frames.length - 1]?.position ?? 0) > 199, '按上限均匀取,不是只取前 40%');
    },
  ],
  [
    'segments 超上限:先去最短段的段中帧、再去段尾帧,每段的段首帧都留着(片尾几段不丢),提示点名',
    () => {
      // 70 段 × 3 帧 = 210 > 200:去 10 个段中帧,从最短的段去起(第 61–70 段比别的短)。
      const durations = Array.from({ length: 70 }, (_, i) => (i >= 60 ? 6 : 10));
      const plan = planStoryboard(film(...durations), { kind: 'segments' });
      equal(plan.frames.length, MAX_STORYBOARD_FRAMES);
      const bySeg = new Map<number, string[]>();
      for (const f of plan.frames) {
        bySeg.set(f.index, [...(bySeg.get(f.index) ?? []), f.role]);
      }
      equal(bySeg.size, 70, '每段都要有帧');
      for (let i = 0; i < 70; i += 1) {
        const roles = (bySeg.get(i) ?? []).join(',');
        equal(roles, i >= 60 ? 'start,end' : 'start,middle,end', `第 ${i + 1} 段`);
      }
      equal(plan.frames[plan.frames.length - 1]?.index, 69, '片尾那段还在');
      equal(plan.notes.join('|'), '共 210 帧,超过上限 200:第 61–70 段去掉了段中那帧');
      // 段中不够去时接着去段尾;段数本身超上限才截掉后面的段。
      const tight = planStoryboard(film(...Array.from({ length: 30 }, () => 10)), { kind: 'segments' }, { maxFrames: 40 });
      equal(tight.frames.length, 40);
      equal(new Set(tight.frames.map((f) => f.index)).size, 30);
      ok(tight.frames.every((f) => f.role !== 'middle'));
      equal(tight.frames.filter((f) => f.role === 'end').length, 10);
      equal(tight.notes.join('|'), '共 90 帧,超过上限 40:第 1–30 段去掉了段中那帧;第 1–20 段去掉了段尾那帧');
      const over = planStoryboard(film(...Array.from({ length: 12 }, () => 10)), { kind: 'segments' }, { maxFrames: 10 });
      equal(over.frames.map((f) => f.role).join(','), Array.from({ length: 10 }, () => 'start').join(','));
      ok(over.notes[0]?.endsWith('第 11、12 段没有出帧') === true, over.notes[0]);
      // 时刻列表超上限:截掉后面的,提示从哪一刻起没出。
      const times = planStoryboard(film(300), { kind: 'times', times: [1, 2, 3, 4] }, { maxFrames: 3 });
      equal(times.frames.length, 3);
      ok(times.notes.some((n) => n.includes('0:04.0 起的没出')), times.notes.join(' | '));
    },
  ],
  [
    'formatSegmentList:1 起、去重排序、连续三段以上写区间',
    () => {
      equal(formatSegmentList([4, 2, 0, 5, 6, 9, 10]), '1、3、5–7、10、11');
      equal(formatSegmentList([]), '');
      equal(formatSegmentList([3, 3]), '4');
    },
  ],
  [
    'segments:每段 段首 +0.7 / 段中 / 段尾 −0.3;短段合并;末段可以到段尾、非末段严格小于段尾',
    () => {
      const offs = segmentStoryboardOffsets(10);
      equal(offs.map((o) => `${o.role}@${o.offset.toFixed(2)}`).join(','), 'start@0.70,middle@5.00,end@9.70');
      const plan = planStoryboard(film(10, 1.1, 0.4), { kind: 'segments' });
      const desc = plan.frames.map((f) => `${f.index}:${f.role}@${f.offset.toFixed(4)}`).join(',');
      equal(desc, '0:start@0.7000,0:middle@5.0000,0:end@9.7000,1:start@0.7000,2:start@0.4000');
      equal(positions(plan.frames), '0.7000,5.0000,9.7000,10.7000,11.5000');
      // 0.4 秒的段不是末段时:段尾那一刻属于下一段,取 11/30。
      const notLast = planStoryboard(film(10, 0.4, 3), { kind: 'segments' });
      const mid = notLast.frames.filter((f) => f.index === 1);
      equal(mid.length, 1);
      close(mid[0]?.offset ?? -1, 11 / 30);
      ok((mid[0]?.offset ?? 1) < 0.4);
      equal(plan.notes.length, 0, '分段模式的合并是语义本身,不提示');
    },
  ],
  [
    'times:升序输出;超出片长夹到片尾并标记;重复合并;段界落到下一段 0 秒;字幕按 subtitleAt',
    () => {
      const segs = [
        seg('a', 10, [{ start: 0, end: 5, text: '甲' }]),
        seg('b', 10, [{ start: 2, end: 8, text: '乙' }]),
        seg('c', 10.5),
      ];
      const plan = planStoryboard(segs, { kind: 'times', times: [42, 13, 3, 13, 10] });
      equal(positions(plan.frames), '3.0000,10.0000,13.0000,30.5000');
      const [f3, f10, f13, fEnd] = plan.frames;
      equal(f3?.subtitle, '甲');
      equal(f3?.role, 'explicit');
      equal(f3?.requested, 3);
      equal(f10?.index, 1);
      equal(f10?.offset, 0);
      equal(f10?.subtitle, '');
      equal(f13?.subtitle, '乙');
      equal(fEnd?.clamped, true);
      equal(fEnd?.requested, 42);
      equal(fEnd?.index, 2);
      close(fEnd?.offset ?? -1, 10.5);
      equal(f3?.clamped, undefined);
      ok(plan.notes.some((n) => n.includes('42 秒超出片长 30.5 秒')), plan.notes.join(' | '));
      ok(plan.notes.some((n) => n.includes('1 帧落在同一时刻')), plan.notes.join(' | '));
      // times 模式不推白场:0.1 秒就是 0.1 秒。
      const early = planStoryboard(film(5), { kind: 'times', times: [0.1] });
      close(early.frames[0]?.offset ?? -1, 0.1);
    },
  ],
  [
    '取整到帧网格:offset × 30 都是整数、非末段 offset < 段长、全片时刻与预览秒数都还原到同一段同一步',
    () => {
      const segs = film(3.217, 0.35, 10.0003, 2, 7.77, 0.9);
      const starts = segmentStarts(segs);
      const total = segs.reduce((s, g) => s + g.duration, 0);
      const specs: StoryboardSpec[] = [
        { kind: 'even', count: 40 },
        { kind: 'segments' },
        { kind: 'times', times: [0, 3.217, 3.2169, 3.567, 13.5673, 20, 24.2873, 999] },
      ];
      for (const spec of specs) {
        const plan = planStoryboard(segs, spec);
        for (const f of plan.frames) {
          const k = f.offset * 30;
          ok(Math.abs(k - Math.round(k)) < 1e-9, `${spec.kind} offset 不在网格上:${f.offset}`);
          if (f.index < segs.length - 1) {
            ok(f.offset < (segs[f.index]?.duration ?? 0), `${spec.kind} 非末段落在段尾:${f.index}@${f.offset}`);
          }
          for (const t of [f.position, f.preview]) {
            const at = segmentAtTime(segs, starts, total, t);
            equal(at.index, f.index, `${spec.kind} ${t} 还原到了第 ${at.index} 段(应为 ${f.index})`);
            equal(Math.round(at.offset * 30), Math.round(k), `${spec.kind} ${t} 还原的步数不对`);
          }
          ok(String(f.preview).length <= String(f.position).length, `预览秒数没更短:${f.preview}`);
        }
      }
      // 预览秒数取最短的那个:5 + 11/30 = 5.3666… 写成 5.37。
      const short = planStoryboard(film(5, 5), { kind: 'times', times: [5.3667] });
      equal(short.frames[0]?.preview, 5.37);
      // 段起点带亚毫秒(配音时间表定的时长):按毫秒写会落回上一段,预览秒数要多写几位。
      const edge = planStoryboard(segs, { kind: 'times', times: [13.5673] }).frames[0];
      equal(edge?.index, 3);
      equal(edge?.offset, 0);
      equal(segmentAtTime(segs, starts, total, Math.round((edge?.position ?? 0) * 1000) / 1000).index, 2);
      equal(segmentAtTime(segs, starts, total, edge?.preview ?? 0).index, 3);
    },
  ],
  [
    '空清单抛 no-segments;总时长为 0 的清单只出一帧并提示',
    () => {
      let code = '';
      try {
        planStoryboard([], { kind: 'even', count: 3 });
      } catch (e) {
        code = isFilmError(e, 'no-segments') ? 'no-segments' : String(e);
      }
      equal(code, 'no-segments');
      const zero = planStoryboard(film(0, 0), { kind: 'even', count: 24 });
      equal(zero.frames.length, 1);
      equal(zero.frames[0]?.position, 0);
      ok(zero.notes.some((n) => n.includes('总时长为 0')), zero.notes.join(' | '));
      const zeroTimes = planStoryboard(film(0), { kind: 'times', times: [3] });
      equal(zeroTimes.frames.length, 1);
      // 程序直接给空列表:按缺省 24 帧并提示。
      const empty = planStoryboard(film(10), { kind: 'times', times: [] });
      ok(empty.frames.length > 1);
      ok(empty.notes.some((n) => n.includes('没有可用的时刻')), empty.notes.join(' | '));
    },
  ],
  [
    'formatFilmTime:四舍五入到 0.1 秒再进位,负数 / NaN 按 0,分钟不封顶',
    () => {
      equal(formatFilmTime(0), '0:00.0');
      equal(formatFilmTime(65.34), '1:05.3');
      equal(formatFilmTime(59.96), '1:00.0');
      equal(formatFilmTime(3600), '60:00.0');
      equal(formatFilmTime(Number.NaN), '0:00.0');
      equal(formatFilmTime(-3), '0:00.0');
    },
  ],
  [
    '说明文案:逐字格式、无字幕、白场阈值、标记顺序、实际值覆盖计划值',
    () => {
      const segs = [seg('开场', 5), seg('正方形的面积', 11.7, [{ start: 0, end: 20, text: '面积是边长的平方' }])];
      const plan = planStoryboard(segs, { kind: 'times', times: [8.2, 99] });
      const [f, clamped] = plan.frames;
      if (!f || !clamped) {
        throw new Error('帧数不对');
      }
      const c = storyboardCaption(f, plan.segmentCount);
      equal(c.time, '0:08.2');
      equal(c.segment, '第 2/2 段 · 正方形的面积');
      equal(c.local, '段内 3.2s / 11.7s');
      equal(c.subtitle, '面积是边长的平方');
      equal(c.flags.length, 0);
      equal(c.label, '0:08.2,第 2 段「正方形的面积」段内 3.2 秒。字幕:面积是边长的平方。');
      const veiled = storyboardCaption(f, 2, { veilAlpha: 0.85, subtitle: '' });
      equal(veiled.flags.join('|'), '白场 85%');
      equal(veiled.subtitle, '(无字幕)');
      equal(storyboardCaption(f, 2, { veilAlpha: 0.01 }).flags.length, 0);
      const all = storyboardCaption(clamped, 2, { veilAlpha: 0.5, error: '炸了', notes: ['重叠', '出框'] });
      equal(all.flags.join('|'), '白场 50%|超出片长(99.0s),按片尾|出错:炸了|重叠|出框');
      ok(all.label.endsWith('。白场 50%;超出片长(99.0s),按片尾;出错:炸了;重叠;出框。'), all.label);
      // 脚本与声明时长对不上:排在超出片长之后、出错之前。
      const timing = storyboardCaption(clamped, 2, { endedEarly: 3.033, overran: 12.2, error: '炸了' });
      equal(
        timing.flags.join('|'),
        '超出片长(99.0s),按片尾|脚本 3.0s 就结束了(声明 11.7s)|脚本超过声明的 11.7s(到 12.2s 还没结束)|出错:炸了',
      );
      const actual = storyboardCaption(f, 2, { elapsed: 2.04, position: 7.04 });
      equal(actual.local, '段内 2.0s / 11.7s');
      equal(actual.time, '0:07.0');
    },
  ],
  [
    'veilAlphaAt:与 Veil 同一条 smooth 曲线',
    () => {
      equal(veilAlphaAt(0, 0.6), 1);
      close(veilAlphaAt(0.3, 0.6), 0.5);
      equal(veilAlphaAt(0.6, 0.6), 0);
      equal(veilAlphaAt(5, 0.6), 0);
      equal(veilAlphaAt(0.1, 0), 0);
      equal(veilAlphaAt(-1, 0.6), 1);
      close(veilAlphaAt(0.1, 0.6), 1 - (1 / 36) * (3 - 1 / 3));
    },
  ],
  [
    '缩略图尺寸与网格列宽',
    () => {
      equal(JSON.stringify(thumbnailSize(1280, 720, 640)), JSON.stringify({ width: 640, height: 360 }));
      equal(JSON.stringify(thumbnailSize(720, 1280, 640)), JSON.stringify({ width: 360, height: 640 }));
      equal(JSON.stringify(thumbnailSize(0, 0, 640)), JSON.stringify({ width: 640, height: 360 }));
      ok(thumbnailSize(1, 10000, 400).width >= 2);
      equal(thumbnailLongEdge(24), 640);
      equal(thumbnailLongEdge(48), 640);
      equal(thumbnailLongEdge(49), 400);
      equal(thumbnailMinWidth(1280, 720), 338);
      equal(thumbnailMinWidth(1024, 768), 253);
      equal(thumbnailMinWidth(720, 1280), 150);
      equal(thumbnailMinWidth(0, 0), 338);
    },
  ],
  [
    'groupFramesBySegment:段号升序、组内 offset 升序',
    () => {
      const plan = planStoryboard(film(4, 4, 4), { kind: 'times', times: [0.7, 2, 3.5, 9, 11] });
      const shuffled = [plan.frames[3], plan.frames[0], plan.frames[4], plan.frames[2], plan.frames[1]].filter(
        (f): f is StoryboardFrame => f !== undefined,
      );
      const groups = groupFramesBySegment(shuffled);
      equal(groups.map((g) => g.index).join(','), '0,2');
      equal(groups[0]?.frames.map((f) => f.offset.toFixed(2)).join(','), '0.70,2.00,3.50');
      equal(groups[1]?.frames.map((f) => f.offset.toFixed(2)).join(','), '1.00,3.00');
    },
  ],
  [
    '联系表排版:横图 6 列、竖图 8 列、面积超限整体缩小',
    () => {
      const l = sheetLayout({ count: 24, thumbWidth: 640, thumbHeight: 360 });
      equal(l.columns, 6);
      equal(l.rows, 4);
      equal(l.scale, 1);
      equal(l.gap, 16);
      equal(l.fontPx, 21);
      equal(l.cells.length, 24);
      equal(JSON.stringify(l.cells[0]), JSON.stringify({ x: 16, y: l.headerHeight + 16 }));
      equal(JSON.stringify(l.cells[7]), JSON.stringify({ x: 16 + 656, y: l.headerHeight + 16 + l.cellHeight + 16 }));
      equal(l.width, 16 + 6 * 656);
      const tall = sheetLayout({ count: 24, thumbWidth: 360, thumbHeight: 640 });
      equal(tall.columns, 8);
      equal(sheetLayout({ count: 3, thumbWidth: 640, thumbHeight: 360 }).columns, 3);
      const big = sheetLayout({ count: 200, thumbWidth: 640, thumbHeight: 360, maxArea: 4_000_000 });
      ok(big.scale < 1);
      ok(big.width * big.height * big.scale * big.scale <= 4_000_000 + 1);
    },
  ],
]);
