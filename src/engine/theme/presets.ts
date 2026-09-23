import type { Theme } from './Theme';

export const lightTheme: Theme = {
  name: 'light',
  background: '#f8f7f4',
  showGrid: true,
  gridColor: 'rgba(0, 0, 0, 0.06)',
  gridSpacing: 40,
  showAxes: true,
  axesColor: 'rgba(0, 0, 0, 0.3)',
  stroke: '#1f2937',
  fill: null,
  strokeWidth: 3,
  opacity: 1,
  fontFamily: 'Georgia, "Times New Roman", serif',
  fontSize: 28,
  textColor: '#1f2937',
};

/**
 * 可选主题清单。只读:使用方要默认主题请直接用具名的 lightTheme,
 * 按 [0] 下标取会让「新增一个主题」意外改掉所有场景的外观。
 */
export const presetThemes: readonly Theme[] = [lightTheme];

/** 按名字查主题,找不到返回 undefined。 */
export function themeByName(name: string): Theme | undefined {
  return presetThemes.find((t) => t.name === name);
}
