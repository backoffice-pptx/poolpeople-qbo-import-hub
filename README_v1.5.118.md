# v1.5.118 — Controlled Native CDC 03-Only Reconstruction

Writes only `03_Native_CDC_Events_V2`.

Hard preconditions:
- v1.5.117 candidate 41 / 32 / 955 / 894 / 955 eligible / zero findings
- modern identity gate exactly 61/61
- existing 02a = 41 unique attempts
- existing 02b = 32 unique committed runs with valid successful 02a parents
- existing 03 = exactly 61 rows and every modern identity preserved

Post-write Gate A requires:
- 955 rows / 955 unique NativeCdcEventId
- 894 INITIAL_LOOKBACK
- 61 INCREMENTAL
- 955 ELIGIBLE
- 955 exact candidate identities
- every 03 row has a 02b parent
- zero findings

No 02a/02b/05/06/payload/property/trigger/State Application writes.

Run only:
`writeQboNativeCdcHistorical03ReconstructionV2()`
