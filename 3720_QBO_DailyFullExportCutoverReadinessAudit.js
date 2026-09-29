/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 3720_QBO_DailyFullExportCutoverReadinessAudit.js
 * Version     : 1.5.130
 * Purpose     : Read-only equivalence/readiness gate before 34xx can own
 *               DAILY_FULL_EXPORT administrative trigger management.
 */

const QBO_DAILY_FULL_EXPORT_CUTOVER_AUDIT_VERSION_ =
  'QBO_DAILY_FULL_EXPORT_CUTOVER_AUDIT_V1';

function auditQboDailyFullExportCutoverReadiness() {
  const def = getQboPipelineDefinition_(QBO_PIPELINE_IDS_.DAILY_FULL_EXPORT);
  const inventory = qboPipelineReconcileTriggerStateReadOnly_(def.pipelineId);
  const plan = planQboPipelineTriggerReconciliation();
  const applySafety = qboTriggerApplySafetyEvaluation_('');
  const props = PropertiesService.getScriptProperties();

  const actualStarter = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === DAILY_QBO_TRIGGER_HANDLERS.START;
  });
  const actualNext = ScriptApp.getProjectTriggers().filter(function(t) {
    return t.getHandlerFunction() === DAILY_QBO_TRIGGER_HANDLERS.NEXT;
  });

  const runId = props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.RUN_ID) || '';
  const indexValue = props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.INDEX);
  const activeState = getActiveDailyQboWorkerState_(props);
  const queueIdle = !runId && (indexValue === null || indexValue === '') && !activeState;

  let scheduleValidation = null;
  let scheduleValidationError = '';
  try {
    scheduleValidation = validateDailyQboExportSchedule_();
  } catch (err) {
    scheduleValidationError = err && err.message ? err.message : String(err);
  }

  const registryStart = (def.triggerSpecs || []).filter(function(s) {
    return s.handler === DAILY_QBO_TRIGGER_HANDLERS.START &&
      s.expectation === QBO_PIPELINE_TRIGGER_EXPECTATION_.REQUIRED_RECURRING;
  });
  const registryNext = (def.triggerSpecs || []).filter(function(s) {
    return s.handler === DAILY_QBO_TRIGGER_HANDLERS.NEXT &&
      s.expectation === QBO_PIPELINE_TRIGGER_EXPECTATION_.TRANSIENT_CONTINUATION;
  });

  const gates = [];
  function gate(name, pass, detail) {
    gates.push({gate:name, pass:!!pass, detail:detail || ''});
  }

  gate('PIPELINE_IS_ACTIVE_PRODUCTION_AUTHORITY',
       def.lifecycle === 'ACTIVE_PRODUCTION_AUTHORITY', def.lifecycle);
  gate('LEGACY_CONTROL_SURFACE_IS_MODULE_24',
       def.legacyControlSurface === '24_TriggerManagement.js', def.legacyControlSurface);
  gate('START_HANDLER_IDENTITY_MATCH',
       registryStart.length === 1, DAILY_QBO_TRIGGER_HANDLERS.START);
  gate('NEXT_HANDLER_IDENTITY_MATCH',
       registryNext.length === 1, DAILY_QBO_TRIGGER_HANDLERS.NEXT);
  gate('DAILY_SCHEDULE_CONTRACT_VALID',
       !scheduleValidationError, scheduleValidationError || 'PASS');
  gate('EXACTLY_ONE_DURABLE_STARTER_PRESENT',
       actualStarter.length === 1, 'actual=' + actualStarter.length);
  gate('NO_TRANSIENT_NEXT_WHILE_IDLE',
       queueIdle ? actualNext.length === 0 : true,
       'queueIdle=' + queueIdle + ', actualNext=' + actualNext.length);
  gate('TRIGGER_INVENTORY_VALID', inventory.valid === true,
       inventory.valid ? 'PASS' : 'FAIL');
  gate('DRY_RUN_PLAN_VALID', plan.valid === true,
       'creates=' + plan.proposedCreateCount +
       ', deletes=' + plan.proposedDeleteExcessCount +
       ', foreign=' + plan.foreignReviewCount);
  gate('APPLY_GLOBAL_HARD_DISABLED',
       applySafety.globalApplyEnabled === false,
       'globalApplyEnabled=' + applySafety.globalApplyEnabled);
  gate('NO_MUTATION_AUTHORIZED',
       applySafety.mutationAuthorized === false,
       'mutationAuthorized=' + applySafety.mutationAuthorized);

  /*
   * Cutover must occur at an idle boundary. We report this separately and make
   * it part of readiness. The audit itself never clears or changes queue state.
   */
  gate('DAILY_QUEUE_IDLE_FOR_CUTOVER',
       queueIdle,
       'runId=' + runId +
       ', queueIndex=' + (indexValue === null ? '' : indexValue) +
       ', activeWorker=' + !!activeState);

  const result = {
    version: QBO_DAILY_FULL_EXPORT_CUTOVER_AUDIT_VERSION_,
    generatedAt: new Date().toISOString(),
    mode: 'READ_ONLY_CUTOVER_READINESS',
    valid: gates.every(function(g){ return g.pass; }),
    mutationPermitted: false,
    pipelineId: def.pipelineId,
    lifecycle: def.lifecycle,
    legacyControlSurface: def.legacyControlSurface,
    scriptTimezone: Session.getScriptTimeZone(),
    configuredSchedule: {
      startHour: DAILY_EXPORT_SCHEDULE.START_HOUR,
      startMinute: DAILY_EXPORT_SCHEDULE.START_MINUTE,
      nextExportDelayMs: DAILY_EXPORT_SCHEDULE.NEXT_EXPORT_DELAY_MS
    },
    triggerContract: {
      startHandler: DAILY_QBO_TRIGGER_HANDLERS.START,
      startExpectation: registryStart.length ? registryStart[0].expectation : '',
      nextHandler: DAILY_QBO_TRIGGER_HANDLERS.NEXT,
      nextExpectation: registryNext.length ? registryNext[0].expectation : '',
      actualStarterCount: actualStarter.length,
      actualNextCount: actualNext.length
    },
    queueState: {
      idle: queueIdle,
      runId: runId,
      queueIndex: indexValue === null ? '' : indexValue,
      activeWorker: !!activeState
    },
    scheduleValidation: {
      valid: !scheduleValidationError,
      result: scheduleValidation,
      error: scheduleValidationError
    },
    gates: gates
  };

  console.log('[PIPELINE CONTROL] | DAILY FULL_EXPORT CUTOVER READINESS | ' +
              JSON.stringify(result, null, 2));
  return result;
}
