use crate::models::{Account, Email, AttachmentWithData, Attachment};
use mailparse::parse_mail;
use ammonia;
use futures::StreamExt;
use std::time::Duration;
use std::borrow::Cow;
use async_imap::extensions::idle::IdleResponse;
use tauri::Emitter;

/// Remove all `url(...)` references from a CSS value string.
/// Prevents CSS-based tracking pixels that could send HTTP requests even without
/// JavaScript (e.g. `background: url(https://tracker.example/pixel.gif)`).
/// Handles unquoted, single-quoted, and double-quoted url() forms.
fn strip_css_url_refs(style: &str) -> String {
    let mut out = String::with_capacity(style.len());
    let mut tail = style;
    loop {
        let lower_tail = tail.to_ascii_lowercase();
        match lower_tail.find("url(") {
            None => {
                out.push_str(tail);
                break;
            }
            Some(i) => {
                out.push_str(&tail[..i]);
                let rest = &tail[i + 4..];
                // Skip to matching ')' — handles quoted and unquoted forms
                match rest.find(')') {
                    Some(j) => tail = &rest[j + 1..],
                    None => break, // malformed CSS, stop safely
                }
            }
        }
    }
    out
}

/// Parse an RFC 5322 From header value into (display_name, email_address).
///
/// Handles the most common formats:
///   "John Doe <john@example.com>"  → ("John Doe",    "john@example.com")
///   '"John Doe" <john@example.com>'→ ("John Doe",    "john@example.com")
///   "<john@example.com>"           → ("john@example.com", "john@example.com")
///   "john@example.com"             → ("john@example.com", "john@example.com")
///
/// Multiple addresses (e.g. Reply-To lists) use only the first address.
fn parse_from_header(from: &str) -> (String, String) {
    // Take only the first address from a comma-separated list.
    let first = from.split(',').next().unwrap_or(from).trim();

    if let Some(start) = first.find('<') {
        if let Some(end) = first.rfind('>') {
            let email = first[start + 1..end].trim().to_string();
            let raw_name = first[..start].trim();
            // Strip surrounding double or single quotes from the display name.
            let display_name = if raw_name.len() >= 2
                && ((raw_name.starts_with('"') && raw_name.ends_with('"'))
                    || (raw_name.starts_with('\'') && raw_name.ends_with('\'')))
            {
                raw_name[1..raw_name.len() - 1].trim().to_string()
            } else {
                raw_name.to_string()
            };
            let display = if display_name.is_empty() { email.clone() } else { display_name };
            return (display, email);
        }
    }

    // No angle brackets — the whole string is treated as the email address.
    let addr = first.to_string();
    (addr.clone(), addr)
}

/// Decode RFC 2047 encoded words that mailparse::get_value() may leave undecoded
/// (e.g. folded multi-line subjects, non-standard whitespace between encoded words).
/// Handles Q-encoding and B-encoding; uses mailparse re-parse for non-UTF-8 charsets.
fn decode_rfc2047(input: &str) -> String {
    if !input.contains("=?") {
        return input.to_string();
    }
    let mut result = String::new();
    let bytes = input.as_bytes();
    let len = bytes.len();
    let mut i = 0;

    while i < len {
        if i + 1 < len && bytes[i] == b'=' && bytes[i + 1] == b'?' {
            let start = i;
            i += 2;
            let Some(cs_end) = bytes[i..].iter().position(|&b| b == b'?').map(|p| i + p) else {
                result.push_str(&String::from_utf8_lossy(&bytes[start..]));
                break;
            };
            let charset = &bytes[i..cs_end];
            i = cs_end + 1;
            if i >= len {
                result.push_str(&String::from_utf8_lossy(&bytes[start..]));
                break;
            }
            let enc = bytes[i].to_ascii_uppercase();
            i += 1;
            if i >= len || bytes[i] != b'?' {
                result.push_str(&String::from_utf8_lossy(&bytes[start..]));
                continue;
            }
            i += 1;
            let payload_start = i;
            let mut found_end = false;
            while i + 1 < len {
                if bytes[i] == b'?' && bytes[i + 1] == b'=' {
                    found_end = true;
                    break;
                }
                i += 1;
            }
            if !found_end {
                result.push_str(&String::from_utf8_lossy(&bytes[start..]));
                break;
            }
            let payload = &bytes[payload_start..i];
            i += 2;

            let decoded_bytes = match enc {
                b'Q' => decode_q_encoded(payload),
                b'B' => decode_base64_bytes(payload),
                _ => payload.to_vec(),
            };
            let cs_str = String::from_utf8_lossy(charset).to_lowercase();
            if cs_str == "utf-8" || cs_str == "utf8" {
                result.push_str(&String::from_utf8_lossy(&decoded_bytes));
            } else if cs_str == "iso-8859-1" || cs_str == "latin1" {
                result.extend(decoded_bytes.iter().map(|&b| b as char));
            } else {
                // For other charsets, re-parse through mailparse which has charset support
                let fake = format!("X: =?{}?{}?{}?=\r\n",
                    String::from_utf8_lossy(charset), enc as char, String::from_utf8_lossy(payload));
                match mailparse::parse_header(fake.as_bytes()) {
                    Ok((hdr, _)) => {
                        let val = hdr.get_value();
                        if val.contains("=?") {
                            result.push_str(&String::from_utf8_lossy(&decoded_bytes));
                        } else {
                            result.push_str(&val);
                        }
                    }
                    Err(_) => result.push_str(&String::from_utf8_lossy(&decoded_bytes)),
                }
            }

            // RFC 2047 §6.2: drop whitespace between adjacent encoded words
            let ws_start = i;
            while i < len && (bytes[i] == b' ' || bytes[i] == b'\t' || bytes[i] == b'\r' || bytes[i] == b'\n') {
                i += 1;
            }
            if i + 1 < len && bytes[i] == b'=' && bytes[i + 1] == b'?' {
                continue; // next token is encoded word — drop whitespace
            }
            result.push_str(&String::from_utf8_lossy(&bytes[ws_start..i]));
        } else {
            result.push(bytes[i] as char);
            i += 1;
        }
    }
    result
}

fn decode_q_encoded(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len());
    let mut i = 0;
    while i < data.len() {
        match data[i] {
            b'_' => { out.push(b' '); i += 1; }
            b'=' if i + 2 < data.len() => {
                let hi = hex_nibble(data[i + 1]);
                let lo = hex_nibble(data[i + 2]);
                if let (Some(h), Some(l)) = (hi, lo) {
                    out.push(h << 4 | l);
                    i += 3;
                } else {
                    out.push(data[i]);
                    i += 1;
                }
            }
            b => { out.push(b); i += 1; }
        }
    }
    out
}

fn hex_nibble(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'A'..=b'F' => Some(b - b'A' + 10),
        b'a'..=b'f' => Some(b - b'a' + 10),
        _ => None,
    }
}

fn decode_base64_bytes(data: &[u8]) -> Vec<u8> {
    const TABLE: [u8; 128] = {
        let mut t = [0xFFu8; 128];
        let mut c = 0u8;
        while c < 26 { t[(b'A' + c) as usize] = c; c += 1; }
        c = 0;
        while c < 26 { t[(b'a' + c) as usize] = 26 + c; c += 1; }
        c = 0;
        while c < 10 { t[(b'0' + c) as usize] = 52 + c; c += 1; }
        t[b'+' as usize] = 62;
        t[b'/' as usize] = 63;
        t
    };
    let filtered: Vec<u8> = data.iter().copied()
        .filter(|&b| b != b'\r' && b != b'\n' && b != b' ' && b != b'\t')
        .collect();
    let mut out = Vec::with_capacity(filtered.len() * 3 / 4);
    for chunk in filtered.chunks(4) {
        let mut buf = [0u8; 4];
        let mut valid = 0usize;
        for (j, &b) in chunk.iter().enumerate() {
            if b == b'=' { break; }
            if (b as usize) < 128 && TABLE[b as usize] != 0xFF {
                buf[j] = TABLE[b as usize];
                valid = j + 1;
            }
        }
        if valid >= 2 { out.push(buf[0] << 2 | buf[1] >> 4); }
        if valid >= 3 { out.push(buf[1] << 4 | buf[2] >> 2); }
        if valid >= 4 { out.push(buf[2] << 6 | buf[3]); }
    }
    out
}

fn extract_body_recursive<'a>(part: &mailparse::ParsedMail<'a>, body_text: &mut String, body_html: &mut String) {
    if part.subparts.is_empty() {
        let mimetype = part.ctype.mimetype.to_lowercase();
        if mimetype == "text/html" {
            if let Ok(html) = part.get_body() {
                if body_html.is_empty() { *body_html = html; }
            }
        } else if mimetype == "text/plain" {
            if let Ok(text) = part.get_body() {
                if body_text.is_empty() { *body_text = text; }
            }
        }
    } else {
        for subpart in &part.subparts {
            extract_body_recursive(subpart, body_text, body_html);
        }
    }
}

/// Walk MIME tree and collect non-text, non-multipart parts as attachments.
fn extract_attachments_recursive<'a>(
    email_id: &str,
    part: &mailparse::ParsedMail<'a>,
    result: &mut Vec<AttachmentWithData>,
    index: &mut usize,
) {
    if part.subparts.is_empty() {
        let mimetype = part.ctype.mimetype.to_lowercase();
        // Skip body text parts — only collect genuine attachment parts.
        if mimetype.starts_with("text/plain") || mimetype.starts_with("text/html") {
            return;
        }
        // Treat as attachment if Content-Disposition is Attachment or if it's not text/* or multipart/*.
        let disp = part.get_content_disposition();
        let is_inline_without_cid = matches!(disp.disposition, mailparse::DispositionType::Inline)
            && disp.params.get("filename").is_none()
            && part.ctype.params.get("name").is_none();
        if is_inline_without_cid {
            return; // skip embedded content with no filename
        }

        if let Ok(data) = part.get_body_raw() {
            if data.is_empty() { return; }
            let filename = disp.params.get("filename")
                .or_else(|| part.ctype.params.get("name"))
                .cloned()
                .unwrap_or_else(|| {
                    let ext = mimetype.split('/').nth(1).unwrap_or("bin");
                    format!("attachment_{}.{}", *index, ext)
                });
            let size = data.len() as i64;
            let id = format!("{}_att_{}", email_id, *index);
            *index += 1;
            result.push(AttachmentWithData {
                meta: Attachment {
                    id,
                    email_id: email_id.to_string(),
                    filename,
                    mime_type: mimetype,
                    size,
                },
                data,
            });
        }
    } else {
        for subpart in &part.subparts {
            extract_attachments_recursive(email_id, subpart, result, index);
        }
    }
}

/// Map a logical folder name ("inbox", "sent", "trash") to a real IMAP mailbox name
/// and SELECT it on the given session. On success returns the actual mailbox name used.
async fn select_folder(
    session: &mut async_imap::Session<tokio_native_tls::TlsStream<tokio::net::TcpStream>>,
    folder: &str,
) -> Result<String, String> {
    let folder_lower = folder.to_lowercase();
    match folder_lower.as_str() {
        "inbox" => {
            session.select("INBOX").await.map_err(|e| e.to_string())?;
            Ok("INBOX".to_string())
        }
        "sent" => {
            for name in &["[Gmail]/Sent Mail", "Sent", "Sent Items", "INBOX.Sent"] {
                if session.select(name).await.is_ok() {
                    return Ok((*name).to_string());
                }
            }
            Err("Could not find Sent folder on this server".into())
        }
        "trash" => {
            for name in &["[Gmail]/Trash", "Trash", "Deleted Items", "INBOX.Trash"] {
                if session.select(name).await.is_ok() {
                    return Ok((*name).to_string());
                }
            }
            Err("Could not find Trash folder on this server".into())
        }
        other => {
            session.select(other).await.map_err(|e| e.to_string())?;
            Ok(other.to_string())
        }
    }
}

/// Verify credentials by opening and immediately closing an IMAP session.
/// Used by the "Test Connection" button in AddAccountView before saving.
pub async fn test_connection(account: &Account) -> Result<(), String> {
    let mut session = connect_imap(account).await?;
    let _ = session.logout().await;
    Ok(())
}

/// Connect to IMAP and return an authenticated session
async fn connect_imap(account: &Account) -> Result<async_imap::Session<tokio_native_tls::TlsStream<tokio::net::TcpStream>>, String> {
    let stream = tokio::net::TcpStream::connect((account.imap_server.as_str(), account.imap_port)).await
        .map_err(|e| format!("Could not connect to TCP server: {}", e))?;

    let connector = native_tls::TlsConnector::builder()
        .danger_accept_invalid_certs(true)
        .danger_accept_invalid_hostnames(true)
        .build()
        .map_err(|e| format!("Build TLS error: {}", e))?;

    let connector = tokio_native_tls::TlsConnector::from(connector);
    let tls_stream = connector.connect(account.imap_server.as_str(), stream).await
        .map_err(|e| format!("Could not perform TLS handshake: {}", e))?;

    let mut client = async_imap::Client::new(tls_stream);
    let _greeting = client.read_response().await;

    let session = client
        .login(&account.username, &account.password)
        .await
        .map_err(|(err, _client)| {
            // async_imap formats NO-response errors as:
            //   no response: code: None, info: Some("<imap-tagged-text>")
            // Extract just the IMAP response text for a human-readable message.
            let s = err.to_string();
            let prefix = "info: Some(\"";
            let clean = if let Some(idx) = s.find(prefix) {
                let after = &s[idx + prefix.len()..];
                if let Some(end) = after.rfind('"') {
                    after[..end].to_string()
                } else {
                    s.clone()
                }
            } else {
                s
            };
            format!("Login failed: {}", clean)
        })?;

    Ok(session)
}

/// Fetch emails from a specific IMAP folder.
/// Returns `(emails, raw_attachments)` so the caller can persist both.
pub async fn fetch_folder(account: &Account, folder: &str, days_limit: i64) -> Result<(Vec<Email>, Vec<AttachmentWithData>), String> {
    let mut session = connect_imap(account).await?;

    let mailbox = match select_folder(&mut session, folder).await {
        Ok(m) => m,
        Err(e) => {
            let _ = session.logout().await;
            return Err(e);
        }
    };

    let date_cutoff = chrono::Utc::now() - chrono::Duration::days(days_limit);
    let search_query = format!("SINCE {}", date_cutoff.format("%d-%b-%Y"));
    log::info!("IMAP Search in {}: {}", mailbox, search_query);

    let uids = session.uid_search(&search_query).await.map_err(|e| e.to_string())?;
    let mut uid_vec: Vec<u32> = uids.into_iter().collect();
    uid_vec.sort_unstable_by(|a, b| b.cmp(a));
    uid_vec.truncate(50);

    if uid_vec.is_empty() {
        log::info!("No emails found in {} matching criteria.", mailbox);
        let _ = session.logout().await;
        return Ok((Vec::new(), Vec::new()));
    }

    let uid_set = uid_vec.into_iter().map(|u| u.to_string()).collect::<Vec<_>>().join(",");
    // UID FETCH automatically includes the UID in every response item (RFC 3501 §6.4.8),
    // so msg.uid will always be Some(n) — unlike plain FETCH where it would be None.
    let mut messages = session.uid_fetch(&uid_set, "RFC822").await.map_err(|e| e.to_string())?;

    let mut emails = Vec::new();
    let mut all_attachments: Vec<AttachmentWithData> = Vec::new();

    while let Some(msg_result) = messages.next().await {
        let msg = match msg_result {
            Ok(m) => m,
            Err(_) => continue,
        };

        let body = match msg.body() {
            Some(b) => b,
            None => continue,
        };

        if let Ok(parsed) = parse_mail(body) {
            let subject = parsed.headers.iter().find(|h| h.get_key().eq_ignore_ascii_case("Subject"))
                .map(|h| decode_rfc2047(&h.get_value())).unwrap_or_else(|| "(No Subject)".to_string());

            let from = parsed.headers.iter().find(|h| h.get_key().eq_ignore_ascii_case("From"))
                .map(|h| decode_rfc2047(&h.get_value())).unwrap_or_else(|| "Unknown".to_string());

            let to_header = [
                "To",
                "Delivered-To",
                "X-Original-To",
            ]
            .iter()
            .find_map(|name| {
                parsed.headers.iter()
                    .find(|h| h.get_key().eq_ignore_ascii_case(name))
                    .map(|h| h.get_value())
                    .filter(|v| !v.is_empty())
            })
            .unwrap_or_default();

            let date_str = parsed.headers.iter().find(|h| h.get_key().eq_ignore_ascii_case("Date"))
                .map(|h| h.get_value()).unwrap_or_default();

            let timestamp = if !date_str.is_empty() {
                chrono::DateTime::parse_from_rfc2822(&date_str)
                    .map(|dt| dt.naive_utc().and_utc().to_rfc3339())
                    .unwrap_or_else(|_| chrono::Utc::now().to_rfc3339())
            } else {
                chrono::Utc::now().to_rfc3339()
            };

            let mut body_text = String::new();
            let mut body_html = String::new();
            extract_body_recursive(&parsed, &mut body_text, &mut body_html);

                let clean_html = if !body_html.is_empty() {
                // Use ammonia Builder to:
                // - Preserve inline style attributes so HTML email layouts render correctly
                // - Allow img tags so embedded images are visible (frontend can hide them)
                // - Strip url() from style values to block CSS-based tracking pixels
                let cleaned = ammonia::Builder::default()
                    .add_tags(&["img"])
                    .add_tag_attributes("img", &["src", "alt", "width", "height", "style"])
                    .add_generic_attributes(&["style"])
                    .attribute_filter(|_element, attribute, value| {
                        if attribute == "style" {
                            // Remove url() references from inline styles to prevent
                            // CSS tracking pixels (e.g. background:url(tracker.gif))
                            Some(Cow::Owned(strip_css_url_refs(value)))
                        } else {
                            Some(Cow::Borrowed(value))
                        }
                    })
                    .clean(&body_html)
                    .to_string();
                Some(cleaned)
            } else {
                None
            };

            let preview = body_text.chars().take(100).collect::<String>();

            let uid = msg.uid.unwrap_or(0);
                // Split the raw From header into display name and email address.
                // Before this change both fields contained the full "Name <addr>" string.
                let (sender_display, sender_addr) = parse_from_header(&from);
                emails.push(Email {
                // Deterministic ID prevents the same email getting a new ID
                // on every background sync, which would orphan selectedEmailId
                // and wipe the readIds Set in the frontend.
                id: format!("{}_{}_{}" , account.id, folder.to_lowercase(), uid),
                account_id: account.id.clone(),
                folder: folder.to_lowercase(),
                uid,
                sender: sender_display,
                sender_email: sender_addr,
                recipient: to_header,
                subject,
                preview,
                body_html: clean_html,
                body_text: Some(body_text),
                timestamp,
                read: false,
                starred: false,
                has_attachments: false, // updated below after extracting MIME attachments
            });
            // Extract attachment parts from the MIME tree for this email.
            let email_id = format!("{}_{}_{}", account.id, folder.to_lowercase(), msg.uid.unwrap_or(0));
            let mut att_index = 0usize;
            extract_attachments_recursive(&email_id, &parsed, &mut all_attachments, &mut att_index);
            if att_index > 0 {
                if let Some(last) = emails.last_mut() {
                    last.has_attachments = true;
                }
            }
        }
    }

    drop(messages);
    let _ = session.logout().await;

    Ok((emails, all_attachments))
}

/// Backward-compatible wrapper
pub async fn fetch_inbox(account: &Account, days_limit: i64) -> Result<(Vec<Email>, Vec<AttachmentWithData>), String> {
    fetch_folder(account, "inbox", days_limit).await
}

/// List available IMAP folders for an account
pub async fn list_folders(account: &Account) -> Result<Vec<String>, String> {
    let mut session = connect_imap(account).await?;
    let folders_stream = session.list(None, Some("*")).await.map_err(|e| e.to_string())?;

    let mut folders = Vec::new();
    let collected: Vec<_> = folders_stream.collect().await;
    for item in collected {
        if let Ok(name) = item {
            folders.push(name.name().to_string());
        }
    }

    let _ = session.logout().await;
    Ok(folders)
}

/// Permanently delete an email from the server by UID.
/// Marks the message with \Deleted then issues EXPUNGE.
pub async fn delete_email_on_server(account: &Account, folder: &str, uid: u32) -> Result<(), String> {
    let mut session = connect_imap(account).await?;

    select_folder(&mut session, folder).await?;

    // Flag the UID as \Deleted; wrap in Box::pin so the stream is Unpin
    let mut flag_stream = Box::pin(
        session
            .uid_store(&uid.to_string(), "+FLAGS (\\Deleted)")
            .await
            .map_err(|e| format!("UID STORE failed: {}", e))?,
    );
    while let Some(result) = flag_stream.next().await {
        result.map_err(|e| format!("UID STORE error: {}", e))?;
    }
    drop(flag_stream);

    // Expunge all \Deleted messages in the selected mailbox
    let mut expunge_stream = Box::pin(
        session
            .expunge()
            .await
            .map_err(|e| format!("EXPUNGE failed: {}", e))?,
    );
    while let Some(result) = expunge_stream.next().await {
        result.map_err(|e| format!("EXPUNGE error: {}", e))?;
    }
    drop(expunge_stream);

    let _ = session.logout().await;
    Ok(())
}

/// Long-running IMAP IDLE watcher for a single account's INBOX.
///
/// Opens a dedicated IMAP connection, enters IDLE mode, and emits the Tauri
/// event `"mail:new"` whenever the server notifies us of new messages.
/// Re-enters IDLE every 25 minutes to comply with RFC 2177 (< 29-minute limit).
/// Reconnects automatically on any connection error.
///
/// Designed to run inside a `tokio::spawn` task. Call `JoinHandle::abort()`
/// to stop it when its account is removed.
pub async fn idle_watcher(account: Account, app_handle: tauri::AppHandle) {
    let email = account.email.clone();

    'reconnect: loop {
        // Establish a fresh dedicated IDLE connection.
        let mut session = match connect_imap(&account).await {
            Ok(s) => s,
            Err(e) => {
                log::warn!("IDLE [{}]: connect failed — {}", email, e);
                tokio::time::sleep(Duration::from_secs(30)).await;
                continue 'reconnect;
            }
        };

        if let Err(e) = session.select("INBOX").await {
            log::warn!("IDLE [{}]: SELECT INBOX failed — {}", email, e);
            tokio::time::sleep(Duration::from_secs(15)).await;
            continue 'reconnect;
        }

        log::info!("IDLE [{}]: watching INBOX", email);

        // Inner loop: IDLE → wait → DONE → repeat.
        // Each cycle waits up to 25 min before re-issuing IDLE (RFC 2177 recommends < 29 min).
        'idle_loop: loop {
            // `session.idle()` moves the session into the Handle.
            let mut handle = session.idle();

            if let Err(e) = handle.init().await {
                log::warn!("IDLE [{}]: IDLE init failed — {}", email, e);
                // Handle (and the session inside it) will be dropped here.
                break 'idle_loop; // triggers reconnect
            }

            // wait_with_timeout borrows &mut handle via the '_ lifetime on the returned future.
            // After the future is awaited (consumed), the borrow ends and handle is accessible again.
            let (wait_fut, _stop_src) = handle.wait_with_timeout(Duration::from_secs(25 * 60));
            let response = match wait_fut.await {
                Ok(r) => r,
                Err(e) => {
                    log::warn!("IDLE [{}]: wait error — {}", email, e);
                    break 'idle_loop; // handle dropped here, triggers reconnect
                }
            };

            // Send DONE and recover the session for the next IDLE cycle.
            session = match handle.done().await {
                Ok(s) => s,
                Err(e) => {
                    log::warn!("IDLE [{}]: DONE error — {}", email, e);
                    break 'idle_loop; // triggers reconnect
                }
            };

            if matches!(response, IdleResponse::NewData(_)) {
                log::info!("IDLE [{}]: new mail detected", email);
                if let Err(e) = app_handle.emit("mail:new", ()) {
                    log::warn!("IDLE [{}]: failed to emit mail:new — {}", email, e);
                }
            }
            // On Timeout or ManualInterrupt: just loop and re-enter IDLE.
        }

        // Brief back-off before reconnecting after a connection/protocol error.
        tokio::time::sleep(Duration::from_secs(15)).await;
    }
}

#[cfg(test)]
mod tests {
    use super::{strip_css_url_refs, parse_from_header};

    #[test]
    fn test_strip_css_url_unquoted() {
        let input = "background: url(https://tracker.example/pixel.gif); color: red;";
        let result = strip_css_url_refs(input);
        assert!(!result.contains("url("), "url() should be removed");
        assert!(result.contains("color: red"), "non-url properties preserved");
    }

    #[test]
    fn test_strip_css_url_double_quoted() {
        let input = r#"background-image: url("https://example.com/bg.png")"#;
        let result = strip_css_url_refs(input);
        assert!(!result.contains("url("));
        assert!(result.contains("background-image:"));
    }

    #[test]
    fn test_strip_css_url_single_quoted() {
        let input = "background: url('https://example.com/tracker.gif') no-repeat;";
        let result = strip_css_url_refs(input);
        assert!(!result.contains("url("));
        assert!(result.contains("no-repeat"));
    }

    #[test]
    fn test_strip_css_url_case_insensitive() {
        let input = "background: URL(https://tracker.example/pixel.gif);";
        let result = strip_css_url_refs(input);
        assert!(!result.to_lowercase().contains("url("));
    }

    #[test]
    fn test_strip_css_url_no_urls() {
        let input = "color: red; font-size: 14px; margin: 0;";
        let result = strip_css_url_refs(input);
        assert_eq!(result, input, "style without urls should be unchanged");
    }

    #[test]
    fn test_strip_css_url_multiple() {
        let input = "background: url(a.gif); border-image: url(b.png); color: blue;";
        let result = strip_css_url_refs(input);
        assert!(!result.contains("url("));
        assert!(result.contains("color: blue"));
    }

    #[test]
    fn test_parse_from_name_and_email() {
        let (name, email) = parse_from_header("John Doe <john@example.com>");
        assert_eq!(name, "John Doe");
        assert_eq!(email, "john@example.com");
    }

    #[test]
    fn test_parse_from_quoted_name() {
        let (name, email) = parse_from_header("\"John Doe\" <john@example.com>");
        assert_eq!(name, "John Doe");
        assert_eq!(email, "john@example.com");
    }

    #[test]
    fn test_parse_from_angle_only() {
        let (name, email) = parse_from_header("<john@example.com>");
        assert_eq!(name, "john@example.com");
        assert_eq!(email, "john@example.com");
    }

    #[test]
    fn test_parse_from_bare_email() {
        let (name, email) = parse_from_header("john@example.com");
        assert_eq!(name, "john@example.com");
        assert_eq!(email, "john@example.com");
    }

    #[test]
    fn test_parse_from_multiple_takes_first() {
        let (name, email) = parse_from_header("Alice <a@example.com>, Bob <b@example.com>");
        assert_eq!(name, "Alice");
        assert_eq!(email, "a@example.com");
    }

    #[test]
    fn test_parse_from_whitespace_trimmed() {
        let (name, email) = parse_from_header("  Jane  <  jane@example.com  >  ");
        assert_eq!(name, "Jane");
        assert_eq!(email, "jane@example.com");
    }
}

