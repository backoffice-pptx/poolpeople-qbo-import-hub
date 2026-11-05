/**
 * V1299 — opt-in, isolated Google Sheets write integration test.
 * Creates ONE new standalone workbook; does not touch QBO or export destinations.
 * The workbook is retained as evidence and its ID logged.
 * Does not modify daily scheduler state or invoke exporters.
 */
function runQboIsolatedWriteIntegrationV1299() {
  const version = '1.5.299';
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty('QBO_DAILY_EXPORT_ACTIVE_TOKEN')) {
    throw new Error('V1299_REFUSE_ACTIVE_DAILY_CLAIM');
  }
  if (typeof QBO_V1297_ACTIVE_CONTEXT_ === 'undefined') {
    throw new Error('V1299_MISSING_V1297_CONTEXT');
  }
  if (QBO_V1297_ACTIVE_CONTEXT_ !== null) {
    throw new Error('V1299_REFUSE_ACTIVE_INVOCATION_CONTEXT');
  }
  const title = 'App50 V1299 Isolated Write Test ' + new Date().toISOString();
  const book = SpreadsheetApp.create(title);
  const workbookId = book.getId();
  const sheet = book.getSheets()[0];
  sheet.setName('V1299_Test');
  const leaseKey = buildExportWriteLeasePropertyKey_(workbookId);
  let checks = 0;
  const assert = function(value, name) {
    if (!value) throw new Error('V1299_ASSERT_FAILED_' + name);
    checks++;
  };
  try {
    const result = withExportWriteLock_('V1299_Test', workbookId, function(assertBoundary) {
      assertBoundary('v1299_before_header');
      sheet.getRange(1, 1, 1, 3).setValues([['Test', 'Version', 'Status']]);
      assertBoundary('v1299_before_data');
      sheet.getRange(2, 1, 1, 3).setValues([['ISOLATED_WRITE', version, 'PASS']]);
      SpreadsheetApp.flush();
      assertBoundary('v1299_after_flush');
      const lease = JSON.parse(props.getProperty(leaseKey) || 'null');
      assert(!!lease && !!lease.token, 'LEASE_EXISTS_IN_CALLBACK');
      assert(qboV1298Decision_(null, null, lease, lease.token) === 'MANUAL_EXPORT_LEASE_ONLY', 'MANUAL_LEASE_DECISION');
      assert(qboV1298Decision_(null, null, lease, 'invalid-token') === 'BLOCK_LEASE', 'INVALID_TOKEN_REJECTED');
      return sheet.getRange(2, 1, 1, 3).getValues()[0];
    });
    assert(result[0] === 'ISOLATED_WRITE' && result[1] === version && result[2] === 'PASS', 'DATA_READBACK');
    assert(!props.getProperty(leaseKey), 'LEASE_RELEASED');
    const output = {version:version,status:'PASS',checksPassed:checks,
      isolatedWorkbookId:workbookId,isolatedWorkbookUrl:book.getUrl(),
      schedulerMutations:0,qboApiCalls:0,productionExportWrites:0,
      scheduledWorkerWriteTested:false,automaticRecoveryEnabled:false};
    console.log('[DAILY V1299] | ISOLATED WRITE PASS | ' + JSON.stringify(output));
    return output;
  } catch (error) {
    console.error('[DAILY V1299] | ISOLATED WRITE FAILED | ' + JSON.stringify({
      version:version,isolatedWorkbookId:workbookId,
      isolatedWorkbookUrl:book.getUrl(),error:String(error && error.message || error),
      leaseKey:leaseKey,leasePresent:!!props.getProperty(leaseKey)}));
    throw error;
  }
}
function previewQboIsolatedWriteIntegrationV1299() {
  const p = PropertiesService.getScriptProperties();
  const x = {version:'1.5.299',readOnly:true,
    activeClaimPresent:!!p.getProperty('QBO_DAILY_EXPORT_ACTIVE_TOKEN'),
    invocationContextPresent:typeof QBO_V1297_ACTIVE_CONTEXT_ !== 'undefined' && QBO_V1297_ACTIVE_CONTEXT_ !== null,
    isolatedWorkbookCreated:false,productionExportWrites:0,
    automaticRecoveryEnabled:false};
  console.log('[DAILY V1299] | READ_ONLY | '+JSON.stringify(x));
  return x;
}
