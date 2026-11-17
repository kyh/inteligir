//! The Inteligir Mac app: one window on the library's page the site serves, the macOS menu, and
//! the update flow the page drives through three commands.

mod menu;
mod navigation;
mod updater;
mod window;

// `generate_context!` writes the config's `plugins` as `serde_json` values, and only the pack's
// config holds any (tauri.package.conf.json): as a dev-dependency the crate compiles every build
// but a release, so this line fails the others too
use serde_json as _;

fn fail(error: &dyn std::fmt::Display) -> ! {
    eprintln!("[desktop] Inteligir failed to start: {error}");
    std::process::exit(1);
}

pub fn run() {
    let context = tauri::generate_context!();
    // `plugins.updater`, which only the pack's config holds (tauri.package.conf.json), turns
    // updates on; under `tauri dev` there is no bundle to replace
    let updates = context.config().plugins.0.contains_key("updater") && !tauri::is_dev();

    let mut builder = tauri::Builder::default();
    if updates {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    }

    let built = builder
        .manage(updater::Updates::new(updates))
        .invoke_handler(tauri::generate_handler![
            updater::check_for_updates,
            updater::download_update,
            updater::install_update,
        ])
        .on_menu_event(|app, event| menu::on_event(app, &event))
        .setup(|app| {
            menu::install(app.handle())?;
            window::create_main(app.handle())?;
            Ok(())
        })
        .build(context);

    match built {
        // closing the window hides it, so the Dock's click brings the same page back
        #[cfg(target_os = "macos")]
        Ok(app) => app.run(|app, event| {
            if let tauri::RunEvent::Reopen { .. } = event {
                window::show_main(app);
            }
        }),
        #[cfg(not(target_os = "macos"))]
        Ok(app) => app.run(|_, _| {}),
        Err(error) => fail(&error),
    }
}
