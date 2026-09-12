/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 89_QBO_InvoiceHistoricalExceptionEvidence.js
 * Version     : 1.5.31
 * Purpose     : Govern the historical Invoice flattened-contract exception
 *               after the 15-field v1.5.31 Invoice contract correction.
 *
 * Historical exception:
 *   Historical Invoice Master Backups predate externalization of 15 governed
 *   QBO top-level business-state fields. v1.5.29 established the omissions and
 *   profiled the historical values. v1.5.30 then proved that every observed
 *   historical change in those fields was already captured in the existing
 *   canonical Snapshot / Change / Change Detail history produced by the prior
 *   RawJSON-based controlled migration.
 *
 * Therefore the existing historical Invoice canonical history may stand; no
 * historical rebuild is required. Beginning with v1.5.31, the governed
 * flattened QBO_Invoices contract externalizes all 15 fields for normal future
 * canonical derivation.
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
 *   - v1.5.30 auditQboInvoiceHistoricalOmittedFieldImpact()
 *
 * Public:
 *   auditQboInvoiceHistoricalExceptionEvidence()
 * ============================================================================
 */

const QBO_INVOICE_HISTORICAL_EXCEPTION_V1531_ = Object.freeze({
  VERSION: '1.5.31',
  FIELDS: Object.freeze([
    'AllowOnlineAffirmPayment',
    'AllowOnlinePayPalPayment',
    'BillEmailBcc',
    'BillEmailCc',
    'CreditCardPayment',
    'EInvoiceStatus',
    'FreeFormAddress',
    'PaymentMethodRef',
    'PaymentRefNum',
    'RecurDataRef',
    'ScheduledPaymentId',
    'ShipFromAddr',
    'ShipMethodRef',
    'TaxExemptionRef',
    'TxnApprovalInfo'
  ])
});

function auditQboInvoiceHistoricalExceptionEvidence() {
  if (typeof auditQboInvoiceHistoricalOmittedFieldImpact !== 'function') {
    throw new Error(
      'INVOICE_HISTORICAL_EXCEPTION_REQUIRES_V1_5_30_IMPACT_DIAGNOSTIC'
    );
  }

  // Reuse the exact v1.5.30 evidence engine while suppressing its detailed log.
  const originalConsoleLog = console.log;
  let diagnostic;
  try {
    console.log = function() {};
    diagnostic = auditQboInvoiceHistoricalOmittedFieldImpact();
  } finally {
    console.log = originalConsoleLog;
  }

  const population = diagnostic.population || {};
  const canonicalEvidencePopulation = diagnostic.canonicalEvidencePopulation || {};
  const impact = diagnostic.historicalImpact || {};
  const fields = diagnostic.perField && typeof diagnostic.perField === 'object'
    ? diagnostic.perField
    : {};

  const expectedFields = QBO_INVOICE_HISTORICAL_EXCEPTION_V1531_.FIELDS.slice();
  const observedFieldNames = Object.keys(fields).sort();
  const expectedFieldNames = expectedFields.slice().sort();

  const allExpectedFieldsRepresented =
    observedFieldNames.length === expectedFieldNames.length &&
    expectedFieldNames.every(function(field, index) {
      return observedFieldNames[index] === field;
    });

  const valid =
    Number(diagnostic.sourcesFound || 0) === 10 &&
    Number(population.sourceRows || 0) === 177658 &&
    Number(population.completeRawRows || 0) === 177658 &&
    Number(population.truncatedRawRows || 0) === 0 &&
    Number(population.invalidRawRows || 0) === 0 &&
    Number(population.distinctEntities || 0) === 17774 &&
    Number(canonicalEvidencePopulation.invoiceSnapshots || 0) === 17809 &&
    Number(canonicalEvidencePopulation.invoiceChanges || 0) === 64 &&
    Number(canonicalEvidencePopulation.invoiceChangeDetails || 0) === 2871 &&
    Number(impact.distinctTransitionEventsWithGovernedOmittedFieldChanges || 0) === 13 &&
    Number(impact.totalGovernedOmittedFieldChanges || 0) === 17 &&
    Number(impact.fullyCapturedEvents || 0) === 13 &&
    Number(impact.partiallyCapturedEvents || 0) === 0 &&
    Number(impact.noExistingSnapshotEvents || 0) === 0 &&
    Number(impact.snapshotWithoutChangeEvents || 0) === 0 &&
    impact.allHistoricalFieldChangesCaptured === true &&
    allExpectedFieldsRepresented;

  const result = {
    version: QBO_INVOICE_HISTORICAL_EXCEPTION_V1531_.VERSION,
    canonicalizationVersion: QBO_STATE_CAPTURE.CANONICALIZATION_VERSION,
    mode: 'INVOICE_HISTORICAL_EXCEPTION_EVIDENCE',
    architectureRule:
      'Canonical state derives from the governed flattened export contract plus governed child datasets; complete RawJSON is controlled historical exception and validation evidence only.',
    exportKey: 'INVOICES',
    governedHistoricalExceptionFields: expectedFields,
    sourcesFound: Number(diagnostic.sourcesFound || 0),
    population: population,
    canonicalEvidencePopulation: canonicalEvidencePopulation,
    historicalImpact: impact,
    allExpectedFieldsRepresented: allExpectedFieldsRepresented,
    historicalContractCorrection:
      'V1_5_31_EXTERNALIZES_ALL_15_GOVERNED_INVOICE_FIELDS',
    historicalCanonicalTreatment:
      valid
        ? 'KEEP_EXISTING_CANONICAL_HISTORY_NO_REBUILD_REQUIRED'
        : 'ACTION_REQUIRED_DO_NOT_REBUILD_OR_ADVANCE_BASED_ON_THIS_RESULT',
    governanceConclusion: valid
      ? 'PASS_EXISTING_INVOICE_CANONICAL_HISTORY_VALIDATED_BY_CONTROLLED_RAWJSON_EXCEPTION_EVIDENCE'
      : 'ACTION_REQUIRED_INVOICE_HISTORICAL_EXCEPTION_NOT_PROVEN',
    valid: valid,
    canonicalWritesPerformed: false,
    migrationCursorChanged: false,
    historicalContractAuditCursorChanged: false
  };

  console.log(JSON.stringify(result, null, 2));
  console.log(
    '[INVOICE HISTORICAL EXCEPTION EVIDENCE] | ' +
    (valid ? 'PASS' : 'ACTION_REQUIRED') +
    ' | sources=' + result.sourcesFound +
    ' | completeRaw=' + Number(population.completeRawRows || 0) +
    ' | transitionEvents=' + Number(impact.distinctTransitionEventsWithGovernedOmittedFieldChanges || 0) +
    ' | fieldChanges=' + Number(impact.totalGovernedOmittedFieldChanges || 0) +
    ' | fullyCaptured=' + Number(impact.fullyCapturedEvents || 0) +
    ' | partial=' + Number(impact.partiallyCapturedEvents || 0) +
    ' | noSnapshot=' + Number(impact.noExistingSnapshotEvents || 0) +
    ' | allFieldsRepresented=' + allExpectedFieldsRepresented
  );

  return result;
}
