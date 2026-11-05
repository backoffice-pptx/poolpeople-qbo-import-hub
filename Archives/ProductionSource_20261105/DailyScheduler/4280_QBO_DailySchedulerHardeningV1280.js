/** V1280 read-only verification of scheduler pause and claim safety. */
function previewQboDailyHardeningV1280() {
  var props = PropertiesService.getScriptProperties();
  var active = getActiveDailyQboWorkerState_(props);
  var out = {
    version: '1.5.280-preview', readOnly: true,
    paused: props.getProperty(QBO_DAILY_V1279_PAUSE_KEY) === 'true',
    runId: props.getProperty(DAILY_QBO_QUEUE_PROPERTIES.RUN_ID) || '',
    activeClaimPresent: !!active,
    activeClaimAgeMs: active && active.startedAtMs ? Date.now()-active.startedAtMs : null,
    ageOnlyTakeoverAllowed: !!(active && isDailyQboWorkerStateStale_(active)),
    continuationTriggers: ScriptApp.getProjectTriggers().filter(function(t) {
      return t.getHandlerFunction() === DAILY_QBO_TRIGGER_HANDLERS.NEXT;
    }).length,
    starterTriggers: ScriptApp.getProjectTriggers().filter(function(t) {
      return t.getHandlerFunction() === DAILY_QBO_TRIGGER_HANDLERS.START;
    }).length
  };
  if (out.ageOnlyTakeoverAllowed) throw Error('V1280 invariant violation: age-only takeover');
  console.log('[DAILY V1280] | READ_ONLY | ' + JSON.stringify(out));
  return out;
}
