/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 30_QBO_Customers.js
 * Purpose     : Export QBO Customer master data to structured Google Sheets tables.
 *
 * Public API:
 *   - exportQboCustomers()
 *
 * Internal Helpers:
 *   - discoverCustomerCustomFields_()
 *   - buildCustomFieldHeader_()
 *   - getCustomerCustomFieldValues_()
 *   - extractCustomFieldValue_()
 *   - nestedValue_()
 *   - normalizeCellValue_()
 *   - valueOrBlank_()
 *   - booleanOrBlank_()
 *   - preferredDeliveryFlag_()
 *   - sanitizeHeader_()
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
 *   - 2026-09-10: Added governed Customer business-state fields IsProject and
 *     ResaleNum to the flattened export contract.
 * ============================================================================
 */


/***********************
 * 30_QBO_Customers.gs
 * Comprehensive QBO customer export
 ***********************/

/**
 * Pulls active and inactive QBO customers into QBO_Customers.
 *
 * Includes:
 * - Standard Customer properties
 * - Contact information
 * - Billing and shipping addresses
 * - Parent/project hierarchy
 * - Tax, currency, terms, and delivery properties
 * - Every custom field returned by QBO
 * - Complete source object in RawJSON
 */
function exportQboCustomers() {
  safeLog_('Starting comprehensive QBO customer export.');

  const customers = qboQueryAllGeneric_(
  'SELECT * FROM Customer WHERE Active IN (true, false)',
  'Customer',
  {
    include: 'enhancedAllCustomFields'
  }
);

  const customFieldColumns = discoverCustomerCustomFields_(customers);

  const standardHeaders = [
    'Id',
    'SyncToken',
    'Active',

    'DisplayName',
    'FullyQualifiedName',
    'CompanyName',
    'Title',
    'GivenName',
    'MiddleName',
    'FamilyName',
    'Suffix',
    'PrintOnCheckName',

    'PrimaryEmail',
    'PrimaryPhone',
    'AlternatePhone',
    'Mobile',
    'Fax',
    'WebAddress',

    'BillAddressId',
    'BillAddressLine1',
    'BillAddressLine2',
    'BillAddressLine3',
    'BillAddressLine4',
    'BillAddressLine5',
    'BillAddressCity',
    'BillAddressState',
    'BillAddressPostalCode',
    'BillAddressCountry',
    'BillAddressCountryCode',
    'BillAddressLat',
    'BillAddressLong',
    'BillAddressNote',

    'ShipAddressId',
    'ShipAddressLine1',
    'ShipAddressLine2',
    'ShipAddressLine3',
    'ShipAddressLine4',
    'ShipAddressLine5',
    'ShipAddressCity',
    'ShipAddressState',
    'ShipAddressPostalCode',
    'ShipAddressCountry',
    'ShipAddressCountryCode',
    'ShipAddressLat',
    'ShipAddressLong',
    'ShipAddressNote',

    'Job',
    'BillWithParent',
    'ParentId',
    'ParentName',
    'Level',
    'IsProject',

    'CustomerTypeId',
    'CustomerTypeName',

    'Balance',
    'BalanceWithJobs',
    'OpenBalanceDate',

    'Taxable',
    'TaxCodeId',
    'TaxCodeName',
    'DefaultTaxCodeId',
    'DefaultTaxCodeName',
    'TaxExemptionReasonId',
    'TaxExemptionReasonName',
    'PrimaryTaxIdentifier',
    'SecondaryTaxIdentifier',
    'ResaleNum',

    'CurrencyId',
    'CurrencyName',
    'ExchangeRate',

    'TermsId',
    'TermsName',

    'PaymentMethodId',
    'PaymentMethodName',

    'SalesTermId',
    'SalesTermName',

    'PreferredDeliveryMethod',
    'PreferredEmailDelivery',
    'PreferredPrintDelivery',

    'Notes',
    'Source',

    'CreateTime',
    'LastUpdatedTime'
  ];

  const customHeaders = customFieldColumns.map(
    field => field.header
  );

  const headers = [
    ...standardHeaders,
    ...customHeaders,
    'CustomFieldsJSON',
    'RawJSON'
  ];

  const rows = customers.map(customer => {
    const meta = extractMeta_(customer);

    const customFieldValues = getCustomerCustomFieldValues_(
      customer,
      customFieldColumns
    );

    return [
      valueOrBlank_(customer.Id),
      valueOrBlank_(customer.SyncToken),
      booleanOrBlank_(customer.Active),

      valueOrBlank_(customer.DisplayName),
      valueOrBlank_(customer.FullyQualifiedName),
      valueOrBlank_(customer.CompanyName),
      valueOrBlank_(customer.Title),
      valueOrBlank_(customer.GivenName),
      valueOrBlank_(customer.MiddleName),
      valueOrBlank_(customer.FamilyName),
      valueOrBlank_(customer.Suffix),
      valueOrBlank_(customer.PrintOnCheckName),

      nestedValue_(customer, 'PrimaryEmailAddr.Address'),
      nestedValue_(customer, 'PrimaryPhone.FreeFormNumber'),
      nestedValue_(customer, 'AlternatePhone.FreeFormNumber'),
      nestedValue_(customer, 'Mobile.FreeFormNumber'),
      nestedValue_(customer, 'Fax.FreeFormNumber'),
      nestedValue_(customer, 'WebAddr.URI'),

      nestedValue_(customer, 'BillAddr.Id'),
      nestedValue_(customer, 'BillAddr.Line1'),
      nestedValue_(customer, 'BillAddr.Line2'),
      nestedValue_(customer, 'BillAddr.Line3'),
      nestedValue_(customer, 'BillAddr.Line4'),
      nestedValue_(customer, 'BillAddr.Line5'),
      nestedValue_(customer, 'BillAddr.City'),
      nestedValue_(customer, 'BillAddr.CountrySubDivisionCode'),
      nestedValue_(customer, 'BillAddr.PostalCode'),
      nestedValue_(customer, 'BillAddr.Country'),
      nestedValue_(customer, 'BillAddr.CountryCode'),
      nestedValue_(customer, 'BillAddr.Lat'),
      nestedValue_(customer, 'BillAddr.Long'),
      nestedValue_(customer, 'BillAddr.Note'),

      nestedValue_(customer, 'ShipAddr.Id'),
      nestedValue_(customer, 'ShipAddr.Line1'),
      nestedValue_(customer, 'ShipAddr.Line2'),
      nestedValue_(customer, 'ShipAddr.Line3'),
      nestedValue_(customer, 'ShipAddr.Line4'),
      nestedValue_(customer, 'ShipAddr.Line5'),
      nestedValue_(customer, 'ShipAddr.City'),
      nestedValue_(customer, 'ShipAddr.CountrySubDivisionCode'),
      nestedValue_(customer, 'ShipAddr.PostalCode'),
      nestedValue_(customer, 'ShipAddr.Country'),
      nestedValue_(customer, 'ShipAddr.CountryCode'),
      nestedValue_(customer, 'ShipAddr.Lat'),
      nestedValue_(customer, 'ShipAddr.Long'),
      nestedValue_(customer, 'ShipAddr.Note'),

      booleanOrBlank_(customer.Job),
      booleanOrBlank_(customer.BillWithParent),
      nestedValue_(customer, 'ParentRef.value'),
      nestedValue_(customer, 'ParentRef.name'),
      numberOrBlank_(customer.Level),
      booleanOrBlank_(customer.IsProject),

      nestedValue_(customer, 'CustomerTypeRef.value'),
      nestedValue_(customer, 'CustomerTypeRef.name'),

      numberOrBlank_(customer.Balance),
      numberOrBlank_(customer.BalanceWithJobs),
      valueOrBlank_(customer.OpenBalanceDate),

      booleanOrBlank_(customer.Taxable),
      nestedValue_(customer, 'TaxCodeRef.value'),
      nestedValue_(customer, 'TaxCodeRef.name'),
      nestedValue_(customer, 'DefaultTaxCodeRef.value'),
      nestedValue_(customer, 'DefaultTaxCodeRef.name'),
      nestedValue_(customer, 'TaxExemptionReasonId'),
      nestedValue_(customer, 'TaxExemptionReasonRef.name'),
      valueOrBlank_(customer.PrimaryTaxIdentifier),
      valueOrBlank_(customer.SecondaryTaxIdentifier),
      valueOrBlank_(customer.ResaleNum),

      nestedValue_(customer, 'CurrencyRef.value'),
      nestedValue_(customer, 'CurrencyRef.name'),
      numberOrBlank_(customer.ExchangeRate),

      nestedValue_(customer, 'TermsRef.value'),
      nestedValue_(customer, 'TermsRef.name'),

      nestedValue_(customer, 'PaymentMethodRef.value'),
      nestedValue_(customer, 'PaymentMethodRef.name'),

      nestedValue_(customer, 'SalesTermRef.value'),
      nestedValue_(customer, 'SalesTermRef.name'),

      valueOrBlank_(customer.PreferredDeliveryMethod),
      preferredDeliveryFlag_(
        customer.PreferredDeliveryMethod,
        'Email'
      ),
      preferredDeliveryFlag_(
        customer.PreferredDeliveryMethod,
        'Print'
      ),

      valueOrBlank_(customer.Notes),
      valueOrBlank_(customer.Source),

      valueOrBlank_(meta.createTime),
      valueOrBlank_(meta.lastUpdatedTime),

      ...customFieldValues,

      jsonStringifySafe_(customer.CustomField || []),
      jsonStringifySafe_(customer)
    ];
  });

writeExport_({
  sheetName: 'QBO_Customers',
  headers: headers,
  rows: rows,
  columnWidths: {
    [headers.indexOf('Notes') + 1]: 300,
    [headers.indexOf('CustomFieldsJSON') + 1]: 300,
    [headers.indexOf('RawJSON') + 1]: 300
  },
  logMessage:
    `Exported ${rows.length} QBO customers with ` +
    `${customFieldColumns.length} custom-field columns.`
});
}


/**
 * Finds every custom field returned across all customers.
 *
 * QBO custom fields may be identified by:
 * - DefinitionId
 * - Name
 * - Type
 *
 * The generated key prioritizes DefinitionId because names can change.
 */
function discoverCustomerCustomFields_(customers) {
  const discovered = new Map();

  customers.forEach(customer => {
    const customFields = Array.isArray(customer.CustomField)
      ? customer.CustomField
      : [];

    customFields.forEach(field => {
      const definitionId = String(
        field.DefinitionId || ''
      ).trim();

      const name = String(
        field.Name || ''
      ).trim();

      const type = String(
        field.Type || ''
      ).trim();

      const key =
        definitionId ||
        name ||
        `Unnamed_${discovered.size + 1}`;

      if (!discovered.has(key)) {
        discovered.set(key, {
          key: key,
          definitionId: definitionId,
          name: name,
          type: type,
          header: buildCustomFieldHeader_(
            name,
            definitionId
          )
        });
      }
    });
  });

  return Array.from(discovered.values()).sort((a, b) => {
    const aNumber = Number(a.definitionId);
    const bNumber = Number(b.definitionId);

    if (
      Number.isFinite(aNumber) &&
      Number.isFinite(bNumber)
    ) {
      return aNumber - bNumber;
    }

    return a.header.localeCompare(b.header);
  });
}


/**
 * Creates a stable spreadsheet column name for a custom field.
 */
function buildCustomFieldHeader_(name, definitionId) {
  const cleanedName = sanitizeHeader_(name);

  if (cleanedName && definitionId) {
    return `Custom_${cleanedName}_${definitionId}`;
  }

  if (cleanedName) {
    return `Custom_${cleanedName}`;
  }

  if (definitionId) {
    return `Custom_Field_${definitionId}`;
  }

  return 'Custom_Unnamed';
}


/**
 * Returns custom-field values in the same order as the
 * discovered custom-field columns.
 */
function getCustomerCustomFieldValues_(
  customer,
  customFieldColumns
) {
  const valuesByKey = new Map();

  const customFields = Array.isArray(customer.CustomField)
    ? customer.CustomField
    : [];

  customFields.forEach(field => {
    const definitionId = String(
      field.DefinitionId || ''
    ).trim();

    const name = String(
      field.Name || ''
    ).trim();

    const key =
      definitionId ||
      name;

    if (!key) {
      return;
    }

    valuesByKey.set(
      key,
      extractCustomFieldValue_(field)
    );
  });

  return customFieldColumns.map(field => {
    return valuesByKey.has(field.key)
      ? valuesByKey.get(field.key)
      : '';
  });
}


/**
 * Extracts the populated value from any supported custom-field type.
 */
function extractCustomFieldValue_(field) {
  const possibleValueProperties = [
    'StringValue',
    'NumberValue',
    'DateValue',
    'BooleanValue',
    'NameValue',
    'AnyValue'
  ];

  for (const propertyName of possibleValueProperties) {
    if (
      Object.prototype.hasOwnProperty.call(
        field,
        propertyName
      )
    ) {
      return normalizeCellValue_(
        field[propertyName]
      );
    }
  }

  // Preserve an unexpected future value structure.
  const metadataProperties = new Set([
    'DefinitionId',
    'Name',
    'Type'
  ]);

  const remainingProperties = Object.keys(field).filter(
    key => !metadataProperties.has(key)
  );

  if (remainingProperties.length === 1) {
    return normalizeCellValue_(
      field[remainingProperties[0]]
    );
  }

  if (remainingProperties.length > 1) {
    const remainingObject = {};

    remainingProperties.forEach(key => {
      remainingObject[key] = field[key];
    });

    return jsonStringifySafe_(remainingObject);
  }

  return '';
}


/**
 * Safely retrieves a nested property using a dot-separated path.
 */
function nestedValue_(object, path) {
  if (!object || !path) {
    return '';
  }

  const value = path
    .split('.')
    .reduce((current, propertyName) => {
      if (
        current === null ||
        current === undefined
      ) {
        return undefined;
      }

      return current[propertyName];
    }, object);

  return normalizeCellValue_(value);
}


/**
 * Converts a value into something safe for a Google Sheets cell.
 */
function normalizeCellValue_(value) {
  if (
    value === null ||
    value === undefined
  ) {
    return '';
  }

  if (value instanceof Date) {
    return value;
  }

  if (
    typeof value === 'object'
  ) {
    return jsonStringifySafe_(value);
  }

  return value;
}


/**
 * Returns a value or a blank without converting false to blank.
 */
function valueOrBlank_(value) {
  return (
    value === null ||
    value === undefined
  )
    ? ''
    : normalizeCellValue_(value);
}


/**
 * Preserves actual Boolean values and leaves missing values blank.
 */
function booleanOrBlank_(value) {
  if (
    value === true ||
    value === false
  ) {
    return value;
  }

  return '';
}


/**
 * Produces a Boolean convenience column for delivery preference.
 */
function preferredDeliveryFlag_(
  preferredDeliveryMethod,
  expectedMethod
) {
  if (!preferredDeliveryMethod) {
    return '';
  }

  return String(preferredDeliveryMethod)
    .toLowerCase()
    .includes(String(expectedMethod).toLowerCase());
}


/**
 * Converts arbitrary text into a safe spreadsheet header.
 */
function sanitizeHeader_(value) {
  return String(value || '')
    .trim()
    .replace(/[^\w]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

