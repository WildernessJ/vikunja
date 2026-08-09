# Spec: scheduled config-driven backups

## Problem
Vikunja has `vikunja dump` / `vikunja restore` (full-instance zip: config + DB + files,
restore-compatible and forward-migratable) but no *scheduled* backup — dump is a manual
one-shot CLI command with no cron anywhere in the codebase. Self-hosters have no built-in
recurring backup.

## Intended behavior
A config-driven cron that periodically runs the existing `dump.Dump()` and prunes old
backups. Reuses the existing dump format (no new backup format, no new restore path).

New `backup:` config section (`pkg/config/config.go` keys + defaults, documented in
`config-raw.json`):

| Key                | Type   | Default              | Meaning                                            |
|--------------------|--------|----------------------|----------------------------------------------------|
| `backup.enabled`   | bool   | `false`              | Opt-in; off unless set                             |
| `backup.schedule`  | string | `"0 2 * * *"`        | robfig 5-field cron (daily 02:00 server time)      |
| `backup.path`      | string | `""` → `<rootpath>/backups` | Destination dir; `mkdir -p` at startup      |
| `backup.keep`      | int    | `7`                  | Keep newest N; `0` = keep all (no prune)           |

`RegisterBackupCron()` in `pkg/modules/dump/backup.go`, called from
`pkg/initialize/init.go` alongside the other `Register*Cron()` calls (after `cron.Init()`).

Scheduled job:
1. No-op + info log when `enabled=false`. Invalid `schedule` → `log.Fatalf` at startup
   (matches every other `Register*Cron`; silently booting with backups OFF is the worst
   failure mode for a backup feature). The scheduled *job body* never crashes the process
   (recover + log-and-continue).
2. `TryLock` a package mutex — dump loads whole DB + all files into memory; if the prior run
   is still going, skip this tick with a warning (no pile-up).
3. `mkdir -p path`; write `vikunja-dump_<timestamp>.zip` via existing `dump.Dump()`.
4. **On dump failure: delete the partial zip and log loudly** (error level), then return.
5. Prune: glob `vikunja-dump_*.zip` in the dir, sort by name descending (timestamp names sort
   chronologically), delete beyond `keep` (skip when `keep=0`). Only touches that glob.
6. `recover()` around the job body so a bad run never kills the scheduler.

## Out of scope (YAGNI)
No encryption, no off-box upload (S3/rsync — sync the dir externally), no "run now" trigger
(the `vikunja dump` CLI is that), no age-based retention, no runtime reschedule, no admin UI
(deferred; would need a settings table + reschedulable cron + license-gated v2 API + Vue view).

## Operational notes (document in config comment)
- The dump contains `config.yml` → DB credentials + `service.secret`. `backup.path` must be a
  restricted directory.
- Prune counts manual CLI dumps sharing the `vikunja-dump_*.zip` name toward keep-N →
  recommend a dedicated dir.
- `FullInitWithoutAsync` (the `dump`/`restore` CLI path) doesn't start cron, so manual dumps
  never collide with the scheduler.

## Test approach
Test-first on the seam that can corrupt data:
- `pruneBackups(dir, keep)` — keeps newest N; ignores non-matching files; `keep=0` no-ops;
  `keep>=count` no-ops.
- Partial-cleanup: simulated `dump.Dump()` failure leaves no `vikunja-dump_*.zip` behind.
- Invalid schedule string → returns error / skips, no panic.
- Integration: temp dir + test DB → one run produces a valid zip (leans on existing
  dump/`restore_test.go` coverage).
- Config default test: `backup.enabled` defaults `false`.
