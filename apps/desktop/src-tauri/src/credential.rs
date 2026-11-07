//! The device credential: the bearer this Mac's sign-in minted, kept in the Keychain and nowhere
//! else on disk, and handed to the page in memory when it opens. Only this module touches the
//! store, through keyring-core over the Keychain (`apple-native-keyring-store`); on Linux, where
//! the shell runs only under the scenario suite, keyring-core's sample store in a file under the
//! app's data dir stands in for it.
//!
//! The record is the credential and the account the sign-in named, so the page knows whose library
//! it opens before any call. Its item is the bundle id's, so Keychain Access names the app it
//! belongs to, and a debug build, an app of its own (`tauri.local.conf.json`), never reads or
//! overwrites the release's.

use std::path::Path;
use std::sync::Arc;

use keyring_core::{CredentialStore, Entry};
use serde::{Deserialize, Serialize};

use crate::error::{ShellError, ShellResult};

/// One credential a Mac: a sign-in replaces the one before it.
const ACCOUNT: &str = "device";

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DeviceCredential {
    pub credential: String,
    pub email: String,
    pub user_id: String,
}

/// What a write to the store needs after it, which only a store kept in a file does.
type Persist = Box<dyn Fn() -> keyring_core::Result<()> + Send + Sync>;

pub struct Credentials {
    store: Arc<CredentialStore>,
    /// The item's service: the app's bundle id.
    service: String,
    persist: Option<Persist>,
}

impl Credentials {
    pub fn with_store(store: Arc<CredentialStore>, service: &str) -> Self {
        Self {
            store,
            service: service.to_owned(),
            persist: None,
        }
    }

    /// The Keychain's login store, under the app's bundle id.
    #[cfg(target_os = "macos")]
    pub fn for_this_mac(bundle_id: &str, _data_dir: &Path) -> ShellResult<Self> {
        let store: Arc<CredentialStore> = apple_native_keyring_store::keychain::Store::new()?;
        Ok(Self::with_store(store, bundle_id))
    }

    /// The scenario suite's stand-in: the sample store, saved to its file after every write,
    /// since it saves itself only when dropped.
    #[cfg(not(target_os = "macos"))]
    pub fn for_this_mac(bundle_id: &str, data_dir: &Path) -> ShellResult<Self> {
        std::fs::create_dir_all(data_dir)?;
        let backing = data_dir.join("credential-store.ron");
        let sample = keyring_core::sample::Store::new_with_backing(&backing.to_string_lossy())?;
        let saving = Arc::clone(&sample);
        let store: Arc<CredentialStore> = sample;
        Ok(Self {
            persist: Some(Box::new(move || saving.save())),
            ..Self::with_store(store, bundle_id)
        })
    }

    fn entry(&self) -> ShellResult<Entry> {
        Ok(self.store.build(&self.service, ACCOUNT, None)?)
    }

    fn persisted(&self) -> ShellResult<()> {
        if let Some(persist) = &self.persist {
            persist()?;
        }
        Ok(())
    }

    /// The credential a sign-in kept, or None: none was kept, or what is kept is no record this
    /// build reads, which reads as signed out rather than as a credential the cloud refuses.
    pub fn read(&self) -> ShellResult<Option<DeviceCredential>> {
        match self.entry()?.get_password() {
            Ok(text) => Ok(serde_json::from_str(&text).ok()),
            Err(keyring_core::Error::NoEntry) => Ok(None),
            Err(error) => Err(error.into()),
        }
    }

    pub fn keep(&self, credential: &DeviceCredential) -> ShellResult<()> {
        let text = serde_json::to_string(credential)
            .map_err(|error| ShellError::Invalid(error.to_string()))?;
        self.entry()?.set_password(&text)?;
        self.persisted()
    }

    /// Forgets the credential; one never kept is already forgotten.
    pub fn forget(&self) -> ShellResult<()> {
        match self.entry()?.delete_credential() {
            Ok(()) | Err(keyring_core::Error::NoEntry) => self.persisted(),
            Err(error) => Err(error.into()),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const BUNDLE_ID: &str = "com.inteligir.desktop";

    fn mocked() -> ShellResult<Credentials> {
        let store: Arc<CredentialStore> = keyring_core::mock::Store::new()?;
        Ok(Credentials::with_store(store, BUNDLE_ID))
    }

    fn signed_in() -> DeviceCredential {
        DeviceCredential {
            credential: format!("igd_{}", "a".repeat(64)),
            email: "owner@example.com".to_owned(),
            user_id: "user-1".to_owned(),
        }
    }

    #[test]
    fn keeps_reads_and_forgets_the_credential() -> ShellResult<()> {
        let credentials = mocked()?;
        assert_eq!(credentials.read()?, None);
        credentials.keep(&signed_in())?;
        assert_eq!(credentials.read()?, Some(signed_in()));
        let replaced = DeviceCredential {
            credential: format!("igd_{}", "b".repeat(64)),
            ..signed_in()
        };
        credentials.keep(&replaced)?;
        assert_eq!(credentials.read()?, Some(replaced));
        credentials.forget()?;
        assert_eq!(credentials.read()?, None);
        // forgetting twice is forgetting once
        credentials.forget()?;
        Ok(())
    }

    #[test]
    fn a_record_this_build_does_not_read_is_signed_out() -> ShellResult<()> {
        let credentials = mocked()?;
        credentials
            .entry()?
            .set_password("{\"credential\":\"igd_x\"}")?;
        assert_eq!(credentials.read()?, None);
        Ok(())
    }

    #[test]
    fn a_store_that_refuses_is_said() -> ShellResult<()> {
        let credentials = mocked()?;
        let entry = credentials.entry()?;
        let mock: Option<&keyring_core::mock::Cred> = entry.as_any().downcast_ref();
        let Some(mock) = mock else {
            return Err(ShellError::Invalid("not the mock's credential".to_owned()));
        };
        mock.set_error(keyring_core::Error::NoStorageAccess(Box::from(
            "the Keychain is locked",
        )));
        assert!(matches!(
            credentials.keep(&signed_in()),
            Err(ShellError::Keychain(_))
        ));
        Ok(())
    }

    #[test]
    fn another_bundle_id_keeps_a_credential_of_its_own() -> ShellResult<()> {
        let store: Arc<CredentialStore> = keyring_core::mock::Store::new()?;
        let release = Credentials::with_store(Arc::clone(&store), BUNDLE_ID);
        let debug = Credentials::with_store(store, "com.inteligir.desktop.dev");
        release.keep(&signed_in())?;
        assert_eq!(debug.read()?, None);
        debug.forget()?;
        assert_eq!(release.read()?, Some(signed_in()));
        Ok(())
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn the_stand_in_keeps_the_credential_across_launches() -> ShellResult<()> {
        let dir = tempfile::tempdir()?;
        Credentials::for_this_mac(BUNDLE_ID, dir.path())?.keep(&signed_in())?;
        assert_eq!(
            Credentials::for_this_mac(BUNDLE_ID, dir.path())?.read()?,
            Some(signed_in())
        );
        Ok(())
    }
}
