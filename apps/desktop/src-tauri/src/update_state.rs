//! The updater's one state, reduced here and parsed off the bridge by the page against
//! `apps/desktop/src/update-state.ts`. Each status carries exactly what it knows, so no surface
//! reads a version that status cannot have.

use serde::Serialize;

/// What one click does next, with the version it acts on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "action", rename_all = "kebab-case")]
pub enum UpdateAction {
    Check,
    Download { version: String },
    Install { version: String },
}

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
    Checking {
        /// What the button offered before the check: a failure offers it again, and a downloaded
        /// update survives whatever the check answers.
        retry: UpdateAction,
    },
    UpToDate,
    Available {
        version: String,
    },
    Downloading {
        percent: u8,
        version: String,
    },
    Downloaded {
        version: String,
    },
    Error {
        message: String,
        retry: UpdateAction,
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

    /// This version in another status, last checked when `checked_at` says.
    fn next(&self, checked_at: Option<String>, status: UpdateStatus) -> Self {
        Self {
            checked_at,
            current_version: self.current_version.clone(),
            status,
        }
    }

    /// Another status, last checked when this one was.
    fn with_status(&self, status: UpdateStatus) -> Self {
        self.next(self.checked_at.clone(), status)
    }

    pub fn is_disabled(&self) -> bool {
        matches!(self.status, S::Disabled { .. })
    }

    /// What one button does next; None while a step is running or nothing can be done.
    pub fn action(&self) -> Option<UpdateAction> {
        match &self.status {
            S::Disabled { .. } | S::Checking { .. } | S::Downloading { .. } => None,
            S::Idle | S::UpToDate => Some(UpdateAction::Check),
            S::Available { version } => Some(UpdateAction::Download {
                version: version.clone(),
            }),
            S::Downloaded { version } => Some(UpdateAction::Install {
                version: version.clone(),
            }),
            S::Error { retry, .. } => Some(retry.clone()),
        }
    }

    /// What a failure leaves the button offering: the update already found, else a fresh check.
    fn retry_after(&self) -> UpdateAction {
        match &self.status {
            S::Checking { retry } => retry.clone(),
            S::Downloading { version, .. } => UpdateAction::Download {
                version: version.clone(),
            },
            _ => self.action().unwrap_or(UpdateAction::Check),
        }
    }

    fn kept_download(&self) -> Option<String> {
        match self.retry_after() {
            UpdateAction::Install { version } => Some(version),
            UpdateAction::Check | UpdateAction::Download { .. } => None,
        }
    }

    pub fn check_started(&self, checked_at: &str) -> Self {
        if self.is_disabled() {
            return self.clone();
        }
        self.next(
            Some(checked_at.to_owned()),
            S::Checking {
                retry: self.retry_after(),
            },
        )
    }

    /// A newer version than the one on disk is a fresh download, not the old one.
    pub fn update_available(&self, version: &str, checked_at: &str) -> Self {
        if self.is_disabled() {
            return self.clone();
        }
        let version = version.to_owned();
        let status = if self.kept_download().as_deref() == Some(version.as_str()) {
            S::Downloaded { version }
        } else {
            S::Available { version }
        };
        self.next(Some(checked_at.to_owned()), status)
    }

    pub fn no_update(&self, checked_at: &str) -> Self {
        if self.is_disabled() {
            return self.clone();
        }
        let status = match self.kept_download() {
            None => S::UpToDate,
            Some(version) => S::Downloaded { version },
        };
        self.next(Some(checked_at.to_owned()), status)
    }

    pub fn download_started(&self, version: &str) -> Self {
        if self.is_disabled() {
            return self.clone();
        }
        self.with_status(S::Downloading {
            percent: 0,
            version: version.to_owned(),
        })
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

    pub fn download_complete(&self, version: &str) -> Self {
        if self.is_disabled() {
            return self.clone();
        }
        self.with_status(S::Downloaded {
            version: version.to_owned(),
        })
    }

    /// A failed download keeps its version and a failed install its bytes, so the retry is that step.
    pub fn failure(&self, message: &str, checked_at: Option<&str>) -> Self {
        if self.is_disabled() {
            return self.clone();
        }
        self.next(
            checked_at
                .map(str::to_owned)
                .or_else(|| self.checked_at.clone()),
            S::Error {
                message: message.to_owned(),
                retry: self.retry_after(),
            },
        )
    }
}

/// Every surface shows a failure's message as it stands, so the state never holds an empty one.
pub fn failure_reason(message: &str) -> String {
    if message.is_empty() {
        "The updater gave no reason.".to_owned()
    } else {
        message.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::*;

    const AT: &str = "2026-10-04T10:00:00.000Z";

    fn wire(state: &UpdateState) -> Value {
        serde_json::to_value(state).unwrap_or_default()
    }

    #[test]
    fn serializes_the_union_the_page_parses() {
        assert_eq!(
            wire(&UpdateState::initial("0.7.0", None)),
            json!({ "status": "idle", "checkedAt": null, "currentVersion": "0.7.0" })
        );
        assert_eq!(
            wire(&UpdateState::initial("0.7.0", Some("no feed"))),
            json!({ "status": "disabled", "checkedAt": null, "currentVersion": "0.7.0", "reason": "no feed" })
        );
        let checking = UpdateState::initial("0.7.0", None).check_started(AT);
        assert_eq!(
            wire(&checking),
            json!({
                "status": "checking",
                "checkedAt": AT,
                "currentVersion": "0.7.0",
                "retry": { "action": "check" },
            })
        );
        let downloading = checking
            .update_available("0.8.0", AT)
            .download_started("0.8.0");
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
            wire(&downloading.failure("network", None)),
            json!({
                "status": "error",
                "checkedAt": AT,
                "currentVersion": "0.7.0",
                "message": "network",
                "retry": { "action": "download", "version": "0.8.0" },
            })
        );
    }

    #[test]
    fn a_disabled_updater_never_moves() {
        let disabled = UpdateState::initial("0.7.0", Some("no feed"));
        assert_eq!(disabled.check_started(AT), disabled);
        assert_eq!(disabled.failure("boom", Some(AT)), disabled);
        assert_eq!(disabled.action(), None);
    }

    #[test]
    fn a_downloaded_update_survives_a_check_that_finds_it_again() {
        let downloaded = UpdateState::initial("0.7.0", None)
            .update_available("0.8.0", AT)
            .download_complete("0.8.0");
        let checking = downloaded.check_started(AT);
        assert!(matches!(
            checking.update_available("0.8.0", AT).status,
            UpdateStatus::Downloaded { .. }
        ));
        assert!(matches!(
            checking.no_update(AT).status,
            UpdateStatus::Downloaded { .. }
        ));
        // a newer one is a fresh download
        assert!(matches!(
            checking.update_available("0.9.0", AT).status,
            UpdateStatus::Available { .. }
        ));
    }

    #[test]
    fn a_failure_offers_the_step_that_failed_again() {
        let downloading = UpdateState::initial("0.7.0", None)
            .update_available("0.8.0", AT)
            .download_started("0.8.0");
        assert_eq!(
            downloading.failure("network", None).action(),
            Some(UpdateAction::Download {
                version: "0.8.0".to_owned()
            })
        );
        let checking = UpdateState::initial("0.7.0", None).check_started(AT);
        assert_eq!(
            checking.failure("dns", Some(AT)).action(),
            Some(UpdateAction::Check)
        );
    }

    #[test]
    fn progress_that_moves_nothing_is_the_same_state() {
        let downloading = UpdateState::initial("0.7.0", None)
            .update_available("0.8.0", AT)
            .download_started("0.8.0");
        assert_eq!(downloading.download_progress(0), downloading);
        assert_eq!(
            downloading.download_progress(250),
            downloading.download_progress(100)
        );
    }
}
