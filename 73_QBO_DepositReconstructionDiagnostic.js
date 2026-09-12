/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 73_QBO_DepositReconstructionDiagnostic.js
 * Purpose     : Read-only diagnostic for historical Deposit observations whose
 *               parent RawJSON was truncated by the Google Sheets cell limit.
 *
 * Scope:
 *   - Diagnoses the Deposit source currently pointed to by the resumable
 *     canonical-migration cursor.
 *   - Finds the first parent Deposit row with truncated RawJSON.
 *   - Inspects parent flattened evidence and all matching QBO_DepositLines rows.
 *   - Builds a reconstruction candidate only from evidence already preserved in
 *     the same Master Backup.
 *   - Compares the candidate's canonical top-level shape with canonical keys
 *     observed in complete Deposit RawJSON from the same source.
 *   - Does NOT write canonical evidence, alter source rows, or advance/reset the
 *     migration cursor.
 *
 * Important:
 *   This diagnostic intentionally distinguishes "supported by preserved
 *   evidence" from "proven complete." Flattened blank cells can collapse the
 *   distinction between an absent QBO property and an explicitly blank value.
 *   Any such ambiguity remains visible and prevents a PROVEN_COMPLETE result.
 * ============================================================================
 */

function auditQboDepositCanonicalReconstructionCurrentSource() {
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
      'DEPOSIT_RECONSTRUCTION_DIAGNOSTIC_NO_CURRENT_SOURCE cursor=' + cursor +
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

  const parentData = qboDepositDiagnosticReadSheet_(parentSheet);
  const lineData = qboDepositDiagnosticReadSheet_(lineSheet);
  qboDepositDiagnosticRequireHeaders_(parentData.index, [
    'Id', 'DocNumber', 'TxnDate', 'DepositAccountId', 'CurrencyCode',
    'ExchangeRate', 'DepartmentId', 'TotalAmount', 'HomeTotalAmount',
    'CashBackJSON', 'LineCount', 'PrivateNote', 'RawJSON'
  ], 'QBO_Deposits');
  qboDepositDiagnosticRequireHeaders_(lineData.index, [
    'DepositId', 'LineId', 'LineNumber', 'RawJSON'
  ], 'QBO_DepositLines');

  let targetRow = null;
  let targetRowNumber = 0;
  for (let i = 0; i < parentData.rows.length; i += 1) {
    const raw = String(parentData.rows[i][parentData.index.RawJSON] || '');
    if (raw.indexOf(QBO_STATE_CAPTURE_RAW_TRUNCATION_MARKER_) !== -1) {
      targetRow = parentData.rows[i];
      targetRowNumber = i + 2;
      break;
    }
  }
  if (!targetRow) {
    const noTarget = {
      version: QBO_STATE_CAPTURE.VERSION,
      mode: 'DEPOSIT_CANONICAL_RECONSTRUCTION_DIAGNOSTIC',
      exportKey: exportKey,
      cursor: cursor,
      sourceIndex: cursor,
      sourceId: source.sourceId,
      truncatedParentRowsFound: 0,
      actionRequired: false,
      conclusion: 'NO_TRUNCATED_DEPOSIT_RAWJSON_IN_CURRENT_SOURCE'
    };
    console.log(JSON.stringify(noTarget, null, 2));
    return noTarget;
  }

  const targetEntityId = qboDepositDiagnosticCellText_(targetRow, parentData.index, 'Id');
  const targetRaw = String(targetRow[parentData.index.RawJSON] || '');
  const originalLength = qboDepositDiagnosticOriginalLength_(targetRaw);
  const lineArrayStartedBeforeTruncation = targetRaw.indexOf('"Line"') !== -1;

  const matchingLineRows = lineData.rows.filter(function(row) {
    return qboDepositDiagnosticCellText_(row, lineData.index, 'DepositId') === targetEntityId;
  }).sort(function(a, b) {
    return qboDepositDiagnosticSortNumber_(a[lineData.index.LineNumber]) -
      qboDepositDiagnosticSortNumber_(b[lineData.index.LineNumber]);
  });

  const lineAudit = qboDepositDiagnosticParseLines_(matchingLineRows, lineData.index);
  const observedSchema = qboDepositDiagnosticObservedCanonicalTopLevelKeys_(
    parentData.rows,
    parentData.index
  );
  const reconstruction = qboDepositDiagnosticBuildCandidate_(
    targetRow,
    parentData.index,
    lineAudit.lines
  );

  let candidateCanonical = null;
  let candidateCanonicalKeys = [];
  let candidateCanonicalHash = '';
  if (reconstruction.buildable) {
    candidateCanonical = qboCanonicalizeEntityState_(exportKey, 'Deposit', reconstruction.entity);
    candidateCanonicalKeys = Object.keys(candidateCanonical).sort();
    candidateCanonicalHash = qboCanonicalStateHash_(exportKey, 'Deposit', candidateCanonical);
  }

  const uncoveredObservedCanonicalKeys = observedSchema.keys.filter(function(key) {
    return candidateCanonicalKeys.indexOf(key) === -1;
  });
  const candidateKeysNotObservedElsewhere = candidateCanonicalKeys.filter(function(key) {
    return observedSchema.keys.indexOf(key) === -1;
  });

  const parentLineCount = qboDepositDiagnosticFiniteNumber_(
    targetRow[parentData.index.LineCount]
  );
  const lineCountMatches = parentLineCount !== null && parentLineCount === matchingLineRows.length;

  const blockers = [];
  if (!lineAudit.allRawJsonComplete) blockers.push('DEPOSIT_LINE_RAWJSON_INCOMPLETE');
  if (!lineAudit.allRawJsonParseable) blockers.push('DEPOSIT_LINE_RAWJSON_INVALID');
  if (!lineCountMatches) blockers.push('DEPOSIT_LINE_COUNT_MISMATCH');
  reconstruction.ambiguities.forEach(function(item) { blockers.push(item); });
  reconstruction.errors.forEach(function(item) { blockers.push(item); });
  uncoveredObservedCanonicalKeys.forEach(function(key) {
    blockers.push('UNRECONSTRUCTED_OBSERVED_CANONICAL_KEY:' + key);
  });

  const uniqueBlockers = qboDepositDiagnosticUnique_(blockers);
  const provenComplete = uniqueBlockers.length === 0;

  const result = {
    version: QBO_STATE_CAPTURE.VERSION,
    canonicalizationVersion: QBO_STATE_CAPTURE.CANONICALIZATION_VERSION,
    mode: 'DEPOSIT_CANONICAL_RECONSTRUCTION_DIAGNOSTIC',
    exportKey: exportKey,
    cursor: cursor,
    sourceIndex: cursor,
    sourceId: source.sourceId,
    masterBackupFileName: source.masterBackupFileName,
    targetEntityId: targetEntityId,
    parentSheetRow: targetRowNumber,
    parentRawJson: {
      truncated: true,
      storedLength: targetRaw.length,
      originalLength: originalLength,
      lineArrayStartedBeforeTruncation: lineArrayStartedBeforeTruncation
    },
    depositLines: {
      parentLineCount: parentLineCount,
      rowsFound: matchingLineRows.length,
      lineCountMatches: lineCountMatches,
      allRawJsonComplete: lineAudit.allRawJsonComplete,
      allRawJsonParseable: lineAudit.allRawJsonParseable,
      incompleteLineNumbers: lineAudit.incompleteLineNumbers,
      invalidLineNumbers: lineAudit.invalidLineNumbers
    },
    sourceSchemaEvidence: {
      completeParentRawRowsScanned: observedSchema.completeRowsScanned,
      observedCanonicalTopLevelKeys: observedSchema.keys
    },
    reconstruction: {
      buildable: reconstruction.buildable,
      mappedCanonicalTopLevelKeys: candidateCanonicalKeys,
      canonicalStateHash: candidateCanonicalHash,
      uncoveredObservedCanonicalKeys: uncoveredObservedCanonicalKeys,
      candidateKeysNotObservedElsewhere: candidateKeysNotObservedElsewhere,
      ambiguities: reconstruction.ambiguities,
      errors: reconstruction.errors
    },
    provenComplete: provenComplete,
    blockers: uniqueBlockers,
    actionRequired: !provenComplete,
    conclusion: provenComplete
      ? 'RECONSTRUCTION_PROVEN_COMPLETE_FOR_GOVERNED_CANONICAL_FIELDS'
      : 'RECONSTRUCTION_NOT_YET_PROVEN_COMPLETE'
  };

  console.log(JSON.stringify(result, null, 2));
  console.log(
    '[DEPOSIT RECONSTRUCTION DIAGNOSTIC] | ' +
    (provenComplete ? 'PASS' : 'ACTION_REQUIRED') +
    ' | sourceIndex=' + cursor +
    ' | entityId=' + targetEntityId +
    ' | lineRows=' + matchingLineRows.length +
    ' | blockers=' + uniqueBlockers.length
  );
  return result;
}

function qboDepositDiagnosticReadSheet_(sheet) {
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

function qboDepositDiagnosticRequireHeaders_(index, required, sheetName) {
  required.forEach(function(name) {
    if (index[name] === undefined) {
      throw new Error('DEPOSIT_DIAGNOSTIC_SOURCE_SCHEMA_MISSING ' + name + ' sheet=' + sheetName);
    }
  });
}

function qboDepositDiagnosticObservedCanonicalTopLevelKeys_(rows, index) {
  const keys = Object.create(null);
  let completeRowsScanned = 0;
  rows.forEach(function(row) {
    const raw = String(row[index.RawJSON] || '');
    if (!raw || raw.indexOf(QBO_STATE_CAPTURE_RAW_TRUNCATION_MARKER_) !== -1) return;
    let entity;
    try { entity = JSON.parse(raw); }
    catch (error) { return; }
    const canonical = qboCanonicalizeEntityState_('DEPOSITS', 'Deposit', entity);
    Object.keys(canonical).forEach(function(key) { keys[key] = true; });
    completeRowsScanned += 1;
  });
  return {completeRowsScanned: completeRowsScanned, keys: Object.keys(keys).sort()};
}

function qboDepositDiagnosticParseLines_(rows, index) {
  const lines = [];
  const incompleteLineNumbers = [];
  const invalidLineNumbers = [];
  rows.forEach(function(row) {
    const lineNumber = row[index.LineNumber];
    const raw = String(row[index.RawJSON] || '');
    if (raw.indexOf(QBO_STATE_CAPTURE_RAW_TRUNCATION_MARKER_) !== -1) {
      incompleteLineNumbers.push(String(lineNumber));
      return;
    }
    try {
      lines.push(JSON.parse(raw));
    } catch (error) {
      invalidLineNumbers.push(String(lineNumber));
    }
  });
  return {
    lines: lines,
    allRawJsonComplete: incompleteLineNumbers.length === 0,
    allRawJsonParseable: invalidLineNumbers.length === 0 && lines.length === rows.length,
    incompleteLineNumbers: incompleteLineNumbers,
    invalidLineNumbers: invalidLineNumbers
  };
}

function qboDepositDiagnosticBuildCandidate_(row, index, lines) {
  const entity = {};
  const ambiguities = [];
  const errors = [];

  qboDepositDiagnosticMapScalar_(entity, 'Id', row, index, 'Id', ambiguities, true);
  qboDepositDiagnosticMapScalar_(entity, 'DocNumber', row, index, 'DocNumber', ambiguities, false);
  qboDepositDiagnosticMapScalar_(entity, 'TxnDate', row, index, 'TxnDate', ambiguities, false);
  qboDepositDiagnosticMapRef_(entity, 'DepositToAccountRef', row, index, 'DepositAccountId', ambiguities);
  qboDepositDiagnosticMapRef_(entity, 'CurrencyRef', row, index, 'CurrencyCode', ambiguities);
  qboDepositDiagnosticMapScalar_(entity, 'ExchangeRate', row, index, 'ExchangeRate', ambiguities, false);
  qboDepositDiagnosticMapRef_(entity, 'DepartmentRef', row, index, 'DepartmentId', ambiguities);
  qboDepositDiagnosticMapScalar_(entity, 'TotalAmt', row, index, 'TotalAmount', ambiguities, false);
  qboDepositDiagnosticMapScalar_(entity, 'HomeTotalAmt', row, index, 'HomeTotalAmount', ambiguities, false);
  qboDepositDiagnosticMapScalar_(entity, 'PrivateNote', row, index, 'PrivateNote', ambiguities, false);

  const cashBackRaw = String(row[index.CashBackJSON] || '');
  if (cashBackRaw) {
    if (cashBackRaw.indexOf(QBO_STATE_CAPTURE_RAW_TRUNCATION_MARKER_) !== -1) {
      errors.push('CASHBACK_JSON_TRUNCATED');
    } else {
      try { entity.CashBack = JSON.parse(cashBackRaw); }
      catch (error) { errors.push('CASHBACK_JSON_INVALID'); }
    }
  } else {
    ambiguities.push('AMBIGUOUS_ABSENT_OR_BLANK:CashBack');
  }

  entity.Line = lines;

  return {
    entity: entity,
    ambiguities: qboDepositDiagnosticUnique_(ambiguities),
    errors: qboDepositDiagnosticUnique_(errors),
    buildable: errors.length === 0
  };
}

function qboDepositDiagnosticMapScalar_(entity, rawKey, row, index, header, ambiguities, required) {
  const value = row[index[header]];
  if (qboDepositDiagnosticHasCellValue_(value)) {
    entity[rawKey] = qboDepositDiagnosticNormalizeCellValue_(value);
  } else if (required) {
    ambiguities.push('MISSING_REQUIRED_FLATTENED_VALUE:' + rawKey);
  } else {
    ambiguities.push('AMBIGUOUS_ABSENT_OR_BLANK:' + rawKey);
  }
}

function qboDepositDiagnosticMapRef_(entity, rawKey, row, index, idHeader, ambiguities) {
  const value = row[index[idHeader]];
  if (qboDepositDiagnosticHasCellValue_(value)) {
    entity[rawKey] = {value: String(value)};
  } else {
    ambiguities.push('AMBIGUOUS_ABSENT_OR_BLANK:' + rawKey);
  }
}

function qboDepositDiagnosticHasCellValue_(value) {
  return !(value === '' || value === null || value === undefined);
}

function qboDepositDiagnosticNormalizeCellValue_(value) {
  if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
    return Utilities.formatDate(value, 'GMT', 'yyyy-MM-dd');
  }
  return value;
}

function qboDepositDiagnosticCellText_(row, index, header) {
  const value = row[index[header]];
  return value === null || value === undefined ? '' : String(value).trim();
}

function qboDepositDiagnosticFiniteNumber_(value) {
  if (value === '' || value === null || value === undefined) return null;
  const number = Number(value);
  return isFinite(number) ? number : null;
}

function qboDepositDiagnosticSortNumber_(value) {
  const number = Number(value);
  return isFinite(number) ? number : Number.MAX_SAFE_INTEGER;
}

function qboDepositDiagnosticOriginalLength_(raw) {
  const match = String(raw || '').match(/\[TRUNCATED: original length (\d+)\]/);
  return match ? Number(match[1]) : null;
}

function qboDepositDiagnosticUnique_(values) {
  const seen = Object.create(null);
  const result = [];
  values.forEach(function(value) {
    const text = String(value || '');
    if (!text || seen[text]) return;
    seen[text] = true;
    result.push(text);
  });
  return result;
}
