# v1.5.129 — Phase B Trigger Apply Safety Contract

Adds the mutation preflight/fail-closed layer.

## Public validation

Run:

`validateQboPipelineTriggerApplySafety()`

This executes the already validated:
- registry completeness audit, and
- trigger reconciliation dry-run plan,

then evaluates explicit apply gates.

## Gates

- registry completeness valid
- reconciliation plan valid
- no foreign triggers
- no proposed excess deletion
- no proposed creation
- explicit confirmation token match for future apply requests
- global apply enable

## Global hard disable

`QBO_TRIGGER_APPLY_GLOBAL_ENABLED_ = false`

Therefore trigger mutation cannot be authorized in v1.5.129.

The future apply entry point exists only to prove fail-closed behavior:

`applyQboPipelineTriggerReconciliation(confirmationToken)`

Even with the exact token it cannot mutate:
1. global apply is false; and
2. this version contains no mutation implementation.

Do not run the apply function for routine validation. Validate only with:

`validateQboPipelineTriggerApplySafety()`

## Expected validation result

Current known trigger state should produce:
- registry completeness valid = true
- reconciliation plan valid = true
- no foreign triggers = true
- no creates/deletes = true
- confirmation-token gate = false (none supplied to validation)
- global-apply gate = false
- mutationAuthorized = false

`allPreMutationGatesPass` is expected false in the no-token validation because
the explicit confirmation token is intentionally absent.

## Safety

No trigger creation/deletion, no property mutation, no workbook/Drive write,
no resume, no State Application activation.
