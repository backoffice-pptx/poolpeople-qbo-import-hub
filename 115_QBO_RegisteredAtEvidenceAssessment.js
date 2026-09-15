/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 115_QBO_RegisteredAtEvidenceAssessment.js
 * Version     : 1.5.84
 * Purpose     : Read-only production-data assessment of exact recovery evidence
 *               for blank 05_Forward_Ingestion_Control.RegisteredAt values.
 *
 * Safety / doctrine:
 *   - Does NOT repair any production/state value.
 *   - Writes only diagnostic output to 98_RegisteredAt_Evidence_Assessment.
 *   - Uses the writer contract itself: Native CDC registration captures ONE
 *     registeredAt timestamp for the entire cycle, in both the current and
 *     historical registration paths. Therefore a unique nonblank sibling
 *     RegisteredAt within the same Native CDC SourceRunId is exact evidence for
 *     blank siblings in that cycle.
 *   - Does NOT substitute RequestCompletedAt, manifest timestamps, webhook
 *     receivedAt, ingestion-log timestamps, or other proximate times.
 *   - Webhook historical registration calls new Date() per event, so sibling
 *     events do not establish exact RegisteredAt equivalence.
 * ============================================================================
 */

const QBO_REGISTERED_AT_EVIDENCE_ASSESSMENT_ = Object.freeze({
  VERSION: 'QBO_REGISTERED_AT_EVIDENCE_ASSESSMENT_V1_5_84_ARTIFACT_CORRELATION',
  SHEET_NAME: '98_RegisteredAt_Evidence_Assessment',
  HEADERS: Object.freeze([
    'AssessmentRunId','AuditRunId','IngestionSourceId','SourceType','SourceRunId',
    'EntityType','TargetRowNumber','ProcessingStatus','RequestCompletedAt',
    'CurrentRegisteredAt','Assessment','CandidateRegisteredAt','EvidenceBasis',
    'SiblingRowCount','NonblankSiblingCount','DistinctSiblingRegisteredAtCount',
    'SiblingEvidenceRows','EvidenceFileId','EvidenceFileName','EvidenceFileCreatedAt',
    'EvidenceFileCreatedDeltaMsToReferenceRegisteredAt','PayloadShardCount',
    'EarliestPayloadEnvelopeCreatedAt','EarliestPayloadDriveCreatedAt',
    'PayloadEnvelopeDeltaMsToReferenceRegisteredAt','PayloadDriveDeltaMsToReferenceRegisteredAt',
    'PayloadFileNameSemantics','ArtifactEvidenceAssessment','ExactRepairEligible','Detail','AssessedAt'
  ]),
  EXACT: 'EXACT_RECOVERABLE',
  NOT_RECOVERABLE: 'HISTORICAL_TIMESTAMP_NOT_RECOVERABLE',
  REVIEW: 'SOURCE_EVIDENCE_REVIEW_REQUIRED'
});

function assessQboBlankRegisteredAtRecoveryEvidence() {
  const ss = getQboStateCaptureSpreadsheet_();
  const startedAt = new Date();
  const assessmentRunId = 'REGISTERED_AT_EVIDENCE|' + Utilities.getUuid();
  const latestAuditRunId = qboRegisteredAtLatestAuditRunId_(ss);
  if (!latestAuditRunId) throw new Error('REGISTERED_AT_EVIDENCE_NO_AUDIT_RUN');

  const target = ss.getSheetByName(QBO_FORWARD_INGESTION_CONTROL_.SHEET_NAME);
  if (!target || target.getLastRow() < 2) throw new Error('REGISTERED_AT_EVIDENCE_LEDGER_EMPTY');
  const headers = target.getRange(1,1,1,target.getLastColumn()).getValues()[0].map(function(v){return String(v||'').trim();});
  const idx = qboRegisteredAtIndex_(headers, [
    'IngestionSourceId','SourceType','SourceRunId','EntityType','ProcessingStatus',
    'RequestCompletedAt','RegisteredAt','EvidenceFileId','EvidenceFileName'
  ]);
  const values = target.getRange(2,1,target.getLastRow()-1,target.getLastColumn()).getValues();
  const rows = values.map(function(r,i){
    return {
      rowNumber:i+2,
      IngestionSourceId:String(r[idx.IngestionSourceId]||'').trim(),
      SourceType:String(r[idx.SourceType]||'').trim(),
      SourceRunId:String(r[idx.SourceRunId]||'').trim(),
      EntityType:String(r[idx.EntityType]||'').trim(),
      ProcessingStatus:String(r[idx.ProcessingStatus]||'').trim(),
      RequestCompletedAt:r[idx.RequestCompletedAt],
      RegisteredAt:r[idx.RegisteredAt],
      EvidenceFileId:String(r[idx.EvidenceFileId]||'').trim(),
      EvidenceFileName:String(r[idx.EvidenceFileName]||'').trim()
    };
  });

  const auditTargets = qboRegisteredAtReadLatestAuditTargets_(ss, latestAuditRunId);
  const targetIds = Object.create(null);
  auditTargets.forEach(function(f){ targetIds[f.recordId] = true; });
  const candidates = rows.filter(function(r){ return targetIds[r.IngestionSourceId] && !qboRegisteredAtDate_(r.RegisteredAt); });

  const nativeByCycle = Object.create(null);
  rows.filter(function(r){return r.SourceType === 'NATIVE_CDC';}).forEach(function(r){
    if (!nativeByCycle[r.SourceRunId]) nativeByCycle[r.SourceRunId] = [];
    nativeByCycle[r.SourceRunId].push(r);
  });

  // Artifact correlation is deliberately evidentiary only. The Change Payload
  // file name is a SHA-256 content identity, not a timestamp. Its envelope
  // createdAt and Drive created time are captured later during payload
  // persistence with independent clocks, so they cannot become exact
  // RegisteredAt substitutes merely because they are temporally close.
  const artifactWanted = Object.create(null);
  candidates.forEach(function(r){ artifactWanted[r.IngestionSourceId] = true; });
  Object.keys(nativeByCycle).forEach(function(cycleId){
    const cycleHasCandidate = (nativeByCycle[cycleId] || []).some(function(r){ return artifactWanted[r.IngestionSourceId]; });
    if (cycleHasCandidate) (nativeByCycle[cycleId] || []).forEach(function(r){ artifactWanted[r.IngestionSourceId] = true; });
  });
  const payloadArtifactIndex = qboRegisteredAtBuildPayloadArtifactIndex_(artifactWanted);
  const evidenceFileIndex = qboRegisteredAtBuildEvidenceFileIndex_(rows, artifactWanted);

  const assessed = candidates.map(function(r){
    const base = {
      row:r,
      assessment:QBO_REGISTERED_AT_EVIDENCE_ASSESSMENT_.REVIEW,
      candidate:'',
      basis:'',
      siblingRowCount:0,
      nonblankSiblingCount:0,
      distinctCount:0,
      siblingEvidenceRows:'',
      exactRepairEligible:false,
      evidenceFileCreatedAt:'',
      evidenceFileDeltaMs:'',
      payloadShardCount:0,
      earliestPayloadEnvelopeCreatedAt:'',
      earliestPayloadDriveCreatedAt:'',
      payloadEnvelopeDeltaMs:'',
      payloadDriveDeltaMs:'',
      payloadFileNameSemantics:'SHA256_CONTENT_HASH_ONLY_NO_TIMESTAMP',
      artifactEvidenceAssessment:'CORROBORATING_ONLY_NOT_EXACT',
      detail:''
    };

    if (r.SourceType === 'NATIVE_CDC') {
      const siblings = nativeByCycle[r.SourceRunId] || [];
      const observed = Object.create(null);
      const evidenceRows = [];
      siblings.forEach(function(s){
        const iso = qboRegisteredAtIso_(s.RegisteredAt);
        if (!iso) return;
        observed[iso] = true;
        evidenceRows.push(s.rowNumber + ':' + s.EntityType + '=' + iso);
      });
      const distinct = Object.keys(observed);
      base.siblingRowCount = siblings.length;
      base.nonblankSiblingCount = evidenceRows.length;
      base.distinctCount = distinct.length;
      base.siblingEvidenceRows = evidenceRows.join(';');
      if (distinct.length === 1) {
        base.assessment = QBO_REGISTERED_AT_EVIDENCE_ASSESSMENT_.EXACT;
        base.candidate = distinct[0];
        base.basis = 'NATIVE_CDC_SAME_CYCLE_SHARED_REGISTERED_AT_WRITER_CONTRACT';
        base.exactRepairEligible = true;
        base.detail = 'Exact sibling evidence exists. Both 104 current registration and 105 historical registration capture one registeredAt value before iterating all entityEvidence for a cycle, so every entity row in SourceRunId=' + r.SourceRunId + ' is contractually assigned the same timestamp.';
      } else if (distinct.length === 0) {
        base.assessment = QBO_REGISTERED_AT_EVIDENCE_ASSESSMENT_.NOT_RECOVERABLE;
        base.basis = 'NO_DURABLE_SAME_CYCLE_REGISTERED_AT_SURVIVES';
        base.detail = 'All Native CDC rows in this cycle lack RegisteredAt. RequestCompletedAt and manifest/run timestamps are different events and are not exact registration evidence. The historical backfill state stores cycle progress but not cycleResult.registeredAt.';
      } else {
        base.assessment = QBO_REGISTERED_AT_EVIDENCE_ASSESSMENT_.REVIEW;
        base.basis = 'CONFLICTING_SAME_CYCLE_REGISTERED_AT_VALUES';
        base.detail = 'Multiple distinct nonblank RegisteredAt values exist inside a Native CDC cycle even though the writer contract assigns one shared timestamp. Manual/source review is required; no repair candidate is authorized.';
      }
      return base;
    }

    if (r.SourceType === 'WEBHOOK') {
      base.assessment = QBO_REGISTERED_AT_EVIDENCE_ASSESSMENT_.NOT_RECOVERABLE;
      base.basis = 'WEBHOOK_REGISTERED_AT_CAPTURED_PER_EVENT';
      base.detail = 'Webhook historical registration invokes new Date() for each event registration. Receipt receivedAt / RequestCompletedAt is not the registration timestamp, and sibling events cannot prove the exact missing value.';
      return base;
    }

    if (r.SourceType === 'FULL_EXPORT') {
      base.assessment = QBO_REGISTERED_AT_EVIDENCE_ASSESSMENT_.REVIEW;
      base.basis = 'FULL_EXPORT_REQUIRES_01_SOURCES_EXACT_MATCH_REVIEW';
      base.detail = 'FULL_EXPORT RegisteredAt recovery is governed separately by exact 01_Sources.RegisteredAt identity evidence. This diagnostic does not broaden that repair contract.';
      return base;
    }

    base.assessment = QBO_REGISTERED_AT_EVIDENCE_ASSESSMENT_.REVIEW;
    base.basis = 'UNSUPPORTED_SOURCE_TYPE';
    base.detail = 'No exact RegisteredAt recovery contract has been established for SourceType=' + r.SourceType + '.';
    return base;
  });

  assessed.forEach(function(a){
    qboRegisteredAtAttachArtifactEvidence_(a, evidenceFileIndex, payloadArtifactIndex);
  });

  qboRegisteredAtPersist_(ss, assessmentRunId, latestAuditRunId, assessed);

  const counts = Object.create(null);
  const exactBySource = Object.create(null);
  assessed.forEach(function(a){
    counts[a.assessment] = Number(counts[a.assessment]||0) + 1;
    if (a.exactRepairEligible) exactBySource[a.row.SourceType] = Number(exactBySource[a.row.SourceType]||0) + 1;
  });
  const nativeCycles = Object.create(null);
  assessed.filter(function(a){return a.row.SourceType==='NATIVE_CDC';}).forEach(function(a){
    if (!nativeCycles[a.row.SourceRunId]) nativeCycles[a.row.SourceRunId] = {assessment:a.assessment, blankRows:0, distinctSiblingRegisteredAtCount:a.distinctCount, candidate:a.candidate};
    nativeCycles[a.row.SourceRunId].blankRows += 1;
  });

  const artifactCalibration = qboRegisteredAtArtifactCalibration_(rows, artifactWanted, evidenceFileIndex, payloadArtifactIndex);

  const result = {
    version:QBO_REGISTERED_AT_EVIDENCE_ASSESSMENT_.VERSION,
    productionDataReadOnly:true,
    diagnosticOutputWritten:true,
    auditRunId:latestAuditRunId,
    assessmentRunId:assessmentRunId,
    blankRegisteredAtFindingCount:auditTargets.length,
    currentlyBlankAssessedCount:assessed.length,
    assessmentCounts:counts,
    exactRepairEligibleBySourceType:exactBySource,
    nativeCdcCycleCount:Object.keys(nativeCycles).length,
    nativeCdcCycleSummary:nativeCycles,
    artifactCorrelationCalibration:artifactCalibration,
    payloadFileNameTimestampBearing:false,
    payloadFileNameContract:'qbo_change_payload_shard_<SHA256>.json',
    payloadArtifactExactRepairAuthorized:false,
    outputSheet:QBO_REGISTERED_AT_EVIDENCE_ASSESSMENT_.SHEET_NAME,
    startedAt:startedAt.toISOString(),
    completedAt:new Date().toISOString(),
    repairApplied:false,
    productionDataMutationApplied:false
  };
  console.log('[REGISTERED AT EVIDENCE] | COMPLETE | ' + JSON.stringify(result));
  return result;
}

function qboRegisteredAtReadLatestAuditTargets_(ss, auditRunId) {
  const sh = ss.getSheetByName(QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.FINDING_SHEET);
  if (!sh || sh.getLastRow() < 2) throw new Error('REGISTERED_AT_EVIDENCE_FINDINGS_MISSING');
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(function(v){return String(v||'').trim();});
  const idx = qboRegisteredAtIndex_(headers,['AuditRunId','Result','SheetName','ColumnOrRule','FindingCode','RecordId']);
  return sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).getValues().filter(function(r){
    return String(r[idx.AuditRunId]||'').trim()===auditRunId &&
      String(r[idx.Result]||'').trim()==='INVALID' &&
      String(r[idx.SheetName]||'').trim()===QBO_FORWARD_INGESTION_CONTROL_.SHEET_NAME &&
      String(r[idx.ColumnOrRule]||'').trim()==='RegisteredAt' &&
      String(r[idx.FindingCode]||'').trim()==='REQUIRED_DATE_BLANK';
  }).map(function(r){return {recordId:String(r[idx.RecordId]||'').trim()};});
}

function qboRegisteredAtLatestAuditRunId_(ss) {
  const sh = ss.getSheetByName(QBO_STATE_CAPTURE_WORKBOOK_AUDIT_.RUN_SHEET);
  if (!sh || sh.getLastRow() < 2) return '';
  const headers = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(function(v){return String(v||'').trim();});
  const idx = qboRegisteredAtIndex_(headers,['AuditRunId','CompletedAt']);
  const values = sh.getRange(2,1,sh.getLastRow()-1,sh.getLastColumn()).getValues();
  let best='', bestMs=-1;
  values.forEach(function(r){
    const id=String(r[idx.AuditRunId]||'').trim();
    const d=qboRegisteredAtDate_(r[idx.CompletedAt]);
    if(id && d && d.getTime()>=bestMs){best=id;bestMs=d.getTime();}
  });
  return best;
}

function qboRegisteredAtPersist_(ss, assessmentRunId, auditRunId, assessed) {
  let sh=ss.getSheetByName(QBO_REGISTERED_AT_EVIDENCE_ASSESSMENT_.SHEET_NAME);
  const h=QBO_REGISTERED_AT_EVIDENCE_ASSESSMENT_.HEADERS;
  if(!sh){
    sh=ss.insertSheet(QBO_REGISTERED_AT_EVIDENCE_ASSESSMENT_.SHEET_NAME);
    sh.getRange(1,1,1,h.length).setValues([h]);
    sh.setFrozenRows(1);
    sh.getRange(1,1,1,h.length).setFontWeight('bold');
    sh.getDataRange().setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  } else {
    if(sh.getLastColumn()<h.length) throw new Error('REGISTERED_AT_EVIDENCE_HEADER_WIDTH_MISMATCH');
    const actual=sh.getRange(1,1,1,h.length).getValues()[0].map(function(v){return String(v||'').trim();});
    h.forEach(function(x,i){if(actual[i]!==x) throw new Error('REGISTERED_AT_EVIDENCE_HEADER_MISMATCH col='+(i+1));});
  }
  if(!assessed.length) return;
  const at=new Date();
  const out=assessed.map(function(a){
    const r=a.row;
    return [assessmentRunId,auditRunId,r.IngestionSourceId,r.SourceType,r.SourceRunId,r.EntityType,r.rowNumber,r.ProcessingStatus,r.RequestCompletedAt,r.RegisteredAt,a.assessment,a.candidate,a.basis,a.siblingRowCount,a.nonblankSiblingCount,a.distinctCount,a.siblingEvidenceRows,r.EvidenceFileId,r.EvidenceFileName,a.evidenceFileCreatedAt,a.evidenceFileDeltaMs,a.payloadShardCount,a.earliestPayloadEnvelopeCreatedAt,a.earliestPayloadDriveCreatedAt,a.payloadEnvelopeDeltaMs,a.payloadDriveDeltaMs,a.payloadFileNameSemantics,a.artifactEvidenceAssessment,a.exactRepairEligible,a.detail,at];
  });
  sh.getRange(sh.getLastRow()+1,1,out.length,h.length).setValues(out);
  sh.getDataRange().setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
}

function qboRegisteredAtIndex_(headers, required) {
  const idx=Object.create(null);
  headers.forEach(function(h,i){idx[h]=i;});
  required.forEach(function(h){if(idx[h]===undefined) throw new Error('REGISTERED_AT_EVIDENCE_HEADER_MISSING '+h);});
  return idx;
}
function qboRegisteredAtDate_(v){if(v instanceof Date&&!isNaN(v.getTime()))return new Date(v.getTime());if(v===null||v===undefined||String(v).trim()==='')return null;const d=new Date(v);return isNaN(d.getTime())?null:d;}
function qboRegisteredAtIso_(v){const d=qboRegisteredAtDate_(v);return d?d.toISOString():'';}


function qboRegisteredAtBuildEvidenceFileIndex_(rows, wanted) {
  const out = Object.create(null);
  rows.forEach(function(r) {
    if (!wanted[r.IngestionSourceId] || !r.EvidenceFileId || out[r.IngestionSourceId]) return;
    try {
      const file = DriveApp.getFileById(r.EvidenceFileId);
      const created = file.getDateCreated();
      out[r.IngestionSourceId] = {
        fileId:file.getId(), fileName:file.getName(),
        createdAt:created ? created.toISOString() : '',
        lastUpdatedAt:file.getLastUpdated() ? file.getLastUpdated().toISOString() : ''
      };
    } catch (error) {
      out[r.IngestionSourceId] = {fileId:r.EvidenceFileId, fileName:r.EvidenceFileName, createdAt:'', lastUpdatedAt:'', error:String(error && error.message || error)};
    }
  });
  return out;
}

function qboRegisteredAtBuildPayloadArtifactIndex_(wanted) {
  const out = Object.create(null);
  const folder = qboResolveGovernedFolderAsset_(
    QBO_CHANGE_PAYLOAD_PERSISTENCE_.FOLDER_ASSET_KEY,
    QBO_CHANGE_PAYLOAD_PERSISTENCE_.FOLDER_EXPECTED_TYPE,
    QBO_CHANGE_PAYLOAD_PERSISTENCE_.ENVIRONMENT
  );
  const it = folder.getFiles();
  let scanned = 0, matched = 0, invalid = 0;
  while (it.hasNext()) {
    const file = it.next();
    scanned += 1;
    const name = file.getName();
    if (name.indexOf(QBO_CHANGE_PAYLOAD_PERSISTENCE_.FILE_PREFIX) !== 0) continue;
    let envelope;
    try { envelope = JSON.parse(file.getBlob().getDataAsString('UTF-8')); }
    catch (error) { invalid += 1; continue; }
    const body = envelope && envelope.stableBody || {};
    const sourceId = String(body.sourceId || '').trim();
    if (!sourceId || !wanted[sourceId]) continue;
    matched += 1;
    if (!out[sourceId]) out[sourceId] = [];
    const driveCreated = file.getDateCreated();
    out[sourceId].push({
      fileId:file.getId(),
      fileName:name,
      envelopeCreatedAt:String(envelope.createdAt || ''),
      driveCreatedAt:driveCreated ? driveCreated.toISOString() : '',
      sourceId:sourceId,
      workUnitId:String(body.workUnitId || ''),
      ingestionRunId:String(body.ingestionRunId || '')
    });
  }
  Object.keys(out).forEach(function(sourceId){
    out[sourceId].sort(function(a,b){
      const am = qboRegisteredAtDate_(a.envelopeCreatedAt);
      const bm = qboRegisteredAtDate_(b.envelopeCreatedAt);
      return (am ? am.getTime() : Number.MAX_SAFE_INTEGER) - (bm ? bm.getTime() : Number.MAX_SAFE_INTEGER);
    });
  });
  out.__scanSummary = {scannedFileCount:scanned, matchedShardCount:matched, invalidJsonFileCount:invalid};
  return out;
}

function qboRegisteredAtAttachArtifactEvidence_(a, evidenceIndex, payloadIndex) {
  const r = a.row;
  const referenceIso = a.candidate || qboRegisteredAtIso_(r.RegisteredAt);
  const reference = qboRegisteredAtDate_(referenceIso);
  const ev = evidenceIndex[r.IngestionSourceId] || null;
  if (ev && ev.createdAt) {
    a.evidenceFileCreatedAt = ev.createdAt;
    if (reference) a.evidenceFileDeltaMs = qboRegisteredAtDeltaMs_(ev.createdAt, referenceIso);
  }
  const shards = payloadIndex[r.IngestionSourceId] || [];
  a.payloadShardCount = shards.length;
  if (shards.length) {
    let env = '', drv = '';
    shards.forEach(function(s){
      if (s.envelopeCreatedAt && (!env || qboRegisteredAtDate_(s.envelopeCreatedAt).getTime() < qboRegisteredAtDate_(env).getTime())) env = s.envelopeCreatedAt;
      if (s.driveCreatedAt && (!drv || qboRegisteredAtDate_(s.driveCreatedAt).getTime() < qboRegisteredAtDate_(drv).getTime())) drv = s.driveCreatedAt;
    });
    a.earliestPayloadEnvelopeCreatedAt = env;
    a.earliestPayloadDriveCreatedAt = drv;
    if (reference && env) a.payloadEnvelopeDeltaMs = qboRegisteredAtDeltaMs_(env, referenceIso);
    if (reference && drv) a.payloadDriveDeltaMs = qboRegisteredAtDeltaMs_(drv, referenceIso);
  }
  a.artifactEvidenceAssessment = 'CORROBORATING_ONLY_NOT_EXACT';
  if (a.payloadShardCount === 0 && !a.evidenceFileCreatedAt) a.artifactEvidenceAssessment = 'NO_ARTIFACT_TIMESTAMP_AVAILABLE';
}

function qboRegisteredAtArtifactCalibration_(rows, wanted, evidenceIndex, payloadIndex) {
  const c = {
    knownRegisteredRowCount:0,
    evidenceFileCreatedComparedCount:0, evidenceFileCreatedExactMatchCount:0,
    payloadEnvelopeComparedCount:0, payloadEnvelopeExactMatchCount:0,
    payloadDriveComparedCount:0, payloadDriveExactMatchCount:0,
    evidenceFileDeltaMsMin:'', evidenceFileDeltaMsMax:'',
    payloadEnvelopeDeltaMsMin:'', payloadEnvelopeDeltaMsMax:'',
    payloadDriveDeltaMsMin:'', payloadDriveDeltaMsMax:'',
    payloadScanSummary:payloadIndex.__scanSummary || {}
  };
  rows.forEach(function(r){
    if (!wanted[r.IngestionSourceId]) return;
    const reg = qboRegisteredAtIso_(r.RegisteredAt);
    if (!reg) return;
    c.knownRegisteredRowCount += 1;
    const ev = evidenceIndex[r.IngestionSourceId];
    if (ev && ev.createdAt) qboRegisteredAtCalibrationDelta_(c,'evidenceFile',ev.createdAt,reg);
    const shards = payloadIndex[r.IngestionSourceId] || [];
    if (shards.length) {
      let env = '', drv = '';
      shards.forEach(function(s){
        if (s.envelopeCreatedAt && (!env || qboRegisteredAtDate_(s.envelopeCreatedAt).getTime() < qboRegisteredAtDate_(env).getTime())) env=s.envelopeCreatedAt;
        if (s.driveCreatedAt && (!drv || qboRegisteredAtDate_(s.driveCreatedAt).getTime() < qboRegisteredAtDate_(drv).getTime())) drv=s.driveCreatedAt;
      });
      if (env) qboRegisteredAtCalibrationDelta_(c,'payloadEnvelope',env,reg);
      if (drv) qboRegisteredAtCalibrationDelta_(c,'payloadDrive',drv,reg);
    }
  });
  return c;
}

function qboRegisteredAtCalibrationDelta_(c, prefix, artifactTime, registeredAt) {
  const d = qboRegisteredAtDeltaMs_(artifactTime, registeredAt);
  const comparedKey = prefix + 'ComparedCount';
  const exactKey = prefix + 'ExactMatchCount';
  const minKey = prefix + 'DeltaMsMin';
  const maxKey = prefix + 'DeltaMsMax';
  c[comparedKey] += 1;
  if (d === 0) c[exactKey] += 1;
  if (c[minKey] === '' || d < c[minKey]) c[minKey] = d;
  if (c[maxKey] === '' || d > c[maxKey]) c[maxKey] = d;
}

function qboRegisteredAtDeltaMs_(artifactTime, registeredAt) {
  const a = qboRegisteredAtDate_(artifactTime), r = qboRegisteredAtDate_(registeredAt);
  if (!a || !r) return '';
  return a.getTime() - r.getTime();
}
