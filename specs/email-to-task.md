# email-to-task Specification

## Purpose

Vikunja SHALL turn emails forwarded to a per-project address into tasks (subject → title, body → description, attachments preserved), ingesting mail by polling an admin-configured IMAP mailbox — frictionless GTD capture into the Inbox project or any other.

## Invariants

- Vikunja MUST NEVER delete mail from the polled mailbox; processed and rejected messages are only marked seen (and optionally moved to a configured folder).
- IMAP credentials MUST NEVER appear in logs; message bodies MUST NOT be logged either.
- A poll-cycle failure (connection refused, auth failure, malformed message) MUST NOT crash the server or block later cycles; it logs and retries next tick.
- The same message MUST NEVER produce two tasks: the poll cursor tracks IMAP UID **together with UIDVALIDITY** (a UIDVALIDITY change invalidates the UID cursor and triggers reconciliation), and a **permanent** store of processed `Message-ID`s is the fallback dedup across cursor resets and restarts. The store is never time-purged — a purge window would reopen the duplicate path on mailbox recreation; at personal capture volumes (rows are one short string each) permanence is the cheaper correctness guarantee.
- Inbound HTML MUST pass through a server-side sanitizer before being stored as a task description. (No backend sanitizer exists today — this feature introduces one; there is nothing to reuse.)
- The inbound address token is a capability: possession of the address suffices to create tasks in that project; regenerating the token invalidates the old address immediately. If the enabling user has been deleted or no longer has write access to the project, the token is treated as disabled (messages are marked seen, logged, and produce no task) until a project admin re-enables.
- Resource bounds: task descriptions derived from mail bodies are truncated at a fixed cap (64 KB); MIME parsing enforces a nesting-depth cap; attachment size limits reuse the existing `files.maxsize` enforcement.

## Requirements

### Requirement: Inbound mailbox configuration

A new `mailer.inbound` config section SHALL define: enabled flag, IMAP host/port/TLS, username, password, poll interval (default 60s), and the address pattern (a base address using plus-addressing, e.g. `vikunja+<token>@host`). When disabled (default), no polling occurs and project settings hide the feature.

#### Scenario: Disabled by default

- **GIVEN** a default config
- **WHEN** the server starts
- **THEN** no IMAP connection is attempted

### Requirement: Per-project inbound address

Each project SHALL support enabling mail-in, which generates a random token (≥16 chars, URL-safe) mapping the address `<base>+<token>@<domain>` to the project. The project settings UI shows the full address with copy button, and offers disable and regenerate. The user who enables it is recorded as the task creator for mail arriving on that token.

#### Scenario: Enable generates address

- **GIVEN** a project where the user has admin access
- **WHEN** the user enables email-in
- **THEN** the response contains the full inbound address with a fresh token

#### Scenario: Edge case: regenerate invalidates old token

- **GIVEN** a project with mail-in token `abc`
- **WHEN** the user regenerates and a message later arrives addressed to `+abc`
- **THEN** no task is created

#### Scenario: Edge case: orphaned enabler suspends the token

- **GIVEN** a project whose mail-in was enabled by user U
- **WHEN** U loses write access (or is deleted) and a message arrives on the token
- **THEN** no task is created and the message is marked seen

### Requirement: Recipient token extraction

The recipient token SHALL be extracted by checking, in order: every `Delivered-To` occurrence top-to-bottom (headers are prepended per hop, so topmost = the final delivery into the polled mailbox — the hop that carries our token), then `X-Original-To`, then every address in `To` and `Cc`. The first address matching the configured base pattern wins. (Forwarding and BCC topologies routinely drop the token from `To` — header order matters and is normative.)

#### Scenario: Token only in Delivered-To

- **GIVEN** a message whose `To` is an unrelated address but whose `Delivered-To` is P's token address
- **WHEN** the poll cycle runs
- **THEN** the task is created in P

### Requirement: Message to task mapping

For each unseen message whose recipient token matches an active project token, Vikunja SHALL create a task: subject → title (trimmed, fallback `(no subject)`); body → description using the `text/plain` part, else HTML through the new server-side sanitizer, truncated at the cap; file attachments → task attachments via the existing attachment pipeline, respecting `files.maxsize` (oversize attachments are skipped, the task is still created).

#### Scenario: Plain email becomes task

- **GIVEN** project P with mail-in enabled by user U
- **WHEN** a message with subject "Renew passport" and a text body arrives at P's address
- **THEN** P contains a new task "Renew passport" with the body as description, created by U

#### Scenario: Attachments preserved

- **GIVEN** a message with a 2 MB PDF attachment addressed to P
- **WHEN** it is processed
- **THEN** the created task has the PDF as a task attachment

#### Scenario: Edge case: unmatched token

- **GIVEN** a message addressed to `+nonexistent`
- **WHEN** the poll cycle runs
- **THEN** no task is created and the message is marked seen (not reprocessed next cycle)

#### Scenario: Edge case: UIDVALIDITY reset does not duplicate

- **GIVEN** a message already processed (its Message-ID recorded)
- **WHEN** the mailbox's UIDVALIDITY changes and the message is seen again under a new UID
- **THEN** no second task is created

## Success Criteria

- **SC-001**: All scenarios pass under `mage test:filter` against the processor with a fake IMAP client (behavioral tests through the real model layer; live-IMAP paths are covered by manual verification — full e2e is infeasible without a mail server in CI, accepted deviation).
- **SC-002**: A kill/restart between poll cycles does not duplicate or lose messages (UID+UIDVALIDITY cursor plus Message-ID store persisted).
- **SC-003**: Project settings E2E: enable → address shown → regenerate changes it.

## Non-Goals

- No built-in SMTP listener and no provider webhooks — IMAP polling only (deployment decision 2026-07-05).
- No enrichment-syntax parsing (`@label`, `p1`, dates) in subject/body — plain capture only in v1.
- No reply-to-comment threading (emails never append to existing tasks).
- No per-user (as opposed to per-project) inbound addresses.
