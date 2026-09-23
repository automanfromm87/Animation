import { equal, ok, suite } from '../testing/harness';
import {
  COMPOSITE_MIN_INTERVAL_MS,
  MIN_EXPORT_FRAMES,
  exportGeometry,
  exportSize,
  pickMimeType,
  shouldComposite,
  validateOutput,
} from './output';

export default suite('导出输出', [
  [
    '选容器:显式指定且支持就用它,不支持就报错而不是悄悄换格式',
    () => {
      const only = (types: string[]) => (t: string): boolean => types.includes(t);
      equal(pickMimeType('video/webm', only(['video/webm'])).mimeType, 'video/webm');
      const miss = pickMimeType('video/webm', only(['video/mp4']));
      equal(miss.error, 'unsupported-mime');
      equal(miss.mimeType, '');
    },
  ],
  [
    '选容器:自动时 mp4 优先,缺席退 webm;什么都不支持报 unsupported',
    () => {
      equal(pickMimeType(undefined, () => true).mimeType, 'video/mp4');
      equal(
        pickMimeType(undefined, (t) => t.startsWith('video/webm')).mimeType,
        'video/webm;codecs=vp9',
      );
      equal(pickMimeType(undefined, () => false).error, 'unsupported');
      // isTypeSupported 抛错按不支持处理,不能把异常漏出去。
      equal(
        pickMimeType(undefined, () => {
          throw new Error('boom');
        }).error,
        'unsupported',
      );
    },
  ],
  [
    '导出画幅:按长边封顶(竖屏限高),等比缩小不放大,尺寸取偶数',
    () => {
      const land = exportSize(3840, 2160, 1920);
      equal(land.width, 1920);
      equal(land.height, 1080);
      // 竖屏 9:16 高清屏:以前只限宽度会导出 1188×2112。
      const portrait = exportSize(2376, 4224, 1920);
      equal(portrait.height, 1920);
      ok(portrait.width % 2 === 0 && portrait.width < 1100, `竖屏宽度:${portrait.width}`);
      const small = exportSize(641, 481, 1920);
      equal(small.width, 642, '不放大,但要取偶');
      equal(small.height, 482);
    },
  ],
  [
    '导出几何:contain 居中,scale 按缓存的 css 宽度算',
    () => {
      const { rect, scale } = exportGeometry(2000, 1000, 1000, 1920, 1440);
      equal(rect.w, 1920);
      equal(rect.h, 960);
      equal(rect.y, 240);
      equal(scale, 1.92);
    },
  ],
  [
    '成片校验:帧数太少判合成端,字节太少判编码端,静态但正常的片子不误杀',
    () => {
      equal(validateOutput({ frames: MIN_EXPORT_FRAMES - 1, seconds: 30, bytes: 1e7 }), 'empty-output');
      // 真实故障的签名:3898 帧 / 32.5 秒 / 9 KB。
      equal(validateOutput({ frames: 3898, seconds: 32.5, bytes: 9 * 1024 }), 'encoder-starved');
      // 30 秒几乎静止的片子,VBR 只出 100 KB 左右:不能判成空。
      equal(validateOutput({ frames: 900, seconds: 30, bytes: 100 * 1024 }), null);
      // 不到 1 秒的片子不做字节判定。
      equal(validateOutput({ frames: 20, seconds: 0.8, bytes: 10 }), null);
    },
  ],
  [
    '合成节流:约 30fps,高刷屏上跳过多余的合成',
    () => {
      ok(shouldComposite(0, -Infinity), '第一帧必须合成');
      ok(!shouldComposite(16.7, 0), '60Hz 下一帧不该再合成');
      ok(shouldComposite(33.4, 0), '60Hz 隔一帧合成');
      ok(!shouldComposite(25, 0), '120Hz 第三帧还不该合成');
      ok(COMPOSITE_MIN_INTERVAL_MS < 1000 / 30, '留出抖动余量');
    },
  ],
]);
