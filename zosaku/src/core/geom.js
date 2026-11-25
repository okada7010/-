// 幾何の計算。座標は mm、X=左右、Y=奥行、Z=高さ。
// 部材は「中心 c・ローカル寸法 s・回転 r（度、X→Y→Z の順に固定軸で回す）」の箱で表す。
import { Quaternion, Euler, Vector3, Matrix4 } from 'three';

const D2R = Math.PI / 180;
const AX = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) };

export const rnd = (v, digits = 4) => {
  const k = 10 ** digits;
  const out = Math.round(v * k) / k;
  return out === 0 ? 0 : out;
};

export function quatOf(r) {
  return new Quaternion().setFromEuler(new Euler(r[0] * D2R, r[1] * D2R, r[2] * D2R, 'ZYX'));
}

export function eulerOf(q) {
  const e = new Euler().setFromQuaternion(q, 'ZYX');
  return [rnd(e.x / D2R), rnd(e.y / D2R), rnd(e.z / D2R)];
}

function rotMatrix(r) {
  return new Matrix4().makeRotationFromQuaternion(quatOf(r)).elements; // 列優先
}

// 軸に平行な外接箱
export function aabbOf(part) {
  const m = rotMatrix(part.r);
  const h = [part.s[0] / 2, part.s[1] / 2, part.s[2] / 2];
  const min = [0, 0, 0], max = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const e = Math.abs(m[i]) * h[0] + Math.abs(m[4 + i]) * h[1] + Math.abs(m[8 + i]) * h[2];
    min[i] = part.c[i] - e;
    max[i] = part.c[i] + e;
  }
  return { min, max };
}

export function unionAabb(parts) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) {
    const b = aabbOf(p);
    for (let i = 0; i < 3; i++) {
      if (b.min[i] < min[i]) min[i] = b.min[i];
      if (b.max[i] > max[i]) max[i] = b.max[i];
    }
  }
  return { min, max };
}

// 箱の8つの角（ワールド座標）
export function cornersOf(part) {
  const q = quatOf(part.r);
  const out = [];
  for (const sx of [-0.5, 0.5]) for (const sy of [-0.5, 0.5]) for (const sz of [-0.5, 0.5]) {
    const v = new Vector3(part.s[0] * sx, part.s[1] * sy, part.s[2] * sz).applyQuaternion(q);
    out.push([v.x + part.c[0], v.y + part.c[1], v.z + part.c[2]]);
  }
  return out;
}

// ローカル座標 → ワールド座標
export function localToWorld(part, p) {
  const v = new Vector3(p[0], p[1], p[2]).applyQuaternion(quatOf(part.r));
  return [v.x + part.c[0], v.y + part.c[1], v.z + part.c[2]];
}

export function worldToLocal(part, p) {
  const v = new Vector3(p[0] - part.c[0], p[1] - part.c[1], p[2] - part.c[2]).applyQuaternion(quatOf(part.r).invert());
  return [v.x, v.y, v.z];
}

// 部材をワールドの軸まわりに回す（pivot が基準点）。parts を直接書き換える。
export function rotateParts(parts, axis, deg, pivot) {
  const qa = new Quaternion().setFromAxisAngle(AX[axis], deg * D2R);
  for (const p of parts) {
    const v = new Vector3(p.c[0] - pivot[0], p.c[1] - pivot[1], p.c[2] - pivot[2]).applyQuaternion(qa);
    p.c = [rnd(v.x + pivot[0]), rnd(v.y + pivot[1]), rnd(v.z + pivot[2])];
    p.r = eulerOf(qa.clone().multiply(quatOf(p.r)));
  }
}

// 親（base の c・r）の中に置いた子の、ワールドでの c・r を返す
export function placeLocal(base, localC, localR) {
  const qb = quatOf(base.r);
  const v = new Vector3(localC[0], localC[1], localC[2]).applyQuaternion(qb);
  return {
    c: [rnd(v.x + base.c[0]), rnd(v.y + base.c[1]), rnd(v.z + base.c[2])],
    r: eulerOf(qb.multiply(quatOf(localR)))
  };
}

export function translateParts(parts, d) {
  for (const p of parts) p.c = [rnd(p.c[0] + d[0]), rnd(p.c[1] + d[1]), rnd(p.c[2] + d[2])];
}

export const centerOf = b => [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
