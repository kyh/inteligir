//! The shell's own small files (the recent vaults, the debug choice) are written whole beside their
//! destination and renamed over it, as the server's `staged-write.ts` writes its own: a crash
//! mid-write leaves the old file or the new one, never half of either.

use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn write_staged(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let dir = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "a file needs a folder"))?;
    fs::create_dir_all(dir)?;
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_nanos())
        .unwrap_or_default();
    let staged = dir.join(format!(".{name}.{}.{nonce}.tmp", std::process::id()));
    let written = (|| {
        let mut file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&staged)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&staged, path)
    })();
    if written.is_err() {
        let _ = fs::remove_file(&staged);
    }
    written
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_the_file_whole_and_leaves_nothing_beside_it() -> io::Result<()> {
        let dir = tempfile::tempdir()?;
        let path = dir.path().join("nested").join("list.json");
        write_staged(&path, b"one")?;
        write_staged(&path, b"two")?;
        assert_eq!(fs::read_to_string(&path)?, "two");
        let leftovers = fs::read_dir(dir.path().join("nested"))?.count();
        assert_eq!(leftovers, 1);
        Ok(())
    }
}
