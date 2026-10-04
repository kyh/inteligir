//! A Finder-launched app's stdout goes nowhere, so what the server child prints is also appended,
//! stamped, to `<dataDir>/logs/server.log`, debug logging on or off: a report can attach it. One
//! backup, so the log costs at most twice its cap. The server does not write its own file: a crash
//! before its logger is up is the line a report most needs.

use std::fmt::Write as _;
use std::fs::{self, OpenOptions};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const SERVER_LOG_MAX_BYTES: u64 = 5 * 1024 * 1024;

pub fn server_log_path(data_dir: &Path) -> PathBuf {
    data_dir.join("logs").join("server.log")
}

pub struct ServerLog {
    path: PathBuf,
    backup: PathBuf,
    max_bytes: u64,
    // unknown until a write stats the file, and again after a failure, which may have moved it
    size: Option<u64>,
    // said once per run of failures: a full disk would otherwise say so on every line
    failing: bool,
}

impl ServerLog {
    pub fn new(path: PathBuf, max_bytes: u64) -> Self {
        let mut backup = path.clone().into_os_string();
        backup.push(".1");
        Self {
            path,
            backup: PathBuf::from(backup),
            max_bytes,
            size: None,
            failing: false,
        }
    }

    /// A log that cannot be written costs the log alone: the failure is reported once, and the
    /// shell carries on.
    pub fn append(&mut self, message: &str) {
        let stamp = utc_stamp(SystemTime::now());
        let mut text = String::new();
        for line in message.split('\n') {
            let _ = writeln!(text, "{stamp} {line}");
        }
        match self.write(&text) {
            Ok(()) => self.failing = false,
            Err(error) => {
                self.size = None;
                if !self.failing {
                    self.failing = true;
                    eprintln!(
                        "[desktop] the server log could not be written ({}): {error}",
                        self.path.display()
                    );
                }
            }
        }
    }

    fn write(&mut self, text: &str) -> std::io::Result<()> {
        let size = if let Some(size) = self.size {
            size
        } else {
            if let Some(parent) = self.path.parent() {
                fs::create_dir_all(parent)?;
            }
            fs::metadata(&self.path).map_or(0, |meta| meta.len())
        };
        let bytes = text.len() as u64;
        let size = if size > 0 && size + bytes > self.max_bytes {
            fs::rename(&self.path, &self.backup)?;
            0
        } else {
            size
        };
        OpenOptions::new()
            .create(true)
            .append(true)
            .open(&self.path)?
            .write_all(text.as_bytes())?;
        self.size = Some(size + bytes);
        Ok(())
    }
}

/// RFC 3339 in UTC to the millisecond, the stamp the Electron shell wrote, so a log spanning the
/// move reads as one.
pub fn utc_stamp(at: SystemTime) -> String {
    let since = at.duration_since(UNIX_EPOCH).unwrap_or_default();
    let millis = since.subsec_millis();
    let secs = since.as_secs();
    let (days, rest) = (secs / 86_400, secs % 86_400);
    let (hour, minute, second) = (rest / 3600, rest % 3600 / 60, rest % 60);
    let (year, month, day) = civil_from_days(days);
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{millis:03}Z")
}

/// Days since 1970-01-01 to a proleptic Gregorian date (Howard Hinnant's `civil_from_days`).
fn civil_from_days(days: u64) -> (u64, u64, u64) {
    let z = days + 719_468;
    let era = z / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = yoe + era * 400 + u64::from(month <= 2);
    (year, month, day)
}

#[cfg(test)]
mod tests {
    use std::time::Duration;

    use super::*;

    fn read(path: &Path) -> String {
        fs::read_to_string(path).unwrap_or_default()
    }

    #[test]
    fn stamps_each_line_in_utc() {
        let at = UNIX_EPOCH + Duration::from_millis(1_759_572_000_123);
        assert_eq!(utc_stamp(at), "2025-10-04T10:00:00.123Z");
        assert_eq!(utc_stamp(UNIX_EPOCH), "1970-01-01T00:00:00.000Z");
        assert_eq!(
            utc_stamp(UNIX_EPOCH + Duration::from_secs(951_782_400)),
            "2000-02-29T00:00:00.000Z"
        );
    }

    #[test]
    fn appends_every_line_of_a_message() -> std::io::Result<()> {
        let dir = tempfile::tempdir()?;
        let path = server_log_path(dir.path());
        let mut log = ServerLog::new(path.clone(), SERVER_LOG_MAX_BYTES);
        log.append("first\nsecond");
        log.append("third");
        let lines: Vec<String> = read(&path).lines().map(str::to_owned).collect();
        assert_eq!(lines.len(), 3);
        assert!(lines[0].ends_with(" first"));
        assert!(lines[2].ends_with(" third"));
        Ok(())
    }

    #[test]
    fn rotates_into_one_backup_past_the_cap() -> std::io::Result<()> {
        let dir = tempfile::tempdir()?;
        let path = server_log_path(dir.path());
        let mut log = ServerLog::new(path.clone(), 80);
        log.append("one");
        log.append("two");
        log.append("three");
        let backup = dir.path().join("logs").join("server.log.1");
        assert!(read(&backup).contains(" one"));
        assert!(read(&path).contains(" three"));
        assert!(!read(&path).contains(" one"));
        Ok(())
    }

    #[test]
    fn a_failed_write_costs_the_line_alone() -> std::io::Result<()> {
        let dir = tempfile::tempdir()?;
        // a file where the logs folder should be: every write fails
        fs::write(dir.path().join("logs"), "")?;
        let mut log = ServerLog::new(server_log_path(dir.path()), SERVER_LOG_MAX_BYTES);
        log.append("lost");
        log.append("lost too");
        assert!(log.failing);
        Ok(())
    }
}
