//! What a page may ask the shell, one command per row of `apps/workspace/src/shell/ipc-contract.ts`. Each
//! answers a plain value the page parses with that row's schema. A command that can be refused
//! answers an `Answer`, so the page shows the refusal in the shell's words; one that can fail only
//! by a fault answers a `Result`, whose `Err` rejects.
//!
//! The app window reaches these through `capabilities/app-window.json`, which the shell grants that
//! window for the server's exact origin alone (`window.rs`); the first run reaches only its four,
//! through `capabilities/first-run.json`.

use std::path::Path;

use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_opener::OpenerExt;

use crate::answer::Answer;
use crate::diagnostics;
use crate::first_run::{self, FirstRunChoice, FirstRunState, PickFolder, PickParent};
use crate::paths;
use crate::shell::{self, Outcome, Shell};
use crate::update_state::UpdateState;
use crate::updater::{self, Updates};
use crate::vaults::VaultsState;

/// Blocking work (a door call, a dialog, a server's start) runs off the async runtime's threads.
async fn blocking<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> T {
    match tauri::async_runtime::spawn_blocking(work).await {
        Ok(value) => value,
        Err(error) => panic!("a blocking task panicked: {error}"),
    }
}

fn no_vault() -> String {
    shell::NO_VAULT.to_owned()
}

// ---- diagnostics ----

#[tauri::command]
pub async fn diagnostics_get_state(app: AppHandle) -> Result<diagnostics::State, String> {
    app.state::<Shell>()
        .with_diagnostics(|diagnostics, run| diagnostics.state(run))
        .ok_or_else(no_vault)
}

#[tauri::command]
pub async fn diagnostics_set_debug(
    app: AppHandle,
    debug: bool,
) -> Result<Answer<diagnostics::State>, String> {
    app.state::<Shell>()
        .with_diagnostics(|diagnostics, run| diagnostics.set_debug(debug, run))
        .ok_or_else(no_vault)
}

/// A relaunch is the ordinary quit, which stops the server and flushes its commit, then a start;
/// a refused one moves nothing.
#[tauri::command]
pub async fn diagnostics_restart(app: AppHandle) -> Result<Answer<diagnostics::State>, String> {
    let answer = app
        .state::<Shell>()
        .with_diagnostics(|diagnostics, run| diagnostics.restart(run))
        .ok_or_else(no_vault)?;
    if matches!(answer, Answer::Done(_)) {
        std::thread::spawn(move || app.restart());
    }
    Ok(answer)
}

#[tauri::command]
pub async fn diagnostics_open_data_folder(app: AppHandle) -> Answer {
    blocking(move || shell::open_data_folder(&app).into()).await
}

#[tauri::command]
pub async fn diagnostics_show_log(app: AppHandle) -> Answer {
    blocking(move || shell::show_server_log(&app).into()).await
}

// ---- Reveal / Open ----

fn resolved(app: &AppHandle, path: &str) -> Result<std::path::PathBuf, String> {
    let target = app.state::<Shell>().target().ok_or_else(no_vault)?;
    paths::resolve_vault_entry(Path::new(&target.vault_dir), path)
}

#[tauri::command]
pub async fn paths_reveal(app: AppHandle, path: String) -> Answer {
    blocking(move || {
        resolved(&app, &path)
            .and_then(|entry| {
                app.opener()
                    .reveal_item_in_dir(entry)
                    .map_err(|error| error.to_string())
            })
            .into()
    })
    .await
}

#[tauri::command]
pub async fn paths_open(app: AppHandle, path: String) -> Answer {
    blocking(move || {
        resolved(&app, &path)
            .and_then(|entry| {
                app.opener()
                    .open_path(entry.to_string_lossy(), None::<&str>)
                    .map_err(|error| error.to_string())
            })
            .into()
    })
    .await
}

// ---- Export to PDF ----

/// WKWebView answers no `window.print()`, so the page asks the shell to print the window.
#[tauri::command]
pub async fn print_page(window: WebviewWindow) -> Answer {
    window.print().map_err(|error| error.to_string()).into()
}

// ---- updates ----

#[tauri::command]
pub async fn updates_get_state(app: AppHandle) -> UpdateState {
    app.state::<Updates>().state()
}

#[tauri::command]
pub async fn updates_check(app: AppHandle) -> UpdateState {
    updater::check(&app, "settings").await
}

#[tauri::command]
pub async fn updates_download(app: AppHandle) -> UpdateState {
    updater::download(&app).await
}

#[tauri::command]
pub async fn updates_install(app: AppHandle) -> UpdateState {
    blocking(move || updater::install(&app)).await
}

// ---- vaults ----

#[tauri::command]
pub async fn vaults_get_state(app: AppHandle) -> Result<VaultsState, String> {
    shell::vaults_state(&app).ok_or_else(no_vault)
}

fn switch_answer(app: &AppHandle, outcome: Outcome) -> Answer<VaultsState> {
    match outcome {
        Outcome::Done => shell::vaults_state(app).ok_or_else(no_vault).into(),
        Outcome::Refused(reason) | Outcome::Reported(reason) => Answer::refused(reason),
    }
}

#[tauri::command]
pub async fn vaults_pick(app: AppHandle) -> Answer<VaultsState> {
    blocking(move || {
        let outcome = match shell::pick_vault_dir(&app) {
            None => Outcome::Done,
            Some(picked) => shell::switch_vault(&app, &picked, true),
        };
        switch_answer(&app, outcome)
    })
    .await
}

/// Only a path this shell handed out comes back: the list is the page's whole vocabulary.
#[tauri::command]
pub async fn vaults_open(app: AppHandle, path: String) -> Answer<VaultsState> {
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
pub async fn vaults_forget(app: AppHandle, path: String) -> Result<VaultsState, String> {
    shell::forget_vault(&app, &path);
    shell::vaults_state(&app).ok_or_else(no_vault)
}

// ---- the first run ----

#[tauri::command]
pub async fn first_run_get_state(app: AppHandle) -> Result<FirstRunState, String> {
    first_run::state(&app)
}

#[tauri::command]
pub async fn first_run_pick_parent(app: AppHandle) -> Result<PickParent, String> {
    blocking(move || first_run::pick_parent(&app)).await
}

#[tauri::command]
pub async fn first_run_pick_folder(app: AppHandle) -> Result<PickFolder, String> {
    blocking(move || first_run::pick_folder(&app)).await
}

#[tauri::command]
pub async fn first_run_finish(app: AppHandle, choice: FirstRunChoice) -> Answer {
    blocking(move || first_run::finish(&app, &choice)).await
}
