//! What the page may ask the shell, one command per row of
//! `apps/workspace/src/shell/ipc-contract.ts`. Each is `async`, takes its arguments owned and
//! answers a `Result`, whose `ShellError` crosses as the call's rejection; the replica's and the
//! files' work runs on a blocking thread, never the runtime's. Bytes cross raw both ways: a staged
//! file comes in as the request's body, named by a header, and goes out as an `ipc::Response`.
//!
//! The window reaches these through `capabilities/app-window.json`, which grants them to the app's
//! own page alone.

use tauri::ipc::{InvokeBody, Request, Response};
use tauri::{AppHandle, Manager};

use crate::account::Account;
use crate::cloud::ShellConfig;
use crate::credential::DeviceCredential;
use crate::error::{ShellError, ShellResult};
use crate::replica::{Row, Statement};
use crate::update_state::UpdateState;
use crate::updater::{self, Updates};

/// The header a staged file's sha rides beside its raw bytes.
const FILE_SHA_HEADER: &str = "x-file-sha";

/// Blocking work (SQLite, the disk, the Keychain) runs off the async runtime's threads.
async fn blocking<T: Send + 'static>(
    app: AppHandle,
    work: impl FnOnce(&Account) -> ShellResult<T> + Send + 'static,
) -> ShellResult<T> {
    tauri::async_runtime::spawn_blocking(move || work(&app.state::<Account>()))
        .await
        .map_err(|error| ShellError::Invalid(format!("the shell's work stopped: {error}")))?
}

#[tauri::command]
pub async fn shell_config(app: AppHandle) -> ShellResult<ShellConfig> {
    Ok(app.state::<ShellConfig>().inner().clone())
}

#[tauri::command]
pub async fn credential_restore(app: AppHandle) -> ShellResult<Option<DeviceCredential>> {
    blocking(app, Account::restore).await
}

#[tauri::command]
pub async fn credential_keep(app: AppHandle, credential: DeviceCredential) -> ShellResult<()> {
    blocking(app, move |account| account.keep(&credential)).await
}

#[tauri::command]
pub async fn credential_forget(app: AppHandle) -> ShellResult<()> {
    blocking(app, Account::forget).await
}

#[tauri::command]
pub async fn replica_all(
    app: AppHandle,
    sql: String,
    params: Vec<serde_json::Value>,
) -> ShellResult<Vec<Row>> {
    blocking(app, move |account| {
        account.replica().all(&Statement { sql, params })
    })
    .await
}

#[tauri::command]
pub async fn replica_run(
    app: AppHandle,
    sql: String,
    params: Vec<serde_json::Value>,
) -> ShellResult<()> {
    blocking(app, move |account| {
        account.replica().run(&Statement { sql, params })
    })
    .await
}

#[tauri::command]
pub async fn replica_begin(app: AppHandle) -> ShellResult<u64> {
    blocking(app, |account| account.replica().begin()).await
}

#[tauri::command]
pub async fn replica_tx_all(
    app: AppHandle,
    token: u64,
    sql: String,
    params: Vec<serde_json::Value>,
) -> ShellResult<Vec<Row>> {
    blocking(app, move |account| {
        account.replica().all_in(token, Statement { sql, params })
    })
    .await
}

#[tauri::command]
pub async fn replica_tx_run(
    app: AppHandle,
    token: u64,
    sql: String,
    params: Vec<serde_json::Value>,
) -> ShellResult<()> {
    blocking(app, move |account| {
        account.replica().run_in(token, Statement { sql, params })
    })
    .await
}

#[tauri::command]
pub async fn replica_commit(app: AppHandle, token: u64) -> ShellResult<()> {
    blocking(app, move |account| account.replica().commit(token)).await
}

#[tauri::command]
pub async fn replica_rollback(app: AppHandle, token: u64) -> ShellResult<()> {
    blocking(app, move |account| {
        account.replica().rollback(token);
        Ok(())
    })
    .await
}

/// A file the outbox will upload: its bytes are the request's raw body, its sha a header.
#[tauri::command]
pub async fn files_stage(app: AppHandle, request: Request<'_>) -> ShellResult<()> {
    let InvokeBody::Raw(bytes) = request.body() else {
        return Err(ShellError::Invalid(
            "a staged file arrives as raw bytes".to_owned(),
        ));
    };
    let sha = request
        .headers()
        .get(FILE_SHA_HEADER)
        .and_then(|value| value.to_str().ok())
        .ok_or_else(|| ShellError::Invalid(format!("a staged file names its {FILE_SHA_HEADER}")))?
        .to_owned();
    let bytes = bytes.clone();
    blocking(app, move |account| account.files().stage(&sha, &bytes)).await
}

/// A staged file's bytes; one this Mac no longer holds is `missing`.
#[tauri::command]
pub async fn files_staged(app: AppHandle, sha: String) -> ShellResult<Response> {
    blocking(app, move |account| {
        account
            .files()
            .staged(&sha)?
            .map(Response::new)
            .ok_or(ShellError::Missing)
    })
    .await
}

#[tauri::command]
pub async fn files_unstage(app: AppHandle, sha: String) -> ShellResult<()> {
    blocking(app, move |account| account.files().unstage(&sha)).await
}

#[tauri::command]
pub async fn files_clear_staged(app: AppHandle) -> ShellResult<()> {
    blocking(app, |account| account.files().clear_staged()).await
}

#[tauri::command]
pub async fn updates_get_state(app: AppHandle) -> ShellResult<UpdateState> {
    Ok(app.state::<Updates>().state())
}

#[tauri::command]
pub async fn updates_check(app: AppHandle) -> ShellResult<UpdateState> {
    Ok(updater::check(&app, "settings").await)
}

/// Restart to Update: installs the ready update and relaunches; the state answers only when
/// nothing was ready, or the install failed.
#[tauri::command]
pub async fn updates_install(app: AppHandle) -> ShellResult<UpdateState> {
    tauri::async_runtime::spawn_blocking(move || updater::restart_to_update(&app))
        .await
        .map_err(|error| ShellError::Invalid(format!("the shell's work stopped: {error}")))
}
