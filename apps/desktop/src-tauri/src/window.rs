//! The one window, on the library's page the site serves: `devUrl` under `tauri dev`,
//! `frontendDist` in a build. It opens no second window and gets no device permission, and closing
//! it hides it, so the page keeps its state for the Dock's next click.

use tauri::utils::config::FrontendDist;
use tauri::webview::{DownloadEvent, NewWindowResponse, PageLoadEvent, PermissionResponse};
use tauri::{
    AppHandle, Config, Manager, Runtime, Url, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

use crate::navigation::{self, Verdict};

pub const MAIN: &str = "main";

/// Names a Worker on this machine to load in place of the configured site.
const LOCAL_SITE_VAR: &str = "INTELIGIR_CLOUD_ORIGIN";

/// An http origin on this machine, spelled as the origin it parses to: no path, query, fragment,
/// userinfo or trailing slash.
fn loopback_origin(value: &str) -> Option<Url> {
    let url = Url::parse(value).ok()?;
    let loopback = url.scheme() == "http"
        && matches!(url.host_str(), Some("localhost" | "127.0.0.1" | "[::1]"))
        && url.origin().ascii_serialization() == value;
    loopback.then_some(url)
}

fn on_origin(url: &Url, origin: &Url) -> Url {
    let mut moved = origin.clone();
    moved.set_path(url.path());
    moved
}

/// The window on a local Worker, at the configured path: the packaged smoke's, and a debug window's
/// beside a Worker on another port. It names this machine or the app refuses to start, so no build
/// loads a site its environment chose from elsewhere, and none silently falls back to production.
pub fn follow_local_site(config: &mut Config) -> Result<(), String> {
    let Ok(value) = std::env::var(LOCAL_SITE_VAR) else {
        return Ok(());
    };
    let Some(origin) = loopback_origin(&value) else {
        return Err(format!(
            "{LOCAL_SITE_VAR} is {value:?}, not an http origin on this machine"
        ));
    };
    let build = &mut config.build;
    build.dev_url = build.dev_url.as_ref().map(|url| on_origin(url, &origin));
    if let Some(FrontendDist::Url(url)) = &mut build.frontend_dist {
        *url = on_origin(url, &origin);
    }
    Ok(())
}

/// The URL `WebviewUrl::default()` resolves to, read the same way Tauri reads it.
fn app_url(config: &Config) -> Option<Url> {
    if tauri::is_dev() {
        config.build.dev_url.clone()
    } else {
        match &config.build.frontend_dist {
            Some(FrontendDist::Url(url)) => Some(url.clone()),
            _ => None,
        }
    }
}

fn open_externally<R: Runtime>(app: &AppHandle<R>, url: &Url) {
    if let Err(error) = app.opener().open_url(url.as_str(), None::<&str>) {
        eprintln!("[desktop] could not open {url} in the browser: {error}");
    }
}

fn hide_on_close<R: Runtime>(window: &WebviewWindow<R>) {
    let hiding = window.clone();
    window.on_window_event(move |event| {
        if let WindowEvent::CloseRequested { api, .. } = event {
            api.prevent_close();
            if let Err(error) = hiding.hide() {
                eprintln!("[desktop] could not hide the window: {error}");
            }
        }
    });
}

/// Built from its entry in tauri.conf.json (`create: false`), since the pin needs closures.
pub fn create_main<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let config = app.config();
    let Some(window) = config
        .app
        .windows
        .iter()
        .find(|window| window.label == MAIN)
    else {
        return Err(tauri::Error::WindowNotFound);
    };
    let Some(app_url) = app_url(config) else {
        return Err(tauri::Error::InvalidWebviewUrl(
            "the site's URL is not set: devUrl, or a URL as frontendDist",
        ));
    };
    let pinned = app_url.clone();
    let navigating = app.clone();
    let opening = app.clone();

    let builder = WebviewWindowBuilder::from_config(app, window)?
        .on_navigation(move |url| match navigation::classify(url, &pinned) {
            Verdict::Allow => true,
            Verdict::OpenExternally => {
                open_externally(&navigating, url);
                false
            }
            Verdict::Deny => false,
        })
        // `window.open` and `target="_blank"`: never a second window, a web page in the browser
        .on_new_window(move |url, _features| {
            if navigation::is_web_url(&url) {
                open_externally(&opening, &url);
            }
            NewWindowResponse::Deny
        })
        // dictation is the operating system's, so the page needs no microphone, and no camera either
        .on_permission_request(|_, _| PermissionResponse::Deny)
        // a file the page saves (a `download` link to a blob of its own) lands in Downloads; with no
        // handler, wry cancels the download
        .on_download(|_, event| {
            if let DownloadEvent::Finished {
                success: false,
                url,
                ..
            } = event
            {
                eprintln!("[desktop] a download from {} did not finish", url.scheme());
            }
            true
        })
        .on_page_load(|_, payload| {
            if let PageLoadEvent::Finished = payload.event() {
                // the packaged smoke reads this line; the query stays out of the log
                let url = payload.url();
                println!(
                    "[desktop] window loaded {}{}",
                    url.origin().ascii_serialization(),
                    url.path()
                );
            }
        });
    let builder = if cfg!(debug_assertions) {
        builder.title("Inteligir (Dev)")
    } else {
        builder
    };
    hide_on_close(&builder.build()?);
    Ok(())
}

/// Brings the window forward; false when there is none.
#[cfg(target_os = "macos")]
pub fn show_main<R: Runtime>(app: &AppHandle<R>) -> bool {
    let Some(window) = app.get_webview_window(MAIN) else {
        return false;
    };
    let shown = window
        .unminimize()
        .and_then(|()| window.show())
        .and_then(|()| window.set_focus());
    if let Err(error) = shown {
        eprintln!("[desktop] could not bring the window forward: {error}");
    }
    true
}

/// View › Reload: the page the window shows, or the site's own once a launch with no connection
/// left it on none.
pub fn reload_main<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window(MAIN) else {
        return;
    };
    let Some(app_url) = app_url(app.config()) else {
        return;
    };
    let shown = window.url().ok();
    let reloaded = match shown {
        Some(url) if url.origin() == app_url.origin() => window.reload(),
        _ => window.navigate(app_url),
    };
    if let Err(error) = reloaded {
        eprintln!("[desktop] could not reload the window: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_local_site_is_on_this_machine_alone() {
        assert!(loopback_origin("http://127.0.0.1:48213").is_some());
        assert!(loopback_origin("http://localhost:5174").is_some());
        assert!(loopback_origin("http://[::1]:5174").is_some());
        assert!(loopback_origin("https://inteligir.com").is_none());
        assert!(loopback_origin("http://127.0.0.1:48213/").is_none());
        assert!(loopback_origin("http://evil.example:80").is_none());
        assert!(loopback_origin("http://localhost:5174/v1").is_none());
        assert!(loopback_origin("http://localhost:5174#x").is_none());
        assert!(loopback_origin("http://u:p@localhost:5174").is_none());
        assert!(loopback_origin("http://localhost:5174?x=1").is_none());
    }

    #[test]
    fn a_local_site_keeps_the_configured_path() {
        let origin = loopback_origin("http://127.0.0.1:48213").unwrap_or_else(|| panic!("origin"));
        let site =
            Url::parse("https://inteligir.com/library").unwrap_or_else(|error| panic!("{error}"));
        assert_eq!(
            on_origin(&site, &origin).as_str(),
            "http://127.0.0.1:48213/library"
        );
    }
}
