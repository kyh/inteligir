//! What the CLI's desktop entry answers about a launch (`apps/cli/src/desktop/desktop-door.ts`):
//! the environment the server runs with, the data dir it serves and whether this is its first
//! launch, and a browser's sign-in.

use std::collections::BTreeMap;

use serde::Deserialize;

/// The data dir a server serves, as the server's own config resolution answered it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub data_dir: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Launch {
    /// What every node child runs with from now on: the login shell's PATH.
    pub env: BTreeMap<String, String>,
    /// No server has opened the data dir yet, so the window lands on the welcome steps.
    #[serde(rename = "firstLaunch")]
    pub first: bool,
    /// What the launch decided that a report would want, said once on the shell's own stdout.
    pub notes: Vec<String>,
    pub target: Target,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Handoff {
    pub url: String,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_launch_the_cli_answers() -> Result<(), serde_json::Error> {
        let launch: Launch = serde_json::from_str(
            r#"{
              "env": {"PATH": "/opt/homebrew/bin:/usr/bin"},
              "firstLaunch": true,
              "notes": [],
              "target": {"dataDir": "/h/.inteligir"}
            }"#,
        )?;
        assert_eq!(launch.target.data_dir, "/h/.inteligir");
        assert!(launch.first);
        assert_eq!(
            launch.env.get("PATH").map(String::as_str),
            Some("/opt/homebrew/bin:/usr/bin")
        );
        Ok(())
    }
}
