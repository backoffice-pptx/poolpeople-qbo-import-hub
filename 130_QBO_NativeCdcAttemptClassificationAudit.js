/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 130_QBO_NativeCdcAttemptClassificationAudit.js
 * Version     : 1.5.108
 *
 * READ-ONLY diagnostic.
 *
 * Establishes the historical evidence population needed to design:
 *   02a_CDC_Run_Attempts_V2       = all governed Native CDC run attempts
 *   02b_CDC_Committed_Runs_V2     = committed subset of 02a
 *   03_Native_CDC_Events_V2       = observations belonging to committed runs
 *
 * No workbook, Drive, Script Properties, triggers, or State Application writes.
 */

const QBO_NCDC_ATTEMPT_AUDIT_V1_5_108 = Object.freeze({
  VERSION: 'QBO_NATIVE_CDC_ATTEMPT_CLASSIFICATION_V1_5_108',
  ROOT_FOLDER_ID: '1wuIk1bYM2hu78M7KcsXhAlmP39O8wh99',
  STATE_CAPTURE_SPREADSHEET_ID: '1JQ3s7fbOvSySmXVx5LuZhDogN2eMFekNAlU5Q6Tx4x0',
  CURRENT_COMMITTED_SHEET: '02_CDC_Run_Manifest_V2'
});

function auditQboNativeCdcAttemptClassification() {
  const C = QBO_NCDC_ATTEMPT_AUDIT_V1_5_108;
  const root = DriveApp.getFolderById(C.ROOT_FOLDER_ID);
  const attempts = [];
  const stack = [{folder: root, path: root.getName(), depth: 0}];

  while (stack.length) {
    const item = stack.pop();
    const folder = item.folder;
    const name = folder.getName();

    if (/^QBO_Native_CDC_(Cycle|Run)_/i.test(name)) {
      attempts.push(qboNcdc108ClassifyAttempt_(folder, item.path, item.depth));
    }

    const children = folder.getFolders();
    while (children.hasNext()) {
      const child = children.next();
      stack.push({
        folder: child,
        path: item.path + '/' + child.getName(),
        depth: item.depth + 1
      });
    }
  }

  attempts.sort(function(a,b) {
    return String(a.folderPath).localeCompare(String(b.folderPath));
  });

  const ss = SpreadsheetApp.openById(C.STATE_CAPTURE_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(C.CURRENT_COMMITTED_SHEET);
  if (!sheet) throw new Error('Missing ' + C.CURRENT_COMMITTED_SHEET);

  const existing = qboNcdc108ReadSheetObjects_(sheet);
  const existingIds = {};
  existing.forEach(function(r) {
    const id = String(r.CdcRunId || '').trim();
    if (id) existingIds[id] = (existingIds[id] || 0) + 1;
  });

  const counts = {};
  attempts.forEach(function(a) {
    counts[a.classification] = (counts[a.classification] || 0) + 1;
  });

  const committedAttempts = attempts.filter(function(a) {
    return a.classification === 'COMMITTED_SUCCESS';
  });
  const committedIds = {};
  committedAttempts.forEach(function(a) {
    if (a.authoritativeCycleId) {
      if (!committedIds[a.authoritativeCycleId]) committedIds[a.authoritativeCycleId] = [];
      committedIds[a.authoritativeCycleId].push(a);
    }
  });

  const committedUnique = Object.keys(committedIds);
  const missingFromCurrent02 = committedUnique.filter(function(id){ return !existingIds[id]; }).sort();
  const extraInCurrent02 = Object.keys(existingIds).filter(function(id){ return !committedIds[id]; }).sort();
  const duplicateCommitted = committedUnique.filter(function(id){ return committedIds[id].length > 1; }).sort();
  const duplicateCurrent02 = Object.keys(existingIds).filter(function(id){ return existingIds[id] > 1; }).sort();

  const unexplained = attempts.filter(function(a) {
    return a.classification === 'UNCLASSIFIED_MANIFEST' ||
           a.classification === 'MULTIPLE_MANIFESTS' ||
           a.classification === 'INVALID_MANIFEST_JSON' ||
           a.classification === 'MISSING_MANIFEST';
  });

  const result = {
    version: C.VERSION,
    status: (
      attempts.length > 0 &&
      unexplained.length === 0 &&
      missingFromCurrent02.length === 0 &&
      extraInCurrent02.length === 0 &&
      duplicateCommitted.length === 0 &&
      duplicateCurrent02.length === 0
    ) ? 'VALID' : 'ACTION_REQUIRED',
    readOnly: true,

    prospective02aAttemptCount: attempts.length,
    prospective02bCommittedAttemptCount: committedAttempts.length,
    prospective02bUniqueCommittedRunCount: committedUnique.length,
    current02V2RowCount: existing.length,
    current02V2UniqueRunCount: Object.keys(existingIds).length,

    classificationCounts: counts,

    missingCommittedRunsFromCurrent02V2: missingFromCurrent02,
    extraCurrent02V2RunsNotCommittedByFolderEvidence: extraInCurrent02,
    duplicateCommittedRunIds: duplicateCommitted,
    duplicateCurrent02V2RunIds: duplicateCurrent02,

    unexplainedAttemptCount: unexplained.length,
    unexplainedAttempts: unexplained,

    attempts: attempts,

    controls: {
      everyCycleLikeFolderClassifiedExactlyOnce: unexplained.length === 0,
      committedSubsetMatchesCurrent02V2:
        missingFromCurrent02.length === 0 &&
        extraInCurrent02.length === 0 &&
        duplicateCommitted.length === 0 &&
        duplicateCurrent02.length === 0,
      mutatesDriveEvidence: false,
      mutatesWorkbook: false,
      mutatesScriptProperties: false,
      mutatesTriggers: false,
      mutatesStateApplication: false
    }
  };

  console.log('[NATIVE CDC ATTEMPT AUDIT] | SUMMARY | ' + JSON.stringify({
    version: result.version,
    status: result.status,
    prospective02aAttemptCount: result.prospective02aAttemptCount,
    prospective02bCommittedAttemptCount: result.prospective02bCommittedAttemptCount,
    prospective02bUniqueCommittedRunCount: result.prospective02bUniqueCommittedRunCount,
    current02V2RowCount: result.current02V2RowCount,
    current02V2UniqueRunCount: result.current02V2UniqueRunCount,
    classificationCounts: result.classificationCounts,
    unexplainedAttemptCount: result.unexplainedAttemptCount,
    missingCommittedRunCountFromCurrent02V2: missingFromCurrent02.length,
    extraCurrent02V2RunCount: extraInCurrent02.length,
    duplicateCommittedRunIdCount: duplicateCommitted.length,
    duplicateCurrent02V2RunIdCount: duplicateCurrent02.length,
    controls: result.controls
  }));

  attempts.forEach(function(a) {
    console.log('[NATIVE CDC ATTEMPT AUDIT] | ATTEMPT | ' + JSON.stringify(a));
  });

  if (unexplained.length) {
    console.log('[NATIVE CDC ATTEMPT AUDIT] | UNEXPLAINED | ' + JSON.stringify(unexplained));
  }

  return result;
}

function qboNcdc108ClassifyAttempt_(folder, folderPath, depth) {
  const folderName = folder.getName();
  const parsed = qboNcdc108ParseFolderIdentity_(folderName);
  const manifests = qboNcdc108FindManifestFiles_(folder);

  const base = {
    folderId: folder.getId(),
    folderName: folderName,
    folderPath: folderPath,
    depth: depth,
    layout: depth === 1 ? 'LEGACY_ROOT' : 'HIERARCHICAL',
    folderParsedCycleId: parsed.cycleId,
    folderTimestampToken: parsed.timestampToken,
    manifestCount: manifests.length,
    manifestFileId: '',
    manifestFileName: '',
    manifestValidJson: null,
    manifestCycleId: '',
    authoritativeCycleId: '',
    manifestStatus: '',
    watermarkCommitted: null,
    runStartedAt: '',
    runCompletedAt: '',
    returnedEntityCount: '',
    liveEntityCount: '',
    deletedEntityCount: '',
    classification: '',
    classificationReason: ''
  };

  if (manifests.length === 0) {
    base.authoritativeCycleId = parsed.cycleId;
    base.classification = 'MISSING_MANIFEST';
    base.classificationReason = 'Cycle-like evidence folder exists but contains no recognized JSON manifest.';
    return base;
  }

  if (manifests.length > 1) {
    base.authoritativeCycleId = parsed.cycleId;
    base.classification = 'MULTIPLE_MANIFESTS';
    base.classificationReason = 'Cycle-like evidence folder contains more than one recognized JSON manifest.';
    base.manifestCount = manifests.length;
    return base;
  }

  const mf = manifests[0];
  base.manifestFileId = mf.getId();
  base.manifestFileName = mf.getName();

  let m;
  try {
    m = JSON.parse(mf.getBlob().getDataAsString('UTF-8'));
    base.manifestValidJson = true;
  } catch (e) {
    base.manifestValidJson = false;
    base.authoritativeCycleId = parsed.cycleId;
    base.classification = 'INVALID_MANIFEST_JSON';
    base.classificationReason = String(e && e.message ? e.message : e);
    return base;
  }

  base.manifestCycleId = String(m.cycleId || '').trim();
  base.authoritativeCycleId = base.manifestCycleId || parsed.cycleId;
  base.manifestStatus = String(m.status || '').trim();
  base.watermarkCommitted = m.watermarkCommitted === true;
  base.runStartedAt = String(m.runStartedAt || '');
  base.runCompletedAt = String(m.runCompletedAt || '');
  base.returnedEntityCount = m.returnedEntityCount == null ? '' : Number(m.returnedEntityCount);
  base.liveEntityCount = m.liveEntityCount == null ? '' : Number(m.liveEntityCount);
  base.deletedEntityCount = m.deletedEntityCount == null ? '' : Number(m.deletedEntityCount);

  const status = base.manifestStatus.toUpperCase();

  if (status === 'SUCCESS' && base.watermarkCommitted === true && base.authoritativeCycleId) {
    base.classification = 'COMMITTED_SUCCESS';
    base.classificationReason = 'Manifest proves SUCCESS and authoritative watermark commit.';
  } else if (status === 'FAILED' && base.watermarkCommitted === false) {
    base.classification = 'FAILED_UNCOMMITTED';
    base.classificationReason = 'Manifest explicitly records FAILED with no watermark commit.';
  } else if (status === 'SUCCESS' && base.watermarkCommitted === false) {
    base.classification = 'SUCCESS_UNCOMMITTED';
    base.classificationReason = 'Manifest records SUCCESS but authoritative watermark was not committed.';
  } else if ((status === 'RUNNING' || status === 'STARTED' || status === 'IN_PROGRESS') &&
             base.watermarkCommitted === false) {
    base.classification = 'INCOMPLETE_UNCOMMITTED';
    base.classificationReason = 'Manifest remains non-terminal and watermark is uncommitted.';
  } else if (!base.authoritativeCycleId) {
    base.classification = 'UNCLASSIFIED_MANIFEST';
    base.classificationReason = 'Manifest/folder did not provide a usable cycle identity.';
  } else {
    base.classification = 'UNCLASSIFIED_MANIFEST';
    base.classificationReason =
      'Manifest status/watermark combination is not governed by this diagnostic: status=' +
      base.manifestStatus + ', watermarkCommitted=' + base.watermarkCommitted;
  }

  return base;
}

function qboNcdc108ParseFolderIdentity_(name) {
  const prefix = /^QBO_Native_CDC_(?:Cycle|Run)_/i;
  const remainder = String(name || '').replace(prefix, '');
  const pipe = remainder.indexOf('|');
  if (pipe < 0) return {cycleId:'', timestampToken:''};

  const beforePipe = remainder.substring(0, pipe);
  const afterPipe = remainder.substring(pipe + 1);
  const m = beforePipe.match(/(\d{8}T\d{4}Z)$/);
  if (!m) return {cycleId:'', timestampToken:''};

  return {
    cycleId: m[1] + '|' + afterPipe,
    timestampToken: beforePipe.substring(0, beforePipe.length - m[1].length).replace(/_+$/, '')
  };
}

function qboNcdc108FindManifestFiles_(folder) {
  const out = [];
  const files = folder.getFiles();
  while (files.hasNext()) {
    const f = files.next();
    const name = f.getName();
    if (/manifest/i.test(name) && /\.json$/i.test(name)) out.push(f);
  }
  return out;
}

function qboNcdc108ReadSheetObjects_(sheet) {
  const lr = sheet.getLastRow();
  const lc = sheet.getLastColumn();
  if (lr < 2 || lc < 1) return [];
  const values = sheet.getRange(1,1,lr,lc).getValues();
  const headers = values[0].map(function(v){ return String(v || '').trim(); });
  return values.slice(1).filter(function(row) {
    return row.some(function(v) {
      return String(v === null || v === undefined ? '' : v).trim() !== '';
    });
  }).map(function(row) {
    const o = {};
    headers.forEach(function(h,i){ if (h) o[h] = row[i]; });
    return o;
  });
}
