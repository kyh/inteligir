//! The updater's one state, reduced here and parsed off the bridge by the page against
//! `apps/desktop/src/update-state.ts`, the same union the Electron shell sent. Each status carries
//! exactly what it knows, so no surface reads a version that status cannot have.

use serde::Serialize;

/// What one click does next, with the version it acts on.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "action", rename_all = "kebab-case")]
pub enum UpdateAction {
    Check,
    Download { version: String },
    Install { version: String },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(tag = "status", rename_all = "kebab-case")]
pub enum UpdateState {
    #[serde(rename_all = "camelCase")]
    Disabled {
        checked_at: Option<String>,
        current_version: String,
        /// Why nothing will be checked.
        reason: String,
    },
    #[serde(rename_all = "camelCase")]
    Idle {
        checked_at: Option<String>,
        current_version: String,
    },
    #[serde(rename_all = "camelCase")]
    Checking {
        checked_at: Option<String>,
        current_version: String,
        /// What the button offered before the check: a failure offers it again, and a downloaded
        /// update survives whatever the check answers.
        retry: UpdateAction,
    },
    #[serde(rename_all = "camelCase")]
    UpToDate {
        checked_at: Option<String>,
        current_version: String,
    },
    #[serde(rename_all = "camelCase")]
    Available {
        checked_at: Option<String>,
        current_version: String,
        version: String,
    },
    #[serde(rename_all = "camelCase")]
    Downloading {
        checked_at: Option<String>,
        current_version: String,
        percent: u8,
        version: String,
    },
    #[serde(rename_all = "camelCase")]
    Downloaded {
        checked_at: Option<String>,
        current_version: String,
        version: String,
    },
    #[serde(rename_all = "camelCase")]
    Error {
        checked_at: Option<String>,
        current_version: String,
        message: String,
        retry: UpdateAction,
    },
}

use UpdateState as S;

struct Base {
    checked_at: Option<String>,
    current_version: String,
}

impl UpdateState {
    pub fn initial(current_version: &str, disabled_reason: Option<&str>) -> Self {
        let current_version = current_version.to_owned();
        match disabled_reason {
            None => S::Idle {
                checked_at: None,
                current_version,
            },
            Some(reason) => S::Disabled {
                checked_at: None,
                current_version,
                reason: reason.to_owned(),
            },
        }
    }

    fn base(&self) -> Base {
        let (S::Disabled {
            checked_at,
            current_version,
            ..
        }
        | S::Idle {
            checked_at,
            current_version,
        }
        | S::Checking {
            checked_at,
            current_version,
            ..
        }
        | S::UpToDate {
            checked_at,
            current_version,
        }
        | S::Available {
            checked_at,
            current_version,
            ..
        }
        | S::Downloading {
            checked_at,
            current_version,
            ..
        }
        | S::Downloaded {
            checked_at,
            current_version,
            ..
        }
        | S::Error {
            checked_at,
            current_version,
            ..
        }) = self;
        Base {
            checked_at: checked_at.clone(),
            current_version: current_version.clone(),
        }
    }

    pub fn is_disabled(&self) -> bool {
        matches!(self, S::Disabled { .. })
    }

    /// What one button does next; None while a step is running or nothing can be done.
    pub fn action(&self) -> Option<UpdateAction> {
        match self {
            S::Disabled { .. } | S::Checking { .. } | S::Downloading { .. } => None,
            S::Idle { .. } | S::UpToDate { .. } => Some(UpdateAction::Check),
            S::Available { version, .. } => Some(UpdateAction::Download {
                version: version.clone(),
            }),
            S::Downloaded { version, .. } => Some(UpdateAction::Install {
                version: version.clone(),
            }),
            S::Error { retry, .. } => Some(retry.clone()),
        }
    }

    /// What a failure leaves the button offering: the update already found, else a fresh check.
    fn retry_after(&self) -> UpdateAction {
        match self {
            S::Checking { retry, .. } => retry.clone(),
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
        S::Checking {
            checked_at: Some(checked_at.to_owned()),
            current_version: self.base().current_version,
            retry: self.retry_after(),
        }
    }

    /// A newer version than the one on disk is a fresh download, not the old one.
    pub fn update_available(&self, version: &str, checked_at: &str) -> Self {
        if self.is_disabled() {
            return self.clone();
        }
        let checked_at = Some(checked_at.to_owned());
        let current_version = self.base().current_version;
        let version = version.to_owned();
        if self.kept_download().as_deref() == Some(version.as_str()) {
            S::Downloaded {
                checked_at,
                current_version,
                version,
            }
        } else {
            S::Available {
                checked_at,
                current_version,
                version,
            }
        }
    }

    pub fn no_update(&self, checked_at: &str) -> Self {
        if self.is_disabled() {
            return self.clone();
        }
        let checked_at = Some(checked_at.to_owned());
        let current_version = self.base().current_version;
        match self.kept_download() {
            None => S::UpToDate {
                checked_at,
                current_version,
            },
            Some(version) => S::Downloaded {
                checked_at,
                current_version,
                version,
            },
        }
    }

    pub fn download_started(&self, version: &str) -> Self {
        if self.is_disabled() {
            return self.clone();
        }
        let Base {
            checked_at,
            current_version,
        } = self.base();
        S::Downloading {
            checked_at,
            current_version,
            percent: 0,
            version: version.to_owned(),
        }
    }

    /// The same state when nothing moved, so a caller can skip a broadcast by equality.
    pub fn download_progress(&self, percent: u8) -> Self {
        match self {
            S::Downloading {
                checked_at,
                current_version,
                percent: before,
                version,
            } if *before != percent.min(100) => S::Downloading {
                checked_at: checked_at.clone(),
                current_version: current_version.clone(),
                percent: percent.min(100),
                version: version.clone(),
            },
            _ => self.clone(),
        }
    }

    pub fn download_complete(&self, version: &str) -> Self {
        if self.is_disabled() {
            return self.clone();
        }
        let Base {
            checked_at,
            current_version,
        } = self.base();
        S::Downloaded {
            checked_at,
            current_version,
            version: version.to_owned(),
        }
    }

    /// A failed download keeps its version and a failed install its bytes, so the retry is that step.
    pub fn failure(&self, message: &str, checked_at: Option<&str>) -> Self {
        if self.is_disabled() {
            return self.clone();
        }
        let base = self.base();
        S::Error {
            checked_at: checked_at.map(str::to_owned).or(base.checked_at),
            current_version: base.current_version,
            message: message.to_owned(),
            retry: self.retry_after(),
        }
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
    use super::*;

    const AT: &str = "2026-10-04T10:00:00.000Z";

    fn json(state: &UpdateState) -> String {
        serde_json::to_string(state).unwrap_or_default()
    }

    #[test]
    fn serializes_the_union_the_page_parses() {
        assert_eq!(
            json(&UpdateState::initial("0.7.0", None)),
            r#"{"status":"idle","checkedAt":null,"currentVersion":"0.7.0"}"#
        );
        let checking = UpdateState::initial("0.7.0", None).check_started(AT);
        assert_eq!(
            json(&checking),
            format!(
                r#"{{"status":"checking","checkedAt":"{AT}","currentVersion":"0.7.0","retry":{{"action":"check"}}}}"#
            )
        );
        let downloading = checking
            .update_available("0.8.0", AT)
            .download_started("0.8.0");
        assert_eq!(
            json(&downloading.download_progress(42)),
            format!(
                r#"{{"status":"downloading","checkedAt":"{AT}","currentVersion":"0.7.0","percent":42,"version":"0.8.0"}}"#
            )
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
            checking.update_available("0.8.0", AT),
            UpdateState::Downloaded { .. }
        ));
        assert!(matches!(
            checking.no_update(AT),
            UpdateState::Downloaded { .. }
        ));
        // a newer one is a fresh download
        assert!(matches!(
            checking.update_available("0.9.0", AT),
            UpdateState::Available { .. }
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
