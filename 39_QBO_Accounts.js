/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 39_QBO_Accounts.js
 * Purpose     : Export the complete QBO Chart of Accounts to a structured
 *               Google Sheets table.
 *
 * Public API:
 *   - exportQboAccounts()
 *
 * Internal Helpers:
 *   - buildAccountRows_()
 *
 * Dependencies:
 *   - qboQueryAllGeneric_()
 *   - writeExport_()
 *   - extractMeta_()
 *   - valueOrBlank_()
 *   - booleanOrBlank_()
 *   - nestedValue_()
 *   - numberOrBlank_()
 *   - jsonStringifyCellSafe_()
 * ============================================================================
 */

const ACCOUNT_HEADERS = [
  // Identity and status
  'Id',
  'SyncToken',
  'Active',

  // Name and hierarchy
  'Name',
  'FullyQualifiedName',
  'Description',
  'AccountNumber',
  'SubAccount',
  'ParentAccountId',
  'ParentAccountName',

  // Classification
  'Classification',
  'AccountType',
  'AccountSubType',

  // Balances
  'CurrentBalance',
  'CurrentBalanceWithSubAccounts',

  // Currency and tax
  'CurrencyCode',
  'CurrencyName',
  'TaxCodeId',
  'TaxCodeName',

  // Additional account properties
  'BankNumber',
  'OpeningBalance',
  'OpeningBalanceDate',

  // Reference objects
  'ParentRefJSON',
  'CurrencyRefJSON',
  'TaxCodeRefJSON',

  // Audit
  'CreateTime',
  'LastUpdatedTime',

  // Source
  'RawJSON'
];

/**
 * Exports all active and inactive QBO Accounts.
 *
 * Output sheet:
 *   QBO_Accounts
 *
 * @return {Object} Export row count.
 */
function exportQboAccounts() {
  safeLog_('Starting QBO chart of accounts export.');

  const accounts = qboQueryAllGeneric_(
    'SELECT * FROM Account WHERE Active IN (true, false)',
    'Account'
  );

  safeLog_(`Retrieved ${accounts.length} QBO accounts.`);

  const rows = buildAccountRows_(accounts);

  writeExport_({
    sheetName: 'QBO_Accounts',
    headers: ACCOUNT_HEADERS,
    rows: rows,
    autoResize: false,

    columnWidths: {
      [ACCOUNT_HEADERS.indexOf('Name') + 1]: 220,
      [ACCOUNT_HEADERS.indexOf('FullyQualifiedName') + 1]: 300,
      [ACCOUNT_HEADERS.indexOf('Description') + 1]: 300,
      [ACCOUNT_HEADERS.indexOf('AccountType') + 1]: 180,
      [ACCOUNT_HEADERS.indexOf('AccountSubType') + 1]: 220,
      [ACCOUNT_HEADERS.indexOf('ParentRefJSON') + 1]: 300,
      [ACCOUNT_HEADERS.indexOf('CurrencyRefJSON') + 1]: 300,
      [ACCOUNT_HEADERS.indexOf('TaxCodeRefJSON') + 1]: 300,
      [ACCOUNT_HEADERS.indexOf('RawJSON') + 1]: 300
    },


    numberFormats: {
      [ACCOUNT_HEADERS.indexOf('CurrentBalance') + 1]: '$#,##0.00',
      [ACCOUNT_HEADERS.indexOf('CurrentBalanceWithSubAccounts') + 1]: '$#,##0.00',
      [ACCOUNT_HEADERS.indexOf('OpeningBalance') + 1]: '$#,##0.00',
      [ACCOUNT_HEADERS.indexOf('OpeningBalanceDate') + 1]: 'yyyy-mm-dd'
    },

    logMessage: `Exported ${rows.length} QBO accounts.`
  });

  safeLog_('Completed QBO chart of accounts export.');

  return {
    accountCount: rows.length
  };
}

/**
 * Builds Chart of Accounts export rows.
 *
 * @param {Array} accounts QBO Account objects.
 * @return {Array<Array<*>>} Export rows.
 */
function buildAccountRows_(accounts) {
  return normalizeArray_(accounts).map(account => {
    const meta = extractMeta_(account);

    return [
      valueOrBlank_(account.Id),
      valueOrBlank_(account.SyncToken),
      booleanOrBlank_(account.Active),

      valueOrBlank_(account.Name),
      valueOrBlank_(account.FullyQualifiedName),
      valueOrBlank_(account.Description),
      valueOrBlank_(account.AcctNum),
      booleanOrBlank_(account.SubAccount),
      nestedValue_(account, 'ParentRef.value'),
      nestedValue_(account, 'ParentRef.name'),

      valueOrBlank_(account.Classification),
      valueOrBlank_(account.AccountType),
      valueOrBlank_(account.AccountSubType),

      numberOrBlank_(account.CurrentBalance),
      numberOrBlank_(account.CurrentBalanceWithSubAccounts),

      nestedValue_(account, 'CurrencyRef.value'),
      nestedValue_(account, 'CurrencyRef.name'),
      nestedValue_(account, 'TaxCodeRef.value'),
      nestedValue_(account, 'TaxCodeRef.name'),

      valueOrBlank_(account.BankNum),
      numberOrBlank_(account.OpeningBalance),
      valueOrBlank_(account.OpeningBalanceDate),

      jsonStringifyCellSafe_(account.ParentRef),
      jsonStringifyCellSafe_(account.CurrencyRef),
      jsonStringifyCellSafe_(account.TaxCodeRef),

      meta.createTime,
      meta.lastUpdatedTime,

      jsonStringifyCellSafe_(account)
    ];
  });
}
