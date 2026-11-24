/**
 * 案件管理ボード（Google Apps Script ＋ スプレッドシート）
 *
 * スプレッドシートの「拡張機能」→「Apps Script」に、このファイル（Code.gs）と
 * Index.html を貼り付けて使います。手順は README.md を参照してください。
 *
 * パスワードはコードにもシートにも書きません。
 * スプレッドシートのメニュー「案件管理」→「共通パスワードを設定」から設定します
 * （スクリプト プロパティにソルト付きハッシュで保存されます）。
 */

var TZ = 'Asia/Tokyo';
var TOKEN_DAYS = 30;
var DEFAULT_STATUSES = ['引合い', '見積', '受注', '設計・手配', '施工中', '完了'];
var PRIORITIES = ['高', '中', '低'];

var DEF = {
  projects: {
    sheet: '案件',
    fields: [
      ['id', '案件ID'], ['name', '案件名'], ['customer', '顧客'], ['code', '管理番号'],
      ['status', '状態'], ['owner', '担当者'], ['start', '開始日'], ['due', '納期'],
      ['priority', '優先度'], ['note', '備考'], ['order', '並び順'], ['archived', 'アーカイブ'],
      ['updatedAt', '更新日時'], ['updatedBy', '更新者']
    ]
  },
  tasks: {
    sheet: 'タスク',
    fields: [
      ['id', 'タスクID'], ['projectId', '案件ID'], ['name', 'タスク名'], ['owner', '担当者'],
      ['due', '期限'], ['done', '完了'], ['order', '並び順'],
      ['updatedAt', '更新日時'], ['updatedBy', '更新者']
    ]
  },
  statuses: { sheet: '状態', fields: [['name', '状態名'], ['order', '並び順']] },
  users: { sheet: '利用者', fields: [['name', '名前'], ['active', '有効']] }
};

/* ---------- 画面・メニュー ---------- */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('案件管理ボード')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function onOpen() {
  SpreadsheetApp.getUi().createMenu('案件管理')
    .addItem('初期設定（シートを作成）', 'setup')
    .addItem('共通パスワードを設定', 'setPassword')
    .addToUi();
}

/** シートと見出しを作る。既にあるシート・データには手を加えない。 */
function setup() {
  var ss = SpreadsheetApp.getActive();
  Object.keys(DEF).forEach(function (key) {
    var def = DEF[key];
    var sh = ss.getSheetByName(def.sheet);
    if (!sh) sh = ss.insertSheet(def.sheet);
    if (sh.getLastRow() === 0) {
      var headers = def.fields.map(function (f) { return f[1]; });
      sh.getRange(1, 1, sh.getMaxRows(), headers.length).setNumberFormat('@');
      sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
      sh.setFrozenRows(1);
      if (key === 'statuses') {
        var rows = DEFAULT_STATUSES.map(function (s, i) { return [s, String(i + 1)]; });
        sh.getRange(2, 1, rows.length, 2).setValues(rows);
      }
    }
  });
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('TOKEN_SECRET')) {
    props.setProperty('TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid());
  }
  try {
    SpreadsheetApp.getUi().alert('初期設定が完了しました。\n「利用者」シートに名前（有効＝TRUE）を登録し、共通パスワードを設定してください。');
  } catch (e) { /* エディタから実行したときは画面がない */ }
}

function setPassword() {
  var ui = SpreadsheetApp.getUi();
  var res = ui.prompt('共通パスワードを設定', '8文字以上で入力してください。', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  var pw = String(res.getResponseText() || '').trim();
  if (pw.length < 8) { ui.alert('8文字以上で入力してください。設定は変更されていません。'); return; }
  var salt = Utilities.getUuid();
  var props = PropertiesService.getScriptProperties();
  props.setProperty('PW_SALT', salt);
  props.setProperty('PW_HASH', sha256_(salt + '|' + pw));
  // パスワードを変えたら、発行済みのログイン状態も無効にする
  props.setProperty('TOKEN_SECRET', Utilities.getUuid() + Utilities.getUuid());
  ui.alert('共通パスワードを設定しました。利用者は再ログインが必要です。');
}

/* ---------- 画面から呼ぶ関数 ---------- */

function apiLogin(password) {
  var props = PropertiesService.getScriptProperties();
  var salt = props.getProperty('PW_SALT');
  var hash = props.getProperty('PW_HASH');
  if (!salt || !hash) throw new Error('共通パスワードが未設定です。管理者に連絡してください。');
  if (sha256_(salt + '|' + String(password || '')) !== hash) {
    Utilities.sleep(1500);
    throw new Error('パスワードが違います。');
  }
  var exp = String(Date.now() + TOKEN_DAYS * 24 * 60 * 60 * 1000);
  return { token: exp + '.' + sha256_(tokenSecret_() + '|' + exp), users: activeUsers_() };
}

function apiLoad(token) {
  checkToken_(token);
  return load_();
}

function apiSaveProject(token, user, p) {
  return write_(token, user, function (ctx) {
    p = p || {};
    var name = text_(p.name, 100);
    if (!name) throw new Error('案件名を入力してください。');
    var statuses = statusNames_();
    var t = table_(DEF.projects);
    var row = p.id ? find_(t, p.id) : null;
    if (p.id && !row) throw new Error('案件が見つかりません。他の人が変更した可能性があります。');
    var status = statuses.indexOf(p.status) >= 0 ? p.status : (row ? row.status : statuses[0]);
    var obj = {
      name: name,
      customer: text_(p.customer, 100),
      code: text_(p.code, 50),
      status: status,
      owner: text_(p.owner, 50),
      start: date_(p.start),
      due: date_(p.due),
      priority: PRIORITIES.indexOf(p.priority) >= 0 ? p.priority : '中',
      note: text_(p.note, 2000),
      updatedAt: ctx.now,
      updatedBy: ctx.user
    };
    if (row) {
      if (row.status !== status) obj.order = String(maxOrder_(t.rows, status) + 1);
      writeRow_(t, row._row, obj);
    } else {
      obj.id = nextProjectId_(t.rows);
      obj.order = String(maxOrder_(t.rows, status) + 1);
      obj.archived = 'FALSE';
      writeRow_(t, t.sheet.getLastRow() + 1, obj);
      ctx.result.projectId = obj.id;
    }
  });
}

/** 案件を別の状態（列）へ移す／列の中で並べ替える。beforeId の前に入れる（空なら末尾）。 */
function apiMoveProject(token, user, id, status, beforeId) {
  return write_(token, user, function (ctx) {
    if (statusNames_().indexOf(status) < 0) throw new Error('状態が見つかりません。画面を更新してください。');
    var t = table_(DEF.projects);
    var row = find_(t, id);
    if (!row) throw new Error('案件が見つかりません。他の人が変更した可能性があります。');
    var list = t.rows.filter(function (r) { return r.status === status && !bool_(r.archived) && r.id !== id; })
      .sort(byOrder_);
    var at = list.length;
    for (var i = 0; i < list.length; i++) if (list[i].id === beforeId) { at = i; break; }
    list.splice(at, 0, row);
    list.forEach(function (r, i) {
      var order = String(i + 1);
      if (r === row) {
        writeRow_(t, r._row, { status: status, order: order, updatedAt: ctx.now, updatedBy: ctx.user });
      } else if (r.order !== order) {
        writeRow_(t, r._row, { order: order });
      }
    });
  });
}

/** 案件をボードから外す（行は消さない。戻すときはシートの「アーカイブ」を FALSE にする）。 */
function apiArchiveProject(token, user, id) {
  return write_(token, user, function (ctx) {
    var t = table_(DEF.projects);
    var row = find_(t, id);
    if (!row) throw new Error('案件が見つかりません。');
    writeRow_(t, row._row, { archived: 'TRUE', updatedAt: ctx.now, updatedBy: ctx.user });
  });
}

function apiSaveTask(token, user, task) {
  return write_(token, user, function (ctx) {
    task = task || {};
    var t = table_(DEF.tasks);
    var row = task.id ? find_(t, task.id) : null;
    if (task.id && !row) throw new Error('タスクが見つかりません。他の人が変更した可能性があります。');
    var obj = { updatedAt: ctx.now, updatedBy: ctx.user };
    if (!row || task.name !== undefined) {
      obj.name = text_(task.name, 200);
      if (!obj.name) throw new Error('タスク名を入力してください。');
    }
    if (!row || task.owner !== undefined) obj.owner = text_(task.owner, 50);
    if (!row || task.due !== undefined) obj.due = date_(task.due);
    if (!row || task.done !== undefined) obj.done = task.done ? 'TRUE' : 'FALSE';
    if (row) {
      writeRow_(t, row._row, obj);
    } else {
      var p = find_(table_(DEF.projects), task.projectId);
      if (!p) throw new Error('案件が見つかりません。');
      obj.id = 'T' + Utilities.getUuid().replace(/-/g, '').slice(0, 10);
      obj.projectId = p.id;
      obj.order = String(maxOrder_(t.rows.filter(function (r) { return r.projectId === p.id; })) + 1);
      writeRow_(t, t.sheet.getLastRow() + 1, obj);
    }
  });
}

function apiDeleteTask(token, user, id) {
  return write_(token, user, function () {
    var t = table_(DEF.tasks);
    var row = find_(t, id);
    if (row) t.sheet.deleteRow(row._row);
  });
}

/* ---------- 内部処理 ---------- */

/** 認証 → ロック → 書き込み → 最新データを返す、の共通の流れ。 */
function write_(token, user, fn) {
  checkToken_(token);
  var name = String(user || '').trim();
  if (activeUsers_().indexOf(name) < 0) throw new Error('利用者が見つかりません。名前を選び直してください。');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var ctx = { user: name, now: Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm:ss'), result: {} };
    fn(ctx);
    SpreadsheetApp.flush();
    var data = load_();
    Object.keys(ctx.result).forEach(function (k) { data[k] = ctx.result[k]; });
    return data;
  } finally {
    lock.releaseLock();
  }
}

function load_() {
  var statuses = statusNames_();
  var projects = table_(DEF.projects).rows
    .filter(function (r) { return r.id && !bool_(r.archived); })
    .map(function (r) {
      return {
        id: r.id, name: r.name, customer: r.customer, code: r.code,
        // シートを手で直して存在しない状態になった案件は、先頭の列に出す
        status: statuses.indexOf(r.status) >= 0 ? r.status : statuses[0],
        owner: r.owner, start: r.start, due: r.due, priority: r.priority || '中', note: r.note,
        order: Number(r.order) || 0, updatedAt: r.updatedAt, updatedBy: r.updatedBy
      };
    });
  var ids = {};
  projects.forEach(function (p) { ids[p.id] = true; });
  var tasks = table_(DEF.tasks).rows
    .filter(function (r) { return r.id && ids[r.projectId]; })
    .map(function (r) {
      return {
        id: r.id, projectId: r.projectId, name: r.name, owner: r.owner, due: r.due,
        done: bool_(r.done), order: Number(r.order) || 0
      };
    });
  return { statuses: statuses, projects: projects, tasks: tasks, users: activeUsers_() };
}

function statusNames_() {
  var names = table_(DEF.statuses).rows
    .filter(function (r) { return r.name; })
    .sort(byOrder_)
    .map(function (r) { return r.name; });
  return names.length ? names : DEFAULT_STATUSES.slice();
}

function activeUsers_() {
  return table_(DEF.users).rows
    .filter(function (r) { return r.name && bool_(r.active); })
    .map(function (r) { return r.name; });
}

/** シートを「見出し名 → 項目」の対応で読む（列の順番を入れ替えられても動く）。 */
function table_(def) {
  var sh = SpreadsheetApp.getActive().getSheetByName(def.sheet);
  if (!sh) throw new Error('シート「' + def.sheet + '」がありません。メニュー「案件管理」→「初期設定」を実行してください。');
  var values = sh.getDataRange().getDisplayValues();
  var headers = values.length ? values[0] : [];
  var keyOf = {};
  def.fields.forEach(function (f) { keyOf[f[1]] = f[0]; });
  var cols = headers.map(function (h) { return keyOf[String(h).trim()] || null; });
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var o = { _row: i + 1 };
    def.fields.forEach(function (f) { o[f[0]] = ''; });
    for (var c = 0; c < cols.length; c++) if (cols[c]) o[cols[c]] = String(values[i][c]).trim();
    rows.push(o);
  }
  return { sheet: sh, cols: cols, rows: rows, width: headers.length };
}

function find_(t, id) {
  id = String(id || '');
  if (!id) return null;
  for (var i = 0; i < t.rows.length; i++) if (t.rows[i].id === id) return t.rows[i];
  return null;
}

/** obj にある項目だけを書き換える（ほかの列はそのまま）。 */
function writeRow_(t, rowNum, obj) {
  var sh = t.sheet;
  var range = sh.getRange(rowNum, 1, 1, t.width);
  var current = rowNum <= sh.getLastRow() ? range.getDisplayValues()[0] : [];
  var out = [];
  for (var c = 0; c < t.width; c++) {
    var key = t.cols[c];
    var v = key && obj[key] !== undefined ? obj[key] : (current[c] !== undefined ? current[c] : '');
    out.push(safe_(v));
  }
  range.setNumberFormat('@').setValues([out]);
}

function nextProjectId_(rows) {
  var max = 0;
  rows.forEach(function (r) {
    var m = /^P-(\d+)$/.exec(r.id);
    if (m) max = Math.max(max, Number(m[1]));
  });
  return 'P-' + ('0000' + (max + 1)).slice(-4);
}

function maxOrder_(rows, status) {
  var max = 0;
  rows.forEach(function (r) {
    if (status !== undefined && r.status !== status) return;
    max = Math.max(max, Number(r.order) || 0);
  });
  return max;
}

function byOrder_(a, b) { return (Number(a.order) || 0) - (Number(b.order) || 0); }

function bool_(v) { return String(v).toUpperCase() === 'TRUE'; }

function text_(v, max) { return String(v === undefined || v === null ? '' : v).trim().slice(0, max); }

function date_(v) {
  v = String(v || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '';
}

/** 先頭が「=」の文字列は数式として扱われてしまうため、全角に置き換える。 */
function safe_(v) {
  v = String(v);
  return v.charAt(0) === '=' ? '＝' + v.slice(1) : v;
}

function tokenSecret_() {
  var s = PropertiesService.getScriptProperties().getProperty('TOKEN_SECRET');
  if (!s) throw new Error('初期設定が未実施です。メニュー「案件管理」→「初期設定」を実行してください。');
  return s;
}

function checkToken_(token) {
  var parts = String(token || '').split('.');
  var ok = parts.length === 2 && /^\d+$/.test(parts[0]) && Number(parts[0]) > Date.now() &&
    sha256_(tokenSecret_() + '|' + parts[0]) === parts[1];
  if (!ok) throw new Error('AUTH: ログインの有効期限が切れました。もう一度ログインしてください。');
}

function sha256_(s) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, s, Utilities.Charset.UTF_8);
  return bytes.map(function (b) { return ('0' + ((b + 256) % 256).toString(16)).slice(-2); }).join('');
}
