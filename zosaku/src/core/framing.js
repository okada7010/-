// 壁を下地（上下枠・間柱・開口まわり）とボードに展開する。
// 約束：角材は s[0] が長さ、板材は s[2] が厚さ。
import { placeLocal } from './geom.js';

const EPS = 0.5;
const MIN_SHORT = 50; // これより短い間柱は入れない

// 四角 r から四角 o を切り抜いた残り（最大4枚）
function rectMinus(r, o) {
  if (o.u1 <= r.u0 + EPS || o.u0 >= r.u1 - EPS || o.v1 <= r.v0 + EPS || o.v0 >= r.v1 - EPS) return [r];
  const out = [];
  if (o.u0 > r.u0 + EPS) out.push({ u0: r.u0, u1: o.u0, v0: r.v0, v1: r.v1 });
  if (o.u1 < r.u1 - EPS) out.push({ u0: o.u1, u1: r.u1, v0: r.v0, v1: r.v1 });
  const mu0 = Math.max(r.u0, o.u0), mu1 = Math.min(r.u1, o.u1);
  if (o.v0 > r.v0 + EPS) out.push({ u0: mu0, u1: mu1, v0: r.v0, v1: o.v0 });
  if (o.v1 < r.v1 - EPS) out.push({ u0: mu0, u1: mu1, v0: o.v1, v1: r.v1 });
  return out;
}

// 壁の面（長さ×高さ）から開口を除いた四角の集まり。u＝0〜長さ、v＝0〜高さ
export function wallPieces(wall) {
  const L = wall.s[0], H = wall.s[2];
  let rects = [{ u0: 0, u1: L, v0: 0, v1: H }];
  for (const o of wall.openings || []) {
    const a = { u0: Math.max(0, o.x), u1: Math.min(L, o.x + o.w), v0: Math.max(0, o.sill), v1: Math.min(H, o.sill + o.h) };
    if (a.u1 - a.u0 < 1 || a.v1 - a.v0 < 1) continue;
    rects = rects.flatMap(r => rectMinus(r, a));
  }
  return rects.filter(r => r.u1 - r.u0 > 0.5 && r.v1 - r.v0 > 0.5);
}

export function frameWall(wall, opt) {
  const L = wall.s[0], H = wall.s[2];
  const B = opt.studB, D = opt.studD, pitch = Math.max(50, opt.pitch);
  const sides = opt.sides || 0, bt = opt.boardT || 0;
  const studMat = opt.studMat || 'wood', boardMat = opt.boardMat || 'gypsum';
  const boardName = opt.boardName || '石膏ボード';
  const yShift = sides === 1 ? bt / 2 : 0; // 片面張りは、全体が壁の厚さの中央に来るよう下地を寄せる
  const out = [];

  // 壁の座標（u＝長さ方向 0〜L、v＝高さ 0〜H、y＝厚さ方向）で箱を指定して部材にする
  const put = (kind, name, mat, u0, u1, y0, y1, v0, v1, dir) => {
    const lc = [(u0 + u1) / 2 - L / 2, (y0 + y1) / 2, (v0 + v1) / 2 - H / 2];
    let s, lr;
    if (dir === 'h') { s = [u1 - u0, y1 - y0, v1 - v0]; lr = [0, 0, 0]; }          // 横使いの角材
    else if (dir === 'v') { s = [v1 - v0, y1 - y0, u1 - u0]; lr = [0, -90, 0]; }   // 立てた角材
    else if (dir === 'board') { s = [u1 - u0, v1 - v0, y1 - y0]; lr = [90, 0, 0]; } // 壁面に張る板
    else { s = [u1 - u0, y1 - y0, v1 - v0]; lr = [0, 0, 0]; }
    const w = placeLocal(wall, lc, lr);
    const part = { kind, name, mat, c: w.c, s, r: w.r };
    out.push(part);
    return part;
  };
  const lum = (name, u0, u1, v0, v1, dir) => {
    if (u1 - u0 < 1 || v1 - v0 < 1) return;
    put('lumber', name, studMat, u0, u1, yShift - D / 2, yShift + D / 2, v0, v1, dir);
  };

  // 開口を壁の範囲に収める
  const ops = (wall.openings || []).map(o => ({
    o,
    u0: Math.max(0, Math.min(L, o.x)), u1: Math.max(0, Math.min(L, o.x + o.w)),
    v0: Math.max(0, Math.min(H, o.sill)), v1: Math.max(0, Math.min(H, o.sill + o.h))
  })).filter(a => a.u1 - a.u0 > 1 && a.v1 - a.v0 > 1).sort((a, b) => a.u0 - b.u0);
  for (const a of ops) a.floor = a.v0 < B + EPS; // 下枠を切る開口（ドアなど）

  // 上枠
  lum('上枠', 0, L, H - B, H, 'h');

  // 下枠（床まである開口のところで切る）
  let segs = [{ u0: 0, u1: L }];
  for (const a of ops.filter(x => x.floor)) {
    const c0 = Math.max(0, a.u0 - B), c1 = Math.min(L, a.u1 + B);
    segs = segs.flatMap(s => {
      if (c1 <= s.u0 || c0 >= s.u1) return [s];
      const r = [];
      if (c0 > s.u0) r.push({ u0: s.u0, u1: c0 });
      if (c1 < s.u1) r.push({ u0: c1, u1: s.u1 });
      return r;
    });
  }
  for (const s of segs) lum('下枠', s.u0, s.u1, 0, B, 'h');

  // 間柱の位置（中心）。端はぴったり、あとは端からピッチごと
  const top = H - B;
  const pos = [];
  if (L > B) {
    pos.push(B / 2);
    for (let k = 1; k * pitch <= L - B * 1.5 + EPS; k++) pos.push(k * pitch);
    if (L - B / 2 > pos[pos.length - 1] + EPS) pos.push(L - B / 2);
  }
  const blocked = u => ops.some(a => u + B / 2 > a.u0 - B + EPS && u - B / 2 < a.u1 + B - EPS);
  for (const u of pos) if (!blocked(u)) lum('間柱', u - B / 2, u + B / 2, B, top, 'v');

  // 開口まわり
  for (const a of ops) {
    const sideBottom = a.floor ? 0 : B;
    if (a.u0 > EPS) lum('間柱（開口脇）', Math.max(0, a.u0 - B), a.u0, sideBottom, top, 'v');
    if (a.u1 < L - EPS) lum('間柱（開口脇）', a.u1, Math.min(L, a.u1 + B), sideBottom, top, 'v');
    const headTop = Math.min(a.v1 + B, top);
    if (a.v1 < top - EPS) lum('まぐさ', a.u0, a.u1, a.v1, headTop, 'h');
    let sillBottom = a.v0;
    if (!a.floor) {
      sillBottom = Math.max(B, a.v0 - B);
      lum('窓台', a.u0, a.u1, sillBottom, a.v0, 'h');
    }
    for (const u of pos) {
      if (u - B / 2 < a.u0 - EPS || u + B / 2 > a.u1 + EPS) continue;
      if (top - headTop >= MIN_SHORT) lum('間柱（開口上下）', u - B / 2, u + B / 2, headTop, top, 'v');
      if (!a.floor && sillBottom - B >= MIN_SHORT) lum('間柱（開口上下）', u - B / 2, u + B / 2, B, sillBottom, 'v');
    }
  }

  // ボード（端から定尺幅で割り付け、開口を切り抜く）
  if (sides > 0 && bt > 0) {
    const bw = Math.max(100, opt.boardW || 910), bl = Math.max(100, opt.boardL || 1820);
    const faces = sides >= 2 ? [-1, 1] : [-1];
    for (const f of faces) {
      const yc = yShift + f * (D / 2 + bt / 2);
      for (let u = 0; u < L - EPS; u += bw) {
        for (let v = 0; v < H - EPS; v += bl) {
          let rects = [{ u0: u, u1: Math.min(L, u + bw), v0: v, v1: Math.min(H, v + bl) }];
          for (const a of ops) rects = rects.flatMap(r => rectMinus(r, a));
          for (const r of rects) {
            if (r.u1 - r.u0 < 1 || r.v1 - r.v0 < 1) continue;
            put('panel', boardName, boardMat, r.u0, r.u1, yc - bt / 2, yc + bt / 2, r.v0, r.v1, 'board');
          }
        }
      }
    }
  }

  // 建具は建具部材として残す
  const T = D + sides * bt;
  for (const a of ops) {
    if (a.o.type === 'open') continue;
    const p = put('fitting', a.o.name || (a.o.type === 'door' ? 'ドア' : '窓'), a.o.type === 'door' ? 'wood' : 'white',
      a.u0, a.u1, -T / 2, T / 2, a.v0, a.v1, 'box');
    p.ftype = a.o.type;
  }
  return out;
}
