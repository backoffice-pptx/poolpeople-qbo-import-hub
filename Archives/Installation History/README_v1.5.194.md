# v1.5.194 — Script Properties Retention Audit

Adds `1091_QBO_ScriptPropertiesRetentionAudit.js` with the no-argument operator function:

- `auditQboScriptPropertiesRetention()`

The audit is strictly read-only. It inventories the current Script Properties store and classifies property families as `KEEP`, `RETIRE_ELIGIBLE`, `BLOCKED_PRESERVE`, or `UNKNOWN_REVIEW`, including approximate storage bytes.

Key controls:

- Unknown/unrecognized properties fail closed to `UNKNOWN_REVIEW`.
- Native CDC per-cycle transient properties reuse the existing governed durable-committed-manifest cleanup planner; this audit does not invent a second eligibility rule.
- The FULL_EXPORT historical ObservationCount V148/V155/V163 working-state family is `RETIRE_ELIGIBLE` only when the exact frozen preview, governed historical apply, bounded post-apply reconciliation, and later historical Observation Index population are all proven complete from persisted state.
- Current Native CDC watermark/pause/cycle/handoff state, pipeline controls, production configuration, credentials, and current Observation Index authority evidence remain `KEEP`.
- Canonical V2 rebuild/migration and unfinished State Capture historical-governance state remain `BLOCKED_PRESERVE`.
- No Script Property is deleted, set, or rewritten. Property values are never logged.

Validation: run `auditQboScriptPropertiesRetention()` from the Apps Script editor and capture the SUMMARY and FAMILY log records. Do not delete properties based on the classification until the output has been reviewed.
