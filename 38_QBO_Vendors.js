/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 38_QBO_Vendors.js
 * Purpose     : Export QBO Vendor master data to structured Google Sheets tables.
 *
 * Public API:
 *   - exportQboVendors()
 *
 * Internal Helpers:
 *   - buildVendorRows_()
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
 * 38_QBO_Vendors.gs
 * QBO Vendor export
 *
 * Output Sheet:
 *   QBO_Vendors
 *
 * Public Functions:
 *   exportQboVendors()
 ***********************/


/**
 * Vendor export columns.
 */
const VENDOR_HEADERS = [

  // Identity
  'Id',
  'SyncToken',
  'Active',

  // Names
  'DisplayName',
  'CompanyName',
  'Title',
  'GivenName',
  'MiddleName',
  'FamilyName',
  'Suffix',
  'PrintOnCheckName',

  // Contact
  'PrimaryPhone',
  'AlternatePhone',
  'MobilePhone',
  'Fax',
  'PrimaryEmail',
  'WebAddress',

  // Billing Address
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
  'BillAddrCountrySubDivisionCode',
  'BillAddrLat',
  'BillAddrLong',

  // Vendor Settings
  'Vendor1099',
  'TaxIdentifier',
  'AccountNumber',
  'Balance',
  'CurrencyCode',
  'CurrencyName',
  'TermId',
  'TermName',

  // Audit
  'CreateTime',
  'LastUpdatedTime',

  // Source
  'RawJSON'
];


/**
 * Exports all active and inactive QBO Vendors.
 *
 * Output sheet:
 *   QBO_Vendors
 *
 * @return {Object} Export row count.
 */
function exportQboVendors() {

  safeLog_('Starting QBO vendors export.');

  const vendors = qboQueryAllGeneric_(
    'SELECT * FROM Vendor WHERE Active IN (true, false)',
    'Vendor'
  );

  safeLog_(`Retrieved ${vendors.length} QBO vendors.`);

  const vendorRows = buildVendorRows_(vendors);

  writeExport_({
    sheetName: 'QBO_Vendors',
    headers: VENDOR_HEADERS,
    rows: vendorRows,
    columnWidths: {
      [VENDOR_HEADERS.indexOf('DisplayName') + 1]: 220,
      [VENDOR_HEADERS.indexOf('CompanyName') + 1]: 220,
      [VENDOR_HEADERS.indexOf('PrimaryEmail') + 1]: 240,
      [VENDOR_HEADERS.indexOf('WebAddress') + 1]: 240,
      [VENDOR_HEADERS.indexOf('BillAddrLine1') + 1]: 240,
      [VENDOR_HEADERS.indexOf('RawJSON') + 1]: 300
    },
    logMessage: `Exported ${vendorRows.length} QBO vendors.`
  });

  safeLog_('Completed QBO vendors export.');

  return {
    vendorCount: vendorRows.length
  };
}


/**
 * Builds rows for the QBO_Vendors sheet.
 *
 * @param {Object[]} vendors QBO Vendor objects.
 * @return {Array[]} Rows matching VENDOR_HEADERS.
 */
function buildVendorRows_(vendors) {

  return vendors.map(vendor => {
    const meta = extractMeta_(vendor);

    return [
      // Identity
      valueOrBlank_(vendor.Id),
      valueOrBlank_(vendor.SyncToken),
      booleanOrBlank_(vendor.Active),

      // Names
      valueOrBlank_(vendor.DisplayName),
      valueOrBlank_(vendor.CompanyName),
      valueOrBlank_(vendor.Title),
      valueOrBlank_(vendor.GivenName),
      valueOrBlank_(vendor.MiddleName),
      valueOrBlank_(vendor.FamilyName),
      valueOrBlank_(vendor.Suffix),
      valueOrBlank_(vendor.PrintOnCheckName),

      // Contact
      nestedValue_(vendor, 'PrimaryPhone.FreeFormNumber'),
      nestedValue_(vendor, 'AlternatePhone.FreeFormNumber'),
      nestedValue_(vendor, 'Mobile.FreeFormNumber'),
      nestedValue_(vendor, 'Fax.FreeFormNumber'),
      nestedValue_(vendor, 'PrimaryEmailAddr.Address'),
      nestedValue_(vendor, 'WebAddr.URI'),

      // Billing Address
      nestedValue_(vendor, 'BillAddr.Id'),
      nestedValue_(vendor, 'BillAddr.Line1'),
      nestedValue_(vendor, 'BillAddr.Line2'),
      nestedValue_(vendor, 'BillAddr.Line3'),
      nestedValue_(vendor, 'BillAddr.Line4'),
      nestedValue_(vendor, 'BillAddr.Line5'),
      nestedValue_(vendor, 'BillAddr.City'),
      nestedValue_(vendor, 'BillAddr.CountrySubDivisionCode'),
      nestedValue_(vendor, 'BillAddr.PostalCode'),
      nestedValue_(vendor, 'BillAddr.Country'),
      nestedValue_(vendor, 'BillAddr.CountrySubDivisionCode'),
      nestedValue_(vendor, 'BillAddr.Lat'),
      nestedValue_(vendor, 'BillAddr.Long'),

      // Vendor Settings
      booleanOrBlank_(vendor.Vendor1099),
      valueOrBlank_(vendor.TaxIdentifier),
      valueOrBlank_(vendor.AcctNum),
      numberOrBlank_(vendor.Balance),
      nestedValue_(vendor, 'CurrencyRef.value'),
      nestedValue_(vendor, 'CurrencyRef.name'),
      nestedValue_(vendor, 'TermRef.value'),
      nestedValue_(vendor, 'TermRef.name'),

      // Audit
      valueOrBlank_(meta.createTime),
      valueOrBlank_(meta.lastUpdatedTime),

      // Source
      jsonStringifySafe_(vendor)
    ];
  });
}