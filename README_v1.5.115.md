# v1.5.115 — Native CDC Identity Reconciliation Audit

Read-only follow-up to the guarded v1.5.114 abort.

## Why

v1.5.114 correctly refused to overwrite an existing 03 key:

`NATIVE_CDC|20260913T1930Z|<CycleUuid>|BillPayment|OBS|7|69916|DELETE`

The validated v1.5.113 population reconciled counts, but the modern candidate event
identity did not exactly reproduce the already-established four-part Native CDC
source identity.

## This audit

1. Reports current post-abort 02a / 02b / 03 row and unique-key counts.
2. Rebuilds the v1.5.113 candidate population.
3. Compares exact NativeCdcEventId identity.
4. Reconciles existing and candidate observations using immutable evidence-file +
   entity observation facts.
5. Reports every one-to-one observation whose event ID differs.
6. Reports SourceId shape counts.

## Safety

No writes to any sheet, Drive artifact, Script Property, trigger, payload, or
State Application output.

## Run only

`auditQboNativeCdcIdentityReconciliationV2()`

Send the complete execution log back. Do not rerun v1.5.114.
