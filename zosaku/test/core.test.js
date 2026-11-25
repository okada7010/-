// 計算部分（画面なし）の確認。実行： npm test
import test from 'node:test';
import assert from 'node:assert/strict';
import { aabbOf, cornersOf, quatOf, eulerOf, rotateParts, placeLocal, unionAabb } from '../src/core/geom.js';
import { newDoc, addPart, serializeDoc, parseDoc, History, wallFromPoints, wallEnds } from '../src/core/model.js';
import { snapGrid, snapBox } from '../src/core/snap.js';
import { frameWall } from '../src/core/framing.js';
import { makeCabinet, makeCounter, makeWallShelf } from '../src/core/cabinet.js';
import { buildCutlist, cutlistCsv, packStock, wallArea } from '../src/core/cutlist.js';

const near = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≒ ${b}`);
const nearArr = (a, b, eps = 1e-6) => { assert.equal(a.length, b.length); a.forEach((v, i) => near(v, b[i], eps)); };
const box = (c, s, r = [0, 0, 0], extra = {}) => ({ kind: 'box', c, s, r, ...extra });
const overlapVol = (A, B) => {
  let v = 1;
  for (let i = 0; i < 3; i++) v *= Math.max(0, Math.min(A.max[i], B.max[i]) - Math.max(A.min[i], B.min[i]));
  return v;
};

// ---------- geom ----------
test('aabbOf：回転なしは中心±半分', () => {
  const b = aabbOf(box([100, 200, 300], [1000, 40, 30]));
  nearArr(b.min, [-400, 180, 285]);
  nearArr(b.max, [600, 220, 315]);
});

test('aabbOf：Z軸90°でXとYの寸法が入れ替わる', () => {
  const b = aabbOf(box([0, 0, 0], [1000, 40, 30], [0, 0, 90]));
  nearArr(b.min, [-20, -500, -15]);
  nearArr(b.max, [20, 500, 15]);
});

test('aabbOf：Y軸-90°で長さ方向（ローカルX）が上を向く', () => {
  const b = aabbOf(box([0, 0, 0], [2400, 105, 30], [0, -90, 0]));
  nearArr(b.min, [-15, -52.5, -1200]);
  nearArr(b.max, [15, 52.5, 1200]);
});

test('cornersOf：8点がAABBに一致する', () => {
  const p = box([10, 20, 30], [100, 200, 300], [0, 0, 90]);
  const cs = cornersOf(p);
  assert.equal(cs.length, 8);
  const b = aabbOf(p);
  for (let i = 0; i < 3; i++) {
    near(Math.min(...cs.map(c => c[i])), b.min[i]);
    near(Math.max(...cs.map(c => c[i])), b.max[i]);
  }
});

test('eulerOf(quatOf(r)) で角度が戻る', () => {
  nearArr(eulerOf(quatOf([0, 0, 30])), [0, 0, 30]);
  nearArr(eulerOf(quatOf([90, 0, 45])), [90, 0, 45]);
});

test('rotateParts：基準点まわりにZ軸90°回すと位置も回る', () => {
  const p = box([1000, 0, 0], [200, 100, 50]);
  rotateParts([p], 'z', 90, [0, 0, 0]);
  nearArr(p.c, [0, 1000, 0]);
  nearArr(p.r, [0, 0, 90]);
});

test('rotateParts：X軸90°を2回で180°になり、箱の範囲は元と同じ', () => {
  const p = box([0, 0, 0], [200, 100, 50]);
  const before = aabbOf(p);
  rotateParts([p], 'x', 90, [0, 0, 0]);
  nearArr(aabbOf(p).max, [100, 25, 50]);
  rotateParts([p], 'x', 90, [0, 0, 0]);
  nearArr(aabbOf(p).max, before.max);
});

test('placeLocal：親の回転と位置を子に掛ける', () => {
  const base = { c: [1000, 1000, 0], r: [0, 0, 90] };
  const out = placeLocal(base, [100, 0, 50], [0, 0, 0]);
  nearArr(out.c, [1000, 1100, 50]);
  nearArr(out.r, [0, 0, 90]);
});

test('unionAabb：複数部材を包む箱', () => {
  const b = unionAabb([box([0, 0, 0], [100, 100, 100]), box([500, 0, 0], [100, 100, 100])]);
  nearArr(b.min, [-50, -50, -50]);
  nearArr(b.max, [550, 50, 50]);
});

// ---------- model ----------
test('addPart：番号が重複しない', () => {
  const doc = newDoc();
  const a = addPart(doc, box([0, 0, 0], [1, 1, 1]));
  const b = addPart(doc, box([0, 0, 0], [1, 1, 1]));
  assert.notEqual(a.id, b.id);
  assert.equal(doc.parts.length, 2);
});

test('serializeDoc → parseDoc で同じ内容に戻る', () => {
  const doc = newDoc();
  addPart(doc, { kind: 'lumber', name: '間柱', mat: 'wood', c: [1, 2, 3], s: [2400, 30, 105], r: [0, -90, 0] });
  doc.dims.push({ id: 'd1', a: [0, 0, 0], b: [100, 0, 0] });
  const back = parseDoc(serializeDoc(doc));
  assert.deepEqual(back.parts, doc.parts);
  assert.deepEqual(back.dims, doc.dims);
  const c = addPart(back, box([0, 0, 0], [1, 1, 1]));
  assert.ok(!doc.parts.some(p => p.id === c.id), '読み込み後に足した部材の番号が既存と重ならない');
});

test('parseDoc：別のアプリのファイルは読まない', () => {
  assert.throws(() => parseDoc('{"app":"other","parts":[]}'), /造作3DCAD/);
  assert.throws(() => parseDoc('not json'));
});

test('parseDoc：数値でない寸法の部材は捨てる', () => {
  const doc = parseDoc(JSON.stringify({ app: 'zosaku3dcad', version: 1, parts: [
    { id: 'p1', kind: 'box', c: [0, 0, 0], s: [100, 100, 100], r: [0, 0, 0] },
    { id: 'p2', kind: 'box', c: [0, 'x', 0], s: [100, 100, 100], r: [0, 0, 0] },
    { id: 'p3', kind: 'box', c: [0, 0, 0], s: [0, 100, 100], r: [0, 0, 0] }
  ] }));
  assert.deepEqual(doc.parts.map(p => p.id), ['p1']);
});

test('History：元に戻す・やり直し', () => {
  const h = new History();
  h.push('A');
  h.push('B');
  assert.equal(h.undo('C'), 'B');
  assert.equal(h.undo('B'), 'A');
  assert.equal(h.undo('A'), null);
  assert.equal(h.redo('A'), 'B');
  assert.equal(h.redo('B'), 'C');
  assert.equal(h.redo('C'), null);
});

test('History：新しい操作をすると、やり直しは消える', () => {
  const h = new History();
  h.push('A');
  h.undo('B');
  h.push('A2');
  assert.equal(h.redo('X'), null);
});

test('wallFromPoints：X方向の壁', () => {
  const w = wallFromPoints([0, 0], [1000, 0], 100, 2400, 0);
  nearArr(w.c, [500, 0, 1200]);
  nearArr(w.s, [1000, 100, 2400]);
  nearArr(w.r, [0, 0, 0]);
});

test('wallFromPoints：Y方向の壁は90°、端点が元に戻る', () => {
  const w = wallFromPoints([200, 100], [200, 1100], 100, 2400, 50);
  nearArr(w.r, [0, 0, 90]);
  near(w.c[2], 1250);
  const e = wallEnds(w);
  nearArr(e.a, [200, 100]);
  nearArr(e.b, [200, 1100]);
});

// ---------- snap ----------
test('snapGrid：刻みに丸める', () => {
  assert.equal(snapGrid(1234, 10), 1230);
  assert.equal(snapGrid(1236, 10), 1240);
  assert.equal(snapGrid(-7, 5), -5);
  assert.equal(snapGrid(12.3, 0), 12.3);
});

test('snapBox：近くの面にぴったり付ける', () => {
  const moving = { min: [0, 0, 0], max: [995, 100, 100] };
  const other = { min: [1000, 0, 0], max: [1100, 100, 100] };
  const r = snapBox(moving, [other], 10);
  near(r.d[0], 5);
  assert.equal(r.hit[0], true);
});

test('snapBox：離れていれば動かさない', () => {
  const moving = { min: [0, 300, 500], max: [900, 400, 600] };
  const other = { min: [1000, 0, 0], max: [1100, 100, 100] };
  const r = snapBox(moving, [other], 10);
  nearArr(r.d, [0, 0, 0]);
  assert.deepEqual(r.hit, [false, false, false]);
});

// ---------- framing ----------
const wall = (L, H, t, openings = [], r = [0, 0, 0], c = null) =>
  ({ kind: 'wall', name: '壁', c: c || [L / 2, 0, H / 2], s: [L, t, H], r, openings });
const FR = { studB: 30, studD: 105, pitch: 455, sides: 2, boardT: 12.5, boardW: 910, boardL: 2420 };
// 板材は s[2] が厚さ（約束）。面積は s[0]×s[1]
const boardArea = parts => parts.filter(p => p.kind === 'panel').reduce((a, p) => a + p.s[0] * p.s[1], 0);

test('frameWall：開口なしの壁は上下枠と455ピッチの間柱になる', () => {
  const parts = frameWall(wall(1820, 2400, 130), FR);
  const lum = parts.filter(p => p.kind === 'lumber');
  assert.equal(lum.filter(p => p.name === '下枠').length, 1);
  assert.equal(lum.filter(p => p.name === '上枠').length, 1);
  const studs = lum.filter(p => p.name === '間柱');
  assert.equal(studs.length, 5);
  studs.forEach(s => near(s.s[0], 2340));
  nearArr(studs.map(s => s.c[0]).sort((a, b) => a - b), [15, 455, 910, 1365, 1805]);
});

test('frameWall：ボード両面張りの面積は壁の面積×2', () => {
  const parts = frameWall(wall(1820, 2400, 130), FR);
  assert.equal(parts.filter(p => p.kind === 'panel').length, 4);
  near(boardArea(parts), 1820 * 2400 * 2);
});

test('frameWall：部材全体が元の壁の箱に収まる（回転した壁でも）', () => {
  for (const r of [[0, 0, 0], [0, 0, 90], [0, 0, 30]]) {
    const w = wall(1820, 2400, 130, [], r, [3000, 2000, 1200]);
    const u = unionAabb(frameWall(w, FR));
    const b = aabbOf(w);
    nearArr(u.min, b.min, 1e-3);
    nearArr(u.max, b.max, 1e-3);
  }
});

test('frameWall：ボードが定尺より高い壁は上下に分けて張る', () => {
  const parts = frameWall(wall(910, 3000, 130), { ...FR, sides: 1 });
  const boards = parts.filter(p => p.kind === 'panel');
  assert.equal(boards.length, 2);
  near(boardArea(parts), 910 * 3000);
});

test('frameWall：ドア開口は下枠を切り、まぐさを入れ、開口に部材がかからない', () => {
  const w = wall(1820, 2400, 130, [{ id: 'o1', type: 'door', x: 500, w: 800, h: 2000, sill: 0 }]);
  const parts = frameWall(w, FR);
  assert.equal(parts.filter(p => p.name === '下枠').length, 2);
  assert.equal(parts.filter(p => p.name === 'まぐさ').length, 1);
  assert.equal(parts.filter(p => p.name === '窓台').length, 0);
  const hole = { min: [500, -1000, 0], max: [1300, 1000, 2000] };
  for (const p of parts.filter(q => q.kind !== 'fitting')) {
    near(overlapVol(aabbOf(p), hole), 0, 1e-3);
  }
  near(boardArea(parts), (1820 * 2400 - 800 * 2000) * 2, 1e-3);
  assert.equal(parts.filter(p => p.kind === 'fitting').length, 1, '建具は建具部材として残る');
});

test('frameWall：窓開口は窓台と上下の短い間柱が入る', () => {
  const w = wall(2730, 2400, 130, [{ id: 'o1', type: 'window', x: 600, w: 1650, h: 1100, sill: 900 }]);
  const parts = frameWall(w, FR);
  assert.equal(parts.filter(p => p.name === '窓台').length, 1);
  assert.equal(parts.filter(p => p.name === 'まぐさ').length, 1);
  const shorts = parts.filter(p => p.name === '間柱（開口上下）');
  assert.ok(shorts.length >= 4, `開口上下の間柱 ${shorts.length}本`);
  const hole = { min: [600, -1000, 900], max: [2250, 1000, 2000] };
  for (const p of parts.filter(q => q.kind !== 'fitting')) near(overlapVol(aabbOf(p), hole), 0, 1e-3);
  near(boardArea(parts), (2730 * 2400 - 1650 * 1100) * 2, 1e-3);
});

test('frameWall：ボードなし（sides 0）なら板材は出ない', () => {
  const parts = frameWall(wall(1820, 2400, 105), { ...FR, sides: 0 });
  assert.equal(parts.filter(p => p.kind === 'panel').length, 0);
});

// ---------- cabinet ----------
test('makeCabinet：部材数と外形寸法', () => {
  const parts = makeCabinet({ W: 900, D: 300, H: 1800, t: 18, shelves: 3, back: 4, kick: 0 });
  assert.equal(parts.length, 8);
  const u = unionAabb(parts);
  nearArr(u.min, [-450, -150, 0]);
  nearArr(u.max, [450, 150, 1800]);
});

test('makeCabinet：板どうしが重ならない', () => {
  const parts = makeCabinet({ W: 900, D: 450, H: 2000, t: 21, shelves: 4, back: 9, kick: 60 });
  for (let i = 0; i < parts.length; i++) for (let j = i + 1; j < parts.length; j++) {
    near(overlapVol(aabbOf(parts[i]), aabbOf(parts[j])), 0, 1e-3);
  }
  assert.equal(parts.filter(p => p.name === '棚板').length, 4);
  assert.ok(parts.some(p => p.name === '台輪'));
});

test('makeCabinet：どの板も s[2] が板厚', () => {
  const parts = makeCabinet({ W: 900, D: 300, H: 1800, t: 18, shelves: 2, back: 4, kick: 60 });
  for (const p of parts) assert.ok(p.s[2] === 18 || (p.name === '背板' && p.s[2] === 4), `${p.name} ${p.s}`);
});

test('makeCabinet：棚板は等間隔', () => {
  const parts = makeCabinet({ W: 900, D: 300, H: 1800, t: 18, shelves: 3, back: 0, kick: 0 });
  const z = parts.filter(p => p.name === '棚板').map(p => p.c[2]).sort((a, b) => a - b);
  near(z[1] - z[0], z[2] - z[1]);
  near(z[1], 900);
});

test('makeCounter：天板の上面が指定の高さ', () => {
  const parts = makeCounter({ W: 1800, D: 600, H: 850, top: 30, t: 30 });
  const u = unionAabb(parts);
  near(u.max[2], 850);
  near(u.min[2], 0);
  near(u.max[0] - u.min[0], 1800);
  assert.equal(parts.filter(p => p.name === 'カウンター天板').length, 1);
});

// ---------- cutlist ----------
test('buildCutlist：同じ断面・長さの角材は、向きや断面の縦横が違っても1行にまとまる', () => {
  const parts = [
    { kind: 'lumber', name: '間柱', mat: 'wood', c: [0, 0, 0], s: [2340, 105, 30], r: [0, -90, 0] },
    { kind: 'lumber', name: '間柱', mat: 'wood', c: [500, 0, 0], s: [2340, 105, 30], r: [0, -90, 0] },
    { kind: 'lumber', name: '間柱', mat: 'wood', c: [900, 0, 0], s: [2340, 30, 105], r: [0, 0, 0] }
  ];
  const cl = buildCutlist(parts);
  assert.equal(cl.lumber.length, 1);
  const row = cl.lumber[0];
  assert.equal(row.qty, 3);
  assert.equal(row.b, 30);
  assert.equal(row.h, 105);
  assert.equal(row.len, 2340);
  near(row.totalM, 7.02);
});

test('buildCutlist：角材は s[0] が長さ（断面より短い端材でも長さを取り違えない）', () => {
  const cl = buildCutlist([{ kind: 'lumber', name: '間柱', mat: 'wood', c: [0, 0, 0], s: [60, 105, 30], r: [0, 0, 0] }]);
  assert.equal(cl.lumber[0].len, 60);
  assert.equal(cl.lumber[0].b, 30);
  assert.equal(cl.lumber[0].h, 105);
});

test('buildCutlist：板材は s[2] が厚さ、残りの大きい方が長さ', () => {
  const cl = buildCutlist([{ kind: 'panel', name: '石膏ボード', mat: 'gypsum', c: [0, 0, 0], s: [910, 2400, 12.5], r: [90, 0, 0] }]);
  const row = cl.panels[0];
  assert.equal(row.t, 12.5);
  assert.equal(row.w, 910);
  assert.equal(row.len, 2400);
  near(row.areaM2, 2.184);
});

test('wallArea：開口を差し引く', () => {
  const w = wall(3640, 2400, 130, [{ id: 'o1', type: 'door', x: 500, w: 800, h: 2000, sill: 0 }]);
  near(wallArea(w), (3640 * 2400 - 800 * 2000) / 1e6);
});

test('buildCutlist：壁と建具を数える', () => {
  const w = wall(3640, 2400, 130, [
    { id: 'o1', type: 'door', x: 500, w: 800, h: 2000, sill: 0 },
    { id: 'o2', type: 'open', x: 2000, w: 900, h: 2000, sill: 0 }
  ]);
  const cl = buildCutlist([w, { kind: 'fitting', ftype: 'door', name: '片開きドア', c: [0, 0, 0], s: [800, 130, 2000], r: [0, 0, 0] }]);
  assert.equal(cl.walls.length, 1);
  assert.equal(cl.fittings.reduce((a, r) => a + r.qty, 0), 2, '開口のみ（open）は建具に数えない');
});

test('packStock：定尺に収まる組合せでまとめる', () => {
  assert.equal(packStock([1800, 1800, 300], 4000, 0).bins, 1);
  assert.equal(packStock([2340, 2340, 2340, 2340, 2340], 4000, 3).bins, 5);
  assert.equal(packStock([2000, 2000], 4000, 3).bins, 2, '切りしろの分で2本に分かれる');
});

test('packStock：定尺より長い材は別に知らせる', () => {
  const r = packStock([4500, 1000], 4000, 3);
  assert.deepEqual(r.over, [4500]);
  assert.equal(r.bins, 1);
});

test('buildCutlist：角材の定尺換算が入る', () => {
  const parts = Array.from({ length: 5 }, (_, i) => ({ kind: 'lumber', name: '間柱', mat: 'wood', c: [i * 455, 0, 0], s: [2340, 105, 30], r: [0, -90, 0] }));
  const cl = buildCutlist(parts, { stockLen: 4000, kerf: 3 });
  assert.equal(cl.stock.length, 1);
  assert.equal(cl.stock[0].count, 5);
});

test('cutlistCsv：Excelで開けるようBOM付き、見出しと数量が入る', () => {
  const cl = buildCutlist([{ kind: 'lumber', name: '間柱', mat: 'wood', c: [0, 0, 0], s: [2340, 105, 30], r: [0, 0, 0] }]);
  const csv = cutlistCsv(cl);
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.match(csv, /角材/);
  assert.match(csv, /間柱/);
  assert.match(csv, /2340/);
  assert.ok(csv.includes('\r\n'));
});

// ---------- sample ----------
import { buildSample } from '../src/core/sample.js';

test('buildSample：保存して読み直しても部材が欠けない', () => {
  const doc = buildSample();
  assert.ok(doc.parts.length > 30);
  const back = parseDoc(serializeDoc(doc));
  assert.equal(back.parts.length, doc.parts.length);
  assert.equal(new Set(doc.parts.map(p => p.id)).size, doc.parts.length, '番号の重複なし');
});

test('buildSample：部材は部屋のまわりに収まる', () => {
  const u = unionAabb(buildSample().parts);
  assert.ok(u.min[0] > -200 && u.max[0] < 3900, `X ${u.min[0]}〜${u.max[0]}`);
  assert.ok(u.min[1] > -200 && u.max[1] < 3000, `Y ${u.min[1]}〜${u.max[1]}`);
  assert.ok(u.min[2] >= -30 && u.max[2] <= 2400.001, `Z ${u.min[2]}〜${u.max[2]}`);
});

// ---------- 壁付け棚 ----------
const WS = { W: 900, D: 250, t: 18, n: 3, pitch: 300, h0: 900, brackets: 2 };

test('makeWallShelf：棚板の数と、棚受けは1段に2個', () => {
  const parts = makeWallShelf(WS);
  assert.equal(parts.filter(p => p.name === '棚板').length, 3);
  assert.equal(parts.filter(p => p.kind === 'hardware').length, 6);
});

test('makeWallShelf：下の段の上面が取付高さ、段の間隔は指定どおり', () => {
  const tops = makeWallShelf(WS).filter(p => p.name === '棚板').map(p => aabbOf(p).max[2]).sort((a, b) => a - b);
  nearArr(tops, [900, 1200, 1500]);
});

test('makeWallShelf：背（壁の側）が y＝奥行/2 にそろい、正面は -Y', () => {
  const parts = makeWallShelf(WS);
  const u = unionAabb(parts);
  near(u.max[1], 125);
  near(u.min[1], -125);
  for (const p of parts.filter(q => q.kind === 'hardware')) near(aabbOf(p).max[1], 125);
});

test('makeWallShelf：棚受けは棚板の真下に付き、板と重ならない', () => {
  const parts = makeWallShelf(WS);
  const boards = parts.filter(p => p.name === '棚板');
  for (const h of parts.filter(p => p.kind === 'hardware')) {
    const hb = aabbOf(h);
    const under = boards.find(b => Math.abs(aabbOf(b).min[2] - hb.max[2]) < 1e-6);
    assert.ok(under, '棚受けの上端が、どれかの棚板の下面にそろう');
    for (const b of boards) near(overlapVol(hb, aabbOf(b)), 0, 1e-6);
    assert.ok(hb.min[0] >= -450 && hb.max[0] <= 450, '棚受けは棚板の幅の中');
  }
});

test('makeWallShelf：棚受け0個なら棚板だけ', () => {
  const parts = makeWallShelf({ ...WS, brackets: 0 });
  assert.ok(parts.every(p => p.name === '棚板'));
});

test('makeWallShelf：板材は s[2] が板厚', () => {
  for (const p of makeWallShelf(WS).filter(q => q.kind === 'panel')) assert.equal(p.s[2], 18);
});

test('parseDoc：金物（hardware）を読み込める', () => {
  const doc = newDoc();
  addPart(doc, { kind: 'hardware', name: '棚受け金物', mat: 'steel', c: [0, 0, 0], s: [25, 200, 150], r: [0, 0, 0] });
  const back = parseDoc(serializeDoc(doc));
  assert.equal(back.parts.length, 1);
  assert.equal(back.parts[0].kind, 'hardware');
});

test('buildCutlist：金物は名称と寸法ごとに数える', () => {
  const cl = buildCutlist(makeWallShelf(WS));
  assert.equal(cl.hardware.length, 1);
  assert.equal(cl.hardware[0].qty, 6);
  assert.equal(cl.panels.find(r => r.name === '棚板').qty, 3);
  assert.match(cutlistCsv(cl), /【金物】/);
});

test('makeWallShelf：段の間隔が狭いときは、棚受けを縮めて下の棚板に当てない', () => {
  const parts = makeWallShelf({ ...WS, pitch: 120 });
  const boards = parts.filter(p => p.name === '棚板').map(aabbOf);
  for (const h of parts.filter(p => p.kind === 'hardware').map(aabbOf)) {
    for (const b of boards) near(overlapVol(h, b), 0, 1e-6);
    assert.ok(h.max[2] - h.min[2] >= 30, '縦の長さは30mm以上は残す');
  }
});

// ---------- 自動寸法 ----------
import { autoDims } from '../src/core/dims.js';
const FRONT = [0, 1, 0], PLAN = [0, 0.0005, -1], ISO = [-0.75, 1.2, -0.8];
const lenOf = d => Math.hypot(d.b[0] - d.a[0], d.b[1] - d.a[1], d.b[2] - d.a[2]);
const totals = ds => ds.filter(d => d.kind === 'total');
const chainOn = (ds, ax) => ds.filter(d => d.kind === 'chain' && d.axis === ax);

test('autoDims：外形寸法 W・D・H が出る', () => {
  const cab = makeCabinet({ W: 900, D: 300, H: 1800, t: 18, shelves: 3, back: 4, kick: 60 });
  const t = totals(autoDims(cab, ISO));
  assert.deepEqual(t.map(d => d.axis).sort(), [0, 1, 2]);
  assert.deepEqual(t.map(d => d.text), t.map(d => String(Math.round(lenOf(d)))));
  near(lenOf(t.find(d => d.axis === 0)), 900);
  near(lenOf(t.find(d => d.axis === 1)), 300);
  near(lenOf(t.find(d => d.axis === 2)), 1800);
});

test('autoDims：棚割り（高さ方向）の寸法をつなぐと全高になる', () => {
  const cab = makeCabinet({ W: 900, D: 300, H: 1800, t: 18, shelves: 3, back: 4, kick: 60 });
  const ch = chainOn(autoDims(cab, ISO), 2);
  near(ch.reduce((a, d) => a + lenOf(d), 0), 1800);
  assert.equal(ch.length, 10, '台輪・地板・3段の棚板（板厚と内法）・天板');
  assert.ok(ch.some(d => d.text === '18'));
});

test('autoDims：幅方向は側板と内法（18・864・18）', () => {
  const cab = makeCabinet({ W: 900, D: 300, H: 1800, t: 18, shelves: 0, back: 0, kick: 0 });
  assert.deepEqual(chainOn(autoDims(cab, FRONT), 0).map(d => d.text), ['18', '864', '18']);
});

test('autoDims：壁付け棚は床からの高さもつなぐ', () => {
  const ws = makeWallShelf({ W: 900, D: 250, t: 18, n: 2, pitch: 300, h0: 900, brackets: 0 });
  const ch = chainOn(autoDims(ws, FRONT), 2);
  near(ch[0].a[2], 0);
  assert.deepEqual(ch.map(d => d.text), ['882', '18', '282', '18']);
});

test('autoDims：chains:false なら外形だけ', () => {
  const cab = makeCabinet({ W: 900, D: 300, H: 1800, t: 18, shelves: 3, back: 4, kick: 60 });
  assert.equal(autoDims(cab, ISO, { chains: false }).length, 3);
});

test('autoDims：正面図では幅の寸法を下に、高さの寸法を左に出す（画面で読める向き）', () => {
  const cab = makeCabinet({ W: 900, D: 300, H: 1800, t: 18, shelves: 0, back: 0, kick: 0 });
  const t = totals(autoDims(cab, FRONT));
  const w = t.find(d => d.axis === 0), h = t.find(d => d.axis === 2);
  assert.ok(w.a[2] < 0 && w.b[2] < 0, '幅は床より下');
  near(w.a[1], -150);
  assert.ok(h.a[0] < -450, '高さは左側');
  const ch = chainOn(autoDims(cab, FRONT), 0)[0];
  assert.ok(ch.a[2] > w.a[2], '内訳の寸法は、外形より物の近く');
});

test('autoDims：平面図では幅の寸法を手前（-Y）に出す', () => {
  const cab = makeCabinet({ W: 900, D: 300, H: 1800, t: 18, shelves: 0, back: 0, kick: 0 });
  const w = totals(autoDims(cab, PLAN)).find(d => d.axis === 0);
  assert.ok(w.a[1] < -150 && w.b[1] < -150);
});

test('autoDims：寸法線には引出線と端の印がある', () => {
  const d = totals(autoDims(makeCabinet({ W: 900, D: 300, H: 1800, t: 18, shelves: 0, back: 0, kick: 0 }), FRONT))[0];
  assert.equal(d.ext.length, 2);
  assert.equal(d.ticks.length, 2);
});

test('autoDims：部材がなければ何も出さない', () => {
  assert.deepEqual(autoDims([], ISO), []);
});
