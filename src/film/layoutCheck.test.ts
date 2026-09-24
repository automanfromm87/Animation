import { Axes, FadeIn, FadeOut, FadeTransform, Label, Rectangle, estimatedTextMetricsInstalled, linear } from '../engine';
import { compositeFrame } from '../export/composite';
import type { SubtitleVisual } from '../export/composite';
import { messageChannelYielder } from '../export/offlineEnv';
import { createStubCanvas } from '../testing/domStub';
import { createFakeCtx } from '../testing/fakeCtx';
import { close, equal, ok, suite } from '../testing/harness';
import { hide, label, stage, sweep, tex } from './helpers';
import {
  DEFAULT_LAYOUT_VIEWPORTS,
  checkFilmLayout,
  checkHandleLayout,
  formatLayoutIssueLine,
  formatLayoutReport,
  inspectFilmFrames,
  inspectFrameAt,
  layoutPreviewSeconds,
  layoutPreviewUrl,
  layoutSampleTimes,
  layoutZones,
  sampleSegmentLayout,
  subtitleBlockRect,
} from './layoutCheck';
import type { FilmLayoutIssue, FilmLayoutReport, LayoutSample } from './layoutCheck';
import { ManualClock } from './offline';
import { fastForwardTo, previewFrameAt } from './preview';
import { directedSegment } from './segments';
import { planFilm, resolveSubtitleVisual, segmentAtTime, subtitleSafeBottom } from './timeline';
import type { Segment, SegmentContext } from './types';
import type { DryRunEnv } from './voice';
import { topologyFilm } from './topology';

const env: DryRunEnv = { createCanvas: () => createStubCanvas(), createYielder: messageChannelYielder };
const LANDSCAPE = DEFAULT_LAYOUT_VIEWPORTS[0] ?? { width: 1280, height: 720 };
const PORTRAIT = DEFAULT_LAYOUT_VIEWPORTS[1] ?? { width: 405, height: 720 };

/** 竖屏里变形成长串后出画:取景框偏高,横屏按高取景(宽裕)、竖屏按宽取景(紧)。 */
const widening = directedSegment('变宽', 4, [{ start: 0.2, end: 3.8, text: '变宽' }], async (env0) => {
  const f = label('AB', 50, { x: 0, y: 0 });
  stage(env0.scene, [f], 30, [new Rectangle(300, 400)]);
  await env0.wait(1);
  await env0.play(new FadeTransform(f, 'ABCDEFGHIJKLMNOPQRST', { runTime: 1 }));
  await env0.wait(2);
});

/** 同一位置的两块字交叉淡化。 */
const crossFade = directedSegment('交叉淡化', 2.5, [{ start: 0.2, end: 2.4, text: '交叉' }], async (env0) => {
  const a = label('开覆盖', 30, { x: 0, y: 0 });
  const b = label('有限子覆盖', 30, { x: 0, y: 0 });
  hide(b);
  stage(env0.scene, [a, b], 30);
  await env0.wait(1);
  await env0.play(new FadeOut(a, { runTime: 1 }), new FadeIn(b, { runTime: 1 }));
  await env0.wait(0.5);
});

/** 推近镜头:途中邻近的字滑出画面(瞬态),停下后仍被切掉一半(真问题)。 */
const pushIn = directedSegment('推近', 4, [{ start: 0.2, end: 3.9, text: '推近' }], async (env0) => {
  const box = new Rectangle(200, 200);
  const neighbor = label('NEIGHBOR', 30, { x: 200, y: 0 });
  stage(env0.scene, [box, neighbor], 20);
  await env0.wait(0.5);
  await env0.scene.playFit([box], { pad: 0, runTime: 2 });
  await env0.wait(1.5);
});

/** 上下两块字把取景撑满:没有字幕时底下那块压在进度条上。 */
function tallStack(name: string, subtitles: Segment['subtitles']): Segment {
  return directedSegment(name, 1.5, subtitles ?? [], async (env0) => {
    const top = label('TOP', 30, { x: 0, y: -100 });
    const bottom = label('BOTTOM', 30, { x: 0, y: 100 });
    stage(env0.scene, [top, bottom], 0);
    await env0.wait(1.5);
  });
}

/** 竖屏里折成两行的字幕,压到取景底边的公式。 */
const longCaption = directedSegment(
  '长字幕',
  2,
  [{ start: 0.2, end: 1.9, text: '这是一条故意写得很长很长的字幕用来在竖屏里折成两行看看会怎样' }],
  async (env0) => {
    const top = label('TOP', 30, { x: 0, y: -300 });
    const bottom = tex('x^2+y^2=z^2', 30, { x: 0, y: 300 });
    stage(env0.scene, [top, bottom], 0);
    await env0.wait(2);
  },
);

/** 坐标轴 + 读数:先沿刻度行扫 2 秒(持续压刻度),再竖着一闪而过(只在一次采样里压到)。 */
const readouts = directedSegment('读数', 5, [{ start: 0.2, end: 4.9, text: '读数' }], async (env0) => {
  const axes = new Axes([0, 4], [0, 2], 400, 200);
  const along = label('k = 1.00', 22, { x: -150, y: 111 });
  const across = label('m = 2.00', 22, { x: 0, y: -100 });
  stage(env0.scene, [axes, along, across], 24);
  await env0.wait(0.75);
  await sweep(env0, {
    from: -150,
    to: 150,
    runTime: 2,
    rateFunc: linear,
    draw: (v) => along.moveTo({ x: v, y: 111 }),
  });
  along.moveTo({ x: 0, y: -60 });
  await env0.wait(0.5);
  // 3.25 → 3.75 线性地从 y = 11 走到 211:只有 3.5 秒那一帧正好在刻度行上(y = 111),走完就藏起来。
  await sweep(env0, {
    from: 11,
    to: 211,
    runTime: 0.5,
    rateFunc: linear,
    draw: (v) => across.moveTo({ x: 0, y: v }),
  });
  hide(across);
  await env0.wait(1.25);
});

/** 一块固定的字 + 一个逐帧变字的读数压在一起 3 秒多。 */
const persistent = directedSegment('持续互压', 3.5, [{ start: 0.2, end: 3.4, text: '持续' }], async (env0) => {
  const fixed = label('FIXED TEXT', 30, { x: 0, y: 0 });
  const reading = label('k = 0.00', 30, { x: 10, y: 5 });
  stage(env0.scene, [fixed, reading], 30);
  await sweep(env0, { from: 0, to: 3, runTime: 3, draw: (v) => reading.setText(`k = ${v.toFixed(2)}`) });
  await env0.wait(0.5);
});

/**
 * 镜头整段慢慢右移(每秒 10 世界单位,zoom 1 下每帧 0.33 px):中间两块字互压(与机位无关,照报 error),
 * 右边一块字一直半截在画外(跟机位有关,但运镜跨了一秒多 → 封顶提醒,不当瞬态)。
 */
const slowPan = directedSegment('慢摇', 4, [{ start: 0.2, end: 3.9, text: '慢摇' }], async (env0) => {
  const a = label('FIXED TEXT', 30, { x: 0, y: 0 });
  const b = label('OVERLAP', 30, { x: 20, y: 5 });
  const edge = label('EDGE LABEL', 30, { x: 640, y: -200 });
  env0.scene.add(a, b, edge);
  env0.scene.getCamera().setView({ x: 0, y: 0, zoom: 1 });
  env0.scene.addUpdater((s, dt) => {
    s.getCamera().x += 10 * dt;
  });
  await env0.wait(4);
});

/** 第二块字 2.1 秒才露出:互压只出现在段尾前一帧(2.267 秒)那次采样里。 */
const lateOverlap = directedSegment('末帧互压', 2.3, [{ start: 0.2, end: 2.2, text: '末帧' }], async (env0) => {
  const a = label('FIXED TEXT', 30, { x: 0, y: 0 });
  const b = label('LATE', 30, { x: 10, y: 5 });
  hide(b);
  stage(env0.scene, [a, b], 30);
  await env0.wait(2.1);
  b.opacity = 1;
  await env0.wait(0.2);
});

/** 8 号小字,镜头一直在拉远:越到后面越小,最严重的是段尾那一帧。 */
const zoomOut = directedSegment('拉远', 3, [{ start: 0.2, end: 2.9, text: '拉远' }], async (env0) => {
  env0.scene.add(label('tiny', 8, { x: 0, y: 0 }));
  env0.scene.getCamera().setView({ x: 0, y: 0, zoom: 1.4 });
  env0.scene.addUpdater((s, dt) => {
    const c = s.getCamera();
    c.zoom = c.zoom * (1 - 0.1 * dt);
  });
  await env0.wait(3);
});

/** 一个 400×400 的框围着读数;1.01 秒后 updater 把它缩成 60×20(边正好穿过读数)。 */
const shrinking = directedSegment('收框', 2, [{ start: 0.2, end: 1.9, text: '收框' }], async (env0) => {
  const box = new Rectangle(400, 400);
  const k = label('k = 1', 30, { x: 0, y: 0 });
  env0.scene.add(box, k);
  env0.scene.getCamera().setView({ x: 0, y: 0, zoom: 1 });
  let t = 0;
  env0.scene.addUpdater((_s, dt) => {
    t += dt;
    if (t > 1.01) {
      box.width = 60;
      box.height = 20;
    }
  });
  await env0.wait(2);
});

function issuesOf(report: FilmLayoutReport, kind: FilmLayoutIssue['kind'], segment?: string): FilmLayoutIssue[] {
  return report.issues.filter((i) => i.kind === kind && (segment === undefined || i.segment === segment));
}

function visual(fontPx: number): SubtitleVisual {
  return {
    fontPx,
    fontFamily: 'sans-serif',
    color: '#fff',
    background: '#000',
    padX: 16,
    padY: 6,
    radius: 8,
    lineHeight: 1.35,
    bottomPx: 36,
    maxWidthRatio: 0.8,
  };
}

export default suite('影片版面检查', [
  [
    '采样时刻:interval 的整数倍 + 段尾前一帧,与段尾太近的网格点并掉',
    () => {
      equal(layoutSampleTimes(2, 0.5, 1 / 30).map((t) => t.toFixed(3)).join(','), '0.500,1.000,1.500,1.967');
      equal(layoutSampleTimes(0.3, 0.5, 1 / 30).map((t) => t.toFixed(3)).join(','), '0.267');
      equal(layoutSampleTimes(1.51, 0.5, 1 / 30).map((t) => t.toFixed(3)).join(','), '0.500,1.000,1.500,1.477', '相差超过半帧:两帧都要');
      equal(layoutSampleTimes(1.52, 0.5, 1 / 30).map((t) => t.toFixed(3)).join(','), '0.500,1.000,1.487', '相差不到半帧:并掉');
    },
  ],
  [
    '变形变宽:竖屏出画一条 error(时刻落在变形之后、position = 段起点 + at),横屏没有',
    async () => {
      const segments = [crossFade, widening];
      const report = await checkFilmLayout(segments, { env });
      const out = issuesOf(report, 'out-of-frame', '变宽');
      equal(out.length, 1, JSON.stringify(out.map(formatLayoutIssueLine)));
      const issue = out[0];
      if (!issue) {
        return;
      }
      equal(issue.severity, 'error');
      equal(issue.viewport, PORTRAIT);
      ok(issue.from >= 1.5 && issue.from <= 2.01, `from ${issue.from}`);
      close(issue.to, 4 - 1 / 30, 1e-6);
      close(issue.position, 2.5 + issue.at, 1e-9);
      equal(issue.objects[0]?.label, 'Label「ABCDEFGHIJKLMNOPQRST」');
      ok(issue.hint.includes('fitExtra'));
      equal(report.issues.filter((i) => i.segment === '变宽' && i.viewport === LANDSCAPE && i.severity !== 'info').length, 0);
      equal(report.failures.length, 0);
      equal(report.segments.length, 4, '2 段 × 2 种画幅');
    },
  ],
  [
    '交叉淡化:只有 info 级的互压',
    async () => {
      const report = await checkFilmLayout([crossFade], { env });
      const overlaps = issuesOf(report, 'text-overlap');
      ok(overlaps.length > 0, '淡化途中应该记一条 info');
      ok(overlaps.every((i) => i.severity === 'info'), JSON.stringify(overlaps.map(formatLayoutIssueLine)));
      ok(overlaps.every((i) => i.motion.includes('fading')));
    },
  ],
  [
    '运镜:推近途中出画只算 info,停下后仍半截在边上 → error',
    async () => {
      const plan = planFilm([pushIn]);
      const seen: Array<{ at: number; severity: string; motion: string }> = [];
      await sampleSegmentLayout(pushIn, {
        env,
        index: 0,
        plan,
        viewport: LANDSCAPE,
        times: layoutSampleTimes(pushIn.duration, 0.5, 1 / 30),
        onSample: (s) => {
          for (const i of s.issues) {
            if (i.kind === 'out-of-frame' && i.items[0]?.label === 'Label「NEIGHBOR」') {
              seen.push({ at: s.at, severity: i.severity, motion: i.motion });
            }
          }
        },
      });
      ok(seen.length > 0);
      for (const s of seen) {
        if (s.at < 2.5 - 1e-6) {
          equal(s.motion, 'camera', `${s.at}s 应在运镜`);
          equal(s.severity, 'info');
        } else {
          equal(s.motion, 'still', `${s.at}s 应已停下`);
          equal(s.severity, 'error');
        }
      }
      ok(seen.some((s) => s.at < 2.5) && seen.some((s) => s.at >= 2.5), JSON.stringify(seen));
      const report = await checkFilmLayout([pushIn], { env, viewports: [LANDSCAPE] });
      const run = issuesOf(report, 'out-of-frame').find((i) => i.severity === 'error');
      ok(run, '停下之后的那段应聚合成 error');
      ok(run?.motion.includes('still'));
    },
  ],
  [
    '没字幕的段:贴底的字压在进度条上 → error;同样内容有字幕 → 没有遮挡问题',
    async () => {
      const bare = tallStack('没字幕', []);
      const subbed = tallStack('有字幕', [{ start: 0.2, end: 1.4, text: '有字幕' }]);
      const report = await checkFilmLayout([bare, subbed], { env, viewports: [LANDSCAPE] });
      const bar = issuesOf(report, 'under-progress-bar', '没字幕');
      equal(bar.length, 1);
      equal(bar[0]?.severity, 'error');
      equal(bar[0]?.objects[0]?.label, 'Label「BOTTOM」');
      equal(bar[0]?.zone?.label, '进度条');
      ok(bar[0]?.hint.includes('字幕'));
      equal(
        report.issues.filter((i) => i.segment === '有字幕' && (i.kind === 'under-progress-bar' || i.kind === 'under-subtitle')).length,
        0,
      );
    },
  ],
  [
    '字幕折行:竖屏 30 字 → subtitle-overflow/warning;压到的公式 → under-subtitle/error',
    async () => {
      const report = await checkFilmLayout([longCaption], { env });
      const overflow = issuesOf(report, 'subtitle-overflow');
      equal(overflow.length, 1, JSON.stringify(overflow.map(formatLayoutIssueLine)));
      equal(overflow[0]?.viewport, PORTRAIT);
      equal(overflow[0]?.severity, 'warning');
      ok((overflow[0]?.amount ?? 0) > 5, `越过 ${overflow[0]?.amount}`);
      close(overflow[0]?.from ?? -1, 0.2);
      close(overflow[0]?.to ?? -1, 1.9);
      const under = issuesOf(report, 'under-subtitle');
      equal(under.length, 1, JSON.stringify(under.map(formatLayoutIssueLine)));
      equal(under[0]?.viewport, PORTRAIT);
      equal(under[0]?.severity, 'error');
      equal(under[0]?.objects[0]?.label, 'Tex「x^2+y^2=z^2」');
    },
  ],
  [
    '扫描读数:沿刻度行持续压 → warning;一闪而过(单次采样、在移动)→ info',
    async () => {
      const report = await checkFilmLayout([readouts], { env, viewports: [LANDSCAPE] });
      const ticks = issuesOf(report, 'text-over-tick');
      const along = ticks.filter((i) => i.objects[0]?.label.startsWith('Label「k = '));
      ok(along.some((i) => i.severity === 'warning' && i.samples >= 2), JSON.stringify(ticks.map(formatLayoutIssueLine)));
      const across = ticks.filter((i) => i.objects[0]?.label.startsWith('Label「m = '));
      equal(across.length, 1, JSON.stringify(ticks.map(formatLayoutIssueLine)));
      equal(across[0]?.severity, 'info');
      equal(across[0]?.samples, 1);
      close(across[0]?.at ?? -1, 3.5, 1e-6);
    },
  ],
  [
    '聚合:持续 3 秒的互压合成 1 条,采样次数对,逐帧读数 labelChanged',
    async () => {
      const report = await checkFilmLayout([persistent], { env, viewports: [LANDSCAPE] });
      const overlaps = issuesOf(report, 'text-overlap');
      equal(overlaps.length, 1, JSON.stringify(overlaps.map(formatLayoutIssueLine)));
      const o = overlaps[0];
      equal(o?.severity, 'error');
      equal(o?.samples, 7);
      close(o?.from ?? -1, 0.5, 1e-6);
      close(o?.to ?? -1, 3.5 - 1 / 30, 1e-6);
      equal(o?.labelChanged, true);
      equal(o?.objects.length, 2);
      ok(JSON.stringify(report).length > 0, '报告可以 JSON 序列化');
    },
  ],
  [
    '字幕块几何与导出合成 drawSubtitle 画的底板一致(两种宽度、一行与两行)',
    () => {
      for (const width of [1280, 405]) {
        for (const text of ['一行字幕', '这一条字幕特别特别长,长到在竖屏里一定会折成两行,横屏里也许不会']) {
          const v = visual(width > 800 ? 20 : 14);
          const measure = createFakeCtx().ctx;
          const block = subtitleBlockRect(text, v, { width, height: 720 }, measure);
          const fake = createFakeCtx();
          compositeFrame(fake.ctx, width, 720, {
            main: createStubCanvas(),
            mainRect: { x: 0, y: 0, w: width, h: 720 },
            scale: 1,
            veilAlpha: 0,
            veilColor: '#fff',
            subtitle: { text, visual: v },
            progress: null,
          });
          const drawn = fake.calls.find((c) => c.op === 'roundRect');
          ok(block && drawn, '两边都应画出底板');
          if (!block || !drawn) {
            continue;
          }
          const [x, y, w, h] = drawn.args;
          close(block.rect.minX, x ?? NaN, 1e-9);
          close(block.rect.minY, y ?? NaN, 1e-9);
          close(block.rect.maxX - block.rect.minX, w ?? NaN, 1e-9);
          close(block.rect.maxY - block.rect.minY, h ?? NaN, 1e-9);
        }
      }
      equal(subtitleBlockRect('  ', visual(20), { width: 1280, height: 720 }, createFakeCtx().ctx), null);
      const zones = layoutZones({
        width: 400,
        height: 300,
        subtitle: { text: '字幕', visual: visual(20) },
        progress: { position: 'top', blockPx: 18 },
        measure: createFakeCtx().ctx,
      });
      equal(zones.map((z) => z.kind).join(','), 'progress-bar,subtitle');
      equal(zones[0]?.rect.maxY, 18, '贴顶的进度条在上边');
    },
  ],
  [
    '安全区口径:采样时给分段的上下文与播放器一致(固定视口、字幕安全区)',
    async () => {
      const recorded: SegmentContext[] = [];
      const spy = (seg: Segment): Segment => ({
        ...seg,
        play(canvas, context) {
          if (context) {
            recorded.push(context);
          }
          return seg.play(canvas, context);
        },
      });
      const bare = tallStack('没字幕', []);
      const segments = [spy(crossFade), spy(bare)];
      await checkFilmLayout(segments, { env, interval: 1 });
      const plan = planFilm(segments);
      equal(recorded.length, 4);
      for (const [i, vp] of [
        [0, LANDSCAPE],
        [1, PORTRAIT],
      ] as const) {
        const c = recorded[i];
        equal(c?.viewport?.width, vp.width);
        equal(c?.viewport?.height, vp.height);
        equal(c?.safeArea?.bottom, subtitleSafeBottom(resolveSubtitleVisual(vp.width, undefined, plan, 'sans-serif')));
        ok(c?.clock instanceof ManualClock);
      }
      equal(recorded[2]?.safeArea, undefined, '没字幕的段不给安全区');
      const off: SegmentContext[] = [];
      await checkFilmLayout([spy(crossFade)], { env, interval: 1, viewports: [LANDSCAPE], film: { subtitles: false } });
      off.push(...recorded.slice(4));
      equal(off[0]?.safeArea, undefined, '关了字幕也不给安全区');
    },
  ],
  [
    'inspectFrameAt 与 previewFrameAt 定位一致、画进给的画布;inspectFilmFrames 按传入顺序返回、同一段只挂一次',
    async () => {
      const plays = new Map<string, number>();
      const count = (seg: Segment): Segment => ({
        ...seg,
        play(canvas, context) {
          plays.set(seg.name, (plays.get(seg.name) ?? 0) + 1);
          return seg.play(canvas, context);
        },
      });
      const segments = [count(crossFade), count(widening)];
      const canvas = createStubCanvas();
      const before = canvas.ops.length;
      const one = await inspectFrameAt(segments, 5.5, { env, canvas, viewport: PORTRAIT });
      ok(canvas.ops.length > before, '给的画布收到了绘制');
      const preview = await previewFrameAt(segments, 5.5, createStubCanvas());
      equal(one.index, preview.index);
      equal(one.offset, preview.offset);
      equal(one.name, preview.name);
      equal(one.subtitle, preview.subtitle);
      equal(one.position, preview.position);
      ok(one.issues.some((i) => i.kind === 'out-of-frame' && i.severity === 'error'), '竖屏 3 秒处应该出画');
      let direct: LayoutSample | null = null;
      await sampleSegmentLayout(widening, {
        env,
        index: 1,
        plan: planFilm(segments),
        viewport: PORTRAIT,
        times: [3],
        onSample: (s) => {
          direct = s;
        },
      });
      const d = direct as LayoutSample | null;
      equal(one.issues.map((i) => i.message).join('|'), d?.issues.map((i) => i.message).join('|'));
      plays.clear();
      const order: number[] = [];
      const frames = await inspectFilmFrames(segments, [4.5, 1, 3.5, 2], {
        env,
        viewport: LANDSCAPE,
        onFrame: (_s, i) => {
          order.push(i);
        },
      });
      equal(frames.samples.map((f) => f?.position.toFixed(2)).join(','), '4.50,1.00,3.50,2.00');
      equal(frames.failures.length, 0);
      equal(frames.aborted, false);
      equal(plays.get('交叉淡化'), 1);
      equal(plays.get('变宽'), 1);
      equal(order.join(','), '1,3,2,0', '每段按时刻顺序出帧');
    },
  ],
  [
    '度量补丁:检查期间 Label 按估算量,结束后(包括分段抛错)恢复',
    async () => {
      const original = Label.prototype.getBox;
      let during = false;
      const boom: Segment = {
        name: '起播就抛',
        duration: 1,
        play() {
          throw new Error('坏了');
        },
      };
      const report = await checkFilmLayout([boom, tallStack('没字幕', [])], {
        env,
        viewports: [LANDSCAPE],
        onProgress: () => {
          during ||= estimatedTextMetricsInstalled();
        },
      });
      ok(during, '检查期间应装着估算度量');
      ok(!estimatedTextMetricsInstalled());
      equal(Label.prototype.getBox, original);
      equal(report.failures.length, 1);
      ok(report.failures[0]?.error.includes('起播抛错'));
    },
  ],
  [
    '失败路径:起播抛错、done reject 都进 failures,不影响别的段',
    async () => {
      const boom: Segment = {
        name: '起播就抛',
        duration: 1,
        play() {
          throw new Error('坏了');
        },
      };
      const rejects = directedSegment('中途出错', 1.5, [{ start: 0.2, end: 1.4, text: '出错' }], async (env0) => {
        stage(env0.scene, [label('X', 30)], 30);
        await env0.wait(0.6);
        throw new Error('脚本出错');
      });
      const report = await checkFilmLayout([boom, rejects, tallStack('没字幕', [])], { env, viewports: [LANDSCAPE] });
      equal(report.failures.length, 2, JSON.stringify(report.failures));
      ok(report.failures.some((f) => f.segment === '中途出错' && f.error.includes('脚本出错')));
      ok(issuesOf(report, 'under-progress-bar', '没字幕').length === 1, '后面的段照样查');
    },
  ],
  [
    '报告格式:分段名、画幅、类别中文名、时间段、预览地址;没注册时占位;minSeverity 生效',
    async () => {
      const report = await checkFilmLayout([crossFade, widening], { env });
      const text = formatLayoutReport(report, { film: '样片', sceneKey: 'demo' });
      ok(text.includes('《样片》'));
      ok(text.includes('#1 变宽'));
      ok(text.includes('[竖屏 405×720] 文字出画'));
      ok(/\/\?scene=demo&preview=\d/.test(text), text);
      ok(/&preview=[\d.]+&aspect=w9h16/.test(text), '竖屏问题的地址应带 &aspect=w9h16');
      ok(!text.includes('先点 9:16'));
      ok(!text.includes('文字互压'), '缺省不显示 info');
      const all = formatLayoutReport(report, { sceneKey: null, minSeverity: 'info' });
      ok(all.includes('文字互压'));
      ok(all.includes('<场景键>'));
      ok(all.includes('还没在 src/sceneRegistry.ts 注册'));
      const errorsOnly = formatLayoutReport(report, { sceneKey: 'demo', minSeverity: 'error' });
      ok(errorsOnly.includes('文字出画'));
      const line = formatLayoutIssueLine(issuesOf(report, 'out-of-frame')[0] as FilmLayoutIssue);
      ok(line.startsWith('[竖屏 405×720] 文字出画 '), line);
    },
  ],
  [
    'checkHandleLayout:挂着的句柄上查当前帧;动画进行中不给时钟截不到',
    async () => {
      const clock = new ManualClock();
      const plan = planFilm([persistent]);
      const handle = persistent.play(createStubCanvas(), {
        clock,
        viewport: { width: 1280, height: 720, pixelRatio: 1 },
        safeArea: { bottom: subtitleSafeBottom(resolveSubtitleVisual(1280, undefined, plan, 'sans-serif')) },
      });
      try {
        await fastForwardTo(handle, clock, 1);
        equal(checkHandleLayout(handle, { width: 1280, height: 720 }), null, '帧泵在跑时 render() 不当场画');
        const r = checkHandleLayout(handle, {
          width: 1280,
          height: 720,
          clock,
          subtitle: { text: '持续', visual: resolveSubtitleVisual(1280, undefined, plan, 'sans-serif') },
          progress: { position: 'bottom', blockPx: plan.barBlockPx },
        });
        ok(r, '给了时钟就截得到');
        ok(r?.issues.some((i) => i.kind === 'text-overlap'));
        equal(r?.zones.length, 2);
      } finally {
        handle.dispose();
      }
    },
  ],
  [
    'inspectFilmFrames:某段起播抛错时结果仍与 positions 一一对应,原因进 failures;inspectFrameAt 抛出真实原因',
    async () => {
      const broken: Segment = {
        name: 'BROKEN',
        duration: 2,
        play() {
          throw new Error('boom');
        },
      };
      const a = tallStack('A', [{ start: 0.2, end: 1.4, text: 'A' }]);
      const c = tallStack('C', [{ start: 0.2, end: 1.4, text: 'C' }]);
      const segments = [a, broken, c];
      // 起点 0、1.5、3.5:三个时刻各在一段的 1 秒处。
      const result = await inspectFilmFrames(segments, [1, 2.5, 4.5], { env, viewport: LANDSCAPE });
      equal(result.samples.length, 3);
      equal(result.samples.map((x) => x?.segment ?? null).join(','), 'A,,C');
      equal(result.samples[1], null);
      equal(result.failures.length, 1, JSON.stringify(result.failures));
      equal(result.failures[0]?.order, 1);
      equal(result.failures[0]?.segment, 'BROKEN');
      ok(result.failures[0]?.error.includes('boom'), result.failures[0]?.error);
      equal(result.aborted, false);
      let message = '';
      try {
        await inspectFrameAt(segments, 2.5, { env, viewport: LANDSCAPE });
      } catch (e) {
        message = e instanceof Error ? e.message : String(e);
      }
      ok(message.includes('boom') && message.includes('BROKEN'), message);
      // 脚本 0.6 秒抛错:之前的帧照常,之后的帧还截得到(停在出错那一刻),但记为出错。
      const rejects = directedSegment('中途出错', 1.5, [{ start: 0.2, end: 1.4, text: '出错' }], async (env0) => {
        stage(env0.scene, [label('X', 30)], 30);
        await env0.wait(0.6);
        throw new Error('脚本出错');
      });
      const mid = await inspectFilmFrames([rejects], [0.3, 1.2], { env, viewport: LANDSCAPE });
      ok(mid.samples[0] && mid.samples[1], '两帧都截得到');
      equal(mid.failures.map((f) => f.order).join(','), '1', JSON.stringify(mid.failures));
      ok(mid.failures[0]?.error.includes('脚本出错'));
    },
  ],
  [
    '叫停:checkFilmLayout 与 inspectFilmFrames 都带 aborted,报告里说明只查了一半',
    async () => {
      let calls = 0;
      const report = await checkFilmLayout([persistent, crossFade], {
        env,
        shouldAbort: () => ++calls > 3,
      });
      equal(report.aborted, true);
      ok(report.segments.length <= 1, `只查到一半:${report.segments.length}`);
      equal(report.failures.length, 0);
      const text = formatLayoutReport(report, { sceneKey: 'x' });
      ok(text.includes('叫停'), text);
      ok(!text.includes('✓ 没有发现'), text);
      const full = await checkFilmLayout([crossFade], { env, viewports: [LANDSCAPE] });
      equal(full.aborted, false);
      let n = 0;
      const frames = await inspectFilmFrames([persistent, crossFade], [1, 4], {
        env,
        viewport: LANDSCAPE,
        shouldAbort: () => ++n > 3,
      });
      equal(frames.aborted, true);
      equal(frames.samples.length, 2);
      equal(frames.samples[1], null, '没轮到的时刻为 null');
      equal(frames.failures.length, 0, '叫停不算失败');
    },
  ],
  [
    '缺省画幅是成片的 1280×720,不按画布的 css 尺寸排版;缩略图按 pixelRatio 出小图',
    async () => {
      const thumb = Object.assign(createStubCanvas(), { clientWidth: 160, clientHeight: 90 });
      const plain = await inspectFilmFrames([crossFade], [1], { env, canvas: thumb });
      equal(plain.samples[0]?.viewport.width, 1280);
      equal(plain.samples[0]?.frame.viewport.w, 1280);
      const small = Object.assign(createStubCanvas(), { clientWidth: 160, clientHeight: 90 });
      const scaled = await inspectFilmFrames([crossFade], [1], {
        env,
        canvas: small,
        viewport: { width: 1280, height: 720, pixelRatio: 160 / 1280 },
      });
      equal(scaled.samples[0]?.frame.viewport.w, 1280, '问题坐标仍在成片画幅里');
      equal(small.width, 160, 'backing store 是缩略图大小');
      equal(small.height, 90);
    },
  ],
  [
    '长时间运镜:互压与机位无关照报 error;一直半截在画外的字不当瞬态,封顶 warning',
    async () => {
      const report = await checkFilmLayout([slowPan], { env, viewports: [LANDSCAPE] });
      const overlaps = issuesOf(report, 'text-overlap');
      equal(overlaps.length, 1, JSON.stringify(overlaps.map(formatLayoutIssueLine)));
      equal(overlaps[0]?.severity, 'error');
      equal(overlaps[0]?.motion.join(','), 'still');
      const edge = issuesOf(report, 'out-of-frame').filter((i) => i.objects[0]?.label === 'Label「EDGE LABEL」');
      equal(edge.length, 1, JSON.stringify(edge.map(formatLayoutIssueLine)));
      equal(edge[0]?.severity, 'warning');
      ok(edge[0]?.motion.includes('camera'));
      // 对照:运镜不到一秒(推近 2 秒、落在 3 次采样里)的途中出画仍只是瞬态。
      const push = await checkFilmLayout([pushIn], { env, viewports: [LANDSCAPE] });
      const transient = issuesOf(push, 'out-of-frame').filter((i) => i.motion.every((m) => m === 'camera'));
      ok(transient.every((i) => i.severity === 'info'), JSON.stringify(transient.map(formatLayoutIssueLine)));
    },
  ],
  [
    '预览地址与显示的时刻钳在段内:只在段尾前一帧出现的问题不会链到下一段',
    async () => {
      const segments = [lateOverlap, crossFade];
      const plan = planFilm(segments);
      const report = await checkFilmLayout(segments, { env, viewports: [LANDSCAPE] });
      const late = issuesOf(report, 'text-overlap', '末帧互压');
      equal(late.length, 1, JSON.stringify(late.map(formatLayoutIssueLine)));
      const issue = late[0] as FilmLayoutIssue;
      close(issue.at, 2.3 - 1 / 30, 1e-6);
      equal(issue.segmentStart, 0);
      equal(issue.segmentDuration, 2.3);
      const seconds = layoutPreviewSeconds(issue);
      ok(seconds < 2.3, `${seconds}`);
      equal(segmentAtTime(segments, plan.starts, plan.total, seconds).index, 0);
      equal(layoutPreviewUrl(issue, 'x'), '/?scene=x&preview=2.27');
      // 竖屏的问题:地址里带上画幅,打开就是 9:16。
      equal(
        layoutPreviewUrl({ ...issue, viewport: { width: 405, height: 720, label: '竖屏 405×720' } }, 'x'),
        '/?scene=x&preview=2.27&aspect=w9h16',
      );
      const text = formatLayoutReport(report, { sceneKey: 'x' });
      ok(text.includes('最严重在段内 2.27s'), text);
      ok(!text.includes('段内 2.3s'), text);
      ok(formatLayoutIssueLine(issue).includes(' 2.27s:'), formatLayoutIssueLine(issue));
      // 起点小数多于两位:往里进一格;段尾:往回退。
      equal(layoutPreviewSeconds({ at: 0, segmentStart: 5.0333, segmentDuration: 2 }), 5.04);
      equal(layoutPreviewSeconds({ at: 1.998, segmentStart: 0, segmentDuration: 2 }), 1.99);
      equal(layoutPreviewSeconds({ at: 0.5, segmentStart: 3, segmentDuration: 2 }), 3.5);
    },
  ],
  [
    '字太小:量值越大越严重,拉远镜头时报的是最小的那一帧',
    async () => {
      const report = await checkFilmLayout([zoomOut], { env, viewports: [LANDSCAPE] });
      const small = issuesOf(report, 'text-too-small');
      equal(small.length, 1, JSON.stringify(small.map(formatLayoutIssueLine)));
      const issue = small[0] as FilmLayoutIssue;
      close(issue.at, 3 - 1 / 30, 1e-6, `最严重应在段尾:${issue.at}`);
      const minPx = report.segments[0]?.minTextPx ?? NaN;
      close(issue.objects[0]?.fontPx ?? NaN, minPx, 1e-9);
      ok(issue.message.includes(`${minPx.toFixed(1)} px`), `${issue.message} / ${minPx}`);
      close(issue.amount, 12 - minPx, 1e-9);
    },
  ],
  [
    '线条命中用采样那一刻的路径:看运动的前瞻里图形变了,不影响这一帧的结论',
    async () => {
      const plan = planFilm([shrinking]);
      const seen: string[] = [];
      await sampleSegmentLayout(shrinking, {
        env,
        index: 0,
        plan,
        viewport: LANDSCAPE,
        times: [1, 1.5],
        check: { strokes: true },
        onSample: (s) => {
          const box = s.frame.items.find((i) => i.label === 'Rectangle');
          const w = box ? box.rect.maxX - box.rect.minX : NaN;
          const crossed = s.issues.some((i) => i.kind === 'text-over-stroke');
          seen.push(`${s.at.toFixed(2)}:${Math.round(w)}:${crossed}`);
        },
      });
      equal(seen.join(' '), '1.00:400:false 1.50:60:true', '1 秒那帧框还是 400 宽、没穿过读数;1.5 秒缩了才穿过');
    },
  ],
  [
    '冒烟:拓扑片跑完,「紧致性」的交叉淡化没有 info 以上的互压',
    async () => {
      const report = await checkFilmLayout(topologyFilm, { env });
      equal(report.failures.length, 0, JSON.stringify(report.failures));
      const compact = report.issues.filter((i) => i.segment === '紧致性' && i.kind === 'text-overlap');
      ok(compact.every((i) => i.severity === 'info'), JSON.stringify(compact.map(formatLayoutIssueLine)));
      equal(report.segments.length, topologyFilm.length * 2);
    },
  ],
]);
