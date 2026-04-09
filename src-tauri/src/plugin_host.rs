use crate::models::Email;

/// Trait that Rust-side plugins implement to hook into backend pipelines.
///
/// All methods have default no-op implementations, so plugins only override
/// what they need. This follows the Tauri plugin pattern of opt-in hooks.
///
/// The plugin host calls these hooks at defined pipeline stages:
///   1. `on_emails_fetched` — after IMAP fetch, before storing to DB
///   2. `on_email_before_display` — before returning email to frontend
///   3. `on_email_before_send` — before handing off to SMTP
///
/// Plugins can transform data (e.g. strip tracking pixels, inject headers)
/// or perform side effects (e.g. logging, analytics, notifications).
pub trait MailPlugin: Send + Sync {
    /// Unique identifier. Must match the frontend plugin manifest id if paired.
    fn id(&self) -> &str;

    /// Human-readable name for logging and settings UI.
    fn name(&self) -> &str;

    /// Called after fetching emails from IMAP, before caching to SQLite.
    /// Plugins can filter, annotate, or transform emails in-place.
    fn on_emails_fetched(&self, emails: &mut Vec<Email>) {
        let _ = emails; // default: no-op
    }

    /// Called before returning an email body to the frontend.
    /// Plugins can sanitize HTML, inject styles, strip trackers, etc.
    fn on_email_before_display(&self, email: &mut Email) {
        let _ = email; // default: no-op
    }

    /// Called before sending an email via SMTP.
    /// Plugins can modify headers, validate content, or abort sending.
    /// Return `Ok(())` to proceed, `Err(reason)` to abort.
    fn on_email_before_send(
        &self,
        _to: &str,
        _subject: &str,
        body: &mut String,
    ) -> Result<(), String> {
        let _ = body;
        Ok(())
    }
}

/// Registry of active backend plugins.
/// Provides pipeline entry points that iterate over all registered plugins.
pub struct PluginHost {
    plugins: Vec<Box<dyn MailPlugin>>,
}

impl PluginHost {
    pub fn new() -> Self {
        Self {
            plugins: Vec::new(),
        }
    }

    /// Register a plugin. Called during app setup.
    pub fn register(&mut self, plugin: Box<dyn MailPlugin>) {
        log::info!("Registered backend plugin: {} ({})", plugin.name(), plugin.id());
        self.plugins.push(plugin);
    }

    /// Run the on_emails_fetched pipeline.
    pub fn run_on_emails_fetched(&self, emails: &mut Vec<Email>) {
        for plugin in &self.plugins {
            plugin.on_emails_fetched(emails);
        }
    }

    /// Run the on_email_before_display pipeline.
    pub fn run_on_email_before_display(&self, email: &mut Email) {
        for plugin in &self.plugins {
            plugin.on_email_before_display(email);
        }
    }

    /// Run the on_email_before_send pipeline.
    /// Returns first error if any plugin rejects.
    pub fn run_on_email_before_send(
        &self,
        to: &str,
        subject: &str,
        body: &mut String,
    ) -> Result<(), String> {
        for plugin in &self.plugins {
            plugin.on_email_before_send(to, subject, body)?;
        }
        Ok(())
    }

    /// Get the number of registered plugins (for testing).
    pub fn plugin_count(&self) -> usize {
        self.plugins.len()
    }
}

// ───────────────────────────────── Built-in Plugins ─────────────────────────

/// Example: strips tracking pixel images from HTML emails on fetch.
pub struct TrackingPixelStripper;

impl MailPlugin for TrackingPixelStripper {
    fn id(&self) -> &str {
        "tracking-pixel-stripper"
    }

    fn name(&self) -> &str {
        "Tracking Pixel Stripper"
    }

    fn on_emails_fetched(&self, emails: &mut Vec<Email>) {
        for email in emails.iter_mut() {
            if let Some(ref mut html) = email.body_html {
                *html = strip_tracking_pixels(html);
            }
        }
    }

    fn on_email_before_display(&self, email: &mut Email) {
        if let Some(ref mut html) = email.body_html {
            *html = strip_tracking_pixels(html);
        }
    }
}

/// Remove <img> tags that look like tracking pixels (1x1 dimensions or common tracker domains).
fn strip_tracking_pixels(html: &str) -> String {
    // Simple regex-free approach: strip img tags with width=1 height=1
    let mut result = String::with_capacity(html.len());
    let mut chars = html.chars().peekable();

    while let Some(c) = chars.next() {
        if c == '<' {
            // Collect the entire tag
            let mut tag = String::from('<');
            for tc in chars.by_ref() {
                tag.push(tc);
                if tc == '>' {
                    break;
                }
            }
            let lower = tag.to_lowercase();
            if lower.starts_with("<img")
                && (lower.contains("width=\"1\"") || lower.contains("width='1'"))
                && (lower.contains("height=\"1\"") || lower.contains("height='1'"))
            {
                // Skip this tracking pixel tag
                continue;
            }
            result.push_str(&tag);
        } else {
            result.push(c);
        }
    }
    result
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_email(body_html: Option<&str>) -> Email {
        Email {
            id: "test_inbox_1".to_string(),
            account_id: "acc1".to_string(),
            folder: "inbox".to_string(),
            uid: 1,
            sender: "Alice".to_string(),
            sender_email: "alice@test.com".to_string(),
            recipient: "me@test.com".to_string(),
            subject: "Test".to_string(),
            preview: "Preview".to_string(),
            body_html: body_html.map(String::from),
            body_text: Some("text".to_string()),
            timestamp: "2026-01-01T00:00:00Z".to_string(),
            read: false,
            starred: false,
        }
    }

    #[test]
    fn test_plugin_host_register() {
        let mut host = PluginHost::new();
        assert_eq!(host.plugin_count(), 0);
        host.register(Box::new(TrackingPixelStripper));
        assert_eq!(host.plugin_count(), 1);
    }

    #[test]
    fn test_tracking_pixel_stripper_removes_1x1_images() {
        let html = r#"<p>Hello</p><img src="https://tracker.com/pixel.gif" width="1" height="1"><p>World</p>"#;
        let result = strip_tracking_pixels(html);
        assert!(!result.contains("tracker.com"));
        assert!(result.contains("<p>Hello</p>"));
        assert!(result.contains("<p>World</p>"));
    }

    #[test]
    fn test_tracking_pixel_stripper_keeps_normal_images() {
        let html = r#"<img src="photo.jpg" width="640" height="480">"#;
        let result = strip_tracking_pixels(html);
        assert!(result.contains("photo.jpg"));
    }

    #[test]
    fn test_plugin_pipeline_emails_fetched() {
        let mut host = PluginHost::new();
        host.register(Box::new(TrackingPixelStripper));

        let mut emails = vec![make_email(Some(
            r#"<p>Hi</p><img src="t.gif" width="1" height="1">"#,
        ))];
        host.run_on_emails_fetched(&mut emails);
        assert!(!emails[0].body_html.as_ref().unwrap().contains("t.gif"));
    }

    #[test]
    fn test_plugin_before_send_ok() {
        let host = PluginHost::new();
        let mut body = "Hello".to_string();
        assert!(host.run_on_email_before_send("to@test.com", "sub", &mut body).is_ok());
    }

    #[test]
    fn test_plugin_before_display() {
        let mut host = PluginHost::new();
        host.register(Box::new(TrackingPixelStripper));

        let mut email = make_email(Some(
            r#"<img src="t.gif" width="1" height="1"><p>Content</p>"#,
        ));
        host.run_on_email_before_display(&mut email);
        let html = email.body_html.unwrap();
        assert!(!html.contains("t.gif"));
        assert!(html.contains("Content"));
    }
}
