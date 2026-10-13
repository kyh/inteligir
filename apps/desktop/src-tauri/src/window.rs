//! The two windows. The app window is a page of the server's own, signed in by a one-time handoff
//! and pinned to the server's origin; the first-run window is the bundle's own page, before any
//! server exists. Each opens no second window and gets no device permission, and closing one hides
//! it: the app lives on in the menu bar, and the page keeps its state for the next Show.

use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, PoisonError};
use std::time::Instant;

use sha2::{Digest, Sha256};
use tauri::ipc::CapabilityBuilder;
use tauri::utils::acl::capability::Capability;
use tauri::webview::{NewWindowResponse, PageLoadEvent, PermissionResponse};
use tauri::{
    AppHandle, Manager, Url, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent, Wry,
};
use tauri_plugin_opener::OpenerExt;

use crate::navigation::{self, ExternalOpens, Verdict};
use crate::server_log::ServerLog;

pub const FIRST_RUN: &str = "first-run";
pub const FIRST_RUN_PAGE: &str = "first-run.html";
/// Where the app window lands after a first run: the steps between the vault and the notes.
pub const WELCOME_PATH: &str = "/welcome";

/// The title every window keeps; the page's own `<title>` never reaches it.
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

/// The pin, the popup policy, the permission policy and the show-once-loaded every window shares.
/// `noted` hears the line each load prints, for a window whose vault keeps a log.
fn pinned<'a>(
    builder: WebviewWindowBuilder<'a, Wry, AppHandle>,
    app: &AppHandle,
    pinned_origin: String,
    page: &'static str,
    noted: impl Fn(&str) + Send + Sync + 'static,
) -> WebviewWindowBuilder<'a, Wry, AppHandle> {
    let opens = Arc::new(ExternalOpens::new());
    let navigating = (app.clone(), Arc::clone(&opens));
    let opening = (app.clone(), opens);
    let shown = AtomicBool::new(false);
    builder
        .title(app_title())
        .visible(false)
        // a file dropped from Finder is the page's (an image into a note), not the shell's
        .disable_drag_drop_handler()
        .zoom_hotkeys_enabled(true)
        .on_navigation(move |url| match navigation::classify(url, &pinned_origin) {
            Verdict::Allow => true,
            Verdict::OpenExternally => {
                open_externally(&navigating.0, &navigating.1, url);
                false
            }
            Verdict::Deny => false,
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
        .on_page_load(move |window, payload| {
            if payload.event() == PageLoadEvent::Finished {
                // the packaged smoke reads this line, and the scenario suite the log's copy. the
                // path alone: a query can still carry a handoff's one-time nonce
                let line = format!("[desktop] {page} loaded {}", payload.url().path());
                println!("{line}");
                noted(&line);
                // the first load alone: a later one (a reload) must not bring back a window Close
                // hid, nor take the focus from whatever has it
                if !shown.swap(true, Ordering::Relaxed)
                    && let Err(error) = window.show().and_then(|()| window.set_focus())
                {
                    eprintln!("[desktop] could not show the window: {error}");
                }
            }
        })
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

/// The page prefs (localStorage) are the origin's, and every vault's server answers on one port,
/// so each data dir gets a data store of its own.
pub fn data_store_id(data_dir: &str) -> [u8; 16] {
    let digest = Sha256::digest(data_dir.as_bytes());
    let mut id = [0_u8; 16];
    id.copy_from_slice(&digest[..16]);
    id
}

pub struct AppWindow<'a> {
    pub label: &'a str,
    /// The server's origin, which the window is pinned to.
    pub origin: &'a str,
    /// The one-time link the page signs in with.
    pub handoff_url: &'a str,
    /// Where the page lands once signed in.
    pub path: &'a str,
    pub data_dir: &'a str,
    /// Where WebKitGTK keeps a vault's store, for the platforms with no data-store identifier.
    pub webview_dir: std::path::PathBuf,
    /// The vault's server log, where the window notes that it loaded.
    pub log: Arc<Mutex<ServerLog>>,
}

/// The app window's permissions, one list for the build and the runtime grant.
const APP_WINDOW_CAPABILITY: &str = include_str!("../capabilities/app-window.json");

/// The app window's permissions are granted for this window and the server's exact origin alone.
fn grant_app_window(app: &AppHandle, label: &str, origin: &str) -> tauri::Result<()> {
    let listed: Capability = serde_json::from_str(APP_WINDOW_CAPABILITY)?;
    let capability = listed.permissions.iter().fold(
        CapabilityBuilder::new(format!("app-window-{label}"))
            .window(label)
            .local(false)
            .remote(origin.to_owned()),
        |capability, permission| capability.permission(permission.identifier().get()),
    );
    app.add_capability(capability)
}

pub fn create_app_window(app: &AppHandle, spec: &AppWindow<'_>) -> tauri::Result<WebviewWindow> {
    let mut url = Url::parse(spec.handoff_url).map_err(|_| {
        tauri::Error::InvalidWebviewUrl("the server announced a handoff that is not a URL")
    })?;
    url.set_path(spec.path);
    grant_app_window(app, spec.label, spec.origin)?;
    let log = Arc::clone(&spec.log);
    let builder = pinned(
        WebviewWindowBuilder::new(app, spec.label, WebviewUrl::External(url)),
        app,
        spec.origin.to_owned(),
        "window",
        move |line| {
            log.lock()
                .unwrap_or_else(PoisonError::into_inner)
                .append(line);
        },
    )
    .inner_size(1200.0, 800.0)
    .min_inner_size(800.0, 600.0)
    .data_store_identifier(data_store_id(spec.data_dir))
    .data_directory(spec.webview_dir.clone());
    // no title bar: the traffic lights sit over the page's top-left corner, which the page reserves
    // (`title-bar.ts`), and its drag strip is a `data-tauri-drag-region`
    #[cfg(target_os = "macos")]
    let builder = builder
        .title_bar_style(tauri::TitleBarStyle::Overlay)
        .hidden_title(true)
        .traffic_light_position(tauri::LogicalPosition::new(16.0, 12.0));
    let window = builder.build()?;
    hide_on_close(&window);
    Ok(window)
}

/// The first run's page is the bundle's own: under `tauri dev` the page's dev server, else
/// Tauri's embedded assets.
fn first_run_origin(app: &AppHandle) -> String {
    let dev_url = app
        .config()
        .build
        .dev_url
        .clone()
        .filter(|_| tauri::is_dev());
    let url = dev_url.or_else(|| Url::parse("tauri://localhost").ok());
    url.as_ref()
        .and_then(navigation::comparable_origin)
        .unwrap_or_default()
}

pub fn create_first_run_window(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let window = pinned(
        WebviewWindowBuilder::new(app, FIRST_RUN, WebviewUrl::App(FIRST_RUN_PAGE.into())),
        app,
        first_run_origin(app),
        "first run",
        |_| {},
    )
    .inner_size(720.0, 620.0)
    .min_inner_size(560.0, 520.0)
    // the default store: every vault's window has a store of its own, so nothing the first run
    // keeps reaches one
    .build()?;
    hide_on_close(&window);
    Ok(window)
}

/// Brings a window forward; false when there is none.
pub fn bring_forward(app: &AppHandle, label: &str) -> bool {
    let Some(window) = app.get_webview_window(label) else {
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

#[cfg(test)]
mod tests {
    use tauri::utils::acl::capability::PermissionEntry;

    use super::*;

    #[test]
    fn the_app_window_s_capability_lists_bare_permissions() -> serde_json::Result<()> {
        let listed: Capability = serde_json::from_str(APP_WINDOW_CAPABILITY)?;
        // a scope would not survive the runtime grant, which takes each permission's name alone
        assert!(
            listed
                .permissions
                .iter()
                .all(|permission| matches!(permission, PermissionEntry::PermissionRef(_)))
        );
        Ok(())
    }

    #[test]
    fn a_data_dir_names_one_store() {
        assert_eq!(data_store_id("/a"), data_store_id("/a"));
        assert_ne!(data_store_id("/a"), data_store_id("/b"));
    }
}
