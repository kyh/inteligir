//! The first run's window asks for a vault before any server exists: the shell hands it folders it
//! picked, and every folder the page names back must be one of them.

use std::collections::HashSet;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::DialogExt;

use crate::answer::Answer;
use crate::launch::{FolderSync, Proposal};
use crate::shell::{self, Outcome, Shell};
use crate::window;

const OVER: &str = "The first run is over.";

/// The first run's handed-out folders: every folder the page names back is one the shell gave it.
pub struct FirstRun {
    pub proposal: Proposal,
    pub parents: HashSet<String>,
    pub folders: HashSet<String>,
}

#[derive(Serialize)]
pub struct FirstRunState {
    #[serde(rename = "newVault")]
    new_vault: Proposal,
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum PickParent {
    Cancelled,
    #[serde(rename_all = "camelCase")]
    Picked {
        external_sync: Value,
        path: String,
    },
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum PickFolder {
    Cancelled,
    Picked { facts: Value, path: String },
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum FirstRunChoice {
    Create { name: String, parent: String },
    Open { path: String },
}

pub fn state(app: &AppHandle) -> Result<FirstRunState, String> {
    app.state::<Shell>()
        .with_first_run(|first_run| FirstRunState {
            new_vault: first_run.proposal.clone(),
        })
        .ok_or_else(|| OVER.to_owned())
}

fn pick(app: &AppHandle, title: &str, create: bool, directory: Option<String>) -> Option<String> {
    let mut picker = app
        .dialog()
        .file()
        .set_title(title)
        .set_can_create_directories(create);
    if let Some(directory) = directory {
        picker = picker.set_directory(directory);
    }
    if let Some(parent) = app.get_webview_window(window::FIRST_RUN) {
        picker = picker.set_parent(&parent);
    }
    picker
        .blocking_pick_folder()
        .and_then(|picked| picked.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}

pub fn pick_parent(app: &AppHandle) -> Result<PickParent, String> {
    let shell = app.state::<Shell>();
    let proposal = shell.with_first_run(|first_run| first_run.proposal.parent.clone());
    let Some(picked) = pick(app, "Where should the vault go?", true, proposal) else {
        return Ok(PickParent::Cancelled);
    };
    shell.with_first_run(|first_run| first_run.parents.insert(picked.clone()));
    // judged at the parent: the vault is not made yet, and whatever syncs the parent syncs it
    let sync: FolderSync = shell::ask_door(app, &["sync", &picked])?;
    Ok(PickParent::Picked {
        external_sync: sync.external_sync,
        path: picked,
    })
}

pub fn pick_folder(app: &AppHandle) -> Result<PickFolder, String> {
    let Some(picked) = pick(app, "Open a folder of notes", false, None) else {
        return Ok(PickFolder::Cancelled);
    };
    app.state::<Shell>()
        .with_first_run(|first_run| first_run.folders.insert(picked.clone()));
    let facts: Value = shell::ask_door(app, &["facts", &picked])?;
    Ok(PickFolder::Picked {
        facts,
        path: picked,
    })
}

/// Every folder the page names back is one handed out here, the proposal's parent or a pick.
pub fn finish(app: &AppHandle, choice: &FirstRunChoice) -> Answer {
    let handed_out = app
        .state::<Shell>()
        .with_first_run(|first_run| match choice {
            FirstRunChoice::Create { parent, .. } if !first_run.parents.contains(parent) => {
                Err("That location is not one the app offered.")
            }
            FirstRunChoice::Open { path } if !first_run.folders.contains(path) => {
                Err("That folder is not one the app offered.")
            }
            FirstRunChoice::Create { .. } | FirstRunChoice::Open { .. } => Ok(()),
        })
        .unwrap_or(Err(OVER));
    if let Err(reason) = handed_out {
        return Answer::refused(reason);
    }
    let args: Vec<&str> = match choice {
        FirstRunChoice::Create { name, parent } => vec!["plan-create", parent, name],
        FirstRunChoice::Open { path } => vec!["plan-open", path],
    };
    match shell::finish_first_run(app, &args) {
        Outcome::Done => Answer::Done(()),
        Outcome::Refused(reason) | Outcome::Reported(reason) => Answer::Refused(reason),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cancelled_pick_crosses_as_its_kind() -> Result<(), serde_json::Error> {
        assert_eq!(
            serde_json::to_value(PickParent::Cancelled)?,
            serde_json::json!({ "kind": "cancelled" })
        );
        Ok(())
    }

    #[test]
    fn reads_the_page_s_first_run_choice() -> Result<(), serde_json::Error> {
        let choice: FirstRunChoice =
            serde_json::from_str(r#"{"kind":"create","name":"Notes","parent":"/h"}"#)?;
        assert!(matches!(choice, FirstRunChoice::Create { .. }));
        Ok(())
    }
}
