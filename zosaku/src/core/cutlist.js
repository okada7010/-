// 部材表（拾い出し）。約束：角材は s[0] が長さ、板材・床は s[2] が厚さ。
import { matName } from './catalog.js';

const r1 = v => Math.round(v * 10) / 10;
const r3 = v => Math.round(v * 1000) / 1000;

export function wallArea(w) {
  const L = w.s[0], H = w.s[2];
  let a = L * H;
  for (const o of w.openings || []) {
    const u0 = Math.max(0, o.x), u1 = Math.min(L, o.x + o.w);
    const v0 = Math.max(0, o.sill), v1 = Math.min(H, o.sill + o.h);
    if (u1 > u0 && v1 > v0) a -= (u1 - u0) * (v1 - v0);
  }
  return a / 1e6;
}

// 定尺材から切り出すときの必要本数（長い順に、入るところへ詰める）
export function packStock(lengths, stockLen, kerf = 0) {
  const over = lengths.filter(l => l > stockLen);
  const list = lengths.filter(l => l <= stockLen).sort((a, b) => b - a);
  const remain = [];
  for (const l of list) {
    let placed = false;
    for (let i = 0; i < remain.length; i++) {
      if (remain[i] >= l + kerf) { remain[i] -= l + kerf; placed = true; break; }
    }
    if (!placed) remain.push(stockLen - l);
  }
  return { bins: remain.length, over };
}

function bump(map, key, make) {
  let row = map.get(key);
  if (!row) { row = make(); map.set(key, row); }
  row.qty += 1;
  return row;
}

export function buildCutlist(parts, opt = {}) {
  const stockLen = opt.stockLen || 4000, kerf = opt.kerf ?? 3;
  const sheetW = opt.sheetW || 910, sheetL = opt.sheetL || 1820, loss = opt.loss ?? 0.1;
  const lumber = new Map(), panels = new Map(), walls = new Map(), slabs = new Map(), fittings = new Map(), hardware = new Map(), others = new Map();
  const secs = new Map(), sheets = new Map();
  const fit = (name, type, w, h) => bump(fittings, [name, type, w, h].join('|'), () => ({ name, type, w, h, qty: 0 }));

  for (const p of parts) {
    const mat = p.mat || '';
    if (p.kind === 'lumber') {
      const len = r1(p.s[0]), b = r1(Math.min(p.s[1], p.s[2])), h = r1(Math.max(p.s[1], p.s[2]));
      const row = bump(lumber, [p.name, mat, b, h, len].join('|'), () => ({ name: p.name, mat, b, h, len, qty: 0, totalM: 0 }));
      row.totalM = r3(row.qty * len / 1000);
      const sk = [mat, b, h].join('|');
      if (!secs.has(sk)) secs.set(sk, { mat, b, h, lengths: [] });
      secs.get(sk).lengths.push(len);
    } else if (p.kind === 'panel') {
      const t = r1(p.s[2]), w = r1(Math.min(p.s[0], p.s[1])), len = r1(Math.max(p.s[0], p.s[1]));
      const row = bump(panels, [p.name, mat, t, w, len].join('|'), () => ({ name: p.name, mat, t, w, len, qty: 0, areaM2: 0 }));
      row.areaM2 = r3(row.qty * w * len / 1e6);
      const sk = [mat, t].join('|');
      if (!sheets.has(sk)) sheets.set(sk, { mat, t, area: 0 });
      sheets.get(sk).area += w * len / 1e6;
    } else if (p.kind === 'wall') {
      const len = r1(p.s[0]), t = r1(p.s[1]), h = r1(p.s[2]), area = r3(wallArea(p));
      const row = bump(walls, [p.name, mat, len, t, h, area].join('|'), () => ({ name: p.name, mat, len, t, h, qty: 0, areaM2: 0 }));
      row.areaM2 = r3(row.qty * area);
      for (const o of p.openings || []) {
        if (o.type === 'open') continue;
        fit(o.name || (o.type === 'door' ? 'ドア' : '窓'), o.type, r1(o.w), r1(o.h));
      }
    } else if (p.kind === 'slab') {
      const len = r1(p.s[0]), w = r1(p.s[1]), t = r1(p.s[2]);
      const row = bump(slabs, [p.name, mat, len, w, t].join('|'), () => ({ name: p.name, mat, len, w, t, qty: 0, areaM2: 0 }));
      row.areaM2 = r3(row.qty * len * w / 1e6);
    } else if (p.kind === 'hardware') {
      const d = p.s.map(r1);
      bump(hardware, [p.name, mat, ...d].join('|'), () => ({ name: p.name, mat, w: d[0], d: d[1], h: d[2], qty: 0 }));
    } else if (p.kind === 'fitting') {
      fit(p.name || (p.ftype === 'door' ? 'ドア' : '窓'), p.ftype || 'door', r1(p.s[0]), r1(p.s[2]));
    } else {
      const d = p.s.map(r1);
      bump(others, [p.name, mat, ...d].join('|'), () => ({ name: p.name, mat, x: d[0], y: d[1], z: d[2], qty: 0 }));
    }
  }

  const stock = [...secs.values()].map(s => {
    const pk = packStock(s.lengths, stockLen, kerf);
    return { mat: s.mat, b: s.b, h: s.h, stockLen, count: pk.bins, over: pk.over, pieces: s.lengths.length,
      totalM: r3(s.lengths.reduce((a, l) => a + l, 0) / 1000) };
  });
  const sheetRows = [...sheets.values()].map(s => ({
    mat: s.mat, t: s.t, areaM2: r3(s.area), sheetW, sheetL,
    count: Math.ceil(s.area * (1 + loss) / (sheetW * sheetL / 1e6) - 1e-9)
  }));
  const byName = (a, b) => (a.name || '').localeCompare(b.name || '', 'ja') || (b.len || 0) - (a.len || 0);
  return {
    lumber: [...lumber.values()].sort(byName),
    panels: [...panels.values()].sort(byName),
    walls: [...walls.values()].sort(byName),
    slabs: [...slabs.values()].sort(byName),
    fittings: [...fittings.values()].sort(byName),
    hardware: [...hardware.values()].sort(byName),
    others: [...others.values()].sort(byName),
    stock, sheets: sheetRows,
    opt: { stockLen, kerf, sheetW, sheetL, loss }
  };
}

// 画面とCSVで共通に使う表の定義
export function cutlistTables(cl) {
  const typeName = { door: 'ドア', window: '窓' };
  return [
    { title: '角材', head: ['名称', '材料', '幅', 'せい', '長さ', '本数', '延長(m)'],
      rows: cl.lumber.map(r => [r.name, matName(r.mat), r.b, r.h, r.len, r.qty, r.totalM]) },
    { title: `角材の定尺換算（定尺 ${cl.opt.stockLen}mm、切りしろ ${cl.opt.kerf}mm）`, head: ['材料', '断面', '切り出し数', '延長(m)', '定尺の必要本数', '定尺より長い材'],
      rows: cl.stock.map(r => [matName(r.mat), `${r.b}×${r.h}`, r.pieces, r.totalM, r.count, r.over.length ? r.over.join(' / ') : '']) },
    { title: '板材', head: ['名称', '材料', '厚さ', '幅', '長さ', '枚数', '面積(m2)'],
      rows: cl.panels.map(r => [r.name, matName(r.mat), r.t, r.w, r.len, r.qty, r.areaM2]) },
    { title: `板材の定尺換算（参考：${cl.opt.sheetW}×${cl.opt.sheetL}、ロス ${Math.round(cl.opt.loss * 100)}%を見込む）`, head: ['材料', '厚さ', '面積(m2)', '定尺の参考枚数'],
      rows: cl.sheets.map(r => [matName(r.mat), r.t, r.areaM2, r.count]) },
    { title: '壁', head: ['名称', '長さ', '厚さ', '高さ', '数', '面積(m2)（開口を除く）'],
      rows: cl.walls.map(r => [r.name, r.len, r.t, r.h, r.qty, r.areaM2]) },
    { title: '床・天井', head: ['名称', '材料', '長さ', '奥行', '厚さ', '数', '面積(m2)'],
      rows: cl.slabs.map(r => [r.name, matName(r.mat), r.len, r.w, r.t, r.qty, r.areaM2]) },
    { title: '建具', head: ['名称', '種類', '幅', '高さ', '数'],
      rows: cl.fittings.map(r => [r.name, typeName[r.type] || r.type, r.w, r.h, r.qty]) },
    { title: '金物', head: ['名称', '材料', '幅', '腕の長さ', '縦の長さ', '数'],
      rows: cl.hardware.map(r => [r.name, matName(r.mat), r.w, r.d, r.h, r.qty]) },
    { title: 'その他', head: ['名称', '材料', 'X寸法', 'Y寸法', 'Z寸法', '数'],
      rows: cl.others.map(r => [r.name, matName(r.mat), r.x, r.y, r.z, r.qty]) }
  ];
}

const csvCell = v => {
  let s = String(v ?? '');
  if (/^[=+\-@\t\r]/.test(s) && typeof v !== 'number') s = "'" + s; // 表計算ソフトで式として動かないようにする
  return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
};

export function cutlistCsv(cl, titleLines = []) {
  const lines = [];
  for (const t of titleLines) lines.push(t.map(csvCell).join(','));
  if (titleLines.length) lines.push('');
  for (const tb of cutlistTables(cl)) {
    if (!tb.rows.length) continue;
    lines.push(csvCell('【' + tb.title + '】'));
    lines.push(tb.head.map(csvCell).join(','));
    for (const r of tb.rows) lines.push(r.map(csvCell).join(','));
    lines.push('');
  }
  return '﻿' + lines.join('\r\n') + '\r\n';
}
