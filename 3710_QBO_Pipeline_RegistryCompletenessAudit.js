/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 3710_QBO_Pipeline_RegistryCompletenessAudit.js
 * Version     : 1.5.127
 * Purpose     : Read-only source-to-registry trigger completeness audit.
 *
 * IMPORTANT:
 * Apps Script cannot enumerate its own source files at runtime. Therefore this
 * audit uses a frozen, source-reviewed inventory derived from the authoritative
 * 2026-09-15 App 50 source snapshot, and reconciles that inventory to the live
 * 3410 registry plus actual installed project triggers.
 *
 * It does not create/delete triggers or mutate properties/workbooks/Drive.
 */

const QBO_TRIGGER_SOURCE_AUDIT_V1_ = Object.freeze({
  version: 'QBO_TRIGGER_SOURCE_AUDIT_V1',
  sourceSnapshot: '50_QBO_Import_Hub_Standalone_SOURCE_AUDIT_20260915.txt',
  sites: Object.freeze([
    {module:'24_TriggerManagement.js', handler:'startDailyQboExportSchedule', siteType:'CREATE', lifecycle:'ACTIVE'},
    {module:'24_TriggerManagement.js', handler:'runNextScheduledQboExport', siteType:'CREATE', lifecycle:'ACTIVE'},

    {module:'73_QBO_NativeCdcProduction.js', handler:'startQboNativeCdcCycle', siteType:'CREATE', lifecycle:'ACTIVE_CONCEPT_REFACTOR'},
    {module:'73_QBO_NativeCdcProduction.js', handler:'runNextQboNativeCdcWave', siteType:'CREATE', lifecycle:'ACTIVE_CONCEPT_REFACTOR'},

    {module:'104_QBO_NativeCdcForwardIngestion.js', handler:'dispatchQboNativeCdcIngestion', siteType:'CREATE', lifecycle:'SUPERSEDED_REPLACE'},
    {module:'106_QBO_FullExportForwardIngestion.js', handler:'dispatchQboFullExportIngestion', siteType:'CREATE', lifecycle:'SUPERSEDED_REPLACE'},
    {module:'107_QBO_WebhookForwardIngestion.js', handler:'dispatchQboWebhookIngestion', siteType:'CREATE', lifecycle:'SUPERSEDED_REPLACE'},

    {module:'53_QBO_GeneralLedgerBackfill.js', handler:'runNextQboGeneralLedgerBackfillMonth', siteType:'CREATE', lifecycle:'CONTROLLED_MIGRATION'},
    {module:'92_QBO_RecursiveContractCoverageAudit.js', handler:'runNextQboRecursiveContractCoverageAudit', siteType:'CREATE', lifecycle:'CONTROLLED_AUDIT'},
    {module:'92_QBO_RecursiveContractCoverageAudit.js', handler:'watchQboRecursiveContractCoverageAudit', siteType:'CREATE', lifecycle:'CONTROLLED_AUDIT'},
    {module:'95_QBO_StateCaptureContractV2Rebuild.js', handler:'runNextQboCanonicalV2Rebuild', siteType:'CREATE', lifecycle:'SUPERSEDED_CONTROLLED_MIGRATION'},
    {module:'95_QBO_StateCaptureContractV2Rebuild.js', handler:'watchQboCanonicalV2Rebuild', siteType:'CREATE', lifecycle:'SUPERSEDED_CONTROLLED_MIGRATION'},

    {module:'105_QBO_NativeCdcHistoricalRegistrationBackfill.js', handler:'qboNativeCdcHistoricalRegistrationContinuation_', siteType:'CREATE', lifecycle:'SUPERSEDED_CONTROLLED_MIGRATION'},
    {module:'108_QBO_WebhookHistoricalReconstruction.js', handler:'qboWebhookHistoricalReconstructionContinuation_', siteType:'CREATE', lifecycle:'SUPERSEDED_CONTROLLED_MIGRATION'},
    {module:'123_QBO_PayloadArtifactHistoricalBackfill.js', handler:'qboPayloadArtifactHistoricalBackfillContinuation_', siteType:'CREATE', lifecycle:'CONTROLLED_MIGRATION'}
  ])
});

function auditQboPipelineRegistryCompleteness() {
  const sourceRows = QBO_TRIGGER_SOURCE_AUDIT_V1_.sites.slice();
  const sourceByHandler = {};
  sourceRows.forEach(function(row) {
    if (!sourceByHandler[row.handler]) sourceByHandler[row.handler] = [];
    sourceByHandler[row.handler].push(row);
  });

  const registryRows = [];
  const registryByHandler = {};
  listQboPipelineDefinitions_().forEach(function(def) {
    (def.triggerSpecs || []).forEach(function(spec) {
      const row = {
        handler: spec.handler,
        pipelineId: def.pipelineId,
        expectation: spec.expectation,
        lifecycle: def.lifecycle,
        jobClass: def.jobClass
      };
      registryRows.push(row);
      if (!registryByHandler[row.handler]) registryByHandler[row.handler] = [];
      registryByHandler[row.handler].push(row);
    });
  });

  const sourceHandlers = Object.keys(sourceByHandler).sort();
  const registryHandlers = Object.keys(registryByHandler).sort();

  const sourceMissingFromRegistry = sourceHandlers.filter(function(handler) {
    return !registryByHandler[handler];
  });
  const registryMissingFromSourceInventory = registryHandlers.filter(function(handler) {
    return !sourceByHandler[handler];
  });
  const duplicateRegistryBindings = registryHandlers.filter(function(handler) {
    return registryByHandler[handler].length !== 1;
  }).map(function(handler) {
    return {handler:handler, bindings:registryByHandler[handler]};
  });

  const actual = ScriptApp.getProjectTriggers().map(function(trigger) {
    return {
      handler: trigger.getHandlerFunction(),
      triggerId: trigger.getUniqueId(),
      source: String(trigger.getTriggerSource()),
      eventType: String(trigger.getEventType())
    };
  });
  const actualUnknownToSourceInventory = actual.filter(function(row) {
    return !sourceByHandler[row.handler];
  });
  const actualUnknownToRegistry = actual.filter(function(row) {
    return !registryByHandler[row.handler];
  });

  const result = {
    version: QBO_TRIGGER_SOURCE_AUDIT_V1_.version,
    sourceSnapshot: QBO_TRIGGER_SOURCE_AUDIT_V1_.sourceSnapshot,
    valid:
      sourceMissingFromRegistry.length === 0 &&
      registryMissingFromSourceInventory.length === 0 &&
      duplicateRegistryBindings.length === 0 &&
      actualUnknownToSourceInventory.length === 0 &&
      actualUnknownToRegistry.length === 0,
    sourceCreateSiteCount: sourceRows.length,
    uniqueSourceHandlerCount: sourceHandlers.length,
    registryBindingCount: registryRows.length,
    uniqueRegistryHandlerCount: registryHandlers.length,
    actualTriggerCount: actual.length,
    sourceMissingFromRegistry: sourceMissingFromRegistry,
    registryMissingFromSourceInventory: registryMissingFromSourceInventory,
    duplicateRegistryBindings: duplicateRegistryBindings,
    actualUnknownToSourceInventory: actualUnknownToSourceInventory,
    actualUnknownToRegistry: actualUnknownToRegistry,
    reconciledHandlers: sourceHandlers.map(function(handler) {
      return {
        handler: handler,
        sourceSites: sourceByHandler[handler],
        registryBindings: registryByHandler[handler] || [],
        actualTriggerCount: actual.filter(function(row){return row.handler===handler;}).length
      };
    })
  };

  console.log('[PIPELINE CONTROL] | REGISTRY COMPLETENESS AUDIT | ' + JSON.stringify(result, null, 2));
  return result;
}
