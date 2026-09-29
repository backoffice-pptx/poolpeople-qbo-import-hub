/**
 * Module  : 4031_QBO_FullExportObservationCountHistoricalApplyPlanSummary.js
 * Version : 1.5.151
 * Purpose : Compact, read-only validation summary for the completed frozen
 *           historical ObservationCount apply plan.
 *
 * Operator:
 *   validateQboFullExportObservationCountHistoricalApplyPlan()
 *
 * Safety:
 *   - NO production writes.
 *   - NO locks / workbook write lease.
 *   - NO trigger mutation.
 *   - Does not reopen MasterBackups.
 *   - Does not create missing 01 sources.
 */
const QBO_FE_OBS_HIST_APPLY_SUMMARY_ = Object.freeze({
  VERSION: '1.5.151',
  PREVIEW_STATE_KEY: 'QBO_FE_OBS_HIST_PREVIEW_V148_STATE',
  PREVIEW_RESULT_PREFIX: 'QBO_FE_OBS_HIST_PREVIEW_V148_RESULT_',
  STRANDED_RUN_IDS: Object.freeze(['9ff6e204-18d8-4f81-b965-7749429886b3'])
});

function validateQboFullExportObservationCountHistoricalApplyPlan() {
  const C = QBO_FE_OBS_HIST_APPLY_SUMMARY_;
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(C.PREVIEW_STATE_KEY);
  if (!raw) throw new Error('Completed historical preview state not found.');

  const state = JSON.parse(raw);
  if (state.status !== 'COMPLETE' ||
      Number(state.processedCount) !== Number(state.candidateCount)) {
    throw new Error('Historical preview must be COMPLETE and fully processed.');
  }

  const counts = {
    frozenCandidates: Number(state.candidateCount),
    processedCandidates: Number(state.processedCount),
    historyWrites: 0,
    sourceWrites: 0,
    historyAlreadyMatches: 0,
    sourceAlreadyMatches: 0,
    controlledTestExcludedSourceCreates: 0,
    strandedRunExcludedSourceCreates: 0,
    unclassifiedMissingSourceBlocked: 0,
    blockedOrMismatch: 0,
    coveredCandidates: 0
  };
  const exceptions = [];
  const covered = {};

  for (let i = 0; i < Number(state.processedCount); i++) {
    const rr = props.getProperty(C.PREVIEW_RESULT_PREFIX + state.previewRunId + '_' + i);
    if (!rr) {
      counts.blockedOrMismatch++;
      exceptions.push({candidateIndex:i, classification:'MISSING_FROZEN_RESULT'});
      continue;
    }

    const r = JSON.parse(rr);
    covered[i] = true;

    const hard = (r.findings || []).filter(function(f) {
      return f.type !== 'SOURCE_MISSING';
    });
    if (hard.length ||
        r.historyDisposition === 'EXISTING_MISMATCH' ||
        r.sourceDisposition === 'EXISTING_MISMATCH' ||
        r.historyDisposition === 'BLOCKED' ||
        r.sourceDisposition === 'BLOCKED') {
      counts.blockedOrMismatch++;
      exceptions.push({
        candidateIndex:i,
        classification:'BLOCKED_OR_MISMATCH',
        runId:r.runId || '',
        exportKey:r.exportKey,
        sourceId:r.sourceId || '',
        findings:r.findings || []
      });
      continue;
    }

    if (r.historyDisposition === 'PROPOSE_WRITE') counts.historyWrites++;
    else if (r.historyDisposition === 'ALREADY_MATCHES') counts.historyAlreadyMatches++;

    if (r.sourceDisposition === 'PROPOSE_WRITE') counts.sourceWrites++;
    else if (r.sourceDisposition === 'ALREADY_MATCHES') counts.sourceAlreadyMatches++;
    else if (r.sourceDisposition === 'SOURCE_MISSING') {
      const runId = String(r.runId || '');
      let classification;
      if (runId.indexOf('STATE_CAPTURE_AUTOREG_TEST_') === 0) {
        classification = 'CONTROLLED_TEST_SOURCE_MISSING';
        counts.controlledTestExcludedSourceCreates++;
      } else if (C.STRANDED_RUN_IDS.indexOf(runId) >= 0) {
        classification = 'STRANDED_RUN_SOURCE_MISSING_ELIGIBILITY_REVIEW_REQUIRED';
        counts.strandedRunExcludedSourceCreates++;
      } else {
        classification = 'UNCLASSIFIED_MISSING_SOURCE_BLOCKED';
        counts.unclassifiedMissingSourceBlocked++;
      }
      exceptions.push({
        candidateIndex:i,
        classification:classification,
        runId:runId,
        exportKey:r.exportKey,
        sourceId:r.sourceId || '',
        observationCount:r.derivedObservationCount,
        sourceCreateProposed:false
      });
    }
  }

  counts.coveredCandidates = Object.keys(covered).length;

  const cellWriteCount = counts.historyWrites + counts.sourceWrites;
  const alreadyMatchCellCount =
    counts.historyAlreadyMatches + counts.sourceAlreadyMatches;

  const out = {
    version:C.VERSION,
    operation:'READ_ONLY_HISTORICAL_OBSERVATIONCOUNT_APPLY_PLAN_VALIDATION',
    sourcePreview:{
      previewRunId:state.previewRunId,
      previewVersion:state.version,
      frozenAt:state.frozenAt,
      status:state.status
    },
    counts:counts,
    reconciliation:{
      proposedCellWrites:cellWriteCount,
      alreadyMatchingCells:alreadyMatchCellCount,
      excludedMissingSourceCreates:
        counts.controlledTestExcludedSourceCreates +
        counts.strandedRunExcludedSourceCreates,
      allCandidatesCovered:
        counts.coveredCandidates === counts.frozenCandidates
    },
    exceptions:exceptions,
    safety:{
      productionWritesPerformed:false,
      locksAcquired:false,
      workbookWriteLeaseAcquired:false,
      triggerMutationPerformed:false,
      missingSourceCreationAllowed:false
    },
    validForControlledApply:
      counts.coveredCandidates === counts.frozenCandidates &&
      counts.blockedOrMismatch === 0 &&
      counts.unclassifiedMissingSourceBlocked === 0
  };

  console.log(JSON.stringify(out, null, 2));
  return out;
}
