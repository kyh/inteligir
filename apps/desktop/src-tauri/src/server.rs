//! The server is a child, and its one supervisor is this module.
//!
//! The shell starts the CLI's desktop entry with `serve`. Either the server boots and announces
//! itself on a ready line, or a server already serving this data dir at the bundled version is
//! adopted: the entry announces it and exits. One that holds the data dir but cannot be adopted
//! is refused in the person's words. Whatever the child prints is appended to the server log. On quit the shell sends SIGTERM and waits the server's own teardown budget before
//! SIGKILL, so the vault's pending commit is flushed. There is no restart: a fresh child mints a
//! fresh session, which the window's cookie does not hold.

use std::collections::BTreeMap;
use std::ffi::OsString;
use std::io::{BufRead, BufReader, Read};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, ExitStatus, Stdio};
use std::sync::mpsc::{self, RecvTimeoutError};
use std::sync::{Arc, Condvar, Mutex, PoisonError};
use std::thread;
use std::time::Duration;

use serde::Deserialize;

use crate::server_log::ServerLog;

/// A warm boot answers in well under a second; a first boot seeds and commits a vault.
pub const READY_TIMEOUT: Duration = Duration::from_secs(45);

/// The line the desktop entry prints once the server answers, before anything else it says is
/// read as the server's own output (`apps/cli/src/desktop/desktop-serve.ts`).
pub const READY_MARKER: &str = "inteligir-desktop:";

/// How long an exit waits for the child's stdout to be read to its end, so a line printed just
/// before the exit (an adoption, a refusal) reaches `start` ahead of the exit itself. Bounded,
/// since a grandchild that inherited the pipe would hold it open.
const DRAIN_WAIT: Duration = Duration::from_secs(2);

/// Where the window goes: the server's origin, and a one-time link that signs the window in.
#[derive(Debug, Clone, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Live {
    pub origin: String,
    pub handoff_url: String,
}

#[derive(Debug, PartialEq, Eq, Deserialize)]
#[serde(tag = "kind", rename_all = "kebab-case")]
enum Announcement {
    Ready {
        #[serde(flatten)]
        live: Live,
        /// How long a stop waits before SIGKILL: the server's own teardown budget plus headroom,
        /// announced rather than spelled here, since a shorter grace lands the kill mid-flush.
        #[serde(rename = "stopGraceMs")]
        stop_grace_ms: u64,
    },
    Adopted {
        #[serde(flatten)]
        live: Live,
    },
    Refused {
        reason: String,
    },
}

fn parse_announcement(line: &str) -> Option<Announcement> {
    serde_json::from_str(line.strip_prefix(READY_MARKER)?).ok()
}

pub struct ServerSpec {
    pub node: PathBuf,
    pub entry: PathBuf,
    pub args: Vec<String>,
    pub cwd: PathBuf,
    pub env: BTreeMap<OsString, OsString>,
    /// Shared with the window, which notes its own load beside what the server says.
    pub log: Arc<Mutex<ServerLog>>,
}

/// The child the shell started. Dropping it stops nothing: only `stop` does, and an adopted server
/// has no `OwnedServer` at all.
pub struct OwnedServer {
    pid: u32,
    exit: Arc<Exit>,
    stop_grace: Duration,
    // never written: the server reads its end to EOF, which comes only when this process is gone,
    // so a shell that crashes or is killed does not leave its server holding the data dir
    _lifeline: Option<ChildStdin>,
}

pub enum Started {
    Owned { live: Live, server: OwnedServer },
    Adopted { live: Live },
}

#[derive(Default)]
struct Exit {
    status: Mutex<ExitState>,
    changed: Condvar,
}

#[derive(Default)]
struct ExitState {
    exited: bool,
    code: Option<i32>,
    ready: bool,
    stopping: bool,
}

enum Event {
    Announced(Announcement),
    Exited(Option<i32>),
}

/// Reads a stream to its end on a thread of its own. The receiver it returns disconnects once the
/// stream has ended, which is what an exit waits on.
fn pump<R: Read + Send + 'static>(
    stream: R,
    log: Arc<Mutex<ServerLog>>,
    announce: Option<mpsc::Sender<Event>>,
) -> mpsc::Receiver<()> {
    let (drained, ended) = mpsc::channel();
    thread::spawn(move || {
        let _drained: mpsc::Sender<()> = drained;
        let mut announced = false;
        for line in BufReader::new(stream).lines().map_while(Result::ok) {
            if !announced
                && let Some(sender) = &announce
                && let Some(announcement) = parse_announcement(&line)
            {
                announced = true;
                let _ = sender.send(Event::Announced(announcement));
                continue;
            }
            println!("[server] {line}");
            log.lock()
                .unwrap_or_else(PoisonError::into_inner)
                .append(&line);
        }
    });
    ended
}

/// What the watcher reports a child's exit to.
struct Watched {
    exit: Arc<Exit>,
    log: Arc<Mutex<ServerLog>>,
    stdout_ended: Option<mpsc::Receiver<()>>,
    events: mpsc::Sender<Event>,
}

/// Waits the child out on a thread of its own, then says it exited: in the log, to whatever waits
/// in `stop`, and to `start` once the child's stdout has been read to its end, so an announcement
/// the child printed before it exited arrives first.
fn watch(
    mut child: Child,
    watched: Watched,
    on_unexpected_exit: impl FnOnce(Option<i32>) + Send + 'static,
) {
    thread::spawn(move || {
        let code = child
            .wait()
            .ok()
            .and_then(|status: ExitStatus| status.code());
        watched
            .log
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .append(&format!("server exited (code {})", describe(code)));
        // `start` reads `exited` under this lock as it takes the ready line, so exactly one of the
        // two tells of a server gone as it announced itself
        let unexpected = {
            let mut state = watched
                .exit
                .status
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            state.exited = true;
            state.code = code;
            state.ready && !state.stopping
        };
        watched.exit.changed.notify_all();
        if let Some(ended) = watched.stdout_ended {
            let _ = ended.recv_timeout(DRAIN_WAIT);
        }
        let _ = watched.events.send(Event::Exited(code));
        if unexpected {
            on_unexpected_exit(code);
        }
    });
}

/// Starts the server, or adopts the one already serving. `on_unexpected_exit` runs on the watcher
/// thread when a child that became ready exits with no `stop` asking it to.
pub fn start(
    spec: ServerSpec,
    on_unexpected_exit: impl FnOnce(Option<i32>) + Send + 'static,
) -> Result<Started, String> {
    let log = spec.log;
    log.lock()
        .unwrap_or_else(PoisonError::into_inner)
        .append("[desktop] starting the server");
    let mut command = Command::new(&spec.node);
    command
        .arg(&spec.entry)
        .args(&spec.args)
        .current_dir(&spec.cwd)
        .env_clear()
        .envs(&spec.env)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    // a process group of its own, so a signal to the shell's group (Ctrl-C under `tauri dev`, a
    // supervisor's killpg) reaches the shell alone, which stops the server once: a second signal
    // mid-shutdown reads as impatience to the server, which then leaves without its flush
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let mut child: Child = command.spawn().map_err(|error| {
        format!(
            "the server could not start ({}): {error}",
            spec.node.display()
        )
    })?;
    let pid = child.id();
    let lifeline = child.stdin.take();
    let (events, received) = mpsc::channel();
    let stdout_ended = child
        .stdout
        .take()
        .map(|stdout| pump(stdout, Arc::clone(&log), Some(events.clone())));
    if let Some(stderr) = child.stderr.take() {
        pump(stderr, Arc::clone(&log), None);
    }

    let exit = Arc::new(Exit::default());
    watch(
        child,
        Watched {
            exit: Arc::clone(&exit),
            log: Arc::clone(&log),
            stdout_ended,
            events,
        },
        on_unexpected_exit,
    );

    let mut server = OwnedServer {
        pid,
        exit,
        stop_grace: Duration::ZERO,
        _lifeline: lifeline,
    };
    match received.recv_timeout(READY_TIMEOUT) {
        Ok(Event::Announced(Announcement::Ready {
            live,
            stop_grace_ms,
        })) => {
            server.stop_grace = Duration::from_millis(stop_grace_ms);
            let gone = {
                let mut state = server
                    .exit
                    .status
                    .lock()
                    .unwrap_or_else(PoisonError::into_inner);
                state.ready = true;
                state.exited.then_some(state.code)
            };
            // it exited before its ready line was read, so the watcher left the telling here
            if let Some(code) = gone {
                return Err(format!(
                    "the server exited as soon as it was ready (code {}). Its log says why.",
                    describe(code)
                ));
            }
            Ok(Started::Owned { live, server })
        }
        // the entry exits once it has named the server it found; nothing of it is left to stop
        Ok(Event::Announced(Announcement::Adopted { live })) => Ok(Started::Adopted { live }),
        // so does one that refused: the reason is already in the person's words
        Ok(Event::Announced(Announcement::Refused { reason })) => Err(reason),
        Ok(Event::Exited(code)) => Err(format!(
            "the server exited before it was ready (code {}). Its log says why.",
            describe(code)
        )),
        Err(RecvTimeoutError::Timeout | RecvTimeoutError::Disconnected) => {
            server.kill();
            Err(format!(
                "the server was still booting when its {}s readiness wait ran out, so it was stopped; it had neither failed nor exited",
                READY_TIMEOUT.as_secs()
            ))
        }
    }
}

fn describe(code: Option<i32>) -> String {
    code.map_or_else(
        || "none: a signal ended it".to_owned(),
        |code| code.to_string(),
    )
}

impl OwnedServer {
    /// SIGTERM, then the server's own budget, then SIGKILL. Blocks: a quit has no later step to
    /// wait in, and the vault's pending commit is what the wait is for.
    pub fn stop(&self) {
        {
            let mut state = self
                .exit
                .status
                .lock()
                .unwrap_or_else(PoisonError::into_inner);
            if state.exited {
                return;
            }
            state.stopping = true;
        }
        signal(self.pid, Termination::Graceful);
        if self.wait_exit(self.stop_grace) {
            return;
        }
        eprintln!(
            "[desktop] the server did not exit within {}ms of SIGTERM; sending SIGKILL",
            self.stop_grace.as_millis()
        );
        self.kill();
        self.wait_exit(Duration::from_secs(5));
    }

    fn kill(&self) {
        let exited = self
            .exit
            .status
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
            .exited;
        if !exited {
            signal(self.pid, Termination::Forced);
        }
    }

    fn wait_exit(&self, within: Duration) -> bool {
        let state = self
            .exit
            .status
            .lock()
            .unwrap_or_else(PoisonError::into_inner);
        let (state, _) = self
            .exit
            .changed
            .wait_timeout_while(state, within, |state| !state.exited)
            .unwrap_or_else(PoisonError::into_inner);
        state.exited
    }
}

#[derive(Clone, Copy)]
enum Termination {
    Graceful,
    Forced,
}

#[cfg(unix)]
fn signal(pid: u32, termination: Termination) {
    use nix::sys::signal::{Signal, kill};
    use nix::unistd::Pid;
    let Ok(pid) = i32::try_from(pid) else {
        return;
    };
    let signal = match termination {
        Termination::Graceful => Signal::SIGTERM,
        Termination::Forced => Signal::SIGKILL,
    };
    // already gone: its exit is on its way to the watcher
    let _ = kill(Pid::from_raw(pid), signal);
}

#[cfg(not(unix))]
fn signal(_pid: u32, _termination: Termination) {}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_the_ready_and_adopted_lines() {
        let ready = parse_announcement(
            r#"inteligir-desktop:{"kind":"ready","origin":"http://127.0.0.1:4664","handoffUrl":"http://127.0.0.1:4664/?handoff=n","stopGraceMs":42000}"#,
        );
        assert_eq!(
            ready,
            Some(Announcement::Ready {
                live: Live {
                    origin: "http://127.0.0.1:4664".to_owned(),
                    handoff_url: "http://127.0.0.1:4664/?handoff=n".to_owned(),
                },
                stop_grace_ms: 42_000,
            })
        );
        let adopted = parse_announcement(
            r#"inteligir-desktop:{"kind":"adopted","origin":"http://127.0.0.1:4664","handoffUrl":"u"}"#,
        );
        assert!(matches!(adopted, Some(Announcement::Adopted { .. })));
        let refused =
            parse_announcement(r#"inteligir-desktop:{"kind":"refused","reason":"Stop it first."}"#);
        assert_eq!(
            refused,
            Some(Announcement::Refused {
                reason: "Stop it first.".to_owned()
            })
        );
    }

    // `/bin/sh -c <script>` in the entry's place: the races are the shell's, not node's
    #[cfg(unix)]
    fn spec_running(script: &str, dir: &std::path::Path) -> ServerSpec {
        ServerSpec {
            node: PathBuf::from("/bin/sh"),
            entry: PathBuf::from("-c"),
            args: vec![script.to_owned()],
            cwd: dir.to_path_buf(),
            env: BTreeMap::new(),
            log: Arc::new(Mutex::new(ServerLog::new(
                dir.join("server.log"),
                crate::server_log::SERVER_LOG_MAX_BYTES,
            ))),
        }
    }

    #[cfg(unix)]
    #[test]
    fn an_entry_that_announces_and_exits_at_once_is_adopted() -> std::io::Result<()> {
        let dir = tempfile::tempdir()?;
        let script = r#"echo 'inteligir-desktop:{"kind":"adopted","origin":"o","handoffUrl":"u"}'"#;
        for _ in 0..40 {
            let started = start(spec_running(script, dir.path()), |_| {});
            assert!(
                matches!(started, Ok(Started::Adopted { .. })),
                "the exit outran the announcement: {:?}",
                started.err()
            );
        }
        Ok(())
    }

    #[cfg(unix)]
    #[test]
    fn a_server_gone_as_it_announces_is_reported_exactly_once() -> std::io::Result<()> {
        let dir = tempfile::tempdir()?;
        let script = r#"echo 'inteligir-desktop:{"kind":"ready","origin":"o","handoffUrl":"u","stopGraceMs":1000}'"#;
        for _ in 0..40 {
            let (told, heard) = mpsc::channel();
            let started = start(spec_running(script, dir.path()), move |code| {
                let _ = told.send(code);
            });
            match started {
                // `start` said so, so the watcher must not
                Err(reason) => {
                    assert!(reason.contains("as soon as it was ready"), "{reason}");
                    assert!(heard.recv_timeout(Duration::from_millis(300)).is_err());
                }
                // the window would load a dead server unless the watcher says so
                Ok(Started::Owned { .. }) => {
                    assert_eq!(heard.recv_timeout(Duration::from_secs(5)), Ok(Some(0)));
                }
                Ok(Started::Adopted { .. }) => panic!("a ready line read as an adoption"),
            }
        }
        Ok(())
    }

    #[test]
    fn the_server_s_own_lines_are_not_announcements() {
        assert_eq!(
            parse_announcement("inteligir 0.6.0 listening on http://127.0.0.1:4664"),
            None
        );
        assert_eq!(parse_announcement(r#"{"kind":"ready"}"#), None);
        assert_eq!(parse_announcement("inteligir-desktop:{not json"), None);
    }
}
