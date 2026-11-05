//! The library's files on this Mac, by their SHA-256. Two folders: the staged files, which the
//! outbox has yet to upload and which nothing evicts, in the app's data dir; and the cache of
//! files fetched from the cloud, which macOS may purge and which this module keeps under its limit
//! by letting the least recently read go first, in the app's caches dir. Both are read by the
//! page through the shell's own scheme (`file_scheme.rs`); a file neither holds is fetched from
//! `/v1/blobs/<sha>` with the device's credential, checked against its sha and kept.

use std::fmt::Write as _;
use std::fs::{self, File, OpenOptions};
use std::io::{self, Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard, PoisonError};
use std::time::{SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};

use crate::error::{ShellError, ShellResult};

/// About 5 GB of fetched files (spec §6), whatever the staged ones take.
pub const CACHE_LIMIT_BYTES: u64 = 5 * 1024 * 1024 * 1024;

/// A file's bytes and the type the cloud served it as.
#[derive(Debug, PartialEq, Eq)]
pub struct Held {
    pub bytes: Vec<u8>,
    pub content_type: String,
}

/// A file this Mac holds: where it is, what it is and how long.
#[derive(Debug, PartialEq, Eq)]
pub struct Located {
    pub path: PathBuf,
    pub content_type: String,
    pub len: u64,
}

impl Located {
    /// The bytes from `start` to `end` inclusive, or the whole file; read from disk, so a range of
    /// a long recording costs that range alone.
    pub fn read(&self, range: Option<(u64, u64)>) -> io::Result<Vec<u8>> {
        let Some((start, end)) = range else {
            return fs::read(&self.path);
        };
        let mut file = File::open(&self.path)?;
        file.seek(SeekFrom::Start(start))?;
        let len = usize::try_from(end - start + 1)
            .map_err(|_| io::Error::new(io::ErrorKind::InvalidInput, "a range too long to hold"))?;
        let mut bytes = vec![0_u8; len];
        file.read_exact(&mut bytes)?;
        Ok(bytes)
    }
}

const UNKNOWN_TYPE: &str = "application/octet-stream";
const TYPE_SUFFIX: &str = ".type";

pub fn is_sha(text: &str) -> bool {
    text.len() == 64
        && text
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

/// Bytes as lowercase hex, as a sha is spelled.
pub fn hex(bytes: &[u8]) -> String {
    bytes
        .iter()
        .fold(String::with_capacity(bytes.len() * 2), |mut text, byte| {
            let _ = write!(text, "{byte:02x}");
            text
        })
}

pub fn sha_of(bytes: &[u8]) -> String {
    hex(&Sha256::digest(bytes))
}

fn checked(sha: &str) -> ShellResult<&str> {
    if is_sha(sha) {
        Ok(sha)
    } else {
        Err(ShellError::Invalid(format!("{sha} is no file's sha")))
    }
}

fn read_if_there(path: &Path) -> io::Result<Option<Vec<u8>>> {
    match fs::read(path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

fn length_if_there(path: &Path) -> io::Result<Option<u64>> {
    match fs::metadata(path) {
        Ok(meta) => Ok(Some(meta.len())),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(error) => Err(error),
    }
}

fn remove_if_there(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error),
        _ => Ok(()),
    }
}

/// Written whole beside the destination and renamed over it, so a crash mid-write leaves the old
/// file or the new one, never half of either.
fn write_whole(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let dir = path
        .parent()
        .ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "a file needs a folder"))?;
    fs::create_dir_all(dir)?;
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|since| since.as_nanos())
        .unwrap_or_default();
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
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

pub struct FileCache {
    staged_dir: PathBuf,
    cache_dir: PathBuf,
    limit: u64,
    // one writer at a time, so an eviction never counts a file another write is renaming in
    writing: Mutex<()>,
}

impl FileCache {
    pub fn new(staged_dir: PathBuf, cache_dir: PathBuf, limit: u64) -> Self {
        Self {
            staged_dir,
            cache_dir,
            limit,
            writing: Mutex::new(()),
        }
    }

    fn write_lock(&self) -> MutexGuard<'_, ()> {
        self.writing.lock().unwrap_or_else(PoisonError::into_inner)
    }

    fn staged_path(&self, sha: &str) -> PathBuf {
        self.staged_dir.join(sha)
    }

    fn cached_path(&self, sha: &str) -> PathBuf {
        self.cache_dir.join(sha)
    }

    fn type_path(&self, sha: &str) -> PathBuf {
        self.cache_dir.join(format!("{sha}{TYPE_SUFFIX}"))
    }

    /// A file the outbox will upload: kept until the write naming it lands, whatever the cache's
    /// limit. Bytes that do not hash to their sha are refused, as the cloud would refuse them.
    pub fn stage(&self, sha: &str, bytes: &[u8]) -> ShellResult<()> {
        let sha = checked(sha)?;
        if sha_of(bytes) != sha {
            return Err(ShellError::Invalid(format!(
                "those bytes are not the file {sha}"
            )));
        }
        let _writing = self.write_lock();
        Ok(write_whole(&self.staged_path(sha), bytes)?)
    }

    pub fn staged(&self, sha: &str) -> ShellResult<Option<Vec<u8>>> {
        Ok(read_if_there(&self.staged_path(checked(sha)?))?)
    }

    /// The write naming the file landed, so the cloud holds it: its bytes move into the cache,
    /// where the next read finds them without a fetch and the limit may let them go.
    pub fn unstage(&self, sha: &str) -> ShellResult<()> {
        let sha = checked(sha)?;
        let _writing = self.write_lock();
        let from = self.staged_path(sha);
        if !from.exists() {
            return Ok(());
        }
        fs::create_dir_all(&self.cache_dir)?;
        fs::rename(&from, self.cached_path(sha))?;
        self.evict()?;
        Ok(())
    }

    /// Every staged file, as a wipe of the outbox drops them.
    pub fn clear_staged(&self) -> ShellResult<()> {
        let _writing = self.write_lock();
        match fs::remove_dir_all(&self.staged_dir) {
            Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error.into()),
            _ => Ok(()),
        }
    }

    /// Everything this Mac holds of the library's files, as a sign-out leaves nothing of the
    /// account behind.
    pub fn clear(&self) -> ShellResult<()> {
        self.clear_staged()?;
        let _writing = self.write_lock();
        match fs::remove_dir_all(&self.cache_dir) {
            Err(error) if error.kind() != io::ErrorKind::NotFound => Err(error.into()),
            _ => Ok(()),
        }
    }

    /// Where the file is if this Mac holds it, staged first; finding a cached one counts as its
    /// latest use.
    pub fn locate(&self, sha: &str) -> ShellResult<Option<Located>> {
        let sha = checked(sha)?;
        let staged = self.staged_path(sha);
        if let Some(len) = length_if_there(&staged)? {
            return Ok(Some(Located {
                path: staged,
                content_type: UNKNOWN_TYPE.to_owned(),
                len,
            }));
        }
        let path = self.cached_path(sha);
        let Some(len) = length_if_there(&path)? else {
            return Ok(None);
        };
        // a file the limit lets go meanwhile was already found; a failed touch costs its recency
        if let Ok(file) = File::options().write(true).open(&path) {
            let _ = file.set_modified(SystemTime::now());
        }
        let content_type = fs::read_to_string(self.type_path(sha))
            .ok()
            .filter(|kind| !kind.is_empty())
            .unwrap_or_else(|| UNKNOWN_TYPE.to_owned());
        Ok(Some(Located {
            path,
            content_type,
            len,
        }))
    }

    /// A file fetched from the cloud, kept once it hashes to its sha, then the limit enforced.
    pub fn keep(&self, sha: &str, held: &Held) -> ShellResult<()> {
        let sha = checked(sha)?;
        if sha_of(&held.bytes) != sha {
            return Err(ShellError::Invalid(format!(
                "the cloud answered other bytes for {sha}"
            )));
        }
        let _writing = self.write_lock();
        write_whole(&self.type_path(sha), held.content_type.as_bytes())?;
        write_whole(&self.cached_path(sha), &held.bytes)?;
        self.evict()?;
        Ok(())
    }

    /// The least recently read files go until the rest fit the limit; the staged ones are
    /// elsewhere and never counted.
    fn evict(&self) -> io::Result<()> {
        let mut files = Vec::new();
        let mut total = 0_u64;
        let entries = match fs::read_dir(&self.cache_dir) {
            Ok(entries) => entries,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error),
        };
        for entry in entries {
            let entry = entry?;
            let name = entry.file_name().to_string_lossy().into_owned();
            if !is_sha(&name) {
                continue;
            }
            let meta = entry.metadata()?;
            total += meta.len();
            files.push((meta.modified()?, meta.len(), name));
        }
        files.sort();
        for (_, len, sha) in files {
            if total <= self.limit {
                break;
            }
            remove_if_there(&self.cached_path(&sha))?;
            remove_if_there(&self.type_path(&sha))?;
            total -= len;
        }
        Ok(())
    }
}

/// What the cloud answered for a file this Mac does not hold.
#[derive(Debug, PartialEq, Eq)]
pub enum Fetched {
    File(Held),
    /// The cloud's status: no such file in the account (404), the credential refused (401)…
    Refused(u16),
}

/// Where a miss is fetched from, and as whom.
pub struct CloudFiles {
    pub client: reqwest::Client,
    pub origin: String,
    pub build: String,
}

/// The client a miss is fetched with, over the crypto provider the updater's plugin installs too
/// (ring), so the shell carries one TLS stack; installed here first, since reqwest builds no
/// client without one.
pub fn http_client() -> ShellResult<reqwest::Client> {
    if rustls::crypto::CryptoProvider::get_default().is_none() {
        // a race lost to another installer leaves that one's provider, which is the same ring
        let _ = rustls::crypto::ring::default_provider().install_default();
    }
    Ok(reqwest::Client::builder().build()?)
}

/// `GET /v1/blobs/<sha>` with the device's credential and build, as the outbox uploads one.
pub async fn fetch(cloud: &CloudFiles, credential: &str, sha: &str) -> ShellResult<Fetched> {
    let sha = checked(sha)?;
    let response = cloud
        .client
        .get(format!("{}/v1/blobs/{sha}", cloud.origin))
        .bearer_auth(credential)
        .header("x-inteligir-build", &cloud.build)
        .send()
        .await?;
    let status = response.status();
    if !status.is_success() {
        return Ok(Fetched::Refused(status.as_u16()));
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or(UNKNOWN_TYPE)
        .to_owned();
    let bytes = response.bytes().await?.to_vec();
    Ok(Fetched::File(Held {
        bytes,
        content_type,
    }))
}

/// The one byte range a request asks, inclusive, within a file of `total` bytes: None to serve it
/// whole (no range, or several), Err for one past its end.
pub fn requested_range(header: Option<&str>, total: u64) -> Result<Option<(u64, u64)>, ()> {
    let Some(spec) = header.and_then(|value| value.trim().strip_prefix("bytes=")) else {
        return Ok(None);
    };
    if spec.contains(',') {
        return Ok(None);
    }
    let Some((start, end)) = spec.split_once('-') else {
        return Err(());
    };
    let (start, end) = match (start.trim(), end.trim()) {
        ("", suffix) => {
            let suffix: u64 = suffix.parse().map_err(|_| ())?;
            if suffix == 0 {
                return Err(());
            }
            (total.saturating_sub(suffix), total.saturating_sub(1))
        }
        (start, "") => (start.parse().map_err(|_| ())?, total.saturating_sub(1)),
        (start, end) => {
            let end: u64 = end.parse().map_err(|_| ())?;
            (
                start.parse().map_err(|_| ())?,
                end.min(total.saturating_sub(1)),
            )
        }
    };
    if total == 0 || start >= total || start > end {
        return Err(());
    }
    Ok(Some((start, end)))
}

#[cfg(test)]
mod tests {
    use std::io::{BufRead, BufReader, Read};
    use std::net::TcpListener;
    use std::time::Duration;

    use super::*;

    /// The file whole, as the scheme serves one asked for without a range.
    fn whole(cache: &FileCache, sha: &str) -> ShellResult<Option<Held>> {
        let Some(located) = cache.locate(sha)? else {
            return Ok(None);
        };
        Ok(Some(Held {
            bytes: located.read(None)?,
            content_type: located.content_type,
        }))
    }

    fn cache_in(dir: &Path, limit: u64) -> FileCache {
        FileCache::new(dir.join("staged"), dir.join("cache"), limit)
    }

    fn file(text: &str) -> (String, Held) {
        let held = Held {
            bytes: text.as_bytes().to_vec(),
            content_type: "image/png".to_owned(),
        };
        (sha_of(text.as_bytes()), held)
    }

    #[test]
    fn a_kept_file_is_a_hit_with_its_type() -> ShellResult<()> {
        let dir = tempfile::tempdir()?;
        let cache = cache_in(dir.path(), CACHE_LIMIT_BYTES);
        let (sha, held) = file("a picture");
        assert_eq!(whole(&cache, &sha)?, None);
        cache.keep(&sha, &held)?;
        assert_eq!(whole(&cache, &sha)?, Some(held));
        Ok(())
    }

    #[test]
    fn bytes_that_are_not_their_sha_are_refused() -> ShellResult<()> {
        let dir = tempfile::tempdir()?;
        let cache = cache_in(dir.path(), CACHE_LIMIT_BYTES);
        let (sha, _) = file("one");
        let (_, other) = file("two");
        assert!(matches!(
            cache.keep(&sha, &other),
            Err(ShellError::Invalid(_))
        ));
        assert!(matches!(
            cache.stage(&sha, &other.bytes),
            Err(ShellError::Invalid(_))
        ));
        assert!(matches!(
            whole(&cache, "../secret"),
            Err(ShellError::Invalid(_))
        ));
        assert_eq!(whole(&cache, &sha)?, None);
        Ok(())
    }

    #[test]
    fn the_least_recently_read_file_goes_first() -> ShellResult<()> {
        let dir = tempfile::tempdir()?;
        // room for two of three nine-byte files
        let cache = cache_in(dir.path(), 18);
        let (first, first_file) = file("file one!");
        let (second, second_file) = file("file two!");
        let (third, third_file) = file("file 3!!!");
        cache.keep(&first, &first_file)?;
        std::thread::sleep(Duration::from_millis(20));
        cache.keep(&second, &second_file)?;
        std::thread::sleep(Duration::from_millis(20));
        // read, so the first is newer than the second
        assert!(whole(&cache, &first)?.is_some());
        std::thread::sleep(Duration::from_millis(20));
        cache.keep(&third, &third_file)?;
        assert!(whole(&cache, &first)?.is_some());
        assert_eq!(whole(&cache, &second)?, None);
        assert!(whole(&cache, &third)?.is_some());
        Ok(())
    }

    #[test]
    fn a_staged_file_is_pinned_past_the_limit_until_its_write_lands() -> ShellResult<()> {
        let dir = tempfile::tempdir()?;
        let cache = cache_in(dir.path(), 0);
        let (sha, held) = file("a staged photo");
        cache.stage(&sha, &held.bytes)?;
        // a fetched file meets a limit of nothing and goes at once; the staged one stays
        let (other, other_file) = file("fetched");
        cache.keep(&other, &other_file)?;
        assert_eq!(whole(&cache, &other)?, None);
        assert_eq!(cache.staged(&sha)?, Some(held.bytes.clone()));
        assert_eq!(
            whole(&cache, &sha)?.map(|held| held.bytes),
            Some(held.bytes.clone())
        );
        // landed: the bytes move to the cache, where the limit may let them go
        cache.unstage(&sha)?;
        assert_eq!(cache.staged(&sha)?, None);
        assert!(dir.path().join("staged").read_dir()?.next().is_none());
        Ok(())
    }

    #[test]
    fn an_unstaged_file_stays_readable_from_the_cache() -> ShellResult<()> {
        let dir = tempfile::tempdir()?;
        let cache = cache_in(dir.path(), CACHE_LIMIT_BYTES);
        let (sha, held) = file("uploaded");
        cache.stage(&sha, &held.bytes)?;
        cache.unstage(&sha)?;
        assert_eq!(
            whole(&cache, &sha)?.map(|held| held.bytes),
            Some(held.bytes)
        );
        // unstaging what is not staged is nothing
        cache.unstage(&sha)?;
        Ok(())
    }

    #[test]
    fn clearing_leaves_nothing_of_the_account() -> ShellResult<()> {
        let dir = tempfile::tempdir()?;
        let cache = cache_in(dir.path(), CACHE_LIMIT_BYTES);
        let (staged, staged_file) = file("staged");
        let (kept, kept_file) = file("kept");
        cache.stage(&staged, &staged_file.bytes)?;
        cache.keep(&kept, &kept_file)?;
        cache.clear_staged()?;
        assert_eq!(cache.staged(&staged)?, None);
        assert!(whole(&cache, &kept)?.is_some());
        cache.clear()?;
        assert_eq!(whole(&cache, &kept)?, None);
        // a second clear finds nothing to clear
        cache.clear()?;
        Ok(())
    }

    #[test]
    fn a_range_is_read_from_disk_alone() -> ShellResult<()> {
        let dir = tempfile::tempdir()?;
        let cache = cache_in(dir.path(), CACHE_LIMIT_BYTES);
        let (sha, held) = file("0123456789");
        cache.keep(&sha, &held)?;
        let located = cache.locate(&sha)?.ok_or(ShellError::Missing)?;
        assert_eq!(located.len, 10);
        assert_eq!(located.read(Some((2, 4)))?, b"234".to_vec());
        Ok(())
    }

    #[test]
    fn reads_one_range_and_serves_the_rest_whole() {
        assert_eq!(requested_range(None, 10), Ok(None));
        assert_eq!(requested_range(Some("bytes=0-3"), 10), Ok(Some((0, 3))));
        assert_eq!(requested_range(Some("bytes=4-"), 10), Ok(Some((4, 9))));
        assert_eq!(requested_range(Some("bytes=-3"), 10), Ok(Some((7, 9))));
        assert_eq!(requested_range(Some("bytes=0-99"), 10), Ok(Some((0, 9))));
        assert_eq!(requested_range(Some("bytes=0-1,4-5"), 10), Ok(None));
        assert_eq!(requested_range(Some("bytes=10-"), 10), Err(()));
        assert_eq!(requested_range(Some("bytes=5-2"), 10), Err(()));
        assert_eq!(requested_range(Some("bytes=x-"), 10), Err(()));
    }

    /// One request answered by a listener on this machine, its head handed back.
    fn answer_once(
        status: &'static str,
        body: &'static [u8],
    ) -> io::Result<(String, std::thread::JoinHandle<Vec<String>>)> {
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let origin = format!("http://{}", listener.local_addr()?);
        let serving = std::thread::spawn(move || {
            let Ok((mut stream, _)) = listener.accept() else {
                return Vec::new();
            };
            let mut head = Vec::new();
            let mut reader = BufReader::new(match stream.try_clone() {
                Ok(read) => read,
                Err(_) => return head,
            });
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).is_err() || line.trim().is_empty() {
                    break;
                }
                head.push(line.trim().to_owned());
            }
            let reply = format!(
                "HTTP/1.1 {status}\r\ncontent-type: image/png\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(reply.as_bytes());
            let _ = stream.write_all(body);
            let _ = stream.read(&mut [0_u8; 1]);
            head
        });
        Ok((origin, serving))
    }

    fn cloud_at(origin: String) -> ShellResult<CloudFiles> {
        Ok(CloudFiles {
            client: http_client()?,
            origin,
            build: "0.6.0+desktop".to_owned(),
        })
    }

    #[test]
    fn a_miss_is_fetched_with_the_credential_and_the_build() -> ShellResult<()> {
        let body: &'static [u8] = b"the cloud's copy";
        let (origin, serving) = answer_once("200 OK", body)?;
        let sha = sha_of(body);
        let fetched =
            tauri::async_runtime::block_on(fetch(&cloud_at(origin)?, "igd_secret", &sha))?;
        assert_eq!(
            fetched,
            Fetched::File(Held {
                bytes: body.to_vec(),
                content_type: "image/png".to_owned(),
            })
        );
        let head = serving
            .join()
            .map_err(|_| ShellError::Invalid("the listener panicked".to_owned()))?;
        assert_eq!(
            head.first().map(String::as_str),
            Some(format!("GET /v1/blobs/{sha} HTTP/1.1").as_str())
        );
        let lowered: Vec<String> = head.iter().map(|line| line.to_lowercase()).collect();
        assert!(
            lowered.contains(&"authorization: bearer igd_secret".to_owned()),
            "{head:?}"
        );
        assert!(
            lowered.contains(&"x-inteligir-build: 0.6.0+desktop".to_owned()),
            "{head:?}"
        );
        Ok(())
    }

    #[test]
    fn a_refused_miss_is_its_status() -> ShellResult<()> {
        let (origin, serving) = answer_once("404 Not Found", b"")?;
        let fetched = tauri::async_runtime::block_on(fetch(
            &cloud_at(origin)?,
            "igd_secret",
            &"0".repeat(64),
        ))?;
        assert_eq!(fetched, Fetched::Refused(404));
        let _ = serving.join();
        Ok(())
    }
}
