/** ============================================================================
 * Application : 50 QBO Import Hub
 * Module      : 28_FailurePathRegression.js
 * Purpose     : Deterministically regression-test scheduler recovery decisions
 *               without calling QBO or mutating production run history.
 *
 * Public API:
 *   - testQboFailurePathRegression()
 *
 * Architecture Notes:
 *   - Tests are pure/in-memory. No workbooks, Drive folders, triggers, OAuth,
 *     QBO requests, or properties are read or written.
 *   - Apps Script platform INTERNAL terminations cannot be deliberately caught
 *     or reproduced by JavaScript. The regression instead validates the
 *     durable state decisions used after such a termination.
 *
 * Change History:
 *   - 2026-09-12: Added scheduler lease-retry and stale-worker regression cases.
 *   - 2026-09-03: Added Objective 19 failure-path regression suite.
 * ============================================================================
 */

function testQboFailurePathRegression() {
  const tests = [
    testQboRegression_CaughtErrorResumesFailedExporter_,
    testQboRegression_InterruptedAttemptResumesSameExporter_,
    testQboRegression_RetryCompleteSupersedesInterrupted_,
    testQboRegression_AllCompleteHasNoResumePoint_,
    testQboRegression_InterruptionCanUpdateMatchingRunningStatus_,
    testQboRegression_InterruptionPreservesNewerCompleteStatus_,
    testQboRegression_InterruptionPreservesDifferentRunStatus_,
    testQboRegression_InterruptionPreservesDifferentAttempt_,
    testQboRegression_WriteLeaseBusyIsRetryable_,
    testQboRegression_GenericErrorIsTerminal_,
    testQboRegression_ActiveWorkerNotStaleBeforeThreshold_,
    testQboRegression_ActiveWorkerStaleAtThreshold_
  ];

  const failures = [];

  tests.forEach(function(testFunction) {
    try {
      testFunction();
      console.log(
        '[FAILURE REGRESSION] | PASS | test=' + testFunction.name
      );
    } catch (error) {
      failures.push(
        testFunction.name + ': ' +
        (error && error.message ? error.message : String(error))
      );
      console.error(
        '[FAILURE REGRESSION] | FAIL | test=' + testFunction.name +
        ' | error=' + failures[failures.length - 1]
      );
    }
  });

  if (failures.length > 0) {
    throw new Error(
      'QBO failure-path regression failed ' + failures.length +
      '/' + tests.length + ' test(s): ' + failures.join(' || ')
    );
  }

  console.log(
    '[FAILURE REGRESSION] | COMPLETE | passed=' +
    tests.length + '/' + tests.length
  );

  return {
    passed: tests.length,
    total: tests.length
  };
}


function testQboRegression_CaughtErrorResumesFailedExporter_() {
  const order = ['A', 'B', 'C'];
  const rows = [
    qboRegressionExportRow_('run-1', 'A', 'COMPLETE'),
    qboRegressionExportRow_('run-1', 'B', 'ERROR')
  ];

  const state = buildQboScheduledRunResumeState_(
    'run-1',
    '2026-09-03T00:00:00.000Z',
    rows,
    order
  );

  assertQboRegressionEqual_(state.resumeIndex, 1, 'caught error resumeIndex');
  assertQboRegressionEqual_(state.completedCount, 1, 'caught error completedCount');
  assertQboRegressionEqual_(state.failedCount, 0, 'caught error failedCount before resume point');
}


function testQboRegression_InterruptedAttemptResumesSameExporter_() {
  const order = ['A', 'B', 'C'];
  const rows = [
    qboRegressionExportRow_('run-2', 'A', 'COMPLETE'),
    qboRegressionExportRow_('run-2', 'B', 'INTERRUPTED')
  ];

  const state = buildQboScheduledRunResumeState_(
    'run-2',
    '2026-09-03T00:00:00.000Z',
    rows,
    order
  );

  assertQboRegressionEqual_(state.resumeIndex, 1, 'interrupted resumeIndex');
  assertQboRegressionEqual_(state.completedCount, 1, 'interrupted completedCount');
}


function testQboRegression_RetryCompleteSupersedesInterrupted_() {
  const order = ['A', 'B', 'C'];
  const rows = [
    qboRegressionExportRow_('run-3', 'A', 'COMPLETE'),
    qboRegressionExportRow_('run-3', 'B', 'INTERRUPTED'),
    qboRegressionExportRow_('run-3', 'B', 'COMPLETE')
  ];

  const state = buildQboScheduledRunResumeState_(
    'run-3',
    '2026-09-03T00:00:00.000Z',
    rows,
    order
  );

  assertQboRegressionEqual_(state.resumeIndex, 2, 'retry-complete resumeIndex');
  assertQboRegressionEqual_(state.completedCount, 2, 'retry-complete completedCount');
}


function testQboRegression_AllCompleteHasNoResumePoint_() {
  const order = ['A', 'B'];
  const rows = [
    qboRegressionExportRow_('run-4', 'A', 'COMPLETE'),
    qboRegressionExportRow_('run-4', 'B', 'COMPLETE')
  ];

  const state = buildQboScheduledRunResumeState_(
    'run-4',
    '2026-09-03T00:00:00.000Z',
    rows,
    order
  );

  assertQboRegressionEqual_(state.resumeIndex, 2, 'all-complete resumeIndex');
  assertQboRegressionEqual_(state.completedCount, 2, 'all-complete completedCount');
}


function testQboRegression_InterruptionCanUpdateMatchingRunningStatus_() {
  const startedAt = new Date('2026-09-03T01:00:00.000Z');
  const statusRow = qboRegressionStatusRow_(
    'A',
    'run-5',
    startedAt,
    'RUNNING'
  );

  assertQboRegressionEqual_(
    shouldUpdateQboInterruptedLatestStatus_(statusRow, 'run-5', startedAt),
    true,
    'matching RUNNING status'
  );
}


function testQboRegression_InterruptionPreservesNewerCompleteStatus_() {
  const startedAt = new Date('2026-09-03T01:00:00.000Z');
  const statusRow = qboRegressionStatusRow_(
    'A',
    'run-6',
    new Date('2026-09-03T01:05:00.000Z'),
    'COMPLETE'
  );

  assertQboRegressionEqual_(
    shouldUpdateQboInterruptedLatestStatus_(statusRow, 'run-6', startedAt),
    false,
    'newer COMPLETE status'
  );
}


function testQboRegression_InterruptionPreservesDifferentRunStatus_() {
  const startedAt = new Date('2026-09-03T01:00:00.000Z');
  const statusRow = qboRegressionStatusRow_(
    'A',
    'newer-run',
    startedAt,
    'RUNNING'
  );

  assertQboRegressionEqual_(
    shouldUpdateQboInterruptedLatestStatus_(statusRow, 'older-run', startedAt),
    false,
    'different run status'
  );
}


function testQboRegression_InterruptionPreservesDifferentAttempt_() {
  const oldStartedAt = new Date('2026-09-03T01:00:00.000Z');
  const retryStartedAt = new Date('2026-09-03T01:10:00.000Z');
  const statusRow = qboRegressionStatusRow_(
    'A',
    'run-7',
    retryStartedAt,
    'RUNNING'
  );

  assertQboRegressionEqual_(
    shouldUpdateQboInterruptedLatestStatus_(statusRow, 'run-7', oldStartedAt),
    false,
    'different RUNNING retry attempt'
  );
}


function testQboRegression_WriteLeaseBusyIsRetryable_() {
  const error = new Error('lease busy');
  error.code = 'QBO_WRITE_LEASE_BUSY';
  assertQboRegressionEqual_(
    isRetryableQboSchedulerError_(error),
    true,
    'write lease busy retryability'
  );
}


function testQboRegression_GenericErrorIsTerminal_() {
  assertQboRegressionEqual_(
    isRetryableQboSchedulerError_(new Error('generic failure')),
    false,
    'generic error retryability'
  );
}


function testQboRegression_ActiveWorkerNotStaleBeforeThreshold_() {
  const now = 1000000;
  const activeState = {
    startedAtMs: now - DAILY_EXPORT_SCHEDULE.WORKER_STALE_MS + 1
  };
  assertQboRegressionEqual_(
    isDailyQboWorkerStateStaleAt_(activeState, now),
    false,
    'worker before stale threshold'
  );
}


function testQboRegression_ActiveWorkerStaleAtThreshold_() {
  const now = 1000000;
  const activeState = {
    startedAtMs: now - DAILY_EXPORT_SCHEDULE.WORKER_STALE_MS
  };
  assertQboRegressionEqual_(
    isDailyQboWorkerStateStaleAt_(activeState, now),
    true,
    'worker at stale threshold'
  );
}

function qboRegressionExportRow_(runId, key, status) {
  return [
    runId,
    1,
    key,
    'exportQboRegression',
    new Date('2026-09-03T00:00:00.000Z'),
    '',
    status,
    '',
    ''
  ];
}


function qboRegressionStatusRow_(key, runId, startedAt, status) {
  return [
    key,
    'exportQboRegression',
    runId,
    startedAt,
    '',
    status,
    '',
    ''
  ];
}


function assertQboRegressionEqual_(actual, expected, label) {
  if (actual !== expected) {
    throw new Error(
      label + ' expected=' + expected + ' actual=' + actual
    );
  }
}
