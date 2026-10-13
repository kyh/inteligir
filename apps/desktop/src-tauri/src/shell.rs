//! The shell's one state: the vault it is on, the server behind it and the window that shows it,
//! and the moves between them. A launch boots the vault the server's rules name, or opens the first
//! run when nothing chose one; a switch is a new server and a new window, and any failure puts the
//! previous vault back. Every rule about which vault is asked of the CLI (`door.rs`); what is here
//! is the order of the moves.

use std::collections::{BTreeMap, HashSet};
use std::ffi::OsString;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

use crate::diagnostics::{self, Diagnostics, ServerRun};
use crate::door::Door;
use crate::launch::{FolderSync, Handoff, Launch, Opening, Plan, Proposal, Target};
use crate::runtime::{self, NodeRuntime};
use crate::server::{self, OwnedServer, ServerSpec, Started};
use crate::server_log::{self, SERVER_LOG_MAX_BYTES, ServerLog};
use crate::vaults::{self, VaultsState};
use crate::window::{self, AppWindow};

pub const NO_VAULT: &str = "No vault is open yet.";
const ADOPTED_SWITCH_REASON: &str = "This server was started outside the app, so the app cannot restart it on another vault. Stop it and reopen Inteligir to switch.";
const SWITCHING_REASON: &str = "Another vault is already opening.";
const OWN_DIR_NAME: &str = "desktop";

// the CLI's names for what the shell pins on a child (`apps/cli/src/server/config.ts`,
// `ui-dev-server.ts`), held equal by `tools/repo-guards/src/desktop-shell-wire.test.ts`
const DATA_DIR_ENV_VAR: &str = "INTELIGIR_DATA_DIR";
const VAULT_DIR_ENV_VAR: &str = "INTELIGIR_VAULT_DIR";
const UI_DEV_URL_ENV_VAR: &str = "INTELIGIR_UI_DEV_URL";

/// The first run's handed-out folders: every folder the page names back is one the shell gave it.
pub struct FirstRun {
    pub proposal: Proposal,
    pub parents: HashSet<String>,
    pub folders: HashSet<String>,
}

/// What a launch settles for the life of the app.
#[derive(Clone)]
struct Launched {
    door: Door,
    /// The recent list, the debug choice and WebKitGTK's stores, under the root data dir the launch
    /// resolved: a development shell's is its checkout's, so two checkouts share none of them.
    own_dir: PathBuf,
}

impl Launched {
    fn recent_path(&self) -> PathBuf {
        self.own_dir.join(vaults::RECENT_VAULTS_FILE_NAME)
    }

    fn webview_dir(&self, data_dir: &str) -> PathBuf {
        self.own_dir
            .join("webview")
            .join(hex16(&window::data_store_id(data_dir)))
    }
}

/// Where the shell is, which says what its window shows and what may happen next.
#[derive(Default)]
enum Phase {
    /// The launch has not settled on a vault or a first run yet.
    #[default]
    Starting,
    /// No vault yet: the first run's window asks for one, and `booting` while its choice opens.
    FirstRun {
        first_run: FirstRun,
        booting: bool,
    },
    /// The previous vault's server is stopped, and its window stays up until the next one opens.
    Switching {
        previous: Target,
        window: String,
    },
    Open(Open),
    /// The server is stopped for a quit or an install, and nothing opens after it.
    Closing,
}

/// A vault on screen: its window, and the server behind it.
struct Open {
    target: Target,
    server: Server,
    window: String,
}

/// A server the shell started is the shell's to stop; one it adopted is nobody's and outlives it.
enum Server {
    Owned {
        server: Arc<OwnedServer>,
        /// The diagnostics choice it started with.
        debug: bool,
    },
    Adopted,
}

impl Server {
    const fn run(&self) -> ServerRun {
        match self {
            Self::Owned { debug, .. } => ServerRun::Owned { debug: *debug },
            Self::Adopted => ServerRun::Adopted,
        }
    }
}

/// What a switch leaves: the vault on screen, its window, and the server the shell started for it.
struct Leaving {
    target: Target,
    window: String,
    server: Arc<OwnedServer>,
}

impl Phase {
    /// The vault on screen: the open one, or the previous one while a switch is under way.
    fn shown(&self) -> Option<(&Target, &str)> {
        match self {
            Self::Open(open) => Some((&open.target, &open.window)),
            Self::Switching { previous, window } => Some((previous, window)),
            Self::Starting | Self::FirstRun { .. } | Self::Closing => None,
        }
    }

    /// A switch leaves only a vault whose server the shell started; anything else says why not.
    fn leaving(&self) -> Result<Leaving, &'static str> {
        match self {
            Self::Open(Open {
                target,
                server: Server::Owned { server, .. },
                window,
            }) => Ok(Leaving {
                target: target.clone(),
                window: window.clone(),
                server: Arc::clone(server),
            }),
            Self::Open(_) => Err(ADOPTED_SWITCH_REASON),
            Self::Switching { .. } => Err(SWITCHING_REASON),
            Self::Starting | Self::FirstRun { .. } | Self::Closing => Err(NO_VAULT),
        }
    }
}

#[derive(Default)]
struct State {
    launched: Option<Launched>,
    phase: Phase,
    diagnostics: Option<Diagnostics>,
    recent: Vec<String>,
    windows_made: u32,
}

impl State {
    /// What the page and the menus offer: the vault on screen, the others remembered, and why a
    /// switch would be refused, if it would.
    fn vaults(&self, exists: impl Fn(&str) -> bool) -> Option<VaultsState> {
        let (target, blocked) = match &self.phase {
            Phase::Open(Open {
                target,
                server: Server::Owned { .. },
                ..
            }) => (target, target.switch_blocked.clone()),
            Phase::Open(Open {
                target,
                server: Server::Adopted,
                ..
            }) => (target, Some(ADOPTED_SWITCH_REASON.to_owned())),
            Phase::Switching { previous, .. } => (previous, Some(SWITCHING_REASON.to_owned())),
            Phase::Starting | Phase::FirstRun { .. } | Phase::Closing => return None,
        };
        let recent = vaults::offered(&self.recent, Some(&target.vault_dir), exists);
        Some(VaultsState {
            blocked,
            current: vaults::vault_ref(&target.vault_dir),
            recent: recent.iter().map(|path| vaults::vault_ref(path)).collect(),
        })
    }
}

pub struct Shell {
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
    pub fn new(bundled: bool) -> Self {
        Self {
            bundled,
            state: Mutex::new(State::default()),
        }
    }

    fn lock(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn launched(&self) -> Result<Launched, String> {
        self.lock()
            .launched
            .clone()
            .ok_or_else(|| "the app is still starting".to_owned())
    }

    fn door(&self) -> Result<Door, String> {
        self.launched().map(|launched| launched.door)
    }

    /// The vault on screen, the previous one while a switch is under way.
    pub fn target(&self) -> Option<Target> {
        self.lock().phase.shown().map(|(target, _)| target.clone())
    }

    /// The diagnostics beside the server behind the open vault's window; None while no vault is
    /// open, since only that server says whether the choice reaches it.
    pub fn with_diagnostics<T>(
        &self,
        read: impl FnOnce(&mut Diagnostics, ServerRun) -> T,
    ) -> Option<T> {
        let mut state = self.lock();
        let State {
            phase, diagnostics, ..
        } = &mut *state;
        let Phase::Open(open) = phase else {
            return None;
        };
        diagnostics
            .as_mut()
            .map(|diagnostics| read(diagnostics, open.server.run()))
    }

    /// The choice the next start of the server runs with.
    fn debug_choice(&self) -> bool {
        self.lock()
            .diagnostics
            .as_ref()
            .is_some_and(Diagnostics::debug)
    }

    pub fn with_first_run<T>(&self, read: impl FnOnce(&mut FirstRun) -> T) -> Option<T> {
        match &mut self.lock().phase {
            Phase::FirstRun { first_run, .. } => Some(read(first_run)),
            _ => None,
        }
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

/// What a vault's server runs with: the door's env and the target's vault, pinned so a selector
/// rewritten since cannot move it. The data dir is the CLI's to derive from the root and that
/// vault, as the target's was: a pinned one is the root too, and the child would read config.json
/// from the vault's own dir, where nothing writes one.
fn server_env(
    door_env: &BTreeMap<OsString, OsString>,
    target: &Target,
) -> BTreeMap<OsString, OsString> {
    let mut env = door_env.clone();
    env.insert(VAULT_DIR_ENV_VAR.into(), target.vault_dir.clone().into());
    env
}

/// Said once and fatal: the app has nothing to show without a vault.
fn fail_start(app: &AppHandle, reason: &str) {
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
pub fn start(app: &AppHandle) {
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
        Err(reason) => return fail_start(app, &reason),
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
        let launched = Launched {
            door,
            own_dir: Path::new(&launch.target.root_data_dir).join(OWN_DIR_NAME),
        };
        let mut state = shell.lock();
        state.recent = vaults::read_recent(&launched.recent_path());
        state.diagnostics = Some(Diagnostics::new(
            launched.own_dir.join(diagnostics::DIAGNOSTICS_FILE_NAME),
            shell.bundled,
        ));
        state.launched = Some(launched);
    }
    crate::menu::rebuild(app);
    crate::updater::start(app);
    match launch.plan {
        Plan::FirstRun => {
            shell.lock().phase = Phase::FirstRun {
                first_run: FirstRun {
                    parents: HashSet::from([launch.proposal.parent.clone()]),
                    folders: HashSet::new(),
                    proposal: launch.proposal,
                },
                booting: false,
            };
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
pub fn boot_vault(app: &AppHandle, target: Target, path: &str) -> Result<(), String> {
    let shell = app.state::<Shell>();
    let launched = shell.launched()?;
    let door = &launched.door;
    let debug = shell.debug_choice();
    let mut env = server_env(&door.env, &target);
    // under `tauri dev` the server answers the page's files from Vite, so an edit reloads in place
    // while the window keeps its server's origin (apps/cli/src/server/ui-dev-server.ts)
    if tauri::is_dev()
        && let Some(dev_url) = &app.config().build.dev_url
    {
        env.insert(UI_DEV_URL_ENV_VAR.into(), dev_url.to_string().into());
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
    let (live, server) = match started {
        Started::Owned { live, server } => (
            live,
            Server::Owned {
                server: Arc::new(server),
                debug,
            },
        ),
        Started::Adopted { live } => {
            println!(
                "[desktop] adopting the server already serving {}",
                target.data_dir
            );
            (live, Server::Adopted)
        }
    };
    let label = {
        let mut state = shell.lock();
        state.windows_made += 1;
        format!("vault-{}", state.windows_made)
    };
    let made = window::create_app_window(
        app,
        &AppWindow {
            label: &label,
            origin: &live.origin,
            handoff_url: &live.handoff_url,
            path,
            data_dir: &target.data_dir,
            webview_dir: launched.webview_dir(&target.data_dir),
            log,
        },
    );
    if let Err(error) = made {
        if let Server::Owned { server, .. } = server {
            server.stop();
        }
        return Err(format!("the window could not open: {error}"));
    }
    {
        let mut state = shell.lock();
        state.recent = vaults::remember(&state.recent, &target.vault_dir);
        if let Err(error) = vaults::write_recent(&launched.recent_path(), &state.recent) {
            eprintln!("[desktop] could not write the recent-vaults list: {error}");
        }
        state.phase = Phase::Open(Open {
            target,
            server,
            window: label,
        });
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

/// The app is ending, for a quit or an install: the child's ordered shutdown flushes the vault's
/// pending commit before anything moves on, and nothing opens after it. An adopted server is
/// nobody's to stop and outlives the shell.
pub fn stop_owned_server(app: &AppHandle) {
    let ended = std::mem::replace(&mut app.state::<Shell>().lock().phase, Phase::Closing);
    if let Phase::Open(Open {
        server: Server::Owned { server, .. },
        ..
    }) = ended
    {
        server.stop();
    }
}

/// The window the app is on: the vault's (the previous one's while a switch is under way), the
/// first run's before the first vault opens, and none while the launch's boot is under way.
pub fn show_current_window(app: &AppHandle) {
    let label = match &app.state::<Shell>().lock().phase {
        Phase::FirstRun { .. } => Some(window::FIRST_RUN.to_owned()),
        phase => phase.shown().map(|(_, window)| window.to_owned()),
    };
    if let Some(label) = label {
        window::bring_forward(app, &label);
    }
}

pub fn vaults_state(app: &AppHandle) -> Option<VaultsState> {
    app.state::<Shell>()
        .lock()
        .vaults(|path| Path::new(path).exists())
}

pub fn remember_list(app: &AppHandle) -> Vec<String> {
    let shell = app.state::<Shell>();
    let state = shell.lock();
    let current = state
        .phase
        .shown()
        .map(|(target, _)| target.vault_dir.as_str());
    vaults::offered(&state.recent, current, |path| Path::new(path).exists())
}

pub fn forget_vault(app: &AppHandle, path: &str) {
    let shell = app.state::<Shell>();
    {
        let mut state = shell.lock();
        state.recent = vaults::forget(&state.recent, path);
        if let Some(launched) = &state.launched
            && let Err(error) = vaults::write_recent(&launched.recent_path(), &state.recent)
        {
            eprintln!("[desktop] could not write the recent-vaults list: {error}");
        }
    }
    crate::menu::rebuild(app);
}

pub fn is_remembered(app: &AppHandle, path: &str) -> bool {
    app.state::<Shell>()
        .lock()
        .recent
        .iter()
        .any(|each| each == path)
}

/// The folder's own service keeps syncing it and the app will not: a picked switch asks first, in
/// the first run's words.
pub fn confirm_outside_sync(app: &AppHandle, vault_dir: &str) -> Result<bool, String> {
    let door = app.state::<Shell>().door()?;
    let sync: FolderSync = door.ask(&["sync", vault_dir])?;
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
pub fn switch_vault(app: &AppHandle, vault_dir: &str, confirm: bool) -> Outcome {
    let shell = app.state::<Shell>();
    if let Err(reason) = shell.lock().phase.leaving() {
        return Outcome::Refused(reason.to_owned());
    }
    let door = match shell.door() {
        Ok(door) => door,
        Err(reason) => return Outcome::Refused(reason),
    };
    let opening: Opening = match door.ask(&["plan-switch", vault_dir]) {
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
    // asked again: another switch may have begun or ended while the plan and the question were out
    let leaving = {
        let mut state = shell.lock();
        match state.phase.leaving() {
            Ok(leaving) => {
                state.phase = Phase::Switching {
                    previous: leaving.target.clone(),
                    window: leaving.window.clone(),
                };
                leaving
            }
            Err(reason) => return Outcome::Refused(reason.to_owned()),
        }
    };
    leaving.server.stop();
    run_switch(app, &door, &leaving, &opening)
}

/// A failed boot left nothing running, so the way back is the previous vault's boot alone.
fn run_switch(app: &AppHandle, door: &Door, leaving: &Leaving, opening: &Opening) -> Outcome {
    let close_previous = || {
        if let Some(window) = app.get_webview_window(&leaving.window)
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
        select(door, Some(&leaving.target.vault_dir)).map(|_| ())
    } else {
        Ok(())
    }
    .and_then(|()| boot_vault(app, leaving.target.clone(), "/"));
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

/// Points config.json at a vault (`None`: the default) and answers the vault the next boot
/// resolves. The door takes back a selection its boot then refuses, so an `Err` here left the
/// selector as it was and there is nothing to put back.
fn select(door: &Door, vault_dir: Option<&str>) -> Result<Target, String> {
    match vault_dir {
        Some(vault_dir) => door.ask(&["select", vault_dir]),
        None => door.ask(&["select", "--default"]),
    }
}

/// The first run's choice: planned against the server's rules, the selector written, the vault
/// booted; a failed boot takes the selector back out, so the next launch asks again.
pub fn finish_first_run(app: &AppHandle, plan_args: &[&str]) -> Outcome {
    let shell = app.state::<Shell>();
    let door = match shell.door() {
        Ok(door) => door,
        Err(reason) => return Outcome::Refused(reason),
    };
    let opening: Opening = match door.ask(plan_args) {
        Ok(opening) => opening,
        Err(reason) => return Outcome::Refused(reason),
    };
    match &mut shell.lock().phase {
        Phase::FirstRun { booting, .. } if !*booting => *booting = true,
        Phase::FirstRun { .. } => {
            return Outcome::Refused("The vault is already opening.".to_owned());
        }
        _ => return Outcome::Refused("The first run is over.".to_owned()),
    }
    let booted = select(&door, opening.selector.as_deref())
        .map_err(|reason| (reason, false))
        .and_then(|target| {
            boot_vault(app, target, window::WELCOME_PATH).map_err(|reason| (reason, true))
        });
    match booted {
        Ok(()) => {
            if let Some(first_run) = app.get_webview_window(window::FIRST_RUN)
                && let Err(error) = first_run.destroy()
            {
                eprintln!("[desktop] could not close the first run: {error}");
            }
            Outcome::Done
        }
        Err((reason, selector_written)) => {
            if let Phase::FirstRun { booting, .. } = &mut shell.lock().phase {
                *booting = false;
            }
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

pub fn ask_door<T: serde::de::DeserializeOwned>(
    app: &AppHandle,
    args: &[&str],
) -> Result<T, String> {
    app.state::<Shell>().door()?.ask(args)
}

pub fn open_data_folder(app: &AppHandle) -> Result<(), String> {
    let target = app
        .state::<Shell>()
        .target()
        .ok_or_else(|| NO_VAULT.to_owned())?;
    app.opener()
        .open_path(&target.data_dir, None::<&str>)
        .map_err(|error| error.to_string())
}

/// A server the shell adopted wrote no log here, but an earlier one on this data dir may have.
pub fn show_server_log(app: &AppHandle) -> Result<(), String> {
    let target = app
        .state::<Shell>()
        .target()
        .ok_or_else(|| NO_VAULT.to_owned())?;
    let log = server_log::server_log_path(Path::new(&target.data_dir));
    if !log.exists() {
        return Err("Nothing has been logged for this vault yet.".to_owned());
    }
    app.opener()
        .reveal_item_in_dir(log)
        .map_err(|error| error.to_string())
}

/// A browser holds no bearer, so it signs in once through a handoff the server mints.
pub fn open_in_browser(app: &AppHandle) {
    let shell = app.state::<Shell>();
    let Some(target) = shell.target() else {
        return;
    };
    let handoff = shell.door().and_then(|door| {
        let mut door = door;
        door.env
            .insert(DATA_DIR_ENV_VAR.into(), target.data_dir.into());
        door.ask::<Handoff>(&["handoff"])
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

#[cfg(test)]
mod tests {
    use std::ffi::OsStr;

    use super::*;

    fn target(vault_dir: &str) -> Target {
        Target {
            data_dir: "/h/.inteligir".to_owned(),
            vault_dir: vault_dir.to_owned(),
            root_data_dir: "/h/.inteligir".to_owned(),
            switch_blocked: None,
        }
    }

    fn shell_in(phase: Phase) -> Shell {
        let shell = Shell::new(true);
        {
            let mut state = shell.lock();
            state.phase = phase;
            state.recent = vec!["/h/Notes".to_owned(), "/h/Work".to_owned()];
            state.diagnostics = Some(Diagnostics::new(
                PathBuf::from("/nowhere/diagnostics.json"),
                true,
            ));
        }
        shell
    }

    fn adopted(vault_dir: &str) -> Phase {
        Phase::Open(Open {
            target: target(vault_dir),
            server: Server::Adopted,
            window: "vault-1".to_owned(),
        })
    }

    #[test]
    fn a_vault_s_server_is_pinned_to_its_vault_and_left_to_derive_its_data_dir() {
        let door_env = BTreeMap::from([(OsString::from("PATH"), OsString::from("/usr/bin"))]);
        let env = server_env(&door_env, &target("/h/Notes"));
        assert_eq!(
            env.get(OsStr::new(VAULT_DIR_ENV_VAR)),
            Some(&OsString::from("/h/Notes"))
        );
        assert_eq!(
            env.get(OsStr::new("PATH")),
            Some(&OsString::from("/usr/bin"))
        );
        assert!(!env.contains_key(OsStr::new(DATA_DIR_ENV_VAR)));

        let pinned = BTreeMap::from([(OsString::from(DATA_DIR_ENV_VAR), OsString::from("/pin"))]);
        assert_eq!(
            server_env(&pinned, &target("/h/Notes")).get(OsStr::new(DATA_DIR_ENV_VAR)),
            Some(&OsString::from("/pin"))
        );
    }

    #[test]
    fn a_switch_under_way_blocks_another_in_its_own_words() {
        let shell = shell_in(Phase::Switching {
            previous: target("/h/Notes"),
            window: "vault-1".to_owned(),
        });
        let state = shell.lock();
        let vaults = state.vaults(|_| true);
        assert_eq!(
            vaults.as_ref().and_then(|vaults| vaults.blocked.as_deref()),
            Some(SWITCHING_REASON)
        );
        assert_eq!(
            vaults.map(|vaults| (vaults.current.path, vaults.recent.len())),
            Some(("/h/Notes".to_owned(), 1))
        );
        assert_eq!(state.phase.leaving().err(), Some(SWITCHING_REASON));
    }

    #[test]
    fn an_adopted_server_refuses_a_switch_and_says_so() {
        let shell = shell_in(adopted("/h/Notes"));
        let state = shell.lock();
        assert_eq!(
            state
                .vaults(|_| true)
                .and_then(|vaults| vaults.blocked)
                .as_deref(),
            Some(ADOPTED_SWITCH_REASON)
        );
        assert_eq!(state.phase.leaving().err(), Some(ADOPTED_SWITCH_REASON));
    }

    #[test]
    fn the_diagnostics_read_the_server_behind_the_open_vault() {
        let shell = shell_in(adopted("/h/Notes"));
        assert!(matches!(
            shell.with_diagnostics(|diagnostics, run| diagnostics.state(run)),
            Some(diagnostics::State::Adopted { .. })
        ));
        shell.lock().phase = Phase::Switching {
            previous: target("/h/Notes"),
            window: "vault-1".to_owned(),
        };
        assert!(shell.with_diagnostics(|_, run| run).is_none());
    }

    #[test]
    fn no_vault_on_screen_offers_no_vaults_and_no_switch() {
        let first_run = Phase::FirstRun {
            first_run: FirstRun {
                proposal: Proposal {
                    name: "Inteligir".to_owned(),
                    parent: "/h".to_owned(),
                },
                parents: HashSet::new(),
                folders: HashSet::new(),
            },
            booting: false,
        };
        for phase in [Phase::Starting, first_run, Phase::Closing] {
            let shell = shell_in(phase);
            let state = shell.lock();
            assert!(state.vaults(|_| true).is_none());
            assert_eq!(state.phase.leaving().err(), Some(NO_VAULT));
            assert!(state.phase.shown().is_none());
        }
    }
}
