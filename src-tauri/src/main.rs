// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod app_config;
mod db;
mod imap;
mod keychain;
mod models;
mod plugin_host;
mod smtp;

use crate::models::{Account, Attachment, Contact, Email, Signature};
use crate::plugin_host::{PluginHost, TrackingPixelStripper};
use std::collections::HashMap;
use std::path::PathBuf;
use std::process::Command;
use std::sync::Arc;
use tauri::{AppHandle, Manager, State};
use tokio::sync::Mutex;

struct AppState {
    db: Mutex<Option<db::Db>>,
    app_config_dir: Mutex<Option<PathBuf>>,
    data_dir: Mutex<Option<PathBuf>>,
    plugin_host: Mutex<PluginHost>,
    /// Per-account IMAP IDLE background tasks. Abort a handle to stop its watcher.
    idle_tasks: Mutex<HashMap<String, tokio::task::JoinHandle<()>>>,
}

fn get_configured_path(path: &Option<PathBuf>, name: &str) -> Result<PathBuf, String> {
    path.clone()
        .ok_or_else(|| format!("{} is not initialized", name))
}

/// Replace the "KEYCHAIN" sentinel in an account's password field with the real
/// password fetched from the OS keychain. No-op if the password is already plain.
async fn hydrate_password(account: &mut Account) -> Result<(), String> {
    if account.password == "KEYCHAIN" {
        let id = account.id.clone();
        account.password = tokio::task::spawn_blocking(move || keychain::get_password(&id))
            .await
            .map_err(|e| e.to_string())??;
    }
    Ok(())
}

/// Start (or restart) the IMAP IDLE watcher for a single account.
/// Aborts any pre-existing task for the same account ID.
async fn start_idle_for_account(state: Arc<AppState>, account: Account, app_handle: AppHandle) {
    let mut tasks = state.idle_tasks.lock().await;
    if let Some(old) = tasks.remove(&account.id) {
        old.abort();
    }
    let id = account.id.clone();
    let handle = tokio::spawn(async move {
        imap::idle_watcher(account, app_handle).await;
    });
    tasks.insert(id, handle);
}

async fn abort_idle_watchers(state: &Arc<AppState>) {
    let handles = {
        let mut tasks = state.idle_tasks.lock().await;
        tasks
            .drain()
            .map(|(_id, handle)| handle)
            .collect::<Vec<_>>()
    };
    for handle in handles {
        handle.abort();
        handle.await.ok();
    }
}

async fn start_idle_for_cached_accounts(state: Arc<AppState>, app_handle: AppHandle) {
    let accounts = {
        let guard = state.db.lock().await;
        match guard.as_ref() {
            Some(db) => db.get_accounts().await.unwrap_or_default(),
            None => vec![],
        }
    };

    for mut account in accounts {
        if let Err(e) = hydrate_password(&mut account).await {
            log::warn!("Could not hydrate password for {}: {}", account.email, e);
            continue;
        }
        start_idle_for_account(state.clone(), account, app_handle.clone()).await;
    }
}

fn get_db(db_opt: &Option<db::Db>) -> Result<&db::Db, String> {
    db_opt
        .as_ref()
        .ok_or_else(|| "Database not initialized".to_string())
}

#[tauri::command]
async fn get_accounts(state: State<'_, Arc<AppState>>) -> Result<Vec<Account>, String> {
    let guard = state.db.lock().await;
    let db = get_db(&guard)?;
    let mut accounts = db.get_accounts().await?;
    for account in &mut accounts {
        if account.password == "KEYCHAIN" {
            // Verify that the keychain entry still exists. If it was stored in a
            // non-persistent backend (e.g. mock keychain in one build, then wiped),
            // the entry will be gone. Clear the sentinel so later IMAP operations
            // fail with a clear "invalid credentials" rather than a cryptic
            // "No matching entry in secure storage" from every command handler.
            let id = account.id.clone();
            let ok = tokio::task::spawn_blocking(move || keychain::get_password(&id))
                .await
                .map(|r| r.is_ok())
                .unwrap_or(false);
            if !ok {
                log::warn!(
                    "Keychain entry missing for {}; clearing sentinel. Re-add the account to restore access.",
                    account.email
                );
                db.set_account_password(&account.id, "").await.ok();
                account.password = "".to_string();
            }
        } else if !account.password.is_empty() {
            // Plaintext password still in DB — migrate to OS keychain.
            let id = account.id.clone();
            let pw = account.password.clone();
            let id2 = id.clone();
            let stored = tokio::task::spawn_blocking(move || {
                keychain::store_password(&id, &pw)?;
                // Verify the entry is immediately readable; some backends (mock)
                // accept writes but don't persist across restarts.
                keychain::get_password(&id2)
            })
            .await
            .map_err(|e| e.to_string())?;
            if stored.is_ok() {
                db.set_account_password(&account.id, "KEYCHAIN").await.ok();
                account.password = "KEYCHAIN".to_string();
            }
            // If verify-read failed, leave plaintext in DB — safer than losing it.
        }
    }
    Ok(accounts)
}

#[tauri::command]
async fn add_account(
    state: State<'_, Arc<AppState>>,
    app_handle: AppHandle,
    mut account: Account,
) -> Result<(), String> {
    // Store real password in OS keychain; persist only the sentinel in SQLite.
    // Verify that the keychain is actually persistent by reading back immediately.
    let id = account.id.clone();
    let pw = account.password.clone();
    let id2 = id.clone();
    let keychain_ok = tokio::task::spawn_blocking(move || {
        keychain::store_password(&id, &pw)?;
        keychain::get_password(&id2)
    })
    .await
    .map(|r| r.is_ok())
    .unwrap_or(false);
    if keychain_ok {
        account.password = "KEYCHAIN".to_string();
    } else {
        log::warn!(
            "Keychain unavailable for {}; keeping plaintext password in DB.",
            account.email
        );
    }
    {
        let guard = state.db.lock().await;
        get_db(&guard)?.insert_account(&account).await?;
    }
    // Hydrate the real password before starting the IDLE watcher.
    hydrate_password(&mut account).await?;
    start_idle_for_account((*state).clone(), account, app_handle).await;
    Ok(())
}

#[tauri::command]
async fn delete_account(state: State<'_, Arc<AppState>>, id: String) -> Result<(), String> {
    {
        let guard = state.db.lock().await;
        get_db(&guard)?.delete_account(&id).await?;
    }
    // Remove the password from OS keychain.
    let id_kc = id.clone();
    tokio::task::spawn_blocking(move || keychain::delete_password(&id_kc))
        .await
        .ok();
    // Abort the IDLE watcher task for this account.
    let mut tasks = state.idle_tasks.lock().await;
    if let Some(handle) = tasks.remove(&id) {
        handle.abort();
        log::info!("IDLE: watcher aborted for account {}", id);
    }
    Ok(())
}

#[tauri::command]
async fn test_connection(account: Account) -> Result<String, String> {
    // Password is plain text here — this is called before the account is saved,
    // so there is no keychain entry yet. No hydration needed.
    imap::test_connection(&account).await?;
    Ok(format!("Connected to {} successfully", account.imap_server))
}

#[tauri::command]
async fn sync_inbox(
    state: State<'_, Arc<AppState>>,
    mut account: Account,
    limit_days: i64,
) -> Result<Vec<Email>, String> {
    hydrate_password(&mut account).await?;
    log::info!("Starting sync_inbox for account: {}", account.email);
    let (mut emails, raw_attachments) = imap::fetch_inbox(&account, limit_days).await?;

    // Run backend plugin pipeline on fetched emails
    {
        let host = state.plugin_host.lock().await;
        host.run_on_emails_fetched(&mut emails);
    }

    let guard = state.db.lock().await;
    if let Ok(db) = get_db(&guard) {
        for email in &emails {
            if let Err(e) = db.upsert_email(email).await {
                log::warn!("Cache write failed for email {}: {}", email.id, e);
            }
        }
        for att in &raw_attachments {
            if let Err(e) = db.insert_attachment(&att.meta, &att.data).await {
                log::warn!("Attachment cache write failed for {}: {}", att.meta.id, e);
            }
        }
    }
    Ok(emails)
}

#[tauri::command]
async fn sync_folder(
    state: State<'_, Arc<AppState>>,
    mut account: Account,
    folder: String,
    limit_days: i64,
) -> Result<Vec<Email>, String> {
    hydrate_password(&mut account).await?;
    log::info!("Syncing folder '{}' for account: {}", folder, account.email);
    let (mut emails, raw_attachments) = imap::fetch_folder(&account, &folder, limit_days).await?;

    // Run backend plugin pipeline on fetched emails
    {
        let host = state.plugin_host.lock().await;
        host.run_on_emails_fetched(&mut emails);
    }

    let guard = state.db.lock().await;
    if let Ok(db) = get_db(&guard) {
        for email in &emails {
            if let Err(e) = db.upsert_email(email).await {
                log::warn!("Cache write failed for email {}: {}", email.id, e);
            }
        }
        for att in &raw_attachments {
            if let Err(e) = db.insert_attachment(&att.meta, &att.data).await {
                log::warn!("Attachment cache write failed for {}: {}", att.meta.id, e);
            }
        }
    }
    Ok(emails)
}

#[tauri::command]
async fn get_cached_emails(
    state: State<'_, Arc<AppState>>,
    account_id: String,
    folder: String,
) -> Result<Vec<Email>, String> {
    let guard = state.db.lock().await;
    get_db(&guard)?
        .get_emails_by_folder(&account_id, &folder)
        .await
}

#[tauri::command]
async fn delete_email(
    state: State<'_, Arc<AppState>>,
    mut account: Account,
    folder: String,
    uid: u32,
    email_id: String,
) -> Result<(), String> {
    hydrate_password(&mut account).await?;
    log::info!(
        "Deleting UID {} from folder '{}' for account: {}",
        uid,
        folder,
        account.email
    );
    imap::delete_email_on_server(&account, &folder, uid).await?;
    let guard = state.db.lock().await;
    get_db(&guard)?.delete_email(&email_id).await
}

#[tauri::command]
async fn search_emails(
    state: State<'_, Arc<AppState>>,
    account_id: String,
    folder: String,
    query: String,
) -> Result<Vec<Email>, String> {
    let guard = state.db.lock().await;
    get_db(&guard)?
        .search_emails(&account_id, &folder, &query)
        .await
}

#[tauri::command]
async fn list_folders(
    _state: State<'_, Arc<AppState>>,
    mut account: Account,
) -> Result<Vec<String>, String> {
    hydrate_password(&mut account).await?;
    imap::list_folders(&account).await
}

#[tauri::command]
async fn send_email(
    state: State<'_, Arc<AppState>>,
    mut account: Account,
    to: String,
    subject: String,
    body: String,
    in_reply_to: Option<String>,
) -> Result<(), String> {
    hydrate_password(&mut account).await?;
    log::info!("Sending email from {} to {}", account.email, to);

    // Run backend plugin pipeline before sending
    let mut processed_body = body;
    {
        let host = state.plugin_host.lock().await;
        host.run_on_email_before_send(&to, &subject, &mut processed_body)?;
    }

    smtp::send_email(
        &account,
        &to,
        &subject,
        &processed_body,
        in_reply_to.as_deref(),
    )
    .await
}

#[tauri::command]
async fn get_setting(
    state: State<'_, Arc<AppState>>,
    key: String,
) -> Result<Option<String>, String> {
    let guard = state.db.lock().await;
    get_db(&guard)?.get_setting(&key).await
}

#[tauri::command]
async fn save_setting(
    state: State<'_, Arc<AppState>>,
    key: String,
    value: String,
) -> Result<(), String> {
    let guard = state.db.lock().await;
    get_db(&guard)?.set_setting(&key, &value).await
}

#[tauri::command]
async fn get_data_dir(state: State<'_, Arc<AppState>>) -> Result<app_config::DataDirInfo, String> {
    let app_config_dir = {
        let guard = state.app_config_dir.lock().await;
        get_configured_path(&guard, "App config directory")?
    };
    let data_dir = {
        let guard = state.data_dir.lock().await;
        get_configured_path(&guard, "Data directory")?
    };
    Ok(app_config::data_dir_info(&app_config_dir, &data_dir))
}

#[tauri::command]
async fn open_data_dir(state: State<'_, Arc<AppState>>) -> Result<(), String> {
    let data_dir = {
        let guard = state.data_dir.lock().await;
        get_configured_path(&guard, "Data directory")?
    };

    if !data_dir.is_dir() {
        return Err(format!(
            "Data directory does not exist: {}",
            data_dir.display()
        ));
    }

    tokio::task::spawn_blocking(move || open_path_in_file_manager(data_dir))
        .await
        .map_err(|e| e.to_string())?
}

fn open_path_in_file_manager(path: PathBuf) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    let mut command = {
        let mut command = Command::new("explorer");
        command.arg(path);
        command
    };

    #[cfg(target_os = "macos")]
    let mut command = {
        let mut command = Command::new("open");
        command.arg(path);
        command
    };

    #[cfg(all(unix, not(target_os = "macos")))]
    let mut command = {
        let mut command = Command::new("xdg-open");
        command.arg(path);
        command
    };

    command
        .spawn()
        .map(|_| ())
        .map_err(|e| format!("Failed to open data directory: {}", e))
}

fn set_window_default_icon(app: &AppHandle, label: &str) {
    let Some(icon) = app.default_window_icon() else {
        log::warn!("Default window icon is not available");
        return;
    };

    let Some(window) = app.get_webview_window(label) else {
        log::warn!("Window '{}' is not available for icon update", label);
        return;
    };

    if let Err(err) = window.set_icon(icon.clone()) {
        log::warn!("Failed to set icon for window '{}': {}", label, err);
    }
}

#[tauri::command]
async fn set_data_dir(
    state: State<'_, Arc<AppState>>,
    app_handle: AppHandle,
    path: String,
) -> Result<app_config::DataDirInfo, String> {
    let app_config_dir = {
        let guard = state.app_config_dir.lock().await;
        get_configured_path(&guard, "App config directory")?
    };
    let current_data_dir = {
        let guard = state.data_dir.lock().await;
        get_configured_path(&guard, "Data directory")?
    };
    let next_data_dir = app_config::prepare_data_dir(std::path::Path::new(&path))?;

    if app_config::paths_equivalent(&current_data_dir, &next_data_dir) {
        return Ok(app_config::data_dir_info(
            &app_config_dir,
            &current_data_dir,
        ));
    }

    abort_idle_watchers(&state).await;
    if let Some(db) = state.db.lock().await.take() {
        db.close().await;
    }

    let migration = async {
        let copied_database =
            app_config::migrate_database_files(&current_data_dir, &next_data_dir)?;
        let db = match db::Db::init(next_data_dir.clone()).await {
            Ok(db) => db,
            Err(err) => {
                if copied_database {
                    app_config::remove_database_files(&next_data_dir).ok();
                }
                return Err(err);
            }
        };
        if let Err(err) = app_config::save_data_dir_config(&app_config_dir, &next_data_dir) {
            db.close().await;
            if copied_database {
                app_config::remove_database_files(&next_data_dir).ok();
            }
            return Err(err);
        }
        Ok::<_, String>((db, copied_database))
    };
    let (db, copied_database) = match migration.await {
        Ok(result) => result,
        Err(err) => match db::Db::init(current_data_dir.clone()).await {
            Ok(db) => {
                *state.db.lock().await = Some(db);
                start_idle_for_cached_accounts((*state).clone(), app_handle).await;
                return Err(err);
            }
            Err(restore_err) => {
                return Err(format!(
                    "{}; failed to restore previous data directory: {}",
                    err, restore_err
                ));
            }
        },
    };

    *state.db.lock().await = Some(db);
    *state.data_dir.lock().await = Some(next_data_dir.clone());
    if copied_database {
        if let Err(err) = app_config::remove_database_files(&current_data_dir) {
            log::warn!(
                "Failed to remove old database files from {}: {}",
                current_data_dir.display(),
                err
            );
        }
    }
    start_idle_for_cached_accounts((*state).clone(), app_handle).await;

    Ok(app_config::data_dir_info(&app_config_dir, &next_data_dir))
}

#[tauri::command]
async fn mark_email_read(
    state: State<'_, Arc<AppState>>,
    id: String,
    read: bool,
) -> Result<(), String> {
    let guard = state.db.lock().await;
    get_db(&guard)?.mark_email_read(&id, read).await
}

#[tauri::command]
async fn get_attachments(
    state: State<'_, Arc<AppState>>,
    email_id: String,
) -> Result<Vec<Attachment>, String> {
    let guard = state.db.lock().await;
    get_db(&guard)?.get_attachments_for_email(&email_id).await
}

/// Write attachment data from the DB cache to a file on disk.
/// `dest_path` is the full absolute path provided by the frontend (e.g. Downloads/report.pdf).
#[tauri::command]
async fn save_attachment(
    state: State<'_, Arc<AppState>>,
    id: String,
    dest_path: String,
) -> Result<(), String> {
    let guard = state.db.lock().await;
    let data = get_db(&guard)?.get_attachment_data(&id).await?;
    drop(guard);

    // Validate dest_path is not empty to avoid accidental root writes.
    if dest_path.is_empty() {
        return Err("dest_path must not be empty".to_string());
    }
    // Create parent directory if it doesn't exist.
    if let Some(parent) = std::path::Path::new(&dest_path).parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&dest_path, &data).map_err(|e| format!("Failed to write attachment: {}", e))?;
    Ok(())
}

#[tauri::command]
async fn toggle_star(
    state: State<'_, Arc<AppState>>,
    id: String,
    starred: bool,
) -> Result<(), String> {
    let guard = state.db.lock().await;
    get_db(&guard)?.toggle_star(&id, starred).await
}

#[tauri::command]
async fn get_signatures(state: State<'_, Arc<AppState>>) -> Result<Vec<Signature>, String> {
    let guard = state.db.lock().await;
    get_db(&guard)?.get_signatures().await
}

#[tauri::command]
async fn save_signature(
    state: State<'_, Arc<AppState>>,
    signature: Signature,
) -> Result<(), String> {
    let guard = state.db.lock().await;
    get_db(&guard)?.upsert_signature(&signature).await
}

#[tauri::command]
async fn delete_signature(state: State<'_, Arc<AppState>>, id: String) -> Result<(), String> {
    let guard = state.db.lock().await;
    get_db(&guard)?.delete_signature(&id).await
}

#[tauri::command]
async fn suggest_contacts(
    state: State<'_, Arc<AppState>>,
    query: String,
) -> Result<Vec<Contact>, String> {
    let guard = state.db.lock().await;
    get_db(&guard)?.suggest_contacts(&query).await
}

/// Escape HTML special characters to prevent injection in the print template.
fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// Open a native print dialog for an email.
/// Rust builds the complete print-ready HTML document (including @media print CSS),
/// writes it to a temp file, and opens a dedicated WebView window.
/// The window auto-triggers window.print() on load, plus shows a manual Print button.
#[tauri::command]
async fn print_email(
    app: AppHandle,
    subject: String,
    sender: String,
    sender_email: String,
    recipient: String,
    date: String,
    body_html: String,
) -> Result<(), String> {
    let html = format!(
        r#"<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>Print — {subject}</title>
<style>
@media print {{ @page {{ margin: 1.5cm; }} }}
body {{ font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 800px; margin: 0 auto; padding: 20px; color: #1a1a1a; }}
.print-header {{ border-bottom: 2px solid #004f96; padding-bottom: 12px; margin-bottom: 16px; }}
.print-header h1 {{ font-size: 18px; margin: 0 0 8px; color: #004f96; }}
.print-header .meta {{ font-size: 13px; color: #666; line-height: 1.6; }}
.print-body {{ font-size: 14px; line-height: 1.6; }}
.print-body img {{ max-width: 100%; }}
@media screen {{ .print-actions {{ text-align: center; margin-top: 24px; border-top: 1px solid #ddd; padding-top: 12px; }} .print-actions button {{ padding: 8px 24px; font-size: 14px; cursor: pointer; border: 1px solid #004f96; background: #004f96; color: white; border-radius: 4px; }} .print-actions button:hover {{ background: #003a75; }} }}
@media print {{ .print-actions {{ display: none; }} }}
</style></head><body>
<div class="print-header">
  <h1>{subject}</h1>
  <div class="meta">
    <div><strong>From:</strong> {sender} &lt;{sender_email}&gt;</div>
    <div><strong>To:</strong> {recipient}</div>
    <div><strong>Date:</strong> {date}</div>
  </div>
</div>
<div class="print-body">{body_html}</div>
<div class="print-actions"><button onclick="window.print()">Print</button></div>
<script>window.onload = function() {{ setTimeout(function() {{ window.print(); }}, 300); }};</script>
</body></html>"#,
        subject = html_escape(&subject),
        sender = html_escape(&sender),
        sender_email = html_escape(&sender_email),
        recipient = html_escape(&recipient),
        date = html_escape(&date),
        body_html = body_html, // already sanitized by ammonia
    );

    let temp = std::env::temp_dir().join("mailmail_print.html");
    std::fs::write(&temp, &html).map_err(|e| e.to_string())?;

    let file_url =
        url::Url::from_file_path(&temp).map_err(|_| "Failed to create file URL".to_string())?;

    // Close any existing print window before opening a new one
    if let Some(w) = app.get_webview_window("print") {
        let _ = w.close();
    }

    tauri::WebviewWindowBuilder::new(&app, "print", tauri::WebviewUrl::External(file_url))
        .title(format!("Print — {}", subject))
        .inner_size(800.0, 600.0)
        .build()
        .map_err(|e| e.to_string())?;
    set_window_default_icon(&app, "print");

    Ok(())
}

fn main() {
    let mut host = PluginHost::new();
    host.register(Box::new(TrackingPixelStripper));

    let state = Arc::new(AppState {
        db: Mutex::new(None),
        app_config_dir: Mutex::new(None),
        data_dir: Mutex::new(None),
        plugin_host: Mutex::new(host),
        idle_tasks: Mutex::new(HashMap::new()),
    });

    tauri::Builder::default()
        .manage(state.clone())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_accounts,
            add_account,
            delete_account,
            test_connection,
            sync_inbox,
            sync_folder,
            list_folders,
            send_email,
            get_setting,
            save_setting,
            get_data_dir,
            open_data_dir,
            set_data_dir,
            mark_email_read,
            toggle_star,
            get_signatures,
            save_signature,
            delete_signature,
            get_attachments,
            save_attachment,
            get_cached_emails,
            delete_email,
            search_emails,
            print_email,
            suggest_contacts,
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            set_window_default_icon(&handle, "main");
            let app_dir = handle
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            let state_setup = state.clone();
            let handle_idle = handle.clone();
            tauri::async_runtime::spawn(async move {
                let data_dir = match app_config::resolve_initial_data_dir(&app_dir) {
                    Ok(data_dir) => data_dir,
                    Err(e) => {
                        log::error!("Failed to resolve data directory: {}", e);
                        return;
                    }
                };
                *state_setup.app_config_dir.lock().await = Some(app_dir.clone());
                *state_setup.data_dir.lock().await = Some(data_dir.clone());
                match db::Db::init(data_dir).await {
                    Ok(db_pool) => {
                        *state_setup.db.lock().await = Some(db_pool);
                        log::info!("Database initialized successfully");
                        start_idle_for_cached_accounts(state_setup.clone(), handle_idle.clone())
                            .await;
                    }
                    Err(e) => log::error!("Failed to initialize database: {}", e),
                }
            });
            // In debug builds, auto-open DevTools so JS console errors are visible
            // in the terminal/DevTools window instead of being silently swallowed.
            #[cfg(debug_assertions)]
            if let Some(win) = app.get_webview_window("main") {
                win.open_devtools();
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
