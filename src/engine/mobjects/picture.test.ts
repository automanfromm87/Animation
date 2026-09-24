import { installAssetStub } from '../../testing/assetStub';
import { close, equal, fakeCtx, ok, stateAt, suite, throws } from '../../testing/harness';
import type { FakeCtxCall } from '../../testing/harness';
import { ColorTo } from '../animations/styleTween';
import { Create, FadeIn, MoveTo, RotateTo, ScaleTo } from '../animations/primitives';
import { thereAndBack } from '../animations/rateFunctions';
import { Transform } from '../animations/transform';
import { Write } from '../animations/write';
import { AssetError } from '../assets/errors';
import type { ImageAsset } from '../assets/registry';
import { createImageAsset, loadImage } from '../assets/registry';
import { lightTheme } from '../theme/presets';
import { worldBoundsOf } from './bounds';
import { Group } from './Group';
import type { MObject } from './MObject';
import { Picture } from './picture';
import { Circle } from './shapes';

/** 桩图像源:200×100,drawImage 收到的就是它。 */
const SOURCE = { stub: 'earth' };

function asset(width = 200, height = 100, source: object | null = SOURCE): ImageAsset {
  return source ? createImageAsset(source as CanvasImageSource, width, height, 'earth') : { kind: 'image', src: 'x', width, height, source: null };
}

function draw(m: MObject): FakeCtxCall[] {
  const { ctx, calls } = fakeCtx();
  m.render(ctx, lightTheme);
  return calls;
}

function drawImages(calls: readonly FakeCtxCall[]): FakeCtxCall[] {
  return calls.filter((c) => c.op === 'drawImage');
}

export default suite('Picture 位图图元', [
  [
    '尺寸:按 width 等比、只给 height、contain / cover / fill、都不给按原图',
    () => {
      const a = asset();
      const w = new Picture(a, { width: 300 });
      equal(`${w.width}x${w.height}`, '300x150');
      const h = new Picture(a, { height: 50 });
      equal(`${h.width}x${h.height}`, '100x50');
      const contain = new Picture(a, { width: 300, height: 300 });
      equal(`${contain.width}x${contain.height}`, '300x150');
      const fill = new Picture(a, { width: 300, height: 300, fit: 'fill' });
      equal(`${fill.width}x${fill.height}`, '300x300');
      const natural = new Picture(a);
      equal(`${natural.width}x${natural.height}`, '200x100');
      equal(`${natural.naturalWidth}x${natural.naturalHeight}`, '200x100');
      const cover = new Picture(a, { width: 300, height: 300, fit: 'cover' });
      equal(`${cover.width}x${cover.height}`, '300x300');
      const [img] = drawImages(draw(cover));
      equal(img?.args.join(','), '50,0,100,100,-150,-150,300,300', 'cover:源矩形居中裁');
      natural.setSize({ width: 50 });
      equal(`${natural.width}x${natural.height}`, '50x25');
    },
  ],
  [
    '参数校验:width / height 要正的有限数,fit 取值合法',
    () => {
      throws(() => new Picture(asset(), { width: NaN }));
      throws(() => new Picture(asset(), { height: -1 }));
      throws(() => new Picture(asset(), { width: 1, height: 1, fit: 'stretch' as 'fill' }));
      let message = '';
      try {
        new Picture(asset(), { width: 0 });
      } catch (e) {
        message = (e as Error).message;
      }
      equal(message, 'Picture 的 width 需要正的有限数,收到 0');
    },
  ],
  [
    '包围盒、剔除半径、缩放与旋转后的世界盒',
    () => {
      const p = new Picture(asset(), { width: 300 });
      equal(`${p.getBox().size.w}x${p.getBox().size.h}`, '300x150');
      close(p.getCullRadius(), Math.hypot(300, 150) / 2);
      p.scale = 2;
      p.rotation = Math.PI / 2;
      p.moveTo({ x: 10, y: 20 });
      const b = worldBoundsOf([p]);
      close(b?.minX ?? NaN, 10 - 150, 1e-9);
      close(b?.maxX ?? NaN, 10 + 150, 1e-9);
      close(b?.minY ?? NaN, 20 - 300, 1e-9);
      close(b?.maxY ?? NaN, 20 + 300, 1e-9);
    },
  ],
  [
    '绘制:drawImage(源, 源矩形, 以原点为中心的目标矩形),变换在前,透明度累积',
    () => {
      const p = new Picture(asset(), { width: 300 });
      p.moveTo({ x: 5, y: 6 });
      p.opacity = 0.5;
      const g = new Group().add(p);
      g.opacity = 0.5;
      const calls = draw(g);
      const imgs = drawImages(calls);
      equal(imgs.length, 1);
      equal(imgs[0]?.value, SOURCE);
      equal(imgs[0]?.args.join(','), '0,0,200,100,-150,-75,300,150');
      equal(stateAt(calls, 'drawImage', 'globalAlpha'), 0.25);
      equal(stateAt(calls, 'drawImage', 'imageSmoothingEnabled'), true);
      equal(stateAt(calls, 'drawImage', 'imageSmoothingQuality'), 'high');
      const ops = calls.map((c) => c.op);
      const at = (op: string): number => ops.lastIndexOf(op, ops.indexOf('drawImage'));
      ok(at('translate') < at('rotate') && at('rotate') < at('scale') && at('scale') < ops.indexOf('drawImage'));
      p.smoothing = false;
      equal(stateAt(draw(p), 'drawImage', 'imageSmoothingEnabled'), false);
    },
  ],
  [
    'Create:从左往右擦出(源宽与目标宽同比例,左边不动);先收起不画;终态完整;往返缓动收尾不画',
    () => {
      const p = new Picture(asset(), { width: 300 });
      p.setRevealFraction(0);
      equal(drawImages(draw(p)).length, 0, 'unrevealed 后不画');
      const create = new Create(p);
      create.begin();
      create.interpolate(0.5);
      equal(drawImages(draw(p))[0]?.args.join(','), '0,0,100,100,-150,-75,150,150');
      create.interpolate(0.25);
      equal(drawImages(draw(p))[0]?.args.join(','), '0,0,50,100,-150,-75,75,150');
      create.finish();
      equal(p.getRevealFraction(), null);
      equal(drawImages(draw(p))[0]?.args.join(','), '0,0,200,100,-150,-75,300,150');
      const back = new Create(p, { rateFunc: thereAndBack });
      back.begin();
      back.interpolate(0.7);
      back.finish();
      equal(drawImages(draw(p)).length, 0, 'thereAndBack 收尾回到没画出来');
    },
  ],
  [
    'node 干跑(source 为 null):不画、不抛错,尺寸照常',
    () => {
      const p = new Picture(asset(200, 100, null), { width: 100 });
      equal(p.height, 50);
      equal(drawImages(draw(p)).length, 0);
    },
  ],
  [
    '字符串构造:没预加载抛 AssetError(not-loaded);预加载后同步可用',
    async () => {
      let error: unknown = null;
      try {
        new Picture('/img/nope.png', { width: 10 });
      } catch (e) {
        error = e;
      }
      ok(error instanceof AssetError && error.code === 'not-loaded', String(error));
      const stub = installAssetStub({ images: { '/img/earth.png': { width: 400, height: 200 } } });
      try {
        await loadImage('/img/earth.png');
        const p = new Picture('/img/earth.png', { width: 100 });
        equal(p.height, 50);
        const [img] = drawImages(draw(p));
        equal((img?.value as { stub?: string } | undefined)?.stub, '/img/earth.png');
      } finally {
        stub.restore();
      }
    },
  ],
  [
    'Write:在自己的时段里淡入,结束撤掉覆盖层',
    () => {
      const p = new Picture(asset(), { width: 300 });
      const write = new Write(p);
      write.begin();
      equal(drawImages(draw(p)).length, 0, '开头什么都没有');
      write.interpolate(0.5);
      const calls = draw(p);
      equal(drawImages(calls).length, 1);
      close(Number(stateAt(calls, 'drawImage', 'globalAlpha')), 0.5, 1e-9);
      write.finish();
      equal(p.getMorphOverlay(), null);
      equal(stateAt(draw(p), 'drawImage', 'globalAlpha'), 1);
    },
  ],
  [
    'Transform / ColorTo / FadeIn / MoveTo / ScaleTo / RotateTo 都能用,终态正确',
    () => {
      const p = new Picture(asset(), { width: 300 });
      const t = new Transform(p, new Circle(40));
      t.begin();
      t.interpolate(0.5);
      ok(draw(p).length > 0);
      t.finish();
      equal(p.opacity, 0, '替换语义:结束时藏起源');
      p.opacity = 1;
      const c = new ColorTo(p, 'red');
      c.begin();
      c.interpolate(1);
      equal(drawImages(draw(p)).length, 1, '着色对位图无效,但照常画');
      p.opacity = 0;
      const anims = [new FadeIn(p), new MoveTo(p, { x: 10, y: 0 }), new ScaleTo(p, 2), new RotateTo(p, 1)];
      for (const a of anims) {
        a.begin();
        a.interpolate(0.5);
        a.finish();
      }
      equal(p.opacity, 1);
      equal(p.position.x, 10);
      equal(p.scale, 2);
      equal(p.rotation, 1);
    },
  ],
]);
