//! Where the shell finds the Node that runs its server and the CLI that server is, and the
//! environment every node child starts with.
//!
//! A packaged app carries both: Node as the sidecar beside the shell's own binary
//! (`bundle.externalBin`), the CLI as a resource. A `tauri dev` shell, and the unbundled build the
//! scenario suite drives, run the checkout's CLI on the developer's own node instead, like
//! `pnpm cli serve` does. Nothing in the environment can point the shell elsewhere: a variable an
//! `open --env` could set would run another program inside a process the OS counts as this app.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};

/// The CLI's own entry for the shell (`apps/cli/src/desktop/desktop-entry.ts`).
pub const DESKTOP_ENTRY: &str = "dist/desktop.js";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NodeRuntime {
    /// The node binary every child runs on.
    pub node: PathBuf,
    /// The CLI package: `dist/`, `bin/`, `seed/` and its production `node_modules`.
    pub cli_dir: PathBuf,
}

impl NodeRuntime {
    pub fn desktop_entry(&self) -> PathBuf {
        self.cli_dir.join(DESKTOP_ENTRY)
    }
}

/// The checkout's CLI, named at compile time: a development shell runs this checkout's server.
fn checkout_cli_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("cli")
}

/// Inside `Inteligir.app/Contents/MacOS`, the bundle carries node and the CLI, and a missing one is
/// a broken install rather than a reason to run something else.
pub fn is_bundled(exe: &Path) -> bool {
    exe.parent()
        .filter(|dir| dir.ends_with("Contents/MacOS"))
        .and_then(Path::parent)
        .and_then(Path::parent)
        .and_then(Path::extension)
        .is_some_and(|extension| extension == "app")
}

pub fn resolve(exe: &Path, resource_dir: &Path) -> Result<NodeRuntime, String> {
    if !is_bundled(exe) {
        return Ok(NodeRuntime {
            node: PathBuf::from("node"),
            cli_dir: checkout_cli_dir(),
        });
    }
    let runtime = NodeRuntime {
        node: exe.with_file_name("node"),
        cli_dir: resource_dir.join("server"),
    };
    for required in [runtime.node.clone(), runtime.desktop_entry()] {
        if !required.exists() {
            return Err(format!(
                "this install is incomplete: {} is missing. Reinstall Inteligir.",
                required.display()
            ));
        }
    }
    Ok(runtime)
}

/// What every node child starts from: the shell's own environment less anything that makes node
/// load code or open a debugger. `NODE_OPTIONS` can `--require` a file or `--inspect` a port, so it
/// and every other `NODE_*` but `NODE_ENV` go: that was the job of the Electron fuses that turned
/// `NODE_OPTIONS` and the inspector arguments off.
pub fn scrubbed_env<I>(inherited: I) -> BTreeMap<OsString, OsString>
where
    I: IntoIterator<Item = (OsString, OsString)>,
{
    inherited
        .into_iter()
        .filter(|(name, _)| {
            let name = name.to_string_lossy();
            !name.starts_with("NODE_") || name == "NODE_ENV"
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pairs(names: &[&str]) -> Vec<(OsString, OsString)> {
        names
            .iter()
            .map(|name| (OsString::from(*name), OsString::from("x")))
            .collect()
    }

    #[test]
    fn drops_every_node_variable_but_its_mode() {
        let kept: Vec<String> = scrubbed_env(pairs(&[
            "PATH",
            "NODE_OPTIONS",
            "NODE_PATH",
            "NODE_ENV",
            "NODE_REPL_EXTERNAL_MODULE",
            "HOME",
        ]))
        .into_keys()
        .map(|name| name.to_string_lossy().into_owned())
        .collect();
        assert_eq!(kept, ["HOME", "NODE_ENV", "PATH"]);
    }

    #[test]
    fn knows_a_bundled_shell_by_where_it_runs() {
        assert!(is_bundled(Path::new(
            "/Applications/Inteligir.app/Contents/MacOS/Inteligir"
        )));
        assert!(!is_bundled(Path::new(
            "/repo/apps/desktop/src-tauri/target/debug/inteligir"
        )));
        assert!(!is_bundled(Path::new("/tmp/Contents/MacOS/Inteligir")));
    }

    #[test]
    fn an_unbundled_shell_runs_the_checkout() -> Result<(), String> {
        let runtime = resolve(
            Path::new("/repo/target/debug/inteligir"),
            Path::new("/nowhere"),
        )?;
        assert_eq!(runtime.node, PathBuf::from("node"));
        assert!(runtime.cli_dir.ends_with("cli"));
        Ok(())
    }

    #[test]
    fn a_bundle_missing_node_is_a_broken_install() {
        let refused = resolve(
            Path::new("/Applications/Inteligir.app/Contents/MacOS/Inteligir"),
            Path::new("/Applications/Inteligir.app/Contents/Resources"),
        );
        assert!(refused.is_err_and(|reason| reason.contains("Reinstall")));
    }
}
