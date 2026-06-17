pub fn redact_email_like(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut output = String::with_capacity(input.len());
    let mut cursor = 0usize;
    let mut i = 0usize;

    while i < bytes.len() {
        if bytes[i] != b'@' {
            i += 1;
            continue;
        }

        let mut start = i;
        while start > 0 && is_email_local_byte(bytes[start - 1]) {
            start -= 1;
        }

        let mut end = i + 1;
        while end < bytes.len() && is_email_domain_byte(bytes[end]) {
            end += 1;
        }

        if start == i || end == i + 1 {
            i += 1;
            continue;
        }

        output.push_str(&input[cursor..start]);
        output.push_str(&redact_email_address(&input[start..end]));
        cursor = end;
        i = end;
    }

    output.push_str(&input[cursor..]);
    output
}

fn redact_email_address(address: &str) -> String {
    let Some((local, domain)) = address.split_once('@') else {
        return address.to_string();
    };
    if local.is_empty() || domain.is_empty() {
        return "[redacted-email]".to_string();
    }

    let local_prefix = local.chars().next().unwrap_or('*');
    let domain_prefix = domain.chars().next().unwrap_or('*');
    let suffix = domain
        .rsplit_once('.')
        .map(|(_, suffix)| format!(".{}", suffix))
        .unwrap_or_default();
    format!("{}***@{}***{}", local_prefix, domain_prefix, suffix)
}

fn is_email_local_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'_' | b'%' | b'+' | b'-')
}

fn is_email_domain_byte(byte: u8) -> bool {
    byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b'-')
}

#[cfg(test)]
mod tests {
    use super::redact_email_like;

    #[test]
    fn redacts_bare_email_address() {
        assert_eq!(redact_email_like("alice@example.com"), "a***@e***.com");
    }

    #[test]
    fn redacts_email_inside_display_address() {
        assert_eq!(
            redact_email_like("Alice <alice@example.com>"),
            "Alice <a***@e***.com>"
        );
    }

    #[test]
    fn redacts_multiple_email_addresses() {
        assert_eq!(
            redact_email_like("alice@example.com, bob@work.test"),
            "a***@e***.com, b***@w***.test"
        );
    }

    #[test]
    fn leaves_text_without_email_unchanged() {
        assert_eq!(redact_email_like("account acc-1"), "account acc-1");
    }
}

