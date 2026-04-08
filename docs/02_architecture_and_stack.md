# Architecture & Tech Stack (Windows Native Native Version)

## Frontend (Presentation Layer)
- **Framework:** React 19 + TypeScript + Vite.
- **State Management:** `zustand` (`src/store.ts`).
    - Standardizes data structures across different IMAP servers.
    - Manages global preferences like `syncLimitDays`.
- **UI & Icons:** Lucide-React for icons (ensures offline reliability).
- **Native Context:** Interacts with the native OS via `@tauri-apps/api`. Includes dynamic window resizing for a "native card" feel for Settings vs. Inbox.

## Backend (Data & Native Layer)
- **Framework:** Tauri v2.
- **Dependencies (Critical for Windows):**
    - `tokio-native-tls`: Replaced `async-native-tls` to solve "unexpected EOF" handshake issues on Windows SChannel.
    - `async-imap`: Configured with `runtime-tokio` feature.
    - `sqlx`: SQLite backend with foreign keys enabled (`PRAGMA foreign_keys = ON`).
    - `serde`: Utilizes `#[serde(rename_all = "camelCase")]` across all models to ensure compatibility with JavaScript property names.
    - `ammonia`: Sanitizes HTML emails in the Rust layer.

## Implementation Specifics
1. **The Handshake Gotcha**: On Windows, the default `tokio-util` compat layer can cause IMAP handshake failures. We use a direct `tokio-native-tls` connector.
2. **Recursive Parsing**: `imap.rs` implements a recursive subpart crawler because nested `multipart/mixed` emails often place the actual content several layers deep.
3. **Synchronization Logic**:
    - Triggered via `invoke("sync_inbox")`.
    - Uses IMAP `SEARCH SINCE <Date>` to enforce limits.
    - Truncates to 50 latest messages per sync cycle for memory safety.
    - Returns full JSON objects mapped correctly to `camelCase` for direct Zustand ingestion.
