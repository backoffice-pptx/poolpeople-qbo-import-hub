/**
 * ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 129_QBO_NativeCdcRecursiveEvidenceInventory.js
 * Version     : 1.5.107
 * Purpose     : READ-ONLY recursive inventory of Native CDC historical evidence.
 *
 * Why:
 *   v1.5.105 reconstructed 30 committed cycles, but Native CDC evidence exists
 *   under more than one Drive layout (legacy root-level cycle folders and the
 *   newer UTC YYYY/MM/DD hierarchy). This audit independently traverses the
 *   complete Native CDC folder tree and reconciles committed manifests to
 *   02_CDC_Run_Manifest_V2 before Gate A proceeds.
 *
 * Mutations: NONE.
 * ============================================================================
 */

const QBO_NATIVE_CDC_RECURSIVE_INVENTORY_V1_5_107 = Object.freeze({
  VERSION: 'QBO_NATIVE_CDC_RECURSIVE_EVIDENCE_INVENTORY_V1_5_107',
  ROOT_FOLDER_ID: '1wuIk1bYM2hu78M7KcsXhAlmP39O8wh99',
  STATE_CAPTURE_SPREADSHEET_ID: '1JQ3s7fbOvSySmXVx5LuZhDogN2eMFekNAlU5Q6Tx4x0',
  SHEET02_V2: '02_CDC_Run_Manifest_V2',
  MANIFEST_NAMES: Object.freeze([
    'manifest.json',
    'cdc_manifest.json',
    'run_manifest.json',
    'QBO_Native_CDC_Manifest.json'
  ])
});

function auditQboNativeCdcRecursiveEvidenceInventory() {
  const C = QBO_NATIVE_CDC_RECURSIVE_INVENTORY_V1_5_107;
  const root = DriveApp.getFolderById(C.ROOT_FOLDER_ID);

  const folderStack = [{folder: root, path: root.getName(), depth: 0}];
  const manifests = [];
  const duplicateCycleIds = {};
  const folderStats = {
    folderCount: 0,
    maxDepth: 0,
    rootLevelCycleLikeFolderCount: 0,
    hierarchicalCycleLikeFolderCount: 0
  };

  while (folderStack.length) {
    const item = folderStack.pop();
    const folder = item.folder;
    folderStats.folderCount++;
    folderStats.maxDepth = Math.max(folderStats.maxDepth, item.depth);

    const name = folder.getName();
    const cycleLike = /^QBO_Native_CDC_(Cycle|Run)_/i.test(name);
    if (cycleLike) {
      if (item.depth === 1) folderStats.rootLevelCycleLikeFolderCount++;
      else folderStats.hierarchicalCycleLikeFolderCount++;
    }

    const manifestFiles = qboNcdiFindManifestFiles_(folder);
    manifestFiles.forEach(function(file) {
      const record = qboNcdiReadManifest_(file, folder, item.path, item.depth);
      manifests.push(record);
      if (record.cycleId) {
        if (!duplicateCycleIds[record.cycleId]) duplicateCycleIds[record.cycleId] = [];
        duplicateCycleIds[record.cycleId].push(record);
      }
    });

    const children = folder.getFolders();
    while (children.hasNext()) {
      const child = children.next();
      folderStack.push({
        folder: child,
        path: item.path + '/' + child.getName(),
        depth: item.depth + 1
      });
    }
  }

  const ss = SpreadsheetApp.openById(C.STATE_CAPTURE_SPREADSHEET_ID);
  const s02 = ss.getSheetByName(C.SHEET02_V2);
  if (!s02) throw new Error('Missing ' + C.SHEET02_V2);
  const rows02 = qboNcdiReadSheetObjects_(s02);
  const ids02 = {};
  rows02.forEach(function(r) {
    const id = String(r.CdcRunId || '').trim();
    if (id) ids02[id] = (ids02[id] || 0) + 1;
  });

  const committed = manifests.filter(function(m) {
    return m.validJson &&
      String(m.status || '').toUpperCase() === 'SUCCESS' &&
      m.watermarkCommitted === true &&
      !!m.cycleId;
  });

  const committedByCycle = {};
  committed.forEach(function(m) {
    if (!committedByCycle[m.cycleId]) committedByCycle[m.cycleId] = [];
    committedByCycle[m.cycleId].push(m);
  });

  const uniqueCommittedIds = Object.keys(committedByCycle).sort();
  const missingFrom02 = uniqueCommittedIds.filter(function(id) { return !ids02[id]; });
  const extraIn02 = Object.keys(ids02).filter(function(id) { return !committedByCycle[id]; }).sort();
  const duplicateCommitted = uniqueCommittedIds.filter(function(id) {
    return committedByCycle[id].length > 1;
  }).map(function(id) {
    return {
      cycleId: id,
      count: committedByCycle[id].length,
      manifests: committedByCycle[id].map(qboNcdiCompactManifest_)
    };
  });
  const duplicate02 = Object.keys(ids02).filter(function(id) {
    return ids02[id] > 1;
  }).sort().map(function(id) { return {cycleId:id, count:ids02[id]}; });

  const invalidJson = manifests.filter(function(m){ return !m.validJson; }).map(qboNcdiCompactManifest_);
  const incomplete = manifests.filter(function(m) {
    return m.validJson && !(String(m.status || '').toUpperCase() === 'SUCCESS' && m.watermarkCommitted === true);
  }).map(qboNcdiCompactManifest_);

  const missingDetails = missingFrom02.map(function(id) {
    return qboNcdiCompactManifest_(committedByCycle[id][0]);
  });

  const result = {
    version: C.VERSION,
    status: (
      missingFrom02.length === 0 &&
      extraIn02.length === 0 &&
      duplicateCommitted.length === 0 &&
      duplicate02.length === 0 &&
      invalidJson.length === 0
    ) ? 'VALID' : 'ACTION_REQUIRED',
    readOnly: true,
    rootFolderId: C.ROOT_FOLDER_ID,
    rootFolderName: root.getName(),
    traversedFolderCount: folderStats.folderCount,
    maxFolderDepth: folderStats.maxDepth,
    rootLevelCycleLikeFolderCount: folderStats.rootLevelCycleLikeFolderCount,
    hierarchicalCycleLikeFolderCount: folderStats.hierarchicalCycleLikeFolderCount,
    manifestFileCount: manifests.length,
    committedManifestFileCount: committed.length,
    uniqueCommittedCycleCount: uniqueCommittedIds.length,
    sheet02V2RowCount: rows02.length,
    sheet02V2UniqueCycleCount: Object.keys(ids02).length,
    missingCommittedCycleCountFrom02V2: missingFrom02.length,
    extra02V2CycleCountNotCommittedEvidence: extraIn02.length,
    duplicateCommittedCycleCount: duplicateCommitted.length,
    duplicate02V2CycleCount: duplicate02.length,
    invalidManifestJsonCount: invalidJson.length,
    incompleteOrUncommittedManifestCount: incomplete.length,
    missingCommittedCyclesFrom02V2: missingDetails,
    extra02V2CyclesNotCommittedEvidence: extraIn02,
    duplicateCommittedCycles: duplicateCommitted,
    duplicate02V2Cycles: duplicate02,
    invalidManifestJson: invalidJson,
    incompleteOrUncommittedManifests: incomplete,
    allCommittedCycles: uniqueCommittedIds.map(function(id) {
      const m = committedByCycle[id][0];
      return {
        cycleId: id,
        runStartedAt: m.runStartedAt,
        runCompletedAt: m.runCompletedAt,
        returnedEntityCount: m.returnedEntityCount,
        liveEntityCount: m.liveEntityCount,
        deletedEntityCount: m.deletedEntityCount,
        folderPath: m.folderPath,
        manifestFileId: m.manifestFileId,
        manifestFileName: m.manifestFileName
      };
    }),
    mutatesDriveEvidence: false,
    mutatesWorkbook: false,
    mutatesScriptProperties: false,
    mutatesTriggers: false,
    mutatesStateApplication: false
  };

  console.log('[NATIVE CDC RECURSIVE INVENTORY] | RESULT | ' + JSON.stringify(result));
  return result;
}

function qboNcdiFindManifestFiles_(folder) {
  const out = [];
  const seen = {};
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    const name = f.getName();
    const lower = name.toLowerCase();
    const explicit = QBO_NATIVE_CDC_RECURSIVE_INVENTORY_V1_5_107.MANIFEST_NAMES
      .some(function(x){ return lower === x.toLowerCase(); });
    const manifestLike = /manifest/i.test(name) && /\.json$/i.test(name);
    if ((explicit || manifestLike) && !seen[f.getId()]) {
      seen[f.getId()] = true;
      out.push(f);
    }
  }
  return out;
}

function qboNcdiReadManifest_(file, folder, path, depth) {
  const base = {
    manifestFileId: file.getId(),
    manifestFileName: file.getName(),
    folderId: folder.getId(),
    folderName: folder.getName(),
    folderPath: path,
    depth: depth,
    validJson: false,
    parseError: '',
    cycleId: '',
    status: '',
    watermarkCommitted: false,
    runStartedAt: '',
    runCompletedAt: '',
    returnedEntityCount: '',
    liveEntityCount: '',
    deletedEntityCount: ''
  };
  try {
    const text = file.getBlob().getDataAsString('UTF-8');
    const m = JSON.parse(text);
    base.validJson = true;
    base.cycleId = String(m.cycleId || '').trim();
    base.status = String(m.status || '').trim();
    base.watermarkCommitted = m.watermarkCommitted === true;
    base.runStartedAt = String(m.runStartedAt || '');
    base.runCompletedAt = String(m.runCompletedAt || '');
    base.returnedEntityCount = m.returnedEntityCount == null ? '' : Number(m.returnedEntityCount);
    base.liveEntityCount = m.liveEntityCount == null ? '' : Number(m.liveEntityCount);
    base.deletedEntityCount = m.deletedEntityCount == null ? '' : Number(m.deletedEntityCount);
  } catch (e) {
    base.parseError = String(e && e.message ? e.message : e);
  }
  return base;
}

function qboNcdiCompactManifest_(m) {
  return {
    cycleId: m.cycleId,
    status: m.status,
    watermarkCommitted: m.watermarkCommitted,
    runStartedAt: m.runStartedAt,
    runCompletedAt: m.runCompletedAt,
    returnedEntityCount: m.returnedEntityCount,
    liveEntityCount: m.liveEntityCount,
    deletedEntityCount: m.deletedEntityCount,
    folderPath: m.folderPath,
    folderId: m.folderId,
    manifestFileId: m.manifestFileId,
    manifestFileName: m.manifestFileName,
    validJson: m.validJson,
    parseError: m.parseError
  };
}

function qboNcdiReadSheetObjects_(sheet) {
  const lr = sheet.getLastRow();
  const lc = sheet.getLastColumn();
  if (lr < 2 || lc < 1) return [];
  const values = sheet.getRange(1,1,lr,lc).getValues();
  const headers = values[0].map(function(v){ return String(v || '').trim(); });
  return values.slice(1).filter(function(row) {
    return row.some(function(v){ return String(v === null || v === undefined ? '' : v).trim() !== ''; });
  }).map(function(row) {
    const o = {};
    headers.forEach(function(h,i){ if (h) o[h] = row[i]; });
    return o;
  });
}
