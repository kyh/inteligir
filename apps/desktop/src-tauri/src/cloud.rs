//! Where this build's library lives, and what the shell tells the page about itself before the
//! page opens it: the cloud's origin, the origin of the shell's file scheme, this build and this
//! Mac's name for its sign-in.
//!
//! A release talks to the production cloud alone, the origin `tauri.conf.json`'s policy lets the
//! page reach and `@repo/contract/cloud/origin` spells, held equal by
//! `tools/repo-guards/src/desktop-shell-wire.test.ts`. A debug build is a local one (`pnpm dev`, the
//! scenario suite), whose cloud is the Worker on this machine, `INTELIGIR_CLOUD_ORIGIN` naming
//! another port; its policy (`tauri.local.conf.json`) lets the page reach loopback alone.

use serde::Serialize;

use crate::file_scheme;

pub const PRODUCTION_CLOUD_ORIGIN: &str = "https://inteligir.com";
const LOCAL_CLOUD_ORIGIN: &str = "http://localhost:5174";
const CLOUD_ORIGIN_ENV_VAR: &str = "INTELIGIR_CLOUD_ORIGIN";

/// The platform the cloud's build floor reads beside the version (`@repo/contract/cloud/client-build`).
const PLATFORM: &str = "desktop";

/// A release's cloud is production's; a debug build's is this machine's Worker, on the port the
/// environment names or `pnpm dev:web`'s, and never an address off this machine.
pub fn cloud_origin() -> String {
    if cfg!(debug_assertions) {
        std::env::var(CLOUD_ORIGIN_ENV_VAR)
            .ok()
            .filter(|origin| is_loopback_origin(origin))
            .unwrap_or_else(|| LOCAL_CLOUD_ORIGIN.to_owned())
    } else {
        PRODUCTION_CLOUD_ORIGIN.to_owned()
    }
}

/// An origin on this machine, spelled as an origin: no path, no query, no trailing slash.
fn is_loopback_origin(origin: &str) -> bool {
    !origin.ends_with('/')
        && tauri::Url::parse(origin).is_ok_and(|url| {
            url.scheme() == "http"
                && matches!(url.host_str(), Some("localhost" | "127.0.0.1"))
                && url.path() == "/"
                && url.query().is_none()
        })
}

/// The build header's value every request names: `<version>+desktop`.
pub fn build_value(version: &str) -> String {
    format!("{version}+{PLATFORM}")
}

/// This Mac's name as the account's device list shows it: the host's name less its `.local`.
pub fn device_name() -> String {
    let host = nix::unistd::gethostname()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let name = host.strip_suffix(".local").unwrap_or(&host).trim();
    if name.is_empty() {
        "Mac".to_owned()
    } else {
        name.to_owned()
    }
}

/// The page's `shellConfigSchema`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShellConfig {
    pub cloud_origin: String,
    pub files_origin: String,
    pub device_name: String,
    pub version: String,
}

impl ShellConfig {
    pub fn new(cloud_origin: String, version: &str) -> Self {
        Self {
            cloud_origin,
            files_origin: file_scheme::ORIGIN.to_owned(),
            device_name: device_name(),
            version: version.to_owned(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn names_the_build_as_the_floor_reads_it() {
        assert_eq!(build_value("0.7.0"), "0.7.0+desktop");
    }

    #[test]
    fn names_this_mac() {
        assert_ne!(device_name(), "");
    }

    #[test]
    fn a_local_build_reaches_loopback_alone() {
        assert!(is_loopback_origin("http://127.0.0.1:48213"));
        assert!(is_loopback_origin("http://localhost:5174"));
        assert!(!is_loopback_origin("https://inteligir.com"));
        assert!(!is_loopback_origin("http://127.0.0.1:48213/"));
        assert!(!is_loopback_origin("http://evil.example:80"));
        assert!(!is_loopback_origin("http://localhost:5174/v1"));
    }
}
