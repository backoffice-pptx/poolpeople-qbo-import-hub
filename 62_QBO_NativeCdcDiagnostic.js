/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 62_QBO_NativeCdcDiagnostic.js
 * Purpose     : Read-only discovery of QBO Native CDC behavior for selected
 *               entities before production CDC/preservation architecture is
 *               implemented.
 *
 * Public API:
 *   - runQboNativeCdcDiagnostic()
 *
 * Discovery scope:
 *   - Transaction, reference, and estimate entities currently exported by App 50
 *   - Includes Invoice, Payment, and TaxCode from the initial proof run
 *
 * Safety / architecture constraints:
 *   - READ ONLY. No spreadsheet, Drive, Current, Snapshot Record, Change Record,
 *     Master Backup, or production dataset writes.
 *   - Reuses the existing Application 50 OAuth and qboGet_() REST boundary.
 *   - Tests each entity separately so one rejected entity cannot mask another.
 *   - Does not infer unobserved intermediate QBO states.
 * ============================================================================
 */

const QBO_NATIVE_CDC_DIAGNOSTIC = Object.freeze({
  TEST_ENTITY: 'Estimate',
  TEST_ENTITY_ID: '69908',
  TEST_DOC_NUMBER: '',
  ENTITIES: Object.freeze([
    'Invoice',
    'Payment',
    'TaxCode',
    'CreditMemo',
    'Bill',
    'BillPayment',
    'Purchase',
    'Deposit',
    'JournalEntry',
    'SalesReceipt',
    'RefundReceipt',
    'Customer',
    'Vendor',
    'Item',
    'Account',
    'Class',
    'Department',
    'Term',
    'PaymentMethod',
    'Estimate'
  ]),
  LOOKBACK_DAYS: 29,
  SAMPLE_ENTITY_LIMIT: 1,
  SAMPLE_JSON_MAX_CHARS: 12000
});

/**
 * Runs the targeted read-only QBO Native CDC diagnostic for Invoice 69909 and its post-void state.
 *
 * Review the Apps Script execution log. The final [NATIVE CDC] | SUMMARY entry
 * contains one result per tested entity. A bounded sample entity is logged for
 * supported entities so actual returned shape can be inspected without writing
 * diagnostic evidence into production datasets.
 */
function runQboNativeCdcDiagnostic() {
  const changedSince = new Date(
    Date.now() - QBO_NATIVE_CDC_DIAGNOSTIC.LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  ).toISOString();

  console.log(
    `[NATIVE CDC TARGETED] | START | entity=${QBO_NATIVE_CDC_DIAGNOSTIC.TEST_ENTITY}` +
    ` | id=${QBO_NATIVE_CDC_DIAGNOSTIC.TEST_ENTITY_ID}` +
    ` | docNumber=${QBO_NATIVE_CDC_DIAGNOSTIC.TEST_DOC_NUMBER}` +
    ` | changedSince=${changedSince}`
  );

  const cfg = getConfig_();

  const result = qboNativeCdcTestEntity_(
    QBO_NATIVE_CDC_DIAGNOSTIC.TEST_ENTITY,
    changedSince,
    cfg.minorVersion
  );

  const entities = result && result.entities ? result.entities : [];
  const matches = entities.filter(function(entity) {
    return String(entity.Id || '') === String(QBO_NATIVE_CDC_DIAGNOSTIC.TEST_ENTITY_ID);
  });

  console.log(
    `[NATIVE CDC TARGETED] | MATCH_COUNT | entity=${QBO_NATIVE_CDC_DIAGNOSTIC.TEST_ENTITY}` +
    ` | id=${QBO_NATIVE_CDC_DIAGNOSTIC.TEST_ENTITY_ID}` +
    ` | occurrences=${matches.length}`
  );

  matches.forEach(function(entity, index) {
    const summary = {
      occurrence: index + 1,
      Id: entity.Id || '',
      SyncToken: entity.SyncToken || '',
      status: entity.status || '',
      sparse: Object.prototype.hasOwnProperty.call(entity, 'sparse') ? entity.sparse : '',
      TxnDate: entity.TxnDate || '',
      LastUpdatedTime:
        entity.MetaData && entity.MetaData.LastUpdatedTime
          ? entity.MetaData.LastUpdatedTime
          : '',
      PrivateNote: entity.PrivateNote || '',
      TotalAmt:
        Object.prototype.hasOwnProperty.call(entity, 'TotalAmt')
          ? entity.TotalAmt
          : '',
      UnappliedAmt:
        Object.prototype.hasOwnProperty.call(entity, 'UnappliedAmt')
          ? entity.UnappliedAmt
          : '',
      lineApplications: Array.isArray(entity.Line)
        ? entity.Line.map(function(line) {
            return {
              Amount: Object.prototype.hasOwnProperty.call(line, 'Amount') ? line.Amount : null,
              LinkedTxn: Array.isArray(line.LinkedTxn) ? line.LinkedTxn : []
            };
          })
        : [],
      topLevelLinkedTxn: Array.isArray(entity.LinkedTxn) ? entity.LinkedTxn : [],
      entityKeys: Object.keys(entity).sort()
    };

    console.log(
      `[NATIVE CDC TARGETED] | MATCH | ${JSON.stringify(summary, null, 2)}`
    );

    let json = JSON.stringify(entity, null, 2);
    if (json.length > QBO_NATIVE_CDC_DIAGNOSTIC.SAMPLE_JSON_MAX_CHARS) {
      json = json.slice(0, QBO_NATIVE_CDC_DIAGNOSTIC.SAMPLE_JSON_MAX_CHARS) +
        '\n...[target sample truncated by diagnostic]';
    }
    console.log(
      `[NATIVE CDC TARGETED] | FULL_MATCH | occurrence=${index + 1} | ${json}`
    );
  });

  if (!matches.length) {
    console.log(
      `[NATIVE CDC TARGETED] | NO_MATCH | entity=${QBO_NATIVE_CDC_DIAGNOSTIC.TEST_ENTITY}` +
      ` | id=${QBO_NATIVE_CDC_DIAGNOSTIC.TEST_ENTITY_ID}`
    );
  }

  console.log('[NATIVE CDC TARGETED] | COMPLETE');
}

function qboNativeCdcTestEntity_(entityName, changedSince, minorVersion) {
  const path =
    'cdc?entities=' + encodeURIComponent(entityName) +
    '&changedSince=' + encodeURIComponent(changedSince) +
    '&minorversion=' + encodeURIComponent(String(minorVersion));

  try {
    const response = qboGet_(path);
    const entities = qboNativeCdcExtractEntities_(response, entityName);
    const analysis = qboNativeCdcAnalyzeEntities_(entities);

    const result = {
      entity: entityName,
      requestStatus: 'SUCCESS',
      cdcSupportedObserved: true,
      returnedEntityCount: entities.length,
      earliestLastUpdatedTime: analysis.earliestLastUpdatedTime,
      latestLastUpdatedTime: analysis.latestLastUpdatedTime,
      syncTokenPresentCount: analysis.syncTokenPresentCount,
      privateNotePresentCount: analysis.privateNotePresentCount,
      linePresentCount: analysis.linePresentCount,
      linkedTxnPresentCount: analysis.linkedTxnPresentCount,
      deletedRepresentationCount: analysis.deletedRepresentationCount,
      sparseTrueCount: analysis.sparseTrueCount,
      sparseFalseCount: analysis.sparseFalseCount,
      sparseUnspecifiedCount: analysis.sparseUnspecifiedCount,
      fullVsSparseObservation: analysis.fullVsSparseObservation,
      rawResponseCapturedInMemory: true,
      rawResponsePersisted: false,
      responseTopLevelKeys: Object.keys(response || {}),
      sampleEntityKeys: analysis.sampleEntityKeys,
      deletedEntityKeys: analysis.deletedEntityKeys,
      deletedStatusValues: analysis.deletedStatusValues,
      error: '',
      entities: entities
    };

    console.log('[NATIVE CDC] | RESULT | ' + JSON.stringify(result, null, 2));
    qboNativeCdcLogSamples_(entityName, entities);
    return result;
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    const result = {
      entity: entityName,
      requestStatus: 'REJECTED_OR_FAILED',
      cdcSupportedObserved: false,
      returnedEntityCount: 0,
      earliestLastUpdatedTime: '',
      latestLastUpdatedTime: '',
      syncTokenPresentCount: 0,
      privateNotePresentCount: 0,
      linePresentCount: 0,
      linkedTxnPresentCount: 0,
      deletedRepresentationCount: 0,
      sparseTrueCount: 0,
      sparseFalseCount: 0,
      sparseUnspecifiedCount: 0,
      fullVsSparseObservation: 'REQUEST_FAILED',
      rawResponseCapturedInMemory: false,
      rawResponsePersisted: false,
      responseTopLevelKeys: [],
      sampleEntityKeys: [],
      deletedEntityKeys: [],
      deletedStatusValues: [],
      error: message
    };

    console.log('[NATIVE CDC] | RESULT | ' + JSON.stringify(result, null, 2));
    return result;
  }
}

function qboNativeCdcChangedSince_() {
  const now = new Date();
  const changedSince = new Date(
    now.getTime() - QBO_NATIVE_CDC_DIAGNOSTIC.LOOKBACK_DAYS * 24 * 60 * 60 * 1000
  );
  return changedSince.toISOString();
}

/**
 * CDC response shape is normally CDCResponse[].QueryResponse[].<Entity>.
 * Walk those containers defensively and collect only the requested entity.
 */
function qboNativeCdcExtractEntities_(response, entityName) {
  const output = [];
  const cdcResponses = qboNativeCdcArray_(response && response.CDCResponse);

  cdcResponses.forEach(function(cdcResponse) {
    qboNativeCdcArray_(cdcResponse && cdcResponse.QueryResponse).forEach(function(queryResponse) {
      qboNativeCdcArray_(queryResponse && queryResponse[entityName]).forEach(function(entity) {
        if (entity && typeof entity === 'object') {
          output.push(entity);
        }
      });
    });
  });

  return output;
}

function qboNativeCdcAnalyzeEntities_(entities) {
  let earliest = '';
  let latest = '';
  let syncTokenPresentCount = 0;
  let privateNotePresentCount = 0;
  let linePresentCount = 0;
  let linkedTxnPresentCount = 0;
  let deletedRepresentationCount = 0;
  let sparseTrueCount = 0;
  let sparseFalseCount = 0;
  let sparseUnspecifiedCount = 0;
  const deletedKeySet = {};
  const deletedStatusSet = {};

  entities.forEach(function(entity) {
    const updated = entity && entity.MetaData && entity.MetaData.LastUpdatedTime
      ? String(entity.MetaData.LastUpdatedTime)
      : '';

    if (updated) {
      if (!earliest || updated < earliest) earliest = updated;
      if (!latest || updated > latest) latest = updated;
    }

    if (entity.SyncToken !== undefined && entity.SyncToken !== null) {
      syncTokenPresentCount += 1;
    }
    if (Object.prototype.hasOwnProperty.call(entity, 'PrivateNote')) {
      privateNotePresentCount += 1;
    }
    if (Array.isArray(entity.Line)) {
      linePresentCount += 1;
    }
    if (qboNativeCdcContainsLinkedTxn_(entity)) {
      linkedTxnPresentCount += 1;
    }
    if (qboNativeCdcIsDeleted_(entity)) {
      deletedRepresentationCount += 1;
      Object.keys(entity).forEach(function(key) {
        deletedKeySet[key] = true;
      });
      const deletedStatus = String(entity.status || entity.Status || '');
      if (deletedStatus) deletedStatusSet[deletedStatus] = true;
    }

    if (entity.sparse === true) {
      sparseTrueCount += 1;
    } else if (entity.sparse === false) {
      sparseFalseCount += 1;
    } else {
      sparseUnspecifiedCount += 1;
    }
  });

  let fullVsSparseObservation = 'NO_ENTITIES_RETURNED';
  if (entities.length) {
    const liveCount = entities.length - deletedRepresentationCount;
    const liveSparseTrueCount = entities.filter(function(entity) {
      return !qboNativeCdcIsDeleted_(entity) && entity.sparse === true;
    }).length;
    const liveSparseFalseCount = entities.filter(function(entity) {
      return !qboNativeCdcIsDeleted_(entity) && entity.sparse === false;
    }).length;
    const liveSparseUnspecifiedCount = liveCount - liveSparseTrueCount - liveSparseFalseCount;

    if (liveCount === 0) {
      fullVsSparseObservation = 'DELETED_REPRESENTATIONS_ONLY';
    } else if (liveSparseFalseCount === liveCount) {
      fullVsSparseObservation = deletedRepresentationCount
        ? 'LIVE_ALL_EXPLICITLY_NON_SPARSE_PLUS_DELETED_REPRESENTATIONS'
        : 'ALL_EXPLICITLY_NON_SPARSE';
    } else if (liveSparseTrueCount === liveCount) {
      fullVsSparseObservation = deletedRepresentationCount
        ? 'LIVE_ALL_EXPLICITLY_SPARSE_PLUS_DELETED_REPRESENTATIONS'
        : 'ALL_EXPLICITLY_SPARSE';
    } else if (liveSparseUnspecifiedCount === liveCount) {
      fullVsSparseObservation = deletedRepresentationCount
        ? 'LIVE_SPARSE_FLAG_NOT_RETURNED_PLUS_DELETED_REPRESENTATIONS'
        : 'SPARSE_FLAG_NOT_RETURNED';
    } else {
      fullVsSparseObservation = 'MIXED_LIVE_SPARSE_FLAGS';
    }
  }

  return {
    earliestLastUpdatedTime: earliest,
    latestLastUpdatedTime: latest,
    syncTokenPresentCount: syncTokenPresentCount,
    privateNotePresentCount: privateNotePresentCount,
    linePresentCount: linePresentCount,
    linkedTxnPresentCount: linkedTxnPresentCount,
    deletedRepresentationCount: deletedRepresentationCount,
    sparseTrueCount: sparseTrueCount,
    sparseFalseCount: sparseFalseCount,
    sparseUnspecifiedCount: sparseUnspecifiedCount,
    fullVsSparseObservation: fullVsSparseObservation,
    sampleEntityKeys: entities.length ? Object.keys(entities[0]).sort() : [],
    deletedEntityKeys: Object.keys(deletedKeySet).sort(),
    deletedStatusValues: Object.keys(deletedStatusSet).sort()
  };
}

function qboNativeCdcContainsLinkedTxn_(value) {
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value.LinkedTxn) && value.LinkedTxn.length) return true;

  if (Array.isArray(value)) {
    return value.some(qboNativeCdcContainsLinkedTxn_);
  }

  return Object.keys(value).some(function(key) {
    return qboNativeCdcContainsLinkedTxn_(value[key]);
  });
}

function qboNativeCdcIsDeleted_(entity) {
  if (!entity || typeof entity !== 'object') return false;
  return String(entity.status || entity.Status || '').toLowerCase() === 'deleted';
}

function qboNativeCdcLogSamples_(entityName, entities) {
  const liveEntities = entities.filter(function(entity) {
    return !qboNativeCdcIsDeleted_(entity);
  });
  const deletedEntities = entities.filter(qboNativeCdcIsDeleted_);

  qboNativeCdcLogEntitySampleGroup_(entityName, 'LIVE_SAMPLE', liveEntities);
  qboNativeCdcLogEntitySampleGroup_(entityName, 'DELETED_SAMPLE', deletedEntities);
}

function qboNativeCdcLogEntitySampleGroup_(entityName, sampleType, entities) {
  const limit = Math.min(
    QBO_NATIVE_CDC_DIAGNOSTIC.SAMPLE_ENTITY_LIMIT,
    entities.length
  );

  for (let i = 0; i < limit; i += 1) {
    let json = JSON.stringify(entities[i], null, 2);
    if (json.length > QBO_NATIVE_CDC_DIAGNOSTIC.SAMPLE_JSON_MAX_CHARS) {
      json = json.slice(0, QBO_NATIVE_CDC_DIAGNOSTIC.SAMPLE_JSON_MAX_CHARS) +
        '\n...[sample truncated by diagnostic]';
    }
    console.log(
      `[NATIVE CDC] | ${sampleType} | entity=${entityName} | index=${i + 1} | ${json}`
    );
  }
}

function qboNativeCdcArray_(value) {
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}
