import { close, equal, fakeCtx, ok, stateAt, suite, throws } from '../../testing/harness';
import { Group } from '../mobjects/Group';
import { Circle, Rectangle } from '../mobjects/shapes';
import { MObject } from '../mobjects/MObject';
import type { Box } from '../mobjects/types';
import { boxFromSize, bumpMeasureGeneration } from '../mobjects/types';
import { lightTheme } from '../theme/presets';
import { Layout } from './Layout';

/** 一行 [a, b] 两个定宽矩形(高 20),返回两者的中心 x。 */
function rowOf(width: number, widths: [number, number], options: ConstructorParameters<typeof Layout>[2]): [number, number] {
  const root = new Layout(width, 100, { direction: 'row', padding: 0, ...options });
  const a = new Rectangle(widths[0], 20);
  const b = new Rectangle(widths[1], 20);
  root.place(a);
  root.place(b);
  root.layout();
  return [a.position.x, b.position.x];
}

/** 模拟用网页字体量宽度的文字(比如 Label):字体到之前按回退字体量出宽 20,到了之后宽 40。 */
class LateFontText extends MObject {
  static arrived = false;

  override getBox(): Box {
    return boxFromSize(LateFontText.arrived ? 40 : 20, 10);
  }

  protected override drawShape(): void {
    // 只测排版,不画。
  }
}

/** 跑 body;fontsArrive() 之后同样的文字量出来变宽。 */
function withLateFonts(body: (fontsArrive: () => void) => void): void {
  LateFontText.arrived = false;
  try {
    body(() => {
      LateFontText.arrived = true;
    });
  } finally {
    LateFontText.arrived = false;
  }
}

export default suite('Layout', [
  [
    'row + center:单个子元素落在容器中心',
    () => {
      const root = new Layout(200, 100, { direction: 'row', justify: 'center' });
      const box = new Rectangle(40, 20);
      root.place(box);
      root.layout();
      close(box.position.x, 0, 1e-9);
      close(box.position.y, 0, 1e-9);
    },
  ],
  [
    'column + gap:相邻子元素间距等于 gap',
    () => {
      const root = new Layout(100, 300, { direction: 'column', gap: 10, padding: 0 });
      const a = new Rectangle(20, 40);
      const b = new Rectangle(20, 60);
      root.place(a);
      root.place(b);
      root.layout();
      const gapBetween = b.position.y - 30 - (a.position.y + 20);
      close(gapBetween, 10, 1e-9);
    },
  ],
  [
    'flex 子容器被拉伸填满剩余主轴空间',
    () => {
      const root = new Layout(600, 100, { direction: 'row', gap: 0, padding: 0 });
      const fixed = new Rectangle(100, 20);
      const panel = new Layout(50, 80);
      root.place(fixed);
      root.place(panel, 1);
      root.layout();
      close(panel.width, 500, 1e-9);
    },
  ],
  [
    '缩小容器后重排,flex 子容器会跟着收缩(不再只涨不缩)',
    () => {
      const root = new Layout(600, 100, { direction: 'row', gap: 0, padding: 0 });
      const fixed = new Rectangle(100, 20);
      const panel = new Layout(50, 80);
      root.place(fixed);
      root.place(panel, 1);
      root.layout();
      equal(panel.width, 500);
      root.setSize(400, 100);
      root.layout();
      close(panel.width, 300, 1e-9);
    },
  ],
  [
    '重复 layout() 是幂等的',
    () => {
      const root = new Layout(400, 100, { direction: 'row', gap: 8, padding: 4 });
      const a = new Circle(20);
      const panel = new Layout(30, 40);
      root.place(a);
      root.place(panel, 1);
      root.layout();
      const firstX = a.position.x;
      const firstW = panel.width;
      root.layout();
      root.layout();
      close(a.position.x, firstX, 1e-9);
      close(panel.width, firstW, 1e-9);
    },
  ],
  [
    'space-between 把剩余空间摊给间隙',
    () => {
      const root = new Layout(300, 50, {
        direction: 'row',
        justify: 'space-between',
        padding: 0,
        gap: 0,
      });
      const a = new Rectangle(50, 10);
      const b = new Rectangle(50, 10);
      root.place(a);
      root.place(b);
      root.layout();
      close(a.position.x, -125, 1e-9);
      close(b.position.x, 125, 1e-9);
    },
  ],
  [
    'remove 会一并清掉 flex 记录',
    () => {
      const root = new Layout(200, 50);
      const a = new Rectangle(10, 10);
      root.place(a, 2);
      equal(root.getFlex(a), 2);
      root.remove(a);
      equal(root.getFlex(a), 0);
      equal(root.getChildren().length, 0);
    },
  ],
  [
    '空容器 layout() 不抛错',
    () => {
      const root = new Layout(100, 100);
      root.layout();
      ok(true);
    },
  ],
  [
    '不裁剪时剔除半径要覆盖溢出的子元素(否则靠边时整块内容闪失)',
    () => {
      const lay = new Layout(20, 20, { padding: 0 });
      lay.place(new Circle(100));
      lay.layout();
      ok(
        lay.getCullRadius() >= 100,
        `剔除半径 ${lay.getCullRadius()} 没盖住半径 100 的子元素`,
      );
    },
  ],
  [
    'clip:true 时自身盒就是严格上界',
    () => {
      const lay = new Layout(20, 20, { padding: 0, clip: true });
      lay.place(new Circle(100));
      lay.layout();
      close(lay.getCullRadius(), Math.hypot(20, 20) / 2, 1e-9);
    },
  ],
  [
    '重复 place 同一子元素只更新 flex,不重复占槽;remove 后 flex 记录一并清掉',
    () => {
      const lay = new Layout(100, 100);
      const c = new Circle(5);
      lay.place(c, 2);
      lay.place(c, 3);
      equal(lay.getChildren().length, 1);
      equal(lay.getFlex(c), 3);
      lay.remove(c);
      equal(lay.getChildren().length, 0);
      equal(lay.getFlex(c), 0);
      // 不是子元素的对象 setFlex 被忽略,不留幽灵条目。
      lay.setFlex(c, 5);
      equal(lay.getFlex(c), 0);
    },
  ],
  [
    '负缩放的子元素按外接盒占位,不和兄弟重叠',
    () => {
      const row = new Layout(300, 60, { gap: 10 });
      const a = new Rectangle(50, 20);
      a.scale = -1;
      const b = new Rectangle(50, 20);
      row.place(a).place(b);
      row.layout();
      close(a.position.x, -125, 1e-9);
      close(b.position.x, -65, 1e-9);
    },
  ],
  [
    '被拉伸的子容器扣除自身缩放;转 90° 时宽高互换',
    () => {
      const row = new Layout(500, 100);
      const half = new Layout(0, 0);
      half.scale = 0.5;
      row.place(half, 1);
      row.layout();
      close(half.width * 0.5, 500, 1e-9, `缩放 0.5 的面板只占了 ${half.width * 0.5}`);
      close(half.height * 0.5, 100, 1e-9);
      const row2 = new Layout(600, 100);
      const turned = new Layout(0, 0);
      turned.rotation = Math.PI / 2;
      row2.place(turned, 1);
      row2.layout();
      close(turned.height, 600, 1e-6, '转 90° 的面板主轴应该是它的高');
      close(turned.width, 100, 1e-6);
    },
  ],
  [
    'justify:center 溢出时两侧对称溢出(与 CSS 一致),不退化成贴左',
    () => {
      const row = new Layout(100, 40, { justify: 'center' });
      const a = new Rectangle(80, 20);
      const b = new Rectangle(80, 20);
      row.place(a).place(b);
      row.layout();
      close(a.position.x, -40, 1e-9);
      close(b.position.x, 40, 1e-9);
    },
  ],
  [
    'clip 与 frame 同开:先撤裁剪再画框,框线不会被裁掉一半',
    () => {
      const lay = new Layout(40, 40, { clip: true, frame: { stroke: '#ccc', strokeWidth: 3 } });
      lay.place(new Circle(5));
      const { ctx, calls } = fakeCtx();
      lay.render(ctx, lightTheme);
      const ops = calls.map((c) => c.op);
      const clipAt = ops.indexOf('clip');
      const rectAt = ops.indexOf('strokeRect');
      ok(clipAt >= 0 && rectAt > clipAt);
      ok(ops.slice(clipAt, rectAt).includes('restore'), '画框前没有撤掉裁剪');
      equal(stateAt(calls, 'strokeRect', 'strokeStyle'), '#ccc');
      equal(stateAt(calls, 'strokeRect', 'lineWidth'), 3);
    },
  ],
  [
    '边框样式独立于子元素:frame 对象不改动子元素的描边',
    () => {
      const lay = new Layout(40, 40, { frame: { stroke: '#ccc' } });
      lay.place(new Circle(5));
      const { ctx, calls } = fakeCtx();
      lay.render(ctx, lightTheme);
      equal(stateAt(calls, 'stroke', 'strokeStyle'), lightTheme.stroke);
    },
  ],
  [
    '尺寸校验:负数或非有限的宽高直接拒绝',
    () => {
      throws(() => new Layout(Number.NaN, 10));
      throws(() => new Layout(10, -1));
      throws(() => new Layout(10, 10).setSize(Infinity, 10));
    },
  ],
  [
    'gap 与 padding 同一口径:负数与非有限值按 0',
    () => {
      equal(new Layout(100, 100, { gap: -10 }).gap, 0);
      equal(new Layout(100, 100, { gap: Number.NaN }).gap, 0);
      equal(new Layout(100, 100, { padding: -3 }).padding, 0);
      equal(new Layout(100, 100, { gap: 6 }).gap, 6);
    },
  ],
  [
    'align start / end:交叉轴贴起始 / 末端(扣掉内边距)',
    () => {
      for (const [align, want] of [
        ['start', -30],
        ['end', 30],
        ['center', 0],
      ] as const) {
        const root = new Layout(200, 100, { direction: 'row', padding: 10, align });
        const box = new Rectangle(40, 20);
        root.place(box);
        root.layout();
        close(box.position.y, want, 1e-9, `align ${align}`);
      }
    },
  ],
  [
    'justify end 整体贴主轴末端;space-around 两端各留半个间隙',
    () => {
      const [ea, eb] = rowOf(200, [40, 40], { justify: 'end' });
      close(ea, 40, 1e-9);
      close(eb, 80, 1e-9);
      const [sa, sb] = rowOf(200, [40, 40], { justify: 'space-around' });
      close(sa, -50, 1e-9);
      close(sb, 50, 1e-9);
    },
  ],
  [
    '溢出时:end 向起始侧溢出,space-between 退化为 start,space-around 退化为 center(CSS 规则)',
    () => {
      const [ea, eb] = rowOf(100, [80, 80], { justify: 'end' });
      close(ea, -70, 1e-9);
      close(eb + 40, 50, 1e-9, 'end 溢出时末项的右边应贴住容器右边');
      const [ba, bb] = rowOf(100, [80, 80], { justify: 'space-between' });
      close(ba, -10, 1e-9);
      close(bb, 70, 1e-9);
      const [ca, cb] = rowOf(100, [80, 80], { justify: 'space-around' });
      close(ca, -40, 1e-9);
      close(cb, 40, 1e-9);
    },
  ],
  [
    '斜着转的子元素按旋转后的外接盒占位',
    () => {
      const root = new Layout(200, 100, { direction: 'row', padding: 0 });
      const a = new Rectangle(40, 20);
      const b = new Rectangle(40, 20);
      a.rotation = Math.PI / 4;
      b.rotation = Math.PI / 4;
      root.place(a);
      root.place(b);
      root.layout();
      const side = 60 / Math.SQRT2;
      close(a.position.x, -100 + side / 2, 1e-9);
      close(b.position.x, -100 + side * 1.5, 1e-9);
    },
  ],
  [
    '不拉伸的嵌套 Layout 用自己的尺寸占位,内部也递归排好',
    () => {
      const outer = new Layout(300, 100, { direction: 'row', padding: 0 });
      const inner = new Layout(100, 50, { direction: 'row', justify: 'end', padding: 0 });
      const leaf = new Rectangle(20, 10);
      inner.place(leaf);
      outer.place(inner);
      outer.layout();
      equal(inner.width, 100, '没有 flex 的子容器不该被拉伸');
      close(inner.position.x, -100, 1e-9);
      close(leaf.position.x, 40, 1e-9, '嵌套容器内部没有排布');
    },
  ],
  [
    'flex 子容器不小于自身内容尺寸:固定兄弟溢出时保住内容,而不是被压成 0',
    () => {
      const root = new Layout(100, 60, { direction: 'row', padding: 0 });
      const fixed = new Rectangle(150, 20);
      const panel = new Layout(10, 10, { direction: 'row', padding: 0 });
      panel.place(new Rectangle(60, 20));
      root.place(fixed);
      root.place(panel, 1);
      root.layout();
      close(panel.width, 60, 1e-9);
    },
  ],
  [
    'flex 份额比内容尺寸还小的项冻结在内容尺寸,剩余空间再分给其它 flex 项',
    () => {
      const root = new Layout(250, 60, { direction: 'row', padding: 0 });
      const fixed = new Rectangle(100, 20);
      const small = new Layout(10, 10, { padding: 0 });
      small.place(new Rectangle(20, 10));
      const wide = new Layout(10, 10, { padding: 0 });
      wide.place(new Rectangle(90, 10));
      root.place(fixed);
      root.place(small, 1);
      root.place(wide, 1);
      root.layout();
      close(wide.width, 90, 1e-9);
      close(small.width, 60, 1e-9);
    },
  ],
  [
    '字体加载完成后:排好之后没人动过的容器自动按新尺寸重排,挪过子元素的保持原样',
    () => {
      withLateFonts((fontsArrive) => {
        const make = (): { root: Layout; tex: LateFontText; box: Rectangle } => {
          const root = new Layout(300, 60, { direction: 'row', padding: 0, gap: 10 });
          const tex = new LateFontText();
          const box = new Rectangle(20, 20);
          root.place(tex);
          root.place(box);
          root.layout();
          return { root, tex, box };
        };
        const untouched = make();
        const moved = make();
        close(untouched.box.position.x, -150 + 20 + 10 + 10, 1e-9);
        moved.box.position = { x: 99, y: 0 };
        // 字体到了,同样的文字量出来更宽。
        fontsArrive();
        const nested = new Group().add(untouched.root);
        bumpMeasureGeneration();
        nested.onMeasurementsChanged();
        moved.root.onMeasurementsChanged();
        close(untouched.box.position.x, -150 + 40 + 10 + 10, 1e-9, '没人动过的容器应按新尺寸重排');
        equal(moved.box.position.x, 99, '手动挪过的子元素被重排拽回去了');
        // 代号没变时不重复重排。
        untouched.box.position = { x: 7, y: 0 };
        untouched.root.onMeasurementsChanged();
        equal(untouched.box.position.x, 7);
      });
    },
  ],
  [
    '自动重排的「没被动过」:子元素缩放/旋转被改过(比如 ScaleTo 播到一半)、嵌套容器里被挪过,都不重排',
    () => {
      withLateFonts((fontsArrive) => {
        const make = (): { root: Layout; tex: LateFontText; box: Rectangle; inner: Layout; leaf: Rectangle } => {
          const root = new Layout(400, 80, { direction: 'row', padding: 0, gap: 10 });
          const tex = new LateFontText();
          const box = new Rectangle(20, 20);
          const inner = new Layout(100, 60, { direction: 'row', padding: 0 });
          const leaf = new Rectangle(10, 10);
          inner.place(leaf);
          root.place(tex);
          root.place(box);
          root.place(inner);
          root.layout();
          return { root, tex, box, inner, leaf };
        };
        const scaled = make();
        const nested = make();
        const boxScaled = scaled.box.position.x;
        const boxNested = nested.box.position.x;
        scaled.box.scale = 0.5;
        nested.leaf.shift(25, 0);
        const leafX = nested.leaf.position.x;
        fontsArrive();
        bumpMeasureGeneration();
        scaled.root.onMeasurementsChanged();
        nested.root.onMeasurementsChanged();
        equal(scaled.box.position.x, boxScaled, '子元素缩放被改过还在重排(会按瞬时缩放排错位)');
        equal(nested.box.position.x, boxNested, '嵌套容器里被挪过还在重排外层');
        equal(nested.leaf.position.x, leafX, '重排抹掉了嵌套容器里的手动改动');
      });
    },
  ],
]);
