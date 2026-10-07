/** App 50 v1.5.226 — read-only Phase G checkpoint inspector. */
function inspectQboPhaseGGlobalEqualTimeCheckpointV1226() {
  const key = 'QBO_PHASE_G_GLOBAL_TIE_V1219_STATE';
  const raw = PropertiesService.getScriptProperties().getProperty(key);
  const out = {version:'1.5.226', mode:'READ_ONLY', stateKey:key, statePresent:raw !== null};
  if (raw !== null) {
    let state;
    try { state = JSON.parse(raw); }
    catch (e) { out.stateParseError = 'INVALID_JSON'; }
    if (state && typeof state === 'object' && !Array.isArray(state)) {
      const fields = ['version','status','runId','workbookId','manifestCursor','manifestCount',
        'observationCount','admittedCount','evidenceExceptionCount','blockedCount','partitionCursor',
        'equalObservedAtGroupCount','equalObservedAtObservationCount','maxEqualObservedAtGroupSize',
        'crossSourceEqualObservedAtGroupCount','deleteConflictGroupCount','tieCandidateFailureCount',
        'startedAt','lastProgressAt','completedAt','error','continuationTriggerId',
        'inFlightManifestBase','inFlightObservationCount'];
      out.checkpoint = {};
      fields.forEach(function(k) { if (Object.prototype.hasOwnProperty.call(state,k)) out.checkpoint[k] = state[k]; });
      out.iteratorTokenPresent = typeof state.iteratorToken === 'string' && state.iteratorToken.length > 0;
    } else if (!out.stateParseError) out.stateParseError = 'INVALID_STATE_OBJECT';
  }
  out.continuationTriggers = ScriptApp.getProjectTriggers()
    .filter(function(t) { return t.getHandlerFunction() === 'qboPhaseGGlobalEqualTimeV1219Continuation_'; })
    .map(function(t) { return {id:t.getUniqueId(),handler:t.getHandlerFunction(),eventType:String(t.getEventType())}; });
  console.log('[PHASE G CHECKPOINT V1226] | READ_ONLY | ' + JSON.stringify(out));
  return out;
}
