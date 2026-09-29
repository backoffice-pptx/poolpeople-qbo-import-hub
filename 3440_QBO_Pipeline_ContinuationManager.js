/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 3440_QBO_Pipeline_ContinuationManager.js
 * Version     : 1.5.139
 * Purpose     : Common read-only continuation visibility contract.
 *
 * Existing domain continuation scheduling remains authoritative until each
 * pipeline is deliberately migrated. This module never infers new work.
 */

const QBO_PIPELINE_CONTINUATION_MANAGER_VERSION_ =
  'QBO_PIPELINE_CONTINUATION_MANAGER_V3';

function qboPipelineContinuationStatus_(pipelineId) {
  const def = getQboPipelineDefinition_(pipelineId);
  const specs = typeof qboPipelineEffectiveTriggerSpecs_ === 'function'
    ? qboPipelineEffectiveTriggerSpecs_(def)
    : qboPipelineTriggerSpecs_(def);

  const handlers = {};
  specs.forEach(function(spec) {
    if (spec.expectation === QBO_PIPELINE_TRIGGER_EXPECTATION_.TRANSIENT_CONTINUATION) {
      handlers[spec.handler] = true;
    }
  });

  const triggers = qboPipelineProjectTriggerRows_().filter(function(row) {
    return !!handlers[row.handler];
  });

  const counts = {};
  triggers.forEach(function(row) {
    counts[row.handler] = (counts[row.handler] || 0) + 1;
  });

  const continuationHandlers = Object.keys(handlers).sort();
  const duplicateContinuationHandlers = continuationHandlers.filter(function(handler) {
    return (counts[handler] || 0) > 1;
  });

  return {
    pipelineId: def.pipelineId,
    version: QBO_PIPELINE_CONTINUATION_MANAGER_VERSION_,
    continuationHandlers: continuationHandlers,
    continuationTriggerCount: triggers.length,
    continuationTriggers: triggers,
    duplicateContinuationHandlers: duplicateContinuationHandlers,
    valid: duplicateContinuationHandlers.length === 0,
    continuationNeedInferred: false,
    continuationSchedulingAuthority: 'OWNING_DOMAIN',
    mutationPerformed: false
  };
}

function qboPipelineScheduleContinuation_(pipelineId) {
  throw new Error('QBO_PIPELINE_CONTINUATION_SCHEDULE_BLOCKED_PHASE_B pipelineId=' +
    String(pipelineId || ''));
}

function qboPipelineRemoveContinuations_(pipelineId) {
  throw new Error('QBO_PIPELINE_CONTINUATION_REMOVE_BLOCKED_PHASE_B pipelineId=' +
    String(pipelineId || ''));
}
