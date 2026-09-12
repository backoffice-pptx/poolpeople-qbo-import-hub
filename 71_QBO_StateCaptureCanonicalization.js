/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 71_QBO_StateCaptureCanonicalization.js
 * Purpose     : Deterministic canonical QBO business-state normalization,
 *               hashing, and semantic diffing for State Capture v1.5.0.
 *
 * Architecture:
 *   - Raw evidence and canonical business state are separate concerns.
 *   - Technical/version metadata does not independently create business-state
 *     transitions.
 *   - Canonicalization is deterministic and versioned.
 *   - Reference display names do not cascade changes into parent entities when
 *     referenced identity is unchanged.
 *   - Arrays use path-specific semantic identity where available.
 * ============================================================================
 */

const QBO_CANONICAL_MISSING_ = Object.freeze({__qboCanonicalMissing: true});

function qboCanonicalizeEntityState_(exportKey, entityType, rawEntity) {
  if (!rawEntity || typeof rawEntity !== 'object' || Array.isArray(rawEntity)) {
    throw new Error('Canonicalization requires a complete QBO entity object.');
  }
  return qboCanonicalizeValue_(rawEntity, {
    exportKey: String(exportKey || ''),
    entityType: String(entityType || ''),
    path: '',
    parentKey: '',
    root: true
  });
}

function qboCanonicalizeValue_(value, context) {
  if (value === null) return null;
  if (Array.isArray(value)) return qboCanonicalizeArray_(value, context);
  if (typeof value !== 'object') return value;

  const result = {};
  Object.keys(value).sort().forEach(function(key) {
    if (qboCanonicalShouldExcludeProperty_(key, context)) return;

    const childPath = context.path ? context.path + '.' + key : key;
    const childContext = {
      exportKey: context.exportKey,
      entityType: context.entityType,
      path: childPath,
      parentKey: key,
      root: false
    };

    // QBO reference objects are canonicalized by stable referenced identity.
    if (qboCanonicalIsReferenceKey_(key) && value[key] && typeof value[key] === 'object' && !Array.isArray(value[key])) {
      result[key] = qboCanonicalizeReference_(value[key], childContext);
      return;
    }

    result[key] = qboCanonicalizeValue_(value[key], childContext);
  });
  return result;
}

function qboCanonicalShouldExcludeProperty_(key, context) {
  if (
    key === 'domain' ||
    key === 'sparse' ||
    key === 'SyncToken' ||
    key === 'MetaData' ||
    key === 'V4IDPseudonym'
  ) {
    return true;
  }
  if (context.root && key === 'Id') return true;

  // Address object IDs are QBO technical object identifiers; semantic address
  // content remains canonical.
  if (key === 'Id' && /(?:^|\.)(BillAddr|ShipAddr)$/.test(context.path || '')) {
    return true;
  }
  return false;
}

function qboCanonicalIsReferenceKey_(key) {
  return /Ref$/.test(String(key || ''));
}

function qboCanonicalizeReference_(ref, context) {
  const result = {};
  if (Object.prototype.hasOwnProperty.call(ref, 'value')) {
    result.value = qboCanonicalizeValue_(ref.value, context);
  }

  // Preserve non-display-name business attributes if QBO adds them to a
  // reference object. The display name is descriptive evidence only.
  Object.keys(ref).sort().forEach(function(key) {
    if (key === 'value' || key === 'name') return;
    result[key] = qboCanonicalizeValue_(ref[key], {
      exportKey: context.exportKey,
      entityType: context.entityType,
      path: context.path + '.' + key,
      parentKey: key,
      root: false
    });
  });
  return result;
}

function qboCanonicalizeArray_(arrayValue, context) {
  const items = arrayValue.map(function(item, index) {
    return qboCanonicalizeValue_(item, {
      exportKey: context.exportKey,
      entityType: context.entityType,
      path: context.path,
      parentKey: context.parentKey,
      root: false,
      arrayIndex: index
    });
  });

  if (qboCanonicalArrayKind_(context.path) === 'CUSTOM_FIELD') {
    return items.slice().sort(function(a, b) {
      return qboCanonicalCompareText_(a && a.DefinitionId, b && b.DefinitionId);
    }).map(function(item) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
      const copy = {};
      Object.keys(item).sort().forEach(function(key) {
        if (key !== 'Name') copy[key] = item[key];
      });
      return copy;
    });
  }

  if (qboCanonicalArrayKind_(context.path) === 'LINKED_TXN') {
    return items.slice().sort(function(a, b) {
      return qboCanonicalCompareText_(
        qboCanonicalLinkedTxnIdentity_(a),
        qboCanonicalLinkedTxnIdentity_(b)
      );
    });
  }

  // Line order can carry document meaning. Preserve it. Diff logic uses Line.Id
  // where present to avoid positional noise while keeping deterministic order.
  return items;
}

function qboCanonicalArrayKind_(path) {
  const key = String(path || '').split('.').pop();
  if (key === 'CustomField') return 'CUSTOM_FIELD';
  if (key === 'LinkedTxn') return 'LINKED_TXN';
  if (key === 'Line') return 'LINE';
  return 'POSITIONAL';
}

function qboCanonicalLinkedTxnIdentity_(item) {
  if (!item || typeof item !== 'object') return qboCanonicalStableStringify_(item);
  return [
    String(item.TxnType || ''),
    String(item.TxnId || ''),
    String(item.TxnLineId || '')
  ].join(':');
}

function qboCanonicalStableStringify_(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    return '[' + value.map(qboCanonicalStableStringify_).join(',') + ']';
  }
  if (typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(function(key) {
      return JSON.stringify(key) + ':' + qboCanonicalStableStringify_(value[key]);
    }).join(',') + '}';
  }
  return JSON.stringify(value);
}

function qboCanonicalStateHash_(exportKey, entityType, canonicalState) {
  return qboStateCaptureAuditSha256_(qboCanonicalStableStringify_({
    version: QBO_STATE_CAPTURE.CANONICALIZATION_VERSION,
    exportKey: String(exportKey || ''),
    entityType: String(entityType || ''),
    state: canonicalState
  }));
}

function qboCanonicalRawPayloadHash_(rawPayload) {
  return qboStateCaptureAuditSha256_(String(rawPayload === undefined || rawPayload === null ? '' : rawPayload));
}

function qboCanonicalDiff_(beforeValue, afterValue) {
  const changes = [];
  qboCanonicalDiffValue_(beforeValue, afterValue, '', changes);
  return changes;
}

function qboCanonicalDiffValue_(beforeValue, afterValue, path, changes) {
  const beforeMissing = beforeValue === QBO_CANONICAL_MISSING_;
  const afterMissing = afterValue === QBO_CANONICAL_MISSING_;

  if (beforeMissing || afterMissing) {
    const present = beforeMissing ? afterValue : beforeValue;
    const operation = beforeMissing ? 'ADD' : 'REMOVE';
    if (present && typeof present === 'object') {
      qboCanonicalExpandMissingDiff_(present, path, operation, changes);
    } else {
      qboCanonicalPushDiff_(changes, path || '$', operation, beforeValue, afterValue);
    }
    return;
  }

  if (qboCanonicalStableStringify_(beforeValue) === qboCanonicalStableStringify_(afterValue)) {
    return;
  }

  const beforeArray = Array.isArray(beforeValue);
  const afterArray = Array.isArray(afterValue);
  if (beforeArray || afterArray) {
    if (!(beforeArray && afterArray)) {
      qboCanonicalPushDiff_(changes, path || '$', 'REPLACE', beforeValue, afterValue);
      return;
    }
    qboCanonicalDiffArray_(beforeValue, afterValue, path, changes);
    return;
  }

  const beforeObject = beforeValue && typeof beforeValue === 'object';
  const afterObject = afterValue && typeof afterValue === 'object';
  if (beforeObject || afterObject) {
    if (!(beforeObject && afterObject)) {
      qboCanonicalPushDiff_(changes, path || '$', 'REPLACE', beforeValue, afterValue);
      return;
    }
    const keys = Object.create(null);
    Object.keys(beforeValue).forEach(function(key) { keys[key] = true; });
    Object.keys(afterValue).forEach(function(key) { keys[key] = true; });
    Object.keys(keys).sort().forEach(function(key) {
      qboCanonicalDiffValue_(
        Object.prototype.hasOwnProperty.call(beforeValue, key) ? beforeValue[key] : QBO_CANONICAL_MISSING_,
        Object.prototype.hasOwnProperty.call(afterValue, key) ? afterValue[key] : QBO_CANONICAL_MISSING_,
        path ? path + '.' + key : key,
        changes
      );
    });
    return;
  }

  qboCanonicalPushDiff_(changes, path || '$', 'REPLACE', beforeValue, afterValue);
}

function qboCanonicalExpandMissingDiff_(value, path, operation, changes) {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      qboCanonicalPushDiff_(changes, path || '$', operation,
        operation === 'ADD' ? QBO_CANONICAL_MISSING_ : value,
        operation === 'ADD' ? value : QBO_CANONICAL_MISSING_);
      return;
    }
    const kind = qboCanonicalArrayKind_(path);
    value.forEach(function(item, index) {
      const childPath = qboCanonicalArrayItemPath_(path, kind, item, index);
      qboCanonicalExpandMissingDiff_(item, childPath, operation, changes);
    });
    return;
  }
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    if (keys.length === 0) {
      qboCanonicalPushDiff_(changes, path || '$', operation,
        operation === 'ADD' ? QBO_CANONICAL_MISSING_ : value,
        operation === 'ADD' ? value : QBO_CANONICAL_MISSING_);
      return;
    }
    keys.forEach(function(key) {
      qboCanonicalExpandMissingDiff_(value[key], path ? path + '.' + key : key, operation, changes);
    });
    return;
  }
  qboCanonicalPushDiff_(changes, path || '$', operation,
    operation === 'ADD' ? QBO_CANONICAL_MISSING_ : value,
    operation === 'ADD' ? value : QBO_CANONICAL_MISSING_);
}

function qboCanonicalDiffArray_(beforeArray, afterArray, path, changes) {
  const kind = qboCanonicalArrayKind_(path);
  if (kind === 'CUSTOM_FIELD' || kind === 'LINKED_TXN' || kind === 'LINE') {
    const beforeMap = qboCanonicalBuildArrayIdentityMap_(beforeArray, kind);
    const afterMap = qboCanonicalBuildArrayIdentityMap_(afterArray, kind);
    if (beforeMap && afterMap) {
      const identities = Object.create(null);
      Object.keys(beforeMap).forEach(function(id) { identities[id] = true; });
      Object.keys(afterMap).forEach(function(id) { identities[id] = true; });
      Object.keys(identities).sort().forEach(function(id) {
        const itemPath = path + '[' + qboCanonicalArrayIdentityLabel_(kind, id) + ']';
        qboCanonicalDiffValue_(
          Object.prototype.hasOwnProperty.call(beforeMap, id) ? beforeMap[id] : QBO_CANONICAL_MISSING_,
          Object.prototype.hasOwnProperty.call(afterMap, id) ? afterMap[id] : QBO_CANONICAL_MISSING_,
          itemPath,
          changes
        );
      });
      return;
    }
  }

  const maxLength = Math.max(beforeArray.length, afterArray.length);
  for (let i = 0; i < maxLength; i += 1) {
    qboCanonicalDiffValue_(
      i < beforeArray.length ? beforeArray[i] : QBO_CANONICAL_MISSING_,
      i < afterArray.length ? afterArray[i] : QBO_CANONICAL_MISSING_,
      path + '[' + i + ']',
      changes
    );
  }
}

function qboCanonicalBuildArrayIdentityMap_(arrayValue, kind) {
  const map = Object.create(null);
  for (let i = 0; i < arrayValue.length; i += 1) {
    const item = arrayValue[i];
    let id = '';
    if (kind === 'CUSTOM_FIELD') id = item && item.DefinitionId !== undefined ? String(item.DefinitionId) : '';
    if (kind === 'LINKED_TXN') id = qboCanonicalLinkedTxnIdentity_(item);
    if (kind === 'LINE') {
      if (item && item.Id !== undefined && item.Id !== '') id = 'ID:' + String(item.Id);
      else if (item && item.LineNum !== undefined && item.LineNum !== '') id = 'NUM:' + String(item.LineNum);
    }
    if (!id || Object.prototype.hasOwnProperty.call(map, id)) return null;
    map[id] = item;
  }
  return map;
}

function qboCanonicalArrayIdentityLabel_(kind, id) {
  if (kind === 'CUSTOM_FIELD') return 'DefinitionId:' + id;
  if (kind === 'LINKED_TXN') {
    const parts = String(id).split(':');
    return (parts[0] || 'Txn') + ':' + (parts[1] || '') + (parts[2] ? ':' + parts[2] : '');
  }
  if (kind === 'LINE') {
    if (String(id).indexOf('ID:') === 0) return 'Id:' + String(id).slice(3);
    if (String(id).indexOf('NUM:') === 0) return 'LineNum:' + String(id).slice(4);
  }
  return id;
}

function qboCanonicalArrayItemPath_(path, kind, item, index) {
  if (kind === 'CUSTOM_FIELD' && item && item.DefinitionId !== undefined) {
    return path + '[DefinitionId:' + item.DefinitionId + ']';
  }
  if (kind === 'LINKED_TXN') {
    return path + '[' + qboCanonicalArrayIdentityLabel_(kind, qboCanonicalLinkedTxnIdentity_(item)) + ']';
  }
  if (kind === 'LINE' && item) {
    if (item.Id !== undefined && item.Id !== '') return path + '[Id:' + item.Id + ']';
    if (item.LineNum !== undefined && item.LineNum !== '') return path + '[LineNum:' + item.LineNum + ']';
  }
  return path + '[' + index + ']';
}

function qboCanonicalPushDiff_(changes, path, operation, beforeValue, afterValue) {
  changes.push({
    path: path,
    operation: operation,
    beforeType: qboCanonicalValueType_(beforeValue),
    beforeValue: qboCanonicalDisplayValue_(beforeValue),
    afterType: qboCanonicalValueType_(afterValue),
    afterValue: qboCanonicalDisplayValue_(afterValue),
    beforeValueHash: qboCanonicalValueHash_(beforeValue),
    afterValueHash: qboCanonicalValueHash_(afterValue),
    classification: 'BUSINESS_STATE'
  });
}

function qboCanonicalValueType_(value) {
  if (value === QBO_CANONICAL_MISSING_) return 'MISSING';
  if (value === null) return 'NULL';
  if (Array.isArray(value)) return 'ARRAY';
  if (typeof value === 'object') return 'OBJECT';
  if (typeof value === 'boolean') return 'BOOLEAN';
  if (typeof value === 'number') return 'NUMBER';
  return 'STRING';
}

function qboCanonicalDisplayValue_(value) {
  if (value === QBO_CANONICAL_MISSING_) return '';
  if (value === null) return 'null';
  if (typeof value === 'object') return jsonStringifyCellSafe_(value);
  return String(value);
}

function qboCanonicalValueHash_(value) {
  if (value === QBO_CANONICAL_MISSING_) return '';
  return qboStateCaptureAuditSha256_(qboCanonicalStableStringify_(value));
}

function qboCanonicalCompareText_(a, b) {
  const aa = String(a === undefined || a === null ? '' : a);
  const bb = String(b === undefined || b === null ? '' : b);
  if (aa < bb) return -1;
  if (aa > bb) return 1;
  return 0;
}
