/** v1.5.245 diagnostic only. Read-only inspection of halted V1244 prospective evidence. */
function inspectQboNativeCdcRawReadbackV1245() {
  const c=QBO_CDC_PROSPECTIVE_V1244_;
  const ctx=qboCdcProspectiveStateV1244_();
  const s=ctx.state, a=s.active;
  if (!a) throw Error('V1245_NO_ACTIVE_CYCLE');
  const folder=DriveApp.getFolderById(a.folderId);
  const entity=c.ENTITIES[a.cursor];
  const expectedName='cdc_'+entity+'.json';
  const iterator=folder.getFilesByName(expectedName);
  const matches=[];
  while(iterator.hasNext()) {
    const f=iterator.next(), raw=f.getBlob().getDataAsString('UTF-8');
    let parsed=null, parseError=null, identity=null, responseCheck=null;
    try { parsed=JSON.parse(raw); } catch(e) { parseError=String(e.message||e); }
    if(parsed) {
      identity={version:parsed.version,cycleId:parsed.cycleId,entity:parsed.entity,changedSince:parsed.changedSince,requestStartedAt:parsed.requestStartedAt,requestCompletedAt:parsed.requestCompletedAt};
      try { responseCheck=qboCdcProspectiveValidateV1244_(parsed,a,entity); }
      catch(e) { responseCheck={error:String(e.message||e)}; }
    }
    matches.push({fileId:f.getId(),name:f.getName(),sizeBytes:f.getSize(),createdAt:f.getDateCreated().toISOString(),updatedAt:f.getLastUpdated().toISOString(),rawLength:raw.length,sha256:qboNativeCdcSha256_(raw),parseError:parseError,identity:identity,responseCheck:responseCheck});
  }
  const out={version:'1.5.245',mode:'READ_ONLY',checkpointStatus:s.status,enabled:s.enabled,prospectiveWatermark:s.prospectiveWatermark,cycleId:a.cycleId,changedSince:a.changedSince,windowEnd:a.windowEnd,cursor:a.cursor,completedResults:a.results.length,nextEntity:entity,expectedFileName:expectedName,matchingFileCount:matches.length,matchingFiles:matches,previousResult:a.cursor?a.results[a.cursor-1]:null,lastCommitted:s.lastCommitted,existingError:s.error};
  console.log('[NATIVE CDC RAW READBACK V1245] | READ_ONLY | '+JSON.stringify(out));
  return out;
}
