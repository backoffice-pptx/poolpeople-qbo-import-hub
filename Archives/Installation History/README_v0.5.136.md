# v0.5.136 GL run-snapshot routing correction

Root cause: createQboGeneralLedgerRunSnapshotV2_ used QBO_EXPORT_SNAPSHOT_FOLDER_ID, also used for master backups. The run artifact was therefore placed in Master Backups.

This package changes only that function's folder resolver in 52_QBO_GeneralLedgerReport.js and adds 1632_QBO_GlRunSnapshotRouting.js. The resolver uses a dedicated QBO_GL_RUN_SNAPSHOT_FOLDER_ID. When absent, it finds exactly one existing Run Snapshots folder beside Master Backups under the same QuickBooks parent. Missing, duplicate, misnamed, or unrelated folders fail closed; no folders are created. The master-backup property stays unchanged.

Install into App 50 / 50 QBO Import Hub Standalone and clasp push. Then run:
1. testGlRunSnapshotRoutingV05136Contract()
2. previewFreshGlRunSnapshotFolderV05136()
3. After preview succeeds with the correct two folder IDs: correctFreshGlRunSnapshotFolderV05136()

The correction is pinned to completed proof request 3dd8aee5-7b14-4bf2-8255-9514958a5e27, GL run 15f7d939-3737-465f-93e7-9b1ef0930c80 and snapshot file 1pcbY513UJCbF_-OJe-tei-FVg9HwleBB6KfWreZ9iSs. It validates the GL_RUN_SNAPSHOT_V2 metadata and all 2215 rows, moves the same file into Run Snapshots, records the dedicated route and verifies parent, contents, ledger and unchanged master route. It creates no replacement snapshot or new capture. Completed retries make no changes.

Local validation: 11 contract checks, sibling/configured routing, missing/duplicate/wrong-folder rejection, and mocked exact-file correction with no-write preview and completed retry. Runtime folder IDs and Drive placement still require the preview/apply results.

Fresh acquisition completed successfully in v0.5.135. This placement correction does not bind that capture or certify a complete production V3 run. The five attached report tables refer to the separate earlier historical-reuse Level1 proof; they do not report results of the new capture.
