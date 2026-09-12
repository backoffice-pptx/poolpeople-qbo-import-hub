/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 87_QBO_InvoiceUncoveredFieldsDiagnostic.js
 * Version     : 1.5.29
 * Purpose     : Read-only diagnostic for Invoice top-level canonical fields
 *               observed in RawJSON but not externalized by the historical
 *               governed flattened Invoice contract.
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
 *   auditQboInvoiceUncoveredFields()
 * ============================================================================
 */

const QBO_INVOICE_UNCOVERED_FIELDS_DIAGNOSTIC_ = Object.freeze({
  EXPORT_KEY: 'INVOICES',
  PARENT_SHEET: 'QBO_Invoices',
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

function auditQboInvoiceUncoveredFields() {
  const cfg = QBO_INVOICE_UNCOVERED_FIELDS_DIAGNOSTIC_;
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
        'INVOICE_UNCOVERED_FIELDS_DIAGNOSTIC_PARENT_SHEET_MISSING sourceIndex=' + sourceIndex +
        ' file=' + source.masterBackupFileName
      );
    }

    const data = qboInvoiceUncoveredReadSheet_(sheet);
    if (data.index.RawJSON === undefined) {
      throw new Error(
        'INVOICE_UNCOVERED_FIELDS_DIAGNOSTIC_RAWJSON_COLUMN_MISSING sourceIndex=' + sourceIndex +
        ' file=' + source.masterBackupFileName
      );
    }

    const sameNameColumns = {};
    cfg.FIELDS.forEach(function(field) {
      sameNameColumns[field] = data.index[field] !== undefined;
      if (sameNameColumns[field]) fieldStats[field].physicalSameNameColumnSources += 1;
    });

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

      let invoice;
      try {
        invoice = JSON.parse(raw);
      } catch (e) {
        invalidRawRows += 1;
        sourceInvalid += 1;
        return;
      }

      completeRawRows += 1;
      sourceComplete += 1;
      const entityId = String(invoice.Id || '');
      const docNumber = invoice.DocNumber === undefined || invoice.DocNumber === null
        ? '' : String(invoice.DocNumber);
      allEntityIds[entityId] = true;

      cfg.FIELDS.forEach(function(field) {
        const stats = fieldStats[field];
        const present = Object.prototype.hasOwnProperty.call(invoice, field);
        const value = present ? invoice[field] : '__ABSENT__';
        const encoded = qboInvoiceUncoveredStableString_(value);
        const valueType = present ? qboInvoiceUncoveredType_(value) : 'absent';

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
          const rawValue = qboInvoiceUncoveredNormalize_(value);
          const flattenedValue = qboInvoiceUncoveredNormalize_(row[data.index[field]]);
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
      })
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
        const encoded = qboInvoiceUncoveredStableString_(obs.value);
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
      valueTypes: qboInvoiceUncoveredCountMapToArray_(stats.valueTypes),
      distinctValueCount: Object.keys(stats.distinctValues).length,
      distinctValues: qboInvoiceUncoveredCountMapToArray_(stats.distinctValues, 25),
      crossSourceChangeCount: qboInvoiceUncoveredCountChanges_(stats.byEntity),
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
    currentHeaderPresence[field] = INVOICE_HEADERS.indexOf(field) !== -1;
  });

  const result = {
    version: '1.5.29',
    canonicalizationVersion: QBO_STATE_CAPTURE.CANONICALIZATION_VERSION,
    mode: 'INVOICE_UNCOVERED_FIELDS_DIAGNOSTIC',
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
    governanceCaution:
      'Do not exclude a field merely because it is constant historically. Classify each field by QBO semantics and whether it belongs to governed business state.',
    sources: sourceSummaries,
    canonicalWritesPerformed: false,
    migrationCursorChanged: false,
    historicalContractAuditCursorChanged: false
  };

  qboInvoiceUncoveredLogPerField_(result);
  console.log(
    '[INVOICE UNCOVERED FIELDS DIAGNOSTIC] | COMPLETE' +
    ' | sources=' + sources.length +
    ' | completeRaw=' + completeRawRows +
    ' | truncatedRaw=' + truncatedRawRows +
    ' | invalidRaw=' + invalidRawRows
  );
  return result;
}

function qboInvoiceUncoveredLogPerField_(result) {
  console.log(JSON.stringify({
    version: result.version,
    canonicalizationVersion: result.canonicalizationVersion,
    mode: 'INVOICE_UNCOVERED_FIELDS_DIAGNOSTIC_PER_FIELD_LOG',
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
          value: qboInvoiceUncoveredLogSafeValue_(entry.value, 500),
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
          before: qboInvoiceUncoveredLogSafeValue_(change.before, 500),
          after: qboInvoiceUncoveredLogSafeValue_(change.after, 500)
        };
      }),
      physicalSameNameColumnSources: stats.physicalSameNameColumnSources || 0
    }));
  });
}

function qboInvoiceUncoveredLogSafeValue_(value, maxLength) {
  const text = String(value === undefined || value === null ? '' : value);
  if (text.length <= maxLength) return text;
  return text.slice(0, maxLength) + '...[TRUNCATED_FOR_LOG length=' + text.length + ']';
}

function qboInvoiceUncoveredCompactSummary_(result) {
  const compactFields = {};
  Object.keys(result.fields || {}).forEach(function(field) {
    const stats = result.fields[field] || {};
    compactFields[field] = {
      presentRows: stats.presentRows || 0,
      absentRows: stats.absentRows || 0,
      valueTypes: stats.valueTypes || [],
      distinctValueCount: stats.distinctValueCount || 0,
      topDistinctValues: (stats.distinctValues || []).slice(0, 6),
      crossSourceChangeCount: stats.crossSourceChangeCount || 0,
      crossSourceChangeExamples: (stats.crossSourceChangeExamples || []).slice(0, 3),
      physicalSameNameColumnSources: stats.physicalSameNameColumnSources || 0
    };
  });

  return {
    version: result.version,
    canonicalizationVersion: result.canonicalizationVersion,
    mode: 'INVOICE_UNCOVERED_FIELDS_DIAGNOSTIC_COMPACT_LOG',
    architectureRule: result.architectureRule,
    exportKey: result.exportKey,
    sourcesFound: result.sourcesFound,
    population: result.population,
    currentExporterSameNameHeaderPresence: result.currentExporterSameNameHeaderPresence,
    fields: compactFields,
    governanceCaution: result.governanceCaution,
    canonicalWritesPerformed: result.canonicalWritesPerformed,
    migrationCursorChanged: result.migrationCursorChanged,
    historicalContractAuditCursorChanged: result.historicalContractAuditCursorChanged
  };
}

function qboInvoiceUncoveredReadSheet_(sheet) {
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

function qboInvoiceUncoveredStableString_(value) {
  if (value === '__ABSENT__') return '__ABSENT__';
  if (value === undefined) return '__UNDEFINED__';
  if (value === null) return 'null';
  if (typeof value === 'object') {
    return JSON.stringify(qboInvoiceUncoveredSortObject_(value));
  }
  return JSON.stringify(value);
}

function qboInvoiceUncoveredSortObject_(value) {
  if (Array.isArray(value)) {
    return value.map(qboInvoiceUncoveredSortObject_);
  }
  if (!value || typeof value !== 'object') return value;
  const out = {};
  Object.keys(value).sort().forEach(function(key) {
    out[key] = qboInvoiceUncoveredSortObject_(value[key]);
  });
  return out;
}

function qboInvoiceUncoveredType_(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function qboInvoiceUncoveredNormalize_(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'object') return qboInvoiceUncoveredStableString_(value);
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function qboInvoiceUncoveredCountMapToArray_(map, limit) {
  const rows = Object.keys(map).map(function(key) {
    return { value: key, count: map[key] };
  }).sort(function(a, b) {
    if (b.count !== a.count) return b.count - a.count;
    return a.value < b.value ? -1 : (a.value > b.value ? 1 : 0);
  });
  return limit ? rows.slice(0, limit) : rows;
}

function qboInvoiceUncoveredCountChanges_(byEntity) {
  let count = 0;
  Object.keys(byEntity).forEach(function(entityId) {
    let previousEncoded = null;
    byEntity[entityId].observations.forEach(function(obs) {
      const encoded = qboInvoiceUncoveredStableString_(obs.value);
      if (previousEncoded !== null && encoded !== previousEncoded) count += 1;
      previousEncoded = encoded;
    });
  });
  return count;
}
