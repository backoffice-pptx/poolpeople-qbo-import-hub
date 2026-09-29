# v1.5.142 — Phase C FULL_EXPORT ObservationCount Contract

## Scope
Contract + controlled schema migration + read-only validation only.

### 22_ExportManifest.js
- Adds explicit `entitySheetName` to all 22 manifest entries.
- Propagates it through manifest lookup/copy helpers.
- Validates that every `entitySheetName` is nonblank and owned by the same manifest entry.
- Makes the parent/entity dataset explicit; `sheetNames[0]` is no longer the semantic authority.

### 4010_QBO_FullExportObservationCountSchemaMigration.js
Controlled migration/audit module.

Public functions:
- `previewQboFullExportObservationCountSchemaMigration()` — READ ONLY; run first.
- `auditQboFullExportEntitySheetContract()` — READ ONLY.
- `applyQboFullExportObservationCountSchemaMigration()` — controlled header-only write after preview passes.

Target schema additions:
- `QBO_Export_Run_History` → `QBO_ExportRunHistory`: append column L `ObservationCount`.
- `QBO State Capture` → `01_Sources`: append column T `ObservationCount`.

The apply function is idempotent and fails closed on any predecessor-header mismatch or conflicting target column.

## Deliberately NOT changed
- No historical ObservationCount values are populated.
- No daily FULL_EXPORT completion/writer behavior changes.
- No `recordQboScheduledExportResult_()` changes.
- No `registerQboCompletedFullExportSource_()` changes.
- No 05/06/State Application changes.
- No triggers or Script Properties changes.

## Validation sequence
1. Copy/push package.
2. Run `previewQboFullExportObservationCountSchemaMigration()` in Apps Script.
3. Review result; it must be `valid: true` and show both schema actions as safe.
4. Run `auditQboFullExportEntitySheetContract()`; it must be `valid: true`, 22 exports, zero findings.
5. Do **not** run schema apply until preview/audit results are reviewed.
