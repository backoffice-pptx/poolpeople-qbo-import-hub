/** V1288: read-only inspection of live checkpoint and queue state. */
function previewQboDailySnapshotBoundaryV1288() {
  const props = PropertiesService.getScriptProperties();
  const q = DAILY_QBO_QUEUE_PROPERTIES;
  const raw = props.getProperty(QBO_DAILY_V1284_KEY);
  let checkpoint = null, parseError = '';
  try { checkpoint = qboDailyV1284Parse_(raw); }
  catch (e) { parseError = String(e && e.message || e); }
  const result = {
    version:'1.5.288-review', readOnly:true,
    paused:props.getProperty(QBO_DAILY_V1279_PAUSE_KEY)==='true',
    runId:props.getProperty(q.RUN_ID)||'',
    activeClaimPresent:!!props.getProperty(q.ACTIVE_TOKEN),
    queueIndex:props.getProperty(q.INDEX),
    checkpointPhase:checkpoint ? checkpoint.phase : null,
    checkpointSequence:checkpoint ? checkpoint.sequence : null,
    checkpointSnapshotId:checkpoint ? checkpoint.snapshotId || '' : '',
    checkpointParseError:parseError,
    snapshotCommitIntegrated:false,
    queueAdvanceCheckpointIntegrated:false,
    exporterWriteFencingIntegrated:false,
    automaticRecoveryEnabled:false,
    decision:'REVIEW_ONLY_NO_MUTATION'
  };
  console.log('[DAILY V1288] | READ_ONLY | '+JSON.stringify(result));
  return result;
}
