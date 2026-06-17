# MailMail hardening plan

Date: 2026-06-17

Goal: reduce account-data exposure, make mailbox reads lighter, and close the highest-value readiness gaps without broad refactors.

## Steps

1. Saved-account IPC uses `accountId`
   - Change sync/send/delete/list-folder commands to resolve saved accounts in Rust.
   - Keep add-account and test-connection accepting full account data because passwords are not saved yet.
   - Verify: focused Rust DB tests, Rust tests, frontend typecheck/tests.

2. Body-on-demand mail loading
   - Keep list/search queries from loading full message bodies.
   - Add a focused command for loading the selected message body.
   - Verify: DB query tests plus frontend selection behavior.

3. Query/search groundwork
   - Add practical SQLite indexes for common folder/search queries.
   - Verify: migration test coverage and existing query tests.

4. Private logging
   - Redact email-like values before logging account operations.
   - Verify: redaction unit tests.

5. Security audit log UI
   - Expose recent audit events from the backend and show them in Settings.
   - Verify: frontend tests and typecheck.

6. Failure-injection validation
   - Add a repeatable checklist for weak network, bad credentials, and backend failure cases.
   - Verify: documentation review plus quality gate.

