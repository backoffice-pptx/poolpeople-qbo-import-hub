/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 79_QBO_ItemUncoveredCanonicalFieldsDiagnostic.js
 * Version     : 1.5.19
 * Purpose     : Read-only diagnostic for Item top-level canonical fields
 *               observed in RawJSON but not preserved by the historical
 *               flattened Item contract.
 *
 * Fields under review:
 *   - ClassRef
 *   - Level
 *   - PrefVendorRef
 *   - PrintGroupedItems
 *   - TaxClassificationRef
 *
 * Architecture rule:
 *   RawJSON is validation/exception evidence only. This diagnostic does not
 *   make RawJSON the normal canonicalization input.
 *
 * Safety:
 *   - No canonical rows are written.
 *   - No migration cursor is changed.
 *   - No historical contract audit cursor is changed.
 *   - No exporter behavior is changed.
 *
 * Public:
 *   auditQboItemUncoveredCanonicalFields()
 * ============================================================================
 */

const QBO_ITEM_UNCOVERED_FIELDS_DIAGNOSTIC_ = Object.freeze({
  EXPORT_KEY: 'ITEMS',
  PARENT_SHEET: 'QBO_Items',
  FIELDS: Object.freeze([
    'ClassRef',
    'Level',
    'PrefVendorRef',
    'PrintGroupedItems',
    'TaxClassificationRef'
  ])
});

/**
 * Scans every available historical Item source and produces read-only evidence
 * for the five top-level canonical fields found uncovered by the source-0
 * historical contract screen.
 *
 * @return {Object} Diagnostic result.
 */
function auditQboItemUncoveredCanonicalFields() {
  const exportKey = QBO_ITEM_UNCOVERED_FIELDS_DIAGNOSTIC_.EXPORT_KEY;

  const stateSs = getQboStateCaptureSpreadsheet_();
  const sourceSheet = stateSs.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);
  const sources = loadQboStateCaptureWriteSources_(sourceSheet, exportKey)
    .filter(function(source) {
      return source.sourceStatus === QBO_STATE_CAPTURE.SOURCE_STATUS_AVAILABLE;
    });

  const fieldStats = Object.create(null);
  QBO_ITEM_UNCOVERED_FIELDS_DIAGNOSTIC_.FIELDS.forEach(function(field) {
    fieldStats[field] = {
      presentRows: 0,
      absentRows: 0,
      distinctValues: Object.create(null),
      populatedEntities: Object.create(null),
      crossSourceChanges: []
    };
  });

  const sourceSummaries = [];
  const byEntity = Object.create(null);

  let sourceRows = 0;
  let completeRawRows = 0;
  let truncatedRawRows = 0;
  let invalidRawRows = 0;

  let printGroupedItemsFlattenedCompared = 0;
  let printGroupedItemsFlattenedExact = 0;
  let printGroupedItemsFlattenedMismatch = 0;
  const printGroupedItemsMismatchExamples = [];

  let levelRowsComparedToParentChain = 0;
  let levelParentChainExact = 0;
  let levelParentChainMismatch = 0;
  const levelParentChainMismatchExamples = [];

  sources.forEach(function(source, sourceIndex) {
    validateQboStateCaptureWriteSource_(
      source,
      getQboExportManifestEntry_(exportKey)
    );

    const sourceSs = SpreadsheetApp.openById(source.masterBackupFileId);
    const sheet = sourceSs.getSheetByName(
      QBO_ITEM_UNCOVERED_FIELDS_DIAGNOSTIC_.PARENT_SHEET
    );
    if (!sheet) {
      throw new Error(
        'ITEM_UNCOVERED_FIELDS_PARENT_SHEET_MISSING sourceIndex=' +
        sourceIndex + ' file=' + source.masterBackupFileName
      );
    }

    const data = qboItemUncoveredFieldsReadSheet_(sheet);
    if (data.index.RawJSON === undefined) {
      throw new Error(
        'ITEM_UNCOVERED_FIELDS_RAWJSON_COLUMN_MISSING sourceIndex=' +
        sourceIndex + ' file=' + source.masterBackupFileName
      );
    }

    const rawItemsForDepth = Object.create(null);
    const parsedRows = [];

    let sourceComplete = 0;
    let sourceTruncated = 0;
    let sourceInvalid = 0;

    data.rows.forEach(function(row, rowOffset) {
      sourceRows += 1;
      const raw = String(row[data.index.RawJSON] || '');

      if (raw.indexOf(QBO_STATE_CAPTURE_RAW_TRUNCATION_MARKER_) !== -1) {
        truncatedRawRows += 1;
        sourceTruncated += 1;
        return;
      }

      let item;
      try {
        item = JSON.parse(raw);
      } catch (e) {
        invalidRawRows += 1;
        sourceInvalid += 1;
        return;
      }

      completeRawRows += 1;
      sourceComplete += 1;

      const entityId = String(item.Id || '');
      const displayName = item.Name === undefined || item.Name === null
        ? ''
        : String(item.Name);
      const fqn = item.FullyQualifiedName === undefined ||
        item.FullyQualifiedName === null
        ? ''
        : String(item.FullyQualifiedName);

      parsedRows.push({
        item: item,
        row: row,
        rowNumber: rowOffset + 2,
        entityId: entityId,
        displayName: displayName,
        fullyQualifiedName: fqn
      });

      if (entityId) {
        rawItemsForDepth[entityId] = item;
      }

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

      QBO_ITEM_UNCOVERED_FIELDS_DIAGNOSTIC_.FIELDS.forEach(function(field) {
        const present = Object.prototype.hasOwnProperty.call(item, field);
        const encoded = present
          ? qboItemUncoveredFieldsStableString_(item[field])
          : '__ABSENT__';

        observation.fields[field] = encoded;

        if (present) {
          fieldStats[field].presentRows += 1;
        } else {
          fieldStats[field].absentRows += 1;
        }

        fieldStats[field].distinctValues[encoded] =
          (fieldStats[field].distinctValues[encoded] || 0) + 1;

        if (present && qboItemUncoveredFieldsIsPopulated_(item[field])) {
          if (!fieldStats[field].populatedEntities[entityId]) {
            fieldStats[field].populatedEntities[entityId] = {
              entityId: entityId,
              displayName: displayName,
              observations: []
            };
          }
          fieldStats[field].populatedEntities[entityId].observations.push({
            sourceIndex: sourceIndex,
            value: item[field]
          });
        }
      });

      byEntity[entityId].observations.push(observation);

      // Directly test the known exporter defect candidate:
      // historical exporter read ItemGroupDetail.PrintGroupedItems while QBO
      // payload evidence shows PrintGroupedItems as a top-level Item field.
      if (Object.prototype.hasOwnProperty.call(item, 'PrintGroupedItems') &&
          data.index.PrintGroupedItems !== undefined) {
        printGroupedItemsFlattenedCompared += 1;

        const rawValue = qboItemUncoveredFieldsNormalizeScalar_(
          item.PrintGroupedItems
        );
        const flattenedValue = qboItemUncoveredFieldsNormalizeScalar_(
          row[data.index.PrintGroupedItems]
        );

        if (rawValue === flattenedValue) {
          printGroupedItemsFlattenedExact += 1;
        } else {
          printGroupedItemsFlattenedMismatch += 1;
          if (printGroupedItemsMismatchExamples.length < 25) {
            printGroupedItemsMismatchExamples.push({
              sourceIndex: sourceIndex,
              entityId: entityId,
              displayName: displayName,
              rawTopLevelValue: item.PrintGroupedItems,
              flattenedValue: row[data.index.PrintGroupedItems]
            });
          }
        }
      }
    });

    // Test whether Level is derivable from the ParentRef hierarchy already
    // present in the governed Item contract. Top-level depth is defined here
    // as 0, direct child as 1, etc. We report mismatches rather than assuming.
    parsedRows.forEach(function(entry) {
      const item = entry.item;
      if (!Object.prototype.hasOwnProperty.call(item, 'Level')) return;

      const depth = qboItemUncoveredFieldsParentDepth_(
        item,
        rawItemsForDepth,
        Object.create(null)
      );
      if (depth === null) return;

      levelRowsComparedToParentChain += 1;
      if (Number(item.Level) === depth) {
        levelParentChainExact += 1;
      } else {
        levelParentChainMismatch += 1;
        if (levelParentChainMismatchExamples.length < 25) {
          levelParentChainMismatchExamples.push({
            sourceIndex: sourceIndex,
            entityId: entry.entityId,
            displayName: entry.displayName,
            fullyQualifiedName: entry.fullyQualifiedName,
            rawLevel: item.Level,
            derivedParentDepth: depth,
            parentRef: item.ParentRef || null
          });
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
      physicalColumns: {
        ClassRef: data.index.ClassRef !== undefined,
        Level: data.index.Level !== undefined,
        PrefVendorRef: data.index.PrefVendorRef !== undefined,
        PrintGroupedItems: data.index.PrintGroupedItems !== undefined,
        TaxClassificationRef: data.index.TaxClassificationRef !== undefined
      }
    });
  });

  // Cross-source change evidence by entity/field.
  Object.keys(byEntity).forEach(function(entityId) {
    const entity = byEntity[entityId];
    entity.observations.sort(function(a, b) {
      return a.sourceIndex - b.sourceIndex;
    });

    QBO_ITEM_UNCOVERED_FIELDS_DIAGNOSTIC_.FIELDS.forEach(function(field) {
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
  QBO_ITEM_UNCOVERED_FIELDS_DIAGNOSTIC_.FIELDS.forEach(function(field) {
    const stats = fieldStats[field];

    resultFields[field] = {
      presentRows: stats.presentRows,
      absentRows: stats.absentRows,
      distinctValues: qboItemUncoveredFieldsDistinctList_(
        stats.distinctValues
      ),
      populatedEntities: Object.keys(stats.populatedEntities)
        .sort()
        .map(function(entityId) {
          return stats.populatedEntities[entityId];
        }),
      crossSourceChanges: stats.crossSourceChanges
    };
  });

  const result = {
    version: '1.5.19',
    canonicalizationVersion: 'QBO_CANONICAL_STATE_V1',
    mode: 'ITEM_UNCOVERED_CANONICAL_FIELDS_DIAGNOSTIC',
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
    PrintGroupedItemsContractTest: {
      rowsCompared: printGroupedItemsFlattenedCompared,
      exactMatches: printGroupedItemsFlattenedExact,
      mismatches: printGroupedItemsFlattenedMismatch,
      mismatchExamples: printGroupedItemsMismatchExamples,
      interpretation:
        'Compares top-level RawJSON PrintGroupedItems to the physical flattened PrintGroupedItems column.'
    },
    LevelDerivationTest: {
      derivationRule:
        'Top-level Item depth=0; each resolvable ParentRef hop adds 1.',
      rowsCompared: levelRowsComparedToParentChain,
      exactMatches: levelParentChainExact,
      mismatches: levelParentChainMismatch,
      mismatchExamples: levelParentChainMismatchExamples
    },
    sourceSummaries: sourceSummaries,
    validRawEvidence:
      truncatedRawRows === 0 && invalidRawRows === 0,
    canonicalWritesPerformed: false,
    migrationCursorChanged: false,
    historicalContractAuditCursorChanged: false
  };

  console.log(JSON.stringify(result, null, 2));
  console.log(
    '[ITEM UNCOVERED CANONICAL FIELDS] | COMPLETE' +
    ' | sources=' + sources.length +
    ' | completeRaw=' + completeRawRows +
    ' | truncatedRaw=' + truncatedRawRows +
    ' | invalidRaw=' + invalidRawRows +
    ' | ClassRefChanges=' +
      resultFields.ClassRef.crossSourceChanges.length +
    ' | LevelChanges=' +
      resultFields.Level.crossSourceChanges.length +
    ' | PrefVendorRefChanges=' +
      resultFields.PrefVendorRef.crossSourceChanges.length +
    ' | PrintGroupedItemsChanges=' +
      resultFields.PrintGroupedItems.crossSourceChanges.length +
    ' | TaxClassificationRefChanges=' +
      resultFields.TaxClassificationRef.crossSourceChanges.length +
    ' | PrintGroupedItemsFlattenedMismatches=' +
      printGroupedItemsFlattenedMismatch +
    ' | LevelParentDepthMismatches=' +
      levelParentChainMismatch
  );

  return result;
}


function qboItemUncoveredFieldsReadSheet_(sheet) {
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


function qboItemUncoveredFieldsStableString_(value) {
  if (value === undefined) return '__UNDEFINED__';
  if (value === null) return 'null';

  if (typeof value !== 'object') {
    return JSON.stringify(value);
  }

  return JSON.stringify(qboItemUncoveredFieldsSortObject_(value));
}


function qboItemUncoveredFieldsSortObject_(value) {
  if (Array.isArray(value)) {
    return value.map(qboItemUncoveredFieldsSortObject_);
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const out = {};
  Object.keys(value).sort().forEach(function(key) {
    out[key] = qboItemUncoveredFieldsSortObject_(value[key]);
  });
  return out;
}


function qboItemUncoveredFieldsIsPopulated_(value) {
  if (value === undefined || value === null || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}


function qboItemUncoveredFieldsNormalizeScalar_(value) {
  if (value === undefined || value === null || value === '') {
    return '__BLANK__';
  }
  if (value === true || String(value).toLowerCase() === 'true') return 'true';
  if (value === false || String(value).toLowerCase() === 'false') return 'false';
  return String(value);
}


/**
 * Derives hierarchy depth from ParentRef using only the same source's Items.
 * Returns null if the chain cannot be resolved or a cycle is encountered.
 */
function qboItemUncoveredFieldsParentDepth_(item, itemMap, seen) {
  if (!item || !item.ParentRef || !item.ParentRef.value) {
    return 0;
  }

  const parentId = String(item.ParentRef.value);
  if (seen[parentId]) return null;
  seen[parentId] = true;

  const parent = itemMap[parentId];
  if (!parent) return null;

  const parentDepth = qboItemUncoveredFieldsParentDepth_(
    parent,
    itemMap,
    seen
  );

  return parentDepth === null ? null : parentDepth + 1;
}


function qboItemUncoveredFieldsDistinctList_(map) {
  return Object.keys(map)
    .sort()
    .map(function(value) {
      return {
        value: value,
        count: map[value]
      };
    });
}
