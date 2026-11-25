// 図面データ（部材の一覧）と、保存・読込・元に戻す。
import { rnd } from './geom.js';

export const APP_ID = 'zosaku3dcad';
export const KINDS = ['lumber', 'panel', 'wall', 'slab', 'box', 'fitting'];

export function newDoc() {
  return { app: APP_ID, version: 1, name: '無題', seq: 1, parts: [], dims: [] };
}

const num3 = a => Array.isArray(a) && a.length === 3 && a.every(v => typeof v === 'number' && Number.isFinite(v));

function cleanOpening(o, i) {
  const n = k => (typeof o[k] === 'number' && Number.isFinite(o[k]) ? o[k] : 0);
  return {
    id: typeof o.id === 'string' ? o.id : 'o' + (i + 1),
    type: ['door', 'window', 'open'].includes(o.type) ? o.type : 'open',
    name: typeof o.name === 'string' ? o.name : '',
    x: n('x'), w: Math.max(1, n('w')), h: Math.max(1, n('h')), sill: Math.max(0, n('sill'))
  };
}

function cleanPart(p) {
  if (!p || typeof p !== 'object') return null;
  if (!KINDS.includes(p.kind) || !num3(p.c) || !num3(p.s) || !num3(p.r)) return null;
  if (p.s.some(v => v <= 0)) return null;
  const out = {
    id: String(p.id || ''),
    kind: p.kind,
    name: typeof p.name === 'string' ? p.name : '',
    mat: typeof p.mat === 'string' ? p.mat : 'wood',
    c: p.c.map(v => rnd(v)), s: p.s.map(v => rnd(v)), r: p.r.map(v => rnd(v)),
    g: typeof p.g === 'string' && p.g ? p.g : null
  };
  if (typeof p.note === 'string' && p.note) out.note = p.note;
  if (p.kind === 'wall') out.openings = Array.isArray(p.openings) ? p.openings.map(cleanOpening) : [];
  if (p.kind === 'fitting') out.ftype = p.ftype === 'window' ? 'window' : 'door';
  return out;
}

export function addPart(doc, props) {
  const part = cleanPart({ r: [0, 0, 0], ...props, id: 'p' + doc.seq });
  if (!part) throw new Error('部材の寸法が正しくありません');
  doc.seq += 1;
  doc.parts.push(part);
  return part;
}

export function newGroupId(doc) {
  const id = 'g' + doc.seq;
  doc.seq += 1;
  return id;
}

export function newSubId(doc, prefix) {
  const id = prefix + doc.seq;
  doc.seq += 1;
  return id;
}

export function serializeDoc(doc) {
  return JSON.stringify(doc);
}

export function parseDoc(text) {
  let raw;
  try { raw = JSON.parse(text); } catch (e) { throw new Error('ファイルを読めません（JSON形式ではありません）'); }
  if (!raw || raw.app !== APP_ID || !Array.isArray(raw.parts)) {
    throw new Error('造作3DCADのファイルではありません');
  }
  const doc = newDoc();
  doc.name = typeof raw.name === 'string' ? raw.name : '無題';
  const seen = new Set();
  let maxNo = 0;
  const noteId = id => { const m = /(\d+)$/.exec(id || ''); if (m) maxNo = Math.max(maxNo, Number(m[1])); };
  for (const p of raw.parts) {
    const part = cleanPart(p);
    if (!part || !part.id || seen.has(part.id)) continue;
    seen.add(part.id);
    noteId(part.id); noteId(part.g);
    (part.openings || []).forEach(o => noteId(o.id));
    doc.parts.push(part);
  }
  for (const d of Array.isArray(raw.dims) ? raw.dims : []) {
    if (d && num3(d.a) && num3(d.b)) {
      const dim = { id: String(d.id || 'd' + (doc.dims.length + 1)), a: d.a.map(v => rnd(v)), b: d.b.map(v => rnd(v)) };
      noteId(dim.id);
      doc.dims.push(dim);
    }
  }
  doc.seq = Math.max(Number.isInteger(raw.seq) ? raw.seq : 1, maxNo + 1);
  return doc;
}

// 元に戻す・やり直し（状態を文字列で積む）
export class History {
  constructor(limit = 100) { this.limit = limit; this.past = []; this.future = []; }
  push(state) {
    this.past.push(state);
    if (this.past.length > this.limit) this.past.shift();
    this.future.length = 0;
  }
  undo(current) {
    if (!this.past.length) return null;
    this.future.push(current);
    return this.past.pop();
  }
  redo(current) {
    if (!this.future.length) return null;
    this.past.push(current);
    return this.future.pop();
  }
  get canUndo() { return this.past.length > 0; }
  get canRedo() { return this.future.length > 0; }
}

// 壁：平面上の2点（芯）から箱を作る。長さ＝ローカルX、厚さ＝ローカルY、高さ＝ローカルZ。
export function wallFromPoints(a, b, t, h, z0) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const L = Math.hypot(dx, dy);
  return {
    c: [rnd((a[0] + b[0]) / 2), rnd((a[1] + b[1]) / 2), rnd(z0 + h / 2)],
    s: [rnd(L), t, h],
    r: [0, 0, rnd(Math.atan2(dy, dx) * 180 / Math.PI)]
  };
}

// 壁の芯の両端（平面座標）
export function wallEnds(w) {
  const a = w.r[2] * Math.PI / 180, hx = Math.cos(a) * w.s[0] / 2, hy = Math.sin(a) * w.s[0] / 2;
  return { a: [rnd(w.c[0] - hx), rnd(w.c[1] - hy)], b: [rnd(w.c[0] + hx), rnd(w.c[1] + hy)] };
}
