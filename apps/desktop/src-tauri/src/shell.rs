//! The shell's one state: the vault it is on, the server behind it and the window that shows it,
//! and the moves between them. A launch boots the vault the server's rules name, or opens the first
//! run when nothing chose one; a switch is a new server and a new window, and any failure puts the
//! previous vault back. Every rule about which vault is asked of the CLI (`door.rs`); what is here
//! is the order of the moves.

use std::collections::{BTreeMap, HashSet};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use tauri::{AppHandle, Manager, Runtime};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

use crate::diagnostics::{self, Diagnostics, ServerRun};
use crate::door::{Door, DoorError};
use crate::launch::{FolderSync, Handoff, Launch, Opening, Plan, Proposal, Target};
use crate::runtime::{self, NodeRuntime};
use crate::server::{self, Live, OwnedServer, ServerSpec, Started};
use crate::server_log::{self, SERVER_LOG_MAX_BYTES, ServerLog};
use crate::vaults::{self, VaultsState};
use crate::window::{self, AppWindow};

const ADOPTED_SWITCH_REASON: &str = "This server was started outside the app, so the app cannot restart it on another vault. Stop it and reopen Inteligir to switch.";

/// The first run's handed-out folders: every folder the page names back is one the shell gave it.
pub struct FirstRun {
    pub proposal: Proposal,
    pub parents: HashSet<String>,
    pub folders: HashSet<String>,
}

#[derive(Default)]
struct State {
    door: Option<Door>,
    target: Option<Target>,
    live: Option<Live>,
    owned: Option<Arc<OwnedServer>>,
    window: Option<String>,
    first_run: Option<FirstRun>,
    diagnostics: Option<Diagnostics>,
    recent: Vec<String>,
    switching: bool,
    windows_made: u32,
}

pub struct Shell {
    /// The shell's own folder (the recent list, the debug choice): Electron's userData, kept so an
    /// upgrade keeps both.
    pub own_dir: PathBuf,
    pub bundled: bool,
    state: Mutex<State>,
}

/// A refusal is answered as a value; `reported` means the shell already said it in a dialog,
/// because the window that asked is gone or the app is quitting.
pub enum Outcome {
    Done,
    Refused(String),
    Reported(String),
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

    pub fn with_first_run<T>(&self, read: impl FnOnce(&mut FirstRun) -> T) -> Option<T> {
        self.lock().first_run.as_mut().map(read)
    }

    fn recent_path(&self) -> PathBuf {
        self.own_dir.join(vaults::RECENT_VAULTS_FILE_NAME)
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

/// Said once and fatal: the app has nothing to show without a vault.
fn fail_start<R: Runtime>(app: &AppHandle<R>, reason: &str) {
    eprintln!("[desktop] Inteligir failed to start: {reason}");
    app.dialog()
        .message(reason)
        .title("Inteligir failed to start")
        .kind(MessageDialogKind::Error)
        .blocking_show();
    app.exit(1);
}

/// The launch, on a thread of its own: the login shell, the CLI and the first boot all take time
/// the main thread must not wait out.
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
    // every node child from here on runs with the login shell's PATH and the Mac's git
    door.env.extend(
        launch
            .env
            .into_iter()
            .map(|(name, value)| (name.into(), value.into())),
    );
    {
        let mut state = shell.lock();
        state.door = Some(door);
        state.recent = vaults::read_recent(&shell.recent_path());
        state.diagnostics = Some(Diagnostics::new(
            shell.own_dir.join(diagnostics::DIAGNOSTICS_FILE_NAME),
            shell.bundled,
        ));
    }
    crate::menu::rebuild(app);
    crate::updater::start(app);
    match launch.plan {
        Plan::FirstRun => {
            {
                let mut state = shell.lock();
                state.first_run = Some(FirstRun {
                    parents: HashSet::from([launch.proposal.parent.clone()]),
                    folders: HashSet::new(),
                    proposal: launch.proposal,
                });
            }
            if let Err(error) = window::create_first_run_window(app) {
                fail_start(app, &error.to_string());
            }
        }
        Plan::Boot => {
            if let Err(reason) = boot_vault(app, launch.target, "/") {
                fail_start(app, &reason);
            }
        }
    }
}

/// The server first, then the window that loads from it. On failure nothing of this boot is left
/// running.
pub fn boot_vault<R: Runtime>(
    app: &AppHandle<R>,
    target: Target,
    path: &str,
) -> Result<(), String> {
    let shell = app.state::<Shell>();
    let door = shell.door()?;
    let debug = shell
        .with_diagnostics(|diagnostics| diagnostics.debug())
        .unwrap_or(false);
    let mut env = door.env.clone();
    env.insert("INTELIGIR_DATA_DIR".into(), target.data_dir.clone().into());
    env.insert(
        "INTELIGIR_VAULT_DIR".into(),
        target.vault_dir.clone().into(),
    );
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
        format!("vault-{}", state.windows_made)
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
            path,
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
        state.recent = vaults::remember(&state.recent, &target.vault_dir);
        if let Err(error) = vaults::write_recent(&shell.recent_path(), &state.recent) {
            eprintln!("[desktop] could not write the recent-vaults list: {error}");
        }
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

/// The child's ordered shutdown flushes the vault's pending commit; nothing moves until it has.
/// An adopted server is nobody's to stop and outlives the shell.
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

/// The window the app is on: the vault's once a server is live, the first run's before the first
/// vault opens, and none while a boot is under way.
pub fn show_current_window<R: Runtime>(app: &AppHandle<R>) {
    let shell = app.state::<Shell>();
    let label = shell.window_label();
    if let Some(label) = label {
        window::bring_forward(app, &label);
        return;
    }
    if shell.with_first_run(|_| ()).is_some() {
        window::bring_forward(app, window::FIRST_RUN);
    }
}

pub fn vaults_state<R: Runtime>(app: &AppHandle<R>) -> Option<VaultsState> {
    let shell = app.state::<Shell>();
    let state = shell.lock();
    let target = state.target.as_ref()?;
    let blocked = if state.owned.is_none() {
        Some(ADOPTED_SWITCH_REASON.to_owned())
    } else {
        target.switch_blocked.clone()
    };
    let recent = vaults::offered(&state.recent, Some(&target.vault_dir), |path| {
        Path::new(path).exists()
    });
    Some(VaultsState {
        blocked,
        current: vaults::vault_ref(&target.vault_dir),
        recent: recent.iter().map(|path| vaults::vault_ref(path)).collect(),
    })
}

pub fn remember_list<R: Runtime>(app: &AppHandle<R>) -> Vec<String> {
    let shell = app.state::<Shell>();
    let state = shell.lock();
    let current = state
        .target
        .as_ref()
        .map(|target| target.vault_dir.as_str());
    vaults::offered(&state.recent, current, |path| Path::new(path).exists())
}

pub fn forget_vault<R: Runtime>(app: &AppHandle<R>, path: &str) {
    let shell = app.state::<Shell>();
    {
        let mut state = shell.lock();
        state.recent = vaults::forget(&state.recent, path);
        if let Err(error) = vaults::write_recent(&shell.recent_path(), &state.recent) {
            eprintln!("[desktop] could not write the recent-vaults list: {error}");
        }
    }
    crate::menu::rebuild(app);
}

pub fn is_remembered<R: Runtime>(app: &AppHandle<R>, path: &str) -> bool {
    app.state::<Shell>()
        .lock()
        .recent
        .iter()
        .any(|each| each == path)
}

fn ask<T: serde::de::DeserializeOwned>(door: &Door, args: &[&str]) -> Result<T, String> {
    door.ask(args).map_err(|error| match error {
        DoorError::Refused(reason) | DoorError::Fault(reason) => reason,
    })
}

/// The folder's own service keeps syncing it and the app will not: a picked switch asks first, in
/// the first run's words.
pub fn confirm_outside_sync<R: Runtime>(
    app: &AppHandle<R>,
    vault_dir: &str,
) -> Result<bool, String> {
    let door = app.state::<Shell>().door()?;
    let sync: FolderSync = ask(&door, &["sync", vault_dir])?;
    let Some(warning) = sync.warning else {
        return Ok(true);
    };
    Ok(app
        .dialog()
        .message(warning.detail)
        .title(warning.headline)
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Open".to_owned(),
            "Cancel".to_owned(),
        ))
        .blocking_show())
}

/// A switch: planned and refused before anything moves, then the old server stopped, the selector
/// written, the new server and window up. Any failure after the stop puts the previous vault back,
/// and a selector that cannot be put back ends the app rather than leave config.json naming the
/// vault that failed.
pub fn switch_vault<R: Runtime>(app: &AppHandle<R>, vault_dir: &str, confirm: bool) -> Outcome {
    let shell = app.state::<Shell>();
    let (door, previous, owns, previous_window) = {
        let state = shell.lock();
        let (Some(door), Some(previous)) = (state.door.clone(), state.target.clone()) else {
            return Outcome::Refused("No vault is open yet.".to_owned());
        };
        (door, previous, state.owned.is_some(), state.window.clone())
    };
    if !owns {
        return Outcome::Refused(ADOPTED_SWITCH_REASON.to_owned());
    }
    let opening: Opening = match ask(&door, &["plan-switch", vault_dir]) {
        Ok(opening) => opening,
        Err(reason) => return Outcome::Refused(reason),
    };
    if confirm {
        match confirm_outside_sync(app, &opening.vault_dir) {
            Ok(true) => {}
            Ok(false) => return Outcome::Done,
            Err(reason) => return Outcome::Refused(reason),
        }
    }
    {
        let mut state = shell.lock();
        if state.switching {
            return Outcome::Refused("Another vault is already opening.".to_owned());
        }
        state.switching = true;
    }
    let outcome = run_switch(app, &door, &previous, &opening, previous_window.as_deref());
    shell.lock().switching = false;
    outcome
}

fn run_switch<R: Runtime>(
    app: &AppHandle<R>,
    door: &Door,
    previous: &Target,
    opening: &Opening,
    previous_window: Option<&str>,
) -> Outcome {
    stop_owned_server(app);
    let close_previous = || {
        if let Some(label) = previous_window
            && let Some(window) = app.get_webview_window(label)
            && let Err(error) = window.destroy()
        {
            eprintln!("[desktop] could not close the previous window: {error}");
        }
    };
    let selected = select(door, opening.selector.as_deref());
    let failure = match selected {
        Ok(target) => match boot_vault(app, target, "/") {
            Ok(()) => {
                close_previous();
                return Outcome::Done;
            }
            Err(reason) => (reason, true),
        },
        Err(reason) => (reason, false),
    };
    let (reason, selector_written) = failure;
    eprintln!("[desktop] the vault did not open; returning to the previous one: {reason}");
    let restored = if selector_written {
        select(door, Some(&previous.vault_dir)).map(|_| ())
    } else {
        Ok(())
    }
    .and_then(|()| {
        stop_owned_server(app);
        boot_vault(app, previous.clone(), "/")
    });
    if let Err(reopen) = restored {
        let reason = format!("{reopen} Reopen Inteligir to continue.");
        app.dialog()
            .message(&reason)
            .title("Inteligir could not reopen the vault")
            .kind(MessageDialogKind::Error)
            .blocking_show();
        app.exit(1);
        return Outcome::Reported(reason);
    }
    close_previous();
    let reason = format!("Could not open {}: {reason}", opening.vault_dir);
    app.dialog()
        .message(&reason)
        .title("Could not open the vault")
        .kind(MessageDialogKind::Error)
        .blocking_show();
    Outcome::Reported(reason)
}

/// Writes config.json's selector (None clears it) and answers the vault the next boot resolves,
/// re-read after the write as the CLI would.
/// Points config.json at a vault (`None`: the default). The door takes back a selection its boot
/// then refuses, so an `Err` here left the selector as it was and there is nothing to put back.
fn select(door: &Door, vault_dir: Option<&str>) -> Result<Target, String> {
    match vault_dir {
        Some(vault_dir) => ask(door, &["select", vault_dir]),
        None => ask(door, &["select", "--default"]),
    }
}

/// The first run's choice: planned against the server's rules, the selector written, the vault
/// booted; a failed boot takes the selector back out, so the next launch asks again.
pub fn finish_first_run<R: Runtime>(app: &AppHandle<R>, plan_args: &[&str]) -> Outcome {
    let shell = app.state::<Shell>();
    let door = match shell.door() {
        Ok(door) => door,
        Err(reason) => return Outcome::Refused(reason),
    };
    let opening: Opening = match ask(&door, plan_args) {
        Ok(opening) => opening,
        Err(reason) => return Outcome::Refused(reason),
    };
    {
        let mut state = shell.lock();
        if state.switching {
            return Outcome::Refused("The vault is already opening.".to_owned());
        }
        state.switching = true;
    }
    let booted = select(&door, opening.selector.as_deref())
        .map_err(|reason| (reason, false))
        .and_then(|target| {
            boot_vault(app, target, window::WELCOME_PATH).map_err(|reason| (reason, true))
        });
    shell.lock().switching = false;
    match booted {
        Ok(()) => {
            shell.lock().first_run = None;
            if let Some(first_run) = app.get_webview_window(window::FIRST_RUN)
                && let Err(error) = first_run.destroy()
            {
                eprintln!("[desktop] could not close the first run: {error}");
            }
            Outcome::Done
        }
        Err((reason, selector_written)) => {
            stop_owned_server(app);
            shell.lock().target = None;
            let residue = if selector_written && opening.selector.is_some() {
                match select(&door, None) {
                    Ok(_) => String::new(),
                    Err(error) => format!(" The next launch will try it again ({error})."),
                }
            } else {
                String::new()
            };
            Outcome::Refused(format!(
                "Could not open {}: {reason}{residue}",
                opening.vault_dir
            ))
        }
    }
}

pub fn ask_door<T: serde::de::DeserializeOwned, R: Runtime>(
    app: &AppHandle<R>,
    args: &[&str],
) -> Result<T, String> {
    let door = app.state::<Shell>().door()?;
    ask(&door, args)
}

pub fn open_data_folder<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let target = app
        .state::<Shell>()
        .target()
        .ok_or_else(|| "No vault is open yet.".to_owned())?;
    app.opener()
        .open_path(&target.data_dir, None::<&str>)
        .map_err(|error| error.to_string())
}

/// A server the shell adopted wrote no log here, but an earlier one on this data dir may have.
pub fn show_server_log<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    let target = app
        .state::<Shell>()
        .target()
        .ok_or_else(|| "No vault is open yet.".to_owned())?;
    let log = server_log::server_log_path(Path::new(&target.data_dir));
    if !log.exists() {
        return Err("Nothing has been logged for this vault yet.".to_owned());
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
