use crate::models::{Account, Email, AttachmentWithData, Attachment};
use mailparse::parse_mail;
use ammonia;
use futures::StreamExt;
use std::time::Duration;
use async_imap::extensions::idle::IdleResponse;
use tauri::Emitter;

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
        .map_err(|(err, _client)| format!("Failed to login: {}", err))?;

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
                .map(|h| h.get_value()).unwrap_or_else(|| "(No Subject)".to_string());

            let from = parsed.headers.iter().find(|h| h.get_key().eq_ignore_ascii_case("From"))
                .map(|h| h.get_value()).unwrap_or_else(|| "Unknown".to_string());

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
                // - Allow img tags so embedded images are visible (frontend can hide them with CSS)
                // The style attribute can contain tracking URLs; this is an accepted tradeoff
                // consistent with standard email client behavior.
                let cleaned = ammonia::Builder::default()
                    .add_tags(&["img"])
                    .add_tag_attributes("img", &["src", "alt", "width", "height", "style"])
                    .add_generic_attributes(&["style"])
                    .clean(&body_html)
                    .to_string();
                Some(cleaned)
            } else {
                None
            };

            let preview = body_text.chars().take(100).collect::<String>();

            let uid = msg.uid.unwrap_or(0);
            emails.push(Email {
                // Deterministic ID prevents the same email getting a new ID
                // on every background sync, which would orphan selectedEmailId
                // and wipe the readIds Set in the frontend.
                id: format!("{}_{}_{}" , account.id, folder.to_lowercase(), uid),
                account_id: account.id.clone(),
                folder: folder.to_lowercase(),
                uid,
                sender: from.clone(),
                sender_email: from,
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
