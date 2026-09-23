import { installDomStub } from '../testing/domStub';
import { installExportStub } from '../testing/exportStub';
import { equal, suite } from '../testing/harness';
import type { RecorderHealth } from './watchdog';
import { DATA_STALL_MS, MUTED_GRACE_MS, diagnoseRecorderStall, isCanvasTainted } from './watchdog';

function healthy(): RecorderHealth {
  return {
    mimeType: 'video/mp4',
    recorderState: 'recording',
    trackState: 'live',
    mutedMs: 0,
    streamActive: true,
    tainted: false,
    frames: 500,
    chunkCount: 5,
    msSinceData: 900,
  };
}

const codeOf = (h: RecorderHealth): string | null => diagnoseRecorderStall(h)?.code ?? null;

export default suite('导出看门狗', [
  [
    '健康链路不误报;拿不到的字段(桩环境)也不误报',
    () => {
      equal(codeOf(healthy()), null);
      equal(
        codeOf({
          ...healthy(),
          trackState: 'unknown',
          mutedMs: null,
          streamActive: null,
          tainted: null,
          chunkCount: 0,
          msSinceData: null,
        }),
        null,
      );
    },
  ],
  [
    '画布被污染优先报(轨道 live、未静音、编码器照常 recording 也照报)',
    () => {
      const d = diagnoseRecorderStall({ ...healthy(), tainted: true });
      equal(d?.code, 'tainted');
      equal(d?.message.includes('污染'), true);
      equal(codeOf({ ...healthy(), tainted: null }), null, '探不出来不能当成被污染');
    },
  ],
  [
    '轨道结束 / 流失活立刻报',
    () => {
      equal(codeOf({ ...healthy(), trackState: 'ended' }), 'track-ended');
      equal(codeOf({ ...healthy(), streamActive: false }), 'track-ended');
    },
  ],
  [
    '静音要持续才报:短暂的帧监控静音不误报',
    () => {
      equal(codeOf({ ...healthy(), mutedMs: MUTED_GRACE_MS - 1 }), null);
      equal(codeOf({ ...healthy(), mutedMs: MUTED_GRACE_MS }), 'track-muted');
    },
  ],
  [
    '编码器悄悄变 inactive 立刻报',
    () => {
      equal(codeOf({ ...healthy(), recorderState: 'inactive' }), 'recorder-stopped');
    },
  ],
  [
    '来过数据后断供才报,边界不报,从没来过不报',
    () => {
      equal(codeOf({ ...healthy(), chunkCount: 2, msSinceData: 30000 }), 'stalled');
      equal(codeOf({ ...healthy(), msSinceData: DATA_STALL_MS }), null);
      equal(codeOf({ ...healthy(), chunkCount: 0, msSinceData: null }), null);
    },
  ],
  [
    '污染探针:只有 SecurityError 才算被污染;复用同一张探针;探不出来返回 null',
    () => {
      const dom = installDomStub();
      try {
        const source = dom.canvas();
        equal(isCanvasTainted(source), null, '没有 document 时探不出来');
        const clean = installExportStub();
        try {
          const probe = document.createElement('canvas');
          equal(isCanvasTainted(source, probe), false);
          equal(isCanvasTainted(source, probe), false, '复用探针仍然干净');
          // 传入的探针必须真的被用上(每秒一次的检查不该每次新建画布)。
          let used = 0;
          const spy = {
            width: 0,
            height: 0,
            getContext: () => {
              used += 1;
              return { drawImage: () => undefined, getImageData: () => undefined };
            },
          } as unknown as HTMLCanvasElement;
          equal(isCanvasTainted(source, spy), false);
          equal(used, 1, '没有复用传入的探针');
        } finally {
          clean.restore();
        }
        const dirty = installExportStub({ tainted: true });
        try {
          equal(isCanvasTainted(source), true);
        } finally {
          dirty.restore();
        }
        // 其它异常(比如 0 尺寸源抛 InvalidStateError)不是污染。
        const probe = {
          width: 0,
          height: 0,
          getContext: () => ({
            drawImage: () => {
              throw new DOMException('zero-size source', 'InvalidStateError');
            },
            getImageData: () => undefined,
          }),
        } as unknown as HTMLCanvasElement;
        equal(isCanvasTainted(source, probe), null);
      } finally {
        dom.restore();
      }
    },
  ],
]);
