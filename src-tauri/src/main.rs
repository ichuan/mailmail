// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod models;
mod imap;
mod smtp;
mod plugin_host;

use std::sync::Arc;
use std::collections::HashMap;
use tokio::sync::Mutex;
use tauri::{AppHandle, Manager, State};
use crate::models::{Account, Email, Signature, Attachment};
use crate::plugin_host::{PluginHost, TrackingPixelStripper};

struct AppState {
    db: Mutex<Option<db::Db>>,
    plugin_host: Mutex<PluginHost>,
    /// Per-account IMAP IDLE background tasks. Abort a handle to stop its watcher.
    idle_tasks: Mutex<HashMap<String, tokio::task::JoinHandle<()>>>,
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

fn get_db(db_opt: &Option<db::Db>) -> Result<&db::Db, String> {
    db_opt.as_ref().ok_or_else(|| "Database not initialized".to_string())
}

#[tauri::command]
async fn get_accounts(state: State<'_, Arc<AppState>>) -> Result<Vec<Account>, String> {
    let guard = state.db.lock().await;
    get_db(&guard)?.get_accounts().await
}

#[tauri::command]
async fn add_account(
    state: State<'_, Arc<AppState>>,
    app_handle: AppHandle,
    account: Account,
) -> Result<(), String> {
    {
        let guard = state.db.lock().await;
        get_db(&guard)?.insert_account(&account).await?;
    }
    start_idle_for_account((*state).clone(), account, app_handle).await;
    Ok(())
}

#[tauri::command]
async fn delete_account(state: State<'_, Arc<AppState>>, id: String) -> Result<(), String> {
    {
        let guard = state.db.lock().await;
        get_db(&guard)?.delete_account(&id).await?;
    }
    // Abort the IDLE watcher task for this account.
    let mut tasks = state.idle_tasks.lock().await;
    if let Some(handle) = tasks.remove(&id) {
        handle.abort();
        log::info!("IDLE: watcher aborted for account {}", id);
    }
    Ok(())
}

#[tauri::command]
async fn sync_inbox(state: State<'_, Arc<AppState>>, account: Account, limit_days: i64) -> Result<Vec<Email>, String> {
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
async fn sync_folder(state: State<'_, Arc<AppState>>, account: Account, folder: String, limit_days: i64) -> Result<Vec<Email>, String> {
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
async fn get_cached_emails(state: State<'_, Arc<AppState>>, account_id: String, folder: String) -> Result<Vec<Email>, String> {
    let guard = state.db.lock().await;
    get_db(&guard)?.get_emails_by_folder(&account_id, &folder).await
}

#[tauri::command]
async fn delete_email(
    state: State<'_, Arc<AppState>>,
    account: Account,
    folder: String,
    uid: u32,
    email_id: String,
) -> Result<(), String> {
    log::info!("Deleting UID {} from folder '{}' for account: {}", uid, folder, account.email);
    imap::delete_email_on_server(&account, &folder, uid).await?;
    let guard = state.db.lock().await;
    get_db(&guard)?.delete_email(&email_id).await
}

#[tauri::command]
async fn search_emails(state: State<'_, Arc<AppState>>, account_id: String, folder: String, query: String) -> Result<Vec<Email>, String> {
    let guard = state.db.lock().await;
    get_db(&guard)?.search_emails(&account_id, &folder, &query).await
}

#[tauri::command]
async fn list_folders(_state: State<'_, Arc<AppState>>, account: Account) -> Result<Vec<String>, String> {
    imap::list_folders(&account).await
}

#[tauri::command]
async fn send_email(
    state: State<'_, Arc<AppState>>,
    account: Account,
    to: String,
    subject: String,
    body: String,
    in_reply_to: Option<String>,
) -> Result<(), String> {
    log::info!("Sending email from {} to {}", account.email, to);

    // Run backend plugin pipeline before sending
    let mut processed_body = body;
    {
        let host = state.plugin_host.lock().await;
        host.run_on_email_before_send(&to, &subject, &mut processed_body)?;
    }

    smtp::send_email(&account, &to, &subject, &processed_body, in_reply_to.as_deref()).await
}

#[tauri::command]
async fn get_setting(state: State<'_, Arc<AppState>>, key: String) -> Result<Option<String>, String> {
    let guard = state.db.lock().await;
    get_db(&guard)?.get_setting(&key).await
}

#[tauri::command]
async fn save_setting(state: State<'_, Arc<AppState>>, key: String, value: String) -> Result<(), String> {
    let guard = state.db.lock().await;
    get_db(&guard)?.set_setting(&key, &value).await
}

#[tauri::command]
async fn mark_email_read(state: State<'_, Arc<AppState>>, id: String, read: bool) -> Result<(), String> {
    let guard = state.db.lock().await;
    get_db(&guard)?.mark_email_read(&id, read).await
}

#[tauri::command]
async fn get_attachments(state: State<'_, Arc<AppState>>, email_id: String) -> Result<Vec<Attachment>, String> {
    let guard = state.db.lock().await;
    get_db(&guard)?.get_attachments_for_email(&email_id).await
}

/// Write attachment data from the DB cache to a file on disk.
/// `dest_path` is the full absolute path provided by the frontend (e.g. Downloads/report.pdf).
#[tauri::command]
async fn save_attachment(state: State<'_, Arc<AppState>>, id: String, dest_path: String) -> Result<(), String> {
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
async fn toggle_star(state: State<'_, Arc<AppState>>, id: String, starred: bool) -> Result<(), String> {
    let guard = state.db.lock().await;
    get_db(&guard)?.toggle_star(&id, starred).await
}

#[tauri::command]
async fn get_signatures(state: State<'_, Arc<AppState>>) -> Result<Vec<Signature>, String> {
    let guard = state.db.lock().await;
    get_db(&guard)?.get_signatures().await
}

#[tauri::command]
async fn save_signature(state: State<'_, Arc<AppState>>, signature: Signature) -> Result<(), String> {
    let guard = state.db.lock().await;
    get_db(&guard)?.upsert_signature(&signature).await
}

#[tauri::command]
async fn delete_signature(state: State<'_, Arc<AppState>>, id: String) -> Result<(), String> {
    let guard = state.db.lock().await;
    get_db(&guard)?.delete_signature(&id).await
}

fn main() {
    let mut host = PluginHost::new();
    host.register(Box::new(TrackingPixelStripper));

    let state = Arc::new(AppState {
        db: Mutex::new(None),
        plugin_host: Mutex::new(host),
        idle_tasks: Mutex::new(HashMap::new()),
    });

    tauri::Builder::default()
        .manage(state.clone())
        .plugin(tauri_plugin_log::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .invoke_handler(tauri::generate_handler![
            get_accounts,
            add_account,
            delete_account,
            sync_inbox,
            sync_folder,
            list_folders,
            send_email,
            get_setting,
            save_setting,
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
        ])
        .setup(move |app| {
            let handle = app.handle().clone();
            let app_dir = handle.path().app_data_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
            let state_setup = state.clone();
            let handle_idle = handle.clone();
            tauri::async_runtime::spawn(async move {
                match db::Db::init(app_dir).await {
                    Ok(db_pool) => {
                        *state_setup.db.lock().await = Some(db_pool);
                        log::info!("Database initialized successfully");
                        // Start IDLE watchers for all already-configured accounts.
                        let accounts = {
                            let guard = state_setup.db.lock().await;
                            match guard.as_ref() {
                                Some(db) => db.get_accounts().await.unwrap_or_default(),
                                None => vec![],
                            }
                        };
                        for account in accounts {
                            start_idle_for_account(
                                state_setup.clone(),
                                account,
                                handle_idle.clone(),
                            )
                            .await;
                        }
                    }
                    Err(e) => log::error!("Failed to initialize database: {}", e),
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
