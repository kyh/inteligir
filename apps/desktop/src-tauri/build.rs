// The app manifest names every command the shell answers, so each one is an `allow-*`
// permission a capability must grant: no window reaches a command nothing granted it.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "check_for_updates",
            "download_update",
            "install_update",
        ]),
    ))?;
    Ok(())
}
