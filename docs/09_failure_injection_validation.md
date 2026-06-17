# Failure injection validation

Use this checklist before release builds that touch account sync, send, storage, or security prompts.

## Scope

Validate that common failures stay diagnosable, do not leak credentials or email addresses in logs, and recover without corrupting cached mail.

## Matrix

| Case | Injection | Expected result |
| --- | --- | --- |
| Bad IMAP password | Add or edit a test account with an invalid app password. | Connection test and sync fail with an auth error; account health moves to manual action required. |
| Unreachable IMAP server | Use `203.0.113.1` as IMAP host or block the app with a local firewall rule. | Sync fails as retryable network/timeout; cached emails remain visible. |
| TLS/certificate failure | Use the correct host with a wrong TLS port or a test server with an invalid certificate. | Failure is classified as TLS/settings related, not auth. |
| Unreachable SMTP server | Use an invalid SMTP host on a test account and send a draft. | Send fails, draft contents remain in the compose view, undo-send state clears. |
| Attachment risk prompt | Save an attachment with an executable extension from a test message. | User is prompted; decision is recorded in the security audit log. |
| Remote image prompt | Enable remote images from Settings. | User sees the tracking warning before the setting changes. |
| Database path unavailable | Move the configured data directory temporarily or remove write access in a test profile. | Startup or cache writes fail visibly; existing keychain credentials are not logged. |
| Background IDLE reconnect | Disconnect network while app is open, then restore it. | Account health changes to degraded/reconnecting, then healthy after reconnect. |

## Log review

After each case, inspect app logs and browser console:

- No saved account password appears.
- Email addresses are redacted or replaced with account IDs.
- Error messages keep enough context to distinguish auth, network, TLS, DB, and plugin failures.

## Recovery checks

- Restore the valid account settings and network.
- Run manual sync.
- Open a previously cached email and a newly synced email.
- Send a small test message.
- Confirm the security audit section still loads.

