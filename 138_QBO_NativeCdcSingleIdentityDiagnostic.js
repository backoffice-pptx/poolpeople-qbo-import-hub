/**
 * App 50 | v1.5.116 | READ ONLY
 * Isolates the single modern 03 NativeCdcEventId discrepancy.
 */
const QBO_NCDC_ID116={VERSION:"QBO_NATIVE_CDC_SINGLE_IDENTITY_DIAGNOSTIC_V1_5_116",SS:"1JQ3s7fbOvSySmXVx5LuZhDogN2eMFekNAlU5Q6Tx4x0",SHEET:"03_Native_CDC_Events_V2"};

function auditQboNativeCdcSingleIdentityDiscrepancy(){
  const candidate=previewQboNativeCdcHistoricalReconstructionV2();
  const ss=SpreadsheetApp.openById(QBO_NCDC_ID116.SS);
  const existing=qboNcdc116Read_(ss,QBO_NCDC_ID116.SHEET);
  const modern=(candidate.observations||[]).filter(r=>String(r.SourceId||"").split("|").length===4);
  const ei={},ci={}; existing.forEach(r=>ei[String(r.NativeCdcEventId||"")]=1);
  modern.forEach(r=>ci[String(r.NativeCdcEventId||"")]=1);
  const eo=existing.filter(r=>!ci[String(r.NativeCdcEventId||"")]);
  const co=modern.filter(r=>!ei[String(r.NativeCdcEventId||"")]);
  const findings=[];
  if(eo.length!==1)findings.push({code:"EXPECTED_ONE_EXISTING_ONLY",actual:eo.length});
  if(co.length!==1)findings.push({code:"EXPECTED_ONE_CANDIDATE_ONLY",actual:co.length});
  const er=eo[0]||null, cr=co[0]||null;
  const comp=er&&cr?qboNcdc116Compare_(er,cr):null;
  const evidence=[];
  [er,cr].forEach((r,i)=>{
    if(!r||!r.EvidenceFileId)return;
    try{
      const f=DriveApp.getFileById(String(r.EvidenceFileId)), blob=f.getBlob();
      const obj=JSON.parse(blob.getDataAsString("UTF-8"));
      evidence.push({side:i?"CANDIDATE":"EXISTING",fileId:f.getId(),fileName:f.getName(),
        sha256:qboNcdc116Hash_(blob.getBytes()),topLevelTime:String(obj.time||""),
        target:qboNcdc116Find_(obj,String(r.EntityType||""),String(r.EntityId||""))});
    }catch(e){findings.push({code:"EVIDENCE_READ_ERROR",side:i?"CANDIDATE":"EXISTING",error:String(e)});}
  });
  const summary={version:QBO_NCDC_ID116.VERSION,status:findings.length?"ACTION_REQUIRED":"PAIR_ISOLATED",
    readOnly:true,existing03Count:existing.length,modernCandidateCount:modern.length,
    existingOnlyCount:eo.length,candidateOnlyModernCount:co.length,
    sameSourceId:comp?comp.sameSourceId:false,sameEntityType:comp?comp.sameEntityType:false,
    sameEntityId:comp?comp.sameEntityId:false,sameOperation:comp?comp.sameOperation:false,
    sameEvidenceFileId:comp?comp.sameEvidenceFileId:false,sameEvidenceHash:comp?comp.sameEvidenceHash:false,
    findingCount:findings.length,controls:{writes:false}};
  console.log("[NCDC SINGLE ID 1.5.116] | SUMMARY | "+JSON.stringify(summary));
  console.log("[NCDC SINGLE ID 1.5.116] | EXISTING ONLY | "+JSON.stringify(er));
  console.log("[NCDC SINGLE ID 1.5.116] | CANDIDATE ONLY | "+JSON.stringify(cr));
  console.log("[NCDC SINGLE ID 1.5.116] | FIELD COMPARISON | "+JSON.stringify(comp));
  console.log("[NCDC SINGLE ID 1.5.116] | SOURCE EVIDENCE | "+JSON.stringify(evidence));
  console.log("[NCDC SINGLE ID 1.5.116] | FINDINGS | "+JSON.stringify(findings));
  return {summary:summary,existingOnly:er,candidateOnly:cr,comparison:comp,evidence:evidence,findings:findings};
}
function qboNcdc116Compare_(a,b){
  const ks={};Object.keys(a).forEach(k=>ks[k]=1);Object.keys(b).forEach(k=>ks[k]=1);
  const d=[];Object.keys(ks).sort().forEach(k=>{const x=qboNcdc116Norm_(a[k]),y=qboNcdc116Norm_(b[k]);if(x!==y)d.push({field:k,existing:x,candidate:y});});
  return {sameSourceId:qboNcdc116Norm_(a.SourceId)===qboNcdc116Norm_(b.SourceId),
    sameEntityType:qboNcdc116Norm_(a.EntityType)===qboNcdc116Norm_(b.EntityType),
    sameEntityId:qboNcdc116Norm_(a.EntityId)===qboNcdc116Norm_(b.EntityId),
    sameOperation:qboNcdc116Norm_(a.Operation)===qboNcdc116Norm_(b.Operation),
    sameEvidenceFileId:qboNcdc116Norm_(a.EvidenceFileId)===qboNcdc116Norm_(b.EvidenceFileId),
    sameEvidenceHash:qboNcdc116Norm_(a.EvidenceHash)===qboNcdc116Norm_(b.EvidenceHash),
    differenceCount:d.length,differences:d};
}
function qboNcdc116Find_(o,t,id){
  const hits=[];(o.CDCResponse||[]).forEach((b,bi)=>(b.QueryResponse||[]).forEach((q,qi)=>Object.keys(q||{}).forEach(k=>{
    if(!Array.isArray(q[k]))return;q[k].forEach((e,ix)=>{if(k===t&&String(e&&(e.Id||e.id)||"")===id)hits.push({blockIndex:bi,queryResponseIndex:qi,entityArrayIndex:ix,entityType:k,status:String(q.status||q.Status||""),entity:e});});
  })));return hits;
}
function qboNcdc116Read_(ss,n){const s=ss.getSheetByName(n);if(!s||s.getLastRow()<2)return[];const v=s.getRange(1,1,s.getLastRow(),s.getLastColumn()).getValues(),h=v[0].map(x=>String(x||"").trim());return v.slice(1).filter(r=>r.some(x=>String(x==null?"":x).trim()!=="")).map(r=>{const o={};h.forEach((k,i)=>{if(k)o[k]=r[i]});return o});}
function qboNcdc116Norm_(v){return v instanceof Date?v.toISOString():(v==null?"":String(v));}
function qboNcdc116Hash_(b){return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256,b).map(x=>("0"+((x<0?x+256:x).toString(16))).slice(-2)).join("");}
