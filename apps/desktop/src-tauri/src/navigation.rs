//! What the window may show: the site's own pages, its blobs (a file the page saves) and the blank
//! documents of a frame; any other web page opens in the browser instead, and nothing else loads.

use tauri::Url;

#[derive(Debug, PartialEq, Eq)]
pub enum Verdict {
    Allow,
    OpenExternally,
    Deny,
}

/// WebKit asks about a frame's navigations too: a note's html block previews in a srcdoc frame,
/// which loads `about:srcdoc`, and a blank frame loads `about:blank`. Neither is a page of its own.
fn is_frame_document(target: &Url) -> bool {
    target.scheme() == "about" && matches!(target.path(), "blank" | "srcdoc")
}

pub fn is_web_url(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
}

/// Compared by origin, never by prefix: `http://localhost:5174` prefixes `http://localhost:51740`.
/// A blob's origin is the page's that made it.
pub fn classify(target: &Url, app: &Url) -> Verdict {
    let origin = target.origin();
    // an opaque origin (a non-web scheme) never equals the app's
    if (origin.is_tuple() && origin == app.origin()) || is_frame_document(target) {
        return Verdict::Allow;
    }
    if is_web_url(target) {
        Verdict::OpenExternally
    } else {
        Verdict::Deny
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn url(value: &str) -> Url {
        Url::parse(value).unwrap_or_else(|error| panic!("{value}: {error}"))
    }

    fn site() -> Url {
        url("https://inteligir.com/library")
    }

    #[test]
    fn keeps_every_page_of_the_site() {
        assert_eq!(
            classify(&url("https://inteligir.com/library/settings"), &site()),
            Verdict::Allow
        );
        assert_eq!(
            classify(
                &url("https://inteligir.com/app/sign-in?next=%2Flibrary"),
                &site()
            ),
            Verdict::Allow
        );
    }

    #[test]
    fn compares_origins_not_prefixes() {
        let local = url("http://localhost:5174/library");
        assert_eq!(
            classify(&url("http://localhost:51740/library"), &local),
            Verdict::OpenExternally
        );
        assert_eq!(
            classify(&url("https://localhost:5174/library"), &local),
            Verdict::OpenExternally
        );
        assert_eq!(
            classify(&url("https://inteligir.com.evil/library"), &site()),
            Verdict::OpenExternally
        );
    }

    #[test]
    fn lets_a_blob_the_page_made_load_as_its_save_and_no_other() {
        assert_eq!(
            classify(&url("blob:https://inteligir.com/065f281d-fbc4"), &site()),
            Verdict::Allow
        );
        assert_eq!(
            classify(&url("blob:https://example.com/065f281d-fbc4"), &site()),
            Verdict::Deny
        );
        assert_eq!(
            classify(&url("blob:null/065f281d-fbc4"), &site()),
            Verdict::Deny
        );
    }

    #[test]
    fn lets_frames_load_their_blank_documents() {
        assert_eq!(classify(&url("about:srcdoc"), &site()), Verdict::Allow);
        assert_eq!(classify(&url("about:blank"), &site()), Verdict::Allow);
        assert_eq!(classify(&url("about:config"), &site()), Verdict::Deny);
    }

    #[test]
    fn opens_other_web_pages_in_the_browser_and_refuses_the_rest() {
        assert_eq!(
            classify(&url("https://example.com/"), &site()),
            Verdict::OpenExternally
        );
        assert_eq!(classify(&url("file:///etc/passwd"), &site()), Verdict::Deny);
        assert_eq!(
            classify(&url("javascript:alert(1)"), &site()),
            Verdict::Deny
        );
        assert_eq!(
            classify(&url("mailto:a@example.com"), &site()),
            Verdict::Deny
        );
        assert_eq!(classify(&url("tauri://localhost/"), &site()), Verdict::Deny);
    }
}
