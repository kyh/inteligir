//! The update flow, behind three commands and one event the shell owns. The page is deployed apart
//! from the installed shell, so it speaks this contract rather than the updater plugin's own API,
//! and holds no plugin permission. Nothing moves without the person: the page checks when it
//! loads, and the download and the restart each wait for a click.

use std::sync::{Mutex, MutexGuard, PoisonError};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
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
    CheckFailed {
        message: String,
    },
    DownloadFailed {
        version: String,
        message: String,
    },
    InstallFailed {
        version: String,
        message: String,
    },
}

/// How far a download is: asked and waiting for its first bytes, with the failure it retries when it
/// is a retry, then the share of them received.
#[derive(Debug, PartialEq)]
enum Received {
    Nothing { retrying: Option<String> },
    Percent(u8),
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
        received: Received,
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
    /// The feed could not be read, so the session holds no update to act on.
    CheckFailed {
        message: String,
    },
    /// The release stays held, so a retry downloads it again with no check.
    DownloadFailed {
        version: String,
        update: U,
        message: String,
    },
    /// The verified bytes stay held, so a retry installs them again with no download.
    InstallFailed {
        version: String,
        update: U,
        bytes: Vec<u8>,
        message: String,
    },
}

#[derive(Debug)]
enum Event<U> {
    CheckAsked,
    /// The feed's answer: a newer release by its version, none, or why it could not be read.
    Checked(Result<Option<(String, U)>, String>),
    DownloadAsked,
    /// Bytes arrived, this share of them all; 0 where the feed names no size.
    Progress(u8),
    /// The release comes back with the bytes or why they did not arrive.
    DownloadEnded(U, Result<Vec<u8>, String>),
    InstallAsked,
    /// What the installer was handed comes back with why it did not install.
    InstallFailed(U, Vec<u8>, String),
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
/// a check is refused while one runs, a download is under way or an update waits to install, a
/// failed install's included.
fn apply<U>(phase: Phase<U>, event: Event<U>) -> (Phase<U>, Option<Work<U>>) {
    match (phase, event) {
        (
            Phase::Idle
            | Phase::NotAvailable
            | Phase::Available { .. }
            | Phase::CheckFailed { .. }
            | Phase::DownloadFailed { .. },
            Event::CheckAsked,
        ) => (Phase::Checking, Some(Work::Check)),
        (Phase::Checking, Event::Checked(Ok(Some((version, update))))) => {
            (Phase::Available { version, update }, None)
        }
        (Phase::Checking, Event::Checked(Ok(None))) => (Phase::NotAvailable, None),
        (Phase::Checking, Event::Checked(Err(message))) => (Phase::CheckFailed { message }, None),
        (Phase::Available { version, update }, Event::DownloadAsked) => (
            Phase::Downloading {
                version,
                received: Received::Nothing { retrying: None },
            },
            Some(Work::Download(update)),
        ),
        (
            Phase::DownloadFailed {
                version,
                update,
                message,
            },
            Event::DownloadAsked,
        ) => (
            Phase::Downloading {
                version,
                received: Received::Nothing {
                    retrying: Some(message),
                },
            },
            Some(Work::Download(update)),
        ),
        (Phase::Downloading { version, .. }, Event::Progress(percent)) => (
            Phase::Downloading {
                version,
                received: Received::Percent(percent),
            },
            None,
        ),
        (Phase::Downloading { version, .. }, Event::DownloadEnded(update, Ok(bytes))) => (
            Phase::Downloaded {
                version,
                update,
                bytes,
            },
            None,
        ),
        (Phase::Downloading { version, .. }, Event::DownloadEnded(update, Err(message))) => (
            Phase::DownloadFailed {
                version,
                update,
                message,
            },
            None,
        ),
        (
            Phase::Downloaded {
                version,
                update,
                bytes,
            }
            | Phase::InstallFailed {
                version,
                update,
                bytes,
                ..
            },
            Event::InstallAsked,
        ) => (
            Phase::Installing { version },
            Some(Work::Install(update, bytes)),
        ),
        (Phase::Installing { version }, Event::InstallFailed(update, bytes, message)) => (
            Phase::InstallFailed {
                version,
                update,
                bytes,
                message,
            },
            None,
        ),
        (phase, _) => (phase, None),
    }
}

impl<U> Phase<U> {
    /// The page's view: installing reads as downloaded until the app restarts, since the page
    /// draws no state of its own for it, and a download reads as the step it was asked from until
    /// its first bytes arrive, so a retry that fails at once, offline, shows no progress between.
    fn wire(&self) -> UpdateState {
        match self {
            Self::Idle => UpdateState::Idle,
            Self::Checking => UpdateState::Checking,
            Self::NotAvailable => UpdateState::NotAvailable,
            Self::Available { version, .. } => UpdateState::Available {
                version: version.clone(),
            },
            Self::Downloading { version, received } => match received {
                Received::Nothing { retrying: None } => UpdateState::Available {
                    version: version.clone(),
                },
                Received::Nothing {
                    retrying: Some(message),
                } => UpdateState::DownloadFailed {
                    version: version.clone(),
                    message: message.clone(),
                },
                Received::Percent(percent) => UpdateState::Downloading {
                    download_percent: *percent,
                },
            },
            Self::Downloaded { version, .. } | Self::Installing { version } => {
                UpdateState::Downloaded {
                    version: version.clone(),
                }
            }
            Self::CheckFailed { message } => UpdateState::CheckFailed {
                message: message.clone(),
            },
            Self::DownloadFailed {
                version, message, ..
            } => UpdateState::DownloadFailed {
                version: version.clone(),
                message: message.clone(),
            },
            Self::InstallFailed {
                version, message, ..
            } => UpdateState::InstallFailed {
                version: version.clone(),
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

    fn lock(&self) -> MutexGuard<'_, Phase<Update>> {
        self.phase.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

/// Applies an event under the lock and tells the page when what it shows moved. The work it
/// returns runs after the lock is dropped.
fn step(app: &AppHandle, event: Event<Update>) -> (UpdateState, Option<Work<Update>>) {
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

#[tauri::command]
pub async fn check_for_updates(app: AppHandle) -> UpdateState {
    if !app.state::<Updates>().enabled {
        return UpdateState::Idle;
    }
    let (state, work) = step(&app, Event::CheckAsked);
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
    step(&app, Event::Checked(checked)).0
}

#[tauri::command]
pub async fn download_update(app: AppHandle) -> UpdateState {
    let (state, work) = step(&app, Event::DownloadAsked);
    let Some(Work::Download(update)) = work else {
        return state;
    };
    let mut received: u64 = 0;
    let bytes = update
        .download(
            |chunk, total| {
                received = received.saturating_add(u64::try_from(chunk).unwrap_or(u64::MAX));
                let share = total.map_or(0, |total| percent(received, total));
                step(&app, Event::Progress(share));
            },
            || {},
        )
        .await
        .map_err(|error| error.to_string());
    step(&app, Event::DownloadEnded(update, bytes)).0
}

#[tauri::command]
pub fn install_update(app: AppHandle) -> UpdateState {
    let (state, work) = step(&app, Event::InstallAsked);
    let Some(Work::Install(update, bytes)) = work else {
        return state;
    };
    // off the command, so its answer reaches the page before the app restarts
    tauri::async_runtime::spawn_blocking(move || match update.install(&bytes) {
        Ok(()) => app.restart(),
        Err(error) => {
            step(&app, Event::InstallFailed(update, bytes, error.to_string()));
        }
    });
    state
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

    fn downloading() -> Phase<()> {
        Phase::Downloading {
            version: "1.2.3".into(),
            received: Received::Percent(7),
        }
    }

    fn downloaded() -> Phase<()> {
        Phase::Downloaded {
            version: "1.2.3".into(),
            update: (),
            bytes: vec![1, 2, 3],
        }
    }

    fn download_failed() -> Phase<()> {
        Phase::DownloadFailed {
            version: "1.2.3".into(),
            update: (),
            message: "offline".into(),
        }
    }

    fn install_failed() -> Phase<()> {
        Phase::InstallFailed {
            version: "1.2.3".into(),
            update: (),
            bytes: vec![1, 2, 3],
            message: "disk full".into(),
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
            wire(&UpdateState::CheckFailed {
                message: "offline".into()
            }),
            json!({ "status": "check-failed", "message": "offline" })
        );
        assert_eq!(
            wire(&UpdateState::DownloadFailed {
                version: "1.2.3".into(),
                message: "cut off".into()
            }),
            json!({ "status": "download-failed", "version": "1.2.3", "message": "cut off" })
        );
        assert_eq!(
            wire(&UpdateState::InstallFailed {
                version: "1.2.3".into(),
                message: "disk full".into()
            }),
            json!({ "status": "install-failed", "version": "1.2.3", "message": "disk full" })
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
        // the page reads the release found until the first bytes arrive
        assert_eq!(
            phase.wire(),
            UpdateState::Available {
                version: "1.2.3".into()
            }
        );
        let (phase, _) = apply(phase, Event::Progress(42));
        assert_eq!(
            phase.wire(),
            UpdateState::Downloading {
                download_percent: 42
            }
        );
        let (phase, _) = apply(phase, Event::DownloadEnded((), Ok(vec![1, 2, 3])));
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
        let (phase, _) = apply(
            phase,
            Event::InstallFailed((), vec![1, 2, 3], "disk full".into()),
        );
        assert_eq!(phase, install_failed());
        assert_eq!(
            phase.wire(),
            UpdateState::InstallFailed {
                version: "1.2.3".into(),
                message: "disk full".into()
            }
        );
    }

    #[test]
    fn a_failed_download_downloads_again_with_no_check() {
        let (phase, _) = apply(
            downloading(),
            Event::DownloadEnded((), Err("offline".into())),
        );
        assert_eq!(phase, download_failed());
        let (phase, work) = apply(phase, Event::DownloadAsked);
        assert_eq!(
            (&phase, work),
            (
                &Phase::Downloading {
                    version: "1.2.3".into(),
                    received: Received::Nothing {
                        retrying: Some("offline".into())
                    }
                },
                Some(Work::Download(()))
            )
        );
        let (phase, _) = apply(phase, Event::DownloadEnded((), Ok(vec![1, 2, 3])));
        assert_eq!(phase, downloaded());
    }

    #[test]
    fn a_retry_reads_as_its_failure_until_bytes_arrive_so_one_failing_at_once_shows_no_progress() {
        let (retrying, _) = apply(download_failed(), Event::DownloadAsked);
        assert_eq!(retrying.wire(), download_failed().wire());
        let (failed, _) = apply(
            retrying,
            Event::DownloadEnded((), Err("still offline".into())),
        );
        assert_eq!(
            failed.wire(),
            UpdateState::DownloadFailed {
                version: "1.2.3".into(),
                message: "still offline".into()
            }
        );
        let (retrying, _) = apply(failed, Event::DownloadAsked);
        let (receiving, _) = apply(retrying, Event::Progress(0));
        assert_eq!(
            receiving.wire(),
            UpdateState::Downloading {
                download_percent: 0
            }
        );
    }

    #[test]
    fn a_failed_install_installs_the_held_bytes_again() {
        let (phase, work) = apply(install_failed(), Event::InstallAsked);
        assert_eq!(work, Some(Work::Install((), vec![1, 2, 3])));
        assert_eq!(
            phase,
            Phase::Installing {
                version: "1.2.3".into()
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
            download_failed(),
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
            install_failed(),
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
                Phase::CheckFailed {
                    message: "offline".into()
                },
                None
            )
        );
    }

    #[test]
    fn a_failed_check_is_told_from_a_failed_download_and_a_check_leaves_both() {
        let (unread, _) = apply(Phase::<()>::Checking, Event::Checked(Err("offline".into())));
        assert_eq!(
            unread.wire(),
            UpdateState::CheckFailed {
                message: "offline".into()
            }
        );
        let (cut, _) = apply(
            downloading(),
            Event::DownloadEnded((), Err("cut off".into())),
        );
        assert_eq!(
            cut.wire(),
            UpdateState::DownloadFailed {
                version: "1.2.3".into(),
                message: "cut off".into()
            }
        );
        for failed in [unread, cut] {
            assert_eq!(
                apply(failed, Event::CheckAsked),
                (Phase::Checking, Some(Work::Check))
            );
        }
    }

    #[test]
    fn a_check_waits_for_the_one_under_way_and_for_an_update_in_hand() {
        let busy = [
            Phase::Checking,
            downloading(),
            downloaded(),
            Phase::Installing {
                version: "1.2.3".into(),
            },
            install_failed(),
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
        let (phase, _) = apply(downloaded(), Event::DownloadEnded((), Err("late".into())));
        assert_eq!(phase, downloaded());
        let (phase, _) = apply(
            download_failed(),
            Event::InstallFailed((), vec![1, 2, 3], "late".into()),
        );
        assert_eq!(phase, download_failed());
    }
}
