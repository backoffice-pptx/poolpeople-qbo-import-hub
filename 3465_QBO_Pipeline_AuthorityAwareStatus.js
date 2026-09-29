/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 3465_QBO_Pipeline_AuthorityAwareStatus.js
 * Version     : 1.5.138
 * Purpose     : Reconcile governed administrative authority into the common
 *               pipeline status surface after controlled authority cutover.
 *
 * Safety:
 * - Read-only.
 * - Does not mutate triggers, properties, workers, workbooks, Drive, or State Capture.
 * - Legacy operational adapters remain responsible for execution/runtime evidence.
 */

const QBO_PIPELINE_AUTHORITY_AWARE_STATUS_VERSION_ =
  'QBO_PIPELINE_AUTHORITY_AWARE_STATUS_V2';

function qboPipelineAdministrativeAuthorityPropertyKey_(pipelineId) {
  return 'QBO_PIPELINE_ADMIN_AUTHORITY_V1__' + String(pipelineId || '').trim();
}

function qboPipelineReadAdministrativeAuthority_(pipelineId) {
  const def = getQboPipelineDefinition_(pipelineId);
  const raw = PropertiesService.getScriptProperties()
    .getProperty(qboPipelineAdministrativeAuthorityPropertyKey_(def.pipelineId));

  if (!raw) {
    return {
      pipelineId: def.pipelineId,
      initialized: false,
      authority: 'LEGACY',
      executionAuthority: '',
      cutoverVersion: '',
      cutoverAt: ''
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      'QBO_PIPELINE_ADMIN_AUTHORITY_INVALID pipelineId=' + def.pipelineId +
      ' error=' + String(error && error.message ? error.message : error)
    );
  }

  return Object.assign({
    pipelineId: def.pipelineId,
    initialized: true
  }, parsed);
}

function qboPipelineApplyAdministrativeAuthorityToStatus_(status) {
  const result = Object.assign({}, status || {});
  const pipelineId = String(result.PipelineId || '').trim();
  if (!pipelineId) return result;

  const adminState = qboPipelineReadAdministrativeState_(pipelineId);
  const authority = qboPipelineReadAdministrativeAuthority_(pipelineId);

  result.GovernedAdministrativeState =
    adminState && adminState.initialized
      ? adminState.administrativeState
      : 'UNINITIALIZED';

  result.GovernedStateAuthoritative =
    !!(authority &&
       authority.initialized === true &&
       authority.authority === 'GOVERNED_34XX');

  if (result.GovernedStateAuthoritative) {
    result.AdministrativeStateAuthority = 'GOVERNED_34XX';
    result.ExecutionAuthority = authority.executionAuthority || '';
    result.AdministrativeAuthorityCutoverAt = authority.cutoverAt || '';
    result.AdministrativeAuthorityVersion = authority.cutoverVersion || '';

    /*
     * Administrative enable/pause state now comes from GOVERNED_34XX.
     * Runtime evidence remains separately represented by OperationalStateAuthority.
     *
     * A governed pause removes only the durable daily starter. If no current
     * queue/run/continuation exists, that is an intentional idle pause rather
     * than a missing-scheduler fault. If work is still active/queued, preserve
     * the legacy operational status so the current execution remains visible.
     */
    if (adminState && adminState.initialized) {
      result.EnabledPaused = adminState.administrativeState;

      if (adminState.administrativeState === 'PAUSED') {
        const hasCurrentRun = !!String(result.CurrentRunId || '').trim();
        const hasCurrentWorkUnit = !!String(result.CurrentWorkUnitId || '').trim();
        const hasQueueIndex = !!String(result.QueueIndex || '').trim();
        const hasContinuation = Number(result.ContinuationTriggerCount || 0) > 0;
        const workerActive =
          result.WorkerLeaseActive === true ||
          String(result.OperationalStatus || '') === 'RUNNING';

        if (!hasCurrentRun &&
            !hasCurrentWorkUnit &&
            !hasQueueIndex &&
            !hasContinuation &&
            !workerActive) {
          result.OperationalStatus = 'ADMINISTRATIVELY_PAUSED_IDLE';
        }
      }
    }
  } else {
    result.AdministrativeStateAuthority = 'LEGACY';
    result.ExecutionAuthority = '';
    result.AdministrativeAuthorityCutoverAt = '';
    result.AdministrativeAuthorityVersion = '';
  }

  result.AuthorityAwareStatusVersion =
    QBO_PIPELINE_AUTHORITY_AWARE_STATUS_VERSION_;

  return result;
}

function validateQboPipelineAuthorityAwareStatus(pipelineId) {
  const base = qboPipelineStatus_(pipelineId);
  const result = qboPipelineApplyAdministrativeAuthorityToStatus_(base);

  console.log(
    '[PIPELINE CONTROL] | AUTHORITY-AWARE STATUS | ' +
    JSON.stringify(result, null, 2)
  );
  return result;
}
