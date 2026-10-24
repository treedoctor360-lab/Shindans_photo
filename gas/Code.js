// =============================================================
//  サーバー（Google Apps Script）
//  スプレッドシートに付いたスクリプトとして置き、ウェブアプリとして公開する。
//  手順は gas/README.md を参照。
//
//  受け付ける操作（すべて POST。本文は JSON の文字）
//    { action: 'ping' }                            … 合言葉の確認
//    { action: 'push', year, deviceId, records }   … 記録を保存する（版番号を確かめてから）
//    { action: 'pull', year, since }               … 通し番号 since より後に変わった記録を返す
//    { action: 'putFile', kind, name, base64 }     … 設定・原本・台帳・前回の調査のファイルを置く（事務所のPCから）
//    { action: 'getFile', kind }                   … 置いたファイルを取り出す（スマホから）
//  どの操作にも pass（合言葉）を付ける。合言葉はスクリプトのプロパティ PASSPHRASE に入れる。
//
//  記録（record）の種類
//    tree    … 木1本の入力内容（調査者が書く）
//    sticky  … 付箋（事務の質問・修正案と、調査者の返事）
//    confirm … 確定の印（事務が付ける）
//  記録ごとに版番号（rev）を持つ。送る側は「自分が最後に見た版（baseRev）」を付けて送り、
//  サーバーの版と違えば（＝他の人が先に変えていれば）上書きせずに断る（conflict）。
//  保存するたびに通し番号（seq）を振り、「前回から変わった記録だけ」を受け取れるようにする。
//  保存した記録は、履歴のシートにも1行ずつ足していく（いつ・誰が・何を）。
// =============================================================

var RECORD_SHEET = 'records';
var HISTORY_SHEET = 'history';
// 列：0 ID / 1 年度 / 2 種類 / 3 木のID / 4 版 / 5 通し番号 / 6 更新日時（端末） / 7 受信日時 / 8 端末 / 9 人 / 10 データ
var HEADER = ['ID', '年度', '種類', '木のID', '版', '通し番号', '更新日時', '受信日時', '端末', '人', 'データ'];
var HISTORY_HEADER = ['受信日時', 'ID', '種類', '木のID', '版', '人', '端末', 'データ'];
var KINDS = ['tree', 'initial', 'sticky', 'confirm']; // initial：詳しい診断（初期診断など）の入力内容
var FILE_KINDS = ['config', 'template', 'ledger', 'prevIndex', 'initialBook']; // initialBook：詳しい診断のデータ入力用ブック
// 前回の写真は場所ごとに1ファイル（prevPhotos:p1, prevPhotos:p2 …）
function isFileKind(kind) {
  return FILE_KINDS.indexOf(kind) >= 0 || /^prevPhotos:p[0-9]{1,4}$/.test(String(kind));
}

// ---------- 計算だけの部分（テストで Node から呼べるように、Google の機能を使わない） ----------

// 届いた記録を、保存してある行に当てはめる計画を立てる
//  rows：保存してある行（見出しを除く）
//  返す形：{ updates: [{ index, row }], appends: [row], history: [row], results: [...] }
//   results の1件：{ id, ok: true, rev, seq } または { id, conflict: true, rev, seq, by, updatedAt, data }
function planPush(rows, records, year, now, deviceId) {
  var byId = {};
  var maxSeq = 0;
  for (var i = 0; i < rows.length; i++) {
    byId[rows[i][0]] = i;
    maxSeq = Math.max(maxSeq, Number(rows[i][5]) || 0);
  }
  var out = { updates: [], appends: [], history: [], results: [] };
  var appendedAt = {};
  for (var k = 0; k < records.length; k++) {
    var r = records[k];
    if (!r || !r.id || KINDS.indexOf(r.kind) < 0) {
      out.results.push({ id: (r && r.id) || '', error: '記録の形が違います' });
      continue;
    }
    var idx = byId[r.id];
    var appendIdx = appendedAt[r.id];
    var cur = idx !== undefined ? rows[idx] : appendIdx !== undefined ? out.appends[appendIdx] : null;
    var curRev = cur ? Number(cur[4]) || 0 : 0;
    if ((Number(r.baseRev) || 0) !== curRev) {
      var data = null;
      try {
        data = cur ? JSON.parse(cur[10]) : null;
      } catch (e) {
        data = null;
      }
      out.results.push({ id: r.id, conflict: true, rev: curRev, seq: cur ? Number(cur[5]) || 0 : 0, by: cur ? cur[9] : '', updatedAt: cur ? cur[6] : '', data: data });
      continue;
    }
    var rev = curRev + 1;
    var seq = ++maxSeq;
    var row = [r.id, String(year), r.kind, r.treeId || '', rev, seq, r.updatedAt || '', now, deviceId || '', r.by || '', JSON.stringify(r.data)];
    if (idx !== undefined) {
      out.updates.push({ index: idx, row: row });
      rows[idx] = row; // 同じ送信の中で続けて同じ記録が来ても正しく比べられるように
    } else if (appendIdx !== undefined) {
      out.appends[appendIdx] = row;
    } else {
      appendedAt[r.id] = out.appends.length;
      out.appends.push(row);
    }
    out.history.push([now, r.id, r.kind, r.treeId || '', rev, r.by || '', deviceId || '', JSON.stringify(r.data)]);
    out.results.push({ id: r.id, ok: true, rev: rev, seq: seq });
  }
  return out;
}

// 通し番号 since より後に変わった、その年度の記録
function listSince(rows, year, since) {
  var out = [];
  var maxSeq = Number(since) || 0;
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (String(r[1]) !== String(year)) continue;
    var seq = Number(r[5]) || 0;
    if (seq <= (Number(since) || 0)) continue;
    var data = null;
    try {
      data = JSON.parse(r[10]);
    } catch (e) {
      continue; // 壊れた行は飛ばす
    }
    out.push({ id: r[0], kind: r[2], treeId: r[3], rev: Number(r[4]) || 0, seq: seq, updatedAt: r[6], by: r[9], data: data });
    maxSeq = Math.max(maxSeq, seq);
  }
  out.sort(function (a, b) {
    return a.seq - b.seq;
  });
  return { records: out, lastSeq: maxSeq };
}

// ---------- Google の機能を使う部分 ----------

function doPost(e) {
  var res;
  try {
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    res = handle(req);
  } catch (err) {
    res = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(res)).setMimeType(ContentService.MimeType.JSON);
}

// ブラウザで URL を開いたとき（動いているかの確認だけ。データは返さない）
function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, message: '動いています' })).setMimeType(ContentService.MimeType.JSON);
}

function handle(req) {
  var props = PropertiesService.getScriptProperties();
  var pass = props.getProperty('PASSPHRASE');
  if (!pass) return { ok: false, error: 'サーバーに合言葉（PASSPHRASE）が設定されていません' };
  if (req.pass !== pass) return { ok: false, error: '合言葉が違います' };

  if (req.action === 'ping') return { ok: true };
  if (req.action === 'pull') {
    if (!req.year) return { ok: false, error: '年度がありません' };
    var l = listSince(readRows(), req.year, req.since);
    return { ok: true, records: l.records, lastSeq: l.lastSeq };
  }
  if (req.action === 'push') return withLock(function () { return push(req); });
  if (req.action === 'putFile') return withLock(function () { return putFile(req, props); });
  if (req.action === 'getFile') return getFile(req, props);
  return { ok: false, error: '知らない操作です：' + req.action };
}

// 同時に書き込まないように順番待ちをする（最大30秒）
function withLock(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

// 保存先のスプレッドシート
//  スプレッドシートの「拡張機能 → Apps Script」から作ったスクリプトなら、そのスプレッドシート。
//  ウェブアプリとして呼ばれたときに見つからない場合に備えて、スクリプトのプロパティ SPREADSHEET_ID も見る。
//  どちらも無ければ、初回に新しいスプレッドシートを作らずに、分かる言葉で知らせる。
function spreadsheet() {
  var ss = null;
  try {
    ss = SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {
    ss = null;
  }
  if (ss) return ss;
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (id) return SpreadsheetApp.openById(id);
  throw new Error('保存先のスプレッドシートが分かりません。スクリプトのプロパティに SPREADSHEET_ID（スプレッドシートの URL の /d/ と /edit の間の文字）を追加してください');
}

// シートを取り出す（なければ見出しを付けて作る）
function sheetOf(name, header) {
  var ss = spreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, header.length).setValues([header]);
    sh.setFrozenRows(1);
    sh.getRange(1, 1, sh.getMaxRows(), header.length).setNumberFormat('@'); // すべて文字として保存（日付や数に勝手に変えられないように）
  }
  return sh;
}

function readRows() {
  var sh = sheetOf(RECORD_SHEET, HEADER);
  var n = sh.getLastRow() - 1;
  return n > 0 ? sh.getRange(2, 1, n, HEADER.length).getValues() : [];
}

function push(req) {
  if (!req.year) return { ok: false, error: '年度がありません' };
  var sh = sheetOf(RECORD_SHEET, HEADER);
  var rows = readRows();
  var plan = planPush(rows, req.records || [], req.year, new Date().toISOString(), req.deviceId);
  plan.updates.forEach(function (u) {
    sh.getRange(u.index + 2, 1, 1, HEADER.length).setValues([u.row]);
  });
  if (plan.appends.length) sh.getRange(sh.getLastRow() + 1, 1, plan.appends.length, HEADER.length).setValues(plan.appends);
  if (plan.history.length) {
    var hs = sheetOf(HISTORY_SHEET, HISTORY_HEADER);
    hs.getRange(hs.getLastRow() + 1, 1, plan.history.length, HISTORY_HEADER.length).setValues(plan.history);
  }
  return { ok: true, results: plan.results };
}

// ファイルはスプレッドシートと同じフォルダの中の「データ」フォルダに置く
function dataFolder(props) {
  var id = props.getProperty('FOLDER_ID');
  if (id) {
    try {
      return DriveApp.getFolderById(id);
    } catch (e) {
      // 消されていたら作り直す
    }
  }
  var ssFile = DriveApp.getFileById(spreadsheet().getId());
  var parents = ssFile.getParents();
  var parent = parents.hasNext() ? parents.next() : DriveApp.getRootFolder();
  var folder = parent.createFolder('データ');
  props.setProperty('FOLDER_ID', folder.getId());
  return folder;
}

function putFile(req, props) {
  if (!isFileKind(req.kind)) return { ok: false, error: 'ファイルの種類が違います' };
  var folder = dataFolder(props);
  var blob = Utilities.newBlob(Utilities.base64Decode(req.base64), 'application/octet-stream', req.name);
  var file = folder.createFile(blob);
  var oldId = props.getProperty('FILE_' + req.kind);
  props.setProperty('FILE_' + req.kind, file.getId());
  props.setProperty('NAME_' + req.kind, req.name);
  if (oldId) {
    try {
      DriveApp.getFileById(oldId).setTrashed(true); // 前のファイルはゴミ箱へ（30日は戻せる）
    } catch (e) {
      // 既に無ければそのまま
    }
  }
  return { ok: true, updated: file.getLastUpdated().toISOString() };
}

function getFile(req, props) {
  if (!isFileKind(req.kind)) return { ok: false, error: 'ファイルの種類が違います' };
  var id = props.getProperty('FILE_' + req.kind);
  if (!id) return { ok: true, file: null };
  var file = DriveApp.getFileById(id);
  return {
    ok: true,
    file: {
      name: props.getProperty('NAME_' + req.kind) || file.getName(),
      updated: file.getLastUpdated().toISOString(),
      base64: Utilities.base64Encode(file.getBlob().getBytes()),
    },
  };
}

// テスト（Node）から計算部分を読めるようにする。Google の上では module が無いので何もしない
if (typeof module !== 'undefined') module.exports = { planPush: planPush, listSince: listSince, isFileKind: isFileKind };
