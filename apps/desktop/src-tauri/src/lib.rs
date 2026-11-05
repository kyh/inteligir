//! The Inteligir desktop shell: a Rust window over the library's page the bundle carries, and what
//! only a native host can do for that page: the replica of the account's library on disk, the
//! credential in the Keychain, the library's files under the shell's own scheme, the updates,
//! menus and the menu-bar icon.

mod account;
mod cloud;
mod commands;
mod credential;
mod dialogs;
mod error;
mod file_cache;
mod file_scheme;
mod leaving;
mod menu;
mod navigation;
mod replica;
mod tray;
mod update_state;
mod updater;
mod window;

use tauri::{App, Manager, RunEvent};

use crate::account::Account;
use crate::cloud::ShellConfig;
use crate::credential::Credentials;
use crate::file_cache::{CACHE_LIMIT_BYTES, CloudFiles, FileCache};
use crate::leaving::Leaving;
use crate::replica::{Replica, TRANSACTION_IDLE_LIMIT};
use crate::updater::Updates;

/// SIGTERM and SIGINT quit as Quit does, the page's last edit written and a ready update installed:
/// a `kill`, launchd at shutdown and Ctrl-C under `tauri dev` all take the ordinary way out.
#[cfg(unix)]
fn quit_on_signals(app: &tauri::AppHandle) {
    use signal_hook::consts::{SIGINT, SIGTERM};
    use signal_hook::iterator::Signals;
    match Signals::new([SIGTERM, SIGINT]) {
        Ok(mut signals) => {
            let app = app.clone();
            std::thread::spawn(move || {
                if signals.forever().next().is_some() {
                    leaving::quit(&app);
                }
            });
        }
        Err(error) => eprintln!("[desktop] a SIGTERM will not quit as Quit does: {error}"),
    }
}

/// Whether this binary runs from an app bundle: only a bundle has something to update, and only a
/// bundle is the one Inteligir a second launch hands over to.
fn is_bundled() -> bool {
    std::env::current_exe().is_ok_and(|exe| {
        exe.ancestors()
            .any(|dir| dir.extension().is_some_and(|extension| extension == "app"))
    })
}

/// The account's state, its folders the platform's: the replica and the staged files in the app's
/// data dir, outside any cache the OS may purge, and the fetched files in its caches dir. All three
/// and the Keychain item are named by the bundle id, which a debug build's config makes its own.
fn manage_account(app: &App, version: &str) -> Result<(), Box<dyn std::error::Error>> {
    let bundle_id = app.config().identifier.clone();
    cloud::own_identity(&bundle_id)?;
    let paths = app.path();
    let data_dir = paths.app_data_dir()?;
    let cache_dir = paths.app_cache_dir()?;
    let config = ShellConfig::new(cloud::cloud_origin(), version);
    app.manage(CloudFiles {
        client: file_cache::http_client()?,
        origin: config.cloud_origin.clone(),
        build: cloud::build_value(version),
    });
    app.manage(config);
    app.manage(Account::new(
        Credentials::for_this_mac(&bundle_id, &data_dir)?,
        Replica::new(TRANSACTION_IDLE_LIMIT),
        FileCache::new(
            data_dir.join("staged"),
            cache_dir.join("files"),
            CACHE_LIMIT_BYTES,
        ),
        data_dir.join("library"),
    ));
    Ok(())
}

pub fn run() {
    let context = tauri::generate_context!();
    // `plugins.updater` in the pack's config names the feed and its key
    let updates_configured = context.config().plugins.0.contains_key("updater");
    let version = context.package_info().version.to_string();
    let bundled = is_bundled();

    let mut builder = tauri::Builder::default();
    // first, as the plugin asks: a second launch hands over to this one before anything else runs.
    // The packaged app alone: the plugin keys on the bundle id, machine-wide, so a development
    // shell or the scenario suite's would otherwise hand over to an installed Inteligir and quit
    if bundled {
        builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            window::show(app);
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
        .manage(Leaving::new())
        .register_asynchronous_uri_scheme_protocol(
            file_scheme::SCHEME,
            |context, request, responder| {
                let app = context.app_handle().clone();
                tauri::async_runtime::spawn(async move {
                    let account = app.state::<Account>();
                    let response = file_scheme::answer(
                        account.files(),
                        &app.state::<CloudFiles>(),
                        account.bearer(),
                        &request,
                    )
                    .await;
                    responder.respond(response);
                });
            },
        )
        .invoke_handler(tauri::generate_handler![
            commands::credential_forget,
            commands::credential_keep,
            commands::credential_restore,
            commands::files_clear_staged,
            commands::files_stage,
            commands::files_staged,
            commands::files_unstage,
            commands::leaving_ready,
            commands::replica_all,
            commands::replica_begin,
            commands::replica_commit,
            commands::replica_rollback,
            commands::replica_run,
            commands::replica_tx_all,
            commands::replica_tx_run,
            commands::shell_config,
            commands::updates_check,
            commands::updates_get_state,
            commands::updates_install,
        ])
        .on_menu_event(|app, event| menu::on_event(app, &event))
        .setup(move |app| {
            manage_account(app, &version)?;
            #[cfg(unix)]
            quit_on_signals(app.handle());
            menu::rebuild(app.handle());
            tray::create(app.handle());
            window::create(app.handle())?;
            updater::start(app.handle());
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
        // closing the window hides the app in the menu bar; Quit is the way out
        RunEvent::ExitRequested {
            code: None, api, ..
        } => api.prevent_exit(),
        // every way out ends here: Quit once the page wrote what it held (leaving.rs), or a quit
        // macOS sends itself, which ends in applicationWillTerminate with nothing after it to wait
        // in. A ready update installs, and the replica's file closes after its last commit
        RunEvent::Exit => {
            updater::install_on_quit(app);
            app.state::<Account>().replica().close();
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => window::show(app),
        _ => {}
    });
}
