import { AudioLibrary } from '../audio/library';
import type { LiveAudioContext, LiveAudioEnv, LiveGain } from '../audio/live';
import { LiveClipPlayer } from '../audio/live';
import type { PlacedClip } from '../audio/types';
import type { Segment } from './types';

/**
 * 影片的配音播放:每帧拿「当前分段 + 段内秒数 + 是否在播」对一次账。
 * 声音跟着画面时间线走(字幕、进度条、跳转、导出都信任的那条),所以暂停、段内跳转、
 * 切段、切后台回来都自然对齐 —— 每段按自己的开头锚定,不会越播越偏。
 * 浏览器要求第一次出声发生在用户操作里:默认关着,setEnabled(true) 请在点击回调里同步调用。
 */
export class VoicePlayback {
  private readonly env: LiveAudioEnv;
  private readonly library: AudioLibrary;
  private ctx: LiveAudioContext | null = null;
  private master: LiveGain | null = null;
  private player: LiveClipPlayer | null = null;
  private capture: { readonly stream: MediaStream } | null = null;
  private enabledValue = false;
  private readonly stopVisibility: () => void;
  private disposed = false;
  /** 上一次对账时的参数(可见性变化、开声音时立刻补一次对账)。 */
  private last: { segment: Segment | null; elapsed: number; playing: boolean; next: Segment | null } | null = null;
  private readonly preloaded = new WeakSet<Segment>();

  constructor(env: LiveAudioEnv) {
    this.env = env;
    this.library = new AudioLibrary({
      fetch: (url) => env.fetch(url),
      decode: (bytes) => {
        const ctx = this.ctx;
        if (!ctx) {
          return Promise.reject(new Error('还没有音频上下文'));
        }
        return ctx.decodeAudioData(bytes);
      },
    });
    this.stopVisibility = env.onVisibilityChange(() => {
      const ctx = this.ctx;
      if (!ctx || !this.enabledValue) {
        return;
      }
      // 切到后台:画面时间线停了,声音也停;回来后按当时的位置接上。
      if (env.hidden()) {
        this.player?.stopAll();
        void ctx.suspend().catch(() => undefined);
      } else {
        void ctx.resume().catch(() => undefined);
        this.resync();
      }
    });
  }

  get enabled(): boolean {
    return this.enabledValue;
  }

  /** 开 / 关声音。开:第一次调用时建音频上下文(必须在用户操作里)。 */
  setEnabled(on: boolean): void {
    if (this.disposed || on === this.enabledValue) {
      return;
    }
    if (!on) {
      this.enabledValue = false;
      this.player?.stopAll();
      return;
    }
    if (!this.ensureContext()) {
      return;
    }
    this.enabledValue = true;
    void this.ctx?.resume().catch(() => undefined);
    this.resync();
  }

  /**
   * 每帧对账。segment 为 null 表示段间(转场);next 是下一段(提前加载它的音频)。
   * playing:没暂停、页面在前台。
   */
  sync(segment: Segment | null, elapsed: number, playing: boolean, next: Segment | null): void {
    this.last = { segment, elapsed, playing, next };
    if (!this.enabledValue || !this.player) {
      return;
    }
    this.preload(segment);
    this.preload(next);
    const clips = segment ? clipsOf(segment) : [];
    this.player.sync(clips, elapsed, playing && !this.env.hidden());
  }

  /**
   * 实时录制:把声音也接进录制的媒体流,返回音轨(拿不到返回 null,录出来没有声音)。
   * 会顺便打开声音(导出按钮的点击就是用户操作)。
   */
  captureTrack(): MediaStreamTrack | null {
    this.setEnabled(true);
    const ctx = this.ctx;
    const master = this.master;
    if (!ctx || !master || typeof ctx.createMediaStreamDestination !== 'function') {
      return null;
    }
    if (!this.capture) {
      try {
        this.capture = ctx.createMediaStreamDestination();
        master.connect(this.capture);
      } catch (e) {
        console.warn('[voice] 接不上录制的音轨,成片没有声音', e);
        this.capture = null;
        return null;
      }
    }
    return this.capture.stream.getAudioTracks()[0] ?? null;
  }

  /** 录制结束:断开录制用的音轨。 */
  releaseCapture(): void {
    if (this.capture && this.master) {
      try {
        this.master.disconnect(this.capture);
      } catch {
        // 已经断开。
      }
    }
    this.capture = null;
  }

  dispose(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.enabledValue = false;
    this.stopVisibility();
    this.player?.stopAll();
    this.releaseCapture();
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.player = null;
  }

  private ensureContext(): boolean {
    if (this.ctx) {
      return true;
    }
    const ctx = this.env.createContext();
    if (!ctx) {
      return false;
    }
    const master = ctx.createGain();
    master.connect(ctx.destination);
    this.ctx = ctx;
    this.master = master;
    this.player = new LiveClipPlayer(ctx, this.library, master);
    return true;
  }

  private resync(): void {
    const last = this.last;
    if (last) {
      this.sync(last.segment, last.elapsed, last.playing, last.next);
    }
  }

  private preload(segment: Segment | null): void {
    if (!segment || this.preloaded.has(segment) || !this.ctx) {
      return;
    }
    this.preloaded.add(segment);
    for (const clip of segment.voice?.clips ?? []) {
      void this.library.load(clip.url);
    }
  }
}

/** 分段的音频片段 → 时间轴片段(段内时间)。 */
function clipsOf(segment: Segment): PlacedClip[] {
  return (segment.voice?.clips ?? []).map((c) => ({
    key: c.id,
    url: c.url,
    at: c.start,
    offset: c.offset,
    duration: c.duration,
  }));
}

/** 片子里有没有要播的音频。 */
export function filmHasVoice(segments: readonly Segment[]): boolean {
  return segments.some((s) => (s.voice?.clips.length ?? 0) > 0);
}
