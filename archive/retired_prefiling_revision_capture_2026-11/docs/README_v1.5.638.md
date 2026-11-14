# v1.5.638 — Date normalization and read-only TSD recovery preview

Install three new JS modules at App 50 project root; retain previous versions. Run `clasp push`.

Run only `previewOctoberTsdRecoveryV15638` and return the log. **Do not rerun exports, invoke recovery attachment, or finalize.**

The v1.5.638 certifier uses each workbook’s spreadsheet timezone to normalize Sheets Date objects to yyyy-MM-dd in both TSD and Recognition log comparisons and recovery candidate filtering. String dates are preserved. All other certification checks are inherited from v1.5.635. The v1.5.638 integrated gate references the corrected certifier but does not auto-execute.

The diagnostic requires the exact October request and already checkpointed TSD run/sequence; it performs independent certification and read-only recovery preview. It may still fail on other independent evidence issues; inspect those rather than rerunning the export. No production write has been executed by preparing this package.
