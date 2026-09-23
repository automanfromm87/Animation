import { installDomStub } from '../../testing/domStub';
import type { FakeCtxCall } from '../../testing/harness';
import { close, equal, fakeCtx, ok, stateAt, suite, throws } from '../../testing/harness';
import { highlightColor, lerpColor } from '../color';
import { Group } from '../mobjects/Group';
import type { MObject } from '../mobjects/MObject';
import { Circle, Dot, Label, Line, Rectangle } from '../mobjects/shapes';
import { Tex } from '../mobjects/tex';
import { pathBounds } from '../path/path';
import { Scene } from '../scene/Scene';
import type { Theme } from '../theme/Theme';
import { lightTheme } from '../theme/presets';
import { Circumscribe, Flash, Indicate, Wiggle } from './emphasis';
import { linear, smooth } from './rateFunctions';

const HIGHLIGHT = highlightColor(lightTheme.background);

function draw(m: MObject, theme: Theme = lightTheme): FakeCtxCall[] {
  const { ctx, calls } = fakeCtx();
  m.render(ctx, theme);
  return calls;
}

/** 装饰(圈、光芒)单独画一遍。 */
function drawAdornment(m: MObject, owner: object): FakeCtxCall[] {
  const { ctx, calls } = fakeCtx();
  m.getEmphasis(owner)?.adorn?.(ctx, lightTheme);
  return calls;
}

export default suite('强调动画 Indicate / Wiggle / Circumscribe / Flash', [
  [
    '强调色按背景挑:亮底橙、暗底琥珀黄,解析不了按亮底',
    () => {
      equal(highlightColor('#f8f7f4'), '#ea580c');
      equal(highlightColor('#111827'), '#fbbf24');
      equal(highlightColor('not-a-color'), '#ea580c');
    },
  ],
  [
    'Indicate:绕几何中心放大、染上强调色;结束后精确回到原样(位置、缩放、样式都没被改过)',
    () => {
      const line = new Line({ x: 0, y: 0 }, { x: 100, y: 0 });
      line.moveTo({ x: 10, y: 20 });
      const ind = new Indicate(line, { rateFunc: linear });
      ind.begin();
      ind.interpolate(1);
      const e = line.getEmphasis(ind);
      equal(e?.scale, 1.2);
      equal(e?.pivot?.x, 50, '线段的几何中心在本地 (50, 0)');
      const calls = draw(line);
      equal(stateAt(calls, 'stroke', 'strokeStyle'), HIGHLIGHT, '满程时就是强调色');
      // 自身变换之后绕 pivot 放大:translate(50,0) → scale(1.2) → translate(-50,0)。
      const ops = calls.filter((c) => c.op === 'translate' || c.op === 'scale').map((c) => `${c.op}(${c.args.join(',')})`);
      equal(ops.slice(0, 5).join(' '), 'translate(10,20) scale(1,1) translate(50,0) scale(1.2,1.2) translate(-50,0)');
      ind.interpolate(0.5);
      equal(
        stateAt(draw(line), 'stroke', 'strokeStyle'),
        lerpColor(lightTheme.stroke, HIGHLIGHT, 0.5),
        '中途按 OKLab 混色',
      );
      ind.finish();
      equal(line.getEmphasis(ind), null);
      equal(stateAt(draw(line), 'stroke', 'strokeStyle'), lightTheme.stroke);
      equal(line.position.x, 10);
      equal(line.scale, 1);
      equal(Object.keys(line.getStyleOverride()).length, 0, '强调不写样式');
    },
  ],
  [
    'Indicate 缺省去而复返;自定义颜色;非法倍数抛错',
    () => {
      const c = new Circle(10);
      const ind = new Indicate(c, { color: '#ff0000', scaleFactor: 1.5 });
      equal(ind.rateFunc(0.5), 1);
      equal(ind.rateFunc(1), 0);
      ind.begin();
      ind.interpolate(1);
      equal(stateAt(draw(c), 'stroke', 'strokeStyle'), '#ff0000');
      equal(c.getEmphasis(ind)?.scale, 1.5);
      const disk = new Circle(10).setStyle({ fill: 'rgba(0, 0, 255, 0.4)' });
      const tinted = new Indicate(disk, { color: '#ff0000', rateFunc: linear });
      tinted.begin();
      tinted.interpolate(1);
      equal(stateAt(draw(disk), 'fill', 'fillStyle'), 'rgba(255, 0, 0, 0.4)', '填充染色保留原来的透明度');
      throws(() => new Indicate(c, { scaleFactor: 0 }));
      throws(() => new Indicate(c, { scaleFactor: Number.NaN }));
    },
  ],
  [
    '容器整组染色:子元素描边、文字都变色;着色不会漏到之后画的对象上(子元素抛错也不会)',
    () => {
      const a = new Circle(10);
      const label = new Label('x');
      const g = new Group().add(a, label);
      const ind = new Indicate(g, { rateFunc: linear, color: '#ff0000' });
      ind.begin();
      ind.interpolate(1);
      const calls = draw(g);
      equal(stateAt(calls, 'stroke', 'strokeStyle'), '#ff0000');
      equal(stateAt(calls, 'fillText', 'fillStyle'), '#ff0000');
      equal(stateAt(draw(new Circle(5)), 'stroke', 'strokeStyle'), lightTheme.stroke, '组外的对象不受影响');

      class Boom extends Circle {
        protected override drawShape(): void {
          throw new Error('boom');
        }
      }
      const broken = new Group().add(new Boom(5));
      const ind2 = new Indicate(broken, { rateFunc: linear, color: '#00ff00' });
      ind2.begin();
      ind2.interpolate(1);
      throws(() => draw(broken));
      equal(stateAt(draw(new Circle(5)), 'stroke', 'strokeStyle'), lightTheme.stroke, '抛错后着色也要交还');
    },
  ],
  [
    '容器上的强调:整组绕中心放大、圈画出来;子元素零强度的着色不挡住祖先的,几个着色取最强的',
    () => {
      const child = new Circle(10);
      child.moveTo({ x: 40, y: 0 });
      const g = new Group().add(child);
      const ind = new Indicate(g, { rateFunc: linear, color: '#ff0000' });
      const circ = new Circumscribe(g);
      ind.begin();
      circ.begin();
      ind.interpolate(1);
      circ.interpolate(0.5);
      // 子元素也挂着一个刚开始(强度 0)的高亮:应当沿用组的着色。
      const idle = new Indicate(child, { rateFunc: linear, color: '#00ff00' });
      idle.begin();
      idle.interpolate(0);
      const calls = draw(g);
      const scales = calls.filter((c) => c.op === 'scale').map((c) => c.args.join(','));
      ok(scales.includes('1.2,1.2'), `整组应当放大,实际 scale 调用 ${scales.join(' ')}`);
      const translates = calls.filter((c) => c.op === 'translate').map((c) => c.args.join(','));
      ok(translates.includes('40,0') && translates.includes('-40,0'), '绕组的几何中心 (40, 0) 放大');
      equal(stateAt(calls, 'stroke', 'strokeStyle', 0), '#ff0000', '子元素零强度的着色不挡住组的');
      equal(calls.filter((c) => c.op === 'stroke').length, 2, '子元素一笔、组的圈一笔');

      const both = new Circle(5);
      const weak = new Indicate(both, { rateFunc: linear, color: '#0000ff' });
      const strong = new Indicate(both, { rateFunc: linear, color: '#ff0000' });
      weak.begin();
      strong.begin();
      strong.interpolate(1);
      weak.interpolate(0.3);
      equal(stateAt(draw(both), 'stroke', 'strokeStyle'), '#ff0000', '同时挂两个着色取强度大的');
    },
  ],
  [
    '公式里的某一项:Indicate 只染、只放大这一部分,其余照常;对象整体不放大',
    () => {
      const tex = new Tex('\\class{lhs}{a+b} = c').setStyle({ fontSize: 20 });
      const whole = tex.getBox();
      const part = tex.getPartBox('lhs');
      ok(part !== null && part.size.w < whole.size.w * 0.8, '那一项比整条公式窄');
      ok(part !== null && part.center.x < 0, '左边那一项在公式左半边');
      equal(tex.getPartBox('nope'), null);
      const inPart = tex.layout().parts.get('lhs')?.length ?? 0;
      const total = tex.layout().primitives.length;
      ok(inPart === 3 && total === 5, `a + b 三个字形在部分里,实际 ${inPart}/${total}`);

      const ind = new Indicate(tex, { part: 'lhs', color: '#ff0000', rateFunc: linear });
      ind.begin();
      ind.interpolate(1);
      const calls = draw(tex);
      const fills = calls.filter((c) => c.op === 'fill').map((_, i) => stateAt(calls, 'fill', 'fillStyle', i));
      equal(fills.filter((c) => c === '#ff0000').length, inPart, '那一项染成强调色');
      equal(fills.filter((c) => c === lightTheme.textColor).length, total - inPart, '其余保持文字色');
      const scales = calls.filter((c) => c.op === 'scale').map((c) => c.args.join(','));
      equal(scales.join(' '), '1,1 20,20 1.2,1.2', '对象自身不放大,只有那一项绕自己的中心放大');
      ind.finish();
      const after = draw(tex);
      equal(after.filter((c) => c.op === 'fill').length, 1, '撤掉后回到同色合并画法(全是文字色,一次 fill)');
    },
  ],
  [
    '公式里的某一项:Circumscribe 圈它、Flash 以它为心;中文按字宽估;名字不对或不是公式时报错',
    () => {
      const tex = new Tex('\\class{lhs}{a+b} = c').setStyle({ fontSize: 20 });
      tex.moveTo({ x: 100, y: 0 });
      const part = tex.getPartBox('lhs');
      if (!part) {
        throw new Error('缺少部分');
      }
      const circ = new Circumscribe(tex, { part: 'lhs', buff: 4 });
      circ.begin();
      const b = pathBounds(circ.framePath());
      close(b?.minX ?? NaN, 100 + part.center.x - part.size.w / 2 - 4, 1e-9);
      close(b?.maxX ?? NaN, 100 + part.center.x + part.size.w / 2 + 4, 1e-9);
      const flash = new Flash(tex, { part: 'lhs' });
      flash.begin();
      close(flash.flashCenter().x, 100 + part.center.x, 1e-9);

      const cjk = new Tex('\\class{v}{\\text{速度}} = 1').setStyle({ fontSize: 20 });
      const v = cjk.getPartBox('v');
      // 与 MathJax 自己给「速度」排出来的宽度相比(同一个字宽假设)。
      const alone = new Tex('\\text{速度}').setStyle({ fontSize: 20 }).getBox().size.w;
      ok(v !== null && Math.abs(v.size.w - alone) < alone * 0.02, `中文部分按字宽估,实际 ${v?.size.w},排版宽 ${alone}`);
      ok(v !== null && v.size.h > 0);
      // 指定了字体时 MathJax 把整串放进一个文字图元:宽度要按字数算。
      const serif = '\\style{font-family:serif}{\\text{速度}}';
      const run = new Tex(`\\class{v}{${serif}} = 1`).setStyle({ fontSize: 20 }).getPartBox('v');
      const runAlone = new Tex(serif).setStyle({ fontSize: 20 }).getBox().size.w;
      ok(run !== null && Math.abs(run.size.w - runAlone) < runAlone * 0.02, `整串的宽按字数算,实际 ${run?.size.w},排版宽 ${runAlone}`);

      throws(() => new Indicate(new Circle(5), { part: 'x' }).begin(), '不是公式');
      let message = '';
      try {
        new Circumscribe(tex, { part: 'nope' }).begin();
      } catch (e) {
        message = e instanceof Error ? e.message : '';
      }
      ok(message.includes('nope') && message.includes('lhs'), `报错应当列出现有的部分,实际:${message}`);
    },
  ],
  [
    '强调期间不参与剔除;与变形覆盖层并存时两者都撤掉才恢复',
    () => {
      const c = new Circle(20);
      const r0 = c.getCullRadius();
      ok(Number.isFinite(r0));
      const ind = new Indicate(c);
      ind.begin();
      ind.interpolate(0.5);
      equal(c.getCullRadius(), Infinity);
      c.setMorphOverlay({ layers: [] });
      ind.finish();
      equal(c.getCullRadius(), Infinity, '覆盖层还在');
      c.setMorphOverlay(null);
      equal(c.getCullRadius(), r0);
    },
  ],
  [
    'Wiggle:左右摆动、微微放大,两端不动;结束撤掉',
    () => {
      const r = new Rectangle(40, 20);
      const w = new Wiggle(r, { rotationAngle: 0.2, wiggles: 6 });
      equal(w.runTime, 2);
      w.begin();
      w.interpolate(0);
      equal(r.getEmphasis(w)?.rotation, 0);
      equal(r.getEmphasis(w)?.scale, 1);
      w.interpolate(0.25);
      // thereAndBack(0.25) = 0.5,sin(6π·0.25) = -1。
      close(r.getEmphasis(w)?.rotation ?? NaN, -0.1, 1e-12);
      close(r.getEmphasis(w)?.scale ?? NaN, 1.05, 1e-12);
      w.finish();
      equal(r.getEmphasis(w), null);
      throws(() => new Wiggle(r, { wiggles: 0 }));
      throws(() => new Wiggle(r, { rotationAngle: Infinity }));
    },
  ],
  [
    'Circumscribe:外接矩形 + 留白,前半程沿顺时针画出、后半程从起点收回;跟着对象移动',
    () => {
      const rect = new Rectangle(100, 40);
      rect.moveTo({ x: 200, y: 100 });
      const circ = new Circumscribe(rect, { buff: 10 });
      circ.begin();
      const b = pathBounds(circ.framePath());
      close(b?.minX ?? NaN, 140, 1e-9);
      close(b?.maxX ?? NaN, 260, 1e-9);
      close(b?.minY ?? NaN, 70, 1e-9);
      close(b?.maxY ?? NaN, 130, 1e-9);
      // 前半程中点:画出周长的 smooth(0.5)=一半,从左上角 (140,70) 走到右下角 (260,130)。
      circ.interpolate(0.25);
      const first = drawAdornment(rect, circ);
      const start = first.find((c) => c.op === 'moveTo');
      equal(start?.args.join(','), '140,70');
      const curves = first.filter((c) => c.op === 'bezierCurveTo');
      const end = curves[curves.length - 1]?.args ?? [];
      close(end[4] ?? NaN, 260, 1e-6);
      close(end[5] ?? NaN, 130, 1e-6);
      equal(stateAt(first, 'stroke', 'strokeStyle'), HIGHLIGHT);
      equal(stateAt(first, 'stroke', 'lineWidth'), lightTheme.strokeWidth, '线宽缺省按主题');
      // 后半程中点:收回前一半,剩下的从右下角开始。
      circ.interpolate(0.75);
      const tail = drawAdornment(rect, circ).find((c) => c.op === 'moveTo');
      close(tail?.args[0] ?? NaN, 260, 1e-6);
      close(tail?.args[1] ?? NaN, 130, 1e-6);
      equal(drawAdornment(rect, circ).filter((c) => c.op === 'stroke').length, 1);
      circ.interpolate(1);
      equal(drawAdornment(rect, circ).filter((c) => c.op === 'stroke').length, 0, '走完时整圈收回');
      rect.moveTo({ x: 0, y: 0 });
      close(pathBounds(circ.framePath())?.minX ?? NaN, -60, 1e-9, '对象移动后圈跟着走');
      circ.finish();
      equal(rect.getEmphasis(circ), null);
    },
  ],
  [
    'Circumscribe:圆形外接包围盒对角线;淡出模式后半程整圈变淡;参数校验',
    () => {
      const rect = new Rectangle(60, 80);
      const circ = new Circumscribe(rect, { shape: 'circle', buff: 5, fadeOut: true, color: '#123456' });
      circ.begin();
      const b = pathBounds(circ.framePath());
      close(((b?.maxX ?? 0) - (b?.minX ?? 0)) / 2, 50 + 5, 1e-6, '半径 = 半对角线 + 留白');
      circ.interpolate(0.75);
      const calls = drawAdornment(rect, circ);
      close(Number(stateAt(calls, 'stroke', 'globalAlpha')), 1 - smooth(0.5), 1e-12);
      equal(stateAt(calls, 'stroke', 'strokeStyle'), '#123456');
      throws(() => new Circumscribe(rect, { buff: -1 }));
      throws(() => new Circumscribe(rect, { shape: 'triangle' as 'circle' }));
      throws(() => new Circumscribe(rect, { strokeWidth: 0 }));
    },
  ],
  [
    'Flash:一圈光芒向外掠过;中心跟着对象;at 指定本地点;两端什么都不画',
    () => {
      const dot = new Dot(6);
      dot.moveTo({ x: 100, y: 50 });
      const flash = new Flash(dot, { rateFunc: linear });
      flash.begin();
      flash.interpolate(0);
      equal(drawAdornment(dot, flash).filter((c) => c.op === 'stroke').length, 0);
      flash.interpolate(0.25); // 可见 [0, 0.5]
      const calls = drawAdornment(dot, flash);
      const moves = calls.filter((c) => c.op === 'moveTo');
      equal(moves.length, 12);
      const r0 = Math.hypot(12, 12) / 2 + 6;
      close(moves[0]?.args[0] ?? NaN, 100 + r0, 1e-9);
      close(moves[0]?.args[1] ?? NaN, 50, 1e-9);
      const line = calls.find((c) => c.op === 'lineTo');
      close(line?.args[0] ?? NaN, 100 + r0 + 7, 1e-9, '光芒长 14,可见一半');
      flash.interpolate(1);
      equal(drawAdornment(dot, flash).filter((c) => c.op === 'stroke').length, 0, '走完时光芒已经掠过');
      dot.moveTo({ x: 0, y: 0 });
      close(flash.flashCenter().x, 0, 1e-12, '中心跟着对象');
      flash.finish();
      equal(dot.getEmphasis(flash), null);

      const holder = new Group();
      holder.moveTo({ x: 10, y: 10 });
      holder.scale = 2;
      const at = new Flash(holder, { at: { x: 5, y: 0 }, lineCount: 4 });
      at.begin();
      const c = at.flashCenter();
      close(c.x, 20, 1e-12, '本地点经对象变换到父坐标');
      close(c.y, 10, 1e-12);
      at.interpolate(0.5);
      equal(drawAdornment(holder, at).filter((x) => x.op === 'moveTo').length, 4);
      throws(() => new Flash(dot, { lineCount: 2.5 }));
      throws(() => new Flash(dot, { lineLength: 0 }));
      throws(() => new Flash(dot, { timeWidth: -1 }));
    },
  ],
  [
    '装饰画在对象之后的父坐标系里,不乘对象自己的透明度',
    () => {
      const c = new Circle(10);
      c.moveTo({ x: 30, y: 0 });
      c.opacity = 0.5;
      const flash = new Flash(c, { rateFunc: linear });
      flash.begin();
      flash.interpolate(0.5);
      const calls = draw(c);
      const strokes = calls.filter((x) => x.op === 'stroke');
      equal(strokes.length, 2, '圆一笔、光芒一笔');
      equal(stateAt(calls, 'stroke', 'globalAlpha', 0), 0.5);
      equal(stateAt(calls, 'stroke', 'globalAlpha', 1), 1, '光芒不跟着对象变淡');
      const firstMove = calls.filter((x) => x.op === 'moveTo').pop();
      ok((firstMove?.args[0] ?? 0) > 30, '光芒的坐标是父坐标(已经含对象的位置)');
    },
  ],
  [
    'Scene.play 端到端:同一对象同时高亮、圈出、闪一下,播完全部撤掉',
    async () => {
      const dom = installDomStub();
      try {
        const scene = new Scene(dom.canvas(), { theme: lightTheme });
        const target = new Circle(30);
        scene.add(target);
        const ind = new Indicate(target, { runTime: 0.3 });
        const circ = new Circumscribe(target, { runTime: 0.3 });
        const flash = new Flash(target, { runTime: 0.3 });
        let done = false;
        void scene.play(ind, circ, flash).then(() => {
          done = true;
        });
        for (let i = 0; i < 8; i++) {
          dom.frame(16);
          await dom.flush();
        }
        ok(target.getEmphasis(ind) !== null && target.getEmphasis(circ) !== null, '播放中挂着效果');
        for (let i = 0; i < 40 && !done; i++) {
          dom.frame(16);
          await dom.flush();
        }
        ok(done);
        equal(target.getEmphasis(ind), null);
        equal(target.getEmphasis(circ), null);
        equal(target.getEmphasis(flash), null);
        ok(Number.isFinite(target.getCullRadius()), '剔除半径恢复');
        scene.dispose();
      } finally {
        dom.restore();
      }
    },
  ],
]);
