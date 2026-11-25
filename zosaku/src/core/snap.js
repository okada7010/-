// 位置合わせ（グリッドと、ほかの部材の面への吸着）

export function snapGrid(v, step) {
  if (!step || step <= 0) return v;
  const out = Math.round(v / step) * step;
  return out === 0 ? 0 : out;
}

// 動かしている箱 box を、others の面に軸ごとに合わせる。
// 返り値 d＝ずらす量、hit＝その軸で合わせたか、at＝合わせた面の座標
export function snapBox(box, others, tol) {
  const d = [0, 0, 0], hit = [false, false, false], at = [null, null, null];
  for (let i = 0; i < 3; i++) {
    let best = tol + 1e-9;
    for (const o of others) {
      for (const mine of [box.min[i], box.max[i]]) {
        for (const theirs of [o.min[i], o.max[i]]) {
          const diff = theirs - mine;
          if (Math.abs(diff) < best) { best = Math.abs(diff); d[i] = diff; hit[i] = true; at[i] = theirs; }
        }
      }
    }
  }
  return { d, hit, at };
}
