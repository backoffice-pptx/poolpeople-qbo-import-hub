/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 141_QBO_WebhookTargetedCaptureReconciliationV2.js
 * Version     : 1.5.120
 * Purpose     : READ-ONLY reconciliation of candidate 04_Webhook_Events_V2
 *               non-delete events to immutable targeted-capture evidence.
 *
 * No writes to workbook, Drive, Script Properties, triggers, payloads or State Application.
 */
const QBO_WEBHOOK_CAPTURE_RECON_1_5_120 = Object.freeze({
  VERSION: 'QBO_WEBHOOK_TARGETED_CAPTURE_RECON_V1_5_120',
  CAPTURED_STATES_FOLDER_ASSET_KEY: 'QBO_CAPTURED_STATES_FOLDER',
  CAPTURED_STATES_FOLDER_EXPECTED_TYPE: 'Folder',
  ENVIRONMENT: 'PROD',
  CAPTURE_FILE_PREFIX: 'qbo_webhook_entity_capture_'
});

function auditQboWebhookTargetedCaptureReconciliationV2() {
  const preview = previewQboWebhookSourceLedgerV2();
  if (!preview || !preview.summary ||
      preview.summary.status !== 'READY_FOR_CONTROLLED_WRITE' ||
      Number(preview.summary.findingCount || 0) !== 0) {
    throw new Error('WEBHOOK_04_PREVIEW_NOT_CLEAN');
  }

  const C = QBO_WEBHOOK_CAPTURE_RECON_1_5_120;
  const folder = qboResolveGovernedFolderAsset_(
    C.CAPTURED_STATES_FOLDER_ASSET_KEY,
    C.CAPTURED_STATES_FOLDER_EXPECTED_TYPE,
    C.ENVIRONMENT
  );

  const findings = [];
  const details = [];
  const byOperation = Object.create(null);
  let required = 0, notRequired = 0, present = 0, missing = 0, invalid = 0;

  preview.events.forEach(function(row) {
    const op = String(row.EventOperation || '').toUpperCase();
    if (!byOperation[op]) byOperation[op] = {events:0, captureRequired:0, present:0, missing:0, invalid:0, notRequired:0};
    byOperation[op].events++;

    if (op === 'DELETE') {
      notRequired++;
      byOperation[op].notRequired++;
      details.push({
        WebhookEventId: row.WebhookEventId,
        operation: op,
        entityType: row.EntityType,
        entityId: row.EntityId,
        status: 'NOT_REQUIRED'
      });
      return;
    }

    required++;
    byOperation[op].captureRequired++;

    // Production capture identity is based on the forward-ingestion source observation ID.
    // For receipt-level forward sources:
    // WEBHOOK|<receipt>|OBS|<index>|<entityType>|<entityId>|<operation>
    const sourceObservationId =
      'WEBHOOK|' + row.WebhookReceiptId +
      '|OBS|' + row.EventIndex +
      '|' + row.EntityType +
      '|' + row.EntityId +
      '|' + op;

    const observationHash = qboStateCaptureAuditSha256_(sourceObservationId);
    const fileName = C.CAPTURE_FILE_PREFIX + observationHash + '.json';
    const files = folder.getFilesByName(fileName);

    if (!files.hasNext()) {
      missing++;
      byOperation[op].missing++;
      details.push({
        WebhookEventId: row.WebhookEventId,
        sourceObservationId: sourceObservationId,
        operation: op,
        entityType: row.EntityType,
        entityId: row.EntityId,
        expectedCaptureFileName: fileName,
        status: 'MISSING'
      });
      return;
    }

    const file = files.next();
    if (files.hasNext()) {
      invalid++;
      byOperation[op].invalid++;
      findings.push({
        code:'DUPLICATE_CAPTURE_FILE_NAME',
        WebhookEventId:row.WebhookEventId,
        expectedCaptureFileName:fileName
      });
      return;
    }

    let envelope;
    try {
      envelope = JSON.parse(file.getBlob().getDataAsString('UTF-8'));
    } catch (e) {
      invalid++;
      byOperation[op].invalid++;
      findings.push({
        code:'CAPTURE_INVALID_JSON',
        WebhookEventId:row.WebhookEventId,
        fileId:file.getId(),
        fileName:file.getName()
      });
      return;
    }

    try {
      qboWebhookForwardValidateCapturedEntity_(envelope, sourceObservationId, {
        entityType:row.EntityType,
        entityId:row.EntityId,
        operation:op,
        sourceChangeTime:row.SourceChangeTime
      });
    } catch (e) {
      invalid++;
      byOperation[op].invalid++;
      findings.push({
        code:'CAPTURE_VALIDATION_FAILED',
        WebhookEventId:row.WebhookEventId,
        fileId:file.getId(),
        fileName:file.getName(),
        reason:String(e && e.message ? e.message : e)
      });
      return;
    }

    present++;
    byOperation[op].present++;
    details.push({
      WebhookEventId:row.WebhookEventId,
      sourceObservationId:sourceObservationId,
      operation:op,
      entityType:row.EntityType,
      entityId:row.EntityId,
      status:'PRESENT_VALID',
      captureFileId:file.getId(),
      captureFileName:file.getName(),
      capturedAt:String(envelope.capturedAt || ''),
      rawEntityHash:String(envelope.rawEntityHash || '')
    });
  });

  const summary = {
    version:C.VERSION,
    mode:'READ_ONLY',
    candidate04EventCount:preview.events.length,
    captureRequiredCount:required,
    captureNotRequiredCount:notRequired,
    capturePresentValidCount:present,
    captureMissingCount:missing,
    captureInvalidCount:invalid,
    byOperation:byOperation,
    findingCount:findings.length,
    status:(invalid===0 && findings.length===0) ? 'RECONCILIATION_COMPLETE' : 'ACTION_REQUIRED',
    controls:{
      writes04:false,writes05:false,writes06:false,writesPayloads:false,
      writesDrive:false,writesProperties:false,writesTriggers:false,writesStateApplication:false
    }
  };

  console.log('[WEBHOOK CAPTURE RECON 1.5.120] | SUMMARY | ' + JSON.stringify(summary));
  console.log('[WEBHOOK CAPTURE RECON 1.5.120] | FINDINGS | ' + JSON.stringify(findings));
  return {summary:summary, details:details, findings:findings};
}
