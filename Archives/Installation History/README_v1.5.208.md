# App 50 v1.5.208 — Controlled TSD 01_Current repair

Purpose: repair only the production defects proven by the v1.5.207 read-only evidence.

Authorized preconditions:
- LINEAGE_ONLY_DEFECT: core business state and full source representation already match latest immutable snapshot; lineage is missing/incorrect.
- LEGACY_CURRENT_PUBLICATION_FIELD_LOSS: no added/removed rows, no representational-only rows, zero taxable delta, and every changed core field is Recognition_Date and/or Source_Transaction_Date with the Current value blank.

Any other difference blocks the repair.

The repair rebuilds 01_Current from each period's latest immutable 02_Detail_Snapshots population, fingerprints snapshots before/after, verifies full business/source/lineage equality after publication, and rolls 01_Current back to its pre-repair rows if a write/postcondition fails. It never intentionally mutates 02_Detail_Snapshots.

Run order:
1. testQboTaxableSalesDetailControlledRepairV1208Contract()
2. repairQboTaxableSalesDetailCurrentLineage()

After SUCCESS, run inspectQboTaxableSalesDetailCurrentLineage() for an independent read-only verification if desired.
