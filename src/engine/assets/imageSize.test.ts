import { equal, suite } from '../../testing/harness';
import { imageSizeFromBytes } from './imageSize';

function bytes(...parts: Array<number[] | string>): Uint8Array {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === 'string') {
      for (let i = 0; i < p.length; i++) {
        out.push(p.charCodeAt(i));
      }
    } else {
      out.push(...p);
    }
  }
  return new Uint8Array(out);
}

const be32 = (v: number): number[] => [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
const le32 = (v: number): number[] => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
const le16 = (v: number): number[] => [v & 255, (v >>> 8) & 255];
const be16 = (v: number): number[] => [(v >>> 8) & 255, v & 255];
const le24 = (v: number): number[] => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255];

function describe(b: Uint8Array): string {
  const s = imageSizeFromBytes(b);
  return s ? `${s.format} ${s.width}x${s.height}` : 'null';
}

const PNG = bytes([0x89], 'PNG', [0x0d, 0x0a, 0x1a, 0x0a], be32(13), 'IHDR', be32(200), be32(100), [8, 6, 0, 0, 0]);

export default suite('资源 · 位图文件头尺寸', [
  ['PNG(IHDR)', () => equal(describe(PNG), 'png 200x100')],
  [
    'GIF87a / GIF89a(逻辑屏幕)',
    () => {
      equal(describe(bytes('GIF89a', le16(320), le16(240), [0, 0, 0])), 'gif 320x240');
      equal(describe(bytes('GIF87a', le16(1), le16(2), [0, 0, 0])), 'gif 1x2');
    },
  ],
  [
    'JPEG:跳过 APP0 / DHT,读 SOF0;渐进式 SOF2 也认',
    () => {
      const app0 = [0xff, 0xe0, ...be16(16), ...Array.from({ length: 14 }, () => 0)];
      const dht = [0xff, 0xc4, ...be16(4), 0, 0];
      const sof0 = [0xff, 0xc0, ...be16(17), 8, ...be16(480), ...be16(640), 3];
      equal(describe(bytes([0xff, 0xd8], app0, dht, sof0)), 'jpeg 640x480');
      const sof2 = [0xff, 0xc2, ...be16(17), 8, ...be16(10), ...be16(20), 3];
      equal(describe(bytes([0xff, 0xd8], [0xff, 0xff], app0, sof2)), 'jpeg 20x10');
      equal(describe(bytes([0xff, 0xd8], app0)), 'null', '截断:没有 SOF');
    },
  ],
  [
    'JPEG 的 EXIF 方向:5–8(手机竖拍)宽高互换,与浏览器摆正后一致;II / MM 两种字节序',
    () => {
      /** APP1:Exif 头 + TIFF 头 + IFD0(先放一个无关条目,再放方向)。 */
      const app1 = (orientation: number, le: boolean): number[] => {
        const u16 = le ? le16 : be16;
        const u32 = le ? le32 : be32;
        const tiff = [
          ...(le ? [0x49, 0x49] : [0x4d, 0x4d]),
          ...u16(42),
          ...u32(8),
          ...u16(2),
          ...u16(0x010f), ...u16(2), ...u32(4), 0x41, 0x42, 0x43, 0,
          ...u16(0x0112), ...u16(3), ...u32(1), ...u16(orientation), 0, 0,
          ...u32(0),
        ];
        const body = [0x45, 0x78, 0x69, 0x66, 0, 0, ...tiff];
        return [0xff, 0xe1, ...be16(body.length + 2), ...body];
      };
      // 4032×3024 的横向传感器图(SOF 里宽 4032、高 3024)。
      const sof0 = [0xff, 0xc0, ...be16(17), 8, ...be16(3024), ...be16(4032), 3];
      equal(describe(bytes([0xff, 0xd8], app1(6, true), sof0)), 'jpeg 3024x4032', '方向 6:顺时针转 90°');
      equal(describe(bytes([0xff, 0xd8], app1(8, false), sof0)), 'jpeg 3024x4032', '方向 8(MM)');
      equal(describe(bytes([0xff, 0xd8], app1(5, true), sof0)), 'jpeg 3024x4032');
      equal(describe(bytes([0xff, 0xd8], app1(3, true), sof0)), 'jpeg 4032x3024', '方向 3 只转 180°');
      equal(describe(bytes([0xff, 0xd8], app1(1, false), sof0)), 'jpeg 4032x3024');
      const notExif = [0xff, 0xe1, ...be16(8), 0x68, 0x74, 0x74, 0x70, 0, 0];
      equal(describe(bytes([0xff, 0xd8], notExif, sof0)), 'jpeg 4032x3024', 'XMP 之类的 APP1 不当 EXIF 读');
    },
  ],
  [
    'WebP:VP8 / VP8L / VP8X',
    () => {
      const riff = (chunk: string, body: number[]): Uint8Array =>
        bytes('RIFF', le32(100), 'WEBP', chunk, le32(body.length), body);
      // VP8 :帧头 3 字节 + 起始码 9d 01 2a,再是 14 位宽 / 高。
      equal(describe(riff('VP8 ', [0, 0, 0, 0x9d, 0x01, 0x2a, ...le16(400), ...le16(300), 0, 0])), 'webp 400x300');
      // VP8L:签名 0x2f,然后 14 位 (w-1)、14 位 (h-1)。
      const w = 99;
      const h = 49;
      const bits = w | (h << 14);
      equal(describe(riff('VP8L', [0x2f, ...le32(bits), 0, 0, 0, 0])), 'webp 100x50');
      equal(describe(riff('VP8X', [0, 0, 0, 0, ...le24(1023), ...le24(767), 0, 0])), 'webp 1024x768');
    },
  ],
  [
    'BMP:BITMAPINFOHEADER(负高度取绝对值)与 CORE 头',
    () => {
      const head = (dib: number[]): Uint8Array => bytes('BM', le32(0), le32(0), le32(54), dib);
      equal(describe(head([...le32(40), ...le32(64), ...le32(-32), 0, 0])), 'bmp 64x32');
      equal(describe(head([...le32(12), ...le16(8), ...le16(4), 0, 0, 0, 0, 0, 0])), 'bmp 8x4');
    },
  ],
  [
    'AVIF:ispe 盒',
    () => {
      equal(
        describe(bytes(be32(20), 'ftyp', 'avif', be32(0), 'mif1', be32(20), 'ispe', be32(0), be32(1920), be32(1080))),
        'avif 1920x1080',
      );
    },
  ],
  [
    'SVG 文本:与插画同一套尺寸规则',
    () => {
      equal(describe(bytes('\n <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 20"/>')), 'svg 30x20');
      equal(describe(bytes('<svg width="2in" height="1in"/>')), 'svg 192x96');
      equal(describe(bytes('<svg/>')), 'svg 300x150', '什么都量不出:按 300×150(与浏览器加载器一致)');
      equal(
        describe(bytes('<svg xmlns="http://www.w3.org/2000/svg"><text x="4" y="12">NEW</text></svg>')),
        'svg 300x150',
        '只有文字的徽章',
      );
    },
  ],
  [
    '截断与未知格式 → null',
    () => {
      equal(describe(PNG.slice(0, 20)), 'null');
      equal(describe(bytes('hello world')), 'null');
      equal(describe(new Uint8Array(0)), 'null');
      equal(describe(bytes('<html></html>')), 'null');
    },
  ],
]);
