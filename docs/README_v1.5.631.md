# App 50 v1.5.631 — forward log contract and gated certification

> **Architecture disposition — November 2026:** The forward
> `Snapshot_Sequence` log contract remains active through
> `60_QBO_TaxableSalesDetailReport.js`,
> `61_QBO_SalesTaxRecognition.js`, and
> `1649_QBO_RevisionExportLogContractV15631.js`.
> The revision certification and integrated-gate modules
> `1650_QBO_PrefilingRevisionCertificationV15631.js` and
> `1651_QBO_PrefilingRevisionIntegratedGateV15631.js`
> belong to the retired App 21 revision-capture workflow.
> Installation instructions below are historical and do
> not authorize reinstating those modules.

**CANDIDATE / NO PRODUCTION AUTHORIZATION.** `PRODUCTION_RELEASED:false` remains enforced.

## Install

Replace the local source files `60_QBO_TaxableSalesDetailReport.js` and `61_QBO_SalesTaxRecognition.js` with the supplied full files. Add `1649`, `1650`, and `1651` to the local App 50 project. Review diffs before `clasp push`. Do not remove older versioned modules.

## Contract

Adds a trailing `Snapshot_Sequence` column to the existing TSD and Recognition success logs. Migration accepts only the exact old prefix or the exact new header and refuses nonblank legacy data in the appended column. No historical rows are backfilled. Each new export records its allocated sequence even when it writes zero snapshot rows. The next sequence calculation includes prior log sequence values so zero-row exports cannot reuse a sequence.

The new v1.5.631 certifier verifies log sequence and rejects collisions; historical zero-row records without persisted sequence remain uncertifiable. GL timestamp comparison is to whole seconds. The new worker uses the new certifier, with export release **disabled**.

## Remaining before production

Run source fixture tests and read-only live schema checks against both existing workbooks. Verify recognition log schema and exact `Snapshot_Sequence` column position, GL metadata and run registry; test historical header migration on isolated copies. Validate interrupted-export recovery against fixtures. Only then review a separate production release.

No QBO exports or live data changes were performed while preparing this patch.
