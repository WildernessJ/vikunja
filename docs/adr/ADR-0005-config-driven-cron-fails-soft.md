---
status: Enacted
date: 2026-07-17
deciders: Jason
phase: —
---

# ADR-0005: Config-driven cron schedules fail soft, not fatal

## Context

Vikunja registers background cron jobs at server startup (reminders, token cleanup,
export cleanup, etc.). Every existing `Register*Cron` passes a **hardcoded literal**
schedule to `cron.Schedule` and, on the registration error, calls `log.Fatalf` — which
exits the process. That is fine when the schedule is a constant the developer controls:
the error path is effectively unreachable at runtime.

The scheduled-backup feature introduced the first cron whose schedule comes from
**operator-supplied free-form config** (`backup.schedule`). Reusing the `log.Fatalf`
convention there means a single typo in that value — e.g. a 6-field (seconds) cron
string, a common output of online cron generators — crashes the entire API on every
startup until an admin fixes it. The blast radius (the whole task manager is down) is
wildly disproportionate to the fault (one optional feature misconfigured).

## Decision

A cron whose schedule originates from user/operator config must **fail soft**: on a
registration/parse error, log at the highest non-fatal severity (`log.Criticalf`) with a
message that names the offending config key and the parse error, then return without
registering the job. The server continues to start; only that job is disabled until the
config is corrected. `log.Fatalf` remains correct for crons with hardcoded schedules,
where a failure is a developer bug, not a config typo.

## Alternatives considered

- **A — Keep `log.Fatalf` (match the existing convention):** rejected. Turns an
  optional-feature config typo into a total outage; users lose access to all their tasks
  because of a backup-schedule mistake.
- **B — Silently skip on error (`log.Errorf` + return), the original implementation:**
  rejected. For a backup feature this is the worst failure mode — the instance boots
  "healthy" with backups silently off, discovered only when a restore is needed and none
  exist. Failure masking.
- **C — Fail soft with a loud, specific CRITICAL log (chosen):** keeps the instance
  serving, but makes the misconfiguration unmissable at boot and names exactly what to
  fix. The feature is opt-in, so the operator who just enabled it is watching the logs.

## Consequences

- **Positive:** a malformed schedule can never take the instance down; the error is
  actionable (names the key + expected format); establishes the rule for any future
  config-driven cron.
- **Negative / trade-offs:** a misconfigured schedule leaves the job disabled rather than
  running — the operator must notice the log line (mitigated by the loud, specific
  message and the opt-in nature). The codebase now carries two intentional patterns for
  cron-registration failure (fatal for literals, soft for config), applied by judgment.

## Confirmation

`pkg/modules/dump/backup/backup.go` `RegisterBackupCron` uses `log.Criticalf` + `return`
(not `log.Fatalf`) on a `cron.Schedule` error. Live-verified: booting with a 6-field
`backup.schedule` logs the message and the server keeps listening. Any new config-driven
cron registrar should follow this — reviewer checklist item.

## Links

- Related ADRs: —
