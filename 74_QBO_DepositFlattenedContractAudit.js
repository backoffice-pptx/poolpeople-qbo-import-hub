/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 74_QBO_DepositFlattenedContractAudit.js
 * Purpose     : Read-only coverage audit comparing the governed flattened
 *               Deposit export contract with canonical state derived from
 *               complete parent RawJSON in the same historical source.
 *
 * Scope:
 *   - Audits the Deposit source currently pointed to by the resumable canonical
 *     migration cursor.
 *   - Uses ONLY non-truncated parent RawJSON rows as the comparison population.
 *   - Rebuilds a Deposit candidate from QBO_Deposits + QBO_DepositLines using
 *     fields actually externalized by the historical exporter.
 *   - Canonicalizes both the complete raw entity and the flattened-contract
 *     candidate under the existing QBO_CANONICAL_STATE_V1 rules.
 *   - Reports exact-equivalence counts and grouped canonical diff paths.
 *   - Specifically reports observed TxnTaxDetail values because the historical
 *     Deposit exporter did not externalize TxnTaxDetailJSON.
 *
 * Read-only guarantees:
 *   - Does NOT write Snapshot / Change / Change Detail records.
 *   - Does NOT alter, reset, or advance any migration cursor.
 *   - Does NOT change canonicalization or migration behavior.
 * ============================================================================
 */

function auditQboDepositFlattenedContractCoverageCurrentSource() {
  const exportKey = 'DEPOSITS';
  const spreadsheet = getQboStateCaptureSpreadsheet_();
  const sourceSheet = spreadsheet.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);
  const sources = loadQboStateCaptureWriteSources_(sourceSheet, exportKey)
    .filter(function(source) {
      return source.sourceStatus === QBO_STATE_CAPTURE.SOURCE_STATUS_AVAILABLE;
    });

  const rawCursor = PropertiesService.getScriptProperties()
    .getProperty(qboCanonicalMigrationCursorKey_(exportKey));
  let cursor = Number(rawCursor || 0);
  if (!isFinite(cursor) || cursor < 0) cursor = 0;
  if (cursor >= sources.length) {
    throw new Error(
      'DEPOSIT_FLATTENED_CONTRACT_AUDIT_NO_CURRENT_SOURCE cursor=' + cursor +
      ' sources=' + sources.length
    );
  }

  const source = sources[cursor];
  validateQboStateCaptureWriteSource_(source, getQboExportManifestEntry_(exportKey));

  const sourceSpreadsheet = SpreadsheetApp.openById(source.masterBackupFileId);
  const parentSheet = sourceSpreadsheet.getSheetByName('QBO_Deposits');
  const lineSheet = sourceSpreadsheet.getSheetByName('QBO_DepositLines');
  if (!parentSheet) throw new Error('MISSING_DEPOSIT_PARENT_SHEET');
  if (!lineSheet) throw new Error('MISSING_DEPOSIT_LINE_SHEET');

  const parentData = qboDepositContractAuditReadSheet_(parentSheet);
  const lineData = qboDepositContractAuditReadSheet_(lineSheet);

  qboDepositContractAuditRequireHeaders_(parentData.index, [
    'Id', 'DocNumber', 'TxnDate', 'DepositAccountId', 'CurrencyCode',
    'ExchangeRate', 'DepartmentId', 'TotalAmount', 'HomeTotalAmount',
    'CashBackJSON', 'LineCount', 'PrivateNote', 'RawJSON'
  ], 'QBO_Deposits');
  qboDepositContractAuditRequireHeaders_(lineData.index, [
    'DepositId', 'LineNumber', 'RawJSON'
  ], 'QBO_DepositLines');

  const lineGroups = qboDepositContractAuditGroupLines_(lineData.rows, lineData.index);
  const diffPathCounts = Object.create(null);
  const diffSamples = [];
  const rawCanonicalTopLevelKeyCounts = Object.create(null);
  const flatCanonicalTopLevelKeyCounts = Object.create(null);
  const missingFromFlatTopLevelCounts = Object.create(null);
  const extraInFlatTopLevelCounts = Object.create(null);
  const txnTaxDetailValueCounts = Object.create(null);
  const rowErrorSamples = [];

  let completeParentRawRows = 0;
  let truncatedParentRawRows = 0;
  let invalidParentRawRows = 0;
  let exactCanonicalMatches = 0;
  let canonicalMismatches = 0;
  let lineCountMismatches = 0;
  let depositsWithIncompleteLineRaw = 0;
  let depositsWithInvalidLineRaw = 0;
  let rowsWithTxnTaxDetail = 0;
  let rowsWithoutTxnTaxDetail = 0;
  let rowsWithOnlyTxnTaxDetailDiff = 0;
  let rowsWithNonTxnTaxDetailDiff = 0;

  parentData.rows.forEach(function(row, rowIndex) {
    const entityId = qboDepositContractAuditCellText_(row, parentData.index, 'Id');
    const raw = String(row[parentData.index.RawJSON] || '');

    if (!raw) {
      invalidParentRawRows += 1;
      qboDepositContractAuditPushSample_(rowErrorSamples, {
        entityId: entityId,
        parentSheetRow: rowIndex + 2,
        error: 'EMPTY_PARENT_RAWJSON'
      }, 20);
      return;
    }
    if (raw.indexOf(QBO_STATE_CAPTURE_RAW_TRUNCATION_MARKER_) !== -1) {
      truncatedParentRawRows += 1;
      return;
    }

    let rawEntity;
    try {
      rawEntity = JSON.parse(raw);
    } catch (error) {
      invalidParentRawRows += 1;
      qboDepositContractAuditPushSample_(rowErrorSamples, {
        entityId: entityId,
        parentSheetRow: rowIndex + 2,
        error: 'INVALID_PARENT_RAWJSON'
      }, 20);
      return;
    }

    completeParentRawRows += 1;

    const lineGroup = lineGroups[entityId] || {
      rowsFound: 0,
      lines: [],
      incompleteRawCount: 0,
      invalidRawCount: 0
    };
    const expectedLineCount = qboDepositContractAuditFiniteNumber_(
      row[parentData.index.LineCount]
    );
    if (expectedLineCount === null || expectedLineCount !== lineGroup.rowsFound) {
      lineCountMismatches += 1;
    }
    if (lineGroup.incompleteRawCount > 0) depositsWithIncompleteLineRaw += 1;
    if (lineGroup.invalidRawCount > 0) depositsWithInvalidLineRaw += 1;

    if (Object.prototype.hasOwnProperty.call(rawEntity, 'TxnTaxDetail')) {
      rowsWithTxnTaxDetail += 1;
      const txnTaxCanonical = qboCanonicalizeValue_(rawEntity.TxnTaxDetail, {
        exportKey: exportKey,
        entityType: 'Deposit',
        path: 'TxnTaxDetail',
        parentKey: 'TxnTaxDetail',
        root: false
      });
      const valueKey = qboCanonicalStableStringify_(txnTaxCanonical);
      txnTaxDetailValueCounts[valueKey] = (txnTaxDetailValueCounts[valueKey] || 0) + 1;
    } else {
      rowsWithoutTxnTaxDetail += 1;
    }

    const flatBuild = qboDepositContractAuditBuildEntityFromFlattened_(
      row,
      parentData.index,
      lineGroup.lines
    );
    if (flatBuild.errors.length > 0) {
      qboDepositContractAuditPushSample_(rowErrorSamples, {
        entityId: entityId,
        parentSheetRow: rowIndex + 2,
        error: flatBuild.errors.join('|')
      }, 20);
    }

    const rawCanonical = qboCanonicalizeEntityState_(exportKey, 'Deposit', rawEntity);
    const flatCanonical = qboCanonicalizeEntityState_(exportKey, 'Deposit', flatBuild.entity);

    Object.keys(rawCanonical).forEach(function(key) {
      rawCanonicalTopLevelKeyCounts[key] = (rawCanonicalTopLevelKeyCounts[key] || 0) + 1;
      if (!Object.prototype.hasOwnProperty.call(flatCanonical, key)) {
        missingFromFlatTopLevelCounts[key] = (missingFromFlatTopLevelCounts[key] || 0) + 1;
      }
    });
    Object.keys(flatCanonical).forEach(function(key) {
      flatCanonicalTopLevelKeyCounts[key] = (flatCanonicalTopLevelKeyCounts[key] || 0) + 1;
      if (!Object.prototype.hasOwnProperty.call(rawCanonical, key)) {
        extraInFlatTopLevelCounts[key] = (extraInFlatTopLevelCounts[key] || 0) + 1;
      }
    });

    if (qboCanonicalStableStringify_(rawCanonical) === qboCanonicalStableStringify_(flatCanonical)) {
      exactCanonicalMatches += 1;
      return;
    }

    canonicalMismatches += 1;
    const diffs = qboCanonicalDiff_(flatCanonical, rawCanonical);
    let onlyTxnTaxDetail = diffs.length > 0;
    diffs.forEach(function(diff) {
      const path = String(diff.path || '$');
      diffPathCounts[path] = (diffPathCounts[path] || 0) + 1;
      if (!(path === 'TxnTaxDetail' || path.indexOf('TxnTaxDetail.') === 0 || path.indexOf('TxnTaxDetail[') === 0)) {
        onlyTxnTaxDetail = false;
      }
      qboDepositContractAuditPushSample_(diffSamples, {
        entityId: entityId,
        parentSheetRow: rowIndex + 2,
        path: path,
        operation: diff.operation,
        beforeType: diff.beforeType,
        beforeValue: diff.beforeValue,
        afterType: diff.afterType,
        afterValue: diff.afterValue
      }, 50);
    });

    if (onlyTxnTaxDetail) rowsWithOnlyTxnTaxDetailDiff += 1;
    else rowsWithNonTxnTaxDetailDiff += 1;
  });

  const txnTaxDetailValues = qboDepositContractAuditCountMapToArray_(txnTaxDetailValueCounts);
  const diffPaths = qboDepositContractAuditCountMapToArray_(diffPathCounts);
  const missingTopLevel = qboDepositContractAuditCountMapToArray_(missingFromFlatTopLevelCounts);
  const extraTopLevel = qboDepositContractAuditCountMapToArray_(extraInFlatTopLevelCounts);

  const onlyObservedGapIsEmptyTxnTaxDetail =
    canonicalMismatches > 0 &&
    rowsWithNonTxnTaxDetailDiff === 0 &&
    txnTaxDetailValues.length === 1 &&
    txnTaxDetailValues[0].value === '{}' &&
    rowsWithoutTxnTaxDetail === 0;

  const result = {
    version: QBO_STATE_CAPTURE.VERSION,
    canonicalizationVersion: QBO_STATE_CAPTURE.CANONICALIZATION_VERSION,
    mode: 'DEPOSIT_FLATTENED_CONTRACT_COVERAGE_AUDIT',
    exportKey: exportKey,
    cursor: cursor,
    sourceIndex: cursor,
    sourceId: source.sourceId,
    masterBackupFileName: source.masterBackupFileName,
    population: {
      parentRows: parentData.rows.length,
      completeParentRawRows: completeParentRawRows,
      truncatedParentRawRows: truncatedParentRawRows,
      invalidParentRawRows: invalidParentRawRows
    },
    flattenedChildEvidence: {
      depositLineRows: lineData.rows.length,
      lineCountMismatches: lineCountMismatches,
      depositsWithIncompleteLineRaw: depositsWithIncompleteLineRaw,
      depositsWithInvalidLineRaw: depositsWithInvalidLineRaw
    },
    canonicalEquivalence: {
      exactCanonicalMatches: exactCanonicalMatches,
      canonicalMismatches: canonicalMismatches,
      exactMatchRate: completeParentRawRows
        ? Number((exactCanonicalMatches / completeParentRawRows).toFixed(6))
        : null,
      rowsWithOnlyTxnTaxDetailDiff: rowsWithOnlyTxnTaxDetailDiff,
      rowsWithNonTxnTaxDetailDiff: rowsWithNonTxnTaxDetailDiff,
      onlyObservedGapIsEmptyTxnTaxDetail: onlyObservedGapIsEmptyTxnTaxDetail
    },
    txnTaxDetailEvidence: {
      rowsWithTxnTaxDetail: rowsWithTxnTaxDetail,
      rowsWithoutTxnTaxDetail: rowsWithoutTxnTaxDetail,
      distinctCanonicalValues: txnTaxDetailValues
    },
    canonicalTopLevelCoverage: {
      rawCanonicalKeyCounts: qboDepositContractAuditCountMapToArray_(rawCanonicalTopLevelKeyCounts),
      flatCanonicalKeyCounts: qboDepositContractAuditCountMapToArray_(flatCanonicalTopLevelKeyCounts),
      missingFromFlattenedContract: missingTopLevel,
      extraInFlattenedContract: extraTopLevel
    },
    canonicalDiffPaths: diffPaths,
    diffSamples: diffSamples,
    rowErrorSamples: rowErrorSamples,
    writesPerformed: false,
    cursorChanged: false,
    conclusion: completeParentRawRows === 0
      ? 'NO_COMPLETE_PARENT_RAWJSON_AVAILABLE_FOR_AUDIT'
      : canonicalMismatches === 0
        ? 'EXACT_CANONICAL_EQUIVALENCE_PROVEN_FOR_COMPLETE_ROWS'
        : onlyObservedGapIsEmptyTxnTaxDetail
          ? 'ONLY_OBSERVED_CANONICAL_GAP_IS_EMPTY_TXN_TAX_DETAIL'
          : 'FLATTENED_CONTRACT_NOT_EXACTLY_EQUIVALENT_TO_COMPLETE_RAWJSON'
  };

  console.log(JSON.stringify(result, null, 2));
  console.log(
    '[DEPOSIT FLATTENED CONTRACT AUDIT] | ' + result.conclusion +
    ' | sourceIndex=' + cursor +
    ' | completeRaw=' + completeParentRawRows +
    ' | truncatedRaw=' + truncatedParentRawRows +
    ' | exact=' + exactCanonicalMatches +
    ' | mismatched=' + canonicalMismatches +
    ' | nonTxnTaxDiffRows=' + rowsWithNonTxnTaxDetailDiff
  );
  return result;
}

function qboDepositContractAuditReadSheet_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 1 || lastColumn < 1) {
    return {headers: [], index: Object.create(null), rows: []};
  }
  const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const headers = values[0].map(function(value) { return String(value || '').trim(); });
  return {
    headers: headers,
    index: buildQboStateCaptureWriteHeaderIndex_(headers),
    rows: values.slice(1)
  };
}

function qboDepositContractAuditRequireHeaders_(index, required, sheetName) {
  required.forEach(function(name) {
    if (index[name] === undefined) {
      throw new Error('DEPOSIT_CONTRACT_AUDIT_SOURCE_SCHEMA_MISSING ' + name + ' sheet=' + sheetName);
    }
  });
}

function qboDepositContractAuditGroupLines_(rows, index) {
  const groups = Object.create(null);
  rows.forEach(function(row) {
    const depositId = qboDepositContractAuditCellText_(row, index, 'DepositId');
    if (!groups[depositId]) {
      groups[depositId] = {
        rowEntries: [],
        rowsFound: 0,
        lines: [],
        incompleteRawCount: 0,
        invalidRawCount: 0
      };
    }
    groups[depositId].rowEntries.push({
      lineNumber: row[index.LineNumber],
      raw: String(row[index.RawJSON] || '')
    });
  });

  Object.keys(groups).forEach(function(depositId) {
    const group = groups[depositId];
    group.rowEntries.sort(function(a, b) {
      return qboDepositContractAuditSortNumber_(a.lineNumber) -
        qboDepositContractAuditSortNumber_(b.lineNumber);
    });
    group.rowsFound = group.rowEntries.length;
    group.rowEntries.forEach(function(entry) {
      if (!entry.raw || entry.raw.indexOf(QBO_STATE_CAPTURE_RAW_TRUNCATION_MARKER_) !== -1) {
        group.incompleteRawCount += 1;
        return;
      }
      try {
        group.lines.push(JSON.parse(entry.raw));
      } catch (error) {
        group.invalidRawCount += 1;
      }
    });
    delete group.rowEntries;
  });
  return groups;
}

function qboDepositContractAuditBuildEntityFromFlattened_(row, index, lines) {
  const entity = {};
  const errors = [];

  qboDepositContractAuditSetScalarIfPresent_(entity, 'Id', row[index.Id]);
  qboDepositContractAuditSetScalarIfPresent_(entity, 'DocNumber', row[index.DocNumber]);
  qboDepositContractAuditSetScalarIfPresent_(
    entity,
    'TxnDate',
    qboDepositContractAuditNormalizeDateCell_(row[index.TxnDate])
  );
  qboDepositContractAuditSetRefIfPresent_(entity, 'DepositToAccountRef', row[index.DepositAccountId]);
  qboDepositContractAuditSetRefIfPresent_(entity, 'CurrencyRef', row[index.CurrencyCode]);
  qboDepositContractAuditSetScalarIfPresent_(entity, 'ExchangeRate', row[index.ExchangeRate]);
  qboDepositContractAuditSetRefIfPresent_(entity, 'DepartmentRef', row[index.DepartmentId]);
  qboDepositContractAuditSetScalarIfPresent_(entity, 'TotalAmt', row[index.TotalAmount]);
  qboDepositContractAuditSetScalarIfPresent_(entity, 'HomeTotalAmt', row[index.HomeTotalAmount]);
  qboDepositContractAuditSetScalarIfPresent_(entity, 'PrivateNote', row[index.PrivateNote]);

  const cashBackRaw = String(row[index.CashBackJSON] || '');
  if (cashBackRaw) {
    if (cashBackRaw.indexOf(QBO_STATE_CAPTURE_RAW_TRUNCATION_MARKER_) !== -1) {
      errors.push('CASHBACK_JSON_TRUNCATED');
    } else {
      try {
        entity.CashBack = JSON.parse(cashBackRaw);
      } catch (error) {
        errors.push('CASHBACK_JSON_INVALID');
      }
    }
  }

  entity.Line = lines;
  return {entity: entity, errors: errors};
}

function qboDepositContractAuditSetScalarIfPresent_(entity, key, value) {
  if (value === '' || value === null || value === undefined) return;
  entity[key] = value;
}

function qboDepositContractAuditSetRefIfPresent_(entity, key, value) {
  if (value === '' || value === null || value === undefined) return;
  entity[key] = {value: String(value)};
}

function qboDepositContractAuditNormalizeDateCell_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, 'GMT', 'yyyy-MM-dd');
  }
  return value;
}

function qboDepositContractAuditCellText_(row, index, header) {
  const value = row[index[header]];
  return value === null || value === undefined ? '' : String(value).trim();
}

function qboDepositContractAuditFiniteNumber_(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return isFinite(number) ? number : null;
}

function qboDepositContractAuditSortNumber_(value) {
  const number = Number(value);
  return isFinite(number) ? number : Number.MAX_SAFE_INTEGER;
}

function qboDepositContractAuditCountMapToArray_(map) {
  return Object.keys(map).map(function(key) {
    return {value: key, count: map[key]};
  }).sort(function(a, b) {
    if (b.count !== a.count) return b.count - a.count;
    return a.value < b.value ? -1 : a.value > b.value ? 1 : 0;
  });
}

function qboDepositContractAuditPushSample_(array, value, maxItems) {
  if (array.length < maxItems) array.push(value);
}
