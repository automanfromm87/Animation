import { close, equal, fakeCtx, ok, suite } from '../../testing/harness';
import { Create } from '../animations/primitives';
import type { TexPrimitive } from '../math/typeset';
import { MATH_SCALE, typesetTex } from '../math/typeset';
import type { PathLayer } from '../path/draw';
import type { PathBounds } from '../path/path';
import { pathBounds, totalSegments } from '../path/path';
import { resolveStyle } from '../theme/Theme';
import { lightTheme } from '../theme/presets';
import { Group } from './Group';
import { Tex } from './tex';

function boundsOf(p: TexPrimitive | undefined): PathBounds {
  const b = p && p.kind !== 'text' ? pathBounds(p.path) : null;
  ok(b !== null, '图元没有几何');
  return b ?? { minX: NaN, minY: NaN, maxX: NaN, maxY: NaN };
}

/** 画一遍,返回记录到的调用。 */
function draw(t: Tex) {
  const { ctx, calls } = fakeCtx();
  t.render(ctx, lightTheme);
  return calls;
}

export default suite('Tex(MathJax 矢量公式)', [
  [
    '尺寸同步可得:搭场景时 getBox 就是真实排版尺寸,按字号缩放',
    () => {
      const a = new Tex('x^2 + y^2 = r^2').setStyle({ fontSize: 20 });
      const b = new Tex('x').setStyle({ fontSize: 20 });
      const box = a.getBox();
      ok(box.size.w > b.getBox().size.w * 4, `宽度不对:${box.size.w}`);
      const big = new Tex('x^2 + y^2 = r^2').setStyle({ fontSize: 40 });
      close(big.getBox().size.w, box.size.w * 2, 1e-9);
      close(big.getBox().size.h, box.size.h * 2, 1e-9);
    },
  ],
  [
    '简单公式共用一条基线:x 与 b 的盒子一样高(一个 \\strut 的行高下限)',
    () => {
      const hx = new Tex('x').setStyle({ fontSize: 10 }).getBox().size.h;
      const hb = new Tex('b').setStyle({ fontSize: 10 }).getBox().size.h;
      close(hx, hb, 1e-9);
      close(hx, (0.9 + 0.3) * MATH_SCALE * 10, 1e-9);
    },
  ],
  [
    '分式、上下标这类高公式的盒子更高,字形完整落在盒子里(不会裁掉分母)',
    () => {
      for (const src of [
        "\\frac{f(x_n)}{f'(x_n)}",
        "\\left(\\frac{f}{g}\\right)' = \\frac{f'g-fg'}{g^2}",
        '\\sum_{i=1}^{n} i^2',
      ]) {
        const t = new Tex(src).setStyle({ fontSize: 10 });
        const box = t.getBox();
        const b = pathBounds(t.toPath());
        const eps = 1e-6;
        ok(
          b !== null &&
            b.minX >= -box.size.w / 2 - eps &&
            b.maxX <= box.size.w / 2 + eps &&
            b.minY >= -box.size.h / 2 - eps &&
            b.maxY <= box.size.h / 2 + eps,
          `${src} 的字形超出了盒子`,
        );
      }
      const frac = new Tex('\\frac{a}{b}').setStyle({ fontSize: 10 }).getBox().size.h;
      const flat = new Tex('x').setStyle({ fontSize: 10 }).getBox().size.h;
      ok(frac > flat, '分式应比单个字母高');
    },
  ],
  [
    '按矢量画:同色字形合成一次 fill,颜色走 textColor;\\textcolor 局部变色',
    () => {
      const plain = draw(new Tex('a+b').setStyle({ fontSize: 20 }));
      equal(plain.filter((c) => c.op === 'fill').length, 1, '同色字形应合成一次 fill');
      ok(plain.some((c) => c.op === '=fillStyle' && c.value === lightTheme.textColor));
      ok(plain.some((c) => c.op === 'bezierCurveTo'), '应描出字形轮廓');
      // \\color 与 LaTeX 一样是开关(一直作用到分组结束),局部变色用 \\textcolor。
      const colored = draw(new Tex('\\textcolor{red}{x}+y').setStyle({ fontSize: 20 }));
      const styles = colored.filter((c) => c.op === '=fillStyle').map((c) => c.value);
      ok(styles.includes('red') && styles.includes(lightTheme.textColor), `颜色:${styles.join(',')}`);
    },
  ],
  [
    '\\text 里的中文用画布文字画,字宽与 MathJax 预留的一致',
    () => {
      const t = new Tex('\\text{递减}').setStyle({ fontSize: 10 });
      const texts = draw(t)
        .filter((c) => c.op === 'fillText')
        .map((c) => c.value);
      equal(texts.join(''), '递减');
      close(t.getBox().size.w, 2 * 0.884 * MATH_SCALE * 10, 1e-6);
    },
  ],
  [
    '语法错误不抛:error 给出说明,公式照样画成红字;未定义的命令显示成红色原文',
    () => {
      const broken = new Tex('\\frac{');
      ok(broken.error !== null, '缺右括号应报错');
      const calls = draw(broken.setStyle({ fontSize: 10 }));
      ok(calls.some((c) => c.op === '=fillStyle' && c.value === '#cc0000'), '错误信息应是红字');
      const unknown = new Tex('\\nosuchmacro');
      equal(unknown.error, null);
      const u = draw(unknown.setStyle({ fontSize: 10 }));
      ok(u.some((c) => c.op === '=fillStyle' && c.value === 'red'));
    },
  ],
  [
    '字形路径:按字号缩放、随内容变化;排版结果按源码缓存',
    () => {
      const t = new Tex('x').setStyle({ fontSize: 10 });
      const small = pathBounds(t.toPath());
      const large = pathBounds(t.toPath(resolveStyle(lightTheme, { fontSize: 30 })));
      ok(small !== null && large !== null);
      close(
        (large?.maxX ?? 0) - (large?.minX ?? 0),
        ((small?.maxX ?? 0) - (small?.minX ?? 0)) * 3,
        1e-9,
      );
      const before = totalSegments(t.toPath());
      t.setTex('x+y');
      ok(totalSegments(t.toPath()) > before, '换内容后字形没变');
      ok(typesetTex('x+y') === typesetTex('x+y'), '同一条源码应命中缓存');
    },
  ],
  [
    '剔除半径按当下的样式上下文解析字号;没有上下文且没设字号时不参与剔除',
    () => {
      const t = new Tex('x');
      equal(t.getCullRadius(), Infinity);
      const group = new Group().add(t);
      const radius = (): number => group.getCullRadius(lightTheme);
      const l = t.layout();
      const half = Math.hypot(l.width, l.height) / 2;
      close(radius(), half * lightTheme.fontSize, 1e-9);
      group.setStyle({ fontSize: 400 });
      close(radius(), half * 400, 1e-9, '容器改了字号,剔除半径没跟上');
      t.setStyle({ fontSize: 10 });
      close(radius(), half * 10, 1e-9, '自身字号应优先于容器');
    },
  ],
  [
    '1 秒内频繁换源(逐帧改公式)告警一次,提示改用 Label;偶尔换不告警',
    () => {
      const original = console.warn;
      let warned = 0;
      console.warn = (): void => {
        warned += 1;
      };
      try {
        const t = new Tex('0');
        for (let i = 1; i <= 5; i++) {
          t.setTex(String(i));
        }
        equal(warned, 0, '偶尔换源不该告警');
        for (let i = 0; i < 60; i++) {
          t.setTex(`v${i}`);
        }
        equal(warned, 1, `告警了 ${warned} 次`);
      } finally {
        console.warn = original;
      }
    },
  ],
  [
    '支持 Create:字形先描轮廓再填充、按排版顺序错峰;画完回到分色合并的正常画法',
    () => {
      const t = new Tex('a+b').setStyle({ fontSize: 20 });
      ok(t.supportsReveal);
      ok(new Group().add(t).supportsReveal, '含公式的组应当可以 Create');
      const anim = new Create(t);
      anim.begin();
      equal(draw(t).filter((c) => c.op === 'fill' || c.op === 'stroke').length, 0, 'f=0 时什么都不该画');
      t.setRevealFraction(0.2);
      const early = draw(t);
      ok(early.some((c) => c.op === 'stroke'), '前段应描出轮廓');
      ok(!early.some((c) => c.op === 'fill'), '轮廓还没描完不该填充');
      t.setRevealFraction(0.9);
      ok(draw(t).some((c) => c.op === 'fill'), '后段应填充');
      anim.finish();
      equal(t.getRevealFraction(), null);
      equal(draw(t).filter((c) => c.op === 'fill').length, 1, '画完应回到同色合并一次 fill');
    },
  ],
  [
    '逐个字形一层(按字号放大,颜色走 textColor / \\textcolor);中文只在 drawMorphResidual 里画',
    () => {
      const style = resolveStyle(lightTheme, { fontSize: 20 });
      const t = new Tex('\\textcolor{red}{x}+y');
      const layers = t.pathLayers(style);
      equal(layers.length, 3);
      equal(layers[0]?.paint.fill, 'red');
      equal(layers[2]?.paint.fill, lightTheme.textColor);
      close(layers[0]?.outlineWidth ?? NaN, 20 * 0.03, 1e-12);
      // 各层合起来就是按字号放大的完整字形。
      const all = pathBounds({ subpaths: layers.flatMap((l) => l.path.subpaths) });
      const outline = pathBounds(t.toPath(style));
      close(all?.minX ?? NaN, outline?.minX ?? NaN, 1e-9);
      close(all?.maxY ?? NaN, outline?.maxY ?? NaN, 1e-9);
      equal(t.pathLayers(resolveStyle(lightTheme, { fontSize: 0 })).length, 0);
      const cjk = new Tex('\\text{递减}');
      equal(cjk.pathLayers(style).length, 0, '中文没有轮廓,不参与变形');
      const { ctx, calls } = fakeCtx();
      cjk.drawMorphResidual(ctx, resolveStyle(lightTheme, { fontSize: 10 }));
      equal(calls.filter((c) => c.op === 'fillText').map((c) => c.value).join(''), '递减');
      equal(calls.filter((c) => c.op === 'save').length, calls.filter((c) => c.op === 'restore').length);
      const plain = fakeCtx();
      t.drawMorphResidual(plain.ctx, style);
      equal(plain.calls.filter((c) => c.op === 'fill' || c.op === 'fillText').length, 0, '没有中文时什么都不画');
    },
  ],
  [
    '\\class / \\cssId 给子式起名:图元带所在部分(外层在前),layout.parts 按名字给下标;MathJax 内部的 mjx- 类不算',
    () => {
      // 阅读顺序:a 2 + b 2 = c 2
      const l = typesetTex('\\class{lhs}{a^2}+b^2=\\cssId{rhs}{c^2}');
      equal(l.primitives.length, 8);
      equal(JSON.stringify(l.parts.get('lhs')), '[0,1]');
      equal(JSON.stringify(l.parts.get('rhs')), '[6,7]');
      equal(JSON.stringify(l.primitives.map((p) => p.parts.join('/'))), '["lhs","lhs","","","","","rhs","rhs"]');
      const nested = typesetTex('\\class{outer}{x+\\class{inner}{y}}');
      equal(JSON.stringify(nested.primitives.map((p) => p.parts)), '[["outer"],["outer"],["outer","inner"]]');
      equal(JSON.stringify(nested.parts.get('outer')), '[0,1,2]');
      equal(JSON.stringify(typesetTex('\\class{a b}{x}').primitives[0]?.parts), '["a","b"]', '一个 \\class 可以带多个类名');
      const table = typesetTex('\\begin{array}{c|c}a&b\\end{array}');
      equal(table.primitives.at(-1)?.kind, 'stroke', '表格竖线');
      equal(table.parts.size, 0, 'MathJax 给表格线的 mjx-solid 类不该算成部分');
      // 起名不改变排版:同一条式子带不带 \\class,字形位置完全一样。
      const plain = typesetTex('a^2+b^2=c^2');
      equal(plain.width, l.width);
      l.primitives.forEach((p, i) => {
        const a = boundsOf(p);
        const b = boundsOf(plain.primitives[i]);
        close(a.minX, b.minX, 1e-9, `第 ${i} 个图元的位置变了`);
        close(a.maxY, b.maxY, 1e-9);
      });
    },
  ],
  [
    '身份键:同一字形同一字号相同,上标、行间大运算符不同(符号键仍相同);分数线不计长短;中文按文字内容',
    () => {
      const x = typesetTex('x').primitives[0];
      const x2 = typesetTex('y+x').primitives[2];
      const sup = typesetTex('a^x').primitives[1];
      equal(x2?.key, x?.key);
      ok(sup?.key !== x?.key, '上标的 x 字号不同,身份键应不同');
      equal(sup?.symbol, x?.symbol);
      const inline = typesetTex('\\sum').primitives[0];
      const display = typesetTex('\\sum', true).primitives[0];
      ok(inline?.key !== display?.key, '行间的求和号是另一个变体');
      equal(inline?.symbol, display?.symbol);
      const bar1 = typesetTex('\\frac{a}{b}').primitives.at(-1);
      const bar2 = typesetTex('\\frac{a+b}{c}').primitives.at(-1);
      equal(bar1?.symbol, 'rect:mfrac');
      equal(bar1?.key, bar2?.key, '分数线不计长短');
      ok(boundsOf(bar2).maxX > boundsOf(bar1).maxX + 0.3, '两条分数线确实不一样长');
      const su = typesetTex('\\text{速度}').primitives[0];
      const su2 = typesetTex('v=\\text{速}').primitives[2];
      equal(su?.kind, 'text');
      equal(su?.symbol, 'text:速');
      equal(su2?.key, su?.key);
    },
  ],
  [
    '嵌套 svg 视口(上划线、伸缩定界符的延长段):按 viewBox 换坐标并裁进视口,不再错位、伸出去',
    () => {
      const over = typesetTex('\\overline{AB}');
      const ab = typesetTex('AB');
      close(over.width, ab.width, 1e-9, '上划线不该把盒子撑宽');
      // 上划线横跨整个盒子(与 AB 同宽),以前是伸长 1.5 倍、往右错出去一截。
      const line = boundsOf(over.primitives[2]);
      close(line.minX, -over.width / 2, 1e-6);
      close(line.maxX, over.width / 2, 1e-6);
      // 四行矩阵的圆括号:上钩、下钩、中间延长段 —— 延长段应接在两钩之间(略有重叠),不能偏到一边。
      const paren = typesetTex('\\left(\\begin{matrix}a\\\\b\\\\c\\\\d\\end{matrix}\\right)');
      const [top, bottom, ext] = [paren.primitives[0], paren.primitives[1], paren.primitives[2]].map(boundsOf);
      ok(top !== undefined && bottom !== undefined && ext !== undefined);
      if (top && bottom && ext) {
        ok(ext.minY < top.maxY && ext.minY > top.minY, `延长段上端 ${ext.minY} 应接进上钩 [${top.minY}, ${top.maxY}]`);
        ok(ext.maxY > bottom.minY && ext.maxY < bottom.maxY, `延长段下端 ${ext.maxY} 应接进下钩 [${bottom.minY}, ${bottom.maxY}]`);
      }
      equal(paren.primitives[2]?.key, typesetTex('\\left(\\begin{matrix}a\\\\b\\\\c\\end{matrix}\\right)').primitives[2]?.key, '延长段不计伸缩量');
    },
  ],
  [
    '\\boxed 的框描边(不画成实心块);\\href 的点击热区不画;\\style{color:…} 设的颜色生效',
    () => {
      const boxed = typesetTex('\\boxed{x}');
      equal(boxed.primitives.map((p) => p.kind).join(','), 'fill,stroke');
      ok(boxed.primitives.every((p) => p.color !== 'none'), '不该出现颜色为 none 的图元');
      const calls = draw(new Tex('\\boxed{x}').setStyle({ fontSize: 20 }));
      ok(!calls.some((c) => c.op === '=fillStyle' && c.value === 'none'));
      equal(calls.filter((c) => c.op === 'stroke').length, 1, '框应描一次边');
      equal(typesetTex('\\href{https://example.com}{x}').primitives.length, 1, '热区矩形不该算成图元');
      const styled = typesetTex('\\style{color:red}{x}+y');
      equal(styled.primitives[0]?.color, 'red');
      equal(styled.primitives[2]?.color, null, '\\style 只管它包住的部分');
    },
  ],
  [
    'partLayers:按名字取某一部分的分层几何(强调公式里的某一项用),partNames 按出现顺序列出部分',
    () => {
      const t = new Tex('\\class{lhs}{a^2}+b^2=\\class{rhs}{c^2}');
      const style = resolveStyle(lightTheme, { fontSize: 20 });
      const all = t.pathLayers(style);
      const lhs = t.partLayers('lhs', style);
      equal(lhs.length, 2);
      const same = (a: PathLayer | undefined, b: PathLayer | undefined): boolean =>
        a !== undefined && b !== undefined && JSON.stringify(pathBounds(a.path)) === JSON.stringify(pathBounds(b.path));
      ok(same(lhs[0], all[0]) && same(lhs[1], all[1]), 'lhs 应是 a 与上标 2');
      ok(same(t.partLayers('rhs', style)[1], all[7]), 'rhs 的第二层应是最后的上标 2');
      equal(t.partLayers('nope', style).length, 0);
      equal(t.partNames.join(','), 'lhs,rhs');
      const layers = t.primitiveLayers(style);
      equal(layers.length, t.layout().primitives.length, '逐图元几何应与图元一一对应');
      equal(new Tex('\\text{速}x').primitiveLayers(style)[0], null, '画布文字没有几何');
      ok(t.primitiveLayers(resolveStyle(lightTheme, { fontSize: 0 })).every((l) => l === null), '字号为 0 时没有几何');
    },
  ],
]);
