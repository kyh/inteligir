//! What a command answers when it cannot do what it was asked: one error, its kind and its message,
//! which crosses the bridge as the command's rejection and which the page parses against
//! `shellErrorSchema` (`apps/workspace/src/shell/shell-error.ts`). Every command answers a
//! `Result`, so a page call either holds its value or rejects with one of these.

use serde::ser::{Serialize, SerializeStruct, Serializer};

#[derive(Debug, thiserror::Error)]
pub enum ShellError {
    /// No account is signed in on this Mac, so there is no library to read or write.
    #[error("No account is signed in on this Mac.")]
    SignedOut,
    /// The transaction a statement names is not the one open: it ended, timed out or was let go
    /// when its page went away.
    #[error("That change was let go before it finished.")]
    TransactionGone,
    /// The shell holds no such file.
    #[error("This Mac does not hold that file.")]
    Missing,
    /// What the page sent is not what the command takes, or the shell's own work stopped on the
    /// way (a task that ended, a listener that panicked, a record it could not write).
    #[error("{0}")]
    Invalid(String),
    #[error(transparent)]
    Sql(#[from] rusqlite::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("The Keychain refused: {0}")]
    Keychain(#[from] keyring_core::Error),
}

impl ShellError {
    /// The page's `kind`, which it switches on; the message is for the person.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::SignedOut => "signed-out",
            Self::TransactionGone => "transaction-gone",
            Self::Missing => "missing",
            Self::Invalid(_) => "invalid",
            Self::Sql(_) => "sql",
            Self::Io(_) => "io",
            Self::Keychain(_) => "keychain",
        }
    }
}

impl Serialize for ShellError {
    fn serialize<S: Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        let mut error = serializer.serialize_struct("ShellError", 2)?;
        error.serialize_field("kind", self.kind())?;
        error.serialize_field("message", &self.to_string())?;
        error.end()
    }
}

pub type ShellResult<T> = Result<T, ShellError>;

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn crosses_as_its_kind_and_its_words() {
        assert_eq!(
            serde_json::to_value(ShellError::SignedOut).ok(),
            Some(
                json!({ "kind": "signed-out", "message": "No account is signed in on this Mac." })
            )
        );
        assert_eq!(
            serde_json::to_value(ShellError::Invalid("no".to_owned())).ok(),
            Some(json!({ "kind": "invalid", "message": "no" }))
        );
    }
}
