//! Tauri's default macOS menu, its Edit menu titled "Edit" so macOS adds Start Dictation, plus
//! View › Reload, the way back once a launch with no connection finds one, and Check for
//! Updates… once the updater is configured.

use tauri::menu::{Menu, MenuEvent, MenuItem, MenuItemKind, PredefinedMenuItem, Submenu};
use tauri::{AppHandle, Manager, Runtime};

use crate::updater::{self, Updates};
use crate::window;

const RELOAD: &str = "reload";
const CHECK_FOR_UPDATES: &str = "check-for-updates";

/// The menu bar is macOS's; the shell runs nowhere else.
pub fn install<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    if cfg!(target_os = "macos") {
        app.set_menu(build(app)?)?;
    }
    Ok(())
}

fn submenu<R: Runtime>(menu: &Menu<R>, title: &str) -> tauri::Result<Option<Submenu<R>>> {
    for item in menu.items()? {
        if let MenuItemKind::Submenu(submenu) = item
            && submenu.text()? == title
        {
            return Ok(Some(submenu));
        }
    }
    Ok(None)
}

fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<Menu<R>> {
    let menu = Menu::default(app)?;
    // the first menu is the app's, opening with About: its own verbs follow it
    if app.state::<Updates>().enabled()
        && let Some(MenuItemKind::Submenu(app_menu)) = menu.items()?.first()
    {
        let check = MenuItem::with_id(
            app,
            CHECK_FOR_UPDATES,
            "Check for Updates…",
            true,
            None::<&str>,
        )?;
        app_menu.insert(&check, 1)?;
    }
    if let Some(view) = submenu(&menu, "View")? {
        let reload = MenuItem::with_id(app, RELOAD, "Reload", true, Some("CmdOrCtrl+R"))?;
        view.insert_items(&[&reload, &PredefinedMenuItem::separator(app)?], 0)?;
    }
    Ok(menu)
}

pub fn on_event<R: Runtime>(app: &AppHandle<R>, event: &MenuEvent) {
    match event.id().as_ref() {
        RELOAD => window::reload_main(app),
        CHECK_FOR_UPDATES => {
            let app = app.clone();
            tauri::async_runtime::spawn(async move {
                updater::check(&app).await;
            });
        }
        _ => {}
    }
}
