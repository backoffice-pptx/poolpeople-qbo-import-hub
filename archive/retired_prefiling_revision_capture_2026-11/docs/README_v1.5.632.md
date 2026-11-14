# App 50 v1.5.632 — Read-only storage-contract audit

Install `1652_QBO_PrefilingRevisionStorageContractAuditV15632.js` in the existing App 50 project and `clasp push`.

Run **`auditRegistryQboPrefilingStorageContractV15632`** directly in Apps Script. No arguments, wrapper, or new Script Properties.

This function inspects the existing TSD and Recognition workbook log and snapshot headers, identifies whether the log is already migrated or safely append-compatible, and checks sequence collisions in current-format success logs. It performs **zero writes**, does not call `qboRev631EnsureLogSchema_`, and does not start any export.

`STORAGE_SCHEMA_COMPATIBLE` is not production authorization. It does not validate a live append, zero-row export, recovery mutation, or populated evidence certification. The integrated capture release flag remains disabled.

The audit reports workbook IDs and aggregate counts, not transaction-level customer data. Historical successful logs without sequences are reported but not retroactively rewritten.
