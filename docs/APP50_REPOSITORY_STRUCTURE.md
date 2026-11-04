# App 50 — Repository Structure and Deployment Boundaries

**Project:** DEV – QBO EXPORTS / App 50 QBO Import Hub Standalone  
**Status:** Approved repository convention  
**Established:** 2026-11-04

## Purpose

Keep production Google Apps Script source, historical recovery evidence, maintained development utilities, and documentation in the same Git repository without accidentally deploying archived or test-only code. This follows the organizational pattern used by App 21 Bookkeeping Audit.

## Approved layout

```text
50 QBO Import Hub Standalone/
├── Archives/
│   ├── Installation History/
│   ├── Installation Instructions/
│   └── Daily Export Recovery/
│       └── 2026-11/
│           ├── historical/
│           └── regression-reference/
├── docs/
│   └── APP50_REPOSITORY_STRUCTURE.md
├── tests/
├── tools/
├── *.js                       # Active Apps Script production source
├── .clasp.json
└── .claspignore
```

## Directory responsibilities

| Path | Intended contents | Deployment policy |
| --- | --- | --- |
| Repository root (`*.js`) | Active production Apps Script modules and runtime dependencies | Deploy through `clasp` |
| `Archives/Installation History/` | Superseded installation logs, version histories, and records | Exclude |
| `Archives/Installation Instructions/` | Superseded installation guides and version-specific READMEs | Exclude |
| `Archives/Daily Export Recovery/2026-11/historical/` | Historical daily export incident diagnostics, recovery designs, and superseded scripts | Exclude |
| `Archives/Daily Export Recovery/2026-11/regression-reference/` | Retained regression checks for investigation/reference, not production runtime | Exclude |
| `docs/` | Current architecture, operational guidance, and repository standards | Exclude |
| `tests/` | Maintained test harnesses not required for production runtime | Exclude |
| `tools/` | Maintained development/administrative tools not required for production runtime | Exclude only after checking dependencies |

## Locked rules

1. **Git preservation:** Keep historical and nonproduction artifacts inside the App 50 Git repository, not in the separate PoolPeople central archive, unless a later explicit decision changes this convention.
2. **Production separation:** Active production Apps Script modules remain at the repository root. Historical or diagnostic JavaScript belongs in `Archives/` and must not be uploaded to Apps Script.
3. **Deployment boundary:** `.clasp.json` currently sets `"rootDir": "."`. At the time of this decision, `.claspignore` did not exist. Before relocating JavaScript into these directories, create and verify an appropriate `.claspignore` that excludes nonproduction paths. Do not assume directory names alone prevent deployment.
4. **Dependency safety:** Before moving any source file to `tests/`, `tools/`, or `Archives/`, confirm that no active production module requires its global functions or constants. In particular, a maintained administrative tool that must remain callable in the deployed Apps Script project must not be excluded merely because it is called a tool.
5. **Evidence retention:** Archive historical incident utilities rather than deleting them. Distinguish operational source, regression evidence, incident-specific recovery scripts, and superseded design prototypes.
6. **Controlled commits:** Keep production fixes, administrative utilities, archive migrations, and separate Native CDC / Phase G workstreams in distinct Git commits.
7. **No implicit execution:** Archiving and documentation changes do not authorize production runs, recovery actions, or additional runtime testing.

## November 2026 daily-export archive scope

The following 21 previously untracked files were classified for archival; their relocation and commit must be verified separately.

**Historical (18):** `4278`, `4279`, `4280`, `4281`, `4282`, `4283`, `4286`, `4287`, `4288`, `4291`, `4292`, `4293`, `4295`, `4296`, `4299`, `4300`, `4303`, `4304` (matching `*_QBO_*.js`).

**Regression-reference (3):** `4294_QBO_WriteLeaseNoStealV1294.js`, `4301_QBO_ActualGuardIsolatedV1301.js`, `4302_QBO_ProductionPropertyReaderV1302.js`.

**Retained active administrative utility:** `3436_QBO_DailyFullExportMissingStarterRepair.js`, committed separately as `a1d2ecb`. The earlier daily-export production reliability changes were committed as `9823f99`.

## Implementation status

This document records the **approved target structure**, not proof that directories, `.claspignore`, or archive moves have already been applied to the user's local Mac repository. Before migration, inspect the existing `clasp` configuration and verify deployment exclusions; then move only the classified files and commit the documentation and archive changes separately.
