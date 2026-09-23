import { createStubCanvas } from '../testing/domStub';
import { equal, ok, suite } from '../testing/harness';
import { containersFor, mediabunnyEncoder, probeEncodableContainers, webCodecsAvailable } from './encoder';

export default suite('离线编码端', [
  [
    '所选格式 → 容器:缺省 mp4 优先再 webm;带 codecs 参数、大小写不敏感;别的容器一个都不试',
    () => {
      equal(containersFor(undefined).join(','), 'mp4,webm');
      equal(containersFor('').join(','), 'mp4,webm');
      equal(containersFor('video/mp4;codecs=avc1.42E01E').join(','), 'mp4');
      equal(containersFor(' VIDEO/WEBM ').join(','), 'webm');
      equal(containersFor('video/ogg').length, 0);
    },
  ],
  [
    '没有 WebCodecs:探测报两种都不能编,编码端返回 null(调用方据此回退或报错)',
    async () => {
      ok(!webCodecsAvailable(), '测试环境不该有 VideoEncoder');
      const probe = await probeEncodableContainers();
      equal(probe.mp4, false);
      equal(probe.webm, false);
      const req = { canvas: createStubCanvas(), width: 1920, height: 1080, fps: 30 };
      // 编不了的容器不加载编码库;能识别的容器真去加载 mediabunny 并探测(按需加载的路径得真能走通)。
      equal(await mediabunnyEncoder({ ...req, mimeType: 'video/ogg' }), null);
      equal(await mediabunnyEncoder(req), null);
    },
  ],
]);
