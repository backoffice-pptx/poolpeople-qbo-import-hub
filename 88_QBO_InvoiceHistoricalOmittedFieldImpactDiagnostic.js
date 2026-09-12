/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 88_QBO_InvoiceHistoricalOmittedFieldImpactDiagnostic.js
 * Version     : 1.5.30
 * Purpose     : Read-only historical impact diagnostic for the 15 Invoice
 *               fields now governed for inclusion but omitted from the legacy
 *               flattened QBO_Invoices contract.
 *
 * Question answered:
 *   Did historical changes in these omitted flattened fields already produce
 *   the expected canonical Snapshot / Change / Change Detail evidence under
 *   the prior RawJSON-based canonical migration, or are there historical
 *   transitions missing from canonical history?
 *
 * Safety:
 *   - No exporter behavior is changed.
 *   - No canonical rows are written.
 *   - No migration cursor is changed.
 *   - No historical contract audit cursor is changed.
 *
 * Public:
 *   auditQboInvoiceHistoricalOmittedFieldImpact()
 * ============================================================================
 */

const QBO_INVOICE_HISTORICAL_OMITTED_FIELD_IMPACT_ = Object.freeze({
  VERSION: '1.5.30',
  EXPORT_KEY: 'INVOICES',
  PARENT_SHEET: 'QBO_Invoices',
  FIELDS: Object.freeze([
    'AllowOnlineAffirmPayment',
    'AllowOnlinePayPalPayment',
    'BillEmailBcc',
    'BillEmailCc',
    'CreditCardPayment',
    'EInvoiceStatus',
    'FreeFormAddress',
    'PaymentMethodRef',
    'PaymentRefNum',
    'RecurDataRef',
    'ScheduledPaymentId',
    'ShipFromAddr',
    'ShipMethodRef',
    'TaxExemptionRef',
    'TxnApprovalInfo'
  ])
});

function auditQboInvoiceHistoricalOmittedFieldImpact() {
  const cfg = QBO_INVOICE_HISTORICAL_OMITTED_FIELD_IMPACT_;
  const stateSs = getQboStateCaptureSpreadsheet_();
  const sourceSheet = stateSs.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SOURCES);
  const sources = loadQboStateCaptureWriteSources_(sourceSheet, cfg.EXPORT_KEY)
    .filter(function(source) {
      return source.sourceStatus === QBO_STATE_CAPTURE.SOURCE_STATUS_AVAILABLE;
    });

  const canonicalEvidence = qboInvoiceImpactLoadCanonicalEvidence_(stateSs);
  const priorByEntity = Object.create(null);
  const entitySeen = Object.create(null);
  const perField = Object.create(null);
  cfg.FIELDS.forEach(function(field) {
    perField[field] = {
      fieldChangeCount: 0,
      fullyCapturedCount: 0,
      partiallyCapturedCount: 0,
      noSnapshotCount: 0,
      snapshotWithoutChangeCount: 0,
      detailMissingCount: 0
    };
  });

  let sourceRows = 0;
  let completeRawRows = 0;
  let truncatedRawRows = 0;
  let invalidRawRows = 0;
  let transitionEvents = 0;
  let fieldChanges = 0;
  let fullyCapturedEvents = 0;
  let partiallyCapturedEvents = 0;
  let noSnapshotEvents = 0;
  let snapshotWithoutChangeEvents = 0;
  const eventExamples = [];
  const missingExamples = [];
  const sourcePairCounts = Object.create(null);

  sources.forEach(function(source, sourceIndex) {
    validateQboStateCaptureWriteSource_(source, getQboExportManifestEntry_(cfg.EXPORT_KEY));
    const sourceSs = SpreadsheetApp.openById(source.masterBackupFileId);
    const sheet = sourceSs.getSheetByName(cfg.PARENT_SHEET);
    if (!sheet) {
      throw new Error(
        'INVOICE_HISTORICAL_IMPACT_PARENT_SHEET_MISSING sourceIndex=' + sourceIndex +
        ' file=' + source.masterBackupFileName
      );
    }

    const data = qboInvoiceImpactReadSheet_(sheet);
    if (data.index.RawJSON === undefined) {
      throw new Error(
        'INVOICE_HISTORICAL_IMPACT_RAWJSON_COLUMN_MISSING sourceIndex=' + sourceIndex +
        ' file=' + source.masterBackupFileName
      );
    }

    data.rows.forEach(function(row) {
      sourceRows += 1;
      const raw = String(row[data.index.RawJSON] || '');
      if (raw.indexOf(QBO_STATE_CAPTURE_RAW_TRUNCATION_MARKER_) !== -1) {
        truncatedRawRows += 1;
        return;
      }

      let invoice;
      try {
        invoice = JSON.parse(raw);
      } catch (e) {
        invalidRawRows += 1;
        return;
      }

      completeRawRows += 1;
      const entityId = String(invoice.Id || '').trim();
      if (!entityId) return;
      entitySeen[entityId] = true;

      const current = Object.create(null);
      cfg.FIELDS.forEach(function(field) {
        current[field] = qboInvoiceImpactStableString_(
          Object.prototype.hasOwnProperty.call(invoice, field) ? invoice[field] : '__ABSENT__'
        );
      });

      const prior = priorByEntity[entityId];
      if (prior) {
        const changedFields = cfg.FIELDS.filter(function(field) {
          return prior.values[field] !== current[field];
        });

        if (changedFields.length) {
          transitionEvents += 1;
          fieldChanges += changedFields.length;
          const pairKey = prior.sourceIndex + '->' + sourceIndex;
          sourcePairCounts[pairKey] = (sourcePairCounts[pairKey] || 0) + 1;
          changedFields.forEach(function(field) {
            perField[field].fieldChangeCount += 1;
          });

          const snapshotKey = qboInvoiceImpactEvidenceKey_(source.sourceId, entityId);
          const snapshot = canonicalEvidence.snapshotBySourceEntity[snapshotKey] || null;
          const change = snapshot
            ? (canonicalEvidence.changeByAfterSnapshotId[snapshot.snapshotRecordId] || null)
            : null;
          const detailPaths = change
            ? (canonicalEvidence.detailPathsByChangeId[change.changeRecordId] || [])
            : [];

          let classification;
          let missingFields = [];
          if (!snapshot) {
            classification = 'NO_EXISTING_SNAPSHOT';
            noSnapshotEvents += 1;
            changedFields.forEach(function(field) { perField[field].noSnapshotCount += 1; });
          } else if (!change) {
            classification = 'SNAPSHOT_WITHOUT_CHANGE';
            snapshotWithoutChangeEvents += 1;
            changedFields.forEach(function(field) { perField[field].snapshotWithoutChangeCount += 1; });
          } else {
            missingFields = changedFields.filter(function(field) {
              return !detailPaths.some(function(path) {
                return qboInvoiceImpactPathMatchesField_(path, field);
              });
            });
            if (missingFields.length) {
              classification = 'PARTIALLY_CAPTURED_DETAIL_MISSING';
              partiallyCapturedEvents += 1;
              changedFields.forEach(function(field) { perField[field].partiallyCapturedCount += 1; });
              missingFields.forEach(function(field) { perField[field].detailMissingCount += 1; });
            } else {
              classification = 'FULLY_CAPTURED_IN_CANONICAL_HISTORY';
              fullyCapturedEvents += 1;
              changedFields.forEach(function(field) { perField[field].fullyCapturedCount += 1; });
            }
          }

          const example = {
            entityId: entityId,
            docNumber: invoice.DocNumber === undefined || invoice.DocNumber === null ? '' : String(invoice.DocNumber),
            fromSourceIndex: prior.sourceIndex,
            toSourceIndex: sourceIndex,
            toSourceId: source.sourceId || '',
            changedFields: changedFields,
            classification: classification,
            snapshotRecordId: snapshot ? snapshot.snapshotRecordId : '',
            changeRecordId: change ? change.changeRecordId : '',
            changeType: change ? change.changeType : '',
            missingChangedFieldsFromDetail: missingFields,
            matchingDetailPaths: detailPaths.filter(function(path) {
              return changedFields.some(function(field) {
                return qboInvoiceImpactPathMatchesField_(path, field);
              });
            })
          };

          if (eventExamples.length < 40) eventExamples.push(example);
          if (classification !== 'FULLY_CAPTURED_IN_CANONICAL_HISTORY' && missingExamples.length < 40) {
            missingExamples.push(example);
          }
        }
      }

      priorByEntity[entityId] = {
        sourceIndex: sourceIndex,
        sourceId: source.sourceId || '',
        values: current
      };
    });
  });

  const allHistoricalFieldChangesCaptured =
    transitionEvents > 0 &&
    noSnapshotEvents === 0 &&
    snapshotWithoutChangeEvents === 0 &&
    partiallyCapturedEvents === 0 &&
    fullyCapturedEvents === transitionEvents;

  const result = {
    version: cfg.VERSION,
    canonicalizationVersion: QBO_STATE_CAPTURE.CANONICALIZATION_VERSION,
    mode: 'INVOICE_HISTORICAL_OMITTED_FIELD_IMPACT_DIAGNOSTIC',
    architectureRule:
      'The 15 Invoice fields are governed for inclusion. This diagnostic tests whether their historical changes were already captured by prior RawJSON-based canonical migration evidence.',
    exportKey: cfg.EXPORT_KEY,
    governedIncludedFields: cfg.FIELDS.slice(),
    sourcesFound: sources.length,
    population: {
      sourceRows: sourceRows,
      completeRawRows: completeRawRows,
      truncatedRawRows: truncatedRawRows,
      invalidRawRows: invalidRawRows,
      distinctEntities: Object.keys(entitySeen).length
    },
    canonicalEvidencePopulation: canonicalEvidence.population,
    historicalImpact: {
      distinctTransitionEventsWithGovernedOmittedFieldChanges: transitionEvents,
      totalGovernedOmittedFieldChanges: fieldChanges,
      fullyCapturedEvents: fullyCapturedEvents,
      partiallyCapturedEvents: partiallyCapturedEvents,
      noExistingSnapshotEvents: noSnapshotEvents,
      snapshotWithoutChangeEvents: snapshotWithoutChangeEvents,
      allHistoricalFieldChangesCaptured: allHistoricalFieldChangesCaptured
    },
    perField: perField,
    sourcePairTransitionCounts: qboInvoiceImpactCountMapToArray_(sourcePairCounts),
    eventExamples: eventExamples,
    unresolvedExamples: missingExamples,
    governanceConclusion: allHistoricalFieldChangesCaptured
      ? 'PASS_EXISTING_INVOICE_CANONICAL_HISTORY_ALREADY_CAPTURED_ALL_OBSERVED_OMITTED_FIELD_CHANGES'
      : 'ACTION_REQUIRED_EXISTING_INVOICE_CANONICAL_HISTORY_DOES_NOT_FULLY_CAPTURE_OBSERVED_OMITTED_FIELD_CHANGES',
    canonicalWritesPerformed: false,
    migrationCursorChanged: false,
    historicalContractAuditCursorChanged: false
  };

  qboInvoiceImpactLog_(result);
  return result;
}

function qboInvoiceImpactLoadCanonicalEvidence_(stateSs) {
  const snapshotSheet = stateSs.getSheetByName(QBO_STATE_CAPTURE.SHEETS.SNAPSHOTS);
  const changeSheet = stateSs.getSheetByName(QBO_STATE_CAPTURE.SHEETS.CHANGES);
  const detailSheet = stateSs.getSheetByName(QBO_STATE_CAPTURE.SHEETS.CHANGE_DETAIL);
  if (!snapshotSheet || !changeSheet || !detailSheet) {
    throw new Error('INVOICE_HISTORICAL_IMPACT_CANONICAL_EVIDENCE_SHEETS_MISSING');
  }

  const snapshotData = qboInvoiceImpactReadSheet_(snapshotSheet);
  const changeData = qboInvoiceImpactReadSheet_(changeSheet);
  const detailData = qboInvoiceImpactReadSheet_(detailSheet);
  const snapshotBySourceEntity = Object.create(null);
  const changeByAfterSnapshotId = Object.create(null);
  const detailPathsByChangeId = Object.create(null);
  let invoiceSnapshots = 0;
  let invoiceChanges = 0;
  let invoiceDetails = 0;

  snapshotData.rows.forEach(function(row) {
    if (snapshotData.index.ExportKey === undefined ||
        String(row[snapshotData.index.ExportKey] || '').trim() !== 'INVOICES') return;
    const sourceId = String(row[snapshotData.index.SourceId] || '').trim();
    const entityId = String(row[snapshotData.index.EntityId] || '').trim();
    const snapshotRecordId = String(row[snapshotData.index.SnapshotRecordId] || '').trim();
    if (!sourceId || !entityId || !snapshotRecordId) return;
    invoiceSnapshots += 1;
    snapshotBySourceEntity[qboInvoiceImpactEvidenceKey_(sourceId, entityId)] = {
      snapshotRecordId: snapshotRecordId,
      snapshotReason: snapshotData.index.SnapshotReason === undefined ? '' : String(row[snapshotData.index.SnapshotReason] || '')
    };
  });

  changeData.rows.forEach(function(row) {
    const afterSnapshotId = changeData.index.AfterSnapshotRecordId === undefined
      ? '' : String(row[changeData.index.AfterSnapshotRecordId] || '').trim();
    if (!afterSnapshotId) return;
    const entityType = changeData.index.EntityType === undefined ? '' : String(row[changeData.index.EntityType] || '').trim();
    if (entityType && entityType.toUpperCase() !== 'INVOICE' && entityType.toUpperCase() !== 'INVOICES') return;
    const changeRecordId = String(row[changeData.index.ChangeRecordId] || '').trim();
    if (!changeRecordId) return;
    invoiceChanges += 1;
    changeByAfterSnapshotId[afterSnapshotId] = {
      changeRecordId: changeRecordId,
      changeType: changeData.index.ChangeType === undefined ? '' : String(row[changeData.index.ChangeType] || ''),
      changedFieldCount: changeData.index.ChangedFieldCount === undefined ? '' : row[changeData.index.ChangedFieldCount]
    };
  });

  detailData.rows.forEach(function(row) {
    const entityType = detailData.index.EntityType === undefined ? '' : String(row[detailData.index.EntityType] || '').trim();
    if (entityType && entityType.toUpperCase() !== 'INVOICE' && entityType.toUpperCase() !== 'INVOICES') return;
    const changeRecordId = String(row[detailData.index.ChangeRecordId] || '').trim();
    const path = detailData.index.Path === undefined ? '' : String(row[detailData.index.Path] || '').trim();
    if (!changeRecordId || !path) return;
    invoiceDetails += 1;
    if (!detailPathsByChangeId[changeRecordId]) detailPathsByChangeId[changeRecordId] = [];
    detailPathsByChangeId[changeRecordId].push(path);
  });

  return {
    snapshotBySourceEntity: snapshotBySourceEntity,
    changeByAfterSnapshotId: changeByAfterSnapshotId,
    detailPathsByChangeId: detailPathsByChangeId,
    population: {
      invoiceSnapshots: invoiceSnapshots,
      invoiceChanges: invoiceChanges,
      invoiceChangeDetails: invoiceDetails
    }
  };
}

function qboInvoiceImpactPathMatchesField_(path, field) {
  const p = String(path || '');
  const f = String(field || '');
  return p === f || p.indexOf(f + '.') === 0 || p.indexOf(f + '[') === 0;
}

function qboInvoiceImpactEvidenceKey_(sourceId, entityId) {
  return String(sourceId || '') + '\u001F' + String(entityId || '');
}

function qboInvoiceImpactReadSheet_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (!values.length) return {headers: [], index: {}, rows: []};
  const headers = values[0].map(function(v) { return String(v || '').trim(); });
  const index = {};
  headers.forEach(function(header, i) { if (header) index[header] = i; });
  return {
    headers: headers,
    index: index,
    rows: values.slice(1).filter(function(row) {
      return row.some(function(v) { return v !== '' && v !== null; });
    })
  };
}

function qboInvoiceImpactStableString_(value) {
  if (value === '__ABSENT__') return '__ABSENT__';
  if (value === undefined) return '__UNDEFINED__';
  if (value === null) return 'null';
  if (typeof value === 'object') return JSON.stringify(qboInvoiceImpactSortObject_(value));
  return JSON.stringify(value);
}

function qboInvoiceImpactSortObject_(value) {
  if (Array.isArray(value)) return value.map(qboInvoiceImpactSortObject_);
  if (!value || typeof value !== 'object') return value;
  const out = {};
  Object.keys(value).sort().forEach(function(key) {
    out[key] = qboInvoiceImpactSortObject_(value[key]);
  });
  return out;
}

function qboInvoiceImpactCountMapToArray_(map) {
  return Object.keys(map).map(function(key) {
    return {sourcePair: key, count: map[key]};
  }).sort(function(a, b) {
    return a.sourcePair < b.sourcePair ? -1 : (a.sourcePair > b.sourcePair ? 1 : 0);
  });
}

function qboInvoiceImpactLog_(result) {
  console.log(JSON.stringify({
    version: result.version,
    mode: result.mode,
    sourcesFound: result.sourcesFound,
    population: result.population,
    canonicalEvidencePopulation: result.canonicalEvidencePopulation,
    historicalImpact: result.historicalImpact,
    governanceConclusion: result.governanceConclusion,
    canonicalWritesPerformed: result.canonicalWritesPerformed,
    migrationCursorChanged: result.migrationCursorChanged,
    historicalContractAuditCursorChanged: result.historicalContractAuditCursorChanged
  }));

  Object.keys(result.perField).forEach(function(field) {
    const stats = result.perField[field];
    console.log(JSON.stringify({
      field: field,
      fieldChangeCount: stats.fieldChangeCount,
      fullyCapturedCount: stats.fullyCapturedCount,
      partiallyCapturedCount: stats.partiallyCapturedCount,
      noSnapshotCount: stats.noSnapshotCount,
      snapshotWithoutChangeCount: stats.snapshotWithoutChangeCount,
      detailMissingCount: stats.detailMissingCount
    }));
  });

  result.eventExamples.forEach(function(event, i) {
    console.log(JSON.stringify({
      eventExample: i + 1,
      entityId: event.entityId,
      docNumber: event.docNumber,
      fromSourceIndex: event.fromSourceIndex,
      toSourceIndex: event.toSourceIndex,
      changedFields: event.changedFields,
      classification: event.classification,
      snapshotRecordId: event.snapshotRecordId,
      changeRecordId: event.changeRecordId,
      changeType: event.changeType,
      missingChangedFieldsFromDetail: event.missingChangedFieldsFromDetail,
      matchingDetailPaths: event.matchingDetailPaths
    }));
  });

  console.log(
    '[INVOICE HISTORICAL OMITTED FIELD IMPACT] | ' +
    (result.historicalImpact.allHistoricalFieldChangesCaptured ? 'PASS' : 'ACTION_REQUIRED') +
    ' | transitionEvents=' + result.historicalImpact.distinctTransitionEventsWithGovernedOmittedFieldChanges +
    ' | fieldChanges=' + result.historicalImpact.totalGovernedOmittedFieldChanges +
    ' | fullyCaptured=' + result.historicalImpact.fullyCapturedEvents +
    ' | partial=' + result.historicalImpact.partiallyCapturedEvents +
    ' | noSnapshot=' + result.historicalImpact.noExistingSnapshotEvents +
    ' | snapshotNoChange=' + result.historicalImpact.snapshotWithoutChangeEvents
  );
}
