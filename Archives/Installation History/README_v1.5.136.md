# v1.5.136 — DAILY_FULL_EXPORT Administrative Pause/Resume

Adds DAILY_FULL_EXPORT-only governed administrative trigger control.

Safety contract:
- pause deletes only `startDailyQboExportSchedule`;
- pause never deletes `runNextScheduledQboExport`;
- pause never clears queue state or cancels run history;
- resume restores exactly one durable starter;
- resume does not call `startDailyQboExportSchedule()` or
  `resumeQboExportSchedule()`;
- duplicate starters fail closed;
- foreign triggers block resume;
- no other pipeline is mutation-authorized;
- generic 3430 mutation remains blocked.

This package includes an APPEND-ONLY 3490 wrapper fragment. Do not replace the
existing 3490 file with the fragment.

First runtime test only:
`previewDailyFullExportAdminPause()`

Do not execute the mutating pause/resume commands until the preview is reviewed.
