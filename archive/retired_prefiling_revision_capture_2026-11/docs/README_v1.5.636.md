# App 50 v1.5.636 — October-only scoped release (REVIEW BEFORE EXECUTION)

Add `1655_QBO_PrefilingRevisionScopedReleaseV15636.js` to the App 50 root. Retain v1.5.635 modules and v1.5.631 log exporters. `clasp push` installs a **new explicit entry point**; it does not run exports.

## Scope

Only revision `8ec4ff53-00e4-4d10-9eaf-c9a15d7e1af5`, request `fe715efe-b1a6-4e42-8bfc-884c6be10f82`, October period key `2610`, date bounds 2026-10-01 through 2026-10-31. Scope is checked against registry-selected live request in `load()` before mutation. The release is intentionally one-off; do not reuse it for another revision. Earlier v1.5.635 remains production-disabled.

## Preview first

Run `previewRegistryQboPrefilingIntegratedGateV15636()` with no parameters. Expected: authorized scope true, request `REQUESTED`, next family `GL`, prior certified true, next unwritten true, `Production_Release_Enabled:true`, `Safe_To_Start_Revision_Capture:true`, zero writes. **Stop and review output before any export.**

## Explicit one-family execution (only after preview approval)

The Apps Script function dropdown cannot pass an argument. Invoke in a controlled execution context:
`runOneQboPrefilingIntegratedCaptureV15636('CONFIRM_ONE_REVISION_EXPORT')`
Each invocation performs at most one family and writes the in-flight marker before calling its exporter. The expected sequence is GL, TSD, Recognition, each followed by independent certification and review. A failure leaves `CAPTURING` and must be recovered using v1.5.635; never blindly retry.

## Finalize separately

After all three families certify and the request is resumable, invoke:
`finalizeQboPrefilingIntegratedCaptureV15636('CONFIRM_REVISION_CAPTURE_COMPLETE')`
This marks the capture request complete; it does **not** publish a superseding prefiling manifest or file a Texas return.

## Safety

This patch authorizes real production exports **only** for the exact pinned revision. No exports or live writes were performed while preparing this patch. No automatic triggers, parameterless export function, or generic future-request release. Source syntax verified locally; full production runtime behavior is not proven by this packaging check. Keep older functions unchanged.
