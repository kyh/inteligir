//! The ways out that wait for the page: Quit (the app menu's ⌘Q, the menu-bar icon's, a SIGTERM)
//! and Restart to Update (the app menu's and Settings'). The open item's last edit sits in the
//! page's memory until its pause writes it to the outbox (`@repo/editor`'s item session), so before
//! the shell exits it asks the page to write what it holds (the `leaving` event) and waits for the
//! page to say it has (`leaving_ready`), at most `LEAVE_WAIT`: a page that never answers (gone,
//! still loading) costs that wait alone. A quit macOS sends on its own (the Dock's Quit, a log out)
//! ends the app with no word to the page, so what its last pause had not written stays unwritten.

use std::sync::mpsc::{self, Sender};
use std::sync::{Mutex, PoisonError};
use std::time::Duration;

use tauri::{AppHandle, Emitter, Manager};

use crate::update_state::UpdateState;
use crate::updater;

pub const LEAVING_EVENT: &str = "leaving";
/// Long enough for the page to write an item's edit through the bridge, short enough that a page
/// that will never answer keeps the person waiting no more than a moment.
pub const LEAVE_WAIT: Duration = Duration::from_secs(3);

/// The leave waiting on the page's answer, if one is.
pub struct Leaving {
    waiting: Mutex<Option<Sender<()>>>,
}

impl Leaving {
    pub const fn new() -> Self {
        Self {
            waiting: Mutex::new(None),
        }
    }

    /// Asks with `ask` and waits for the answer or `wait`, whichever comes first; false when
    /// another leave is already waiting, which this one then leaves to finish.
    fn ask_and_wait(&self, ask: impl FnOnce(), wait: Duration) -> bool {
        let (answer, answered) = mpsc::channel();
        {
            let mut waiting = self.waiting.lock().unwrap_or_else(PoisonError::into_inner);
            if waiting.is_some() {
                return false;
            }
            *waiting = Some(answer);
        }
        ask();
        if answered.recv_timeout(wait).is_err() {
            eprintln!("[desktop] the page did not answer within {wait:?}: leaving without it");
        }
        self.waiting
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take();
        true
    }

    /// The page wrote what it held.
    pub fn answered(&self) {
        if let Some(answer) = self
            .waiting
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .take()
        {
            let _ = answer.send(());
        }
    }
}

/// Asks the page to write what it holds and waits for it; a blocking call, so the caller's thread
/// is never the main one, which carries the page's answer.
fn page_written(app: &AppHandle) -> bool {
    app.state::<Leaving>().ask_and_wait(
        || {
            if let Err(error) = app.emit(LEAVING_EVENT, ()) {
                eprintln!("[desktop] could not ask the page to write what it holds: {error}");
            }
        },
        LEAVE_WAIT,
    )
}

/// Quit: once the page has written what it holds, the app exits, installing a ready update.
pub fn quit(app: &AppHandle) {
    if page_written(app) {
        app.exit(0);
    }
}

/// Restart to Update: once the page has written what it holds, the ready update installs and the
/// app relaunches; the state answers when nothing was ready or the install failed.
pub fn restart_to_update(app: &AppHandle) -> UpdateState {
    page_written(app);
    updater::restart_to_update(app)
}

#[cfg(test)]
mod tests {
    use std::sync::Arc;
    use std::time::Instant;

    use super::*;

    #[test]
    fn waits_for_the_page_s_answer() {
        let leaving = Arc::new(Leaving::new());
        let answering = Arc::clone(&leaving);
        let started = Instant::now();
        let left = leaving.ask_and_wait(
            move || {
                std::thread::spawn(move || answering.answered());
            },
            Duration::from_secs(30),
        );
        assert!(left);
        assert!(started.elapsed() < Duration::from_secs(30));
    }

    #[test]
    fn leaves_without_a_page_that_never_answers() {
        let leaving = Leaving::new();
        assert!(leaving.ask_and_wait(|| {}, Duration::from_millis(20)));
        // the wait is over, so a later leave asks again
        assert!(leaving.ask_and_wait(|| {}, Duration::from_millis(20)));
    }

    #[test]
    fn a_second_quit_leaves_the_first_to_finish() {
        let leaving = Arc::new(Leaving::new());
        let again = Arc::clone(&leaving);
        let second = Arc::new(Mutex::new(None));
        let seen = Arc::clone(&second);
        let left = leaving.ask_and_wait(
            move || {
                let asked = again.ask_and_wait(|| {}, Duration::from_millis(20));
                *seen.lock().unwrap_or_else(PoisonError::into_inner) = Some(asked);
                again.answered();
            },
            Duration::from_secs(30),
        );
        assert!(left);
        assert_eq!(
            *second.lock().unwrap_or_else(PoisonError::into_inner),
            Some(false)
        );
    }

    #[test]
    fn an_answer_no_leave_waits_for_is_nothing() {
        Leaving::new().answered();
    }
}
