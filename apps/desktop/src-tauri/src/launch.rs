//! What the CLI's desktop entry answers about the vaults (`DoorAnswers` in
//! `apps/cli/src/desktop/desktop-door.ts`): the launch, a folder's facts, a plan, a selector's
//! write. Rust reads only what it acts on and hands the rest to the page as the CLI wrote it, where
//! the page parses it. `tools/repo-guards/src/desktop-shell-wire.test.ts` holds every type here to
//! the door's zod schemas, and parses the `fixtures/` these tests read with them.

use std::collections::BTreeMap;

use serde::Deserialize;
use serde_json::Value;

/// The vault a server is bound to, as the server's own config resolution answered it.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Target {
    pub data_dir: String,
    pub vault_dir: String,
    /// Where config.json lives; every vault's data dir sits beneath it.
    pub root_data_dir: String,
    /// Why a switch is refused before any folder is picked (an env pin), in the CLI's words.
    pub switch_blocked: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum Plan {
    Boot,
    FirstRun,
}

/// The vault a first run proposes: the default a launch with no choice would have made.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize, serde::Serialize)]
pub struct Proposal {
    pub name: String,
    pub parent: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Launch {
    /// What every node child runs with from now on: the login shell's PATH, and the git the Mac
    /// should run when it is the bundled one.
    pub env: BTreeMap<String, String>,
    /// What the launch decided that a report would want, said once on the shell's own stdout.
    pub notes: Vec<String>,
    pub target: Target,
    pub plan: Plan,
    pub proposal: Proposal,
}

/// A first run's choice, or a switch, planned against the server's rules: the vault it opens, and
/// what config.json is pointed at (None: the default, which needs no selector).
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Opening {
    pub vault_dir: String,
    pub selector: Option<String>,
}

/// Where a folder already syncs on its own, and the sentences a confirmation says about it.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FolderSync {
    /// The page's `externalSyncSchema` value, passed through.
    pub external_sync: Value,
    pub warning: Option<Warning>,
}

#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
pub struct Warning {
    pub headline: String,
    pub detail: String,
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
        let launch: Launch = serde_json::from_str(include_str!("../fixtures/launch.json"))?;
        assert_eq!(launch.plan, Plan::FirstRun);
        assert_eq!(launch.target.vault_dir, "/h/Inteligir");
        assert_eq!(launch.target.switch_blocked, None);
        assert_eq!(
            launch.proposal,
            Proposal {
                name: "Inteligir".to_owned(),
                parent: "/h".to_owned()
            }
        );
        assert_eq!(
            launch.env.get("PATH").map(String::as_str),
            Some("/opt/homebrew/bin:/usr/bin")
        );
        Ok(())
    }

    #[test]
    fn reads_an_opening() -> Result<(), serde_json::Error> {
        let opening: Opening = serde_json::from_str(include_str!("../fixtures/plan-open.json"))?;
        assert_eq!(opening.vault_dir, "/h/Notes");
        assert_eq!(opening.selector.as_deref(), Some("/h/Notes"));
        Ok(())
    }

    #[test]
    fn reads_the_target_a_selection_answers() -> Result<(), serde_json::Error> {
        let target: Target = serde_json::from_str(include_str!("../fixtures/select.json"))?;
        assert_eq!(target.root_data_dir, "/h/.inteligir");
        assert!(target.data_dir.starts_with("/h/.inteligir/vaults/"));
        assert!(target.switch_blocked.is_some());
        Ok(())
    }

    #[test]
    fn reads_a_folder_another_service_syncs() -> Result<(), serde_json::Error> {
        let sync: FolderSync = serde_json::from_str(include_str!("../fixtures/sync.json"))?;
        assert_eq!(sync.external_sync["kind"], "dropbox");
        assert_eq!(
            sync.warning.map(|warning| warning.headline).as_deref(),
            Some("Dropbox keeps syncing this folder.")
        );
        Ok(())
    }

    #[test]
    fn reads_a_handoff() -> Result<(), serde_json::Error> {
        let handoff: Handoff = serde_json::from_str(include_str!("../fixtures/handoff.json"))?;
        assert_eq!(handoff.url, "http://127.0.0.1:4664/?handoff=n");
        Ok(())
    }
}
