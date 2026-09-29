/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 3470_QBO_Pipeline_TriggerReconciliationPlan.js
 * Version     : 1.5.138
 * Purpose     : Read-only desired-vs-actual trigger reconciliation planner.
 *
 * SAFETY: This module NEVER creates or deletes Apps Script triggers.
 */

const QBO_TRIGGER_RECONCILIATION_PLAN_VERSION_ = 'QBO_TRIGGER_RECONCILIATION_PLAN_V2';

function qboPipelineDesiredTriggerState_(def, actualByHandler) {
  const governed = qboPipelineReadAdministrativeState_(def.pipelineId);
  const authority = qboPipelineReadAdministrativeAuthority_(def.pipelineId);
  const governedAuthoritative =
    !!(authority &&
       authority.initialized === true &&
       authority.authority === 'GOVERNED_34XX');

  const effectiveSpecs =
    typeof qboPipelineEffectiveTriggerSpecs_ === 'function'
      ? qboPipelineEffectiveTriggerSpecs_(def)
      : (def.triggerSpecs || []);

  const rows = [];

  effectiveSpecs.forEach(function(spec) {
    const actual = actualByHandler[spec.handler] || [];
    let desiredCount = 0;
    let rationale = '';

    if (spec.expectation === QBO_PIPELINE_TRIGGER_EXPECTATION_.REQUIRED_RECURRING) {
      desiredCount = 1;
      rationale = spec.expectationBasis || 'REQUIRED_RECURRING';
    } else if (spec.expectation === QBO_PIPELINE_TRIGGER_EXPECTATION_.INTENTIONALLY_ABSENT) {
      desiredCount = 0;
      rationale = spec.expectationBasis || 'INTENTIONALLY_ABSENT';
    } else if (spec.expectation === QBO_PIPELINE_TRIGGER_EXPECTATION_.TRANSIENT_CONTINUATION) {
      /*
       * The common control plane does not infer continuation need.
       * Preserve one existing transient continuation; absent remains absent.
       */
      desiredCount = actual.length > 0 ? 1 : 0;
      rationale = actual.length > 0
        ? 'PRESERVE_EXISTING_TRANSIENT'
        : 'TRANSIENT_NOT_CURRENTLY_REQUIRED';
    } else {
      throw new Error('Unsupported trigger expectation: ' + spec.expectation);
    }

    let action = 'KEEP';
    if (actual.length < desiredCount) action = 'CREATE';
    else if (actual.length > desiredCount) action = 'DELETE_EXCESS';

    rows.push({
      pipelineId: def.pipelineId,
      lifecycle: def.lifecycle,
      phaseBMode: def.phaseBMode,
      governedAdministrativeState: governed.initialized
        ? governed.administrativeState
        : 'UNINITIALIZED',
      governedStateAuthoritative: governedAuthoritative,
      administrativeStateAuthority: governedAuthoritative
        ? 'GOVERNED_34XX'
        : 'LEGACY',
      handler: spec.handler,
      expectation: spec.expectation,
      expectationBasis: spec.expectationBasis || 'REGISTRY_STATIC',
      actualCount: actual.length,
      desiredCount: desiredCount,
      proposedAction: action,
      rationale: rationale,
      mutationPermitted: false
    });
  });

  return rows;
}

function planQboPipelineTriggerReconciliation() {
  const actual = ScriptApp.getProjectTriggers().map(function(trigger) {
    return {
      handler: trigger.getHandlerFunction(),
      triggerId: trigger.getUniqueId(),
      source: String(trigger.getTriggerSource()),
      eventType: String(trigger.getEventType())
    };
  });

  const actualByHandler = {};
  actual.forEach(function(row) {
    if (!actualByHandler[row.handler]) actualByHandler[row.handler] = [];
    actualByHandler[row.handler].push(row);
  });

  const governedHandlers = {};
  let actions = [];
  listQboPipelineDefinitions_().forEach(function(def) {
    (def.triggerSpecs || []).forEach(function(spec) {
      governedHandlers[spec.handler] = true;
    });
    actions = actions.concat(qboPipelineDesiredTriggerState_(def, actualByHandler));
  });

  const foreign = actual.filter(function(row) {
    return !governedHandlers[row.handler];
  }).map(function(row) {
    return {
      pipelineId: '',
      lifecycle: 'UNREGISTERED',
      phaseBMode: 'UNREGISTERED',
      governedAdministrativeState: 'UNREGISTERED',
      governedStateAuthoritative: false,
      administrativeStateAuthority: 'UNREGISTERED',
      handler: row.handler,
      expectation: 'UNREGISTERED',
      expectationBasis: 'UNREGISTERED',
      actualCount: 1,
      desiredCount: null,
      proposedAction: 'REVIEW_FOREIGN',
      rationale: 'NOT_IN_PIPELINE_REGISTRY',
      mutationPermitted: false,
      triggerId: row.triggerId
    };
  });

  actions = actions.concat(foreign);

  const creates = actions.filter(function(row){return row.proposedAction==='CREATE';});
  const deletes = actions.filter(function(row){return row.proposedAction==='DELETE_EXCESS';});
  const foreignReviews = actions.filter(function(row){return row.proposedAction==='REVIEW_FOREIGN';});

  const result = {
    version: QBO_TRIGGER_RECONCILIATION_PLAN_VERSION_,
    generatedAt: new Date().toISOString(),
    mode: 'DRY_RUN_READ_ONLY',
    mutationPermitted: false,
    valid:
      creates.length === 0 &&
      deletes.length === 0 &&
      foreignReviews.length === 0,
    actualTriggerCount: actual.length,
    proposedCreateCount: creates.length,
    proposedDeleteExcessCount: deletes.length,
    foreignReviewCount: foreignReviews.length,
    proposedCreates: creates,
    proposedDeleteExcess: deletes,
    foreignReviews: foreignReviews,
    actions: actions
  };

  console.log('[PIPELINE CONTROL] | TRIGGER RECONCILIATION PLAN | ' + JSON.stringify(result, null,2));
  return result;
}
