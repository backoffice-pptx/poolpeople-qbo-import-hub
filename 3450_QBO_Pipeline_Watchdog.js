/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 3450_QBO_Pipeline_Watchdog.js
 * Version     : 1.5.139
 * Purpose     : Governed read-only watchdog diagnostic contract.
 *
 * Watchdogs are stale-recovery mechanisms, not normal orchestration.
 * v1.5.139 classifies existing runtime evidence but never reseeds work.
 */

const QBO_PIPELINE_WATCHDOG_VERSION_ = 'QBO_PIPELINE_WATCHDOG_V2';

function qboPipelineWatchdogDiagnostic_(pipelineId) {
  const def = getQboPipelineDefinition_(pipelineId);
  const admin = qboPipelineReadAdministrativeState_(def.pipelineId);
  const authority = typeof qboPipelineReadAdministrativeAuthority_ === 'function'
    ? qboPipelineReadAdministrativeAuthority_(def.pipelineId)
    : { initialized: false, authority: 'LEGACY' };
  const triggerState = qboPipelineReconcileTriggerStateReadOnly_(def.pipelineId);
  const continuation = qboPipelineContinuationStatus_(def.pipelineId);
  const legacy = qboPipelineLegacyOperationalState_(def, triggerState);

  const governedAuthoritative =
    !!(authority &&
       authority.initialized === true &&
       authority.authority === 'GOVERNED_34XX');

  const administrativelyPaused =
    governedAuthoritative &&
    admin &&
    admin.initialized === true &&
    admin.administrativeState === 'PAUSED';

  const staleSignal = legacy.activeWorkerStale === true;
  let diagnosticStatus = 'HEALTHY_NO_STALE_SIGNAL';
  let recoveryEligible = false;
  let reason = 'NO_STALE_SIGNAL';

  if (!triggerState.valid) {
    diagnosticStatus = 'TRIGGER_STATE_INVALID';
    reason = 'TRIGGER_STATE_INVALID';
  } else if (!continuation.valid) {
    diagnosticStatus = 'CONTINUATION_STATE_INVALID';
    reason = 'DUPLICATE_CONTINUATION_TRIGGER';
  } else if (staleSignal) {
    diagnosticStatus = administrativelyPaused
      ? 'STALE_SIGNAL_WHILE_ADMINISTRATIVELY_PAUSED'
      : 'STALE_SIGNAL_DETECTED';
    recoveryEligible = !administrativelyPaused;
    reason = administrativelyPaused
      ? 'ADMINISTRATIVE_PAUSE_BLOCKS_AUTOMATIC_RECOVERY'
      : 'OWNING_DOMAIN_RECOVERY_REQUIRED';
  } else if (administrativelyPaused) {
    diagnosticStatus = 'ADMINISTRATIVELY_PAUSED_NO_RECOVERY';
    reason = 'ADMINISTRATIVELY_PAUSED';
  }

  return {
    pipelineId: def.pipelineId,
    version: QBO_PIPELINE_WATCHDOG_VERSION_,
    lifecycle: def.lifecycle,
    phaseBMode: def.phaseBMode,
    administrativeState: admin,
    administrativeAuthority: authority,
    governedStateAuthoritative: governedAuthoritative,
    triggerStateValid: triggerState.valid,
    continuationStateValid: continuation.valid,
    continuationTriggerCount: continuation.continuationTriggerCount,
    activeWorkerStale: staleSignal,
    diagnosticStatus: diagnosticStatus,
    recoveryEligible: recoveryEligible,
    recoveryAuthority: 'OWNING_DOMAIN',
    recoveryAttempted: false,
    reason: reason,
    mutationPerformed: false
  };
}

function qboPipelineRunWatchdog_(pipelineId) {
  return qboPipelineWatchdogDiagnostic_(pipelineId);
}
