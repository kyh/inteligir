//! The updater's one state, reduced here and parsed off the bridge by the page against
//! `apps/workspace/src/shell/update-state.ts`. Each status carries exactly what it knows, so no
//! surface reads a version that status cannot have.
//!
//! The page reads what its one button does from the status (`updateAction`), so the shell
//! spells no action of its own. The flow: a check that finds an update downloads it at once, in the background; a download
//! that verifies leaves it ready, and a ready update installs when the app quits, so the next
//! launch is the new version, or at once on Restart to Update. A failed check or download is said
//! and offers a check again, which the next periodic check also is, so a download that failed
//! starts over on its own.

use serde::Serialize;

/// The facts every status shares, beside the status itself.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateState {
    pub checked_at: Option<String>,
    pub current_version: String,
    #[serde(flatten)]
    pub status: UpdateStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum UpdateStatus {
    Disabled {
        /// Why nothing will be checked.
        reason: String,
    },
    Idle,
    Checking,
    UpToDate,
    Downloading {
        percent: u8,
        version: String,
    },
    /// Downloaded and verified: it installs when the app quits.
    Ready {
        version: String,
    },
    Error {
        message: String,
    },
}

use UpdateStatus as S;

impl UpdateState {
    pub fn initial(current_version: &str, disabled_reason: Option<&str>) -> Self {
        Self {
            checked_at: None,
            current_version: current_version.to_owned(),
            status: disabled_reason.map_or(S::Idle, |reason| S::Disabled {
                reason: reason.to_owned(),
            }),
        }
    }

    fn with(&self, checked_at: Option<String>, status: UpdateStatus) -> Self {
        Self {
            checked_at,
            current_version: self.current_version.clone(),
            status,
        }
    }

    /// Another status, last checked when this one was.
    fn with_status(&self, status: UpdateStatus) -> Self {
        self.with(self.checked_at.clone(), status)
    }

    /// Whether a check may start: never while one is out, an update is on its way or one is ready.
    pub fn may_check(&self) -> bool {
        matches!(self.status, S::Idle | S::UpToDate | S::Error { .. })
    }

    /// The version a quit installs, when one is ready.
    pub fn installs_on_quit(&self) -> Option<&str> {
        match &self.status {
            S::Ready { version } => Some(version),
            _ => None,
        }
    }

    pub fn check_started(&self, checked_at: &str) -> Self {
        if !self.may_check() {
            return self.clone();
        }
        self.with(Some(checked_at.to_owned()), S::Checking)
    }

    /// A newer version than this one: its download starts at once.
    pub fn update_found(&self, version: &str) -> Self {
        if self.status != S::Checking {
            return self.clone();
        }
        self.with_status(S::Downloading {
            percent: 0,
            version: version.to_owned(),
        })
    }

    pub fn no_update(&self) -> Self {
        if self.status != S::Checking {
            return self.clone();
        }
        self.with_status(S::UpToDate)
    }

    /// The same state when nothing moved, so a caller can skip a broadcast by equality.
    pub fn download_progress(&self, percent: u8) -> Self {
        match &self.status {
            S::Downloading {
                percent: before,
                version,
            } if *before != percent.min(100) => self.with_status(S::Downloading {
                percent: percent.min(100),
                version: version.clone(),
            }),
            _ => self.clone(),
        }
    }

    pub fn download_complete(&self) -> Self {
        match &self.status {
            S::Downloading { version, .. } => self.with_status(S::Ready {
                version: version.clone(),
            }),
            _ => self.clone(),
        }
    }

    /// A failed check, download or install: said, and a check offered again.
    pub fn failure(&self, message: &str) -> Self {
        if matches!(self.status, S::Disabled { .. }) {
            return self.clone();
        }
        let message = if message.is_empty() {
            "The updater gave no reason.".to_owned()
        } else {
            message.to_owned()
        };
        self.with_status(S::Error { message })
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;

    const AT: &str = "2026-10-04T10:00:00.000Z";
    const LATER: &str = "2026-10-04T10:04:00.000Z";

    fn wire(state: &UpdateState) -> Value {
        serde_json::to_value(state).unwrap_or_default()
    }

    fn idle() -> UpdateState {
        UpdateState::initial("0.7.0", None)
    }

    #[test]
    fn serializes_the_union_the_page_parses() {
        assert_eq!(
            wire(&idle()),
            json!({ "status": "idle", "checkedAt": null, "currentVersion": "0.7.0" })
        );
        assert_eq!(
            wire(&UpdateState::initial("0.7.0", Some("no feed"))),
            json!({ "status": "disabled", "checkedAt": null, "currentVersion": "0.7.0", "reason": "no feed" })
        );
        let downloading = idle().check_started(AT).update_found("0.8.0");
        assert_eq!(
            wire(&downloading.download_progress(42)),
            json!({
                "status": "downloading",
                "checkedAt": AT,
                "currentVersion": "0.7.0",
                "percent": 42,
                "version": "0.8.0",
            })
        );
        assert_eq!(
            wire(&downloading.download_complete()),
            json!({ "status": "ready", "checkedAt": AT, "currentVersion": "0.7.0", "version": "0.8.0" })
        );
    }

    #[test]
    fn a_found_update_downloads_and_waits_for_the_quit() {
        let checking = idle().check_started(AT);
        assert!(!checking.may_check());
        let downloading = checking.update_found("0.8.0");
        assert!(matches!(
            downloading.status,
            UpdateStatus::Downloading { percent: 0, .. }
        ));
        // no second check starts while it downloads
        assert!(!downloading.may_check());
        assert_eq!(downloading.check_started(LATER), downloading);
        assert_eq!(downloading.installs_on_quit(), None);
        let ready = downloading.download_progress(60).download_complete();
        assert_eq!(ready.installs_on_quit(), Some("0.8.0"));
        // a ready update stays ready: a check never starts over it
        assert_eq!(ready.check_started(LATER), ready);
    }

    #[test]
    fn a_failed_download_starts_over_on_the_next_check() {
        let failed = idle()
            .check_started(AT)
            .update_found("0.8.0")
            .download_progress(30)
            .failure("the connection dropped");
        assert_eq!(
            failed.status,
            UpdateStatus::Error {
                message: "the connection dropped".to_owned()
            }
        );
        assert_eq!(failed.installs_on_quit(), None);
        assert!(failed.may_check());
        let again = failed.check_started(LATER);
        assert_eq!(again.status, UpdateStatus::Checking);
        assert_eq!(again.checked_at.as_deref(), Some(LATER));
        assert!(matches!(
            again.update_found("0.8.0").status,
            UpdateStatus::Downloading { .. }
        ));
    }

    #[test]
    fn a_check_that_finds_nothing_is_up_to_date() {
        let checked = idle().check_started(AT).no_update();
        assert_eq!(checked.status, UpdateStatus::UpToDate);
        assert!(checked.may_check());
        assert_eq!(
            idle().check_started(AT).failure("").status,
            UpdateStatus::Error {
                message: "The updater gave no reason.".to_owned()
            }
        );
    }

    #[test]
    fn a_disabled_updater_never_moves() {
        let disabled = UpdateState::initial("0.7.0", Some("no feed"));
        assert!(!disabled.may_check());
        assert_eq!(disabled.check_started(AT), disabled);
        assert_eq!(disabled.failure("boom"), disabled);
    }

    #[test]
    fn moves_out_of_order_change_nothing() {
        let idle = idle();
        assert_eq!(idle.update_found("0.8.0"), idle);
        assert_eq!(idle.no_update(), idle);
        assert_eq!(idle.download_complete(), idle);
        let downloading = idle.check_started(AT).update_found("0.8.0");
        assert_eq!(downloading.download_progress(0), downloading);
        assert_eq!(
            downloading.download_progress(250),
            downloading.download_progress(100)
        );
    }
}
