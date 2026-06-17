use sqlx::{
    sqlite::{SqliteConnectOptions, SqlitePoolOptions, SqliteRow},
    Row, SqlitePool,
};
use std::path::PathBuf;
use std::time::Duration;

const CURRENT_SCHEMA_VERSION: i64 = 4;

#[derive(Clone)]
pub struct Db {
    pub pool: SqlitePool,
}

impl Db {
    pub async fn init(app_dir: PathBuf) -> Result<Self, String> {
        std::fs::create_dir_all(&app_dir).unwrap_or_default();
        let db_path = app_dir.join("mailmail.sqlite");

        let conn_opts = sqlite_connect_options(db_path)
            .create_if_missing(true)
            .pragma("foreign_keys", "ON")
            .pragma("journal_mode", "WAL")
            .pragma("synchronous", "NORMAL")
            .pragma("busy_timeout", "5000");

        let pool = SqlitePoolOptions::new()
            .max_connections(10)
            .acquire_timeout(Duration::from_secs(5))
            .connect_with(conn_opts)
            .await
            .map_err(|e| e.to_string())?;

        let db = Db { pool };
        db.create_tables().await?;
        Ok(db)
    }

    pub async fn close(self) {
        sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
            .execute(&self.pool)
            .await
            .ok();
        self.pool.close().await;
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
                username TEXT NOT NULL
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
                is_starred BOOLEAN NOT NULL DEFAULT 0,
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
            r#"
            CREATE TABLE IF NOT EXISTS signatures (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                content TEXT NOT NULL,
                is_default INTEGER NOT NULL DEFAULT 0
            );
            "#,
            r#"
            CREATE TABLE IF NOT EXISTS attachments (
                id TEXT PRIMARY KEY,
                email_id TEXT NOT NULL,
                filename TEXT NOT NULL,
                mime_type TEXT NOT NULL,
                size INTEGER NOT NULL,
                data BLOB NOT NULL,
                FOREIGN KEY(email_id) REFERENCES emails(id) ON DELETE CASCADE
            );
            "#,
            r#"
            CREATE TABLE IF NOT EXISTS security_audit_logs (
                id TEXT PRIMARY KEY,
                event_type TEXT NOT NULL,
                severity TEXT NOT NULL,
                email_id TEXT,
                account_id TEXT,
                target TEXT NOT NULL,
                decision TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            "#,
        ];

        for q in queries {
            sqlx::query(q).execute(&self.pool).await.map_err(|e| e.to_string())?;
        }

        self.run_schema_migrations().await?;

        Ok(())
    }

    async fn run_schema_migrations(&self) -> Result<(), String> {
        self.ensure_schema_migrations_table().await?;

        let current_version = self.current_schema_version().await?;
        if current_version > CURRENT_SCHEMA_VERSION {
            return Err(format!(
                "Database schema version {} is newer than supported version {}",
                current_version,
                CURRENT_SCHEMA_VERSION,
            ));
        }

        if current_version < 1 {
            self.apply_legacy_schema_migration().await?;
            self.record_schema_version(1).await?;
        }

        if current_version < 2 {
            self.apply_accounts_password_removal_migration().await?;
            self.record_schema_version(2).await?;
        }

        if current_version < 3 {
            self.apply_security_audit_log_migration().await?;
            self.record_schema_version(3).await?;
        }

        if current_version < 4 {
            self.apply_email_query_indexes_migration().await?;
            self.record_schema_version(4).await?;
        }

        Ok(())
    }

    async fn ensure_schema_migrations_table(&self) -> Result<(), String> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn current_schema_version(&self) -> Result<i64, String> {
        let row = sqlx::query("SELECT MAX(version) AS version FROM schema_migrations")
            .fetch_one(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(row.try_get::<Option<i64>, _>("version").map_err(|e| e.to_string())?.unwrap_or(0))
    }

    async fn record_schema_version(&self, version: i64) -> Result<(), String> {
        sqlx::query(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?, datetime('now')) \
             ON CONFLICT(version) DO NOTHING",
        )
        .bind(version)
        .execute(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn apply_legacy_schema_migration(&self) -> Result<(), String> {
        // Add recipient column to existing databases that predate this field.
        let _ = sqlx::query("ALTER TABLE emails ADD COLUMN recipient TEXT DEFAULT ''")
            .execute(&self.pool)
            .await;

        // Add is_starred column for the star feature.
        let _ = sqlx::query("ALTER TABLE emails ADD COLUMN is_starred BOOLEAN NOT NULL DEFAULT 0")
            .execute(&self.pool)
            .await;

        // Add has_attachments column for attachment support.
        let _ = sqlx::query("ALTER TABLE emails ADD COLUMN has_attachments BOOLEAN NOT NULL DEFAULT 0")
            .execute(&self.pool)
            .await;

        // Clean up rows where uid=0, which were created by a bug where FETCH without
        // explicit UID data item caused msg.uid to always be None. IMAP UIDs start at 1.
        let _ = sqlx::query("DELETE FROM emails WHERE uid = 0")
            .execute(&self.pool)
            .await;

        // Normalize email IDs to the deterministic format used by imap.rs.
        // Before commit f35c189, IDs were random UUIDs regenerated on every IMAP fetch.
        // This caused the selectedEmailId to become orphaned after each background sync.
        // Updating the DB here means the first cache load already returns stable IDs,
        // so the user never sees a selected email disappear during the initial sync.
        let _ = sqlx::query(
            "UPDATE emails SET id = account_id || '_' || lower(folder) || '_' || CAST(uid AS TEXT) \
             WHERE id != account_id || '_' || lower(folder) || '_' || CAST(uid AS TEXT)"
        )
        .execute(&self.pool)
        .await;

        Ok(())
    }

    async fn apply_accounts_password_removal_migration(&self) -> Result<(), String> {
        let has_password_column = sqlx::query("PRAGMA table_info(accounts)")
            .fetch_all(&self.pool)
            .await
            .map_err(|e| e.to_string())?
            .into_iter()
            .any(|row| row.try_get::<String, _>("name").unwrap_or_default() == "password");
        if !has_password_column {
            return Ok(());
        }

        sqlx::query("ALTER TABLE accounts DROP COLUMN password")
            .execute(&self.pool)
            .await
            .map_err(|e| e.to_string())?;

        Ok(())
    }

    async fn apply_security_audit_log_migration(&self) -> Result<(), String> {
        sqlx::query(
            r#"
            CREATE TABLE IF NOT EXISTS security_audit_logs (
                id TEXT PRIMARY KEY,
                event_type TEXT NOT NULL,
                severity TEXT NOT NULL,
                email_id TEXT,
                account_id TEXT,
                target TEXT NOT NULL,
                decision TEXT NOT NULL,
                created_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            "#,
        )
        .execute(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    async fn apply_email_query_indexes_migration(&self) -> Result<(), String> {
        let queries = [
            "CREATE INDEX IF NOT EXISTS emails_account_folder_timestamp_idx ON emails (account_id, folder, timestamp DESC, id DESC)",
            "CREATE INDEX IF NOT EXISTS emails_starred_timestamp_idx ON emails (is_starred, timestamp DESC, id DESC)",
        ];

        for q in queries {
            sqlx::query(q)
                .execute(&self.pool)
                .await
                .map_err(|e| e.to_string())?;
        }
        Ok(())
    }

    pub async fn insert_account(&self, account: &crate::models::Account) -> Result<(), String> {
        let q = r#"
            INSERT INTO accounts (id, name, email, imap_server, imap_port, smtp_server, smtp_port, username)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
            .execute(&self.pool)
            .await
            .map_err(|e| e.to_string())?;

        Ok(())
    }

    pub async fn get_accounts(&self) -> Result<Vec<crate::models::Account>, String> {
        let q = "SELECT id, name, email, imap_server, imap_port, smtp_server, smtp_port, username FROM accounts";

        let rows = sqlx::query(q)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| e.to_string())?;

        let mut accounts = Vec::new();
        for row in rows {
            accounts.push(account_from_row(row)?);
        }

        Ok(accounts)
    }

    pub async fn get_account_by_id(&self, id: &str) -> Result<Option<crate::models::Account>, String> {
        let q = "SELECT id, name, email, imap_server, imap_port, smtp_server, smtp_port, username FROM accounts WHERE id = ?";

        let row = sqlx::query(q)
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| e.to_string())?;

        row.map(account_from_row).transpose()
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
            INSERT INTO emails (id, account_id, folder, uid, sender, sender_email, recipient, subject, preview, body_text, body_html, timestamp, is_read, has_attachments)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(account_id, folder, uid) DO UPDATE SET
                id = excluded.id,
                sender = excluded.sender,
                sender_email = excluded.sender_email,
                recipient = excluded.recipient,
                subject = excluded.subject,
                preview = excluded.preview,
                body_text = excluded.body_text,
                body_html = excluded.body_html,
                timestamp = excluded.timestamp,
                has_attachments = excluded.has_attachments
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
            .bind(email.has_attachments)
            .execute(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn get_emails_by_folder(&self, account_id: &str, folder: &str) -> Result<Vec<crate::models::Email>, String> {
        let rows = sqlx::query(
            "SELECT id, account_id, folder, uid, sender, sender_email, recipient, subject, preview, NULL AS body_text, NULL AS body_html, timestamp, is_read, is_starred, has_attachments FROM emails WHERE account_id = ? AND folder = ? ORDER BY timestamp DESC"
        )
            .bind(account_id)
            .bind(folder)
            .fetch_all(&self.pool)
            .await
            .map_err(|e| e.to_string())?;

        let mut emails = Vec::new();
        for row in rows {
            emails.push(email_from_row(row)?);
        }
        Ok(emails)
    }

    pub async fn get_email_by_id(&self, id: &str) -> Result<Option<crate::models::Email>, String> {
        let row = sqlx::query(
            "SELECT id, account_id, folder, uid, sender, sender_email, recipient, subject, preview, body_text, body_html, timestamp, is_read, is_starred, has_attachments FROM emails WHERE id = ?"
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(|e| e.to_string())?;

        row.map(email_from_row).transpose()
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

    pub async fn toggle_star(&self, id: &str, starred: bool) -> Result<(), String> {
        sqlx::query("UPDATE emails SET is_starred = ? WHERE id = ?")
            .bind(starred)
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
            "SELECT id, account_id, folder, uid, sender, sender_email, recipient, subject, preview, NULL AS body_text, NULL AS body_html, timestamp, is_read, is_starred, has_attachments \
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
            emails.push(email_from_row(row)?);
        }
        Ok(emails)
    }

    pub async fn query_emails(&self, query: &crate::models::EmailQuery) -> Result<Vec<crate::models::Email>, String> {
        let limit = query.limit.clamp(1, 200) as i64;
        let mut sql = String::from(
            "SELECT id, account_id, folder, uid, sender, sender_email, recipient, subject, preview, NULL AS body_text, NULL AS body_html, timestamp, is_read, is_starred, has_attachments FROM emails WHERE 1 = 1",
        );

        if !query.account_ids.is_empty() {
            let placeholders = std::iter::repeat("?")
                .take(query.account_ids.len())
                .collect::<Vec<_>>()
                .join(", ");
            sql.push_str(" AND account_id IN (");
            sql.push_str(&placeholders);
            sql.push(')');
        }

        if query.folder == "starred" {
            sql.push_str(" AND is_starred = 1");
        } else {
            sql.push_str(" AND folder = ?");
        }

        let has_search = query.search.as_ref().map(|s| !s.trim().is_empty()).unwrap_or(false);
        if has_search {
            sql.push_str(" AND (subject LIKE ? OR sender LIKE ? OR sender_email LIKE ? OR recipient LIKE ? OR preview LIKE ? OR body_text LIKE ?)");
        }

        if query.cursor.is_some() {
            sql.push_str(" AND (timestamp < ? OR (timestamp = ? AND id < ?))");
        }

        sql.push_str(" ORDER BY timestamp DESC, id DESC LIMIT ?");

        let mut q = sqlx::query(&sql);
        for account_id in &query.account_ids {
            q = q.bind(account_id);
        }
        if query.folder != "starred" {
            q = q.bind(&query.folder);
        }
        if let Some(search) = query.search.as_ref().filter(|s| !s.trim().is_empty()) {
            let pattern = format!("%{}%", search.trim());
            for _ in 0..6 {
                q = q.bind(pattern.clone());
            }
        }
        if let Some(cursor) = &query.cursor {
            q = q.bind(&cursor.timestamp).bind(&cursor.timestamp).bind(&cursor.id);
        }
        q = q.bind(limit);

        let rows = q.fetch_all(&self.pool).await.map_err(|e| e.to_string())?;
        rows.into_iter().map(email_from_row).collect()
    }

    /// Store an attachment's binary data in the DB. Replaces any existing attachment with the same id.
    pub async fn insert_attachment(&self, meta: &crate::models::Attachment, data: &[u8]) -> Result<(), String> {
        sqlx::query(
            "INSERT INTO attachments (id, email_id, filename, mime_type, size, data) VALUES (?, ?, ?, ?, ?, ?) \
             ON CONFLICT(id) DO UPDATE SET filename=excluded.filename, mime_type=excluded.mime_type, size=excluded.size, data=excluded.data"
        )
        .bind(&meta.id)
        .bind(&meta.email_id)
        .bind(&meta.filename)
        .bind(&meta.mime_type)
        .bind(meta.size)
        .bind(data)
        .execute(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Returns attachment metadata (no BLOB data) for all attachments of a given email.
    pub async fn get_attachments_for_email(&self, email_id: &str) -> Result<Vec<crate::models::Attachment>, String> {
        let rows = sqlx::query(
            "SELECT id, email_id, filename, mime_type, size FROM attachments WHERE email_id = ? ORDER BY rowid ASC"
        )
        .bind(email_id)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| e.to_string())?;

        let mut attachments = Vec::new();
        for row in rows {
            attachments.push(crate::models::Attachment {
                id: row.try_get("id").map_err(|e| e.to_string())?,
                email_id: row.try_get("email_id").map_err(|e| e.to_string())?,
                filename: row.try_get("filename").map_err(|e| e.to_string())?,
                mime_type: row.try_get("mime_type").map_err(|e| e.to_string())?,
                size: row.try_get("size").map_err(|e| e.to_string())?,
            });
        }
        Ok(attachments)
    }

    /// Returns the raw binary data for a single attachment (for save-to-disk).
    pub async fn get_attachment_data(&self, id: &str) -> Result<Vec<u8>, String> {
        let row = sqlx::query("SELECT data FROM attachments WHERE id = ?")
            .bind(id)
            .fetch_optional(&self.pool)
            .await
            .map_err(|e| e.to_string())?
            .ok_or_else(|| format!("Attachment '{}' not found", id))?;
        let data: Vec<u8> = row.try_get("data").map_err(|e| e.to_string())?;
        Ok(data)
    }

    pub async fn insert_security_audit_log(&self, event: &crate::models::NewSecurityAuditLog) -> Result<crate::models::SecurityAuditLog, String> {
        let id = uuid::Uuid::new_v4().to_string();
        sqlx::query(
            "INSERT INTO security_audit_logs (id, event_type, severity, email_id, account_id, target, decision) VALUES (?, ?, ?, ?, ?, ?, ?)"
        )
        .bind(&id)
        .bind(&event.event_type)
        .bind(&event.severity)
        .bind(&event.email_id)
        .bind(&event.account_id)
        .bind(&event.target)
        .bind(&event.decision)
        .execute(&self.pool)
        .await
        .map_err(|e| e.to_string())?;

        let row = sqlx::query(
            "SELECT id, event_type, severity, email_id, account_id, target, decision, created_at FROM security_audit_logs WHERE id = ?"
        )
        .bind(&id)
        .fetch_one(&self.pool)
        .await
        .map_err(|e| e.to_string())?;

        Ok(crate::models::SecurityAuditLog {
            id: row.try_get("id").map_err(|e| e.to_string())?,
            event_type: row.try_get("event_type").map_err(|e| e.to_string())?,
            severity: row.try_get("severity").map_err(|e| e.to_string())?,
            email_id: row.try_get("email_id").map_err(|e| e.to_string())?,
            account_id: row.try_get("account_id").map_err(|e| e.to_string())?,
            target: row.try_get("target").map_err(|e| e.to_string())?,
            decision: row.try_get("decision").map_err(|e| e.to_string())?,
            created_at: row.try_get("created_at").map_err(|e| e.to_string())?,
        })
    }

    pub async fn list_security_audit_logs(&self, limit: i64) -> Result<Vec<crate::models::SecurityAuditLog>, String> {
        let rows = sqlx::query(
            "SELECT id, event_type, severity, email_id, account_id, target, decision, created_at \
             FROM security_audit_logs \
             ORDER BY datetime(created_at) DESC, rowid DESC \
             LIMIT ?"
        )
        .bind(limit.clamp(1, 100))
        .fetch_all(&self.pool)
        .await
        .map_err(|e| e.to_string())?;

        rows.into_iter()
            .map(|row| {
                Ok(crate::models::SecurityAuditLog {
                    id: row.try_get("id").map_err(|e| e.to_string())?,
                    event_type: row.try_get("event_type").map_err(|e| e.to_string())?,
                    severity: row.try_get("severity").map_err(|e| e.to_string())?,
                    email_id: row.try_get("email_id").map_err(|e| e.to_string())?,
                    account_id: row.try_get("account_id").map_err(|e| e.to_string())?,
                    target: row.try_get("target").map_err(|e| e.to_string())?,
                    decision: row.try_get("decision").map_err(|e| e.to_string())?,
                    created_at: row.try_get("created_at").map_err(|e| e.to_string())?,
                })
            })
            .collect()
    }

    pub async fn get_signatures(&self) -> Result<Vec<crate::models::Signature>, String> {
        let rows = sqlx::query("SELECT id, name, content, is_default FROM signatures ORDER BY name ASC")
            .fetch_all(&self.pool)
            .await
            .map_err(|e| e.to_string())?;

        let mut sigs = Vec::new();
        for row in rows {
            sigs.push(crate::models::Signature {
                id: row.try_get("id").map_err(|e| e.to_string())?,
                name: row.try_get("name").map_err(|e| e.to_string())?,
                content: row.try_get("content").map_err(|e| e.to_string())?,
                is_default: row.try_get::<bool, _>("is_default").unwrap_or(false),
            });
        }
        Ok(sigs)
    }

    /// Insert or replace a signature. If is_default is true, clears is_default from all others first.
    pub async fn upsert_signature(&self, sig: &crate::models::Signature) -> Result<(), String> {
        if sig.is_default {
            sqlx::query("UPDATE signatures SET is_default = 0")
                .execute(&self.pool)
                .await
                .map_err(|e| e.to_string())?;
        }
        sqlx::query(
            "INSERT INTO signatures (id, name, content, is_default) VALUES (?, ?, ?, ?) \
             ON CONFLICT(id) DO UPDATE SET name=excluded.name, content=excluded.content, is_default=excluded.is_default"
        )
        .bind(&sig.id)
        .bind(&sig.name)
        .bind(&sig.content)
        .bind(sig.is_default)
        .execute(&self.pool)
        .await
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub async fn delete_signature(&self, id: &str) -> Result<(), String> {
        sqlx::query("DELETE FROM signatures WHERE id = ?")
            .bind(id)
            .execute(&self.pool)
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    /// Return up to 10 unique contacts matching `query` (prefix on display name or email).
    ///
    /// Contacts are derived from the emails table: we collect (sender, sender_email) from
    /// received messages and (recipient) from sent messages, then deduplicate by email address.
    /// Results are ordered by most-recently-seen first so frequent contacts appear at the top.
    pub async fn suggest_contacts(&self, query: &str) -> Result<Vec<crate::models::Contact>, String> {
        let pattern = format!("%{}%", query);

        // Collect from received messages: sender + sender_email columns.
        // Collect from sent messages: recipient field (may be "Name <email>" or bare email).
        let rows = sqlx::query(
            "SELECT sender AS name, sender_email AS email, MAX(timestamp) AS last_seen \
             FROM emails \
             WHERE sender_email != '' \
               AND (sender LIKE ? OR sender_email LIKE ?) \
             GROUP BY lower(sender_email) \
             UNION ALL \
             SELECT '' AS name, recipient AS email, MAX(timestamp) AS last_seen \
             FROM emails \
             WHERE folder = 'sent' AND recipient != '' \
               AND recipient LIKE ? \
             GROUP BY lower(recipient) \
             ORDER BY last_seen DESC \
             LIMIT 30"
        )
        .bind(&pattern)
        .bind(&pattern)
        .bind(&pattern)
        .fetch_all(&self.pool)
        .await
        .map_err(|e| e.to_string())?;

        // Deduplicate by normalized email address, keep first occurrence (most recent).
        let mut seen = std::collections::HashSet::new();
        let mut contacts = Vec::new();
        for row in rows {
            let raw_email: String = row.try_get("email").unwrap_or_default();
            let name: String = row.try_get("name").unwrap_or_default();

            // Normalize: extract bare email from "Name <email>" if needed.
            let bare = if let (Some(s), Some(e)) = (raw_email.find('<'), raw_email.rfind('>')) {
                raw_email[s + 1..e].trim().to_lowercase()
            } else {
                raw_email.trim().to_lowercase()
            };

            if bare.is_empty() || bare.contains(' ') { continue; }
            if seen.contains(&bare) { continue; }
            seen.insert(bare.clone());

            contacts.push(crate::models::Contact {
                name: if name.is_empty() { bare.clone() } else { name },
                email: bare,
            });
            if contacts.len() >= 10 { break; }
        }
        Ok(contacts)
    }
}

fn sqlite_connect_options(db_path: PathBuf) -> SqliteConnectOptions {
    SqliteConnectOptions::new().filename(db_path)
}

fn account_from_row(row: SqliteRow) -> Result<crate::models::Account, String> {
    let imap_port: i32 = row.try_get("imap_port").map_err(|e| e.to_string())?;
    let smtp_port: i32 = row.try_get("smtp_port").map_err(|e| e.to_string())?;
    Ok(crate::models::Account {
        id: row.try_get("id").map_err(|e| e.to_string())?,
        name: row.try_get("name").map_err(|e| e.to_string())?,
        email: row.try_get("email").map_err(|e| e.to_string())?,
        imap_server: row.try_get("imap_server").map_err(|e| e.to_string())?,
        imap_port: imap_port as u16,
        smtp_server: row.try_get("smtp_server").map_err(|e| e.to_string())?,
        smtp_port: smtp_port as u16,
        username: row.try_get("username").map_err(|e| e.to_string())?,
        password: String::new(),
    })
}

fn email_from_row(row: sqlx::sqlite::SqliteRow) -> Result<crate::models::Email, String> {
    Ok(crate::models::Email {
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
        starred: row.try_get::<bool, _>("is_starred").unwrap_or(false),
        has_attachments: row.try_get::<bool, _>("has_attachments").unwrap_or(false),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{Account, Email, EmailQuery, EmailQueryCursor, NewSecurityAuditLog};
    use tempfile::TempDir;

    async fn setup_db() -> (Db, TempDir) {
        let tmp = TempDir::new().expect("failed to create temp dir");
        let db = Db::init(tmp.path().to_path_buf()).await.expect("failed to init db");
        (db, tmp)
    }

    async fn schema_version(db: &Db) -> i64 {
        let row = sqlx::query("SELECT MAX(version) AS version FROM schema_migrations")
            .fetch_one(&db.pool)
            .await
            .expect("schema version query failed");
        row.try_get::<Option<i64>, _>("version").unwrap().unwrap_or(0)
    }

    async fn email_column_names(db: &Db) -> Vec<String> {
        let rows = sqlx::query("PRAGMA table_info(emails)")
            .fetch_all(&db.pool)
            .await
            .expect("table info query failed");
        rows.into_iter()
            .map(|row| row.try_get::<String, _>("name").unwrap())
            .collect()
    }

    async fn account_column_names(db: &Db) -> Vec<String> {
        let rows = sqlx::query("PRAGMA table_info(accounts)")
            .fetch_all(&db.pool)
            .await
            .expect("account table info query failed");
        rows.into_iter()
            .map(|row| row.try_get::<String, _>("name").unwrap())
            .collect()
    }

    async fn email_index_names(db: &Db) -> Vec<String> {
        let rows = sqlx::query("PRAGMA index_list(emails)")
            .fetch_all(&db.pool)
            .await
            .expect("email index list query failed");
        rows.into_iter()
            .map(|row| row.try_get::<String, _>("name").unwrap())
            .collect()
    }

    async fn create_legacy_database(app_dir: &std::path::Path) {
        std::fs::create_dir_all(app_dir).expect("failed to create legacy app dir");
        let db_path = app_dir.join("mailmail.sqlite");
        let conn_opts = sqlite_connect_options(db_path).create_if_missing(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(conn_opts)
            .await
            .expect("failed to create legacy db");

        sqlx::query(
            r#"
            CREATE TABLE accounts (
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
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            r#"
            CREATE TABLE emails (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                folder TEXT NOT NULL,
                uid INTEGER NOT NULL,
                sender TEXT,
                sender_email TEXT,
                subject TEXT,
                preview TEXT,
                body_text TEXT,
                body_html TEXT,
                timestamp TEXT NOT NULL,
                is_read BOOLEAN NOT NULL DEFAULT 0,
                FOREIGN KEY(account_id) REFERENCES accounts(id) ON DELETE CASCADE
            );
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("CREATE UNIQUE INDEX emails_account_uid_idx ON emails (account_id, folder, uid)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO accounts (id, name, email, imap_server, imap_port, smtp_server, smtp_port, username, password) \
             VALUES ('acc-1', 'Test User', 'test@example.com', 'imap.example.com', 993, 'smtp.example.com', 465, 'test@example.com', 'secret')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO emails (id, account_id, folder, uid, sender, sender_email, subject, preview, body_text, body_html, timestamp, is_read) \
             VALUES ('legacy-random-id', 'acc-1', 'inbox', 7, 'sender@example.com', 'sender@example.com', 'Legacy message', 'Preview', 'Body', '<p>Body</p>', '2026-01-01T00:00:00+00:00', 0)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query(
            "INSERT INTO emails (id, account_id, folder, uid, sender, sender_email, subject, preview, body_text, body_html, timestamp, is_read) \
             VALUES ('bad-uid-zero', 'acc-1', 'inbox', 0, 'sender@example.com', 'sender@example.com', 'Broken message', 'Preview', 'Body', '<p>Body</p>', '2026-01-01T00:00:00+00:00', 0)",
        )
        .execute(&pool)
        .await
        .unwrap();

        pool.close().await;
    }

    async fn create_future_schema_database(app_dir: &std::path::Path) {
        std::fs::create_dir_all(app_dir).expect("failed to create future app dir");
        let db_path = app_dir.join("mailmail.sqlite");
        let conn_opts = sqlite_connect_options(db_path).create_if_missing(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(conn_opts)
            .await
            .expect("failed to create future db");

        sqlx::query(
            r#"
            CREATE TABLE schema_migrations (
                version INTEGER PRIMARY KEY,
                applied_at TEXT NOT NULL DEFAULT (datetime('now'))
            );
            "#,
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO schema_migrations (version) VALUES (?)")
            .bind(CURRENT_SCHEMA_VERSION + 1)
            .execute(&pool)
            .await
            .unwrap();

        pool.close().await;
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
            starred: false,
            has_attachments: false,
        }
    }

    #[tokio::test]
    async fn test_schema_version_recorded_on_new_database() {
        let (db, _tmp) = setup_db().await;

        assert_eq!(schema_version(&db).await, CURRENT_SCHEMA_VERSION);
    }

    #[tokio::test]
    async fn test_email_query_indexes_exist_on_new_database() {
        let (db, _tmp) = setup_db().await;

        let indexes = email_index_names(&db).await;

        assert!(indexes.contains(&"emails_account_folder_timestamp_idx".to_string()));
        assert!(indexes.contains(&"emails_starred_timestamp_idx".to_string()));
    }

    #[tokio::test]
    async fn test_new_database_accounts_table_has_no_password_column() {
        let (db, _tmp) = setup_db().await;

        let columns = account_column_names(&db).await;

        assert!(!columns.contains(&"password".to_string()));
    }

    #[tokio::test]
    async fn test_init_accepts_canonicalized_data_dir() {
        let tmp = TempDir::new().expect("failed to create temp dir");
        let canonical = tmp.path().canonicalize().expect("canonicalize temp dir");

        let db = Db::init(canonical).await.expect("canonical path should open");

        assert_eq!(schema_version(&db).await, CURRENT_SCHEMA_VERSION);
    }

    #[tokio::test]
    async fn test_schema_migrations_are_idempotent() {
        let (db, _tmp) = setup_db().await;
        db.create_tables().await.expect("repeat migration failed");

        let rows = sqlx::query("SELECT version FROM schema_migrations ORDER BY version")
            .fetch_all(&db.pool)
            .await
            .expect("schema migration rows query failed");

        assert_eq!(rows.len(), 4);
        assert_eq!(rows[0].try_get::<i64, _>("version").unwrap(), 1);
        assert_eq!(rows[1].try_get::<i64, _>("version").unwrap(), 2);
        assert_eq!(rows[2].try_get::<i64, _>("version").unwrap(), 3);
        assert_eq!(rows[3].try_get::<i64, _>("version").unwrap(), CURRENT_SCHEMA_VERSION);
    }

    #[tokio::test]
    async fn test_legacy_database_migrates_with_data_preserved() {
        let tmp = TempDir::new().expect("failed to create temp dir");
        create_legacy_database(tmp.path()).await;

        let db = Db::init(tmp.path().to_path_buf()).await.expect("legacy db migration failed");

        assert_eq!(schema_version(&db).await, CURRENT_SCHEMA_VERSION);
        let account_columns = account_column_names(&db).await;
        assert!(!account_columns.contains(&"password".to_string()));
        let columns = email_column_names(&db).await;
        assert!(columns.contains(&"recipient".to_string()));
        assert!(columns.contains(&"is_starred".to_string()));
        assert!(columns.contains(&"has_attachments".to_string()));

        let emails = db.get_emails_by_folder("acc-1", "inbox").await.unwrap();
        assert_eq!(emails.len(), 1);
        assert_eq!(emails[0].id, "acc-1_inbox_7");
        assert_eq!(emails[0].recipient, "");
        assert!(!emails[0].starred);
        assert!(!emails[0].has_attachments);
    }

    #[tokio::test]
    async fn test_newer_schema_version_is_rejected() {
        let tmp = TempDir::new().expect("failed to create temp dir");
        create_future_schema_database(tmp.path()).await;

        let err = match Db::init(tmp.path().to_path_buf()).await {
            Ok(_) => panic!("future schema database should be rejected"),
            Err(err) => err,
        };

        assert!(err.contains("newer than supported"));
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
    async fn test_get_account_by_id_returns_matching_account() {
        let (db, _tmp) = setup_db().await;
        db.insert_account(&test_account()).await.unwrap();
        db.insert_account(&Account {
            id: "acc-2".to_string(),
            name: "Other User".to_string(),
            email: "other@example.com".to_string(),
            imap_server: "imap.other.example.com".to_string(),
            imap_port: 993,
            smtp_server: "smtp.other.example.com".to_string(),
            smtp_port: 465,
            username: "other@example.com".to_string(),
            password: "secret".to_string(),
        })
        .await
        .unwrap();

        let account = db
            .get_account_by_id("acc-2")
            .await
            .unwrap()
            .expect("account should exist");

        assert_eq!(account.id, "acc-2");
        assert_eq!(account.email, "other@example.com");
        assert_eq!(account.password, "");
    }

    #[tokio::test]
    async fn test_get_account_by_id_returns_none_for_missing_account() {
        let (db, _tmp) = setup_db().await;
        db.insert_account(&test_account()).await.unwrap();

        let account = db.get_account_by_id("missing").await.unwrap();

        assert!(account.is_none());
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
    async fn test_folder_query_omits_email_body() {
        let (db, _tmp) = setup_db().await;
        db.insert_account(&test_account()).await.unwrap();
        db.upsert_email(&test_email("acc-1", 1)).await.unwrap();

        let emails = db.get_emails_by_folder("acc-1", "inbox").await.unwrap();

        assert_eq!(emails.len(), 1);
        assert_eq!(emails[0].body_text, None);
        assert_eq!(emails[0].body_html, None);
    }

    #[tokio::test]
    async fn test_get_email_by_id_returns_body() {
        let (db, _tmp) = setup_db().await;
        db.insert_account(&test_account()).await.unwrap();
        db.upsert_email(&test_email("acc-1", 1)).await.unwrap();

        let email = db
            .get_email_by_id("email-1")
            .await
            .unwrap()
            .expect("email should exist");

        assert_eq!(email.body_text.as_deref(), Some("Hello"));
        assert_eq!(email.body_html.as_deref(), Some("<p>Hello</p>"));
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

    #[tokio::test]
    async fn test_query_emails_filters_searches_and_pages() {
        let (db, _tmp) = setup_db().await;
        db.insert_account(&test_account()).await.unwrap();
        let mut other_account = test_account();
        other_account.id = "acc-2".to_string();
        other_account.email = "other@example.com".to_string();
        db.insert_account(&other_account).await.unwrap();

        for uid in 1..=3 {
            let mut email = test_email("acc-1", uid);
            email.id = format!("acc-1_inbox_{}", uid);
            email.subject = if uid == 2 { "Quarterly Budget".to_string() } else { format!("Message {}", uid) };
            email.timestamp = format!("2026-01-0{}T00:00:00+00:00", uid);
            db.upsert_email(&email).await.unwrap();
        }
        let mut other = test_email("acc-2", 1);
        other.id = "acc-2_inbox_1".to_string();
        other.subject = "Quarterly Budget".to_string();
        other.timestamp = "2026-01-04T00:00:00+00:00".to_string();
        db.upsert_email(&other).await.unwrap();

        let page = db.query_emails(&EmailQuery {
            account_ids: vec!["acc-1".to_string()],
            folder: "inbox".to_string(),
            search: None,
            cursor: None,
            limit: 2,
        }).await.unwrap();
        assert_eq!(page.iter().map(|email| email.id.as_str()).collect::<Vec<_>>(), vec!["acc-1_inbox_3", "acc-1_inbox_2"]);

        let next_page = db.query_emails(&EmailQuery {
            account_ids: vec!["acc-1".to_string()],
            folder: "inbox".to_string(),
            search: None,
            cursor: Some(EmailQueryCursor {
                timestamp: page[1].timestamp.clone(),
                id: page[1].id.clone(),
            }),
            limit: 2,
        }).await.unwrap();
        assert_eq!(next_page.iter().map(|email| email.id.as_str()).collect::<Vec<_>>(), vec!["acc-1_inbox_1"]);

        let search = db.query_emails(&EmailQuery {
            account_ids: vec!["acc-1".to_string()],
            folder: "inbox".to_string(),
            search: Some("budget".to_string()),
            cursor: None,
            limit: 10,
        }).await.unwrap();
        assert_eq!(search.len(), 1);
        assert_eq!(search[0].id, "acc-1_inbox_2");
    }

    #[tokio::test]
    async fn test_toggle_star() {
        let (db, _tmp) = setup_db().await;
        db.insert_account(&test_account()).await.unwrap();

        let email = test_email("acc-1", 1);
        db.upsert_email(&email).await.unwrap();

        // Star by id as used in upsert
        db.toggle_star("email-1", true).await.unwrap();
        let emails = db.get_emails_by_folder("acc-1", "inbox").await.unwrap();
        assert!(emails[0].starred);

        db.toggle_star("email-1", false).await.unwrap();
        let emails = db.get_emails_by_folder("acc-1", "inbox").await.unwrap();
        assert!(!emails[0].starred);
    }

    #[tokio::test]
    async fn test_attachment_insert_and_retrieve() {
        let (db, _tmp) = setup_db().await;
        db.insert_account(&test_account()).await.unwrap();
        let mut email = test_email("acc-1", 42);
        email.has_attachments = true;
        db.upsert_email(&email).await.unwrap();

        let meta = crate::models::Attachment {
            id: "email-42_att_0".to_string(),
            email_id: "email-42".to_string(),
            filename: "report.pdf".to_string(),
            mime_type: "application/pdf".to_string(),
            size: 1234,
        };
        db.insert_attachment(&meta, b"fake-pdf-bytes").await.unwrap();

        let atts = db.get_attachments_for_email("email-42").await.unwrap();
        assert_eq!(atts.len(), 1);
        assert_eq!(atts[0].filename, "report.pdf");
        assert_eq!(atts[0].size, 1234);

        let data = db.get_attachment_data("email-42_att_0").await.unwrap();
        assert_eq!(data, b"fake-pdf-bytes");
    }

    #[tokio::test]
    async fn test_insert_security_audit_log() {
        let (db, _tmp) = setup_db().await;

        let inserted = db.insert_security_audit_log(&NewSecurityAuditLog {
            event_type: "external_link".to_string(),
            severity: "medium".to_string(),
            email_id: Some("email-1".to_string()),
            account_id: Some("acc-1".to_string()),
            target: "https://example.com".to_string(),
            decision: "opened".to_string(),
        }).await.unwrap();

        assert_eq!(inserted.event_type, "external_link");
        assert_eq!(inserted.severity, "medium");
        assert_eq!(inserted.target, "https://example.com");
        assert_eq!(inserted.decision, "opened");
        assert!(!inserted.id.is_empty());
        assert!(!inserted.created_at.is_empty());
    }

    #[tokio::test]
    async fn test_list_security_audit_logs_returns_recent_first() {
        let (db, _tmp) = setup_db().await;

        db.insert_security_audit_log(&NewSecurityAuditLog {
            event_type: "external_link".to_string(),
            severity: "medium".to_string(),
            email_id: Some("email-1".to_string()),
            account_id: Some("acc-1".to_string()),
            target: "https://first.example.com".to_string(),
            decision: "opened".to_string(),
        })
        .await
        .unwrap();
        db.insert_security_audit_log(&NewSecurityAuditLog {
            event_type: "attachment_save".to_string(),
            severity: "high".to_string(),
            email_id: Some("email-2".to_string()),
            account_id: Some("acc-1".to_string()),
            target: "invoice.exe".to_string(),
            decision: "cancelled".to_string(),
        })
        .await
        .unwrap();

        let logs = db.list_security_audit_logs(1).await.unwrap();

        assert_eq!(logs.len(), 1);
        assert_eq!(logs[0].event_type, "attachment_save");
        assert_eq!(logs[0].target, "invoice.exe");
    }

    #[tokio::test]
    async fn test_suggest_contacts() {
        let (db, _tmp) = setup_db().await;
        db.insert_account(&test_account()).await.unwrap();

        // Insert an email with a known sender so it appears in suggestions.
        let mut email = test_email("acc-1", 1);
        email.sender = "Alice Smith".to_string();
        email.sender_email = "alice@example.com".to_string();
        db.upsert_email(&email).await.unwrap();

        // Insert a second email so we can verify deduplication.
        let mut email2 = test_email("acc-1", 2);
        email2.sender = "Alice Smith".to_string();
        email2.sender_email = "alice@example.com".to_string();
        email2.subject = "Second message from Alice".to_string();
        db.upsert_email(&email2).await.unwrap();

        // Insert an unrelated sender to verify filtering.
        let mut email3 = test_email("acc-1", 3);
        email3.sender = "Bob Jones".to_string();
        email3.sender_email = "bob@example.com".to_string();
        email3.subject = "Hello from Bob".to_string();
        db.upsert_email(&email3).await.unwrap();

        // Should match Alice by name prefix (case-insensitive).
        let contacts = db.suggest_contacts("alice").await.unwrap();
        assert_eq!(contacts.len(), 1, "deduplication should yield exactly one Alice");
        assert_eq!(contacts[0].email, "alice@example.com");
        assert_eq!(contacts[0].name, "Alice Smith");

        // Should match Alice by email prefix.
        let contacts2 = db.suggest_contacts("alice@ex").await.unwrap();
        assert_eq!(contacts2.len(), 1);
        assert_eq!(contacts2[0].email, "alice@example.com");

        // Query that matches nobody.
        let contacts3 = db.suggest_contacts("zzznomatch").await.unwrap();
        assert!(contacts3.is_empty(), "unexpected result for no-match query");

        // Query broad enough to match both Alice and Bob.
        let contacts4 = db.suggest_contacts("example.com").await.unwrap();
        assert_eq!(contacts4.len(), 2);
    }
}
