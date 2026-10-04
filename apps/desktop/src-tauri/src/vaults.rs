//! The vaults the shell remembers, and what it offers to switch to. The list is the shell's own,
//! never a vault's: a vault is a git repo that leaves this machine. Whether a switch may happen is
//! the server's rule, asked of the CLI (`door.rs`); this keeps only the list and its file.

use std::fs;
use std::path::Path;

use serde::{Deserialize, Serialize};

use crate::files::write_staged;

pub const RECENT_VAULTS_FILE_NAME: &str = "recent-vaults.json";
pub const RECENT_VAULTS_LIMIT: usize = 8;

/// The page's `vaultRefSchema`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct VaultRef {
    pub name: String,
    pub path: String,
}

pub fn vault_ref(path: &str) -> VaultRef {
    let name = Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| path.to_owned());
    VaultRef {
        name,
        path: path.to_owned(),
    }
}

/// The page's `vaultsStateSchema`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct VaultsState {
    /// None when a switch would be honoured; else why the page offers no picker.
    pub blocked: Option<String>,
    pub current: VaultRef,
    /// The others, newest first; the current one is never in it.
    pub recent: Vec<VaultRef>,
}

/// Newest first, one row per path.
pub fn remember(recent: &[String], path: &str) -> Vec<String> {
    std::iter::once(path.to_owned())
        .chain(recent.iter().filter(|each| *each != path).cloned())
        .take(RECENT_VAULTS_LIMIT)
        .collect()
}

pub fn forget(recent: &[String], path: &str) -> Vec<String> {
    recent
        .iter()
        .filter(|each| *each != path)
        .cloned()
        .collect()
}

/// What the menu and the page both offer: never the vault already open, and never a folder that is
/// gone (an unmounted drive stays remembered, and is offered again once it is back).
pub fn offered(
    recent: &[String],
    current: Option<&str>,
    exists: impl Fn(&str) -> bool,
) -> Vec<String> {
    recent
        .iter()
        .filter(|path| Some(path.as_str()) != current && exists(path))
        .cloned()
        .collect()
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct RecentFile {
    vaults: Vec<RecentRow>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct RecentRow {
    path: String,
}

/// A convenience, not a store: bytes that are not a list read as nothing remembered, and say so,
/// rather than refusing to boot over a file the person never wrote.
pub fn read_recent(path: &Path) -> Vec<String> {
    let Ok(raw) = fs::read_to_string(path) else {
        return Vec::new();
    };
    if let Ok(file) = serde_json::from_str::<RecentFile>(&raw) {
        file.vaults
            .into_iter()
            .map(|row| row.path)
            .filter(|path| !path.is_empty())
            .collect()
    } else {
        eprintln!(
            "[desktop] {} is not a recent-vaults list; starting over",
            path.display()
        );
        Vec::new()
    }
}

pub fn write_recent(path: &Path, recent: &[String]) -> std::io::Result<()> {
    let file = RecentFile {
        vaults: recent
            .iter()
            .map(|path| RecentRow { path: path.clone() })
            .collect(),
    };
    let json = serde_json::to_string_pretty(&file).map_err(std::io::Error::other)?;
    write_staged(path, format!("{json}\n").as_bytes())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn paths(values: &[&str]) -> Vec<String> {
        values.iter().map(|value| (*value).to_owned()).collect()
    }

    #[test]
    fn remembers_newest_first_once_each_up_to_the_limit() {
        let recent = paths(&["/b", "/a"]);
        assert_eq!(remember(&recent, "/a"), paths(&["/a", "/b"]));
        let full: Vec<String> = (0..RECENT_VAULTS_LIMIT).map(|n| format!("/{n}")).collect();
        let next = remember(&full, "/new");
        assert_eq!(next.len(), RECENT_VAULTS_LIMIT);
        assert_eq!(next[0], "/new");
    }

    #[test]
    fn offers_neither_the_open_vault_nor_a_missing_one() {
        let recent = paths(&["/open", "/gone", "/here"]);
        assert_eq!(
            offered(&recent, Some("/open"), |path| path != "/gone"),
            paths(&["/here"])
        );
    }

    #[test]
    fn names_a_vault_by_its_folder() {
        assert_eq!(vault_ref("/Users/k/Notes").name, "Notes");
        assert_eq!(vault_ref("/").name, "/");
    }

    #[test]
    fn round_trips_the_file_the_electron_shell_wrote() -> std::io::Result<()> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join(RECENT_VAULTS_FILE_NAME);
        fs::write(
            &path,
            "{\n  \"vaults\": [\n    {\n      \"path\": \"/a\"\n    }\n  ]\n}\n",
        )?;
        assert_eq!(read_recent(&path), paths(&["/a"]));
        write_recent(&path, &paths(&["/b", "/a"]))?;
        assert_eq!(read_recent(&path), paths(&["/b", "/a"]));
        fs::write(&path, "[1, 2]")?;
        assert_eq!(read_recent(&path), Vec::<String>::new());
        Ok(())
    }
}
