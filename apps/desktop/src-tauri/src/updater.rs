//! The update flow, behind three commands and one event the shell owns. The page is deployed apart
//! from the installed shell, so it speaks this contract rather than the updater plugin's own API,
//! and holds no plugin permission. Nothing moves without the person: the page checks when it
//! loads, and the download and the restart each wait for a click.

use std::sync::{Mutex, MutexGuard, PoisonError};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, Runtime};
use tauri_plugin_updater::{Update, UpdaterExt};

/// The event the page listens for (`apps/workspace/src/shell/desktop-bridge.ts`).
const UPDATE_STATE_EVENT: &str = "update-state";

/// Mirrored by `updateStateSchema` in `apps/workspace/src/shell/desktop-bridge.ts`, which parses it.
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

#[derive(Default)]
struct Session {
    state: UpdateState,
    /// The release a check found, until it is downloaded.
    found: Option<Update>,
    /// The release and its verified bytes, until they are installed.
    downloaded: Option<(Update, Vec<u8>)>,
}

pub struct Updates {
    enabled: bool,
    session: Mutex<Session>,
}

impl Updates {
    /// Off under `tauri dev`, and until the updater is configured: there is no feed to read.
    pub fn new(enabled: bool) -> Self {
        Self {
            enabled,
            session: Mutex::default(),
        }
    }

    pub fn enabled(&self) -> bool {
        self.enabled
    }

    fn lock(&self) -> MutexGuard<'_, Session> {
        self.session.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

fn announce<R: Runtime>(app: &AppHandle<R>, state: &UpdateState) {
    if let Err(error) = app.emit(UPDATE_STATE_EVENT, state) {
        eprintln!("[desktop] could not send the update state: {error}");
    }
}

/// Records the state and tells the page. Never called with the session locked.
fn publish<R: Runtime>(app: &AppHandle<R>, state: UpdateState) -> UpdateState {
    app.state::<Updates>().lock().state = state.clone();
    announce(app, &state);
    state
}

fn failed<R: Runtime>(app: &AppHandle<R>, error: &tauri_plugin_updater::Error) -> UpdateState {
    publish(
        app,
        UpdateState::Error {
            message: error.to_string(),
        },
    )
}

fn percent(received: u64, total: u64) -> u8 {
    if total == 0 {
        return 0;
    }
    u8::try_from(received.saturating_mul(100) / total).map_or(100, |value| value.min(100))
}

pub async fn check<R: Runtime>(app: &AppHandle<R>) -> UpdateState {
    let updates = app.state::<Updates>();
    {
        // tested and claimed under one lock, so a second check never starts beside the first
        let mut session = updates.lock();
        let busy = matches!(
            session.state,
            UpdateState::Checking
                | UpdateState::Downloading { .. }
                | UpdateState::Downloaded { .. }
        );
        if !updates.enabled || busy {
            return session.state.clone();
        }
        session.state = UpdateState::Checking;
    }
    announce(app, &UpdateState::Checking);

    let found = match app.updater() {
        Ok(feed) => feed.check().await,
        Err(error) => Err(error),
    };
    match found {
        Ok(Some(update)) => {
            let version = update.version.clone();
            updates.lock().found = Some(update);
            publish(app, UpdateState::Available { version })
        }
        Ok(None) => publish(app, UpdateState::NotAvailable),
        Err(error) => failed(app, &error),
    }
}

pub async fn download<R: Runtime>(app: &AppHandle<R>) -> UpdateState {
    let updates = app.state::<Updates>();
    let starting = UpdateState::Downloading {
        download_percent: 0,
    };
    let update = {
        let mut session = updates.lock();
        let available = matches!(session.state, UpdateState::Available { .. });
        match session.found.take() {
            Some(update) if available => {
                session.state = starting.clone();
                update
            }
            other => {
                session.found = other;
                return session.state.clone();
            }
        }
    };
    announce(app, &starting);

    let mut received: u64 = 0;
    let mut shown: u8 = 0;
    let bytes = update
        .download(
            |chunk, total| {
                received = received.saturating_add(u64::try_from(chunk).unwrap_or(u64::MAX));
                let Some(total) = total else { return };
                let now = percent(received, total);
                if now != shown {
                    shown = now;
                    publish(
                        app,
                        UpdateState::Downloading {
                            download_percent: now,
                        },
                    );
                }
            },
            || {},
        )
        .await;
    match bytes {
        Ok(bytes) => {
            let version = update.version.clone();
            updates.lock().downloaded = Some((update, bytes));
            publish(app, UpdateState::Downloaded { version })
        }
        Err(error) => failed(app, &error),
    }
}

pub fn install<R: Runtime>(app: AppHandle<R>) -> UpdateState {
    let updates = app.state::<Updates>();
    let (update, bytes, state) = {
        let mut session = updates.lock();
        let downloaded = matches!(session.state, UpdateState::Downloaded { .. });
        match session.downloaded.take() {
            Some((update, bytes)) if downloaded => (update, bytes, session.state.clone()),
            other => {
                session.downloaded = other;
                return session.state.clone();
            }
        }
    };
    // off the command, so its answer reaches the page before the app restarts
    tauri::async_runtime::spawn_blocking(move || match update.install(&bytes) {
        Ok(()) => app.restart(),
        Err(error) => {
            failed(&app, &error);
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
}
