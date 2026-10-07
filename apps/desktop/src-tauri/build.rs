// The app manifest names every command the shell answers, so each one is an `allow-*`
// permission a capability must grant: no window reaches a command nothing granted it. The list
// is held against the page's rows (`apps/desktop/src/ipc-contract.ts`), `src/commands.rs` and the
// capabilities by `tools/repo-guards/src/desktop-shell-wire.test.ts`.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "diagnostics_get_state",
            "diagnostics_open_data_folder",
            "diagnostics_restart",
            "diagnostics_set_debug",
            "diagnostics_show_log",
            "first_run_finish",
            "first_run_get_state",
            "first_run_pick_folder",
            "first_run_pick_parent",
            "paths_open",
            "paths_reveal",
            "print_page",
            "updates_check",
            "updates_download",
            "updates_get_state",
            "updates_install",
            "vaults_forget",
            "vaults_get_state",
            "vaults_open",
            "vaults_pick",
        ]),
    ))?;
    Ok(())
}
