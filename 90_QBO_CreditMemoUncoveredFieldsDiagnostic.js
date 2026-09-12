/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 90_QBO_CreditMemoUncoveredFieldsDiagnostic.js
 * Version     : 1.5.32
 * Purpose     : Read-only diagnostic for Credit Memo top-level canonical fields
 *               observed in RawJSON but not externalized by the historical
 *               governed flattened Credit Memo contract.
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
 *   auditQboCreditMemoUncoveredFields()
 * ============================================================================
 */

const QBO_CREDIT_MEMO_UNCOVERED_FIELDS_DIAGNOSTIC_ = Object.freeze({
  EXPORT_KEY: 'CREDIT_MEMOS',
  PARENT_SHEET: 'QBO_CreditMemos',
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

function auditQboCreditMemoUncoveredFields() {
  const cfg = QBO_CREDIT_MEMO_UNCOVERED_FIELDS_DIAGNOSTIC_;
  const exportKey = cfg.EXPORT_KEY;
  const stateSs = getQboStateCaptureSpreadsheet_();
  const sourceSheet = stateSs.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);
  const sources = loadQboStateCaptureWriteSources_(sourceSheet, exportKey)
    .filter(function(source) {
      return source.sourceStatus === QBO_STATE_CAPTURE.SOURCE_STATUS_AVAILABLE;
    });

  const fieldStats = {};
  cfg.FIELDS.forEach(function(field) {
    fieldStats[field] = {
      presentRows: 0,
      absentRows: 0,
      valueTypes: Object.create(null),
      distinctValues: Object.create(null),
      byEntity: Object.create(null),
      physicalSameNameColumnSources: 0,
      rowsComparedToSameNameColumn: 0,
      exactSameNameMatches: 0,
      sameNameMismatches: 0,
      sameNameMismatchExamples: []
    };
  });

  const balanceVsRemainingCredit = {
    sourcesWithRemainingCreditColumn: 0,
    rowsCompared: 0,
    exactMatches: 0,
    mismatches: 0,
    mismatchExamples: []
  };

  let sourceRows = 0;
  let completeRawRows = 0;
  let truncatedRawRows = 0;
  let invalidRawRows = 0;
  const allEntityIds = Object.create(null);
  const sourceSummaries = [];

  sources.forEach(function(source, sourceIndex) {
    validateQboStateCaptureWriteSource_(source, getQboExportManifestEntry_(exportKey));
    const sourceSs = SpreadsheetApp.openById(source.masterBackupFileId);
    const sheet = sourceSs.getSheetByName(cfg.PARENT_SHEET);
    if (!sheet) {
      throw new Error(
        'CREDIT_MEMO_UNCOVERED_FIELDS_DIAGNOSTIC_PARENT_SHEET_MISSING sourceIndex=' + sourceIndex +
        ' file=' + source.masterBackupFileName
      );
    }

    const data = qboCreditMemoUncoveredReadSheet_(sheet);
    if (data.index.RawJSON === undefined) {
      throw new Error(
        'CREDIT_MEMO_UNCOVERED_FIELDS_DIAGNOSTIC_RAWJSON_COLUMN_MISSING sourceIndex=' + sourceIndex +
        ' file=' + source.masterBackupFileName
      );
    }

    const sameNameColumns = {};
    cfg.FIELDS.forEach(function(field) {
      sameNameColumns[field] = data.index[field] !== undefined;
      if (sameNameColumns[field]) fieldStats[field].physicalSameNameColumnSources += 1;
    });

    const hasRemainingCreditColumn = data.index.RemainingCredit !== undefined;
    if (hasRemainingCreditColumn) {
      balanceVsRemainingCredit.sourcesWithRemainingCreditColumn += 1;
    }

    let sourceComplete = 0;
    let sourceTruncated = 0;
    let sourceInvalid = 0;

    data.rows.forEach(function(row) {
      sourceRows += 1;
      const raw = String(row[data.index.RawJSON] || '');
      if (raw.indexOf(QBO_STATE_CAPTURE_RAW_TRUNCATION_MARKER_) !== -1) {
        truncatedRawRows += 1;
        sourceTruncated += 1;
        return;
      }

      let creditMemo;
      try {
        creditMemo = JSON.parse(raw);
      } catch (e) {
        invalidRawRows += 1;
        sourceInvalid += 1;
        return;
      }

      completeRawRows += 1;
      sourceComplete += 1;
      const entityId = String(creditMemo.Id || '');
      const docNumber = creditMemo.DocNumber === undefined || creditMemo.DocNumber === null
        ? '' : String(creditMemo.DocNumber);
      allEntityIds[entityId] = true;

      cfg.FIELDS.forEach(function(field) {
        const stats = fieldStats[field];
        const present = Object.prototype.hasOwnProperty.call(creditMemo, field);
        const value = present ? creditMemo[field] : '__ABSENT__';
        const encoded = qboCreditMemoUncoveredStableString_(value);
        const valueType = present ? qboCreditMemoUncoveredType_(value) : 'absent';

        if (present) stats.presentRows += 1;
        else stats.absentRows += 1;
        stats.valueTypes[valueType] = (stats.valueTypes[valueType] || 0) + 1;
        stats.distinctValues[encoded] = (stats.distinctValues[encoded] || 0) + 1;

        if (!stats.byEntity[entityId]) {
          stats.byEntity[entityId] = {
            entityId: entityId,
            docNumber: docNumber,
            observations: []
          };
        }
        stats.byEntity[entityId].observations.push({
          sourceIndex: sourceIndex,
          value: value
        });

        if (present && sameNameColumns[field]) {
          stats.rowsComparedToSameNameColumn += 1;
          const rawValue = qboCreditMemoUncoveredNormalize_(value);
          const flattenedValue = qboCreditMemoUncoveredNormalize_(row[data.index[field]]);
          if (rawValue === flattenedValue) {
            stats.exactSameNameMatches += 1;
          } else {
            stats.sameNameMismatches += 1;
            if (stats.sameNameMismatchExamples.length < 20) {
              stats.sameNameMismatchExamples.push({
                sourceIndex: sourceIndex,
                entityId: entityId,
                docNumber: docNumber,
                rawValue: value,
                flattenedValue: row[data.index[field]]
              });
            }
          }
        }
      });

      if (Object.prototype.hasOwnProperty.call(creditMemo, 'Balance') && hasRemainingCreditColumn) {
        balanceVsRemainingCredit.rowsCompared += 1;
        const rawBalance = qboCreditMemoUncoveredNormalize_(creditMemo.Balance);
        const flattenedRemainingCredit = qboCreditMemoUncoveredNormalize_(row[data.index.RemainingCredit]);
        if (rawBalance === flattenedRemainingCredit) {
          balanceVsRemainingCredit.exactMatches += 1;
        } else {
          balanceVsRemainingCredit.mismatches += 1;
          if (balanceVsRemainingCredit.mismatchExamples.length < 20) {
            balanceVsRemainingCredit.mismatchExamples.push({
              sourceIndex: sourceIndex,
              entityId: entityId,
              docNumber: docNumber,
              rawBalance: creditMemo.Balance,
              flattenedRemainingCredit: row[data.index.RemainingCredit]
            });
          }
        }
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
      sameNameColumnsPresent: cfg.FIELDS.filter(function(field) {
        return sameNameColumns[field];
      }),
      hasRemainingCreditColumn: hasRemainingCreditColumn
    });
  });

  const fields = {};
  cfg.FIELDS.forEach(function(field) {
    const stats = fieldStats[field];
    const changes = [];
    Object.keys(stats.byEntity).sort().forEach(function(entityId) {
      const entity = stats.byEntity[entityId];
      let previousEncoded = null;
      let previousSourceIndex = null;
      entity.observations.forEach(function(obs) {
        const encoded = qboCreditMemoUncoveredStableString_(obs.value);
        if (previousEncoded !== null && encoded !== previousEncoded) {
          if (changes.length < 100) {
            changes.push({
              entityId: entity.entityId,
              docNumber: entity.docNumber,
              fromSourceIndex: previousSourceIndex,
              toSourceIndex: obs.sourceIndex,
              before: previousEncoded,
              after: encoded
            });
          }
        }
        previousEncoded = encoded;
        previousSourceIndex = obs.sourceIndex;
      });
    });

    fields[field] = {
      presentRows: stats.presentRows,
      absentRows: stats.absentRows,
      valueTypes: qboCreditMemoUncoveredCountMapToArray_(stats.valueTypes),
      distinctValueCount: Object.keys(stats.distinctValues).length,
      distinctValues: qboCreditMemoUncoveredCountMapToArray_(stats.distinctValues, 25),
      crossSourceChangeCount: qboCreditMemoUncoveredCountChanges_(stats.byEntity),
      crossSourceChangeExamples: changes,
      physicalSameNameColumnSources: stats.physicalSameNameColumnSources,
      rowsComparedToSameNameColumn: stats.rowsComparedToSameNameColumn,
      exactSameNameMatches: stats.exactSameNameMatches,
      sameNameMismatches: stats.sameNameMismatches,
      sameNameMismatchExamples: stats.sameNameMismatchExamples
    };
  });

  const currentHeaderPresence = {};
  cfg.FIELDS.forEach(function(field) {
    currentHeaderPresence[field] = CREDIT_MEMO_HEADERS.indexOf(field) !== -1;
  });

  const result = {
    version: '1.5.32',
    canonicalizationVersion: QBO_STATE_CAPTURE.CANONICALIZATION_VERSION,
    mode: 'CREDIT_MEMO_UNCOVERED_FIELDS_DIAGNOSTIC',
    architectureRule:
      'Canonical state derives from the governed flattened export contract plus governed child datasets; RawJSON is controlled validation evidence.',
    exportKey: exportKey,
    sourcesFound: sources.length,
    population: {
      sourceRows: sourceRows,
      completeRawRows: completeRawRows,
      truncatedRawRows: truncatedRawRows,
      invalidRawRows: invalidRawRows,
      distinctEntities: Object.keys(allEntityIds).length
    },
    currentExporterSameNameHeaderPresence: currentHeaderPresence,
    fields: fields,
    semanticCandidateComparison: {
      Balance_vs_flattened_RemainingCredit: balanceVsRemainingCredit
    },
    governanceCaution:
      'Do not exclude a field merely because it is constant historically or because another flattened field currently has the same value. Classify by QBO semantics and governed business-state meaning.',
    sources: sourceSummaries,
    canonicalWritesPerformed: false,
    migrationCursorChanged: false,
    historicalContractAuditCursorChanged: false
  };

  qboCreditMemoUncoveredLogPerField_(result);
  console.log(JSON.stringify({
    version: result.version,
    mode: 'CREDIT_MEMO_UNCOVERED_FIELDS_DIAGNOSTIC_BALANCE_COMPARISON',
    semanticCandidateComparison: result.semanticCandidateComparison,
    canonicalWritesPerformed: false,
    migrationCursorChanged: false,
    historicalContractAuditCursorChanged: false
  }));
  console.log(
    '[CREDIT MEMO UNCOVERED FIELDS DIAGNOSTIC] | COMPLETE' +
    ' | sources=' + sources.length +
    ' | completeRaw=' + completeRawRows +
    ' | truncatedRaw=' + truncatedRawRows +
    ' | invalidRaw=' + invalidRawRows
  );
  return result;
}

function qboCreditMemoUncoveredLogPerField_(result) {
  console.log(JSON.stringify({
    version: result.version,
    canonicalizationVersion: result.canonicalizationVersion,
    mode: 'CREDIT_MEMO_UNCOVERED_FIELDS_DIAGNOSTIC_PER_FIELD_LOG',
    exportKey: result.exportKey,
    sourcesFound: result.sourcesFound,
    population: result.population,
    currentExporterSameNameHeaderPresence: result.currentExporterSameNameHeaderPresence,
    canonicalWritesPerformed: result.canonicalWritesPerformed,
    migrationCursorChanged: result.migrationCursorChanged,
    historicalContractAuditCursorChanged: result.historicalContractAuditCursorChanged
  }));

  Object.keys(result.fields || {}).forEach(function(field) {
    const stats = result.fields[field] || {};
    console.log(JSON.stringify({
      field: field,
      presentRows: stats.presentRows || 0,
      absentRows: stats.absentRows || 0,
      valueTypes: stats.valueTypes || [],
      distinctValueCount: stats.distinctValueCount || 0,
      topDistinctValues: (stats.distinctValues || []).slice(0, 4).map(function(entry) {
        return {
          value: qboCreditMemoUncoveredLogSafeValue_(entry.value, 500),
          count: entry.count
        };
      }),
      crossSourceChangeCount: stats.crossSourceChangeCount || 0,
      crossSourceChangeExamples: (stats.crossSourceChangeExamples || []).slice(0, 2).map(function(change) {
        return {
          entityId: change.entityId,
          docNumber: change.docNumber,
          fromSourceIndex: change.fromSourceIndex,
          toSourceIndex: change.toSourceIndex,
          before: qboCreditMemoUncoveredLogSafeValue_(change.before, 500),
          after: qboCreditMemoUncoveredLogSafeValue_(change.after, 500)
        };
      }),
      physicalSameNameColumnSources: stats.physicalSameNameColumnSources || 0
    }));
  });
}

function qboCreditMemoUncoveredLogSafeValue_(value, maxLength) {
  const text = String(value === undefined || value === null ? '' : value);
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...[TRUNCATED_FOR_LOG length=' + text.length + ']';
}

function qboCreditMemoUncoveredReadSheet_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (!values.length) return { headers: [], index: {}, rows: [] };
  const headers = values[0].map(function(v) { return String(v || '').trim(); });
  const index = {};
  headers.forEach(function(header, i) { if (header) index[header] = i; });
  return {
    headers: headers,
    index: index,
    rows: values.slice(1).filter(function(row) {
      return row.some(function(v) { return v !== '' && v !== null; });
    })
  };
}

function qboCreditMemoUncoveredStableString_(value) {
  if (value === '__ABSENT__') return '__ABSENT__';
  if (value === undefined) return '__UNDEFINED__';
  if (value === null) return 'null';
  if (typeof value === 'object') {
    return JSON.stringify(qboCreditMemoUncoveredSortObject_(value));
  }
  return JSON.stringify(value);
}

function qboCreditMemoUncoveredSortObject_(value) {
  if (Array.isArray(value)) {
    return value.map(qboCreditMemoUncoveredSortObject_);
  }
  if (!value || typeof value !== 'object') return value;
  const out = {};
  Object.keys(value).sort().forEach(function(key) {
    out[key] = qboCreditMemoUncoveredSortObject_(value[key]);
  });
  return out;
}

function qboCreditMemoUncoveredType_(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function qboCreditMemoUncoveredNormalize_(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'object') return qboCreditMemoUncoveredStableString_(value);
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function qboCreditMemoUncoveredCountMapToArray_(map, limit) {
  const rows = Object.keys(map).map(function(key) {
    return { value: key, count: map[key] };
  }).sort(function(a, b) {
    if (b.count !== a.count) return b.count - a.count;
    return a.value < b.value ? -1 : (a.value > b.value ? 1 : 0);
  });
  return limit ? rows.slice(0, limit) : rows;
}

function qboCreditMemoUncoveredCountChanges_(byEntity) {
  let count = 0;
  Object.keys(byEntity).forEach(function(entityId) {
    let previousEncoded = null;
    byEntity[entityId].observations.forEach(function(obs) {
      const encoded = qboCreditMemoUncoveredStableString_(obs.value);
      if (previousEncoded !== null && encoded !== previousEncoded) count += 1;
      previousEncoded = encoded;
    });
  });
  return count;
}
