//! Tauri's updater makes the moves; this owns the policy. One step at a time, nothing downloads or
//! installs without a click, a check 15 seconds after launch and every 4 minutes after, and the
//! server stopped before the bundle is replaced, so the vault's pending commit flushes first. The
//! state is the `UpdateState` union, which the page mirrors from the `update-state` event.

use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::server_log::utc_stamp;
use crate::update_state::{UpdateAction, UpdateState, failure_reason};

pub const UPDATE_STATE_EVENT: &str = "update-state";
pub const STARTUP_DELAY: Duration = Duration::from_secs(15);
pub const POLL_INTERVAL: Duration = Duration::from_secs(4 * 60);

/// What a step holds while it runs, so two cannot run at once.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Step {
    Check,
    Download,
    Install,
}

struct Inner {
    state: UpdateState,
    step: Option<Step>,
    found: Option<Update>,
    /// The bytes a download verified, kept for the install, with the version they are.
    downloaded: Option<(String, Vec<u8>)>,
}

pub struct Updates {
    inner: Mutex<Inner>,
}

/// Why a build never checks: one with no feed configured, and a shell with no bundle to replace.
pub fn disabled_reason(configured: bool, bundled: bool) -> Option<&'static str> {
    if !bundled {
        Some("Automatic updates are only available in the packaged app.")
    } else if !configured {
        Some("This build carries no update feed.")
    } else {
        None
    }
}

fn now() -> String {
    utc_stamp(SystemTime::now())
}

impl Updates {
    pub fn new(current_version: &str, disabled: Option<&str>) -> Self {
        Self {
            inner: Mutex::new(Inner {
                state: UpdateState::initial(current_version, disabled),
                step: None,
                found: None,
                downloaded: None,
            }),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn state(&self) -> UpdateState {
        self.lock().state.clone()
    }
}

fn publish<R: Runtime>(app: &AppHandle<R>, inner: &mut Inner, next: UpdateState) {
    if inner.state == next {
        return;
    }
    inner.state = next;
    if let Err(error) = app.emit(UPDATE_STATE_EVENT, &inner.state) {
        eprintln!("[updater] could not tell the page: {error}");
    }
}

fn updates<R: Runtime>(app: &AppHandle<R>) -> tauri::State<'_, Updates> {
    app.state::<Updates>()
}

/// Reserves a step; false when another is running, which is said and skipped.
fn reserve<R: Runtime>(app: &AppHandle<R>, step: Step) -> bool {
    let updates = updates(app);
    let mut inner = updates.lock();
    if let Some(running) = inner.step {
        println!("[updater] {step:?} skipped: {running:?} is in progress");
        return false;
    }
    inner.step = Some(step);
    true
}

fn release<R: Runtime>(app: &AppHandle<R>, step: Step) {
    let updates = updates(app);
    let mut inner = updates.lock();
    if inner.step == Some(step) {
        inner.step = None;
    }
}

pub async fn check<R: Runtime>(app: &AppHandle<R>, reason: &str) -> UpdateState {
    {
        let state = updates(app).state();
        if state.is_disabled() {
            return state;
        }
        if matches!(
            state,
            UpdateState::Downloading { .. } | UpdateState::Downloaded { .. }
        ) {
            println!("[updater] check ({reason}) skipped: an update is already on its way");
            return state;
        }
    }
    if !reserve(app, Step::Check) {
        return updates(app).state();
    }
    {
        let updates = updates(app);
        let mut inner = updates.lock();
        let next = inner.state.check_started(&now());
        publish(app, &mut inner, next);
    }
    println!("[updater] checking for updates ({reason})");
    let found = match app.updater() {
        Ok(updater) => updater.check().await.map_err(|error| error.to_string()),
        Err(error) => Err(error.to_string()),
    };
    {
        let updates = updates(app);
        let mut inner = updates.lock();
        let at = now();
        let next = match found {
            Ok(Some(update)) => {
                println!("[updater] update available: {}", update.version);
                let next = inner.state.update_available(&update.version, &at);
                inner.found = Some(update);
                next
            }
            Ok(None) => inner.state.no_update(&at),
            Err(message) => inner.state.failure(&failure_reason(&message), Some(&at)),
        };
        publish(app, &mut inner, next);
    }
    release(app, Step::Check);
    updates(app).state()
}

/// Runs only where the button offers a download, so the two cannot disagree.
pub async fn download<R: Runtime>(app: &AppHandle<R>) -> UpdateState {
    let (version, update) = {
        let updates = updates(app);
        let inner = updates.lock();
        let Some(UpdateAction::Download { version }) = inner.state.action() else {
            return inner.state.clone();
        };
        let Some(update) = inner.found.clone() else {
            return inner.state.clone();
        };
        (version, update)
    };
    if !reserve(app, Step::Download) {
        return updates(app).state();
    }
    {
        let updates = updates(app);
        let mut inner = updates.lock();
        let next = inner.state.download_started(&version);
        publish(app, &mut inner, next);
    }
    println!("[updater] downloading {version}");
    let mut received: u64 = 0;
    let progress_app = app.clone();
    let bytes = update
        .download(
            |chunk, total| {
                received += chunk as u64;
                let Some(total) = total.filter(|total| *total > 0) else {
                    return;
                };
                let percent = u8::try_from(received.saturating_mul(100) / total).unwrap_or(100);
                let updates = updates(&progress_app);
                let mut inner = updates.lock();
                let next = inner.state.download_progress(percent);
                publish(&progress_app, &mut inner, next);
            },
            || {},
        )
        .await;
    {
        let updates = updates(app);
        let mut inner = updates.lock();
        let next = match bytes {
            Ok(bytes) => {
                println!("[updater] update downloaded: {version}");
                inner.downloaded = Some((version.clone(), bytes));
                inner.state.download_complete(&version)
            }
            Err(error) => inner
                .state
                .failure(&failure_reason(&error.to_string()), None),
        };
        publish(app, &mut inner, next);
    }
    release(app, Step::Download);
    updates(app).state()
}

/// Stops the server, replaces the bundle, relaunches. The server is already down when an install
/// fails, so the honest move is to say so and quit.
pub fn install<R: Runtime>(app: &AppHandle<R>) -> UpdateState {
    let (update, bytes) = {
        let updates = updates(app);
        let inner = updates.lock();
        let Some(UpdateAction::Install { version }) = inner.state.action() else {
            return inner.state.clone();
        };
        match (&inner.found, &inner.downloaded) {
            (Some(update), Some((downloaded, bytes))) if *downloaded == version => {
                (update.clone(), bytes.clone())
            }
            _ => return inner.state.clone(),
        }
    };
    if !reserve(app, Step::Install) {
        return updates(app).state();
    }
    println!(
        "[updater] installing {}: stopping the server",
        update.version
    );
    crate::shell::stop_owned_server(app);
    match update.install(bytes) {
        Ok(()) => app.restart(),
        Err(error) => {
            let message = failure_reason(&error.to_string());
            {
                let updates = updates(app);
                let mut inner = updates.lock();
                let next = inner.state.failure(&message, None);
                publish(app, &mut inner, next);
            }
            release(app, Step::Install);
            app.dialog()
                .message(format!("{message} Reopen Inteligir to continue."))
                .title("Update failed")
                .kind(MessageDialogKind::Error)
                .blocking_show();
            app.exit(1);
            updates(app).state()
        }
    }
}

/// The first check shortly after launch, then every few minutes; a disabled updater runs neither.
pub fn start<R: Runtime>(app: &AppHandle<R>) {
    let state = updates(app).state();
    if let UpdateState::Disabled { reason, .. } = state {
        println!("[updater] updates disabled: {reason}");
        return;
    }
    let polling = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(STARTUP_DELAY);
        tauri::async_runtime::block_on(check(&polling, "startup"));
        loop {
            std::thread::sleep(POLL_INTERVAL);
            tauri::async_runtime::block_on(check(&polling, "poll"));
        }
    });
}

fn tell<R: Runtime>(app: &AppHandle<R>, title: &str, message: &str, kind: MessageDialogKind) {
    app.dialog()
        .message(message)
        .title(title)
        .kind(kind)
        .blocking_show();
}

fn ask<R: Runtime>(app: &AppHandle<R>, title: &str, message: &str, yes: &str, no: &str) -> bool {
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            yes.to_owned(),
            no.to_owned(),
        ))
        .blocking_show()
}

fn ask_to_restart<R: Runtime>(app: &AppHandle<R>, version: &str) {
    if ask(
        app,
        "Update ready",
        &format!(
            "Inteligir {version} is ready to install. The app restarts to finish; your notes are saved first."
        ),
        "Restart now",
        "Later",
    ) {
        install(app);
    }
}

/// Check for Updates… in the app menu: the same steps the page's button takes, said in dialogs.
pub async fn check_from_menu<R: Runtime>(app: AppHandle<R>) {
    let state = check(&app, "menu").await;
    let menu_app = app.clone();
    let _ = tauri::async_runtime::spawn_blocking(move || {
        let app = menu_app;
        match state {
            UpdateState::Idle { .. }
            | UpdateState::Checking { .. }
            | UpdateState::Downloading { .. } => {}
            UpdateState::UpToDate {
                current_version, ..
            } => tell(
                &app,
                "You're up to date",
                &format!("Inteligir {current_version} is the newest version."),
                MessageDialogKind::Info,
            ),
            UpdateState::Available { version, .. } => {
                if ask(
                    &app,
                    "Update available",
                    &format!("Inteligir {version} is available."),
                    "Download",
                    "Later",
                ) {
                    let downloaded = tauri::async_runtime::block_on(download(&app));
                    match downloaded {
                        UpdateState::Downloaded { version, .. } => ask_to_restart(&app, &version),
                        UpdateState::Error { message, .. } => {
                            tell(&app, "Download failed", &message, MessageDialogKind::Error);
                        }
                        _ => {}
                    }
                }
            }
            UpdateState::Downloaded { version, .. } => ask_to_restart(&app, &version),
            UpdateState::Disabled { reason, .. } => {
                tell(&app, "Updates are off", &reason, MessageDialogKind::Warning);
            }
            UpdateState::Error { message, .. } => {
                tell(
                    &app,
                    "Update check failed",
                    &message,
                    MessageDialogKind::Warning,
                );
            }
        }
    })
    .await;
}
