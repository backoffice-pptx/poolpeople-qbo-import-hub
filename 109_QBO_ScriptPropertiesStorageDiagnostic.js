/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 109_QBO_ScriptPropertiesStorageDiagnostic.js
 * Version     : 1.5.73
 * Purpose     : Read-only Script Properties storage-quota diagnostics.
 *
 * Public API:
 *   - diagnoseQboScriptPropertiesStorage()
 *
 * Safety:
 *   - READ ONLY. This module never sets, deletes, or rewrites Script Properties.
 *   - Property values are never logged or returned.
 *   - Output reports property keys, approximate UTF-8 storage bytes, categories,
 *     growth classification, and aggregate counts only.
 * ============================================================================
 */

const QBO_SCRIPT_PROPERTIES_DIAGNOSTIC_ = Object.freeze({
  VERSION: 'QBO_SCRIPT_PROPERTIES_STORAGE_DIAGNOSTIC_V1',
  TOP_N: 40,
  LOG_CHUNK_SIZE: 40,
  NATIVE_CDC_ENTITY_META_PREFIX: 'QBO_NATIVE_CDC_ENTITY_META_V2__'
});

/**
 * Read-only inventory of the current project Script Properties store.
 *
 * Approximate storage bytes are calculated as UTF-8 bytes for key + value.
 * Apps Script quota accounting is owned by Google, so this is an operational
 * estimate for diagnosis rather than a promise of Google's internal byte count.
 */
function diagnoseQboScriptPropertiesStorage() {
  const props = PropertiesService.getScriptProperties();
  const all = props.getProperties();
  const keys = Object.keys(all).sort();

  const rows = [];
  const categories = {};
  const growthClasses = {};
  const nativeCdcCycles = {};
  let totalKeyBytes = 0;
  let totalValueBytes = 0;

  keys.forEach(function(key) {
    const value = String(all[key] == null ? '' : all[key]);
    const keyBytes = qboScriptPropertiesUtf8Bytes_(key);
    const valueBytes = qboScriptPropertiesUtf8Bytes_(value);
    const totalBytes = keyBytes + valueBytes;
    const category = qboScriptPropertiesCategory_(key);
    const growthClass = qboScriptPropertiesGrowthClass_(key);
    const cycleId = qboScriptPropertiesNativeCdcCycleId_(key);

    totalKeyBytes += keyBytes;
    totalValueBytes += valueBytes;

    if (!categories[category]) categories[category] = {propertyCount: 0, approximateBytes: 0};
    categories[category].propertyCount++;
    categories[category].approximateBytes += totalBytes;

    if (!growthClasses[growthClass]) growthClasses[growthClass] = {propertyCount: 0, approximateBytes: 0};
    growthClasses[growthClass].propertyCount++;
    growthClasses[growthClass].approximateBytes += totalBytes;

    if (cycleId) nativeCdcCycles[cycleId] = (nativeCdcCycles[cycleId] || 0) + 1;

    rows.push({
      key: key,
      category: category,
      growthClass: growthClass,
      keyBytes: keyBytes,
      valueBytes: valueBytes,
      approximateBytes: totalBytes,
      nativeCdcCycleId: cycleId || ''
    });
  });

  const bySize = rows.slice().sort(function(a, b) {
    if (b.approximateBytes !== a.approximateBytes) return b.approximateBytes - a.approximateBytes;
    return a.key.localeCompare(b.key);
  });

  const categoryRows = Object.keys(categories).map(function(name) {
    return {
      category: name,
      propertyCount: categories[name].propertyCount,
      approximateBytes: categories[name].approximateBytes
    };
  }).sort(function(a, b) {
    if (b.approximateBytes !== a.approximateBytes) return b.approximateBytes - a.approximateBytes;
    return a.category.localeCompare(b.category);
  });

  const growthRows = Object.keys(growthClasses).map(function(name) {
    return {
      growthClass: name,
      propertyCount: growthClasses[name].propertyCount,
      approximateBytes: growthClasses[name].approximateBytes
    };
  }).sort(function(a, b) {
    if (b.approximateBytes !== a.approximateBytes) return b.approximateBytes - a.approximateBytes;
    return a.growthClass.localeCompare(b.growthClass);
  });

  const cycleRows = Object.keys(nativeCdcCycles).map(function(cycleId) {
    return {cycleId: cycleId, propertyCount: nativeCdcCycles[cycleId]};
  }).sort(function(a, b) { return a.cycleId.localeCompare(b.cycleId); });

  const result = {
    version: QBO_SCRIPT_PROPERTIES_DIAGNOSTIC_.VERSION,
    readOnly: true,
    propertyCount: rows.length,
    approximateKeyBytes: totalKeyBytes,
    approximateValueBytes: totalValueBytes,
    approximateTotalBytes: totalKeyBytes + totalValueBytes,
    approximateTotalKiB: Number(((totalKeyBytes + totalValueBytes) / 1024).toFixed(2)),
    categorySummary: categoryRows,
    growthSummary: growthRows,
    nativeCdcEntityMeta: {
      prefix: QBO_SCRIPT_PROPERTIES_DIAGNOSTIC_.NATIVE_CDC_ENTITY_META_PREFIX,
      cycleCount: cycleRows.length,
      propertyCount: rows.filter(function(r) {
        return r.key.indexOf(QBO_SCRIPT_PROPERTIES_DIAGNOSTIC_.NATIVE_CDC_ENTITY_META_PREFIX) === 0;
      }).length,
      cycles: cycleRows
    },
    largestProperties: bySize.slice(0, QBO_SCRIPT_PROPERTIES_DIAGNOSTIC_.TOP_N),
    allProperties: rows
  };

  console.log('[SCRIPT PROPERTIES DIAGNOSTIC] | SUMMARY | ' + JSON.stringify({
    version: result.version,
    readOnly: result.readOnly,
    propertyCount: result.propertyCount,
    approximateTotalBytes: result.approximateTotalBytes,
    approximateTotalKiB: result.approximateTotalKiB,
    nativeCdcEntityMetaCycleCount: result.nativeCdcEntityMeta.cycleCount,
    nativeCdcEntityMetaPropertyCount: result.nativeCdcEntityMeta.propertyCount,
    categorySummary: result.categorySummary,
    growthSummary: result.growthSummary,
    largestProperties: result.largestProperties
  }, null, 2));

  for (let i = 0; i < rows.length; i += QBO_SCRIPT_PROPERTIES_DIAGNOSTIC_.LOG_CHUNK_SIZE) {
    console.log('[SCRIPT PROPERTIES DIAGNOSTIC] | INVENTORY ' +
      (i + 1) + '-' + Math.min(i + QBO_SCRIPT_PROPERTIES_DIAGNOSTIC_.LOG_CHUNK_SIZE, rows.length) +
      ' | ' + JSON.stringify(rows.slice(i, i + QBO_SCRIPT_PROPERTIES_DIAGNOSTIC_.LOG_CHUNK_SIZE)));
  }

  return result;
}

function qboScriptPropertiesUtf8Bytes_(text) {
  return Utilities.newBlob(String(text == null ? '' : text)).getBytes().length;
}

function qboScriptPropertiesCategory_(key) {
  const k = String(key || '');
  if (k.indexOf('QBO_NATIVE_CDC_ENTITY_META_V2__') === 0) return 'NATIVE_CDC_ENTITY_META';
  if (k.indexOf('QBO_NATIVE_CDC_') === 0) return 'NATIVE_CDC_CONTROL';
  if (k.indexOf('QBO_FULL_EXPORT_FORWARD_INGESTION_') === 0) return 'FULL_EXPORT_FORWARD_INGESTION';
  if (k.indexOf('QBO_WEBHOOK_') === 0) return 'WEBHOOK';
  if (k.indexOf('QBO_HISTORICAL_') === 0) return 'HISTORICAL_BACKFILL';
  if (k.indexOf('QBO_CANONICAL_V2_') === 0) return 'CANONICAL_V2_REBUILD';
  if (k.indexOf('QBO_RECURSIVE_') === 0) return 'RECURSIVE_CONTRACT_AUDIT';
  if (k.indexOf('QBO_STATE_CAPTURE_') === 0) return 'STATE_CAPTURE';
  if (k.indexOf('QBO_') === 0) return 'OTHER_QBO';
  return 'OTHER';
}

function qboScriptPropertiesGrowthClass_(key) {
  const k = String(key || '');
  if (k.indexOf(QBO_SCRIPT_PROPERTIES_DIAGNOSTIC_.NATIVE_CDC_ENTITY_META_PREFIX) === 0) {
    return 'ACCUMULATING_PER_NATIVE_CDC_CYCLE';
  }
  if (k.indexOf('ATTEMPTS__') >= 0) return 'ACCUMULATING_ATTEMPT_COUNTER';
  if (k.indexOf('LEASE') >= 0) return 'TRANSIENT_LEASE';
  if (k.indexOf('CURSOR') >= 0) return 'CURSOR';
  if (k.indexOf('STATE') >= 0) return 'SINGLETON_OR_RUN_STATE';
  if (k.indexOf('CUTOVER') >= 0) return 'SINGLETON_CUTOVER';
  if (k.indexOf('WATERMARK') >= 0) return 'SINGLETON_WATERMARK';
  if (k.indexOf('PAUSE') >= 0) return 'SINGLETON_PAUSE';
  return 'OTHER';
}

function qboScriptPropertiesNativeCdcCycleId_(key) {
  const prefix = QBO_SCRIPT_PROPERTIES_DIAGNOSTIC_.NATIVE_CDC_ENTITY_META_PREFIX;
  const k = String(key || '');
  if (k.indexOf(prefix) !== 0) return '';
  const remainder = k.substring(prefix.length);
  if (remainder.indexOf('ATTEMPTS__') === 0) {
    const attemptParts = remainder.substring('ATTEMPTS__'.length).split('__');
    return attemptParts.length >= 2 ? attemptParts[0] : '';
  }
  const parts = remainder.split('__');
  return parts.length >= 2 ? parts[0] : '';
}
