/** V1281 read-only queue liveness and trigger review. No recovery mutations. */
function previewQboDailyRecoveryV1281() {
  var props = PropertiesService.getScriptProperties();
  var active = getActiveDailyQboWorkerState_(props);
  var triggers = ScriptApp.getProjectTriggers();
  var out = {
    version: '1.5.281-preview', readOnly: true,
    paused: props.getProperty(QBO_DAILY_V1279_PAUSE_KEY) === 'true',
    runId: props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.RUN_ID) || '',
    queueIndex: props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.INDEX),
    activeClaimPresent: !!active,
    activeExportKey: active ? active.exportKey : '',
    activeClaimAgeMs: active && active.startedAtMs ? Date.now() - active.startedAtMs : null,
    ageOnlyTakeoverAllowed: !!(active && isDailyQboWorkerStateStale_(active)),
    continuationTriggers: triggers.filter(function(t) {
      return t.getHandlerFunction() === DAILY_QBO_TRIGGER_HANDLERS.NEXT;
    }).length,
    starterTriggers: triggers.filter(function(t) {
      return t.getHandlerFunction() === DAILY_QBO_TRIGGER_HANDLERS.START;
    }).length,
    recoveryMode: active ? 'MANUAL_LIVENESS_VERIFICATION_REQUIRED' : 'NO_ACTIVE_CLAIM',
    executionLivenessVerified: false
  };
  if (out.ageOnlyTakeoverAllowed) throw new Error('Age-only takeover unexpectedly enabled');
  console.log('[DAILY V1281] | READ_ONLY | ' + JSON.stringify(out));
  return out;
}
