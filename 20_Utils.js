/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 20_Utils.js
 * Purpose     : Shared spreadsheet, object, serialization, and QBO transaction
 *               helpers used by exporter modules.
 *
 * Responsibilities:
 *   - Create and initialize export sheets.
 *   - Write export rows to Google Sheets.
 *   - Normalize common QBO values and metadata.
 *   - Safely serialize source objects for spreadsheet storage.
 *   - Summarize QBO LinkedTxn collections.
 *
 * Public API:
 *   - None. All functions in this module are internal application helpers.
 *
 * Internal Helpers:
 *   - getExportSpreadsheetId_()
 *   - getExportSpreadsheet_()
 *   - prepareExportSheet_()
 *   - writeExportHeader_()
 *   - clearStaleExportContent_()
 *   - writeRows_()
 *   - applyExportDataLayout_()
 *   - extractMeta_()
 *   - numberOrBlank_()
 *   - jsonStringifySafe_()
 *   - jsonStringifyCellSafe_()
 *   - normalizeArray_()
 *   - summarizeLinkedTransactions_()
 *
 * Dependencies:
 *   - Google Apps Script Spreadsheet service
 *   - safeLog_()
 *   - valueOrBlank_()
 *
 * Used By:
 *   - QBO exporter modules throughout Application 50
 *
 * Current Owner:
 *   - 50 QBO Import Hub
 *
 * Future Ownership:
 *   - Generic primitives may be evaluated for Application 40 only after
 *     demonstrated reuse by another application. QBO-specific helpers remain
 *     owned by Application 50.
 *
 * Change History:
 *   - 2026-09-01: Enforced manifest-driven independent workbook resolution.
 *     Each export must have its own configured destination property; the
 *     legacy shared-workbook fallback has been retired.
 *   - 2026-09-01: Added manifest-driven destination workbook resolution.
 *     Each export may target its own configured workbook.
 *   - 2026-08-31: Replaced destructive pre-write sheet clearing with a
 *     non-destructive prepare/write/cleanup sequence. Existing export content
 *     remains in place until replacement rows and headers have been written;
 *     stale trailing content is cleared only after the new table is complete.
 *   - 2026-08-27: Centralized CLIP/no-wrap and standard row-height behavior
 *     behind applyExportDataLayout_() using the shared EXPORT_LAYOUT policy.
 *   - 2026-08-27: Centralized export workbook resolution behind
 *     getExportSpreadsheetId_() / getExportSpreadsheet_(); exporter modules
 *     contain no direct workbook-open logic.
 *   - 2026-08-27: Standalone refactor now resolves the export workbook from the
 *     QBO_EXPORT_SPREADSHEET_ID Script Property instead of relying on an active
 *     container-bound spreadsheet.
 *   - 2026-08-23: Limited export clearing to the populated range instead of
 *     clearing the entire allocated sheet grid. Standardized export data rows
 *     to clipped/no-wrap display with fixed single-line row height.
 *   - 2026-07-21: Moved normalizeArray_() from 41_QBO_Payments.js into this
 *     shared utility module. Added standardized module documentation.
 * ============================================================================
 */


// =============================================================================
// Spreadsheet helpers
// =============================================================================

/**
 * Resolves and validates the configured independent destination workbook ID
 * for one export sheet. Every registered export requires its own configured
 * workbook property; no shared-workbook fallback is permitted.
 */
function getExportSpreadsheetId_(sheetName) {
  const manifestEntry = getQboExportManifestEntryForSheet_(sheetName);

  if (!manifestEntry) {
    throw new Error(
      'Export sheet ' + String(sheetName || '') +
      ' is not registered in QBO_EXPORT_MANIFEST. Register the sheet before ' +
      'attempting to resolve its destination workbook.'
    );
  }

  const props = PropertiesService.getScriptProperties();
  const destinationPropertyKey = manifestEntry.workbookPropertyKey;
  const destinationId = String(
    props.getProperty(destinationPropertyKey) || ''
  ).trim();

  if (!destinationId) {
    throw new Error(
      'Missing independent destination workbook configuration for export ' +
      manifestEntry.key + '. Set Script Property ' + destinationPropertyKey +
      ' to the workbook ID before running this export.'
    );
  }

  return destinationId;
}


/**
 * Opens the configured independent destination workbook for one export sheet.
 *
 * All Application 50 workbook access flows through this helper. Exporters do
 * not contain spreadsheet IDs and do not open destination workbooks directly.
 */
function getExportSpreadsheet_(sheetName) {
  const manifestEntry = getQboExportManifestEntryForSheet_(sheetName);

  if (!manifestEntry) {
    throw new Error(
      'Export sheet ' + String(sheetName || '') +
      ' is not registered in QBO_EXPORT_MANIFEST.'
    );
  }

  const spreadsheetId = getExportSpreadsheetId_(sheetName);

  try {
    return SpreadsheetApp.openById(spreadsheetId);
  } catch (error) {
    throw new Error(
      'Unable to open QBO export spreadsheet for ' +
      manifestEntry.key + ' using ' + manifestEntry.workbookPropertyKey + '=' +
      spreadsheetId + '. Verify the spreadsheet ID and this script ' +
      'account\'s access. Original error: ' + error.message
    );
  }
}



/**
 * Prepares the target export sheet without clearing existing content.
 *
 * The previous populated dimensions are captured so stale trailing content can
 * be removed only after the replacement export has been written successfully.
 * This avoids destroying the last successful export before the new data write.
 *
 * @param {string} sheetName Target sheet name.
 * @param {number} rowCount Number of replacement data rows.
 * @param {number} columnCount Number of replacement columns.
 * @return {Object} Sheet plus previous populated dimensions.
 */
function prepareExportSheet_(sheetName, rowCount, columnCount) {
  const spreadsheet = getExportSpreadsheet_(sheetName);

  const sheet =
    spreadsheet.getSheetByName(sheetName) ||
    spreadsheet.insertSheet(sheetName);

  const previousLastRow = sheet.getLastRow();
  const previousLastColumn = sheet.getLastColumn();
  const requiredRows = Math.max(1, Number(rowCount || 0) + 1);
  const requiredColumns = Math.max(1, Number(columnCount || 0));

  if (sheet.getMaxRows() < requiredRows) {
    sheet.insertRowsAfter(
      sheet.getMaxRows(),
      requiredRows - sheet.getMaxRows()
    );
  }

  if (sheet.getMaxColumns() < requiredColumns) {
    sheet.insertColumnsAfter(
      sheet.getMaxColumns(),
      requiredColumns - sheet.getMaxColumns()
    );
  }

  return {
    sheet: sheet,
    previousLastRow: previousLastRow,
    previousLastColumn: previousLastColumn
  };
}


/**
 * Writes the replacement header row after replacement data rows have succeeded.
 */
function writeExportHeader_(sheet, headers) {
  sheet
    .getRange(1, 1, 1, headers.length)
    .setValues([headers]);
}


/**
 * Clears content that belonged to the prior export but falls outside the new
 * table dimensions. This runs only after the new rows, header, and formatting
 * have completed successfully.
 */
function clearStaleExportContent_(
  sheet,
  previousLastRow,
  previousLastColumn,
  rowCount,
  columnCount
) {
  const newLastRow = Number(rowCount || 0) + 1;
  const newLastColumn = Number(columnCount || 0);

  if (previousLastRow > newLastRow && previousLastColumn > 0) {
    sheet
      .getRange(
        newLastRow + 1,
        1,
        previousLastRow - newLastRow,
        Math.max(previousLastColumn, newLastColumn)
      )
      .clearContent();
  }

  if (previousLastColumn > newLastColumn && previousLastRow > 0) {
    sheet
      .getRange(
        1,
        newLastColumn + 1,
        previousLastRow,
        previousLastColumn - newLastColumn
      )
      .clearContent();
  }
}


/**
 * Writes rows beginning on row 2.
 *
 * QBO export tables use a compact, single-line data layout. Text is clipped
 * rather than wrapped so long JSON/description values do not expand row
 * heights and make the export difficult to scan.
 */
function writeRows_(sheet, rows) {
  if (!rows || rows.length === 0) {
    return;
  }

  const dataRange = sheet.getRange(
    2,
    1,
    rows.length,
    rows[0].length
  );

  const sheetName = sheet.getName();

  let perfStartedAt = Date.now();
  dataRange.setValues(rows);
  safeLog_(
    `[PERF] ${sheetName} write setValues (${rows.length} rows): ` +
    `${Date.now() - perfStartedAt} ms.`
  );

  applyExportDataLayout_(sheet, dataRange, rows.length);
}


/**
 * Applies the shared compact display policy to exported data rows.
 *
 * Keeping wrapping and standard row height here prevents entity exporters from
 * drifting into different presentation behavior. It also normalizes heights
 * that may remain from older exports that previously wrapped long values.
 */
function applyExportDataLayout_(sheet, dataRange, rowCount) {
  if (!sheet || !dataRange || rowCount <= 0) {
    return;
  }

  const sheetName = sheet.getName();

  let perfStartedAt = Date.now();
  dataRange.setWrapStrategy(
    EXPORT_LAYOUT.DATA_WRAP_STRATEGY
  );
  safeLog_(
    `[PERF] ${sheetName} write CLIP wrap strategy (${rowCount} rows): ` +
    `${Date.now() - perfStartedAt} ms.`
  );

  // Force the compact height even when cells contain embedded line breaks.
  // setRowHeights() allows rows to grow to fit content; the forced variant
  // is required to guarantee the single-line export layout.
  perfStartedAt = Date.now();
  sheet.setRowHeightsForced(
    2,
    rowCount,
    EXPORT_LAYOUT.DATA_ROW_HEIGHT
  );
  safeLog_(
    `[PERF] ${sheetName} write forced row heights (${rowCount} rows): ` +
    `${Date.now() - perfStartedAt} ms.`
  );
}


/**
 * Extracts standard QBO metadata timestamps.
 */
function extractMeta_(object) {
  const metadata =
    object?.MetaData ||
    object?.metaData ||
    {};

  return {
    createTime:
      metadata.CreateTime ||
      metadata.createTime ||
      '',

    lastUpdatedTime:
      metadata.LastUpdatedTime ||
      metadata.lastUpdatedTime ||
      ''
  };
}


/**
 * Converts a value to a finite number.
 * Returns a blank when the value is missing or invalid.
 */
function numberOrBlank_(value) {
  if (
    value === '' ||
    value === null ||
    value === undefined
  ) {
    return '';
  }

  const number = Number(value);

  return Number.isFinite(number)
    ? number
    : '';
}


/**
 * Safely converts an object or array to JSON text.
 */
function jsonStringifySafe_(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return '';
  }

  try {
    return JSON.stringify(value);
  } catch (error) {
    safeLog_(
      'Unable to stringify JSON: ' +
      error.message
    );

    return '';
  }
}

/**
 * Converts a value to JSON that is safe for a Google Sheets cell.
 *
 * Google Sheets allows a maximum of 50,000 characters per cell.
 * Oversized JSON is truncated and clearly marked.
 *
 * @param {*} value Value to serialize.
 * @param {number=} maxLength Optional maximum length.
 * @return {string} Cell-safe JSON string.
 */
function jsonStringifyCellSafe_(
  value,
  maxLength
) {

  const limit =
    Number.isFinite(Number(maxLength))
      ? Number(maxLength)
      : 49000;

  const json =
    jsonStringifySafe_(value);

  if (
    typeof json !== 'string' ||
    json.length <= limit
  ) {
    return json;
  }

  const marker =
    `...[TRUNCATED: original length ${json.length}]`;

  return json.substring(
    0,
    Math.max(0, limit - marker.length)
  ) + marker;
}


// =============================================================================
// Collection normalization
// =============================================================================

/**
 * Normalizes a value into an array.
 *
 * Handles:
 * - missing values
 * - a single object
 * - an existing array
 *
 * @param {*} value Source value.
 * @return {Array} Normalized array.
 */
function normalizeArray_(value) {

  if (
    value === undefined ||
    value === null
  ) {
    return [];
  }

  return Array.isArray(value)
    ? value
    : [value];
}


// =============================================================================
// QBO linked-transaction helpers
// =============================================================================

/**
 * Summarizes a QBO LinkedTxn collection into
 * standardized transaction-type counts and ID lists.
 *
 * This helper is intended for reuse across all
 * QBO transaction exporters.
 *
 * @param {*} linkedTxn QBO LinkedTxn value.
 * @return {Object} Standardized linked-transaction summary.
 */
function summarizeLinkedTransactions_(linkedTxn) {

  const linkedTransactions =
    normalizeArray_(linkedTxn);

  const transactionIds = {
    Invoice: [],
    Payment: [],
    SalesReceipt: [],
    Estimate: [],
    CreditMemo: [],
    Deposit: [],
    Bill: [],
    JournalEntry: [],
    Purchase: []
  };

  const otherTransactions = [];

  linkedTransactions.forEach(
    transaction => {

      const transactionId =
        valueOrBlank_(
          transaction.TxnId
        );

      const transactionType =
        valueOrBlank_(
          transaction.TxnType
        );

      if (
        Object.prototype.hasOwnProperty.call(
          transactionIds,
          transactionType
        )
      ) {

        if (
          transactionId !== '' &&
          !transactionIds[
            transactionType
          ].includes(transactionId)
        ) {
          transactionIds[
            transactionType
          ].push(transactionId);
        }

      } else {

        otherTransactions.push(
          transaction
        );
      }
    }
  );

  return {
    totalCount:
      linkedTransactions.length,

    invoiceCount:
      transactionIds.Invoice.length,

    invoiceIds:
      transactionIds.Invoice.join(', '),

    paymentCount:
      transactionIds.Payment.length,

    paymentIds:
      transactionIds.Payment.join(', '),

    salesReceiptCount:
      transactionIds.SalesReceipt.length,

    salesReceiptIds:
      transactionIds.SalesReceipt.join(', '),

    estimateCount:
      transactionIds.Estimate.length,

    estimateIds:
      transactionIds.Estimate.join(', '),

    creditMemoCount:
      transactionIds.CreditMemo.length,

    creditMemoIds:
      transactionIds.CreditMemo.join(', '),

    depositCount:
      transactionIds.Deposit.length,

    depositIds:
      transactionIds.Deposit.join(', '),

    billCount:
      transactionIds.Bill.length,

    billIds:
      transactionIds.Bill.join(', '),

    journalEntryCount:
      transactionIds.JournalEntry.length,

    journalEntryIds:
      transactionIds.JournalEntry.join(', '),

    purchaseCount:
      transactionIds.Purchase.length,

    purchaseIds:
      transactionIds.Purchase.join(', '),

    otherCount:
      otherTransactions.length,

    otherTransactions:
      otherTransactions
  };
}
