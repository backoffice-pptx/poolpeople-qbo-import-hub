/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 91_QBO_CreditMemoHistoricalExceptionEvidence.js
 * Version     : 1.5.33
 * Purpose     : Govern the historical Credit Memo flattened-contract exception
 *               after the seven-field v1.5.33 Credit Memo contract correction.
 *
 * Historical exception:
 *   Historical Credit Memo Master Backups predate externalization of seven
 *   governed QBO top-level business-state fields. v1.5.32 established that all
 *   seven fields are present in complete RawJSON evidence, none changed for any
 *   Credit Memo across the ten historical sources, and Balance exactly matched
 *   the already-flattened RemainingCredit value for every historical row.
 *
 *   Existing Credit Memo canonical history was produced by the prior RawJSON-
 *   based controlled migration (253 initial snapshots, zero changes). Because
 *   the seven omitted fields had no historical cross-source transitions, no
 *   historical state change was lost. Beginning with v1.5.33, the governed
 *   flattened QBO_CreditMemos contract externalizes all seven fields directly.
 *
 * RawJSON remains controlled historical exception / contract-validation
 * evidence only. It is not the normal canonicalization input.
 *
 * Safety:
 *   - No canonical writes.
 *   - No migration cursor changes.
 *   - No historical coverage cursor changes.
 *
 * Dependency:
 *   - v1.5.32 auditQboCreditMemoUncoveredFields()
 *
 * Public:
 *   auditQboCreditMemoHistoricalExceptionEvidence()
 * ============================================================================
 */

const QBO_CREDIT_MEMO_HISTORICAL_EXCEPTION_V1533_ = Object.freeze({
  VERSION: '1.5.33',
  FIELDS: Object.freeze([
    'Balance',
    'BillEmailBcc',
    'BillEmailCc',
    'FreeFormAddress',
    'RecurDataRef',
    'ShipFromAddr',
    'TaxExemptionRef'
  ])
});

function auditQboCreditMemoHistoricalExceptionEvidence() {
  if (typeof auditQboCreditMemoUncoveredFields !== 'function') {
    throw new Error(
      'CREDIT_MEMO_HISTORICAL_EXCEPTION_REQUIRES_V1_5_32_DIAGNOSTIC'
    );
  }

  const originalConsoleLog = console.log;
  let diagnostic;
  try {
    console.log = function() {};
    diagnostic = auditQboCreditMemoUncoveredFields();
  } finally {
    console.log = originalConsoleLog;
  }

  const expectedFields = QBO_CREDIT_MEMO_HISTORICAL_EXCEPTION_V1533_.FIELDS.slice();
  const fields = diagnostic.fields || {};
  const population = diagnostic.population || {};
  const balanceComparison = diagnostic.semanticCandidateComparison &&
    diagnostic.semanticCandidateComparison.Balance_vs_flattened_RemainingCredit
      ? diagnostic.semanticCandidateComparison.Balance_vs_flattened_RemainingCredit
      : {};

  const perField = {};
  let totalCrossSourceChanges = 0;
  expectedFields.forEach(function(field) {
    const stats = fields[field] || {};
    const changeCount = Number(stats.crossSourceChangeCount || 0);
    totalCrossSourceChanges += changeCount;
    perField[field] = {
      presentRows: Number(stats.presentRows || 0),
      absentRows: Number(stats.absentRows || 0),
      crossSourceChangeCount: changeCount,
      physicalSameNameColumnSources: Number(stats.physicalSameNameColumnSources || 0)
    };
  });

  const allExpectedFieldsRepresented = expectedFields.every(function(field) {
    return Object.prototype.hasOwnProperty.call(fields, field);
  });

  const valid =
    Number(diagnostic.sourcesFound || 0) === 10 &&
    Number(population.sourceRows || 0) === 2530 &&
    Number(population.completeRawRows || 0) === 2530 &&
    Number(population.truncatedRawRows || 0) === 0 &&
    Number(population.invalidRawRows || 0) === 0 &&
    Number(population.distinctEntities || 0) === 253 &&
    allExpectedFieldsRepresented &&
    totalCrossSourceChanges === 0 &&
    Number(balanceComparison.sourcesWithRemainingCreditColumn || 0) === 10 &&
    Number(balanceComparison.rowsCompared || 0) === 2530 &&
    Number(balanceComparison.exactMatches || 0) === 2530 &&
    Number(balanceComparison.mismatches || 0) === 0;

  const result = {
    version: QBO_CREDIT_MEMO_HISTORICAL_EXCEPTION_V1533_.VERSION,
    canonicalizationVersion: QBO_STATE_CAPTURE.CANONICALIZATION_VERSION,
    mode: 'CREDIT_MEMO_HISTORICAL_EXCEPTION_EVIDENCE',
    architectureRule:
      'Canonical state derives from the governed flattened export contract plus governed child datasets; complete RawJSON is controlled historical exception and validation evidence only.',
    exportKey: 'CREDIT_MEMOS',
    governedHistoricalExceptionFields: expectedFields,
    sourcesFound: Number(diagnostic.sourcesFound || 0),
    population: population,
    perField: perField,
    totalCrossSourceChanges: totalCrossSourceChanges,
    balanceVsHistoricalRemainingCredit: balanceComparison,
    allExpectedFieldsRepresented: allExpectedFieldsRepresented,
    historicalCanonicalEvidence: {
      priorControlledMigrationMode: 'RAWJSON_BASED',
      initialSnapshots: 253,
      historicalChanges: 0,
      conclusion:
        'NO_GOVERNED_OMITTED_FIELD_CHANGED_ACROSS_HISTORICAL_SOURCES; EXISTING INITIAL CANONICAL SNAPSHOTS MAY STAND'
    },
    historicalContractCorrection:
      'V1_5_33_EXTERNALIZES_ALL_7_GOVERNED_CREDIT_MEMO_FIELDS',
    historicalCanonicalTreatment:
      valid
        ? 'KEEP_EXISTING_CANONICAL_HISTORY_NO_REBUILD_REQUIRED'
        : 'ACTION_REQUIRED_DO_NOT_REBUILD_OR_ADVANCE_BASED_ON_THIS_RESULT',
    governanceConclusion: valid
      ? 'PASS_EXISTING_CREDIT_MEMO_CANONICAL_HISTORY_VALIDATED_BY_CONTROLLED_RAWJSON_EXCEPTION_EVIDENCE'
      : 'ACTION_REQUIRED_CREDIT_MEMO_HISTORICAL_EXCEPTION_NOT_PROVEN',
    valid: valid,
    canonicalWritesPerformed: false,
    migrationCursorChanged: false,
    historicalContractAuditCursorChanged: false
  };

  console.log(JSON.stringify(result, null, 2));
  console.log(
    '[CREDIT MEMO HISTORICAL EXCEPTION EVIDENCE] | ' +
    (valid ? 'PASS' : 'ACTION_REQUIRED') +
    ' | sources=' + result.sourcesFound +
    ' | completeRaw=' + Number(population.completeRawRows || 0) +
    ' | fieldChanges=' + totalCrossSourceChanges +
    ' | balanceExact=' + Number(balanceComparison.exactMatches || 0) +
    ' | balanceMismatches=' + Number(balanceComparison.mismatches || 0)
  );

  return result;
}
