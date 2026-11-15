//! The one window, on the library's page the site serves: `devUrl` under `tauri dev`,
//! `frontendDist` in a build. It opens no second window and gets no device permission, and closing
//! it hides it, so the page keeps its state for the Dock's next click.

use tauri::utils::config::FrontendDist;
use tauri::webview::{DownloadEvent, NewWindowResponse, PermissionResponse};
use tauri::{
    AppHandle, Config, Manager, Runtime, Url, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

use crate::navigation::{self, Verdict};

pub const MAIN: &str = "main";

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
        });
    let builder = if cfg!(debug_assertions) {
        builder.title("Inteligir (Dev)")
    } else {
        builder
    };
    hide_on_close(&builder.build()?);
    Ok(())
}

/// Brings the window forward, when there is one.
#[cfg(target_os = "macos")]
pub fn show_main<R: Runtime>(app: &AppHandle<R>) {
    let Some(window) = app.get_webview_window(MAIN) else {
        return;
    };
    let shown = window
        .unminimize()
        .and_then(|()| window.show())
        .and_then(|()| window.set_focus());
    if let Err(error) = shown {
        eprintln!("[desktop] could not bring the window forward: {error}");
    }
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
