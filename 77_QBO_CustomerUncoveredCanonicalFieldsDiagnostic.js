/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 77_QBO_CustomerUncoveredCanonicalFieldsDiagnostic.js
 * Purpose     : Read-only diagnostic for Customer canonical fields observed in
 *               RawJSON but not externalized by the governed flattened export
 *               contract.
 *
 * Fields under review:
 *   - IsProject
 *   - ResaleNum
 *   - V4IDPseudonym
 *
 * Safety:
 *   - No canonical rows are written.
 *   - No migration cursor is changed.
 *   - No historical-contract audit cursor is changed.
 *   - No exporter/canonicalizer behavior is changed.
 * ============================================================================
 */

/**
 * Audits all AVAILABLE Customer State Capture sources in one read-only pass.
 *
 * Reports:
 *   - distinct value counts for IsProject and ResaleNum
 *   - Customer Id / DisplayName for populated ResaleNum values
 *   - V4IDPseudonym shape, uniqueness, duplicates, and relationship to Id/name
 *   - cross-source value changes by Customer Id for each reviewed field
 */
function auditQboCustomerUncoveredCanonicalFields() {
  const exportKey = 'CUSTOMERS';
  const stateSs = getQboStateCaptureSpreadsheet_();
  const sourceSheet = stateSs.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);
  const sources = loadQboStateCaptureWriteSources_(sourceSheet, exportKey)
    .filter(function(source) {
      return source.sourceStatus === QBO_STATE_CAPTURE.SOURCE_STATUS_AVAILABLE;
    });

  const fields = ['IsProject', 'ResaleNum', 'V4IDPseudonym'];
  const aggregate = {};
  fields.forEach(function(field) {
    aggregate[field] = {
      presentRows: 0,
      absentRows: 0,
      distinctValues: Object.create(null)
    };
  });

  const sourceSummaries = [];
  const priorByEntity = Object.create(null);
  const changes = {
    IsProject: [],
    ResaleNum: [],
    V4IDPseudonym: []
  };

  const resaleEntities = Object.create(null);

  let totalRows = 0;
  let completeRawRows = 0;
  let truncatedRawRows = 0;
  let invalidRawRows = 0;

  let v4Distinct = Object.create(null);
  let v4Rows = 0;
  let v4HexRows = 0;
  let v4EqualsIdRows = 0;
  let v4EqualsDisplayNameRows = 0;
  let v4MinLength = null;
  let v4MaxLength = null;

  sources.forEach(function(source, sourceIndex) {
    validateQboStateCaptureWriteSource_(
      source,
      getQboExportManifestEntry_(exportKey)
    );

    const sourceSs = SpreadsheetApp.openById(source.masterBackupFileId);
    const sheet = sourceSs.getSheetByName('QBO_Customers');

    if (!sheet) {
      throw new Error(
        'CUSTOMER_UNCOVERED_FIELD_DIAGNOSTIC_SHEET_MISSING source=' +
        source.sourceId
      );
    }

    const values = sheet.getDataRange().getValues();
    if (!values.length) return;

    const headers = values[0].map(function(value) {
      return String(value || '').trim();
    });
    const index = buildQboStateCaptureWriteHeaderIndex_(headers);

    if (index.RawJSON === undefined) {
      throw new Error(
        'CUSTOMER_UNCOVERED_FIELD_DIAGNOSTIC_RAWJSON_MISSING source=' +
        source.sourceId
      );
    }

    let sourceRows = 0;
    let sourceCompleteRaw = 0;
    let sourceTruncatedRaw = 0;
    let sourceInvalidRaw = 0;

    const sourceFieldCounts = {};
    fields.forEach(function(field) {
      sourceFieldCounts[field] = Object.create(null);
    });

    values.slice(1).forEach(function(row) {
      sourceRows += 1;
      totalRows += 1;

      const raw = String(row[index.RawJSON] || '');
      if (!raw) {
        sourceInvalidRaw += 1;
        invalidRawRows += 1;
        return;
      }

      if (/\[TRUNCATED:\s*original length/i.test(raw)) {
        sourceTruncatedRaw += 1;
        truncatedRawRows += 1;
        return;
      }

      let entity;
      try {
        entity = JSON.parse(raw);
      } catch (e) {
        sourceInvalidRaw += 1;
        invalidRawRows += 1;
        return;
      }

      sourceCompleteRaw += 1;
      completeRawRows += 1;

      const entityId = String(entity.Id || '');
      const displayName = String(entity.DisplayName || '');

      if (!priorByEntity[entityId]) {
        priorByEntity[entityId] = Object.create(null);
      }

      fields.forEach(function(field) {
        const has = Object.prototype.hasOwnProperty.call(entity, field);
        if (has) {
          aggregate[field].presentRows += 1;
          const normalized = qboCustomerDiagnosticValue_(entity[field]);
          aggregate[field].distinctValues[normalized] =
            (aggregate[field].distinctValues[normalized] || 0) + 1;
          sourceFieldCounts[field][normalized] =
            (sourceFieldCounts[field][normalized] || 0) + 1;

          if (
            Object.prototype.hasOwnProperty.call(priorByEntity[entityId], field) &&
            priorByEntity[entityId][field] !== normalized
          ) {
            changes[field].push({
              entityId: entityId,
              displayName: displayName,
              sourceIndex: sourceIndex,
              before: priorByEntity[entityId][field],
              after: normalized
            });
          }
          priorByEntity[entityId][field] = normalized;
        } else {
          aggregate[field].absentRows += 1;

          if (
            Object.prototype.hasOwnProperty.call(priorByEntity[entityId], field) &&
            priorByEntity[entityId][field] !== '__ABSENT__'
          ) {
            changes[field].push({
              entityId: entityId,
              displayName: displayName,
              sourceIndex: sourceIndex,
              before: priorByEntity[entityId][field],
              after: '__ABSENT__'
            });
          }
          priorByEntity[entityId][field] = '__ABSENT__';
        }
      });

      if (
        Object.prototype.hasOwnProperty.call(entity, 'ResaleNum') &&
        String(entity.ResaleNum || '') !== ''
      ) {
        const resaleKey = entityId + '|' + qboCustomerDiagnosticValue_(entity.ResaleNum);
        if (!resaleEntities[resaleKey]) {
          resaleEntities[resaleKey] = {
            entityId: entityId,
            displayName: displayName,
            resaleNum: String(entity.ResaleNum),
            firstSeenSourceIndex: sourceIndex,
            occurrences: 0
          };
        }
        resaleEntities[resaleKey].occurrences += 1;
      }

      if (Object.prototype.hasOwnProperty.call(entity, 'V4IDPseudonym')) {
        const v4 = String(entity.V4IDPseudonym === null ? '' : entity.V4IDPseudonym);
        v4Rows += 1;
        v4Distinct[v4] = (v4Distinct[v4] || 0) + 1;

        if (/^[0-9a-f]+$/i.test(v4)) v4HexRows += 1;
        if (v4 === entityId) v4EqualsIdRows += 1;
        if (v4 === displayName) v4EqualsDisplayNameRows += 1;

        const len = v4.length;
        if (v4MinLength === null || len < v4MinLength) v4MinLength = len;
        if (v4MaxLength === null || len > v4MaxLength) v4MaxLength = len;
      }
    });

    sourceSummaries.push({
      sourceIndex: sourceIndex,
      sourceId: source.sourceId,
      masterBackupFileName: source.masterBackupFileName,
      parentRows: sourceRows,
      completeRawRows: sourceCompleteRaw,
      truncatedRawRows: sourceTruncatedRaw,
      invalidRawRows: sourceInvalidRaw,
      IsProject: qboCustomerDiagnosticCounts_(sourceFieldCounts.IsProject),
      ResaleNum: qboCustomerDiagnosticCounts_(sourceFieldCounts.ResaleNum),
      V4IDPseudonymDistinctCount:
        Object.keys(sourceFieldCounts.V4IDPseudonym).length
    });
  });

  const v4DuplicateValues = Object.keys(v4Distinct)
    .filter(function(value) { return v4Distinct[value] > 1; })
    .map(function(value) {
      return {valueHash: qboStateCaptureAuditSha256_(value), count: v4Distinct[value]};
    });

  const result = {
    version: QBO_STATE_CAPTURE.VERSION,
    canonicalizationVersion: QBO_STATE_CAPTURE.CANONICALIZATION_VERSION,
    mode: 'CUSTOMER_UNCOVERED_CANONICAL_FIELDS_DIAGNOSTIC',
    exportKey: exportKey,
    sourcesFound: sources.length,
    population: {
      sourceRows: totalRows,
      completeRawRows: completeRawRows,
      truncatedRawRows: truncatedRawRows,
      invalidRawRows: invalidRawRows
    },
    IsProject: {
      presentRows: aggregate.IsProject.presentRows,
      absentRows: aggregate.IsProject.absentRows,
      distinctValues: qboCustomerDiagnosticCounts_(
        aggregate.IsProject.distinctValues
      ),
      crossSourceChanges: changes.IsProject
    },
    ResaleNum: {
      presentRows: aggregate.ResaleNum.presentRows,
      absentRows: aggregate.ResaleNum.absentRows,
      distinctValues: qboCustomerDiagnosticCounts_(
        aggregate.ResaleNum.distinctValues
      ),
      populatedEntities: Object.keys(resaleEntities)
        .sort()
        .map(function(key) { return resaleEntities[key]; }),
      crossSourceChanges: changes.ResaleNum
    },
    V4IDPseudonym: {
      presentRows: aggregate.V4IDPseudonym.presentRows,
      absentRows: aggregate.V4IDPseudonym.absentRows,
      totalRowsWithValue: v4Rows,
      distinctValuesAcrossAllRows: Object.keys(v4Distinct).length,
      duplicateDistinctValueCount: v4DuplicateValues.length,
      duplicateValuesByHash: v4DuplicateValues,
      hexOnlyRows: v4HexRows,
      equalsEntityIdRows: v4EqualsIdRows,
      equalsDisplayNameRows: v4EqualsDisplayNameRows,
      minLength: v4MinLength,
      maxLength: v4MaxLength,
      crossSourceChangeCount: changes.V4IDPseudonym.length,
      crossSourceChanges: changes.V4IDPseudonym
    },
    sources: sourceSummaries,
    writesPerformed: false,
    canonicalWritesPerformed: false,
    migrationCursorChanged: false,
    historicalContractAuditCursorChanged: false,
    actionRequired: true,
    conclusion: 'CUSTOMER_FIELD_CLASSIFICATION_REQUIRED'
  };

  console.log(JSON.stringify(result, null, 2));
  console.log(
    '[CUSTOMER UNCOVERED CANONICAL FIELDS] | COMPLETE' +
    ' | sources=' + sources.length +
    ' | completeRaw=' + completeRawRows +
    ' | IsProjectChanges=' + changes.IsProject.length +
    ' | ResaleNumPopulatedEntities=' + Object.keys(resaleEntities).length +
    ' | ResaleNumChanges=' + changes.ResaleNum.length +
    ' | V4Distinct=' + Object.keys(v4Distinct).length +
    ' | V4Changes=' + changes.V4IDPseudonym.length
  );

  return result;
}

function qboCustomerDiagnosticValue_(value) {
  if (value === undefined) return '__ABSENT__';
  return qboCanonicalStableStringify_(value);
}

function qboCustomerDiagnosticCounts_(counts) {
  return Object.keys(counts || {})
    .sort()
    .map(function(value) {
      return {
        value: value,
        count: counts[value]
      };
    });
}
