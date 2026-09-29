/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 3410_QBO_Pipeline_Registry.js
 * Purpose     : Governed registry for App 50 pipelines/jobs.
 *
 * Phase B bootstrap:
 * - Registry is descriptive/read-only with respect to existing workers.
 * - No pipeline is resumed and no trigger is installed by this module.
 * - Existing handlers remain execution authorities until deliberate cutover.
 */

const QBO_PIPELINE_REGISTRY_VERSION_ = 'QBO_PIPELINE_REGISTRY_V4';

const QBO_PIPELINE_JOB_CLASS_ = Object.freeze({
  PRODUCTION_ACQUISITION: 'PRODUCTION_ACQUISITION',
  PRODUCTION_INGESTION: 'PRODUCTION_INGESTION',
  STATE_APPLICATION: 'STATE_APPLICATION',
  SCHEDULED_EXPORT_REPORT: 'SCHEDULED_EXPORT_REPORT',
  MIGRATION_BACKFILL: 'MIGRATION_BACKFILL',
  DIAGNOSTIC_WATCHDOG: 'DIAGNOSTIC_WATCHDOG'
});

const QBO_PIPELINE_TRIGGER_EXPECTATION_ = Object.freeze({
  REQUIRED_RECURRING: 'REQUIRED_RECURRING',
  TRANSIENT_CONTINUATION: 'TRANSIENT_CONTINUATION',
  INTENTIONALLY_ABSENT: 'INTENTIONALLY_ABSENT'
});

const QBO_PIPELINE_IDS_ = Object.freeze({
  DAILY_FULL_EXPORT: 'DAILY_FULL_EXPORT',
  NATIVE_CDC_ACQUISITION: 'NATIVE_CDC_ACQUISITION',
  NATIVE_CDC_INGESTION_LEGACY: 'NATIVE_CDC_INGESTION_LEGACY',
  FULL_EXPORT_INGESTION_LEGACY: 'FULL_EXPORT_INGESTION_LEGACY',
  WEBHOOK_INGESTION_LEGACY: 'WEBHOOK_INGESTION_LEGACY',
  STATE_APPLICATION: 'STATE_APPLICATION',
  GENERAL_LEDGER_BACKFILL: 'GENERAL_LEDGER_BACKFILL',
  PAYLOAD_ARTIFACT_HISTORICAL_BACKFILL: 'PAYLOAD_ARTIFACT_HISTORICAL_BACKFILL',
  RECURSIVE_CONTRACT_AUDIT: 'RECURSIVE_CONTRACT_AUDIT',
  CANONICAL_V2_REBUILD_LEGACY: 'CANONICAL_V2_REBUILD_LEGACY',
  NATIVE_CDC_HISTORICAL_REGISTRATION_LEGACY: 'NATIVE_CDC_HISTORICAL_REGISTRATION_LEGACY',
  WEBHOOK_HISTORICAL_RECONSTRUCTION_LEGACY: 'WEBHOOK_HISTORICAL_RECONSTRUCTION_LEGACY'
});

function qboPipelineTriggerSpec_(handler, expectation) {
  return Object.freeze({ handler: handler, expectation: expectation });
}

function qboPipelineRegistry_() {
  const E = QBO_PIPELINE_TRIGGER_EXPECTATION_;
  return Object.freeze({
    DAILY_FULL_EXPORT: Object.freeze({
      pipelineId: QBO_PIPELINE_IDS_.DAILY_FULL_EXPORT,
      displayName: 'Daily FULL_EXPORT',
      jobClass: QBO_PIPELINE_JOB_CLASS_.SCHEDULED_EXPORT_REPORT,
      lifecycle: 'ACTIVE_PRODUCTION_AUTHORITY',
      phaseBMode: 'OBSERVE_EXISTING',
      triggerSpecs: Object.freeze([
        qboPipelineTriggerSpec_('startDailyQboExportSchedule', E.REQUIRED_RECURRING),
        qboPipelineTriggerSpec_('runNextScheduledQboExport', E.TRANSIENT_CONTINUATION)
      ]),
      legacyControlSurface: '24_TriggerManagement.js',
      legacyStatusAdapter: 'DAILY_FULL_EXPORT',
      stateCaptureResumePermitted: false
    }),
    NATIVE_CDC_ACQUISITION: Object.freeze({
      pipelineId: QBO_PIPELINE_IDS_.NATIVE_CDC_ACQUISITION,
      displayName: 'Native CDC Acquisition',
      jobClass: QBO_PIPELINE_JOB_CLASS_.PRODUCTION_ACQUISITION,
      lifecycle: 'ACTIVE_CONCEPT_REFACTOR',
      phaseBMode: 'OBSERVE_EXISTING_PAUSED',
      triggerSpecs: Object.freeze([
        qboPipelineTriggerSpec_('startQboNativeCdcCycle', E.INTENTIONALLY_ABSENT),
        qboPipelineTriggerSpec_('runNextQboNativeCdcWave', E.INTENTIONALLY_ABSENT)
      ]),
      legacyControlSurface: 'Native CDC production control',
      legacyStatusAdapter: 'NATIVE_CDC_ACQUISITION',
      stateCaptureResumePermitted: false
    }),
    NATIVE_CDC_INGESTION_LEGACY: Object.freeze({
      pipelineId: QBO_PIPELINE_IDS_.NATIVE_CDC_INGESTION_LEGACY,
      displayName: 'Native CDC Ingestion — Legacy',
      jobClass: QBO_PIPELINE_JOB_CLASS_.PRODUCTION_INGESTION,
      lifecycle: 'SUPERSEDED_REPLACE',
      phaseBMode: 'OBSERVE_EXISTING_PAUSED',
      triggerSpecs: Object.freeze([
        qboPipelineTriggerSpec_('dispatchQboNativeCdcIngestion', E.INTENTIONALLY_ABSENT)
      ]),
      legacyControlSurface: '104_QBO_NativeCdcForwardIngestion.js',
      legacyStatusAdapter: 'TRIGGER_GATED_PAUSED',
      stateCaptureResumePermitted: false
    }),
    FULL_EXPORT_INGESTION_LEGACY: Object.freeze({
      pipelineId: QBO_PIPELINE_IDS_.FULL_EXPORT_INGESTION_LEGACY,
      displayName: 'FULL_EXPORT State Capture Ingestion — Legacy',
      jobClass: QBO_PIPELINE_JOB_CLASS_.PRODUCTION_INGESTION,
      lifecycle: 'SUPERSEDED_REPLACE',
      phaseBMode: 'OBSERVE_EXISTING_PAUSED',
      triggerSpecs: Object.freeze([
        qboPipelineTriggerSpec_('dispatchQboFullExportIngestion', E.INTENTIONALLY_ABSENT)
      ]),
      legacyControlSurface: '106_QBO_FullExportForwardIngestion.js',
      legacyStatusAdapter: 'TRIGGER_GATED_PAUSED',
      stateCaptureResumePermitted: false
    }),
    WEBHOOK_INGESTION_LEGACY: Object.freeze({
      pipelineId: QBO_PIPELINE_IDS_.WEBHOOK_INGESTION_LEGACY,
      displayName: 'Webhook State Capture Ingestion — Legacy',
      jobClass: QBO_PIPELINE_JOB_CLASS_.PRODUCTION_INGESTION,
      lifecycle: 'SUPERSEDED_REPLACE',
      phaseBMode: 'OBSERVE_EXISTING_PAUSED',
      triggerSpecs: Object.freeze([
        qboPipelineTriggerSpec_('dispatchQboWebhookIngestion', E.INTENTIONALLY_ABSENT)
      ]),
      legacyControlSurface: '107_QBO_WebhookForwardIngestion.js',
      legacyStatusAdapter: 'TRIGGER_GATED_PAUSED',
      stateCaptureResumePermitted: false
    }),
    STATE_APPLICATION: Object.freeze({
      pipelineId: QBO_PIPELINE_IDS_.STATE_APPLICATION,
      displayName: 'State Application',
      jobClass: QBO_PIPELINE_JOB_CLASS_.STATE_APPLICATION,
      lifecycle: 'DISABLED_PENDING_V2',
      phaseBMode: 'DISABLED',
      triggerSpecs: Object.freeze([]),
      legacyControlSurface: '',
      legacyStatusAdapter: 'DISABLED',
      stateCaptureResumePermitted: false
    }),
    GENERAL_LEDGER_BACKFILL: Object.freeze({
      pipelineId: QBO_PIPELINE_IDS_.GENERAL_LEDGER_BACKFILL,
      displayName: 'General Ledger Historical Backfill',
      jobClass: QBO_PIPELINE_JOB_CLASS_.MIGRATION_BACKFILL,
      lifecycle: 'CONTROLLED_MIGRATION_BACKFILL',
      phaseBMode: 'OBSERVE_EXISTING',
      triggerSpecs: Object.freeze([
        qboPipelineTriggerSpec_('runNextQboGeneralLedgerBackfillMonth', E.TRANSIENT_CONTINUATION)
      ]),
      legacyControlSurface: '53_QBO_GeneralLedgerBackfill.js',
      legacyStatusAdapter: 'TRANSIENT_JOB',
      stateCaptureResumePermitted: false
    }),
    PAYLOAD_ARTIFACT_HISTORICAL_BACKFILL: Object.freeze({
      pipelineId: QBO_PIPELINE_IDS_.PAYLOAD_ARTIFACT_HISTORICAL_BACKFILL,
      displayName: 'Payload Artifact Historical Backfill',
      jobClass: QBO_PIPELINE_JOB_CLASS_.MIGRATION_BACKFILL,
      lifecycle: 'CONTROLLED_MIGRATION_BACKFILL',
      phaseBMode: 'OBSERVE_EXISTING',
      triggerSpecs: Object.freeze([
        qboPipelineTriggerSpec_('qboPayloadArtifactHistoricalBackfillContinuation_', E.TRANSIENT_CONTINUATION)
      ]),
      legacyControlSurface: '123_QBO_PayloadArtifactHistoricalBackfill.js',
      legacyStatusAdapter: 'TRANSIENT_JOB',
      stateCaptureResumePermitted: false
    }),
    RECURSIVE_CONTRACT_AUDIT: Object.freeze({
      pipelineId: QBO_PIPELINE_IDS_.RECURSIVE_CONTRACT_AUDIT,
      displayName: 'Recursive Contract Coverage Audit',
      jobClass: QBO_PIPELINE_JOB_CLASS_.DIAGNOSTIC_WATCHDOG,
      lifecycle: 'CONTROLLED_AUDIT_DIAGNOSTIC',
      phaseBMode: 'OBSERVE_EXISTING',
      triggerSpecs: Object.freeze([
        qboPipelineTriggerSpec_('runNextQboRecursiveContractCoverageAudit', E.TRANSIENT_CONTINUATION),
        qboPipelineTriggerSpec_('watchQboRecursiveContractCoverageAudit', E.TRANSIENT_CONTINUATION)
      ]),
      legacyControlSurface: '92 recursive contract audit',
      legacyStatusAdapter: 'TRANSIENT_JOB',
      stateCaptureResumePermitted: false
    }),
    CANONICAL_V2_REBUILD_LEGACY: Object.freeze({
      pipelineId: QBO_PIPELINE_IDS_.CANONICAL_V2_REBUILD_LEGACY,
      displayName: 'Canonical V2 Rebuild — Legacy',
      jobClass: QBO_PIPELINE_JOB_CLASS_.MIGRATION_BACKFILL,
      lifecycle: 'SUPERSEDED_CONTROLLED_MIGRATION',
      phaseBMode: 'OBSERVE_EXISTING',
      triggerSpecs: Object.freeze([
        qboPipelineTriggerSpec_('runNextQboCanonicalV2Rebuild', E.TRANSIENT_CONTINUATION),
        qboPipelineTriggerSpec_('watchQboCanonicalV2Rebuild', E.TRANSIENT_CONTINUATION)
      ]),
      legacyControlSurface: '95_QBO_StateCaptureContractV2Rebuild.js',
      legacyStatusAdapter: 'TRANSIENT_JOB',
      stateCaptureResumePermitted: false
    }),
    NATIVE_CDC_HISTORICAL_REGISTRATION_LEGACY: Object.freeze({
      pipelineId: QBO_PIPELINE_IDS_.NATIVE_CDC_HISTORICAL_REGISTRATION_LEGACY,
      displayName: 'Native CDC Historical Registration — Legacy',
      jobClass: QBO_PIPELINE_JOB_CLASS_.MIGRATION_BACKFILL,
      lifecycle: 'SUPERSEDED_CONTROLLED_MIGRATION',
      phaseBMode: 'OBSERVE_EXISTING',
      triggerSpecs: Object.freeze([
        qboPipelineTriggerSpec_('qboNativeCdcHistoricalRegistrationContinuation_', E.TRANSIENT_CONTINUATION)
      ]),
      legacyControlSurface: '105_QBO_NativeCdcHistoricalRegistrationBackfill.js',
      legacyStatusAdapter: 'TRANSIENT_JOB',
      stateCaptureResumePermitted: false
    }),
    WEBHOOK_HISTORICAL_RECONSTRUCTION_LEGACY: Object.freeze({
      pipelineId: QBO_PIPELINE_IDS_.WEBHOOK_HISTORICAL_RECONSTRUCTION_LEGACY,
      displayName: 'Webhook Historical Reconstruction — Legacy',
      jobClass: QBO_PIPELINE_JOB_CLASS_.MIGRATION_BACKFILL,
      lifecycle: 'SUPERSEDED_CONTROLLED_MIGRATION',
      phaseBMode: 'OBSERVE_EXISTING',
      triggerSpecs: Object.freeze([
        qboPipelineTriggerSpec_('qboWebhookHistoricalReconstructionContinuation_', E.TRANSIENT_CONTINUATION)
      ]),
      legacyControlSurface: '108_QBO_WebhookHistoricalReconstruction.js',
      legacyStatusAdapter: 'TRANSIENT_JOB',
      stateCaptureResumePermitted: false
    })
  });
}

function getQboPipelineDefinition_(pipelineId) {
  const id = String(pipelineId || '').trim();
  const registry = qboPipelineRegistry_();
  if (!Object.prototype.hasOwnProperty.call(registry, id)) {
    throw new Error('QBO_PIPELINE_UNKNOWN pipelineId=' + id);
  }
  return registry[id];
}

function listQboPipelineDefinitions_() {
  const registry = qboPipelineRegistry_();
  return Object.keys(registry).sort().map(function(key) { return registry[key]; });
}

function qboPipelineTriggerSpecs_(def) {
  return (def.triggerSpecs || []).slice();
}

function qboPipelineGovernedHandlerMap_() {
  const map = {};
  listQboPipelineDefinitions_().forEach(function(def) {
    qboPipelineTriggerSpecs_(def).forEach(function(spec) {
      if (!map[spec.handler]) map[spec.handler] = [];
      map[spec.handler].push({
        pipelineId: def.pipelineId,
        expectation: spec.expectation
      });
    });
  });
  return map;
}
