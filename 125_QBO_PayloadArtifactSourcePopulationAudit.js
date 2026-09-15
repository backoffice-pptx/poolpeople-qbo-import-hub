/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 125_QBO_PayloadArtifactSourcePopulationAudit.js
 * Version     : 1.5.102
 * Purpose     : Read-only source-population reconciliation explaining why
 *               SUM(06.ObservationCount) differs from SUM(05.ObservationCount).
 *
 * CLASSIFICATION (one row/result per exact 06 IngestionSourceId):
 *   05_BACKED
 *     Exact IngestionSourceId exists once in 05.
 *
 *   01_ONLY_HISTORICAL
 *     No 05 row; exact SourceId exists once in authoritative 01; every 06 row
 *     is governed historical reconstruction lineage.
 *
 *   UNEXPLAINED
 *     Anything else: missing/duplicate 01/05 identity, mixed or unexpected
 *     lineage, or another condition that prevents exact classification.
 *
 * IMPORTANT:
 *   - READ ONLY.
 *   - Does not open or mutate physical Change Payload files.
 *   - Does not mutate 01, 05, 06, payloads, ingestion state, Script Properties,
 *     triggers, or State Application.
 * ============================================================================
 */

const QBO_PAYLOAD_ARTIFACT_SOURCE_POP_AUDIT_ = Object.freeze({
  VERSION: 'QBO_PAYLOAD_ARTIFACT_SOURCE_POPULATION_AUDIT_V1_5_102',
  SOURCE_SHEET: '01_Sources',
  CONTROL_SHEET: '05_Forward_Ingestion_Control',
  ARTIFACT_SHEET: '06_Payload_Artifacts'
});

function auditQboPayloadArtifactSourcePopulation() {
  const C = QBO_PAYLOAD_ARTIFACT_SOURCE_POP_AUDIT_;
  const startedAt = new Date().toISOString();
  console.log('[PAYLOAD SOURCE POP AUDIT] | START | version=' + C.VERSION);

  const ss = getQboStateCaptureSpreadsheet_();
  const s01 = qboPopAuditRequireSheet_(ss, C.SOURCE_SHEET);
  const s05 = qboPopAuditRequireSheet_(ss, C.CONTROL_SHEET);
  const s06 = qboPopAuditRequireSheet_(ss, C.ARTIFACT_SHEET);

  const rows01 = qboPopAuditReadObjects_(s01);
  const rows05 = qboPopAuditReadObjects_(s05);
  const rows06 = qboPopAuditReadObjects_(s06);

  const by01 = qboPopAuditGroup_(rows01, function(r) {
    return String(r.SourceId || r.IngestionSourceId || '').trim();
  });
  const by05 = qboPopAuditGroup_(rows05, function(r) {
    return String(r.IngestionSourceId || r.SourceId || '').trim();
  });
  const by06 = qboPopAuditGroup_(rows06, function(r) {
    return String(r.IngestionSourceId || r.SourceId || '').trim();
  });

  const totals05 = qboPopAuditTotals_(rows05);
  const totals06 = qboPopAuditTotals_(rows06);

  const bucketTotals = {
    '05_BACKED': qboPopAuditEmptyBucket_(),
    '01_ONLY_HISTORICAL': qboPopAuditEmptyBucket_(),
    'UNEXPLAINED': qboPopAuditEmptyBucket_()
  };

  const sourceResults = [];
  Object.keys(by06).sort().forEach(function(sourceId) {
    if (!sourceId) return;
    const a01 = by01[sourceId] || [];
    const a05 = by05[sourceId] || [];
    const a06 = by06[sourceId] || [];

    const obs06 = qboPopAuditSum_(a06, 'ObservationCount');
    const payload06 = qboPopAuditSum_(a06, 'PayloadCount');
    const obs05 = qboPopAuditSum_(a05, 'ObservationCount');
    const payload05 = qboPopAuditSum_(a05, 'PayloadCount');
    const shard05 = qboPopAuditSum_(a05, 'ShardCount');

    const lineage = qboPopAuditLineage_(a06);
    let classification = 'UNEXPLAINED';
    const reasons = [];

    if (a05.length === 1) {
      classification = '05_BACKED';
      if (a01.length !== 1) reasons.push('01_SOURCE_CARDINALITY_' + a01.length);
      if (obs05 !== obs06) reasons.push('OBSERVATION_COUNT_MISMATCH_05_VS_06');
      if (payload05 !== payload06) reasons.push('PAYLOAD_COUNT_MISMATCH_05_VS_06');
      if (shard05 !== a06.length) reasons.push('SHARD_COUNT_MISMATCH_05_VS_06');
      if (lineage.unexpectedCount > 0) reasons.push('UNEXPECTED_06_LINEAGE');
      // A 05-backed source remains 05_BACKED so its mismatch is visible inside
      // that bucket rather than being hidden by reclassification.
    } else if (a05.length === 0 &&
               a01.length === 1 &&
               lineage.rowCount > 0 &&
               lineage.historicalExactCount === lineage.rowCount) {
      classification = '01_ONLY_HISTORICAL';
    } else {
      if (a05.length > 1) reasons.push('05_SOURCE_CARDINALITY_' + a05.length);
      if (a05.length === 0 && a01.length !== 1) reasons.push('01_SOURCE_CARDINALITY_' + a01.length);
      if (lineage.historicalExactCount !== lineage.rowCount) reasons.push('NOT_ALL_ROWS_GOVERNED_HISTORICAL');
      if (lineage.unexpectedCount > 0) reasons.push('UNEXPECTED_06_LINEAGE');
    }

    const b = bucketTotals[classification];
    b.sourceCount++;
    b.artifactRowCount += a06.length;
    b.observationCount06 += obs06;
    b.payloadCount06 += payload06;
    b.observationCount05 += obs05;
    b.payloadCount05 += payload05;
    b.shardCount05 += shard05;
    if (reasons.length) b.sourceWithFindingCount++;

    sourceResults.push({
      sourceId: sourceId,
      classification: classification,
      source01RowCount: a01.length,
      control05RowCount: a05.length,
      artifact06RowCount: a06.length,
      observationCount05: obs05,
      observationCount06: obs06,
      observationDelta06Minus05: obs06 - obs05,
      payloadCount05: payload05,
      payloadCount06: payload06,
      shardCount05: shard05,
      lineage: lineage,
      findings: reasons
    });
  });

  // Also detect 05 sources that have no 06 artifacts yet. During an active
  // historical backfill this may simply mean 06 is incomplete.
  const sources05Without06 = [];
  Object.keys(by05).sort().forEach(function(sourceId) {
    if (!sourceId || (by06[sourceId] || []).length) return;
    const a05 = by05[sourceId];
    sources05Without06.push({
      sourceId: sourceId,
      control05RowCount: a05.length,
      observationCount05: qboPopAuditSum_(a05, 'ObservationCount'),
      payloadCount05: qboPopAuditSum_(a05, 'PayloadCount'),
      shardCount05: qboPopAuditSum_(a05, 'ShardCount')
    });
  });

  const fiveBacked = sourceResults.filter(function(r) {
    return r.classification === '05_BACKED';
  });
  const fiveBackedMismatch = fiveBacked.filter(function(r) {
    return r.findings.length > 0;
  });
  const unexplained = sourceResults.filter(function(r) {
    return r.classification === 'UNEXPLAINED';
  });

  const explained06Obs =
    bucketTotals['05_BACKED'].observationCount06 +
    bucketTotals['01_ONLY_HISTORICAL'].observationCount06;

  const result = {
    version: C.VERSION,
    status: unexplained.length === 0 && fiveBackedMismatch.length === 0
      ? 'VALID_POPULATION_CLASSIFICATION'
      : 'ACTION_REQUIRED',
    readOnly: true,
    backfillAware: true,
    totals: {
      sheet05RowCount: rows05.length,
      sheet05ObservationCount: totals05.observationCount,
      sheet05PayloadCount: totals05.payloadCount,
      sheet05ShardCount: totals05.shardCount,
      sheet06RowCount: rows06.length,
      sheet06ObservationCount: totals06.observationCount,
      sheet06PayloadCount: totals06.payloadCount,
      observationDelta06Minus05: totals06.observationCount - totals05.observationCount
    },
    buckets: bucketTotals,
    explanation: {
      explained06ObservationCount: explained06Obs,
      unexplained06ObservationCount: bucketTotals['UNEXPLAINED'].observationCount06,
      historicalOutside05ObservationCount:
        bucketTotals['01_ONLY_HISTORICAL'].observationCount06,
      fiveBackedObservationCount06:
        bucketTotals['05_BACKED'].observationCount06,
      fiveBackedObservationCount05:
        bucketTotals['05_BACKED'].observationCount05
    },
    integrity: {
      fiveBackedSourceCount: fiveBacked.length,
      fiveBackedSourceWithFindingCount: fiveBackedMismatch.length,
      unexplainedSourceCount: unexplained.length,
      sources05Without06Count: sources05Without06.length
    },
    sourceResults: sourceResults,
    sources05Without06: sources05Without06,
    startedAt: startedAt,
    completedAt: new Date().toISOString()
  };

  console.log('[PAYLOAD SOURCE POP AUDIT] | SUMMARY | ' + JSON.stringify({
    version: result.version,
    status: result.status,
    totals: result.totals,
    buckets: result.buckets,
    explanation: result.explanation,
    integrity: result.integrity
  }));

  if (fiveBackedMismatch.length) {
    console.log('[PAYLOAD SOURCE POP AUDIT] | 05_BACKED_FINDINGS | ' +
      JSON.stringify(fiveBackedMismatch));
  }
  if (unexplained.length) {
    console.log('[PAYLOAD SOURCE POP AUDIT] | UNEXPLAINED | ' +
      JSON.stringify(unexplained));
  }
  if (sources05Without06.length) {
    console.log('[PAYLOAD SOURCE POP AUDIT] | 05_WITHOUT_06 | ' +
      JSON.stringify(sources05Without06));
  }

  return result;
}

function qboPopAuditLineage_(rows) {
  let historicalExactCount = 0;
  let forwardLikeCount = 0;
  let unexpectedCount = 0;
  const statuses = Object.create(null);
  const registrationModes = Object.create(null);
  const ingestionRunPrefixes = Object.create(null);

  rows.forEach(function(r) {
    const status = String(r.LineageStatus || '').trim();
    const mode = String(r.RegistrationMode || '').trim();
    const run = String(r.IngestionRunId || '').trim();
    statuses[status || '(blank)'] = (statuses[status || '(blank)'] || 0) + 1;
    registrationModes[mode || '(blank)'] = (registrationModes[mode || '(blank)'] || 0) + 1;

    let prefix = '(blank)';
    if (run.indexOf('HIST_PAYLOAD|') === 0) prefix = 'HIST_PAYLOAD';
    else if (run.indexOf('FORWARD_') === 0) prefix = 'FORWARD';
    else if (run) prefix = run.split('|')[0];
    ingestionRunPrefixes[prefix] = (ingestionRunPrefixes[prefix] || 0) + 1;

    const historicalExact =
      run.indexOf('HIST_PAYLOAD|') === 0 &&
      String(r.WorkUnitId || '').indexOf('HISTWU|') === 0 &&
      (status === 'HISTORICAL_SOURCE_EXACT_NO_05' ||
       status === 'EXACT_RECONCILED');

    if (historicalExact) historicalExactCount++;
    else if (run.indexOf('FORWARD_') === 0) forwardLikeCount++;
    else unexpectedCount++;
  });

  return {
    rowCount: rows.length,
    historicalExactCount: historicalExactCount,
    forwardLikeCount: forwardLikeCount,
    unexpectedCount: unexpectedCount,
    lineageStatuses: statuses,
    registrationModes: registrationModes,
    ingestionRunPrefixes: ingestionRunPrefixes
  };
}

function qboPopAuditEmptyBucket_() {
  return {
    sourceCount: 0,
    artifactRowCount: 0,
    observationCount06: 0,
    payloadCount06: 0,
    observationCount05: 0,
    payloadCount05: 0,
    shardCount05: 0,
    sourceWithFindingCount: 0
  };
}

function qboPopAuditTotals_(rows) {
  return {
    observationCount: qboPopAuditSum_(rows, 'ObservationCount'),
    payloadCount: qboPopAuditSum_(rows, 'PayloadCount'),
    shardCount: qboPopAuditSum_(rows, 'ShardCount')
  };
}

function qboPopAuditSum_(rows, field) {
  return rows.reduce(function(sum, r) {
    const v = r[field];
    if (v === '' || v === null || v === undefined) return sum;
    const n = Number(v);
    if (!isFinite(n)) {
      throw new Error('PAYLOAD_SOURCE_POP_AUDIT_NON_NUMERIC field=' +
        field + ' value=' + v + ' row=' + r._rowNumber);
    }
    return sum + n;
  }, 0);
}

function qboPopAuditGroup_(rows, keyFn) {
  const out = Object.create(null);
  rows.forEach(function(r) {
    const key = String(keyFn(r) || '').trim();
    if (!out[key]) out[key] = [];
    out[key].push(r);
  });
  return out;
}

function qboPopAuditRequireSheet_(ss, name) {
  const sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('PAYLOAD_SOURCE_POP_AUDIT_SHEET_NOT_FOUND ' + name);
  return sheet;
}

function qboPopAuditReadObjects_(sheet) {
  const lr = sheet.getLastRow();
  const lc = sheet.getLastColumn();
  if (lr < 1 || lc < 1) return [];
  const values = sheet.getRange(1, 1, lr, lc).getValues();
  const headers = values[0].map(function(v) { return String(v || '').trim(); });
  return values.slice(1).filter(function(row) {
    return row.some(function(v) { return v !== '' && v !== null; });
  }).map(function(row, i) {
    const out = {_rowNumber: i + 2};
    headers.forEach(function(h, c) { if (h) out[h] = row[c]; });
    return out;
  });
}
