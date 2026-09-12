/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 81_QBO_TermUncoveredCanonicalFieldsDiagnostic.js
 * Version     : 1.5.21
 * Purpose     : Read-only diagnostic for Term top-level canonical fields
 *               observed in RawJSON but not proven by the historical flattened
 *               Term contract coverage screen.
 *
 * Fields under review:
 *   - DayOfMonthDue
 *   - DiscountDayOfMonth
 *   - DiscountDays
 *   - DiscountPercent
 *   - DueDays
 *   - DueNextMonthDays
 *   - Type
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
 *   auditQboTermUncoveredCanonicalFields()
 * ============================================================================
 */

const QBO_TERM_UNCOVERED_FIELDS_DIAGNOSTIC_ = Object.freeze({
  EXPORT_KEY: 'TERMS',
  PARENT_SHEET: 'QBO_Terms',
  FIELDS: Object.freeze([
    'DayOfMonthDue',
    'DiscountDayOfMonth',
    'DiscountDays',
    'DiscountPercent',
    'DueDays',
    'DueNextMonthDays',
    'Type'
  ]),
  FLATTENED_COLUMNS: Object.freeze({
    DayOfMonthDue: 'DayOfMonthDue',
    DiscountDayOfMonth: null,
    DiscountDays: 'DiscountDays',
    DiscountPercent: 'DiscountPercent',
    DueDays: 'DueDays',
    DueNextMonthDays: 'DueNextMonthDays',
    Type: 'Type'
  })
});

/**
 * Scans every AVAILABLE historical Term source and compares the seven fields
 * from the v1.5.20 source-0 coverage finding against the physical flattened
 * Term output and the legacy exporter's nested-object interpretation.
 *
 * @return {Object} Diagnostic result.
 */
function auditQboTermUncoveredCanonicalFields() {
  const cfg = QBO_TERM_UNCOVERED_FIELDS_DIAGNOSTIC_;
  const exportKey = cfg.EXPORT_KEY;

  const stateSs = getQboStateCaptureSpreadsheet_();
  const sourceSheet = stateSs.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);
  const sources = loadQboStateCaptureWriteSources_(sourceSheet, exportKey)
    .filter(function(source) {
      return source.sourceStatus === QBO_STATE_CAPTURE.SOURCE_STATUS_AVAILABLE;
    });

  const fieldStats = Object.create(null);
  cfg.FIELDS.forEach(function(field) {
    fieldStats[field] = {
      presentRows: 0,
      absentRows: 0,
      distinctValues: Object.create(null),
      populatedEntities: Object.create(null),
      crossSourceChanges: [],
      flattenedRowsCompared: 0,
      flattenedExactMatches: 0,
      flattenedMismatches: 0,
      flattenedMismatchExamples: [],
      physicalColumnPresentInSources: 0
    };
  });

  const byEntity = Object.create(null);
  const sourceSummaries = [];

  let sourceRows = 0;
  let completeRawRows = 0;
  let truncatedRawRows = 0;
  let invalidRawRows = 0;

  const legacyPathEvidence = {
    rowsWithStandardTermObject: 0,
    rowsWithDateDrivenTermObject: 0,
    rowsWithNeitherNestedObject: 0,
    rowsWhereLegacyDerivedTypeCompared: 0,
    rowsWhereLegacyDerivedTypeMatchesRawType: 0,
    rowsWhereLegacyDerivedTypeMismatchesRawType: 0,
    legacyDerivedTypeMismatchExamples: []
  };

  sources.forEach(function(source, sourceIndex) {
    validateQboStateCaptureWriteSource_(
      source,
      getQboExportManifestEntry_(exportKey)
    );

    const sourceSs = SpreadsheetApp.openById(source.masterBackupFileId);
    const sheet = sourceSs.getSheetByName(cfg.PARENT_SHEET);
    if (!sheet) {
      throw new Error(
        'TERM_UNCOVERED_FIELDS_PARENT_SHEET_MISSING sourceIndex=' +
        sourceIndex + ' file=' + source.masterBackupFileName
      );
    }

    const data = qboTermUncoveredFieldsReadSheet_(sheet);
    if (data.index.RawJSON === undefined) {
      throw new Error(
        'TERM_UNCOVERED_FIELDS_RAWJSON_COLUMN_MISSING sourceIndex=' +
        sourceIndex + ' file=' + source.masterBackupFileName
      );
    }

    const physicalColumns = Object.create(null);
    cfg.FIELDS.forEach(function(field) {
      const column = cfg.FLATTENED_COLUMNS[field];
      const present = column !== null && data.index[column] !== undefined;
      physicalColumns[field] = present;
      if (present) fieldStats[field].physicalColumnPresentInSources += 1;
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

      let term;
      try {
        term = JSON.parse(raw);
      } catch (e) {
        invalidRawRows += 1;
        sourceInvalid += 1;
        return;
      }

      completeRawRows += 1;
      sourceComplete += 1;

      const entityId = String(term.Id || '');
      const displayName = term.Name === undefined || term.Name === null
        ? ''
        : String(term.Name);

      if (!byEntity[entityId]) {
        byEntity[entityId] = {
          entityId: entityId,
          displayName: displayName,
          observations: []
        };
      }

      const observation = {
        sourceIndex: sourceIndex,
        sourceId: source.sourceId || '',
        masterBackupFileName: source.masterBackupFileName || '',
        fields: Object.create(null)
      };

      cfg.FIELDS.forEach(function(field) {
        const stats = fieldStats[field];
        const present = Object.prototype.hasOwnProperty.call(term, field);
        const encoded = present
          ? qboTermUncoveredFieldsStableString_(term[field])
          : '__ABSENT__';

        observation.fields[field] = encoded;

        if (present) stats.presentRows += 1;
        else stats.absentRows += 1;

        stats.distinctValues[encoded] =
          (stats.distinctValues[encoded] || 0) + 1;

        if (present && qboTermUncoveredFieldsIsPopulated_(term[field])) {
          if (!stats.populatedEntities[entityId]) {
            stats.populatedEntities[entityId] = {
              entityId: entityId,
              displayName: displayName,
              observations: []
            };
          }
          stats.populatedEntities[entityId].observations.push({
            sourceIndex: sourceIndex,
            value: term[field]
          });
        }

        const flattenedColumn = cfg.FLATTENED_COLUMNS[field];
        if (present &&
            flattenedColumn !== null &&
            data.index[flattenedColumn] !== undefined) {
          stats.flattenedRowsCompared += 1;

          const rawValue = qboTermUncoveredFieldsNormalizeScalar_(term[field]);
          const flattenedValue = qboTermUncoveredFieldsNormalizeScalar_(
            row[data.index[flattenedColumn]]
          );

          if (rawValue === flattenedValue) {
            stats.flattenedExactMatches += 1;
          } else {
            stats.flattenedMismatches += 1;
            if (stats.flattenedMismatchExamples.length < 25) {
              stats.flattenedMismatchExamples.push({
                sourceIndex: sourceIndex,
                entityId: entityId,
                displayName: displayName,
                rawTopLevelValue: term[field],
                flattenedColumn: flattenedColumn,
                flattenedValue: row[data.index[flattenedColumn]]
              });
            }
          }
        }
      });

      byEntity[entityId].observations.push(observation);

      // Preserve explicit evidence about the legacy exporter assumption in
      // 34_QBO_Terms.js. That exporter derived Type from StandardTerm /
      // DateDrivenTerm rather than reading top-level term.Type.
      if (term.StandardTerm) legacyPathEvidence.rowsWithStandardTermObject += 1;
      if (term.DateDrivenTerm) legacyPathEvidence.rowsWithDateDrivenTermObject += 1;
      if (!term.StandardTerm && !term.DateDrivenTerm) {
        legacyPathEvidence.rowsWithNeitherNestedObject += 1;
      }

      if (Object.prototype.hasOwnProperty.call(term, 'Type')) {
        let legacyDerivedType = '';
        if (term.StandardTerm) legacyDerivedType = 'Standard';
        else if (term.DateDrivenTerm) legacyDerivedType = 'DateDriven';

        legacyPathEvidence.rowsWhereLegacyDerivedTypeCompared += 1;
        if (qboTermUncoveredFieldsNormalizeScalar_(legacyDerivedType) ===
            qboTermUncoveredFieldsNormalizeScalar_(term.Type)) {
          legacyPathEvidence.rowsWhereLegacyDerivedTypeMatchesRawType += 1;
        } else {
          legacyPathEvidence.rowsWhereLegacyDerivedTypeMismatchesRawType += 1;
          if (legacyPathEvidence.legacyDerivedTypeMismatchExamples.length < 25) {
            legacyPathEvidence.legacyDerivedTypeMismatchExamples.push({
              sourceIndex: sourceIndex,
              entityId: entityId,
              displayName: displayName,
              rawType: term.Type,
              legacyDerivedType: legacyDerivedType,
              hasStandardTerm: !!term.StandardTerm,
              hasDateDrivenTerm: !!term.DateDrivenTerm
            });
          }
        }
      }
    });

    sourceSummaries.push({
      sourceIndex: sourceIndex,
      sourceId: source.sourceId || '',
      masterBackupFileName: source.masterBackupFileName || '',
      parentRows: data.rows.length,
      completeRawRows: sourceComplete,
      truncatedRawRows: sourceTruncated,
      invalidRawRows: sourceInvalid,
      physicalColumns: physicalColumns
    });
  });

  // Cross-source change evidence by Term and field.
  Object.keys(byEntity).forEach(function(entityId) {
    const entity = byEntity[entityId];
    entity.observations.sort(function(a, b) {
      return a.sourceIndex - b.sourceIndex;
    });

    cfg.FIELDS.forEach(function(field) {
      let previous = null;
      entity.observations.forEach(function(observation) {
        const current = observation.fields[field];
        if (previous && previous.value !== current) {
          fieldStats[field].crossSourceChanges.push({
            entityId: entityId,
            displayName: entity.displayName,
            fromSourceIndex: previous.sourceIndex,
            toSourceIndex: observation.sourceIndex,
            before: previous.value,
            after: current
          });
        }
        previous = {
          sourceIndex: observation.sourceIndex,
          value: current
        };
      });
    });
  });

  const resultFields = Object.create(null);
  cfg.FIELDS.forEach(function(field) {
    const stats = fieldStats[field];
    const flattenedColumn = cfg.FLATTENED_COLUMNS[field];

    resultFields[field] = {
      presentRows: stats.presentRows,
      absentRows: stats.absentRows,
      distinctValues: qboTermUncoveredFieldsDistinctList_(
        stats.distinctValues
      ),
      populatedEntities: Object.keys(stats.populatedEntities)
        .sort()
        .map(function(entityId) {
          return stats.populatedEntities[entityId];
        }),
      crossSourceChanges: stats.crossSourceChanges,
      flattenedContractTest: {
        expectedColumn: flattenedColumn,
        physicalColumnPresentInSources:
          stats.physicalColumnPresentInSources,
        rowsCompared: stats.flattenedRowsCompared,
        exactMatches: stats.flattenedExactMatches,
        mismatches: stats.flattenedMismatches,
        mismatchExamples: stats.flattenedMismatchExamples
      }
    };
  });

  const result = {
    version: '1.5.21',
    canonicalizationVersion: 'QBO_CANONICAL_STATE_V1',
    mode: 'TERM_UNCOVERED_CANONICAL_FIELDS_DIAGNOSTIC',
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
    fields: resultFields,
    legacyExporterPathEvidence: legacyPathEvidence,
    sourceSummaries: sourceSummaries,
    validRawEvidence:
      truncatedRawRows === 0 && invalidRawRows === 0,
    canonicalWritesPerformed: false,
    migrationCursorChanged: false,
    historicalContractAuditCursorChanged: false
  };

  console.log(JSON.stringify(result, null, 2));
  console.log(
    '[TERM UNCOVERED CANONICAL FIELDS] | COMPLETE' +
    ' | sources=' + sources.length +
    ' | completeRaw=' + completeRawRows +
    ' | truncatedRaw=' + truncatedRawRows +
    ' | invalidRaw=' + invalidRawRows +
    ' | TypeChanges=' + resultFields.Type.crossSourceChanges.length +
    ' | DueDaysChanges=' + resultFields.DueDays.crossSourceChanges.length +
    ' | DiscountDaysChanges=' +
      resultFields.DiscountDays.crossSourceChanges.length +
    ' | DiscountPercentChanges=' +
      resultFields.DiscountPercent.crossSourceChanges.length +
    ' | DayOfMonthDueChanges=' +
      resultFields.DayOfMonthDue.crossSourceChanges.length +
    ' | DueNextMonthDaysChanges=' +
      resultFields.DueNextMonthDays.crossSourceChanges.length +
    ' | DiscountDayOfMonthChanges=' +
      resultFields.DiscountDayOfMonth.crossSourceChanges.length +
    ' | FlattenedMismatches=' +
      cfg.FIELDS.reduce(function(sum, field) {
        return sum + resultFields[field].flattenedContractTest.mismatches;
      }, 0)
  );

  return result;
}


function qboTermUncoveredFieldsReadSheet_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (!values.length) {
    return {
      headers: [],
      index: Object.create(null),
      rows: []
    };
  }

  const headers = values[0].map(function(value) {
    return String(value || '').trim();
  });

  const index = Object.create(null);
  headers.forEach(function(header, i) {
    if (header) index[header] = i;
  });

  return {
    headers: headers,
    index: index,
    rows: values.slice(1).filter(function(row) {
      return row.some(function(value) {
        return value !== '' && value !== null;
      });
    })
  };
}


function qboTermUncoveredFieldsStableString_(value) {
  if (value === undefined) return '__UNDEFINED__';
  if (value === null) return 'null';
  if (typeof value !== 'object') return JSON.stringify(value);
  return JSON.stringify(qboTermUncoveredFieldsSortObject_(value));
}


function qboTermUncoveredFieldsSortObject_(value) {
  if (Array.isArray(value)) {
    return value.map(qboTermUncoveredFieldsSortObject_);
  }
  if (!value || typeof value !== 'object') return value;

  const out = {};
  Object.keys(value).sort().forEach(function(key) {
    out[key] = qboTermUncoveredFieldsSortObject_(value[key]);
  });
  return out;
}


function qboTermUncoveredFieldsIsPopulated_(value) {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}


function qboTermUncoveredFieldsNormalizeScalar_(value) {
  if (value === undefined || value === null || value === '') {
    return '__BLANK__';
  }
  if (typeof value === 'number') return String(value);
  if (value === true || String(value).toLowerCase() === 'true') return 'true';
  if (value === false || String(value).toLowerCase() === 'false') return 'false';
  return String(value).trim();
}


function qboTermUncoveredFieldsDistinctList_(map) {
  return Object.keys(map)
    .sort()
    .map(function(value) {
      return {
        value: value,
        count: map[value]
      };
    });
}
