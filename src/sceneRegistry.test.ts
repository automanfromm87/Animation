import type { ExportAudioReport } from './export/types';
import type { FilmController, FilmState } from './film/types';
import { FilmError, OPUS_IN_MP4_NOTE } from './export/types';
import {
  DEFAULT_SCENE,
  ASPECT_IDS,
  SCENES,
  aspectSearch,
  downloadName,
  exportAudioMessage,
  exportErrorMessage,
  fromFilm,
  isUserCancel,
  previewSearch,
  progressPercent,
  resolveAspect,
  resolvePreviewSeconds,
  resolveSceneId,
  resolveStoryboardParam,
  supportedFormats,
} from './sceneRegistry';
import { equal, ok, suite } from './testing/harness';

export default suite('场景注册表', [
  [
    '?scene= 只认注册表自己的键,原型链上的名字回落到默认场景',
    () => {
      equal(resolveSceneId('?scene=film'), 'film');
      equal(resolveSceneId('?scene=derivatives'), 'derivatives');
      equal(resolveSceneId(''), DEFAULT_SCENE);
      for (const bad of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'nope']) {
        equal(resolveSceneId(`?scene=${bad}`), DEFAULT_SCENE, bad);
      }
    },
  ],
  [
    '?preview= 只认非负有限数字,非法值回落正常播放;只有影片条目能预览',
    () => {
      equal(resolvePreviewSeconds('?scene=film&preview=480'), 480);
      equal(resolvePreviewSeconds('?preview=3.5'), 3.5);
      equal(resolvePreviewSeconds('?preview=0'), 0);
      equal(resolvePreviewSeconds('?scene=film'), null);
      equal(resolvePreviewSeconds('?preview='), null);
      equal(resolvePreviewSeconds('?preview=nope'), null);
      equal(resolvePreviewSeconds('?preview=-3'), null);
      equal(resolvePreviewSeconds('?preview=Infinity'), null);
      equal(typeof SCENES.film.preview, 'function');
      equal(typeof SCENES.derivatives.preview, 'function');
      equal(typeof SCENES.topology.preview, 'function');
      equal('preview' in SCENES.overview, false);
      equal('preview' in SCENES.pythagoras, false);
    },
  ],
  [
    '&storyboard 有这个参数(值可以为空)就进故事板模式,原文交给影片层解析;只有影片条目有故事板',
    () => {
      equal(resolveStoryboardParam('?scene=film&storyboard'), '');
      equal(resolveStoryboardParam('?scene=film&storyboard='), '');
      equal(resolveStoryboardParam('&storyboard=12'), '12');
      equal(resolveStoryboardParam('?scene=film&storyboard=3,10.5'), '3,10.5');
      equal(resolveStoryboardParam('?scene=film&storyboard=segments'), 'segments');
      // URL 里的 + 解码成空格(时刻列表的分隔符之一)。
      equal(resolveStoryboardParam('?storyboard=3+10.5'), '3 10.5');
      equal(resolveStoryboardParam('?scene=film'), null);
      equal(resolveStoryboardParam(''), null);
      for (const id of ['film', 'derivatives', 'topology', 'voicedemo'] as const) {
        equal(typeof SCENES[id].storyboard, 'function', id);
      }
      equal('storyboard' in SCENES.overview, false);
      equal('storyboard' in SCENES.pythagoras, false);
    },
  ],
  [
    '缩略图点进单帧预览的查询串:去掉 storyboard、写上 preview,其余参数保留;非法秒数按 0',
    () => {
      equal(previewSearch('?scene=film&storyboard=3,5', 12.37), '?scene=film&preview=12.37');
      equal(previewSearch('?scene=film&storyboard', 5.366666666666667), '?scene=film&preview=5.366667');
      equal(previewSearch('?scene=film&storyboard=segments', -3), '?scene=film&preview=0');
      equal(previewSearch('?scene=film&storyboard', Number.NaN), '?scene=film&preview=0');
      equal(previewSearch('?scene=topology&x=1&storyboard=24&preview=9', 2), '?scene=topology&x=1&preview=2');
      equal(resolvePreviewSeconds(previewSearch('?scene=film&storyboard', 42.5)), 42.5);
      equal(resolveStoryboardParam(previewSearch('?scene=film&storyboard=3', 1)), null);
      // 画幅跟着走:竖屏故事板点进去的单帧预览也是竖屏。
      const fromPortrait = previewSearch('?scene=derivatives&storyboard=segments&aspect=w9h16', 5);
      equal(fromPortrait, '?scene=derivatives&aspect=w9h16&preview=5');
      equal(resolveAspect(fromPortrait), 'w9h16');
    },
  ],
  [
    '&aspect= 画幅:认得的四种原样取,没有 / 认不出按 full;写回地址时 full 删参数、其余参数保留',
    () => {
      for (const id of ASPECT_IDS) {
        equal(resolveAspect(`?scene=film&aspect=${id}`), id);
      }
      equal(resolveAspect('?scene=film'), 'full');
      equal(resolveAspect('?aspect=W9H16'), 'full');
      equal(resolveAspect('?aspect=constructor'), 'full');
      equal(resolveAspect(''), 'full');
      equal(aspectSearch('?scene=film&storyboard', 'w9h16'), '?scene=film&storyboard=&aspect=w9h16');
      equal(aspectSearch('?scene=film&aspect=w9h16&storyboard=24', 'w4h3'), '?scene=film&aspect=w4h3&storyboard=24');
      equal(aspectSearch('?scene=film&aspect=w9h16', 'full'), '?scene=film');
      equal(aspectSearch('?aspect=w9h16', 'full'), '');
      equal(aspectSearch('', 'full'), '');
      equal(aspectSearch('', 'w16h9'), '?aspect=w16h9');
    },
  ],
  [
    '每个入口都有标题、类型与懒加载函数',
    () => {
      for (const [id, entry] of Object.entries(SCENES)) {
        ok(entry.title.length > 0, id);
        ok(entry.kind === 'scene' || entry.kind === 'film', id);
        equal(typeof entry.load, 'function', id);
      }
    },
  ],
  [
    '可导出格式只列浏览器支持的;一个都不支持就不显示导出',
    () => {
      equal(supportedFormats(null).length, 0);
      equal(supportedFormats(() => false).length, 0);
      equal(supportedFormats((m) => m === 'video/webm').join(','), 'auto,video/webm');
      equal(supportedFormats(() => true).join(','), 'auto,video/mp4,video/webm');
      // isTypeSupported 自己抛错(老浏览器)按不支持处理。
      equal(
        supportedFormats(() => {
          throw new Error('boom');
        }).length,
        0,
      );
    },
  ],
  [
    '离线编码能编的容器并进可导出格式:没有 MediaRecorder 也能导,两边取并集',
    () => {
      equal(supportedFormats(null, { mp4: true, webm: false }).join(','), 'auto,video/mp4');
      equal(
        supportedFormats((m) => m === 'video/webm', { mp4: true, webm: false }).join(','),
        'auto,video/mp4,video/webm',
      );
      equal(supportedFormats(null, { mp4: false, webm: false }).length, 0);
    },
  ],
  [
    '下载文件名区分场景与画幅,扩展名跟随实际编码格式',
    () => {
      const at = new Date(2026, 8, 23, 7, 5, 9);
      equal(downloadName('film', 'w16h9', 'video/mp4;codecs=avc1', at), 'film-w16h9-20260923-070509.mp4');
      equal(downloadName('derivatives', 'full', 'video/webm;codecs=vp9', at), 'derivatives-full-20260923-070509.webm');
      // 故事板联系表是 PNG。
      equal(downloadName('film', 'storyboard-w16h9', 'image/png', at), 'film-storyboard-w16h9-20260923-070509.png');
    },
  ],
  [
    '取消按错误码识别,不靠文案;错误提示对用户是中文说明',
    () => {
      ok(isUserCancel(new FilmError('cancelled', '导出已取消')));
      ok(!isUserCancel(new FilmError('tainted', '导出中断')));
      ok(!isUserCancel(new Error('export cancelled')));
      equal(exportErrorMessage(new FilmError('busy', '已经在导出了')), '已经在导出了');
      equal(exportErrorMessage(new Error('x')), '导出失败:x');
      equal(exportErrorMessage('y'), '导出失败:y');
    },
  ],
  [
    '进度百分比取整并夹紧',
    () => {
      equal(progressPercent(0, 10), 0);
      equal(progressPercent(3.33, 10), 33);
      equal(progressPercent(20, 10), 100);
      equal(progressPercent(-1, 10), 0);
      equal(progressPercent(5, 0), 0);
      equal(progressPercent(Number.NaN, 10), 0);
    },
  ],
  [
    '配音进了成片:status 说含配音;没有附加说明时不弹提示',
    () => {
      const m = exportAudioMessage({ status: 'included', codec: 'aac' });
      ok(m.status.includes('含配音'), m.status);
      ok(m.status.includes('已开始下载'), m.status);
      equal(m.notice, null);
    },
  ],
  [
    '配音进了成片但带播放提示(MP4 里装 Opus):提示里原样带上这条说明',
    () => {
      const m = exportAudioMessage({ status: 'included', codec: 'opus', note: OPUS_IN_MP4_NOTE });
      ok(m.status.includes('含配音'), m.status);
      ok(m.notice !== null && m.notice.includes(OPUS_IN_MP4_NOTE), String(m.notice));
      equal(m.notice, `成片含配音。${OPUS_IN_MP4_NOTE}。`);
    },
  ],
  [
    '部分配音缺失且 MP4 里装的是 Opus:原因、缺失的文件与播放提示都在提示里',
    () => {
      const m = exportAudioMessage({
        status: 'partial',
        codec: 'opus',
        failed: ['/voice/a.mp3'],
        reason: '1 个配音文件取不到或解不开,那几句是静音',
        note: OPUS_IN_MP4_NOTE,
      });
      equal(m.notice, `成片含配音,但1 个配音文件取不到或解不开,那几句是静音(a.mp3)。${OPUS_IN_MP4_NOTE}。`);
    },
  ],
  [
    '读屏播报 announce = 状态 + 提示(读屏只听常驻的播报区,原因不能只写在可见提示里);没有提示时就是状态',
    () => {
      const dropped = exportAudioMessage({ status: 'dropped', reason: '浏览器编不了 video/mp4 的音频' });
      equal(dropped.announce, `${dropped.status}。${dropped.notice ?? ''}`);
      ok(dropped.announce.includes('浏览器编不了 video/mp4 的音频'), dropped.announce);
      const plain = exportAudioMessage({ status: 'included', codec: 'aac' });
      equal(plain.announce, plain.status);
      equal(exportAudioMessage(undefined).announce, '导出完成,已开始下载');
    },
  ],
  [
    '部分配音缺失:提示列出前 3 个(解码后的)文件名,超过 3 个补「等 N 个」',
    () => {
      const failed = [
        '/voice/voice-demo/%E7%94%B2.mp3',
        'https://cdn.example.com/voice/b.mp3?v=2',
        '/voice/c.mp3#t=1',
        '/voice/d.mp3',
        '/voice/e.mp3',
      ];
      const m = exportAudioMessage({
        status: 'partial',
        codec: 'aac',
        reason: '5 个配音文件取不到或解不开,那几句是静音',
        failed,
      });
      ok(m.status.includes('部分配音缺失'), m.status);
      equal(m.notice, '成片含配音,但5 个配音文件取不到或解不开,那几句是静音(甲.mp3、b.mp3、c.mp3 等 5 个)。');
      ok(m.notice !== null && !m.notice.includes('d.mp3'), '只列前 3 个');
      ok(m.notice !== null && !m.notice.includes('%E7'), '文件名要解码成人能读的');
    },
  ],
  [
    '部分配音缺失:恰好 3 个不补「等」;没给原因用默认说法;没给地址不加括号',
    () => {
      const three = exportAudioMessage({ status: 'partial', failed: ['/a.mp3', '/b.mp3', '/c.mp3'] });
      equal(three.notice, '成片含配音,但有配音文件没能加载(a.mp3、b.mp3、c.mp3)。');
      const none = exportAudioMessage({ status: 'partial', reason: '有两句解不开' });
      equal(none.notice, '成片含配音,但有两句解不开。');
      const empty = exportAudioMessage({ status: 'partial', failed: [] });
      equal(empty.notice, '成片含配音,但有配音文件没能加载。');
      // 地址以 / 结尾取不到文件名时退回整个地址,不能列出空名字。
      const dir = exportAudioMessage({ status: 'partial', failed: ['https://x.test/voice/'] });
      equal(dir.notice, '成片含配音,但有配音文件没能加载(https://x.test/voice/)。');
    },
  ],
  [
    // 【已知源码缺陷,用例按正确行为断言】sceneRegistry.ts 的 fileName() 直接 decodeURIComponent:
    // 地址里有不成对的 %(文件名 100%.mp3,new URL 解析后仍是原样的 %)会抛 URIError,
    // exportAudioMessage 跟着抛,App 下载已触发但状态行/提示不更新,还多一个未处理的 rejection。
    '部分配音缺失:地址里有非法百分号转义时不抛错,退回原样的文件名',
    () => {
      let m: ReturnType<typeof exportAudioMessage> | null = null;
      let error: unknown = null;
      try {
        m = exportAudioMessage({ status: 'partial', failed: ['http://x.test/voice/demo/100%.mp3'] });
      } catch (e) {
        error = e;
      }
      equal(error, null, `exportAudioMessage 对非法转义的地址抛错了:${String(error)}`);
      ok(m !== null && m.notice !== null && m.notice.includes('100%.mp3'), String(m?.notice));
    },
  ],
  [
    '配音被丢掉:提示直说成片没有配音与原因;原因缺失或为空写「原因不明」',
    () => {
      const reason = '浏览器没能把配音音轨加进录制流';
      const m = exportAudioMessage({ status: 'dropped', reason });
      ok(m.status.includes('没有配音'), m.status);
      equal(m.notice, `成片没有配音:${reason}。`);
      equal(exportAudioMessage({ status: 'dropped' }).notice, '成片没有配音:原因不明。');
      equal(exportAudioMessage({ status: 'dropped', reason: '' }).notice, '成片没有配音:原因不明。');
    },
  ],
  [
    '没有配音 / 关了配音 / 还没定论 / 没有报告:只报导出完成,不弹提示',
    () => {
      const cases: Array<ExportAudioReport | undefined> = [
        { status: 'none' },
        { status: 'off' },
        { status: 'pending' },
        // 即使带了 reason 也不提示:这些状态不是「配音丢了」。
        { status: 'off', reason: '用户关了配音' },
        undefined,
      ];
      for (const audio of cases) {
        const m = exportAudioMessage(audio);
        const label = audio?.status ?? 'undefined';
        equal(m.status, '导出完成,已开始下载', label);
        equal(m.notice, null, label);
      }
    },
  ],
  [
    'fromFilm:audioEnabled 读播放器此刻的声音状态(实时录制会自己开声音,宿主的按钮据此对齐)',
    () => {
      let enabled = false;
      const state = (): FilmState => ({
        mode: 'playing',
        index: 0,
        segment: null,
        segmentElapsed: 0,
        position: 0,
        total: 1,
        paused: false,
        exporting: false,
        audio: { available: true, enabled },
      });
      const noop = (): void => undefined;
      const controller = Object.assign(noop, {
        dispose: noop,
        seekTo: noop,
        seekToTime: noop,
        setPaused: noop,
        exportVideo: () => {
          throw new Error('不导出');
        },
        getState: state,
        setAudioEnabled: (on: boolean) => {
          enabled = on;
        },
      }) as FilmController;
      const handle = fromFilm(controller);
      equal(handle.audioAvailable?.(), true);
      equal(handle.audioEnabled?.(), false);
      enabled = true;
      equal(handle.audioEnabled?.(), true, '应当实时读播放器状态,而不是缓存');
      handle.setAudioEnabled?.(false);
      equal(handle.audioEnabled?.(), false);
    },
  ],
]);
