/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 3480_QBO_Pipeline_TriggerApplySafety.js
 * Version     : 1.5.141
 * Purpose     : Trigger mutation safety/readiness contract.
 *
 * PHASE-B HARD RULE:
 * This module is globally fail-closed. It performs no trigger mutation.
 *
 * v1.5.141 separates environmental readiness from operator authorization:
 * - environmental readiness is derived from registry completeness + V2 plan;
 * - confirmation-token state is reported separately;
 * - global apply remains hard-disabled;
 * - no mutation implementation is introduced.
 */

const QBO_TRIGGER_APPLY_SAFETY_VERSION_ = 'QBO_TRIGGER_APPLY_SAFETY_V2';
const QBO_TRIGGER_APPLY_GLOBAL_ENABLED_ = false;
const QBO_TRIGGER_APPLY_CONFIRMATION_TOKEN_ = 'APPLY_QBO_PIPELINE_TRIGGER_PLAN';

function qboTriggerApplySafetyEvaluation_(confirmationToken) {
  const completeness = auditQboPipelineRegistryCompleteness();
  const plan = planQboPipelineTriggerReconciliation();

  const environmentalGates = [];
  const authorizationGates = [];

  function environmentalGate(name, pass, detail) {
    environmentalGates.push({gate:name, pass:!!pass, detail:detail || ''});
  }

  function authorizationGate(name, pass, detail) {
    authorizationGates.push({gate:name, pass:!!pass, detail:detail || ''});
  }

  environmentalGate(
    'REGISTRY_COMPLETENESS_VALID',
    completeness.valid === true,
    completeness.valid ? 'PASS' : 'Registry completeness audit is not valid.'
  );
  environmentalGate(
    'RECONCILIATION_PLAN_VALID',
    plan.valid === true,
    plan.valid ? 'PASS' : 'Reconciliation plan is not valid.'
  );
  environmentalGate(
    'NO_FOREIGN_TRIGGERS',
    Number(plan.foreignReviewCount || 0) === 0,
    'foreignReviewCount=' + Number(plan.foreignReviewCount || 0)
  );
  environmentalGate(
    'NO_PROPOSED_DELETE_EXCESS',
    Number(plan.proposedDeleteExcessCount || 0) === 0,
    'proposedDeleteExcessCount=' + Number(plan.proposedDeleteExcessCount || 0)
  );
  environmentalGate(
    'NO_PROPOSED_CREATE',
    Number(plan.proposedCreateCount || 0) === 0,
    'proposedCreateCount=' + Number(plan.proposedCreateCount || 0)
  );

  const tokenMatched =
    String(confirmationToken || '') === QBO_TRIGGER_APPLY_CONFIRMATION_TOKEN_;

  authorizationGate(
    'CONFIRMATION_TOKEN_MATCH',
    tokenMatched,
    confirmationToken ? 'Token supplied.' : 'No confirmation token supplied.'
  );
  authorizationGate(
    'GLOBAL_APPLY_ENABLED',
    QBO_TRIGGER_APPLY_GLOBAL_ENABLED_ === true,
    QBO_TRIGGER_APPLY_GLOBAL_ENABLED_
      ? 'Enabled.'
      : 'Phase-B global hard disable is active.'
  );

  const environmentalReadiness = environmentalGates.every(function(row) {
    return row.pass;
  });

  const operatorAuthorizationReady = authorizationGates.every(function(row) {
    return row.pass;
  });

  const mutationAuthorized =
    environmentalReadiness &&
    operatorAuthorizationReady &&
    QBO_TRIGGER_APPLY_GLOBAL_ENABLED_ === true;

  return {
    version: QBO_TRIGGER_APPLY_SAFETY_VERSION_,
    generatedAt: new Date().toISOString(),
    mode: 'PHASE_B_FAIL_CLOSED',

    environmentalReadiness: environmentalReadiness,
    operatorAuthorizationReady: operatorAuthorizationReady,
    mutationAuthorized: mutationAuthorized,

    globalApplyEnabled: QBO_TRIGGER_APPLY_GLOBAL_ENABLED_,
    requiredConfirmationToken: QBO_TRIGGER_APPLY_CONFIRMATION_TOKEN_,
    confirmationTokenMatched: tokenMatched,

    reconciliationPlanVersion: plan.version || '',
    reconciliationPlanMode: plan.mode || '',
    reconciliationPlanMutationPermitted: plan.mutationPermitted === true,

    environmentalGates: environmentalGates,
    authorizationGates: authorizationGates,

    completenessSummary: {
      valid: completeness.valid,
      sourceCreateSiteCount: completeness.sourceCreateSiteCount,
      uniqueSourceHandlerCount: completeness.uniqueSourceHandlerCount,
      registryBindingCount: completeness.registryBindingCount,
      actualTriggerCount: completeness.actualTriggerCount
    },
    planSummary: {
      version: plan.version || '',
      valid: plan.valid,
      actualTriggerCount: plan.actualTriggerCount,
      proposedCreateCount: plan.proposedCreateCount,
      proposedDeleteExcessCount: plan.proposedDeleteExcessCount,
      foreignReviewCount: plan.foreignReviewCount,
      mutationPermitted: plan.mutationPermitted === true
    }
  };
}

/**
 * Apps Script editor-friendly read-only readiness validation.
 * No confirmation token is supplied or required for environmental validation.
 */
function validateQboPipelineTriggerApplySafety() {
  const result = qboTriggerApplySafetyEvaluation_('');
  console.log(
    '[PIPELINE CONTROL] | TRIGGER APPLY SAFETY | ' +
    JSON.stringify(result, null, 2)
  );
  return result;
}

/**
 * Future apply entry point. In v1.5.141 it ALWAYS fails closed.
 *
 * Even with the exact confirmation token and every environmental precondition
 * passing, QBO_TRIGGER_APPLY_GLOBAL_ENABLED_ is false and no mutation code
 * exists here.
 */
function applyQboPipelineTriggerReconciliation(confirmationToken) {
  const result = qboTriggerApplySafetyEvaluation_(confirmationToken);
  console.log(
    '[PIPELINE CONTROL] | TRIGGER APPLY REQUEST | ' +
    JSON.stringify(result, null, 2)
  );

  if (!result.mutationAuthorized) {
    throw new Error(
      'QBO pipeline trigger apply is globally disabled in Phase B. ' +
      'No trigger mutation performed.'
    );
  }

  throw new Error(
    'QBO pipeline trigger mutation implementation is not present in v1.5.141. ' +
    'No trigger mutation performed.'
  );
}
