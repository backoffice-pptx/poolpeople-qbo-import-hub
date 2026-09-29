/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 1260_QBO_ObservationIndexContract.js
 * Version     : 1.5.173
 * Purpose     : Governed logical-observation index contract between physical
 *               payload authority (06) and State Application.
 *
 * ARCHITECTURE LOCK — 2026-09-17
 *
 * 05 is source/work-unit ingestion control and MUST NOT carry ObservedAt.
 * 06 is physical payload-artifact authority and MUST NOT be used as business
 * chronology authority.
 *
 * 07_Observation_Index is one durable row per logical Change Payload
 * observation. It carries ObservationId + ObservedAt, source-reported change
 * metadata, and the exact physical payload pointer required to recover the
 * immutable observation.
 *
 * SourceOperation is SOURCE EVIDENCE only (e.g. CREATE/UPDATE/DELETE/EMAILED).
 * It is not a State Application conclusion and does not imply that canonical
 * business state changed.
 *
 * 07 does NOT duplicate normalized/canonical entity state and does NOT store
 * derived business-change details. Those conclusions belong to State
 * Application outputs (10/11/12/13).
 *
 * ObservedAt is evidence-capture chronology, not source-reported change time
 * and not downstream processing time. For FULL_EXPORT observations, ObservedAt
 * MUST equal ObservationCompletedAt from the exact 01_Sources / FULL_EXPORT
 * run-history lineage that captured the immutable export evidence. QBO
 * MetaData.LastUpdatedTime remains SourceChangeTime / QboLastUpdatedTime and is
 * supporting version/change evidence only. PayloadCreatedAt, PersistedAt and
 * IndexedAt never substitute for ObservedAt.
 *
 * State Application chronology is partitioned by EntityType + EntityId and
 * ordered by ObservedAt. Equal ObservedAt cases are resolved by governed
 * evidence rules; payload/file/ingestion ordering is never a tie breaker.
 *
 * PHYSICAL STORAGE LOCK — 2026-09-17 / v1.5.173
 *
 * Google Sheets is NOT the durable row-level physical store for logical 07.
 * Runtime proved the combined State Capture workbook cannot hold the historical
 * 07 population because Sheets enforces a 10,000,000-cell workbook ceiling.
 *
 * Logical 07 remains one record per ObservationId with this exact contract.
 * Durable physical authority moves to immutable, deterministic Drive JSON
 * Observation Index shards plus a compact shard/lookup manifest. State
 * Application resolves the relevant shard records for EntityType + EntityId,
 * verifies them, orders by ObservedAt, then applies governed state rules.
 *
 * Shard/file/manifest/ingestion order is NEVER chronology.
 *
 * This module is CONTRACT ONLY. It creates/writes no sheet or Drive artifact.
 */
const QBO_OBSERVATION_INDEX_CONTRACT_ = Object.freeze({
  VERSION: 'QBO_OBSERVATION_INDEX_V1',
  SHEET_NAME: '07_Observation_Index',

  HEADERS: Object.freeze([
    'ObservationId',
    'IngestionSourceId',
    'SourceType',
    'SourceLedger',
    'SourceRunId',
    'SourceUnitId',
    'EntityType',
    'EntityId',
    'ObservedAt',
    'SourceChangeTime',
    'SourceOperation',
    'PayloadKind',
    'PayloadFileId',
    'PayloadFileName',
    'PayloadShardHash',
    'PayloadOrdinal',
    'NormalizedStateHash',
    'QboSyncToken',
    'QboLastUpdatedTime',
    'AdmissionStatus',
    'IndexedAt'
  ]),

  REQUIRED_IDENTITY: Object.freeze([
    'ObservationId','IngestionSourceId','SourceType','SourceLedger',
    'EntityType','EntityId','ObservedAt',
    'PayloadFileId','PayloadShardHash','PayloadOrdinal'
  ]),

  SOURCE_EVIDENCE_FIELDS: Object.freeze([
    'SourceChangeTime','SourceOperation','QboSyncToken','QboLastUpdatedTime'
  ]),

  CHRONOLOGY_PARTITION: Object.freeze(['EntityType','EntityId']),
  PRIMARY_CHRONOLOGY_FIELD: 'ObservedAt',

  NON_CHRONOLOGY_FIELDS: Object.freeze([
    'PayloadFileName','PayloadShardHash','PayloadOrdinal','IndexedAt'
  ]),

  PROHIBITED_DERIVED_FIELDS: Object.freeze([
    'BusinessStateChanged','ChangeType','ChangedFields','PreviousState',
    'CanonicalState','CanonicalStateJson'
  ]),

  ADMISSION_STATUS: Object.freeze({
    ADMITTED: 'ADMITTED',
    EVIDENCE_EXCEPTION: 'EVIDENCE_EXCEPTION',
    BLOCKED: 'BLOCKED'
  }),

  INVARIANTS: Object.freeze({
    ONE_ROW_PER_OBSERVATION_ID: true,
    OBSERVATION_ID_GLOBALLY_UNIQUE: true,
    OBSERVED_AT_REQUIRED: true,
    PHYSICAL_PAYLOAD_POINTER_REQUIRED: true,
    SOURCE_OPERATION_IS_EVIDENCE_NOT_CONCLUSION: true,
    DERIVED_BUSINESS_CHANGE_NOT_STORED_IN_07: true,
    CANONICAL_STATE_NOT_DUPLICATED_IN_07: true,
    INGESTION_ORDER_IS_NOT_BUSINESS_CHRONOLOGY: true,
    PAYLOAD_ORDER_IS_NOT_BUSINESS_CHRONOLOGY: true,
    STATE_APPLICATION_PARTITIONS_BY_ENTITY: true,
    EQUAL_OBSERVED_AT_REQUIRES_GOVERNED_RESOLUTION: true,
    FULL_EXPORT_OBSERVED_AT_EQUALS_EXACT_EXPORT_COMPLETED_AT: true,
    SOURCE_CHANGE_TIME_IS_SUPPORTING_EVIDENCE_NOT_OBSERVED_AT: true,
    PROCESSING_TIMESTAMPS_NEVER_SUBSTITUTE_FOR_OBSERVED_AT: true
  })
});

function validateQboObservationIndexContractV173(){
  const c=QBO_OBSERVATION_INDEX_CONTRACT_, findings=[],seen=Object.create(null);
  c.HEADERS.forEach(function(h){
    if(!h)findings.push('BLANK_HEADER');
    if(seen[h])findings.push('DUPLICATE_HEADER:'+h);
    seen[h]=true;
  });
  c.REQUIRED_IDENTITY.forEach(function(h){if(!seen[h])findings.push('REQUIRED_HEADER_MISSING:'+h);});
  c.PROHIBITED_DERIVED_FIELDS.forEach(function(h){if(seen[h])findings.push('PROHIBITED_DERIVED_FIELD_PRESENT:'+h);});
  if(seen.Operation)findings.push('AMBIGUOUS_OPERATION_HEADER_PRESENT');
  if(!seen.SourceOperation)findings.push('SOURCE_OPERATION_MISSING');
  ['PayloadFileId','PayloadShardHash','PayloadOrdinal'].forEach(function(h){
    if(!seen[h])findings.push('PAYLOAD_POINTER_MISSING:'+h);
  });

  const out={
    version:'1.5.173',
    operation:'OBSERVATION_INDEX_CONTRACT_VALIDATION',
    sheetName:c.SHEET_NAME,
    headerCount:c.HEADERS.length,
    primaryChronologyField:c.PRIMARY_CHRONOLOGY_FIELD,
    chronologyPartition:c.CHRONOLOGY_PARTITION.slice(),
    sourceOperationSemantics:'SOURCE_EVIDENCE_ONLY_NOT_BUSINESS_STATE_CHANGE',
    fullExportObservedAtSemantics:'EXACT_FULL_EXPORT_OBSERVATION_COMPLETED_AT',
    sourceChangeTimeSemantics:'SUPPORTING_SOURCE_REPORTED_CHANGE_EVIDENCE_ONLY',
    physicalRowStore:'IMMUTABLE_DRIVE_JSON_SHARDS',
    googleSheetDurableRowStore:false,
    stateApplicationReadPath:'ENTITY_LOOKUP_TO_RELEVANT_07_SHARDS_THEN_ORDER_BY_OBSERVED_AT',
    shardOrderIsChronology:false,
    derivedBusinessChangeStoredIn07:false,
    canonicalStateDuplicatedIn07:false,
    findingCount:findings.length,
    findings:findings,
    valid:findings.length===0,
    safety:{sheetCreationPerformed:false,productionWritesPerformed:false,triggerMutationPerformed:false}
  };
  console.log(JSON.stringify(out,null,2));
  return out;
}
