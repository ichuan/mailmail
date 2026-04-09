// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod db;
mod models;
mod imap;
mod smtp;
mod plugin_host;

use std::sync::Arc;
use tokio::sync::Mutex;
use tauri::{Manager, State};
use crate::models::{Account, Email};
use crate::plugin_host::{PluginHost, TrackingPixelStripper};

struct AppState {
    db: Mutex<Option<db::Db>>,
    plugin_host: Mutex<PluginHost>,
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
async fn add_account(state: State<'_, Arc<AppState>>, account: Account) -> Result<(), String> {
    let guard = state.db.lock().await;
    get_db(&guard)?.insert_account(&account).await
}

#[tauri::command]
async fn delete_account(state: State<'_, Arc<AppState>>, id: String) -> Result<(), String> {
    let guard = state.db.lock().await;
    get_db(&guard)?.delete_account(&id).await
}

#[tauri::command]
async fn sync_inbox(state: State<'_, Arc<AppState>>, account: Account, limit_days: i64) -> Result<Vec<Email>, String> {
    log::info!("Starting sync_inbox for account: {}", account.email);
    let mut emails = imap::fetch_inbox(&account, limit_days).await?;

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
    }
    Ok(emails)
}

#[tauri::command]
async fn sync_folder(state: State<'_, Arc<AppState>>, account: Account, folder: String, limit_days: i64) -> Result<Vec<Email>, String> {
    log::info!("Syncing folder '{}' for account: {}", folder, account.email);
    let mut emails = imap::fetch_folder(&account, &folder, limit_days).await?;

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
async fn toggle_star(state: State<'_, Arc<AppState>>, id: String, starred: bool) -> Result<(), String> {
    let guard = state.db.lock().await;
    get_db(&guard)?.toggle_star(&id, starred).await
}

fn main() {
    let mut host = PluginHost::new();
    host.register(Box::new(TrackingPixelStripper));

    let state = Arc::new(AppState {
        db: Mutex::new(None),
        plugin_host: Mutex::new(host),
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
            get_cached_emails,
            delete_email,
            search_emails,
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            let app_dir = handle.path().app_data_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
            tauri::async_runtime::spawn(async move {
                match db::Db::init(app_dir).await {
                    Ok(db_pool) => {
                        *state.db.lock().await = Some(db_pool);
                        log::info!("Database initialized successfully");
                    }
                    Err(e) => log::error!("Failed to initialize database: {}", e),
                }
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
