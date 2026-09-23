import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  build: {
    // MathJax 单独成块:TeX 解析器与全套字形路径占了大头(压缩后约 1.6MB、gzip 约 575KB),
    // 引擎代码改动时这个大文件仍能命中浏览器缓存。字形数据是 \mathbb、\mathfrak 这些命令要用的,删不得。
    chunkSizeWarningLimit: 1700,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            { name: 'mathjax', test: /[\\/]node_modules[\\/]mathjax-full[\\/]/ },
            // 视频封装库只在导出(或探测可导出的格式)时才按需加载。
            { name: 'mediabunny', test: /[\\/]node_modules[\\/]mediabunny[\\/]/ },
          ],
        },
      },
    },
  },
});
