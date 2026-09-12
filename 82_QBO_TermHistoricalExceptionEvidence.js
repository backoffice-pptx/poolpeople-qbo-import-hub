/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 82_QBO_TermHistoricalExceptionEvidence.js
 * Version     : 1.5.22
 * Purpose     : Govern the historical Term flattened-contract exception proven
 *               by v1.5.21 without rebuilding canonical Term history.
 *
 * Historical exception:
 *   Historical Term sources 0–9 predate the corrected v1.5.22 flattened Term
 *   contract. The legacy exporter populated Type, DueDays, DiscountDays,
 *   DiscountPercent, DayOfMonthDue, and DueNextMonthDays from nested paths
 *   that are not the actual QBO top-level Term business fields, and it omitted
 *   DiscountDayOfMonth entirely. Complete RawJSON validation evidence proves
 *   the governed top-level values and proves no historical changes in any of
 *   the seven fields.
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
 *   - v1.5.21 auditQboTermUncoveredCanonicalFields()
 *
 * Public:
 *   auditQboTermHistoricalExceptionEvidence()
 * ============================================================================
 */

function auditQboTermHistoricalExceptionEvidence() {
  if (typeof auditQboTermUncoveredCanonicalFields !== 'function') {
    throw new Error(
      'TERM_HISTORICAL_EXCEPTION_REQUIRES_V1_5_21_DIAGNOSTIC'
    );
  }

  // Reuse the exact v1.5.21 evidence engine while suppressing its verbose log.
  const originalConsoleLog = console.log;
  let diagnostic;
  try {
    console.log = function() {};
    diagnostic = auditQboTermUncoveredCanonicalFields();
  } finally {
    console.log = originalConsoleLog;
  }

  const requiredFields = [
    'Type',
    'DueDays',
    'DiscountDays',
    'DiscountPercent',
    'DayOfMonthDue',
    'DueNextMonthDays',
    'DiscountDayOfMonth'
  ];

  const fields = diagnostic.fields || {};
  const changeCounts = {};
  const flattenedEvidence = {};
  let totalCrossSourceChanges = 0;
  let totalFlattenedRowsCompared = 0;
  let totalFlattenedExactMatches = 0;
  let totalFlattenedMismatches = 0;

  requiredFields.forEach(function(field) {
    const fieldResult = fields[field] || {};
    const changes = Array.isArray(fieldResult.crossSourceChanges)
      ? fieldResult.crossSourceChanges.length
      : -1;
    const test = fieldResult.flattenedContractTest || {};

    changeCounts[field] = changes;
    if (changes > 0) totalCrossSourceChanges += changes;

    flattenedEvidence[field] = {
      expectedColumn: test.expectedColumn === undefined
        ? null
        : test.expectedColumn,
      physicalColumnPresentInSources:
        Number(test.physicalColumnPresentInSources || 0),
      rowsCompared: Number(test.rowsCompared || 0),
      exactMatches: Number(test.exactMatches || 0),
      mismatches: Number(test.mismatches || 0)
    };

    totalFlattenedRowsCompared += flattenedEvidence[field].rowsCompared;
    totalFlattenedExactMatches += flattenedEvidence[field].exactMatches;
    totalFlattenedMismatches += flattenedEvidence[field].mismatches;
  });

  const sixLegacyColumns = [
    'Type',
    'DueDays',
    'DiscountDays',
    'DiscountPercent',
    'DayOfMonthDue',
    'DueNextMonthDays'
  ];

  const sixLegacyColumnsSystematicallyWrong = sixLegacyColumns.every(
    function(field) {
      const evidence = flattenedEvidence[field];
      return evidence.physicalColumnPresentInSources === 10 &&
        evidence.rowsCompared > 0 &&
        evidence.exactMatches === 0 &&
        evidence.mismatches === evidence.rowsCompared;
    }
  );

  const missingDiscountDayOfMonth =
    flattenedEvidence.DiscountDayOfMonth.expectedColumn === null &&
    flattenedEvidence.DiscountDayOfMonth.physicalColumnPresentInSources === 0 &&
    flattenedEvidence.DiscountDayOfMonth.rowsCompared === 0;

  const valid =
    diagnostic.sourcesFound === 10 &&
    diagnostic.population &&
    diagnostic.population.sourceRows === 220 &&
    diagnostic.population.completeRawRows === 220 &&
    diagnostic.population.truncatedRawRows === 0 &&
    diagnostic.population.invalidRawRows === 0 &&
    diagnostic.population.distinctEntities === 22 &&
    diagnostic.validRawEvidence === true &&
    totalCrossSourceChanges === 0 &&
    requiredFields.every(function(field) {
      return changeCounts[field] === 0;
    }) &&
    sixLegacyColumnsSystematicallyWrong &&
    totalFlattenedRowsCompared === 760 &&
    totalFlattenedExactMatches === 0 &&
    totalFlattenedMismatches === 760 &&
    missingDiscountDayOfMonth;

  const result = {
    version: '1.5.22',
    canonicalizationVersion: 'QBO_CANONICAL_STATE_V1',
    mode: 'TERM_HISTORICAL_EXCEPTION_EVIDENCE',
    architectureRule:
      'Canonical state derives from the governed flattened export contract plus governed child datasets; RawJSON is controlled historical exception evidence only.',
    exportKey: 'TERMS',
    sourcesFound: diagnostic.sourcesFound,
    population: diagnostic.population,
    historicalExceptionFields: requiredFields,
    crossSourceChangeCounts: changeCounts,
    totalCrossSourceChanges: totalCrossSourceChanges,
    legacyFlattenedContractEvidence: {
      fields: flattenedEvidence,
      totalRowsCompared: totalFlattenedRowsCompared,
      totalExactMatches: totalFlattenedExactMatches,
      totalMismatches: totalFlattenedMismatches,
      sixLegacyColumnsSystematicallyWrong:
        sixLegacyColumnsSystematicallyWrong,
      DiscountDayOfMonthColumnHistoricallyAbsent:
        missingDiscountDayOfMonth,
      conclusion:
        sixLegacyColumnsSystematicallyWrong && missingDiscountDayOfMonth
          ? 'SYSTEMATIC_LEGACY_TERM_EXPORTER_PATH_DEFECT_AND_OMISSION_CONFIRMED'
          : 'TERM_LEGACY_FLATTENED_CONTRACT_EVIDENCE_REQUIRES_REVIEW'
    },
    governanceConclusion: valid
      ? 'PASS_EXISTING_TERM_CANONICAL_HISTORY_VALIDATED_BY_CONTROLLED_RAWJSON_EXCEPTION_EVIDENCE'
      : 'ACTION_REQUIRED_TERM_HISTORICAL_EXCEPTION_NOT_PROVEN',
    valid: valid,
    canonicalWritesPerformed: false,
    migrationCursorChanged: false,
    historicalContractAuditCursorChanged: false
  };

  console.log(JSON.stringify(result, null, 2));
  console.log(
    '[TERM HISTORICAL EXCEPTION EVIDENCE] | ' +
    (valid ? 'PASS' : 'ACTION_REQUIRED') +
    ' | sources=' + diagnostic.sourcesFound +
    ' | completeRaw=' + diagnostic.population.completeRawRows +
    ' | changes=' + totalCrossSourceChanges +
    ' | flattenedCompared=' + totalFlattenedRowsCompared +
    ' | flattenedMismatches=' + totalFlattenedMismatches +
    ' | DiscountDayOfMonthMissing=' + missingDiscountDayOfMonth
  );

  return result;
}
