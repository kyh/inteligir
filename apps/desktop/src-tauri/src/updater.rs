//! The update flow, behind three commands and one event the shell owns. The page is deployed apart
//! from the installed shell, so it speaks this contract rather than the updater plugin's own API,
//! and holds no plugin permission. Nothing moves without the person: the page checks when it
//! loads, and the download and the restart each wait for a click.

use std::sync::{Mutex, MutexGuard, PoisonError};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};

/// The event the page listens for (`apps/web/src/library/shell/desktop-bridge.ts`).
const UPDATE_STATE_EVENT: &str = "update-state";

/// Mirrored by `updateStateSchema` in `apps/web/src/library/shell/desktop-bridge.ts`, which parses it.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum UpdateState {
    #[default]
    Idle,
    Checking,
    NotAvailable,
    Available {
        version: String,
    },
    Downloading {
        #[serde(rename = "downloadPercent")]
        download_percent: u8,
    },
    Downloaded {
        version: String,
    },
    Error {
        message: String,
    },
}

/// Where the session stands, the release it found and its verified bytes held inside the phase
/// that has them, so no phase names an update it does not hold. `U` is the plugin's `Update` in
/// the shell and `()` in the tests.
#[derive(Debug, PartialEq)]
enum Phase<U> {
    Idle,
    Checking,
    NotAvailable,
    Available {
        version: String,
        update: U,
    },
    Downloading {
        version: String,
        percent: u8,
    },
    Downloaded {
        version: String,
        update: U,
        bytes: Vec<u8>,
    },
    /// The bytes went to the installer: the app restarts, or the install fails.
    Installing {
        version: String,
    },
    Failed {
        message: String,
    },
}

#[derive(Debug)]
enum Event<U> {
    CheckAsked,
    /// The feed's answer: a newer release by its version, none, or why it could not be read.
    Checked(Result<Option<(String, U)>, String>),
    DownloadAsked,
    Progress(u8),
    DownloadEnded(Result<(U, Vec<u8>), String>),
    InstallAsked,
    InstallFailed(String),
}

/// What a step hands the shell to run outside the lock.
#[derive(Debug, PartialEq)]
enum Work<U> {
    Check,
    Download(U),
    Install(U, Vec<u8>),
}

/// The one step of the session: an event moves the phase or leaves it as it stands. An ask that
/// does not fit the phase (a download before a check found one, a second restart) is a no-op, and
/// a check is refused while one runs, a download is under way or an update waits to install.
fn apply<U>(phase: Phase<U>, event: Event<U>) -> (Phase<U>, Option<Work<U>>) {
    match (phase, event) {
        (
            Phase::Idle | Phase::NotAvailable | Phase::Available { .. } | Phase::Failed { .. },
            Event::CheckAsked,
        ) => (Phase::Checking, Some(Work::Check)),
        (Phase::Checking, Event::Checked(Ok(Some((version, update))))) => {
            (Phase::Available { version, update }, None)
        }
        (Phase::Checking, Event::Checked(Ok(None))) => (Phase::NotAvailable, None),
        (Phase::Available { version, update }, Event::DownloadAsked) => (
            Phase::Downloading {
                version,
                percent: 0,
            },
            Some(Work::Download(update)),
        ),
        (Phase::Downloading { version, .. }, Event::Progress(percent)) => {
            (Phase::Downloading { version, percent }, None)
        }
        (Phase::Downloading { version, .. }, Event::DownloadEnded(Ok((update, bytes)))) => (
            Phase::Downloaded {
                version,
                update,
                bytes,
            },
            None,
        ),
        (
            Phase::Downloaded {
                version,
                update,
                bytes,
            },
            Event::InstallAsked,
        ) => (
            Phase::Installing { version },
            Some(Work::Install(update, bytes)),
        ),
        (Phase::Checking, Event::Checked(Err(message)))
        | (Phase::Downloading { .. }, Event::DownloadEnded(Err(message)))
        | (Phase::Installing { .. }, Event::InstallFailed(message)) => {
            (Phase::Failed { message }, None)
        }
        (phase, _) => (phase, None),
    }
}

impl<U> Phase<U> {
    /// The page's view: installing reads as downloaded until the app restarts, since the page
    /// draws no state of its own for it.
    fn wire(&self) -> UpdateState {
        match self {
            Self::Idle => UpdateState::Idle,
            Self::Checking => UpdateState::Checking,
            Self::NotAvailable => UpdateState::NotAvailable,
            Self::Available { version, .. } => UpdateState::Available {
                version: version.clone(),
            },
            Self::Downloading { percent, .. } => UpdateState::Downloading {
                download_percent: *percent,
            },
            Self::Downloaded { version, .. } | Self::Installing { version } => {
                UpdateState::Downloaded {
                    version: version.clone(),
                }
            }
            Self::Failed { message } => UpdateState::Error {
                message: message.clone(),
            },
        }
    }
}

pub struct Updates {
    enabled: bool,
    phase: Mutex<Phase<Update>>,
}

impl Updates {
    /// Off under `tauri dev`, and until the updater is configured: there is no feed to read.
    pub fn new(enabled: bool) -> Self {
        Self {
            enabled,
            phase: Mutex::new(Phase::Idle),
        }
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }

    fn lock(&self) -> MutexGuard<'_, Phase<Update>> {
        self.phase.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// Applies an event under the lock and tells the page when what it shows moved. The work it
/// returns runs after the lock is dropped.
fn step<R: Runtime>(
    app: &AppHandle<R>,
    event: Event<Update>,
) -> (UpdateState, Option<Work<Update>>) {
    let updates = app.state::<Updates>();
    let (before, after, work) = {
        let mut phase = updates.lock();
        let before = phase.wire();
        let (next, work) = apply(std::mem::replace(&mut *phase, Phase::Idle), event);
        *phase = next;
        (before, phase.wire(), work)
    };
    if after != before
        && let Err(error) = app.emit(UPDATE_STATE_EVENT, &after)
    {
        eprintln!("[desktop] could not send the update state: {error}");
    }
    (after, work)
}

fn percent(received: u64, total: u64) -> u8 {
    if total == 0 {
        return 0;
    }
    u8::try_from(received.saturating_mul(100) / total).map_or(100, |value| value.min(100))
}

pub async fn check<R: Runtime>(app: &AppHandle<R>) -> UpdateState {
    if !app.state::<Updates>().enabled {
        return UpdateState::Idle;
    }
    let (state, work) = step(app, Event::CheckAsked);
    let Some(Work::Check) = work else {
        return state;
    };
    let found = match app.updater() {
        Ok(feed) => feed.check().await,
        Err(error) => Err(error),
    };
    let checked = found
        .map(|found| found.map(|update| (update.version.clone(), update)))
        .map_err(|error| error.to_string());
    step(app, Event::Checked(checked)).0
}

pub async fn download<R: Runtime>(app: &AppHandle<R>) -> UpdateState {
    let (state, work) = step(app, Event::DownloadAsked);
    let Some(Work::Download(update)) = work else {
        return state;
    };
    let mut received: u64 = 0;
    let bytes = update
        .download(
            |chunk, total| {
                received = received.saturating_add(u64::try_from(chunk).unwrap_or(u64::MAX));
                if let Some(total) = total {
                    step(app, Event::Progress(percent(received, total)));
                }
            },
            || {},
        )
        .await;
    let ended = bytes
        .map(|bytes| (update, bytes))
        .map_err(|error| error.to_string());
    step(app, Event::DownloadEnded(ended)).0
}

pub fn install<R: Runtime>(app: AppHandle<R>) -> UpdateState {
    let (state, work) = step(&app, Event::InstallAsked);
    let Some(Work::Install(update, bytes)) = work else {
        return state;
    };
    // off the command, so its answer reaches the page before the app restarts
    tauri::async_runtime::spawn_blocking(move || match update.install(&bytes) {
        Ok(()) => app.restart(),
        Err(error) => {
            step(&app, Event::InstallFailed(error.to_string()));
        }
    });
    state
}

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> UpdateState {
    check(&app).await
}

#[tauri::command]
pub async fn download_update(app: AppHandle) -> UpdateState {
    download(&app).await
}

#[tauri::command]
pub fn install_update(app: AppHandle) -> UpdateState {
    install(app)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn wire(state: &UpdateState) -> serde_json::Value {
        serde_json::to_value(state).unwrap_or_else(|error| panic!("{state:?}: {error}"))
    }

    fn available() -> Phase<()> {
        Phase::Available {
            version: "1.2.3".into(),
            update: (),
        }
    }

    fn downloaded() -> Phase<()> {
        Phase::Downloaded {
            version: "1.2.3".into(),
            update: (),
            bytes: vec![1, 2, 3],
        }
    }

    #[test]
    fn serializes_the_shape_the_page_parses() {
        assert_eq!(wire(&UpdateState::Idle), json!({ "status": "idle" }));
        assert_eq!(
            wire(&UpdateState::NotAvailable),
            json!({ "status": "not-available" })
        );
        assert_eq!(
            wire(&UpdateState::Available {
                version: "1.2.3".into()
            }),
            json!({ "status": "available", "version": "1.2.3" })
        );
        assert_eq!(
            wire(&UpdateState::Downloading {
                download_percent: 42
            }),
            json!({ "status": "downloading", "downloadPercent": 42 })
        );
        assert_eq!(
            wire(&UpdateState::Downloaded {
                version: "1.2.3".into()
            }),
            json!({ "status": "downloaded", "version": "1.2.3" })
        );
        assert_eq!(
            wire(&UpdateState::Error {
                message: "offline".into()
            }),
            json!({ "status": "error", "message": "offline" })
        );
    }

    #[test]
    fn percent_floors_and_stays_in_range() {
        assert_eq!(percent(0, 0), 0);
        assert_eq!(percent(1, 3), 33);
        assert_eq!(percent(3, 3), 100);
        assert_eq!(percent(5, 3), 100);
        assert_eq!(percent(u64::MAX, 1), 100);
    }

    #[test]
    fn a_found_update_downloads_and_installs_on_a_click_each() {
        let (phase, work) = apply(Phase::Idle, Event::CheckAsked);
        assert_eq!((&phase, work), (&Phase::Checking, Some(Work::Check)));
        let (phase, _) = apply(phase, Event::Checked(Ok(Some(("1.2.3".into(), ())))));
        assert_eq!(phase, available());
        let (phase, work) = apply(phase, Event::DownloadAsked);
        assert_eq!(work, Some(Work::Download(())));
        let (phase, _) = apply(phase, Event::Progress(42));
        assert_eq!(
            phase.wire(),
            UpdateState::Downloading {
                download_percent: 42
            }
        );
        let (phase, _) = apply(phase, Event::DownloadEnded(Ok(((), vec![1, 2, 3]))));
        assert_eq!(phase, downloaded());
        let (phase, work) = apply(phase, Event::InstallAsked);
        assert_eq!(work, Some(Work::Install((), vec![1, 2, 3])));
        // the page goes on reading downloaded until the app restarts
        assert_eq!(
            phase.wire(),
            UpdateState::Downloaded {
                version: "1.2.3".into()
            }
        );
    }

    #[test]
    fn a_restart_asked_again_while_installing_does_nothing() {
        let (installing, _) = apply(downloaded(), Event::InstallAsked);
        let (phase, work) = apply(installing, Event::InstallAsked);
        assert_eq!(work, None);
        assert_eq!(
            phase,
            Phase::Installing {
                version: "1.2.3".into()
            }
        );
        let (phase, _) = apply(phase, Event::InstallFailed("disk full".into()));
        assert_eq!(
            phase.wire(),
            UpdateState::Error {
                message: "disk full".into()
            }
        );
    }

    #[test]
    fn nothing_installs_or_downloads_before_its_turn() {
        for phase in [
            Phase::Idle,
            Phase::Checking,
            available(),
            Phase::NotAvailable,
        ] {
            let before = phase.wire();
            let (phase, work) = apply(phase, Event::InstallAsked);
            assert_eq!((phase.wire(), work), (before, None));
        }
        for phase in [
            Phase::Idle,
            Phase::Checking,
            downloaded(),
            Phase::NotAvailable,
        ] {
            let before = phase.wire();
            let (phase, work) = apply(phase, Event::DownloadAsked);
            assert_eq!((phase.wire(), work), (before, None));
        }
    }

    #[test]
    fn a_check_again_lets_the_release_it_found_go() {
        let (phase, work) = apply(available(), Event::CheckAsked);
        assert_eq!((&phase, work), (&Phase::Checking, Some(Work::Check)));
        let (phase, work) = apply(phase, Event::DownloadAsked);
        assert_eq!(work, None);
        let (phase, _) = apply(phase, Event::Checked(Err("offline".into())));
        let (phase, work) = apply(phase, Event::DownloadAsked);
        assert_eq!(
            (phase, work),
            (
                Phase::Failed {
                    message: "offline".into()
                },
                None
            )
        );
    }

    #[test]
    fn a_check_waits_for_the_one_under_way_and_for_an_update_in_hand() {
        let busy = [
            Phase::Checking,
            Phase::Downloading {
                version: "1.2.3".into(),
                percent: 7,
            },
            downloaded(),
            Phase::Installing {
                version: "1.2.3".into(),
            },
        ];
        for phase in busy {
            let before = phase.wire();
            let (phase, work) = apply(phase, Event::CheckAsked);
            assert_eq!((phase.wire(), work), (before, None));
        }
    }

    #[test]
    fn progress_and_late_answers_move_only_the_phase_they_belong_to() {
        let (phase, _) = apply(available(), Event::Progress(50));
        assert_eq!(phase, available());
        let (phase, _) = apply(Phase::<()>::Idle, Event::Checked(Ok(None)));
        assert_eq!(phase, Phase::Idle);
        let (phase, _) = apply(downloaded(), Event::DownloadEnded(Err("late".into())));
        assert_eq!(phase, downloaded());
    }
}
