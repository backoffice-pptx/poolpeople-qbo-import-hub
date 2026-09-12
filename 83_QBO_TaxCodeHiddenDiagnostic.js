/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 83_QBO_TaxCodeHiddenDiagnostic.js
 * Version     : 1.5.23
 * Purpose     : Read-only diagnostic for the TaxCode Hidden top-level canonical
 *               field observed in RawJSON but not externalized by the governed
 *               historical flattened TaxCode contract.
 *
 * Architecture rule:
 *   Canonical state derives from the governed flattened export contract plus
 *   governed child datasets. RawJSON is validation/exception evidence only.
 *
 * Safety:
 *   - No canonical rows are written.
 *   - No migration cursor is changed.
 *   - No historical contract audit cursor is changed.
 *   - No exporter behavior is changed.
 *
 * Public:
 *   auditQboTaxCodeHiddenField()
 * ============================================================================
 */

const QBO_TAX_CODE_HIDDEN_DIAGNOSTIC_ = Object.freeze({
  EXPORT_KEY: 'TAX_CODES',
  PARENT_SHEET: 'QBO_TaxCodes',
  FIELD: 'Hidden',
  FLATTENED_COLUMN: 'Hidden',
  PRESERVED_INFERENCE_FIELDS: Object.freeze([
    'Active',
    'Taxable',
    'TaxGroup',
    'TaxCodeConfigType'
  ])
});

/**
 * Scans every AVAILABLE historical TaxCode source and evaluates the uncovered
 * top-level Hidden field.
 *
 * @return {Object} Diagnostic result.
 */
function auditQboTaxCodeHiddenField() {
  const cfg = QBO_TAX_CODE_HIDDEN_DIAGNOSTIC_;
  const exportKey = cfg.EXPORT_KEY;

  const stateSs = getQboStateCaptureSpreadsheet_();
  const sourceSheet = stateSs.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);
  const sources = loadQboStateCaptureWriteSources_(sourceSheet, exportKey)
    .filter(function(source) {
      return source.sourceStatus === QBO_STATE_CAPTURE.SOURCE_STATUS_AVAILABLE;
    });

  let sourceRows = 0;
  let completeRawRows = 0;
  let truncatedRawRows = 0;
  let invalidRawRows = 0;
  let presentRows = 0;
  let absentRows = 0;
  let physicalHiddenColumnPresentInSources = 0;
  let flattenedRowsCompared = 0;
  let flattenedExactMatches = 0;
  let flattenedMismatches = 0;

  const distinctValues = Object.create(null);
  const byEntity = Object.create(null);
  const populatedEntities = Object.create(null);
  const flattenedMismatchExamples = [];
  const sourceSummaries = [];

  // Tests whether Hidden is deterministically implied, in this observed
  // historical population, by meaningful already-preserved TaxCode fields.
  // This is evidence only; a historical correlation is not by itself a reason
  // to exclude a genuine QBO business-state field from the governed contract.
  const inferenceTests = Object.create(null);
  const inferenceFieldSets = [
    ['Active'],
    ['Taxable'],
    ['TaxGroup'],
    ['TaxCodeConfigType'],
    ['Active','Taxable','TaxGroup','TaxCodeConfigType']
  ];
  inferenceFieldSets.forEach(function(fields) {
    inferenceTests[fields.join('+')] = Object.create(null);
  });

  sources.forEach(function(source, sourceIndex) {
    validateQboStateCaptureWriteSource_(
      source,
      getQboExportManifestEntry_(exportKey)
    );

    const sourceSs = SpreadsheetApp.openById(source.masterBackupFileId);
    const sheet = sourceSs.getSheetByName(cfg.PARENT_SHEET);
    if (!sheet) {
      throw new Error(
        'TAX_CODE_HIDDEN_PARENT_SHEET_MISSING sourceIndex=' + sourceIndex +
        ' file=' + source.masterBackupFileName
      );
    }

    const data = qboTaxCodeHiddenReadSheet_(sheet);
    if (data.index.RawJSON === undefined) {
      throw new Error(
        'TAX_CODE_HIDDEN_RAWJSON_COLUMN_MISSING sourceIndex=' + sourceIndex +
        ' file=' + source.masterBackupFileName
      );
    }

    const hasPhysicalHiddenColumn = data.index[cfg.FLATTENED_COLUMN] !== undefined;
    if (hasPhysicalHiddenColumn) physicalHiddenColumnPresentInSources += 1;

    let sourceComplete = 0;
    let sourceTruncated = 0;
    let sourceInvalid = 0;
    let sourcePresent = 0;
    let sourceAbsent = 0;

    data.rows.forEach(function(row) {
      sourceRows += 1;
      const raw = String(row[data.index.RawJSON] || '');

      if (raw.indexOf(QBO_STATE_CAPTURE_RAW_TRUNCATION_MARKER_) !== -1) {
        truncatedRawRows += 1;
        sourceTruncated += 1;
        return;
      }

      let taxCode;
      try {
        taxCode = JSON.parse(raw);
      } catch (e) {
        invalidRawRows += 1;
        sourceInvalid += 1;
        return;
      }

      completeRawRows += 1;
      sourceComplete += 1;

      const entityId = String(taxCode.Id || '');
      const displayName = taxCode.Name === undefined || taxCode.Name === null
        ? ''
        : String(taxCode.Name);
      const present = Object.prototype.hasOwnProperty.call(taxCode, cfg.FIELD);
      const encoded = present
        ? qboTaxCodeHiddenStableString_(taxCode[cfg.FIELD])
        : '__ABSENT__';

      if (present) {
        presentRows += 1;
        sourcePresent += 1;
      } else {
        absentRows += 1;
        sourceAbsent += 1;
      }
      distinctValues[encoded] = (distinctValues[encoded] || 0) + 1;

      if (!byEntity[entityId]) {
        byEntity[entityId] = {
          entityId: entityId,
          displayName: displayName,
          observations: []
        };
      }
      byEntity[entityId].observations.push({
        sourceIndex: sourceIndex,
        value: present ? taxCode[cfg.FIELD] : '__ABSENT__'
      });

      if (present) {
        if (!populatedEntities[entityId]) {
          populatedEntities[entityId] = {
            entityId: entityId,
            displayName: displayName,
            observations: []
          };
        }
        populatedEntities[entityId].observations.push({
          sourceIndex: sourceIndex,
          value: taxCode[cfg.FIELD]
        });
      }

      if (present && hasPhysicalHiddenColumn) {
        flattenedRowsCompared += 1;
        const rawValue = qboTaxCodeHiddenNormalizeScalar_(taxCode[cfg.FIELD]);
        const flattenedValue = qboTaxCodeHiddenNormalizeScalar_(
          row[data.index[cfg.FLATTENED_COLUMN]]
        );
        if (rawValue === flattenedValue) {
          flattenedExactMatches += 1;
        } else {
          flattenedMismatches += 1;
          if (flattenedMismatchExamples.length < 25) {
            flattenedMismatchExamples.push({
              sourceIndex: sourceIndex,
              entityId: entityId,
              displayName: displayName,
              rawHidden: taxCode[cfg.FIELD],
              flattenedHidden: row[data.index[cfg.FLATTENED_COLUMN]]
            });
          }
        }
      }

      if (present) {
        inferenceFieldSets.forEach(function(fields) {
          const testName = fields.join('+');
          const signatureParts = fields.map(function(field) {
            const value = Object.prototype.hasOwnProperty.call(taxCode, field)
              ? qboTaxCodeHiddenStableString_(taxCode[field])
              : '__ABSENT__';
            return field + '=' + value;
          });
          const signature = signatureParts.join('|');
          if (!inferenceTests[testName][signature]) {
            inferenceTests[testName][signature] = Object.create(null);
          }
          inferenceTests[testName][signature][encoded] = true;
        });
      }
    });

    sourceSummaries.push({
      sourceIndex: sourceIndex,
      sourceId: source.sourceId || '',
      masterBackupFileName: source.masterBackupFileName || '',
      rows: data.rows.length,
      completeRawRows: sourceComplete,
      truncatedRawRows: sourceTruncated,
      invalidRawRows: sourceInvalid,
      hiddenPresentRows: sourcePresent,
      hiddenAbsentRows: sourceAbsent,
      hasPhysicalHiddenColumn: hasPhysicalHiddenColumn
    });
  });

  const crossSourceChanges = [];
  Object.keys(byEntity).sort().forEach(function(entityId) {
    const entity = byEntity[entityId];
    let previousEncoded = null;
    let previousSourceIndex = null;
    entity.observations.forEach(function(obs) {
      const encoded = qboTaxCodeHiddenStableString_(obs.value);
      if (previousEncoded !== null && encoded !== previousEncoded) {
        crossSourceChanges.push({
          entityId: entity.entityId,
          displayName: entity.displayName,
          fromSourceIndex: previousSourceIndex,
          toSourceIndex: obs.sourceIndex,
          before: previousEncoded,
          after: encoded
        });
      }
      previousEncoded = encoded;
      previousSourceIndex = obs.sourceIndex;
    });
  });

  const inferenceEvidence = {};
  Object.keys(inferenceTests).forEach(function(testName) {
    const signatures = inferenceTests[testName];
    const signatureNames = Object.keys(signatures);
    const ambiguous = [];
    signatureNames.forEach(function(signature) {
      const hiddenValues = Object.keys(signatures[signature]);
      if (hiddenValues.length > 1) {
        ambiguous.push({
          signature: signature,
          hiddenValues: hiddenValues
        });
      }
    });
    inferenceEvidence[testName] = {
      distinctPreservedSignatures: signatureNames.length,
      ambiguousSignatureCount: ambiguous.length,
      deterministicallyPredictsHiddenInObservedHistory: ambiguous.length === 0,
      ambiguousExamples: ambiguous.slice(0, 25)
    };
  });

  const result = {
    version: '1.5.23',
    canonicalizationVersion: QBO_STATE_CAPTURE.CANONICALIZATION_VERSION,
    mode: 'TAX_CODE_HIDDEN_FIELD_DIAGNOSTIC',
    architectureRule:
      'Canonical state derives from the governed flattened export contract plus governed child datasets; RawJSON is controlled validation evidence.',
    exportKey: exportKey,
    sourcesFound: sources.length,
    population: {
      sourceRows: sourceRows,
      completeRawRows: completeRawRows,
      truncatedRawRows: truncatedRawRows,
      invalidRawRows: invalidRawRows,
      distinctEntities: Object.keys(byEntity).length
    },
    hidden: {
      presentRows: presentRows,
      absentRows: absentRows,
      distinctValues: qboTaxCodeHiddenCountMapToArray_(distinctValues),
      populatedEntities: Object.keys(populatedEntities).sort().map(function(id) {
        return populatedEntities[id];
      }),
      crossSourceChanges: crossSourceChanges
    },
    flattenedContractTest: {
      expectedColumn: cfg.FLATTENED_COLUMN,
      physicalColumnPresentInSources: physicalHiddenColumnPresentInSources,
      rowsCompared: flattenedRowsCompared,
      exactMatches: flattenedExactMatches,
      mismatches: flattenedMismatches,
      mismatchExamples: flattenedMismatchExamples
    },
    preservedFieldInferenceEvidence: inferenceEvidence,
    inferenceCaution:
      'Observed historical predictability does not by itself justify excluding a genuine QBO business-state field from the governed contract.',
    sources: sourceSummaries,
    canonicalWritesPerformed: false,
    migrationCursorChanged: false,
    historicalContractAuditCursorChanged: false
  };

  console.log(JSON.stringify(result, null, 2));
  console.log(
    '[TAX CODE HIDDEN DIAGNOSTIC] | COMPLETE' +
    ' | sources=' + sources.length +
    ' | completeRaw=' + completeRawRows +
    ' | truncatedRaw=' + truncatedRawRows +
    ' | invalidRaw=' + invalidRawRows +
    ' | HiddenChanges=' + crossSourceChanges.length +
    ' | physicalHiddenColumns=' + physicalHiddenColumnPresentInSources
  );

  return result;
}

function qboTaxCodeHiddenReadSheet_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (!values.length) return { headers: [], index: {}, rows: [] };

  const headers = values[0].map(function(v) { return String(v || '').trim(); });
  const index = {};
  headers.forEach(function(header, i) {
    if (header) index[header] = i;
  });

  return {
    headers: headers,
    index: index,
    rows: values.slice(1).filter(function(row) {
      return row.some(function(v) { return v !== '' && v !== null; });
    })
  };
}

function qboTaxCodeHiddenStableString_(value) {
  if (value === '__ABSENT__') return '__ABSENT__';
  if (value === undefined) return '__UNDEFINED__';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch (e) {
    return String(value);
  }
}

function qboTaxCodeHiddenNormalizeScalar_(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  const text = String(value).trim();
  if (/^(true|false)$/i.test(text)) return text.toLowerCase();
  return text;
}

function qboTaxCodeHiddenCountMapToArray_(map) {
  return Object.keys(map).sort().map(function(value) {
    return { value: value, count: map[value] };
  });
}
