//! The menu-bar icon: closing the last window hides the app there rather than quitting it, so
//! Show brings it back, and Quit is the one way out (and the server's flush).

use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Manager, Runtime};

use crate::menu::{HIDE_APP, OPEN_DATA_FOLDER, SHOW_APP};
use crate::shell::Shell;

const TRAY_ID: &str = "inteligir";

fn menu<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let server_open = app.state::<Shell>().target().is_some();
    Menu::with_items(
        app,
        &[
            &MenuItem::with_id(
                app,
                SHOW_APP,
                format!("Show {}", crate::window::app_title()),
                true,
                None::<&str>,
            )?,
            &MenuItem::with_id(app, HIDE_APP, "Hide", true, None::<&str>)?,
            &PredefinedMenuItem::separator(app)?,
            &MenuItem::with_id(
                app,
                OPEN_DATA_FOLDER,
                "Open Data Folder",
                server_open,
                None::<&str>,
            )?,
            &PredefinedMenuItem::separator(app)?,
            &PredefinedMenuItem::quit(app, None)?,
        ],
    )
}

fn create<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<TrayIcon<R>> {
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
pub fn rebuild<R: Runtime>(app: &AppHandle<R>) {
    let rebuilt = match app.tray_by_id(TRAY_ID) {
        Some(tray) => menu(app).and_then(|menu| tray.set_menu(Some(menu))),
        None => create(app).map(|_| ()),
    };
    if let Err(error) = rebuilt {
        eprintln!("[desktop] no menu-bar icon: {error}");
    }
}
