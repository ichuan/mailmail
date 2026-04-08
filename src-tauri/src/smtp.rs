use crate::models::Account;
use lettre::message::header::ContentType;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};

pub async fn send_email(
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

    mailer
        .send(email)
        .await
        .map_err(|e| format!("Failed to send email: {}", e))?;

    Ok(())
}
