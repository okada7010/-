// 画面を実際に操作して確かめる。実行： npm run build && NODE_PATH=$(npm root -g) node test/e2e.mjs [画像の出力先]
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
const { chromium } = createRequire(import.meta.url)('playwright');
const here = dirname(fileURLToPath(import.meta.url));
const out = process.argv[2] || null;
const url = 'file://' + join(here, '..', 'index.html');

const browser = await chromium.launch({ args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 860 }, deviceScaleFactor: 1, acceptDownloads: true });
const page = await ctx.newPage();
const errors = [];
page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
page.on('pageerror', e => errors.push('pageerror: ' + e.message));
let n = 0;
const shot = async name => { if (out) await page.screenshot({ path: join(out, `${String(++n).padStart(2, '0')}_${name}.png`) }); };
const st = fn => page.evaluate(fn);
// 図面の座標 → 画面の座標
const scr = p => page.evaluate(p => {
  const v = window.__zosaku.view, r = v.dom.getBoundingClientRect(), s = v.project(p);
  return { x: r.left + s.x, y: r.top + s.y };
}, p);
const clickAt = async (p, opt) => { const s = await scr(p); await page.mouse.move(s.x, s.y); await page.mouse.click(s.x, s.y, opt); };
const ok = msg => console.log('  ok  ' + msg);

await page.goto(url);
await page.waitForFunction(() => window.__zosaku);
await page.waitForTimeout(500);
const start = await st(() => window.__zosaku.S.doc.parts.length);
assert.equal(start, 51);
ok('起動するとサンプル（部材51）が開く');
await shot('start');

// 選択
const ply = await st(() => { const p = window.__zosaku.S.doc.parts.filter(p => p.name.startsWith('合板')).pop(); return { id: p.id, c: p.c }; });
await clickAt([ply.c[0], ply.c[1], ply.c[2] + 6]);
assert.deepEqual(await st(() => [...window.__zosaku.S.sel]), [ply.id]);
assert.match(await page.textContent('#pane-props'), /板材/);
ok('クリックで部材を選び、プロパティが出る');

// ドラッグ移動 → 元に戻す
const s0 = await scr([ply.c[0], ply.c[1], ply.c[2] + 6]);
await page.mouse.move(s0.x, s0.y); await page.mouse.down();
await page.mouse.move(s0.x + 60, s0.y + 10, { steps: 5 }); await page.mouse.up();
const moved = await st(() => window.__zosaku.S.doc.parts.find(p => [...window.__zosaku.S.sel][0] === p.id).c);
assert.ok(Math.hypot(moved[0] - ply.c[0], moved[1] - ply.c[1]) > 50, 'ドラッグで動く');
assert.equal(moved[2], ply.c[2]);
ok(`ドラッグで水平に移動（高さは変わらない）: ${ply.c} → ${moved}`);
await page.keyboard.press('Control+z');
assert.deepEqual(await st(() => window.__zosaku.S.doc.parts.find(p => p.name.startsWith('合板') && p.c[2] > 25).c), ply.c);
ok('Ctrl+Z で元の位置に戻る');

// Shift＋ドラッグで上下
await clickAt([ply.c[0], ply.c[1], ply.c[2] + 6]);
const s1 = await scr([ply.c[0], ply.c[1], ply.c[2] + 6]);
await page.keyboard.down('Shift');
await page.mouse.move(s1.x, s1.y); await page.mouse.down();
await page.mouse.move(s1.x, s1.y - 80, { steps: 5 }); await page.mouse.up();
await page.keyboard.up('Shift');
const up = await st(() => window.__zosaku.S.doc.parts.find(p => [...window.__zosaku.S.sel][0] === p.id).c);
assert.equal(up[0], ply.c[0]); assert.equal(up[1], ply.c[1]); assert.ok(up[2] > ply.c[2] + 100);
ok(`Shift＋ドラッグで上下だけ動く: Z ${ply.c[2]} → ${up[2]}`);
await page.keyboard.press('Control+z');

// 数値入力で寸法を変える（左手前下の角は動かない）
await clickAt([ply.c[0], ply.c[1], ply.c[2] + 6]);
await page.fill('#pane-props [data-f=s0]', '1000');
await page.press('#pane-props [data-f=s0]', 'Tab');
await page.waitForFunction(() => { const z = window.__zosaku; const p = z.S.doc.parts.find(p => z.S.sel.has(p.id)); return p && p.s[0] === 1000; });
assert.equal(await st(() => document.activeElement.dataset.f), 's1', 'Tabで次の欄（幅）にカーソルが移る');
await page.keyboard.press('Escape');
const resized = await st(() => window.__zosaku.S.doc.parts.find(p => [...window.__zosaku.S.sel][0] === p.id));
assert.equal(resized.s[0], 1000);
assert.equal(resized.c[0] - 500, ply.c[0] - 910);
ok('プロパティで長さを変えると、端の位置を保って伸縮する');
await page.keyboard.press('Control+z');

// ライブラリから置く
await page.click('#lib .item:has-text("柱 105角")');
await clickAt([1800, 1300, 0]);
const post = await st(() => { const z = window.__zosaku; const p = z.S.doc.parts.find(p => z.S.sel.has(p.id)); return { n: z.S.doc.parts.length, p }; });
assert.equal(post.n, start + 1);
assert.equal(post.p.name, '柱 105角');
assert.ok(Math.abs(post.p.c[2] - 1350) < 0.01, `柱は床の上に立つ（中心高さ ${post.p.c[2]}）`);
ok('ライブラリの柱を床の上に置ける');
await shot('placed');

// 壁を描く（刻み100mm）
await page.selectOption('#gridSel', '100');
await page.keyboard.press('w');
await page.waitForTimeout(150);
await clickAt([500, -1500, 0]);
await clickAt([2500, -1500, 0]);
const far = await scr([2500, -600, 0]);
await page.mouse.move(far.x, far.y);
await page.keyboard.type('1500');
await page.keyboard.press('Enter');
await page.keyboard.press('Escape');
await page.keyboard.press('Escape');
const walls = await st(() => window.__zosaku.S.doc.parts.filter(p => p.kind === 'wall' && p.name === '壁').map(p => ({ id: p.id, s: p.s, c: p.c, r: p.r })));
assert.equal(walls.length, 2);
assert.deepEqual(walls[0].s, [2000, 90, 2400]);
assert.deepEqual(walls[1].s, [1545, 90, 2400], '角は相手の厚さの半分だけ伸ばす');
assert.equal(walls[1].r[2], 90);
ok('壁を2点クリックと、長さの数字入力で描ける（角の取り合いも処理）');
assert.equal(await st(() => window.__zosaku.S.tool), 'select');

// 開口を入れる
await page.click('#lib .item:has-text("片開きドア")');
await clickAt([1500, -1545, 1200]);
const wall = await st(() => window.__zosaku.S.doc.parts.find(p => p.kind === 'wall' && p.name === '壁'));
assert.equal(wall.openings.length, 1);
assert.equal(wall.openings[0].w, 800);
ok(`壁をクリックしてドアを入れられる（位置 ${wall.openings[0].x}）`);
await shot('wall_door');

// 下地に展開
await page.click('#pane-props [data-pa=frame]');
await page.click('#dlgFoot button.primary');
await page.waitForFunction(() => window.__zosaku.S.doc.parts.some(p => p.name === 'まぐさ' && window.__zosaku.S.sel.has(p.id)));
const framed = await st(() => { const z = window.__zosaku; return { walls: z.S.doc.parts.filter(p => p.kind === 'wall' && p.name === '壁').length, names: [...new Set(z.S.doc.parts.filter(p => z.S.sel.has(p.id)).map(p => p.name))] }; });
assert.equal(framed.walls, 1);
for (const nm of ['上枠', '下枠', '間柱', 'まぐさ', '片開きドア']) assert.ok(framed.names.includes(nm), nm + ' がある');
ok('壁を下地に展開できる: ' + framed.names.join('・'));
await page.keyboard.press('Escape');
await shot('framed');

// 部材表
await page.click('[data-act=cutlist]');
const cl = await page.textContent('#clTables');
assert.match(cl, /角材/); assert.match(cl, /間柱/); assert.match(cl, /定尺の必要本数/); assert.match(cl, /建具/);
await shot('cutlist');
const dl = page.waitForEvent('download');
await page.click('#dlgFoot button:has-text("CSV")');
const csvPath = await (await dl).path();
const csv = readFileSync(csvPath, 'utf8');
assert.equal(csv.charCodeAt(0), 0xFEFF);
assert.match(csv, /【角材】/);
ok('部材表を表示し、CSVで保存できる');
await page.click('#dlgFoot button.primary');

// 寸法
await page.keyboard.press('m');
await clickAt([0, 0, 0]);
await clickAt([0, 2730, 0]);
await page.keyboard.press('Escape');
const dims = await st(() => window.__zosaku.S.doc.dims.length);
assert.equal(dims, 3);
ok('2点クリックで寸法線が残る');

// 視点
await page.keyboard.press('2');
assert.equal(await st(() => window.__zosaku.view.isOrtho), true);
await page.waitForTimeout(200);
await shot('plan');
await page.keyboard.press('3'); await page.waitForTimeout(200); await shot('front');
await page.keyboard.press('1'); await page.waitForTimeout(200);
assert.equal(await st(() => window.__zosaku.view.isOrtho), false);
ok('平面・正面・立体の切替');

// 断面
await page.click('#btnClip'); await page.waitForTimeout(200); await shot('clip'); await page.click('#btnClip');

// 配列・回転・グループ
await page.click('#lib .item:has-text("間柱 30×105")');
await clickAt([600, 600, 0]);
await page.click('[data-act=array]');
await page.click('#dlgFoot button.primary');
await page.waitForFunction(() => window.__zosaku.S.sel.size === 4);
assert.equal(await st(() => window.__zosaku.S.sel.size), 4);
await page.keyboard.press('Control+g');
assert.equal(await st(() => { const z = window.__zosaku; return new Set(z.S.doc.parts.filter(p => z.S.sel.has(p.id)).map(p => p.g)).size; }), 1);
await page.keyboard.press('r');
ok('配列（455ピッチ×3）・グループ・回転');
await shot('array');

// 保存 → 読み直し
const dl2 = page.waitForEvent('download');
await page.click('[data-act=save]');
const saved = JSON.parse(readFileSync(await (await dl2).path(), 'utf8'));
const count = await st(() => window.__zosaku.S.doc.parts.length);
assert.equal(saved.parts.length, count);
assert.equal(saved.app, 'zosaku3dcad');
ok(`JSONで保存（部材 ${count}）`);
await page.waitForTimeout(900);
await page.reload();
await page.waitForFunction(() => window.__zosaku);
assert.equal(await st(() => window.__zosaku.S.doc.parts.length), count);
ok('開き直すと、自動保存から続きが開く');

// 画像・OBJ
const dl3 = page.waitForEvent('download');
await page.click('[data-act=png]');
assert.match((await dl3).suggestedFilename(), /\.png$/);
const dl4 = page.waitForEvent('download');
await page.click('[data-act=obj]');
const obj = readFileSync(await (await dl4).path(), 'utf8');
assert.ok(obj.includes('\nv ') && obj.includes('\nf '));
ok('画像とOBJを書き出せる');

await page.click('[data-act=help]'); await shot('help'); await page.click('#dlgFoot button.primary');

assert.deepEqual(errors, [], 'コンソールにエラーが出ていない');
ok('コンソールのエラーなし');
await browser.close();
console.log('e2e: すべて確認できました');
