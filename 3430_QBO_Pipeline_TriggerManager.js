/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 3430_QBO_Pipeline_TriggerManager.js
 * Purpose     : Governed trigger inventory/reconciliation.
 *
 * v1.5.137:
 * - DAILY_FULL_EXPORT durable starter expectation becomes governed
 *   administrative-state-aware after authority cutover.
 * - ENABLED => starter REQUIRED_RECURRING.
 * - PAUSED  => starter INTENTIONALLY_ABSENT.
 * - Transient continuation semantics remain unchanged.
 * - Other pipelines retain registry-defined expectations.
 *
 * Safety:
 * - Read-only reconciliation only.
 * - Generic trigger install/remove remains fail-closed.
 */

const QBO_PIPELINE_TRIGGER_MANAGER_VERSION_ = 'QBO_PIPELINE_TRIGGER_MANAGER_V3';

function qboPipelineProjectTriggerRows_() {
  return ScriptApp.getProjectTriggers().map(function(trigger) {
    return {
      handler: String(trigger.getHandlerFunction() || ''),
      source: String(trigger.getTriggerSource()),
      eventType: String(trigger.getEventType()),
      triggerId: String(trigger.getUniqueId() || '')
    };
  });
}

function qboPipelineEffectiveTriggerSpecs_(def) {
  const specs = qboPipelineTriggerSpecs_(def).map(function(spec) {
    return Object.assign({}, spec);
  });

  if (def.pipelineId !== QBO_PIPELINE_IDS_.DAILY_FULL_EXPORT ||
      typeof qboPipelineReadAdministrativeAuthority_ !== 'function') {
    return specs;
  }

  const authority = qboPipelineReadAdministrativeAuthority_(def.pipelineId);
  if (!authority ||
      authority.initialized !== true ||
      authority.authority !== 'GOVERNED_34XX') {
    return specs;
  }

  const admin = qboPipelineReadAdministrativeState_(def.pipelineId);
  if (!admin || !admin.initialized) return specs;

  return specs.map(function(spec) {
    if (spec.handler !== DAILY_QBO_TRIGGER_HANDLERS.START) return spec;

    if (admin.administrativeState === 'PAUSED') {
      return Object.assign({}, spec, {
        expectation: QBO_PIPELINE_TRIGGER_EXPECTATION_.INTENTIONALLY_ABSENT,
        expectationBasis: 'GOVERNED_ADMINISTRATIVE_STATE_PAUSED'
      });
    }

    if (admin.administrativeState === 'ENABLED') {
      return Object.assign({}, spec, {
        expectation: QBO_PIPELINE_TRIGGER_EXPECTATION_.REQUIRED_RECURRING,
        expectationBasis: 'GOVERNED_ADMINISTRATIVE_STATE_ENABLED'
      });
    }

    return spec;
  });
}

function qboPipelineEffectiveGovernedHandlerMap_() {
  const map = {};
  listQboPipelineDefinitions_().forEach(function(def) {
    qboPipelineEffectiveTriggerSpecs_(def).forEach(function(spec) {
      if (!map[spec.handler]) map[spec.handler] = [];
      map[spec.handler].push({
        pipelineId: def.pipelineId,
        expectation: spec.expectation,
        expectationBasis: spec.expectationBasis || 'REGISTRY_STATIC'
      });
    });
  });
  return map;
}

function qboPipelineTriggerInventory_() {
  const handlerMap = qboPipelineEffectiveGovernedHandlerMap_();
  const triggers = qboPipelineProjectTriggerRows_();

  const rows = triggers.map(function(row) {
    const owners = handlerMap[row.handler] || [];
    return Object.assign({}, row, {
      governed: owners.length > 0,
      pipelineBindings: owners.slice()
    });
  });

  const actualHandlers = {};
  rows.forEach(function(row) {
    actualHandlers[row.handler] = (actualHandlers[row.handler] || 0) + 1;
  });

  const requiredRecurringMissing = [];
  const transientContinuationAbsent = [];
  const intentionallyAbsentConfirmed = [];
  const intentionallyAbsentViolations = [];
  const duplicateGovernedHandlers = [];

  Object.keys(handlerMap).sort().forEach(function(handler) {
    const count = actualHandlers[handler] || 0;
    const bindings = handlerMap[handler];

    bindings.forEach(function(binding) {
      if (binding.expectation === QBO_PIPELINE_TRIGGER_EXPECTATION_.REQUIRED_RECURRING && count === 0) {
        requiredRecurringMissing.push({
          handler: handler,
          pipelineId: binding.pipelineId,
          expectationBasis: binding.expectationBasis
        });
      } else if (binding.expectation === QBO_PIPELINE_TRIGGER_EXPECTATION_.TRANSIENT_CONTINUATION && count === 0) {
        transientContinuationAbsent.push({
          handler: handler,
          pipelineId: binding.pipelineId,
          expectationBasis: binding.expectationBasis
        });
      } else if (binding.expectation === QBO_PIPELINE_TRIGGER_EXPECTATION_.INTENTIONALLY_ABSENT) {
        const item = {
          handler: handler,
          pipelineId: binding.pipelineId,
          actualCount: count,
          expectationBasis: binding.expectationBasis
        };
        if (count === 0) intentionallyAbsentConfirmed.push(item);
        else intentionallyAbsentViolations.push(item);
      }
    });

    if (count > 1) {
      duplicateGovernedHandlers.push({ handler: handler, actualCount: count });
    }
  });

  const orphanOrForeign = rows.filter(function(row) { return !row.governed; });

  return {
    version: QBO_PIPELINE_TRIGGER_MANAGER_VERSION_,
    generatedAt: new Date().toISOString(),
    valid:
      requiredRecurringMissing.length === 0 &&
      intentionallyAbsentViolations.length === 0 &&
      duplicateGovernedHandlers.length === 0 &&
      orphanOrForeign.length === 0,
    triggerCount: rows.length,
    governedTriggerCount: rows.filter(function(row) { return row.governed; }).length,
    orphanOrForeignTriggerCount: orphanOrForeign.length,
    requiredRecurringMissing: requiredRecurringMissing,
    transientContinuationAbsent: transientContinuationAbsent,
    intentionallyAbsentConfirmed: intentionallyAbsentConfirmed,
    intentionallyAbsentViolations: intentionallyAbsentViolations,
    duplicateGovernedHandlers: duplicateGovernedHandlers,
    triggers: rows,
    orphanOrForeignTriggers: orphanOrForeign
  };
}

function qboPipelineTriggersFor_(pipelineId) {
  const def = getQboPipelineDefinition_(pipelineId);
  const handlers = {};
  qboPipelineEffectiveTriggerSpecs_(def).forEach(function(spec) {
    handlers[spec.handler] = spec.expectation;
  });
  return qboPipelineProjectTriggerRows_().filter(function(row) {
    return Object.prototype.hasOwnProperty.call(handlers, row.handler);
  }).map(function(row) {
    return Object.assign({}, row, { expectation: handlers[row.handler] });
  });
}

function qboPipelineReconcileTriggerStateReadOnly_(pipelineId) {
  const def = getQboPipelineDefinition_(pipelineId);
  const specs = qboPipelineEffectiveTriggerSpecs_(def);
  const actual = qboPipelineTriggersFor_(def.pipelineId);
  const byHandler = {};
  actual.forEach(function(row) {
    byHandler[row.handler] = (byHandler[row.handler] || 0) + 1;
  });

  const requiredRecurringMissing = [];
  const transientContinuationAbsent = [];
  const intentionallyAbsentConfirmed = [];
  const intentionallyAbsentViolations = [];

  specs.forEach(function(spec) {
    const count = byHandler[spec.handler] || 0;
    const item = {
      handler: spec.handler,
      actualCount: count,
      expectationBasis: spec.expectationBasis || 'REGISTRY_STATIC'
    };

    if (spec.expectation === QBO_PIPELINE_TRIGGER_EXPECTATION_.REQUIRED_RECURRING && count === 0) {
      requiredRecurringMissing.push(item);
    } else if (spec.expectation === QBO_PIPELINE_TRIGGER_EXPECTATION_.TRANSIENT_CONTINUATION && count === 0) {
      transientContinuationAbsent.push(item);
    } else if (spec.expectation === QBO_PIPELINE_TRIGGER_EXPECTATION_.INTENTIONALLY_ABSENT) {
      if (count === 0) intentionallyAbsentConfirmed.push(item);
      else intentionallyAbsentViolations.push(item);
    }
  });

  return {
    pipelineId: def.pipelineId,
    phaseBMode: def.phaseBMode,
    lifecycle: def.lifecycle,
    triggerSpecs: specs,
    actualTriggers: actual,
    valid:
      requiredRecurringMissing.length === 0 &&
      intentionallyAbsentViolations.length === 0 &&
      Object.keys(byHandler).filter(function(handler) { return byHandler[handler] > 1; }).length === 0,
    requiredRecurringMissing: requiredRecurringMissing,
    transientContinuationAbsent: transientContinuationAbsent,
    intentionallyAbsentConfirmed: intentionallyAbsentConfirmed,
    intentionallyAbsentViolations: intentionallyAbsentViolations,
    duplicateHandlers: Object.keys(byHandler).filter(function(handler) {
      return byHandler[handler] > 1;
    }),
    mutationPerformed: false
  };
}

function qboPipelineInstallTriggers_(pipelineId) {
  throw new Error('QBO_PIPELINE_TRIGGER_INSTALL_BLOCKED_PHASE_B pipelineId=' + String(pipelineId || ''));
}

function qboPipelineRemoveTriggers_(pipelineId) {
  throw new Error('QBO_PIPELINE_TRIGGER_REMOVE_BLOCKED_PHASE_B pipelineId=' + String(pipelineId || ''));
}
