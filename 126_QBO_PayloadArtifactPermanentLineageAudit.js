/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 126_QBO_PayloadArtifactPermanentLineageAudit.js
 * Version     : 1.5.103
 * Purpose     : Gate A read-only reconciliation of every 06_Payload_Artifacts
 *               row to its permanent governed upstream source lineage.
 *
 * Permanent source ownership:
 *   FULL_EXPORT / FULL_EXPORT_LEGACY -> 01_Sources
 *   NATIVE_CDC                       -> 02_CDC_Run_Manifest + 03_Native_CDC_Events
 *   WEBHOOK                          -> 04_Webhook_Events
 *
 * IMPORTANT:
 *   - READ ONLY. No sheet, Drive file, Script Property, trigger, ingestion
 *     checkpoint, payload, or State Application mutation.
 *   - 05 is corroborating transformation-control evidence only. Presence in 05
 *     does not define permanent source legitimacy.
 *   - RegistrationMode and IngestionRunId are processing provenance only and
 *     never redefine permanent source identity.
 *   - 02/03/04 may still be empty before their governed V2 backfill. In that
 *     case this audit proves deterministic lineage requirements and reports
 *     BACKFILL_REQUIRED rather than manufacturing ledger rows.
 * ============================================================================
 */

const QBO_PAYLOAD_PERMANENT_LINEAGE_AUDIT_ = Object.freeze({
  VERSION: 'QBO_PAYLOAD_ARTIFACT_PERMANENT_LINEAGE_AUDIT_V1_5_104',
  SOURCE_SHEET: '01_Sources',
  CDC_RUN_SHEET: '02_CDC_Run_Manifest',
  CDC_EVENT_SHEET: '03_Native_CDC_Events',
  WEBHOOK_EVENT_SHEET: '04_Webhook_Events',
  CONTROL_SHEET: '05_Forward_Ingestion_Control',
  ARTIFACT_SHEET: '06_Payload_Artifacts'
});

function auditQboPayloadArtifactPermanentLineage() {
  const C = QBO_PAYLOAD_PERMANENT_LINEAGE_AUDIT_;
  const startedAt = new Date().toISOString();
  console.log('[PAYLOAD PERMANENT LINEAGE AUDIT] | START | version=' + C.VERSION);

  const ss = getQboStateCaptureSpreadsheet_();
  const rows01 = qboPermLineageReadObjects_(qboPermLineageRequireSheet_(ss, C.SOURCE_SHEET));
  const rows02 = qboPermLineageReadObjects_(qboPermLineageRequireSheet_(ss, C.CDC_RUN_SHEET));
  const rows03 = qboPermLineageReadObjects_(qboPermLineageRequireSheet_(ss, C.CDC_EVENT_SHEET));
  const rows04 = qboPermLineageReadObjects_(qboPermLineageRequireSheet_(ss, C.WEBHOOK_EVENT_SHEET));
  const rows05 = qboPermLineageReadObjects_(qboPermLineageRequireSheet_(ss, C.CONTROL_SHEET));
  const rows06 = qboPermLineageReadObjects_(qboPermLineageRequireSheet_(ss, C.ARTIFACT_SHEET));

  const by01 = qboPermLineageGroup_(rows01, function(r) { return qboPermLineageText_(r.SourceId); });
  const by02 = qboPermLineageGroup_(rows02, function(r) { return qboPermLineageText_(r.CdcRunId); });
  const by03Source = qboPermLineageGroup_(rows03, function(r) { return qboPermLineageText_(r.SourceId); });
  const by04Receipt = qboPermLineageGroup_(rows04, function(r) {
    return qboPermLineageText_(r.WebhookReceiptId || r.WebhookDeliveryId);
  });
  const by04Event = qboPermLineageGroup_(rows04, function(r) { return qboPermLineageText_(r.WebhookEventId); });
  const by05 = qboPermLineageGroup_(rows05, function(r) { return qboPermLineageText_(r.IngestionSourceId || r.SourceId); });

  const artifactFindings = [];
  const sourceAgg = Object.create(null);
  const buckets = Object.create(null);
  let totalObs06 = 0;
  let totalPayload06 = 0;
  let artifactRowsWithFinding = 0;

  rows06.forEach(function(row, index) {
    const result = qboPermLineageClassifyArtifact_(row, {
      by01: by01, by02: by02, by03Source: by03Source, by04Receipt: by04Receipt,
      by04Event: by04Event, by05: by05
    });
    result.sheetRowNumber = index + 2;
    result.payloadFileId = qboPermLineageText_(row.PayloadFileId);
    result.payloadFileName = qboPermLineageText_(row.PayloadFileName);
    result.observationCount = qboPermLineageNumber_(row.ObservationCount);
    result.payloadCount = qboPermLineageNumber_(row.PayloadCount);
    totalObs06 += result.observationCount;
    totalPayload06 += result.payloadCount;

    const b = buckets[result.classification] || (buckets[result.classification] = qboPermLineageEmptyBucket_());
    b.artifactRowCount++;
    b.observationCount += result.observationCount;
    b.payloadCount += result.payloadCount;
    if (result.findings.length) {
      b.artifactWithFindingCount++;
      artifactRowsWithFinding++;
      artifactFindings.push(result);
    }

    const sourceKey = result.permanentPopulationKey || ('UNRESOLVED|' + result.ingestionSourceId);
    const s = sourceAgg[sourceKey] || (sourceAgg[sourceKey] = {
      permanentPopulationKey: sourceKey,
      sourceType: result.sourceType,
      sourceLedger: result.sourceLedger,
      sourceLedgerStatus: result.sourceLedgerStatus,
      artifactRowCount: 0,
      observationCount06: 0,
      payloadCount06: 0,
      current05RowCount: 0,
      classifications: Object.create(null),
      findings: Object.create(null)
    });
    s.artifactRowCount++;
    s.observationCount06 += result.observationCount;
    s.payloadCount06 += result.payloadCount;
    s.current05RowCount = Math.max(s.current05RowCount, result.current05RowCount);
    s.classifications[result.classification] = true;
    result.findings.forEach(function(f) { s.findings[f] = true; });
  });

  const sourceResults = Object.keys(sourceAgg).sort().map(function(k) {
    const s = sourceAgg[k];
    s.classifications = Object.keys(s.classifications).sort();
    s.findings = Object.keys(s.findings).sort();
    return s;
  });

  const classificationTotals = {};
  Object.keys(buckets).sort().forEach(function(k) { classificationTotals[k] = buckets[k]; });

  const unresolved = artifactFindings.filter(function(r) {
    return r.classification === 'UNRESOLVED' || r.classification === 'CONTROLLED_TEST_ORPHAN';
  });
  const exactOrBackfillableCount = rows06.length - unresolved.length;
  const status = unresolved.length === 0 ? 'GATE_A_LINEAGE_POPULATION_PROVEN' : 'ACTION_REQUIRED';

  const result = {
    version: C.VERSION,
    status: status,
    readOnly: true,
    permanentSourceOwnership: {
      FULL_EXPORT: '01_Sources',
      FULL_EXPORT_LEGACY: '01_Sources',
      NATIVE_CDC: '02_CDC_Run_Manifest + 03_Native_CDC_Events',
      WEBHOOK: '04_Webhook_Events',
      transformationControl: '05_Forward_Ingestion_Control',
      artifactControl: '06_Payload_Artifacts'
    },
    totals: {
      sheet01RowCount: rows01.length,
      sheet02RowCount: rows02.length,
      sheet03RowCount: rows03.length,
      sheet04RowCount: rows04.length,
      sheet05RowCount: rows05.length,
      sheet06RowCount: rows06.length,
      sheet06ObservationCount: totalObs06,
      sheet06PayloadCount: totalPayload06,
      permanentLineageExactOrBackfillableArtifactCount: exactOrBackfillableCount,
      unresolvedArtifactCount: unresolved.length,
      artifactRowsWithFindingCount: artifactRowsWithFinding,
      permanentPopulationCount: sourceResults.length
    },
    classifications: classificationTotals,
    sourceResults: sourceResults,
    artifactFindings: artifactFindings,
    startedAt: startedAt,
    completedAt: new Date().toISOString()
  };

  console.log('[PAYLOAD PERMANENT LINEAGE AUDIT] | SUMMARY | ' + JSON.stringify({
    version: result.version,
    status: result.status,
    totals: result.totals,
    classifications: result.classifications
  }));
  if (artifactFindings.length) {
    console.log('[PAYLOAD PERMANENT LINEAGE AUDIT] | FINDINGS | ' + JSON.stringify(artifactFindings));
  }
  return result;
}

function qboPermLineageClassifyArtifact_(row, ix) {
  const sid = qboPermLineageText_(row.IngestionSourceId || row.SourceId);
  const sourceType = qboPermLineageNormalizeSourceType_(row.SourceType, sid);
  const findings = [];
  const current05RowCount = (ix.by05[sid] || []).length;
  let classification = 'UNRESOLVED';
  let sourceLedger = '';
  let sourceLedgerStatus = '';
  let permanentPopulationKey = '';

  if (!sid) {
    findings.push('MISSING_06_INGESTION_SOURCE_ID');
  } else if (sourceType === 'FULL_EXPORT' || sourceType === 'FULL_EXPORT_LEGACY') {
    sourceLedger = '01_Sources';
    permanentPopulationKey = sid;
    const a01 = ix.by01[sid] || [];
    if (a01.length === 1) {
      classification = 'FULL_EXPORT_01_EXACT';
      sourceLedgerStatus = 'EXACT';
    } else if (a01.length === 0 && qboPermLineageIsControlledTestSource_(sid)) {
      classification = 'CONTROLLED_TEST_ORPHAN';
      sourceLedgerStatus = 'MISSING_BY_CONTROLLED_TEST_DISPOSITION';
      findings.push('CONTROLLED_TEST_SOURCE_REMOVED_FROM_01');
    } else {
      sourceLedgerStatus = a01.length === 0 ? 'MISSING' : 'DUPLICATE';
      findings.push('01_SOURCE_CARDINALITY_' + a01.length);
    }
  } else if (sourceType === 'NATIVE_CDC') {
    sourceLedger = '02_CDC_Run_Manifest + 03_Native_CDC_Events';
    const p = qboPermLineageParseNativeCdcSource_(sid);
    if (!p.valid) {
      findings.push('NATIVE_CDC_SOURCE_ID_NOT_DERIVABLE');
    } else {
      permanentPopulationKey = sid;
      const a02 = ix.by02[p.cdcRunId] || [];
      const a03 = ix.by03Source[sid] || [];
      if (a02.length === 1 && a03.length > 0) {
        classification = 'NATIVE_CDC_02_03_PRESENT';
        sourceLedgerStatus = 'PRESENT';
      } else if (a02.length === 0 && a03.length === 0) {
        classification = 'NATIVE_CDC_02_03_BACKFILL_REQUIRED';
        sourceLedgerStatus = 'BACKFILL_REQUIRED';
      } else {
        classification = 'NATIVE_CDC_02_03_PARTIAL';
        sourceLedgerStatus = 'PARTIAL';
        findings.push('CDC_RUN_02_CARDINALITY_' + a02.length);
        if (a03.length === 0) findings.push('CDC_EVENT_03_POPULATION_MISSING');
      }
    }
  } else if (sourceType === 'WEBHOOK') {
    sourceLedger = '04_Webhook_Events';
    const p = qboPermLineageParseWebhookSource_(sid);
    if (!p.valid) {
      findings.push('WEBHOOK_SOURCE_ID_NOT_DERIVABLE');
    } else if (p.historicalEvent) {
      permanentPopulationKey = 'WEBHOOK|' + p.receiptId + '|EVENT|' + p.eventIndex;
      const a04 = ix.by04Event[permanentPopulationKey] || [];
      if (a04.length === 1) {
        classification = 'WEBHOOK_04_EVENT_PRESENT';
        sourceLedgerStatus = 'PRESENT';
      } else if (a04.length === 0) {
        classification = 'WEBHOOK_04_EVENT_BACKFILL_REQUIRED';
        sourceLedgerStatus = 'BACKFILL_REQUIRED';
      } else {
        classification = 'UNRESOLVED';
        sourceLedgerStatus = 'DUPLICATE';
        findings.push('04_WEBHOOK_EVENT_CARDINALITY_' + a04.length);
      }
    } else {
      permanentPopulationKey = 'WEBHOOK|' + p.receiptId;
      const a04r = ix.by04Receipt[p.receiptId] || [];
      if (a04r.length > 0) {
        classification = 'WEBHOOK_04_RECEIPT_POPULATION_PRESENT';
        sourceLedgerStatus = 'PRESENT';
      } else {
        classification = 'WEBHOOK_04_RECEIPT_BACKFILL_REQUIRED';
        sourceLedgerStatus = 'BACKFILL_REQUIRED';
      }
    }
  } else {
    findings.push('UNSUPPORTED_SOURCE_TYPE_' + (sourceType || 'BLANK'));
  }

  if (current05RowCount > 1) findings.push('05_CORROBORATION_CARDINALITY_' + current05RowCount);

  return {
    ingestionSourceId: sid,
    sourceType: sourceType,
    sourceLedger: sourceLedger,
    sourceLedgerStatus: sourceLedgerStatus,
    permanentPopulationKey: permanentPopulationKey,
    classification: classification,
    current05RowCount: current05RowCount,
    registrationMode: qboPermLineageText_(row.RegistrationMode),
    ingestionRunId: qboPermLineageText_(row.IngestionRunId),
    lineageStatus06: qboPermLineageText_(row.LineageStatus),
    findings: findings
  };
}

function qboPermLineageNormalizeSourceType_(value, sid) {
  let t = qboPermLineageText_(value).toUpperCase();
  if (t === 'FULL_EXPORT_LEGACY') return t;
  if (t === 'FULL_EXPORT') return t;
  if (t === 'NATIVE_CDC') return t;
  if (t === 'WEBHOOK') return t;
  if (/^FULL_EXPORT_LEGACY\|/.test(sid)) return 'FULL_EXPORT_LEGACY';
  if (/^FULL_EXPORT\|/.test(sid)) return 'FULL_EXPORT';
  if (/^NATIVE_CDC\|/.test(sid)) return 'NATIVE_CDC';
  if (/^WEBHOOK\|/.test(sid)) return 'WEBHOOK';
  return t;
}

function qboPermLineageParseNativeCdcSource_(sid) {
  // Permanent Native CDC source identity:
  // NATIVE_CDC|<CycleBucket>|<CycleUuid>|<EntityType>
  // CdcRunId itself is <CycleBucket>|<CycleUuid>, so it contains a pipe.
  const m = /^NATIVE_CDC\|([^|]+)\|([^|]+)\|([^|]+)$/.exec(sid);
  return m ? {
    valid:true,
    cdcRunId:m[1] + '|' + m[2],
    entityType:m[3]
  } : {valid:false};
}

function qboPermLineageParseWebhookSource_(sid) {
  let m = /^WEBHOOK\|HISTORICAL\|([^|]+)\|EVENT\|(\d+)$/.exec(sid);
  if (m) return {valid:true, historicalEvent:true, receiptId:m[1], eventIndex:Number(m[2])};
  m = /^WEBHOOK\|([^|]+)$/.exec(sid);
  if (m && m[1] !== 'HISTORICAL') return {valid:true, historicalEvent:false, receiptId:m[1]};
  return {valid:false};
}

function qboPermLineageIsControlledTestSource_(sid) {
  return /^FULL_EXPORT\|STATE_CAPTURE_AUTOREG_TEST_[^|]+\|/.test(sid);
}

function qboPermLineageEmptyBucket_() {
  return {artifactRowCount:0, observationCount:0, payloadCount:0, artifactWithFindingCount:0};
}

function qboPermLineageRequireSheet_(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('PAYLOAD_PERMANENT_LINEAGE_AUDIT_MISSING_SHEET ' + name);
  return sheet;
}

function qboPermLineageReadObjects_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastCol = sheet.getLastColumn();
  if (lastRow < 1 || lastCol < 1) return [];
  const values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  const headers = values[0].map(function(h) { return String(h || '').trim(); });
  return values.slice(1).filter(function(row) {
    return row.some(function(v) { return String(v === null || v === undefined ? '' : v).trim() !== ''; });
  }).map(function(row) {
    const o = {};
    headers.forEach(function(h, i) { if (h) o[h] = row[i]; });
    return o;
  });
}

function qboPermLineageGroup_(rows, keyFn) {
  const out = Object.create(null);
  rows.forEach(function(r) {
    const k = keyFn(r);
    if (!k) return;
    (out[k] || (out[k] = [])).push(r);
  });
  return out;
}

function qboPermLineageText_(v) {
  return String(v === null || v === undefined ? '' : v).trim();
}

function qboPermLineageNumber_(v) {
  if (v === '' || v === null || v === undefined) return 0;
  const n = Number(v);
  return isFinite(n) ? n : 0;
}
