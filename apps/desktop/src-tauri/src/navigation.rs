//! What a window may show. A window keeps its own origin: the app window the server's, the first
//! run's the bundle's. Any other web page opens in the browser instead, and nothing else loads.

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

/// Compared by origin, never by prefix: `http://127.0.0.1:4664` prefixes `http://127.0.0.1:46640`.
pub fn classify(target: &Url, pinned: &str) -> Verdict {
    if comparable_origin(target).as_deref() == Some(pinned) || is_frame_document(target) {
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

    fn url(value: &str) -> Url {
        Url::parse(value).unwrap_or_else(|error| panic!("{value}: {error}"))
    }

    #[test]
    fn keeps_the_pinned_origin_on_any_path() {
        assert_eq!(
            classify(
                &url("http://127.0.0.1:4664/settings?tab=1"),
                "http://127.0.0.1:4664"
            ),
            Verdict::Allow
        );
        assert_eq!(
            classify(
                &url("tauri://localhost/first-run.html"),
                "tauri://localhost"
            ),
            Verdict::Allow
        );
    }

    #[test]
    fn compares_origins_not_prefixes() {
        let pinned = "http://127.0.0.1:4664";
        assert_eq!(
            classify(&url("http://127.0.0.1:46640/"), pinned),
            Verdict::OpenExternally
        );
        assert_eq!(
            classify(&url("http://localhost:4664/"), pinned),
            Verdict::OpenExternally
        );
        assert_eq!(
            classify(&url("https://127.0.0.1:4664/"), pinned),
            Verdict::OpenExternally
        );
    }

    #[test]
    fn a_login_in_the_url_is_no_origin() {
        assert_eq!(comparable_origin(&url("tauri://localhost@evil/")), None);
        assert_eq!(
            classify(&url("tauri://localhost@evil/"), "tauri://localhost"),
            Verdict::Deny
        );
        assert_eq!(
            classify(&url("http://user@127.0.0.1:4664/"), "http://127.0.0.1:4664"),
            Verdict::OpenExternally
        );
    }

    #[test]
    fn opens_other_web_pages_in_the_browser_and_refuses_the_rest() {
        let pinned = "http://127.0.0.1:4664";
        assert_eq!(
            classify(&url("https://example.com/"), pinned),
            Verdict::OpenExternally
        );
        assert_eq!(classify(&url("file:///etc/passwd"), pinned), Verdict::Deny);
        assert_eq!(classify(&url("javascript:alert(1)"), pinned), Verdict::Deny);
        assert_eq!(classify(&url("tauri://localhost/"), pinned), Verdict::Deny);
    }

    #[test]
    fn lets_frames_load_their_blank_documents() {
        let pinned = "http://127.0.0.1:4664";
        assert_eq!(classify(&url("about:srcdoc"), pinned), Verdict::Allow);
        assert_eq!(classify(&url("about:blank"), pinned), Verdict::Allow);
        assert_eq!(classify(&url("about:config"), pinned), Verdict::Deny);
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
