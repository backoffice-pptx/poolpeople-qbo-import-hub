/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 85_QBO_VendorRateFieldsDiagnostic.js
 * Version     : 1.5.25
 * Purpose     : Read-only diagnostic for Vendor BillRate and CostRate fields
 *               observed in RawJSON but not externalized by the historical
 *               governed flattened Vendor contract.
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
 *   auditQboVendorRateFields()
 * ============================================================================
 */

const QBO_VENDOR_RATE_FIELDS_DIAGNOSTIC_ = Object.freeze({
  EXPORT_KEY: 'VENDORS',
  PARENT_SHEET: 'QBO_Vendors',
  FIELDS: Object.freeze([
    Object.freeze({ field: 'BillRate', candidateColumns: Object.freeze(['BillRate']) }),
    Object.freeze({ field: 'CostRate', candidateColumns: Object.freeze(['CostRate']) })
  ])
});

function auditQboVendorRateFields() {
  const cfg = QBO_VENDOR_RATE_FIELDS_DIAGNOSTIC_;
  const exportKey = cfg.EXPORT_KEY;
  const stateSs = getQboStateCaptureSpreadsheet_();
  const sourceSheet = stateSs.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);
  const sources = loadQboStateCaptureWriteSources_(sourceSheet, exportKey)
    .filter(function(source) {
      return source.sourceStatus === QBO_STATE_CAPTURE.SOURCE_STATUS_AVAILABLE;
    });

  const fieldStats = {};
  cfg.FIELDS.forEach(function(def) {
    fieldStats[def.field] = {
      presentRows: 0,
      absentRows: 0,
      distinctValues: Object.create(null),
      byEntity: Object.create(null),
      physicalCandidateColumns: Object.create(null),
      rowsCompared: 0,
      exactMatches: 0,
      mismatches: 0,
      mismatchExamples: []
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
        'VENDOR_RATE_DIAGNOSTIC_PARENT_SHEET_MISSING sourceIndex=' + sourceIndex +
        ' file=' + source.masterBackupFileName
      );
    }

    const data = qboVendorRateReadSheet_(sheet);
    if (data.index.RawJSON === undefined) {
      throw new Error(
        'VENDOR_RATE_DIAGNOSTIC_RAWJSON_COLUMN_MISSING sourceIndex=' + sourceIndex +
        ' file=' + source.masterBackupFileName
      );
    }

    const sourceFieldColumns = {};
    cfg.FIELDS.forEach(function(def) {
      const presentCandidates = def.candidateColumns.filter(function(column) {
        return data.index[column] !== undefined;
      });
      sourceFieldColumns[def.field] = presentCandidates;
      presentCandidates.forEach(function(column) {
        fieldStats[def.field].physicalCandidateColumns[column] =
          (fieldStats[def.field].physicalCandidateColumns[column] || 0) + 1;
      });
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

      let vendor;
      try {
        vendor = JSON.parse(raw);
      } catch (e) {
        invalidRawRows += 1;
        sourceInvalid += 1;
        return;
      }

      completeRawRows += 1;
      sourceComplete += 1;
      const entityId = String(vendor.Id || '');
      const displayName = vendor.DisplayName === undefined || vendor.DisplayName === null
        ? '' : String(vendor.DisplayName);
      allEntityIds[entityId] = true;

      cfg.FIELDS.forEach(function(def) {
        const stats = fieldStats[def.field];
        const present = Object.prototype.hasOwnProperty.call(vendor, def.field);
        const value = present ? vendor[def.field] : '__ABSENT__';
        const encoded = qboVendorRateStableString_(value);

        if (present) stats.presentRows += 1;
        else stats.absentRows += 1;
        stats.distinctValues[encoded] = (stats.distinctValues[encoded] || 0) + 1;

        if (!stats.byEntity[entityId]) {
          stats.byEntity[entityId] = {
            entityId: entityId,
            displayName: displayName,
            observations: []
          };
        }
        stats.byEntity[entityId].observations.push({
          sourceIndex: sourceIndex,
          value: value
        });

        const candidateColumns = sourceFieldColumns[def.field];
        if (present && candidateColumns.length) {
          candidateColumns.forEach(function(column) {
            stats.rowsCompared += 1;
            const rawValue = qboVendorRateNormalizeScalar_(vendor[def.field]);
            const flattenedValue = qboVendorRateNormalizeScalar_(row[data.index[column]]);
            if (rawValue === flattenedValue) {
              stats.exactMatches += 1;
            } else {
              stats.mismatches += 1;
              if (stats.mismatchExamples.length < 25) {
                stats.mismatchExamples.push({
                  sourceIndex: sourceIndex,
                  entityId: entityId,
                  displayName: displayName,
                  field: def.field,
                  candidateColumn: column,
                  rawValue: vendor[def.field],
                  flattenedValue: row[data.index[column]]
                });
              }
            }
          });
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
      candidateColumns: sourceFieldColumns
    });
  });

  const fields = {};
  cfg.FIELDS.forEach(function(def) {
    const stats = fieldStats[def.field];
    const changes = [];
    Object.keys(stats.byEntity).sort().forEach(function(entityId) {
      const entity = stats.byEntity[entityId];
      let previousEncoded = null;
      let previousSourceIndex = null;
      entity.observations.forEach(function(obs) {
        const encoded = qboVendorRateStableString_(obs.value);
        if (previousEncoded !== null && encoded !== previousEncoded) {
          changes.push({
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

    fields[def.field] = {
      presentRows: stats.presentRows,
      absentRows: stats.absentRows,
      distinctValues: qboVendorRateCountMapToArray_(stats.distinctValues),
      crossSourceChanges: changes,
      flattenedContractTest: {
        candidateColumns: def.candidateColumns,
        physicalCandidateColumns: qboVendorRateCountMapToArray_(stats.physicalCandidateColumns),
        rowsCompared: stats.rowsCompared,
        exactMatches: stats.exactMatches,
        mismatches: stats.mismatches,
        mismatchExamples: stats.mismatchExamples
      }
    };
  });

  const result = {
    version: '1.5.25',
    canonicalizationVersion: QBO_STATE_CAPTURE.CANONICALIZATION_VERSION,
    mode: 'VENDOR_RATE_FIELDS_DIAGNOSTIC',
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
    exporterInspection: {
      currentVendorHeadersContainBillRate: VENDOR_HEADERS.indexOf('BillRate') !== -1,
      currentVendorHeadersContainCostRate: VENDOR_HEADERS.indexOf('CostRate') !== -1,
      note: 'Current 38_QBO_Vendors.js has no BillRate or CostRate flattened columns as of this diagnostic package.'
    },
    fields: fields,
    governanceCaution:
      'Historical constancy is not sufficient reason to exclude a genuine QBO business-state field. Governance should follow field semantics and contract purpose.',
    sources: sourceSummaries,
    canonicalWritesPerformed: false,
    migrationCursorChanged: false,
    historicalContractAuditCursorChanged: false
  };

  console.log(JSON.stringify(result, null, 2));
  console.log(
    '[VENDOR RATE FIELDS DIAGNOSTIC] | COMPLETE' +
    ' | sources=' + sources.length +
    ' | completeRaw=' + completeRawRows +
    ' | truncatedRaw=' + truncatedRawRows +
    ' | invalidRaw=' + invalidRawRows +
    ' | BillRateChanges=' + fields.BillRate.crossSourceChanges.length +
    ' | CostRateChanges=' + fields.CostRate.crossSourceChanges.length
  );
  return result;
}

function qboVendorRateReadSheet_(sheet) {
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

function qboVendorRateStableString_(value) {
  if (value === '__ABSENT__') return '__ABSENT__';
  if (value === undefined) return '__UNDEFINED__';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  try { return JSON.stringify(value); } catch (e) { return String(value); }
}

function qboVendorRateNormalizeScalar_(value) {
  if (value === undefined || value === null || value === '') return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  return String(value).trim();
}

function qboVendorRateCountMapToArray_(map) {
  return Object.keys(map).sort().map(function(value) {
    return { value: value, count: map[value] };
  });
}
