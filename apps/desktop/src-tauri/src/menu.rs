//! The macOS menu bar and the menu-bar icon's menu, rebuilt whenever what they offer moves (a vault
//! opens, the recent list changes). Both offer the data folder only once a vault is open, which a
//! first run has not yet. A menu click is the main thread's, so anything that waits (the CLI, a
//! dialog, a server's start) runs on a thread of its own.

use tauri::menu::{
    AboutMetadata, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu, SubmenuBuilder,
};
use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};

use crate::shell::{self, Outcome, Shell};
use crate::{commands, tray, updater};

const CHECK_FOR_UPDATES: &str = "check-for-updates";
pub const OPEN_DATA_FOLDER: &str = "open-data-folder";
const OPEN_VAULT: &str = "open-vault";
const OPEN_IN_BROWSER: &str = "open-in-browser";
pub const SHOW_APP: &str = "show-app";
pub const HIDE_APP: &str = "hide-app";
const RECENT_PREFIX: &str = "open-recent:";

fn item<R: Runtime>(
    app: &AppHandle<R>,
    id: &str,
    text: &str,
    enabled: bool,
    accelerator: Option<&str>,
) -> tauri::Result<MenuItem<R>> {
    MenuItem::with_id(app, id, text, enabled, accelerator)
}

fn app_menu<R: Runtime>(app: &AppHandle<R>, vault_open: bool) -> tauri::Result<Submenu<R>> {
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
            vault_open,
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

fn file_menu<R: Runtime>(
    app: &AppHandle<R>,
    vault_open: bool,
    recent: &[String],
) -> tauri::Result<Submenu<R>> {
    let mut recent_menu =
        SubmenuBuilder::new(app, "Open Recent Vault").enabled(vault_open && !recent.is_empty());
    for path in recent {
        let name = crate::vaults::vault_ref(path).name;
        recent_menu = recent_menu.item(&item(
            app,
            &format!("{RECENT_PREFIX}{path}"),
            &name,
            true,
            None,
        )?);
    }
    SubmenuBuilder::new(app, "File")
        .item(&item(
            app,
            OPEN_VAULT,
            "Open Vault…",
            vault_open,
            Some("CmdOrCtrl+O"),
        )?)
        .item(&recent_menu.build()?)
        .separator()
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
    let shell = app.state::<Shell>();
    let vault_open = shell.target().is_some();
    let recent = shell::remember_list(app);
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
            vault_open,
            None,
        )?)
        .build()?;
    Menu::with_items(
        app,
        &[
            &app_menu(app, vault_open)?,
            &file_menu(app, vault_open, &recent)?,
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

fn switch_from_menu<R: Runtime>(app: &AppHandle<R>, vault_dir: &str, confirm: bool) {
    match shell::switch_vault(app, vault_dir, confirm) {
        Outcome::Done | Outcome::Reported(_) => {}
        Outcome::Refused(reason) => say(app, "Could not open the vault", &reason),
    }
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
        OPEN_VAULT => {
            std::thread::spawn(move || {
                if let Some(picked) = commands::pick_vault_dir(&app) {
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
