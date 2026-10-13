//! The macOS menu bar and the menu-bar icon's menu, rebuilt whenever what they offer moves (a vault
//! opens, the recent list changes). Both offer the data folder only once a vault is open, which a
//! first run has not yet, and a switch only where the page offers one (`vaults_state`'s `blocked`).
//! A menu click is the main thread's, so anything that waits (the CLI, a dialog, a server's start)
//! runs on a thread of its own.

use tauri::menu::{
    AboutMetadata, Menu, MenuBuilder, MenuEvent, MenuItemBuilder, Submenu, SubmenuBuilder,
};
use tauri::{AppHandle, Manager, Wry};

use crate::shell::{self, Outcome, Shell};
use crate::{dialogs, tray, updater};

const CHECK_FOR_UPDATES: &str = "check-for-updates";
pub const OPEN_DATA_FOLDER: &str = "open-data-folder";
const OPEN_VAULT: &str = "open-vault";
const OPEN_IN_BROWSER: &str = "open-in-browser";
pub const SHOW_APP: &str = "show-app";
pub const HIDE_APP: &str = "hide-app";
const RECENT_PREFIX: &str = "open-recent:";

fn app_menu(app: &AppHandle, vault_open: bool) -> tauri::Result<Submenu<Wry>> {
    let info = app.package_info();
    let about = AboutMetadata {
        name: Some(crate::window::app_title().to_owned()),
        version: Some(info.version.to_string()),
        ..AboutMetadata::default()
    };
    SubmenuBuilder::new(app, crate::window::app_title())
        .about(Some(about))
        .text(CHECK_FOR_UPDATES, "Check for Updates…")
        .separator()
        .item(
            &MenuItemBuilder::with_id(OPEN_DATA_FOLDER, "Open Data Folder")
                .enabled(vault_open)
                .build(app)?,
        )
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()
}

fn file_menu(app: &AppHandle, switchable: bool, recent: &[String]) -> tauri::Result<Submenu<Wry>> {
    let mut recent_menu =
        SubmenuBuilder::new(app, "Open Recent Vault").enabled(switchable && !recent.is_empty());
    for path in recent {
        let name = crate::vaults::vault_ref(path).name;
        recent_menu = recent_menu.text(format!("{RECENT_PREFIX}{path}"), name);
    }
    SubmenuBuilder::new(app, "File")
        .item(
            &MenuItemBuilder::with_id(OPEN_VAULT, "Open Vault…")
                .enabled(switchable)
                .accelerator("CmdOrCtrl+O")
                .build(app)?,
        )
        .item(&recent_menu.build()?)
        .separator()
        .close_window()
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
    let shell = app.state::<Shell>();
    let vault_open = shell.target().is_some();
    // an adopted server, or a launch an env var pins, refuses a switch: no entry offers one
    let switchable = shell::vaults_state(app).is_some_and(|state| state.blocked.is_none());
    let recent = shell::remember_list(app);
    let view = SubmenuBuilder::new(app, "View").fullscreen().build()?;
    let window = SubmenuBuilder::new(app, "Window")
        .minimize()
        .maximize()
        .build()?;
    let help = SubmenuBuilder::new(app, "Help")
        .item(
            &MenuItemBuilder::with_id(OPEN_IN_BROWSER, "Open in Browser")
                .enabled(vault_open)
                .build(app)?,
        )
        .build()?;
    MenuBuilder::new(app)
        .item(&app_menu(app, vault_open)?)
        .item(&file_menu(app, switchable, &recent)?)
        .item(&edit_menu(app)?)
        .item(&view)
        .item(&window)
        .item(&help)
        .build()
}

/// The menu bar is macOS's; elsewhere the shell runs only under the scenario suite, where a GTK
/// menu bar would only take height from the page.
pub fn rebuild(app: &AppHandle) {
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

fn switch_from_menu(app: &AppHandle, vault_dir: &str, confirm: bool) {
    match shell::switch_vault(app, vault_dir, confirm) {
        Outcome::Done | Outcome::Reported(_) => {}
        Outcome::Refused(reason) => dialogs::error(app, "Could not open the vault", &reason),
    }
}

pub fn on_event(app: &AppHandle, event: &MenuEvent) {
    let id = event.id().as_ref().to_owned();
    let app = app.clone();
    match id.as_str() {
        CHECK_FOR_UPDATES => {
            std::thread::spawn(move || updater::check_from_menu(&app));
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
                    dialogs::error(&app, "Could not open the data folder", &reason);
                }
            });
        }
        OPEN_VAULT => {
            std::thread::spawn(move || {
                if let Some(picked) = shell::pick_vault_dir(&app) {
                    switch_from_menu(&app, &picked, true);
                }
            });
        }
        OPEN_IN_BROWSER => {
            std::thread::spawn(move || shell::open_in_browser(&app));
        }
        other => {
            if let Some(path) = other.strip_prefix(RECENT_PREFIX) {
                let path = path.to_owned();
                std::thread::spawn(move || switch_from_menu(&app, &path, false));
            }
        }
    }
}
