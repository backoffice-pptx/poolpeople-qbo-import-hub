/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 3460_QBO_Pipeline_Status.js
 * Purpose     : Unified read-only pipeline status surface.
 *
 * v1.5.139:
 * - Preserves authority-aware administrative status from v1.5.138.
 * - Adds continuation health/authority to the unified status surface.
 * - Adds read-only watchdog diagnostic classification without invoking recovery.
 * - Keeps operational/runtime authority separate from administrative authority.
 */

const QBO_PIPELINE_STATUS_VERSION_ = 'QBO_PIPELINE_STATUS_V6';

function qboPipelineLegacyOperationalState_(def, triggerState) {
  const adapter = String(def.legacyStatusAdapter || '');

  if (adapter === 'DISABLED') {
    return {
      authority: 'GOVERNED_ARCHITECTURE',
      enabledPaused: 'DISABLED',
      operationalStatus: 'DISABLED',
      currentRunId: '',
      currentWorkUnitId: '',
      lastStartedAt: '',
      lastHeartbeatAt: '',
      lastProgressAt: '',
      lastCompletedAt: '',
      lastSuccessfulAt: '',
      backlogPendingWork: '',
      lastError: ''
    };
  }

  if (adapter === 'TRANSIENT_JOB') {
    const active = triggerState.actualTriggers.length > 0;
    return {
      authority: 'LEGACY_TRANSIENT_TRIGGER_STATE',
      enabledPaused: active ? 'ACTIVE' : 'IDLE',
      operationalStatus: active ? 'TRANSIENT_TRIGGER_PRESENT' : 'NO_TRIGGER_IDLE',
      currentRunId: '',
      currentWorkUnitId: '',
      lastStartedAt: '',
      lastHeartbeatAt: '',
      lastProgressAt: '',
      lastCompletedAt: '',
      lastSuccessfulAt: '',
      backlogPendingWork: 'NOT_READ_IN_PHASE_B_STATUS',
      lastError: ''
    };
  }

  if (adapter === 'TRIGGER_GATED_PAUSED') {
    const active = triggerState.actualTriggers.length > 0;
    return {
      authority: 'LEGACY_TRIGGER_STATE',
      enabledPaused: active ? 'ENABLED' : 'PAUSED',
      operationalStatus: active ? 'LEGACY_TRIGGER_ACTIVE' : 'PAUSED_NO_DISPATCH_TRIGGER',
      currentRunId: '',
      currentWorkUnitId: '',
      lastStartedAt: '',
      lastHeartbeatAt: '',
      lastProgressAt: '',
      lastCompletedAt: '',
      lastSuccessfulAt: '',
      backlogPendingWork: 'NOT_READ_IN_PHASE_B_STATUS',
      lastError: ''
    };
  }

  if (adapter === 'NATIVE_CDC_ACQUISITION') {
    const props = PropertiesService.getScriptProperties();
    const paused = props.getProperty(QBO_NATIVE_CDC_PRODUCTION.PAUSE_PROPERTY_KEY) === 'true';
    const state = qboNativeCdcReadState_();
    const now = Date.now();
    const leaseActive = !!(
      state &&
      state.workerLeaseOwner &&
      Number(state.workerLeaseExpiresAtMs || 0) > now
    );
    const status = state && state.status ? String(state.status) : 'IDLE';
    return {
      authority: 'LEGACY_NATIVE_CDC_STATE',
      enabledPaused: paused ? 'PAUSED' : 'ENABLED',
      operationalStatus: paused ? 'PAUSED' : status,
      currentRunId: state && state.cycleId ? String(state.cycleId) : '',
      currentWorkUnitId: state && state.currentWorkUnitId ? String(state.currentWorkUnitId) : '',
      lastStartedAt: state && state.startedAt ? String(state.startedAt) : '',
      lastHeartbeatAt: state && state.lastHeartbeatAt ? String(state.lastHeartbeatAt) : '',
      lastProgressAt: state && state.lastProgressAt ? String(state.lastProgressAt) : '',
      lastCompletedAt: state && state.completedAt ? String(state.completedAt) : '',
      lastSuccessfulAt: state && state.completedAt && status === 'SUCCESS' ? String(state.completedAt) : '',
      backlogPendingWork: state && state.nextEntityIndex !== undefined
        ? String(state.nextEntityIndex) + '/' + String(QBO_NATIVE_CDC_PRODUCTION.ENTITIES.length)
        : '',
      lastError: state && state.error ? String(state.error) : '',
      workerLeaseActive: leaseActive,
      committedWatermark: props.getProperty(QBO_NATIVE_CDC_PRODUCTION.WATERMARK_PROPERTY_KEY) || ''
    };
  }

  if (adapter === 'DAILY_FULL_EXPORT') {
    const props = PropertiesService.getScriptProperties();
    const runId = props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.RUN_ID) || '';
    const queueIndexValue = props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.INDEX);
    const queueIndex = queueIndexValue === null || queueIndexValue === ''
      ? ''
      : Number(queueIndexValue);
    const activeState = getActiveDailyQboWorkerState_(props);
    const hasContinuation = triggerState.actualTriggers.some(function(row) {
      return row.handler === DAILY_QBO_TRIGGER_HANDLERS.NEXT;
    });
    const starterInstalled = triggerState.actualTriggers.some(function(row) {
      return row.handler === DAILY_QBO_TRIGGER_HANDLERS.START;
    });

    let operationalStatus = 'SCHEDULED_IDLE';
    if (activeState) operationalStatus = 'RUNNING';
    else if (runId && hasContinuation) operationalStatus = 'QUEUED';
    else if (runId) operationalStatus = 'RUN_STATE_PRESENT_NO_CONTINUATION';
    else if (!starterInstalled) operationalStatus = 'SCHEDULER_TRIGGER_MISSING';

    return {
      authority: 'LEGACY_DAILY_EXPORT_STATE',
      enabledPaused: starterInstalled ? 'ENABLED' : 'PAUSED_OR_UNINSTALLED',
      operationalStatus: operationalStatus,
      currentRunId: runId,
      currentWorkUnitId: activeState && activeState.exportKey ? String(activeState.exportKey) : '',
      lastStartedAt: activeState && activeState.startedAt ? String(activeState.startedAt) :
        (props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.STARTED_AT) || ''),
      lastHeartbeatAt: '',
      lastProgressAt: '',
      lastCompletedAt: '',
      lastSuccessfulAt: '',
      backlogPendingWork: queueIndex === '' ? '' :
        String(queueIndex) + '/' + String(DAILY_QBO_EXPORT_ORDER.length),
      lastError: '',
      queueIndex: queueIndex,
      activeWorkerStale: activeState ? isDailyQboWorkerStateStale_(activeState) : false
    };
  }

  return {
    authority: 'UNKNOWN_ADAPTER',
    enabledPaused: 'UNKNOWN',
    operationalStatus: 'UNKNOWN',
    currentRunId: '',
    currentWorkUnitId: '',
    lastStartedAt: '',
    lastHeartbeatAt: '',
    lastProgressAt: '',
    lastCompletedAt: '',
    lastSuccessfulAt: '',
    backlogPendingWork: '',
    lastError: 'No legacy status adapter for pipeline.'
  };
}

function qboPipelineStatus_(pipelineId) {
  const def = getQboPipelineDefinition_(pipelineId);
  const governedAdmin = qboPipelineReadAdministrativeState_(def.pipelineId);
  const triggerState = qboPipelineReconcileTriggerStateReadOnly_(def.pipelineId);
  const continuation = qboPipelineContinuationStatus_(def.pipelineId);
  const legacy = qboPipelineLegacyOperationalState_(def, triggerState);

  const base = {
    PipelineId: def.pipelineId,
    DisplayName: def.displayName,
    JobClass: def.jobClass,
    Lifecycle: def.lifecycle,
    PhaseBMode: def.phaseBMode,

    /* Runtime/execution evidence authority remains explicit and separate. */
    OperationalStateAuthority: legacy.authority,
    EnabledPaused: legacy.enabledPaused,
    OperationalStatus: legacy.operationalStatus,

    GovernedAdministrativeState: governedAdmin.initialized
      ? governedAdmin.administrativeState
      : 'UNINITIALIZED',
    GovernedStateAuthoritative: false,

    TriggerStateValid: triggerState.valid,
    TriggerInstalled: triggerState.actualTriggers.length > 0,
    TriggerCount: triggerState.actualTriggers.length,
    TriggerSpecs: triggerState.triggerSpecs,
    RequiredRecurringMissing: triggerState.requiredRecurringMissing,
    TransientContinuationAbsent: triggerState.transientContinuationAbsent,
    IntentionallyAbsentConfirmed: triggerState.intentionallyAbsentConfirmed,
    IntentionallyAbsentViolations: triggerState.intentionallyAbsentViolations,
    DuplicateHandlers: triggerState.duplicateHandlers,
    ContinuationTriggerCount: continuation.continuationTriggerCount,
    ContinuationStateValid: continuation.valid,
    ContinuationHandlers: continuation.continuationHandlers,
    DuplicateContinuationHandlers: continuation.duplicateContinuationHandlers,
    ContinuationSchedulingAuthority: continuation.continuationSchedulingAuthority,

    CurrentRunId: legacy.currentRunId,
    CurrentWorkUnitId: legacy.currentWorkUnitId,
    LastStartedAt: legacy.lastStartedAt,
    LastHeartbeatAt: legacy.lastHeartbeatAt,
    LastProgressAt: legacy.lastProgressAt,
    LastCompletedAt: legacy.lastCompletedAt,
    LastSuccessfulAt: legacy.lastSuccessfulAt,
    BacklogPendingWork: legacy.backlogPendingWork,
    LastError: legacy.lastError,
    WorkerLeaseActive: legacy.workerLeaseActive === undefined ? '' : legacy.workerLeaseActive,
    CommittedWatermark: legacy.committedWatermark || '',
    QueueIndex: legacy.queueIndex === undefined ? '' : legacy.queueIndex,
    ActiveWorkerStale: legacy.activeWorkerStale === undefined ? '' : legacy.activeWorkerStale,

    WatchdogStatus: 'DIAGNOSTIC_ONLY_NOT_EVALUATED',
    WatchdogRecoveryAuthority: 'OWNING_DOMAIN',
    Version: QBO_PIPELINE_STATUS_VERSION_
  };

  let result = base;
  if (typeof qboPipelineApplyAdministrativeAuthorityToStatus_ === 'function') {
    result = qboPipelineApplyAdministrativeAuthorityToStatus_(result);
  }

  /*
   * Do not call qboPipelineWatchdogDiagnostic_() here because that diagnostic
   * deliberately reuses the legacy operational adapter. Keep normal status
   * non-recursive and expose the directly available stale signal.
   */
  if (result.ActiveWorkerStale === true) {
    result.WatchdogStatus = result.EnabledPaused === 'PAUSED'
      ? 'STALE_SIGNAL_WHILE_ADMINISTRATIVELY_PAUSED'
      : 'STALE_SIGNAL_DETECTED';
  } else if (result.EnabledPaused === 'PAUSED') {
    result.WatchdogStatus = 'ADMINISTRATIVELY_PAUSED_NO_RECOVERY';
  } else {
    result.WatchdogStatus = 'HEALTHY_NO_STALE_SIGNAL';
  }

  return result;
}

function qboPipelineStatuses_() {
  return listQboPipelineDefinitions_().map(function(def) {
    return qboPipelineStatus_(def.pipelineId);
  });
}