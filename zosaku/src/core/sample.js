// はじめて開いたときに表示するサンプル（3640×2730 の小部屋）
import { newDoc, addPart, newGroupId, newSubId, wallFromPoints } from './model.js';
import { frameWall } from './framing.js';
import { makeCabinet, makeCounter } from './cabinet.js';
import { translateParts } from './geom.js';

export function buildSample() {
  const doc = newDoc();
  doc.name = 'サンプル_小部屋';
  addPart(doc, { kind: 'slab', name: '床', mat: 'floor', c: [1820, 1365, -15], s: [3640, 2730, 30] });

  // 西の壁（仕上げた壁。ドア付き）
  addPart(doc, {
    kind: 'wall', name: '間仕切壁', mat: 'wall', ...wallFromPoints([0, 2795], [0, 0], 90, 2400, 0),
    openings: [{ id: newSubId(doc, 'o'), type: 'door', name: '片開きドア', x: 1500, w: 800, h: 2000, sill: 0 }]
  });

  // 北の壁（下地に展開した状態。室内側から下地が見えるよう、ボードは外側の片面だけ）
  const north = {
    kind: 'wall', name: '間仕切壁', mat: 'wall', ...wallFromPoints([3640, 2730], [0, 2730], 130, 2400, 0),
    openings: [{ id: newSubId(doc, 'o'), type: 'window', name: '腰窓', x: 1100, w: 1650, h: 1100, sill: 900 }]
  };
  const g1 = newGroupId(doc);
  for (const p of frameWall(north, { studB: 30, studD: 105, pitch: 455, sides: 1, boardT: 12.5, boardW: 910, boardL: 2420 })) {
    addPart(doc, { ...p, g: g1 });
  }

  // 造作家具
  const inner = 2730 - 58.75; // 北の壁の室内側の面
  const cab = makeCabinet({ W: 900, D: 300, H: 1800, t: 18, shelves: 3, back: 4, kick: 60 });
  translateParts(cab, [3170, inner - 150, 0]);
  const g2 = newGroupId(doc);
  cab.forEach(p => addPart(doc, { ...p, g: g2 }));

  const counter = makeCounter({ W: 1800, D: 600, H: 850, top: 30, t: 30 });
  translateParts(counter, [1715, inner - 300, 0]);
  const g3 = newGroupId(doc);
  counter.forEach(p => addPart(doc, { ...p, g: g3 }));

  // 床に置いた材料
  for (let i = 0; i < 3; i++) {
    addPart(doc, { kind: 'panel', name: '合板 t12（3×6）', mat: 'plywood', c: [2500, 700, 6 + i * 12], s: [1820, 910, 12] });
  }
  for (let i = 0; i < 4; i++) {
    addPart(doc, { kind: 'lumber', name: '下地 30×40（野縁・胴縁）', mat: 'wood', c: [1000, 350 + i * 60, 15], s: [1820, 40, 30] });
  }

  doc.dims.push({ id: newSubId(doc, 'd'), a: [0, 0, 0], b: [3640, 0, 0] });
  doc.dims.push({ id: newSubId(doc, 'd'), a: [3640, 0, 0], b: [3640, 2730, 0] });
  return doc;
}
