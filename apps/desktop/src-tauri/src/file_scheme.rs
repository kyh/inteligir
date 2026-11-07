//! The shell's own scheme for the library's files, `inteligir-files://localhost/<sha>`, which the
//! page names in an image's, a recording's or a PDF's address, and fetches to save a file. Its own
//! name, never `blob`, which WebKit already handles and would refuse to hand over. A file this Mac
//! holds is served from disk, one range of it when asked; a miss is fetched from the cloud with the
//! device's credential, kept, then served. Every file but a PDF is served under a script-less
//! sandbox, as the cloud serves it. The page's origin alone may read an answer (CORS), since a
//! save reads the bytes into a blob of the page's own origin: the window itself never goes to a
//! file (`item-stages.tsx` in the page, `navigation.rs`).

use tauri::http::{Request, Response, StatusCode, header};

use crate::file_cache::{self, CloudFiles, Fetched, FileCache, Held, Located};
use crate::window::PAGE_ORIGIN;

pub const SCHEME: &str = "inteligir-files";
/// What the page puts before a file's sha: the scheme's, at the host WebKit hands a custom scheme.
pub const ORIGIN: &str = "inteligir-files://localhost";

// the cloud's own policies for a file (apps/web/src/worker/library/blob-routes.ts): a sandbox
// blanks WebKit's PDF viewer, so a PDF alone keeps its viewer, runs no script, loads nothing but
// itself, and only the app's page may frame it
const PDF_POLICY: &str = "default-src 'none'; object-src 'self'; style-src 'unsafe-inline'; frame-ancestors tauri://localhost";
// any other file: an <img> never runs an svg's script, but a navigation to its address would
const SANDBOX_POLICY: &str = "default-src 'none'; sandbox";

fn is_pdf(content_type: &str) -> bool {
    content_type
        .split(';')
        .next()
        .is_some_and(|kind| kind.trim().eq_ignore_ascii_case("application/pdf"))
}

fn refused(status: StatusCode) -> Response<Vec<u8>> {
    let mut response = Response::new(Vec::new());
    *response.status_mut() = status;
    let headers = response.headers_mut();
    headers.insert(
        header::CACHE_CONTROL,
        header::HeaderValue::from_static("no-store"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_ORIGIN,
        header::HeaderValue::from_static(PAGE_ORIGIN),
    );
    response
}

fn served(located: &Located, range_header: Option<&str>) -> Response<Vec<u8>> {
    let Ok(range) = file_cache::requested_range(range_header, located.len) else {
        let mut response = refused(StatusCode::RANGE_NOT_SATISFIABLE);
        if let Ok(value) = header::HeaderValue::from_str(&format!("bytes */{}", located.len)) {
            response.headers_mut().insert(header::CONTENT_RANGE, value);
        }
        return response;
    };
    let bytes = match located.read(range) {
        Ok(bytes) => bytes,
        Err(error) => {
            eprintln!("[files] could not read {}: {error}", located.path.display());
            return refused(StatusCode::INTERNAL_SERVER_ERROR);
        }
    };
    let mut builder = Response::builder()
        .header(header::CONTENT_TYPE, &located.content_type)
        .header(header::ACCEPT_RANGES, "bytes")
        .header(header::ACCESS_CONTROL_ALLOW_ORIGIN, PAGE_ORIGIN)
        // a file is its sha, so its bytes never change under its address
        .header(
            header::CACHE_CONTROL,
            "private, max-age=31536000, immutable",
        )
        .header(
            header::CONTENT_SECURITY_POLICY,
            if is_pdf(&located.content_type) {
                PDF_POLICY
            } else {
                SANDBOX_POLICY
            },
        );
    builder = match range {
        Some((start, end)) => builder.status(StatusCode::PARTIAL_CONTENT).header(
            header::CONTENT_RANGE,
            format!("bytes {start}-{end}/{}", located.len),
        ),
        None => builder.status(StatusCode::OK),
    };
    builder
        .body(bytes)
        .unwrap_or_else(|_| refused(StatusCode::INTERNAL_SERVER_ERROR))
}

/// The file served from this Mac's disk, or None when it holds no such file.
fn held(files: &FileCache, sha: &str, range_header: Option<&str>) -> Option<Response<Vec<u8>>> {
    match files.locate(sha) {
        Ok(Some(located)) => Some(served(&located, range_header)),
        Ok(None) => None,
        Err(error) => {
            eprintln!("[files] could not look for {sha}: {error}");
            Some(refused(StatusCode::INTERNAL_SERVER_ERROR))
        }
    }
}

/// A fetched file kept, then served from where it was kept.
fn kept(
    files: &FileCache,
    sha: &str,
    fetched: &Held,
    range_header: Option<&str>,
) -> Response<Vec<u8>> {
    if let Err(error) = files.keep(sha, fetched) {
        eprintln!("[files] could not keep {sha}: {error}");
        return refused(StatusCode::BAD_GATEWAY);
    }
    held(files, sha, range_header).unwrap_or_else(|| refused(StatusCode::INTERNAL_SERVER_ERROR))
}

/// The disk's part of an answer, on a blocking thread, never the async runtime's, which the
/// fetches and the commands share: a read is up to a whole file, a keep hashes it, writes it and
/// walks the cache.
async fn on_disk(
    files: &FileCache,
    work: impl FnOnce(&FileCache) -> Option<Response<Vec<u8>>> + Send + 'static,
) -> Option<Response<Vec<u8>>> {
    let files = files.clone();
    tauri::async_runtime::spawn_blocking(move || work(&files))
        .await
        .unwrap_or_else(|error| {
            eprintln!("[files] the disk's work stopped: {error}");
            Some(refused(StatusCode::INTERNAL_SERVER_ERROR))
        })
}

/// The answer to one of the page's file requests.
pub async fn answer(
    files: &FileCache,
    cloud: &CloudFiles,
    bearer: Option<String>,
    request: &Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let sha = request.uri().path().trim_start_matches('/').to_owned();
    if !file_cache::is_sha(&sha) {
        return refused(StatusCode::NOT_FOUND);
    }
    let range_header = request
        .headers()
        .get(header::RANGE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let (looking, range) = (sha.clone(), range_header.clone());
    if let Some(response) =
        on_disk(files, move |files| held(files, &looking, range.as_deref())).await
    {
        return response;
    }
    let Some(bearer) = bearer else {
        return refused(StatusCode::UNAUTHORIZED);
    };
    let fetched = match file_cache::fetch(cloud, &bearer, &sha).await {
        Ok(Fetched::File(held)) => held,
        Ok(Fetched::Refused(status)) => {
            return refused(StatusCode::from_u16(status).unwrap_or(StatusCode::BAD_GATEWAY));
        }
        // offline, or the cloud unreachable: the page shows the file as not here yet
        Err(error) => {
            eprintln!("[files] could not fetch {sha}: {error}");
            return refused(StatusCode::BAD_GATEWAY);
        }
    };
    on_disk(files, move |files| {
        Some(kept(files, &sha, &fetched, range_header.as_deref()))
    })
    .await
    .unwrap_or_else(|| refused(StatusCode::INTERNAL_SERVER_ERROR))
}

#[cfg(test)]
mod tests {
    use std::error::Error;
    use std::io::{BufRead, BufReader, Read, Write};
    use std::net::TcpListener;
    use std::path::Path;

    use super::*;
    use crate::error::{ShellError, ShellResult};
    use crate::file_cache::{CACHE_LIMIT_BYTES, sha_of};

    fn files_in(dir: &Path) -> FileCache {
        FileCache::new(dir.join("staged"), dir.join("cache"), CACHE_LIMIT_BYTES)
    }

    fn nowhere() -> CloudFiles {
        CloudFiles {
            client: file_cache::http_client().unwrap_or_default(),
            // a port nothing listens on: a test that reaches it fails
            origin: "http://127.0.0.1:9".to_owned(),
            build: "0.6.0+desktop".to_owned(),
        }
    }

    fn get(sha: &str, range: Option<&str>) -> Request<Vec<u8>> {
        let mut builder = Request::builder().uri(format!("{ORIGIN}/{sha}"));
        if let Some(range) = range {
            builder = builder.header(header::RANGE, range);
        }
        builder.body(Vec::new()).unwrap_or_default()
    }

    fn served_now(
        files: &FileCache,
        cloud: &CloudFiles,
        bearer: Option<&str>,
        request: &Request<Vec<u8>>,
    ) -> Response<Vec<u8>> {
        tauri::async_runtime::block_on(answer(files, cloud, bearer.map(str::to_owned), request))
    }

    #[test]
    fn the_origin_is_the_scheme_s() {
        assert_eq!(ORIGIN, format!("{SCHEME}://localhost"));
    }

    #[test]
    fn a_held_file_is_served_whole_or_by_its_range_under_a_sandbox() -> ShellResult<()> {
        let dir = tempfile::tempdir()?;
        let files = files_in(dir.path());
        let bytes = b"0123456789";
        let sha = sha_of(bytes);
        files.keep(
            &sha,
            &Held {
                bytes: bytes.to_vec(),
                content_type: "video/webm".to_owned(),
            },
        )?;
        let whole = served_now(&files, &nowhere(), None, &get(&sha, None));
        assert_eq!(whole.status(), StatusCode::OK);
        assert_eq!(whole.body(), &bytes.to_vec());
        assert_eq!(
            whole
                .headers()
                .get(header::CONTENT_TYPE)
                .map(header::HeaderValue::as_bytes),
            Some(b"video/webm".as_slice())
        );
        assert_eq!(
            whole
                .headers()
                .get(header::CONTENT_SECURITY_POLICY)
                .map(header::HeaderValue::as_bytes),
            Some(SANDBOX_POLICY.as_bytes())
        );
        // the page saves a file by reading it, which only its own origin may
        assert_eq!(
            header(&whole, header::ACCESS_CONTROL_ALLOW_ORIGIN),
            Some(PAGE_ORIGIN.as_bytes())
        );
        let ranged = served_now(&files, &nowhere(), None, &get(&sha, Some("bytes=2-4")));
        assert_eq!(ranged.status(), StatusCode::PARTIAL_CONTENT);
        assert_eq!(ranged.body(), &b"234".to_vec());
        assert_eq!(
            ranged
                .headers()
                .get(header::CONTENT_RANGE)
                .map(header::HeaderValue::as_bytes),
            Some(b"bytes 2-4/10".as_slice())
        );
        let beyond = served_now(&files, &nowhere(), None, &get(&sha, Some("bytes=20-")));
        assert_eq!(beyond.status(), StatusCode::RANGE_NOT_SATISFIABLE);
        Ok(())
    }

    fn header(response: &Response<Vec<u8>>, name: header::HeaderName) -> Option<&[u8]> {
        response
            .headers()
            .get(name)
            .map(header::HeaderValue::as_bytes)
    }

    #[test]
    fn a_pdf_added_on_this_mac_keeps_its_viewer_before_and_after_its_upload() -> ShellResult<()> {
        let dir = tempfile::tempdir()?;
        let files = files_in(dir.path());
        let bytes = b"%PDF-1.4 taken offline";
        let sha = sha_of(bytes);
        files.stage(&sha, bytes, "application/pdf")?;
        for moment in ["staged", "uploaded"] {
            if moment == "uploaded" {
                files.unstage(&sha)?;
            }
            let response = served_now(&files, &nowhere(), None, &get(&sha, None));
            assert_eq!(response.status(), StatusCode::OK, "{moment}");
            assert_eq!(response.body(), &bytes.to_vec(), "{moment}");
            assert_eq!(
                header(&response, header::CONTENT_TYPE),
                Some(b"application/pdf".as_slice()),
                "{moment}"
            );
            assert_eq!(
                header(&response, header::CONTENT_SECURITY_POLICY),
                Some(PDF_POLICY.as_bytes()),
                "{moment}"
            );
        }
        Ok(())
    }

    #[test]
    fn a_miss_signed_out_or_offline_is_refused_and_kept_out_of_the_cache() -> ShellResult<()> {
        let dir = tempfile::tempdir()?;
        let files = files_in(dir.path());
        let sha = "c".repeat(64);
        let signed_out = served_now(&files, &nowhere(), None, &get(&sha, None));
        assert_eq!(signed_out.status(), StatusCode::UNAUTHORIZED);
        let offline = served_now(&files, &nowhere(), Some("igd_x"), &get(&sha, None));
        assert_eq!(offline.status(), StatusCode::BAD_GATEWAY);
        assert_eq!(
            offline
                .headers()
                .get(header::CACHE_CONTROL)
                .map(header::HeaderValue::as_bytes),
            Some(b"no-store".as_slice())
        );
        // a save the page asked reads why it failed
        assert_eq!(
            header(&offline, header::ACCESS_CONTROL_ALLOW_ORIGIN),
            Some(PAGE_ORIGIN.as_bytes())
        );
        let unnamed = served_now(&files, &nowhere(), Some("igd_x"), &get("not-a-sha", None));
        assert_eq!(unnamed.status(), StatusCode::NOT_FOUND);
        assert!(files.locate(&sha)?.is_none());
        Ok(())
    }

    #[test]
    fn a_miss_is_fetched_with_the_bearer_kept_and_then_a_hit() -> Result<(), Box<dyn Error>> {
        let dir = tempfile::tempdir()?;
        let files = files_in(dir.path());
        let body: &'static [u8] = b"%PDF-1.4 a page";
        let sha = sha_of(body);
        let listener = TcpListener::bind("127.0.0.1:0")?;
        let cloud = CloudFiles {
            client: file_cache::http_client()?,
            origin: format!("http://{}", listener.local_addr()?),
            build: "0.6.0+desktop".to_owned(),
        };
        // one request answered, then the listener gone: a second fetch would fail
        let serving = std::thread::spawn(move || -> Vec<String> {
            let Ok((mut stream, _)) = listener.accept() else {
                return Vec::new();
            };
            let Ok(read) = stream.try_clone() else {
                return Vec::new();
            };
            let mut reader = BufReader::new(read);
            let mut head = Vec::new();
            loop {
                let mut line = String::new();
                if reader.read_line(&mut line).is_err() || line.trim().is_empty() {
                    break;
                }
                head.push(line.trim().to_lowercase());
            }
            let reply = format!(
                "HTTP/1.1 200 OK\r\ncontent-type: application/pdf\r\ncontent-length: {}\r\nconnection: close\r\n\r\n",
                body.len()
            );
            let _ = stream.write_all(reply.as_bytes());
            let _ = stream.write_all(body);
            let _ = stream.read(&mut [0_u8; 1]);
            head
        });
        let first = served_now(&files, &cloud, Some("igd_bearer"), &get(&sha, None));
        assert_eq!(first.status(), StatusCode::OK);
        assert_eq!(first.body(), &body.to_vec());
        assert_eq!(
            first
                .headers()
                .get(header::CONTENT_SECURITY_POLICY)
                .map(header::HeaderValue::as_bytes),
            Some(PDF_POLICY.as_bytes())
        );
        let head = serving
            .join()
            .map_err(|_| ShellError::Invalid("the listener panicked".to_owned()))?;
        assert!(
            head.contains(&"authorization: bearer igd_bearer".to_owned()),
            "{head:?}"
        );
        let again = served_now(&files, &cloud, Some("igd_bearer"), &get(&sha, None));
        assert_eq!(again.status(), StatusCode::OK);
        assert_eq!(again.body(), &body.to_vec());
        Ok(())
    }
}
