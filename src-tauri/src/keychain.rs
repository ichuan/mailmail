/// Thin wrapper around the OS keychain (Windows Credential Manager /
/// macOS Keychain / Linux SecretService) for storing IMAP passwords.
///
/// All entries are stored under the service name "mailmail".

const SERVICE: &str = "mailmail";

/// Store (or overwrite) a password for the given account ID.
pub fn store_password(account_id: &str, password: &str) -> Result<(), String> {
    let entry = keyring::Entry::new(SERVICE, account_id).map_err(|e| e.to_string())?;
    entry.set_password(password).map_err(|e| e.to_string())
}

/// Retrieve the password for the given account ID.
/// Returns an error if the entry does not exist.
pub fn get_password(account_id: &str) -> Result<String, String> {
    let entry = keyring::Entry::new(SERVICE, account_id).map_err(|e| e.to_string())?;
    entry.get_password().map_err(|e| e.to_string())
}

/// Delete the keychain entry for the given account ID.
/// Silently succeeds if the entry does not exist.
pub fn delete_password(account_id: &str) {
    if let Ok(entry) = keyring::Entry::new(SERVICE, account_id) {
        let _ = entry.delete_credential();
    }
}
