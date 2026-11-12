/* DXF → SVG 转换（纯 JS，无依赖）
 * 把 ASCII DXF 的几何实体转换为等价的 SVG 文本，再交给现有的 SVG 导入管线（parseSvg），
 * 因此缩放适配、线型识别、文字、撤销等行为与 SVG 导入保持一致。
 *
 * 支持：LINE、CIRCLE、ARC、LWPOLYLINE、POLYLINE（含圆弧段 bulge）、SOLID、TEXT、MTEXT、
 *       INSERT（块，含缩放 / 旋转 / 镜像）；SPLINE、ELLIPSE 近似为折线。
 * 跳过并计数：DIMENSION、HATCH、IMAGE 等非几何或无法可靠转换的实体；图层关闭 / 冻结的内容直接忽略。
 * 不支持：二进制 DXB、DWG（由调用方给出提示）。
 */
(function (root) {
'use strict';

// $INSUNITS 代码 → 毛米换算；未设置或 0 时按毫米处理
const UNIT_MM = { 1: 25.4, 2: 304.8, 4: 1, 5: 10, 6: 1000 };
const MAX_DEPTH = 12;

const num = v => { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; };
const fmt = n => { const r = Number(n.toFixed(4)); return String(Object.is(r, -0) ? 0 : r); };
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const deg = a => a * Math.PI / 180;

/* ---------- 仿射矩阵 [a,b,c,d,e,f]：x' = a·x + c·y + e，y' = b·x + d·y + f ---------- */
const IDENTITY = [1, 0, 0, 1, 0, 0];
const mul = (m, n) => [
  m[0] * n[0] + m[2] * n[1], m[1] * n[0] + m[3] * n[1],
  m[0] * n[2] + m[2] * n[3], m[1] * n[2] + m[3] * n[3],
  m[0] * n[4] + m[2] * n[5] + m[4], m[1] * n[4] + m[3] * n[5] + m[5],
];
const apply = (m, x, y) => [m[0] * x + m[2] * y + m[4], m[1] * x + m[3] * y + m[5]];
const translate = (tx, ty) => [1, 0, 0, 1, tx, ty];
const scaleM = (sx, sy) => [sx, 0, 0, sy, 0, 0];
const rotateM = t => [Math.cos(t), Math.sin(t), -Math.sin(t), Math.cos(t), 0, 0];

/* ---------- 解析 DXF 分组码对 ---------- */
function tokenize(text) {
  const lines = text.split(/\r?\n/);
  const pairs = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (Number.isNaN(code)) throw Error('DXF 格式无效');
    pairs.push({ code, value: lines[i + 1].replace(/\s+$/, '') });
  }
  return pairs;
}

const get = (rec, code) => { const p = rec.groups.find(g => g.code === code); return p ? p.value : undefined; };
const all = (rec, code) => rec.groups.filter(g => g.code === code).map(g => g.value);

// 把 POLYLINE 后面紧跟的 VERTEX…SEQEND 收拢到 POLYLINE 上
function linkPolylines(recs) {
  const out = [];
  for (let i = 0; i < recs.length; i++) {
    const r = recs[i];
    if (r.type === 'VERTEX' || r.type === 'SEQEND') continue;
    if (r.type === 'POLYLINE') {
      const vertices = [];
      let j = i + 1;
      for (; j < recs.length && recs[j].type !== 'SEQEND'; j++) if (recs[j].type === 'VERTEX') vertices.push(recs[j]);
      r.vertices = vertices;
      i = j;
    }
    out.push(r);
  }
  return out;
}

function parseDocument(pairs) {
  const doc = { unitMm: 1, layers: new Map(), linetypes: new Map(), blocks: new Map(), entities: [] };
  const recs = [];
  let cur = null;
  for (const p of pairs) {
    if (p.code === 0) { cur = { type: p.value, groups: [] }; recs.push(cur); }
    else if (cur) cur.groups.push(p);
  }

  let section = null, block = null;
  for (const r of recs) {
    if (r.type === 'SECTION') {
      section = get(r, 2);
      if (section === 'HEADER') {
        const i = r.groups.findIndex(g => g.code === 9 && g.value === '$INSUNITS');
        if (i >= 0 && r.groups[i + 1]) doc.unitMm = UNIT_MM[num(r.groups[i + 1].value)] ?? 1;
      }
      continue;
    }
    if (r.type === 'ENDSEC') { section = null; continue; }
    if (section === 'TABLES' && r.type === 'LTYPE') {
      const name = (get(r, 2) || '').toUpperCase();
      if (name) doc.linetypes.set(name, all(r, 49).map(num));
    } else if (section === 'TABLES' && r.type === 'LAYER') {
      doc.layers.set((get(r, 2) || '').toUpperCase(), { frozen: (num(get(r, 70)) & 1) === 1, color: num(get(r, 62)), linetype: (get(r, 6) || '').toUpperCase() });
    } else if (section === 'BLOCKS') {
      if (r.type === 'BLOCK') { block = { base: { x: num(get(r, 10)), y: num(get(r, 20)) }, list: [] }; doc.blocks.set(get(r, 2), block); }
      else if (r.type === 'ENDBLK') block = null;
      else if (block) block.list.push(r);
    } else if (section === 'ENTITIES') {
      doc.entities.push(r);
    }
  }
  doc.entities = linkPolylines(doc.entities);
  for (const b of doc.blocks.values()) b.list = linkPolylines(b.list);
  return doc;
}

/* ---------- 几何辅助 ---------- */
// 圆弧段（bulge）的圆心与半径，p1→p2 按 bulge 的符号（正为逆时针）
function bulgeArc(p1, p2, b) {
  const dx = p2[0] - p1[0], dy = p2[1] - p1[1];
  const L = Math.hypot(dx, dy);
  const theta = 4 * Math.atan(b);
  const h = (L / 2) * (1 - b * b) / (2 * b);      // 圆心到弦中点的有向距离（沿左法线）
  const mx = (p1[0] + p2[0]) / 2, my = (p1[1] + p2[1]) / 2;
  const nx = -dy / L, ny = dx / L;
  const c = [mx + nx * h, my + ny * h];
  const r = Math.hypot(p1[0] - c[0], p1[1] - c[1]);
  return { c, r, theta, a0: Math.atan2(p1[1] - c[1], p1[0] - c[0]) };
}

function sampleBulge(p1, p2, b, steps = 32) {
  if (!b) return [p2];
  const { c, r, theta, a0 } = bulgeArc(p1, p2, b);
  const pts = [];
  for (let i = 1; i <= steps; i++) {
    const t = a0 + theta * i / steps;
    pts.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
  }
  return pts;
}

function sampleArc(c, r, a0, a1, steps) {
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = deg(a0 + (a1 - a0) * i / steps);
    pts.push([c[0] + r * Math.cos(t), c[1] + r * Math.sin(t)]);
  }
  return pts;
}

/* ---------- 实体转换 ---------- */
function convert(text) {
  const pairs = tokenize(text);
  const doc = parseDocument(pairs);
  const out = [];
  const bbox = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  let skipped = 0, approximated = 0;

  // 世界坐标 → SVG 坐标（y 轴翻转，DXF 为 y 向上）；同时扩展包围盒
  const toSvg = (m, x, y) => {
    const [X, Y] = apply(m, x, y);
    const sx = X, sy = -Y;
    bbox.minX = Math.min(bbox.minX, sx); bbox.maxX = Math.max(bbox.maxX, sx);
    bbox.minY = Math.min(bbox.minY, sy); bbox.maxY = Math.max(bbox.maxY, sy);
    return [sx, sy];
  };
  const P = (m, p) => toSvg(m, p[0], p[1]);
  const pointStr = pts => pts.map(p => `${fmt(p[0])} ${fmt(p[1])}`).join(' ');

  const HIDDEN_DASH = ' stroke-dasharray="1.2 0.6"', CENTER_DASH = ' stroke-dasharray="3 0.7 0.35 0.7"';
  const styleFromName = name => {
    if (/CENTER|CENTRE|DASHDOT|CHAIN|PHANTOM|中心线|点划线/.test(name)) return CENTER_DASH;
    if (/HIDDEN|DASH|DOT|ISO|虚线|隐藏线|点线/.test(name)) return HIDDEN_DASH;
    return '';
  };
  // 实体线型常写成 BYLAYER，真正的线型在 LAYER 表的组码 6 上；块内图层 0 / BYBLOCK 继承 INSERT
  const layerNameOf = (rec, inherited) => {
    const name = get(rec, 8) || '0';
    return name === '0' && inherited?.layer ? inherited.layer : name;
  };
  // DXF 的图层名不区分大小写
  const layerLookup = name => doc.layers.get(String(name || '0').toUpperCase());
  const linetypeOf = (rec, inherited) => {
    let name = (get(rec, 6) || '').trim().toUpperCase();
    if (name === 'BYBLOCK' && inherited?.linetype) return inherited.linetype;
    if (!name || name === 'BYLAYER' || name === 'BYBLOCK') {
      const layer = layerLookup(layerNameOf(rec, inherited));
      name = (layer?.linetype || '').trim().toUpperCase();
    }
    return name;
  };
  const lineStyle = (rec, inherited) => {
    const name = linetypeOf(rec, inherited);
    if (!name || name === 'CONTINUOUS' || name === 'BYLAYER' || name === 'BYBLOCK') return '';
    const pattern = doc.linetypes.get(name);
    if (pattern && pattern.length) {
      if (!pattern.some(v => v < 0)) return '';
      return pattern.length >= 4 ? CENTER_DASH : HIDDEN_DASH;
    }
    return styleFromName(name);
  };

  const emitPath = (d, rec, m, inherited) => out.push(`<path d="${d}" fill="none" stroke="black"${lineStyle(rec, inherited)}/>`);
  const emitPoly = (pts, closed, rec, m, inherited) => {
    if (pts.length < 2) return;
    emitPath(`M${pointStr(pts)}${closed ? ' Z' : ''}`, rec, m, inherited);
  };

  // 有向圆 / 弧：uniform 缩放时保留圆与弧，否则退化为折线
  const emitCircle = (rec, m, c, r, a0 = 0, a1 = 360, inherited) => {
    const sLen = Math.hypot(m[0], m[1]);
    const uniform = Math.abs(sLen - Math.hypot(m[2], m[3])) < 1e-6 * Math.max(1, sLen) && Math.abs(m[0] * m[2] + m[1] * m[3]) < 1e-6 * Math.max(1, sLen * sLen);
    const sweep = ((a1 - a0) % 360 + 360) % 360 || 360;
    if (!uniform) {
      approximated++;
      const pts = sampleArc(c, r, a0, a0 + sweep, 72).map(p => P(m, p));
      return emitPoly(pts, sweep >= 359.999, rec, m, inherited);
    }
    const cs = P(m, c);
    if (sweep >= 359.999) {
      out.push(`<circle cx="${fmt(cs[0])}" cy="${fmt(cs[1])}" r="${fmt(r * sLen)}" fill="none" stroke="black"${lineStyle(rec, inherited)}/>`);
      return;
    }
    const p0 = P(m, [c[0] + r * Math.cos(deg(a0)), c[1] + r * Math.sin(deg(a0))]);
    const p1 = P(m, [c[0] + r * Math.cos(deg(a0 + sweep)), c[1] + r * Math.sin(deg(a0 + sweep))]);
    const det = m[0] * m[3] - m[1] * m[2];
    const largeArc = sweep > 180 ? 1 : 0;
    // toSvg 额外翻转了 Y，SVG 的角度方向必须随之反转；块镜像再翻转一次。
    const sweepFlag = det > 0 ? 0 : 1;
    emitPath(`M${fmt(p0[0])} ${fmt(p0[1])}A${fmt(r * sLen)} ${fmt(r * sLen)} 0 ${largeArc} ${sweepFlag} ${fmt(p1[0])} ${fmt(p1[1])}`, rec, m, inherited);
  };

  // 顶点列表（x,y,bulge）→ 路径。圆弧段在 uniform 缩放时保留为 SVG 圆弧
  const emitVertexPath = (verts, closed, rec, m, inherited) => {
    if (verts.length < 2) return;
    const n = verts.length;
    const segCount = closed ? n : n - 1;
    const sLen = Math.hypot(m[0], m[1]);
    const det = m[0] * m[3] - m[1] * m[2];
    const uniform = Math.abs(sLen - Math.hypot(m[2], m[3])) < 1e-6 * Math.max(1, sLen) && Math.abs(m[0] * m[2] + m[1] * m[3]) < 1e-6 * Math.max(1, sLen * sLen);
    let d = '';
    const start = P(m, [verts[0].x, verts[0].y]);
    d += `M${fmt(start[0])} ${fmt(start[1])}`;
    for (let i = 0; i < segCount; i++) {
      const a = verts[i], b = verts[(i + 1) % n];
      const bulge = a.bulge || 0;
      const end = P(m, [b.x, b.y]);
      if (!bulge) { d += `L${fmt(end[0])} ${fmt(end[1])}`; continue; }
      if (!uniform) {
        approximated++;
        for (const p of sampleBulge([a.x, a.y], [b.x, b.y], bulge)) {
          const q = P(m, p);
          d += `L${fmt(q[0])} ${fmt(q[1])}`;
        }
        continue;
      }
      const chord = Math.hypot(b.x - a.x, b.y - a.y);
      const theta = 4 * Math.atan(bulge);
      const r = chord / (2 * Math.sin(Math.abs(theta) / 2)) * sLen;
      const largeArc = Math.abs(theta) > Math.PI ? 1 : 0;
      const sweepFlag = ((bulge > 0) === (det > 0)) ? 0 : 1;
      d += `A${fmt(r)} ${fmt(r)} 0 ${largeArc} ${sweepFlag} ${fmt(end[0])} ${fmt(end[1])}`;
    }
    if (closed) d += 'Z';
    emitPath(d, rec, m, inherited);
  };

  const readLwVertices = rec => {
    const verts = [];
    for (const g of rec.groups) {
      if (g.code === 10) verts.push({ x: num(g.value), y: 0, bulge: 0 });
      else if (g.code === 20 && verts.length) verts[verts.length - 1].y = num(g.value);
      else if (g.code === 42 && verts.length) verts[verts.length - 1].bulge = num(g.value);
    }
    return verts;
  };

  const readPolyVertices = rec => (rec.vertices || []).map(v => ({
    x: num(get(v, 10)), y: num(get(v, 20)), bulge: num(get(v, 42)),
  }));

  const visible = (rec, inherited) => {
    const L = layerLookup(layerNameOf(rec, inherited));
    return !(L && (L.frozen || L.color < 0));
  };

  function emitEntity(rec, m, depth, inherited) {
    if (!visible(rec, inherited)) return;
    const x = k => num(get(rec, k));
    switch (rec.type) {
      case 'LINE': {
        const a = P(m, [x(10), x(20)]), b = P(m, [x(11), x(21)]);
        out.push(`<line x1="${fmt(a[0])}" y1="${fmt(a[1])}" x2="${fmt(b[0])}" y2="${fmt(b[1])}" stroke="black"${lineStyle(rec, inherited)}/>`);
        return;
      }
      case 'CIRCLE':
        return emitCircle(rec, m, [x(10), x(20)], x(40), 0, 360, inherited);
      case 'ARC':
        return emitCircle(rec, m, [x(10), x(20)], x(40), x(50), x(51), inherited);
      case 'LWPOLYLINE':
        return emitVertexPath(readLwVertices(rec), (num(get(rec, 70)) & 1) === 1, rec, m, inherited);
      case 'POLYLINE':
        return emitVertexPath(readPolyVertices(rec), (num(get(rec, 70)) & 1) === 1, rec, m, inherited);
      case 'SPLINE': {
        // 优先用拟合点；没有则用控制点。折线近似，不保证曲线形状一致
        const xs = all(rec, 11).length ? all(rec, 11) : all(rec, 10);
        const ys = all(rec, 21).length ? all(rec, 21) : all(rec, 20);
        const pts = xs.map((v, i) => P(m, [num(v), num(ys[i])]));
        approximated++;
        return emitPoly(pts, false, rec, m, inherited);
      }
      case 'ELLIPSE': {
        const c = [x(10), x(20)], major = [x(11), x(21)], ratio = x(40) || 1;
        let t0 = x(41), t1 = x(42) || Math.PI * 2;
        if (t1 <= t0) t1 += Math.PI * 2;
        const minor = [-major[1] * ratio, major[0] * ratio];
        const N = 96, pts = [];
        for (let i = 0; i <= N; i++) {
          const t = t0 + (t1 - t0) * i / N;
          const px = c[0] + Math.cos(t) * major[0] + Math.sin(t) * minor[0];
          const py = c[1] + Math.cos(t) * major[1] + Math.sin(t) * minor[1];
          pts.push(P(m, [px, py]));
        }
        approximated++;
        return emitPoly(pts, Math.abs(t1 - t0 - Math.PI * 2) < 1e-6, rec, m, inherited);
      }
      case 'SOLID': {
        const p1 = P(m, [x(10), x(20)]), p2 = P(m, [x(11), x(21)]), p3 = P(m, [x(12), x(22)]), p4 = P(m, [x(13), x(23)]);
        // DXF 的 SOLID 顶点顺序为 1-2-4-3
        return emitPoly([p1, p2, p4, p3], true, rec, m, inherited);
      }
      case 'TEXT':
      case 'MTEXT': {
        let text;
        if (rec.type === 'TEXT') text = (get(rec, 1) || '').replace(/%%c/gi, 'Ø').replace(/%%d/gi, '°').replace(/%%p/gi, '±').replace(/%%%/g, '%');
        else {
          text = all(rec, 3).join('') + (get(rec, 1) || '');
          text = text.replace(/\\P/g, ' ').replace(/\\[fFHhCcTtQWAK][^;]*;/g, '').replace(/\\S([^;^]*)[\^#]([^;]*);/g, '$1/$2').replace(/\\\\/g, '\\').replace(/[{}]/g, '');
        }
        if (!text.trim()) return;
        const p = P(m, [x(10), x(20)]);
        const height = x(40) || 2.5;
        const rot = x(50) + Math.atan2(m[1], m[0]) * 180 / Math.PI;
        const size = height * Math.hypot(m[0], m[1]);
        out.push(`<text x="${fmt(p[0])}" y="${fmt(p[1])}" font-size="${fmt(size)}" transform="rotate(${fmt(-rot)} ${fmt(p[0])} ${fmt(p[1])})" fill="black">${esc(text)}</text>`);
        return;
      }
      case 'INSERT': {
        const block = doc.blocks.get(get(rec, 2));
        if (!block || depth >= MAX_DEPTH) { skipped++; return; }
        const sx = x(41) || 1, sy = x(42) || 1, rot = deg(x(50));
        const local = mul(translate(x(10), x(20)), mul(rotateM(rot), mul(scaleM(sx, sy), translate(-block.base.x, -block.base.y))));
        const child = mul(m, local);
        const childContext = { layer: layerNameOf(rec, inherited), linetype: linetypeOf(rec, inherited) };
        for (const br of block.list) if (br.type !== 'ATTDEF' && br.type !== 'ATTRIB') emitEntity(br, child, depth + 1, childContext);
        return;
      }
      default:
        skipped++;
    }
  }

  const base = scaleM(doc.unitMm, doc.unitMm);
  for (const rec of doc.entities) emitEntity(rec, base, 0, null);

  if (!out.length) throw Error('DXF 中没有可导入的几何图形');
  const w = Math.max(bbox.maxX - bbox.minX, 1), h = Math.max(bbox.maxY - bbox.minY, 1);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(bbox.minX)} ${fmt(bbox.minY)} ${fmt(w)} ${fmt(h)}" width="${fmt(w)}mm" height="${fmt(h)}mm">${out.join('')}</svg>`;
  return { svg, skipped, approximated };
}

function isBinaryDxf(text) { return text.startsWith('AutoCAD Binary DXF'); }

const api = { convert, isBinaryDxf };
root.DxfImport = api;
if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
