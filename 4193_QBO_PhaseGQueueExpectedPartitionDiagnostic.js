/** v1.5.247. Read-only diagnosis of v1245 expected partition guard. */
function inspectQboPhaseGQueueExpectedPartitionV1247(){return qboPhaseG1245Lock_(function(){
 const ctx=qboPhaseG1245Read_(),s=ctx.state; qboPhaseG1245Frozen_(s);qboPhaseG1245Inventory_(s);
 if(s.status!=='COMPARE_PARTITIONS'||s.candidateCursor!==683||s.rowCount!==329653||s.partitionCursor!==0||s.error!=='V1245_EXPECTED_PARTITION_INVALID'||s.metadata.length!==683)throw Error('V1247_DIAGNOSTIC_BOUNDARY_CHANGED');
 const part=s.partitionCursor,count=s.partitionCounts[part],offset=s.partitionCounts.slice(0,part).reduce((a,b)=>a+b,0),sh=SpreadsheetApp.openById(s.workbookId).getSheetByName('Candidate_Rows');
 if(!sh||!Number.isInteger(count)||count<0)throw Error('V1247_PRIVATE_SHEET_OR_COUNT_INVALID');
 const header=sh.getRange(1,1,1,4).getValues()[0],rows=count?sh.getRange(offset+2,1,count,4).getValues():[],seen=Object.create(null),duplicates=[],invalid=[],counts={wrongPartition:0,invalidCandidateIndex:0,missingCandidateMetadata:0,duplicateObservationIdOccurrences:0,blankObservationIds:0,invalidRowJSON:0,rowObservationIdMismatch:0};
 const describe=function(r,index){const idx=Number(r[1]),m=Number.isInteger(idx)?s.metadata[idx]:null;return {sheetRow:offset+index+2,partitionCell:r[0],partitionCellType:typeof r[0],candidateIndexCell:r[1],candidateIndexCellType:typeof r[1],observationId:String(r[2]),manifestId:m?m.id:null,manifestBase:m?m.base:null,rowJSON:String(r[3])};};
 rows.forEach(function(r,i){const idx=Number(r[1]),id=String(r[2]),reasons=[];
  if(Number(r[0])!==part){counts.wrongPartition++;reasons.push('WRONG_PARTITION');}
  if(!Number.isInteger(idx)){counts.invalidCandidateIndex++;reasons.push('INVALID_CANDIDATE_INDEX');}
  if(!s.metadata[idx]){counts.missingCandidateMetadata++;reasons.push('MISSING_CANDIDATE_METADATA');}
  if(!id){counts.blankObservationIds++;reasons.push('BLANK_OBSERVATION_ID');}
  let parsed;try{parsed=JSON.parse(String(r[3]));if(!Array.isArray(parsed)||parsed.length!==10){counts.invalidRowJSON++;reasons.push('INVALID_ROW_JSON_SHAPE');}else if(String(parsed[3])!==id){counts.rowObservationIdMismatch++;reasons.push('ROW_OBSERVATION_ID_MISMATCH');}}catch(e){counts.invalidRowJSON++;reasons.push('INVALID_ROW_JSON');}
  if(Object.prototype.hasOwnProperty.call(seen,id)){counts.duplicateObservationIdOccurrences++;if(duplicates.length<8){const prior=seen[id];duplicates.push({observationId:id,sameRowJSON:String(prior.row[3])===String(r[3]),sameCandidateIndex:Number(prior.row[1])===idx,first:describe(prior.row,prior.index),repeat:describe(r,i)});}}else seen[id]={row:r,index:i};
  if(reasons.length&&invalid.length<8)invalid.push({reasons:reasons,row:describe(r,i)});
 });
 // Verify a bounded sample directly against immutable source triplets, without editing expected rows.
 const requested=[];duplicates.forEach(d=>{requested.push(d.first,d.repeat);});invalid.forEach(x=>requested.push(x.row));const checked=Object.create(null),sourceChecks=[];
 requested.forEach(function(item){if(!item.manifestId||checked[item.manifestId]||sourceChecks.length>=4)return;checked[item.manifestId]=true;const m=s.metadata.find(x=>x.id===item.manifestId),source=qboPhaseG1245Source_(m.id,m.base),bucket=source.buckets[part]||[],ids=requested.filter(x=>x.manifestId===m.id).map(x=>x.observationId),uniqueIds=Array.from(new Set(ids));
  sourceChecks.push({manifestId:m.id,manifestBase:m.base,shardHashMatchesAudit:source.shardHash===m.shardHash,admissionCountsMatchAudit:JSON.stringify(source.delta)===JSON.stringify(m.delta),rowsForSampleIds:uniqueIds.map(id=>({observationId:id,sourceOccurrences:bucket.filter(row=>String(row[3])===id).length,expectedSampleMatchesSource:requested.filter(x=>x.manifestId===m.id&&x.observationId===id).every(x=>bucket.some(row=>JSON.stringify(row)===x.rowJSON))}))});
 });
 qboPhaseG1245Frozen_(s);const out={version:'1.5.247',mode:'READ_ONLY',status:s.status,privateAuditWorkbookId:s.workbookId,partition:part,expectedPartitionRows:count,privateSheetLastRow:sh.getLastRow(),header:header,counts:counts,invalidSamples:invalid,duplicateSamples:duplicates,sourceChecks:sourceChecks,globalCheckpointModified:false,auditCheckpointModified:false,partitionRowsModified:false,ingestionAuthorized:false};
 // Split samples into bounded log entries to avoid truncating the diagnostic summary.
 qboPhaseG1245Log_('EXPECTED_PARTITION_DIAGNOSTIC',{version:out.version,mode:out.mode,privateAuditWorkbookId:out.privateAuditWorkbookId,partition:part,expectedPartitionRows:count,privateSheetLastRow:out.privateSheetLastRow,header:header,counts:counts,duplicateSampleCount:duplicates.length,invalidSampleCount:invalid.length,globalCheckpointModified:false,auditCheckpointModified:false});
 invalid.forEach(x=>qboPhaseG1245Log_('INVALID_EXPECTED_ROW',x));duplicates.forEach(x=>qboPhaseG1245Log_('DUPLICATE_EXPECTED_ID',x));sourceChecks.forEach(x=>qboPhaseG1245Log_('SOURCE_SAMPLE_CHECK',x));return out;
 });}
