//! The one window: the library's page the bundle carries (`@repo/workspace`'s build), on the app's
//! own origin, pinned there. It opens no second window and gets no device permission, and closing
//! it hides it: the app lives on in the menu bar, and the page keeps its state for the next Show.
//! A page load that starts (a reload, the crash screen's Reload) lets go of any transaction the
//! page left open in the replica.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Instant;

use tauri::webview::{DownloadEvent, NewWindowResponse, PageLoadEvent, PermissionResponse};
use tauri::{
    AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

use crate::account::Account;
use crate::file_scheme;
use crate::navigation::{self, ExternalOpens, Verdict};

pub const MAIN: &str = "main";
/// The page's document in the bundle: the build mirrors the cloud's paths, so it sits under
/// `library/` as the Worker serves it.
const PAGE: &str = "library/";
/// The origin Tauri serves the bundle on, on macOS and Linux alike, which the cloud answers CORS
/// for (`MAC_APP_ORIGIN` in `@repo/contract/cloud/origin`).
pub const PAGE_ORIGIN: &str = "tauri://localhost";

/// The title the window keeps; the page's own `<title>` never reaches it.
pub fn app_title() -> &'static str {
    if cfg!(debug_assertions) {
        "Inteligir (Dev)"
    } else {
        "Inteligir"
    }
}

fn open_externally(app: &AppHandle, opens: &ExternalOpens, url: &Url) {
    if !opens.allow(Instant::now()) {
        eprintln!("[desktop] refused to open {url}: another opened less than a second ago");
        return;
    }
    if let Err(error) = app.opener().open_url(url.as_str(), None::<&str>) {
        eprintln!("[desktop] could not open {url} in the browser: {error}");
    }
}

/// Closing hides: the app stays in the menu bar, and Show brings the same page back.
fn hide_on_close(window: &WebviewWindow) {
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

pub fn create(app: &AppHandle) -> tauri::Result<()> {
    let opens = Arc::new(ExternalOpens::new());
    let navigating = (app.clone(), Arc::clone(&opens));
    let opening = (app.clone(), opens);
    let shown = AtomicBool::new(false);
    let builder = WebviewWindowBuilder::new(app, MAIN, WebviewUrl::App(PAGE.into()))
        .title(app_title())
        .visible(false)
        .inner_size(1200.0, 800.0)
        .min_inner_size(800.0, 600.0)
        // a file dropped from Finder is the page's (an image into a note), not the shell's
        .disable_drag_drop_handler()
        .zoom_hotkeys_enabled(true)
        .on_navigation(move |url| {
            match navigation::classify(url, &[PAGE_ORIGIN, file_scheme::ORIGIN]) {
                Verdict::Allow => true,
                Verdict::OpenExternally => {
                    open_externally(&navigating.0, &navigating.1, url);
                    false
                }
                Verdict::Deny => false,
            }
        })
        // `window.open` and `target="_blank"`: never a second window, a web page in the browser.
        // WebKit asks only for an open a click made, so no page can open the browser unasked
        .on_new_window(move |url, _features| {
            if navigation::is_web_url(&url) {
                open_externally(&opening.0, &opening.1, &url);
            }
            NewWindowResponse::Deny
        })
        // dictation is the operating system's, so the page needs no microphone, and no camera either
        .on_permission_request(|_, _| PermissionResponse::Deny)
        // a file the page saves (a `download` link: an item's original, an export's zip) lands in
        // the Downloads folder under its own name, numbered rather than over another
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
        .on_page_load(move |window, payload| match payload.event() {
            PageLoadEvent::Started => {
                window.app_handle().state::<Account>().replica().abandon();
            }
            PageLoadEvent::Finished => {
                // the packaged smoke reads this line
                println!("[desktop] window loaded {}", payload.url().path());
                // the first load alone: a later one (a reload) must not bring back a window Close
                // hid, nor take the focus from whatever has it
                if !shown.swap(true, Ordering::Relaxed)
                    && let Err(error) = window.show().and_then(|()| window.set_focus())
                {
                    eprintln!("[desktop] could not show the window: {error}");
                }
            }
        });
    // no title bar: the traffic lights sit over the page's top-left corner, and the page keeps it
    // clear and draws what drags the window (`apps/workspace/src/app/title-bar.ts`)
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(16.0, 12.0));
    hide_on_close(&builder.build()?);
    Ok(())
}

/// Brings the window forward. A second launch can land before setup has made it, and the first
/// page load shows it then.
pub fn show(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(MAIN)
        && let Err(error) = window
            .unminimize()
            .and_then(|()| window.show())
            .and_then(|()| window.set_focus())
    {
        eprintln!("[desktop] could not bring the window forward: {error}");
    }
}
