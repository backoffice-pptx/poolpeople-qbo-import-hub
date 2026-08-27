/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 32_QBO_Items.js
 * Purpose     : Export QBO Item master data to structured Google Sheets tables.
 *
 * Public API:
 *   - exportQboItems()
 *
 * Internal Helpers:
 *   - buildItemRows_()
 *   - buildItemGroupRows_()
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
 * 32_QBO_Items.gs
 * QBO Product & Service export
 *
 * Output Sheets:
 *   QBO_Items
 *   QBO_ItemGroupLines
 *
 * Public Functions:
 *   exportQboItems()
 ***********************/


/**
 * Parent item export columns.
 */
const ITEM_HEADERS = [

  // Identity
  'Id',
  'SyncToken',
  'Active',

  // Classification
  'Type',
  'DisplayType',
  'IsGroup',
  'PrintGroupedItems',
  'GroupLineCount',
  'SubItem',

  // Names
  'Name',
  'FullyQualifiedName',
  'Sku',

  // Hierarchy
  'ParentId',
  'ParentName',

  // Sales
  'UnitPrice',
  'Taxable',
  'Description',

  // Purchasing
  'PurchaseCost',
  'PurchaseDescription',

  // Inventory
  'TrackQtyOnHand',
  'QtyOnHand',
  'InvStartDate',

  // Accounts
  'IncomeAccountId',
  'IncomeAccountName',

  'ExpenseAccountId',
  'ExpenseAccountName',

  'AssetAccountId',
  'AssetAccountName',

  // Audit
  'CreateTime',
  'LastUpdatedTime',

  // Source
  'RawJSON'
];


/**
 * Bundle component export columns.
 */
const ITEM_GROUP_HEADERS = [

  // Parent Bundle
  'GroupItemId',
  'GroupItemName',
  'GroupItemFullyQualifiedName',

  // Bundle Component
  'LineNumber',
  'ComponentItemId',
  'ComponentItemName',
  'ComponentItemType',
  'Quantity',

  // Source
  'RawJSON'
];


/**
 * Exports all active and inactive QBO Items.
 *
 * Output sheets:
 *   QBO_Items
 *   QBO_ItemGroupLines
 *
 * @return {Object} Export row counts.
 */
function exportQboItems() {

  safeLog_('Starting QBO items export.');

  const items = qboQueryAllGeneric_(
    'SELECT * FROM Item WHERE Active IN (true, false)',
    'Item'
  );

  safeLog_(`Retrieved ${items.length} QBO items.`);

  //
  // Parent Items
  //
  const itemRows = buildItemRows_(items);

  writeExport_({
    sheetName: 'QBO_Items',
    headers: ITEM_HEADERS,
    rows: itemRows,
    columnWidths: {
      [ITEM_HEADERS.indexOf('Description') + 1]: 300,
      [ITEM_HEADERS.indexOf('PurchaseDescription') + 1]: 300,
      [ITEM_HEADERS.indexOf('RawJSON') + 1]: 300
    },
    logMessage: `Exported ${itemRows.length} QBO items.`
  });

  //
  // Bundle Components
  //
  const groupRows = buildItemGroupRows_(items);

  writeExport_({
    sheetName: 'QBO_ItemGroupLines',
    headers: ITEM_GROUP_HEADERS,
    rows: groupRows,
    columnWidths: {
      [ITEM_GROUP_HEADERS.indexOf('RawJSON') + 1]: 300
    },
    logMessage: `Exported ${groupRows.length} QBO bundle component rows.`
  });

  safeLog_('Completed QBO items export.');

  return {
    itemCount: itemRows.length,
    bundleComponentCount: groupRows.length
  };
}


/**
 * Builds rows for the QBO_Items sheet.
 *
 * @param {Object[]} items QBO Item objects.
 * @return {Array[]} Rows matching ITEM_HEADERS.
 */
function buildItemRows_(items) {

  return items.map(item => {
    const meta = extractMeta_(item);

    const isGroup = item.Type === 'Group';
    const groupDetail = item.ItemGroupDetail || {};
    const groupLines = Array.isArray(groupDetail.ItemGroupLine)
      ? groupDetail.ItemGroupLine
      : [];

    return [
      // Identity
      valueOrBlank_(item.Id),
      valueOrBlank_(item.SyncToken),
      booleanOrBlank_(item.Active),

      // Classification
      valueOrBlank_(item.Type),
      isGroup ? 'Bundle' : valueOrBlank_(item.Type),
      isGroup,
      isGroup
        ? booleanOrBlank_(groupDetail.PrintGroupedItems)
        : '',
      isGroup ? groupLines.length : '',
      booleanOrBlank_(item.SubItem),

      // Names
      valueOrBlank_(item.Name),
      valueOrBlank_(item.FullyQualifiedName),
      valueOrBlank_(item.Sku),

      // Hierarchy
      nestedValue_(item, 'ParentRef.value'),
      nestedValue_(item, 'ParentRef.name'),

      // Sales
      numberOrBlank_(item.UnitPrice),
      booleanOrBlank_(item.Taxable),
      valueOrBlank_(item.Description),

      // Purchasing
      numberOrBlank_(item.PurchaseCost),
      valueOrBlank_(item.PurchaseDesc),

      // Inventory
      booleanOrBlank_(item.TrackQtyOnHand),
      numberOrBlank_(item.QtyOnHand),
      valueOrBlank_(item.InvStartDate),

      // Accounts
      nestedValue_(item, 'IncomeAccountRef.value'),
      nestedValue_(item, 'IncomeAccountRef.name'),

      nestedValue_(item, 'ExpenseAccountRef.value'),
      nestedValue_(item, 'ExpenseAccountRef.name'),

      nestedValue_(item, 'AssetAccountRef.value'),
      nestedValue_(item, 'AssetAccountRef.name'),

      // Audit
      valueOrBlank_(meta.createTime),
      valueOrBlank_(meta.lastUpdatedTime),

      // Source
      jsonStringifySafe_(item)
    ];
  });
}


/**
 * Builds bundle component rows for the QBO_ItemGroupLines sheet.
 *
 * @param {Object[]} items QBO Item objects.
 * @return {Array[]} Rows matching ITEM_GROUP_HEADERS.
 */
function buildItemGroupRows_(items) {

  const rows = [];

  items.forEach(item => {
    if (item.Type !== 'Group') {
      return;
    }

    const groupDetail = item.ItemGroupDetail || {};
    const groupLines = Array.isArray(groupDetail.ItemGroupLine)
      ? groupDetail.ItemGroupLine
      : [];

    groupLines.forEach((line, index) => {
      const itemRef = line.ItemRef || {};

      rows.push([
        // Parent Bundle
        valueOrBlank_(item.Id),
        valueOrBlank_(item.Name),
        valueOrBlank_(item.FullyQualifiedName),

        // Bundle Component
        index + 1,
        valueOrBlank_(itemRef.value),
        valueOrBlank_(itemRef.name),
        valueOrBlank_(line.ItemType),
        numberOrBlank_(line.Qty),

        // Source
        jsonStringifySafe_(line)
      ]);
    });
  });

  return rows;
}