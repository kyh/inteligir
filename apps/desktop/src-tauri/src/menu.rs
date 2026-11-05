//! The macOS menu bar, rebuilt when an update becomes ready, since the app menu then offers
//! Restart to Update in place of Check for Updates…. Quit is the app's own item, not the predefined
//! one, which ends the app before the page could write its last edit (`leaving.rs`). A menu click
//! is the main thread's, so anything that waits (a check, a dialog, the page's answer) runs on a
//! thread of its own.

use tauri::menu::{
    AboutMetadata, Menu, MenuBuilder, MenuEvent, MenuItem, MenuItemBuilder, Submenu, SubmenuBuilder,
};
use tauri::{AppHandle, Manager, Wry};
use tauri_plugin_opener::OpenerExt;

use crate::cloud::ShellConfig;
use crate::leaving;
use crate::updater::{self, Updates};

const CHECK_FOR_UPDATES: &str = "check-for-updates";
const QUIT: &str = "quit";
const RESTART_TO_UPDATE: &str = "restart-to-update";
const OPEN_IN_BROWSER: &str = "open-in-browser";
pub const SHOW_APP: &str = "show-app";
pub const HIDE_APP: &str = "hide-app";

/// Where Open in Browser goes: the library's page on the cloud, the browser tab's own.
const LIBRARY_PAGE_PATH: &str = "/library";

/// Quit, as the app menu and the menu-bar icon both offer it, under macOS's own chord.
pub fn quit_item(app: &AppHandle) -> tauri::Result<MenuItem<Wry>> {
    MenuItemBuilder::with_id(QUIT, format!("Quit {}", crate::window::app_title()))
        .accelerator("CmdOrCtrl+Q")
        .build(app)
}

fn app_menu(app: &AppHandle) -> tauri::Result<Submenu<Wry>> {
    let info = app.package_info();
    let about = AboutMetadata {
        name: Some(crate::window::app_title().to_owned()),
        version: Some(info.version.to_string()),
        ..AboutMetadata::default()
    };
    let ready = app.state::<Updates>().state().installs_on_quit().is_some();
    let menu = SubmenuBuilder::new(app, crate::window::app_title()).about(Some(about));
    let menu = if ready {
        menu.text(RESTART_TO_UPDATE, "Restart to Update")
    } else {
        menu.text(CHECK_FOR_UPDATES, "Check for Updates…")
    };
    menu.separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .item(&quit_item(app)?)
        .build()
}

/// Named "Edit", so macOS adds Start Dictation… and Emoji & Symbols to it: dictation is the
/// operating system's.
fn edit_menu(app: &AppHandle) -> tauri::Result<Submenu<Wry>> {
    SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()
}

fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let file = SubmenuBuilder::new(app, "File").close_window().build()?;
    let view = SubmenuBuilder::new(app, "View").fullscreen().build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .build()?;
    let help = SubmenuBuilder::new(app, "Help")
        .text(OPEN_IN_BROWSER, "Open in Browser")
        .build()?;
    MenuBuilder::new(app)
        .item(&app_menu(app)?)
        .item(&file)
        .item(&edit_menu(app)?)
        .item(&view)
        .item(&window)
        .item(&help)
        .build()
}

/// The menu bar is macOS's; elsewhere the shell runs only under the scenario suite, where a GTK
/// menu bar would only take height from the page.
pub fn rebuild(app: &AppHandle) {
    if !cfg!(target_os = "macos") {
        return;
    }
    match build(app) {
        Ok(menu) => {
            if let Err(error) = app.set_menu(menu) {
                eprintln!("[desktop] could not set the menu: {error}");
            }
        }
        Err(error) => eprintln!("[desktop] could not build the menu: {error}"),
    }
}

pub fn on_event(app: &AppHandle, event: &MenuEvent) {
    let app = app.clone();
    match event.id().as_ref() {
        CHECK_FOR_UPDATES => {
            std::thread::spawn(move || updater::check_from_menu(&app));
        }
        RESTART_TO_UPDATE => {
            std::thread::spawn(move || {
                leaving::restart_to_update(&app);
            });
        }
        QUIT => {
            std::thread::spawn(move || leaving::quit(&app));
        }
        SHOW_APP => crate::window::show(&app),
        HIDE_APP => {
            for window in app.webview_windows().into_values() {
                if let Err(error) = window.hide() {
                    eprintln!("[desktop] could not hide the window: {error}");
                }
            }
        }
        OPEN_IN_BROWSER => {
            let url = format!(
                "{}{LIBRARY_PAGE_PATH}",
                app.state::<ShellConfig>().cloud_origin
            );
            if let Err(error) = app.opener().open_url(&url, None::<&str>) {
                eprintln!("[desktop] could not open {url} in the browser: {error}");
            }
        }
        _ => {}
    }
}
