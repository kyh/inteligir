//! What the window may show: the app's own page, and the shell's files framed in it (a PDF's
//! viewer). Any other web page opens in the browser instead, and nothing else loads.

use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::Url;

#[derive(Debug, PartialEq, Eq)]
pub enum Verdict {
    Allow,
    OpenExternally,
    Deny,
}

/// The origin a window is pinned to, compared by its parts. Not `Url::origin`: the url crate
/// answers an opaque origin for any non-special scheme, so `tauri://localhost` would equal nothing,
/// and `tauri://app@evil` would carry a host of `evil` past a prefix compare.
pub fn comparable_origin(url: &Url) -> Option<String> {
    if !url.username().is_empty() || url.password().is_some() {
        return None;
    }
    let host = url.host_str().filter(|host| !host.is_empty())?;
    Some(match url.port_or_known_default() {
        Some(port) => format!("{}://{host}:{port}", url.scheme()),
        None => format!("{}://{host}", url.scheme()),
    })
}

/// WebKit asks about a frame's navigations too: a note's html block previews in a srcdoc frame,
/// which loads `about:srcdoc`, and a blank frame loads `about:blank`. Neither is a page of its own.
fn is_frame_document(target: &Url) -> bool {
    target.scheme() == "about" && matches!(target.path(), "blank" | "srcdoc")
}

pub fn is_web_url(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
}

/// Compared by origin, never by prefix: `tauri://localhost` prefixes `tauri://localhost.evil`.
pub fn classify(target: &Url, pinned: &[&str]) -> Verdict {
    let own = comparable_origin(target).is_some_and(|origin| pinned.contains(&origin.as_str()));
    if own || is_frame_document(target) {
        return Verdict::Allow;
    }
    if is_web_url(target) {
        Verdict::OpenExternally
    } else {
        Verdict::Deny
    }
}

/// A script can navigate the page with no click, and every refused navigation to a web page would
/// open the browser, so a page in a loop would be a loop of launches. WebKit tells Tauri nothing of
/// the click behind a navigation, so the browser opens at most once a second instead.
pub struct ExternalOpens {
    last: Mutex<Option<Instant>>,
}

pub const EXTERNAL_OPEN_SPACING: Duration = Duration::from_secs(1);

impl ExternalOpens {
    pub const fn new() -> Self {
        Self {
            last: Mutex::new(None),
        }
    }

    /// Records the open when it is allowed.
    pub fn allow(&self, now: Instant) -> bool {
        let mut last = self
            .last
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        let allowed =
            last.is_none_or(|at| now.saturating_duration_since(at) >= EXTERNAL_OPEN_SPACING);
        if allowed {
            *last = Some(now);
        }
        allowed
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const PINNED: &[&str] = &["tauri://localhost", "inteligir-files://localhost"];

    fn url(value: &str) -> Url {
        Url::parse(value).unwrap_or_else(|error| panic!("{value}: {error}"))
    }

    #[test]
    fn keeps_the_page_and_its_files_on_any_path() {
        assert_eq!(
            classify(&url("tauri://localhost/library/#/settings"), PINNED),
            Verdict::Allow
        );
        assert_eq!(
            classify(
                &url(&format!("inteligir-files://localhost/{}", "a".repeat(64))),
                PINNED
            ),
            Verdict::Allow
        );
    }

    #[test]
    fn compares_origins_not_prefixes() {
        assert_eq!(
            classify(&url("tauri://localhost.evil/"), PINNED),
            Verdict::Deny
        );
        assert_eq!(classify(&url("tauri://elsewhere/"), PINNED), Verdict::Deny);
        assert_eq!(
            classify(&url("http://localhost/library/"), PINNED),
            Verdict::OpenExternally
        );
    }

    #[test]
    fn a_login_in_the_url_is_no_origin() {
        assert_eq!(comparable_origin(&url("tauri://localhost@evil/")), None);
        assert_eq!(
            classify(&url("tauri://localhost@evil/"), PINNED),
            Verdict::Deny
        );
        assert_eq!(
            classify(&url("https://user@inteligir.com/"), PINNED),
            Verdict::OpenExternally
        );
    }

    #[test]
    fn opens_other_web_pages_in_the_browser_and_refuses_the_rest() {
        assert_eq!(
            classify(&url("https://example.com/"), PINNED),
            Verdict::OpenExternally
        );
        assert_eq!(classify(&url("file:///etc/passwd"), PINNED), Verdict::Deny);
        assert_eq!(classify(&url("javascript:alert(1)"), PINNED), Verdict::Deny);
        assert_eq!(
            classify(&url("blob:tauri://localhost/x"), PINNED),
            Verdict::Deny
        );
    }

    #[test]
    fn lets_frames_load_their_blank_documents() {
        assert_eq!(classify(&url("about:srcdoc"), PINNED), Verdict::Allow);
        assert_eq!(classify(&url("about:blank"), PINNED), Verdict::Allow);
        assert_eq!(classify(&url("about:config"), PINNED), Verdict::Deny);
    }

    #[test]
    fn opens_the_browser_at_most_once_a_second() {
        let opens = ExternalOpens::new();
        let start = Instant::now();
        assert!(opens.allow(start));
        assert!(!opens.allow(start + Duration::from_millis(400)));
        assert!(opens.allow(start + EXTERNAL_OPEN_SPACING));
    }
}
