/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 3490_QBO_OperatorCommands.js
 * Purpose     : Predictable human/operator entry points for governed pipelines.
 *
 * Phase B bootstrap:
 * - Status/list commands are read-only.
 * - Trigger mutation and resume commands fail closed.
 * - No existing State Capture pipeline can be resumed from this module.
 */

function listQboPipelineStatuses() {
  const result = qboPipelineStatuses_();
  console.log('[PIPELINE CONTROL] | STATUSES | ' + JSON.stringify(result, null, 2));
  return result;
}

function listAllQboPipelineTriggers() {
  const result = qboPipelineTriggerInventory_();
  console.log('[PIPELINE CONTROL] | TRIGGER INVENTORY | ' + JSON.stringify(result, null, 2));
  return result;
}

function getQboPipelineStatus(pipelineId) {
  const result = qboPipelineStatus_(pipelineId);
  console.log('[PIPELINE CONTROL] | STATUS | ' + JSON.stringify(result, null, 2));
  return result;
}

function listQboPipelineTriggers(pipelineId) {
  const result = qboPipelineReconcileTriggerStateReadOnly_(pipelineId);
  console.log('[PIPELINE CONTROL] | PIPELINE TRIGGERS | ' + JSON.stringify(result, null, 2));
  return result;
}

function runQboPipelineWatchdog(pipelineId) {
  const result = qboPipelineRunWatchdog_(pipelineId);
  console.log('[PIPELINE CONTROL] | WATCHDOG DIAGNOSTIC | ' + JSON.stringify(result, null, 2));
  return result;
}

function pauseQboPipeline(pipelineId) {
  const result = qboPipelinePause_(pipelineId);
  console.log('[PIPELINE CONTROL] | GOVERNED PAUSE STATE SET | ' + JSON.stringify(result));
  return result;
}

function resumeQboPipeline(pipelineId) {
  return qboPipelineResume_(pipelineId);
}

function installQboPipelineTriggers(pipelineId) {
  return qboPipelineInstallTriggers_(pipelineId);
}

function removeQboPipelineTriggers(pipelineId) {
  return qboPipelineRemoveTriggers_(pipelineId);
}
/**
 * v1.5.136 operator wrappers — append to existing 3490_QBO_OperatorCommands.js.
 */
function previewDailyFullExportAdminPause() {
  return previewDailyFullExportAdministrativePause();
}

function pauseDailyFullExportAdmin() {
  return pauseDailyFullExportAdministrativeSchedule();
}

function previewDailyFullExportAdminResume() {
  return previewDailyFullExportAdministrativeResume();
}

function resumeDailyFullExportAdmin() {
  return resumeDailyFullExportAdministrativeSchedule();
}

/**
 * v1.5.140 — DAILY_FULL_EXPORT watchdog operator wrapper.
 *
 * Human/operator-facing no-argument wrapper only.
 * Business logic remains owned by 3450_QBO_Pipeline_Watchdog.js.
 */
function watchDailyFullExport() {
  return runQboPipelineWatchdog('DAILY_FULL_EXPORT');
}


/* Routine wrappers. Resume remains intentionally fail-closed in Phase B. */
function pauseNativeCdcPipeline() {
  return pauseQboPipeline(QBO_PIPELINE_IDS_.NATIVE_CDC_ACQUISITION);
}
function resumeNativeCdcPipeline() {
  return resumeQboPipeline(QBO_PIPELINE_IDS_.NATIVE_CDC_ACQUISITION);
}
function pauseWebhookPipeline() {
  return pauseQboPipeline(QBO_PIPELINE_IDS_.WEBHOOK_INGESTION_LEGACY);
}
function resumeWebhookPipeline() {
  return resumeQboPipeline(QBO_PIPELINE_IDS_.WEBHOOK_INGESTION_LEGACY);
}
function pauseFullExportIngestionPipeline() {
  return pauseQboPipeline(QBO_PIPELINE_IDS_.FULL_EXPORT_INGESTION_LEGACY);
}
function resumeFullExportIngestionPipeline() {
  return resumeQboPipeline(QBO_PIPELINE_IDS_.FULL_EXPORT_INGESTION_LEGACY);
}

/**
 * Operator command: controlled zero-trigger-churn administrative cutover for
 * DAILY_FULL_EXPORT.
 */
function cutoverDailyFullExportAdminAuthority() {
  return cutoverQboDailyFullExportAdministrativeAuthority(
    QBO_PIPELINE_ADMIN_CUTOVER_TOKEN_
  );
}

/**
 * Operator validation command retained after v1.5.134 runtime validation.
 */
function validateDailyFullExportAuthorityAwareStatus() {
  return validateQboPipelineAuthorityAwareStatus(
    QBO_PIPELINE_IDS_.DAILY_FULL_EXPORT
  );
}

/**
 * Normal unified-status validation after v1.5.135 integration.
 */
function validateDailyFullExportUnifiedStatus() {
  return getQboPipelineStatus(QBO_PIPELINE_IDS_.DAILY_FULL_EXPORT);
}

