//! The shell's one state: the data dir it serves, the server behind it and the window that shows
//! it, and the moves between them. A launch boots the server on the data dir the server's own
//! rules name (asked of the CLI, `door.rs`) and opens the window on it, on the welcome steps when
//! nothing has served that data dir yet; what is here is the order of the moves.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::{DialogExt, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

use crate::diagnostics::{self, Diagnostics, ServerRun};
use crate::door::{Door, DoorError};
use crate::launch::{Handoff, Launch, Target};
use crate::runtime::{self, NodeRuntime};
use crate::server::{self, Live, OwnedServer, ServerSpec, Started};
use crate::server_log::{self, SERVER_LOG_MAX_BYTES, ServerLog};
use crate::window::{self, AppWindow};

#[derive(Default)]
struct State {
    door: Option<Door>,
    target: Option<Target>,
    live: Option<Live>,
    owned: Option<Arc<OwnedServer>>,
    window: Option<String>,
    diagnostics: Option<Diagnostics>,
    windows_made: u32,
}

pub struct Shell {
    /// The shell's own folder (the debug choice, the webview stores): Electron's userData, kept so
    /// an upgrade keeps them.
    pub own_dir: PathBuf,
    pub bundled: bool,
    state: Mutex<State>,
}

impl Shell {
    pub fn new(own_dir: PathBuf, bundled: bool) -> Self {
        Self {
            own_dir,
            bundled,
            state: Mutex::new(State::default()),
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn door(&self) -> Result<Door, String> {
        self.lock()
            .door
            .clone()
            .ok_or_else(|| "the app is still starting".to_owned())
    }

    pub fn target(&self) -> Option<Target> {
        self.lock().target.clone()
    }

    pub fn window_label(&self) -> Option<String> {
        self.lock().window.clone()
    }

    pub fn with_diagnostics<T>(&self, read: impl FnOnce(&mut Diagnostics) -> T) -> Option<T> {
        self.lock().diagnostics.as_mut().map(read)
    }
}

/// The node mode the server and the CLI read: a packaged app is production whatever its launch
/// environment says, so a Finder launch never lands on a checkout's development layout.
fn node_env(bundled: bool) -> &'static str {
    if bundled { "production" } else { "development" }
}

fn base_env(bundled: bool) -> BTreeMap<OsString, OsString> {
    let mut env = runtime::scrubbed_env(std::env::vars_os());
    env.insert("NODE_ENV".into(), node_env(bundled).into());
    env
}

/// Where a door call and the server run: a packaged app's home, or the checkout a development
/// shell belongs to, which is how the CLI derives a development instance.
fn working_dir(bundled: bool, node: &NodeRuntime) -> PathBuf {
    let home = std::env::var_os("HOME").map(PathBuf::from);
    if bundled && let Some(home) = home {
        return home;
    }
    node.cli_dir
        .parent()
        .and_then(Path::parent)
        .map_or_else(|| PathBuf::from("/"), Path::to_path_buf)
}

/// Said once and fatal: the app has nothing to show without its server.
fn fail_start<R: Runtime>(app: &AppHandle<R>, reason: &str) {
    eprintln!("[desktop] Inteligir failed to start: {reason}");
    app.dialog()
        .message(reason)
        .title("Inteligir failed to start")
        .kind(MessageDialogKind::Error)
        .blocking_show();
    app.exit(1);
}

/// The launch, on a thread of its own: the login shell, the CLI and the boot all take time the main
/// thread must not wait out.
pub fn start<R: Runtime>(app: &AppHandle<R>) {
    let shell = app.state::<Shell>();
    let exe = match std::env::current_exe() {
        Ok(exe) => exe,
        Err(error) => return fail_start(app, &error.to_string()),
    };
    let resource_dir = app.path().resource_dir().unwrap_or_default();
    let node = match runtime::resolve(&exe, &resource_dir) {
        Ok(node) => node,
        Err(reason) => return fail_start(app, &reason),
    };
    let cwd = working_dir(shell.bundled, &node);
    let mut door = Door {
        runtime: node,
        env: base_env(shell.bundled),
        cwd,
    };
    let launch: Launch = match door.ask(&["launch"]) {
        Ok(launch) => launch,
        Err(error) => return fail_start(app, error.message()),
    };
    for note in &launch.notes {
        println!("[desktop] {note}");
    }
    // every node child from here on runs with the login shell's PATH
    door.env.extend(
        launch
            .env
            .into_iter()
            .map(|(name, value)| (name.into(), value.into())),
    );
    {
        let mut state = shell.lock();
        state.door = Some(door);
        state.diagnostics = Some(Diagnostics::new(
            shell.own_dir.join(diagnostics::DIAGNOSTICS_FILE_NAME),
            shell.bundled,
        ));
    }
    crate::menu::rebuild(app);
    crate::updater::start(app);
    let landing = if launch.first {
        window::WELCOME_PATH
    } else {
        window::WORKSPACE_PATH
    };
    if let Err(reason) = boot_server(app, launch.target, landing) {
        fail_start(app, &reason);
    }
}

/// The server first, then the window that loads from it, landing on `landing`. On failure nothing
/// of this boot is left running.
fn boot_server<R: Runtime>(
    app: &AppHandle<R>,
    target: Target,
    landing: &str,
) -> Result<(), String> {
    let shell = app.state::<Shell>();
    let door = shell.door()?;
    let debug = shell
        .with_diagnostics(|diagnostics| diagnostics.debug())
        .unwrap_or(false);
    let mut env = door.env.clone();
    env.insert("INTELIGIR_DATA_DIR".into(), target.data_dir.clone().into());
    // under `tauri dev` the server answers the page's files from Vite, so an edit reloads in place
    // while the window keeps its server's origin (apps/cli/src/server/ui-dev-server.ts)
    if tauri::is_dev()
        && let Some(dev_url) = &app.config().build.dev_url
    {
        env.insert("INTELIGIR_UI_DEV_URL".into(), dev_url.to_string().into());
    }
    let mut args = vec!["serve"];
    if debug {
        args.push("--debug");
    }
    let log = Arc::new(Mutex::new(ServerLog::new(
        server_log::server_log_path(Path::new(&target.data_dir)),
        SERVER_LOG_MAX_BYTES,
    )));
    let spec = ServerSpec {
        node: door.runtime.node.clone(),
        entry: door.runtime.desktop_entry(),
        args: args.into_iter().map(str::to_owned).collect(),
        cwd: door.cwd.clone(),
        env,
        log: Arc::clone(&log),
    };
    let exiting = app.clone();
    let started = server::start(spec, move |code| {
        // no in-place restart: a fresh child mints a fresh session the window does not hold
        let code = code.map_or_else(|| "a signal".to_owned(), |code| format!("code {code}"));
        exiting
            .dialog()
            .message(format!(
                "The local server exited unexpectedly ({code}). Reopen Inteligir to continue."
            ))
            .title("Inteligir server stopped")
            .kind(MessageDialogKind::Error)
            .blocking_show();
        exiting.exit(1);
    })?;
    let (live, owned, run) = match started {
        Started::Owned { live, server } => {
            (live, Some(Arc::new(server)), ServerRun::Owned { debug })
        }
        Started::Adopted { live } => {
            println!(
                "[desktop] adopting the server already serving {}",
                target.data_dir
            );
            (live, None, ServerRun::Adopted)
        }
    };
    let label = {
        let mut state = shell.lock();
        state.windows_made += 1;
        format!("app-{}", state.windows_made)
    };
    let webview_dir = shell
        .own_dir
        .join("webview")
        .join(hex16(&window::data_store_id(&target.data_dir)));
    let made = window::create_app_window(
        app,
        &AppWindow {
            label: &label,
            origin: &live.origin,
            handoff_url: &live.handoff_url,
            path: landing,
            data_dir: &target.data_dir,
            webview_dir,
            log,
        },
    );
    if let Err(error) = made {
        if let Some(server) = owned {
            server.stop();
        }
        return Err(format!("the window could not open: {error}"));
    }
    {
        let mut state = shell.lock();
        if let Some(diagnostics) = state.diagnostics.as_mut() {
            diagnostics.record_run(run);
        }
        state.target = Some(target);
        state.live = Some(live);
        state.owned = owned;
        state.window = Some(label);
    }
    crate::menu::rebuild(app);
    Ok(())
}

fn hex16(id: &[u8; 16]) -> String {
    id.iter().fold(String::with_capacity(32), |mut hex, byte| {
        use std::fmt::Write as _;
        let _ = write!(hex, "{byte:02x}");
        hex
    })
}

/// The child's ordered shutdown runs to its end; nothing moves until it has. An adopted server is
/// nobody's to stop and outlives the shell.
pub fn stop_owned_server<R: Runtime>(app: &AppHandle<R>) {
    let owned = {
        let shell = app.state::<Shell>();
        let mut state = shell.lock();
        state.live = None;
        state.owned.take()
    };
    if let Some(server) = owned {
        server.stop();
    }
}

/// The window the app is on once a server is live, and none while the boot is under way.
pub fn show_current_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(label) = app.state::<Shell>().window_label() {
        window::bring_forward(app, &label);
    }
}

fn ask<T: serde::de::DeserializeOwned>(door: &Door, args: &[&str]) -> Result<T, String> {
    door.ask(args).map_err(|error| match error {
        DoorError::Refused(reason) | DoorError::Fault(reason) => reason,
    })
}

pub fn open_data_folder<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let target = app
        .state::<Shell>()
        .target()
        .ok_or_else(|| "The server is not up yet.".to_owned())?;
    app.opener()
        .open_path(&target.data_dir, None::<&str>)
        .map_err(|error| error.to_string())
}

/// A server the shell adopted wrote no log here, but an earlier one on this data dir may have.
pub fn show_server_log<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let target = app
        .state::<Shell>()
        .target()
        .ok_or_else(|| "The server is not up yet.".to_owned())?;
    let log = server_log::server_log_path(Path::new(&target.data_dir));
    if !log.exists() {
        return Err("Nothing has been logged yet.".to_owned());
    }
    app.opener()
        .reveal_item_in_dir(log)
        .map_err(|error| error.to_string())
}

/// A browser holds no bearer, so it signs in once through a handoff the server mints.
pub fn open_in_browser<R: Runtime>(app: &AppHandle<R>) {
    let shell = app.state::<Shell>();
    let Some(target) = shell.target() else {
        return;
    };
    let handoff = shell.door().and_then(|door| {
        let mut door = door;
        door.env
            .insert("INTELIGIR_DATA_DIR".into(), target.data_dir.into());
        ask::<Handoff>(&door, &["handoff"])
    });
    let opened = handoff.and_then(|handoff| {
        app.opener()
            .open_url(handoff.url, None::<&str>)
            .map_err(|error| error.to_string())
    });
    if let Err(reason) = opened {
        app.dialog()
            .message(reason)
            .title("Could not open Inteligir in the browser")
            .kind(MessageDialogKind::Error)
            .blocking_show();
    }
}
