import { close, equal, ok, suite } from '../testing/harness';
import { colorAlpha, fadeColor, formatColor, lerpColor, parseColor } from './color';

/** 装一个只会把几个命名色规范化成 #rrggbb 的 document(模拟浏览器画布的 fillStyle)。 */
function namedColorDocument(): { restore(): void } {
  const g = globalThis as unknown as Record<string, unknown>;
  const had = 'document' in g;
  const saved = g['document'];
  const names: Record<string, string> = { red: '#ff0000', rebeccapurple: '#663399' };
  g['document'] = {
    createElement: () => ({
      width: 0,
      height: 0,
      getContext: () => {
        let value = '#000000';
        return {
          get fillStyle(): string {
            return value;
          },
          // 非法值被静默忽略,与真实画布一致。
          set fillStyle(v: string) {
            const hit = names[v] ?? (/^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : undefined);
            if (hit) {
              value = hit;
            }
          },
        };
      },
    }),
  };
  return {
    restore() {
      if (had) {
        g['document'] = saved;
      } else {
        delete g['document'];
      }
    },
  };
}

export default suite('颜色工具', [
  [
    '解析 hex(3/4/6/8 位)与 rgb()/rgba()(逗号、空格、斜杠 alpha、百分比)',
    () => {
      equal(JSON.stringify(parseColor('#f80')), JSON.stringify({ r: 255, g: 136, b: 0, a: 1 }));
      equal(parseColor('#f808')?.a, 0x88 / 255);
      equal(JSON.stringify(parseColor('#1F2937')), JSON.stringify({ r: 31, g: 41, b: 55, a: 1 }));
      close(parseColor('#00000080')?.a ?? NaN, 128 / 255, 1e-12);
      equal(JSON.stringify(parseColor('rgb(10, 20, 30)')), JSON.stringify({ r: 10, g: 20, b: 30, a: 1 }));
      equal(parseColor('rgba(0, 0, 0, 0.06)')?.a, 0.06);
      equal(JSON.stringify(parseColor('rgb(100% 0% 50% / 25%)')), JSON.stringify({ r: 255, g: 0, b: 127.5, a: 0.25 }));
      equal(parseColor(' rgb(1,2,3) ')?.b, 3, '首尾空白应忽略');
      // 通道越界钳住,不是解析失败。
      equal(parseColor('rgb(300, -5, 0)')?.r, 255);
      equal(parseColor('rgb(300, -5, 0)')?.g, 0);
    },
  ],
  [
    '非法值返回 null;node 里没有画布,命名色也解析不了',
    () => {
      for (const bad of ['', '#12', '#12345', 'rgb(1, 2)', 'rgb(a, b, c)', 'rgba(1,2,3,4,5)', 'hsl(0 0% 0%)', 'red']) {
        equal(parseColor(bad), null, `「${bad}」不该解析成功`);
      }
    },
  ],
  [
    '命名色交给画布规范化;失败记录按 document 分开(换了环境重新解析)',
    () => {
      equal(parseColor('rebeccapurple'), null, '没有 document 时解析不了');
      const doc = namedColorDocument();
      try {
        equal(JSON.stringify(parseColor('rebeccapurple')), JSON.stringify({ r: 102, g: 51, b: 153, a: 1 }));
        equal(parseColor('notacolor'), null, '画布不认的值仍是 null');
      } finally {
        doc.restore();
      }
    },
  ],
  [
    '格式化:通道取整钳住;不透明时省掉 alpha,alpha 保留三位小数',
    () => {
      equal(formatColor({ r: 12.4, g: 300, b: -3, a: 1 }), 'rgb(12, 255, 0)');
      equal(formatColor({ r: 0, g: 0, b: 0, a: 0.12345 }), 'rgba(0, 0, 0, 0.123)');
      equal(formatColor({ r: 1, g: 2, b: 3, a: 7 }), 'rgb(1, 2, 3)');
    },
  ],
  [
    'lerpColor:端点精确;null 与颜色之间按同色透明度淡入淡出;两边都 null 为 null',
    () => {
      equal(lerpColor('#ff0000', '#0000ff', 0), '#ff0000');
      equal(lerpColor('#ff0000', '#0000ff', 1), '#0000ff');
      equal(lerpColor(null, '#00ff00', 0.5), 'rgba(0, 255, 0, 0.5)');
      equal(lerpColor('rgba(0, 0, 255, 0.5)', null, 0.5), 'rgba(0, 0, 255, 0.25)');
      equal(lerpColor(null, null, 0.3), null);
      equal(lerpColor(null, '#00ff00', 1), '#00ff00');
    },
  ],
  [
    'lerpColor 在 OKLab 里插值:红到绿的中点不发灰(比 sRGB 直接平均亮)',
    () => {
      const mid = parseColor(lerpColor('#ff0000', '#00ff00', 0.5) ?? '');
      ok(mid !== null);
      // sRGB 平均是 (128,128,0),感知上是发暗的泥黄;OKLab 中点明显更亮。
      ok((mid?.r ?? 0) > 150 && (mid?.g ?? 0) > 150, `中点 ${JSON.stringify(mid)}`);
      ok((mid?.b ?? 255) < 60);
      // 同色之间插值不漂移。
      const same = parseColor(lerpColor('#336699', '#336699', 0.37) ?? '');
      equal(JSON.stringify(same), JSON.stringify({ r: 51, g: 102, b: 153, a: 1 }));
    },
  ],
  [
    '解析不了的颜色没法插值:在中点处切换',
    () => {
      equal(lerpColor('red', '#0000ff', 0.4), 'red');
      equal(lerpColor('red', '#0000ff', 0.6), '#0000ff');
    },
  ],
  [
    'colorAlpha / fadeColor',
    () => {
      equal(colorAlpha('rgba(1, 2, 3, 0.4)'), 0.4);
      equal(colorAlpha('whatever'), 1, '解析不了按不透明算');
      equal(fadeColor('#ff0000', 1), '#ff0000', '系数 1 原样返回');
      equal(fadeColor('#ff0000', 0.5), 'rgba(255, 0, 0, 0.5)');
      equal(fadeColor('rgba(0, 0, 0, 0.5)', 0.5), 'rgba(0, 0, 0, 0.25)');
      equal(fadeColor('whatever', 0.5), 'whatever');
    },
  ],
]);
