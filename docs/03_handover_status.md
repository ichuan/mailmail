# AI Handover Status & Technical Context
*This document contains critical implementation details for the next AI assistant.*

## 🏁 Current Status: Plugin Architecture (Phase 1–4 Complete)
All previously listed features are complete. Plugin system fully implemented.

### ✅ Completed Milestones
1.  **Account CRUD**: Full SQLite integration. Deletion works with cascading foreign keys enabled.
2.  **IMAP Inbox Sync**:
    - **Handshake Resolved**: Uses `tokio-native-tls` to avoid EOF errors on Windows.
    - **Recursive Body Parsing**: Deeply nested HTML emails now display correctly.
    - **Global Sync Limit**: Users can choose 30/60/90 days in Settings, and Rust respects this via IMAP `SEARCH`.
3.  **UI/UX Native Polish**:
    - **Window Resizing**, **Lucide Migration**, **camelCase Serialization** fixed.
4.  **Multi-Folder Sync (Sent/Trash)**:
    - `sync_folder` Tauri command uses `select_folder()` helper for Gmail/standard/Outlook naming.
5.  **Compose/Send Email**: `ComposeView.tsx` + `smtp.rs` (lettre), Reply/Forward wired.
6.  **Settings Persistence**: `syncLimitDays` and other keys survive app restarts via SQLite.
7.  **Multi-Account Sync**: All accounts synced on startup and folder change.
8.  **Email Caching in SQLite** *(new)*:
    - `sync_folder`/`sync_inbox` now call `db.upsert_email()` after each IMAP fetch.
    - New `get_cached_emails(accountId, folder)` command reads from SQLite.
    - App startup and folder changes: show cached emails immediately, then refresh from IMAP in background.
9.  **Delete Email** *(new)*:
    - `imap::delete_email_on_server(account, folder, uid)`: UID STORE `\Deleted` + EXPUNGE.
    - `delete_email` Tauri command: IMAP delete → DB delete.
    - Trash button in reading view is now wired; removes email from store after success.
10. **Local Search** *(new)*:
    - `db.search_emails(account_id, folder, query)`: SQLite LIKE on subject/sender/body_text.
    - `search_emails` Tauri command registered.
    - Middle pane search bar with 300ms debounce and clear button (client-side filter over loaded emails).
    - `setSearchQuery` action added to store; `setFolder` resets search query.
11. **Test Coverage**:
    - **Rust (13 tests)**: all previous + `test_search_emails`.
    - **Frontend (12 tests)**: all previous + `removeEmail`, `clear selection on delete`, `search query / folder reset`.
12. **Plugin Architecture (Phase 1–4)**:
    - **Core Infrastructure**: EventBus (17 typed events), SlotRegistry (`<Slot>` React component), PluginManager (lifecycle + permission-gated PluginAPI), Permissions module.
    - **Store Integration**: Zustand actions emit EventBus events (folder:changed, email:selected, compose:open/close, email:deleted, settings:changed).
    - **UI Slots**: 5 extension points in App.tsx (sidebar:top/bottom, toolbar:actions, email-detail:header/footer).
    - **Built-in TS Plugins**: theme-switcher (sidebar:bottom), image-toggle (toolbar:actions).
    - **Context Menu Extensibility**: Plugin-contributed items rendered alongside built-in context menu entries.
    - **Rust Backend Plugins**: `MailPlugin` trait with 3 pipeline hooks (on_emails_fetched, on_email_before_display, on_email_before_send). `PluginHost` wired into sync_inbox, sync_folder, send_email. TrackingPixelStripper built-in strips 1×1 tracking pixels.
    - **Test Coverage**: 62 Vitest tests (8 files) + 19 Rust tests.

---

## 🛠️ Technical Documentation for Next Agent

### 1. The Rust Models (`src-tauri/src/models.rs`)
**CRITICAL**: Every field in Rust `Account` and `Email` structs MUST be serializable to `camelCase` for React to see them.
> [!IMPORTANT]
> If you add a field like `is_unread` in Rust, ensure the struct has `#[serde(rename_all = "camelCase")]`.

### 2. The IMAP Logic (`src-tauri/src/imap.rs`)
- Uses `select_folder()` helper that handles Gmail, standard IMAP, and Outlook folder names.
- `uid_store` and `expunge` streams must be wrapped in `Box::pin()` — they return non-`Unpin` streams.
- `extract_body_recursive` handles nested MIME parts. Do not replace with index-based access.

### 3. State Management (`src/store.ts`)
- Zustand is single source of truth.
- `searchQuery` resets to `''` when folder changes.
- `removeEmail` also clears `selectedEmailId` if the deleted email was selected.

---

## 🚀 Remaining Next Steps

1.  **IMAP IDLE / Background Syncing** (complex):
    - Spawn a Tokio task per account that maintains an IDLE connection.
    - Emit Tauri event `new_mail` when changes detected; frontend calls `sync_folder` on receive.
    - Requires `CancellationToken` or `oneshot` channel to stop when account is deleted.
2.  **Attachments**:
    - Detect `Content-Disposition: attachment` parts in `extract_body_recursive`.
    - Expose attachment list as metadata; add a save-to-disk button via Tauri dialog.
3.  **Security - Keychain**:
    - Passwords currently stored in plaintext SQLite. Migrate to system Keychain using `tauri-plugin-keychain`.

## 🐛 Known Gotchas
- **Window size permissions**: `core:window:allow-set-size` must be in `capabilities/default.json`.
- **Handshake EOF**: Port 993 = Implicit TLS (correct); Port 143 = StartTLS.
- **`npx @tauri-apps/cli dev` fails** on this machine (`cb.apply is not a function`). Use `npm run tauri:dev` instead.
