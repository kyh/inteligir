//! The menu-bar icon: closing the last window hides the app there rather than quitting it, so
//! Show brings it back, and Quit is the one way out (and the server's flush).

use tauri::image::Image;
use tauri::menu::{Menu, MenuBuilder, MenuItemBuilder};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Manager, Wry};

use crate::menu::{HIDE_APP, OPEN_DATA_FOLDER, SHOW_APP};
use crate::shell::Shell;

const TRAY_ID: &str = "inteligir";

fn menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let vault_open = app.state::<Shell>().target().is_some();
    MenuBuilder::new(app)
        .text(SHOW_APP, format!("Show {}", crate::window::app_title()))
        .text(HIDE_APP, "Hide")
        .separator()
        .item(
            &MenuItemBuilder::with_id(OPEN_DATA_FOLDER, "Open Data Folder")
                .enabled(vault_open)
                .build(app)?,
        )
        .separator()
        .quit()
        .build()
}

fn create(app: &AppHandle) -> tauri::Result<TrayIcon> {
    // a template, which macOS draws in the menu bar's own colour from its alpha alone: the app
    // icon's wire sphere on a transparent ground (the icon itself is opaque edge to edge, so as a
    // template it drew a plain square)
    let icon = Image::from_bytes(include_bytes!("../icons/tray-template.png"))?;
    TrayIconBuilder::with_id(TRAY_ID)
        .icon(icon)
        .icon_as_template(true)
        .tooltip(crate::window::app_title())
        .menu(&menu(app)?)
        .build(app)
}

/// Made on the first call and its menu replaced after; a Linux desktop with no tray host has no
/// menu-bar icon, which costs the icon alone.
pub fn rebuild(app: &AppHandle) {
    let rebuilt = match app.tray_by_id(TRAY_ID) {
        Some(tray) => menu(app).and_then(|menu| tray.set_menu(Some(menu))),
        None => create(app).map(|_| ()),
    };
    if let Err(error) = rebuilt {
        eprintln!("[desktop] no menu-bar icon: {error}");
    }
}
