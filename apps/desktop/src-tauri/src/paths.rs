//! Reveal in Finder and Open with the default app: the page names a vault entry, and only the
//! shell hands it to the OS, after the entry has proved it sits under the vault. Containment is
//! physical, like the server's: both sides are realpathed first, so a `..` or a symlink planted
//! inside the vault cannot reach what it points at. That realpath is the whole check, so the
//! vault's path grammar is not spelled here a second time: what it refuses besides (`.git`, a
//! staging file) is a refusal for writes, and showing one in Finder harms nothing.

use std::path::{Component, Path, PathBuf};

use serde::Serialize;

/// What the page reads back (`path-action.ts`): only whether the OS took the entry, and the
/// reason when not.
#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct PathAction {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl PathAction {
    pub const fn done() -> Self {
        Self {
            ok: true,
            reason: None,
        }
    }

    pub fn refused(reason: impl Into<String>) -> Self {
        Self {
            ok: false,
            reason: Some(reason.into()),
        }
    }
}

/// The entry's realpath when it is physically inside the vault, and never the vault itself.
pub fn resolve_vault_entry(vault_dir: &Path, relative: &str) -> Result<PathBuf, String> {
    let named = Path::new(relative);
    let plainly_relative = !relative.is_empty()
        && !relative.contains('\0')
        && named
            .components()
            .all(|component| matches!(component, Component::Normal(_) | Component::CurDir));
    let outside = || format!("{relative} is not in the vault");
    if !plainly_relative {
        return Err(outside());
    }
    let root = vault_dir.canonicalize().map_err(|_| outside())?;
    let entry = vault_dir
        .join(named)
        .canonicalize()
        .map_err(|_| outside())?;
    if entry == root || !entry.starts_with(&root) {
        return Err(outside());
    }
    Ok(entry)
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    #[test]
    fn answers_an_entry_inside_the_vault() -> std::io::Result<()> {
        let dir = tempfile::tempdir()?;
        fs::create_dir(dir.path().join("notes"))?;
        fs::write(dir.path().join("notes").join("a.md"), "# A\n")?;
        let resolved = resolve_vault_entry(dir.path(), "notes/a.md");
        assert_eq!(
            resolved,
            Ok(dir.path().canonicalize()?.join("notes").join("a.md"))
        );
        Ok(())
    }

    #[test]
    fn refuses_the_vault_itself_and_paths_out_of_it() -> std::io::Result<()> {
        let dir = tempfile::tempdir()?;
        let vault = dir.path().join("vault");
        fs::create_dir(&vault)?;
        fs::write(dir.path().join("secret"), "")?;
        for path in [
            "",
            ".",
            "../secret",
            "/etc/passwd",
            "notes/../../secret",
            "a\0b",
        ] {
            assert!(resolve_vault_entry(&vault, path).is_err(), "{path:?}");
        }
        Ok(())
    }

    #[test]
    fn refuses_a_missing_entry() -> std::io::Result<()> {
        let dir = tempfile::tempdir()?;
        assert!(resolve_vault_entry(dir.path(), "missing.md").is_err());
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    fn refuses_a_symlink_that_leads_out() -> std::io::Result<()> {
        let dir = tempfile::tempdir()?;
        let vault = dir.path().join("vault");
        fs::create_dir(&vault)?;
        fs::write(dir.path().join("key"), "")?;
        std::os::unix::fs::symlink(dir.path().join("key"), vault.join("notes.md"))?;
        assert!(resolve_vault_entry(&vault, "notes.md").is_err());
        Ok(())
    }

    #[test]
    fn serializes_as_the_page_reads_it() -> Result<(), serde_json::Error> {
        assert_eq!(
            serde_json::to_string(&PathAction::done())?,
            r#"{"ok":true}"#
        );
        assert_eq!(
            serde_json::to_string(&PathAction::refused("no"))?,
            r#"{"ok":false,"reason":"no"}"#
        );
        Ok(())
    }
}
