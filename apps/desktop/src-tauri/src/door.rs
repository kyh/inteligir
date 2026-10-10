//! The shell asks the CLI's desktop entry whatever the server's own rules decide: the vault a
//! launch boots, what a first run's choice opens, whether a switch may happen, a folder's facts,
//! the selector's write. Those rules are TypeScript over `inteligir/server/*`, so they are asked of
//! it and never spelled a second time here. Each ask is one node process answering one JSON line
//! (`apps/cli/src/desktop/desktop-entry.ts`): an answer, or a refusal in the page's words. Every
//! caller says a refusal and a fault alike, so both come back as one sentence.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::PathBuf;
use std::process::{Command, Stdio};

use serde::Deserialize;
use serde::de::DeserializeOwned;

use crate::runtime::NodeRuntime;

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
    /// The answer, or why there is none: the CLI's refusal as it stands, or what kept the entry from
    /// answering at all.
    pub fn ask<T: DeserializeOwned>(&self, args: &[&str]) -> Result<T, String> {
        let output = Command::new(&self.runtime.node)
            .arg(self.runtime.desktop_entry())
            .args(args)
            .env_clear()
            .envs(&self.env)
            .current_dir(&self.cwd)
            .stdin(Stdio::null())
            .output()
            .map_err(|error| format!("{} could not start: {error}", self.runtime.node.display()))?;
        let stdout = String::from_utf8_lossy(&output.stdout);
        let line = stdout.lines().rev().find(|line| !line.trim().is_empty());
        if !output.status.success() || line.is_none() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let said = stderr.trim();
            return Err(if said.is_empty() {
                format!("the app's helper exited {}", output.status)
            } else {
                said.to_owned()
            });
        }
        parse_reply(line.unwrap_or_default())
    }
}

fn parse_reply<T: DeserializeOwned>(line: &str) -> Result<T, String> {
    match serde_json::from_str::<Reply<T>>(line) {
        Ok(Reply::Answer { answer }) => Ok(answer),
        Ok(Reply::Refusal { reason }) => Err(reason),
        Err(error) => Err(format!(
            "the app's helper answered something it should not: {error}"
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Debug, PartialEq, Eq, Deserialize)]
    struct Vault {
        path: String,
    }

    #[test]
    fn reads_an_answer_and_a_refusal() {
        assert_eq!(
            parse_reply::<Vault>(r#"{"answer":{"path":"/v"}}"#),
            Ok(Vault {
                path: "/v".to_owned()
            })
        );
        assert_eq!(
            parse_reply::<Vault>(r#"{"reason":"That folder is not there any more."}"#),
            Err("That folder is not there any more.".to_owned())
        );
    }

    #[test]
    fn anything_else_says_the_helper_misspoke() {
        for line in [r#"{"answer":{"wrong":1}}"#, "not json"] {
            assert!(
                parse_reply::<Vault>(line)
                    .is_err_and(|reason| reason.starts_with("the app's helper answered")),
                "{line}"
            );
        }
    }
}
