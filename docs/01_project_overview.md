# Project Overview: MailMail Desktop

## Background & Motivation
The goal of this project is to build a hyper-lightweight, extremely fast, and privacy-focused multi-account email client exclusively for Windows 11. 
The user was dissatisfied with existing solutions (e.g., Mailspring, modern Outlook) for the following reasons:
1. **Bloat:** Existing clients rely heavily on Electron, consuming massive amounts of RAM and leading to slow startup times.
2. **Privacy Issues:** The new Outlook forces synchronization of personal emails to Microsoft's cloud servers, which is a major privacy violation for the user (who runs self-hosted mail servers and Gmail).
3. **Complexity:** Existing clients add unnecessary features like smart filtering, calendar sync, and snoozing.

## Core Requirements (Current Scope)
- **Minimalist UX:** Essentialist design strongly inspired by Apple's "Mail.app" clean design but leveraging standard Windows 11 aesthetics (e.g., Mica effects, rounded corners, clean typography).
- **Unified Inbox:** Primary UI aggregates all emails from all connected accounts effortlessly.
- **Sync Limits:** To maintain performance, the client defaults to a **30-day sync window** (configurable to 60 or 90 days), preventing local database and memory bloat from decades of history.
- **Strictly Local:** Zero middleman servers. The client speaks directly to user-defined IMAP/SMTP servers.

## Technical Constraints & Decisions
*   **Tauri v2:** Used for native performance and minimal memory footprint.
*   **App Passwords Only:** Purely traditional IMAP/SMTP authentication. No OAuth2 overhead.
*   **Recursive Body Extraction:** Complex multi-part emails (Mixed/Alternative) are recursively traversed to find the best HTML/Plaintext content.
*   **Sanitization:** All incoming HTML is piped through the `ammonia` crate in backend Rust to strip malicious scripts and tracking pixels before rendering in the frontend.
