//! The Inteligir desktop shell: a Rust window over the page the local server serves, the server
//! itself as the one child it supervises, and what only a native host can do for that page: menus,
//! the menu-bar icon, dialogs, Finder, and the updates.

mod commands;
mod diagnostics;
mod door;
mod files;
mod launch;
mod menu;
mod navigation;
mod paths;
mod runtime;
mod server;
mod server_log;
mod shell;
mod tray;
mod update_state;
mod updater;
mod vaults;
mod window;

use tauri::{Manager, RunEvent};

use crate::shell::Shell;
use crate::updater::Updates;

/// SIGTERM and SIGINT quit as Quit does, so the server's teardown runs: a `kill`, launchd at
/// shutdown and Ctrl-C under `tauri dev` all flush the vault's pending commit. A handler, not a
/// blocked mask: nothing of it reaches the children the shell starts.
#[cfg(unix)]
fn quit_on_signals<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    use signal_hook::consts::{SIGINT, SIGTERM};
    use signal_hook::iterator::Signals;
    match Signals::new([SIGTERM, SIGINT]) {
        Ok(mut signals) => {
            let app = app.clone();
            std::thread::spawn(move || {
                if signals.forever().next().is_some() {
                    app.exit(0);
                }
            });
        }
        Err(error) => eprintln!("[desktop] a SIGTERM will not stop the server first: {error}"),
    }
}

pub fn run() {
    let context = tauri::generate_context!();
    // `plugins.updater` in tauri.conf.json names the feed and its key; a shell outside a bundle has
    // nothing to replace
    let updates_configured = context.config().plugins.0.contains_key("updater");
    let version = context.package_info().version.to_string();
    let bundled = std::env::current_exe().is_ok_and(|exe| runtime::is_bundled(&exe));

    let mut builder = tauri::Builder::default();
    // first, as the plugin asks: a second launch of the app hands over to this one before anything
    // else runs, since two shells would race for the port and the loser would adopt the winner. The
    // packaged app alone: the plugin keys on the bundle id, machine-wide, so a development shell or
    // the scenario suite's would otherwise hand over to an installed Inteligir and quit
    if bundled {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            shell::show_current_window(app);
        }));
    }
    builder = builder
        .plugin(tauri_plugin_dialog::init())
        // only Rust opens links (window.rs): the plugin's own script would catch a `_blank` click
        // and ask for a command no page is granted, so the link would do nothing
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        );
    if updates_configured && bundled {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    let built = builder
        .manage(Updates::new(
            &version,
            updater::disabled_reason(updates_configured, bundled),
        ))
        .invoke_handler(tauri::generate_handler![
            commands::diagnostics_get_state,
            commands::diagnostics_open_data_folder,
            commands::diagnostics_restart,
            commands::diagnostics_set_debug,
            commands::diagnostics_show_log,
            commands::first_run_finish,
            commands::first_run_get_state,
            commands::first_run_pick_folder,
            commands::first_run_pick_parent,
            commands::paths_open,
            commands::paths_reveal,
            commands::print_page,
            commands::updates_check,
            commands::updates_download,
            commands::updates_get_state,
            commands::updates_install,
            commands::vaults_forget,
            commands::vaults_get_state,
            commands::vaults_open,
            commands::vaults_pick,
        ])
        .on_menu_event(|app, event| menu::on_event(app, &event))
        .setup(move |app| {
            // the Electron shell's userData, so an upgrade keeps the recent list and the debug choice
            let own_dir = app.path().data_dir()?.join(if bundled {
                "Inteligir"
            } else {
                "Inteligir (Dev)"
            });
            app.manage(Shell::new(own_dir, bundled));
            #[cfg(unix)]
            quit_on_signals(app.handle());
            let launching = app.handle().clone();
            std::thread::spawn(move || shell::start(&launching));
            Ok(())
        })
        .build(context);

    let app = match built {
        Ok(app) => app,
        Err(error) => {
            eprintln!("[desktop] Inteligir failed to start: {error}");
            std::process::exit(1);
        }
    };
    app.run(|app, event| match event {
        // closing the last window hides the app in the menu bar; Quit is the way out
        RunEvent::ExitRequested {
            code: None, api, ..
        } => api.prevent_exit(),
        // Cmd+Q ends in applicationWillTerminate, with nothing after it to wait in, so the
        // server's flush is waited for here
        RunEvent::Exit => shell::stop_owned_server(app),
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => shell::show_current_window(app),
        _ => {}
    });
}
