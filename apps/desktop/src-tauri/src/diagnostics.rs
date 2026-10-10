//! Debug logging is a choice a Finder-launched app has no environment variable for, so the shell
//! keeps it in its own folder, reads it before each start of the server, and hands the server every
//! trace namespace when it is on. A change asks for a restart, which is the ordinary quit and a
//! relaunch. A server the shell adopted is nobody's child here, so neither reaches it.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::answer::{Answer, Payload};
use crate::files::write_staged;

pub const DIAGNOSTICS_FILE_NAME: &str = "diagnostics.json";

const ADOPTED_REASON: &str = "This server was started outside the app, so the app cannot change how it logs or restart it. Stop it and reopen Inteligir.";
const DEVELOPMENT_REASON: &str =
    "A development build cannot relaunch itself. Quit and start it again.";

#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
pub struct Choice {
    pub debug: bool,
}

/// What the server behind the window booted with, which the shell's open vault says; an adopted one
/// ignored the choice entirely.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServerRun {
    Owned { debug: bool },
    Adopted,
}

/// The page's `diagnosticsStateSchema`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "server", rename_all = "camelCase")]
pub enum State {
    #[serde(rename = "owned", rename_all = "camelCase")]
    Owned {
        debug: bool,
        restart_required: bool,
        can_restart: bool,
    },
    #[serde(rename = "adopted")]
    Adopted { debug: bool, reason: String },
}

impl Payload for State {}

/// A missing file is the default; bytes that are not a choice read as off and say so, rather
/// than refusing a launch over a file the person never wrote.
pub fn read_choice(path: &Path) -> Choice {
    let Ok(raw) = fs::read_to_string(path) else {
        return Choice::default();
    };
    serde_json::from_str(&raw).unwrap_or_else(|_| {
        eprintln!(
            "[desktop] {} is not a diagnostics choice; debug logging stays off",
            path.display()
        );
        Choice::default()
    })
}

pub struct Diagnostics {
    path: PathBuf,
    choice: Choice,
    can_restart: bool,
}

impl Diagnostics {
    pub fn new(path: PathBuf, can_restart: bool) -> Self {
        Self {
            choice: read_choice(&path),
            path,
            can_restart,
        }
    }

    /// The choice the next start of the server runs with.
    pub fn debug(&self) -> bool {
        self.choice.debug
    }

    pub fn state(&self, run: ServerRun) -> State {
        match run {
            ServerRun::Adopted => State::Adopted {
                debug: self.choice.debug,
                reason: ADOPTED_REASON.to_owned(),
            },
            ServerRun::Owned { debug } => State::Owned {
                debug: self.choice.debug,
                restart_required: debug != self.choice.debug,
                can_restart: self.can_restart,
            },
        }
    }

    pub fn set_debug(&mut self, debug: bool, run: ServerRun) -> Answer<State> {
        if run == ServerRun::Adopted {
            return Answer::refused(ADOPTED_REASON);
        }
        let next = Choice { debug };
        let written = serde_json::to_string_pretty(&next)
            .map_err(|error| error.to_string())
            .and_then(|json| {
                write_staged(&self.path, format!("{json}\n").as_bytes())
                    .map_err(|error| error.to_string())
            });
        if let Err(error) = written {
            return Answer::refused(format!("The choice could not be saved: {error}"));
        }
        self.choice = next;
        Answer::Done(self.state(run))
    }

    /// Whether a restart may go ahead; the caller relaunches the app.
    pub fn restart(&self, run: ServerRun) -> Answer<State> {
        if run == ServerRun::Adopted {
            return Answer::refused(ADOPTED_REASON);
        }
        if !self.can_restart {
            return Answer::refused(DEVELOPMENT_REASON);
        }
        Answer::Done(self.state(run))
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;

    const OWNED_OFF: ServerRun = ServerRun::Owned { debug: false };

    fn wire<T: Serialize>(value: &T) -> Value {
        serde_json::to_value(value).unwrap_or_default()
    }

    #[test]
    fn reads_a_missing_or_garbled_file_as_off() -> std::io::Result<()> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join(DIAGNOSTICS_FILE_NAME);
        assert_eq!(read_choice(&path), Choice { debug: false });
        fs::write(&path, "{\"debug\": \"yes\"}")?;
        assert_eq!(read_choice(&path), Choice { debug: false });
        fs::write(&path, "{\"debug\": true}")?;
        assert_eq!(read_choice(&path), Choice { debug: true });
        Ok(())
    }

    #[test]
    fn a_change_is_saved_and_asks_for_a_restart() -> std::io::Result<()> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join(DIAGNOSTICS_FILE_NAME);
        let mut diagnostics = Diagnostics::new(path.clone(), true);
        assert_eq!(
            wire(&diagnostics.set_debug(true, OWNED_OFF)),
            json!({
                "ok": true,
                "state": { "server": "owned", "debug": true, "restartRequired": true, "canRestart": true },
            })
        );
        assert_eq!(read_choice(&path), Choice { debug: true });
        Ok(())
    }

    #[test]
    fn an_adopted_server_refuses_both() {
        let mut diagnostics = Diagnostics::new(PathBuf::from("/nowhere/diagnostics.json"), true);
        assert_eq!(
            wire(&diagnostics.state(ServerRun::Adopted)),
            json!({ "server": "adopted", "debug": false, "reason": ADOPTED_REASON })
        );
        assert_eq!(
            diagnostics.restart(ServerRun::Adopted),
            Answer::refused(ADOPTED_REASON)
        );
        assert_eq!(
            diagnostics.set_debug(true, ServerRun::Adopted),
            Answer::refused(ADOPTED_REASON)
        );
    }

    #[test]
    fn a_development_shell_cannot_relaunch() {
        let diagnostics = Diagnostics::new(PathBuf::from("/nowhere/diagnostics.json"), false);
        assert_eq!(
            diagnostics.restart(OWNED_OFF),
            Answer::refused(DEVELOPMENT_REASON)
        );
    }

    #[test]
    fn a_packaged_shell_relaunches_the_server_it_started() {
        let diagnostics = Diagnostics::new(PathBuf::from("/nowhere/diagnostics.json"), true);
        assert!(matches!(diagnostics.restart(OWNED_OFF), Answer::Done(_)));
    }
}
