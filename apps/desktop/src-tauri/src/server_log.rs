//! A Finder-launched app's stdout goes nowhere, so what the server child prints is also appended,
//! stamped, to `<dataDir>/logs/server.log`, debug logging on or off: a report can attach it. One
//! backup, so the log costs at most twice its cap. The server does not write its own file: a crash
//! before its logger is up is the line a report most needs.

use std::fmt::Write as _;
use std::fs::{self, OpenOptions};
use std::io::Write as _;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use time::OffsetDateTime;
use time::format_description::BorrowedFormatItem;
use time::macros::format_description;

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
    /// shell carries on. A message bigger than the cap is cut to it, so no write takes a file
    /// past it.
    pub fn append(&mut self, message: &str) {
        let stamp = utc_stamp(SystemTime::now());
        let mut text = String::new();
        for line in message.split('\n') {
            let _ = writeln!(text, "{stamp} {line}");
        }
        let text = capped(text, self.max_bytes);
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

const CUT: &str = " [cut]\n";

/// The text whole, or its head and a mark, `max_bytes` in all, cut where no character is split.
fn capped(mut text: String, max_bytes: u64) -> String {
    let max = usize::try_from(max_bytes).unwrap_or(usize::MAX);
    if text.len() <= max {
        return text;
    }
    let mut end = max.saturating_sub(CUT.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text.truncate(end);
    text.push_str(CUT);
    text
}

const STAMP: &[BorrowedFormatItem<'_>] =
    format_description!("[year]-[month]-[day]T[hour]:[minute]:[second].[subsecond digits:3]Z");

/// RFC 3339 in UTC to the millisecond.
pub fn utc_stamp(at: SystemTime) -> String {
    OffsetDateTime::from(at).format(STAMP).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use std::time::{Duration, UNIX_EPOCH};

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
    fn a_line_bigger_than_the_cap_is_cut_to_it() -> std::io::Result<()> {
        let dir = tempfile::tempdir()?;
        let path = server_log_path(dir.path());
        let mut log = ServerLog::new(path.clone(), 80);
        log.append("before");
        log.append(&"é".repeat(200));
        log.append("after");
        let backup = dir.path().join("logs").join("server.log.1");
        for file in [&path, &backup] {
            assert!(
                fs::metadata(file)?.len() <= 80,
                "{} passed the cap",
                file.display()
            );
        }
        assert!(read(&backup).ends_with(" [cut]\n"));
        assert!(read(&path).contains(" after"));
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
