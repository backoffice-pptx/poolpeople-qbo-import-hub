/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 2320_QBO_ObservationIndexPhysicalStorageContract.js
 * Version     : 1.5.174
 * Purpose     : Contract/readiness gate for sharded physical storage of logical
 *               07_Observation_Index after the Google Sheets capacity failure.
 *
 * SAFETY:
 *   - validation/preflight only
 *   - creates no Drive folders/files
 *   - writes no workbook cells
 *   - mutates no triggers or Script Properties
 */
const QBO_OBSERVATION_INDEX_PHYSICAL_V173_ = Object.freeze({
  VERSION: 'QBO_OBSERVATION_INDEX_PHYSICAL_V2',
  LOGICAL_CONTRACT_VERSION: 'QBO_OBSERVATION_INDEX_V1',
  LEGACY_SHEET_NAME: '07_Observation_Index',
  STORAGE_KIND: 'IMMUTABLE_DRIVE_JSON_SHARDS',
  SHARD_SCHEMA_VERSION: 'QBO_OBSERVATION_INDEX_SHARD_V1',
  FILE_PREFIX: 'qbo_observation_index_shard_',
  HASH_ALGORITHM: 'SHA-256',
  GOVERNED_PARENT_ASSET_KEY: 'QBO_CHANGE_PAYLOADS_FOLDER',
  GOVERNED_PARENT_EXPECTED_TYPE: 'Folder',
  ENVIRONMENT: 'PROD',
  SHARD_FOLDER_NAME: 'Observation Index Shards',
  MANIFEST_FOLDER_NAME: 'Observation Index Manifests',
  LOOKUP_FOLDER_NAME: 'Observation Index Lookup',
  REQUIRED_SHARD_STABLE_BODY_FIELDS: Object.freeze([
    'schemaVersion','sourcePayloadFileId','sourcePayloadShardHash',
    'observationCount','observationIds','records'
  ]),
  LOOKUP_PARTITION: Object.freeze(['EntityType','EntityId']),
  CHRONOLOGY_FIELD: 'ObservedAt',
  RULES: Object.freeze({
    ONE_LOGICAL_RECORD_PER_OBSERVATION_ID: true,
    IMMUTABLE_SHARDS: true,
    DETERMINISTIC_CONTENT_HASH_IDENTITY: true,
    IDEMPOTENT_RECONCILIATION: true,
    EXACT_06_PAYLOAD_LINEAGE_REQUIRED: true,
    ENTITY_LOOKUP_REQUIRED_BEFORE_STATE_APPLICATION: true,
    STATE_APPLICATION_READS_RELEVANT_SHARDS_ONLY: true,
    STATE_APPLICATION_ORDERS_ENTITY_OBSERVATIONS_BY_OBSERVED_AT: true,
    SHARD_ORDER_IS_NOT_CHRONOLOGY: true,
    INGESTION_ORDER_IS_NOT_CHRONOLOGY: true,
    LATE_ARRIVING_OBSERVATIONS_MUST_NOT_BE_BLINDLY_APPENDED_TO_STATE: true
  })
});

function validateQboObservationIndexPhysicalStorageContractV174() {
  const c = QBO_OBSERVATION_INDEX_PHYSICAL_V173_;
  const logical = QBO_OBSERVATION_INDEX_CONTRACT_;
  const findings = [];

  if (!logical || logical.VERSION !== c.LOGICAL_CONTRACT_VERSION) {
    findings.push('LOGICAL_CONTRACT_VERSION_MISMATCH');
  }
  if (c.STORAGE_KIND !== 'IMMUTABLE_DRIVE_JSON_SHARDS') {
    findings.push('UNEXPECTED_STORAGE_KIND');
  }
  if (c.CHRONOLOGY_FIELD !== logical.PRIMARY_CHRONOLOGY_FIELD) {
    findings.push('CHRONOLOGY_FIELD_MISMATCH');
  }
  if (JSON.stringify(c.LOOKUP_PARTITION) !== JSON.stringify(logical.CHRONOLOGY_PARTITION)) {
    findings.push('LOOKUP_PARTITION_MISMATCH');
  }
  if (!c.RULES.SHARD_ORDER_IS_NOT_CHRONOLOGY ||
      !c.RULES.STATE_APPLICATION_ORDERS_ENTITY_OBSERVATIONS_BY_OBSERVED_AT) {
    findings.push('STATE_APPLICATION_CHRONOLOGY_RULE_MISSING');
  }

  const out = {
    version:'1.5.174',
    operation:'OBSERVATION_INDEX_PHYSICAL_STORAGE_CONTRACT_VALIDATION',
    logicalContractVersion:logical.VERSION,
    physicalStorageVersion:c.VERSION,
    storageKind:c.STORAGE_KIND,
    shardSchemaVersion:c.SHARD_SCHEMA_VERSION,
    lookupPartition:c.LOOKUP_PARTITION.slice(),
    chronologyField:c.CHRONOLOGY_FIELD,
    stateApplicationReadSemantics:
      'LOOKUP_ENTITY_TO_RELEVANT_IMMUTABLE_07_SHARDS_VERIFY_RECORDS_ORDER_BY_OBSERVED_AT_APPLY_GOVERNED_RULES',
    shardOrderIsChronology:false,
    lateArrivingObservationBlindAppendAllowed:false,
    findingCount:findings.length,
    findings:findings,
    valid:findings.length===0,
    safety:{
      driveWritesPerformed:false,
      workbookWritesPerformed:false,
      scriptPropertiesMutationPerformed:false,
      triggerMutationPerformed:false
    }
  };
  console.log(JSON.stringify(out,null,2));
  return out;
}
