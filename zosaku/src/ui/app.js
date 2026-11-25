// 造作3DCAD 本体（画面の操作）
import * as THREE from 'three';
import { OBJExporter } from 'three/addons/exporters/OBJExporter.js';
import { View3D } from './view3d.js';
import { aabbOf, unionAabb, cornersOf, rotateParts, translateParts, localToWorld, worldToLocal, centerOf, rnd } from '../core/geom.js';
import { newDoc, addPart, newGroupId, newSubId, serializeDoc, parseDoc, History, wallFromPoints, wallEnds } from '../core/model.js';
import { snapGrid, snapBox } from '../core/snap.js';
import { frameWall } from '../core/framing.js';
import { makeCabinet, makeCounter, makeWallShelf } from '../core/cabinet.js';
import { buildCutlist, cutlistTables, cutlistCsv } from '../core/cutlist.js';
import { MATS, LIBRARY, KIND_NAMES, SIZE_LABELS, WALL_PRESETS } from '../core/catalog.js';
import { buildSample } from '../core/sample.js';
import { autoDims } from '../core/dims.js';

const VERSION = '__VER__';
const SAVE_KEY = 'zosaku3dcad.autosave.v1';
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = v => { const r = Math.round(v * 10) / 10; return Number.isInteger(r) ? String(r) : r.toFixed(1); };
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const pad2 = n => String(n).padStart(2, '0');
const today = () => { const d = new Date(); return { y: d.getFullYear(), m: pad2(d.getMonth() + 1), d: pad2(d.getDate()) }; };

const S = {
  doc: newDoc(), sel: new Set(), selDim: null, tool: 'select', hidden: new Set(),
  grid: 10, osnap: true, place: null, libOn: null,
  wall: { t: 90, h: 2400, z: 0, ortho: true, last: null, typed: '', cur: null }, autoDim: true, autoDimKey: '', autoDimList: [],
  measure: { a: null }, drag: null, down: null, clip: null, clipboard: null, pasteN: 0,
  live: [], lastMove: null,
  clOpt: { stockLen: 4000, kerf: 3, loss: 10, sheet: '910x1820', onlySel: false }
};
const history = new History(100);
let view;
let byId = new Map();
const cornerCache = new Map();

// ---------- 共通 ----------
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.t);
  toast.t = setTimeout(() => el.classList.remove('show'), 2600);
}

const selParts = () => S.doc.parts.filter(p => S.sel.has(p.id));
const groupIds = g => S.doc.parts.filter(p => p.g === g).map(p => p.id);
const visibleParts = () => S.doc.parts.filter(p => !S.hidden.has(p.kind));

function pushHistory() { history.push(serializeDoc(S.doc)); }

function commit(fn) {
  pushHistory();
  fn();
  refresh();
}

function refresh(save = true) {
  byId = new Map(S.doc.parts.map(p => [p.id, p]));
  cornerCache.clear();
  for (const id of [...S.sel]) if (!byId.has(id)) S.sel.delete(id);
  if (S.selDim && !S.doc.dims.some(d => d.id === S.selDim)) S.selDim = null;
  view.sync(S.doc.parts, S.sel, S.hidden);
  view.setDims(S.doc.dims, S.selDim);
  updateLabels();
  renderProps();
  renderList();
  updateButtons();
  updateStatus();
  if (save) autosaveSoon();
}

function lightRefresh() {
  cornerCache.clear();
  view.sync(S.doc.parts, S.sel, S.hidden);
  updateLabels();
}

function autosaveSoon() {
  clearTimeout(autosaveSoon.t);
  autosaveSoon.t = setTimeout(() => {
    try { localStorage.setItem(SAVE_KEY, serializeDoc(S.doc)); } catch (e) { /* 保存できない環境でも動かす */ }
  }, 600);
}

// 自動の寸法：選んだ部材（なければ表示中の全部）。壁・床がある図面全体は外形だけ
function updateAutoDims() {
  let list = [];
  if (S.autoDim) {
    const target = S.sel.size ? selParts() : visibleParts();
    const chains = S.sel.size > 0 || !target.some(p => p.kind === 'wall' || p.kind === 'slab');
    list = autoDims(target, view.viewDir(), { chains });
  }
  const key = JSON.stringify(list.map(d => [d.a, d.b]));
  if (key === S.autoDimKey) return false;
  S.autoDimKey = key;
  S.autoDimList = list;
  view.setAutoDims(list);
  return true;
}

function updateLabels() {
  updateAutoDims();
  const list = [];
  for (const d of S.doc.dims) {
    const len = Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1], d.b[2] - d.a[2]);
    list.push({ key: 'd:' + d.id, p: [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2, (d.a[2] + d.b[2]) / 2], text: fmt(len), cls: 'dim' + (d.id === S.selDim ? ' sel' : ''), data: d.id });
  }
  S.autoDimList.forEach((d, i) => list.push({
    key: 'a' + i, p: [(d.a[0] + d.b[0]) / 2, (d.a[1] + d.b[1]) / 2, (d.a[2] + d.b[2]) / 2],
    text: d.text, cls: 'adim' + (d.kind === 'total' ? ' total' : ''), seg: [d.a, d.b]
  }));
  if (S.sel.size === 1 && !S.autoDim) {
    const p = byId.get([...S.sel][0]);
    if (p) {
      const h = [p.s[0] / 2, p.s[1] / 2, p.s[2] / 2];
      list.push({ key: 's0', p: localToWorld(p, [0, -h[1], -h[2]]), text: fmt(p.s[0]), cls: 'size' });
      list.push({ key: 's1', p: localToWorld(p, [-h[0], 0, -h[2]]), text: fmt(p.s[1]), cls: 'size' });
      list.push({ key: 's2', p: localToWorld(p, [-h[0], -h[1], 0]), text: fmt(p.s[2]), cls: 'size' });
    }
  }
  for (const l of S.live) list.push(l);
  view.setLabels(list);
}

function updateStatus(pos) {
  if (pos) $('#stPos').innerHTML = `X <b>${fmt(pos[0])}</b>　Y <b>${fmt(pos[1])}</b>　Z <b>${fmt(pos[2])}</b>`;
  $('#stSel').innerHTML = S.sel.size ? `選択 <b>${S.sel.size}</b>` : '';
  $('#stAll').innerHTML = `部材 <b>${S.doc.parts.length}</b>　寸法 <b>${S.doc.dims.length}</b>`;
  $('#viewInfo').textContent = `${view.isOrtho ? '平行投影' : '透視投影'}・刻み ${S.grid}mm${S.osnap ? '・吸着あり' : ''}`;
}

function setMsg(t) { $('#stMsg').textContent = t || ''; }

function updateButtons() {
  const n = S.sel.size, grp = selParts().some(p => p.g);
  document.querySelectorAll('[data-need]').forEach(b => {
    const need = b.dataset.need;
    b.disabled = need === 'sel' ? n < 1 : need === 'sel2' ? n < 2 : need === 'grp' ? !grp : !(n || S.selDim);
  });
  $('[data-act=undo]').disabled = !history.canUndo;
  $('[data-act=redo]').disabled = !history.canRedo;
  document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === S.tool && !S.place));
  $('#btnOrtho').classList.toggle('on', view.isOrtho);
  $('#btnOsnap').classList.toggle('on', S.osnap);
  $('#btnClip').classList.toggle('on', S.clip !== null);
  $('#btnAutoDim').classList.toggle('on', S.autoDim);
  document.querySelectorAll('#lib .item').forEach(b => b.classList.toggle('on', b.dataset.key === S.libOn));
}

// ---------- ツールの切替と、上のバーの案内 ----------
function setTool(tool) {
  S.tool = tool;
  S.place = null; S.libOn = null;
  S.wall.last = null; S.wall.typed = ''; S.wall.cur = null;
  S.measure.a = null;
  S.live = [];
  view.setGhost(null);
  view.setMarker(null);
  view.setDims(S.doc.dims, S.selDim);
  view.dom.style.cursor = tool === 'select' ? '' : 'crosshair';
  renderCtx();
  updateLabels();
  updateButtons();
  setMsg('');
}

function renderCtx() {
  const el = $('#ctx');
  const tip = t => `<span class="tip" title="${esc(t)}">${esc(t)}</span>`;
  if (S.place) {
    el.innerHTML = `<b>${esc(S.place.label)}</b>` + (S.place.opening
      ? tip('壁をクリックすると、その位置に入ります（Shift＋クリック＝続けて入れる、Esc＝中止）')
      : S.place.wallMount
        ? tip('壁の面をクリックすると、背を壁に向けて、指定の高さに付きます（Shift＋クリック＝続けて置く、Esc＝中止）')
        : tip('クリックで置きます。ほかの部材の面に合わせると、その面に付きます（R＝90°回転、Shift＋クリック＝続けて置く、Esc＝中止）'));
    return;
  }
  if (S.tool === 'wall') {
    el.innerHTML = `<b>壁を描く</b>
      <label>厚さ <select id="wPreset">${WALL_PRESETS.map(p => `<option value="${p.t}"${p.t === S.wall.t ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}<option value=""${WALL_PRESETS.some(p => p.t === S.wall.t) ? '' : ' selected'}>数値で指定</option></select>
      <input type="number" id="wT" value="${S.wall.t}" min="10" step="1"></label>
      <label>高さ <input type="number" id="wH" value="${S.wall.h}" min="100" step="10"></label>
      <label>下端 <input type="number" id="wZ" value="${S.wall.z}" step="10"></label>
      <label><input type="checkbox" id="wOrtho"${S.wall.ortho ? ' checked' : ''}> 直交</label>` +
      tip('始点→終点の順にクリック（続けて描けます）。数字＋Enterで長さ指定。ダブルクリックかEscで終了');
    return;
  }
  if (S.tool === 'measure') {
    el.innerHTML = '<b>寸法を測る</b>' + tip('2点をクリックすると寸法線が残ります（部材の角に吸着）。寸法の数字をクリック→Deleteで消せます');
    return;
  }
  el.innerHTML = '<b>選択・移動</b>' + tip('クリック＝選択（Shiftで追加、Altでグループ内の1本）／部材をドラッグ＝移動（Shiftで上下、Altで位置合わせなし）／何もない所をドラッグ＝視点の回転、右ドラッグ＝視点の移動、ホイール＝拡大縮小');
}

// ---------- 部材ライブラリ ----------
function renderLib() {
  const el = $('#lib');
  el.innerHTML = LIBRARY.map((cat, ci) => `<section><h3>${esc(cat.title)}</h3><div class="items">${cat.items.map((it, ii) => {
    let sub = it.hint || '';
    if (it.type === 'part' && it.kind === 'lumber') sub = `${fmt(it.s[1])}×${fmt(it.s[2])}　長さ ${fmt(it.s[0])}`;
    else if (it.type === 'part' && it.kind === 'panel') sub = `${fmt(it.s[0])}×${fmt(it.s[1])}　厚 ${fmt(it.s[2])}`;
    else if (it.type === 'part') sub = `${fmt(it.s[0])}×${fmt(it.s[1])}×${fmt(it.s[2])}`;
    return `<button class="item" data-key="${ci}-${ii}">${esc(it.name)}${sub ? `<small>${esc(sub)}</small>` : ''}</button>`;
  }).join('')}</div></section>`).join('');
  el.addEventListener('click', e => {
    const h = e.target.closest('h3');
    if (h) { h.parentElement.classList.toggle('closed'); return; }
    const b = e.target.closest('.item');
    if (!b) return;
    const [ci, ii] = b.dataset.key.split('-').map(Number);
    useLibItem(LIBRARY[ci].items[ii], b.dataset.key);
  });
}

async function useLibItem(it, key) {
  if (it.type === 'tool') { setTool(it.tool); return; }
  if (it.type === 'opening') {
    setTool('select');
    S.place = { opening: { ...it.o, name: it.name.replace(/\s*W\d.*$/, '') }, label: it.name };
    S.libOn = key;
    view.dom.style.cursor = 'crosshair';
    renderCtx(); updateButtons();
    return;
  }
  if (it.type === 'gen') {
    if (it.gen === 'wallshelf') {
      const parts = await askWallShelf();
      if (parts) startPlace(parts, it.name, 0, key, { fixZ: true, wallMount: true });
      return;
    }
    const parts = it.gen === 'cabinet' ? await askCabinet() : await askCounter();
    if (parts) startPlace(parts, it.name, 0, key);
    return;
  }
  const part = { kind: it.kind, name: it.name, mat: it.mat, c: [0, 0, 0], s: it.s.slice(), r: it.stand ? [0, -90, 0] : [0, 0, 0] };
  startPlace([part], it.name, it.z || 0, key, { wallMount: it.kind === 'hardware' });
}

// ---------- 配置（仮表示をマウスに付けて、クリックで置く） ----------
function normalizePlace(parts) {
  const b = unionAabb(parts), c = centerOf(b);
  translateParts(parts, [-c[0], -c[1], -b.min[2]]);
}

// opts.fixZ：作ったときの高さのまま置く／opts.wallMount：壁の面をクリックすると、背（+Y）を壁に向ける
function startPlace(parts, label, z0, key, opts = {}) {
  setTool('select');
  if (opts.fixZ) z0 = unionAabb(parts).min[2];
  normalizePlace(parts);
  S.place = { parts, label, z0: z0 || 0, cur: null, fixZ: !!opts.fixZ, wallMount: !!opts.wallMount,
    base: opts.wallMount ? JSON.parse(JSON.stringify(parts)) : null, rot: 0 };
  S.libOn = key || null;
  view.dom.style.cursor = 'crosshair';
  renderCtx(); updateButtons();
  if (S.lastMove) movePlace(S.lastMove);
}

function movePlace(e) {
  const pl = S.place;
  if (!pl || pl.opening) return;
  const pick = view.pick(e.clientX, e.clientY);
  if (pl.wallMount && pick && Math.abs(pick.normal[2]) < 0.5) {
    // 正面（-Y）を面の外向きに合わせる
    const deg = rnd(Math.atan2(pick.normal[0], -pick.normal[1]) * 180 / Math.PI, 2);
    if (deg !== pl.rot) {
      pl.parts = JSON.parse(JSON.stringify(pl.base));
      if (deg) rotateParts(pl.parts, 'z', deg, [0, 0, 0]);
      normalizePlace(pl.parts);
      pl.rot = deg;
    }
  }
  const b = unionAabb(pl.parts), c0 = centerOf(b);
  const half = [(b.max[0] - b.min[0]) / 2, (b.max[1] - b.min[1]) / 2, (b.max[2] - b.min[2]) / 2];
  let center;
  if (pick) {
    const n = pick.normal;
    const ax = Math.abs(n[0]) > Math.abs(n[1]) ? (Math.abs(n[0]) > Math.abs(n[2]) ? 0 : 2) : (Math.abs(n[1]) > Math.abs(n[2]) ? 1 : 2);
    const sg = n[ax] >= 0 ? 1 : -1;
    center = pick.point.slice();
    for (let i = 0; i < 3; i++) if (i !== ax) center[i] = snapGrid(center[i] - half[i], S.grid) + half[i];
    center[ax] = rnd(pick.point[ax], 1) + sg * half[ax];
  } else {
    const pt = view.planePoint(e.clientX, e.clientY, [0, 0, 1], [0, 0, 0]);
    if (!pt || Math.hypot(pt[0], pt[1]) > 500000) return;
    center = [snapGrid(pt[0] - half[0], S.grid) + half[0], snapGrid(pt[1] - half[1], S.grid) + half[1], pl.z0 + half[2]];
  }
  if (pl.fixZ) center[2] = pl.z0 + half[2];
  const d = [center[0] - c0[0], center[1] - c0[1], center[2] - c0[2]];
  pl.cur = pl.parts.map(p => ({ ...p, c: [rnd(p.c[0] + d[0]), rnd(p.c[1] + d[1]), rnd(p.c[2] + d[2])] }));
  view.setGhost(pl.cur);
  updateStatus([center[0] - half[0], center[1] - half[1], center[2] - half[2]]);
}

function commitPlace(keep) {
  const pl = S.place;
  if (!pl || !pl.cur) return;
  commit(() => {
    const gid = pl.cur.length > 1 ? newGroupId(S.doc) : null;
    S.sel = new Set(pl.cur.map(p => addPart(S.doc, { ...p, g: gid }).id));
    S.selDim = null;
  });
  if (!keep) setTool('select');
}

function placeOpening(e, keep) {
  const o = S.place.opening;
  const pick = view.pick(e.clientX, e.clientY);
  const w = pick && byId.get(pick.id);
  if (!w || w.kind !== 'wall') { toast('壁をクリックしてください'); return; }
  if (o.w > w.s[0]) { toast('壁の長さが開口の幅より短いため、入れられません'); return; }
  const u = worldToLocal(w, pick.point)[0] + w.s[0] / 2;
  const x = clamp(snapGrid(u - o.w / 2, S.grid), 0, w.s[0] - o.w);
  const sill = Math.min(o.sill, Math.max(0, w.s[2] - 100));
  const h = Math.min(o.h, w.s[2] - sill);
  commit(() => {
    w.openings.push({ id: newSubId(S.doc, 'o'), type: o.type, name: o.name, x, w: o.w, h, sill });
    S.sel = new Set([w.id]); S.selDim = null;
  });
  if (!keep) setTool('select');
}

// ---------- 壁を描く ----------
function wallPoint(e) {
  const pt = view.planePoint(e.clientX, e.clientY, [0, 0, 1], [0, 0, S.wall.z]);
  if (!pt || Math.hypot(pt[0], pt[1]) > 500000) return null;
  let p = [snapGrid(pt[0], S.grid), snapGrid(pt[1], S.grid)];
  const tol = view.mmPerPixel() * 10;
  let best = tol;
  for (const w of S.doc.parts) {
    if (w.kind !== 'wall') continue;
    const en = wallEnds(w);
    for (const q of [en.a, en.b]) {
      const d = Math.hypot(q[0] - pt[0], q[1] - pt[1]);
      if (d < best) { best = d; p = q.slice(); }
    }
  }
  const last = S.wall.last;
  if (last && S.wall.ortho && !e.altKey) {
    if (Math.abs(p[0] - last[0]) >= Math.abs(p[1] - last[1])) p[1] = last[1]; else p[0] = last[0];
  }
  return p;
}

function moveWall(e) {
  const p = wallPoint(e);
  if (!p) return;
  S.wall.cur = p;
  const last = S.wall.last;
  view.setMarker([p[0], p[1], S.wall.z]);
  if (last) {
    let b = p;
    const len0 = Math.hypot(p[0] - last[0], p[1] - last[1]);
    if (S.wall.typed && len0 > 0) {
      const L = Number(S.wall.typed);
      b = [last[0] + (p[0] - last[0]) / len0 * L, last[1] + (p[1] - last[1]) / len0 * L];
    }
    const len = Math.hypot(b[0] - last[0], b[1] - last[1]);
    if (len > 1) {
      view.setGhost([{ ...wallFromPoints(last, b, S.wall.t, S.wall.h, S.wall.z) }]);
      S.live = [{ key: 'live', p: [(last[0] + b[0]) / 2, (last[1] + b[1]) / 2, S.wall.z + S.wall.h], text: (S.wall.typed ? '長さ ' : '') + fmt(len), cls: 'live' }];
    } else { view.setGhost(null); S.live = []; }
    updateLabels();
  }
  updateStatus([p[0], p[1], S.wall.z]);
}

// 既存の壁との取り合い：角（相手の端）なら相手の厚さの半分だけ伸ばし、T字（相手の途中）なら面で止める
function joinAdjust(pt, dir, sign) {
  for (const w of S.doc.parts) {
    if (w.kind !== 'wall') continue;
    const en = wallEnds(w), L = w.s[0];
    if (L < 1) continue;
    const wd = [(en.b[0] - en.a[0]) / L, (en.b[1] - en.a[1]) / L];
    if (Math.abs(dir[0] * wd[1] - dir[1] * wd[0]) < 0.2) continue;
    const rx = pt[0] - en.a[0], ry = pt[1] - en.a[1];
    const t = rx * wd[0] + ry * wd[1];
    if (t < -1 || t > L + 1 || Math.abs(rx * wd[1] - ry * wd[0]) > 1) continue;
    const k = w.s[1] / 2;
    return (t < 1 || t > L - 1) ? sign * k : -sign * k;
  }
  return 0;
}

function addWallSeg(a, b) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
  if (len < 1) return false;
  const dir = [(b[0] - a[0]) / len, (b[1] - a[1]) / len];
  const ja = joinAdjust(a, dir, -1), jb = joinAdjust(b, dir, 1);
  const a2 = [a[0] + dir[0] * ja, a[1] + dir[1] * ja], b2 = [b[0] + dir[0] * jb, b[1] + dir[1] * jb];
  if (Math.hypot(b2[0] - a2[0], b2[1] - a2[1]) < 1) return false;
  commit(() => {
    addPart(S.doc, { kind: 'wall', name: '壁', mat: 'wall', ...wallFromPoints(a2, b2, S.wall.t, S.wall.h, S.wall.z), openings: [] });
  });
  return true;
}

function wallClick(e) {
  const p = wallPoint(e);
  if (!p) return;
  if (!S.wall.last) { S.wall.last = p; setMsg('終点をクリック（数字＋Enterで長さ指定）'); return; }
  if (addWallSeg(S.wall.last, p)) { S.wall.last = p; S.wall.typed = ''; }
  view.setGhost(null); S.live = []; updateLabels();
}

function endWallChain() {
  S.wall.last = null; S.wall.typed = '';
  view.setGhost(null); S.live = []; updateLabels(); setMsg('');
}

function wallTypedEnter() {
  const w = S.wall;
  if (!w.last) return;
  if (!w.typed) { endWallChain(); return; }
  const L = Number(w.typed);
  const cur = w.cur || [w.last[0] + 1, w.last[1]];
  let dx = cur[0] - w.last[0], dy = cur[1] - w.last[1];
  const n = Math.hypot(dx, dy);
  if (n < 1e-6) { dx = 1; dy = 0; } else { dx /= n; dy /= n; }
  const b = [rnd(w.last[0] + dx * L), rnd(w.last[1] + dy * L)];
  if (L > 0 && addWallSeg(w.last, b)) w.last = b;
  w.typed = '';
  view.setGhost(null); S.live = []; updateLabels();
}

// ---------- 寸法を測る ----------
function cornersCached(p) {
  let c = cornerCache.get(p.id);
  if (!c) { c = cornersOf(p); cornerCache.set(p.id, c); }
  return c;
}

function measurePoint(e) {
  const r = view.dom.getBoundingClientRect();
  const mx = e.clientX - r.left, my = e.clientY - r.top;
  let best = 11, bp = null;
  for (const p of visibleParts()) {
    for (const c of cornersCached(p)) {
      const s = view.project(c);
      if (s.behind) continue;
      const d = Math.hypot(s.x - mx, s.y - my);
      if (d < best) { best = d; bp = c; }
    }
  }
  if (bp) return bp.map(v => rnd(v, 1));
  const pick = view.pick(e.clientX, e.clientY);
  if (pick) return pick.point.map(v => rnd(v, 1));
  const pt = view.planePoint(e.clientX, e.clientY, [0, 0, 1], [0, 0, 0]);
  if (!pt || Math.hypot(pt[0], pt[1]) > 500000) return null;
  return [snapGrid(pt[0], S.grid), snapGrid(pt[1], S.grid), 0];
}

function moveMeasure(e) {
  const p = measurePoint(e);
  if (!p) return;
  view.setMarker(p);
  const a = S.measure.a;
  if (a) {
    view.setDims([...S.doc.dims, { id: 'live', a, b: p }], S.selDim);
    const len = Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]);
    S.live = [{ key: 'live', p: [(a[0] + p[0]) / 2, (a[1] + p[1]) / 2, (a[2] + p[2]) / 2], text: fmt(len), cls: 'live' }];
    setMsg(`距離 ${fmt(len)}　ΔX ${fmt(Math.abs(p[0] - a[0]))}　ΔY ${fmt(Math.abs(p[1] - a[1]))}　ΔZ ${fmt(Math.abs(p[2] - a[2]))}`);
    updateLabels();
  }
  updateStatus(p);
}

function measureClick(e) {
  const p = measurePoint(e);
  if (!p) return;
  if (!S.measure.a) { S.measure.a = p; setMsg('2点目をクリック'); return; }
  const a = S.measure.a;
  S.measure.a = null; S.live = [];
  if (Math.hypot(p[0] - a[0], p[1] - a[1], p[2] - a[2]) < 0.5) { refresh(false); return; }
  commit(() => { S.doc.dims.push({ id: newSubId(S.doc, 'd'), a, b: p }); });
}

// ---------- 選択とドラッグ移動 ----------
function clickSelect(pick, e) {
  S.selDim = null;
  if (!pick || !byId.get(pick.id)) {
    if (!e.shiftKey) S.sel.clear();
  } else {
    const part = byId.get(pick.id);
    const ids = part.g && !e.altKey ? groupIds(part.g) : [part.id];
    if (e.shiftKey) {
      const all = ids.every(i => S.sel.has(i));
      ids.forEach(i => (all ? S.sel.delete(i) : S.sel.add(i)));
    } else S.sel = new Set(ids);
  }
  refresh(false);
}

function beginDrag(e) {
  const pick = S.down.pick, part = byId.get(pick.id);
  if (!part) return;
  if (!S.sel.has(part.id)) {
    S.sel = new Set(part.g && !e.altKey ? groupIds(part.g) : [part.id]);
    S.selDim = null;
  }
  const parts = selParts();
  pushHistory();
  S.drag = {
    p0: pick.point, parts, orig: parts.map(p => p.c.slice()), box: unionAabb(parts),
    others: S.doc.parts.filter(p => !S.sel.has(p.id) && !S.hidden.has(p.kind)).map(aabbOf), d: [0, 0, 0]
  };
}

function doDrag(e) {
  const g = S.drag, dir = view.viewDir();
  let d, free;
  if (e.shiftKey) {
    let n = [dir[0], dir[1], 0];
    if (Math.hypot(n[0], n[1]) < 1e-3) n = [0, -1, 0];
    const pt = view.planePoint(e.clientX, e.clientY, n, g.p0);
    if (!pt) return;
    d = [0, 0, pt[2] - g.p0[2]]; free = [false, false, true];
  } else if (Math.abs(dir[2]) < 0.25) {
    const n = Math.abs(dir[0]) > Math.abs(dir[1]) ? [1, 0, 0] : [0, 1, 0];
    const pt = view.planePoint(e.clientX, e.clientY, n, g.p0);
    if (!pt) return;
    free = [n[0] === 0, n[1] === 0, true];
    d = [0, 1, 2].map(i => (free[i] ? pt[i] - g.p0[i] : 0));
  } else {
    const pt = view.planePoint(e.clientX, e.clientY, [0, 0, 1], g.p0);
    if (!pt) return;
    d = [pt[0] - g.p0[0], pt[1] - g.p0[1], 0]; free = [true, true, false];
  }
  if (d.some(v => Math.abs(v) > 1e6)) return;
  if (!e.altKey) {
    for (let i = 0; i < 3; i++) if (free[i]) d[i] = snapGrid(g.box.min[i] + d[i], S.grid) - g.box.min[i];
    if (S.osnap && g.others.length) {
      const moved = { min: g.box.min.map((v, i) => v + d[i]), max: g.box.max.map((v, i) => v + d[i]) };
      const r = snapBox(moved, g.others, Math.max(2, view.mmPerPixel() * 8));
      for (let i = 0; i < 3; i++) if (free[i] && r.hit[i]) d[i] += r.d[i];
    }
  }
  g.d = d;
  g.parts.forEach((p, i) => { p.c = [rnd(g.orig[i][0] + d[0]), rnd(g.orig[i][1] + d[1]), rnd(g.orig[i][2] + d[2])]; });
  lightRefresh();
  setMsg(`移動　ΔX ${fmt(d[0])}　ΔY ${fmt(d[1])}　ΔZ ${fmt(d[2])}`);
}

function endDrag() {
  const g = S.drag;
  S.drag = null;
  if (g.d.every(v => v === 0)) history.past.pop();
  setMsg('');
  refresh();
}

function onDown(e) {
  if (e.target !== view.dom) return;
  S.down = { x: e.clientX, y: e.clientY, button: e.button, moved: false, pick: null };
  if (e.button === 0 && S.tool === 'select' && !S.place) {
    const pick = view.pick(e.clientX, e.clientY);
    if (pick) { S.down.pick = pick; view.controls.enabled = false; }
  }
}

function onMove(e) {
  if (S.down && !S.down.moved && Math.hypot(e.clientX - S.down.x, e.clientY - S.down.y) > 4) {
    S.down.moved = true;
    if (S.down.pick) beginDrag(e);
  }
  if (S.drag) { doDrag(e); return; }
  if (S.down) return;
  if (e.target !== view.dom) return;
  S.lastMove = { clientX: e.clientX, clientY: e.clientY, altKey: e.altKey, shiftKey: e.shiftKey };
  if (S.place) { if (!S.place.opening) movePlace(e); return; }
  if (S.tool === 'wall') { moveWall(e); return; }
  if (S.tool === 'measure') { moveMeasure(e); return; }
  const pt = view.planePoint(e.clientX, e.clientY, [0, 0, 1], [0, 0, 0]);
  if (pt && Math.hypot(pt[0], pt[1]) < 500000) updateStatus(pt);
}

function onUp(e) {
  view.controls.enabled = true;
  const down = S.down;
  S.down = null;
  if (S.drag) { endDrag(); return; }
  if (!down || down.moved) return;
  if (down.button === 2) {
    if (S.place) setTool('select');
    else if (S.tool === 'wall' && S.wall.last) endWallChain();
    else if (S.tool === 'measure' && S.measure.a) { S.measure.a = null; S.live = []; refresh(false); }
    return;
  }
  if (down.button !== 0) return;
  if (S.place) { if (S.place.opening) placeOpening(e, e.shiftKey); else commitPlace(e.shiftKey); return; }
  if (S.tool === 'wall') { wallClick(e); return; }
  if (S.tool === 'measure') { measureClick(e); return; }
  clickSelect(down.pick || view.pick(e.clientX, e.clientY), e);
}

// ---------- 編集の操作 ----------
function cloneParts(parts, offset) {
  const gmap = new Map();
  return parts.map(p => {
    const q = JSON.parse(JSON.stringify(p));
    delete q.id;
    if (p.g) { if (!gmap.has(p.g)) gmap.set(p.g, newGroupId(S.doc)); q.g = gmap.get(p.g); }
    if (q.openings) q.openings.forEach(o => { o.id = newSubId(S.doc, 'o'); });
    q.c = [q.c[0] + offset[0], q.c[1] + offset[1], q.c[2] + offset[2]];
    return q;
  });
}

const A = {
  undo() {
    const prev = history.undo(serializeDoc(S.doc));
    if (prev) { S.doc = parseDoc(prev); S.sel.clear(); $('#docName').value = S.doc.name; refresh(); }
  },
  redo() {
    const next = history.redo(serializeDoc(S.doc));
    if (next) { S.doc = parseDoc(next); S.sel.clear(); $('#docName').value = S.doc.name; refresh(); }
  },
  del() {
    if (!S.sel.size && !S.selDim) return;
    commit(() => {
      S.doc.parts = S.doc.parts.filter(p => !S.sel.has(p.id));
      if (S.selDim) S.doc.dims = S.doc.dims.filter(d => d.id !== S.selDim);
      S.sel.clear(); S.selDim = null;
    });
  },
  dup() {
    const parts = selParts();
    if (!parts.length) return;
    commit(() => { S.sel = new Set(cloneParts(parts, [200, 0, 0]).map(q => addPart(S.doc, q).id)); });
    toast('右へ200mmずらして複製しました');
  },
  copy() {
    const parts = selParts();
    if (!parts.length) return;
    S.clipboard = JSON.stringify(parts); S.pasteN = 0;
    toast(`${parts.length}個をコピーしました`);
  },
  paste() {
    if (!S.clipboard) return;
    S.pasteN += 1;
    const src = JSON.parse(S.clipboard);
    commit(() => { S.sel = new Set(cloneParts(src, [200 * S.pasteN, 200 * S.pasteN, 0]).map(q => addPart(S.doc, q).id)); });
  },
  selectAll() { S.sel = new Set(visibleParts().map(p => p.id)); S.selDim = null; refresh(false); },
  rotz() { rotateSel('z'); },
  rotx() { rotateSel('x'); },
  roty() { rotateSel('y'); },
  group() {
    if (S.sel.size < 2) return;
    commit(() => { const g = newGroupId(S.doc); selParts().forEach(p => { p.g = g; }); });
    toast('グループにしました');
  },
  ungroup() {
    if (!selParts().some(p => p.g)) return;
    commit(() => { selParts().forEach(p => { p.g = null; }); });
    toast('グループを解除しました');
  },
  async array() {
    const parts = selParts();
    if (!parts.length) return;
    const v = await formDialog('配列（等間隔に複製）', [
      { key: 'n', label: '増やす数', type: 'number', value: 3, min: 1, max: 200, step: 1 },
      { key: 'dx', label: 'X方向の間隔', type: 'number', value: 455, unit: 'mm' },
      { key: 'dy', label: 'Y方向の間隔', type: 'number', value: 0, unit: 'mm' },
      { key: 'dz', label: 'Z方向の間隔', type: 'number', value: 0, unit: 'mm' }
    ], '複製する', '選んだ部材を、指定した間隔で並べて増やします（例：間柱や根太を455mmピッチで並べる）。');
    if (!v) return;
    const n = clamp(Math.round(v.n), 1, 200);
    if (!v.dx && !v.dy && !v.dz) { toast('間隔がすべて0です'); return; }
    commit(() => {
      const ids = [...S.sel];
      for (let k = 1; k <= n; k++) cloneParts(parts, [v.dx * k, v.dy * k, v.dz * k]).forEach(q => ids.push(addPart(S.doc, q).id));
      S.sel = new Set(ids);
    });
  },
  nudge(i, sign) {
    const parts = selParts();
    if (!parts.length) return;
    const d = [0, 0, 0];
    d[i] = sign * S.grid;
    commit(() => translateParts(parts, d));
  },
  new() {
    if (S.doc.parts.length && !confirm('いまの図面を閉じて、新しい図面を始めます。よろしいですか？（「元に戻す」で戻せます）')) return;
    commit(() => { S.doc = newDoc(); S.sel.clear(); });
    $('#docName').value = S.doc.name;
  },
  sample() {
    if (S.doc.parts.length && !confirm('いまの図面をサンプルに置き換えます。よろしいですか？（「元に戻す」で戻せます）')) return;
    commit(() => { S.doc = buildSample(); S.sel.clear(); });
    $('#docName').value = S.doc.name;
    A.fit('iso');
  },
  open() { $('#file').click(); },
  save() {
    const t = today();
    download(`造作3DCAD_${safeName(S.doc.name)}_${t.y}${t.m}${t.d}.json`, JSON.stringify(S.doc, null, 1), 'application/json');
  },
  png() {
    const t = today();
    const url = compositePng();
    const a = document.createElement('a');
    a.href = url; a.download = `造作3DCAD_${safeName(S.doc.name)}_${t.y}${t.m}${t.d}.png`;
    document.body.appendChild(a); a.click(); a.remove();
  },
  obj() {
    if (!S.doc.parts.length) { toast('部材がありません'); return; }
    const root = new THREE.Group();
    view.partsGroup.updateMatrixWorld(true);
    for (const m of view.pickables) {
      const c = new THREE.Mesh(m.geometry, m.material);
      c.applyMatrix4(m.matrixWorld);
      const p = byId.get(m.userData.partId);
      c.name = (p ? p.name : 'part').replace(/\s+/g, '_');
      root.add(c);
    }
    root.updateMatrixWorld(true);
    const t = today();
    download(`造作3DCAD_${safeName(S.doc.name)}_${t.y}${t.m}${t.d}.obj`, new OBJExporter().parse(root), 'text/plain');
  },
  fit(name) {
    const parts = visibleParts();
    let box = parts.length ? unionAabb(parts) : { min: [0, 0, 0], max: [3640, 2730, 2400] };
    if (S.autoDim && parts.length) {
      // 寸法線の分だけ広めに入れる（dims.js の寸法線のずらし量に合わせる）
      const size = Math.max(...box.max.map((v, i) => v - box.min[i]));
      const pad = 2.6 * Math.max(50, Math.round(size * 0.06 / 10) * 10);
      box = { min: box.min.map(v => v - pad), max: box.max.map(v => v + pad) };
    }
    view.setView(name || null, box);
  },
  ortho() { view.setOrtho(!view.isOrtho); updateButtons(); updateStatus(); },
  osnap() { S.osnap = !S.osnap; updateButtons(); updateStatus(); },
  clip() {
    S.clip = S.clip === null ? Number($('#clipNum').value) || 1500 : null;
    $('#clipBox').classList.toggle('show', S.clip !== null);
    view.setClip(S.clip);
    updateButtons();
  },
  autodim() {
    S.autoDim = !S.autoDim;
    try { localStorage.setItem(SAVE_KEY + '.autodim', S.autoDim ? '1' : '0'); } catch (e) { /* 保存できなくても動かす */ }
    updateLabels(); updateButtons();
  },
  cutlist() { showCutlist(); },
  help() { showHelp(); }
};

function rotateSel(axis) {
  if (S.place && !S.place.opening) {
    if (axis !== 'z') return;
    const b = unionAabb(S.place.parts);
    rotateParts(S.place.parts, 'z', 90, centerOf(b));
    normalizePlace(S.place.parts);
    S.place.rot = NaN; // 次に壁へ合わせたとき、向きを付け直す
    if (S.lastMove) movePlace(S.lastMove);
    return;
  }
  if (S.place) return;
  const parts = selParts();
  if (!parts.length) return;
  commit(() => {
    const b = unionAabb(parts);
    rotateParts(parts, axis, 90, centerOf(b));
    if (axis !== 'z') translateParts(parts, [0, 0, b.min[2] - unionAabb(parts).min[2]]);
  });
}

const safeName = s => (s || '無題').replace(/[\\/:*?"<>|\s]+/g, '_').slice(0, 40);

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

// 3Dの画像に、寸法などの文字ラベルを重ねて1枚の画像にする
function compositePng() {
  const src = view.dom;
  const img = view.snapshot();
  const cv = document.createElement('canvas');
  cv.width = src.width; cv.height = src.height;
  const g = cv.getContext('2d');
  const k = src.width / view.w;
  g.drawImage(src, 0, 0);
  g.font = `600 ${12 * k}px "Yu Gothic UI","Meiryo",sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const l of view.labels) {
    if (!l.shown) continue;
    const s = { x: l.sx, y: l.sy };
    const w = g.measureText(l.text).width + 10 * k, h = 18 * k;
    g.save();
    g.translate(s.x * k, s.y * k);
    if (l.rot) g.rotate(l.rot * Math.PI / 180);
    g.translate(-s.x * k, -s.y * k);
    g.fillStyle = 'rgba(255,255,255,.92)';
    g.fillRect(s.x * k - w / 2, s.y * k - h / 2, w, h);
    g.strokeStyle = '#c3cad3'; g.lineWidth = k;
    g.strokeRect(s.x * k - w / 2, s.y * k - h / 2, w, h);
    g.fillStyle = l.cls && l.cls.includes('adim') ? '#0b6e79' : l.cls && l.cls.includes('dim') ? '#b02a1c' : '#1f4f96';
    g.fillText(l.text, s.x * k, s.y * k);
    g.restore();
  }
  try { return cv.toDataURL('image/png'); } catch (e) { return img; }
}

async function openFile(file) {
  try {
    const doc = parseDoc(await file.text());
    commit(() => { S.doc = doc; S.sel.clear(); });
    $('#docName').value = S.doc.name;
    A.fit();
    toast(`「${file.name}」を開きました（部材 ${doc.parts.length}）`);
  } catch (e) {
    toast(e.message || 'ファイルを読めませんでした');
  }
}

// ---------- ダイアログ ----------
function openDialog({ title, body, buttons, onOpen }) {
  return new Promise(resolve => {
    const dlg = $('#dlg');
    $('#dlgTitle').textContent = title;
    $('#dlgBody').innerHTML = body;
    const foot = $('#dlgFoot');
    foot.innerHTML = '';
    let result = null;
    for (const b of buttons) {
      const el = document.createElement('button');
      el.type = 'button';
      el.textContent = b.label;
      if (b.cls) el.className = b.cls;
      el.addEventListener('click', () => {
        const r = b.run ? b.run() : b.value;
        if (r === false) return;
        result = r === undefined ? null : r;
        dlg.close();
      });
      foot.appendChild(el);
    }
    dlg.addEventListener('close', () => resolve(result), { once: true });
    dlg.showModal();
    if (onOpen) onOpen($('#dlgBody'));
  });
}

function formDialog(title, fields, okLabel, note) {
  const body = `<div class="form">${note ? `<div class="note">${esc(note)}</div>` : ''}${fields.map(f => {
    let input;
    if (f.type === 'select') input = `<select data-k="${f.key}">${f.options.map(o => `<option value="${esc(o.v)}"${String(o.v) === String(f.value) ? ' selected' : ''}>${esc(o.label)}</option>`).join('')}</select>`;
    else input = `<span><input type="number" data-k="${f.key}" value="${f.value}"${f.min !== undefined ? ` min="${f.min}"` : ''}${f.max !== undefined ? ` max="${f.max}"` : ''} step="${f.step || 1}"> ${esc(f.unit || '')}</span>`;
    return `<label>${esc(f.label)}</label>${input}`;
  }).join('')}</div>`;
  return openDialog({
    title, body,
    buttons: [
      { label: 'やめる', value: null },
      { label: okLabel, cls: 'primary', run() {
        const out = {};
        for (const f of fields) {
          const el = $(`#dlgBody [data-k="${f.key}"]`);
          if (f.type === 'select') { out[f.key] = el.value; continue; }
          const v = Number(el.value);
          if (!Number.isFinite(v) || (f.min !== undefined && v < f.min) || (f.max !== undefined && v > f.max)) {
            toast(`「${f.label}」の値を確認してください`); el.focus(); return false;
          }
          out[f.key] = v;
        }
        return out;
      } }
    ]
  });
}

async function askCabinet() {
  const v = await formDialog('箱物・棚を作る', [
    { key: 'W', label: '幅（W）', type: 'number', value: 900, min: 100, unit: 'mm' },
    { key: 'D', label: '奥行（D）', type: 'number', value: 300, min: 50, unit: 'mm' },
    { key: 'H', label: '高さ（H）', type: 'number', value: 1800, min: 100, unit: 'mm' },
    { key: 't', label: '板の厚さ', type: 'number', value: 18, min: 3, unit: 'mm' },
    { key: 'shelves', label: '棚板の枚数', type: 'number', value: 3, min: 0, max: 30 },
    { key: 'back', label: '背板の厚さ（0＝なし）', type: 'number', value: 4, min: 0, unit: 'mm', step: 0.5 },
    { key: 'kick', label: '台輪の高さ（0＝なし）', type: 'number', value: 60, min: 0, unit: 'mm' }
  ], '作る', '側板勝ち（側板の内側に天板・地板・棚板が入る）で板に分けます。棚板は等間隔です。');
  if (!v) return null;
  if (v.W <= 2 * v.t || v.H <= v.kick + 2 * v.t + v.shelves * v.t || v.D <= v.back) { toast('寸法の組合せが成り立ちません（板厚や枚数を確認してください）'); return null; }
  return makeCabinet(v);
}

async function askWallShelf() {
  const v = await formDialog('壁付け棚を作る', [
    { key: 'W', label: '棚板の幅（W）', type: 'number', value: 900, min: 100, unit: 'mm' },
    { key: 'D', label: '棚板の奥行（D）', type: 'number', value: 250, min: 60, unit: 'mm' },
    { key: 't', label: '棚板の厚さ', type: 'number', value: 18, min: 3, unit: 'mm' },
    { key: 'n', label: '段数', type: 'number', value: 3, min: 1, max: 20 },
    { key: 'pitch', label: '段の間隔', type: 'number', value: 300, min: 50, unit: 'mm' },
    { key: 'h0', label: '下の段の高さ（床から棚板の上面）', type: 'number', value: 900, min: 0, unit: 'mm' },
    { key: 'brackets', label: '棚受け金物（1段あたり、0＝なし）', type: 'number', value: 2, min: 0, max: 10 },
    { key: 'mat', label: '棚板の材料', type: 'select', value: 'lumbercore', options: [
      { v: 'lumbercore', label: 'ランバーコア' }, { v: 'laminated', label: '集成材' }, { v: 'plywood', label: '合板' }, { v: 'white', label: '化粧板（白）' }] }
  ], '作る', '棚板と、その下に付ける棚受け金物（L字）を作ります。壁の面をクリックすると、背を壁に向けて、指定の高さに付きます。棚受けの大きさは奥行から自動で決めます（段の間隔が狭いときは縦を縮めます）。');
  if (!v) return null;
  if (v.n > 1 && v.pitch <= v.t) { toast('段の間隔は、棚板の厚さより大きくしてください'); return null; }
  return makeWallShelf(v);
}

async function askCounter() {
  const v = await formDialog('カウンターを作る', [
    { key: 'W', label: '幅（W）', type: 'number', value: 1800, min: 200, unit: 'mm' },
    { key: 'D', label: '奥行（D）', type: 'number', value: 600, min: 100, unit: 'mm' },
    { key: 'H', label: '天板の上面の高さ', type: 'number', value: 850, min: 100, unit: 'mm' },
    { key: 'top', label: '天板の厚さ', type: 'number', value: 30, min: 5, unit: 'mm' },
    { key: 't', label: '側板・幕板の厚さ', type: 'number', value: 30, min: 5, unit: 'mm' }
  ], '作る', '天板・両端の側板・奥の幕板に分けます。');
  if (!v) return null;
  if (v.W <= 2 * v.t || v.H <= v.top + 50) { toast('寸法の組合せが成り立ちません'); return null; }
  return makeCounter(v);
}

async function frameSelectedWalls() {
  const walls = selParts().filter(p => p.kind === 'wall');
  if (!walls.length) { toast('壁を選んでください'); return; }
  const t = walls[0].s[1];
  const guess = t - 25 >= 20 ? t - 25 : t;
  const v = await formDialog('壁を下地に展開する', [
    { key: 'studMat', label: '下地の材料', type: 'select', value: guess === 65 || guess === 100 ? 'lgs' : 'wood', options: [{ v: 'wood', label: '木（間柱・枠）' }, { v: 'lgs', label: '軽量鉄骨（LGS）' }] },
    { key: 'studB', label: '下地の見付（壁に沿う幅）', type: 'number', value: guess === 65 || guess === 100 ? 45 : 30, min: 5, unit: 'mm' },
    { key: 'studD', label: '下地の奥行（壁の厚さ方向）', type: 'number', value: guess, min: 5, unit: 'mm' },
    { key: 'pitch', label: '間柱のピッチ', type: 'select', value: '455', options: [303, 455, 606, 910].map(x => ({ v: x, label: x + ' mm' })) },
    { key: 'sides', label: 'ボード張り', type: 'select', value: '2', options: [{ v: 2, label: '両面' }, { v: 1, label: '片面' }, { v: 0, label: 'なし（下地のみ）' }] },
    { key: 'board', label: 'ボードの種類', type: 'select', value: 'gypsum|12.5', options: [
      { v: 'gypsum|12.5', label: '石膏ボード t12.5' }, { v: 'gypsum|9.5', label: '石膏ボード t9.5' },
      { v: 'plywood|9', label: '合板 t9' }, { v: 'plywood|12', label: '合板 t12' }, { v: 'keical|6', label: 'ケイカル板 t6' }] },
    { key: 'size', label: 'ボードの定尺', type: 'select', value: '910x2420', options: [
      { v: '910x1820', label: '910×1820（3×6）' }, { v: '910x2420', label: '910×2420（3×8）' }, { v: '1220x2440', label: '1220×2440（4×8）' }] }
  ], '展開する', `選んだ壁 ${walls.length}枚を、上下枠・間柱・開口まわり（まぐさ・窓台）とボードの部材に置き換えます。壁は消え、部材のグループになります（「元に戻す」で戻せます）。`);
  if (!v) return;
  const [bm, bt] = v.board.split('|');
  const [bw, bl] = v.size.split('x').map(Number);
  const names = { gypsum: '石膏ボード', plywood: '合板', keical: 'ケイカル板' };
  const opt = {
    studMat: v.studMat, studB: v.studB, studD: v.studD, pitch: Number(v.pitch), sides: Number(v.sides),
    boardT: Number(bt), boardW: bw, boardL: bl, boardMat: bm, boardName: `${names[bm]} t${bt}`
  };
  let made = 0;
  commit(() => {
    const ids = [];
    for (const w of walls) {
      const g = newGroupId(S.doc);
      S.doc.parts = S.doc.parts.filter(p => p.id !== w.id);
      for (const p of frameWall(w, opt)) { ids.push(addPart(S.doc, { ...p, g }).id); made++; }
    }
    S.sel = new Set(ids);
  });
  toast(`下地とボード ${made}個に展開しました`);
}

function showCutlist() {
  const render = () => {
    const o = S.clOpt;
    const [sw, sl] = o.sheet.split('x').map(Number);
    const parts = o.onlySel && S.sel.size ? selParts() : S.doc.parts;
    const cl = buildCutlist(parts, { stockLen: o.stockLen, kerf: o.kerf, sheetW: sw, sheetL: sl, loss: o.loss / 100 });
    showCutlist.cl = cl;
    const tables = cutlistTables(cl).filter(t => t.rows.length);
    $('#clTables').innerHTML = tables.length ? tables.map(t => `<h4>${esc(t.title)}</h4><table><thead><tr>${t.head.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${t.rows.map(r => `<tr>${r.map((c, i) => `<td${typeof c === 'string' && i ? ' class="t"' : ''}>${esc(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`).join('')
      : '<p class="empty">部材がありません。</p>';
  };
  const o = S.clOpt;
  const sel = (id, list, cur) => `<select id="${id}">${list.map(([v, l]) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${l}</option>`).join('')}</select>`;
  openDialog({
    title: `部材表（拾い出し）　${S.doc.name}`,
    body: `<div class="cl-opt">
        <label>角材の定尺 ${sel('clStock', [[3000, '3m'], [3650, '3.65m'], [4000, '4m'], [6000, '6m']], o.stockLen)}</label>
        <label>切りしろ <input type="number" id="clKerf" value="${o.kerf}" min="0" step="1"> mm</label>
        <label>板の定尺 ${sel('clSheet', [['910x1820', '3×6'], ['910x2420', '3×8'], ['1220x2440', '4×8']], o.sheet)}</label>
        <label>板のロス <input type="number" id="clLoss" value="${o.loss}" min="0" max="100" step="1"> %</label>
        <label><input type="checkbox" id="clSel"${o.onlySel ? ' checked' : ''}${S.sel.size ? '' : ' disabled'}> 選択中の部材だけ</label>
      </div><div id="clTables"></div>
      <p class="empty">数量は図面の部材をそのまま数えたものです。定尺換算は目安で、継手・端材の使い回し・搬入寸法は含みません。発注前に必ず確認してください。</p>`,
    buttons: [
      { label: 'CSVで保存（Excel用）', run() {
        const t = today();
        download(`造作3DCAD_部材表_${safeName(S.doc.name)}_${t.y}${t.m}${t.d}.csv`,
          cutlistCsv(showCutlist.cl, [['造作3DCAD 部材表', S.doc.name, `${t.y}年${t.m}月${t.d}日`]]), 'text/csv');
        return false;
      } },
      { label: '閉じる', cls: 'primary', value: null }
    ],
    onOpen(body) {
      render();
      body.addEventListener('change', () => {
        o.stockLen = Number($('#clStock').value);
        o.kerf = Math.max(0, Number($('#clKerf').value) || 0);
        o.sheet = $('#clSheet').value;
        o.loss = clamp(Number($('#clLoss').value) || 0, 0, 100);
        o.onlySel = $('#clSel').checked;
        render();
      });
    }
  });
}

function showHelp() {
  openDialog({
    title: `造作3DCAD Ver${VERSION} の使い方`,
    body: `<div class="help">
      <h5>できること</h5>
      <ul><li>角材・板材・壁・床・天井・建具・造作家具（箱物・棚、カウンター、壁付け棚）を、mm単位で3Dに組み立てる</li>
      <li>壁を「下地に展開」して、上下枠・間柱・まぐさ・窓台・ボードに自動で割り付ける</li>
      <li>部材表（拾い出し）を作り、CSV（Excel用）で保存する</li></ul>
      <h5>置く・描く</h5>
      <ul><li>左の一覧から部材を選び、3D画面でクリックして置く。ほかの部材の面に合わせると、その面に付く</li>
      <li>「壁を描く」は、始点→終点の順にクリック。数字を打って <kbd>Enter</kbd> で長さを指定できる</li>
      <li>建具・開口は、左で選んでから壁をクリック。位置や寸法は右の「プロパティ」で直す</li>
      <li>「壁付け棚」は、寸法・段数・高さを入れてから壁の面をクリック。背が壁に向き、指定の高さに付く</li></ul>
      <h5>選ぶ・動かす</h5>
      <ul><li>クリックで選択、<kbd>Shift</kbd>＋クリックで追加。グループは全体が選ばれる（<kbd>Alt</kbd>＋クリックで1本だけ）</li>
      <li>部材をドラッグで移動。<kbd>Shift</kbd> を押しながらで上下、<kbd>Alt</kbd> で位置合わせなし</li>
      <li>矢印キーで刻みずつ移動、<kbd>PageUp</kbd>／<kbd>PageDown</kbd> で上下</li>
      <li>正確な位置・寸法・角度は、右の「プロパティ」に数値で入れる</li></ul>
      <h5>視点</h5>
      <ul><li>何もない所をドラッグ＝回転、右ドラッグ（またはホイールを押してドラッグ）＝移動、ホイール＝拡大縮小</li>
      <li><kbd>1</kbd> 立体　<kbd>2</kbd> 平面　<kbd>3</kbd> 正面　<kbd>4</kbd> 側面　<kbd>F</kbd> 全体</li>
      <li>「断面」で、指定の高さから上を隠して中を見る</li>
      <li>「寸法表示」（<kbd>D</kbd>）で、選んだ部材の外形寸法（幅・奥行・高さ）と、板の割付寸法（棚板の間隔・側板と内法など）を自動で描く。何も選んでいないときは図面全体。正面・平面・側面にすると、その図で読める側に出る。「画像」で寸法ごと書き出せる</li></ul>
      <h5>キー操作</h5>
      <ul><li><kbd>V</kbd> 選択　<kbd>W</kbd> 壁　<kbd>M</kbd> 寸法　<kbd>R</kbd> 90°回転　<kbd>Delete</kbd> 削除　<kbd>Esc</kbd> 中止</li>
      <li><kbd>Ctrl</kbd>+<kbd>Z</kbd> 元に戻す　<kbd>Ctrl</kbd>+<kbd>Y</kbd> やり直し　<kbd>Ctrl</kbd>+<kbd>D</kbd> 複製　<kbd>Ctrl</kbd>+<kbd>C</kbd>／<kbd>V</kbd> コピー・貼り付け</li>
      <li><kbd>Ctrl</kbd>+<kbd>G</kbd> グループ　<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>G</kbd> 解除　<kbd>Ctrl</kbd>+<kbd>A</kbd> すべて選択　<kbd>Ctrl</kbd>+<kbd>S</kbd> 保存</li></ul>
      <h5>保存</h5>
      <ul><li>作業中の図面は、このブラウザに自動で保存され、次に開いたとき続きから始まる</li>
      <li>「保存」でJSONファイルに書き出し、「開く」で読み込む（画面へファイルをドロップしても開ける）</li>
      <li>棚だけを作るときは「新規」で空の図面にしてから、棚を置く</li></ul>
      <h5>注意</h5>
      <ul><li>部材の寸法は呼び寸法の目安です。製品の実寸・定尺は仕入先の資料で確認してください</li>
      <li>下地の割付は一般的な納まりの目安です。構造・防火・固定方法などの判断は、設計図書と担当者の確認を優先してください</li></ul>
    </div>`,
    buttons: [{ label: '閉じる', cls: 'primary', value: null }]
  });
}

// ---------- 右パネル：プロパティ ----------
function numInput(f, v, extra = '') {
  return `<input type="number" data-f="${f}" value="${fmt(v)}" step="any"${extra}>`;
}

const fieldKey = el => (el && el.dataset ? (el.dataset.f ? `[data-f="${el.dataset.f}"]` : el.dataset.of ? `[data-of="${el.dataset.of}"][data-oi="${el.dataset.oi}"]` : null) : null);

function renderProps() {
  const el = $('#pane-props');
  const act = document.activeElement;
  const keep = el.contains(act) ? fieldKey(act) : null;
  renderPropsBody(el);
  if (keep) {
    const again = el.querySelector(keep);
    if (again) { again.focus(); if (again.select && again.type !== 'select-one') again.select(); }
  }
}

function renderPropsBody(el) {
  const parts = selParts();
  if (S.selDim && !parts.length) {
    const d = S.doc.dims.find(x => x.id === S.selDim);
    const len = Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1], d.b[2] - d.a[2]);
    el.innerHTML = `<h4>寸法線</h4><div class="f">
      <label>距離</label><div>${fmt(len)} mm</div>
      <label>ΔX／ΔY／ΔZ</label><div>${fmt(Math.abs(d.b[0] - d.a[0]))}／${fmt(Math.abs(d.b[1] - d.a[1]))}／${fmt(Math.abs(d.b[2] - d.a[2]))}</div>
      </div><div class="btns"><button data-pa="del" class="danger">この寸法を消す</button></div>`;
    return;
  }
  if (!parts.length) {
    el.innerHTML = `<div class="empty">部材を選ぶと、ここで名称・位置・寸法・角度を数値で直せます。<br><br>左の一覧から部材を選んで、3D画面をクリックすると置けます。</div>`;
    return;
  }
  if (parts.length > 1) {
    const b = unionAabb(parts);
    const grouped = parts.every(p => p.g && p.g === parts[0].g);
    el.innerHTML = `<h4>${parts.length}個を選択中${grouped ? '（グループ）' : ''}</h4>
      <div class="f"><label>全体の大きさ</label><div>${fmt(b.max[0] - b.min[0])} × ${fmt(b.max[1] - b.min[1])} × ${fmt(b.max[2] - b.min[2])}</div></div>
      <h4>位置（全体の左手前下の角）</h4>
      <div class="tri"><label>X${numInput('mx', b.min[0])}</label><label>Y${numInput('my', b.min[1])}</label><label>Z（下端）${numInput('mz', b.min[2])}</label></div>
      <h4>材料をまとめて変える</h4>
      <div class="f"><label>材料</label><select data-f="mmat"><option value="">（変えない）</option>${Object.entries(MATS).map(([k, m]) => `<option value="${k}">${esc(m.name)}</option>`).join('')}</select></div>
      ${parts.some(p => p.kind === 'wall') ? '<div class="btns"><button data-pa="frame" class="primary">壁を下地に展開…</button></div>' : ''}`;
    return;
  }
  const p = parts[0], b = aabbOf(p), lb = SIZE_LABELS[p.kind];
  let html = `<h4>${esc(KIND_NAMES[p.kind])}${p.g ? '（グループの中の1つ）' : ''}</h4>
    <div class="f">
      <label>名称</label><input type="text" data-f="name" value="${esc(p.name)}" maxlength="60">
      <label>材料</label><select data-f="mat">${Object.entries(MATS).map(([k, m]) => `<option value="${k}"${k === p.mat ? ' selected' : ''}>${esc(m.name)}</option>`).join('')}</select>
    </div>
    <h4>寸法（mm）</h4>
    <div class="tri"><label>${lb[0]}${numInput('s0', p.s[0], ' min="0.1"')}</label><label>${lb[1]}${numInput('s1', p.s[1], ' min="0.1"')}</label><label>${lb[2]}${numInput('s2', p.s[2], ' min="0.1"')}</label></div>
    <h4>位置（左手前下の角、mm）</h4>
    <div class="tri"><label>X${numInput('px', b.min[0])}</label><label>Y${numInput('py', b.min[1])}</label><label>Z（下端）${numInput('pz', b.min[2])}</label></div>
    <h4>回転（度）</h4>
    <div class="tri"><label>X軸${numInput('r0', p.r[0])}</label><label>Y軸${numInput('r1', p.r[1])}</label><label>Z軸（平面）${numInput('r2', p.r[2])}</label></div>`;
  if (p.kind === 'wall') {
    html += `<h4>開口・建具（位置は壁の始点から）</h4>${(p.openings || []).map((o, i) => `<div class="op">
        <div class="head"><select data-of="type" data-oi="${i}"><option value="door"${o.type === 'door' ? ' selected' : ''}>ドア</option><option value="window"${o.type === 'window' ? ' selected' : ''}>窓</option><option value="open"${o.type === 'open' ? ' selected' : ''}>開口のみ</option></select>
        <button data-pa="delOpening" data-oi="${i}" class="danger">消す</button></div>
        <div class="quad">
          <label>位置<input type="number" data-of="x" data-oi="${i}" value="${fmt(o.x)}" step="any"></label>
          <label>幅<input type="number" data-of="w" data-oi="${i}" value="${fmt(o.w)}" min="1" step="any"></label>
          <label>下端高さ<input type="number" data-of="sill" data-oi="${i}" value="${fmt(o.sill)}" min="0" step="any"></label>
          <label>高さ<input type="number" data-of="h" data-oi="${i}" value="${fmt(o.h)}" min="1" step="any"></label>
        </div></div>`).join('') || '<div class="empty" style="padding:4px">開口はありません。左の「建具・開口」から選んで壁をクリックすると入ります。</div>'}
      <div class="btns"><button data-pa="frame" class="primary">壁を下地に展開…</button></div>`;
  }
  html += `<h4>メモ</h4><div class="f"><textarea class="wide" data-f="note" rows="2" maxlength="200">${esc(p.note || '')}</textarea></div>`;
  el.innerHTML = html;
}

// 値の反映は、Tabなどでカーソルが次の欄へ移ったあとに行う（描き直しでカーソルを見失わないため）
function onPropChange(e) {
  const t = e.target;
  setTimeout(() => applyPropChange(t), 0);
}

function applyPropChange(t) {
  const parts = selParts();
  if (!parts.length) return;
  if (t.dataset.of) {
    const p = parts[0], o = p.openings[Number(t.dataset.oi)], k = t.dataset.of;
    if (!o) return;
    if (k === 'type') { commit(() => { o.type = t.value; }); return; }
    const v = Number(t.value);
    if (!Number.isFinite(v) || ((k === 'w' || k === 'h') && v < 1) || (k === 'sill' && v < 0)) { renderProps(); return; }
    commit(() => { o[k] = v; });
    return;
  }
  const f = t.dataset.f;
  if (!f) return;
  if (f === 'mmat') { if (t.value) commit(() => parts.forEach(p => { p.mat = t.value; })); return; }
  if (f[0] === 'm') {
    const i = 'xyz'.indexOf(f[1]), v = Number(t.value);
    if (!Number.isFinite(v)) { renderProps(); return; }
    const d = [0, 0, 0];
    d[i] = v - unionAabb(parts).min[i];
    commit(() => translateParts(parts, d));
    return;
  }
  const p = parts[0];
  if (f === 'name') { commit(() => { p.name = t.value.trim(); }); return; }
  if (f === 'mat') { commit(() => { p.mat = t.value; }); return; }
  if (f === 'note') { commit(() => { if (t.value.trim()) p.note = t.value.trim(); else delete p.note; }); return; }
  const v = Number(t.value);
  if (!Number.isFinite(v)) { renderProps(); return; }
  const i = Number(f[1]);
  if (f[0] === 'p') {
    const d = [0, 0, 0];
    d['xyz'.indexOf(f[1])] = v - aabbOf(p).min['xyz'.indexOf(f[1])];
    commit(() => translateParts([p], d));
  } else if (f[0] === 's') {
    if (v <= 0) { renderProps(); return; }
    commit(() => {
      const m0 = aabbOf(p).min;
      p.s[i] = rnd(v);
      const m1 = aabbOf(p).min;
      translateParts([p], [m0[0] - m1[0], m0[1] - m1[1], m0[2] - m1[2]]);
    });
  } else if (f[0] === 'r') {
    commit(() => { p.r[i] = rnd(v); });
  }
}

function onPropClick(e) {
  const b = e.target.closest('[data-pa]');
  if (!b) return;
  const act = b.dataset.pa;
  if (act === 'del') A.del();
  else if (act === 'frame') frameSelectedWalls();
  else if (act === 'delOpening') {
    const p = selParts()[0];
    commit(() => { p.openings.splice(Number(b.dataset.oi), 1); });
  }
}

// ---------- 右パネル：部材一覧 ----------
function renderList() {
  const el = $('#pane-list');
  if (!el.classList.contains('on')) return;
  const kinds = Object.keys(KIND_NAMES);
  let html = '';
  for (const k of kinds) {
    const list = S.doc.parts.filter(p => p.kind === k);
    if (!list.length) continue;
    html += `<div class="kind"><header><input type="checkbox" data-vis="${k}"${S.hidden.has(k) ? '' : ' checked'} title="表示／非表示"> ${esc(KIND_NAMES[k])} <span>${list.length}</span></header><ul>${list.slice(0, 200).map(p =>
      `<li data-id="${p.id}"${S.sel.has(p.id) ? ' class="sel"' : ''}>${esc(p.name || '（名称なし）')}<span>${p.s.map(fmt).join('×')}</span></li>`).join('')}</ul>${list.length > 200 ? `<div class="empty" style="padding:2px 6px">ほか ${list.length - 200}個</div>` : ''}</div>`;
  }
  if (S.doc.dims.length) html += `<div class="kind"><header>寸法線 <span>${S.doc.dims.length}</span></header><div class="btns"><button data-pa="clearDims" class="danger">寸法線をすべて消す</button></div></div>`;
  el.innerHTML = html || '<div class="empty">部材はまだありません。</div>';
}

// ---------- 起動 ----------
function readTheme() {
  const cs = getComputedStyle(document.documentElement);
  const hex = n => parseInt(cs.getPropertyValue(n).trim().replace('#', ''), 16);
  return { bg: hex('--stage'), grid1: hex('--grid1'), grid2: hex('--grid2') };
}

function isTyping() {
  const a = document.activeElement;
  return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
}

function onKey(e) {
  if ($('#dlg').open) return;
  if (isTyping()) {
    if (e.key === 'Escape') document.activeElement.blur();
    return;
  }
  const ctrl = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
  if (ctrl) {
    const map = { z: e.shiftKey ? 'redo' : 'undo', y: 'redo', d: 'dup', c: 'copy', v: 'paste', a: 'selectAll', s: 'save', g: e.shiftKey ? 'ungroup' : 'group' };
    if (map[k]) { e.preventDefault(); A[map[k]](); }
    return;
  }
  if (S.tool === 'wall' && S.wall.last) {
    if (/^[0-9.]$/.test(e.key)) { S.wall.typed = (S.wall.typed + e.key).slice(0, 7); if (S.lastMove) moveWall(S.lastMove); setMsg(`長さ ${S.wall.typed} mm → Enterで確定`); return; }
    if (e.key === 'Backspace') { S.wall.typed = S.wall.typed.slice(0, -1); if (S.lastMove) moveWall(S.lastMove); return; }
    if (e.key === 'Enter') { wallTypedEnter(); return; }
  }
  if (e.key === 'Escape') {
    if (S.place) setTool('select');
    else if (S.tool === 'wall' && S.wall.last) endWallChain();
    else if (S.tool !== 'select') setTool('select');
    else { S.sel.clear(); S.selDim = null; refresh(false); }
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); A.del(); return; }
  const arrows = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [1, 1], ArrowDown: [1, -1], PageUp: [2, 1], PageDown: [2, -1] };
  if (arrows[e.key]) { if (S.sel.size) { e.preventDefault(); A.nudge(...arrows[e.key]); } return; }
  if (k === 'v') setTool('select');
  else if (k === 'w') setTool('wall');
  else if (k === 'm') setTool('measure');
  else if (k === 'r') rotateSel('z');
  else if (k === 'f') A.fit();
  else if (k === 'd') A.autodim();
  else if ('1234'.includes(k) && k) setViewByName(['iso', 'top', 'front', 'right'][Number(k) - 1]);
}

function setViewByName(name) {
  view.setOrtho(name !== 'iso');
  A.fit(name);
  updateButtons(); updateStatus();
}

function init() {
  view = new View3D($('#view'), $('#labels'));
  view.setTheme(readTheme());
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => view.setTheme(readTheme()));
  renderLib();

  const stage = $('#stage');
  stage.addEventListener('pointerdown', onDown, true);
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  view.dom.addEventListener('contextmenu', e => e.preventDefault());
  view.dom.addEventListener('dblclick', () => { if (S.tool === 'wall') endWallChain(); });
  view.controls.addEventListener('change', () => { if (S.autoDim && updateAutoDims()) updateLabels(); });
  view.controls.addEventListener('change', () => { $('#viewInfo').textContent = `${view.isOrtho ? '平行投影' : '透視投影'}・刻み ${S.grid}mm${S.osnap ? '・吸着あり' : ''}`; });
  window.addEventListener('keydown', onKey);

  $('#labels').addEventListener('click', e => {
    const id = e.target.dataset && e.target.dataset.dim;
    if (!id || S.tool !== 'select' || S.place) return;
    S.sel.clear(); S.selDim = id; refresh(false);
  });

  document.addEventListener('click', e => {
    const b = e.target.closest('#top [data-act], #top [data-tool], #top [data-view]');
    if (!b) return;
    if (b.dataset.tool) setTool(b.dataset.tool);
    else if (b.dataset.view) setViewByName(b.dataset.view);
    else if (A[b.dataset.act]) A[b.dataset.act]();
    b.blur();
  });

  $('#ctx').addEventListener('change', e => {
    const id = e.target.id, w = S.wall;
    if (id === 'wPreset' && e.target.value) { w.t = Number(e.target.value); $('#wT').value = w.t; }
    else if (id === 'wT') { const v = Number(e.target.value); if (v >= 10) w.t = v; renderCtx(); }
    else if (id === 'wH') { const v = Number(e.target.value); if (v >= 100) w.h = v; else e.target.value = w.h; }
    else if (id === 'wZ') { const v = Number(e.target.value); if (Number.isFinite(v)) w.z = v; }
    else if (id === 'wOrtho') w.ortho = e.target.checked;
  });

  $('#gridSel').addEventListener('change', e => { S.grid = Number(e.target.value); updateStatus(); e.target.blur(); });
  $('#docName').addEventListener('change', e => { S.doc.name = e.target.value.trim() || '無題'; e.target.value = S.doc.name; autosaveSoon(); });
  $('#file').addEventListener('change', e => { const f = e.target.files[0]; e.target.value = ''; if (f) openFile(f); });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) openFile(f); });

  const clipSet = v => { S.clip = v; $('#clipRange').value = v; $('#clipNum').value = v; view.setClip(v); };
  $('#clipRange').addEventListener('input', e => clipSet(Number(e.target.value)));
  $('#clipNum').addEventListener('change', e => clipSet(Number(e.target.value) || 0));

  document.querySelectorAll('.tabs button').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach(x => x.classList.toggle('on', x === b));
    document.querySelectorAll('.pane').forEach(x => x.classList.toggle('on', x.id === 'pane-' + b.dataset.tab));
    renderList();
  }));
  $('#pane-props').addEventListener('change', onPropChange);
  $('#pane-props').addEventListener('click', onPropClick);
  $('#pane-list').addEventListener('click', e => {
    if (e.target.closest('[data-pa=clearDims]')) { commit(() => { S.doc.dims = []; }); return; }
    const li = e.target.closest('li[data-id]');
    if (!li) return;
    const p = byId.get(li.dataset.id);
    if (!p) return;
    if (e.shiftKey) { if (S.sel.has(p.id)) S.sel.delete(p.id); else S.sel.add(p.id); } else S.sel = new Set([p.id]);
    S.selDim = null;
    refresh(false);
  });
  $('#pane-list').addEventListener('change', e => {
    const k = e.target.dataset.vis;
    if (!k) return;
    if (e.target.checked) S.hidden.delete(k); else { S.hidden.add(k); selParts().filter(p => p.kind === k).forEach(p => S.sel.delete(p.id)); }
    refresh(false);
  });

  try { if (localStorage.getItem(SAVE_KEY + '.autodim') === '0') S.autoDim = false; } catch (e) { /* 既定のまま */ }
  let restored = false;
  try {
    const saved = localStorage.getItem(SAVE_KEY);
    if (saved) { S.doc = parseDoc(saved); restored = true; }
  } catch (e) { /* 壊れた自動保存は使わない */ }
  if (!restored) S.doc = buildSample();
  $('#docName').value = S.doc.name;
  setTool('select');
  refresh(false);
  A.fit('iso');
  if (restored) toast('前回の続きを開きました');
  window.__zosaku = { S, view, A, history, refresh, setTool, version: VERSION };
}

init();
