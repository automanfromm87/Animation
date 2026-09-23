import { equal, ok, suite, throws } from '../../testing/harness';
import type { Segment2D } from '../mobjects3d/drawRecorder.testutil';
import { recordingCtx } from '../mobjects3d/drawRecorder.testutil';
import type { MeshView, Vec3 } from '../mobjects3d/Mesh3D';
import type { EdgeTopology } from '../mobjects3d/topology';
import { BOUNDARY } from '../mobjects3d/topology';
import { lightTheme } from '../theme/presets';
import { ImplicitSurface } from './ImplicitSurface';
import type { FieldFn } from './sdf';
import { sdSphere, sphereToTorusField } from './sdf';

/** 探针:暴露物体空间法线、边拓扑、视图缓存与双面判定。 */
class Probe extends ImplicitSurface {
  normal(i: number): Vec3 {
    return this.objectFaceNormal(i);
  }

  topo(): EdgeTopology {
    return this.edgeTopology();
  }

  view(): MeshView {
    return this.updateView();
  }

  isTwoSided(): boolean {
    return this.twoSided;
  }
}

const genus = sphereToTorusField(36, 30, 12);

function gradientAt(field: FieldFn, p: Vec3, params: number[]): Vec3 {
  const e = 0.01;
  return {
    x: field(p.x + e, p.y, p.z, params) - field(p.x - e, p.y, p.z, params),
    y: field(p.x, p.y + e, p.z, params) - field(p.x, p.y - e, p.z, params),
    z: field(p.x, p.y, p.z + e, params) - field(p.x, p.y, p.z - e, params),
  };
}

function faceCenter(s: ImplicitSurface, i: number): Vec3 {
  const face = s.faces[i] ?? [];
  const c = { x: 0, y: 0, z: 0 };
  for (const vi of face) {
    const v = s.vertices[vi];
    c.x += (v?.x ?? 0) / face.length;
    c.y += (v?.y ?? 0) / face.length;
    c.z += (v?.z ?? 0) / face.length;
  }
  return c;
}

export default suite('ImplicitSurface', [
  [
    '叉积法线处处朝外(与场梯度同向),球端与环端都成立',
    () => {
      for (const t of [0, 0.5, 1]) {
        const s = new Probe(genus, { bounds: 58, resolution: 18, params: [t] });
        let wrong = 0;
        for (let i = 0; i < s.faces.length; i++) {
          const n = s.normal(i);
          const g = gradientAt(genus, faceCenter(s, i), [t]);
          if (n.x * g.x + n.y * g.y + n.z * g.z <= 0) {
            wrong += 1;
          }
        }
        equal(wrong, 0, `t=${t}:${wrong}/${s.faces.length} 个面法线朝内`);
      }
    },
  ],
  [
    '轮廓提取:每条被描出的剪影边两侧恰好一前一后',
    () => {
      const s = new Probe((x, y, z) => sdSphere(x, y, z, 30), { bounds: 45, resolution: 16 });
      const topo = s.topo();
      const view = s.view();
      let contour = 0;
      for (let e = 0; e < topo.edgeCount; e++) {
        const a = topo.faceA[e] ?? -1;
        const b = topo.faceB[e] ?? -1;
        ok(b !== BOUNDARY, '闭合球面不该有边界边');
        if (a >= 0 && b >= 0 && view.front[a] !== view.front[b]) {
          contour += 1;
        }
      }
      ok(contour > 20, `剪影边太少:${contour}`);
      const rec = recordingCtx();
      s.render(rec.ctx, lightTheme);
      const drawnSegments = rec.strokes.reduce((sum, st) => sum + st.segments.length, 0);
      equal(drawnSegments, contour, '无填充时画出的线段数应等于剪影边数');
    },
  ],
  [
    '填充模式下轮廓线紧跟所属正面描出(与面片交错),被遮挡的段会被后画的面盖住',
    () => {
      const s = new ImplicitSurface(genus, { bounds: 58, resolution: 18, params: [1] });
      s.setStyle({ fill: '#88aaee' });
      const rec = recordingCtx();
      s.render(rec.ctx, lightTheme);
      const outlines = rec.strokes
        .map((st, i) => ({ st, i }))
        .filter(({ st }) => st.strokeStyle === lightTheme.stroke);
      ok(outlines.length > 0, '没有描出轮廓');
      // 找到第一条轮廓描边之后还有面片被填:说明轮廓是在画家循环里交错描的,
      // 而不是等所有面都填完再统一压在最上面。
      const firstOutlineOp = rec.ops.findIndex((op, i) => {
        if (op !== 'stroke') {
          return false;
        }
        const strokeIndex = rec.ops.slice(0, i + 1).filter((o) => o === 'stroke').length - 1;
        return rec.strokes[strokeIndex]?.strokeStyle === lightTheme.stroke;
      });
      ok(
        rec.ops.slice(firstOutlineOp).includes('fill'),
        '轮廓全部画在最后,被遮挡的轮廓段会压在表面上',
      );
      // 每条轮廓描边都紧跟在它所属那个面的填充之后:线段端点都是刚填的那个多边形的顶点。
      const isCorner = (path: readonly Segment2D[], x: number, y: number): boolean =>
        path.some(([x1, y1]) => Math.abs(x1 - x) < 1e-9 && Math.abs(y1 - y) < 1e-9);
      let fillIndex = 0;
      let strokeIndex = 0;
      let lastFill: readonly Segment2D[] | null = null;
      let checked = 0;
      for (const op of rec.ops) {
        if (op === 'fill') {
          lastFill = rec.fillPaths[fillIndex] ?? null;
          fillIndex += 1;
          continue;
        }
        const st = rec.strokes[strokeIndex];
        strokeIndex += 1;
        if (!st || st.strokeStyle !== lightTheme.stroke) {
          continue;
        }
        ok(lastFill !== null, '轮廓描在了任何面之前');
        for (const [x1, y1, x2, y2] of st.segments) {
          ok(
            lastFill !== null && isCorner(lastFill, x1, y1) && isCorner(lastFill, x2, y2),
            '轮廓段不属于紧挨着它之前填的那个面',
          );
          checked += 1;
        }
      }
      ok(checked > 20, `核对的轮廓段太少:${checked}`);
    },
  ],
  [
    '填充时用同色描边盖住三角形之间的抗锯齿缝',
    () => {
      const s = new ImplicitSurface((x, y, z) => sdSphere(x, y, z, 30), { bounds: 45, resolution: 10 });
      s.setStyle({ fill: '#ffffff', strokeWidth: 0 });
      const rec = recordingCtx();
      s.render(rec.ctx, lightTheme);
      ok(rec.fills.length > 0, '什么都没画');
      equal(rec.strokes.length, rec.fills.length, '每个面都应该补一笔同色描边');
      rec.strokes.forEach((st, i) => {
        equal(st.strokeStyle, rec.fills[i], '缝隙描边颜色应与面片一致');
      });
      // 半透明时不补:每条三角形边会被叠两遍透明度,浮出一张网格纹。
      s.setStyle({ fill: 'rgba(136, 170, 255, 0.5)' });
      const translucent = recordingCtx();
      s.render(translucent.ctx, lightTheme);
      ok(translucent.fills.length > 0);
      equal(translucent.strokes.length, 0, '半透明填充不该补缝');
    },
  ],
  [
    'resample() 不带参数时按当前参数强制重建(场函数读了外部状态)',
    () => {
      let radius = 20;
      const s = new ImplicitSurface((x, y, z) => sdSphere(x, y, z, radius), {
        bounds: 45,
        resolution: 10,
      });
      const before = s.getCullRadius();
      radius = 35;
      s.resample([0]);
      equal(s.getCullRadius(), before, '同参 resample 应是空操作');
      s.resample();
      ok(s.getCullRadius() > before * 1.4, `没有重建:${before} → ${s.getCullRadius()}`);
    },
  ],
  [
    '同一组参数再次 resample 是空操作;换参数时拓扑随之重建',
    () => {
      const s = new Probe(genus, { bounds: 58, resolution: 18, params: [0] });
      const faces = s.faces;
      s.resample([0]);
      ok(s.faces === faces, '同参重采样重建了网格');
      const euler = (): number => {
        const topo = s.topo();
        return s.vertices.length - topo.edgeCount + s.faces.length;
      };
      equal(euler(), 2, '球(亏格 0)的欧拉示性数应为 2');
      s.resample([1]);
      ok(s.faces !== faces, '换参数后网格没重建');
      equal(euler(), 0, '环(亏格 1)的欧拉示性数应为 0');
      equal(s.getParams()[0], 1);
    },
  ],
  [
    '闭合曲面单面;被包围盒截开(带边界边)时双面',
    () => {
      const closed = new Probe((x, y, z) => sdSphere(x, y, z, 30), { bounds: 45, resolution: 12 });
      equal(closed.isTwoSided(), false);
      const clipped = new Probe((x, y, z) => sdSphere(x, y, z, 30), { bounds: 25, resolution: 12 });
      equal(clipped.isTwoSided(), true, '被截开的球应按双面处理');
    },
  ],
  [
    'resolution / bounds 非法时抛错',
    () => {
      throws(() => new ImplicitSurface(genus, { resolution: 0 }));
      throws(() => new ImplicitSurface(genus, { resolution: 2.5 }));
      throws(() => new ImplicitSurface(genus, { bounds: -1 }));
      throws(() => new ImplicitSurface(genus, { bounds: NaN }));
    },
  ],
]);
