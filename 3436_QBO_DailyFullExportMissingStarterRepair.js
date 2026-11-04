/**
 * App 50 — targeted DAILY_FULL_EXPORT missing-starter repair.
 * Install as a new Apps Script file. Run preview first, then repair once.
 * Does not start exports, change administrative state, or modify queue/history.
 */
const QBO_DAILY_STARTER_REPAIR_VERSION_ = '1.5.236-repair2';

function previewQboDailyMissingStarterRepair() {
  qboDailyFullExportAssertGovernedAuthority_();
  const governed = qboPipelineReadAdministrativeState_(QBO_PIPELINE_IDS_.DAILY_FULL_EXPORT);
  const triggers = qboDailyFullExportTriggerPartition_();
  const foreignPreserved = qboPipelineProjectTriggerRows_().filter(function(row) {
    return row.handler !== DAILY_QBO_TRIGGER_HANDLERS.START &&
      row.handler !== DAILY_QBO_TRIGGER_HANDLERS.NEXT;
  });
  const result = {
    version: QBO_DAILY_STARTER_REPAIR_VERSION_,
    mode: 'READ_ONLY',
    administrativeState: governed.initialized ? governed.administrativeState : 'UNINITIALIZED',
    starterCount: triggers.starters.length,
    continuationCount: triggers.continuations.length,
    unrelatedTriggersPreserved: foreignPreserved.map(function(row) { return row.handler; }),
    eligible: governed.initialized === true && governed.administrativeState === 'ENABLED' && triggers.starters.length === 0 && triggers.continuations.length === 0,
    mutationPerformed: false
  };
  console.log('[DAILY STARTER REPAIR] | PREVIEW | ' + JSON.stringify(result));
  return result;
}

function repairQboDailyMissingStarter() {
  qboDailyFullExportAssertGovernedAuthority_();
  // Preflight before acquiring the script lock, as in governed resume.
  validateDailyQboExportSchedule_();
  validateQboExportPreflight_();
  // Other App 50 pipelines own their triggers; they are not blockers.
  // Scope this repair exclusively to DAILY_FULL_EXPORT starter inventory.
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('DAILY_STARTER_REPAIR_LOCK_UNAVAILABLE');
  let createdId = '';
  try {
    const governed = qboPipelineReadAdministrativeState_(QBO_PIPELINE_IDS_.DAILY_FULL_EXPORT);
    if (!governed.initialized || governed.administrativeState !== 'ENABLED') {
      throw new Error('DAILY_STARTER_REPAIR_REQUIRES_ENABLED_STATE');
    }
    const before = qboDailyFullExportTriggerPartition_();
    if (before.continuations.length !== 0) {
      throw new Error('DAILY_STARTER_REPAIR_ACTIVE_CONTINUATION count=' + before.continuations.length);
    }
    if (before.starters.length !== 0) {
      throw new Error('DAILY_STARTER_REPAIR_REQUIRES_ZERO_STARTERS count=' + before.starters.length);
    }
    const created = ScriptApp.newTrigger(DAILY_QBO_TRIGGER_HANDLERS.START)
      .timeBased()
      .atHour(DAILY_EXPORT_SCHEDULE.START_HOUR)
      .nearMinute(DAILY_EXPORT_SCHEDULE.START_MINUTE)
      .everyDays(1)
      .inTimezone(Session.getScriptTimeZone())
      .create();
    createdId = String(created.getUniqueId() || '');
    const after = qboDailyFullExportTriggerPartition_();
    if (after.starters.length !== 1 || String(after.starters[0].triggerId) !== createdId) {
      throw new Error('DAILY_STARTER_REPAIR_POSTCONDITION_FAILED count=' + after.starters.length);
    }
  } finally {
    lock.releaseLock();
  }
  const result = {
    version: QBO_DAILY_STARTER_REPAIR_VERSION_,
    status: 'STARTER_CREATED',
    triggerId: createdId,
    administrativeStatePreserved: true,
    queueStatePreserved: true,
    runHistoryPreserved: true,
    exportStarted: false
  };
  console.log('[DAILY STARTER REPAIR] | COMPLETE | ' + JSON.stringify(result));
  return result;
}
