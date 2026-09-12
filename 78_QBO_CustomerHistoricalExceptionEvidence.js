/**
 * QBO Customer Historical Exception Evidence
 * Version: 1.5.17
 *
 * Read-only validation for the governed historical Customer exception:
 * legacy Customer flattened contracts omitted IsProject and ResaleNum.
 * Complete RawJSON is used here only as exception/change evidence, not as
 * the normal canonicalization input.
 *
 * Public:
 *   auditQboCustomerHistoricalExceptionEvidence()
 */
function auditQboCustomerHistoricalExceptionEvidence() {
  const exportKey = 'CUSTOMERS';
  const stateSs = getQboStateCaptureSpreadsheet_();
  const sourceSheet = stateSs.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);
  const sources = loadQboStateCaptureWriteSources_(sourceSheet, exportKey)
    .filter(function(source) {
      return source.sourceStatus === QBO_STATE_CAPTURE.SOURCE_STATUS_AVAILABLE;
    });

  const byEntity = Object.create(null);
  const sourceSummaries = [];
  let totalRows = 0;
  let completeRawRows = 0;
  let truncatedRawRows = 0;
  let invalidRawRows = 0;

  sources.forEach(function(source, sourceIndex) {
    validateQboStateCaptureWriteSource_(source, getQboExportManifestEntry_(exportKey));

    const sourceSs = SpreadsheetApp.openById(source.masterBackupFileId);
    const parentSheet = sourceSs.getSheetByName(
      QBO_HISTORICAL_CONTRACT_AUDIT_.PARENT_SHEETS[exportKey]
    );
    if (!parentSheet) {
      throw new Error(
        'CUSTOMER_HISTORICAL_EXCEPTION_PARENT_SHEET_MISSING sourceIndex=' +
        sourceIndex + ' file=' + source.masterBackupFileName
      );
    }

    const data = qboHistoricalContractAuditReadSheet_(parentSheet);
    if (data.index.RawJSON === undefined) {
      throw new Error(
        'CUSTOMER_HISTORICAL_EXCEPTION_RAWJSON_COLUMN_MISSING sourceIndex=' +
        sourceIndex + ' file=' + source.masterBackupFileName
      );
    }
    let sourceComplete = 0;
    let sourceTruncated = 0;
    let sourceInvalid = 0;
    let isProjectPresent = 0;
    let resalePresent = 0;

    data.rows.forEach(function(row) {
      totalRows++;
      const raw = String(row[data.index.RawJSON] || '');
      if (raw.indexOf(QBO_STATE_CAPTURE_RAW_TRUNCATION_MARKER_) !== -1) {
        truncatedRawRows++;
        sourceTruncated++;
        return;
      }

      let obj;
      try {
        obj = JSON.parse(raw);
      } catch (e) {
        invalidRawRows++;
        sourceInvalid++;
        return;
      }

      completeRawRows++;
      sourceComplete++;

      const id = String(obj.Id || row[data.index.Id] || '');
      if (!id) return;

      const displayName = obj.DisplayName === undefined || obj.DisplayName === null
        ? ''
        : String(obj.DisplayName);

      const isProjectPresentNow = Object.prototype.hasOwnProperty.call(obj, 'IsProject');
      const resalePresentNow = Object.prototype.hasOwnProperty.call(obj, 'ResaleNum');

      if (isProjectPresentNow) isProjectPresent++;
      if (resalePresentNow) resalePresent++;

      const isProject = isProjectPresentNow ? JSON.stringify(obj.IsProject) : '__ABSENT__';
      const resaleNum = resalePresentNow ? JSON.stringify(obj.ResaleNum) : '__ABSENT__';

      if (!byEntity[id]) {
        byEntity[id] = {
          entityId: id,
          displayName: displayName,
          observations: []
        };
      }
      byEntity[id].observations.push({
        sourceIndex: sourceIndex,
        sourceId: source.sourceId || '',
        masterBackupFileName: source.masterBackupFileName || '',
        isProject: isProject,
        resaleNum: resaleNum
      });
    });

    sourceSummaries.push({
      sourceIndex: sourceIndex,
      sourceId: source.sourceId || '',
      masterBackupFileName: source.masterBackupFileName || '',
      parentRows: data.rows.length,
      completeRawRows: sourceComplete,
      truncatedRawRows: sourceTruncated,
      invalidRawRows: sourceInvalid,
      isProjectPresentRows: isProjectPresent,
      resaleNumPresentRows: resalePresent
    });
  });

  const entityIds = Object.keys(byEntity).sort();
  const isProjectChanges = [];
  const resaleNumChanges = [];
  const resaleNumPopulatedEntities = [];
  const isProjectDistinct = Object.create(null);
  const resaleDistinct = Object.create(null);

  entityIds.forEach(function(id) {
    const e = byEntity[id];
    e.observations.sort(function(a, b) { return a.sourceIndex - b.sourceIndex; });

    let previous = null;
    e.observations.forEach(function(o) {
      isProjectDistinct[o.isProject] = (isProjectDistinct[o.isProject] || 0) + 1;
      resaleDistinct[o.resaleNum] = (resaleDistinct[o.resaleNum] || 0) + 1;

      if (previous) {
        if (previous.isProject !== o.isProject) {
          isProjectChanges.push({
            entityId: id,
            displayName: e.displayName,
            fromSourceIndex: previous.sourceIndex,
            toSourceIndex: o.sourceIndex,
            before: previous.isProject,
            after: o.isProject
          });
        }
        if (previous.resaleNum !== o.resaleNum) {
          resaleNumChanges.push({
            entityId: id,
            displayName: e.displayName,
            fromSourceIndex: previous.sourceIndex,
            toSourceIndex: o.sourceIndex,
            before: previous.resaleNum,
            after: o.resaleNum
          });
        }
      }
      previous = o;
    });

    const populated = e.observations.filter(function(o) {
      return o.resaleNum !== '__ABSENT__' && o.resaleNum !== 'null' && o.resaleNum !== '""';
    });
    if (populated.length) {
      resaleNumPopulatedEntities.push({
        entityId: id,
        displayName: e.displayName,
        valuesBySource: populated.map(function(o) {
          return {
            sourceIndex: o.sourceIndex,
            value: JSON.parse(o.resaleNum)
          };
        })
      });
    }
  });

  function distinctList_(map) {
    return Object.keys(map).sort().map(function(value) {
      return { value: value, count: map[value] };
    });
  }

  const valid =
    sources.length === 10 &&
    truncatedRawRows === 0 &&
    invalidRawRows === 0 &&
    isProjectChanges.length === 0 &&
    resaleNumChanges.length === 0;

  const result = {
    version: '1.5.18',
    canonicalizationVersion: 'QBO_CANONICAL_STATE_V1',
    mode: 'CUSTOMER_HISTORICAL_EXCEPTION_EVIDENCE',
    architectureRule: 'RawJSON is used only as controlled historical exception/change evidence for fields omitted from the legacy flattened Customer contract.',
    exportKey: exportKey,
    sourcesFound: sources.length,
    population: {
      sourceRows: totalRows,
      completeRawRows: completeRawRows,
      truncatedRawRows: truncatedRawRows,
      invalidRawRows: invalidRawRows,
      distinctEntities: entityIds.length
    },
    IsProject: {
      distinctObservedValues: distinctList_(isProjectDistinct),
      crossSourceChanges: isProjectChanges
    },
    ResaleNum: {
      distinctObservedValues: distinctList_(resaleDistinct),
      populatedEntities: resaleNumPopulatedEntities,
      crossSourceChanges: resaleNumChanges
    },
    sourceSummaries: sourceSummaries,
    governanceConclusion: valid
      ? 'PASS_EXISTING_CUSTOMER_CANONICAL_HISTORY_VALIDATED_BY_CONTROLLED_RAWJSON_EXCEPTION_EVIDENCE'
      : 'ACTION_REQUIRED_CUSTOMER_HISTORICAL_EXCEPTION_NOT_PROVEN',
    valid: valid,
    canonicalWritesPerformed: false,
    migrationCursorChanged: false,
    historicalContractAuditCursorChanged: false
  };

  console.log(JSON.stringify(result, null, 2));
  console.log(
    '[CUSTOMER HISTORICAL EXCEPTION EVIDENCE] | ' +
    (valid ? 'PASS' : 'ACTION_REQUIRED') +
    ' | sources=' + sources.length +
    ' | completeRaw=' + completeRawRows +
    ' | IsProjectChanges=' + isProjectChanges.length +
    ' | ResaleNumChanges=' + resaleNumChanges.length +
    ' | ResaleNumPopulatedEntities=' + resaleNumPopulatedEntities.length
  );

  return result;
}
