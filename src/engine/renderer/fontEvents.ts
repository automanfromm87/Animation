import { bumpMeasureGeneration } from '../mobjects/types';

/**
 * 网页字体加载完成事件。公式是矢量字形、不依赖字体加载;
 * 但 Label 用画布量文字,页面上的网页字体晚到时,同样的文字量出来会变宽 ——
 * 递增度量代号并通知订阅者(Scene 据此重排一次性排版的容器、重取景、重画)。
 * 只在字体真正加载完成(loadingdone)时通知,加载失败(loadingerror)不通知。
 */

const listeners = new Set<() => void>();
/** 已挂过监听的字体集:换了 document(测试桩装卸、iframe)各挂各的。 */
const watched = new WeakSet<FontFaceSet>();
let notifyQueued = false;

function fontsLoaded(): void {
  bumpMeasureGeneration();
  if (notifyQueued) {
    return;
  }
  // 同一轮里接连完成的多个字体只通知一次。
  notifyQueued = true;
  queueMicrotask(() => {
    notifyQueued = false;
    for (const listener of [...listeners]) {
      try {
        listener();
      } catch (e) {
        console.error('[fontEvents] 字体就绪回调抛错', e);
      }
    }
  });
}

function watch(): void {
  const fonts = typeof document !== 'undefined' ? document.fonts : undefined;
  if (!fonts || typeof fonts.addEventListener !== 'function' || watched.has(fonts)) {
    return;
  }
  watched.add(fonts);
  fonts.addEventListener('loadingdone', (e) => {
    if (e.fontfaces.length > 0) {
      fontsLoaded();
    }
  });
}

/** 订阅「有网页字体加载完成,文字尺寸可能变了」,返回退订函数。 */
export function onFontsLoaded(listener: () => void): () => void {
  watch();
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
