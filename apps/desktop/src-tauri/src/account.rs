//! The account this Mac is signed in to, and everything of it the shell holds: the credential in
//! the Keychain, the replica's file for that account, its staged and cached files, and the bearer
//! the file scheme fetches a miss with. A sign-in opens the account's replica and keeps the
//! credential; a launch restores both; a sign-out leaves nothing of the account behind.

use std::path::PathBuf;
use std::sync::{Mutex, MutexGuard, PoisonError};

use crate::credential::{Credentials, DeviceCredential};
use crate::error::{ShellError, ShellResult};
use crate::file_cache::{self, FetchAs, FileCache, Landing};
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

    /// The credential a miss is fetched with, while an account is signed in. The generation is
    /// read first, so a sign-out that lands between the two reads leaves it behind and what it
    /// was read for lands nothing.
    pub fn fetching_as(&self) -> Option<FetchAs> {
        let since = self.files.generation();
        let bearer = self.bearer_slot().clone()?;
        Some(FetchAs { bearer, since })
    }

    /// A file the outbox will upload, for the account signed in. One that outlives its account
    /// would sit in the data dir with no row naming it, since nothing evicts a staged file, so it
    /// is refused as the row itself would be.
    pub fn stage(&self, sha: &str, bytes: &[u8], content_type: &str) -> ShellResult<()> {
        let asking = self.fetching_as().ok_or(ShellError::SignedOut)?;
        match self.files.stage(sha, bytes, content_type, asking.since)? {
            Landing::Kept => Ok(()),
            Landing::AccountLeft => Err(ShellError::SignedOut),
        }
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

    /// A sign-in's credential, kept in the Keychain once its account's replica opened: the page
    /// revokes a sign-in this refuses, so the Keychain never holds one it let go.
    pub fn keep(&self, credential: &DeviceCredential) -> ShellResult<()> {
        self.open(credential)?;
        self.credentials.keep(credential).inspect_err(|_| {
            self.close();
        })
    }

    fn close(&self) {
        self.bearer_slot().take();
        self.replica.close();
    }

    /// Signs this Mac out: the credential, the replica's file and every file of the account go.
    /// Answers the credential let go, for a page whose library never opened to give its device
    /// back; a Keychain that will not read it stops none of the rest.
    pub fn forget(&self) -> ShellResult<Option<DeviceCredential>> {
        self.close();
        file_cache::remove_dir_if_there(&self.library_dir)?;
        self.files.clear()?;
        let kept = self.credentials.read().unwrap_or_default();
        self.credentials.forget()?;
        Ok(kept)
    }
}

#[cfg(test)]
mod tests {
    use std::error::Error;
    use std::io::{BufRead, BufReader, Write};
    use std::net::TcpListener;
    use std::path::Path;
    use std::sync::{Arc, mpsc};

    use keyring_core::CredentialStore;
    use serde_json::json;
    use tauri::http::{Request, StatusCode};

    use super::*;
    use crate::file_cache::{CACHE_LIMIT_BYTES, CloudFiles};
    use crate::file_scheme;
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
            email: "owner@example.com".to_owned(),
            user_id: "user-1".to_owned(),
        }
    }

    fn bearer_of(account: &Account) -> Option<String> {
        account.fetching_as().map(|fetching| fetching.bearer)
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
        assert_eq!(bearer_of(&first), None);
        first.keep(&signed_in())?;
        assert_eq!(bearer_of(&first), Some(signed_in().credential));
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
        account.stage(&sha, bytes, "image/png")?;
        assert_eq!(account.forget()?, Some(signed_in()));
        assert_eq!(account.forget()?, None);
        assert_eq!(bearer_of(&account), None);
        assert!(!dir.path().join("library").exists());
        assert_eq!(account.files().staged(&sha)?, None);
        assert!(account.replica().all(&statement("SELECT 1")).is_err());
        assert_eq!(account_in(dir.path(), &store).restore()?, None);
        Ok(())
    }

    #[test]
    fn a_file_staged_once_the_account_left_is_refused_and_held_nowhere() -> ShellResult<()> {
        let dir = tempfile::tempdir()?;
        let store: Arc<CredentialStore> = keyring_core::mock::Store::new()?;
        let account = account_in(dir.path(), &store);
        account.keep(&signed_in())?;
        account.forget()?;
        let bytes = b"a photo dropped as the Mac was revoked";
        let sha = file_cache::sha_of(bytes);
        assert!(matches!(
            account.stage(&sha, bytes, "image/png"),
            Err(ShellError::SignedOut)
        ));
        assert_eq!(account.files().staged(&sha)?, None);
        assert!(!dir.path().join("staged").exists());
        Ok(())
    }

    #[test]
    fn a_file_on_its_way_up_at_a_sign_out_lands_nothing() -> ShellResult<()> {
        let dir = tempfile::tempdir()?;
        let store: Arc<CredentialStore> = keyring_core::mock::Store::new()?;
        let account = account_in(dir.path(), &store);
        account.keep(&signed_in())?;
        let bytes = b"a photo dropped as the Mac was revoked";
        let sha = file_cache::sha_of(bytes);
        let since = account.fetching_as().ok_or(ShellError::SignedOut)?.since;
        account.forget()?;
        assert_eq!(
            account.files().stage(&sha, bytes, "image/png", since)?,
            Landing::AccountLeft
        );
        assert_eq!(account.files().staged(&sha)?, None);
        assert!(!dir.path().join("staged").exists());
        Ok(())
    }

    #[test]
    fn a_sign_in_whose_replica_will_not_open_leaves_no_credential() -> ShellResult<()> {
        let dir = tempfile::tempdir()?;
        let store: Arc<CredentialStore> = keyring_core::mock::Store::new()?;
        let account = account_in(dir.path(), &store);
        // a file where the replica's folder goes, as a disk that refuses it would
        std::fs::write(dir.path().join("library"), b"")?;
        assert!(account.keep(&signed_in()).is_err());
        assert_eq!(bearer_of(&account), None);
        assert_eq!(account_in(dir.path(), &store).restore()?, None);
        Ok(())
    }

    #[test]
    fn a_sign_in_the_keychain_refuses_leaves_nothing_open() -> ShellResult<()> {
        let dir = tempfile::tempdir()?;
        let store: Arc<CredentialStore> = keyring_core::mock::Store::new()?;
        let account = account_in(dir.path(), &store);
        account.credentials.refuse_next_write()?;
        assert!(matches!(
            account.keep(&signed_in()),
            Err(ShellError::Keychain(_))
        ));
        assert_eq!(bearer_of(&account), None);
        assert!(account.replica().all(&statement("SELECT 1")).is_err());
        Ok(())
    }

    #[test]
    fn a_file_on_its_way_at_a_sign_out_stays_out_of_the_cache() -> Result<(), Box<dyn Error>> {
        let dir = tempfile::tempdir()?;
        let store: Arc<CredentialStore> = keyring_core::mock::Store::new()?;
        let account = account_in(dir.path(), &store);
        account.keep(&signed_in())?;
        let body: &'static [u8] = b"a photo of the account's";
        let sha = file_cache::sha_of(body);
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let cloud = CloudFiles {
            client: file_cache::http_client()?,
            origin: format!("http://{}", listener.local_addr()?),
            build: "0.6.0+desktop".to_owned(),
        };
        let (asked, cloud_was_asked) = mpsc::channel();
        let (answer, cloud_may_answer) = mpsc::channel::<()>();
        let serving = std::thread::spawn(move || {
            let Ok((mut stream, _)) = listener.accept() else {
                return;
            };
            let Ok(read) = stream.try_clone() else {
                return;
            };
            let mut reader = BufReader::new(read);
            let mut line = String::new();
            while reader.read_line(&mut line).is_ok_and(|read| read > 2) {
                line.clear();
            }
            let _ = asked.send(());
            let _ = cloud_may_answer.recv();
            let head = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: image/png\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(head.as_bytes());
            let _ = stream.write_all(body);
        });
        let request = Request::builder()
            .uri(format!("{}/{sha}", file_scheme::ORIGIN))
            .body(Vec::new())?;
        let asking = account.fetching_as();
        let response = std::thread::scope(|scope| {
            let fetching = scope.spawn(|| {
                tauri::async_runtime::block_on(file_scheme::answer(
                    account.files(),
                    &cloud,
                    asking,
                    &request,
                ))
            });
            let left = cloud_was_asked
                .recv()
                .map_err(|error| ShellError::Invalid(error.to_string()))
                .and_then(|()| account.forget());
            let _ = answer.send(());
            left.map(|_| fetching.join())
        })?
        .map_err(|_| ShellError::Invalid("the fetch panicked".to_owned()))?;
        let _ = serving.join();
        assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
        assert_eq!(account.files().locate(&sha)?, None);
        assert!(!dir.path().join("cache").exists());
        Ok(())
    }
}
