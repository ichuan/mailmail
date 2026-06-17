use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub name: String,
    pub email: String,
    pub imap_server: String,
    pub imap_port: u16,
    pub smtp_server: String,
    pub smtp_port: u16,
    pub username: String,
    #[serde(default, skip_serializing)]
    pub password: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PublicAccount {
    pub id: String,
    pub name: String,
    pub email: String,
    pub imap_server: String,
    pub imap_port: u16,
    pub smtp_server: String,
    pub smtp_port: u16,
    pub username: String,
}

impl From<&Account> for PublicAccount {
    fn from(account: &Account) -> Self {
        Self {
            id: account.id.clone(),
            name: account.name.clone(),
            email: account.email.clone(),
            imap_server: account.imap_server.clone(),
            imap_port: account.imap_port,
            smtp_server: account.smtp_server.clone(),
            smtp_port: account.smtp_port,
            username: account.username.clone(),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AppErrorCode {
    NetworkUnavailable,
    TlsFailed,
    AuthFailed,
    ServerRejected,
    Timeout,
    RateLimited,
    ProtocolError,
    DbUnavailable,
    KeychainUnavailable,
    InvalidInput,
    PluginRejected,
    Unknown,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum AppErrorUserAction {
    Retry,
    Reauthenticate,
    CheckSettings,
    Wait,
    ContactSupport,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AppError {
    pub code: AppErrorCode,
    pub message: String,
    pub retryable: bool,
    pub user_action: AppErrorUserAction,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
}

impl AppError {
    pub fn new(
        code: AppErrorCode,
        message: String,
        retryable: bool,
        user_action: AppErrorUserAction,
    ) -> Self {
        Self {
            code,
            message,
            retryable,
            user_action,
            details: None,
        }
    }

    pub fn from_message(message: String) -> Self {
        let lower = message.to_lowercase();
        if lower.contains("login failed")
            || lower.contains("auth")
            || lower.contains("invalid credentials")
        {
            return Self::new(
                AppErrorCode::AuthFailed,
                message,
                false,
                AppErrorUserAction::Reauthenticate,
            );
        }
        if lower.contains("keychain")
            || lower.contains("secure storage")
            || lower.contains("credential")
        {
            return Self::new(
                AppErrorCode::KeychainUnavailable,
                message,
                false,
                AppErrorUserAction::Reauthenticate,
            );
        }
        if lower.contains("timeout") || lower.contains("timed out") {
            return Self::new(
                AppErrorCode::Timeout,
                message,
                true,
                AppErrorUserAction::Retry,
            );
        }
        if lower.contains("tls") || lower.contains("certificate") || lower.contains("handshake") {
            return Self::new(
                AppErrorCode::TlsFailed,
                message,
                false,
                AppErrorUserAction::CheckSettings,
            );
        }
        if lower.contains("network") || lower.contains("connection") || lower.contains("tcp") {
            return Self::new(
                AppErrorCode::NetworkUnavailable,
                message,
                true,
                AppErrorUserAction::Retry,
            );
        }
        Self::new(
            AppErrorCode::Unknown,
            message,
            false,
            AppErrorUserAction::ContactSupport,
        )
    }
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Email {
    pub id: String, // deterministic: "{account_id}_{folder}_{uid}"
    pub account_id: String,
    pub folder: String,
    pub uid: u32,
    pub sender: String,
    pub sender_email: String,
    /// The "To:" header value, showing which address actually received this email
    pub recipient: String,
    pub subject: String,
    pub preview: String,
    pub body_html: Option<String>,
    pub body_text: Option<String>,
    pub timestamp: String,
    pub read: bool,
    #[serde(default)]
    pub starred: bool,
    #[serde(default)]
    pub has_attachments: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmailQueryCursor {
    pub timestamp: String,
    pub id: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmailQuery {
    #[serde(default)]
    pub account_ids: Vec<String>,
    pub folder: String,
    #[serde(default)]
    pub search: Option<String>,
    #[serde(default)]
    pub cursor: Option<EmailQueryCursor>,
    #[serde(default = "default_email_query_limit")]
    pub limit: u32,
}

fn default_email_query_limit() -> u32 {
    50
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Attachment {
    pub id: String,
    pub email_id: String,
    pub filename: String,
    pub mime_type: String,
    pub size: i64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SecurityAuditLog {
    pub id: String,
    pub event_type: String,
    pub severity: String,
    pub email_id: Option<String>,
    pub account_id: Option<String>,
    pub target: String,
    pub decision: String,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NewSecurityAuditLog {
    pub event_type: String,
    pub severity: String,
    #[serde(default)]
    pub email_id: Option<String>,
    #[serde(default)]
    pub account_id: Option<String>,
    pub target: String,
    pub decision: String,
}

/// Internal transfer type for carrying raw attachment bytes from imap.rs to main.rs.
/// Not serialized — the data is stored in the DB, then fetched on demand.
pub struct AttachmentWithData {
    pub meta: Attachment,
    pub data: Vec<u8>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Signature {
    pub id: String,
    pub name: String,
    pub content: String,
    pub is_default: bool,
}

/// A contact suggestion derived from historical email senders and recipients.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Contact {
    pub name: String,
    pub email: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_account_serializes_to_camel_case() {
        let account = Account {
            id: "1".to_string(),
            name: "Test".to_string(),
            email: "a@b.example.com".to_string(),
            imap_server: "imap.b.com".to_string(),
            imap_port: 993,
            smtp_server: "smtp.b.com".to_string(),
            smtp_port: 465,
            username: "a@b.example.com".to_string(),
            password: "pass".to_string(),
        };
        let json = serde_json::to_string(&account).unwrap();
        assert!(json.contains("imapServer"));
        assert!(json.contains("imapPort"));
        assert!(json.contains("smtpServer"));
        assert!(json.contains("smtpPort"));
        assert!(!json.contains("imap_server"));
    }

    #[test]
    fn test_account_deserializes_from_camel_case() {
        let json = r#"{
            "id": "1",
            "name": "Test",
            "email": "a@b.example.com",
            "imapServer": "imap.b.com",
            "imapPort": 993,
            "smtpServer": "smtp.b.com",
            "smtpPort": 465,
            "username": "a@b.example.com",
            "password": "pass"
        }"#;
        let account: Account = serde_json::from_str(json).unwrap();
        assert_eq!(account.imap_server, "imap.b.com");
        assert_eq!(account.imap_port, 993);
    }

    #[test]
    fn test_email_serializes_to_camel_case() {
        let email = Email {
            id: "1".to_string(),
            account_id: "acc-1".to_string(),
            folder: "inbox".to_string(),
            uid: 42,
            sender: "from@test.example.com".to_string(),
            sender_email: "from@test.example.com".to_string(),
            recipient: "me@test.example.com".to_string(),
            subject: "Hello".to_string(),
            preview: "Preview".to_string(),
            body_html: None,
            body_text: Some("text".to_string()),
            timestamp: "2026-01-01T00:00:00Z".to_string(),
            read: false,
            starred: false,
            has_attachments: false,
        };
        let json = serde_json::to_string(&email).unwrap();
        assert!(json.contains("accountId"));
        assert!(json.contains("senderEmail"));
        assert!(json.contains("bodyHtml"));
        assert!(json.contains("bodyText"));
        assert!(!json.contains("account_id"));
        assert!(!json.contains("body_html"));
    }

    #[test]
    fn test_email_deserializes_from_camel_case() {
        let json = r#"{
            "id": "1",
            "accountId": "acc-1",
            "folder": "inbox",
            "uid": 42,
            "sender": "from@test.example.com",
            "senderEmail": "from@test.example.com",
            "recipient": "me@test.example.com",
            "subject": "Hello",
            "preview": "Preview",
            "bodyHtml": null,
            "bodyText": "text",
            "timestamp": "2026-01-01T00:00:00Z",
            "read": false
        }"#;
        let email: Email = serde_json::from_str(json).unwrap();
        assert_eq!(email.account_id, "acc-1");
        assert_eq!(email.sender_email, "from@test.example.com");
        assert_eq!(email.recipient, "me@test.example.com");
        assert_eq!(email.body_text, Some("text".to_string()));
    }

    #[test]
    fn test_app_error_serializes_to_frontend_shape() {
        let error = AppError::new(
            AppErrorCode::KeychainUnavailable,
            "Credential unavailable".to_string(),
            false,
            AppErrorUserAction::Reauthenticate,
        );

        let json = serde_json::to_value(&error).unwrap();

        assert_eq!(json["code"], "keychain_unavailable");
        assert_eq!(json["message"], "Credential unavailable");
        assert_eq!(json["retryable"], false);
        assert_eq!(json["userAction"], "reauthenticate");
    }

    #[test]
    fn test_app_error_classifies_legacy_messages() {
        assert_eq!(
            AppError::from_message("No matching entry in secure storage".to_string()).code,
            AppErrorCode::KeychainUnavailable,
        );
        assert_eq!(
            AppError::from_message("TCP connection timed out".to_string()).code,
            AppErrorCode::Timeout,
        );
        assert_eq!(
            AppError::from_message("Login failed: invalid credentials".to_string()).code,
            AppErrorCode::AuthFailed,
        );
    }
}
