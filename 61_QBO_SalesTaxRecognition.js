/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 61_QBO_SalesTaxRecognition.js
 * Purpose     : Permanent sales-tax recognition evidence derived from the
 *               governed, captured General Ledger dataset.
 *
 * Architecture:
 *   - DOES NOT call reports/GeneralLedger directly.
 *   - Reads the existing QBO General Ledger report workbook produced by
 *     52_QBO_GeneralLedgerReport.js.
 *   - Carries the source GL ExtractRunId / ExtractedAt / report period into
 *     every derived row and snapshot so downstream Level 2 work can distinguish
 *     GL source freshness from a real-time TaxableSalesDetail API pull.
 *   - Stores rebuildable Current data plus immutable recognition snapshots and
 *     row-level change records.
 *   - Does not modify or participate in the GL exporter/backfill chain.
 *
 * IMPORTANT SOURCE-POPULATION NOTE:
 *   Diagnostics proved that all authoritative Sales-by-Tax-Name rows exist in
 *   raw Cash GL, including four rows outside the original Income/Other Income
 *   candidate rule. A safe permanent exact-inclusion predicate for every GL
 *   row has not yet been independently proven. Therefore this module preserves
 *   the broader eligible GL evidence population (allowed sales transaction
 *   types, nonzero data rows, excluding Undeposited Funds and sales-tax-payable
 *   accounts) and labels it as supporting recognition evidence. Downstream code
 *   must not treat it as an exact Sales-by-Tax-Name clone until that predicate
 *   is separately validated and promoted.
 *
 * Script Property:
 *   QBO_SALES_TAX_RECOGNITION_DATA_SPREADSHEET_ID
 * ============================================================================ */

const QBO_SALES_TAX_RECOGNITION = Object.freeze({
  PROPERTY_KEY: 'QBO_SALES_TAX_RECOGNITION_DATA_SPREADSHEET_ID',
  WORKBOOK_TITLE: 'QBO_Sales_Tax_Recognition_Data',
  CONTROL_SHEET: '00_Controls',
  CURRENT_SHEET: '01_Current',
  SNAPSHOT_SHEET: '02_Recognition_Snapshots',
  CHANGES_SHEET: '03_Snapshot_Changes',
  LOG_SHEET: '90_Ingestion_Log',
  ROW_HASH_VERSION: '1',
  DATA_FOLDER_ASSET_KEY: 'QBO_DATA_EXCHANGE_CURRENT_FOLDER',
  DATA_FOLDER_PATH: 'Data Platform/Data Exchange/QuickBooks/Current',
  ALLOWED_TYPES: Object.freeze(['Invoice', 'Sales Receipt', 'Credit Memo', 'Refund'])
});

const QBO_STR_HEADERS = Object.freeze([
  'Period_Key',
  'Snapshot_Sequence',
  'Snapshot_Run_ID',
  'Derived_At',
  'Source_GL_Workbook_ID',
  'Source_GL_Extract_Run_ID',
  'Source_GL_Extracted_At',
  'Source_GL_Report_Start_Date',
  'Source_GL_Report_End_Date',
  'Recognition_Date',
  'Transaction_Type',
  'Transaction_ID',
  'Num',
  'Customer',
  'Distribution_Account',
  'Account_ID',
  'Amount',
  'Memo_Description',
  'Split_Account',
  'Split_ID',
  'Evidence_Role',
  'Row_Key',
  'Row_Hash',
  'Source_GL_Row_JSON'
]);

const QBO_STR_CHANGE_HEADERS = Object.freeze([
  'Period_Key',
  'Prior_Snapshot',
  'New_Snapshot',
  'Snapshot_Run_ID',
  'Detected_At',
  'Change_Type',
  'Row_Key',
  'Old_Row_Hash',
  'New_Row_Hash'
]);

const QBO_STR_LOG_HEADERS = Object.freeze([
  'Snapshot_Run_ID',
  'Derived_At',
  'Period_Key',
  'Period_Start',
  'Period_End',
  'Source_GL_Workbook_ID',
  'Source_GL_Extract_Run_ID',
  'Source_GL_Extracted_At',
  'Status',
  'Row_Count',
  'Change_Count',
  'Error'
]);

function provisionQboSalesTaxRecognitionDataWorkbook() {
  const props = PropertiesService.getScriptProperties();
  const targetFolder = qboStrResolveGovernedDataFolder_();
  let id = String(
    props.getProperty(QBO_SALES_TAX_RECOGNITION.PROPERTY_KEY) || ''
  ).trim();
  let ss = null;
  let status = 'READY';
  let supersededSpreadsheetId = '';

  if (id) {
    ss = SpreadsheetApp.openById(id);
    qboStrEnsureWorkbook_(ss);
    const file = DriveApp.getFileById(id);
    if (!qboStrFileIsInFolder_(file, targetFolder.getId())) {
      if (qboStrWorkbookHasCapturedData_(ss)) {
        throw new Error(
          'Configured Sales Tax Recognition workbook ' + id +
          ' is outside ' + QBO_SALES_TAX_RECOGNITION.DATA_FOLDER_PATH +
          ' and already contains captured data. Automatic migration is blocked.'
        );
      }
      supersededSpreadsheetId = id;
      ss = qboStrCreateWorkbookInFolder_(targetFolder);
      id = ss.getId();
      props.setProperty(QBO_SALES_TAX_RECOGNITION.PROPERTY_KEY, id);
      status = 'REPROVISIONED_IN_GOVERNED_DATA_FOLDER';
    }
  } else {
    ss = qboStrCreateWorkbookInFolder_(targetFolder);
    id = ss.getId();
    props.setProperty(QBO_SALES_TAX_RECOGNITION.PROPERTY_KEY, id);
    status = 'CREATED_IN_GOVERNED_DATA_FOLDER';
  }

  qboStrEnsureWorkbook_(ss);
  return {
    spreadsheetId: id,
    spreadsheetUrl: ss.getUrl(),
    status: status,
    governedFolderId: targetFolder.getId(),
    governedPath: QBO_SALES_TAX_RECOGNITION.DATA_FOLDER_PATH,
    supersededSpreadsheetId: supersededSpreadsheetId
  };
}

function qboStrCreateWorkbookInFolder_(targetFolder) {
  const ss = SpreadsheetApp.create(QBO_SALES_TAX_RECOGNITION.WORKBOOK_TITLE);
  DriveApp.getFileById(ss.getId()).moveTo(targetFolder);
  return ss;
}

function qboStrResolveGovernedDataFolder_() {
  if (typeof DataPlatform05 === 'undefined' ||
      typeof DataPlatform05.getConfiguredAssetReference !== 'function') {
    throw new Error(
      'Application 05 library DataPlatform05 is unavailable. Cannot resolve governed asset ' +
      QBO_SALES_TAX_RECOGNITION.DATA_FOLDER_ASSET_KEY + '.'
    );
  }
  const asset = DataPlatform05.getConfiguredAssetReference(
    QBO_SALES_TAX_RECOGNITION.DATA_FOLDER_ASSET_KEY,
    'Folder',
    'PROD'
  );
  const folderId = asset && String(asset.ResourceIdentifier || '').trim();
  if (!folderId) {
    throw new Error(
      'Application 05 returned no ResourceIdentifier for governed asset ' +
      QBO_SALES_TAX_RECOGNITION.DATA_FOLDER_ASSET_KEY + '.'
    );
  }
  try {
    return DriveApp.getFolderById(folderId);
  } catch (err) {
    throw new Error(
      'Unable to open governed folder asset ' +
      QBO_SALES_TAX_RECOGNITION.DATA_FOLDER_ASSET_KEY + ' (' + folderId + '): ' +
      (err && err.message ? err.message : err)
    );
  }
}

function qboStrFileIsInFolder_(file, folderId) {
  const parents = file.getParents();
  while (parents.hasNext()) {
    if (String(parents.next().getId()) === String(folderId)) return true;
  }
  return false;
}

function qboStrWorkbookHasCapturedData_(ss) {
  return [
    QBO_SALES_TAX_RECOGNITION.CURRENT_SHEET,
    QBO_SALES_TAX_RECOGNITION.SNAPSHOT_SHEET,
    QBO_SALES_TAX_RECOGNITION.CHANGES_SHEET,
    QBO_SALES_TAX_RECOGNITION.LOG_SHEET
  ].some(function(name) {
    const sheet = ss.getSheetByName(name);
    return sheet && sheet.getLastRow() > 1;
  });
}

function exportQboSalesTaxRecognition() {
  const ss = qboStrGetWorkbook_();
  qboStrEnsureWorkbook_(ss);
  const monthKey = qboStrReadControlValue_(ss, 'REPORT_MONTH');
  if (!/^\d{4}-\d{2}$/.test(String(monthKey || '').trim())) {
    throw new Error(
      '00_Controls REPORT_MONTH must be set to YYYY-MM before running exportQboSalesTaxRecognition().'
    );
  }
  return exportQboSalesTaxRecognitionForMonth(String(monthKey).trim());
}

function exportQboSalesTaxRecognitionForMonth(monthKey) {
  const period = qboStrResolveMonth_(monthKey);
  return exportQboSalesTaxRecognitionForPeriod(
    period.startDate,
    period.endDate
  );
}

function exportQboSalesTaxRecognitionForPeriod(startDate, endDate) {
  qboStrValidatePeriod_(startDate, endDate);

  const periodKey = startDate.slice(0, 7).replace('-', '');
  const runId = Utilities.getUuid();
  const derivedAt = new Date();
  const outputSs = qboStrGetWorkbook_();
  qboStrEnsureWorkbook_(outputSs);

  const source = qboStrReadCapturedGlPeriod_(startDate, endDate);

  safeLog_(
    '[SALES TAX RECOGNITION] | START | run=' + runId +
    ' | period=' + startDate + '..' + endDate +
    ' | sourceGlRun=' + source.extractRunId +
    ' | sourceGlExtractedAt=' + source.extractedAt
  );

  const eligible = qboStrAssignOccurrences_(
    source.rows.filter(qboStrIsEligibleEvidenceRow_)
  );

  const currentRows = eligible.map(function(row) {
    const base = [
      periodKey,
      '',
      '',
      derivedAt,
      source.spreadsheetId,
      source.extractRunId,
      source.extractedAt,
      source.reportStartDate,
      source.reportEndDate,
      row.recognitionDate,
      row.transactionType,
      row.transactionId,
      row.num,
      row.customer,
      qboStrTerminalAccount_(row.distributionAccount),
      row.accountId,
      row.amount,
      row.memo,
      row.splitAccount,
      row.splitId,
      'GL_SUPPORTING_RECOGNITION_EVIDENCE'
    ];

    const rowKey = qboStrKey_(base, row.occurrence);
    const rawJson = row.rawRowJson || '';
    const rowHash = qboStrStateHash_(base, rawJson);
    return base.concat([rowKey, rowHash, rawJson]);
  });

  let result;
  withExportWriteLock_(
    QBO_SALES_TAX_RECOGNITION.CURRENT_SHEET,
    outputSs.getId(),
    function() {
      const seq = qboStrNextSeq_(outputSs, periodKey);
      const previous = qboStrLatest_(outputSs, periodKey);
      const snapshotRows = currentRows.map(function(row) {
        const copy = row.slice();
        copy[1] = seq;
        copy[2] = runId;
        return copy;
      });

      qboStrReplaceCurrent_(outputSs, periodKey, currentRows);
      qboStrAppend_(
        outputSs.getSheetByName(QBO_SALES_TAX_RECOGNITION.SNAPSHOT_SHEET),
        QBO_STR_HEADERS,
        snapshotRows
      );

      const changes = qboStrChanges_(
        periodKey,
        previous.sequence,
        seq,
        runId,
        derivedAt,
        previous.rows,
        snapshotRows
      );

      qboStrAppend_(
        outputSs.getSheetByName(QBO_SALES_TAX_RECOGNITION.CHANGES_SHEET),
        QBO_STR_CHANGE_HEADERS,
        changes
      );

      qboStrWriteControls_(
        outputSs,
        periodKey,
        seq,
        runId,
        derivedAt,
        source,
        snapshotRows.length,
        changes.length
      );

      qboStrAppend_(
        outputSs.getSheetByName(QBO_SALES_TAX_RECOGNITION.LOG_SHEET),
        QBO_STR_LOG_HEADERS,
        [[
          runId,
          derivedAt,
          periodKey,
          startDate,
          endDate,
          source.spreadsheetId,
          source.extractRunId,
          source.extractedAt,
          'SUCCESS',
          snapshotRows.length,
          changes.length,
          ''
        ]]
      );

      result = {
        spreadsheetId: outputSs.getId(),
        spreadsheetUrl: outputSs.getUrl(),
        periodKey: periodKey,
        snapshotSequence: seq,
        rowCount: snapshotRows.length,
        changeCount: changes.length,
        runId: runId,
        sourceGlWorkbookId: source.spreadsheetId,
        sourceGlExtractRunId: source.extractRunId,
        sourceGlExtractedAt: source.extractedAt
      };
    }
  );

  safeLog_('[SALES TAX RECOGNITION] | COMPLETE | ' + JSON.stringify(result));
  return result;
}

/**
 * Reads exactly one captured GL reporting period from the existing governed
 * General Ledger workbook. This function never refreshes QBO.
 */
function qboStrReadCapturedGlPeriod_(startDate, endDate) {
  const ss = getQboGeneralLedgerReportSpreadsheet_();
  const sheet = ss.getSheetByName(QBO_GENERAL_LEDGER_REPORT.DATA_SHEET);
  if (!sheet || sheet.getLastRow() < 2) {
    throw new Error('Captured General Ledger dataset is empty.');
  }

  const values = sheet.getDataRange().getValues();
  const headers = values[0].map(function(value) {
    return String(value || '').trim();
  });
  const idx = qboStrHeaderIndex_(headers, [
    'ExtractRunId',
    'ExtractedAt',
    'ReportBasis',
    'ReportStartDate',
    'ReportEndDate',
    'RowType',
    'GroupLabel',
    'GroupId',
    'Date',
    'TransactionType',
    'TransactionId',
    'Num',
    'Name',
    'MemoDescription',
    'Split',
    'SplitId',
    'Amount',
    'RawRowJSON'
  ]);

  const matched = values.slice(1).filter(function(row) {
    return qboStrDateText_(row[idx.ReportStartDate]) === startDate &&
      qboStrDateText_(row[idx.ReportEndDate]) === endDate;
  });

  if (!matched.length) {
    throw new Error(
      'No captured General Ledger period was found for ' +
      startDate + '..' + endDate +
      '. The existing captured GL dataset was searched without refreshing QBO.'
    );
  }

  const runIds = {};
  matched.forEach(function(row) {
    const id = String(row[idx.ExtractRunId] || '').trim();
    if (id) runIds[id] = true;
  });
  const runIdList = Object.keys(runIds);
  if (runIdList.length !== 1) {
    throw new Error(
      'Captured GL period ' + startDate + '..' + endDate +
      ' contains ' + runIdList.length +
      ' ExtractRunIds; expected exactly one current captured run.'
    );
  }

  const extractRunId = runIdList[0];
  const runRows = matched.filter(function(row) {
    return String(row[idx.ExtractRunId] || '').trim() === extractRunId;
  });
  const first = runRows[0];
  const basis = String(first[idx.ReportBasis] || '').trim();
  if (basis && basis !== 'Cash') {
    throw new Error(
      'Captured General Ledger period is ' + basis + '; expected Cash.'
    );
  }

  const extractedAt = first[idx.ExtractedAt];
  const dataRows = runRows
    .filter(function(row) {
      return String(row[idx.RowType] || '').trim() === 'Data';
    })
    .map(function(row) {
      return {
        recognitionDate: qboStrDateText_(row[idx.Date]),
        transactionType: String(row[idx.TransactionType] || '').trim(),
        transactionId: String(row[idx.TransactionId] || '').trim(),
        num: String(row[idx.Num] || '').trim(),
        customer: String(row[idx.Name] || '').trim(),
        memo: String(row[idx.MemoDescription] || '').trim(),
        splitAccount: String(row[idx.Split] || '').trim(),
        splitId: String(row[idx.SplitId] || '').trim(),
        amount: qboStrNumber_(row[idx.Amount]),
        distributionAccount: String(row[idx.GroupLabel] || '').trim(),
        accountId: String(row[idx.GroupId] || '').trim(),
        rawRowJson: String(row[idx.RawRowJSON] || '')
      };
    });

  return {
    spreadsheetId: ss.getId(),
    extractRunId: extractRunId,
    extractedAt: extractedAt,
    reportStartDate: startDate,
    reportEndDate: endDate,
    rowCount: dataRows.length,
    rows: dataRows
  };
}

function qboStrIsEligibleEvidenceRow_(row) {
  if (QBO_SALES_TAX_RECOGNITION.ALLOWED_TYPES.indexOf(row.transactionType) === -1) {
    return false;
  }
  if (!row.transactionId) return false;
  if (row.amount === null || Math.abs(row.amount) < 0.0000001) return false;

  const account = qboStrNorm_(qboStrTerminalAccount_(row.distributionAccount));
  if (account === 'undeposited funds') return false;
  if (/texas comptroller|sales tax payable|tax payable/.test(account)) return false;
  return true;
}

function qboStrHeaderIndex_(headers, required) {
  const index = {};
  required.forEach(function(name) {
    const i = headers.indexOf(name);
    if (i < 0) {
      throw new Error('Captured General Ledger schema is missing column ' + name + '.');
    }
    index[name] = i;
  });
  return index;
}

function qboStrResolveMonth_(monthKey) {
  const match = String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
  if (!match) throw new Error('monthKey must be YYYY-MM');
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error('monthKey contains an invalid month.');
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 0));
  return {
    startDate: Utilities.formatDate(start, 'UTC', 'yyyy-MM-dd'),
    endDate: Utilities.formatDate(end, 'UTC', 'yyyy-MM-dd')
  };
}

function qboStrValidatePeriod_(startDate, endDate) {
  const pattern = /^\d{4}-\d{2}-\d{2}$/;
  if (!pattern.test(String(startDate || '')) || !pattern.test(String(endDate || ''))) {
    throw new Error('Recognition dates must use yyyy-mm-dd format.');
  }
  if (startDate > endDate) {
    throw new Error('Recognition startDate must be on or before endDate.');
  }
}

function qboStrDateText_(value) {
  if (value === null || value === undefined || value === '') return '';
  if (Object.prototype.toString.call(value) === '[object Date]') {
    return Utilities.formatDate(value, Session.getScriptTimeZone() || 'America/Chicago', 'yyyy-MM-dd');
  }
  const text = String(value).trim();
  const iso = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return iso[1] + '-' + iso[2] + '-' + iso[3];
  return text;
}

function qboStrNumber_(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return isFinite(value) ? value : null;
  const number = Number(String(value).replace(/[$,\s]/g, ''));
  return isFinite(number) ? number : null;
}

function qboStrTerminalAccount_(value) {
  const parts = String(value || '').split(':');
  return parts[parts.length - 1].trim();
}

function qboStrNorm_(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function qboStrAssignOccurrences_(rows) {
  const seen = {};
  return (rows || []).map(function(row) {
    const key = [
      row.recognitionDate,
      row.transactionType,
      row.transactionId,
      qboStrNorm_(qboStrTerminalAccount_(row.distributionAccount)),
      qboStrNorm_(row.memo),
      qboStrNorm_(row.splitAccount),
      qboStrMoneyKey_(row.amount)
    ].join('|');
    seen[key] = (seen[key] || 0) + 1;
    row.occurrence = seen[key];
    return row;
  });
}

function qboStrKey_(row, occurrence) {
  return [
    row[9],  // Recognition_Date
    row[10], // Transaction_Type
    row[11], // Transaction_ID
    row[14], // Distribution_Account
    qboStrMoneyKey_(row[16]), // Amount
    row[17], // Memo_Description
    row[18], // Split_Account
    occurrence || 1
  ].map(qboStrNorm_).join('|');
}

function qboStrMoneyKey_(value) {
  if (value === null || value === undefined || value === '') return '';
  const number = Number(value);
  return isFinite(number) ? number.toFixed(2) : qboStrNorm_(value);
}

function qboStrCanonicalText_(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/\s+/g, ' ')
    .trim();
}

function qboStrCanonicalDateOnly_(value) {
  return qboStrDateText_(value);
}

function qboStrCanonicalNumber_(value) {
  const number = qboStrNumber_(value);
  return number === null ? '' : Number(number.toFixed(2));
}

function qboStrCanonicalState_(row) {
  return [
    qboStrCanonicalDateOnly_(row[9]),
    qboStrCanonicalText_(row[10]),
    qboStrCanonicalText_(row[11]),
    qboStrCanonicalText_(row[12]),
    qboStrCanonicalText_(row[13]),
    qboStrCanonicalText_(row[14]),
    qboStrCanonicalText_(row[15]),
    qboStrCanonicalNumber_(row[16]),
    qboStrCanonicalText_(row[17]),
    qboStrCanonicalText_(row[18]),
    qboStrCanonicalText_(row[19]),
    qboStrCanonicalText_(row[20])
  ];
}

function qboStrStateHash_(row, rawJson) {
  let raw = rawJson || '';
  try { raw = raw ? JSON.parse(raw) : ''; } catch (_err) {}
  return qboStrHash_({
    version: QBO_SALES_TAX_RECOGNITION.ROW_HASH_VERSION,
    state: qboStrCanonicalState_(row),
    rawGlRow: raw
  });
}

function qboStrComparableHash_(row) {
  return qboStrStateHash_(row, row[23]);
}

function qboStrHash_(values) {
  const bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    JSON.stringify(values),
    Utilities.Charset.UTF_8
  );
  return bytes.map(function(value) {
    return ('0' + ((value + 256) % 256).toString(16)).slice(-2);
  }).join('');
}

function qboStrGetWorkbook_() {
  const id = String(
    PropertiesService.getScriptProperties().getProperty(
      QBO_SALES_TAX_RECOGNITION.PROPERTY_KEY
    ) || ''
  ).trim();
  if (!id) {
    throw new Error('Run provisionQboSalesTaxRecognitionDataWorkbook() first.');
  }
  return SpreadsheetApp.openById(id);
}

function qboStrEnsureWorkbook_(ss) {
  [
    QBO_SALES_TAX_RECOGNITION.CONTROL_SHEET,
    QBO_SALES_TAX_RECOGNITION.CURRENT_SHEET,
    QBO_SALES_TAX_RECOGNITION.SNAPSHOT_SHEET,
    QBO_SALES_TAX_RECOGNITION.CHANGES_SHEET,
    QBO_SALES_TAX_RECOGNITION.LOG_SHEET
  ].forEach(function(name) {
    if (!ss.getSheetByName(name)) ss.insertSheet(name);
  });

  const defaultSheet = ss.getSheetByName('Sheet1');
  if (defaultSheet && ss.getSheets().length > 1 && defaultSheet.getLastRow() === 0) {
    ss.deleteSheet(defaultSheet);
  }

  qboStrEnsureControls_(ss);
  qboStrHeader_(ss.getSheetByName(QBO_SALES_TAX_RECOGNITION.CURRENT_SHEET), QBO_STR_HEADERS);
  qboStrHeader_(ss.getSheetByName(QBO_SALES_TAX_RECOGNITION.SNAPSHOT_SHEET), QBO_STR_HEADERS);
  qboStrHeader_(ss.getSheetByName(QBO_SALES_TAX_RECOGNITION.CHANGES_SHEET), QBO_STR_CHANGE_HEADERS);
  qboStrHeader_(ss.getSheetByName(QBO_SALES_TAX_RECOGNITION.LOG_SHEET), QBO_STR_LOG_HEADERS);
}

function qboStrHeader_(sheet, headers) {
  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
  }
}

function qboStrAppend_(sheet, headers, rows) {
  qboStrHeader_(sheet, headers);
  if (!rows.length) return;
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
  sheet.getRange(sheet.getLastRow() - rows.length + 1, 1, rows.length, headers.length)
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
}

function qboStrNextSeq_(ss, periodKey) {
  const sheet = ss.getSheetByName(QBO_SALES_TAX_RECOGNITION.SNAPSHOT_SHEET);
  if (sheet.getLastRow() < 2) return 1;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getValues();
  let max = 0;
  values.forEach(function(row) {
    if (String(row[0]) === periodKey) max = Math.max(max, Number(row[1]) || 0);
  });
  return max + 1;
}

function qboStrLatest_(ss, periodKey) {
  const sheet = ss.getSheetByName(QBO_SALES_TAX_RECOGNITION.SNAPSHOT_SHEET);
  if (sheet.getLastRow() < 2) return { sequence: 0, rows: [] };
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, QBO_STR_HEADERS.length).getValues();
  let sequence = 0;
  values.forEach(function(row) {
    if (String(row[0]) === periodKey) sequence = Math.max(sequence, Number(row[1]) || 0);
  });
  return {
    sequence: sequence,
    rows: values.filter(function(row) {
      return String(row[0]) === periodKey && Number(row[1]) === sequence;
    })
  };
}

function qboStrReplaceCurrent_(ss, periodKey, rows) {
  const sheet = ss.getSheetByName(QBO_SALES_TAX_RECOGNITION.CURRENT_SHEET);
  let keep = [];
  if (sheet.getLastRow() > 1) {
    keep = sheet.getRange(2, 1, sheet.getLastRow() - 1, QBO_STR_HEADERS.length)
      .getValues()
      .filter(function(row) { return String(row[0]) !== periodKey; });
  }

  sheet.clearContents();
  sheet.getRange(1, 1, 1, QBO_STR_HEADERS.length).setValues([QBO_STR_HEADERS]);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, QBO_STR_HEADERS.length).setFontWeight('bold');

  const clean = rows.map(function(row) {
    const copy = row.slice();
    copy[1] = '';
    copy[2] = '';
    return copy;
  });
  const all = keep.concat(clean);
  if (all.length) {
    sheet.getRange(2, 1, all.length, QBO_STR_HEADERS.length).setValues(all);
    sheet.getRange(2, 1, all.length, QBO_STR_HEADERS.length)
      .setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
  }
}

function qboStrChanges_(periodKey, oldSeq, newSeq, runId, detectedAt, oldRows, newRows) {
  const oldMap = {};
  const newMap = {};
  const changes = [];
  const keyIndex = QBO_STR_HEADERS.indexOf('Row_Key');
  const hashIndex = QBO_STR_HEADERS.indexOf('Row_Hash');

  oldRows.forEach(function(row) { oldMap[String(row[keyIndex])] = row; });
  newRows.forEach(function(row) { newMap[String(row[keyIndex])] = row; });

  Object.keys(oldMap).forEach(function(key) {
    if (!newMap[key]) {
      changes.push([
        periodKey, oldSeq, newSeq, runId, detectedAt,
        'REMOVE', key, oldMap[key][hashIndex], ''
      ]);
    } else {
      const oldComparable = qboStrComparableHash_(oldMap[key]);
      const newComparable = qboStrComparableHash_(newMap[key]);
      if (oldComparable !== newComparable) {
        changes.push([
          periodKey, oldSeq, newSeq, runId, detectedAt,
          'CHANGE', key, oldMap[key][hashIndex], newMap[key][hashIndex]
        ]);
      }
    }
  });

  Object.keys(newMap).forEach(function(key) {
    if (!oldMap[key]) {
      changes.push([
        periodKey, oldSeq, newSeq, runId, detectedAt,
        'ADD', key, '', newMap[key][hashIndex]
      ]);
    }
  });
  return changes;
}

function qboStrEnsureControls_(ss) {
  const sheet = ss.getSheetByName(QBO_SALES_TAX_RECOGNITION.CONTROL_SHEET);
  if (!sheet) return;
  const existing = qboStrReadControls_(sheet);
  if (sheet.getLastRow() === 0) {
    qboStrRenderControls_(sheet, '', '', '', '', '', null, '', '');
    return;
  }
  if (!Object.prototype.hasOwnProperty.call(existing, 'REPORT_MONTH')) {
    const latest = String(existing['Latest Period Key'] || '').trim();
    const reportMonth = /^\d{6}$/.test(latest)
      ? latest.slice(0, 4) + '-' + latest.slice(4, 6)
      : '';
    qboStrRenderControls_(
      sheet,
      reportMonth,
      existing['Latest Period Key'] || '',
      existing['Latest Snapshot Sequence'] || '',
      existing['Latest Snapshot Run ID'] || '',
      existing['Latest Derived At'] || '',
      null,
      existing['Latest Row Count'] || '',
      existing['Latest Change Count'] || ''
    );
  }
}

function qboStrReadControls_(sheet) {
  const out = {};
  if (!sheet || sheet.getLastRow() < 2) return out;
  const values = sheet.getRange(2, 1, sheet.getLastRow() - 1, 2).getDisplayValues();
  values.forEach(function(row) {
    const key = String(row[0] || '').trim();
    if (key) out[key] = String(row[1] || '').trim();
  });
  return out;
}

function qboStrReadControlValue_(ss, key) {
  return qboStrReadControls_(
    ss.getSheetByName(QBO_SALES_TAX_RECOGNITION.CONTROL_SHEET)
  )[key];
}

function qboStrRenderControls_(sheet, reportMonth, periodKey, sequence, runId, derivedAt, source, rowCount, changeCount) {
  source = source || {};
  const values = [
    ['Control', 'Value'],
    ['Dataset', 'QBO Sales Tax Recognition Evidence'],
    ['Source', 'Captured App 50 QBO_GeneralLedger dataset'],
    ['Source refresh behavior', 'NOT REAL TIME; this module never calls GeneralLedger API'],
    ['Accounting Method', 'Cash'],
    ['REPORT_MONTH', reportMonth],
    ['Population status', 'SUPPORTING_EVIDENCE_NOT_YET_EXACT_SALES_BY_TAX_NAME_CLONE'],
    ['Included transaction types', 'Invoice; Sales Receipt; Credit Memo; Refund'],
    ['Excluded accounts', 'Undeposited Funds; Texas Comptroller / tax-payable'],
    ['Row Hash Version', QBO_SALES_TAX_RECOGNITION.ROW_HASH_VERSION],
    ['Latest Period Key', periodKey],
    ['Latest Snapshot Sequence', sequence],
    ['Latest Snapshot Run ID', runId],
    ['Latest Derived At', derivedAt],
    ['Source GL Workbook ID', source.spreadsheetId || ''],
    ['Source GL Extract Run ID', source.extractRunId || ''],
    ['Source GL Extracted At', source.extractedAt || ''],
    ['Source GL Report Start Date', source.reportStartDate || ''],
    ['Source GL Report End Date', source.reportEndDate || ''],
    ['Latest Row Count', rowCount],
    ['Latest Change Count', changeCount]
  ];
  sheet.clearContents();
  sheet.getRange(1, 1, values.length, 2).setValues(values);
  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, 2).setFontWeight('bold');
  sheet.getDataRange().setWrapStrategy(SpreadsheetApp.WrapStrategy.CLIP);
}

function qboStrWriteControls_(ss, periodKey, sequence, runId, derivedAt, source, rowCount, changeCount) {
  const sheet = ss.getSheetByName(QBO_SALES_TAX_RECOGNITION.CONTROL_SHEET);
  const reportMonth = qboStrReadControlValue_(ss, 'REPORT_MONTH') || '';
  qboStrRenderControls_(
    sheet, reportMonth, periodKey, sequence, runId, derivedAt, source, rowCount, changeCount
  );
}
