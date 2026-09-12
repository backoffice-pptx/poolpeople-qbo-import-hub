/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 75_QBO_DepositLineOrderAudit.js
 * Purpose     : Read-only proof diagnostic for the seven Deposit contract-audit
 *               exceptions where child-line reconstruction differed from
 *               complete parent RawJSON beyond TxnTaxDetail.
 *
 * Question tested:
 *   Does QBO_DepositLines preserve the original parent Deposit.Line[] sequence
 *   in physical sheet-row order, while sorting by exported LineNumber changes
 *   that sequence when QBO LineNum values repeat/restart?
 *
 * Read-only guarantees:
 *   - No canonical records are written.
 *   - No migration cursor is changed.
 *   - No exporter, canonicalizer, or migration behavior is changed.
 * ============================================================================
 */

function auditQboDepositLineOrderExceptionsCurrentSource() {
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
      'DEPOSIT_LINE_ORDER_AUDIT_NO_CURRENT_SOURCE cursor=' + cursor +
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

  const parentData = qboDepositLineOrderAuditReadSheet_(parentSheet);
  const lineData = qboDepositLineOrderAuditReadSheet_(lineSheet);

  qboDepositLineOrderAuditRequireHeaders_(parentData.index, ['Id', 'RawJSON'], 'QBO_Deposits');
  qboDepositLineOrderAuditRequireHeaders_(
    lineData.index,
    ['DepositId', 'LineNumber', 'RawJSON'],
    'QBO_DepositLines'
  );

  // IMPORTANT: preserve physical sheet-row order. buildDepositLineRows_()
  // appends lines in normalizeArray_(deposit.Line) order.
  const lineGroups = Object.create(null);
  lineData.rows.forEach(function(row, zeroBasedRowIndex) {
    const depositId = qboDepositLineOrderAuditText_(row[lineData.index.DepositId]);
    if (!lineGroups[depositId]) lineGroups[depositId] = [];
    lineGroups[depositId].push({
      sheetRow: zeroBasedRowIndex + 2,
      lineNumber: row[lineData.index.LineNumber],
      raw: String(row[lineData.index.RawJSON] || '')
    });
  });

  const exceptions = [];
  let completeParentsScanned = 0;
  let parentLineArraysCompared = 0;
  let sheetOrderExactMatches = 0;
  let sortedOrderExactMatches = 0;

  parentData.rows.forEach(function(row, zeroBasedRowIndex) {
    const entityId = qboDepositLineOrderAuditText_(row[parentData.index.Id]);
    const raw = String(row[parentData.index.RawJSON] || '');
    if (!raw || raw.indexOf(QBO_STATE_CAPTURE_RAW_TRUNCATION_MARKER_) !== -1) return;

    let parent;
    try {
      parent = JSON.parse(raw);
    } catch (error) {
      return;
    }
    completeParentsScanned += 1;

    const parentLines = Array.isArray(parent.Line) ? parent.Line : [];
    const childEntries = lineGroups[entityId] || [];
    if (parentLines.length !== childEntries.length) return;

    const sheetOrderLines = [];
    let childRawValid = true;
    childEntries.forEach(function(entry) {
      if (!entry.raw || entry.raw.indexOf(QBO_STATE_CAPTURE_RAW_TRUNCATION_MARKER_) !== -1) {
        childRawValid = false;
        return;
      }
      try {
        sheetOrderLines.push(JSON.parse(entry.raw));
      } catch (error) {
        childRawValid = false;
      }
    });
    if (!childRawValid || sheetOrderLines.length !== parentLines.length) return;

    parentLineArraysCompared += 1;

    const parentCanonicalLines = qboCanonicalizeValue_(parentLines, {
      exportKey: exportKey,
      entityType: 'Deposit',
      path: 'Line',
      parentKey: 'Line',
      root: false
    });
    const sheetCanonicalLines = qboCanonicalizeValue_(sheetOrderLines, {
      exportKey: exportKey,
      entityType: 'Deposit',
      path: 'Line',
      parentKey: 'Line',
      root: false
    });

    const sheetExact =
      qboCanonicalStableStringify_(parentCanonicalLines) ===
      qboCanonicalStableStringify_(sheetCanonicalLines);
    if (sheetExact) sheetOrderExactMatches += 1;

    const sortedEntries = childEntries.slice().sort(function(a, b) {
      const av = Number(a.lineNumber);
      const bv = Number(b.lineNumber);
      const an = isFinite(av) ? av : Number.MAX_SAFE_INTEGER;
      const bn = isFinite(bv) ? bv : Number.MAX_SAFE_INTEGER;
      return an - bn;
    });
    const sortedLines = sortedEntries.map(function(entry) {
      return JSON.parse(entry.raw);
    });
    const sortedCanonicalLines = qboCanonicalizeValue_(sortedLines, {
      exportKey: exportKey,
      entityType: 'Deposit',
      path: 'Line',
      parentKey: 'Line',
      root: false
    });
    const sortedExact =
      qboCanonicalStableStringify_(parentCanonicalLines) ===
      qboCanonicalStableStringify_(sortedCanonicalLines);
    if (sortedExact) sortedOrderExactMatches += 1;

    // Report only rows where sorting changes an otherwise exact child-line sequence.
    if (sheetExact && !sortedExact) {
      const lineNumbers = childEntries.map(function(entry) {
        return entry.lineNumber;
      });
      const duplicateCounts = Object.create(null);
      lineNumbers.forEach(function(value) {
        const key = String(value);
        duplicateCounts[key] = (duplicateCounts[key] || 0) + 1;
      });
      const repeatedLineNumbers = Object.keys(duplicateCounts)
        .filter(function(key) { return duplicateCounts[key] > 1; })
        .map(function(key) {
          return {lineNumber: key, count: duplicateCounts[key]};
        });

      exceptions.push({
        entityId: entityId,
        parentSheetRow: zeroBasedRowIndex + 2,
        parentLineCount: parentLines.length,
        childLineCount: childEntries.length,
        physicalSheetOrderMatchesParentLineArray: true,
        lineNumberSortedOrderMatchesParentLineArray: false,
        exportedLineNumberSequence: lineNumbers,
        repeatedLineNumbers: repeatedLineNumbers,
        firstChildSheetRow: childEntries.length ? childEntries[0].sheetRow : null,
        lastChildSheetRow: childEntries.length
          ? childEntries[childEntries.length - 1].sheetRow
          : null
      });
    }
  });

  const provenOrderingIssue =
    exceptions.length === 7 &&
    exceptions.every(function(item) {
      return item.physicalSheetOrderMatchesParentLineArray === true &&
        item.lineNumberSortedOrderMatchesParentLineArray === false;
    });

  const result = {
    version: QBO_STATE_CAPTURE.VERSION,
    canonicalizationVersion: QBO_STATE_CAPTURE.CANONICALIZATION_VERSION,
    mode: 'DEPOSIT_LINE_ORDER_EXCEPTION_AUDIT',
    exportKey: exportKey,
    cursor: cursor,
    sourceIndex: cursor,
    sourceId: source.sourceId,
    masterBackupFileName: source.masterBackupFileName,
    completeParentsScanned: completeParentsScanned,
    parentLineArraysCompared: parentLineArraysCompared,
    sheetOrderExactMatches: sheetOrderExactMatches,
    sortedOrderExactMatches: sortedOrderExactMatches,
    orderingExceptionsFound: exceptions.length,
    exceptions: exceptions,
    writesPerformed: false,
    cursorChanged: false,
    provenOrderingIssue: provenOrderingIssue,
    conclusion: provenOrderingIssue
      ? 'SEVEN_EXCEPTIONS_ARE_LINE_NUMBER_SORT_ARTIFACTS'
      : 'LINE_ORDERING_CAUSE_NOT_FULLY_PROVEN'
  };

  console.log(JSON.stringify(result, null, 2));
  console.log(
    '[DEPOSIT LINE ORDER AUDIT] | ' + result.conclusion +
    ' | sourceIndex=' + cursor +
    ' | compared=' + parentLineArraysCompared +
    ' | sheetOrderExact=' + sheetOrderExactMatches +
    ' | sortedOrderExact=' + sortedOrderExactMatches +
    ' | exceptions=' + exceptions.length
  );

  return result;
}

function qboDepositLineOrderAuditReadSheet_(sheet) {
  const lastRow = sheet.getLastRow();
  const lastColumn = sheet.getLastColumn();
  if (lastRow < 1 || lastColumn < 1) {
    return {headers: [], index: Object.create(null), rows: []};
  }
  const values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  const headers = values[0].map(function(value) {
    return String(value || '').trim();
  });
  return {
    headers: headers,
    index: buildQboStateCaptureWriteHeaderIndex_(headers),
    rows: values.slice(1)
  };
}

function qboDepositLineOrderAuditRequireHeaders_(index, required, sheetName) {
  required.forEach(function(name) {
    if (index[name] === undefined) {
      throw new Error(
        'DEPOSIT_LINE_ORDER_AUDIT_SOURCE_SCHEMA_MISSING ' +
        name + ' sheet=' + sheetName
      );
    }
  });
}

function qboDepositLineOrderAuditText_(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}
