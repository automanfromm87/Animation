import type { Segment } from './types';

/**
 * 影片目录:配音工具(导出台词稿、校验时间表)按名字找影片。名字与页面的 ?scene= 一致,
 * 配音文件放在 public/voice/<名字>/。按需加载:只用到一部片子时不必把别的片子也加载进来。
 */
export const FILM_CATALOG: Readonly<Record<string, () => Promise<readonly Segment[]>>> = {
  film: async () => (await import('./program')).pythagorasFilm,
  derivatives: async () => (await import('./derivatives')).derivativesFilm,
  topology: async () => (await import('./topology')).topologyFilm,
  'voice-demo': async () => (await import('./voiceDemo')).voiceDemoFilm,
};

/** 目录里的影片名。 */
export function filmNames(): string[] {
  return Object.keys(FILM_CATALOG);
}

/** 按名字加载影片;名字不对时抛错并列出可选的名字。 */
export async function loadFilm(name: string): Promise<readonly Segment[]> {
  const load = Object.hasOwn(FILM_CATALOG, name) ? FILM_CATALOG[name] : undefined;
  if (!load) {
    throw new Error(`没有名为「${name}」的影片;可选:${filmNames().join('、')}`);
  }
  return load();
}
