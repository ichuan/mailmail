use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const CONFIG_FILE_NAME: &str = "config.json";
const DATA_DIR_NAME: &str = "data";
const WRITE_TEST_FILE_NAME: &str = ".mailmail-write-test";
const DATABASE_FILE_SUFFIXES: [&str; 3] = ["", "-wal", "-shm"];
pub const DATABASE_FILE_NAME: &str = "mailmail.sqlite";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DataDirInfo {
    pub data_dir: String,
    pub default_data_dir: String,
    pub is_custom: bool,
}

#[derive(Debug, Default, Deserialize, Serialize)]
struct AppConfig {
    data_dir: Option<PathBuf>,
}

pub fn config_file_path(app_config_dir: &Path) -> PathBuf {
    app_config_dir.join(CONFIG_FILE_NAME)
}

pub fn default_data_dir(app_config_dir: &Path) -> PathBuf {
    app_config_dir.join(DATA_DIR_NAME)
}

pub fn resolve_initial_data_dir(app_config_dir: &Path) -> Result<PathBuf, String> {
    std::fs::create_dir_all(app_config_dir).map_err(|e| e.to_string())?;
    let config = load_config(app_config_dir)?;
    let data_dir = if let Some(custom_dir) = config.data_dir {
        custom_dir
    } else if app_config_dir.join(DATABASE_FILE_NAME).exists() {
        app_config_dir.to_path_buf()
    } else {
        default_data_dir(app_config_dir)
    };
    prepare_data_dir(&data_dir)
}

pub fn data_dir_info(app_config_dir: &Path, data_dir: &Path) -> DataDirInfo {
    let default_dir = default_data_dir(app_config_dir);
    DataDirInfo {
        data_dir: data_dir.display().to_string(),
        default_data_dir: default_dir.display().to_string(),
        is_custom: !paths_equivalent(data_dir, &default_dir),
    }
}

pub fn prepare_data_dir(data_dir: &Path) -> Result<PathBuf, String> {
    if data_dir.as_os_str().is_empty() {
        return Err("Data directory must not be empty".to_string());
    }
    if data_dir.exists() && !data_dir.is_dir() {
        return Err(format!(
            "Data directory is not a directory: {}",
            data_dir.display()
        ));
    }
    std::fs::create_dir_all(data_dir)
        .map_err(|e| format!("Failed to create data directory: {}", e))?;
    let canonical = data_dir
        .canonicalize()
        .map_err(|e| format!("Failed to resolve data directory: {}", e))?;
    ensure_data_dir_writable(&canonical)?;
    Ok(canonical)
}

pub fn save_data_dir_config(app_config_dir: &Path, data_dir: &Path) -> Result<(), String> {
    std::fs::create_dir_all(app_config_dir).map_err(|e| e.to_string())?;
    let default_dir = default_data_dir(app_config_dir);
    let config = if paths_equivalent(data_dir, &default_dir) {
        AppConfig::default()
    } else {
        AppConfig {
            data_dir: Some(data_dir.to_path_buf()),
        }
    };
    let json = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    std::fs::write(config_file_path(app_config_dir), json).map_err(|e| e.to_string())
}

pub fn migrate_database_files(source_dir: &Path, target_dir: &Path) -> Result<bool, String> {
    if paths_equivalent(source_dir, target_dir) {
        return Ok(false);
    }

    let source_db = source_dir.join(DATABASE_FILE_NAME);
    if !source_db.exists() {
        return Ok(false);
    }

    std::fs::create_dir_all(target_dir).map_err(|e| e.to_string())?;
    for suffix in DATABASE_FILE_SUFFIXES {
        let target = target_dir.join(format!("{}{}", DATABASE_FILE_NAME, suffix));
        if target.exists() {
            return Err(format!(
                "Target data directory already contains database files for {}",
                DATABASE_FILE_NAME
            ));
        }
    }

    let mut copied_paths = Vec::new();
    for suffix in DATABASE_FILE_SUFFIXES {
        let source = source_dir.join(format!("{}{}", DATABASE_FILE_NAME, suffix));
        if source.exists() {
            let target = target_dir.join(format!("{}{}", DATABASE_FILE_NAME, suffix));
            if let Err(err) = std::fs::copy(&source, &target) {
                for copied_path in copied_paths {
                    std::fs::remove_file(copied_path).ok();
                }
                return Err(format!("Failed to copy {}: {}", source.display(), err));
            }
            copied_paths.push(target);
        }
    }

    Ok(true)
}

pub fn remove_database_files(data_dir: &Path) -> Result<(), String> {
    for suffix in DATABASE_FILE_SUFFIXES {
        let path = data_dir.join(format!("{}{}", DATABASE_FILE_NAME, suffix));
        if path.exists() {
            std::fs::remove_file(&path)
                .map_err(|e| format!("Failed to remove {}: {}", path.display(), e))?;
        }
    }
    Ok(())
}

pub fn paths_equivalent(left: &Path, right: &Path) -> bool {
    let left = left.canonicalize().unwrap_or_else(|_| left.to_path_buf());
    let right = right.canonicalize().unwrap_or_else(|_| right.to_path_buf());
    left == right
}

fn load_config(app_config_dir: &Path) -> Result<AppConfig, String> {
    let path = config_file_path(app_config_dir);
    if !path.exists() {
        return Ok(AppConfig::default());
    }
    let raw = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    serde_json::from_str(&raw).map_err(|e| format!("Invalid app config: {}", e))
}

fn ensure_data_dir_writable(data_dir: &Path) -> Result<(), String> {
    let test_path = data_dir.join(WRITE_TEST_FILE_NAME);
    std::fs::write(&test_path, b"ok")
        .map_err(|e| format!("Data directory is not writable: {}", e))?;
    std::fs::remove_file(&test_path).map_err(|e| format!("Failed to remove write test file: {}", e))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn fresh_install_uses_data_subdirectory() {
        let tmp = TempDir::new().unwrap();

        let data_dir = resolve_initial_data_dir(tmp.path()).unwrap();

        assert!(paths_equivalent(&data_dir, &tmp.path().join(DATA_DIR_NAME)));
    }

    #[test]
    fn legacy_install_keeps_existing_app_data_database() {
        let tmp = TempDir::new().unwrap();
        std::fs::write(tmp.path().join(DATABASE_FILE_NAME), b"legacy").unwrap();

        let data_dir = resolve_initial_data_dir(tmp.path()).unwrap();

        assert!(paths_equivalent(&data_dir, tmp.path()));
    }

    #[test]
    fn saved_custom_data_dir_is_loaded() {
        let tmp = TempDir::new().unwrap();
        let custom = tmp.path().join("custom-data");
        std::fs::create_dir_all(&custom).unwrap();

        save_data_dir_config(tmp.path(), &custom).unwrap();
        let data_dir = resolve_initial_data_dir(tmp.path()).unwrap();

        assert!(paths_equivalent(&data_dir, &custom));
    }

    #[test]
    fn database_files_migrate_without_overwriting_existing_database() {
        let tmp = TempDir::new().unwrap();
        let source = tmp.path().join("source");
        let target = tmp.path().join("target");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(source.join(DATABASE_FILE_NAME), b"db").unwrap();
        std::fs::write(source.join(format!("{}-wal", DATABASE_FILE_NAME)), b"wal").unwrap();

        assert!(migrate_database_files(&source, &target).unwrap());
        assert_eq!(
            std::fs::read(target.join(DATABASE_FILE_NAME)).unwrap(),
            b"db"
        );
        assert_eq!(
            std::fs::read(target.join(format!("{}-wal", DATABASE_FILE_NAME))).unwrap(),
            b"wal"
        );

        let second_target = tmp.path().join("second-target");
        std::fs::create_dir_all(&second_target).unwrap();
        std::fs::write(second_target.join(DATABASE_FILE_NAME), b"existing").unwrap();
        let err = migrate_database_files(&source, &second_target).unwrap_err();
        assert!(err.contains("already contains"));
    }

    #[test]
    fn target_sidecar_files_are_not_overwritten() {
        let tmp = TempDir::new().unwrap();
        let source = tmp.path().join("source");
        let target = tmp.path().join("target");
        std::fs::create_dir_all(&source).unwrap();
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(source.join(DATABASE_FILE_NAME), b"db").unwrap();
        std::fs::write(
            target.join(format!("{}-wal", DATABASE_FILE_NAME)),
            b"existing",
        )
        .unwrap();

        let err = migrate_database_files(&source, &target).unwrap_err();

        assert!(err.contains("already contains"));
        assert_eq!(
            std::fs::read(target.join(format!("{}-wal", DATABASE_FILE_NAME))).unwrap(),
            b"existing"
        );
    }
}
