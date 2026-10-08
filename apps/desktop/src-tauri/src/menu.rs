//! The macOS menu bar and the menu-bar icon's menu, rebuilt whenever what they offer moves (the
//! server comes up). Both offer the data folder only once the server is up. A menu click is the
//! main thread's, so anything that waits (the CLI, a dialog) runs on a thread of its own.

use tauri::menu::{
    AboutMetadata, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu, SubmenuBuilder,
};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use crate::shell::{self, Shell};
use crate::{tray, updater};

const CHECK_FOR_UPDATES: &str = "check-for-updates";
pub const OPEN_DATA_FOLDER: &str = "open-data-folder";
const OPEN_IN_BROWSER: &str = "open-in-browser";
pub const SHOW_APP: &str = "show-app";
pub const HIDE_APP: &str = "hide-app";

fn item<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    text: &str,
    enabled: bool,
    accelerator: Option<&str>,
) -> tauri::Result<MenuItem<R>> {
    MenuItem::with_id(app, id, text, enabled, accelerator)
}

fn app_menu<R: Runtime>(app: &AppHandle<R>, server_open: bool) -> tauri::Result<Submenu<R>> {
    let info = app.package_info();
    let about = AboutMetadata {
        name: Some(crate::window::app_title().to_owned()),
        version: Some(info.version.to_string()),
        ..AboutMetadata::default()
    };
    SubmenuBuilder::new(app, crate::window::app_title())
        .item(&PredefinedMenuItem::about(app, None, Some(about))?)
        .item(&item(
            app,
            CHECK_FOR_UPDATES,
            "Check for Updates…",
            true,
            None,
        )?)
        .separator()
        .item(&item(
            app,
            OPEN_DATA_FOLDER,
            "Open Data Folder",
            server_open,
            None,
        )?)
        .separator()
        .item(&PredefinedMenuItem::services(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::hide(app, None)?)
        .item(&PredefinedMenuItem::hide_others(app, None)?)
        .item(&PredefinedMenuItem::show_all(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::quit(app, None)?)
        .build()
}

fn file_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    SubmenuBuilder::new(app, "File")
        .item(&PredefinedMenuItem::close_window(app, None)?)
        .build()
}

/// Named "Edit", so macOS adds Start Dictation… and Emoji & Symbols to it: dictation is the
/// operating system's.
fn edit_menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Submenu<R>> {
    SubmenuBuilder::new(app, "Edit")
        .item(&PredefinedMenuItem::undo(app, None)?)
        .item(&PredefinedMenuItem::redo(app, None)?)
        .separator()
        .item(&PredefinedMenuItem::cut(app, None)?)
        .item(&PredefinedMenuItem::copy(app, None)?)
        .item(&PredefinedMenuItem::paste(app, None)?)
        .item(&PredefinedMenuItem::select_all(app, None)?)
        .build()
}

fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let server_open = app.state::<Shell>().target().is_some();
    let view = SubmenuBuilder::new(app, "View")
        .item(&PredefinedMenuItem::fullscreen(app, None)?)
        .build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .item(&PredefinedMenuItem::minimize(app, None)?)
        .item(&PredefinedMenuItem::maximize(app, None)?)
        .build()?;
    let help = SubmenuBuilder::new(app, "Help")
        .item(&item(
            app,
            OPEN_IN_BROWSER,
            "Open in Browser",
            server_open,
            None,
        )?)
        .build()?;
    Menu::with_items(
        app,
        &[
            &app_menu(app, server_open)?,
            &file_menu(app)?,
            &edit_menu(app)?,
            &view,
            &window,
            &help,
        ],
    )
}

/// The menu bar is macOS's; elsewhere the shell runs only under the scenario suite, where a GTK
/// menu bar would only take height from the page.
pub fn rebuild<R: Runtime>(app: &AppHandle<R>) {
    if cfg!(target_os = "macos") {
        match build(app) {
            Ok(menu) => {
                if let Err(error) = app.set_menu(menu) {
                    eprintln!("[desktop] could not set the menu: {error}");
                }
            }
            Err(error) => eprintln!("[desktop] could not build the menu: {error}"),
        }
    }
    tray::rebuild(app);
}

fn say<R: Runtime>(app: &AppHandle<R>, title: &str, message: &str) {
    app.dialog()
        .message(message)
        .title(title)
        .kind(MessageDialogKind::Error)
        .blocking_show();
}

pub fn on_event<R: Runtime>(app: &AppHandle<R>, event: &MenuEvent) {
    let id = event.id().as_ref().to_owned();
    let app = app.clone();
    match id.as_str() {
        CHECK_FOR_UPDATES => {
            tauri::async_runtime::spawn(updater::check_from_menu(app));
        }
        SHOW_APP => shell::show_current_window(&app),
        HIDE_APP => {
            for window in app.webview_windows().into_values() {
                if let Err(error) = window.hide() {
                    eprintln!("[desktop] could not hide the window: {error}");
                }
            }
        }
        OPEN_DATA_FOLDER => {
            std::thread::spawn(move || {
                if let Err(reason) = shell::open_data_folder(&app) {
                    say(&app, "Could not open the data folder", &reason);
                }
            });
        }
        OPEN_IN_BROWSER => {
            std::thread::spawn(move || shell::open_in_browser(&app));
        }
        _ => {}
    }
}
