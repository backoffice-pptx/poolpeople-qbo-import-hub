# V1298 REVIEW ONLY — DO NOT PUSH

This merges V1294 no-steal lease semantics and V1295 boundary checks into
V1297's invocation identity propagation and adds scheduler-claim comparison.

**Critical:** The V1297 replacement framework in the preceding package was
based on the 5:40 PM snapshot and did not include V1294/V1295 protections.
This V1298 source explicitly restores them. It is not verified against a
fresh post-V1297 `clasp pull` and must be diffed before deployment.

The guard checks before major mutation calls; it cannot interrupt a running
SpreadsheetApp operation or attest that a stale Apps Script execution ended.
Manual exporters use lease-token-only validation. No lease clearing or
automatic worker takeover is authorized.

Also review `ACTIVE_INDEX` key against deployed scheduler properties; if
different, scheduled writes fail closed. Run tests only after code review.
