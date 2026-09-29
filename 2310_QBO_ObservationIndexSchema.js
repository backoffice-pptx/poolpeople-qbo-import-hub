/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 2310_QBO_ObservationIndexSchema.js
 * Version     : 1.5.169
 * Purpose     : Provision and validate the physical 07_Observation_Index sheet
 *               from the governed QBO_OBSERVATION_INDEX_CONTRACT_.
 *
 * Scope:
 *   - creates 07 only when absent
 *   - writes only the governed header row / layout when creating 07
 *   - validates exact schema after provisioning
 *   - DOES NOT populate observation rows
 *   - DOES NOT mutate 05, 06, triggers, payloads, or State Application
 *
 * Operator:
 *   provisionAndValidateQboObservationIndexV169()
 */

function provisionAndValidateQboObservationIndexV169() {
  if (typeof QBO_OBSERVATION_INDEX_CONTRACT_ === 'undefined') {
    throw new Error('QBO_OBSERVATION_INDEX_CONTRACT_ is unavailable. Deploy validated 1260 contract first.');
  }

  const c = QBO_OBSERVATION_INDEX_CONTRACT_;
  const ss = getQboStateCaptureSpreadsheet_();
  const existing = ss.getSheetByName(c.SHEET_NAME);
  const created = !existing;

  // Reuse the existing governed State Capture provisioning infrastructure.
  const sh = ensureQboStateCaptureSheet_(ss, c.SHEET_NAME, c.HEADERS.slice());
  applyQboStateCaptureSheetLayout_(sh, c.HEADERS.slice());

  const validation = validateQboObservationIndexPhysicalSchemaV169_(
    sh,
    c.HEADERS.slice()
  );

  const out = {
    version: '1.5.169',
    operation: 'OBSERVATION_INDEX_PHYSICAL_SCHEMA_PROVISION_AND_VALIDATE',
    spreadsheetId: ss.getId(),
    sheetName: c.SHEET_NAME,
    sheetCreated: created,
    expectedHeaderCount: c.HEADERS.length,
    actualHeaderCount: validation.actualHeaders.length,
    dataRowCount: Math.max(0, sh.getLastRow() - 1),
    exactHeaderMatch: validation.exactHeaderMatch,
    findingCount: validation.findings.length,
    findings: validation.findings,
    valid: validation.findings.length === 0,
    safety: {
      observationRowsWritten: false,
      ingestionControlMutated: false,
      payloadArtifactsMutated: false,
      triggersMutated: false,
      stateApplicationMutated: false
    }
  };

  console.log(JSON.stringify(out, null, 2));
  return out;
}

function validateQboObservationIndexPhysicalSchemaV169_(sh, expectedHeaders) {
  const findings = [];
  const actualCount = sh.getLastColumn();
  const actualHeaders = actualCount > 0
    ? sh.getRange(1, 1, 1, actualCount).getValues()[0].map(function(v) {
        return String(v == null ? '' : v).trim();
      })
    : [];

  const exactHeaderMatch =
    actualHeaders.length === expectedHeaders.length &&
    expectedHeaders.every(function(h, i) {
      return actualHeaders[i] === h;
    });

  if (!exactHeaderMatch) {
    findings.push('07_HEADER_CONTRACT_MISMATCH');
  }

  const seen = Object.create(null);
  actualHeaders.forEach(function(h) {
    if (!h) findings.push('07_BLANK_HEADER');
    if (seen[h]) findings.push('07_DUPLICATE_HEADER:' + h);
    seen[h] = true;
  });

  expectedHeaders.forEach(function(h) {
    if (!seen[h]) findings.push('07_REQUIRED_HEADER_MISSING:' + h);
  });

  if (seen.Operation) {
    findings.push('07_AMBIGUOUS_OPERATION_HEADER_PRESENT');
  }
  if (!seen.SourceOperation) {
    findings.push('07_SOURCE_OPERATION_HEADER_MISSING');
  }

  return {
    actualHeaders: actualHeaders,
    exactHeaderMatch: exactHeaderMatch,
    findings: findings
  };
}
