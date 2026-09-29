/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 4050_QBO_ObservationIndexHistoricalBackfill.js
 * Version     : 1.5.182
 * Purpose     : Controlled, resumable reconstruction of 07_Observation_Index
 *               from immutable Change Payload shards already registered in
 *               06_Payload_Artifacts.
 *
 * Authority / safety:
 *   - 06 + immutable payload shard are read-only authorities.
 *   - Writes ONLY 07_Observation_Index and one ScriptProperties run state.
 *   - Does NOT mutate 05, 06, payload files, source ledgers, triggers outside
 *     its own continuation, or State Application.
 *   - Idempotent by PayloadFileId + ObservationId + PayloadOrdinal.
 *   - A retry reconciles an already-complete artifact; partial/mismatched 07
 *     materialization fails closed and is never silently appended over.
 *
 * Operator:
 *   recoverQboObservationIndexHistoricalBackfillV172()
 *
 * v1.5.172 repair:
 *   - FULL_EXPORT payload ObservedAt is fail-closed against the exact
 *     01_Sources ObservationCompletedAt for that IngestionSourceId.
 *   - QBO LastUpdatedTime remains supporting SourceChangeTime evidence only.
 *   - Spreadsheet tail reconciliation retries transient Spreadsheet service
 *     access failures with bounded exponential backoff.
 *   - Recovery resumes the exact v1.5.171 run only when physical 07 row count
 *     equals its durable indexedObservationCount checkpoint.
 *
 * v1.5.171 repair:
 *   - Shard hash is the SHA-256 of canonical stableBody, not raw envelope text.
 *   - Payloads are read from envelope.stableBody.payloads.
 *   - Artifact reconciliation verifies only the expected tail block instead of
 *     scanning the entire 07 PayloadFileId column on every artifact.
 *   - Recovery is fail-closed against the exact v1.5.170 cursor-0 hash failure.
 */

const QBO_OBSERVATION_INDEX_BACKFILL_V170_ = Object.freeze({
  VERSION: '1.5.170',
  STATE_KEY: 'QBO_OBSERVATION_INDEX_BACKFILL_V170_STATE',
  CONTINUATION_HANDLER: 'qboObservationIndexHistoricalBackfillV170Continuation_',
  CONTINUATION_DELAY_MS: 60000,
  RUNTIME_BUDGET_MS: 180000,
  MAX_OBSERVATIONS_PER_INVOCATION: 25000,
  TARGET_HISTORICAL_ARTIFACT_COUNT: 3455,
  TARGET_HISTORICAL_OBSERVATION_COUNT: 734913
});

function startQboObservationIndexHistoricalBackfillV170() {
  qboObservationIndexV170DeleteContinuationTriggers_();
  const props = PropertiesService.getScriptProperties();
  const existing = qboObservationIndexV170LoadState_();
  if (existing && existing.status === 'RUNNING') {
    throw new Error('OBSERVATION_INDEX_V170_ALREADY_RUNNING cursor=' + existing.artifactCursor);
  }

  const ss = getQboStateCaptureSpreadsheet_();
  const sh07 = ss.getSheetByName(QBO_OBSERVATION_INDEX_CONTRACT_.SHEET_NAME);
  if (!sh07) throw new Error('OBSERVATION_INDEX_V170_07_MISSING');
  const schema = validateQboObservationIndexPhysicalSchemaV169_(sh07, QBO_OBSERVATION_INDEX_CONTRACT_.HEADERS.slice());
  if (schema.findings.length) throw new Error('OBSERVATION_INDEX_V170_07_SCHEMA_INVALID ' + schema.findings.join(','));
  if (sh07.getLastRow() > 1) {
    throw new Error('OBSERVATION_INDEX_V170_START_REQUIRES_EMPTY_07 rows=' + (sh07.getLastRow()-1) + '. Use resume/reconciliation, not a fresh start.');
  }

  const artifacts = qboPayloadArtifactReadRows_();
  const expectedObs = artifacts.reduce(function(n,r){ return n + Number(r.ObservationCount || 0); }, 0);
  const expectedPayload = artifacts.reduce(function(n,r){ return n + Number(r.PayloadCount || 0); }, 0);
  if (artifacts.length !== QBO_OBSERVATION_INDEX_BACKFILL_V170_.TARGET_HISTORICAL_ARTIFACT_COUNT ||
      expectedObs !== QBO_OBSERVATION_INDEX_BACKFILL_V170_.TARGET_HISTORICAL_OBSERVATION_COUNT ||
      expectedPayload !== expectedObs) {
    throw new Error('OBSERVATION_INDEX_V170_FROZEN_POPULATION_GATE_FAILED artifacts=' + artifacts.length +
      ' observationCount=' + expectedObs + ' payloadCount=' + expectedPayload);
  }

  const state = {
    version:'1.5.170', status:'RUNNING', runId:'OBS_INDEX_V170|' + Utilities.getUuid(),
    artifactCursor:0, artifactCount:artifacts.length,
    expectedObservationCount:expectedObs, expectedPayloadCount:expectedPayload,
    processedArtifactCount:0, indexedObservationCount:0, admittedCount:0,
    evidenceExceptionCount:0, blockedCount:0, reconciledArtifactCount:0,
    startedAt:new Date().toISOString(), lastProgressAt:'', completedAt:'', error:''
  };
  props.setProperty(QBO_OBSERVATION_INDEX_BACKFILL_V170_.STATE_KEY, JSON.stringify(state));
  console.log('[OBSERVATION INDEX V170] | START | ' + JSON.stringify(state));
  return qboObservationIndexHistoricalBackfillV170Worker_();
}

function recoverQboObservationIndexHistoricalBackfillV171() {
  qboObservationIndexV170DeleteContinuationTriggers_();
  const state = qboObservationIndexV170LoadState_();
  if (!state ||
      state.status !== 'FAILED' ||
      Number(state.artifactCursor) !== 0 ||
      Number(state.processedArtifactCount) !== 0 ||
      Number(state.indexedObservationCount) !== 0 ||
      String(state.error || '').indexOf('OBSERVATION_INDEX_V170_SHARD_HASH_MISMATCH') !== 0) {
    throw new Error('OBSERVATION_INDEX_V171_RECOVERY_PRECONDITION_FAILED state=' + JSON.stringify(state));
  }

  const ss = getQboStateCaptureSpreadsheet_();
  const sh07 = ss.getSheetByName(QBO_OBSERVATION_INDEX_CONTRACT_.SHEET_NAME);
  if (!sh07) throw new Error('OBSERVATION_INDEX_V171_07_MISSING');
  if (Math.max(0, sh07.getLastRow() - 1) !== 0) {
    throw new Error('OBSERVATION_INDEX_V171_RECOVERY_REQUIRES_EMPTY_07 rows=' + Math.max(0, sh07.getLastRow() - 1));
  }

  state.version = '1.5.171';
  state.status = 'RUNNING';
  state.error = '';
  state.lastProgressAt = new Date().toISOString();
  qboObservationIndexV170SaveState_(state);
  console.log('[OBSERVATION INDEX V171] | RECOVERED | ' + JSON.stringify(state));
  return qboObservationIndexHistoricalBackfillV170Worker_();
}

function recoverQboObservationIndexHistoricalBackfillV172() {
  qboObservationIndexV170DeleteContinuationTriggers_();
  const state = qboObservationIndexV170LoadState_();
  if (!state ||
      state.status !== 'FAILED' ||
      String(state.version || '') !== '1.5.171' ||
      String(state.error || '').indexOf('Service Spreadsheets failed while accessing document') !== 0) {
    throw new Error('OBSERVATION_INDEX_V172_RECOVERY_PRECONDITION_FAILED state=' + JSON.stringify(state));
  }

  const ss = getQboStateCaptureSpreadsheet_();
  const sh07 = ss.getSheetByName(QBO_OBSERVATION_INDEX_CONTRACT_.SHEET_NAME);
  if (!sh07) throw new Error('OBSERVATION_INDEX_V172_07_MISSING');
  const physicalRows = Math.max(0, qboObservationIndexV172SpreadsheetRetry_(function(){ return sh07.getLastRow(); }, '07_LAST_ROW') - 1);
  const checkpointRows = Number(state.indexedObservationCount || 0);
  if (physicalRows !== checkpointRows) {
    throw new Error('OBSERVATION_INDEX_V172_RECOVERY_ROW_COUNT_MISMATCH physical=' + physicalRows + ' checkpoint=' + checkpointRows);
  }

  state.version = '1.5.172';
  state.status = 'RUNNING';
  state.error = '';
  state.lastProgressAt = new Date().toISOString();
  qboObservationIndexV170SaveState_(state);
  console.log('[OBSERVATION INDEX V172] | RECOVERED | ' + JSON.stringify(state));
  return qboObservationIndexHistoricalBackfillV170Worker_();
}

function qboObservationIndexHistoricalBackfillV170Continuation_() {
  qboObservationIndexV170DeleteContinuationTriggers_();
  return qboObservationIndexHistoricalBackfillV170Worker_();
}

function qboObservationIndexHistoricalBackfillV170Worker_() {
  const started = Date.now();
  const state = qboObservationIndexV170LoadState_();
  if (!state || state.status !== 'RUNNING') {
    console.log('[OBSERVATION INDEX V170] | NOOP | state=' + JSON.stringify(state));
    return state;
  }

  try {
    const ss = getQboStateCaptureSpreadsheet_();
    const sh07 = ss.getSheetByName(QBO_OBSERVATION_INDEX_CONTRACT_.SHEET_NAME);
    if (!sh07) throw new Error('OBSERVATION_INDEX_V170_07_MISSING');
    const schema = validateQboObservationIndexPhysicalSchemaV169_(sh07, QBO_OBSERVATION_INDEX_CONTRACT_.HEADERS.slice());
    if (schema.findings.length) throw new Error('OBSERVATION_INDEX_V170_07_SCHEMA_INVALID ' + schema.findings.join(','));

    const artifacts = qboPayloadArtifactReadRows_();
    const fullExportObservedAtBySource = qboObservationIndexV172FullExportObservedAtMap_();
    if (artifacts.length !== Number(state.artifactCount)) throw new Error('OBSERVATION_INDEX_V170_06_POPULATION_DRIFT expected=' + state.artifactCount + ' actual=' + artifacts.length);

    let invocationObs = 0;
    while (state.artifactCursor < artifacts.length &&
           Date.now() - started < QBO_OBSERVATION_INDEX_BACKFILL_V170_.RUNTIME_BUDGET_MS &&
           invocationObs < QBO_OBSERVATION_INDEX_BACKFILL_V170_.MAX_OBSERVATIONS_PER_INVOCATION) {
      const artifact = artifacts[state.artifactCursor];
      const result = qboObservationIndexV170IndexArtifact_(sh07, artifact, fullExportObservedAtBySource);
      state.artifactCursor += 1;
      state.processedArtifactCount += 1;
      state.indexedObservationCount += result.observationCount;
      state.admittedCount += result.admittedCount;
      state.evidenceExceptionCount += result.evidenceExceptionCount;
      state.blockedCount += result.blockedCount;
      if (result.reconciled) state.reconciledArtifactCount += 1;
      state.lastProgressAt = new Date().toISOString();
      state.error = '';
      qboObservationIndexV170SaveState_(state);
      invocationObs += result.observationCount;
    }

    if (state.artifactCursor >= artifacts.length) {
      return qboObservationIndexV170Finalize_(state, sh07, artifacts);
    }

    qboObservationIndexV170InstallContinuation_();
    console.log('[OBSERVATION INDEX V172] | PROGRESS | ' + JSON.stringify(state));
    return state;
  } catch (err) {
    state.status = 'FAILED';
    state.error = String(err && err.message ? err.message : err);
    state.lastProgressAt = new Date().toISOString();
    qboObservationIndexV170SaveState_(state);
    qboObservationIndexV170DeleteContinuationTriggers_();
    console.log('[OBSERVATION INDEX V172] | FAILED | ' + JSON.stringify(state));
    throw err;
  }
}

function qboObservationIndexV170IndexArtifact_(sh07, artifact, fullExportObservedAtBySource) {
  const fileId = String(artifact.PayloadFileId || '').trim();
  const expectedHash = String(artifact.PayloadShardHash || '').trim();
  const expectedObs = Number(artifact.ObservationCount || 0);
  const expectedPayload = Number(artifact.PayloadCount || 0);
  if (!fileId || !expectedHash) throw new Error('OBSERVATION_INDEX_V171_INVALID_06_IDENTITY row=' + artifact.rowNumber);
  if (expectedObs !== expectedPayload) throw new Error('OBSERVATION_INDEX_V171_06_COUNT_MISMATCH fileId=' + fileId);

  const file = DriveApp.getFileById(fileId);
  const text = file.getBlob().getDataAsString('UTF-8');
  let envelope;
  try { envelope = JSON.parse(text); } catch (e) { throw new Error('OBSERVATION_INDEX_V171_INVALID_JSON fileId=' + fileId); }

  // Governed shard identity: the persistence contract hashes canonical stableBody,
  // while the physical file is an envelope containing createdAt/hash metadata.
  const stableBody = envelope && envelope.stableBody;
  if (!stableBody || typeof stableBody !== 'object') {
    throw new Error('OBSERVATION_INDEX_V171_STABLE_BODY_MISSING fileId=' + fileId);
  }
  const actualHash = qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(stableBody));
  if (actualHash !== expectedHash || String(envelope.shardHash || '') !== expectedHash) {
    throw new Error('OBSERVATION_INDEX_V171_SHARD_HASH_MISMATCH fileId=' + fileId);
  }

  const payloads = Array.isArray(stableBody.payloads) ? stableBody.payloads : [];
  if (payloads.length !== expectedObs || Number(stableBody.observationCount || 0) !== expectedObs) {
    throw new Error('OBSERVATION_INDEX_V171_SHARD_COUNT_MISMATCH fileId=' + fileId +
      ' ledger=' + expectedObs + ' payloads=' + payloads.length +
      ' stableBody=' + stableBody.observationCount);
  }
  const stableIds = Array.isArray(stableBody.observationIds) ? stableBody.observationIds : [];
  if (stableIds.length !== payloads.length) {
    throw new Error('OBSERVATION_INDEX_V171_OBSERVATION_ID_VECTOR_COUNT_MISMATCH fileId=' + fileId);
  }
  payloads.forEach(function(p, i) {
    if (!p || String(p.observationId || '') !== String(stableIds[i] || '')) {
      throw new Error('OBSERVATION_INDEX_V171_OBSERVATION_ID_VECTOR_MISMATCH fileId=' + fileId + ' ordinal=' + i);
    }
  });
  qboObservationIndexV172ValidateFullExportObservedAt_(artifact, payloads, fullExportObservedAtBySource || {});

  // Retry reconciliation is deliberately tail-bounded. The worker checkpoints
  // only after a whole artifact is verified, so an uncheckpointed retry can only
  // concern the current artifact at the physical tail of 07.
  const existingTail = qboObservationIndexV171TailRowsForArtifact_(sh07, fileId, payloads.length);
  if (existingTail.status === 'COMPLETE') {
    qboObservationIndexV170VerifyExistingArtifact_(sh07, existingTail.rowNumbers, payloads, artifact);
    const counts = qboObservationIndexV170AdmissionCounts_(payloads, artifact);
    counts.observationCount = payloads.length;
    counts.reconciled = true;
    return counts;
  }
  if (existingTail.status === 'PARTIAL') {
    throw new Error('OBSERVATION_INDEX_V171_PARTIAL_ARTIFACT_IN_07 fileId=' + fileId +
      ' existing=' + existingTail.rowNumbers.length + ' expected=' + payloads.length);
  }

  const now = new Date();
  const rows = payloads.map(function(p, ordinal) {
    return qboObservationIndexV170BuildRow_(p, ordinal, artifact, now);
  });
  if (rows.length) {
    const startRow = qboObservationIndexV172SpreadsheetRetry_(function(){ return sh07.getLastRow(); }, 'APPEND_LAST_ROW') + 1;
    qboObservationIndexV172SpreadsheetRetry_(function(){
      sh07.getRange(startRow, 1, rows.length, QBO_OBSERVATION_INDEX_CONTRACT_.HEADERS.length).setValues(rows);
      SpreadsheetApp.flush();
      return true;
    }, 'APPEND_WRITE fileId=' + fileId);
    const rowNumbers = [];
    for (let r = startRow; r < startRow + rows.length; r++) rowNumbers.push(r);
    qboObservationIndexV170VerifyExistingArtifact_(sh07, rowNumbers, payloads, artifact);
  }
  const counts = qboObservationIndexV170AdmissionCounts_(payloads, artifact);
  counts.observationCount = payloads.length;
  counts.reconciled = false;
  return counts;
}

function qboObservationIndexV171TailRowsForArtifact_(sh07, fileId, expectedCount) {
  if (expectedCount === 0) return {status:'NONE', rowNumbers:[]};
  const lastRow = qboObservationIndexV172SpreadsheetRetry_(function(){ return sh07.getLastRow(); }, 'TAIL_LAST_ROW');
  const dataRows = Math.max(0, lastRow - 1);
  if (dataRows === 0) return {status:'NONE', rowNumbers:[]};

  const fileCol = QBO_OBSERVATION_INDEX_CONTRACT_.HEADERS.indexOf('PayloadFileId') + 1;
  if (!fileCol) throw new Error('OBSERVATION_INDEX_V171_PAYLOAD_FILE_ID_HEADER_MISSING');

  const take = Math.min(expectedCount, dataRows);
  const startRow = lastRow - take + 1;
  const vals = qboObservationIndexV172SpreadsheetRetry_(function(){
    return sh07.getRange(startRow, fileCol, take, 1).getValues();
  }, 'TAIL_READ fileId=' + fileId);
  const matchingRows = [];
  for (let i = 0; i < vals.length; i++) {
    if (String(vals[i][0] || '') === String(fileId)) matchingRows.push(startRow + i);
  }
  if (matchingRows.length === 0) return {status:'NONE', rowNumbers:[]};
  if (matchingRows.length === expectedCount && take === expectedCount) {
    return {status:'COMPLETE', rowNumbers:matchingRows};
  }
  return {status:'PARTIAL', rowNumbers:matchingRows};
}

function qboObservationIndexV172FullExportObservedAtMap_() {
  const ss = getQboStateCaptureSpreadsheet_();
  const sh01 = ss.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);
  if (!sh01) throw new Error('OBSERVATION_INDEX_V172_01_SOURCES_MISSING');
  const sources = loadQboStateCaptureWriteSources_(sh01, '');
  const out = Object.create(null);
  sources.forEach(function(source) {
    const sourceId = String(source.sourceId || '');
    const sourceType = String(source.sourceAcquisitionType || '').toUpperCase();
    if (sourceType.indexOf('FULL_EXPORT') !== 0) return;
    const completedAt = qboObservationIndexV172Iso_(source.observationCompletedAt);
    if (!completedAt) throw new Error('OBSERVATION_INDEX_V172_FULL_EXPORT_COMPLETED_AT_MISSING sourceId=' + sourceId);
    out[sourceId] = completedAt;
  });
  return out;
}

function qboObservationIndexV172ValidateFullExportObservedAt_(artifact, payloads, fullExportObservedAtBySource) {
  const sourceType = String(artifact.SourceType || '').toUpperCase();
  if (sourceType.indexOf('FULL_EXPORT') !== 0) return;
  const sourceId = String(artifact.IngestionSourceId || '');
  const expected = String(fullExportObservedAtBySource[sourceId] || '');
  if (!expected) throw new Error('OBSERVATION_INDEX_V172_FULL_EXPORT_SOURCE_COMPLETED_AT_NOT_FOUND sourceId=' + sourceId);
  payloads.forEach(function(p, ordinal) {
    const actual = qboObservationIndexV172Iso_(p && p.observedAt);
    if (actual !== expected) {
      throw new Error('OBSERVATION_INDEX_V172_FULL_EXPORT_OBSERVED_AT_MISMATCH sourceId=' + sourceId +
        ' fileId=' + artifact.PayloadFileId + ' ordinal=' + ordinal + ' expected=' + expected + ' actual=' + actual);
    }
  });
}

function qboObservationIndexV172Iso_(value) {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return '';
  return d.toISOString();
}

function qboObservationIndexV172SpreadsheetRetry_(fn, label) {
  const delays = [250, 750, 1500, 3000];
  let lastError = null;
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try { return fn(); }
    catch (err) {
      lastError = err;
      const message = String(err && err.message ? err.message : err);
      const transientSpreadsheet = message.indexOf('Service Spreadsheets failed while accessing document') >= 0 ||
        message.indexOf('Service invoked too many times') >= 0 ||
        message.indexOf('Internal error') >= 0;
      if (!transientSpreadsheet || attempt >= delays.length) throw err;
      console.log('[OBSERVATION INDEX V172] | SPREADSHEET RETRY | label=' + label + ' | attempt=' + (attempt + 1) + ' | error=' + message);
      Utilities.sleep(delays[attempt]);
    }
  }
  throw lastError;
}

function qboObservationIndexV170BuildRow_(p, ordinal, artifact, indexedAt) {
  if (!p || !String(p.observationId || '')) throw new Error('OBSERVATION_INDEX_V170_PAYLOAD_MISSING_OBSERVATION_ID fileId=' + artifact.PayloadFileId + ' ordinal=' + ordinal);
  if (!String(p.entityType || '') || !String(p.entityId || '') || !String(p.observedAt || '')) throw new Error('OBSERVATION_INDEX_V170_PAYLOAD_IDENTITY_INCOMPLETE observationId=' + p.observationId);
  const admission = qboObservationIndexV170AdmissionStatus_(p, artifact);
  const raw = qboObservationIndexV170RawEntity_(p);
  const sourceLedger = qboObservationIndexV170SourceLedger_(String(p.sourceType || artifact.SourceType || ''));
  const sourceOperation = String((p.sourceEvidence && p.sourceEvidence.sourceOperation) || p.operation || '').toUpperCase();
  return [
    String(p.observationId || ''),
    String(artifact.IngestionSourceId || p.sourceId || ''),
    String(p.sourceType || artifact.SourceType || ''),
    sourceLedger,
    String(artifact.SourceRunId || p.exportRunId || p.cycleId || ''),
    String(artifact.WorkUnitId || p.workUnitId || p.entityRunId || ''),
    String(p.entityType || ''),
    String(p.entityId || ''),
    String(p.observedAt || ''),
    String(p.sourceChangeTime || (p.sourceEvidence && p.sourceEvidence.sourceChangeTime) || ''),
    sourceOperation,
    String(p.payloadKind || ''),
    String(artifact.PayloadFileId || ''),
    String(artifact.PayloadFileName || ''),
    String(artifact.PayloadShardHash || ''),
    ordinal,
    String(p.normalizedStateHash || ''),
    String(raw.SyncToken || ''),
    String(raw.MetaData && raw.MetaData.LastUpdatedTime || ''),
    admission,
    indexedAt
  ];
}

function qboObservationIndexV170RawEntity_(p) {
  const raw = p && p.rawEntityEvidence && String(p.rawEntityEvidence.rawJson || '');
  if (!raw) return {};
  try { return JSON.parse(raw); } catch (e) { return {}; }
}

function qboObservationIndexV170SourceLedger_(sourceType) {
  sourceType = String(sourceType || '').toUpperCase();
  if (sourceType.indexOf('FULL_EXPORT') === 0) return '01_Sources';
  if (sourceType === 'NATIVE_CDC') return '03_Native_CDC_Events_V2';
  if (sourceType === 'WEBHOOK') return '04_Webhook_Events_V2';
  throw new Error('OBSERVATION_INDEX_V170_UNKNOWN_SOURCE_LEDGER sourceType=' + sourceType);
}

function qboObservationIndexV170AdmissionStatus_(p, artifact) {
  const lineage = String(artifact.LineageStatus || '');
  const exact = lineage === QBO_PAYLOAD_ARTIFACT_LEDGER_.LINEAGE_EXACT || lineage === QBO_PAYLOAD_ARTIFACT_LEDGER_.LINEAGE_HISTORICAL_SOURCE_EXACT;
  if (!exact) return QBO_OBSERVATION_INDEX_CONTRACT_.ADMISSION_STATUS.BLOCKED;
  if (String(p.payloadKind || '').toUpperCase() === 'EVIDENCE_EXCEPTION') return QBO_OBSERVATION_INDEX_CONTRACT_.ADMISSION_STATUS.EVIDENCE_EXCEPTION;
  return QBO_OBSERVATION_INDEX_CONTRACT_.ADMISSION_STATUS.ADMITTED;
}

function qboObservationIndexV170AdmissionCounts_(payloads, artifact) {
  const out={admittedCount:0,evidenceExceptionCount:0,blockedCount:0};
  payloads.forEach(function(p){
    const s=qboObservationIndexV170AdmissionStatus_(p,artifact);
    if(s===QBO_OBSERVATION_INDEX_CONTRACT_.ADMISSION_STATUS.ADMITTED) out.admittedCount++;
    else if(s===QBO_OBSERVATION_INDEX_CONTRACT_.ADMISSION_STATUS.EVIDENCE_EXCEPTION) out.evidenceExceptionCount++;
    else if(s===QBO_OBSERVATION_INDEX_CONTRACT_.ADMISSION_STATUS.BLOCKED) out.blockedCount++;
    else throw new Error('OBSERVATION_INDEX_V170_UNKNOWN_ADMISSION_STATUS '+s);
  });
  return out;
}

function qboObservationIndexV170FindArtifactRows_(sh07, fileId) {
  if (sh07.getLastRow() <= 1) return [];
  const col = QBO_OBSERVATION_INDEX_CONTRACT_.HEADERS.indexOf('PayloadFileId') + 1;
  if (!col) throw new Error('OBSERVATION_INDEX_V170_PAYLOAD_FILE_ID_HEADER_MISSING');
  return sh07.getRange(2,col,sh07.getLastRow()-1,1).createTextFinder(String(fileId)).matchEntireCell(true).findAll().map(function(c){return c.getRow();});
}

function qboObservationIndexV170VerifyExistingArtifact_(sh07, rowNumbers, payloads, artifact) {
  const h=QBO_OBSERVATION_INDEX_CONTRACT_.HEADERS;
  const oi=h.indexOf('ObservationId'), fi=h.indexOf('PayloadFileId'), hi=h.indexOf('PayloadShardHash'), pi=h.indexOf('PayloadOrdinal');
  if (!rowNumbers.length && !payloads.length) return;
  if (rowNumbers.length !== payloads.length) throw new Error('OBSERVATION_INDEX_V172_VERIFY_ROW_COUNT_MISMATCH fileId='+artifact.PayloadFileId);
  const firstRow=rowNumbers[0], expectedLast=firstRow+rowNumbers.length-1;
  if(rowNumbers[rowNumbers.length-1]!==expectedLast) throw new Error('OBSERVATION_INDEX_V172_VERIFY_ROWS_NOT_CONTIGUOUS fileId='+artifact.PayloadFileId);
  const values=qboObservationIndexV172SpreadsheetRetry_(function(){
    return sh07.getRange(firstRow,1,rowNumbers.length,h.length).getValues();
  }, 'VERIFY_ARTIFACT fileId='+artifact.PayloadFileId);
  const byOrdinal=Object.create(null);
  values.forEach(function(v){
    const ord=Number(v[pi]);
    if(byOrdinal[ord]) throw new Error('OBSERVATION_INDEX_V170_DUPLICATE_ORDINAL fileId='+artifact.PayloadFileId+' ordinal='+ord);
    byOrdinal[ord]=v;
  });
  payloads.forEach(function(p,i){
    const v=byOrdinal[i];
    if(!v) throw new Error('OBSERVATION_INDEX_V170_MISSING_ORDINAL fileId='+artifact.PayloadFileId+' ordinal='+i);
    if(String(v[oi])!==String(p.observationId)||String(v[fi])!==String(artifact.PayloadFileId)||String(v[hi])!==String(artifact.PayloadShardHash)) {
      throw new Error('OBSERVATION_INDEX_V170_EXISTING_ROW_MISMATCH fileId='+artifact.PayloadFileId+' ordinal='+i);
    }
  });
}

function qboObservationIndexV170Finalize_(state, sh07, artifacts) {
  qboObservationIndexV170DeleteContinuationTriggers_();
  const dataRows=Math.max(0,sh07.getLastRow()-1);
  if(Number(state.indexedObservationCount)!==Number(state.expectedObservationCount)) throw new Error('OBSERVATION_INDEX_V170_FINAL_STATE_COUNT_MISMATCH');
  if(dataRows!==Number(state.expectedObservationCount)) throw new Error('OBSERVATION_INDEX_V170_FINAL_07_ROW_COUNT_MISMATCH expected='+state.expectedObservationCount+' actual='+dataRows);

  const obsCol=QBO_OBSERVATION_INDEX_CONTRACT_.HEADERS.indexOf('ObservationId')+1;
  const ids=sh07.getRange(2,obsCol,dataRows,1).getValues().map(function(r){return String(r[0]||'');});
  const seen=Object.create(null); let duplicateCount=0, blankCount=0;
  ids.forEach(function(id){if(!id)blankCount++; else if(seen[id])duplicateCount++; else seen[id]=true;});
  if(blankCount||duplicateCount) throw new Error('OBSERVATION_INDEX_V170_FINAL_ID_INTEGRITY blank='+blankCount+' duplicate='+duplicateCount);

  state.status='COMPLETE'; state.completedAt=new Date().toISOString(); state.error='';
  state.distinctObservationIdCount=Object.keys(seen).length;
  state.final07RowCount=dataRows;
  state.countInvariantValid = dataRows===Number(state.expectedObservationCount) && state.distinctObservationIdCount===dataRows;
  qboObservationIndexV170SaveState_(state);
  console.log('[OBSERVATION INDEX V172] | COMPLETE | '+JSON.stringify(state));
  return state;
}

function qboObservationIndexV170LoadState_(){
  const s=PropertiesService.getScriptProperties().getProperty(QBO_OBSERVATION_INDEX_BACKFILL_V170_.STATE_KEY);
  return s?JSON.parse(s):null;
}
function qboObservationIndexV170SaveState_(s){PropertiesService.getScriptProperties().setProperty(QBO_OBSERVATION_INDEX_BACKFILL_V170_.STATE_KEY,JSON.stringify(s));}
function qboObservationIndexV170InstallContinuation_(){
  qboObservationIndexV170DeleteContinuationTriggers_();
  ScriptApp.newTrigger(QBO_OBSERVATION_INDEX_BACKFILL_V170_.CONTINUATION_HANDLER).timeBased().after(QBO_OBSERVATION_INDEX_BACKFILL_V170_.CONTINUATION_DELAY_MS).create();
}
function qboObservationIndexV170DeleteContinuationTriggers_(){
  ScriptApp.getProjectTriggers().forEach(function(t){if(t.getHandlerFunction()===QBO_OBSERVATION_INDEX_BACKFILL_V170_.CONTINUATION_HANDLER)ScriptApp.deleteTrigger(t);});
}
function statusQboObservationIndexHistoricalBackfillV170(){const s=qboObservationIndexV170LoadState_();console.log(JSON.stringify(s,null,2));return s;}


/* ============================================================================
 * v1.5.179 — dormant immutable-shard writer candidate
 *
 * These helpers define the replacement physical writer but are NOT wired into
 * qboObservationIndexHistoricalBackfillV170Worker_ yet. The current historical
 * run remains FAILED at artifact cursor 1137. v1.5.179 is therefore a no-write
 * conversion-validation release.
 *
 * Determinism:
 *   IndexedAt is frozen to the retained historical run startedAt. It is
 *   processing/provenance metadata, never chronology. This prevents retry from
 *   changing immutable shard content/hash.
 * ========================================================================== */
const QBO_OBSERVATION_INDEX_SHARD_WRITER_V179_ = Object.freeze({
  VERSION:'1.5.179',
  SHARD_SCHEMA:'QBO_OBSERVATION_INDEX_SHARD_V1',
  MANIFEST_SCHEMA:'QBO_OBSERVATION_INDEX_MANIFEST_V1',
  LOOKUP_SCHEMA:'QBO_OBSERVATION_INDEX_LOOKUP_SEGMENT_V1',
  FILE_PREFIX:'qbo_observation_index_artifact_'
});

const QBO_OBSERVATION_INDEX_PAYLOAD_READ_V187_=Object.freeze({
  MAX_ATTEMPTS:4,
  BASE_DELAY_MS:1000
});

function qboObservationIndexV187ReadPayloadEnvelope_(fileId){
  let last=null;
  for(let attempt=1;attempt<=QBO_OBSERVATION_INDEX_PAYLOAD_READ_V187_.MAX_ATTEMPTS;attempt++){
    try{
      const text=qboObsIndexV184DriveReadRetry_(function(){
        return DriveApp.getFileById(fileId).getBlob().getDataAsString('UTF-8');
      });
      return JSON.parse(text);
    }catch(e){
      // Existing bounded Drive-service retry is already handled by the read
      // helper. At this layer retry only parse failures from an incomplete read.
      const message=String(e&&e.message?e.message:e);
      const parseFailure=(e instanceof SyntaxError)||/JSON|Unexpected token|Unexpected end/i.test(message);
      if(!parseFailure) throw e;
      last=e;
      if(attempt<QBO_OBSERVATION_INDEX_PAYLOAD_READ_V187_.MAX_ATTEMPTS)
        Utilities.sleep(QBO_OBSERVATION_INDEX_PAYLOAD_READ_V187_.BASE_DELAY_MS*Math.pow(2,attempt-1));
    }
  }
  throw new Error('OBS_INDEX_V179_INVALID_JSON fileId='+fileId+' attempts='+QBO_OBSERVATION_INDEX_PAYLOAD_READ_V187_.MAX_ATTEMPTS+
    ' last='+String(last&&last.message?last.message:last));
}

function qboObservationIndexV179PrepareArtifact_(artifact, artifactCursor, state, fullExportObservedAtBySource) {
  const fileId=String(artifact.PayloadFileId||'').trim();
  const expectedHash=String(artifact.PayloadShardHash||'').trim();
  const expectedObs=Number(artifact.ObservationCount||0);
  const expectedPayload=Number(artifact.PayloadCount||0);
  if(!fileId||!expectedHash) throw new Error('OBS_INDEX_V179_INVALID_06_IDENTITY row='+artifact.rowNumber);
  if(expectedObs!==expectedPayload) throw new Error('OBS_INDEX_V179_06_COUNT_MISMATCH fileId='+fileId);

  // v1.5.187: an immutable Drive artifact may occasionally return an incomplete
  // read without a Drive-service exception. Retry only the JSON read/parse
  // boundary. A successfully parsed artifact must still pass every existing
  // canonical hash/count/vector check; semantic evidence failures never retry.
  const envelope=qboObservationIndexV187ReadPayloadEnvelope_(fileId);
  const stableBody=envelope&&envelope.stableBody;
  if(!stableBody||typeof stableBody!=='object') throw new Error('OBS_INDEX_V179_STABLE_BODY_MISSING fileId='+fileId);
  const actualHash=qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(stableBody));
  if(actualHash!==expectedHash||String(envelope.shardHash||'')!==expectedHash)
    throw new Error('OBS_INDEX_V179_SOURCE_SHARD_HASH_MISMATCH fileId='+fileId);

  const payloads=Array.isArray(stableBody.payloads)?stableBody.payloads:[];
  const stableIds=Array.isArray(stableBody.observationIds)?stableBody.observationIds:[];
  if(payloads.length!==expectedObs||Number(stableBody.observationCount||0)!==expectedObs||stableIds.length!==payloads.length)
    throw new Error('OBS_INDEX_V179_SOURCE_COUNT_MISMATCH fileId='+fileId);
  payloads.forEach(function(p,i){
    if(!p||String(p.observationId||'')!==String(stableIds[i]||''))
      throw new Error('OBS_INDEX_V179_SOURCE_OBSERVATION_VECTOR_MISMATCH fileId='+fileId+' ordinal='+i);
  });

  qboObservationIndexV172ValidateFullExportObservedAt_(artifact,payloads,fullExportObservedAtBySource||{});

  const indexedAt=new Date(String(state.startedAt||''));
  if(isNaN(indexedAt.getTime())) throw new Error('OBS_INDEX_V179_RUN_STARTED_AT_INVALID');
  const records=payloads.map(function(p,ordinal){
    const row=qboObservationIndexV170BuildRow_(p,ordinal,artifact,indexedAt);
    const o={};
    QBO_OBSERVATION_INDEX_CONTRACT_.HEADERS.forEach(function(h,i){o[h]=qboObsIndexV175Cell_(row[i]);});
    return o;
  });
  qboObsIndexV175ValidateRecords_(records,Number(artifactCursor));

  const observationIds=records.map(function(r){return String(r.ObservationId||'');});
  const cursorToken=qboObsIndexV175Pad_(Number(artifactCursor),9);
  const hashToken=expectedHash.slice(0,16);
  const shardName=QBO_OBSERVATION_INDEX_SHARD_WRITER_V179_.FILE_PREFIX+cursorToken+'_'+hashToken+'.json';
  const lookupName=shardName.replace('.json','.lookup.json');
  const manifestName=shardName.replace('.json','.manifest.json');

  const shardStable={
    schemaVersion:QBO_OBSERVATION_INDEX_SHARD_WRITER_V179_.SHARD_SCHEMA,
    historicalRunId:String(state.runId||''),
    artifactCursor:Number(artifactCursor),
    sourceKind:'HISTORICAL_06_PAYLOAD_ARTIFACT',
    sourcePayloadFileId:fileId,
    sourcePayloadFileName:String(artifact.PayloadFileName||''),
    sourcePayloadShardHash:expectedHash,
    ingestionSourceId:String(artifact.IngestionSourceId||''),
    observationCount:records.length,
    observationIds:observationIds,
    records:records
  };
  const shardHash=qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(shardStable));

  const entityMap={};
  records.forEach(function(r,i){
    const key=String(r.EntityType||'')+'|'+String(r.EntityId||'');
    if(!entityMap[key]) entityMap[key]={entityType:String(r.EntityType||''),entityId:String(r.EntityId||''),ordinals:[],
      minObservedAt:String(r.ObservedAt||''),maxObservedAt:String(r.ObservedAt||'')};
    const e=entityMap[key], oa=String(r.ObservedAt||'');
    e.ordinals.push(i);
    if(oa<e.minObservedAt)e.minObservedAt=oa;
    if(oa>e.maxObservedAt)e.maxObservedAt=oa;
  });
  const entries=Object.keys(entityMap).sort().map(function(k){return entityMap[k];});
  const lookupStable={
    schemaVersion:QBO_OBSERVATION_INDEX_SHARD_WRITER_V179_.LOOKUP_SCHEMA,
    shardFileName:shardName,shardHash:shardHash,entityCount:entries.length,entries:entries
  };
  const lookupHash=qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(lookupStable));
  const manifestStable={
    schemaVersion:QBO_OBSERVATION_INDEX_SHARD_WRITER_V179_.MANIFEST_SCHEMA,
    historicalRunId:String(state.runId||''),artifactCursor:Number(artifactCursor),
    sourcePayloadFileId:fileId,sourcePayloadShardHash:expectedHash,
    observationCount:records.length,firstObservationId:observationIds[0]||'',
    lastObservationId:observationIds[observationIds.length-1]||'',
    shardFileName:shardName,shardHash:shardHash,
    lookupFileName:lookupName,lookupHash:lookupHash,entityCount:entries.length
  };
  const manifestHash=qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(manifestStable));
  return {records:records,observationIds:observationIds,shardName:shardName,lookupName:lookupName,manifestName:manifestName,
    shardStable:shardStable,shardHash:shardHash,lookupStable:lookupStable,lookupHash:lookupHash,
    manifestStable:manifestStable,manifestHash:manifestHash};
}


/* ============================================================================
 * v1.5.180 — controlled one-artifact shard-writer canary
 *
 * This does NOT enable the general historical worker. It advances the retained
 * historical run by exactly one artifact (cursor 1137) through immutable shard
 * storage, checkpoints only after shard + lookup + manifest are committed and
 * verified, then stops in PAUSED_SHARD_WRITER_CANARY.
 * ========================================================================== */
function recoverQboObservationIndexHistoricalShardWriterCanaryV180(){
  qboObservationIndexV170DeleteContinuationTriggers_();
  let state=qboObservationIndexV170LoadState_();
  const expectedRun='OBS_INDEX_V170|f03b49ad-69bc-4300-bf11-c769dbe72a0b';
  if(!state||String(state.runId)!==expectedRun||String(state.status)!=='FAILED'||
     Number(state.artifactCursor)!==1137||Number(state.indexedObservationCount)!==201614){
    throw new Error('OBS_INDEX_V180_CANARY_PRECONDITION_FAILED state='+JSON.stringify(state));
  }
  const artifacts=qboPayloadArtifactReadRows_();
  if(artifacts.length!==Number(state.artifactCount||0)) throw new Error('OBS_INDEX_V180_06_POPULATION_DRIFT');
  const cursor=Number(state.artifactCursor);
  const map=qboObservationIndexV172FullExportObservedAtMap_();

  state.version='1.5.180';
  state.status='RUNNING_SHARD_WRITER_CANARY';
  state.error='';
  state.lastProgressAt=new Date().toISOString();
  qboObservationIndexV170SaveState_(state);

  try{
    const result=qboObservationIndexV180CommitArtifactShard_(artifacts[cursor],cursor,state,map);
    // Durable checkpoint occurs only after all three immutable artifacts verify.
    state.artifactCursor=cursor+1;
    state.processedArtifactCount=Number(state.processedArtifactCount||0)+1;
    state.indexedObservationCount=Number(state.indexedObservationCount||0)+result.observationCount;
    state.admittedCount=Number(state.admittedCount||0)+result.admittedCount;
    state.evidenceExceptionCount=Number(state.evidenceExceptionCount||0)+result.evidenceExceptionCount;
    state.blockedCount=Number(state.blockedCount||0)+result.blockedCount;
    if(result.reconciled) state.reconciledArtifactCount=Number(state.reconciledArtifactCount||0)+1;
    state.status='PAUSED_SHARD_WRITER_CANARY';
    state.lastProgressAt=new Date().toISOString();
    state.error='';
    state.shardWriterCanary={
      artifactCursor:cursor,sourcePayloadFileId:String(artifacts[cursor].PayloadFileId||''),
      observationCount:result.observationCount,shardFileId:result.shardFileId,
      manifestFileId:result.manifestFileId,lookupFileId:result.lookupFileId,
      shardHash:result.shardHash,manifestHash:result.manifestHash,lookupHash:result.lookupHash,
      completedAt:state.lastProgressAt
    };
    qboObservationIndexV170SaveState_(state);
    console.log('[OBSERVATION INDEX SHARD WRITER V180] | CANARY_COMPLETE | '+JSON.stringify(state));
    return state;
  }catch(err){
    state.status='FAILED';
    state.error=String(err&&err.message?err.message:err);
    state.lastProgressAt=new Date().toISOString();
    qboObservationIndexV170SaveState_(state);
    qboObservationIndexV170DeleteContinuationTriggers_();
    console.error('[OBSERVATION INDEX SHARD WRITER V180] | CANARY_FAILED | '+JSON.stringify(state));
    throw err;
  }
}

const QBO_OBSERVATION_INDEX_FOLDER_RESOLUTION_V188_=Object.freeze({
  MAX_ATTEMPTS:4,
  BASE_DELAY_MS:1000
});

function qboObservationIndexV188ResolveFolders_(){
  let last=null;
  for(let attempt=1;attempt<=QBO_OBSERVATION_INDEX_FOLDER_RESOLUTION_V188_.MAX_ATTEMPTS;attempt++){
    try{return qboObsIndexV175ResolveFolders_();}
    catch(e){
      const message=String(e&&e.message?e.message:e);
      if(!/Service error:\s*Drive/i.test(message)) throw e;
      last=e;
      if(attempt<QBO_OBSERVATION_INDEX_FOLDER_RESOLUTION_V188_.MAX_ATTEMPTS)
        Utilities.sleep(QBO_OBSERVATION_INDEX_FOLDER_RESOLUTION_V188_.BASE_DELAY_MS*Math.pow(2,attempt-1));
    }
  }
  throw last||new Error('OBS_INDEX_V188_FOLDER_RESOLUTION_FAILED');
}

function qboObservationIndexV180CommitArtifactShard_(artifact,artifactCursor,state,fullExportObservedAtBySource,resolvedShardFolders){
  const prepared=qboObservationIndexV179PrepareArtifact_(artifact,artifactCursor,state,fullExportObservedAtBySource);
  const folders=resolvedShardFolders||qboObservationIndexV188ResolveFolders_();

  const shardEnvelope={stableBody:prepared.shardStable,shardHash:prepared.shardHash};
  const shard=qboObsIndexV175CreateOrVerifyJson_(folders.shards,prepared.shardName,shardEnvelope,function(existing){
    return existing&&String(existing.shardHash||'')===prepared.shardHash&&
      existing.stableBody&&Number(existing.stableBody.artifactCursor)===Number(artifactCursor)&&
      String(existing.stableBody.sourcePayloadShardHash||'')===String(artifact.PayloadShardHash||'');
  });

  // Physical lookup carries the actual immutable shard file identity.
  const lookupStable=Object.assign({},prepared.lookupStable,{shardFileId:shard.file.getId()});
  const lookupHash=qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(lookupStable));
  const lookupEnvelope={stableBody:lookupStable,lookupHash:lookupHash};
  const lookup=qboObsIndexV175CreateOrVerifyJson_(folders.lookup,prepared.lookupName,lookupEnvelope,function(existing){
    return existing&&String(existing.lookupHash||'')===lookupHash&&existing.stableBody&&
      String(existing.stableBody.shardFileId||'')===shard.file.getId()&&
      String(existing.stableBody.shardHash||'')===prepared.shardHash;
  });

  // Manifest is the commit marker and references both immutable physical files.
  const manifestStable=Object.assign({},prepared.manifestStable,{
    shardFileId:shard.file.getId(),lookupFileId:lookup.file.getId(),
    lookupHash:lookupHash
  });
  const manifestHash=qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(manifestStable));
  const manifestEnvelope={stableBody:manifestStable,manifestHash:manifestHash};
  const manifest=qboObsIndexV175CreateOrVerifyJson_(folders.manifests,prepared.manifestName,manifestEnvelope,function(existing){
    return existing&&String(existing.manifestHash||'')===manifestHash&&existing.stableBody&&
      String(existing.stableBody.shardFileId||'')===shard.file.getId()&&
      String(existing.stableBody.lookupFileId||'')===lookup.file.getId()&&
      String(existing.stableBody.shardHash||'')===prepared.shardHash&&
      String(existing.stableBody.lookupHash||'')===lookupHash;
  });

  // Re-read all three durable files before allowing the historical checkpoint.
  qboObservationIndexV180VerifyCommittedArtifact_(shard.file,lookup.file,manifest.file,
    prepared.shardHash,lookupHash,manifestHash,prepared.observationIds.length);

  // Admission counts remain authoritative from the original verified source.
  // v1.5.184 removes the unused proxy count pass.
  const source=qboObsIndexV184DriveReadRetry_(function(){
    return JSON.parse(DriveApp.getFileById(String(artifact.PayloadFileId)).getBlob().getDataAsString('UTF-8'));
  });
  const actualCounts=qboObservationIndexV170AdmissionCounts_(source.stableBody.payloads||[],artifact);
  return {
    observationCount:prepared.observationIds.length,
    admittedCount:actualCounts.admittedCount,
    evidenceExceptionCount:actualCounts.evidenceExceptionCount,
    blockedCount:actualCounts.blockedCount,
    reconciled:Boolean(shard.existed||lookup.existed||manifest.existed),
    shardFileId:shard.file.getId(),lookupFileId:lookup.file.getId(),manifestFileId:manifest.file.getId(),
    shardHash:prepared.shardHash,lookupHash:lookupHash,manifestHash:manifestHash
  };
}
function qboObservationIndexV180PayloadAdmissionProxy_(r){return {payloadKind:String(r.PayloadKind||'')};}

function qboObservationIndexV180VerifyCommittedArtifact_(shardFile,lookupFile,manifestFile,shardHash,lookupHash,manifestHash,expectedCount){
  const s=qboObsIndexV184DriveReadRetry_(function(){return JSON.parse(shardFile.getBlob().getDataAsString('UTF-8'));});
  const l=qboObsIndexV184DriveReadRetry_(function(){return JSON.parse(lookupFile.getBlob().getDataAsString('UTF-8'));});
  const m=qboObsIndexV184DriveReadRetry_(function(){return JSON.parse(manifestFile.getBlob().getDataAsString('UTF-8'));});
  if(String(s.shardHash||'')!==shardHash||
     qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(s.stableBody))!==shardHash)
    throw new Error('OBS_INDEX_V180_COMMITTED_SHARD_VERIFY_FAILED');
  if(String(l.lookupHash||'')!==lookupHash||
     qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(l.stableBody))!==lookupHash)
    throw new Error('OBS_INDEX_V180_COMMITTED_LOOKUP_VERIFY_FAILED');
  if(String(m.manifestHash||'')!==manifestHash||
     qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(m.stableBody))!==manifestHash)
    throw new Error('OBS_INDEX_V180_COMMITTED_MANIFEST_VERIFY_FAILED');
  if(Number(s.stableBody.observationCount||0)!==Number(expectedCount)||
     Number(m.stableBody.observationCount||0)!==Number(expectedCount))
    throw new Error('OBS_INDEX_V180_COMMITTED_COUNT_VERIFY_FAILED');
  if(String(l.stableBody.shardFileId||'')!==shardFile.getId()||
     String(m.stableBody.shardFileId||'')!==shardFile.getId()||
     String(m.stableBody.lookupFileId||'')!==lookupFile.getId())
    throw new Error('OBS_INDEX_V180_COMMITTED_REFERENCE_VERIFY_FAILED');
}


/* ============================================================================
 * v1.5.181 — controlled resumable historical shard drain
 *
 * Resumes ONLY the exact v1.5.180 canary checkpoint. The legacy sheet writer
 * remains retired for this path. Each 06 artifact commits:
 *   shard -> lookup -> manifest -> durable verification -> checkpoint.
 * A single continuation chain drains bounded work. Completion stops in
 * COMPLETE_SHARDED_PENDING_RECONCILIATION; it does not retire legacy 07 or
 * enable State Application.
 * ========================================================================== */
const QBO_OBSERVATION_INDEX_SHARD_DRAIN_V181_=Object.freeze({
  VERSION:'1.5.181',
  CONTINUATION_HANDLER:'qboObservationIndexHistoricalShardDrainV181Continuation_',
  CONTINUATION_DELAY_MS:60000,
  RUNTIME_BUDGET_MS:180000,
  MAX_ARTIFACTS_PER_INVOCATION:20,
  MAX_OBSERVATIONS_PER_INVOCATION:5000
});

function recoverQboObservationIndexHistoricalShardDrainV181(){
  qboObservationIndexV181DeleteContinuationTriggers_();
  qboObservationIndexV170DeleteContinuationTriggers_();
  const state=qboObservationIndexV170LoadState_();
  const expectedRun='OBS_INDEX_V170|f03b49ad-69bc-4300-bf11-c769dbe72a0b';
  const canaryBoundary=state&&String(state.status)==='PAUSED_SHARD_WRITER_CANARY'&&
    Number(state.artifactCursor)===1138&&Number(state.processedArtifactCount)===1138&&
    Number(state.indexedObservationCount)===201864&&state.shardWriterCanary;
  const governedFailureBoundary=state&&String(state.status)==='FAILED_SHARD_DRAIN'&&
    Number(state.artifactCursor)===1300&&Number(state.processedArtifactCount)===1300&&
    Number(state.indexedObservationCount)===235106&&
    String(state.error||'').indexOf('OBSERVATION_INDEX_V172_FULL_EXPORT_SOURCE_COMPLETED_AT_NOT_FOUND sourceId=FULL_EXPORT|STATE_CAPTURE_AUTOREG_TEST_')===0;
  const drivePartialBoundary=state&&String(state.status)==='FAILED_SHARD_DRAIN'&&
    Number(state.artifactCursor)===1864&&Number(state.processedArtifactCount)===1864&&
    Number(state.indexedObservationCount)===363554&&Number(state.admittedCount)===363510&&
    Number(state.evidenceExceptionCount)===24&&Number(state.blockedCount)===20&&
    Number(state.governedExcludedObservationCount||0)===55&&
    String(state.error||'')==='Service error: Drive';
  const transientInvalidJsonBoundary=state&&String(state.status)==='FAILED_SHARD_DRAIN'&&
    Number(state.artifactCursor)===2540&&Number(state.processedArtifactCount)===2540&&
    Number(state.indexedObservationCount)===517762&&Number(state.admittedCount)===517706&&
    Number(state.evidenceExceptionCount)===36&&Number(state.blockedCount)===20&&
    Number(state.governedExcludedObservationCount||0)===55&&
    String(state.error||'')==='OBS_INDEX_V179_INVALID_JSON fileId=12EY1mLyXBeWti1fffyxTyO-6CefuoZnU';
  const transientFolderResolutionBoundary=state&&String(state.status)==='FAILED_SHARD_DRAIN'&&
    Number(state.artifactCursor)===3132&&Number(state.processedArtifactCount)===3132&&
    Number(state.indexedObservationCount)===658432&&Number(state.admittedCount)===658364&&
    Number(state.evidenceExceptionCount)===48&&Number(state.blockedCount)===20&&
    Number(state.reconciledArtifactCount||0)===1&&
    Number(state.governedExcludedObservationCount||0)===55&&
    String(state.error||'')==='Service error: Drive';
  if(!state||String(state.runId)!==expectedRun||
     (!canaryBoundary&&!governedFailureBoundary&&!drivePartialBoundary&&!transientInvalidJsonBoundary&&!transientFolderResolutionBoundary)){
    throw new Error('OBS_INDEX_V188_RECOVERY_PRECONDITION_FAILED state='+JSON.stringify(state));
  }
  const artifacts=qboPayloadArtifactReadRows_();
  const total=artifacts.reduce(function(n,r){return n+Number(r.ObservationCount||0);},0);
  if(artifacts.length!==Number(state.artifactCount)||total!==Number(state.expectedObservationCount))
    throw new Error('OBS_INDEX_V181_FROZEN_POPULATION_DRIFT artifacts='+artifacts.length+' observations='+total);

  state.version='1.5.188';
  state.status='RUNNING_SHARD_DRAIN';
  state.error='';
  state.lastProgressAt=new Date().toISOString();
  qboObservationIndexV170SaveState_(state);
  console.log('[OBSERVATION INDEX SHARD DRAIN V181] | RECOVERED | '+JSON.stringify(state));
  return qboObservationIndexHistoricalShardDrainV181Worker_();
}

function qboObservationIndexHistoricalShardDrainV181Continuation_(e){
  // v1.5.185: a fired one-time trigger is not a prerequisite cleanup target.
  // Mark the governed scheduled trigger as consumed, then let the worker make
  // progress. Failure to clean stale trigger objects must never strand the drain.
  qboObservationIndexV185MarkContinuationConsumed_(e);
  return qboObservationIndexHistoricalShardDrainV181Worker_();
}

function qboObservationIndexHistoricalShardDrainV181Worker_(){
  const started=Date.now(),state=qboObservationIndexV170LoadState_();
  if(!state||String(state.status)!=='RUNNING_SHARD_DRAIN'){
    console.log('[OBSERVATION INDEX SHARD DRAIN V181] | NOOP | '+JSON.stringify(state));
    return state;
  }
  try{
    const artifacts=qboPayloadArtifactReadRows_();
    if(artifacts.length!==Number(state.artifactCount))
      throw new Error('OBS_INDEX_V181_06_POPULATION_DRIFT expected='+state.artifactCount+' actual='+artifacts.length);
    const map=qboObservationIndexV172FullExportObservedAtMap_();
  const resolvedShardFolders=qboObservationIndexV188ResolveFolders_();
    let invocationArtifacts=0,invocationObs=0;

    while(Number(state.artifactCursor)<artifacts.length &&
          Date.now()-started<QBO_OBSERVATION_INDEX_SHARD_DRAIN_V181_.RUNTIME_BUDGET_MS &&
          invocationArtifacts<QBO_OBSERVATION_INDEX_SHARD_DRAIN_V181_.MAX_ARTIFACTS_PER_INVOCATION &&
          invocationObs<QBO_OBSERVATION_INDEX_SHARD_DRAIN_V181_.MAX_OBSERVATIONS_PER_INVOCATION){
      const cursor=Number(state.artifactCursor),artifact=artifacts[cursor];
      if(qboObservationIndexV182IsGovernedControlledTestOrphan_(artifact,map)){
        const excluded=qboObservationIndexV182VerifyControlledTestOrphan_(artifact,cursor);
        // Governed exclusion consumes the physical 06 artifact but creates no
        // logical-07 observation. Never synthesize ObservedAt.
        state.artifactCursor=cursor+1;
        state.processedArtifactCount=Number(state.processedArtifactCount||0)+1;
        state.governedExcludedArtifactCount=Number(state.governedExcludedArtifactCount||0)+1;
        state.governedExcludedObservationCount=Number(state.governedExcludedObservationCount||0)+excluded.observationCount;
        state.governedExcludedPayloadCount=Number(state.governedExcludedPayloadCount||0)+excluded.payloadCount;
        state.lastGovernedExclusion={
          classification:'CONTROLLED_TEST_ORPHAN',
          artifactCursor:cursor,
          ingestionSourceId:String(artifact.IngestionSourceId||''),
          payloadFileId:String(artifact.PayloadFileId||''),
          observationCount:excluded.observationCount,
          excludedAt:new Date().toISOString()
        };
        state.lastProgressAt=state.lastGovernedExclusion.excludedAt;state.error='';
        qboObservationIndexV170SaveState_(state);
        invocationArtifacts++;invocationObs+=excluded.observationCount;
        console.log('[OBSERVATION INDEX SHARD DRAIN V182] | GOVERNED_EXCLUSION | '+JSON.stringify(state.lastGovernedExclusion));
        continue;
      }

      const result=qboObservationIndexV180CommitArtifactShard_(artifact,cursor,state,map,resolvedShardFolders);
      // Checkpoint only after shard/lookup/manifest durable verification.
      state.artifactCursor=cursor+1;
      state.processedArtifactCount=Number(state.processedArtifactCount||0)+1;
      state.indexedObservationCount=Number(state.indexedObservationCount||0)+result.observationCount;
      state.admittedCount=Number(state.admittedCount||0)+result.admittedCount;
      state.evidenceExceptionCount=Number(state.evidenceExceptionCount||0)+result.evidenceExceptionCount;
      state.blockedCount=Number(state.blockedCount||0)+result.blockedCount;
      if(result.reconciled)state.reconciledArtifactCount=Number(state.reconciledArtifactCount||0)+1;
      state.lastProgressAt=new Date().toISOString();state.error='';
      qboObservationIndexV170SaveState_(state);
      invocationArtifacts++;invocationObs+=result.observationCount;
    }

    if(Number(state.artifactCursor)>=artifacts.length){
      qboObservationIndexV185BestEffortDeleteContinuationTriggers_('');
      state.scheduledContinuationTriggerId='';
      state.status='COMPLETE_SHARDED_PENDING_RECONCILIATION';
      state.completedAt=new Date().toISOString();
      state.error='';
      qboObservationIndexV170SaveState_(state);
      console.log('[OBSERVATION INDEX SHARD DRAIN V181] | DRAIN_COMPLETE | '+JSON.stringify(state));
      return state;
    }

    qboObservationIndexV181InstallContinuation_(state);
    console.log('[OBSERVATION INDEX SHARD DRAIN V181] | PROGRESS | '+JSON.stringify({
      version:state.version,status:state.status,runId:state.runId,artifactCursor:state.artifactCursor,
      artifactCount:state.artifactCount,indexedObservationCount:state.indexedObservationCount,
      expectedObservationCount:state.expectedObservationCount,admittedCount:state.admittedCount,
      evidenceExceptionCount:state.evidenceExceptionCount,blockedCount:state.blockedCount,
      invocationArtifacts:invocationArtifacts,invocationObservations:invocationObs,lastProgressAt:state.lastProgressAt
    }));
    return state;
  }catch(err){
    state.status='FAILED_SHARD_DRAIN';
    state.error=String(err&&err.message?err.message:err);
    state.lastProgressAt=new Date().toISOString();
    qboObservationIndexV170SaveState_(state);
    qboObservationIndexV185BestEffortDeleteContinuationTriggers_('');
    console.error('[OBSERVATION INDEX SHARD DRAIN V181] | FAILED | '+JSON.stringify(state));
    throw err;
  }
}


function qboObservationIndexV182IsGovernedControlledTestOrphan_(artifact,fullExportObservedAtBySource){
  const sid=String(artifact&&artifact.IngestionSourceId||'').trim();
  if(!/^FULL_EXPORT\|STATE_CAPTURE_AUTOREG_TEST_[^|]+\|[^|]+$/.test(sid)) return false;
  // A controlled-test source is excludable only when its governed 01 source
  // registration is absent. If retained source chronology exists, process it
  // normally instead of excluding it.
  return !Object.prototype.hasOwnProperty.call(fullExportObservedAtBySource||{},sid);
}

function qboObservationIndexV182VerifyControlledTestOrphan_(artifact,artifactCursor){
  const sid=String(artifact.IngestionSourceId||'').trim();
  if(!/^FULL_EXPORT\|STATE_CAPTURE_AUTOREG_TEST_[^|]+\|[^|]+$/.test(sid))
    throw new Error('OBS_INDEX_V182_EXCLUSION_NOT_CONTROLLED_TEST sourceId='+sid);
  const fileId=String(artifact.PayloadFileId||'').trim();
  const expectedHash=String(artifact.PayloadShardHash||'').trim();
  if(!fileId||!expectedHash) throw new Error('OBS_INDEX_V182_EXCLUSION_IDENTITY_MISSING cursor='+artifactCursor);
  const envelope=JSON.parse(DriveApp.getFileById(fileId).getBlob().getDataAsString('UTF-8'));
  const stableBody=envelope&&envelope.stableBody;
  if(!stableBody||typeof stableBody!=='object') throw new Error('OBS_INDEX_V182_EXCLUSION_STABLE_BODY_MISSING fileId='+fileId);
  const actualHash=qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(stableBody));
  if(actualHash!==expectedHash||String(envelope.shardHash||'')!==expectedHash)
    throw new Error('OBS_INDEX_V182_EXCLUSION_SOURCE_HASH_MISMATCH fileId='+fileId);
  const payloads=Array.isArray(stableBody.payloads)?stableBody.payloads:[];
  const ids=Array.isArray(stableBody.observationIds)?stableBody.observationIds:[];
  const obs=Number(artifact.ObservationCount||0), pc=Number(artifact.PayloadCount||0);
  if(obs!==pc||payloads.length!==obs||ids.length!==obs||
     Number(stableBody.observationCount||0)!==obs)
    throw new Error('OBS_INDEX_V182_EXCLUSION_COUNT_MISMATCH fileId='+fileId);
  payloads.forEach(function(p,i){
    if(!p||String(p.observationId||'')!==String(ids[i]||''))
      throw new Error('OBS_INDEX_V182_EXCLUSION_OBSERVATION_VECTOR_MISMATCH fileId='+fileId+' ordinal='+i);
  });
  return {observationCount:obs,payloadCount:pc};
}

function qboObservationIndexV181InstallContinuation_(state){
  // v1.5.185 create-first contract: scheduling continuity is established before
  // stale-trigger cleanup is attempted. Cleanup is best-effort only.
  const trigger=ScriptApp.newTrigger(QBO_OBSERVATION_INDEX_SHARD_DRAIN_V181_.CONTINUATION_HANDLER)
    .timeBased().after(QBO_OBSERVATION_INDEX_SHARD_DRAIN_V181_.CONTINUATION_DELAY_MS).create();
  const id=String(trigger.getUniqueId()||'');
  state=state||qboObservationIndexV170LoadState_();
  if(state){
    state.version='1.5.188';
    state.scheduledContinuationTriggerId=id;
    state.continuationScheduledAt=new Date().toISOString();
    qboObservationIndexV170SaveState_(state);
  }
  qboObservationIndexV185BestEffortDeleteContinuationTriggers_(id);
  return id;
}
function qboObservationIndexV181DeleteContinuationTriggers_(){
  // Compatibility helper. Trigger cleanup is no longer allowed to be fatal.
  return qboObservationIndexV185BestEffortDeleteContinuationTriggers_('');
}
function qboObservationIndexV185BestEffortDeleteContinuationTriggers_(preserveId){
  const result={deleted:0,failed:0,listFailed:false,errors:[]};
  let triggers=[];
  try{triggers=ScriptApp.getProjectTriggers();}
  catch(e){
    result.listFailed=true;result.errors.push(String(e&&e.message?e.message:e));
    console.warn('[OBSERVATION INDEX SHARD DRAIN V185] | TRIGGER_CLEANUP_LIST_WARNING | '+JSON.stringify(result));
    return result;
  }
  triggers.forEach(function(t){
    try{
      if(t.getHandlerFunction()!==QBO_OBSERVATION_INDEX_SHARD_DRAIN_V181_.CONTINUATION_HANDLER)return;
      const id=String(t.getUniqueId()||'');
      if(preserveId&&id===preserveId)return;
      ScriptApp.deleteTrigger(t);result.deleted++;
    }catch(e){
      result.failed++;result.errors.push(String(e&&e.message?e.message:e));
    }
  });
  if(result.failed)console.warn('[OBSERVATION INDEX SHARD DRAIN V185] | TRIGGER_CLEANUP_WARNING | '+JSON.stringify(result));
  return result;
}
function qboObservationIndexV185MarkContinuationConsumed_(e){
  const s=qboObservationIndexV170LoadState_();
  if(!s)return;
  const firedId=String(e&&e.triggerUid||'');
  const governed=String(s.scheduledContinuationTriggerId||'');
  if(!firedId||!governed||firedId===governed){
    s.scheduledContinuationTriggerId='';
    s.continuationConsumedAt=new Date().toISOString();
    s.version='1.5.185';
    qboObservationIndexV170SaveState_(s);
  }
}
function statusQboObservationIndexHistoricalShardDrainV181(){
  const s=qboObservationIndexV170LoadState_();
  let triggers=[],triggerServiceError='';
  try{
    triggers=ScriptApp.getProjectTriggers().filter(function(t){
      return t.getHandlerFunction()===QBO_OBSERVATION_INDEX_SHARD_DRAIN_V181_.CONTINUATION_HANDLER;
    });
  }catch(e){triggerServiceError=String(e&&e.message?e.message:e);}
  const governedId=s?String(s.scheduledContinuationTriggerId||''):'';
  const ids=triggers.map(function(t){return String(t.getUniqueId()||'');});
  const out={state:s,continuationTriggerCount:triggers.length,continuationTriggerIds:ids,
    governedScheduledContinuationTriggerId:governedId,
    governedScheduledTriggerPresent:!!governedId&&ids.indexOf(governedId)>=0,
    triggerServiceError:triggerServiceError};
  console.log('[OBSERVATION INDEX SHARD DRAIN V181] | STATUS | '+JSON.stringify(out));
  return out;
}

/**
 * Governed one-time reseed for the exact v1.5.184 stranded RUNNING boundary.
 * It creates a future continuation first, persists its trigger ID, and only
 * then attempts non-fatal cleanup of stale trigger objects.
 */
function reseedQboObservationIndexHistoricalShardDrainV185(){
  const s=qboObservationIndexV170LoadState_();
  if(!s||String(s.runId)!=='OBS_INDEX_V170|f03b49ad-69bc-4300-bf11-c769dbe72a0b'||
     String(s.status)!=='RUNNING_SHARD_DRAIN'||Number(s.artifactCursor)!==2062||
     Number(s.processedArtifactCount)!==2062||Number(s.indexedObservationCount)!==408363||
     Number(s.admittedCount)!==408315||Number(s.evidenceExceptionCount)!==28||
     Number(s.blockedCount)!==20||Number(s.governedExcludedObservationCount||0)!==55||
     String(s.error||'')!=='')
    throw new Error('OBS_INDEX_V185_RESEED_PRECONDITION_FAILED state='+JSON.stringify(s));
  const current=String(s.scheduledContinuationTriggerId||'');
  if(current)throw new Error('OBS_INDEX_V185_GOVERNED_CONTINUATION_ALREADY_RECORDED id='+current);
  const id=qboObservationIndexV181InstallContinuation_(s);
  console.log('[OBSERVATION INDEX SHARD DRAIN V185] | RESEEDED | '+JSON.stringify({
    version:'1.5.185',runId:s.runId,artifactCursor:s.artifactCursor,indexedObservationCount:s.indexedObservationCount,
    scheduledContinuationTriggerId:id,status:s.status}));
  return statusQboObservationIndexHistoricalShardDrainV181();
}
