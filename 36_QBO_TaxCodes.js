/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 36_QBO_TaxCodes.js
 * Purpose     : Export QBO TaxCode master data to structured Google Sheets tables.
 *
 * Public API:
 *   - exportQboTaxCodes()
 *
 * Internal Helpers:
 *   - buildTaxCodeRows_()
 *   - buildTaxCodeRateRows_()
 *   - appendTaxCodeRateRows_()
 *   - getTaxRateDetails_()
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
 * 36_QBO_TaxCodes.gs
 * QBO Tax Code export
 *
 * Output Sheets:
 *   QBO_TaxCodes
 *   QBO_TaxCodeRates
 *
 * Public Functions:
 *   exportQboTaxCodes()
 ***********************/


/**
 * Tax Code parent export columns.
 */
const TAX_CODE_HEADERS = [

  // Identity
  'Id',
  'SyncToken',
  'Active',

  // Tax Code
  'Name',
  'Description',
  'Taxable',
  'TaxGroup',
  'TaxCodeConfigType',

  // Related Rates
  'SalesTaxRateCount',
  'PurchaseTaxRateCount',
  'TotalTaxRateCount',

  // Audit
  'CreateTime',
  'LastUpdatedTime',

  // Source
  'RawJSON'
];


/**
 * Tax Code rate-reference child export columns.
 */
const TAX_CODE_RATE_HEADERS = [

  // Parent Tax Code
  'TaxCodeId',
  'TaxCodeName',

  // Rate List
  'RateListType',
  'LineNumber',

  // Referenced Tax Rate
  'TaxRateId',
  'TaxRateName',
  'TaxType',
  'TaxOrder',

  // Source
  'RawJSON'
];


/**
 * Exports all active and inactive QBO Tax Codes.
 *
 * Output sheets:
 *   QBO_TaxCodes
 *   QBO_TaxCodeRates
 *
 * @return {Object} Export row counts.
 */
function exportQboTaxCodes() {

  safeLog_('Starting QBO tax codes export.');

  const taxCodes = qboQueryAllGeneric_(
    'SELECT * FROM TaxCode WHERE Active IN (true, false)',
    'TaxCode'
  );

  safeLog_(`Retrieved ${taxCodes.length} QBO tax codes.`);

  //
  // Parent Tax Codes
  //
  const taxCodeRows = buildTaxCodeRows_(taxCodes);

  writeExport_({
    sheetName: 'QBO_TaxCodes',
    headers: TAX_CODE_HEADERS,
    rows: taxCodeRows,
    columnWidths: {
      [TAX_CODE_HEADERS.indexOf('Name') + 1]: 220,
      [TAX_CODE_HEADERS.indexOf('Description') + 1]: 300,
      [TAX_CODE_HEADERS.indexOf('RawJSON') + 1]: 300
    },
    logMessage: `Exported ${taxCodeRows.length} QBO tax codes.`
  });

  //
  // Tax Code Rate References
  //
  const taxCodeRateRows = buildTaxCodeRateRows_(taxCodes);

  writeExport_({
    sheetName: 'QBO_TaxCodeRates',
    headers: TAX_CODE_RATE_HEADERS,
    rows: taxCodeRateRows,
    columnWidths: {
      [TAX_CODE_RATE_HEADERS.indexOf('TaxCodeName') + 1]: 220,
      [TAX_CODE_RATE_HEADERS.indexOf('TaxRateName') + 1]: 220,
      [TAX_CODE_RATE_HEADERS.indexOf('RawJSON') + 1]: 300
    },
    logMessage:
      `Exported ${taxCodeRateRows.length} QBO tax code rate-reference rows.`
  });

  safeLog_('Completed QBO tax codes export.');

  return {
    taxCodeCount: taxCodeRows.length,
    taxCodeRateCount: taxCodeRateRows.length
  };
}


/**
 * Builds rows for the QBO_TaxCodes sheet.
 *
 * @param {Object[]} taxCodes QBO TaxCode objects.
 * @return {Array[]} Rows matching TAX_CODE_HEADERS.
 */
function buildTaxCodeRows_(taxCodes) {

  return taxCodes.map(taxCode => {
    const meta = extractMeta_(taxCode);

    const salesRateDetails = getTaxRateDetails_(
      taxCode.SalesTaxRateList
    );

    const purchaseRateDetails = getTaxRateDetails_(
      taxCode.PurchaseTaxRateList
    );

    return [
      // Identity
      valueOrBlank_(taxCode.Id),
      valueOrBlank_(taxCode.SyncToken),
      booleanOrBlank_(taxCode.Active),

      // Tax Code
      valueOrBlank_(taxCode.Name),
      valueOrBlank_(taxCode.Description),
      booleanOrBlank_(taxCode.Taxable),
      booleanOrBlank_(taxCode.TaxGroup),
      valueOrBlank_(taxCode.TaxCodeConfigType),

      // Related Rates
      salesRateDetails.length,
      purchaseRateDetails.length,
      salesRateDetails.length + purchaseRateDetails.length,

      // Audit
      valueOrBlank_(meta.createTime),
      valueOrBlank_(meta.lastUpdatedTime),

      // Source
      jsonStringifySafe_(taxCode)
    ];
  });
}


/**
 * Builds child rows for the QBO_TaxCodeRates sheet.
 *
 * A Tax Code can contain rate references in:
 *   SalesTaxRateList
 *   PurchaseTaxRateList
 *
 * @param {Object[]} taxCodes QBO TaxCode objects.
 * @return {Array[]} Rows matching TAX_CODE_RATE_HEADERS.
 */
function buildTaxCodeRateRows_(taxCodes) {

  const rows = [];

  taxCodes.forEach(taxCode => {

    appendTaxCodeRateRows_(
      rows,
      taxCode,
      'Sales',
      getTaxRateDetails_(taxCode.SalesTaxRateList)
    );

    appendTaxCodeRateRows_(
      rows,
      taxCode,
      'Purchase',
      getTaxRateDetails_(taxCode.PurchaseTaxRateList)
    );

  });

  return rows;
}


/**
 * Appends one set of Tax Rate reference rows.
 *
 * @param {Array[]} rows Destination row array.
 * @param {Object} taxCode Parent QBO TaxCode object.
 * @param {string} rateListType Sales or Purchase.
 * @param {Object[]} rateDetails TaxRateDetail objects.
 */
function appendTaxCodeRateRows_(
  rows,
  taxCode,
  rateListType,
  rateDetails
) {

  rateDetails.forEach((rateDetail, index) => {
    const taxRateRef = rateDetail.TaxRateRef || {};

    rows.push([
      // Parent Tax Code
      valueOrBlank_(taxCode.Id),
      valueOrBlank_(taxCode.Name),

      // Rate List
      rateListType,
      index + 1,

      // Referenced Tax Rate
      valueOrBlank_(taxRateRef.value),
      valueOrBlank_(taxRateRef.name),
      valueOrBlank_(rateDetail.TaxType),
      numberOrBlank_(rateDetail.TaxOrder),

      // Source
      jsonStringifySafe_(rateDetail)
    ]);
  });
}


/**
 * Safely extracts TaxRateDetail records from a QBO tax rate list.
 *
 * QBO normally returns:
 *   {
 *     TaxRateDetail: [...]
 *   }
 *
 * This helper also handles a single TaxRateDetail object.
 *
 * @param {Object} taxRateList SalesTaxRateList or PurchaseTaxRateList.
 * @return {Object[]} TaxRateDetail records.
 */
function getTaxRateDetails_(taxRateList) {

  if (!taxRateList || !taxRateList.TaxRateDetail) {
    return [];
  }

  if (Array.isArray(taxRateList.TaxRateDetail)) {
    return taxRateList.TaxRateDetail;
  }

  return [taxRateList.TaxRateDetail];
}