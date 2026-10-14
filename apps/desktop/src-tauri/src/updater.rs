//! Tauri's updater makes the moves; this owns the policy. One step at a time, nothing downloads or
//! installs without a click, a check 15 seconds after launch and every 4 minutes after, and the
//! server stopped before the bundle is replaced, so the vault's pending commit flushes first. The
//! state is the `UpdateState` union, which the page mirrors from the `update-state` event.

use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::MessageDialogKind;
use tauri_plugin_updater::{Update, UpdaterExt};

use crate::dialogs;
use crate::server_log::utc_stamp;
use crate::update_state::{UpdateAction, UpdateState, UpdateStatus, failure_reason};

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

    /// Reserves a step until the guard drops; None when another is running, which is said and
    /// skipped.
    fn reserve(&self, step: Step) -> Option<Running<'_>> {
        let mut inner = self.lock();
        if let Some(running) = inner.step {
            println!("[updater] {step:?} skipped: {running:?} is in progress");
            return None;
        }
        inner.step = Some(step);
        Some(Running { updates: self })
    }

    /// Moves the state on and tells the page; `next` may keep what the step found beside it.
    fn transition(&self, app: &AppHandle, next: impl FnOnce(&mut Inner) -> UpdateState) {
        let mut inner = self.lock();
        let next = next(&mut inner);
        publish(app, &mut inner, next);
    }
}

/// A reserved step, released on whichever path the step leaves by.
struct Running<'a> {
    updates: &'a Updates,
}

impl Drop for Running<'_> {
    // takes the lock, which is not reentrant: a step reserves before it locks, so every guard it
    // takes on `Inner` is gone by the time this one drops
    fn drop(&mut self) {
        self.updates.lock().step = None;
    }
}

fn publish(app: &AppHandle, inner: &mut Inner, next: UpdateState) {
    if inner.state == next {
        return;
    }
    inner.state = next;
    if let Err(error) = app.emit(UPDATE_STATE_EVENT, &inner.state) {
        eprintln!("[updater] could not tell the page: {error}");
    }
}

fn updates(app: &AppHandle) -> tauri::State<'_, Updates> {
    app.state::<Updates>()
}

pub async fn check(app: &AppHandle, reason: &str) -> UpdateState {
    let updates = updates(app);
    {
        let state = updates.state();
        if state.is_disabled() {
            return state;
        }
        if matches!(
            state.status,
            UpdateStatus::Downloading { .. } | UpdateStatus::Downloaded { .. }
        ) {
            println!("[updater] check ({reason}) skipped: an update is already on its way");
            return state;
        }
    }
    let Some(_running) = updates.reserve(Step::Check) else {
        return updates.state();
    };
    updates.transition(app, |inner| inner.state.check_started(&now()));
    println!("[updater] checking for updates ({reason})");
    let found = match app.updater() {
        Ok(checker) => checker.check().await.map_err(|error| error.to_string()),
        Err(error) => Err(error.to_string()),
    };
    updates.transition(app, |inner| {
        let at = now();
        match found {
            Ok(Some(update)) => {
                println!("[updater] update available: {}", update.version);
                let next = inner.state.update_available(&update.version, &at);
                inner.found = Some(update);
                next
            }
            Ok(None) => inner.state.no_update(&at),
            Err(message) => inner.state.failure(&failure_reason(&message), Some(&at)),
        }
    });
    updates.state()
}

/// Runs only where the button offers a download, so the two cannot disagree. Reserved before the
/// update is read, so no check can swap `found` between the read and the download: the bytes are
/// always the update's that install pairs them with.
pub async fn download(app: &AppHandle) -> UpdateState {
    let updates = updates(app);
    let Some(_running) = updates.reserve(Step::Download) else {
        return updates.state();
    };
    let (version, update) = {
        let mut inner = updates.lock();
        let offered = match (inner.state.action(), &inner.found) {
            (Some(UpdateAction::Download { version }), Some(update))
                if update.version == version =>
            {
                Some((version, update.clone()))
            }
            _ => None,
        };
        let Some((version, update)) = offered else {
            return inner.state.clone();
        };
        let next = inner.state.download_started(&version);
        publish(app, &mut inner, next);
        (version, update)
    };
    println!("[updater] downloading {version}");
    let mut received: u64 = 0;
    let bytes = update
        .download(
            |chunk, total| {
                received += chunk as u64;
                let Some(total) = total.filter(|total| *total > 0) else {
                    return;
                };
                let percent = u8::try_from(received.saturating_mul(100) / total).unwrap_or(100);
                updates.transition(app, |inner| inner.state.download_progress(percent));
            },
            || {},
        )
        .await;
    updates.transition(app, |inner| match bytes {
        Ok(bytes) => {
            println!("[updater] update downloaded: {version}");
            inner.downloaded = Some((version.clone(), bytes));
            inner.state.download_complete(&version)
        }
        Err(error) => inner
            .state
            .failure(&failure_reason(&error.to_string()), None),
    });
    updates.state()
}

/// Stops the server, replaces the bundle, relaunches. The server is already down when an install
/// fails, so the honest move is to say so and quit.
pub fn install(app: &AppHandle) -> UpdateState {
    let updates = updates(app);
    let (update, bytes) = {
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
    let Some(running) = updates.reserve(Step::Install) else {
        return updates.state();
    };
    println!(
        "[updater] installing {}: stopping the server",
        update.version
    );
    crate::shell::stop_owned_server(app);
    match update.install(bytes) {
        Ok(()) => app.restart(),
        Err(error) => {
            let message = failure_reason(&error.to_string());
            updates.transition(app, |inner| inner.state.failure(&message, None));
            drop(running);
            dialogs::error(
                app,
                "Update failed",
                &format!("{message} Reopen Inteligir to continue."),
            );
            app.exit(1);
            updates.state()
        }
    }
}

/// The first check shortly after launch, then every few minutes; a disabled updater runs neither.
pub fn start(app: &AppHandle) {
    if let UpdateStatus::Disabled { reason } = updates(app).state().status {
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

fn ask_to_restart(app: &AppHandle, version: &str) {
    if dialogs::confirm(
        app,
        MessageDialogKind::Info,
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

/// Check for Updates… in the app menu: the same steps the page's button takes, said in dialogs,
/// each waited out, so it runs on a thread of its own.
pub fn check_from_menu(app: &AppHandle) {
    let UpdateState {
        current_version,
        status,
        ..
    } = tauri::async_runtime::block_on(check(app, "menu"));
    match status {
        UpdateStatus::Idle | UpdateStatus::Checking { .. } | UpdateStatus::Downloading { .. } => {}
        UpdateStatus::UpToDate => dialogs::show(
            app,
            MessageDialogKind::Info,
            "You're up to date",
            &format!("Inteligir {current_version} is the newest version."),
        ),
        UpdateStatus::Available { version } => {
            if dialogs::confirm(
                app,
                MessageDialogKind::Info,
                "Update available",
                &format!("Inteligir {version} is available."),
                "Download",
                "Later",
            ) {
                match tauri::async_runtime::block_on(download(app)).status {
                    UpdateStatus::Downloaded { version } => ask_to_restart(app, &version),
                    UpdateStatus::Error { message, .. } => {
                        dialogs::error(app, "Download failed", &message);
                    }
                    _ => {}
                }
            }
        }
        UpdateStatus::Downloaded { version } => ask_to_restart(app, &version),
        UpdateStatus::Disabled { reason } => {
            dialogs::show(app, MessageDialogKind::Warning, "Updates are off", &reason);
        }
        UpdateStatus::Error { message, .. } => {
            dialogs::show(
                app,
                MessageDialogKind::Warning,
                "Update check failed",
                &message,
            );
        }
    }
}
