/** Tests for the typed persistence contract added in v1.5.209 / v0.5.361. */
function testQboSalesTaxTypedWriterContractsV05361() {
  const checks = [];
  function check(name, passed) { checks.push({name:name, passed:!!passed}); }
  function formatRecorder() {
    const calls = [];
    return {
      calls: calls,
      getRange: function(row, col, rows, cols) {
        return {setNumberFormat:function(pattern){calls.push({row:row,col:col,rows:rows,cols:cols,pattern:pattern});}};
      }
    };
  }

  const recognition = formatRecorder();
  qboStrApplyTypedFormats_(recognition, QBO_STR_HEADERS, 2, 3);
  check('recognition period is formatted as text', recognition.calls.some(function(x){return x.col===1&&x.pattern==='@';}));
  check('recognition timestamps use date-time format', recognition.calls.some(function(x){return x.col===4&&x.pattern==='yyyy-mm-dd hh:mm:ss';}) && recognition.calls.some(function(x){return x.col===7&&x.pattern==='yyyy-mm-dd hh:mm:ss';}));
  check('recognition calendar dates use date format', recognition.calls.some(function(x){return x.col===10&&x.pattern==='yyyy-mm-dd';}));

  const tsd = formatRecorder();
  qboTsdApplyTypedFormats_(tsd, QBO_TSD_DETAIL_HEADERS, 2, 3);
  check('TSD period is formatted as text', tsd.calls.some(function(x){return x.col===1&&x.pattern==='@';}));
  check('TSD report as-of uses date-time format', tsd.calls.some(function(x){return x.col===4&&x.pattern==='yyyy-mm-dd hh:mm:ss';}));
  check('TSD calendar dates use date format', tsd.calls.some(function(x){return x.col===5&&x.pattern==='yyyy-mm-dd';}) && tsd.calls.some(function(x){return x.col===14&&x.pattern==='yyyy-mm-dd';}));

  const writes = [];
  const sh = {
    getLastRow:function(){return 1;},
    clearContents:function(){},
    setFrozenRows:function(){},
    getRange:function(row,col,rows,cols){
      return {
        setValues:function(values){writes.push({row:row,values:values});},
        setFontWeight:function(){},
        setNumberFormat:function(){},
        setWrapStrategy:function(){}
      };
    }
  };
  const snapshotRow = new Array(QBO_STR_HEADERS.length).fill('');
  snapshotRow[0]='202609'; snapshotRow[1]=8; snapshotRow[2]='recognition-run-exact';
  qboStrReplaceCurrent_({getSheetByName:function(){return sh;}}, '202609', [snapshotRow]);
  const currentWrite = writes.filter(function(x){return x.row===2;})[0];
  check('current recognition retains snapshot sequence and run ID', !!currentWrite && currentWrite.values[0][1]===8 && currentWrite.values[0][2]==='recognition-run-exact');

  const passed = checks.every(function(x){return x.passed;});
  const out = {Version:'0.5.361',Status:passed?'PASS':'FAIL',Test_Count:checks.length,Passed:checks.filter(function(x){return x.passed;}).length,Checks:checks,Writes_Performed:0,V3_Activated:false};
  safeLog_('[SALES TAX TYPED WRITER TESTS] '+JSON.stringify(out));
  if(!passed) throw new Error('Sales tax typed writer contract tests failed.');
  return out;
}
