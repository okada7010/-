// Code.gs を Node 上の簡易スプレッドシートで動かして確認する。
// 実行： node anken/test/code.test.js
// （Google の実環境の代わりなので、公開後の実機確認は別途必要）
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');
const assert = require('assert');

function makeSheet(name) {
  const data = [];
  const range = (row, col, rows, cols) => ({
    getDisplayValues: () => Array.from({ length: rows }, (_, r) =>
      Array.from({ length: cols }, (_, c) => String((data[row - 1 + r] || [])[col - 1 + c] ?? ''))),
    setValues(values) {
      values.forEach((line, r) => {
        const target = data[row - 1 + r] || (data[row - 1 + r] = []);
        line.forEach((v, c) => {
          assert.ok(!String(v).startsWith('='), '数式として解釈される値を書き込んでいる: ' + v);
          target[col - 1 + c] = String(v);
        });
      });
      for (let i = 0; i < data.length; i++) if (!data[i]) data[i] = [];
      return this;
    },
    setNumberFormat() { return this; },
    setFontWeight() { return this; }
  });
  return {
    data, name,
    getLastRow: () => data.length,
    getMaxRows: () => 1000,
    getRange: (row, col, rows = 1, cols = 1) => range(row, col, rows, cols),
    getDataRange() {
      const width = data.reduce((m, r) => Math.max(m, r.length), 0);
      return range(1, 1, data.length, width);
    },
    setFrozenRows() {},
    deleteRow(row) { data.splice(row - 1, 1); }
  };
}

function makeEnv() {
  const sheets = {};
  const props = {};
  let uuid = 0;
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = makeSheet(n))
  };
  const env = {
    SpreadsheetApp: {
      getActive: () => ss, flush() {},
      getUi() { throw new Error('no ui'); }
    },
    PropertiesService: { getScriptProperties: () => ({
      getProperty: (k) => (k in props ? props[k] : null),
      setProperty: (k, v) => { props[k] = v; }
    }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    Utilities: {
      DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (alg, s) => Array.from(crypto.createHash('sha256').update(s, 'utf8').digest())
        .map((b) => (b > 127 ? b - 256 : b)),
      getUuid: () => crypto.createHash('md5').update(String(++uuid)).digest('hex'),
      formatDate: () => '2026-11-24 10:00:00',
      sleep() {}
    },
    HtmlService: {}
  };
  vm.createContext(env);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8'), env);
  env.sheets = sheets;
  env.props = props;
  return env;
}

function setPassword(env, pw) {
  env.props.PW_SALT = 'salt';
  env.props.PW_HASH = env.sha256_('salt|' + pw);
}

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

function ready() {
  const env = makeEnv();
  env.setup();
  env.sheets['利用者'].data.push(['担当A', 'TRUE'], ['担当B', 'TRUE'], ['退職者', 'FALSE']);
  setPassword(env, 'correct-horse');
  const token = env.apiLogin('correct-horse').token;
  return { env, token };
}

test('初期設定でシートと既定の状態ができ、二度実行してもデータは増えない', () => {
  const env = makeEnv();
  env.setup();
  env.setup();
  assert.deepStrictEqual(Object.keys(env.sheets).sort(), ['タスク', '利用者', '案件', '状態'].sort());
  assert.strictEqual(env.sheets['状態'].data.length, 7);
  assert.strictEqual(env.sheets['案件'].data[0][0], '案件ID');
});

test('パスワード未設定・誤りではログインできず、正しければ有効な利用者だけ返る', () => {
  const env = makeEnv();
  env.setup();
  assert.throws(() => env.apiLogin('x'), /未設定/);
  setPassword(env, 'correct-horse');
  assert.throws(() => env.apiLogin('wrong'), /パスワードが違います/);
  env.sheets['利用者'].data.push(['担当A', 'TRUE'], ['退職者', 'FALSE']);
  const res = env.apiLogin('correct-horse');
  assert.deepStrictEqual(Array.from(res.users), ['担当A']);
});

test('トークンがない・改ざん・期限切れは拒否する', () => {
  const { env, token } = ready();
  assert.throws(() => env.apiLoad(''), /AUTH/);
  assert.throws(() => env.apiLoad(token.replace(/.$/, (c) => (c === '0' ? '1' : '0'))), /AUTH/);
  const old = '1000';
  assert.throws(() => env.apiLoad(old + '.' + env.sha256_(env.props.TOKEN_SECRET + '|' + old)), /AUTH/);
  const far = String(Date.now() + 9e12);
  assert.throws(() => env.apiLoad(far + '.' + token.split('.')[1]), /AUTH/);
  assert.ok(env.apiLoad(token).statuses.length === 6);
});

test('利用者一覧にない名前・無効な名前では書き込めない', () => {
  const { env, token } = ready();
  assert.throws(() => env.apiSaveProject(token, '部外者', { name: 'x' }), /利用者が見つかりません/);
  assert.throws(() => env.apiSaveProject(token, '退職者', { name: 'x' }), /利用者が見つかりません/);
  assert.strictEqual(env.sheets['案件'].data.length, 1);
});

test('案件の登録・更新：連番ID、状態の検証、更新者の記録', () => {
  const { env, token } = ready();
  let d = env.apiSaveProject(token, '担当A', { name: ' 案件1 ', customer: '顧客', status: '見積', due: '2026-12-01', priority: '高' });
  assert.strictEqual(d.projectId, 'P-0001');
  d = env.apiSaveProject(token, '担当B', { name: '案件2', status: '存在しない', due: '12/1', priority: '?' });
  assert.strictEqual(d.projectId, 'P-0002');
  const p2 = d.projects.find((p) => p.id === 'P-0002');
  assert.strictEqual(p2.status, '引合い');
  assert.strictEqual(p2.due, '');
  assert.strictEqual(p2.priority, '中');
  assert.throws(() => env.apiSaveProject(token, '担当A', { name: '  ' }), /案件名/);
  d = env.apiSaveProject(token, '担当B', { id: 'P-0001', name: '案件1改', status: '受注' });
  const p1 = d.projects.find((p) => p.id === 'P-0001');
  assert.strictEqual(p1.name, '案件1改');
  assert.strictEqual(p1.status, '受注');
  assert.strictEqual(p1.updatedBy, '担当B');
  assert.strictEqual(d.projects.length, 2);
  assert.throws(() => env.apiSaveProject(token, '担当A', { id: 'P-9999', name: 'x' }), /見つかりません/);
});

test('「=」で始まる入力は数式にならない', () => {
  const { env, token } = ready();
  const d = env.apiSaveProject(token, '担当A', { name: '=HYPERLINK("x")', note: '=1+1' });
  assert.strictEqual(d.projects[0].name, '＝HYPERLINK("x")');
});

test('案件の移動：列の変更と、指定したカードの前への並べ替え', () => {
  const { env, token } = ready();
  ['a', 'b', 'c'].forEach((n) => env.apiSaveProject(token, '担当A', { name: n, status: '見積' }));
  env.apiSaveProject(token, '担当A', { name: 'd', status: '引合い' });
  const order = (d, s) => d.projects.filter((p) => p.status === s).sort((x, y) => x.order - y.order).map((p) => p.name).join('');
  let d = env.apiMoveProject(token, '担当A', 'P-0004', '見積', 'P-0002');
  assert.strictEqual(order(d, '見積'), 'adbc');
  assert.strictEqual(order(d, '引合い'), '');
  d = env.apiMoveProject(token, '担当A', 'P-0001', '見積', '');
  assert.strictEqual(order(d, '見積'), 'dbca');
  d = env.apiMoveProject(token, '担当A', 'P-0003', '完了', '');
  assert.strictEqual(order(d, '見積'), 'dba');
  assert.strictEqual(order(d, '完了'), 'c');
  assert.throws(() => env.apiMoveProject(token, '担当A', 'P-0001', 'なし', ''), /状態/);
});

test('タスクの追加・完了・削除と、一部の項目だけの更新', () => {
  const { env, token } = ready();
  env.apiSaveProject(token, '担当A', { name: '案件' });
  let d = env.apiSaveTask(token, '担当A', { projectId: 'P-0001', name: '調査', owner: '担当B', due: '2026-12-10' });
  d = env.apiSaveTask(token, '担当A', { projectId: 'P-0001', name: '手配' });
  assert.strictEqual(d.tasks.length, 2);
  assert.deepStrictEqual(Array.from(d.tasks.map((t) => t.order)), [1, 2]);
  const id = d.tasks[0].id;
  d = env.apiSaveTask(token, '担当B', { id, done: true });
  const t = d.tasks.find((x) => x.id === id);
  assert.strictEqual(t.done, true);
  assert.strictEqual(t.name, '調査');
  assert.strictEqual(t.owner, '担当B');
  assert.strictEqual(t.due, '2026-12-10');
  assert.throws(() => env.apiSaveTask(token, '担当A', { projectId: 'P-0001', name: '' }), /タスク名/);
  assert.throws(() => env.apiSaveTask(token, '担当A', { projectId: 'P-9999', name: 'x' }), /案件が見つかりません/);
  d = env.apiDeleteTask(token, '担当A', id);
  assert.deepStrictEqual(Array.from(d.tasks.map((x) => x.name)), ["手配"]);
});

test('アーカイブした案件とそのタスクは画面に出ないが、行は残る', () => {
  const { env, token } = ready();
  env.apiSaveProject(token, '担当A', { name: '案件' });
  env.apiSaveTask(token, '担当A', { projectId: 'P-0001', name: '調査' });
  const d = env.apiArchiveProject(token, '担当A', 'P-0001');
  assert.strictEqual(d.projects.length, 0);
  assert.strictEqual(d.tasks.length, 0);
  assert.strictEqual(env.sheets['案件'].data.length, 2);
  assert.strictEqual(env.apiSaveProject(token, '担当A', { name: '次' }).projectId, 'P-0002');
});

test('シートの列順を入れ替えても、見出し名で読み書きできる', () => {
  const { env, token } = ready();
  const sh = env.sheets['案件'];
  sh.data[0].reverse();
  const d = env.apiSaveProject(token, '担当A', { name: '案件', customer: '顧客' });
  assert.strictEqual(d.projects[0].customer, '顧客');
  assert.strictEqual(sh.data[1][sh.data[0].indexOf('案件名')], '案件');
});

let failed = 0;
for (const [name, fn] of tests) {
  try { fn(); console.log('ok   ' + name); } catch (e) { failed++; console.log('FAIL ' + name + '\n     ' + e.message); }
}
console.log(failed ? failed + ' 件失敗' : tests.length + ' 件すべて成功');
process.exit(failed ? 1 : 0);
