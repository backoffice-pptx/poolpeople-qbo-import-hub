/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 3420_QBO_Pipeline_Control.js
 * Version     : 1.5.133
 * Purpose     : Common administrative-state contract for governed pipelines.
 *
 * Phase B safety:
 * - This bootstrap does NOT mutate existing legacy pause properties.
 * - Resume is fail-closed for all registered State Capture-related pipelines.
 * - No worker calls this module yet; cutover wiring is a later controlled step.
 */

const QBO_PIPELINE_CONTROL_VERSION_ = 'QBO_PIPELINE_CONTROL_V1';
const QBO_PIPELINE_CONTROL_PROPERTY_PREFIX_ = 'QBO_PIPELINE_CONTROL_V1__';

function qboPipelineControlPropertyKey_(pipelineId) {
  return QBO_PIPELINE_CONTROL_PROPERTY_PREFIX_ + String(pipelineId || '').trim();
}

function qboPipelineReadAdministrativeState_(pipelineId) {
  const def = getQboPipelineDefinition_(pipelineId);
  const raw = PropertiesService.getScriptProperties()
    .getProperty(qboPipelineControlPropertyKey_(def.pipelineId));

  if (!raw) {
    return {
      pipelineId: def.pipelineId,
      initialized: false,
      administrativeState: 'UNINITIALIZED',
      paused: null,
      source: 'NO_GOVERNED_STATE_YET'
    };
  }

  let parsed;
  try { parsed = JSON.parse(raw); }
  catch (error) {
    throw new Error('QBO_PIPELINE_CONTROL_STATE_INVALID pipelineId=' +
      def.pipelineId + ' error=' + String(error && error.message ? error.message : error));
  }

  return Object.assign({
    pipelineId: def.pipelineId,
    initialized: true,
    source: 'GOVERNED_PROPERTY'
  }, parsed);
}

/**
 * Controlled internal writer used by governed cutovers.
 * This does not mutate triggers or legacy pause properties.
 */
function qboPipelineWriteAdministrativeState_(pipelineId, administrativeState, metadata) {
  const def = getQboPipelineDefinition_(pipelineId);
  const normalized = String(administrativeState || '').trim().toUpperCase();

  if (normalized !== 'ENABLED' && normalized !== 'PAUSED') {
    throw new Error(
      'QBO_PIPELINE_CONTROL_STATE_UNSUPPORTED pipelineId=' + def.pipelineId +
      ' administrativeState=' + normalized
    );
  }

  const now = new Date().toISOString();
  const state = Object.assign({
    administrativeState: normalized,
    paused: normalized === 'PAUSED',
    updatedAt: now,
    version: QBO_PIPELINE_CONTROL_VERSION_
  }, metadata || {});

  PropertiesService.getScriptProperties().setProperty(
    qboPipelineControlPropertyKey_(def.pipelineId),
    JSON.stringify(state)
  );

  return qboPipelineReadAdministrativeState_(def.pipelineId);
}

function qboPipelineAssertResumeAllowed_(pipelineId) {
  const def = getQboPipelineDefinition_(pipelineId);
  if (def.stateCaptureResumePermitted !== true) {
    throw new Error(
      'QBO_PIPELINE_RESUME_BLOCKED_PHASE_B pipelineId=' + def.pipelineId +
      ' lifecycle=' + def.lifecycle +
      ' mode=' + def.phaseBMode
    );
  }
  return def;
}

function qboPipelinePause_(pipelineId) {
  return qboPipelineWriteAdministrativeState_(
    pipelineId,
    'PAUSED',
    { reason: 'OPERATOR_PAUSE' }
  );
}

function qboPipelineResume_(pipelineId) {
  const def = qboPipelineAssertResumeAllowed_(pipelineId);
  throw new Error(
    'QBO_PIPELINE_RESUME_NOT_WIRED pipelineId=' + def.pipelineId +
    ' Phase B bootstrap cannot resume workers.'
  );
}
