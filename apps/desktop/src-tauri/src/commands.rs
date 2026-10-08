//! What a page may ask the shell, one command per row of `apps/desktop/src/ipc-contract.ts`. Each
//! answers a plain value the page parses with that row's schema, and a refusal is a value too,
//! never an error: the page shows it in the shell's words.
//!
//! The app window reaches these through a capability the shell adds for the server's exact origin
//! (`window.rs`).

use serde::Serialize;
use tauri::{AppHandle, Manager, Runtime};

use crate::diagnostics;
use crate::shell::{self, Shell};
use crate::update_state::UpdateState;
use crate::updater::{self, Updates};

/// The commands the app window is granted, named as `build.rs`'s app manifest names them.
pub const APP_WINDOW_COMMANDS: &[&str] = &[
    "diagnostics_get_state",
    "diagnostics_open_data_folder",
    "diagnostics_restart",
    "diagnostics_set_debug",
    "diagnostics_show_log",
    "updates_check",
    "updates_download",
    "updates_get_state",
    "updates_install",
];

/// What the page reads back when the shell asks the OS to show a folder or a file of its own
/// (`path-action.ts`): only whether the OS took it, and the reason when not.
#[derive(Debug, PartialEq, Eq, Serialize)]
pub struct PathAction {
    ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    reason: Option<String>,
}

impl PathAction {
    pub const fn done() -> Self {
        Self {
            ok: true,
            reason: None,
        }
    }

    pub fn refused(reason: impl Into<String>) -> Self {
        Self {
            ok: false,
            reason: Some(reason.into()),
        }
    }
}

/// Blocking work (an OS opener, an install) runs off the async runtime's threads.
async fn blocking<T: Send + 'static>(work: impl FnOnce() -> T + Send + 'static) -> T {
    match tauri::async_runtime::spawn_blocking(work).await {
        Ok(value) => value,
        Err(error) => panic!("a blocking task panicked: {error}"),
    }
}

fn no_server() -> String {
    "The server is not up yet.".to_owned()
}

// ---- diagnostics ----

#[tauri::command]
pub async fn diagnostics_get_state<R: Runtime>(
    app: AppHandle<R>,
) -> Result<diagnostics::State, String> {
    app.state::<Shell>()
        .with_diagnostics(|diagnostics| diagnostics.state())
        .ok_or_else(no_server)
}

#[tauri::command]
pub async fn diagnostics_set_debug<R: Runtime>(
    app: AppHandle<R>,
    debug: bool,
) -> Result<diagnostics::Answer, String> {
    app.state::<Shell>()
        .with_diagnostics(|diagnostics| diagnostics.set_debug(debug))
        .ok_or_else(no_server)
}

/// A relaunch is the ordinary quit, which stops the server in order, then a start; a refused one
/// moves nothing.
#[tauri::command]
pub async fn diagnostics_restart<R: Runtime>(
    app: AppHandle<R>,
) -> Result<diagnostics::Answer, String> {
    let answer = app
        .state::<Shell>()
        .with_diagnostics(|diagnostics| diagnostics.restart())
        .ok_or_else(no_server)?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_path_action_serializes_as_the_page_reads_it() -> Result<(), serde_json::Error> {
        assert_eq!(
            serde_json::to_string(&PathAction::done())?,
            r#"{"ok":true}"#
        );
        assert_eq!(
            serde_json::to_string(&PathAction::refused("no"))?,
            r#"{"ok":false,"reason":"no"}"#
        );
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
