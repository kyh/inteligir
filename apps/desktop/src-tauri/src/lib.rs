//! The Inteligir Mac app: one window on the library's page the site serves, the macOS menu, and
//! the update flow the page drives through three commands.

mod menu;
mod navigation;
mod updater;
mod window;

fn fail(error: &dyn std::fmt::Display) -> ! {
    eprintln!("[desktop] Inteligir failed to start: {error}");
    std::process::exit(1);
}

pub fn run() {
    let mut context = tauri::generate_context!();
    if let Err(error) = window::follow_local_site(context.config_mut()) {
        fail(&error);
    }
    // `plugins.updater`, which the pack writes, turns updates on; under `tauri dev` there is no
    // bundle to replace
    let updates = context.config().plugins.0.contains_key("updater") && !tauri::is_dev();

    let mut builder = tauri::Builder::default()
        // only Rust opens links (window.rs): the plugin's own script would catch a `_blank`
        // click and ask for a command the page is not granted, so the link would do nothing
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        );
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
