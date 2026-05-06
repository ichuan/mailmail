# Handover Status

> Last updated: 2026-05-06

## Current Baseline

- Frontend tests: `npm test` -> 18 files, 120 tests passing.
- Rust tests: `cd src-tauri && cargo test` -> 36 tests passing.
- Type checks: `cd src-tauri && cargo check` passes with existing dead-code warnings in `plugin_host.rs`.
- Stability work is now the active priority before large feature expansion.

## Stability Changes Completed

- IMAP IDLE now uses exponential reconnect backoff and emits `mail:connection-status` with `accountId`, status, failure count, and retry delay.
- SQLite is configured with WAL, `synchronous=NORMAL`, `busy_timeout`, `acquire_timeout`, and a larger pool.
- SMTP send has a 20s timeout and finite transient retry with 5s / 10s backoff.
- IMAP delete wraps `UID STORE` and `EXPUNGE` startup/stream consumption in timeouts.
- Attachment extraction skips attachments over 10MB and skips further attachments after 50MB per email.
- HTML email links only open external URLs with `http` or `https` schemes.
- Frontend iframe/Tauri listeners, compose timers, undo-send timers, and toast timers now clean up on unmount.
- Zustand email state is bounded per account/folder; Toast UI is capped at five visible items.

## Residual Risks

- `mailparse` still requires full message body parsing before attachment size checks; true streaming attachment protection requires IMAP BODYSTRUCTURE / partial fetch work.
- Release logs are important for stability diagnosis but may include email addresses in some existing log lines. Decide whether to redact or hash account identifiers.
- Frontend search still scans in-memory emails for body text. Large mailbox search should move toward SQLite search or indexing.

## Recommended Next Work

1. Run weak-network manual tests: disconnect/reconnect, server timeout, IDLE recovery.
2. Run large attachment tests around 10MB and 50MB thresholds.
3. Review release log privacy policy.
4. Only after P0 validation, resume feature work such as labels, configurable shortcuts, OAuth2, and PGP.