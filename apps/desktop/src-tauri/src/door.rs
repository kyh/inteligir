//! The shell asks the CLI's desktop entry whatever the server's own rules decide: the environment
//! a launch runs the server with and the data dir it serves, and a browser's sign-in. Those rules
//! are TypeScript over `inteligir/server/*`, so they are asked of it and never spelled a second
//! time here. Each ask is one node process answering one JSON line
//! (`apps/cli/src/desktop/desktop-entry.ts`): an answer, or a refusal in the page's words.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde::Deserialize;
use serde::de::DeserializeOwned;

use crate::runtime::NodeRuntime;

#[derive(Debug, PartialEq, Eq)]
pub enum DoorError {
    /// A refusal the CLI words for the person: shown as it stands.
    Refused(String),
    /// The entry could not answer at all.
    Fault(String),
}

impl DoorError {
    pub fn message(&self) -> &str {
        match self {
            Self::Refused(message) | Self::Fault(message) => message,
        }
    }
}

#[derive(Deserialize)]
#[serde(untagged)]
enum Reply<T> {
    Answer { answer: T },
    Refusal { reason: String },
}

#[derive(Clone)]
pub struct Door {
    pub runtime: NodeRuntime,
    pub env: BTreeMap<OsString, OsString>,
    pub cwd: PathBuf,
}

impl Door {
    pub fn ask<T: DeserializeOwned>(&self, args: &[&str]) -> Result<T, DoorError> {
        let output = Command::new(&self.runtime.node)
            .arg(self.runtime.desktop_entry())
            .args(args)
            .env_clear()
            .envs(&self.env)
            .current_dir(&self.cwd)
            .stdin(Stdio::null())
            .output()
            .map_err(|error| {
                DoorError::Fault(format!(
                    "{} could not start: {error}",
                    self.runtime.node.display()
                ))
            })?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let line = stdout.lines().rev().find(|line| !line.trim().is_empty());
        if !output.status.success() || line.is_none() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let said = stderr.trim();
            return Err(DoorError::Fault(if said.is_empty() {
                format!("the app's helper exited {}", output.status)
            } else {
                said.to_owned()
            }));
        }
        parse_reply(line.unwrap_or_default())
    }
}

fn parse_reply<T: DeserializeOwned>(line: &str) -> Result<T, DoorError> {
    match serde_json::from_str::<Reply<T>>(line) {
        Ok(Reply::Answer { answer }) => Ok(answer),
        Ok(Reply::Refusal { reason }) => Err(DoorError::Refused(reason)),
        Err(error) => Err(DoorError::Fault(format!(
            "the app's helper answered something it should not: {error}"
        ))),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, PartialEq, Eq, Deserialize)]
    struct Folder {
        path: String,
    }

    #[test]
    fn reads_an_answer_and_a_refusal() {
        assert_eq!(
            parse_reply::<Folder>(r#"{"answer":{"path":"/v"}}"#),
            Ok(Folder {
                path: "/v".to_owned()
            })
        );
        assert_eq!(
            parse_reply::<Folder>(r#"{"reason":"That folder is not there any more."}"#),
            Err(DoorError::Refused(
                "That folder is not there any more.".to_owned()
            ))
        );
    }

    #[test]
    fn anything_else_is_a_fault() {
        assert!(matches!(
            parse_reply::<Folder>(r#"{"answer":{"wrong":1}}"#),
            Err(DoorError::Fault(_))
        ));
        assert!(matches!(
            parse_reply::<Folder>("not json"),
            Err(DoorError::Fault(_))
        ));
    }
}
