// The app manifest names every command the shell answers, so each one is an `allow-*`
// permission a capability must grant: no page reaches a command nothing granted it. The list
// is held against the page's rows (`apps/workspace/src/shell/ipc-contract.ts`), `src/lib.rs`'s
// handlers and the capability by `tools/repo-guards/src/desktop-shell-wire.test.ts`.
fn main() -> Result<(), Box<dyn std::error::Error>> {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "credential_forget",
            "credential_keep",
            "credential_restore",
            "files_clear_staged",
            "files_stage",
            "files_staged",
            "files_unstage",
            "leaving_ready",
            "replica_all",
            "replica_begin",
            "replica_commit",
            "replica_rollback",
            "replica_run",
            "replica_tx_all",
            "replica_tx_run",
            "shell_config",
            "updates_check",
            "updates_get_state",
            "updates_install",
        ]),
    ))?;
    Ok(())
}
