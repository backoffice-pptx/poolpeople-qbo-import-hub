/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 80_QBO_ItemHistoricalExceptionEvidence.js
 * Version     : 1.5.20
 * Purpose     : Govern the historical Item flattened-contract exception proven
 *               by v1.5.19 without rebuilding canonical Item history.
 *
 * Historical exception:
 *   Item sources 0–10 predate externalization of ClassRef, Level,
 *   PrefVendorRef, PrintGroupedItems, and TaxClassificationRef.
 *   Complete RawJSON validation evidence proves no historical changes in any
 *   of those fields. Level is fully derivable from ParentRef. The historical
 *   PrintGroupedItems flattened column is invalid evidence because the legacy
 *   exporter read the wrong QBO path.
 *
 * RawJSON remains controlled validation evidence only. It is not the normal
 * canonicalization input.
 *
 * Safety:
 *   - No canonical writes.
 *   - No migration cursor changes.
 *   - No historical coverage cursor changes.
 *
 * Dependency:
 *   - v1.5.19 auditQboItemUncoveredCanonicalFields()
 *
 * Public:
 *   auditQboItemHistoricalExceptionEvidence()
 * ============================================================================
 */

function auditQboItemHistoricalExceptionEvidence() {
  if (typeof auditQboItemUncoveredCanonicalFields !== 'function') {
    throw new Error(
      'ITEM_HISTORICAL_EXCEPTION_REQUIRES_V1_5_19_DIAGNOSTIC'
    );
  }

  // v1.5.19 intentionally emits a comprehensive evidence object that can
  // exceed the Apps Script log display limit. Reuse that exact evidence engine
  // while suppressing its verbose console.log output here; this control emits
  // only the compact governed conclusion.
  const originalConsoleLog = console.log;
  let diagnostic;
  try {
    console.log = function() {};
    diagnostic = auditQboItemUncoveredCanonicalFields();
  } finally {
    console.log = originalConsoleLog;
  }

  const fields = diagnostic.fields || {};
  const requiredFields = [
    'ClassRef',
    'Level',
    'PrefVendorRef',
    'PrintGroupedItems',
    'TaxClassificationRef'
  ];

  const changeCounts = {};
  let totalCrossSourceChanges = 0;

  requiredFields.forEach(function(field) {
    const fieldResult = fields[field] || {};
    const count = Array.isArray(fieldResult.crossSourceChanges)
      ? fieldResult.crossSourceChanges.length
      : -1;
    changeCounts[field] = count;
    if (count > 0) totalCrossSourceChanges += count;
  });

  const printTest = diagnostic.PrintGroupedItemsContractTest || {};
  const levelTest = diagnostic.LevelDerivationTest || {};

  const valid =
    diagnostic.sourcesFound === 11 &&
    diagnostic.population &&
    diagnostic.population.sourceRows === 5109 &&
    diagnostic.population.completeRawRows === 5109 &&
    diagnostic.population.truncatedRawRows === 0 &&
    diagnostic.population.invalidRawRows === 0 &&
    totalCrossSourceChanges === 0 &&
    changeCounts.ClassRef === 0 &&
    changeCounts.Level === 0 &&
    changeCounts.PrefVendorRef === 0 &&
    changeCounts.PrintGroupedItems === 0 &&
    changeCounts.TaxClassificationRef === 0 &&
    printTest.rowsCompared === 176 &&
    printTest.mismatches === 176 &&
    printTest.exactMatches === 0 &&
    levelTest.mismatches === 0 &&
    levelTest.rowsCompared > 0;

  const result = {
    version: '1.5.20',
    canonicalizationVersion: 'QBO_CANONICAL_STATE_V1',
    mode: 'ITEM_HISTORICAL_EXCEPTION_EVIDENCE',
    architectureRule:
      'Canonical state derives from the governed flattened export contract plus governed child datasets; RawJSON is controlled historical exception evidence only.',
    exportKey: 'ITEMS',
    sourcesFound: diagnostic.sourcesFound,
    population: diagnostic.population,
    historicalExceptionFields: requiredFields,
    crossSourceChangeCounts: changeCounts,
    totalCrossSourceChanges: totalCrossSourceChanges,
    LevelEvidence: {
      rowsComparedToParentHierarchy: levelTest.rowsCompared,
      exactMatches: levelTest.exactMatches,
      mismatches: levelTest.mismatches,
      conclusion: levelTest.mismatches === 0
        ? 'LEVEL_EXACTLY_DERIVABLE_FROM_PARENTREF_HIERARCHY'
        : 'LEVEL_DERIVATION_EXCEPTION_FOUND'
    },
    PrintGroupedItemsEvidence: {
      rowsCompared: printTest.rowsCompared,
      exactMatches: printTest.exactMatches,
      mismatches: printTest.mismatches,
      conclusion:
        printTest.rowsCompared === 176 &&
        printTest.mismatches === 176 &&
        printTest.exactMatches === 0
          ? 'SYSTEMATIC_LEGACY_EXPORTER_PATH_DEFECT_CONFIRMED'
          : 'PRINT_GROUPED_ITEMS_EVIDENCE_REQUIRES_REVIEW'
    },
    governanceConclusion: valid
      ? 'PASS_EXISTING_ITEM_CANONICAL_HISTORY_VALIDATED_BY_CONTROLLED_RAWJSON_EXCEPTION_EVIDENCE'
      : 'ACTION_REQUIRED_ITEM_HISTORICAL_EXCEPTION_NOT_PROVEN',
    valid: valid,
    canonicalWritesPerformed: false,
    migrationCursorChanged: false,
    historicalContractAuditCursorChanged: false
  };

  console.log(JSON.stringify(result, null, 2));
  console.log(
    '[ITEM HISTORICAL EXCEPTION EVIDENCE] | ' +
    (valid ? 'PASS' : 'ACTION_REQUIRED') +
    ' | sources=' + diagnostic.sourcesFound +
    ' | completeRaw=' + diagnostic.population.completeRawRows +
    ' | changes=' + totalCrossSourceChanges +
    ' | LevelMismatches=' + levelTest.mismatches +
    ' | PrintGroupedItemsMismatches=' + printTest.mismatches
  );

  return result;
}
