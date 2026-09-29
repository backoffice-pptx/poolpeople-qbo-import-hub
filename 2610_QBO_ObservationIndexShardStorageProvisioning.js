/**
 * Application : 50 QBO Import Hub Standalone
 * Module      : 2610_QBO_ObservationIndexShardStorageProvisioning.js
 * Version     : 1.5.174
 * Purpose     : Controlled provisioning + validation of the physical storage
 *               containers for logical 07_Observation_Index.
 *
 * GOVERNANCE:
 *   - Uses the already-governed PROD QBO_CHANGE_PAYLOADS_FOLDER as parent.
 *   - Creates only three exact child folders when absent:
 *       Observation Index Shards
 *       Observation Index Manifests
 *       Observation Index Lookup
 *   - Refuses duplicate same-name children.
 *   - Creates no shard/manifest/lookup data files.
 *   - Writes no workbook cells.
 *   - Mutates no Script Properties or triggers.
 *
 * The new child folders are implementation containers beneath an already
 * governed asset; they are not silently registered as new top-level assets.
 */

function provisionAndValidateQboObservationIndexShardStorageV174() {
  const c = QBO_OBSERVATION_INDEX_PHYSICAL_V173_;
  const parent = qboResolveGovernedFolderAsset_(
    c.GOVERNED_PARENT_ASSET_KEY,
    c.GOVERNED_PARENT_EXPECTED_TYPE,
    c.ENVIRONMENT
  );

  const defs = [
    {role:'SHARDS', name:c.SHARD_FOLDER_NAME},
    {role:'MANIFESTS', name:c.MANIFEST_FOLDER_NAME},
    {role:'LOOKUP', name:c.LOOKUP_FOLDER_NAME}
  ];

  const created = [];
  const containers = defs.map(function(def) {
    const result = qboObservationIndexV174RequireSingleChildFolder_(parent, def.name, true);
    if (result.created) created.push(def.role);
    return {
      role:def.role,
      folderName:result.folder.getName(),
      folderId:result.folder.getId(),
      parentFolderId:parent.getId(),
      created:result.created
    };
  });

  const validation = validateQboObservationIndexShardStorageV174();
  validation.provisioning = {
    governedParentAssetKey:c.GOVERNED_PARENT_ASSET_KEY,
    governedParentFolderId:parent.getId(),
    governedParentFolderName:parent.getName(),
    createdRoles:created,
    createdFolderCount:created.length,
    dataFilesCreated:0,
    workbookWritesPerformed:false,
    scriptPropertiesMutationPerformed:false,
    triggerMutationPerformed:false
  };
  console.log('[OBSERVATION INDEX STORAGE V174] | PROVISIONED_VALIDATED | ' + JSON.stringify(validation));
  return validation;
}

function validateQboObservationIndexShardStorageV174() {
  const c = QBO_OBSERVATION_INDEX_PHYSICAL_V173_;
  const findings = [];
  let parent = null;
  try {
    parent = qboResolveGovernedFolderAsset_(
      c.GOVERNED_PARENT_ASSET_KEY,
      c.GOVERNED_PARENT_EXPECTED_TYPE,
      c.ENVIRONMENT
    );
  } catch (err) {
    findings.push('GOVERNED_PARENT_UNAVAILABLE ' + qboObservationIndexV174Err_(err));
  }

  const defs = [
    {role:'SHARDS', name:c.SHARD_FOLDER_NAME},
    {role:'MANIFESTS', name:c.MANIFEST_FOLDER_NAME},
    {role:'LOOKUP', name:c.LOOKUP_FOLDER_NAME}
  ];
  const containers = [];

  if (parent) {
    defs.forEach(function(def) {
      try {
        const result = qboObservationIndexV174RequireSingleChildFolder_(parent, def.name, false);
        containers.push({
          role:def.role,
          folderName:result.folder.getName(),
          folderId:result.folder.getId(),
          parentFolderId:parent.getId(),
          directChild:true
        });
      } catch (err) {
        findings.push(def.role + '_CONTAINER_INVALID ' + qboObservationIndexV174Err_(err));
      }
    });
  }

  const out = {
    version:'1.5.174',
    operation:'OBSERVATION_INDEX_SHARD_STORAGE_VALIDATION',
    physicalStorageVersion:c.VERSION,
    storageKind:c.STORAGE_KIND,
    governedParentAssetKey:c.GOVERNED_PARENT_ASSET_KEY,
    governedParentFolderId:parent ? parent.getId() : '',
    governedParentFolderName:parent ? parent.getName() : '',
    containers:containers,
    containerCount:containers.length,
    expectedContainerCount:defs.length,
    shardDataFileCreationPerformed:false,
    manifestDataFileCreationPerformed:false,
    lookupDataFileCreationPerformed:false,
    findingCount:findings.length,
    findings:findings,
    valid:findings.length===0 && containers.length===defs.length,
    safety:{
      workbookWritesPerformed:false,
      scriptPropertiesMutationPerformed:false,
      triggerMutationPerformed:false
    }
  };
  console.log('[OBSERVATION INDEX STORAGE V174] | VALIDATION | ' + JSON.stringify(out));
  return out;
}

function qboObservationIndexV174RequireSingleChildFolder_(parent, name, createIfMissing) {
  const it = parent.getFoldersByName(name);
  if (it.hasNext()) {
    const folder = it.next();
    if (it.hasNext()) {
      throw new Error('DUPLICATE_CHILD_FOLDERS name=' + name + ' parentId=' + parent.getId());
    }
    const parents = folder.getParents();
    if (!parents.hasNext()) throw new Error('CHILD_HAS_NO_PARENT name=' + name);
    const actualParent = parents.next();
    if (parents.hasNext()) throw new Error('CHILD_HAS_MULTIPLE_PARENTS name=' + name);
    if (actualParent.getId() !== parent.getId()) {
      throw new Error('CHILD_PARENT_MISMATCH name=' + name);
    }
    return {folder:folder, created:false};
  }
  if (!createIfMissing) throw new Error('MISSING_CHILD_FOLDER name=' + name);
  return {folder:parent.createFolder(name), created:true};
}

function qboObservationIndexV174Err_(err) {
  return String(err && err.message ? err.message : err);
}
