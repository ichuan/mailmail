use sqlx::{sqlite::{SqliteConnectOptions, SqlitePoolOptions}, SqlitePool, Row};
use std::str::FromStr;
use std::path::PathBuf;

#[derive(Clone)]
pub struct Db {
    pub pool: SqlitePool,
}

impl Db {
    pub async fn init(app_dir: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&app_dir).unwrap_or_default();
        let db_path = app_dir.join("mailmail.sqlite");

        let conn_opts = SqliteConnectOptions::from_str(&format!("sqlite://{}", db_path.display()))
            .map_err(|e| e.to_string())?
            .create_if_missing(true)
            .pragma("foreign_keys", "ON");

        let pool = SqlitePoolOptions::new()
            .max_connections(5)
            .connect_with(conn_opts)
            .await
            .map_err(|e| e.to_string())?;

        let db = Db { pool };
        db.create_tables().await?;
        Ok(db)
    }

    async fn create_tables(&self) -> Result<(), String> {
        let queries = [
            r#"
            CREATE TABLE IF NOT EXISTS accounts (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                email TEXT NOT NULL,
                imap_server TEXT NOT NULL,
                imap_port INTEGER NOT NULL,
                smtp_server TEXT NOT NULL,
                smtp_port INTEGER NOT NULL,
                username TEXT NOT NULL,
                password TEXT NOT NULL
            );
            "#,
            r#"
            CREATE TABLE IF NOT EXISTS emails (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                folder TEXT NOT NULL,
                uid INTEGER NOT NULL,
                sender TEXT,
                sender_email TEXT,
                recipient TEXT DEFAULT '',
                subject TEXT,
                preview TEXT,
                body_text TEXT,
                body_html TEXT,
                timestamp TEXT NOT NULL,
                is_read BOOLEAN NOT NULL DEFAULT 0,
                FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
            );
            "#,
            r#"
            CREATE UNIQUE INDEX IF NOT EXISTS emails_account_uid_idx ON emails (account_id, folder, uid);
            "#,
            r#"
            CREATE TABLE IF NOT EXISTS settings (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            );
            "#,
        ];

        for q in queries {
            sqlx::query(q).execute(&self.pool).await.map_err(|e| e.to_string())?;
        }

        // Migration: add recipient column to existing databases that predate this field.
        // Ignoring the error is intentional — SQLite returns "duplicate column name" if it
        // already exists, which is harmless.
        let _ = sqlx::query("ALTER TABLE emails ADD COLUMN recipient TEXT DEFAULT ''")
            .execute(&self.pool)
            .await;

        // Clean up rows where uid=0, which were created by a bug where FETCH without
        // explicit UID data item caused msg.uid to always be None. IMAP UIDs start at 1.
        let _ = sqlx::query("DELETE FROM emails WHERE uid = 0")
            .execute(&self.pool)
            .await;

        Ok(())
    }

    pub async fn insert_account(&self, account: &crate::models::Account) -> Result<(), String> {
        let q = r#"
            INSERT INTO accounts (id, name, email, imap_server, imap_port, smtp_server, smtp_port, username, password)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        "#;

        sqlx::query(q)
            .bind(&account.id)
            .bind(&account.name)
            .bind(&account.email)
            .bind(&account.imap_server)
            .bind(&account.imap_port)
            .bind(&account.smtp_server)
            .bind(&account.smtp_port)
            .bind(&account.username)
            .bind(&account.password)
            .execute(&self.pool)
            .await
            .map_err(|e| e.to_string())?;

        Ok(())
    }

    pub async fn get_accounts(&self) -> Result<Vec<crate::models::Account>, String> {
        let q = "SELECT id, name, email, imap_server, imap_port, smtp_server, smtp_port, username, password FROM accounts";

        let rows = sqlx::query(q)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| e.to_string())?;

        let mut accounts = Vec::new();
        for row in rows {
            let imap_port: i32 = row.try_get("imap_port").map_err(|e| e.to_string())?;
            let smtp_port: i32 = row.try_get("smtp_port").map_err(|e| e.to_string())?;
            accounts.push(crate::models::Account {
                id: row.try_get("id").map_err(|e| e.to_string())?,
                name: row.try_get("name").map_err(|e| e.to_string())?,
                email: row.try_get("email").map_err(|e| e.to_string())?,
                imap_server: row.try_get("imap_server").map_err(|e| e.to_string())?,
                imap_port: imap_port as u16,
                smtp_server: row.try_get("smtp_server").map_err(|e| e.to_string())?,
                smtp_port: smtp_port as u16,
                username: row.try_get("username").map_err(|e| e.to_string())?,
                password: row.try_get("password").map_err(|e| e.to_string())?,
            });
        }

        Ok(accounts)
    }

    pub async fn delete_account(&self, id: &str) -> Result<(), String> {
        let q = "DELETE FROM accounts WHERE id = ?";
        sqlx::query(q)
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn get_setting(&self, key: &str) -> Result<Option<String>, String> {
        let row = sqlx::query("SELECT value FROM settings WHERE key = ?")
            .bind(key)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(row.map(|r| r.try_get::<String, _>("value").unwrap_or_default()))
    }

    pub async fn set_setting(&self, key: &str, value: &str) -> Result<(), String> {
        sqlx::query("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
            .bind(key)
            .bind(value)
            .execute(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn upsert_email(&self, email: &crate::models::Email) -> Result<(), String> {
        let q = r#"
            INSERT INTO emails (id, account_id, folder, uid, sender, sender_email, recipient, subject, preview, body_text, body_html, timestamp, is_read)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(account_id, folder, uid) DO UPDATE SET
                sender = excluded.sender,
                sender_email = excluded.sender_email,
                recipient = excluded.recipient,
                subject = excluded.subject,
                preview = excluded.preview,
                body_text = excluded.body_text,
                body_html = excluded.body_html,
                timestamp = excluded.timestamp
        "#;
        sqlx::query(q)
            .bind(&email.id)
            .bind(&email.account_id)
            .bind(&email.folder)
            .bind(email.uid)
            .bind(&email.sender)
            .bind(&email.sender_email)
            .bind(&email.recipient)
            .bind(&email.subject)
            .bind(&email.preview)
            .bind(&email.body_text)
            .bind(&email.body_html)
            .bind(&email.timestamp)
            .bind(email.read)
            .execute(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn get_emails_by_folder(&self, account_id: &str, folder: &str) -> Result<Vec<crate::models::Email>, String> {
        let rows = sqlx::query(
            "SELECT id, account_id, folder, uid, sender, sender_email, recipient, subject, preview, body_text, body_html, timestamp, is_read FROM emails WHERE account_id = ? AND folder = ? ORDER BY timestamp DESC"
        )
            .bind(account_id)
            .bind(folder)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| e.to_string())?;

        let mut emails = Vec::new();
        for row in rows {
            emails.push(crate::models::Email {
                id: row.try_get("id").map_err(|e| e.to_string())?,
                account_id: row.try_get("account_id").map_err(|e| e.to_string())?,
                folder: row.try_get("folder").map_err(|e| e.to_string())?,
                uid: row.try_get::<i32, _>("uid").map_err(|e| e.to_string())? as u32,
                sender: row.try_get("sender").map_err(|e| e.to_string())?,
                sender_email: row.try_get("sender_email").map_err(|e| e.to_string())?,
                recipient: row.try_get("recipient").unwrap_or_default(),
                subject: row.try_get("subject").map_err(|e| e.to_string())?,
                preview: row.try_get("preview").map_err(|e| e.to_string())?,
                body_text: row.try_get("body_text").map_err(|e| e.to_string())?,
                body_html: row.try_get("body_html").map_err(|e| e.to_string())?,
                timestamp: row.try_get("timestamp").map_err(|e| e.to_string())?,
                read: row.try_get::<bool, _>("is_read").map_err(|e| e.to_string())?,
            });
        }
        Ok(emails)
    }

    pub async fn mark_email_read(&self, id: &str, read: bool) -> Result<(), String> {
        sqlx::query("UPDATE emails SET is_read = ? WHERE id = ?")
            .bind(read)
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn delete_email(&self, id: &str) -> Result<(), String> {
        sqlx::query("DELETE FROM emails WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Search emails by subject, sender, or body_text using a LIKE pattern.
    /// Returns at most 50 results ordered by timestamp DESC.
    pub async fn search_emails(&self, account_id: &str, folder: &str, query: &str) -> Result<Vec<crate::models::Email>, String> {
        let pattern = format!("%{}%", query);
        let rows = sqlx::query(
            "SELECT id, account_id, folder, uid, sender, sender_email, recipient, subject, preview, body_text, body_html, timestamp, is_read \
             FROM emails \
             WHERE account_id = ? AND folder = ? \
               AND (subject LIKE ? OR sender LIKE ? OR body_text LIKE ?) \
             ORDER BY timestamp DESC LIMIT 50"
        )
        .bind(account_id)
        .bind(folder)
        .bind(&pattern)
        .bind(&pattern)
        .bind(&pattern)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| e.to_string())?;

        let mut emails = Vec::new();
        for row in rows {
            emails.push(crate::models::Email {
                id: row.try_get("id").map_err(|e| e.to_string())?,
                account_id: row.try_get("account_id").map_err(|e| e.to_string())?,
                folder: row.try_get("folder").map_err(|e| e.to_string())?,
                uid: row.try_get::<i32, _>("uid").map_err(|e| e.to_string())? as u32,
                sender: row.try_get("sender").map_err(|e| e.to_string())?,
                sender_email: row.try_get("sender_email").map_err(|e| e.to_string())?,
                recipient: row.try_get("recipient").unwrap_or_default(),
                subject: row.try_get("subject").map_err(|e| e.to_string())?,
                preview: row.try_get("preview").map_err(|e| e.to_string())?,
                body_text: row.try_get("body_text").map_err(|e| e.to_string())?,
                body_html: row.try_get("body_html").map_err(|e| e.to_string())?,
                timestamp: row.try_get("timestamp").map_err(|e| e.to_string())?,
                read: row.try_get::<bool, _>("is_read").map_err(|e| e.to_string())?,
            });
        }
        Ok(emails)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Account, Email};
    use tempfile::TempDir;

    async fn setup_db() -> (Db, TempDir) {
        let tmp = TempDir::new().expect("failed to create temp dir");
        let db = Db::init(tmp.path().to_path_buf()).await.expect("failed to init db");
        (db, tmp)
    }

    fn test_account() -> Account {
        Account {
            id: "acc-1".to_string(),
            name: "Test User".to_string(),
            email: "test@example.com".to_string(),
            imap_server: "imap.example.com".to_string(),
            imap_port: 993,
            smtp_server: "smtp.example.com".to_string(),
            smtp_port: 465,
            username: "test@example.com".to_string(),
            password: "secret".to_string(),
        }
    }

    fn test_email(account_id: &str, uid: u32) -> Email {
        Email {
            id: format!("email-{}", uid),
            account_id: account_id.to_string(),
            folder: "inbox".to_string(),
            uid,
            sender: "sender@example.com".to_string(),
            sender_email: "sender@example.com".to_string(),
            recipient: "me@example.com".to_string(),
            subject: format!("Test Subject {}", uid),
            preview: "Preview text...".to_string(),
            body_html: Some("<p>Hello</p>".to_string()),
            body_text: Some("Hello".to_string()),
            timestamp: "2026-01-01T00:00:00+00:00".to_string(),
            read: false,
        }
    }

    #[tokio::test]
    async fn test_insert_and_get_accounts() {
        let (db, _tmp) = setup_db().await;
        let acc = test_account();

        db.insert_account(&acc).await.expect("insert failed");
        let accounts = db.get_accounts().await.expect("get failed");

        assert_eq!(accounts.len(), 1);
        assert_eq!(accounts[0].id, "acc-1");
        assert_eq!(accounts[0].email, "test@example.com");
        assert_eq!(accounts[0].imap_port, 993);
    }

    #[tokio::test]
    async fn test_delete_account() {
        let (db, _tmp) = setup_db().await;
        let acc = test_account();

        db.insert_account(&acc).await.unwrap();
        db.delete_account("acc-1").await.unwrap();

        let accounts = db.get_accounts().await.unwrap();
        assert_eq!(accounts.len(), 0);
    }

    #[tokio::test]
    async fn test_delete_account_cascades_emails() {
        let (db, _tmp) = setup_db().await;
        let acc = test_account();

        db.insert_account(&acc).await.unwrap();
        db.upsert_email(&test_email("acc-1", 1)).await.unwrap();
        db.upsert_email(&test_email("acc-1", 2)).await.unwrap();

        let emails = db.get_emails_by_folder("acc-1", "inbox").await.unwrap();
        assert_eq!(emails.len(), 2);

        db.delete_account("acc-1").await.unwrap();
        let emails_after = db.get_emails_by_folder("acc-1", "inbox").await.unwrap();
        assert_eq!(emails_after.len(), 0);
    }

    #[tokio::test]
    async fn test_upsert_email_deduplicates() {
        let (db, _tmp) = setup_db().await;
        db.insert_account(&test_account()).await.unwrap();

        let email = test_email("acc-1", 100);
        db.upsert_email(&email).await.unwrap();
        // Upsert same uid again with different subject
        let mut email2 = test_email("acc-1", 100);
        email2.id = "email-100-v2".to_string();
        email2.subject = "Updated Subject".to_string();
        db.upsert_email(&email2).await.unwrap();

        let emails = db.get_emails_by_folder("acc-1", "inbox").await.unwrap();
        assert_eq!(emails.len(), 1);
        assert_eq!(emails[0].subject, "Updated Subject");
    }

    #[tokio::test]
    async fn test_mark_email_read() {
        let (db, _tmp) = setup_db().await;
        db.insert_account(&test_account()).await.unwrap();

        let email = test_email("acc-1", 1);
        db.upsert_email(&email).await.unwrap();

        db.mark_email_read("email-1", true).await.unwrap();
        let emails = db.get_emails_by_folder("acc-1", "inbox").await.unwrap();
        assert!(emails[0].read);

        db.mark_email_read("email-1", false).await.unwrap();
        let emails = db.get_emails_by_folder("acc-1", "inbox").await.unwrap();
        assert!(!emails[0].read);
    }

    #[tokio::test]
    async fn test_delete_email() {
        let (db, _tmp) = setup_db().await;
        db.insert_account(&test_account()).await.unwrap();
        db.upsert_email(&test_email("acc-1", 1)).await.unwrap();

        db.delete_email("email-1").await.unwrap();
        let emails = db.get_emails_by_folder("acc-1", "inbox").await.unwrap();
        assert_eq!(emails.len(), 0);
    }

    #[tokio::test]
    async fn test_settings_get_set() {
        let (db, _tmp) = setup_db().await;

        // Initially empty
        let val = db.get_setting("syncLimitDays").await.unwrap();
        assert_eq!(val, None);

        // Set
        db.set_setting("syncLimitDays", "60").await.unwrap();
        let val = db.get_setting("syncLimitDays").await.unwrap();
        assert_eq!(val, Some("60".to_string()));

        // Overwrite
        db.set_setting("syncLimitDays", "90").await.unwrap();
        let val = db.get_setting("syncLimitDays").await.unwrap();
        assert_eq!(val, Some("90".to_string()));
    }

    #[tokio::test]
    async fn test_emails_folder_filtering() {
        let (db, _tmp) = setup_db().await;
        db.insert_account(&test_account()).await.unwrap();

        let mut inbox_email = test_email("acc-1", 1);
        inbox_email.folder = "inbox".to_string();
        db.upsert_email(&inbox_email).await.unwrap();

        let mut sent_email = test_email("acc-1", 2);
        sent_email.id = "email-sent-2".to_string();
        sent_email.folder = "sent".to_string();
        db.upsert_email(&sent_email).await.unwrap();

        let inbox = db.get_emails_by_folder("acc-1", "inbox").await.unwrap();
        assert_eq!(inbox.len(), 1);
        assert_eq!(inbox[0].folder, "inbox");

        let sent = db.get_emails_by_folder("acc-1", "sent").await.unwrap();
        assert_eq!(sent.len(), 1);
        assert_eq!(sent[0].folder, "sent");
    }

    #[tokio::test]
    async fn test_search_emails() {
        let (db, _tmp) = setup_db().await;
        db.insert_account(&test_account()).await.unwrap();

        // Insert emails with distinct subjects and bodies
        let mut e1 = test_email("acc-1", 1);
        e1.subject = "Budget Report Q4".to_string();
        e1.body_text = Some("Please review the attached spreadsheet".to_string());
        db.upsert_email(&e1).await.unwrap();

        let mut e2 = test_email("acc-1", 2);
        e2.id = "email-2".to_string();
        e2.subject = "Team Meeting Tomorrow".to_string();
        e2.body_text = Some("See you at 10am in the conference room".to_string());
        db.upsert_email(&e2).await.unwrap();

        let mut e3 = test_email("acc-1", 3);
        e3.id = "email-3".to_string();
        e3.subject = "Budget Forecast 2025".to_string();
        e3.body_text = Some("Annual summary enclosed".to_string());
        db.upsert_email(&e3).await.unwrap();

        // Search by subject keyword — should match 2 "Budget" emails
        let results = db.search_emails("acc-1", "inbox", "Budget").await.unwrap();
        assert_eq!(results.len(), 2);

        // Search by body keyword — should match exactly 1
        let results = db.search_emails("acc-1", "inbox", "conference").await.unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].subject, "Team Meeting Tomorrow");

        // Search with no match — should return empty
        let results = db.search_emails("acc-1", "inbox", "nonexistent_xyz").await.unwrap();
        assert_eq!(results.len(), 0);
    }
}
