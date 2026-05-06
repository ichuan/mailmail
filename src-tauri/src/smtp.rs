use crate::models::Account;
use lettre::message::header::ContentType;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use std::time::Duration;

const SMTP_SEND_TIMEOUT_SECS: u64 = 20;
const SMTP_MAX_RETRIES: u32 = 2;

pub fn is_transient_smtp_error(message: &str) -> bool {
    let lower = message.to_ascii_lowercase();
    lower.contains("timeout")
        || lower.contains("timed out")
        || lower.contains("temporar")
        || lower.contains("try again")
        || lower.contains("connection")
        || lower.contains("network")
        || lower.contains("i/o")
        || lower.contains("io error")
}

pub async fn send_email(
    account: &Account,
    to: &str,
    subject: &str,
    body: &str,
    in_reply_to: Option<&str>,
) -> Result<(), String> {
    let mut attempt = 0;
    loop {
        match send_email_once(account, to, subject, body, in_reply_to).await {
            Ok(()) => return Ok(()),
            Err(e) if is_transient_smtp_error(&e) && attempt < SMTP_MAX_RETRIES => {
                attempt += 1;
                let delay = Duration::from_secs(5 * 2_u64.pow(attempt - 1));
                log::warn!("SMTP transient failure, retry {}/{} in {:?}", attempt, SMTP_MAX_RETRIES, delay);
                tokio::time::sleep(delay).await;
            }
            Err(e) => return Err(e),
        }
    }
}

async fn send_email_once(
    account: &Account,
    to: &str,
    subject: &str,
    body: &str,
    in_reply_to: Option<&str>,
) -> Result<(), String> {
    let mut msg_builder = Message::builder()
        .from(
            format!("{} <{}>", account.name, account.email)
                .parse()
                .map_err(|e| format!("Invalid from address: {}", e))?,
        )
        .to(to.parse().map_err(|e| format!("Invalid to address: {}", e))?)
        .subject(subject);

    if let Some(reply_id) = in_reply_to {
        msg_builder = msg_builder.in_reply_to(reply_id.to_string());
    }

    let email = msg_builder
        .header(ContentType::TEXT_PLAIN)
        .body(body.to_string())
        .map_err(|e| format!("Failed to build email: {}", e))?;

    let creds = Credentials::new(account.username.clone(), account.password.clone());

    // Determine transport based on port: 465 = implicit TLS, 587 = STARTTLS
    let mailer = if account.smtp_port == 465 {
        AsyncSmtpTransport::<Tokio1Executor>::relay(&account.smtp_server)
            .map_err(|e| format!("SMTP relay error: {}", e))?
            .credentials(creds)
            .port(account.smtp_port)
            .build()
    } else {
        AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&account.smtp_server)
            .map_err(|e| format!("SMTP STARTTLS error: {}", e))?
            .credentials(creds)
            .port(account.smtp_port)
            .build()
    };

    tokio::time::timeout(Duration::from_secs(SMTP_SEND_TIMEOUT_SECS), mailer.send(email))
        .await
        .map_err(|_| format!("Failed to send email: SMTP send timed out after {}s", SMTP_SEND_TIMEOUT_SECS))?
        .map_err(|e| format!("Failed to send email: {}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::is_transient_smtp_error;

    #[test]
    fn classifies_transient_smtp_errors() {
        assert!(is_transient_smtp_error("SMTP send timed out after 20s"));
        assert!(is_transient_smtp_error("connection reset by peer"));
        assert!(is_transient_smtp_error("temporarily unavailable, try again"));
    }

    #[test]
    fn leaves_permanent_smtp_errors_non_transient() {
        assert!(!is_transient_smtp_error("Invalid recipient address"));
        assert!(!is_transient_smtp_error("Authentication failed"));
    }
}
