import { installAssetStub } from '../../testing/assetStub';
import { close, equal, fakeCtx, ok, stateAt, suite, throws } from '../../testing/harness';
import type { FakeCtxCall } from '../../testing/harness';
import { ColorTo } from '../animations/styleTween';
import { Create } from '../animations/primitives';
import { Transform } from '../animations/transform';
import { Write } from '../animations/write';
import { AssetError } from '../assets/errors';
import { loadSvg } from '../assets/registry';
import { pathBounds } from '../path/path';
import { lightTheme } from '../theme/presets';
import { worldBoundsInScene } from './bounds';
import { Group } from './Group';
import type { MObject } from './MObject';
import { Illustration, SvgGroup, SvgPart } from './illustration';
import { Circle } from './shapes';

const CAR = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 50">
  <rect id="body" class="panel" x="0" y="0" width="60" height="30" fill="#e11d48" stroke="#111111" stroke-width="2"/>
  <g id="wheel" class="round">
    <circle id="tire" cx="20" cy="40" r="10" fill="currentColor"/>
    <circle cx="20" cy="40" r="4" fill="none" stroke="currentColor"/>
  </g>
  <path id="road" d="M0 50 H100" fill="none" stroke="#333333" stroke-linecap="round"/>
</svg>`;

function draw(m: MObject): FakeCtxCall[] {
  const { ctx, calls } = fakeCtx();
  m.render(ctx, lightTheme);
  return calls;
}

function count(calls: readonly FakeCtxCall[], op: string): number {
  return calls.filter((c) => c.op === op).length;
}

function part(illo: Illustration, id: string): SvgPart {
  const p = illo.part(id);
  ok(p instanceof SvgPart, `${id} 应当是形状部件`);
  return p as SvgPart;
}

/** 单独画一个部件(不带插画的变换),返回调用记录。 */
function drawPart(p: SvgPart): FakeCtxCall[] {
  const saved = { ...p.position };
  p.position = { x: 0, y: 0 };
  try {
    return draw(p);
  } finally {
    p.position = saved;
  }
}

function sameCalls(a: readonly FakeCtxCall[], b: readonly FakeCtxCall[]): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export default suite('Illustration SVG 插画', [
  [
    '尺寸:viewBox + width 等比;几何烘焙成世界单位,原点是画板中心;线宽跟着缩放',
    () => {
      const illo = new Illustration(CAR, { width: 300 });
      equal(`${illo.width}x${illo.height}`, '300x150');
      equal(`${illo.naturalWidth}x${illo.naturalHeight}`, '100x50');
      equal(`${illo.getBox().size.w}x${illo.getBox().size.h}`, '300x150');
      const body = part(illo, 'body');
      close(body.position.x, -60);
      close(body.position.y, -30);
      const b = worldBoundsInScene([illo], [body]);
      close(b?.minX ?? NaN, -150);
      close(b?.minY ?? NaN, -75);
      close(b?.maxX ?? NaN, 30);
      close(b?.maxY ?? NaN, 15);
      equal(body.getStyle(lightTheme).strokeWidth, 6);
    },
  ],
  [
    '尺寸:只给 height、contain、fill;画板为 0 时按那一边缩放抛错;参数校验',
    () => {
      const h = new Illustration(CAR, { height: 75 });
      equal(`${h.width}x${h.height}`, '150x75');
      const contain = new Illustration(CAR, { width: 300, height: 100 });
      equal(`${contain.width}x${contain.height}`, '200x100');
      const fill = new Illustration(CAR, { width: 300, height: 300, fit: 'fill' });
      equal(`${fill.width}x${fill.height}`, '300x300');
      close(part(fill, 'body').getStyle(lightTheme).strokeWidth, 2 * Math.sqrt(18), 1e-9);
      const flat = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="0"/>';
      equal(new Illustration(flat, { width: 50 }).height, 0);
      let message = '';
      try {
        new Illustration(flat, { height: 10, label: 'flat.svg' });
      } catch (e) {
        message = (e as Error).message;
      }
      equal(message, '插画「flat.svg」画板高度为 0,不能按 height 缩放');
      throws(() => new Illustration(CAR, { width: -1 }));
      throws(() => new Illustration(CAR, { lagRatio: -1 }));
      throws(() => new Illustration(CAR, { width: 1, height: 1, fit: 'cover' as 'fill' }));
    },
  ],
  [
    '部件:文档顺序、按 id / class / 下标取,错 id 列出现有的',
    () => {
      const illo = new Illustration(CAR, { width: 300 });
      equal(illo.parts.map((p) => p.tag).join(','), 'rect,circle,circle,path');
      equal(illo.ids.join(','), 'body,wheel,tire,road');
      ok(illo.part('wheel') instanceof SvgGroup);
      ok(illo.part('body') instanceof SvgPart);
      equal(illo.parts[1], illo.part('tire'));
      ok(illo.hasPart('road') && !illo.hasPart('nope'));
      equal(illo.partsWithClass('round').map((p) => p.svgId).join(','), 'wheel');
      equal(illo.partsWithClass('panel')[0], illo.part('body'));
      equal(illo.partsWithClass('none').length, 0);
      let message = '';
      try {
        illo.part('flam');
      } catch (e) {
        message = (e as Error).message;
      }
      equal(message, '插画「内联 SVG」里没有 id 为「flam」的部件;现有:body、wheel、tire、road');
    },
  ],
  [
    '重定原点:部件原点 = 自身包围盒中心,组原点 = 子元素外接盒中心;世界盒不变',
    () => {
      const illo = new Illustration(CAR, { width: 300 });
      illo.moveTo({ x: 1000, y: -50 });
      for (const p of illo.parts) {
        const b = pathBounds(p.toPath());
        ok(b !== null);
        close(((b?.minX ?? 0) + (b?.maxX ?? 0)) / 2, 0, 1e-9, '部件几何以自身中心为原点');
        close(((b?.minY ?? 0) + (b?.maxY ?? 0)) / 2, 0, 1e-9);
      }
      const wheel = illo.part('wheel');
      close(wheel.position.x, 20 * 3 - 150);
      close(wheel.position.y, 40 * 3 - 75);
      const tire = illo.part('tire');
      close(tire.position.x, 0, 1e-9);
      const b = worldBoundsInScene([illo], [tire]);
      close(b?.minX ?? NaN, 1000 + 10 * 3 - 150, 1e-6);
      close(b?.maxX ?? NaN, 1000 + 30 * 3 - 150, 1e-6);
      close(b?.minY ?? NaN, -50 + 30 * 3 - 75, 1e-6);
      close(b?.maxY ?? NaN, -50 + 50 * 3 - 75, 1e-6);
    },
  ],
  [
    '颜色:写明的锁定(容器盖不掉);currentColor / 没写 fill 跟随 textColor',
    () => {
      const illo = new Illustration(CAR, { width: 300 });
      const body = part(illo, 'body');
      const tire = part(illo, 'tire');
      illo.setStyle({ fill: '#0000ff', stroke: '#00ff00' });
      const bodyCalls = draw(illo);
      equal(stateAt(bodyCalls, 'fill', 'fillStyle', 0), 'rgb(225, 29, 72)', '写明的填充锁定');
      equal(stateAt(bodyCalls, 'stroke', 'strokeStyle', 0), 'rgb(17, 17, 17)');
      equal(stateAt(drawPart(tire), 'fill', 'fillStyle'), lightTheme.textColor, '缺省墨色 = 主题文字色');
      illo.setStyle({ textColor: '#2563eb' });
      const calls = draw(illo);
      equal(stateAt(calls, 'fill', 'fillStyle', 1), '#2563eb', 'currentColor 部件跟 textColor 换色');
      equal(stateAt(calls, 'stroke', 'strokeStyle', 1), '#2563eb', 'currentColor 描边同样');
      equal(body.getStyle(lightTheme).fill, 'rgb(225, 29, 72)');
      equal(tire.getStyle(lightTheme).fill, lightTheme.textColor, 'getStyle 报告实际画出来的颜色');
      for (const p of illo.parts) {
        equal(p.opacity, 1, '不透明度烘焙进颜色,部件自身 opacity 都是 1');
      }
    },
  ],
  [
    'ColorTo 从墨色平滑过渡(首帧不跳色)并连填充一起改;Indicate 的着色也染到墨色部件',
    () => {
      const illo = new Illustration(CAR, { width: 300 });
      const tire = part(illo, 'tire');
      const c = new ColorTo(tire, '#e11d48');
      c.begin();
      c.interpolate(0);
      equal(stateAt(drawPart(tire), 'fill', 'fillStyle'), lightTheme.textColor, '第一帧仍是原来的墨色');
      c.interpolate(1);
      c.finish();
      equal(stateAt(drawPart(tire), 'fill', 'fillStyle'), '#e11d48');
      const other = part(new Illustration(CAR, { width: 300 }), 'tire');
      other.setEmphasis({}, { tint: { color: '#ff0000', amount: 1 } });
      equal(stateAt(drawPart(other), 'fill', 'fillStyle'), '#ff0000');
      const whole = new ColorTo(illo, '#00ff00');
      whole.begin();
      whole.finish();
      const calls = draw(illo);
      equal(stateAt(calls, 'fill', 'fillStyle', 0), '#00ff00', 'ColorTo(整幅) 逐叶子生效,锁定的颜色也改');
    },
  ],
  [
    '线帽 / 线连 / miterLimit:按 SVG 在描边前设好',
    () => {
      const illo = new Illustration(CAR, { width: 300 });
      const calls = drawPart(part(illo, 'road'));
      equal(stateAt(calls, 'stroke', 'lineCap'), 'round');
      equal(stateAt(calls, 'stroke', 'lineJoin'), 'miter');
      equal(stateAt(calls, 'stroke', 'miterLimit'), 4);
    },
  ],
  [
    'Create:部件错峰;先收起什么都不画;lagRatio 0 同时;有填充的件前半程只描轮廓;终态与没 Create 过一致',
    () => {
      const fresh = draw(new Illustration(CAR, { width: 300 }));
      const illo = new Illustration(CAR, { width: 300 });
      illo.setRevealFraction(0);
      const hidden = draw(illo);
      equal(count(hidden, 'fill') + count(hidden, 'stroke'), 0);
      illo.setRevealFraction(0.1);
      const fr = illo.parts.map((p) => p.getRevealFraction() ?? 1);
      ok((fr[0] ?? 0) > 0 && (fr[0] ?? 0) > (fr[1] ?? 0), `错峰:${fr.join(',')}`);
      equal(fr[3], 0, '最后一件还没开始');
      const same = new Illustration(CAR, { width: 300, lagRatio: 0 });
      same.setRevealFraction(0.3);
      ok(same.parts.every((p) => p.getRevealFraction() === 0.3));
      const outline = draw(same);
      equal(count(outline, 'fill'), 0, '有填充的件在 r < 0.5 时只描轮廓');
      ok(count(outline, 'stroke') > 0);
      const create = new Create(illo);
      create.begin();
      create.interpolate(0.6);
      create.finish();
      ok(sameCalls(draw(illo), fresh), 'Create.finish 后与从没 Create 过的插画逐项相同');
      illo.setRevealFraction(0.5);
      illo.setRevealFraction(null);
      ok(sameCalls(draw(illo), fresh));
    },
  ],
  [
    'Create:什么都不画的部件不占时段(Material 图标的隐形边框),画面不会白白停着;上了色就重新排进去',
    () => {
      const icon = new Illustration(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" fill="none"/>' +
          '<path id="frame" d="M0 0h24v24H0z" fill="none"/><path d="M12 2 L22 22 H2 Z"/></svg>',
        { width: 240 },
      );
      equal(icon.parts.length, 2, '匿名的隐形边框解析时就丢了,带 id 的留着');
      const frame = part(icon, 'frame');
      ok(frame.drawsNothing);
      const create = new Create(icon);
      create.begin();
      create.interpolate(0.1);
      close(icon.parts[1]?.getRevealFraction() ?? NaN, 0.1, 1e-12, '唯一看得见的部件从一开始就在画');
      equal(frame.getRevealFraction(), 0.1, '隐形部件跟着总进度走');
      create.finish();
      frame.setStyle({ fill: '#ff0000' });
      ok(!frame.drawsNothing);
      icon.setRevealFraction(0.1);
      ok((frame.getRevealFraction() ?? 0) > (icon.parts[1]?.getRevealFraction() ?? 1), '上了色的部件重新占时段');
    },
  ],
  [
    '画板外的形状不进树:剔除半径不被撑大、Create 不给它排时段',
    () => {
      const illo = new Illustration(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><rect width="100" height="100"/><circle cx="400" cy="50" r="10"/></svg>',
        { width: 100 },
      );
      equal(illo.parts.length, 1);
      close(illo.getCullRadius(lightTheme), Math.hypot(100, 100) / 2, 1e-6);
    },
  ],
  [
    'Write / Transform 的覆盖层按部件共同的线型画(圆头线稿不变平头);线型混用时用画布缺省',
    () => {
      const icon = new Illustration(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
          'stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="M12 5l7 7-7 7"/></svg>',
        { width: 240 },
      );
      const w = new Write(icon);
      w.begin();
      w.interpolate(0.5);
      const during = draw(icon);
      equal(stateAt(during, 'stroke', 'lineCap'), 'round');
      equal(stateAt(during, 'stroke', 'lineJoin'), 'round');
      equal(stateAt(during, 'stroke', 'miterLimit'), 4);
      w.finish();
      equal(stateAt(draw(icon), 'stroke', 'lineCap'), 'round', '覆盖层撤掉后各部件照常');
      const car = new Illustration(CAR, { width: 300 });
      const mixed = new Write(car);
      mixed.begin();
      mixed.interpolate(0.5);
      equal(stateAt(draw(car), 'stroke', 'lineCap'), undefined, 'body 平头、road 圆头:不猜');
      mixed.finish();
      const road = part(car, 'road');
      const single = new Write(road);
      single.begin();
      single.interpolate(0.5);
      equal(stateAt(drawPart(road), 'stroke', 'lineCap'), 'round', 'Write 单个部件按它自己的线型');
      single.finish();
    },
  ],
  [
    'ColorTo 保留 SVG 里半透明描边 / 填充的透明度(组 opacity 烘焙进颜色的阴影)',
    () => {
      const illo = new Illustration(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g opacity="0.3"><path d="M1 1 H9 V9 Z" fill="#000" stroke="#000"/></g></svg>',
        { width: 100 },
      );
      const tween = new ColorTo(illo, '#ff0000');
      tween.begin();
      tween.finish();
      const style = illo.parts[0]?.getStyle(lightTheme);
      equal(style?.fill, 'rgba(255, 0, 0, 0.3)');
      equal(style?.stroke, 'rgba(255, 0, 0, 0.3)', '描边也保留 0.3,不会突然变实');
    },
  ],
  [
    'Create:某个 <g> 自己也逐件画出;空插画、带空组的插画 Create 不抛错',
    () => {
      const illo = new Illustration(CAR, { width: 300 });
      const wheel = illo.part('wheel');
      wheel.setRevealFraction(0.2);
      const tire = illo.part('tire');
      ok((tire.getRevealFraction() ?? 0) > (illo.parts[2]?.getRevealFraction() ?? 1));
      equal(illo.part('body').getRevealFraction(), null, '组外的部件不受影响');
      const empty = new Illustration('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"/>', { width: 10 });
      const c = new Create(empty);
      c.begin();
      c.interpolate(0.5);
      c.finish();
      const withEmpty = new Illustration(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><g id="slot"/><rect width="5" height="5"/></svg>',
        { width: 10 },
      );
      ok(withEmpty.part('slot') instanceof SvgGroup);
      const c2 = new Create(withEmpty);
      c2.begin();
      c2.finish();
    },
  ],
  [
    'Write:每个部件一片,结束撤掉覆盖层;Transform(插画, 插画) 与 Transform(插画, 圆) 都能用',
    () => {
      const illo = new Illustration(CAR, { width: 300 });
      const w = new Write(illo);
      w.begin();
      w.interpolate(1);
      equal(illo.getMorphOverlay()?.layers.length, 4);
      w.finish();
      equal(illo.getMorphOverlay(), null);
      const other = new Illustration(CAR, { width: 100 });
      const t = new Transform(illo, other);
      t.begin();
      t.interpolate(0.5);
      ok(draw(illo).length > 0);
      t.finish();
      const t2 = new Transform(other, new Circle(30));
      t2.begin();
      t2.interpolate(0.5);
      t2.finish();
    },
  ],
  [
    '确定性:同一文档同一尺寸建两次,部件共用同一份几何、位置相同;换尺寸是新几何',
    async () => {
      const stub = installAssetStub({ texts: { '/svg/car.svg': CAR } });
      try {
        const asset = await loadSvg('/svg/car.svg');
        const a = new Illustration(asset, { width: 300 });
        const b = new Illustration('/svg/car.svg', { width: 300 });
        equal(a.label, '/svg/car.svg');
        a.parts.forEach((p, i) => {
          const q = b.parts[i];
          equal(p.toPath(), q?.toPath(), '共用 PathData');
          equal(p.position.x, q?.position.x);
          equal(p.position.y, q?.position.y);
        });
        const c = new Illustration(asset, { width: 200 });
        ok(c.parts[0]?.toPath() !== a.parts[0]?.toPath());
        ok(a.parts[0] !== b.parts[0], '图元每次现建');
        let error: unknown = null;
        try {
          new Illustration('/svg/other.svg');
        } catch (e) {
          error = e;
        }
        ok(error instanceof AssetError && error.code === 'not-loaded');
      } finally {
        stub.restore();
      }
    },
  ],
  [
    '内联源码:同一字符串只解析一次(不支持的内容只告警一次)',
    () => {
      const text = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>x</text><rect id="once-only" width="1" height="1"/></svg>';
      const warns: unknown[] = [];
      const { warn } = console;
      console.warn = (...args: unknown[]): void => {
        warns.push(args[0]);
      };
      try {
        const docs = [1, 2, 3].map(() => new Illustration(text, { width: 10 }).document);
        equal(docs[0], docs[2]);
      } finally {
        console.warn = warn;
      }
      equal(warns.length, 1);
      ok(String(warns[0]).includes('<text>×1'));
    },
  ],
  [
    'clip:画子元素前按画板裁剪,之后恢复;剔除半径取画板半对角线',
    () => {
      const illo = new Illustration(CAR, { width: 300, clip: true });
      const ops = draw(new Group().add(illo)).map((c) => c.op);
      const clipAt = ops.indexOf('clip');
      ok(clipAt > 0 && ops[clipAt - 1] === 'rect');
      ok(ops.indexOf('fill') > clipAt);
      close(illo.getCullRadius(), Math.hypot(300, 150) / 2);
      const open = new Illustration(CAR, { width: 300 });
      equal(count(draw(open), 'clip'), 0);
    },
  ],
]);
