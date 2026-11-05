//! Tauri's updater makes the moves; this owns the policy (`update_state.rs`). A check runs 15
//! seconds after launch and every 4 minutes after; one that finds an update downloads it in the
//! background, the plugin verifying its signature, and a verified download installs when the app
//! quits, so the next launch is the new version, and nothing restarts the app under the person.
//! Restart to Update, in the app menu and in Settings, installs it and relaunches at once. Either
//! way out first has the page write the open item's last edit to the outbox on disk
//! (`leaving.rs`), so a quit to install loses no edit the page held. The page holds no updater
//! permission: it mirrors this state from the `update-state` event and asks through the shell's own
//! commands.

use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{Duration, SystemTime};

use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_dialog::MessageDialogKind;
use tauri_plugin_updater::{Update, UpdaterExt};
use time::OffsetDateTime;
use time::format_description::BorrowedFormatItem;
use time::macros::format_description;

use crate::dialogs;
use crate::update_state::{UpdateState, UpdateStatus};

pub const UPDATE_STATE_EVENT: &str = "update-state";
pub const STARTUP_DELAY: Duration = Duration::from_secs(15);
pub const POLL_INTERVAL: Duration = Duration::from_secs(4 * 60);

const STAMP: &[BorrowedFormatItem<'_>] =
    format_description!("[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:3]Z");

fn now() -> String {
    OffsetDateTime::from(SystemTime::now())
        .format(STAMP)
        .unwrap_or_default()
}

struct Inner {
    state: UpdateState,
    /// The verified bytes of the ready update, with the update they install.
    ready: Option<(Update, Vec<u8>)>,
}

pub struct Updates {
    inner: Mutex<Inner>,
}

/// Why a build never checks: a shell with no bundle to replace, and one with no feed configured.
pub fn disabled_reason(configured: bool, bundled: bool) -> Option<&'static str> {
    if !bundled {
        Some("Automatic updates are only available in the packaged app.")
    } else if !configured {
        Some("This build carries no update feed.")
    } else {
        None
    }
}

impl Updates {
    pub fn new(current_version: &str, disabled: Option<&str>) -> Self {
        Self {
            inner: Mutex::new(Inner {
                state: UpdateState::initial(current_version, disabled),
                ready: None,
            }),
        }
    }

    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner.lock().unwrap_or_else(PoisonError::into_inner)
    }

    pub fn state(&self) -> UpdateState {
        self.lock().state.clone()
    }

    /// Moves the state on and tells the page; the menu follows whether an update is ready.
    fn transition(&self, app: &AppHandle, next: impl FnOnce(&mut Inner) -> UpdateState) {
        let ready_moved = {
            let mut inner = self.lock();
            let next = next(&mut inner);
            if inner.state == next {
                return;
            }
            let was_ready = inner.state.installs_on_quit().is_some();
            inner.state = next;
            if let Err(error) = app.emit(UPDATE_STATE_EVENT, &inner.state) {
                eprintln!("[updater] could not tell the page: {error}");
            }
            was_ready != inner.state.installs_on_quit().is_some()
        };
        if ready_moved {
            crate::menu::rebuild(app);
        }
    }
}

fn updates(app: &AppHandle) -> tauri::State<'_, Updates> {
    app.state::<Updates>()
}

/// Asks the feed; an update it names starts downloading in the background, and the state that
/// says so is answered at once.
pub async fn check(app: &AppHandle, reason: &str) -> UpdateState {
    let updates = updates(app);
    let mut started = false;
    updates.transition(app, |inner| {
        started = inner.state.may_check();
        inner.state.check_started(&now())
    });
    if !started {
        return updates.state();
    }
    println!("[updater] checking for updates ({reason})");
    let found = match app.updater() {
        Ok(checker) => checker.check().await.map_err(|error| error.to_string()),
        Err(error) => Err(error.to_string()),
    };
    match found {
        Ok(Some(update)) => {
            println!(
                "[updater] update available: {}; downloading",
                update.version
            );
            updates.transition(app, |inner| inner.state.update_found(&update.version));
            let downloading = app.clone();
            tauri::async_runtime::spawn(async move { download(&downloading, update).await });
        }
        Ok(None) => updates.transition(app, |inner| inner.state.no_update()),
        Err(message) => updates.transition(app, |inner| inner.state.failure(&message)),
    }
    updates.state()
}

async fn download(app: &AppHandle, update: Update) {
    let updates = updates(app);
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
            println!(
                "[updater] {} is ready: it installs when the app quits",
                update.version
            );
            inner.ready = Some((update, bytes));
            inner.state.download_complete()
        }
        Err(error) => inner.state.failure(&error.to_string()),
    });
}

/// Installs the ready update over the bundle, if there is one; the next launch runs it.
fn install_ready(app: &AppHandle) -> Option<Result<(), String>> {
    let updates = updates(app);
    let (update, bytes) = updates.lock().ready.take()?;
    println!("[updater] installing {}", update.version);
    let installed = update.install(bytes).map_err(|error| error.to_string());
    if let Err(message) = &installed {
        updates.transition(app, |inner| inner.state.failure(message));
    }
    Some(installed)
}

/// The app is quitting: a ready update goes on now, so the next launch is the new version.
pub fn install_on_quit(app: &AppHandle) {
    if let Some(Err(message)) = install_ready(app) {
        eprintln!("[updater] the update did not install: {message}");
    }
}

/// Restart to Update, once the page wrote what it held (`leaving::restart_to_update`): installs the
/// ready update and relaunches at once.
pub fn restart_to_update(app: &AppHandle) -> UpdateState {
    match install_ready(app) {
        Some(Ok(())) => app.restart(),
        Some(Err(message)) => dialogs::error(
            app,
            "The update did not install",
            &format!("{message} Inteligir will try again after its next check."),
        ),
        None => {}
    }
    updates(app).state()
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

/// Check for Updates… in the app menu: the page's button's check, its answer said in a dialog, so
/// it runs on a thread of its own.
pub fn check_from_menu(app: &AppHandle) {
    let UpdateState {
        current_version,
        status,
        ..
    } = tauri::async_runtime::block_on(check(app, "menu"));
    match status {
        UpdateStatus::Idle | UpdateStatus::Checking | UpdateStatus::Ready { .. } => {}
        UpdateStatus::UpToDate => dialogs::show(
            app,
            MessageDialogKind::Info,
            "You're up to date",
            &format!("Inteligir {current_version} is the newest version."),
        ),
        UpdateStatus::Downloading { version, .. } => dialogs::show(
            app,
            MessageDialogKind::Info,
            "An update is on its way",
            &format!(
                "Inteligir {version} is downloading. It installs when you quit, or choose Restart to Update once it's ready."
            ),
        ),
        UpdateStatus::Disabled { reason } => {
            dialogs::show(app, MessageDialogKind::Warning, "Updates are off", &reason);
        }
        UpdateStatus::Error { message } => {
            dialogs::show(
                app,
                MessageDialogKind::Warning,
                "Update check failed",
                &message,
            );
        }
    }
}
