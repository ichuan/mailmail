use serde::{Serialize, Deserialize};

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
    pub password: String, // In a real app this should be securely stored in the OS keyring
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
}
