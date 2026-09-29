/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 3425_QBO_Pipeline_AdministrativeAuthorityCutover.js
 * Version     : 1.5.131
 * Purpose     : Controlled zero-trigger-churn administrative authority cutover.
 *
 * v1.5.131 is intentionally scoped ONLY to DAILY_FULL_EXPORT.
 * It initializes governed administrative state from freshly proven legacy
 * state, but does not create/delete triggers or alter module-24 queue state.
 */

const QBO_PIPELINE_ADMIN_CUTOVER_VERSION_ = 'QBO_PIPELINE_ADMIN_CUTOVER_V1';
const QBO_PIPELINE_ADMIN_AUTHORITY_PROPERTY_PREFIX_ =
  'QBO_PIPELINE_ADMIN_AUTHORITY_V1__';
const QBO_PIPELINE_ADMIN_CUTOVER_TOKEN_ =
  'CUTOVER_DAILY_FULL_EXPORT_ADMIN_AUTHORITY';

function qboPipelineAdminAuthorityKey_(pipelineId) {
  return QBO_PIPELINE_ADMIN_AUTHORITY_PROPERTY_PREFIX_ + pipelineId;
}

function qboReadPipelineAdminAuthority_(pipelineId) {
  const raw = PropertiesService.getScriptProperties()
    .getProperty(qboPipelineAdminAuthorityKey_(pipelineId));
  if (!raw) {
    return {
      pipelineId: pipelineId,
      initialized: false,
      authority: 'LEGACY',
      cutoverVersion: '',
      cutoverAt: ''
    };
  }
  const parsed = JSON.parse(raw);
  parsed.initialized = true;
  return parsed;
}

function previewQboDailyFullExportAdministrativeCutover() {
  const readiness = auditQboDailyFullExportCutoverReadiness();
  const currentAuthority =
    qboReadPipelineAdminAuthority_(QBO_PIPELINE_IDS_.DAILY_FULL_EXPORT);
  const status = getQboPipelineStatus(QBO_PIPELINE_IDS_.DAILY_FULL_EXPORT);

  const proposed = {
    pipelineId: QBO_PIPELINE_IDS_.DAILY_FULL_EXPORT,
    administrativeState: status.EnabledPaused === 'ENABLED' ? 'ENABLED' : 'PAUSED',
    authority: 'GOVERNED_34XX',
    executionAuthority: '24_TriggerManagement.js',
    preserveExistingTriggers: true,
    preserveQueueWorkerSemantics: true
  };

  const result = {
    version: QBO_PIPELINE_ADMIN_CUTOVER_VERSION_,
    mode: 'PREVIEW_READ_ONLY',
    valid: readiness.valid === true &&
           currentAuthority.authority !== 'GOVERNED_34XX',
    mutationPermitted: false,
    readinessValid: readiness.valid,
    currentAuthority: currentAuthority,
    observedLegacyStatus: {
      EnabledPaused: status.EnabledPaused,
      OperationalStatus: status.OperationalStatus,
      TriggerInstalled: status.TriggerInstalled,
      TriggerCount: status.TriggerCount,
      CurrentRunId: status.CurrentRunId || ''
    },
    proposedState: proposed
  };

  console.log('[PIPELINE CONTROL] | DAILY FULL_EXPORT ADMIN CUTOVER PREVIEW | ' +
              JSON.stringify(result, null, 2));
  return result;
}

/**
 * Controlled cutover. The only writes are governed Script Properties recording
 * administrative state/authority. No trigger, queue, workbook, or Drive writes.
 */
function cutoverQboDailyFullExportAdministrativeAuthority(confirmationToken) {
  if (String(confirmationToken || '') !== QBO_PIPELINE_ADMIN_CUTOVER_TOKEN_) {
    throw new Error('Confirmation token mismatch. No cutover performed.');
  }

  const preview = previewQboDailyFullExportAdministrativeCutover();
  if (!preview.valid) {
    throw new Error('Daily FULL_EXPORT administrative cutover readiness failed. No cutover performed.');
  }

  const beforeTriggers = ScriptApp.getProjectTriggers().map(function(t) {
    return t.getHandlerFunction() + '|' + t.getUniqueId();
  }).sort();

  const props = PropertiesService.getScriptProperties();
  const now = new Date().toISOString();

  /*
   * Existing 3420 governed administrative state is initialized to mirror
   * observed legacy truth. Then a separate authority marker records cutover.
   * This does not alter the legacy queue or trigger set.
   */
  qboPipelineWriteAdministrativeState_(
    QBO_PIPELINE_IDS_.DAILY_FULL_EXPORT,
    preview.proposedState.administrativeState,
    {
      reason: 'CONTROLLED_ADMIN_AUTHORITY_CUTOVER',
      sourceAuthority: 'LEGACY_DAILY_EXPORT_STATE',
      cutoverVersion: QBO_PIPELINE_ADMIN_CUTOVER_VERSION_
    }
  );

  const authorityRecord = {
    pipelineId: QBO_PIPELINE_IDS_.DAILY_FULL_EXPORT,
    authority: 'GOVERNED_34XX',
    executionAuthority: '24_TriggerManagement.js',
    cutoverVersion: QBO_PIPELINE_ADMIN_CUTOVER_VERSION_,
    cutoverAt: now
  };
  props.setProperty(
    qboPipelineAdminAuthorityKey_(QBO_PIPELINE_IDS_.DAILY_FULL_EXPORT),
    JSON.stringify(authorityRecord)
  );

  const afterTriggers = ScriptApp.getProjectTriggers().map(function(t) {
    return t.getHandlerFunction() + '|' + t.getUniqueId();
  }).sort();

  if (JSON.stringify(beforeTriggers) !== JSON.stringify(afterTriggers)) {
    throw new Error(
      'SAFETY FAILURE: trigger set changed during zero-churn administrative cutover.'
    );
  }

  const result = {
    version: QBO_PIPELINE_ADMIN_CUTOVER_VERSION_,
    status: 'CUTOVER_COMPLETE',
    pipelineId: QBO_PIPELINE_IDS_.DAILY_FULL_EXPORT,
    administrativeAuthority: 'GOVERNED_34XX',
    executionAuthority: '24_TriggerManagement.js',
    initializedAdministrativeState: preview.proposedState.administrativeState,
    triggerSetUnchanged: true,
    triggerCount: afterTriggers.length,
    queueWorkerSemanticsUnchanged: true,
    globalGenericTriggerApplyStillDisabled:
      typeof QBO_TRIGGER_APPLY_GLOBAL_ENABLED_ !== 'undefined'
        ? QBO_TRIGGER_APPLY_GLOBAL_ENABLED_ === false
        : true,
    cutoverAt: now
  };

  console.log('[PIPELINE CONTROL] | DAILY FULL_EXPORT ADMIN CUTOVER | ' +
              JSON.stringify(result, null, 2));
  return result;
}

function validateQboDailyFullExportAdministrativeAuthority() {
  const authority =
    qboReadPipelineAdminAuthority_(QBO_PIPELINE_IDS_.DAILY_FULL_EXPORT);
  const governed =
    qboPipelineReadAdministrativeState_(QBO_PIPELINE_IDS_.DAILY_FULL_EXPORT);
  const readiness = auditQboDailyFullExportCutoverReadiness();

  const result = {
    version: QBO_PIPELINE_ADMIN_CUTOVER_VERSION_,
    valid:
      authority.initialized === true &&
      authority.authority === 'GOVERNED_34XX' &&
      governed.initialized === true &&
      readiness.valid === true,
    authority: authority,
    governedAdministrativeState: governed,
    readinessStillValid: readiness.valid,
    mutationPermitted: false
  };
  console.log('[PIPELINE CONTROL] | DAILY FULL_EXPORT ADMIN AUTHORITY VALIDATION | ' +
              JSON.stringify(result, null, 2));
  return result;
}
