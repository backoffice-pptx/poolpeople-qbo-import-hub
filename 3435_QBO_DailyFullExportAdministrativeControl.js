/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 3435_QBO_DailyFullExportAdministrativeControl.js
 * Version     : 1.5.136
 * Purpose     : DAILY_FULL_EXPORT-only governed administrative pause/resume.
 *
 * Contract:
 * - Administrative pause prevents future scheduled daily starts.
 * - It removes only the durable START trigger.
 * - It never removes the transient NEXT trigger, clears queue state, cancels
 *   run history, or interrupts an active/queued daily run.
 * - Administrative resume restores exactly one durable START trigger and does
 *   not start/resume a run immediately.
 * - No other pipeline is mutation-authorized here.
 */

const QBO_DAILY_FULL_EXPORT_ADMIN_CONTROL_VERSION_ =
  'QBO_DAILY_FULL_EXPORT_ADMIN_CONTROL_V1';

function qboDailyFullExportAssertGovernedAuthority_() {
  const authority = qboPipelineReadAdministrativeAuthority_(
    QBO_PIPELINE_IDS_.DAILY_FULL_EXPORT
  );

  if (!authority ||
      authority.initialized !== true ||
      authority.authority !== 'GOVERNED_34XX' ||
      authority.executionAuthority !== '24_TriggerManagement.js') {
    throw new Error(
      'DAILY_FULL_EXPORT_ADMIN_CONTROL_AUTHORITY_NOT_ESTABLISHED'
    );
  }
  return authority;
}

function qboDailyFullExportTriggerPartition_() {
  const rows = qboPipelineProjectTriggerRows_();
  return {
    starters: rows.filter(function(row) {
      return row.handler === DAILY_QBO_TRIGGER_HANDLERS.START;
    }),
    continuations: rows.filter(function(row) {
      return row.handler === DAILY_QBO_TRIGGER_HANDLERS.NEXT;
    })
  };
}

function previewDailyFullExportAdministrativePause() {
  const authority = qboDailyFullExportAssertGovernedAuthority_();
  const status = qboPipelineStatus_(QBO_PIPELINE_IDS_.DAILY_FULL_EXPORT);
  const triggers = qboDailyFullExportTriggerPartition_();

  const result = {
    version: QBO_DAILY_FULL_EXPORT_ADMIN_CONTROL_VERSION_,
    mode: 'PREVIEW_READ_ONLY',
    operation: 'PAUSE',
    pipelineId: QBO_PIPELINE_IDS_.DAILY_FULL_EXPORT,
    authority: authority.authority,
    executionAuthority: authority.executionAuthority,
    governedAdministrativeState: status.GovernedAdministrativeState,
    operationalStatus: status.OperationalStatus,
    currentRunId: status.CurrentRunId,
    starterTriggerCount: triggers.starters.length,
    continuationTriggerCount: triggers.continuations.length,
    proposedStarterDeletes: triggers.starters.map(function(row) {
      return row.triggerId;
    }),
    continuationTriggersPreserved: true,
    queueStatePreserved: true,
    runHistoryPreserved: true,
    activeRunInterrupted: false,
    mutationPermitted: false
  };

  console.log('[PIPELINE CONTROL] | DAILY ADMIN PAUSE PREVIEW | ' +
    JSON.stringify(result, null, 2));
  return result;
}

function pauseDailyFullExportAdministrativeSchedule() {
  qboDailyFullExportAssertGovernedAuthority_();

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const before = qboDailyFullExportTriggerPartition_();

    /* Delete only the durable daily starter. Never touch NEXT. */
    const starterIds = {};
    before.starters.forEach(function(row) { starterIds[row.triggerId] = true; });
    ScriptApp.getProjectTriggers().forEach(function(trigger) {
      if (starterIds[String(trigger.getUniqueId() || '')]) {
        ScriptApp.deleteTrigger(trigger);
      }
    });

    qboPipelineWriteAdministrativeState_(
      QBO_PIPELINE_IDS_.DAILY_FULL_EXPORT,
      'PAUSED',
      {
        reason: 'GOVERNED_ADMINISTRATIVE_PAUSE',
        administrativeControlVersion:
          QBO_DAILY_FULL_EXPORT_ADMIN_CONTROL_VERSION_
      }
    );
  } finally {
    lock.releaseLock();
  }

  const after = qboDailyFullExportTriggerPartition_();
  if (after.starters.length !== 0) {
    throw new Error(
      'DAILY_FULL_EXPORT_ADMIN_PAUSE_POSTCONDITION_FAILED starterCount=' +
      after.starters.length
    );
  }

  const result = qboPipelineStatus_(QBO_PIPELINE_IDS_.DAILY_FULL_EXPORT);
  console.log('[PIPELINE CONTROL] | DAILY ADMIN PAUSED | ' +
    JSON.stringify(result, null, 2));
  return result;
}

function previewDailyFullExportAdministrativeResume() {
  const authority = qboDailyFullExportAssertGovernedAuthority_();
  const status = qboPipelineStatus_(QBO_PIPELINE_IDS_.DAILY_FULL_EXPORT);
  const triggers = qboDailyFullExportTriggerPartition_();

  const result = {
    version: QBO_DAILY_FULL_EXPORT_ADMIN_CONTROL_VERSION_,
    mode: 'PREVIEW_READ_ONLY',
    operation: 'RESUME',
    pipelineId: QBO_PIPELINE_IDS_.DAILY_FULL_EXPORT,
    authority: authority.authority,
    executionAuthority: authority.executionAuthority,
    governedAdministrativeState: status.GovernedAdministrativeState,
    operationalStatus: status.OperationalStatus,
    currentRunId: status.CurrentRunId,
    starterTriggerCount: triggers.starters.length,
    continuationTriggerCount: triggers.continuations.length,
    wouldCreateStarter: triggers.starters.length === 0,
    wouldDeleteDuplicateStarters: triggers.starters.length > 1,
    wouldStartRunImmediately: false,
    wouldCallResumeQboExportSchedule: false,
    continuationTriggersPreserved: true,
    queueStatePreserved: true,
    mutationPermitted: false
  };

  console.log('[PIPELINE CONTROL] | DAILY ADMIN RESUME PREVIEW | ' +
    JSON.stringify(result, null, 2));
  return result;
}

function resumeDailyFullExportAdministrativeSchedule() {
  qboDailyFullExportAssertGovernedAuthority_();

  const governed = qboPipelineReadAdministrativeState_(
    QBO_PIPELINE_IDS_.DAILY_FULL_EXPORT
  );
  if (!governed.initialized || governed.administrativeState !== 'PAUSED') {
    throw new Error(
      'DAILY_FULL_EXPORT_ADMIN_RESUME_REQUIRES_PAUSED_STATE current=' +
      (governed.initialized ? governed.administrativeState : 'UNINITIALIZED')
    );
  }

  /* Validate production prerequisites before any mutation. */
  validateDailyQboExportSchedule_();
  validateQboExportPreflight_();

  const inventory = qboPipelineTriggerInventory_();
  if (inventory.orphanOrForeignTriggerCount > 0) {
    throw new Error('DAILY_FULL_EXPORT_ADMIN_RESUME_FOREIGN_TRIGGER_BLOCK');
  }

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const partition = qboDailyFullExportTriggerPartition_();

    /* Fail closed on duplicates rather than silently deleting them. */
    if (partition.starters.length > 1) {
      throw new Error(
        'DAILY_FULL_EXPORT_ADMIN_RESUME_DUPLICATE_STARTERS count=' +
        partition.starters.length
      );
    }

    if (partition.starters.length === 0) {
      ScriptApp.newTrigger(DAILY_QBO_TRIGGER_HANDLERS.START)
        .timeBased()
        .atHour(DAILY_EXPORT_SCHEDULE.START_HOUR)
        .nearMinute(DAILY_EXPORT_SCHEDULE.START_MINUTE)
        .everyDays(1)
        .inTimezone(Session.getScriptTimeZone())
        .create();
    }

    qboPipelineWriteAdministrativeState_(
      QBO_PIPELINE_IDS_.DAILY_FULL_EXPORT,
      'ENABLED',
      {
        reason: 'GOVERNED_ADMINISTRATIVE_RESUME',
        administrativeControlVersion:
          QBO_DAILY_FULL_EXPORT_ADMIN_CONTROL_VERSION_
      }
    );
  } finally {
    lock.releaseLock();
  }

  const after = qboDailyFullExportTriggerPartition_();
  if (after.starters.length !== 1) {
    throw new Error(
      'DAILY_FULL_EXPORT_ADMIN_RESUME_POSTCONDITION_FAILED starterCount=' +
      after.starters.length
    );
  }

  const result = qboPipelineStatus_(QBO_PIPELINE_IDS_.DAILY_FULL_EXPORT);
  console.log('[PIPELINE CONTROL] | DAILY ADMIN RESUMED | ' +
    JSON.stringify(result, null, 2));
  return result;
}
