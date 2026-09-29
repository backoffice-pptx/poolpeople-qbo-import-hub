/**
 * Module  : 4030_QBO_FullExportObservationCountHistoricalApplyPlan.js
 * Version : 1.5.150
 * Purpose : Read-only exact apply-plan preview from the completed frozen
 *           historical ObservationCount preview.
 *
 * Operator:
 *   previewQboFullExportObservationCountHistoricalApplyPlan()
 *
 * Safety:
 *   - NO production workbook writes.
 *   - NO locks / workbook write lease.
 *   - NO trigger mutation.
 *   - Uses only the completed frozen preview candidates/results.
 *   - Does not refreeze or reopen MasterBackups.
 *   - Does not create missing 01 sources.
 */
const QBO_FE_OBS_HIST_APPLY_PLAN_ = Object.freeze({
  VERSION: '1.5.150',
  PREVIEW_STATE_KEY: 'QBO_FE_OBS_HIST_PREVIEW_V148_STATE',
  PREVIEW_RESULT_PREFIX: 'QBO_FE_OBS_HIST_PREVIEW_V148_RESULT_',
  STRANDED_RUN_IDS: Object.freeze([
    '9ff6e204-18d8-4f81-b965-7749429886b3'
  ])
});

function previewQboFullExportObservationCountHistoricalApplyPlan() {
  const C = QBO_FE_OBS_HIST_APPLY_PLAN_;
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(C.PREVIEW_STATE_KEY);
  if (!raw) throw new Error('Completed historical preview state not found.');

  const state = JSON.parse(raw);
  if (state.status !== 'COMPLETE') {
    throw new Error('Historical preview must be COMPLETE. Current status=' + state.status);
  }
  if (Number(state.processedCount) !== Number(state.candidateCount)) {
    throw new Error('Historical preview is not fully processed.');
  }

  const plan = {
    version: C.VERSION,
    operation: 'READ_ONLY_HISTORICAL_OBSERVATIONCOUNT_APPLY_PLAN',
    sourcePreview: {
      previewRunId: state.previewRunId,
      frozenAt: state.frozenAt,
      frozenCandidateCount: Number(state.candidateCount),
      processedCount: Number(state.processedCount)
    },
    counts: {
      historyWrites: 0,
      sourceWrites: 0,
      historyAlreadyMatches: 0,
      sourceAlreadyMatches: 0,
      controlledTestExcludedSourceCreates: 0,
      strandedRunExcludedSourceCreates: 0,
      otherMissingSourceCreatesBlocked: 0,
      blockedOrMismatch: 0
    },
    historyWrites: [],
    sourceWrites: [],
    alreadyMatches: [],
    excludedMissingSources: [],
    blocked: [],
    safety: {
      productionWritesPerformed: false,
      locksAcquired: false,
      workbookWriteLeaseAcquired: false,
      triggerMutationPerformed: false,
      missingSourceCreationAllowed: false
    }
  };

  for (let i = 0; i < Number(state.processedCount); i++) {
    const rr = props.getProperty(C.PREVIEW_RESULT_PREFIX + state.previewRunId + '_' + i);
    if (!rr) {
      plan.counts.blockedOrMismatch++;
      plan.blocked.push({candidateIndex:i, reason:'MISSING_FROZEN_RESULT'});
      continue;
    }
    const r = JSON.parse(rr);

    // Any derivation/evidence failure or existing mismatch blocks apply.
    const hardFindings = (r.findings || []).filter(function(f) {
      return f.type !== 'SOURCE_MISSING';
    });
    if (hardFindings.length ||
        r.historyDisposition === 'EXISTING_MISMATCH' ||
        r.sourceDisposition === 'EXISTING_MISMATCH' ||
        r.historyDisposition === 'BLOCKED' ||
        r.sourceDisposition === 'BLOCKED') {
      plan.counts.blockedOrMismatch++;
      plan.blocked.push({
        candidateIndex:i, kind:r.kind, runId:r.runId || '', exportKey:r.exportKey,
        sourceId:r.sourceId || '', findings:r.findings || [],
        historyDisposition:r.historyDisposition,
        sourceDisposition:r.sourceDisposition
      });
      continue;
    }

    if (r.historyDisposition === 'PROPOSE_WRITE') {
      plan.counts.historyWrites++;
      plan.historyWrites.push({
        candidateIndex:i,
        historyRow:r.historyRow,
        runId:r.runId,
        exportKey:r.exportKey,
        masterBackupFileId:r.masterBackupFileId,
        masterBackupFileName:r.masterBackupFileName,
        entitySheetName:r.entitySheetName,
        observationCount:r.derivedObservationCount
      });
    } else if (r.historyDisposition === 'ALREADY_MATCHES') {
      plan.counts.historyAlreadyMatches++;
      plan.alreadyMatches.push({
        authority:'QBO_ExportRunHistory',
        candidateIndex:i, row:r.historyRow, runId:r.runId,
        exportKey:r.exportKey, observationCount:r.derivedObservationCount
      });
    }

    if (r.sourceDisposition === 'PROPOSE_WRITE') {
      plan.counts.sourceWrites++;
      plan.sourceWrites.push({
        candidateIndex:i,
        sourceRow:r.sourceRow,
        sourceId:r.sourceId,
        runId:r.runId || '',
        exportKey:r.exportKey,
        masterBackupFileId:r.masterBackupFileId,
        masterBackupFileName:r.masterBackupFileName,
        entitySheetName:r.entitySheetName,
        observationCount:r.derivedObservationCount,
        authority:
          r.kind === 'FULL_EXPORT_LEGACY'
            ? 'HISTORICAL_EXCEPTION_MASTERBACKUP'
            : 'RECONCILED_EXACT_RUN_HISTORY'
      });
    } else if (r.sourceDisposition === 'ALREADY_MATCHES') {
      plan.counts.sourceAlreadyMatches++;
      plan.alreadyMatches.push({
        authority:'01_Sources',
        candidateIndex:i, row:r.sourceRow, sourceId:r.sourceId,
        exportKey:r.exportKey, observationCount:r.derivedObservationCount
      });
    } else if (r.sourceDisposition === 'SOURCE_MISSING') {
      const cls = qboFeObsHistApplyPlanClassifyMissingSource_(r);
      if (cls === 'CONTROLLED_TEST_SOURCE_MISSING') {
        plan.counts.controlledTestExcludedSourceCreates++;
      } else if (cls === 'STRANDED_RUN_SOURCE_MISSING_ELIGIBILITY_REVIEW_REQUIRED') {
        plan.counts.strandedRunExcludedSourceCreates++;
      } else {
        plan.counts.otherMissingSourceCreatesBlocked++;
      }
      plan.excludedMissingSources.push({
        candidateIndex:i,
        classification:cls,
        runId:r.runId || '',
        exportKey:r.exportKey,
        sourceId:r.sourceId || '',
        historyRow:r.historyRow || null,
        observationCount:r.derivedObservationCount,
        sourceCreateProposed:false
      });
    }
  }

  plan.validForControlledApply =
    plan.counts.blockedOrMismatch === 0 &&
    plan.counts.otherMissingSourceCreatesBlocked === 0 &&
    plan.sourcePreview.frozenCandidateCount ===
      plan.counts.historyWrites +
      plan.counts.historyAlreadyMatches; // all frozen candidates are run-history candidates in current preview

  // The previous invariant is intentionally strict. If FULL_EXPORT_LEGACY exists,
  // validate coverage by candidate indexes instead.
  const covered = {};
  plan.historyWrites.forEach(function(x){covered[x.candidateIndex]=true;});
  plan.sourceWrites.forEach(function(x){covered[x.candidateIndex]=true;});
  plan.alreadyMatches.forEach(function(x){covered[x.candidateIndex]=true;});
  plan.excludedMissingSources.forEach(function(x){covered[x.candidateIndex]=true;});
  plan.blocked.forEach(function(x){covered[x.candidateIndex]=true;});
  plan.coveredCandidateCount = Object.keys(covered).length;
  plan.validForControlledApply =
    plan.counts.blockedOrMismatch === 0 &&
    plan.counts.otherMissingSourceCreatesBlocked === 0 &&
    plan.coveredCandidateCount === plan.sourcePreview.frozenCandidateCount;

  console.log(JSON.stringify(plan, null, 2));
  return plan;
}

function qboFeObsHistApplyPlanClassifyMissingSource_(r) {
  const runId = String(r.runId || '');
  if (runId.indexOf('STATE_CAPTURE_AUTOREG_TEST_') === 0) {
    return 'CONTROLLED_TEST_SOURCE_MISSING';
  }
  if (QBO_FE_OBS_HIST_APPLY_PLAN_.STRANDED_RUN_IDS.indexOf(runId) >= 0) {
    return 'STRANDED_RUN_SOURCE_MISSING_ELIGIBILITY_REVIEW_REQUIRED';
  }
  return 'UNCLASSIFIED_MISSING_SOURCE_BLOCKED';
}
