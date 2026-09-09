# 50 QBO Import Hub Standalone

## Purpose

Application 50 is the standalone QuickBooks Online acquisition and governed-export application. It owns direct QBO API/report retrieval and source-dataset persistence used by downstream Pool People applications.

Production exports are scheduled through individual Apps Script time-based triggers per export function. `99_TriggeredCalls.js` is retained but is not the required production orchestration path.

## Sales-Tax Permanent Sources

Application 50 owns the permanent QBO source layer used by the Level 1 / Level 2 sales-tax reconciliation architecture.

### TaxableSalesDetail

`TaxableSalesDetail` is pulled directly from QBO on a Cash basis for the requested period. Each successful pull represents **QBO's current reconstruction of that historical period at the pull ASOF**; later pulls may differ after transaction or application changes.

The persistent dataset contract is:

```text
00_Controls
01_Current
02_Detail_Snapshots
03_Snapshot_Changes
90_Ingestion_Log
```

The governed workbook itself is stored under:

```text
Data Platform/Data Exchange/QuickBooks/CURRENT/QBO_Taxable_Sales_Detail_Data
```

Provisioning code must create or resolve that governed location. It must not leave the workbook in My Drive root or under `Applications/50 QBO Import Hub Standalone/Workbook`.

- `00_Controls` — report period, source/pull ASOF, snapshot identity/sequence, status, validation, warnings, and errors.
- `01_Current` — replaceable latest reconstruction for the requested period.
- `02_Detail_Snapshots` — immutable successful report captures.
- `03_Snapshot_Changes` — row/state changes between snapshots.
- `90_Ingestion_Log` — execution history, counts, timing, status, and diagnostics.

Application 21 Bookkeeping Audit is the primary downstream consumer for Level 2 transaction-level variance explanation. Application 05 may consume selected canonical/normalized data only where its reusable transformation contracts remain needed; these sources must not be routed through the retired Phase 9 audit pipeline.

### General Ledger and Sales-Tax Recognition

The permanent sales-tax recognition source is derived from the **existing governed General Ledger export**, not a second direct GL report pull inside the sales-tax derivation module.

```text
QBO General Ledger API
        │
        ▼
Existing App 50 GL Export
QBO_Export_General_Ledger_Report
        │
        └── captured/refreshed on its own schedule and ASOF
        │
        ▼
Sales-Tax Recognition Derivation
        │
        ▼
21 Bookkeeping Audit — Level 2 evidence
```

The recognition derivation must preserve the GL source freshness/ASOF. It must not be represented as real-time merely because the derivation itself ran later.

Validated diagnostic findings to promote into permanent logic include Cash GL recognition behavior, correct date-only handling, account metadata enrichment, and the fact that the authoritative Sales-by-Tax-Name population includes certain non-Income control rows. Temporary diagnostics `53–59` are research scaffolding, not permanent production modules; their proven logic should be harvested into production modules/tests before they are removed.

## Cross-Application Ownership

```text
QBO
│
├── TaxableSalesDetail API ──► App 50 permanent detail dataset ──► App 21 Level 2
│
└── General Ledger API ──────► App 50 governed GL export
                                      │
                                      ▼
                               recognition derivation ───────────► App 21 Level 2

QBO Liability snapshots ────────────────────────────────────────► App 21 Level 1/2
```

Application 50 acquires and governs sources. Application 21 explains/accountably reconciles variances. Application 05 supplies only reusable transformation logic where appropriate.

## Snapshot Terminology

- **Current** — replaceable latest operational state.
- **Master Backup** — full-file recovery copy.
- **Snapshot Record / Run Snapshot** — immutable audit evidence.
- **Change Record / CDC** — differences between captured states.

Do not use “snapshot” as a generic synonym for a full-file backup.
