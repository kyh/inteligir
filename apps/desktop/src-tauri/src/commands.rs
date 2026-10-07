//! What a page may ask the shell, one command per row of `apps/desktop/src/ipc-contract.ts`. Each
//! answers a plain value the page parses with that row's schema, and a refusal is a value too,
//! never an error: the page shows it in the shell's words.
//!
//! The app window reaches these through a capability the shell adds for the server's exact origin
//! (`window.rs`); the first run reaches only its four, through `capabilities/first-run.json`.

use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Manager, Runtime, WebviewWindow};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::diagnostics;
use crate::launch::FolderSync;
use crate::paths::{self, PathAction};
use crate::shell::{self, Outcome, Shell};
use crate::update_state::UpdateState;
use crate::updater::{self, Updates};
use crate::vaults::VaultsState;
use crate::window;

/// The commands the app window is granted, named as `build.rs`'s app manifest names them.
pub const APP_WINDOW_COMMANDS: &[&str] = &[
    "diagnostics_get_state",
    "diagnostics_open_data_folder",
    "diagnostics_restart",
    "diagnostics_set_debug",
    "diagnostics_show_log",
    "paths_open",
    "paths_reveal",
    "print_page",
    "updates_check",
    "updates_download",
    "updates_get_state",
    "updates_install",
    "vaults_forget",
    "vaults_get_state",
    "vaults_open",
    "vaults_pick",
];

/// A refusal or the state: `{ ok: true, state }` or `{ ok: false, reason }`.
#[derive(Debug, Serialize)]
pub struct Answer<T: Serialize> {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    state: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl<T: Serialize> Answer<T> {
    fn done(state: T) -> Self {
        Self {
            ok: true,
            state: Some(state),
            reason: None,
        }
    }

    fn refused(reason: impl Into<String>) -> Self {
        Self {
            ok: false,
            state: None,
            reason: Some(reason.into()),
        }
    }
}

/// Blocking work (a door call, a dialog, a server's start) runs off the async runtime's threads.
async fn blocking<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> T {
    match tauri::async_runtime::spawn_blocking(work).await {
        Ok(value) => value,
        Err(error) => panic!("a blocking task panicked: {error}"),
    }
}

fn no_vault() -> String {
    "No vault is open yet.".to_owned()
}

// ---- diagnostics ----

#[tauri::command]
pub async fn diagnostics_get_state<R: Runtime>(
    app: AppHandle<R>,
) -> Result<diagnostics::State, String> {
    app.state::<Shell>()
        .with_diagnostics(|diagnostics| diagnostics.state())
        .ok_or_else(no_vault)
}

#[tauri::command]
pub async fn diagnostics_set_debug<R: Runtime>(
    app: AppHandle<R>,
    debug: bool,
) -> Result<diagnostics::Answer, String> {
    app.state::<Shell>()
        .with_diagnostics(|diagnostics| diagnostics.set_debug(debug))
        .ok_or_else(no_vault)
}

/// A relaunch is the ordinary quit, which stops the server and flushes its commit, then a start;
/// a refused one moves nothing.
#[tauri::command]
pub async fn diagnostics_restart<R: Runtime>(
    app: AppHandle<R>,
) -> Result<diagnostics::Answer, String> {
    let answer = app
        .state::<Shell>()
        .with_diagnostics(|diagnostics| diagnostics.restart())
        .ok_or_else(no_vault)?;
    if answer.is_done() {
        std::thread::spawn(move || app.restart());
    }
    Ok(answer)
}

#[tauri::command]
pub async fn diagnostics_open_data_folder<R: Runtime>(app: AppHandle<R>) -> PathAction {
    blocking(move || match shell::open_data_folder(&app) {
        Ok(()) => PathAction::done(),
        Err(reason) => PathAction::refused(reason),
    })
    .await
}

#[tauri::command]
pub async fn diagnostics_show_log<R: Runtime>(app: AppHandle<R>) -> PathAction {
    blocking(move || match shell::show_server_log(&app) {
        Ok(()) => PathAction::done(),
        Err(reason) => PathAction::refused(reason),
    })
    .await
}

// ---- Reveal / Open ----

fn resolved<R: Runtime>(app: &AppHandle<R>, path: &str) -> Result<std::path::PathBuf, String> {
    let target = app.state::<Shell>().target().ok_or_else(no_vault)?;
    paths::resolve_vault_entry(Path::new(&target.vault_dir), path)
}

#[tauri::command]
pub async fn paths_reveal<R: Runtime>(app: AppHandle<R>, path: String) -> PathAction {
    blocking(move || {
        match resolved(&app, &path).and_then(|entry| {
            app.opener()
                .reveal_item_in_dir(entry)
                .map_err(|error| error.to_string())
        }) {
            Ok(()) => PathAction::done(),
            Err(reason) => PathAction::refused(reason),
        }
    })
    .await
}

#[tauri::command]
pub async fn paths_open<R: Runtime>(app: AppHandle<R>, path: String) -> PathAction {
    blocking(move || {
        match resolved(&app, &path).and_then(|entry| {
            app.opener()
                .open_path(entry.to_string_lossy(), None::<&str>)
                .map_err(|error| error.to_string())
        }) {
            Ok(()) => PathAction::done(),
            Err(reason) => PathAction::refused(reason),
        }
    })
    .await
}

// ---- Export to PDF ----

/// WKWebView answers no `window.print()`, so the page asks the shell to print the window.
#[tauri::command]
pub async fn print_page<R: Runtime>(window: WebviewWindow<R>) -> PathAction {
    match window.print() {
        Ok(()) => PathAction::done(),
        Err(error) => PathAction::refused(error.to_string()),
    }
}

// ---- updates ----

#[tauri::command]
pub async fn updates_get_state<R: Runtime>(app: AppHandle<R>) -> UpdateState {
    app.state::<Updates>().state()
}

#[tauri::command]
pub async fn updates_check<R: Runtime>(app: AppHandle<R>) -> UpdateState {
    updater::check(&app, "settings").await
}

#[tauri::command]
pub async fn updates_download<R: Runtime>(app: AppHandle<R>) -> UpdateState {
    updater::download(&app).await
}

#[tauri::command]
pub async fn updates_install<R: Runtime>(app: AppHandle<R>) -> UpdateState {
    blocking(move || updater::install(&app)).await
}

// ---- vaults ----

#[tauri::command]
pub async fn vaults_get_state<R: Runtime>(app: AppHandle<R>) -> Result<VaultsState, String> {
    shell::vaults_state(&app).ok_or_else(no_vault)
}

fn switch_answer<R: Runtime>(app: &AppHandle<R>, outcome: Outcome) -> Answer<VaultsState> {
    match outcome {
        Outcome::Done => match shell::vaults_state(app) {
            Some(state) => Answer::done(state),
            None => Answer::refused(no_vault()),
        },
        Outcome::Refused(reason) | Outcome::Reported(reason) => Answer::refused(reason),
    }
}

/// The folder is the person's pick, made here: the page never names a path it was not handed.
pub fn pick_vault_dir<R: Runtime>(app: &AppHandle<R>) -> Option<String> {
    let mut picker = app
        .dialog()
        .file()
        .set_title("Open vault")
        .set_can_create_directories(true);
    if let Some(parent) = app
        .state::<Shell>()
        .target()
        .and_then(|target| Path::new(&target.vault_dir).parent().map(Path::to_path_buf))
    {
        picker = picker.set_directory(parent);
    }
    picker
        .blocking_pick_folder()
        .and_then(|picked| picked.into_path().ok())
        .map(|path| path.to_string_lossy().into_owned())
}

#[tauri::command]
pub async fn vaults_pick<R: Runtime>(app: AppHandle<R>) -> Answer<VaultsState> {
    blocking(move || {
        let outcome = match pick_vault_dir(&app) {
            None => Outcome::Done,
            Some(picked) => shell::switch_vault(&app, &picked, true),
        };
        switch_answer(&app, outcome)
    })
    .await
}

/// Only a path this shell handed out comes back: the list is the page's whole vocabulary.
#[tauri::command]
pub async fn vaults_open<R: Runtime>(app: AppHandle<R>, path: String) -> Answer<VaultsState> {
    blocking(move || {
        if !shell::is_remembered(&app, &path) {
            return Answer::refused("That vault is not one the app remembers.");
        }
        let outcome = shell::switch_vault(&app, &path, false);
        switch_answer(&app, outcome)
    })
    .await
}

/// Forgetting a row cannot be refused, so it answers the state alone.
#[tauri::command]
pub async fn vaults_forget<R: Runtime>(
    app: AppHandle<R>,
    path: String,
) -> Result<VaultsState, String> {
    shell::forget_vault(&app, &path);
    shell::vaults_state(&app).ok_or_else(no_vault)
}

// ---- the first run ----

#[derive(Serialize)]
pub struct FirstRunState {
    #[serde(rename = "newVault")]
    new_vault: crate::launch::Proposal,
}

#[tauri::command]
pub async fn first_run_get_state<R: Runtime>(app: AppHandle<R>) -> Result<FirstRunState, String> {
    app.state::<Shell>()
        .with_first_run(|first_run| FirstRunState {
            new_vault: first_run.proposal.clone(),
        })
        .ok_or_else(|| "The first run is over.".to_owned())
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

fn pick_for_first_run<R: Runtime>(
    app: &AppHandle<R>,
    title: &str,
    create: bool,
    directory: Option<String>,
) -> Option<String> {
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

#[tauri::command]
pub async fn first_run_pick_parent<R: Runtime>(app: AppHandle<R>) -> Result<PickParent, String> {
    blocking(move || {
        let proposal = app
            .state::<Shell>()
            .with_first_run(|first_run| first_run.proposal.parent.clone());
        let Some(picked) = pick_for_first_run(&app, "Where should the vault go?", true, proposal)
        else {
            return Ok(PickParent::Cancelled);
        };
        app.state::<Shell>()
            .with_first_run(|first_run| first_run.parents.insert(picked.clone()));
        // judged at the parent: the vault is not made yet, and whatever syncs the parent syncs it
        let sync: FolderSync = shell::ask_door(&app, &["sync", &picked])?;
        Ok(PickParent::Picked {
            external_sync: sync.external_sync,
            path: picked,
        })
    })
    .await
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum PickFolder {
    Cancelled,
    Picked { facts: Value, path: String },
}

#[tauri::command]
pub async fn first_run_pick_folder<R: Runtime>(app: AppHandle<R>) -> Result<PickFolder, String> {
    blocking(move || {
        let Some(picked) = pick_for_first_run(&app, "Open a folder of notes", false, None) else {
            return Ok(PickFolder::Cancelled);
        };
        app.state::<Shell>()
            .with_first_run(|first_run| first_run.folders.insert(picked.clone()));
        let facts: Value = shell::ask_door(&app, &["facts", &picked])?;
        Ok(PickFolder::Picked {
            facts,
            path: picked,
        })
    })
    .await
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum FirstRunChoice {
    Create { name: String, parent: String },
    Open { path: String },
}

#[derive(Serialize)]
pub struct FirstRunAnswer {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

/// Every folder the page names back is one handed out here, the proposal's parent or a pick.
#[tauri::command]
pub async fn first_run_finish<R: Runtime>(
    app: AppHandle<R>,
    choice: FirstRunChoice,
) -> FirstRunAnswer {
    blocking(move || {
        let shell = app.state::<Shell>();
        let handed_out = shell.with_first_run(|first_run| match &choice {
            FirstRunChoice::Create { parent, .. } => first_run.parents.contains(parent),
            FirstRunChoice::Open { path } => first_run.folders.contains(path),
        });
        let refusal = match (&choice, handed_out) {
            (_, None) => Some("The first run is over."),
            (FirstRunChoice::Create { .. }, Some(false)) => {
                Some("That location is not one the app offered.")
            }
            (FirstRunChoice::Open { .. }, Some(false)) => {
                Some("That folder is not one the app offered.")
            }
            (_, Some(true)) => None,
        };
        if let Some(reason) = refusal {
            return FirstRunAnswer {
                ok: false,
                reason: Some(reason.to_owned()),
            };
        }
        let args: Vec<&str> = match &choice {
            FirstRunChoice::Create { name, parent } => vec!["plan-create", parent, name],
            FirstRunChoice::Open { path } => vec!["plan-open", path],
        };
        match shell::finish_first_run(&app, &args) {
            Outcome::Done => FirstRunAnswer {
                ok: true,
                reason: None,
            },
            Outcome::Refused(reason) | Outcome::Reported(reason) => FirstRunAnswer {
                ok: false,
                reason: Some(reason),
            },
        }
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn answers_cross_as_values() -> Result<(), serde_json::Error> {
        assert_eq!(
            serde_json::to_string(&Answer::<u8>::refused("no"))?,
            r#"{"ok":false,"reason":"no"}"#
        );
        assert_eq!(
            serde_json::to_string(&Answer::done(1_u8))?,
            r#"{"ok":true,"state":1}"#
        );
        assert_eq!(
            serde_json::to_string(&PickParent::Cancelled)?,
            r#"{"kind":"cancelled"}"#
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

    #[test]
    fn the_app_window_s_commands_are_named_once_in_order() {
        let mut sorted = APP_WINDOW_COMMANDS.to_vec();
        sorted.sort_unstable();
        sorted.dedup();
        assert_eq!(sorted, APP_WINDOW_COMMANDS);
    }
}
