/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 50_QBO_RecurringTransactions.js
 * Purpose     : Export all QBO recurring transaction templates and their
 *               embedded transaction lines.
 *
 * Design:
 *   - No business filtering is applied.
 *   - All recurring transaction types are retained.
 *   - Common fields are followed by transaction-type-specific fields.
 *   - Sales Receipt payment-processing fields reflect only the payload returned
 *     by QBO; they do not apply business interpretation.
 *   - Full embedded and raw JSON payloads are preserved.
 *
 * Output sheets:
 *   - QBO_RecurringTransactions
 *   - QBO_RecurringTransactionLines
 *
 * Public API:
 *   - exportQboRecurringTransactions()
 * ============================================================================
 */

const RECURRING_TRANSACTION_HEADERS = [
  // Identity and recurring metadata
  'RecurringTransactionId',
  'SyncToken',
  'UnderlyingTransactionType',
  'TemplateName',
  'RecurType',
  'Active',

  // Schedule
  'IntervalType',
  'NumInterval',
  'DayOfMonth',
  'DayOfWeek',
  'WeekOfMonth',
  'MonthOfYear',
  'StartDate',
  'EndDate',
  'PreviousDate',
  'NextDate',

  // Embedded transaction identity
  'TransactionId',
  'DocNumber',
  'TxnDate',

  // Customer / vendor
  'CustomerId',
  'CustomerName',
  'VendorId',
  'VendorName',

  // Common payment and delivery
  'PaymentMethodId',
  'PaymentMethodName',
  'EmailStatus',
  'BillEmailAddress',
  'DeliveryType',
  'PrintStatus',

  // Common amounts and content
  'CurrencyCode',
  'CurrencyName',
  'ExchangeRate',
  'TotalAmount',
  'Balance',
  'TotalTax',
  'LineCount',
  'PrivateNote',
  'CustomerMemo',

  // Custom fields
  'CustomField_ServiceAddress',
  'CustomField_DepositToSchedule',
  'CustomField_RentalProperty',
  'CustomField_EngagementType',
  'CustomField_CustomerRole',
  'CustomFieldsJSON',

  // Invoice-specific fields
  'AllowOnlinePayment',
  'AllowOnlineCreditCardPayment',
  'AllowOnlineACHPayment',
  'AllowOnlinePayPalPayment',
  'AllowOnlineAffirmPayment',
  'SalesTermId',
  'SalesTermName',

  // Sales Receipt-specific fields
  'HasCreditCardPayment',
  'CreditCardExpiryMonth',
  'CreditCardExpiryYear',
  'CreditCardProcessingStatus',
  'CreditCardSecurityCodeMatch',
  'CreditCardAvsStreet',
  'CreditCardAvsZip',
  'PaymentProcessingJSON',
  'DepositToAccountId',
  'DepositToAccountName',

  // Payloads and audit
  'RecurringInfoJSON',
  'ScheduleInfoJSON',
  'EmbeddedTransactionJSON',
  'CreateTime',
  'LastUpdatedTime',
  'RawJSON'
];

const RECURRING_TRANSACTION_LINE_HEADERS = [
  // Parent template
  'RecurringTransactionId',
  'TemplateName',
  'RecurringType',
  'UnderlyingTransactionType',

  // Embedded transaction
  'TransactionId',
  'DocNumber',
  'TxnDate',
  'CustomerId',
  'CustomerName',
  'VendorId',
  'VendorName',

  // Line identity
  'LineId',
  'LineNumber',
  'LineLevel',
  'ParentLineId',
  'ParentLineNumber',
  'DetailType',

  // General fields
  'Description',
  'Amount',

  // Item detail
  'ItemId',
  'ItemName',
  'Quantity',
  'UnitPrice',
  'RatePercent',
  'ServiceDate',

  // Account detail
  'AccountId',
  'AccountName',

  // Customer detail on expense lines
  'LineCustomerId',
  'LineCustomerName',
  'BillableStatus',
  'MarkupPercent',

  // Classification and tax
  'ClassId',
  'ClassName',
  'TaxCodeId',
  'TaxCodeName',

  // Discount detail
  'DiscountPercent',
  'DiscountAccountId',
  'DiscountAccountName',

  // Group detail
  'GroupItemId',
  'GroupItemName',
  'GroupLineCount',

  // Source
  'LineDetailJSON',
  'RawJSON'
];

/**
 * Exports all recurring transaction templates without filtering.
 *
 * @return {Object} Export row counts.
 */
function exportQboRecurringTransactions() {
  safeLog_('Starting QBO recurring transactions export.');

  const recurringTransactions = qboQueryAllGeneric_(
    'SELECT * FROM RecurringTransaction',
    'RecurringTransaction'
  );

  safeLog_(
    `Retrieved ${recurringTransactions.length} QBO recurring transactions.`
  );

  const parentRows = buildRecurringTransactionRows_(recurringTransactions);
  const lineRows = buildRecurringTransactionLineRows_(recurringTransactions);

  writeExport_({
    sheetName: 'QBO_RecurringTransactions',
    headers: RECURRING_TRANSACTION_HEADERS,
    rows: parentRows,
    autoResize: false,
    columnWidths: {
      [RECURRING_TRANSACTION_HEADERS.indexOf('TemplateName') + 1]: 240,
      [RECURRING_TRANSACTION_HEADERS.indexOf('UnderlyingTransactionType') + 1]: 190,
      [RECURRING_TRANSACTION_HEADERS.indexOf('CustomerName') + 1]: 240,
      [RECURRING_TRANSACTION_HEADERS.indexOf('VendorName') + 1]: 240,
      [RECURRING_TRANSACTION_HEADERS.indexOf('PaymentMethodName') + 1]: 200,
      [RECURRING_TRANSACTION_HEADERS.indexOf('BillEmailAddress') + 1]: 240,
      [RECURRING_TRANSACTION_HEADERS.indexOf('PrivateNote') + 1]: 300,
      [RECURRING_TRANSACTION_HEADERS.indexOf('CustomerMemo') + 1]: 300,
      [RECURRING_TRANSACTION_HEADERS.indexOf('CustomFieldsJSON') + 1]: 300,
      [RECURRING_TRANSACTION_HEADERS.indexOf('PaymentProcessingJSON') + 1]: 300,
      [RECURRING_TRANSACTION_HEADERS.indexOf('RecurringInfoJSON') + 1]: 300,
      [RECURRING_TRANSACTION_HEADERS.indexOf('ScheduleInfoJSON') + 1]: 300,
      [RECURRING_TRANSACTION_HEADERS.indexOf('EmbeddedTransactionJSON') + 1]: 300,
      [RECURRING_TRANSACTION_HEADERS.indexOf('RawJSON') + 1]: 300
    },
    numberFormats: {
      [RECURRING_TRANSACTION_HEADERS.indexOf('StartDate') + 1]: 'yyyy-mm-dd',
      [RECURRING_TRANSACTION_HEADERS.indexOf('EndDate') + 1]: 'yyyy-mm-dd',
      [RECURRING_TRANSACTION_HEADERS.indexOf('PreviousDate') + 1]: 'yyyy-mm-dd',
      [RECURRING_TRANSACTION_HEADERS.indexOf('NextDate') + 1]: 'yyyy-mm-dd',
      [RECURRING_TRANSACTION_HEADERS.indexOf('TxnDate') + 1]: 'yyyy-mm-dd',
      [RECURRING_TRANSACTION_HEADERS.indexOf('ExchangeRate') + 1]: '0.000000',
      [RECURRING_TRANSACTION_HEADERS.indexOf('TotalAmount') + 1]: '$#,##0.00',
      [RECURRING_TRANSACTION_HEADERS.indexOf('Balance') + 1]: '$#,##0.00',
      [RECURRING_TRANSACTION_HEADERS.indexOf('TotalTax') + 1]: '$#,##0.00'
    },
    logMessage: `Exported ${parentRows.length} QBO recurring transactions.`
  });

  writeExport_({
    sheetName: 'QBO_RecurringTransactionLines',
    headers: RECURRING_TRANSACTION_LINE_HEADERS,
    rows: lineRows,
    autoResize: false,
    columnWidths: {
      [RECURRING_TRANSACTION_LINE_HEADERS.indexOf('TemplateName') + 1]: 240,
      [RECURRING_TRANSACTION_LINE_HEADERS.indexOf('CustomerName') + 1]: 240,
      [RECURRING_TRANSACTION_LINE_HEADERS.indexOf('VendorName') + 1]: 240,
      [RECURRING_TRANSACTION_LINE_HEADERS.indexOf('Description') + 1]: 300,
      [RECURRING_TRANSACTION_LINE_HEADERS.indexOf('ItemName') + 1]: 240,
      [RECURRING_TRANSACTION_LINE_HEADERS.indexOf('AccountName') + 1]: 240,
      [RECURRING_TRANSACTION_LINE_HEADERS.indexOf('LineDetailJSON') + 1]: 300,
      [RECURRING_TRANSACTION_LINE_HEADERS.indexOf('RawJSON') + 1]: 300
    },
    numberFormats: {
      [RECURRING_TRANSACTION_LINE_HEADERS.indexOf('TxnDate') + 1]: 'yyyy-mm-dd',
      [RECURRING_TRANSACTION_LINE_HEADERS.indexOf('Amount') + 1]: '$#,##0.00',
      [RECURRING_TRANSACTION_LINE_HEADERS.indexOf('Quantity') + 1]: '0.00',
      [RECURRING_TRANSACTION_LINE_HEADERS.indexOf('UnitPrice') + 1]: '$#,##0.00',
      [RECURRING_TRANSACTION_LINE_HEADERS.indexOf('RatePercent') + 1]: '0.00',
      [RECURRING_TRANSACTION_LINE_HEADERS.indexOf('MarkupPercent') + 1]: '0.00',
      [RECURRING_TRANSACTION_LINE_HEADERS.indexOf('DiscountPercent') + 1]: '0.00'
    },
    logMessage: `Exported ${lineRows.length} QBO recurring transaction line rows.`
  });

  safeLog_('Completed QBO recurring transactions export.');

  return {
    recurringTransactionCount: parentRows.length,
    recurringTransactionLineCount: lineRows.length
  };
}

function buildRecurringTransactionRows_(recurringTransactions) {
  return normalizeArray_(recurringTransactions).map(recurring => {
    const recurringInfo = getRecurringInfo_(recurring);
    const schedule = getRecurringScheduleInfo_(recurring);
    const transaction = getRecurringEmbeddedTransaction_(recurring);
    const transactionType = detectRecurringTransactionType_(recurring, transaction);
    const isInvoice = transactionType === 'Invoice';
    const isSalesReceipt = transactionType === 'SalesReceipt';
    const creditCardPayment = isSalesReceipt &&
      transaction.CreditCardPayment &&
      typeof transaction.CreditCardPayment === 'object'
      ? transaction.CreditCardPayment
      : null;
    const creditChargeInfo = creditCardPayment
      ? creditCardPayment.CreditChargeInfo || {}
      : {};
    const creditChargeResponse = creditCardPayment
      ? creditCardPayment.CreditChargeResponse || {}
      : {};
    const customFields = normalizeArray_(transaction.CustomField);
    const meta = extractMeta_(transaction);

    return [
      valueOrBlank_(firstPresentValue_([
        nestedValue_(transaction, 'RecurDataRef.value'),
        recurring.Id,
        transaction.Id
      ])),
      valueOrBlank_(firstPresentValue_([recurring.SyncToken, transaction.SyncToken])),
      valueOrBlank_(transactionType),
      valueOrBlank_(firstPresentValue_([
        recurring.Name,
        recurring.TemplateName,
        recurringInfo.Name,
        recurringInfo.TemplateName
      ])),
      valueOrBlank_(firstPresentValue_([
        recurring.RecurType,
        recurring.RecurringType,
        recurringInfo.RecurType,
        recurringInfo.Type
      ])),
      booleanOrBlank_(firstPresentValue_([
        recurring.Active,
        recurringInfo.Active,
        recurring.Enabled
      ])),

      valueOrBlank_(firstPresentValue_([
        schedule.IntervalType,
        schedule.Interval,
        schedule.Frequency
      ])),
      numberOrBlank_(firstPresentValue_([
        schedule.NumInterval,
        schedule.IntervalCount,
        schedule.Every
      ])),
      numberOrBlank_(schedule.DayOfMonth),
      valueOrBlank_(schedule.DayOfWeek),
      valueOrBlank_(schedule.WeekOfMonth),
      valueOrBlank_(schedule.MonthOfYear),
      valueOrBlank_(firstPresentValue_([schedule.StartDate, recurringInfo.StartDate])),
      valueOrBlank_(firstPresentValue_([schedule.EndDate, recurringInfo.EndDate])),
      valueOrBlank_(firstPresentValue_([schedule.PreviousDate, recurringInfo.PreviousDate])),
      valueOrBlank_(firstPresentValue_([schedule.NextDate, recurringInfo.NextDate])),

      valueOrBlank_(transaction.Id),
      valueOrBlank_(transaction.DocNumber),
      valueOrBlank_(transaction.TxnDate),

      nestedValue_(transaction, 'CustomerRef.value'),
      nestedValue_(transaction, 'CustomerRef.name'),
      nestedValue_(transaction, 'VendorRef.value'),
      nestedValue_(transaction, 'VendorRef.name'),

      nestedValue_(transaction, 'PaymentMethodRef.value'),
      nestedValue_(transaction, 'PaymentMethodRef.name'),
      valueOrBlank_(transaction.EmailStatus),
      nestedValue_(transaction, 'BillEmail.Address'),
      nestedValue_(transaction, 'DeliveryInfo.DeliveryType'),
      valueOrBlank_(transaction.PrintStatus),

      nestedValue_(transaction, 'CurrencyRef.value'),
      nestedValue_(transaction, 'CurrencyRef.name'),
      numberOrBlank_(transaction.ExchangeRate),
      numberOrBlank_(transaction.TotalAmt),
      numberOrBlank_(transaction.Balance),
      numberOrBlank_(nestedValue_(transaction, 'TxnTaxDetail.TotalTax')),
      normalizeArray_(transaction.Line).length,
      valueOrBlank_(transaction.PrivateNote),
      valueOrBlank_(firstPresentValue_([
        nestedValue_(transaction, 'CustomerMemo.value'),
        transaction.CustomerMemo
      ])),

      getRecurringCustomFieldValue_(customFields, 'Service Address'),
      getRecurringCustomFieldValue_(customFields, 'Deposit To Schedule'),
      getRecurringCustomFieldValue_(customFields, 'Rental Property'),
      getRecurringCustomFieldValue_(customFields, 'Engagement Type'),
      getRecurringCustomFieldValue_(customFields, 'Customer Role'),
      jsonStringifyCellSafe_(customFields),

      isInvoice ? booleanOrBlank_(transaction.AllowOnlinePayment) : '',
      isInvoice ? booleanOrBlank_(transaction.AllowOnlineCreditCardPayment) : '',
      isInvoice ? booleanOrBlank_(transaction.AllowOnlineACHPayment) : '',
      isInvoice ? booleanOrBlank_(transaction.AllowOnlinePayPalPayment) : '',
      isInvoice ? booleanOrBlank_(transaction.AllowOnlineAffirmPayment) : '',
      isInvoice ? nestedValue_(transaction, 'SalesTermRef.value') : '',
      isInvoice ? nestedValue_(transaction, 'SalesTermRef.name') : '',

      isSalesReceipt ? Boolean(creditCardPayment) : '',
      isSalesReceipt ? numberOrBlank_(creditChargeInfo.CcExpiryMonth) : '',
      isSalesReceipt ? numberOrBlank_(creditChargeInfo.CcExpiryYear) : '',
      isSalesReceipt ? valueOrBlank_(creditChargeResponse.Status) : '',
      isSalesReceipt ? valueOrBlank_(creditChargeResponse.CardSecurityCodeMatch) : '',
      isSalesReceipt ? valueOrBlank_(creditChargeResponse.AvsStreet) : '',
      isSalesReceipt ? valueOrBlank_(creditChargeResponse.AvsZip) : '',
      isSalesReceipt && creditCardPayment
        ? jsonStringifyCellSafe_(creditCardPayment)
        : '',
      isSalesReceipt ? nestedValue_(transaction, 'DepositToAccountRef.value') : '',
      isSalesReceipt ? nestedValue_(transaction, 'DepositToAccountRef.name') : '',

      jsonStringifyCellSafe_(recurringInfo),
      jsonStringifyCellSafe_(schedule),
      jsonStringifyCellSafe_(transaction),
      meta.createTime,
      meta.lastUpdatedTime,
      jsonStringifyCellSafe_(recurring)
    ];
  });
}

/**
 * Returns the value of a named QBO custom field.
 * Matching ignores spaces and punctuation so known field names remain stable.
 *
 * @param {Array} customFields QBO CustomField array.
 * @param {string} fieldName Expected field name.
 * @return {*} Custom field value or blank.
 */
function getRecurringCustomFieldValue_(customFields, fieldName) {
  const target = normalizeRecurringCustomFieldName_(fieldName);
  const match = normalizeArray_(customFields).find(field =>
    normalizeRecurringCustomFieldName_(field && field.Name) === target
  );

  if (!match) {
    return '';
  }

  return valueOrBlank_(firstPresentValue_([
    match.StringValue,
    match.NumberValue,
    match.BooleanValue,
    match.DateValue
  ]));
}

function normalizeRecurringCustomFieldName_(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

function buildRecurringTransactionLineRows_(recurringTransactions) {
  const rows = [];

  normalizeArray_(recurringTransactions).forEach(recurring => {
    const recurringInfo = getRecurringInfo_(recurring);
    const transaction = getRecurringEmbeddedTransaction_(recurring);
    const transactionType = detectRecurringTransactionType_(recurring, transaction);
    const recurringId = firstPresentValue_([recurring.Id, transaction.Id]);
    const templateName = firstPresentValue_([
      recurring.Name,
      recurring.TemplateName,
      recurringInfo.Name,
      recurringInfo.TemplateName
    ]);
    const recurringType = firstPresentValue_([
      recurring.RecurType,
      recurring.RecurringType,
      recurringInfo.RecurType,
      recurringInfo.Type
    ]);

    appendRecurringLineRows_(
      rows,
      normalizeArray_(transaction.Line),
      {
        recurringId: recurringId,
        templateName: templateName,
        recurringType: recurringType,
        transactionType: transactionType,
        transaction: transaction,
        level: 0,
        parentLineId: '',
        parentLineNumber: ''
      }
    );
  });

  return rows;
}

function appendRecurringLineRows_(rows, lines, context) {
  normalizeArray_(lines).forEach((line, index) => {
    const lineNumber = firstPresentValue_([line.LineNum, index + 1]);
    const detailType = valueOrBlank_(line.DetailType);
    const detail = detailType && line[detailType]
      ? line[detailType]
      : {};

    const sales = line.SalesItemLineDetail || {};
    const accountExpense = line.AccountBasedExpenseLineDetail || {};
    const itemExpense = line.ItemBasedExpenseLineDetail || {};
    const discount = line.DiscountLineDetail || {};
    const group = line.GroupLineDetail || {};

    const itemDetail = Object.keys(sales).length ? sales : itemExpense;
    const accountRef = firstPresentValue_([
      accountExpense.AccountRef,
      itemExpense.AccountRef,
      detail.AccountRef
    ]) || {};
    const customerRef = firstPresentValue_([
      accountExpense.CustomerRef,
      itemExpense.CustomerRef,
      detail.CustomerRef
    ]) || {};
    const classRef = firstPresentValue_([
      sales.ClassRef,
      accountExpense.ClassRef,
      itemExpense.ClassRef,
      detail.ClassRef
    ]) || {};
    const taxCodeRef = firstPresentValue_([
      sales.TaxCodeRef,
      accountExpense.TaxCodeRef,
      itemExpense.TaxCodeRef,
      detail.TaxCodeRef
    ]) || {};

    rows.push([
      valueOrBlank_(context.recurringId),
      valueOrBlank_(context.templateName),
      valueOrBlank_(context.recurringType),
      valueOrBlank_(context.transactionType),

      valueOrBlank_(context.transaction.Id),
      valueOrBlank_(context.transaction.DocNumber),
      valueOrBlank_(context.transaction.TxnDate),
      nestedValue_(context.transaction, 'CustomerRef.value'),
      nestedValue_(context.transaction, 'CustomerRef.name'),
      nestedValue_(context.transaction, 'VendorRef.value'),
      nestedValue_(context.transaction, 'VendorRef.name'),

      valueOrBlank_(line.Id),
      valueOrBlank_(lineNumber),
      context.level,
      valueOrBlank_(context.parentLineId),
      valueOrBlank_(context.parentLineNumber),
      detailType,

      valueOrBlank_(line.Description),
      numberOrBlank_(line.Amount),

      valueOrBlank_(nestedValue_(itemDetail, 'ItemRef.value')),
      valueOrBlank_(nestedValue_(itemDetail, 'ItemRef.name')),
      numberOrBlank_(itemDetail.Qty),
      numberOrBlank_(itemDetail.UnitPrice),
      numberOrBlank_(itemDetail.RatePercent),
      valueOrBlank_(itemDetail.ServiceDate),

      valueOrBlank_(accountRef.value),
      valueOrBlank_(accountRef.name),

      valueOrBlank_(customerRef.value),
      valueOrBlank_(customerRef.name),
      valueOrBlank_(firstPresentValue_([
        accountExpense.BillableStatus,
        itemExpense.BillableStatus,
        detail.BillableStatus
      ])),
      numberOrBlank_(firstPresentValue_([
        accountExpense.MarkupInfo && accountExpense.MarkupInfo.Percent,
        itemExpense.MarkupInfo && itemExpense.MarkupInfo.Percent,
        detail.MarkupInfo && detail.MarkupInfo.Percent
      ])),

      valueOrBlank_(classRef.value),
      valueOrBlank_(classRef.name),
      valueOrBlank_(taxCodeRef.value),
      valueOrBlank_(taxCodeRef.name),

      numberOrBlank_(discount.DiscountPercent),
      nestedValue_(discount, 'DiscountAccountRef.value'),
      nestedValue_(discount, 'DiscountAccountRef.name'),

      nestedValue_(group, 'GroupItemRef.value'),
      nestedValue_(group, 'GroupItemRef.name'),
      normalizeArray_(group.Line).length,

      jsonStringifyCellSafe_(detail),
      jsonStringifyCellSafe_(line)
    ]);

    if (normalizeArray_(group.Line).length > 0) {
      appendRecurringLineRows_(rows, group.Line, {
        recurringId: context.recurringId,
        templateName: context.templateName,
        recurringType: context.recurringType,
        transactionType: context.transactionType,
        transaction: context.transaction,
        level: context.level + 1,
        parentLineId: line.Id || '',
        parentLineNumber: lineNumber
      });
    }
  });
}

function getRecurringInfo_(recurring) {
  return firstPresentValue_([
    recurring.RecurringInfo,
    recurring.RecurData,
    recurring.RecurringData,
    recurring.RecurrenceInfo
  ]) || {};
}

function getRecurringScheduleInfo_(recurring) {
  const recurringInfo = getRecurringInfo_(recurring);

  return firstPresentValue_([
    recurring.ScheduleInfo,
    recurring.Schedule,
    recurringInfo.ScheduleInfo,
    recurringInfo.Schedule
  ]) || {};
}

function getRecurringEmbeddedTransaction_(recurring) {
  const knownTypes = [
    'SalesReceipt',
    'Invoice',
    'Estimate',
    'CreditMemo',
    'RefundReceipt',
    'Bill',
    'Purchase',
    'Check',
    'Expense',
    'JournalEntry',
    'Deposit',
    'Transfer',
    'PurchaseOrder',
    'VendorCredit'
  ];

  const direct = firstPresentValue_([
    recurring.Transaction,
    recurring.Txn,
    recurring.TemplateTransaction,
    recurring.TransactionTemplate
  ]);

  if (direct && typeof direct === 'object') {
    return direct;
  }

  for (let index = 0; index < knownTypes.length; index++) {
    const candidate = recurring[knownTypes[index]];

    if (candidate && typeof candidate === 'object') {
      return candidate;
    }
  }

  // Some payloads may return the transaction fields and recurrence fields
  // on the same object. Preserve that shape rather than returning blank data.
  if (
    recurring.Line ||
    recurring.CustomerRef ||
    recurring.VendorRef ||
    recurring.TotalAmt ||
    recurring.TxnDate
  ) {
    return recurring;
  }

  return {};
}

function detectRecurringTransactionType_(recurring, transaction) {
  const explicitType = firstPresentValue_([
    recurring.TransactionType,
    recurring.TxnType,
    recurring.EntityType,
    nestedValue_(recurring, 'Transaction.type'),
    nestedValue_(recurring, 'Transaction.Type'),
    transaction.TransactionType,
    transaction.TxnType,
    transaction.EntityType,
    transaction.type,
    transaction.Type
  ]);

  if (explicitType !== '' && explicitType !== null && explicitType !== undefined) {
    return explicitType;
  }

  const knownTypes = [
    'SalesReceipt',
    'Invoice',
    'Estimate',
    'CreditMemo',
    'RefundReceipt',
    'Bill',
    'Purchase',
    'Check',
    'Expense',
    'JournalEntry',
    'Deposit',
    'Transfer',
    'PurchaseOrder',
    'VendorCredit'
  ];

  for (let index = 0; index < knownTypes.length; index++) {
    if (recurring[knownTypes[index]]) {
      return knownTypes[index];
    }
  }

  if (transaction.CustomerRef && transaction.DepositToAccountRef) {
    return 'SalesReceipt';
  }

  if (transaction.CustomerRef && transaction.DueDate) {
    return 'Invoice';
  }

  if (transaction.VendorRef && transaction.APAccountRef) {
    return 'Bill';
  }

  return '';
}

function findFirstPathValue_(object, paths) {
  for (let index = 0; index < paths.length; index++) {
    const value = nestedValue_(object, paths[index]);

    if (value !== '' && value !== null && value !== undefined) {
      return value;
    }
  }

  return '';
}

function firstPresentValue_(values) {
  for (let index = 0; index < values.length; index++) {
    const value = values[index];

    if (value !== '' && value !== null && value !== undefined) {
      return value;
    }
  }

  return '';
}

