import { close, equal, ok, suite } from '../../testing/harness';
import { Axes } from '../mobjects/graphs';
import type { MObject } from '../mobjects/MObject';
import { Circle, Label, Line } from '../mobjects/shapes';
import type { Bounds } from '../mobjects/types';
import { Scene } from '../scene/Scene';
import { createStubCanvas } from '../../testing/domStub';
import type { LayoutFrame, LayoutItem } from './inspect';
import { layoutObjectId } from './inspect';
import { findLayoutIssues, findSceneLayoutIssues } from './issues';
import type { LayoutZone } from './issues';

/** 400×300 视口,机位让世界坐标 = 屏幕坐标(线条命中检查也走同一套换算)。 */
const VIEW = { x: 200, y: 150, zoom: 1 };

function rect(minX: number, minY: number, maxX: number, maxY: number): Bounds {
  return { minX, minY, maxX, maxY };
}

function item(
  object: MObject,
  r: Bounds,
  o?: Partial<Pick<LayoutItem, 'kind' | 'part' | 'opacity' | 'reveal' | 'fontPx' | 'label' | 'text'>>,
): LayoutItem {
  const id = String(layoutObjectId(object));
  const kind = o?.kind ?? 'text';
  return {
    key: o?.part ? `${id}:${o.part}` : id,
    objectKey: id,
    object,
    ...(o?.part ? { part: o.part } : {}),
    kind,
    label: o?.label ?? (object instanceof Label ? `Label「${object.text}」` : object.constructor.name),
    ...(o?.text !== undefined ? { text: o.text } : object instanceof Label ? { text: object.text } : {}),
    rect: r,
    ink: r,
    world: r,
    opacity: o?.opacity ?? 1,
    reveal: o?.reveal ?? 1,
    fontPx: o?.fontPx ?? (kind === 'graphic' ? 0 : 20),
    transform: { x: 0, y: 0, rotation: 0, scale: 1 },
    ...(kind === 'graphic' ? { path: object.toPath() } : {}),
  };
}

function frame(items: LayoutItem[], view = VIEW): LayoutFrame {
  return { viewport: { w: 400, h: 300 }, view, items };
}

function text(s: string, r: Bounds, o?: Parameters<typeof item>[2]): LayoutItem {
  return item(new Label(s), r, o);
}

export default suite('版面检查 · 规则', [
  [
    '出画:0.5 px 不报;3 px 且露 95% → warning;10 px → error;露 < 90% → error;整个在外 → offscreen/info;刻度 → warning',
    () => {
      equal(findLayoutIssues(frame([text('a', rect(-0.5, 10, 99.5, 30))])).length, 0);
      const small = findLayoutIssues(frame([text('a', rect(-3, 10, 97, 30))]));
      equal(small.length, 1);
      equal(small[0]?.kind, 'out-of-frame');
      equal(small[0]?.severity, 'warning');
      close(small[0]?.amount ?? 0, 3);
      ok(small[0]?.message.includes('左边'), small[0]?.message);
      equal(findLayoutIssues(frame([text('a', rect(390, 10, 410, 30))]))[0]?.severity, 'error', '越出 10 px');
      equal(findLayoutIssues(frame([text('a', rect(10, -5, 30, 30))]))[0]?.severity, 'error', '只露 86%');
      const off = findLayoutIssues(frame([text('a', rect(500, 10, 520, 30))]));
      equal(off[0]?.kind, 'offscreen');
      equal(off[0]?.severity, 'info');
      const axes = new Axes([0, 1], [0, 1], 10, 10);
      const tick = item(axes, rect(390, 10, 410, 22), { kind: 'tick-label', part: 'x:1', text: '1', fontPx: 10 });
      equal(findLayoutIssues(frame([tick]))[0]?.severity, 'warning', '刻度数字出画一律 warning');
      const region = small[0]?.region;
      ok(region && region.minX === 0 && region.maxX === 97, 'region 是露在画里的部分');
    },
  ],
  [
    '互压:3×3 → error;2×10 → 不报;任一方不透明度 0.3 → warning;同一对象的两块不报',
    () => {
      const hit = findLayoutIssues(frame([text('a', rect(10, 10, 50, 30)), text('b', rect(47, 27, 90, 60))]));
      equal(hit.length, 1);
      equal(hit[0]?.kind, 'text-overlap');
      equal(hit[0]?.severity, 'error');
      equal(hit[0]?.items.length, 2);
      ok(hit[0]?.message.includes('互压'));
      equal(findLayoutIssues(frame([text('a', rect(10, 10, 50, 30)), text('b', rect(48, 10, 90, 30))])).length, 0);
      const dim = findLayoutIssues(frame([text('a', rect(10, 10, 50, 30)), text('b', rect(20, 10, 60, 30), { opacity: 0.3 })]));
      equal(dim[0]?.severity, 'warning');
      // 行框碰上了、墨迹没碰上(贴得近但没压上):按墨迹盒判,不报。
      const upper = { ...text('a', rect(10, 10, 60, 40)), ink: rect(10, 14, 60, 36) };
      const lower = { ...text('b', rect(10, 37, 60, 67)), ink: rect(10, 41, 60, 63) };
      equal(findLayoutIssues(frame([upper, lower])).length, 0, '墨迹没碰上不报');
      const same = new Label('x');
      equal(findLayoutIssues(frame([item(same, rect(10, 10, 50, 30)), item(same, rect(20, 10, 60, 30), { part: 'p' })])).length, 0);
    },
  ],
  [
    '压刻度:一条公式压 3 个刻度 → 1 条问题,ticks 三个,region 为并集,warning',
    () => {
      const axes = new Axes([0, 3], [0, 1], 100, 50);
      const t = (s: string, x: number): LayoutItem =>
        item(axes, rect(x, 100, x + 10, 112), { kind: 'tick-label', part: `x:${s}`, text: s, fontPx: 10 });
      const formula = text('f', rect(0, 105, 200, 130));
      const issues = findLayoutIssues(frame([formula, t('1', 20), t('2', 60), t('3', 100), t('9', 300)]));
      equal(issues.length, 1);
      const i = issues[0];
      equal(i?.kind, 'text-over-tick');
      equal(i?.severity, 'warning');
      equal(i?.ticks?.join(','), '1,2,3');
      ok(i?.region.minX === 20 && i.region.maxX === 110 && i.region.minY === 105 && i.region.maxY === 112);
      ok(i?.message.includes('刻度 1、2、3'), i?.message);
    },
  ],
  [
    '遮挡区:文字进字幕区 → error;刻度 → warning;线穿过进度条 → info;图形外接盒碰到但线没进 → 不报',
    () => {
      const sub: LayoutZone = { kind: 'subtitle', label: '字幕条', rect: rect(50, 240, 350, 270) };
      const bar: LayoutZone = { kind: 'progress-bar', label: '进度条', rect: rect(0, 282, 400, 300) };
      const zones = [sub, bar];
      const t = findLayoutIssues(frame([text('a', rect(100, 230, 200, 250))]), { zones });
      equal(t[0]?.kind, 'under-subtitle');
      equal(t[0]?.severity, 'error');
      equal(t[0]?.zone?.kind, 'subtitle');
      ok(t[0]?.message.includes('字幕条'));
      const axes = new Axes([0, 1], [0, 1], 10, 10);
      const tick = findLayoutIssues(frame([item(axes, rect(100, 285, 110, 297), { kind: 'tick-label', part: 'x:0', text: '0', fontPx: 10 })]), { zones });
      equal(tick[0]?.kind, 'under-progress-bar');
      equal(tick[0]?.severity, 'warning');
      // 一条从 (10, 250) 到 (390, 295) 的斜线穿过进度条。
      const line = new Line({ x: 10, y: 250 }, { x: 390, y: 295 });
      const crossing = findLayoutIssues(frame([item(line, rect(10, 250, 390, 295), { kind: 'graphic' })]), { zones: [bar] });
      equal(crossing.length, 1);
      equal(crossing[0]?.severity, 'info');
      // 圆的外接盒碰到进度条一角,但圆周没进去。
      const circle = new Circle(40);
      const ring = item(circle, rect(-40, 245, 40, 325), { kind: 'graphic' });
      const ringFrame = frame([{ ...ring, transform: { x: 0, y: 285, rotation: 0, scale: 1 } }], { x: 200, y: 150, zoom: 1 });
      const cornerZone: LayoutZone = { kind: 'progress-bar', label: '进度条', rect: rect(35, 248, 60, 255) };
      equal(findLayoutIssues(ringFrame, { zones: [cornerZone] }).length, 0, '线没进遮挡区不报');
    },
  ],
  [
    '字太小:11 px 文字 → warning;5 px 刻度 → 同一坐标轴一条;minTextPx: 0 关闭',
    () => {
      const axes = new Axes([0, 3], [0, 1], 100, 50);
      const ticks = ['0', '1', '2'].map((s, k) =>
        item(axes, rect(20 + k * 30, 100, 26 + k * 30, 106), { kind: 'tick-label', part: `x:${s}`, text: s, fontPx: 5 }),
      );
      const small = text('小字', rect(200, 10, 222, 21), { fontPx: 11 });
      const issues = findLayoutIssues(frame([small, ...ticks]));
      equal(issues.filter((i) => i.kind === 'text-too-small').length, 2);
      const tickIssue = issues.find((i) => i.ticks !== undefined);
      equal(tickIssue?.ticks?.length, 3);
      equal(tickIssue?.severity, 'warning');
      close(tickIssue?.amount ?? NaN, 1, 1e-9, '刻度量值 = 下限 6 − 5');
      // 越小越严重:量值是「差下限多少」,两块小字里 9 px 的排在 11 px 前面。
      const smaller = text('更小', rect(200, 40, 218, 49), { fontPx: 9 });
      const both = findLayoutIssues(frame([small, smaller])).filter((i) => i.kind === 'text-too-small');
      equal(both.map((i) => i.items[0]?.label).join(','), 'Label「更小」,Label「小字」');
      close(both[0]?.amount ?? NaN, 3, 1e-9);
      ok(both[0]?.message.includes('9.0 px'), both[0]?.message);
      equal(findLayoutIssues(frame([small]), { minTextPx: 0 }).length, 0);
      equal(findLayoutIssues(frame([text('ok', rect(0, 0, 20, 12), { fontPx: 12 })])).length, 0, '12 px 不报');
    },
  ],
  [
    '线穿文字:缺省不查;打开后穿过 → info;只擦到文字盒外缘不报',
    () => {
      const label = text('k = 1', rect(100, 100, 200, 120));
      const through = new Line({ x: 90, y: 110 }, { x: 210, y: 110 });
      const graze = new Line({ x: 90, y: 101 }, { x: 210, y: 101 });
      const items = [label, item(through, rect(90, 110, 210, 110), { kind: 'graphic' })];
      equal(findLayoutIssues(frame(items)).length, 0);
      const on = findLayoutIssues(frame(items), { strokes: true });
      equal(on.length, 1);
      equal(on[0]?.kind, 'text-over-stroke');
      equal(on[0]?.severity, 'info');
      equal(findLayoutIssues(frame([label, item(graze, rect(90, 101, 210, 101), { kind: 'graphic' })]), { strokes: true }).length, 0);
    },
  ],
  [
    '运动:镜头平移 → camera/info;不透明度变 → fading/info;只位移 → moving 保留级别;下一帧没了 → fading',
    () => {
      const a = text('a', rect(390, 10, 420, 30));
      const cur = frame([a]);
      const panned = findLayoutIssues(cur, { next: frame([a], { x: 210, y: 150, zoom: 1 }) });
      equal(panned[0]?.motion, 'camera');
      equal(panned[0]?.severity, 'info');
      const faded = findLayoutIssues(cur, { next: frame([{ ...a, opacity: 0.9 }]) });
      equal(faded[0]?.motion, 'fading');
      equal(faded[0]?.severity, 'info');
      equal(panned[0]?.baseSeverity, 'error', '降级前的级别留着');
      const moved = findLayoutIssues(cur, { next: frame([{ ...a, rect: rect(392, 10, 422, 30), world: rect(392, 10, 422, 30) }]) });
      equal(moved[0]?.motion, 'moving');
      equal(moved[0]?.severity, 'error');
      const gone = findLayoutIssues(cur, { next: frame([]) });
      equal(gone[0]?.motion, 'fading');
      const still = findLayoutIssues(cur, { next: frame([a]) });
      equal(still[0]?.motion, 'still');
      equal(still[0]?.severity, 'error');
    },
  ],
  [
    '运动:互压 / 压刻度与机位无关 —— 镜头在动也照报;只看两块东西自己在世界里动没动',
    () => {
      const shift = (i: LayoutItem, dx: number): LayoutItem => ({
        ...i,
        rect: rect(i.rect.minX - dx, i.rect.minY, i.rect.maxX - dx, i.rect.maxY),
      });
      const a = text('a', rect(10, 10, 50, 30));
      const b = text('b', rect(40, 10, 90, 30));
      const axes = new Axes([0, 3], [0, 1], 100, 50);
      const tick = item(axes, rect(60, 25, 70, 37), { kind: 'tick-label', part: 'x:1', text: '1', fontPx: 10 });
      // 镜头右移 10(世界不动,屏幕盒整体左移 10)。
      const next = frame([shift(a, 10), shift(b, 10), shift(tick, 10)], { x: 210, y: 150, zoom: 1 });
      const issues = findLayoutIssues(frame([a, b, tick]), { next });
      const overlap = issues.find((i) => i.kind === 'text-overlap');
      equal(overlap?.motion, 'still');
      equal(overlap?.severity, 'error', '运镜挪不开互压');
      const onTick = issues.find((i) => i.kind === 'text-over-tick');
      equal(onTick?.motion, 'still');
      equal(onTick?.severity, 'warning');
      // 对照:出画这种跟机位有关的照样按运镜降级。
      const edge = text('edge', rect(380, 50, 420, 70));
      const out = findLayoutIssues(frame([edge]), { next: frame([shift(edge, 10)], { x: 210, y: 150, zoom: 1 }) });
      equal(out[0]?.motion, 'camera');
      equal(out[0]?.severity, 'info');
      // 一块字在世界里动了:moving,级别保留。
      const bMoved = { ...b, world: rect(43, 10, 93, 30) };
      const moving = findLayoutIssues(frame([a, b]), { next: frame([a, bMoved], { x: 210, y: 150, zoom: 1 }) });
      equal(moving[0]?.motion, 'moving');
      equal(moving[0]?.severity, 'error');
      // 淡入淡出照样判。
      const fading = findLayoutIssues(frame([a, b]), { next: frame([a, { ...b, opacity: 0.8 }]) });
      equal(fading[0]?.motion, 'fading');
      equal(fading[0]?.severity, 'info');
    },
  ],
  [
    '排序:级别降序、再按量值;视口为 0 返回 [];findSceneLayoutIssues 走场景',
    () => {
      const issues = findLayoutIssues(frame([
        text('info', rect(600, 10, 620, 30)),
        text('warn', rect(-3, 50, 97, 70)),
        text('err1', rect(390, 100, 420, 120)),
        text('err2', rect(380, 200, 450, 220)),
      ]));
      equal(issues.map((i) => i.severity).join(','), 'error,error,warning,info');
      ok((issues[0]?.amount ?? 0) > (issues[1]?.amount ?? 0));
      equal(findLayoutIssues({ viewport: { w: 0, h: 0 }, view: VIEW, items: [text('a', rect(0, 0, 10, 10))] }).length, 0);
      const scene = new Scene(createStubCanvas(), { viewport: { width: 400, height: 300 } });
      const l = new Label('出画的字').setStyle({ fontSize: 20 });
      l.moveTo({ x: 200, y: 0 });
      scene.add(l);
      const found = findSceneLayoutIssues(scene);
      equal(found[0]?.kind, 'out-of-frame');
      scene.dispose();
      equal(findSceneLayoutIssues(scene).length, 0);
    },
  ],
]);
