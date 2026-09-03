/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 21_ExportFramework.js
 * Purpose     : Reusable export orchestration and table-writing framework for QBO entity exporters.
 *
 * Internal Helpers:
 *   - writeExport_()
 *   - logExportEvent_()
 *   - withExportWriteLock_()
 *   - writeExportUnlocked_()
 *   - registerQboExporterSheetCompletion_()
 *   - validateExportConfig_()
 *   - validateExportTableStructure_()
 *   - formatExportHeader_()
 *   - applyExportFilter_()
 *   - resizeExportColumns_()
 *   - applyExportColumnWidths_()
 *   - applyExportNumberFormats_()
 *
 * Dependencies:
 *   - Other Application 50 modules as referenced by function calls
 *   - Google Apps Script services used by this module
 *
 * Current Owner:
 *   - 50 QBO Import Hub
 *
 * Future Ownership:
 *   - Generic helpers may be evaluated for Application 40 only after demonstrated reuse; QBO-specific behavior remains in Application 50.
 *
 * Change History:
 *   - 2026-09-03: Final cleanup removed the obsolete temporary
 *     testWriteExport() harness from the production export framework.
 *   - 2026-09-01: Standardized exporter-level completion across single- and
 *     multi-sheet exports. A workbook snapshot is now created only after every
 *     manifest-owned sheet has successfully written in the current execution;
 *     completion is tracked centrally rather than inferred from whichever
 *     sheet happens to be listed last in the manifest.
 *   - 2026-09-01: Added post-write snapshot creation after the final owned
 *     sheet of each exporter succeeds. Snapshot creation runs while the export
 *     write lock is still held so the copied workbook represents the completed
 *     exporter state without a concurrent write race.
 *   - 2026-09-01: Added pre-write structural integrity validation for export
 *     tables. Headers must be non-empty and unique, every row must be a dense
 *     array with exactly the header width, and unsupported nested cell values
 *     are rejected before workbook mutation. No export schema changed.
 *   - 2026-08-31: Standardized safe sheet replacement. Export writes now
 *     prepare the existing target without clearing it, write replacement data
 *     and headers first, then clear stale trailing content only after the new
 *     table and formatting succeed. Sheet identity/name are preserved.
 *   - 2026-08-31: Standardized table-export lifecycle logging in writeExport_()
 *     with START, COMPLETE, and ERROR events including export ID, sheet name,
 *     row/column counts, and elapsed time. No export schema or write behavior
 *     changed.
 *   - 2026-08-27: Added per-step workbook-write performance diagnostics for timeout analysis. No export schema changed.
 *   - 2026-08-27: Added shared ScriptLock protection around workbook-write
 *     operations. Overlapping trigger/manual exports may retrieve QBO data in
 *     parallel, but workbook mutation is serialized through writeExport_().
 *   - 2026-08-23: Removed per-column wrapping from the export framework. Data
 *     rows are now clipped/no-wrap centrally by writeRows_().
 *   - 2026-07-21: Added standardized module documentation. No runtime behavior
 *     changed.
 * ============================================================================
 */


/***********************
 * 21_ExportFramework.gs
 * Shared QBO export-writing framework
 ***********************/

/**
 * Per-execution exporter completion state.
 *
 * This state intentionally lives only in memory. It is not stored in Script
 * Properties because a sheet written by a prior or failed Apps Script
 * execution must never satisfy completion for a later run.
 */
const QBO_EXPORTER_COMPLETION_STATE_ = Object.create(null);

/**
 * Writes a complete export to a Google Sheet.
 *
 * Expected config:
 * {
 *   sheetName: 'QBO_Items',
 *   headers: ['Id', 'Name'],
 *   rows: [[1, 'Example']],
 *   freezeRows: 1,
 *   filter: true,
 *   autoResize: true,
 *   columnWidths: {
 *     1: 120,
 *     2: 300
 *   },
 *   maxColumnWidth: 300,
 *   logMessage: 'Exported 25 QBO items.'
 * }
 */
function writeExport_(config) {
  const exportId = Utilities.getUuid();
  const startedAt = Date.now();

  try {
    validateExportConfig_(config);

    const metadata = {
      exportId: exportId,
      sheetName: config.sheetName,
      rowCount: (config.rows || []).length,
      columnCount: config.headers.length
    };

    logExportEvent_('START', metadata);

    const sheet = withExportWriteLock_(
      config.sheetName,
      function() {
        const writtenSheet = writeExportUnlocked_(config);

        registerQboExporterSheetCompletion_(config.sheetName);

        return writtenSheet;
      }
    );

    logExportEvent_('COMPLETE', {
      exportId: metadata.exportId,
      sheetName: metadata.sheetName,
      rowCount: metadata.rowCount,
      columnCount: metadata.columnCount,
      durationMs: Date.now() - startedAt
    });

    return sheet;
  } catch (error) {
    logExportEvent_('ERROR', {
      exportId: exportId,
      sheetName:
        config && config.sheetName
          ? config.sheetName
          : '(unknown)',
      rowCount:
        config && Array.isArray(config.rows)
          ? config.rows.length
          : '',
      columnCount:
        config && Array.isArray(config.headers)
          ? config.headers.length
          : '',
      durationMs: Date.now() - startedAt,
      errorMessage:
        error && error.message
          ? error.message
          : String(error)
    });

    throw error;
  }
}


/**
 * Records one successfully written manifest-owned sheet and completes the
 * exporter only after every sheet owned by that manifest entry has succeeded
 * in this same Apps Script execution.
 *
 * The snapshot is created while writeExport_() still holds the shared write
 * lock. This preserves the existing no-concurrent-write guarantee while
 * removing the fragile assumption that writing the manifest's last-listed
 * sheet alone proves the exporter completed successfully.
 *
 * Unregistered sheets are ignored here. Production export sheets cannot reach
 * this point unregistered because destination resolution is manifest-driven,
 * but this keeps generic framework tests such as TEST_ExportFramework usable.
 *
 * @param {string} sheetName Successfully written sheet name.
 * @return {Object|null} Completion metadata, or null when exporter is pending
 *   or the sheet is not registered.
 */
function registerQboExporterSheetCompletion_(sheetName) {
  const entry = getQboExportManifestEntryForSheet_(sheetName);

  if (!entry) {
    return null;
  }

  let state = QBO_EXPORTER_COMPLETION_STATE_[entry.key];

  if (!state) {
    state = {
      completedSheets: Object.create(null),
      firstCompletedAt: Date.now()
    };
    QBO_EXPORTER_COMPLETION_STATE_[entry.key] = state;
  }

  state.completedSheets[sheetName] = true;

  const completedSheetNames = entry.sheetNames.filter(function(ownedSheetName) {
    return Boolean(state.completedSheets[ownedSheetName]);
  });

  safeLog_(
    '[EXPORTER] | SHEET COMPLETE | export=' + entry.key +
    ' | sheet=' + sheetName +
    ' | completed=' + completedSheetNames.length + '/' + entry.sheetNames.length
  );

  const missingSheetNames = entry.sheetNames.filter(function(ownedSheetName) {
    return !state.completedSheets[ownedSheetName];
  });

  if (missingSheetNames.length > 0) {
    return {
      exportKey: entry.key,
      complete: false,
      completedSheets: completedSheetNames.slice(),
      missingSheets: missingSheetNames.slice()
    };
  }

  const snapshot = createQboExportSnapshot_(entry.key);
  const durationMs = Date.now() - state.firstCompletedAt;

  safeLog_(
    '[EXPORTER] | COMPLETE | export=' + entry.key +
    ' | sheets=' + entry.sheetNames.length +
    ' | durationMs=' + durationMs
  );

  delete QBO_EXPORTER_COMPLETION_STATE_[entry.key];

  return {
    exportKey: entry.key,
    complete: true,
    completedSheets: completedSheetNames.slice(),
    missingSheets: [],
    snapshot: snapshot,
    durationMs: durationMs
  };
}


/**
 * Writes one standardized table-export lifecycle event.
 *
 * These events provide a stable operational layer above the more detailed
 * [PERF] diagnostics. They intentionally describe one writeExport_() table
 * write, not an entire multi-sheet entity export.
 */
function logExportEvent_(status, metadata) {
  const parts = [
    '[EXPORT]',
    status,
    `id=${metadata.exportId || ''}`,
    `sheet=${metadata.sheetName || ''}`,
    `rows=${metadata.rowCount === '' ? '' : metadata.rowCount}`,
    `columns=${metadata.columnCount === '' ? '' : metadata.columnCount}`
  ];

  if (metadata.durationMs !== undefined) {
    parts.push(`durationMs=${metadata.durationMs}`);
  }

  if (metadata.errorMessage) {
    parts.push(`error=${metadata.errorMessage}`);
  }

  safeLog_(parts.join(' | '));
}


/**
 * Serializes mutation of the configured export workbook.
 *
 * The lock is scoped only to the write/format phase. QBO retrieval and row
 * construction occur before writeExport_() is called, so separate scheduled
 * exports do not spend their API-read time blocking one another.
 *
 * If another execution is still writing after the configured wait period,
 * this execution fails clearly rather than allowing concurrent workbook
 * mutation. Its next scheduled run or a manual rerun can then retry safely.
 */
function withExportWriteLock_(sheetName, callback) {
  if (typeof callback !== 'function') {
    throw new Error(
      'withExportWriteLock_ requires a callback function.'
    );
  }

  const lock = LockService.getScriptLock();
  const waitMs = EXPORT_EXECUTION.WRITE_LOCK_WAIT_MS;
  const acquired = lock.tryLock(waitMs);

  if (!acquired) {
    throw new Error(
      'Unable to acquire QBO export workbook write lock within ' +
      waitMs + ' ms for sheet ' + sheetName + '. ' +
      'Another export is currently writing. Retry this export after the ' +
      'other execution finishes.'
    );
  }

  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}


/**
 * Performs the actual sheet mutation after writeExport_() has acquired the
 * shared workbook-write lock.
 */
function writeExportUnlocked_(config) {
  const sheetName = config.sheetName;
  const headers = config.headers;
  const rows = config.rows || [];
  const writeStartedAt = Date.now();
  let stepStartedAt = writeStartedAt;

  function logWriteStep_(stepName) {
    const now = Date.now();
    safeLog_(
      `[PERF] ${sheetName} write ${stepName}: ${now - stepStartedAt} ms.`
    );
    stepStartedAt = now;
  }

  const LARGE_EXPORT_THRESHOLD = 5000;
  const isLargeExport = rows.length > LARGE_EXPORT_THRESHOLD;

  const freezeRows =
    config.freezeRows === undefined
      ? 1
      : config.freezeRows;

  const useFilter =
    config.filter === undefined
      ? true
      : config.filter;

  const autoResize =
    config.autoResize === undefined
      ? rows.length <= LARGE_EXPORT_THRESHOLD
      : config.autoResize;

  const maxColumnWidth =
    config.maxColumnWidth || 300;

  const sheetState = prepareExportSheet_(
    sheetName,
    rows.length,
    headers.length
  );
  const sheet = sheetState.sheet;
  logWriteStep_('sheet prepare');

  writeRows_(sheet, rows);
  logWriteStep_(`writeRows total (${rows.length} rows)`);

  writeExportHeader_(sheet, headers);
  logWriteStep_('header values');

  formatExportHeader_(
    sheet,
    headers,
    freezeRows
  );
  logWriteStep_('header formatting');

  if (useFilter) {
    applyExportFilter_(
      sheet,
      headers.length,
      rows.length
    );
    logWriteStep_('filter');
  }

  if (autoResize && !isLargeExport) {
    resizeExportColumns_(
      sheet,
      headers.length,
      maxColumnWidth
    );
    logWriteStep_('auto resize');
  }

  applyExportColumnWidths_(
    sheet,
    config.columnWidths || {}
  );
  logWriteStep_('configured column widths');

  if (config.numberFormats) {
    applyExportNumberFormats_(
      sheet,
      config.numberFormats,
      rows.length
    );
    logWriteStep_('number formats');
  }

  clearStaleExportContent_(
    sheet,
    sheetState.previousLastRow,
    sheetState.previousLastColumn,
    rows.length,
    headers.length
  );
  logWriteStep_('stale content cleanup');

  safeLog_(
    `[PERF] ${sheetName} write complete: ${rows.length} rows in ` +
    `${Date.now() - writeStartedAt} ms.`
  );

  if (config.logMessage) {
    safeLog_(config.logMessage);
  }

  return sheet;
}

/**
 * Validates required export configuration values.
 */
function validateExportConfig_(config) {
  if (!config || typeof config !== 'object') {
    throw new Error(
      'writeExport_ requires a configuration object.'
    );
  }

  if (
    typeof config.sheetName !== 'string' ||
    !config.sheetName.trim()
  ) {
    throw new Error(
      'writeExport_ requires a non-empty sheetName string.'
    );
  }

  if (
    !Array.isArray(config.headers) ||
    config.headers.length === 0
  ) {
    throw new Error(
      'writeExport_ requires a non-empty headers array.'
    );
  }

  if (
    config.rows !== undefined &&
    !Array.isArray(config.rows)
  ) {
    throw new Error(
      'writeExport_ rows must be an array.'
    );
  }

  validateExportTableStructure_(
    config.headers,
    config.rows || []
  );
}


/**
 * Validates the rectangular table result before any workbook mutation occurs.
 *
 * Exporters are expected to hand the framework a spreadsheet-ready table:
 * - every header is a non-empty string;
 * - header names are unique;
 * - every row is a dense array with exactly the header width; and
 * - cells contain scalar spreadsheet values (or Date/null), not nested
 *   arrays/objects that should have been serialized by the entity exporter.
 *
 * This validation is intentionally structural only. It does not interpret QBO
 * business meaning or impose entity-specific required fields.
 */
function validateExportTableStructure_(headers, rows) {
  const seenHeaders = Object.create(null);

  headers.forEach((header, index) => {
    if (
      typeof header !== 'string' ||
      !header.trim()
    ) {
      throw new Error(
        `Header ${index + 1} must be a non-empty string.`
      );
    }

    if (seenHeaders[header]) {
      throw new Error(
        `Duplicate export header '${header}' at column ${index + 1}.`
      );
    }

    seenHeaders[header] = true;
  });

  const expectedWidth = headers.length;

  rows.forEach((row, rowIndex) => {
    if (!Array.isArray(row)) {
      throw new Error(
        `Row ${rowIndex + 1} is not an array.`
      );
    }

    if (row.length !== expectedWidth) {
      throw new Error(
        `Row ${rowIndex + 1} has ${row.length} values, ` +
        `but ${expectedWidth} headers were supplied.`
      );
    }

    for (let columnIndex = 0; columnIndex < expectedWidth; columnIndex++) {
      if (!Object.prototype.hasOwnProperty.call(row, columnIndex)) {
        throw new Error(
          `Row ${rowIndex + 1}, column ${columnIndex + 1} is missing. ` +
          'Export rows must be dense arrays.'
        );
      }

      const value = row[columnIndex];

      if (value === null || value instanceof Date) {
        continue;
      }

      const valueType = typeof value;

      if (
        valueType !== 'string' &&
        valueType !== 'number' &&
        valueType !== 'boolean' &&
        valueType !== 'undefined'
      ) {
        throw new Error(
          `Row ${rowIndex + 1}, column ${columnIndex + 1} contains an ` +
          'unsupported nested value. Serialize arrays/objects before export.'
        );
      }
    }
  });
}



/**
 * Applies consistent header formatting.
 */
function formatExportHeader_(
  sheet,
  headers,
  freezeRows
) {
  if (freezeRows > 0) {
    sheet.setFrozenRows(freezeRows);
  }

  sheet
    .getRange(1, 1, 1, headers.length)
    .setFontWeight('bold');
}


/**
 * Replaces any existing filter with a fresh one.
 */
function applyExportFilter_(
  sheet,
  columnCount,
  rowCount
) {
  const existingFilter = sheet.getFilter();

  if (existingFilter) {
    existingFilter.remove();
  }

  if (rowCount > 0) {
    sheet
      .getRange(
        1,
        1,
        rowCount + 1,
        columnCount
      )
      .createFilter();
  }
}


/**
 * Auto-resizes columns and enforces a maximum width.
 */
function resizeExportColumns_(
  sheet,
  columnCount,
  maxColumnWidth
) {
  sheet.autoResizeColumns(
    1,
    columnCount
  );

  for (
    let column = 1;
    column <= columnCount;
    column++
  ) {
    const currentWidth =
      sheet.getColumnWidth(column);

    if (currentWidth > maxColumnWidth) {
      sheet.setColumnWidth(
        column,
        maxColumnWidth
      );
    }
  }
}


/**
 * Applies explicit column widths.
 *
 * Example:
 * {
 *   1: 120,
 *   5: 300
 * }
 */
function applyExportColumnWidths_(
  sheet,
  columnWidths
) {
  Object.keys(columnWidths)
    .forEach(columnKey => {
      const column = Number(columnKey);
      const width = Number(
        columnWidths[columnKey]
      );

      if (
        Number.isFinite(column) &&
        Number.isFinite(width)
      ) {
        sheet.setColumnWidth(
          column,
          width
        );
      }
    });
}


/**
 * Applies number formats by column.
 *
 * Example:
 * {
 *   4: '$#,##0.00',
 *   7: 'yyyy-mm-dd'
 * }
 */
function applyExportNumberFormats_(
  sheet,
  numberFormats,
  rowCount
) {
  if (rowCount <= 0) {
    return;
  }

  Object.keys(numberFormats)
    .forEach(columnKey => {
      const column = Number(columnKey);
      const format =
        numberFormats[columnKey];

      if (
        Number.isFinite(column) &&
        format
      ) {
        sheet
          .getRange(
            2,
            column,
            rowCount,
            1
          )
          .setNumberFormat(format);
      }
    });
}
