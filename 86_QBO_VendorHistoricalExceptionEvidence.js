/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 86_QBO_VendorHistoricalExceptionEvidence.js
 * Version     : 1.5.26
 * Purpose     : Govern the historical Vendor BillRate / CostRate flattened-
 *               contract exception proven by v1.5.25 without rebuilding
 *               canonical Vendor history.
 *
 * Historical exception:
 *   Historical Vendor sources predate externalization of the QBO top-level
 *   BillRate and CostRate business-state fields. Complete RawJSON validation
 *   evidence proves both fields were present on every observed Vendor row,
 *   remained 0 throughout the historical population, and had no cross-source
 *   changes. Historical source sheets contained no physical BillRate or
 *   CostRate columns.
 *
 * RawJSON remains controlled historical exception evidence only. It is not the
 * normal canonicalization input.
 *
 * Safety:
 *   - No canonical writes.
 *   - No migration cursor changes.
 *   - No historical coverage cursor changes.
 *
 * Dependency:
 *   - v1.5.25 auditQboVendorRateFields()
 *
 * Public:
 *   auditQboVendorHistoricalExceptionEvidence()
 * ============================================================================
 */

function auditQboVendorHistoricalExceptionEvidence() {
  if (typeof auditQboVendorRateFields !== 'function') {
    throw new Error(
      'VENDOR_HISTORICAL_EXCEPTION_REQUIRES_V1_5_25_DIAGNOSTIC'
    );
  }

  // Reuse the exact v1.5.25 evidence engine while suppressing its verbose log.
  const originalConsoleLog = console.log;
  let diagnostic;
  try {
    console.log = function() {};
    diagnostic = auditQboVendorRateFields();
  } finally {
    console.log = originalConsoleLog;
  }

  const population = diagnostic.population || {};
  const fields = diagnostic.fields || {};
  const billRate = fields.BillRate || {};
  const costRate = fields.CostRate || {};

  function fieldEvidence_(fieldName, fieldData) {
    const distinctValues = Array.isArray(fieldData.distinctValues)
      ? fieldData.distinctValues
      : [];
    const crossSourceChanges = Array.isArray(fieldData.crossSourceChanges)
      ? fieldData.crossSourceChanges
      : [];
    const flattened = fieldData.flattenedContractTest || {};

    const allObservedValuesZero =
      distinctValues.length === 1 &&
      String(distinctValues[0].value) === '0' &&
      Number(distinctValues[0].count || 0) === 4500;

    const historicalColumnAbsent =
      Array.isArray(flattened.candidateColumns) &&
      flattened.candidateColumns.indexOf(fieldName) !== -1 &&
      Array.isArray(flattened.physicalCandidateColumns) &&
      flattened.physicalCandidateColumns.length === 0 &&
      Number(flattened.rowsCompared || 0) === 0 &&
      Number(flattened.exactMatches || 0) === 0 &&
      Number(flattened.mismatches || 0) === 0;

    return {
      presentRows: Number(fieldData.presentRows || 0),
      absentRows: Number(fieldData.absentRows || 0),
      distinctValues: distinctValues,
      crossSourceChangeCount: crossSourceChanges.length,
      allObservedValuesZero: allObservedValuesZero,
      historicalColumnAbsent: historicalColumnAbsent,
      flattenedContractTest: {
        candidateColumns: flattened.candidateColumns || [],
        physicalCandidateColumns: flattened.physicalCandidateColumns || [],
        rowsCompared: Number(flattened.rowsCompared || 0),
        exactMatches: Number(flattened.exactMatches || 0),
        mismatches: Number(flattened.mismatches || 0)
      }
    };
  }

  const billRateEvidence = fieldEvidence_('BillRate', billRate);
  const costRateEvidence = fieldEvidence_('CostRate', costRate);

  const valid =
    diagnostic.sourcesFound === 10 &&
    population.sourceRows === 4500 &&
    population.completeRawRows === 4500 &&
    population.truncatedRawRows === 0 &&
    population.invalidRawRows === 0 &&
    population.distinctEntities === 450 &&
    billRateEvidence.presentRows === 4500 &&
    billRateEvidence.absentRows === 0 &&
    billRateEvidence.crossSourceChangeCount === 0 &&
    billRateEvidence.allObservedValuesZero &&
    billRateEvidence.historicalColumnAbsent &&
    costRateEvidence.presentRows === 4500 &&
    costRateEvidence.absentRows === 0 &&
    costRateEvidence.crossSourceChangeCount === 0 &&
    costRateEvidence.allObservedValuesZero &&
    costRateEvidence.historicalColumnAbsent;

  const result = {
    version: '1.5.26',
    canonicalizationVersion: QBO_STATE_CAPTURE.CANONICALIZATION_VERSION,
    mode: 'VENDOR_HISTORICAL_EXCEPTION_EVIDENCE',
    architectureRule:
      'Canonical state derives from the governed flattened export contract plus governed child datasets; RawJSON is controlled historical exception evidence only.',
    exportKey: 'VENDORS',
    sourcesFound: diagnostic.sourcesFound,
    population: population,
    historicalExceptionFields: ['BillRate', 'CostRate'],
    billRateEvidence: billRateEvidence,
    costRateEvidence: costRateEvidence,
    legacyFlattenedContractEvidence: {
      BillRateColumnHistoricallyAbsent: billRateEvidence.historicalColumnAbsent,
      CostRateColumnHistoricallyAbsent: costRateEvidence.historicalColumnAbsent,
      conclusion:
        billRateEvidence.historicalColumnAbsent && costRateEvidence.historicalColumnAbsent
          ? 'HISTORICAL_VENDOR_RATE_COLUMN_OMISSIONS_CONFIRMED'
          : 'VENDOR_LEGACY_FLATTENED_CONTRACT_EVIDENCE_REQUIRES_REVIEW'
    },
    governanceConclusion: valid
      ? 'PASS_EXISTING_VENDOR_CANONICAL_HISTORY_VALIDATED_BY_CONTROLLED_RAWJSON_EXCEPTION_EVIDENCE'
      : 'ACTION_REQUIRED_VENDOR_HISTORICAL_EXCEPTION_NOT_PROVEN',
    valid: valid,
    canonicalWritesPerformed: false,
    migrationCursorChanged: false,
    historicalContractAuditCursorChanged: false
  };

  console.log(JSON.stringify(result, null, 2));
  console.log(
    '[VENDOR HISTORICAL EXCEPTION EVIDENCE] | ' +
    (valid ? 'PASS' : 'ACTION_REQUIRED') +
    ' | sources=' + diagnostic.sourcesFound +
    ' | completeRaw=' + population.completeRawRows +
    ' | BillRatePresent=' + billRateEvidence.presentRows +
    ' | BillRateChanges=' + billRateEvidence.crossSourceChangeCount +
    ' | BillRateAllZero=' + billRateEvidence.allObservedValuesZero +
    ' | BillRateColumnMissing=' + billRateEvidence.historicalColumnAbsent +
    ' | CostRatePresent=' + costRateEvidence.presentRows +
    ' | CostRateChanges=' + costRateEvidence.crossSourceChangeCount +
    ' | CostRateAllZero=' + costRateEvidence.allObservedValuesZero +
    ' | CostRateColumnMissing=' + costRateEvidence.historicalColumnAbsent
  );

  return result;
}
