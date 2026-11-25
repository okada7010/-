// 自動の寸法（外形寸法と、板の割付寸法）。
// viewDir（視線の向き）から、画面で読める側に寸法線を出す。
// 返り値：[{ kind:'total'|'chain', axis, a, b, text, ext:[[p,q],..], ticks:[[p,q],..] }]
import { unionAabb, aabbOf } from './geom.js';

const THIN = 60; // これ以下の厚さの板を、割付寸法の対象にする

const fmt = v => {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
};

// 各軸の「板の位置」（その軸に垂直な薄い板の両面）
function boardPositions(parts, axis) {
  const out = [];
  for (const p of parts) {
    if (p.kind !== 'panel' && p.kind !== 'slab') continue;
    const b = aabbOf(p);
    const size = [0, 1, 2].map(i => b.max[i] - b.min[i]);
    const others = [0, 1, 2].filter(i => i !== axis).map(i => size[i]);
    if (size[axis] <= THIN && size[axis] < Math.min(...others)) out.push(b.min[axis], b.max[axis]);
  }
  return out;
}

function uniqSorted(vals) {
  const s = [...vals].sort((x, y) => x - y);
  const out = [];
  for (const v of s) if (!out.length || v - out[out.length - 1] > 0.5) out.push(v);
  return out;
}

export function autoDims(parts, viewDir, opt = {}) {
  if (!parts.length) return [];
  const chains = opt.chains !== false;
  const box = unionAabb(parts);
  const size = [0, 1, 2].map(i => box.max[i] - box.min[i]);
  const off = Math.max(50, Math.round(Math.max(...size) * 0.06 / 10) * 10);
  const gap = off * 0.15, over = off * 0.25, tick = off * 0.3;
  const vd = viewDir;
  // 視線の向きから見て、手前になる側（-1＝小さい側、+1＝大きい側）
  const near = i => (vd[i] < -1e-6 ? 1 : -1);
  const out = [];

  for (let m = 0; m < 3; m++) {
    if (size[m] < 0.5) continue;
    const others = [0, 1, 2].filter(i => i !== m);
    // 寸法線をずらす軸：画面の面内に近い方（視線との内積が小さい方）
    const o = Math.abs(vd[others[0]]) <= Math.abs(vd[others[1]]) ? others[0] : others[1];
    const q = others[0] === o ? others[1] : others[0];
    const sg = o === 2 ? -1 : near(o);           // 高さ方向へずらすときは常に下
    const edge = sg < 0 ? box.min[o] : box.max[o];
    const qv = near(q) < 0 ? box.min[q] : box.max[q];
    const pt = (mv, ov) => { const p = [0, 0, 0]; p[m] = mv; p[o] = ov; p[q] = qv; return p; };
    const make = (kind, v0, v1, line) => {
      const ext = [v0, v1].map(v => [pt(v, edge + sg * gap), pt(v, line + sg * over)]);
      const ticks = [v0, v1].map(v => {
        const c = pt(v, line), d = [0, 0, 0];
        d[m] = tick / 2; d[o] = sg * tick / 2;
        return [[c[0] - d[0], c[1] - d[1], c[2] - d[2]], [c[0] + d[0], c[1] + d[1], c[2] + d[2]]];
      });
      out.push({ kind, axis: m, a: pt(v0, line), b: pt(v1, line), text: fmt(v1 - v0), ext, ticks });
    };

    let pos = [];
    if (chains) {
      const bp = boardPositions(parts, m);
      if (bp.length) {
        const extra = m === 2 && box.min[2] > 1 ? [0] : []; // 浮いている物は床からの高さもつなぐ
        pos = uniqSorted([box.min[m], box.max[m], ...bp, ...extra]);
      }
    }
    const hasChain = pos.length > 2 || (pos.length === 2 && pos[0] < box.min[m] - 0.5);
    if (hasChain) for (let i = 0; i + 1 < pos.length; i++) make('chain', pos[i], pos[i + 1], edge + sg * off);
    make('total', box.min[m], box.max[m], edge + sg * (hasChain ? 2 * off : off));
  }
  return out;
}
