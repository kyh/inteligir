//! The menu-bar icon: closing the window hides the app there rather than quitting it, so Show
//! brings it back, and Quit is the one way out.

use tauri::image::Image;
use tauri::menu::{Menu, MenuBuilder};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Wry};

use crate::menu::{self, HIDE_APP, SHOW_APP};

const TRAY_ID: &str = "inteligir";

fn menu(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    MenuBuilder::new(app)
        .text(SHOW_APP, format!("Show {}", crate::window::app_title()))
        .text(HIDE_APP, "Hide")
        .separator()
        .item(&menu::quit_item(app)?)
        .build()
}

/// Made once at launch; a Linux desktop with no tray host has no menu-bar icon, which costs the
/// icon alone.
pub fn create(app: &AppHandle) {
    // a template, which macOS draws in the menu bar's own colour from its alpha alone: the app
    // icon's wire sphere on a transparent ground (the icon itself is opaque edge to edge, so as a
    // template it drew a plain square)
    let made: tauri::Result<TrayIcon> =
        Image::from_bytes(include_bytes!("../icons/tray-template.png")).and_then(|icon| {
            TrayIconBuilder::with_id(TRAY_ID)
                .icon(icon)
                .icon_as_template(true)
                .tooltip(crate::window::app_title())
                .menu(&menu(app)?)
                .build(app)
        });
    if let Err(error) = made {
        eprintln!("[desktop] no menu-bar icon: {error}");
    }
}
