/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 131_QBO_NativeCdcLegacyRunEvidenceAudit.js
 * Version     : 1.5.109
 *
 * READ-ONLY targeted audit of the three pre-CycleId Native CDC Run folders
 * discovered by v1.5.108.
 *
 * Purpose:
 * - establish deterministic legacy run identity from immutable folder evidence;
 * - inventory every file in each legacy run folder;
 * - inspect manifest and JSON evidence structure without modifying evidence;
 * - reconcile legacy evidence against 06_Payload_Artifacts by source/run/file clues;
 * - determine what can safely populate prospective 02a / 02b / 03 V2.
 */

const QBO_NCDC_LEGACY_AUDIT_V1_5_109 = Object.freeze({
  VERSION: 'QBO_NATIVE_CDC_LEGACY_RUN_EVIDENCE_AUDIT_V1_5_109',
  ROOT_FOLDER_ID: '1wuIk1bYM2hu78M7KcsXhAlmP39O8wh99',
  STATE_CAPTURE_SPREADSHEET_ID: '1JQ3s7fbOvSySmXVx5LuZhDogN2eMFekNAlU5Q6Tx4x0',
  PAYLOAD_ARTIFACT_SHEET: '06_Payload_Artifacts',
  LEGACY_FOLDER_IDS: [
    '1x3XlvpWjIUglMGSDKmn3p2j6gmfBS0NC',
    '14Mp3FGhOXgF8OEc7cwbDNR6lhNBsmjVj',
    '1kn5sfZak1nxCHXAQCbj8J6cVtAkh3Sxq'
  ]
});

function auditQboNativeCdcLegacyRunEvidence() {
  const C = QBO_NCDC_LEGACY_AUDIT_V1_5_109;
  const ss = SpreadsheetApp.openById(C.STATE_CAPTURE_SPREADSHEET_ID);
  const s06 = ss.getSheetByName(C.PAYLOAD_ARTIFACT_SHEET);
  if (!s06) throw new Error('Missing ' + C.PAYLOAD_ARTIFACT_SHEET);
  const rows06 = qboNcdc109ReadSheetObjects_(s06);

  const runs = C.LEGACY_FOLDER_IDS.map(function(folderId) {
    return qboNcdc109AuditLegacyFolder_(DriveApp.getFolderById(folderId), rows06);
  });

  const summary = {
    version: C.VERSION,
    status: runs.every(function(r){ return r.folderIdentity.valid && !r.invalidJsonFileCount; })
      ? 'EVIDENCE_INVENTORIED'
      : 'ACTION_REQUIRED',
    readOnly: true,
    legacyRunFolderCount: runs.length,
    manifestPresentCount: runs.filter(function(r){ return r.manifest.present; }).length,
    committedSuccessManifestCount: runs.filter(function(r){
      return r.manifest.present &&
             r.manifest.validJson &&
             r.manifest.status === 'SUCCESS' &&
             r.manifest.watermarkCommitted === true;
    }).length,
    missingManifestCount: runs.filter(function(r){ return !r.manifest.present; }).length,
    totalJsonEvidenceFiles: runs.reduce(function(n,r){ return n + r.jsonFileCount; }, 0),
    totalInvalidJsonFiles: runs.reduce(function(n,r){ return n + r.invalidJsonFileCount; }, 0),
    totalManifestReturnedEntities: runs.reduce(function(n,r){
      return n + (Number(r.manifest.returnedEntityCount) || 0);
    }, 0),
    total06CandidateRows: runs.reduce(function(n,r){ return n + r.payload06.candidateRowCount; }, 0),
    controls: {
      mutatesDriveEvidence: false,
      mutatesWorkbook: false,
      mutatesScriptProperties: false,
      mutatesTriggers: false,
      mutatesStateApplication: false
    }
  };

  console.log('[NATIVE CDC LEGACY AUDIT] | SUMMARY | ' + JSON.stringify(summary));

  runs.forEach(function(r) {
    console.log('[NATIVE CDC LEGACY AUDIT] | RUN | ' + JSON.stringify({
      folderIdentity: r.folderIdentity,
      manifest: r.manifest,
      directFileCount: r.directFileCount,
      recursiveFileCount: r.recursiveFileCount,
      jsonFileCount: r.jsonFileCount,
      invalidJsonFileCount: r.invalidJsonFileCount,
      evidenceEntitySummary: r.evidenceEntitySummary,
      payload06: r.payload06
    }));

    r.files.forEach(function(f) {
      console.log('[NATIVE CDC LEGACY AUDIT] | FILE | ' + JSON.stringify({
        legacyRunId: r.folderIdentity.legacyRunId,
        folderPath: f.folderPath,
        fileId: f.fileId,
        fileName: f.fileName,
        mimeType: f.mimeType,
        size: f.size,
        json: f.json,
        jsonShape: f.jsonShape,
        extracted: f.extracted
      }));
    });
  });

  return {summary: summary, runs: runs};
}

function qboNcdc109AuditLegacyFolder_(folder, rows06) {
  const identity = qboNcdc109ParseLegacyRunFolder_(folder);
  const files = [];
  qboNcdc109WalkFiles_(folder, folder.getName(), files);

  const manifestFiles = files.filter(function(f){ return /^manifest\.json$/i.test(f.fileName); });
  let manifest = {
    present: manifestFiles.length === 1,
    count: manifestFiles.length,
    fileId: '',
    fileName: '',
    validJson: false,
    status: '',
    watermarkCommitted: null,
    runStartedAt: '',
    runCompletedAt: '',
    returnedEntityCount: '',
    liveEntityCount: '',
    deletedEntityCount: '',
    cycleId: '',
    rawTopLevelKeys: []
  };

  if (manifestFiles.length === 1) {
    const mf = manifestFiles[0];
    manifest.fileId = mf.fileId;
    manifest.fileName = mf.fileName;
    manifest.validJson = mf.json === true;
    if (mf.parsed) {
      const m = mf.parsed;
      manifest.status = String(m.status || '').trim();
      manifest.watermarkCommitted = m.watermarkCommitted === true;
      manifest.runStartedAt = String(m.runStartedAt || '');
      manifest.runCompletedAt = String(m.runCompletedAt || '');
      manifest.returnedEntityCount = m.returnedEntityCount == null ? '' : Number(m.returnedEntityCount);
      manifest.liveEntityCount = m.liveEntityCount == null ? '' : Number(m.liveEntityCount);
      manifest.deletedEntityCount = m.deletedEntityCount == null ? '' : Number(m.deletedEntityCount);
      manifest.cycleId = String(m.cycleId || '').trim();
      manifest.rawTopLevelKeys = Object.keys(m).sort();
    }
  }

  const entitySummary = {};
  files.forEach(function(f) {
    if (!f.extracted) return;
    const et = String(f.extracted.entityType || '').trim();
    if (!et) return;
    if (!entitySummary[et]) entitySummary[et] = {fileCount:0, extractedEntityObservationCount:0};
    entitySummary[et].fileCount++;
    entitySummary[et].extractedEntityObservationCount += Number(f.extracted.entityObservationCount || 0);
  });

  const clues = [
    identity.legacyRunId,
    identity.uuid,
    identity.folderName
  ].filter(Boolean);

  const candidates = rows06.filter(function(r) {
    const hay = [
      r.IngestionSourceId, r.SourceRunId, r.WorkUnitId,
      r.PayloadFileId, r.PayloadFileName, r.RegistrationMode
    ].map(function(v){ return String(v == null ? '' : v); }).join('|');
    return clues.some(function(c){ return hay.indexOf(c) >= 0; });
  });

  return {
    folderIdentity: identity,
    manifest: manifest,
    directFileCount: qboNcdc109CountDirectFiles_(folder),
    recursiveFileCount: files.length,
    jsonFileCount: files.filter(function(f){ return f.json === true; }).length,
    invalidJsonFileCount: files.filter(function(f){ return f.json === false; }).length,
    evidenceEntitySummary: entitySummary,
    payload06: {
      candidateRowCount: candidates.length,
      observationCount: candidates.reduce(function(n,r){ return n + (Number(r.ObservationCount) || 0); }, 0),
      payloadCount: candidates.reduce(function(n,r){ return n + (Number(r.PayloadCount) || 0); }, 0),
      candidateRows: candidates.map(function(r) {
        return {
          IngestionSourceId: r.IngestionSourceId || '',
          SourceType: r.SourceType || '',
          SourceRunId: r.SourceRunId || '',
          WorkUnitId: r.WorkUnitId || '',
          ObservationCount: r.ObservationCount || '',
          PayloadCount: r.PayloadCount || '',
          PayloadFileId: r.PayloadFileId || '',
          PayloadFileName: r.PayloadFileName || '',
          RegistrationMode: r.RegistrationMode || '',
          LineageStatus: r.LineageStatus || ''
        };
      })
    },
    files: files
  };
}

function qboNcdc109ParseLegacyRunFolder_(folder) {
  const name = folder.getName();
  const m = name.match(/^QBO_Native_CDC_Run_(\d{8}_\d{6}_\d{3})_([0-9a-f-]{36})$/i);
  return {
    folderId: folder.getId(),
    folderName: name,
    valid: !!m,
    timestampToken: m ? m[1] : '',
    uuid: m ? m[2] : '',
    // Historical deterministic identity: preserve the identity actually present.
    // Do not invent a modern CycleBucket.
    legacyRunId: m ? ('LEGACY_NATIVE_CDC_RUN|' + m[2]) : '',
    identityBasis: m ? 'IMMUTABLE_FOLDER_NAME_UUID' : 'UNRESOLVED'
  };
}

function qboNcdc109WalkFiles_(folder, path, out) {
  const it = folder.getFiles();
  while (it.hasNext()) {
    const f = it.next();
    const rec = {
      folderPath: path,
      fileId: f.getId(),
      fileName: f.getName(),
      mimeType: f.getMimeType(),
      size: f.getSize(),
      json: null,
      jsonShape: '',
      extracted: null,
      parsed: null
    };

    if (/\.json$/i.test(rec.fileName)) {
      try {
        const obj = JSON.parse(f.getBlob().getDataAsString('UTF-8'));
        rec.json = true;
        rec.parsed = obj;
        rec.jsonShape = qboNcdc109DescribeJsonShape_(obj);
        rec.extracted = qboNcdc109ExtractEvidenceHints_(obj, rec.fileName);
      } catch (e) {
        rec.json = false;
        rec.jsonShape = 'INVALID_JSON: ' + String(e && e.message ? e.message : e);
      }
    }
    out.push(rec);
  }

  const subs = folder.getFolders();
  while (subs.hasNext()) {
    const sub = subs.next();
    qboNcdc109WalkFiles_(sub, path + '/' + sub.getName(), out);
  }
}

function qboNcdc109DescribeJsonShape_(obj) {
  if (Array.isArray(obj)) return 'ARRAY[' + obj.length + ']';
  if (obj && typeof obj === 'object') return 'OBJECT{' + Object.keys(obj).sort().join(',') + '}';
  return typeof obj;
}

function qboNcdc109ExtractEvidenceHints_(obj, fileName) {
  if (!obj || typeof obj !== 'object') return null;

  const out = {
    entityType: '',
    entityObservationCount: 0,
    sourceId: '',
    cycleId: '',
    runId: '',
    requestStartedAt: '',
    requestCompletedAt: '',
    topLevelKeys: Array.isArray(obj) ? [] : Object.keys(obj).sort()
  };

  if (!Array.isArray(obj)) {
    out.entityType = String(obj.entityType || obj.EntityType || '').trim();
    out.sourceId = String(obj.sourceId || obj.SourceId || '').trim();
    out.cycleId = String(obj.cycleId || obj.CycleId || '').trim();
    out.runId = String(obj.runId || obj.RunId || obj.cdcRunId || obj.CdcRunId || '').trim();
    out.requestStartedAt = String(obj.requestStartedAt || obj.RequestStartedAt || '');
    out.requestCompletedAt = String(obj.requestCompletedAt || obj.RequestCompletedAt || '');

    const candidates = [
      obj.entities, obj.Entities, obj.observations, obj.Observations,
      obj.events, obj.Events, obj.records, obj.Records,
      obj.data, obj.Data
    ];
    for (let i = 0; i < candidates.length; i++) {
      if (Array.isArray(candidates[i])) {
        out.entityObservationCount = candidates[i].length;
        break;
      }
    }
  } else {
    out.entityObservationCount = obj.length;
  }

  if (!out.entityType) {
    const m = String(fileName || '').match(/(?:^|[_-])([A-Za-z][A-Za-z0-9]+)(?:[_-]|\.json$)/);
    if (m) out.entityType = m[1];
  }
  return out;
}

function qboNcdc109CountDirectFiles_(folder) {
  let n = 0;
  const it = folder.getFiles();
  while (it.hasNext()) { it.next(); n++; }
  return n;
}

function qboNcdc109ReadSheetObjects_(sheet) {
  const lr = sheet.getLastRow(), lc = sheet.getLastColumn();
  if (lr < 2 || lc < 1) return [];
  const values = sheet.getRange(1,1,lr,lc).getValues();
  const headers = values[0].map(function(v){ return String(v || '').trim(); });
  return values.slice(1).filter(function(row) {
    return row.some(function(v){ return String(v == null ? '' : v).trim() !== ''; });
  }).map(function(row) {
    const o = {};
    headers.forEach(function(h,i){ if (h) o[h] = row[i]; });
    return o;
  });
}
