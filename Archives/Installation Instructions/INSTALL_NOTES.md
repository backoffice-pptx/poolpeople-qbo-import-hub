# V1338 controlled production installation — NO RESTART

Validated against Nov 4 00:06 source export. The only change to 24_TriggerManagement.js is one call before token creation.

1. Keep production scheduler PAUSED.
2. Backup production source.
3. Copy exactly the two .js files into the production Apps Script source. Do not copy the lab code.
4. Confirm source diff and successful save. Do NOT run the daily starter, scheduler, worker, watchdog, resume, or replay.
5. Return with confirmation and a read-only scheduler preflight log for restart decision.

This is not authorization to resume the scheduler. Isolated tests use synthetic history; production read-only state must be checked again after installation.
