import { textAdvance } from '../math/typeset';
import { setTextWidthOverride } from '../mobjects/shapes';

/**
 * 画布文字宽度估计:中日韩 / 全角 1em,其余 0.6em(与 Tex 里 \text 的 textAdvance 同一口径)。
 * 没有 DOM 时 measureTextWidth 按每字 0.6em 量,中文被低估约 40%;版面检查在 node 里用它补上。
 */
export function estimateTextWidth(text: string, fontSize: number): number {
  return textAdvance(text) * fontSize;
}

/** 安装计数:嵌套安装只在最外层撤销时恢复。 */
let installs = 0;

/**
 * 临时把画布文字的宽度度量(measureTextWidth:Label 的盒、坐标轴刻度数字与轴名)换成 estimateTextWidth(高不变),
 * 返回撤销函数(幂等,调两次不多减计数)。
 * 只给没有真实字体度量的环境(node 干跑、版面检查)用;装着的期间搭建的场景(fitObjects、Layout、columnList)
 * 与检查用的是同一套度量 —— 取景按窄的量、检查按宽的量,会冒出假的出画。浏览器里不要装(那里有真实度量)。
 * 它跨 await 生效(换的是模块级度量),同一进程里只该有一个检查任务装着它。
 */
export function installEstimatedTextMetrics(): () => void {
  if (installs === 0) {
    setTextWidthOverride(estimateTextWidth);
  }
  installs += 1;
  let undone = false;
  return () => {
    if (undone) {
      return;
    }
    undone = true;
    installs -= 1;
    if (installs === 0) {
      setTextWidthOverride(null);
    }
  };
}

/** 估算度量此刻是否装着(测试与诊断用)。 */
export function estimatedTextMetricsInstalled(): boolean {
  return installs > 0;
}
