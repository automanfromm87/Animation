import { equal, ok, suite, throws } from '../../testing/harness';
import { lightTheme } from '../theme/presets';
import { recordingCtx } from './drawRecorder.testutil';
import type { Vec3 } from './Mesh3D';
import type { ParametricSurfaceOptions } from './ParametricSurface';
import { ParametricSurface, sphereSurface } from './ParametricSurface';
import type { ParamFn } from './parametric';
import {
  kleinParam,
  mobiusParam,
  sphereParam,
  sphereTorusHomotopy,
  torusParam,
} from './parametric';

/** 探针:暴露物体空间法线、全局朝向符号与双面判定。 */
class Probe extends ParametricSurface {
  sign(): number {
    return (this as unknown as { normalSign: number }).normalSign;
  }

  normalOf(index: number): Vec3 {
    return this.objectFaceNormal(index);
  }

  isTwoSided(): boolean {
    return this.twoSided;
  }

  faceCenter(index: number): Vec3 {
    const face = this.faces[index] ?? [];
    let x = 0;
    let y = 0;
    let z = 0;
    for (const vi of face) {
      const v = this.vertices[vi];
      if (v) {
        x += v.x;
        y += v.y;
        z += v.z;
      }
    }
    const n = face.length || 1;
    return { x: x / n, y: y / n, z: z / n };
  }
}

/** 环面 (R, r)(主环在 xz 平面)在点 p 处的解析外法线。 */
function torusOutward(p: Vec3, R: number): Vec3 {
  const len = Math.hypot(p.x, p.z) || 1;
  const n = { x: p.x - (p.x / len) * R, y: p.y, z: p.z - (p.z / len) * R };
  const m = Math.hypot(n.x, n.y, n.z) || 1;
  return { x: n.x / m, y: n.y / m, z: n.z / m };
}

function agreementWithTorus(probe: Probe, R: number): number {
  let agree = 0;
  let total = 0;
  for (let i = 0; i < probe.faces.length; i++) {
    const c = probe.faceCenter(i);
    const n = probe.normalOf(i);
    const t = torusOutward(c, R);
    const d = n.x * t.x + n.y * t.y + n.z * t.z;
    if (Math.abs(d) > 0.2) {
      total += 1;
      if (d > 0) {
        agree += 1;
      }
    }
  }
  return total === 0 ? 0 : agree / total;
}

/** 面片按顶点坐标集合去重后,有多少个面与别的面完全重合(重复覆盖的签名)。 */
function coincidentFaces(surface: ParametricSurface): number {
  const q = (v: number): string => (Math.round(v * 1e4) / 1e4).toFixed(4);
  const seen = new Map<string, number>();
  for (const face of surface.faces) {
    const key = face
      .map((vi) => {
        const v = surface.vertices[vi];
        return v ? `${q(v.x)},${q(v.y)},${q(v.z)}` : '';
      })
      .sort()
      .join('|');
    seen.set(key, (seen.get(key) ?? 0) + 1);
  }
  let dup = 0;
  for (const count of seen.values()) {
    if (count > 1) {
      dup += count;
    }
  }
  return dup;
}

function drawn(surface: ParametricSurface) {
  const rec = recordingCtx();
  surface.render(rec.ctx, lightTheme);
  return rec;
}

export default suite('ParametricSurface', [
  [
    'resample 之后会重标定法线朝向(球→环同伦不会整体反向)',
    () => {
      const probe = new Probe(sphereTorusHomotopy(38, 28, 12), {
        uSegs: 26,
        vSegs: 18,
        params: [0],
      });
      // 先在球端取一次法线,让法线缓存建立起来:重采样必须让它失效。
      probe.normalOf(0);
      probe.resample([1]);
      const rate = agreementWithTorus(probe, 28);
      ok(rate > 0.95, `t=1 时只有 ${(rate * 100).toFixed(1)}% 的面法线朝外`);
    },
  ],
  [
    '直接构造的环面法线也朝外(叉积法线基准正确)',
    () => {
      const probe = new Probe(torusParam(28, 12), { uSegs: 26, vSegs: 18 });
      const rate = agreementWithTorus(probe, 28);
      ok(rate > 0.95, `只有 ${(rate * 100).toFixed(1)}% 的面法线朝外`);
    },
  ],
  [
    '同伦全程最多翻一次朝向,且落在有向体积过零点附近(不会中途爆闪)',
    () => {
      const probe = new Probe(sphereTorusHomotopy(38, 28, 12), {
        uSegs: 26,
        vSegs: 18,
        params: [0],
      });
      let flips = 0;
      let prev: number | null = null;
      let flipAt = -1;
      for (let i = 0; i <= 200; i++) {
        const t = i / 200;
        probe.resample([t]);
        probe.normalOf(0);
        const sign = probe.sign();
        if (prev !== null && sign !== prev) {
          flips += 1;
          flipAt = t;
        }
        prev = sign;
      }
      ok(flips <= 1, `全程翻转了 ${flips} 次(应至多 1 次)`);
      // 有向体积的过零点在 t≈0.75,那才是曲面真正发生反转的地方。
      ok(
        flips === 0 || Math.abs(flipAt - 0.75) < 0.05,
        `翻转点 ${flipAt} 偏离了有向体积过零点`,
      );
    },
  ],
  [
    '按网格缝判断单/双面:环面、球面、同伦起点单面;莫比乌斯、克莱因、开放曲面双面',
    () => {
      const cases: ReadonlyArray<readonly [string, ParamFn, ParametricSurfaceOptions, boolean]> = [
        ['环面', torusParam(28, 12), { uSegs: 20, vSegs: 12 }, false],
        ['球面', sphereParam(30), { uSegs: 16, vSegs: 10 }, false],
        ['同伦 t=0', sphereTorusHomotopy(38, 28, 12), { uSegs: 20, vSegs: 12, params: [0] }, false],
        ['莫比乌斯', mobiusParam(28, 9), { uSegs: 30, vSegs: 6 }, true],
        ['克莱因', kleinParam(13), { uSegs: 18, vSegs: 12 }, true],
        ['马鞍', (u, v) => ({ x: u, y: -(u * u - v * v) / 40, z: v }), { uRange: [-30, 30], vRange: [-30, 30], uSegs: 8, vSegs: 8 }, true],
      ];
      for (const [name, fn, options, twoSided] of cases) {
        const probe = new Probe(fn, options);
        equal(probe.isTwoSided(), twoSided, `${name} 的单/双面判错了`);
      }
      // 显式覆盖。
      equal(new Probe(torusParam(28, 12), { sided: 'two' }).isTwoSided(), true);
      equal(new Probe(mobiusParam(28, 9), { sided: 'one' }).isTwoSided(), false);
    },
  ],
  [
    '单/双面只在构造时判一次:同伦形变中途网格张开也不会切换',
    () => {
      const probe = new Probe(sphereTorusHomotopy(38, 28, 12), { uSegs: 20, vSegs: 12, params: [0] });
      probe.resample([0.5]);
      equal(probe.isTwoSided(), false);
    },
  ],
  [
    '预设曲面不重复覆盖(克莱因瓶以前 u 走满 2π,216 个面里 180 个两两重合)',
    () => {
      for (const [name, surface] of [
        ['克莱因', new ParametricSurface(kleinParam(13), { uSegs: 18, vSegs: 12 })],
        ['莫比乌斯', new ParametricSurface(mobiusParam(28, 9), { uSegs: 30, vSegs: 6 })],
        ['环面', new ParametricSurface(torusParam(28, 12), { uSegs: 20, vSegs: 12 })],
        ['球面', sphereSurface(30, { uSegs: 16, vSegs: 10 })],
      ] as const) {
        equal(coincidentFaces(surface), 0, `${name} 有重合的面片`);
      }
    },
  ],
  [
    '开放曲面的画法与参数顺序无关:线框全实线,填充明暗一致',
    () => {
      const range = { uRange: [-40, 40] as const, vRange: [-40, 40] as const, uSegs: 6, vSegs: 6 };
      const a = new ParametricSurface((u, v) => ({ x: u, y: 0, z: v }), range);
      const b = new ParametricSurface((u, v) => ({ x: v, y: 0, z: u }), range);
      for (const s of [a, b]) {
        const rec = drawn(s);
        ok(rec.strokes.some((stroke) => stroke.segments.length > 0), '线框什么都没画');
        ok(
          rec.strokes.every((stroke) => !stroke.dashed),
          '开放曲面画出了虚线(背面剔除对开放曲面不成立)',
        );
      }
      a.setStyle({ fill: '#ffffff' });
      b.setStyle({ fill: '#ffffff' });
      const fa = new Set(drawn(a).fills);
      const fb = new Set(drawn(b).fills);
      ok(fa.size > 0, '填充什么都没画');
      equal([...fa].join(), [...fb].join(), '两种参数化的明暗不一致');
    },
  ],
  [
    '同一组参数再次 resample 是空操作;不传参数则强制重采',
    () => {
      let calls = 0;
      const fn: ParamFn = (u, v, params) => {
        calls += 1;
        return { x: u, y: (params[0] ?? 0) * v, z: v };
      };
      const s = new ParametricSurface(fn, { uRange: [0, 1], vRange: [0, 1], uSegs: 3, vSegs: 3, params: [1] });
      const perSample = calls;
      s.resample([1]);
      equal(calls, perSample, '同参重采样又算了一遍');
      s.resample([2]);
      equal(calls, perSample * 2);
      s.resample();
      equal(calls, perSample * 3);
      equal(s.getParams()[0], 2);
    },
  ],
  [
    'sphereSurface 预设把 vRange 钉在 [0, π],首尾行分别落在两极',
    () => {
      const preset = sphereSurface(40, { uSegs: 8, vSegs: 8 });
      const first = preset.vertices[0];
      const last = preset.vertices[preset.vertices.length - 1];
      ok(first !== undefined && last !== undefined);
      ok(
        Math.abs((first?.y ?? 0) - (last?.y ?? 0)) > 1,
        'vRange 没有钉住,首尾行落在了同一个极点上',
      );
    },
  ],
  [
    '有填充、线宽为 0 时补同色缝;半透明填充或整体淡出时不补',
    () => {
      const torus = new ParametricSurface(torusParam(28, 12), { uSegs: 12, vSegs: 8 });
      torus.setStyle({ fill: '#ffffff', strokeWidth: 0 });
      const rec = drawn(torus);
      ok(rec.fills.length > 0, '什么都没画');
      equal(rec.strokes.length, rec.fills.length, '每个面都应补一笔同色描边');
      rec.strokes.forEach((st, i) => equal(st.strokeStyle, rec.fills[i]));
      torus.setStyle({ fill: 'rgba(255, 255, 255, 0.5)' });
      equal(drawn(torus).strokes.length, 0, '半透明填充补缝会叠出网格纹');
      torus.setStyle({ fill: '#ffffff' });
      torus.opacity = 0.5;
      equal(drawn(torus).strokes.length, 0, '整体淡出时补缝会叠出网格纹');
    },
  ],
  [
    '可去奇点(0/0 得 NaN)向内侧挪一点重取,拿到极限附近的值',
    () => {
      const sinc: ParamFn = (u, v) => {
        const r = Math.hypot(u, v);
        return { x: u, y: (-20 * Math.sin(r)) / r, z: v };
      };
      const s = new ParametricSurface(sinc, {
        uRange: [-10, 10],
        vRange: [-10, 10],
        uSegs: 4,
        vSegs: 4,
      });
      const center = s.vertices[2 * 5 + 2];
      ok(center !== undefined && Math.abs(center.y + 20) < 1e-3, `原点处 y=${center?.y}`);
    },
  ],
  [
    'resample 采到非有限值时沿用上一次的位置,只告警一次',
    () => {
      const fn: ParamFn = (u, v, params) => ({
        x: u,
        y: (params[0] ?? 0) > 0 ? Math.sqrt(-1) : 0,
        z: v,
      });
      const s = new ParametricSurface(fn, {
        uRange: [0, 1],
        vRange: [0, 1],
        uSegs: 2,
        vSegs: 2,
        params: [0],
      });
      const original = console.warn;
      let warned = 0;
      console.warn = (): void => {
        warned += 1;
      };
      try {
        s.resample([1]);
        s.resample([2]);
      } finally {
        console.warn = original;
      }
      equal(warned, 1, `告警了 ${warned} 次`);
      ok(s.vertices.every((v) => v.y === 0), '非有限的采样点没有沿用旧位置');
      equal(s.getParams()[0], 2);
    },
  ],
  [
    'uSegs / vSegs 必须是正整数;定义域必须有限;采样出 ±Infinity(真正的极点)直接抛错',
    () => {
      for (const bad of [0, -1, 2.5]) {
        throws(() => new ParametricSurface(torusParam(10, 3), { uSegs: bad }));
      }
      throws(() => new ParametricSurface(torusParam(10, 3), { uRange: [0, NaN] }));
      throws(() => new ParametricSurface((u) => ({ x: Math.log(u), y: 0, z: 0 }), { uRange: [0, 1] }));
      throws(() => new ParametricSurface((u) => ({ x: u, y: 1 / u, z: 0 }), { uRange: [0, 1] }));
    },
  ],
]);
