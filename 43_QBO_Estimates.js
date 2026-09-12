/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 43_QBO_Estimates.js
 * Purpose     : Export QBO Estimates and estimate lines to structured Google Sheets tables.
 *
 * Public API:
 *   - exportQboEstimates()
 *
 * Internal Helpers:
 *   - buildEstimateRows_()
 *   - buildEstimateLineRows_()
 *   - appendEstimateLineRow_()
 *   - calculateEstimateLineTotals_()
 *
 * Dependencies:
 *   - Other Application 50 modules as referenced by function calls
 *   - Google Apps Script services used by this module
 *
 * Current Owner:
 *   - 50 QBO Import Hub
 *
 * Future Ownership:
 *   - Remains in Application 50 unless a later approved architecture decision assigns a narrower reusable component elsewhere.
 *
 * Change History:
 *   - 2026-07-21: Added standardized module documentation. No runtime behavior
 *     changed.
 * ============================================================================
 */


/***********************
 * 43_QBO_Estimates.gs
 * QBO Estimate export
 *
 * Output Sheets:
 *   QBO_Estimates
 *   QBO_EstimateLines
 *
 * Public Functions:
 *   exportQboEstimates()
 ***********************/

/** Estimate parent export columns. */
const ESTIMATE_HEADERS = [
  'Id',
  'SyncToken',
  'DocNumber',
  'TxnDate',
  'ExpirationDate',
  'AcceptedDate',
  'ShipDate',
  'TransactionStatus',
  'AcceptedBy',
  'CustomerId',
  'CustomerName',
  'CustomerMemo',
  'ClassId',
  'ClassName',
  'DepartmentId',
  'DepartmentName',
  'CurrencyCode',
  'CurrencyName',
  'ExchangeRate',
  'BillEmail',
  'BillEmailBccAddress',
  'BillEmailBccJSON',
  'BillEmailCcAddress',
  'BillEmailCcJSON',
  'FreeFormAddress',
  'BillAddrId',
  'BillAddrLine1',
  'BillAddrLine2',
  'BillAddrLine3',
  'BillAddrLine4',
  'BillAddrLine5',
  'BillAddrCity',
  'BillAddrState',
  'BillAddrPostalCode',
  'BillAddrCountry',
  'ShipAddrId',
  'ShipAddrLine1',
  'ShipAddrLine2',
  'ShipAddrLine3',
  'ShipAddrLine4',
  'ShipAddrLine5',
  'ShipAddrCity',
  'ShipAddrState',
  'ShipAddrPostalCode',
  'ShipAddrCountry',
  'ShipFromAddrId',
  'ShipFromAddrLine1',
  'ShipFromAddrLine2',
  'ShipFromAddrLine3',
  'ShipFromAddrLine4',
  'ShipFromAddrLine5',
  'ShipFromAddrCity',
  'ShipFromAddrState',
  'ShipFromAddrPostalCode',
  'ShipFromAddrCountry',
  'ShipFromAddrJSON',
  'TrackingNumber',
  'PrintStatus',
  'EmailStatus',
  'DeliveryType',
  'DeliveryTime',
  'DeliveryInfoJSON',
  'Subtotal',
  'DiscountTotal',
  'TotalTax',
  'TotalAmount',
  'HomeTotalAmount',
  'TransactionTaxCodeId',
  'TransactionTaxCodeName',
  'ApplyTaxAfterDiscount',
  'TaxExemptionRefId',
  'TaxExemptionRefName',
  'TaxExemptionRefJSON',
  'TransactionTaxDetailJSON',
  'LineCount',
  'PrivateNote',
  'CustomFieldsJSON',
  'LinkedTransactionCount',

  'LinkedInvoiceCount',
  'LinkedInvoiceIds',

  'LinkedOtherTransactionCount',
  'LinkedOtherTransactionsJSON',
  'LinkedTransactionsJSON',
  'CreateTime',
  'LastUpdatedTime',
  'RawJSON'
];

/** Estimate line export columns. */
const ESTIMATE_LINE_HEADERS = [
  'EstimateId',
  'EstimateDocNumber',
  'EstimateTxnDate',
  'EstimateStatus',
  'CustomerId',
  'CustomerName',
  'LineId',
  'LineNumber',
  'LineLevel',
  'ParentLineId',
  'ParentLineNumber',
  'DetailType',
  'Description',
  'Amount',
  'ItemId',
  'ItemName',
  'ItemAccountId',
  'ItemAccountName',
  'TaxClassificationId',
  'TaxClassificationName',
  'Quantity',
  'UnitPrice',
  'RatePercent',
  'ServiceDate',
  'ClassId',
  'ClassName',
  'TaxCodeId',
  'TaxCodeName',
  'DiscountPercent',
  'DiscountAccountId',
  'DiscountAccountName',
  'GroupItemId',
  'GroupItemName',
  'GroupLineCount',
  'LinkedTransactionCount',

  'LinkedOtherTransactionCount',
  'LinkedOtherTransactionsJSON',
  'LinkedTransactionsJSON',
  'RawJSON'
];

/**
 * Exports all QBO Estimates and their line details.
 *
 * @return {Object} Export row counts.
 */
function exportQboEstimates() {
  safeLog_('Starting QBO estimates export.');

  const estimates = qboQueryAllGeneric_(
    'SELECT * FROM Estimate',
    'Estimate'
  );

  safeLog_(`Retrieved ${estimates.length} QBO estimates.`);

  const estimateRows = buildEstimateRows_(estimates);

  writeExport_({
    sheetName: 'QBO_Estimates',
    headers: ESTIMATE_HEADERS,
    rows: estimateRows,
    columnWidths: {
      [ESTIMATE_HEADERS.indexOf('DocNumber') + 1]: 120,
      [ESTIMATE_HEADERS.indexOf('TransactionStatus') + 1]: 160,
      [ESTIMATE_HEADERS.indexOf('AcceptedBy') + 1]: 200,
      [ESTIMATE_HEADERS.indexOf('CustomerName') + 1]: 240,
      [ESTIMATE_HEADERS.indexOf('CustomerMemo') + 1]: 300,
      [ESTIMATE_HEADERS.indexOf('BillEmail') + 1]: 240,
      [ESTIMATE_HEADERS.indexOf('BillAddrLine1') + 1]: 240,
      [ESTIMATE_HEADERS.indexOf('ShipAddrLine1') + 1]: 240,
      [ESTIMATE_HEADERS.indexOf('PrivateNote') + 1]: 300,
      [ESTIMATE_HEADERS.indexOf('CustomFieldsJSON') + 1]: 300,
      [ESTIMATE_HEADERS.indexOf('TransactionTaxDetailJSON') + 1]: 300,
      [ESTIMATE_HEADERS.indexOf('LinkedOtherTransactionsJSON') + 1]: 300,
      [ESTIMATE_HEADERS.indexOf('LinkedTransactionsJSON') + 1]: 300,
      [ESTIMATE_HEADERS.indexOf('RawJSON') + 1]: 300
    },
    numberFormats: {
      [ESTIMATE_HEADERS.indexOf('TxnDate') + 1]: 'yyyy-mm-dd',
      [ESTIMATE_HEADERS.indexOf('ExpirationDate') + 1]: 'yyyy-mm-dd',
      [ESTIMATE_HEADERS.indexOf('AcceptedDate') + 1]: 'yyyy-mm-dd',
      [ESTIMATE_HEADERS.indexOf('ShipDate') + 1]: 'yyyy-mm-dd',
      [ESTIMATE_HEADERS.indexOf('ExchangeRate') + 1]: '0.000000',
      [ESTIMATE_HEADERS.indexOf('Subtotal') + 1]: '$#,##0.00',
      [ESTIMATE_HEADERS.indexOf('DiscountTotal') + 1]: '$#,##0.00',
      [ESTIMATE_HEADERS.indexOf('TotalTax') + 1]: '$#,##0.00',
      [ESTIMATE_HEADERS.indexOf('TotalAmount') + 1]: '$#,##0.00',
      [ESTIMATE_HEADERS.indexOf('HomeTotalAmount') + 1]: '$#,##0.00'
    },
    logMessage: `Exported ${estimateRows.length} QBO estimates.`
  });

  const estimateLineRows = buildEstimateLineRows_(estimates);

  writeExport_({
    sheetName: 'QBO_EstimateLines',
    headers: ESTIMATE_LINE_HEADERS,
    rows: estimateLineRows,
    columnWidths: {
      [ESTIMATE_LINE_HEADERS.indexOf('EstimateDocNumber') + 1]: 140,
      [ESTIMATE_LINE_HEADERS.indexOf('EstimateStatus') + 1]: 160,
      [ESTIMATE_LINE_HEADERS.indexOf('CustomerName') + 1]: 240,
      [ESTIMATE_LINE_HEADERS.indexOf('Description') + 1]: 300,
      [ESTIMATE_LINE_HEADERS.indexOf('ItemName') + 1]: 240,
      [ESTIMATE_LINE_HEADERS.indexOf('LinkedOtherTransactionsJSON') + 1]: 300,
      [ESTIMATE_LINE_HEADERS.indexOf('LinkedTransactionsJSON') + 1]: 300,
      [ESTIMATE_LINE_HEADERS.indexOf('RawJSON') + 1]: 300
    },
    numberFormats: {
      [ESTIMATE_LINE_HEADERS.indexOf('EstimateTxnDate') + 1]: 'yyyy-mm-dd',
      [ESTIMATE_LINE_HEADERS.indexOf('Amount') + 1]: '$#,##0.00',
      [ESTIMATE_LINE_HEADERS.indexOf('Quantity') + 1]: '0.00',
      [ESTIMATE_LINE_HEADERS.indexOf('UnitPrice') + 1]: '$#,##0.00',
      [ESTIMATE_LINE_HEADERS.indexOf('RatePercent') + 1]: '0.00',
      [ESTIMATE_LINE_HEADERS.indexOf('DiscountPercent') + 1]: '0.00'
    },
    logMessage: `Exported ${estimateLineRows.length} QBO estimate line rows.`
  });

  safeLog_('Completed QBO estimates export.');

  return {
    estimateCount: estimateRows.length,
    estimateLineCount: estimateLineRows.length
  };
}

/**
 * Builds rows for QBO_Estimates.
 *
 * @param {Object[]} estimates QBO Estimate objects.
 * @return {Array[]} Rows matching ESTIMATE_HEADERS.
 */
function buildEstimateRows_(estimates) {
  return estimates.map(estimate => {
    const meta = extractMeta_(estimate);
    const lines = normalizeArray_(estimate.Line);
    const totals = calculateEstimateLineTotals_(lines);
    const linkedTransactions = normalizeArray_(estimate.LinkedTxn);
    const linked = summarizeLinkedTransactionsForTypes_(linkedTransactions, ['Invoice']);

    return [
      valueOrBlank_(estimate.Id),
      valueOrBlank_(estimate.SyncToken),
      valueOrBlank_(estimate.DocNumber),
      valueOrBlank_(estimate.TxnDate),
      valueOrBlank_(estimate.ExpirationDate),
      valueOrBlank_(estimate.AcceptedDate),
      valueOrBlank_(estimate.ShipDate),
      valueOrBlank_(estimate.TxnStatus),
      valueOrBlank_(estimate.AcceptedBy),
      nestedValue_(estimate, 'CustomerRef.value'),
      nestedValue_(estimate, 'CustomerRef.name'),
      nestedValue_(estimate, 'CustomerMemo.value'),
      nestedValue_(estimate, 'ClassRef.value'),
      nestedValue_(estimate, 'ClassRef.name'),
      nestedValue_(estimate, 'DepartmentRef.value'),
      nestedValue_(estimate, 'DepartmentRef.name'),
      nestedValue_(estimate, 'CurrencyRef.value'),
      nestedValue_(estimate, 'CurrencyRef.name'),
      numberOrBlank_(estimate.ExchangeRate),
      nestedValue_(estimate, 'BillEmail.Address'),
      nestedValue_(estimate, 'BillEmailBcc.Address'),
      jsonStringifyCellSafe_(estimate.BillEmailBcc),
      nestedValue_(estimate, 'BillEmailCc.Address'),
      jsonStringifyCellSafe_(estimate.BillEmailCc),
      valueOrBlank_(estimate.FreeFormAddress),
      nestedValue_(estimate, 'BillAddr.Id'),
      nestedValue_(estimate, 'BillAddr.Line1'),
      nestedValue_(estimate, 'BillAddr.Line2'),
      nestedValue_(estimate, 'BillAddr.Line3'),
      nestedValue_(estimate, 'BillAddr.Line4'),
      nestedValue_(estimate, 'BillAddr.Line5'),
      nestedValue_(estimate, 'BillAddr.City'),
      nestedValue_(estimate, 'BillAddr.CountrySubDivisionCode'),
      nestedValue_(estimate, 'BillAddr.PostalCode'),
      nestedValue_(estimate, 'BillAddr.Country'),
      nestedValue_(estimate, 'ShipAddr.Id'),
      nestedValue_(estimate, 'ShipAddr.Line1'),
      nestedValue_(estimate, 'ShipAddr.Line2'),
      nestedValue_(estimate, 'ShipAddr.Line3'),
      nestedValue_(estimate, 'ShipAddr.Line4'),
      nestedValue_(estimate, 'ShipAddr.Line5'),
      nestedValue_(estimate, 'ShipAddr.City'),
      nestedValue_(estimate, 'ShipAddr.CountrySubDivisionCode'),
      nestedValue_(estimate, 'ShipAddr.PostalCode'),
      nestedValue_(estimate, 'ShipAddr.Country'),
      nestedValue_(estimate, 'ShipFromAddr.Id'),
      nestedValue_(estimate, 'ShipFromAddr.Line1'),
      nestedValue_(estimate, 'ShipFromAddr.Line2'),
      nestedValue_(estimate, 'ShipFromAddr.Line3'),
      nestedValue_(estimate, 'ShipFromAddr.Line4'),
      nestedValue_(estimate, 'ShipFromAddr.Line5'),
      nestedValue_(estimate, 'ShipFromAddr.City'),
      nestedValue_(estimate, 'ShipFromAddr.CountrySubDivisionCode'),
      nestedValue_(estimate, 'ShipFromAddr.PostalCode'),
      nestedValue_(estimate, 'ShipFromAddr.Country'),
      jsonStringifyCellSafe_(estimate.ShipFromAddr),
      valueOrBlank_(estimate.TrackingNum),
      valueOrBlank_(estimate.PrintStatus),
      valueOrBlank_(estimate.EmailStatus),
      nestedValue_(estimate, 'DeliveryInfo.DeliveryType'),
      nestedValue_(estimate, 'DeliveryInfo.DeliveryTime'),
      jsonStringifyCellSafe_(estimate.DeliveryInfo),
      totals.subtotal,
      totals.discountTotal,
      nestedNumberOrBlank_(estimate, 'TxnTaxDetail.TotalTax'),
      numberOrBlank_(estimate.TotalAmt),
      numberOrBlank_(estimate.HomeTotalAmt),
      nestedValue_(estimate, 'TxnTaxDetail.TxnTaxCodeRef.value'),
      nestedValue_(estimate, 'TxnTaxDetail.TxnTaxCodeRef.name'),
      booleanOrBlank_(estimate.ApplyTaxAfterDiscount),
      nestedValue_(estimate, 'TaxExemptionRef.value'),
      nestedValue_(estimate, 'TaxExemptionRef.name'),
      jsonStringifyCellSafe_(estimate.TaxExemptionRef),
      jsonStringifyCellSafe_(estimate.TxnTaxDetail),
      lines.length,
      valueOrBlank_(estimate.PrivateNote),
      jsonStringifyCellSafe_(estimate.CustomField),
            linked.totalCount,
      linkedTxnTypeCount_(linked, 'Invoice'),
      linkedTxnTypeIds_(linked, 'Invoice'),
      linked.otherCount,
      jsonStringifyCellSafe_(linked.otherTransactions),
      jsonStringifyCellSafe_(linkedTransactions),
      valueOrBlank_(meta.createTime),
      valueOrBlank_(meta.lastUpdatedTime),
      jsonStringifyCellSafe_(estimate)
    ];
  });
}

/**
 * Builds rows for QBO_EstimateLines.
 *
 * Group lines and nested group components are exported as separate rows.
 *
 * @param {Object[]} estimates QBO Estimate objects.
 * @return {Array[]} Rows matching ESTIMATE_LINE_HEADERS.
 */
function buildEstimateLineRows_(estimates) {
  const rows = [];

  estimates.forEach(estimate => {
    normalizeArray_(estimate.Line).forEach((line, index) => {
      appendEstimateLineRow_(
        rows,
        estimate,
        line,
        index + 1,
        0,
        '',
        ''
      );
    });
  });

  return rows;
}

/**
 * Appends one Estimate line and any nested group lines.
 *
 * @param {Array[]} rows Destination row array.
 * @param {Object} estimate Parent Estimate object.
 * @param {Object} line Estimate line object.
 * @param {number} fallbackLineNumber Array position.
 * @param {number} lineLevel Zero for top-level lines.
 * @param {*} parentLineId Parent group line ID.
 * @param {*} parentLineNumber Parent group line number.
 */
function appendEstimateLineRow_(
  rows,
  estimate,
  line,
  fallbackLineNumber,
  lineLevel,
  parentLineId,
  parentLineNumber
) {
  const detailType = valueOrBlank_(line.DetailType);
  const detail = detailType && line[detailType] ? line[detailType] : {};
  const suppliedLineNumber = valueOrBlank_(line.LineNum);
  const lineNumber = suppliedLineNumber !== ''
    ? suppliedLineNumber
    : fallbackLineNumber;
  const groupLines = detailType === 'GroupLineDetail'
    ? normalizeArray_(detail.Line)
    : [];
  const linkedTransactions = normalizeArray_(line.LinkedTxn);
  const linked = summarizeLinkedTransactionsForTypes_(linkedTransactions, []);

  rows.push([
    valueOrBlank_(estimate.Id),
    valueOrBlank_(estimate.DocNumber),
    valueOrBlank_(estimate.TxnDate),
    valueOrBlank_(estimate.TxnStatus),
    nestedValue_(estimate, 'CustomerRef.value'),
    nestedValue_(estimate, 'CustomerRef.name'),
    valueOrBlank_(line.Id),
    lineNumber,
    lineLevel,
    valueOrBlank_(parentLineId),
    valueOrBlank_(parentLineNumber),
    detailType,
    valueOrBlank_(line.Description),
    numberOrBlank_(line.Amount),
    nestedValue_(detail, 'ItemRef.value'),
    nestedValue_(detail, 'ItemRef.name'),
    nestedValue_(detail, 'ItemAccountRef.value'),
    nestedValue_(detail, 'ItemAccountRef.name'),
    nestedValue_(detail, 'TaxClassificationRef.value'),
    nestedValue_(detail, 'TaxClassificationRef.name'),
    numberOrBlank_(detail.Qty),
    numberOrBlank_(detail.UnitPrice),
    numberOrBlank_(detail.RatePercent),
    valueOrBlank_(detail.ServiceDate),
    nestedValue_(detail, 'ClassRef.value'),
    nestedValue_(detail, 'ClassRef.name'),
    nestedValue_(detail, 'TaxCodeRef.value'),
    nestedValue_(detail, 'TaxCodeRef.name'),
    numberOrBlank_(detail.DiscountPercent),
    nestedValue_(detail, 'DiscountAccountRef.value'),
    nestedValue_(detail, 'DiscountAccountRef.name'),
    nestedValue_(detail, 'GroupItemRef.value'),
    nestedValue_(detail, 'GroupItemRef.name'),
    groupLines.length,
        linked.totalCount,
    linked.otherCount,
    jsonStringifyCellSafe_(linked.otherTransactions),
    jsonStringifyCellSafe_(linkedTransactions),
    jsonStringifyCellSafe_(line)
    ]);

  groupLines.forEach((childLine, childIndex) => {
    appendEstimateLineRow_(
      rows,
      estimate,
      childLine,
      childIndex + 1,
      lineLevel + 1,
      valueOrBlank_(line.Id),
      lineNumber
    );
  });
}

/**
 * Calculates useful Estimate totals from line records.
 *
 * @param {Object[]} lines Estimate line objects.
 * @return {Object} Subtotal and discount total.
 */
function calculateEstimateLineTotals_(lines) {
  let subtotal = '';
  let discountTotal = 0;
  let hasDiscount = false;

  lines.forEach(line => {
    if (line.DetailType === 'SubTotalLineDetail') {
      subtotal = numberOrBlank_(line.Amount);
    }

    if (line.DetailType === 'DiscountLineDetail') {
      const amount = Number(line.Amount);

      if (Number.isFinite(amount)) {
        discountTotal += Math.abs(amount);
        hasDiscount = true;
      }
    }
  });

  return {
    subtotal: subtotal,
    discountTotal: hasDiscount ? discountTotal : ''
  };
}
