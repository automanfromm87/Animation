import { FilmError } from './export/types';
import {
  DEFAULT_SCENE,
  SCENES,
  downloadName,
  exportErrorMessage,
  isUserCancel,
  progressPercent,
  resolvePreviewSeconds,
  resolveSceneId,
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
]);
