//! The account this Mac is signed in to, and everything of it the shell holds: the credential in
//! the Keychain, the replica's file for that account, its staged and cached files, and the bearer
//! the file scheme fetches a miss with. A sign-in keeps the credential and opens the account's
//! replica; a launch restores both; a sign-out leaves nothing of the account behind.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};

use crate::credential::{Credentials, DeviceCredential};
use crate::error::ShellResult;
use crate::file_cache::{self, FileCache};
use crate::replica::Replica;

pub struct Account {
    credentials: Credentials,
    replica: Replica,
    files: FileCache,
    library_dir: PathBuf,
    bearer: Mutex<Option<String>>,
}

impl Account {
    pub fn new(
        credentials: Credentials,
        replica: Replica,
        files: FileCache,
        library_dir: PathBuf,
    ) -> Self {
        Self {
            credentials,
            replica,
            files,
            library_dir,
            bearer: Mutex::new(None),
        }
    }

    fn bearer_slot(&self) -> MutexGuard<'_, Option<String>> {
        self.bearer.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn replica(&self) -> &Replica {
        &self.replica
    }

    pub fn files(&self) -> &FileCache {
        &self.files
    }

    /// The credential a miss is fetched with, while an account is signed in.
    pub fn bearer(&self) -> Option<String> {
        self.bearer_slot().clone()
    }

    /// The account's replica: one file an account, named by a hash of its id, so no id reaches a
    /// path.
    fn replica_path(&self, user_id: &str) -> PathBuf {
        let name = file_cache::sha_of(user_id.as_bytes());
        self.library_dir.join(format!("{name}.sqlite"))
    }

    fn open(&self, credential: &DeviceCredential) -> ShellResult<()> {
        self.replica.open(&self.replica_path(&credential.user_id))?;
        self.bearer_slot().replace(credential.credential.clone());
        Ok(())
    }

    /// The credential a sign-in kept, with its account's replica open; None when signed out.
    pub fn restore(&self) -> ShellResult<Option<DeviceCredential>> {
        let Some(credential) = self.credentials.read()? else {
            return Ok(None);
        };
        self.open(&credential)?;
        Ok(Some(credential))
    }

    /// A sign-in's credential, kept in the Keychain before its account's replica opens.
    pub fn keep(&self, credential: &DeviceCredential) -> ShellResult<()> {
        self.credentials.keep(credential)?;
        self.open(credential)
    }

    /// Signs this Mac out: the credential, the replica's file and every file of the account go.
    pub fn forget(&self) -> ShellResult<()> {
        self.bearer_slot().take();
        self.replica.close();
        remove_dir(&self.library_dir)?;
        self.files.clear()?;
        self.credentials.forget()
    }
}

fn remove_dir(dir: &Path) -> std::io::Result<()> {
    match std::fs::remove_dir_all(dir) {
        Err(error) if error.kind() != std::io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;

    use keyring_core::CredentialStore;
    use serde_json::json;

    use super::*;
    use crate::file_cache::CACHE_LIMIT_BYTES;
    use crate::replica::{Statement, TRANSACTION_IDLE_LIMIT};

    fn account_in(dir: &Path, store: &Arc<CredentialStore>) -> Account {
        Account::new(
            Credentials::with_store(Arc::clone(store), "com.inteligir.desktop"),
            Replica::new(TRANSACTION_IDLE_LIMIT),
            FileCache::new(dir.join("staged"), dir.join("cache"), CACHE_LIMIT_BYTES),
            dir.join("library"),
        )
    }

    fn signed_in() -> DeviceCredential {
        DeviceCredential {
            credential: format!("igd_{}", "b".repeat(64)),
            device_id: "device-1".to_owned(),
            email: "owner@example.com".to_owned(),
            user_id: "user-1".to_owned(),
        }
    }

    fn statement(sql: &str) -> Statement {
        Statement {
            sql: sql.to_owned(),
            params: vec![],
        }
    }

    #[test]
    fn a_sign_in_opens_the_account_s_replica_and_a_relaunch_restores_it() -> ShellResult<()> {
        let dir = tempfile::tempdir()?;
        let store: Arc<CredentialStore> = keyring_core::mock::Store::new()?;
        let first = account_in(dir.path(), &store);
        assert_eq!(first.restore()?, None);
        assert_eq!(first.bearer(), None);
        first.keep(&signed_in())?;
        assert_eq!(first.bearer(), Some(signed_in().credential));
        first
            .replica()
            .run(&statement("CREATE TABLE kept (body TEXT)"))?;
        first
            .replica()
            .run(&statement("INSERT INTO kept VALUES ('offline')"))?;
        first.replica().close();

        let relaunched = account_in(dir.path(), &store);
        assert_eq!(relaunched.restore()?, Some(signed_in()));
        let rows = relaunched
            .replica()
            .all(&statement("SELECT body FROM kept"))?;
        assert_eq!(rows[0].get("body"), Some(&json!("offline")));
        Ok(())
    }

    #[test]
    fn a_sign_out_leaves_nothing_of_the_account() -> ShellResult<()> {
        let dir = tempfile::tempdir()?;
        let store: Arc<CredentialStore> = keyring_core::mock::Store::new()?;
        let account = account_in(dir.path(), &store);
        account.keep(&signed_in())?;
        account
            .replica()
            .run(&statement("CREATE TABLE kept (body TEXT)"))?;
        let bytes = b"a staged photo";
        let sha = file_cache::sha_of(bytes);
        account.files().stage(&sha, bytes)?;
        account.forget()?;
        assert_eq!(account.bearer(), None);
        assert!(!dir.path().join("library").exists());
        assert_eq!(account.files().staged(&sha)?, None);
        assert!(account.replica().all(&statement("SELECT 1")).is_err());
        assert_eq!(account_in(dir.path(), &store).restore()?, None);
        Ok(())
    }
}
