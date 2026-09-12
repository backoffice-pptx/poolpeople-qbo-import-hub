/** ============================================================================
 * Application : 50 QBO Import Hub Standalone
 * Module      : 64_QBO_ChangeEvidenceSetup.js
 * Purpose     : Governed validation of the QuickBooks/Change Evidence folder
 *               hierarchy after one-time bootstrap creation and registration.
 *
 * Public API:
 *   - validateQboChangeEvidenceRegistry()
 *   - setupQboChangeEvidenceFolders()  // backward-compatible validation alias
 *
 * Governance:
 *   - The governed PROD asset registry is now authoritative for the Change
 *     Evidence parent and all four child folders.
 *   - Normal validation does NOT create Drive folders and does NOT create or
 *     mutate asset-registry records.
 *   - Missing, renamed, inaccessible, duplicated-parent, or mis-parented assets
 *     cause validation to fail before production CDC acquisition.
 * ============================================================================
 */

function validateQboChangeEvidenceRegistry() {
  const cfg = QBO_CHANGE_EVIDENCE_SETUP;

  const rootFolder = qboResolveGovernedFolderAsset_(
    cfg.ROOT_FOLDER_ASSET_KEY,
    cfg.ROOT_FOLDER_EXPECTED_TYPE,
    cfg.ENVIRONMENT
  );

  if (rootFolder.getName() !== cfg.EXPECTED_ROOT_FOLDER_NAME) {
    throw new Error(
      'Change Evidence registry validation refused: governed asset ' +
      cfg.ROOT_FOLDER_ASSET_KEY + ' resolved to folder "' + rootFolder.getName() +
      '"; expected "' + cfg.EXPECTED_ROOT_FOLDER_NAME + '".'
    );
  }

  const quickBooksFolder = qboRequireSingleParent_(rootFolder, cfg.ROOT_FOLDER_ASSET_KEY);
  if (quickBooksFolder.getName() !== cfg.EXPECTED_PARENT_FOLDER_NAME) {
    throw new Error(
      'Change Evidence registry validation refused: governed folder "' +
      cfg.EXPECTED_ROOT_FOLDER_NAME + '" is parented under "' +
      quickBooksFolder.getName() + '"; expected "' +
      cfg.EXPECTED_PARENT_FOLDER_NAME + '".'
    );
  }

  const assets = cfg.CHILD_FOLDERS.map(function(definition) {
    const folder = qboResolveGovernedFolderAsset_(
      definition.assetKey,
      'Folder',
      cfg.ENVIRONMENT
    );

    if (folder.getName() !== definition.name) {
      throw new Error(
        'Change Evidence registry validation refused: governed asset ' +
        definition.assetKey + ' resolved to folder "' + folder.getName() +
        '"; expected "' + definition.name + '".'
      );
    }

    const parent = qboRequireSingleParent_(folder, definition.assetKey);
    if (parent.getId() !== rootFolder.getId()) {
      throw new Error(
        'Change Evidence registry validation refused: governed asset ' +
        definition.assetKey + ' is not a direct child of governed asset ' +
        cfg.ROOT_FOLDER_ASSET_KEY + '. Actual parent="' + parent.getName() +
        '" (' + parent.getId() + '), expected="' + rootFolder.getName() +
        '" (' + rootFolder.getId() + ').'
      );
    }

    return {
      assetKey: definition.assetKey,
      folderId: folder.getId(),
      folderName: folder.getName(),
      parentFolderId: parent.getId(),
      status: 'VALID'
    };
  });

  const result = {
    environment: cfg.ENVIRONMENT,
    rootAssetKey: cfg.ROOT_FOLDER_ASSET_KEY,
    rootFolderId: rootFolder.getId(),
    rootFolderName: rootFolder.getName(),
    quickBooksFolderId: quickBooksFolder.getId(),
    quickBooksFolderName: quickBooksFolder.getName(),
    registryActionRequired: false,
    valid: true,
    assets: assets
  };

  console.log('[CHANGE EVIDENCE REGISTRY] | VALID | ' + JSON.stringify(result, null, 2));
  return result;
}

/**
 * Backward-compatible entry point retained so the previously used setup
 * function remains callable. After bootstrap and registry registration it is
 * intentionally validation-only and performs no Drive or registry mutation.
 */
function setupQboChangeEvidenceFolders() {
  const result = validateQboChangeEvidenceRegistry();
  console.log('[CHANGE EVIDENCE SETUP] | COMPLETE | status=VERIFIED_REGISTERED');
  return result;
}

function qboResolveGovernedFolderAsset_(assetKey, expectedType, environment) {
  if (typeof DataPlatform05 === 'undefined' ||
      typeof DataPlatform05.getConfiguredAssetReference !== 'function') {
    throw new Error(
      'Change Evidence registry validation refused: Application 05 library ' +
      'DataPlatform05 is unavailable. Cannot resolve governed asset ' + assetKey + '.'
    );
  }

  let asset;
  try {
    asset = DataPlatform05.getConfiguredAssetReference(
      assetKey,
      expectedType,
      environment
    );
  } catch (err) {
    throw new Error(
      'Change Evidence registry validation refused: unable to resolve governed asset ' +
      assetKey + ': ' + (err && err.message ? err.message : err)
    );
  }

  const folderId = asset && String(asset.ResourceIdentifier || '').trim();
  if (!folderId) {
    throw new Error(
      'Change Evidence registry validation refused: Application 05 returned no ' +
      'ResourceIdentifier for governed asset ' + assetKey + '.'
    );
  }

  try {
    return DriveApp.getFolderById(folderId);
  } catch (err) {
    throw new Error(
      'Change Evidence registry validation refused: unable to open governed folder asset ' +
      assetKey + ' (' + folderId + '): ' +
      (err && err.message ? err.message : err)
    );
  }
}

function qboRequireSingleParent_(folder, assetKey) {
  const parents = folder.getParents();
  if (!parents.hasNext()) {
    throw new Error(
      'Change Evidence registry validation refused: governed asset ' + assetKey +
      ' has no accessible parent folder.'
    );
  }

  const parent = parents.next();
  if (parents.hasNext()) {
    throw new Error(
      'Change Evidence registry validation refused: governed asset ' + assetKey +
      ' has multiple accessible parent folders.'
    );
  }
  return parent;
}
