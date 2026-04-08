# MailMail Windows Client

A minimalistic, privacy-focused native Windows 11 email client built with Tauri v2, Rust, and React.

## Environment Requirements

- **OS**: Windows 11 (exclusively tested on Windows/MSVC).
- **Node**: v18+ (verified with `npm`).
- **Rust**: The latest stable Rust toolchain (usually installed via `rustup`).
- **Build Tools**: Visual Studio C++ Build Tools (required by Tauri on Windows).

## Quick Start & Debugging

If you are a developer looking to run, test, or troubleshoot the MailMail client locally, follow these exact steps:

### 1. Install Node Dependencies
Ensure all frontend and Tauri CLI dependencies are installed:
```powershell
npm install
```

### 2. Start the Development Server
This will automatically compile the Rust backend, bind to the Vite React dev server, and open the native Windows client:
```powershell
npx @tauri-apps/cli dev
```

### 3. Log Troubleshooting
If any background errors occur (e.g., IMAP sync failures, SQLite errors, TLS panics), you can view the backend Rust logs in the same terminal window where you ran `npx @tauri-apps/cli dev`.

Common log hints:
- **`[INFO]`**: Standard status items like "TCP and TLS Connected" or "Attempting login as..."
- **`[ERROR]`**: Errors like `sync_inbox error: Failed to login: imap parsing error` indicate issues with credentials, port numbers, or server incompatibilities.

## Project Structure
- `src-tauri/src/main.rs` & `imap.rs`: Core IMAP logic using `async-imap` and Tauri v2 IPC bindings.
- `src/`: The React 19 Frontend using `Tailwind CSS v4` and `lucide-react` for fully localized, offline UI rendering.
- `docs/`: Reference documentation on the architecture and migration status.
- **[Handover Status](file:///d:/projects/mailmail/docs/03_handover_status.md)**: Critical technical context for AI and developers.
