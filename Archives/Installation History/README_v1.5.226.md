# v1.5.226 — Read-only Phase G checkpoint inspector

Changed-files-only package. Adds a standalone inspector; does not replace module 4100.

Run `inspectQboPhaseGGlobalEqualTimeCheckpointV1226()` once and provide its execution log.

Reads only the exact Phase G Script Property and current user's project trigger inventory. Logs checkpoint fields and whether an iterator token exists, but never logs its value. No property writes, trigger creation/deletion, workbook access, worker invocation, or recovery occurs. Missing/invalid state is reported explicitly.

V1221 recovery is restricted to the historical FAILED cursor 1117 checkpoint and must not be reused for the Oct. 6 hard engine termination. That recovery function deletes continuation triggers before validating its checkpoint. Current persisted state must be inspected before preparing a new governed recovery.

Local validation: syntax check and mocked cases for existing, missing, malformed, and invalid-object state; token exclusion and unrelated-trigger exclusion; mutation APIs unavailable in mocks.
