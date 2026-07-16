/**
 * 飲食店GASへ追加する無人実行アダプター。
 * 既存の処理関数群と同じApps Scriptプロジェクトへ追加してください。
 * 既存コードのSERPAPI_KEY定数は削除し、必要箇所では
 * PropertiesService.getScriptProperties().getProperty('SERPAPI_KEY') を使用します。
 */

function executeAllProcessesHeadless(jobId) {
  importCSVFiles();
  executeNormalizeAndValidate();
  executeDuplicateCheck();
  executeChainCheck();
  executeFacilityCheck();
  executeWorkflowGrouping();
  executeSplitSheets();
  executeGenerateSalesGenreSheets();
  executeExportSalesGenreCsvFiles();
  var summary = executeCountSummary();
  PropertiesService.getScriptProperties().setProperty('HD_LAST_SUMMARY', JSON.stringify({
    jobId: jobId,
    completedAt: new Date().toISOString(),
    summary: summary || {}
  }));
  return summary;
}

function pollCsvInputFolder() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(1000)) return;
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var parent = DriveApp.getFileById(ss.getId()).getParents().next();
    var input = hdGetExactlyOneFolder_(parent, 'CSV投入フォルダ');
    var processed = hdGetExactlyOneFolder_(parent, '処理済みフォルダ');
    var exports = hdGetExactlyOneFolder_(parent, '完成版CSVエクスポート');
    var csvFiles = hdIteratorToArray_(input.getFilesByType(MimeType.CSV));
    if (!csvFiles.length) return;

    var jobs = {};
    csvFiles.forEach(function(file) {
      var metadata = hdReadMetadata_(file.getDescription());
      if (!metadata.jobId) throw new Error('jobIdが無い入力CSVがあります: ' + file.getName());
      jobs[metadata.jobId] = true;
    });
    var jobIds = Object.keys(jobs);
    if (jobIds.length !== 1) throw new Error('複数ジョブのCSVが混在しているため処理を停止しました: ' + jobIds.join(', '));
    var jobId = jobIds[0];
    var beforeExportIds = {};
    hdIteratorToArray_(exports.getFilesByType(MimeType.CSV)).forEach(function(file) { beforeExportIds[file.getId()] = true; });

    try {
      executeAllProcessesHeadless(jobId);
      hdIteratorToArray_(exports.getFilesByType(MimeType.CSV)).forEach(function(file) {
        if (!beforeExportIds[file.getId()]) file.setDescription(JSON.stringify({ jobId: jobId, spreadsheetId: ss.getId() }));
      });
      PropertiesService.getScriptProperties().deleteProperty('HD_LAST_ERROR');
    } catch (error) {
      // importCSVFiles()は取込直後に処理済みへ移動するため、後続失敗時だけ入力へ戻す。
      csvFiles.forEach(function(original) {
        try { DriveApp.getFileById(original.getId()).moveTo(input); } catch (moveError) { console.error(moveError); }
      });
      PropertiesService.getScriptProperties().setProperty('HD_LAST_ERROR', JSON.stringify({ jobId: jobId, failedAt: new Date().toISOString(), message: String(error && error.message || error) }));
      throw error;
    }
  } finally {
    lock.releaseLock();
  }
}

function installCsvPollingTrigger() {
  ScriptApp.getProjectTriggers().filter(function(trigger) {
    return trigger.getHandlerFunction() === 'pollCsvInputFolder';
  }).forEach(function(trigger) { ScriptApp.deleteTrigger(trigger); });
  ScriptApp.newTrigger('pollCsvInputFolder').timeBased().everyMinutes(5).create();
}

function hdGetExactlyOneFolder_(parent, name) {
  var matches = hdIteratorToArray_(parent.getFoldersByName(name));
  if (matches.length !== 1) throw new Error('フォルダ「' + name + '」の候補数が' + matches.length + '件です');
  return matches[0];
}

function hdIteratorToArray_(iterator) {
  var result = [];
  while (iterator.hasNext()) result.push(iterator.next());
  return result;
}

function hdReadMetadata_(description) {
  try { return JSON.parse(description || '{}'); } catch (error) { return {}; }
}

// =====================================================================
// Node連携用WebアプリAPI
// 「次のユーザーとして実行: 自分」「アクセスできるユーザー: 全員」でデプロイし、
// 必ずGAS_WEB_APP_SECRETをスクリプトプロパティへ設定してください。
// =====================================================================
function doPost(event) {
  try {
    var request = JSON.parse(event.postData.contents || '{}');
    var expected = PropertiesService.getScriptProperties().getProperty('GAS_WEB_APP_SECRET');
    if (!expected || request.secret !== expected) return hdJson_({ ok: false, error: '認証に失敗しました', code: 'unauthorized' });
    var data;
    if (request.action === 'resolveLocation') data = hdResolveLocation_(request.rootId, request.prefecture, request.city, request.refresh === true);
    else if (request.action === 'uploadCsv') data = hdUploadCsv_(request);
    else if (request.action === 'findExports') data = hdFindExports_(request.exportFolderId, request.jobId);
    else if (request.action === 'downloadFile') data = hdDownloadFile_(request.fileId);
    else if (request.action === 'listMasterJobs') data = hdListMasterJobs_(request);
    else if (request.action === 'updateMasterStatus') data = hdUpdateMasterStatus_(request);
    else if (request.action === 'consolidateRouteCsv') data = hdConsolidateRouteCsv_(request);
    else throw new Error('未対応のactionです: ' + request.action);
    return hdJson_({ ok: true, data: data });
  } catch (error) {
    return hdJson_({ ok: false, error: String(error.message || error), code: error.code || 'gas_error', candidates: error.candidates || [] });
  }
}

function hdResolveLocation_(rootId, prefecture, city, refresh) {
  if (!rootId || !prefecture || !city) throw hdApiError_('location_invalid_area', 'ルートID、都道府県、市区町村が不足しています', []);
  var cache = CacheService.getScriptCache();
  var key = 'driveLocation:' + rootId + ':' + prefecture + ':' + city;
  if (!refresh) {
    var cached = cache.get(key);
    if (cached) return JSON.parse(cached);
  }
  var root = DriveApp.getFolderById(rootId);
  var prefectureFolder = hdExactlyOneFolder_(root, prefecture);
  var cityFolder = hdExactlyOneFolder_(prefectureFolder, city);
  var input = hdExactlyOneFolder_(cityFolder, 'CSV投入フォルダ');
  var processed = hdExactlyOneFolder_(cityFolder, '処理済みフォルダ');
  var exports = hdExactlyOneFolder_(cityFolder, '完成版CSVエクスポート');
  var sheets = hdIteratorToArray_(cityFolder.getFilesByName(city)).filter(function(file) { return file.getMimeType() === MimeType.GOOGLE_SHEETS; });
  if (sheets.length !== 1) throw hdApiError_(sheets.length ? 'location_ambiguous' : 'location_not_found', 'スプレッドシート「' + city + '」の候補数が' + sheets.length + '件です', hdFilesToCandidates_(sheets.length ? sheets : hdIteratorToArray_(cityFolder.getFiles())));
  var result = { rootId: rootId, prefecture: prefecture, city: city, prefectureFolderId: prefectureFolder.getId(), cityFolderId: cityFolder.getId(), inputFolderId: input.getId(), processedFolderId: processed.getId(), exportFolderId: exports.getId(), spreadsheetId: sheets[0].getId(), discoveredAt: new Date().toISOString() };
  cache.put(key, JSON.stringify(result), 21600);
  return result;
}

function hdUploadCsv_(request) {
  var location = request.location || {};
  if (!location.inputFolderId || !location.processedFolderId || !request.jobId || !request.name || !request.contentBase64) throw new Error('CSVアップロード情報が不足しています');
  var folders = [DriveApp.getFolderById(location.inputFolderId), DriveApp.getFolderById(location.processedFolderId)];
  for (var i = 0; i < folders.length; i++) {
    var files = folders[i].getFiles();
    while (files.hasNext()) {
      var existing = files.next();
      var metadata = hdReadMetadata_(existing.getDescription());
      if (metadata.jobId === request.jobId && existing.getName().indexOf(request.name.split('_')[0] + '_') === 0) return hdFileInfo_(existing, true);
    }
  }
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var bytes = Utilities.base64Decode(request.contentBase64);
    var blob = Utilities.newBlob(bytes, 'text/csv', request.name);
    var file = folders[0].createFile(blob).setDescription(JSON.stringify({ jobId: request.jobId }));
    return hdFileInfo_(file, false);
  } finally { lock.releaseLock(); }
}

function hdFindExports_(folderId, jobId) {
  return hdIteratorToArray_(DriveApp.getFolderById(folderId).getFilesByType(MimeType.CSV)).filter(function(file) {
    return hdReadMetadata_(file.getDescription()).jobId === jobId;
  }).map(function(file) { return hdFileInfo_(file, false); });
}

function hdDownloadFile_(fileId) {
  var file = DriveApp.getFileById(fileId);
  return { id: file.getId(), name: file.getName(), contentBase64: Utilities.base64Encode(file.getBlob().getBytes()) };
}

function hdExactlyOneFolder_(parent, name) {
  var matches = hdIteratorToArray_(parent.getFoldersByName(name));
  if (matches.length !== 1) {
    var all = hdIteratorToArray_(parent.getFolders());
    throw hdApiError_(matches.length ? 'location_ambiguous' : 'location_not_found', 'フォルダ「' + name + '」の候補数が' + matches.length + '件です', hdFilesToCandidates_(matches.length ? matches : all));
  }
  return matches[0];
}

function hdFilesToCandidates_(files) { return files.map(function(file) { return { id: file.getId(), name: file.getName(), mimeType: file.getMimeType ? file.getMimeType() : MimeType.FOLDER }; }); }
function hdFileInfo_(file, skipped) { return { id: file.getId(), name: file.getName(), url: file.getUrl(), mimeType: file.getMimeType(), skippedDuplicate: skipped === true }; }
function hdApiError_(code, message, candidates) { var error = new Error(message); error.code = code; error.candidates = candidates || []; return error; }
function hdJson_(value) { return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON); }

function hdManagementSpreadsheet_() {
  var id = PropertiesService.getScriptProperties().getProperty('MANAGEMENT_SPREADSHEET_ID');
  if (!id) throw new Error('MANAGEMENT_SPREADSHEET_IDがスクリプトプロパティにありません');
  return SpreadsheetApp.openById(id);
}

function hdHeaderMap_(header) {
  var map = {};
  header.forEach(function(value, index) { map[String(value).trim()] = index; });
  return map;
}

function hdBoolean_(value) { return value === true || String(value).toUpperCase() === 'TRUE'; }

function hdListMasterJobs_(request) {
  var sheet = hdManagementSpreadsheet_().getSheetByName('日別架電計画');
  var values = sheet.getDataRange().getValues();
  var header = hdHeaderMap_(values[0]);
  ['当日架電市区町村','営業ルート','自動取得対象','飲食取得完了'].forEach(function(name) { if (header[name] == null) throw new Error('管理列がありません: ' + name); });
  return values.slice(1).map(function(row, index) {
    return {
      rowNumber: index + 2,
      prefecture: request.prefecture,
      city: String(row[header['当日架電市区町村']] || '').trim(),
      route: String(row[header['営業ルート']] || '').trim(),
      genre: String(row[header['取得ジャンル']] || '飲食店').trim(),
      sources: String(row[header['取得元']] || 'googlemaps,tabelog').trim(),
      minimumCount: Number(row[header['最低統合件数']]) || 0,
      jobId: String(row[header['ジョブID']] || '').trim(),
      autoTarget: hdBoolean_(row[header['自動取得対象']]),
      completed: hdBoolean_(row[header['飲食取得完了']])
    };
  }).filter(function(item) { return item.city && item.autoTarget && !item.completed; });
}

function hdUpdateMasterStatus_(request) {
  var sheet = hdManagementSpreadsheet_().getSheetByName('日別架電計画');
  var header = hdHeaderMap_(sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]);
  var row = Number(request.rowNumber);
  if (!row || row < 2) throw new Error('管理行番号が不正です');
  function set(name, value) { if (header[name] == null) throw new Error('管理列がありません: ' + name); sheet.getRange(row, header[name] + 1).setValue(value); }
  set('最終実行日時', new Date());
  if (request.jobId != null) set('ジョブID', request.jobId);
  if (request.state === 'started') { set('飲食取得進行中', true); set('エラー内容', ''); }
  else if (request.state === 'scraped') { set('飲食取得完了', true); }
  else if (request.state === 'completed') {
    set('飲食取得進行中', false); set('飲食取得完了', true); set('飲食店コムデスク投入', true); set('完成CSVリンク', request.completedCsvLink || ''); set('エラー内容', '');
  } else if (request.state === 'error') { set('飲食取得進行中', false); set('エラー内容', String(request.error || '').slice(0, 2000)); }
  else throw new Error('不正な状態です: ' + request.state);
  return { rowNumber: row, state: request.state };
}

function hdConsolidateRouteCsv_(request) {
  var members = request.members || [];
  if (!members.length) throw new Error('統合対象CSVがありません');
  var unifiedHeader = [], headerSet = {}, rows = [];
  members.forEach(function(member) {
    (member.fileIds || []).forEach(function(fileId) {
      var file = DriveApp.getFileById(fileId);
      var parsed = Utilities.parseCsv(file.getBlob().getDataAsString('UTF-8').replace(/^\uFEFF/, ''));
      if (!parsed.length) return;
      parsed[0].forEach(function(name) { name = String(name).trim(); if (name && !headerSet[name]) { headerSet[name] = true; unifiedHeader.push(name); } });
      rows.push({ header: parsed[0].map(String), values: parsed.slice(1), city: member.city });
    });
  });
  var combined = [unifiedHeader];
  rows.forEach(function(group) {
    var positions = group.header.map(function(name) { return unifiedHeader.indexOf(name); });
    group.values.forEach(function(source) { var row = new Array(unifiedHeader.length).fill(''); source.forEach(function(value, index) { if (positions[index] >= 0) row[positions[index]] = value; }); combined.push(row); });
  });
  if (combined.length - 1 < Number(request.minimumCount || 0)) throw new Error('同一営業ルートで統合しても最低統合件数に達しません: ' + (combined.length - 1) + '件');
  var first = DriveApp.getFileById(members[0].fileIds[0]);
  var exportFolder = first.getParents().next();
  var safeRoute = String(request.route || 'route').replace(/[\\\/:*?"<>|]/g, '_');
  var safeGenre = String(request.genre || '飲食店').replace(/[\\\/:*?"<>|]/g, '_');
  var fileName = '統合版_' + safeRoute + '_' + safeGenre + '_' + Utilities.formatDate(new Date(), 'JST', 'yyyyMMdd_HHmm') + '.csv';
  var csv = '\uFEFF' + combined.map(function(row) { return row.map(function(value) { return '"' + String(value == null ? '' : value).replace(/"/g, '""') + '"'; }).join(','); }).join('\r\n');
  var output = exportFolder.createFile(Utilities.newBlob(csv, 'text/csv', fileName)).setDescription(JSON.stringify({ jobId: request.jobId, integrated: true, route: request.route, sourceFileIds: members.reduce(function(all, item) { return all.concat(item.fileIds || []); }, []) }));
  return { id: output.getId(), name: output.getName(), url: output.getUrl(), count: combined.length - 1 };
}
