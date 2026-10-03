# v1.5.203 — Final Historical 07 Certification Recovery

Repairs the v1.5.202 collection checkpoint failure exposed by a transient
Spreadsheet service error on 2026-09-30.

## Recovery contract

- Reuses the existing v202 certification workbook and run identity.
- Treats workbook ObservationId rows as the durable collection commit record.
- Replays immutable artifacts read-only from artifact 0 and verifies every durable
  ObservationId in prefix order.
- Selects the greatest fully verified artifact boundary represented by the workbook.
- Removes only any workbook tail rows written by the failed, uncheckpointed invocation.
- Rebuilds all collection counters and prefix counts from the verified boundary.
- Persists the repaired checkpoint as v1.5.203 and schedules normal continuation.
- Does not mutate source evidence or Change Payloads.

Transient Spreadsheet failures during subsequent work are saved as
`RECOVERY_REQUIRED` from the last persisted checkpoint rather than preserving
in-memory cursor advances as a terminal failed checkpoint.

## Recover the existing failed run

Run once from Apps Script:

`recoverQboFinalHistorical07TrustCertificationV203`

Expected successful log marker:

`[FINAL HISTORICAL 07 V203] | RECOVERED | ...`

After recovery, the continuation chain is automatic. Use the existing status entrypoint:

`statusQboFinalHistorical07TrustCertificationV202`

Do not run the v202 start function. Do not manually invoke the continuation function.
