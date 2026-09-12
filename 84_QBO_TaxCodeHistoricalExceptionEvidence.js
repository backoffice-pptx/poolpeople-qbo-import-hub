/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 84_QBO_TaxCodeHistoricalExceptionEvidence.js
 * Version     : 1.5.24
 * Purpose     : Govern the historical TaxCode Hidden flattened-contract
 *               exception proven by v1.5.23 without rebuilding canonical
 *               TaxCode history.
 *
 * Historical exception:
 *   Historical TaxCode sources predate externalization of the QBO top-level
 *   Hidden business-state field. Complete RawJSON validation evidence proves
 *   Hidden was present on every observed TaxCode row, was false throughout the
 *   historical population, and had no cross-source changes. Historical source
 *   sheets contained no physical Hidden column.
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
 *   - v1.5.23 auditQboTaxCodeHiddenField()
 *
 * Public:
 *   auditQboTaxCodeHistoricalExceptionEvidence()
 * ============================================================================
 */

function auditQboTaxCodeHistoricalExceptionEvidence() {
  if (typeof auditQboTaxCodeHiddenField !== 'function') {
    throw new Error(
      'TAX_CODE_HISTORICAL_EXCEPTION_REQUIRES_V1_5_23_DIAGNOSTIC'
    );
  }

  // Reuse the exact v1.5.23 evidence engine while suppressing its verbose log.
  const originalConsoleLog = console.log;
  let diagnostic;
  try {
    console.log = function() {};
    diagnostic = auditQboTaxCodeHiddenField();
  } finally {
    console.log = originalConsoleLog;
  }

  const population = diagnostic.population || {};
  const hidden = diagnostic.hidden || {};
  const flattened = diagnostic.flattenedContractTest || {};
  const distinctValues = Array.isArray(hidden.distinctValues)
    ? hidden.distinctValues
    : [];
  const crossSourceChanges = Array.isArray(hidden.crossSourceChanges)
    ? hidden.crossSourceChanges
    : [];

  const onlyObservedValueIsFalse =
    distinctValues.length === 1 &&
    String(distinctValues[0].value) === 'false' &&
    Number(distinctValues[0].count || 0) === 99;

  const historicalColumnAbsent =
    flattened.expectedColumn === 'Hidden' &&
    Number(flattened.physicalColumnPresentInSources || 0) === 0 &&
    Number(flattened.rowsCompared || 0) === 0 &&
    Number(flattened.exactMatches || 0) === 0 &&
    Number(flattened.mismatches || 0) === 0;

  const valid =
    diagnostic.sourcesFound === 11 &&
    population.sourceRows === 99 &&
    population.completeRawRows === 99 &&
    population.truncatedRawRows === 0 &&
    population.invalidRawRows === 0 &&
    population.distinctEntities === 9 &&
    hidden.presentRows === 99 &&
    hidden.absentRows === 0 &&
    crossSourceChanges.length === 0 &&
    onlyObservedValueIsFalse &&
    historicalColumnAbsent;

  const result = {
    version: '1.5.24',
    canonicalizationVersion: QBO_STATE_CAPTURE.CANONICALIZATION_VERSION,
    mode: 'TAX_CODE_HISTORICAL_EXCEPTION_EVIDENCE',
    architectureRule:
      'Canonical state derives from the governed flattened export contract plus governed child datasets; RawJSON is controlled historical exception evidence only.',
    exportKey: 'TAX_CODES',
    sourcesFound: diagnostic.sourcesFound,
    population: population,
    historicalExceptionFields: ['Hidden'],
    hiddenEvidence: {
      presentRows: hidden.presentRows,
      absentRows: hidden.absentRows,
      distinctValues: distinctValues,
      crossSourceChangeCount: crossSourceChanges.length,
      allObservedValuesFalse: onlyObservedValueIsFalse
    },
    legacyFlattenedContractEvidence: {
      expectedColumn: flattened.expectedColumn,
      physicalColumnPresentInSources:
        Number(flattened.physicalColumnPresentInSources || 0),
      rowsCompared: Number(flattened.rowsCompared || 0),
      exactMatches: Number(flattened.exactMatches || 0),
      mismatches: Number(flattened.mismatches || 0),
      HiddenColumnHistoricallyAbsent: historicalColumnAbsent,
      conclusion: historicalColumnAbsent
        ? 'HISTORICAL_TAX_CODE_HIDDEN_COLUMN_OMISSION_CONFIRMED'
        : 'TAX_CODE_LEGACY_FLATTENED_CONTRACT_EVIDENCE_REQUIRES_REVIEW'
    },
    governanceConclusion: valid
      ? 'PASS_EXISTING_TAX_CODE_CANONICAL_HISTORY_VALIDATED_BY_CONTROLLED_RAWJSON_EXCEPTION_EVIDENCE'
      : 'ACTION_REQUIRED_TAX_CODE_HISTORICAL_EXCEPTION_NOT_PROVEN',
    valid: valid,
    canonicalWritesPerformed: false,
    migrationCursorChanged: false,
    historicalContractAuditCursorChanged: false
  };

  console.log(JSON.stringify(result, null, 2));
  console.log(
    '[TAX CODE HISTORICAL EXCEPTION EVIDENCE] | ' +
    (valid ? 'PASS' : 'ACTION_REQUIRED') +
    ' | sources=' + diagnostic.sourcesFound +
    ' | completeRaw=' + population.completeRawRows +
    ' | HiddenPresent=' + hidden.presentRows +
    ' | HiddenChanges=' + crossSourceChanges.length +
    ' | allFalse=' + onlyObservedValueIsFalse +
    ' | HiddenColumnMissing=' + historicalColumnAbsent
  );

  return result;
}
