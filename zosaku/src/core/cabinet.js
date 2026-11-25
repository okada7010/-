// 造作家具（箱物・カウンター）を板材に分けて作る。
// 原点は家具の平面の中心・床面。正面は手前（-Y）。板材は s[2] が板厚。

const side = (name, mat, x, yc, depth, height, t, z0 = 0) =>
  ({ kind: 'panel', name, mat, c: [x, yc, z0 + height / 2], s: [height, depth, t], r: [0, -90, 0] });
const flat = (name, mat, yc, width, depth, t, zc) =>
  ({ kind: 'panel', name, mat, c: [0, yc, zc], s: [width, depth, t], r: [0, 0, 0] });
const upright = (name, mat, yc, width, height, t, zc) =>
  ({ kind: 'panel', name, mat, c: [0, yc, zc], s: [width, height, t], r: [90, 0, 0] });

export function makeCabinet(o) {
  const W = o.W, D = o.D, H = o.H, t = o.t;
  const n = Math.max(0, Math.floor(o.shelves || 0));
  const tb = Math.max(0, o.back || 0), kick = Math.max(0, o.kick || 0);
  const mat = o.mat || 'lumbercore';
  const Dc = D - tb;          // 箱の奥行（背板は後ろからかぶせる）
  const yc = -tb / 2;
  const inner = W - 2 * t;
  const out = [];
  out.push(side('側板', mat, -(W / 2 - t / 2), yc, Dc, H, t));
  out.push(side('側板', mat, W / 2 - t / 2, yc, Dc, H, t));
  out.push(flat('天板', mat, yc, inner, Dc, t, H - t / 2));
  out.push(flat('地板', mat, yc, inner, Dc, t, kick + t / 2));
  const clear = H - kick - 2 * t;
  const gap = (clear - n * t) / (n + 1);
  for (let k = 1; k <= n; k++) {
    out.push(flat('棚板', mat, yc, inner, Dc, t, kick + t + gap * k + t * (k - 0.5)));
  }
  if (tb > 0) out.push(upright('背板', o.backMat || 'plywood', D / 2 - tb / 2, W, H, tb, H / 2));
  if (kick > 0) {
    const inset = Dc > 100 ? 30 : 0;
    out.push(upright('台輪', mat, -D / 2 + inset + t / 2, inner, kick, t, kick / 2));
  }
  return out;
}

export function makeCounter(o) {
  const W = o.W, D = o.D, H = o.H, top = o.top, t = o.t;
  const legH = H - top;
  const out = [];
  out.push({ kind: 'panel', name: 'カウンター天板', mat: o.topMat || 'laminated', c: [0, 0, H - top / 2], s: [W, D, top], r: [0, 0, 0] });
  out.push(side('側板', o.mat || 'lumbercore', -(W / 2 - t / 2), 0, D, legH, t));
  out.push(side('側板', o.mat || 'lumbercore', W / 2 - t / 2, 0, D, legH, t));
  const apron = Math.min(200, Math.max(60, legH / 4));
  out.push(upright('幕板', o.mat || 'lumbercore', D / 2 - 30 - t / 2, W - 2 * t, apron, t, legH - apron / 2));
  return out;
}

// 壁付け棚：棚板と棚受け金物（L字）。背（壁の側）が +Y、正面が -Y。
// h0＝下の段の棚板の上面の高さ（床から）。金物は kind 'hardware'（s＝［幅, 腕の長さ, 縦の長さ］）。
export function makeWallShelf(o) {
  const W = o.W, D = o.D, t = o.t;
  const n = Math.max(1, Math.floor(o.n || 1));
  const k = Math.max(0, Math.floor(o.brackets ?? 2));
  const mat = o.mat || 'lumbercore';
  const armD = o.armD || Math.max(50, Math.round(D * 0.8 / 5) * 5);   // 腕は奥行の8割ほど
  let armH = o.armH || Math.max(50, Math.round(armD * 0.75 / 5) * 5);
  if (n > 1) armH = Math.max(30, Math.min(armH, o.pitch - t - 10)); // 下の段の棚板に当てない
  const bw = 25;
  const inset = Math.min(100, W / 4);
  const xs = k === 1 ? [0] : Array.from({ length: k }, (_, i) => -W / 2 + inset + (W - 2 * inset) * i / (k - 1));
  const out = [];
  for (let i = 0; i < n; i++) {
    const top = o.h0 + i * o.pitch;
    out.push({ kind: 'panel', name: '棚板', mat, c: [0, 0, top - t / 2], s: [W, D, t], r: [0, 0, 0] });
    for (const x of xs) {
      out.push({ kind: 'hardware', name: '棚受け金物', mat: 'steel', c: [x, D / 2 - armD / 2, top - t - armH / 2], s: [bw, armD, armH], r: [0, 0, 0] });
    }
  }
  return out;
}
