import type { VideoCodec } from 'mediabunny';

/**
 * 离线导出的视频编码端:把编码画布的当前内容按给定时间戳编成一帧,收尾交出成片。
 * 时间戳由调用方按帧号精确给出(帧号 / 帧率),与墙钟无关 —— 这正是离线导出的意义。
 */
export interface VideoEncoderSink {
  /** 实际选用的容器(如 'video/mp4')。成片 Blob 的类型以它为准。 */
  readonly mimeType: string;
  /** 实际选用的编码(如 'avc'),诊断用。 */
  readonly codec: string;
  /** 把画布当前内容编成一帧(秒)。返回的 Promise 用来施加编码器背压:await 它再画下一帧。 */
  addFrame(timestamp: number, duration: number): Promise<void>;
  /** 收尾并交出成片。 */
  finish(): Promise<Blob>;
  /** 放弃:释放编码器,不交成片。 */
  cancel(): Promise<void>;
}

export interface EncoderRequest {
  /** 要编码的画布(合成好的导出帧)。 */
  canvas: HTMLCanvasElement;
  width: number;
  height: number;
  fps: number;
  /** 指定容器('video/mp4' / 'video/webm',可带 codecs 参数);缺省自动选(mp4 优先)。 */
  mimeType?: string;
}

/** 编码端工厂:当前环境编不了请求的容器时返回 null(调用方据此回退实时录制或报 unsupported-mime)。 */
export type EncoderFactory = (req: EncoderRequest) => Promise<VideoEncoderSink | null>;

/** 浏览器有没有 WebCodecs 编码器(同步粗判;具体编码能不能用要等工厂探测)。 */
export function webCodecsAvailable(): boolean {
  return typeof VideoEncoder !== 'undefined';
}

type Container = 'mp4' | 'webm';

/** 每种容器按兼容性排的候选编码:mp4 首选 H.264(几乎所有播放器都能放),webm 首选 VP9。 */
const CODECS: Readonly<Record<Container, readonly VideoCodec[]>> = {
  mp4: ['avc', 'hevc', 'av1', 'vp9'],
  webm: ['vp9', 'vp8', 'av1'],
};

/** 请求的 mimeType → 按顺序尝试的容器。缺省自动时 mp4 优先。 */
export function containersFor(mimeType: string | undefined): Container[] {
  const want = (mimeType ?? '').trim().toLowerCase();
  if (want === '') {
    return ['mp4', 'webm'];
  }
  if (want.startsWith('video/mp4')) {
    return ['mp4'];
  }
  if (want.startsWith('video/webm')) {
    return ['webm'];
  }
  return [];
}

/**
 * mediabunny(WebCodecs)编码端:按容器挑第一个浏览器编得了的编码,
 * H.264/HEVC/AV1/VP9 进 MP4,VP9/VP8/AV1 进 WebM;成片写在内存里(BufferTarget)。
 * 编码库按需加载:真正导出(或探测可导出格式)时才下载,不占首屏和影片分块。
 */
export const mediabunnyEncoder: EncoderFactory = async (req) => {
  const containers = containersFor(req.mimeType);
  if (containers.length === 0) {
    return null;
  }
  const {
    BufferTarget,
    CanvasSource,
    Mp4OutputFormat,
    Output,
    Quality,
    WebMOutputFormat,
    getFirstEncodableVideoCodec,
  } = await import('mediabunny');
  for (const container of containers) {
    const codec = await getFirstEncodableVideoCodec([...CODECS[container]], {
      width: req.width,
      height: req.height,
      frameRate: req.fps,
    });
    if (!codec) {
      continue;
    }
    const target = new BufferTarget();
    const format =
      container === 'mp4' ? new Mp4OutputFormat({ fastStart: 'in-memory' }) : new WebMOutputFormat();
    const output = new Output({ format, target });
    const source = new CanvasSource(req.canvas, {
      codec,
      quality: new Quality('high'),
      keyFrameInterval: 2,
    });
    output.addVideoTrack(source, { frameRate: req.fps });
    try {
      await output.start();
    } catch (e) {
      await output.cancel().catch(() => undefined);
      throw e;
    }
    const mimeType = format.mimeType;
    return {
      mimeType,
      codec,
      addFrame: (timestamp, duration) => source.add(timestamp, duration),
      finish: async () => {
        await output.finalize();
        const buffer = target.buffer;
        if (!buffer) {
          throw new Error('编码器收尾后没有交出数据');
        }
        return new Blob([buffer], { type: mimeType });
      },
      cancel: async () => {
        if (output.state !== 'finalized' && output.state !== 'canceled') {
          await output.cancel();
        }
      },
    };
  }
  return null;
};

/**
 * 浏览器能离线编码哪些容器(各按自己的候选编码探测,1080p / 30fps)。
 * 没有 WebCodecs 或探测出错按「不能编」处理。宿主据此把离线能编的格式并进下拉框。
 */
export async function probeEncodableContainers(): Promise<{ mp4: boolean; webm: boolean }> {
  if (!webCodecsAvailable()) {
    return { mp4: false, webm: false };
  }
  const probe = async (container: Container): Promise<boolean> => {
    try {
      const { getFirstEncodableVideoCodec } = await import('mediabunny');
      const codec = await getFirstEncodableVideoCodec([...CODECS[container]], {
        width: 1920,
        height: 1080,
        frameRate: 30,
      });
      return codec !== null;
    } catch {
      return false;
    }
  };
  const [mp4, webm] = await Promise.all([probe('mp4'), probe('webm')]);
  return { mp4, webm };
}
