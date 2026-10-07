/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 4070_QBO_StateApplicationV2PhaseGPreflight.js
 * Version     : 1.5.213
 * Purpose     : Read-only Phase G preflight after Final Historical 07 trust
 *               certification. Proves whether legacy Canonical V2 rebuild state
 *               and existing V2 State Application rows can be preserved/reset
 *               before an observation-led V2 rebuild/replay is implemented.
 *
 * Safety contract:
 *   - READ ONLY: no workbook, Drive, Script Property, or trigger mutations.
 *   - Requires the exact completed Historical 07 certification population.
 *   - Fails closed if legacy Canonical V2 worker/watchdog triggers are active.
 *   - Does NOT authorize startQboCanonicalV2Rebuild(); module 95 is source-led
 *     and predates the governed 05/06 observation authority certified by v204.
 * ============================================================================
 */

const QBO_PHASE_G_PREFLIGHT_V1213_ = Object.freeze({
  VERSION: '1.5.213',
  REQUIRED_HIST07_STATUS: 'COMPLETE_HISTORICAL_07_TRUST_CERTIFIED',
  REQUIRED_HIST07_RUN: 'FINAL_HIST07_V202|2a2db396-f66b-4d89-a902-22f4c9149d36',
  EXPECTED_ARTIFACTS: 3455,
  EXPECTED_PHYSICAL: 734913,
  EXPECTED_LOGICAL: 734858,
  LEGACY_HANDLERS: Object.freeze(['runNextQboCanonicalV2Rebuild','watchQboCanonicalV2Rebuild']),
  V2_VERSIONS: Object.freeze({
    snapshot: 'SNAPSHOT_RECORD_V2',
    change: 'CHANGE_RECORD_V2',
    detail: 'CHANGE_DETAIL_V2'
  })
});

function preflightQboStateApplicationV2PhaseGV1213() {
  const C = QBO_PHASE_G_PREFLIGHT_V1213_;
  const props = PropertiesService.getScriptProperties();
  const hist = qboPhaseGPreflightHist07_(props);
  const triggers = qboPhaseGPreflightLegacyTriggers_();
  const legacyState = qboPhaseGPreflightLegacyState_(props);
  const workbook = qboPhaseGPreflightWorkbook_();

  const blockers = [];
  if (!hist.passed) blockers.push('HISTORICAL_07_CERTIFICATION_NOT_EXACT');
  if (triggers.count) blockers.push('LEGACY_CANONICAL_V2_TRIGGER_ACTIVE');

  // Existing V2 rows are not themselves a failure: they are precisely what the
  // next controlled design must classify as preserve/reconcile/reset evidence.
  // But their presence prevents any blind restart of the legacy rebuild.
  if (workbook.totalV2Rows > 0) blockers.push('EXISTING_V2_STATE_REQUIRES_CONTROLLED_DISPOSITION');
  if (legacyState.hasState) blockers.push('LEGACY_REBUILD_STATE_REQUIRES_CONTROLLED_DISPOSITION');

  const result = {
    version: C.VERSION,
    operation: 'STATE_APPLICATION_V2_PHASE_G_PREFLIGHT',
    readOnly: true,
    phase: 'PHASE_G',
    historical07: hist,
    legacyCanonicalV2Triggers: triggers,
    legacyCanonicalV2RebuildState: legacyState,
    stateApplicationWorkbook: workbook,
    legacyModule95Authorized: false,
    requiredReplayAuthority: 'GOVERNED_LOGICAL_07_OBSERVATION_POPULATION_ORDERED_BY_OBSERVED_AT',
    nextAction: 'DESIGN_OBSERVATION_LED_V2_REBUILD_REPLAY',
    blockers: blockers,
    passedForDesign: hist.passed && triggers.count === 0,
    passedForReplayStart: false,
    controls: {
      workbookWrites: false,
      driveWrites: false,
      scriptPropertiesWrites: false,
      triggerMutations: false,
      stateApplicationWrites: false
    }
  };
  console.log('[PHASE G PREFLIGHT V1213] | SUMMARY | ' + JSON.stringify(result));
  return result;
}

function qboPhaseGPreflightHist07_(props) {
  const C = QBO_PHASE_G_PREFLIGHT_V1213_;
  let s = null;
  try { s = JSON.parse(props.getProperty('QBO_FINAL_HIST07_V202_STATE') || 'null'); } catch (e) {}
  const checks = {
    statePresent: !!s,
    status: s ? String(s.status || '') : '',
    runId: s ? String(s.runId || '') : '',
    artifactCursor: s ? Number(s.artifactCursor || 0) : 0,
    artifactCount: s ? Number(s.artifactCount || 0) : 0,
    physicalObservationCount: s ? Number(s.physicalObservationCount || 0) : 0,
    logicalObservationCount: s ? Number(s.logicalObservationCount || 0) : 0,
    identityMismatchCount: s ? Number(s.identityMismatchCount || 0) : -1,
    webhookGatePassed: !!(s && s.webhookGate && s.webhookGate.passed === true),
    cdcGatePassed: !!(s && s.cdcGate && s.cdcGate.passed === true),
    completedAt: s ? String(s.completedAt || '') : ''
  };
  checks.passed = !!s &&
    checks.status === C.REQUIRED_HIST07_STATUS &&
    checks.runId === C.REQUIRED_HIST07_RUN &&
    checks.artifactCursor === C.EXPECTED_ARTIFACTS &&
    checks.artifactCount === C.EXPECTED_ARTIFACTS &&
    checks.physicalObservationCount === C.EXPECTED_PHYSICAL &&
    checks.logicalObservationCount === C.EXPECTED_LOGICAL &&
    checks.identityMismatchCount === 0 &&
    checks.webhookGatePassed && checks.cdcGatePassed && !!checks.completedAt;
  return checks;
}

function qboPhaseGPreflightLegacyTriggers_() {
  const handlers = QBO_PHASE_G_PREFLIGHT_V1213_.LEGACY_HANDLERS;
  const found = ScriptApp.getProjectTriggers().filter(function(t) {
    return handlers.indexOf(String(t.getHandlerFunction() || '')) >= 0;
  }).map(function(t) {
    return {handler:String(t.getHandlerFunction() || ''), uniqueId:String(t.getUniqueId() || '')};
  });
  return {count:found.length, triggers:found};
}

function qboPhaseGPreflightLegacyState_(props) {
  const keys = [
    'QBO_CANONICAL_V2_REBUILD_RUN_ID','QBO_CANONICAL_V2_REBUILD_STATUS',
    'QBO_CANONICAL_V2_REBUILD_EXPORT_INDEX','QBO_CANONICAL_V2_REBUILD_SOURCE_INDEX',
    'QBO_CANONICAL_V2_REBUILD_STARTED_AT','QBO_CANONICAL_V2_REBUILD_LAST_PROGRESS_AT',
    'QBO_CANONICAL_V2_REBUILD_LAST_HEARTBEAT_AT','QBO_CANONICAL_V2_REBUILD_WORKER_LEASE_TOKEN',
    'QBO_CANONICAL_V2_REBUILD_WORKER_LEASE_EXPIRES_AT','QBO_CANONICAL_V2_REBUILD_LAST_ERROR'
  ];
  const o = {};
  let present = 0;
  keys.forEach(function(k) { const v = props.getProperty(k); if (v !== null) present++; o[k] = v === null ? '' : String(v); });
  const migrationKeys = props.getKeys().filter(function(k){return String(k).indexOf('QBO_CANONICAL_MIGRATION_CURSOR_V1|')===0;}).sort();
  return {
    hasState: present > 0 || migrationKeys.length > 0,
    propertyCount: present,
    runId: o.QBO_CANONICAL_V2_REBUILD_RUN_ID,
    status: o.QBO_CANONICAL_V2_REBUILD_STATUS,
    exportIndex: o.QBO_CANONICAL_V2_REBUILD_EXPORT_INDEX,
    sourceIndex: o.QBO_CANONICAL_V2_REBUILD_SOURCE_INDEX,
    startedAt: o.QBO_CANONICAL_V2_REBUILD_STARTED_AT,
    lastProgressAt: o.QBO_CANONICAL_V2_REBUILD_LAST_PROGRESS_AT,
    lastHeartbeatAt: o.QBO_CANONICAL_V2_REBUILD_LAST_HEARTBEAT_AT,
    workerLeasePresent: !!o.QBO_CANONICAL_V2_REBUILD_WORKER_LEASE_TOKEN,
    workerLeaseExpiresAt: o.QBO_CANONICAL_V2_REBUILD_WORKER_LEASE_EXPIRES_AT,
    lastError: o.QBO_CANONICAL_V2_REBUILD_LAST_ERROR,
    legacyMigrationCursorPropertyCount: migrationKeys.length,
    legacyMigrationCursorKeyHash: qboPhaseGPreflightSha256_(migrationKeys.join('\n'))
  };
}

function qboPhaseGPreflightWorkbook_() {
  const C = QBO_PHASE_G_PREFLIGHT_V1213_;
  const ss = getQboStateCaptureSpreadsheet_();
  const specs = [
    {sheet:QBO_STATE_CAPTURE.SHEETS.SNAPSHOTS, versionHeader:'SnapshotRecordVersion', version:C.V2_VERSIONS.snapshot, idHeader:'SnapshotRecordId'},
    {sheet:QBO_STATE_CAPTURE.SHEETS.CHANGES, versionHeader:'ChangeRecordVersion', version:C.V2_VERSIONS.change, idHeader:'ChangeRecordId'},
    {sheet:QBO_STATE_CAPTURE.SHEETS.CHANGE_DETAIL, versionHeader:'ChangeDetailVersion', version:C.V2_VERSIONS.detail, idHeader:'ChangeDetailId'}
  ];
  const sheets = {};
  let totalV2Rows = 0;
  specs.forEach(function(spec) {
    const sh = ss.getSheetByName(spec.sheet);
    if (!sh) { sheets[spec.sheet] = {exists:false,rowCount:0,v2RowCount:0,idFingerprint:''}; return; }
    const lr=sh.getLastRow(), lc=sh.getLastColumn();
    if (lr < 1 || lc < 1) { sheets[spec.sheet] = {exists:true,rowCount:0,v2RowCount:0,idFingerprint:qboPhaseGPreflightSha256_('')}; return; }
    const values=sh.getRange(1,1,lr,lc).getValues(), headers=values[0].map(function(v){return String(v||'').trim();});
    const vi=headers.indexOf(spec.versionHeader), ii=headers.indexOf(spec.idHeader);
    if (vi < 0 || ii < 0) throw new Error('PHASE_G_PREFLIGHT_REQUIRED_HEADER_MISSING sheet='+spec.sheet);
    const ids=[];
    for(let r=1;r<values.length;r++) if(String(values[r][vi]||'')===spec.version) ids.push(String(values[r][ii]||''));
    ids.sort(); totalV2Rows += ids.length;
    sheets[spec.sheet] = {exists:true,rowCount:Math.max(0,lr-1),v2RowCount:ids.length,idFingerprint:qboPhaseGPreflightSha256_(ids.join('\n'))};
  });
  return {spreadsheetId:ss.getId(), totalV2Rows:totalV2Rows, sheets:sheets};
}

function qboPhaseGPreflightSha256_(value) {
  const bytes=Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,String(value||''),Utilities.Charset.UTF_8);
  return bytes.map(function(b){return ('0'+((b+256)%256).toString(16)).slice(-2);}).join('');
}
