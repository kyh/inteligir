// ---------------------------------------------------------------------------
// What a vault crawl leaves OUT of the sync manifest — ONE fact, shared by
// every platform walk (desktop's VaultManager.walk, mobile's SyncIo walk).
//
// Divergence here loses files rather than looking untidy: the 3-way reconcile
// reads "in base, absent from local" as a LOCAL DELETE, so a name one platform
// pushes and another's crawl excludes is permanently removed from the
// coordinator and every peer on that peer's next pass. Only names NEITHER
// platform can produce as a real note may appear here, and only names that are
// excluded on EVERY pass — a rule that varies per vault, per user or over time
// (a .gitignore entry, a hidden-file preference) belongs in the platform's own
// VIEW filter, never in this file.
//
// ADDING A NAME HERE IS A PERMANENT DELETION. Nothing this file names has ever
// entered a live manifest, which is the only reason the set below costs no
// files: there is nothing under those names for a peer to lose. Every FUTURE
// addition has to clear that same bar. For any platform that did not already
// exclude the name, files under it ARE in the manifest, and adding it here
// removes them from the coordinator and from every device, with no undo. When
// in doubt, leave the name in the manifest and filter it out of the VIEW.
//
// Dot-entries are NOT excluded wholesale. Hiding them declutters a sidebar; a
// `.archive/` folder is still on disk, and pruning it here would fan the whole
// subtree out as permanent deletions the moment a user drags a folder into it.
// The named trees below are the documented exception: each is tool- or
// OS-owned, regenerated on demand, and never the user's notes.
// ---------------------------------------------------------------------------

/** Directory names hard-pruned at every depth — never descended, never listed,
 * whatever the ignore files say. A vault that sits in or beside a dev repo
 * would otherwise upload gigabytes of regenerable build output; a vault on an
 * external drive or a network share would upload the volume's own bookkeeping.
 * Every name here is owned by a tool or the OS, is rebuilt from something the
 * user does sync, and is machine-local — so nothing is lost by never having
 * it. */
const SKIP_DIRS: ReadonlySet<string> = new Set([
  // Version control metadata.
  ".git",
  ".svn",
  ".hg",
  // Note apps that keep their own per-device state beside the notes.
  ".obsidian",
  ".trash",
  // Dependency trees and build/tool caches.
  "node_modules",
  ".venv",
  ".direnv",
  ".yarn",
  ".pnpm-store",
  ".gradle",
  ".next",
  ".nuxt",
  ".turbo",
  ".vercel",
  ".wrangler",
  ".terraform",
  ".cache",
  ".parcel-cache",
  ".pytest_cache",
  ".mypy_cache",
  ".ruff_cache",
  ".tox",
  // Editor / agent workspace state: per-machine settings and local history,
  // rewritten constantly and meaningless on another device.
  ".vscode",
  ".idea",
  ".claude",
  // Volume metadata. These sit at the root of any external drive or network
  // share a vault might live on, are written by the OS as the user browses,
  // and are recreated the moment they are needed again.
  ".Spotlight-V100",
  ".DocumentRevisions-V100",
  ".fseventsd",
  ".TemporaryItems",
  ".Trashes",
  "$RECYCLE.BIN",
]);

/** The suffix `atomicWrite` gives the sibling it renames into place. A crawl
 * that catches one mid-save must not offer the half-written bytes to sync. */
const TMP_SUFFIX = ".tmp";

/** OS-owned metadata files. Excluded not because they are hidden but because
 * the OS rewrites them on every browse: kept in the manifest they would sync
 * (and conflict-copy) on their own schedule forever, while nothing anywhere
 * ever reads them back. */
const OS_METADATA_NAMES: ReadonlySet<string> = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

/** macOS's AppleDouble sidecar: writing `note.md` to a volume with no extended
 * attributes (exFAT, SMB, most USB sticks) leaves `._note.md` beside it
 * carrying the attributes. It is derived from the file next to it and is
 * meaningless on any other device. */
const APPLE_DOUBLE_PREFIX = "._";

const CLOUD_PLACEHOLDER_SUFFIX = ".icloud";

/** Pruned at every depth whatever the entry's type — a crawl neither descends
 * nor lists these. */
export function isPrunedName(name: string): boolean {
  return SKIP_DIRS.has(name);
}

/** Files a crawl must keep out of the manifest entirely. */
export function isExcludedFileName(name: string): boolean {
  return (
    isPrunedName(name) ||
    OS_METADATA_NAMES.has(name) ||
    name.startsWith(APPLE_DOUBLE_PREFIX) ||
    name.endsWith(TMP_SUFFIX) ||
    cloudPlaceholderTarget(name) !== null
  );
}

/** The real file name a cloud placeholder stands in for (`.note.md.icloud` →
 * `note.md`), or null when `name` is not one. iCloud Drive's storage
 * optimisation evicts `note.md` and leaves this stub in its place, so the stub
 * is EVIDENCE about a file the crawl could not see rather than a file of its
 * own: it never belongs in the manifest, and the name it yields is what a
 * caller matches against the last-synced base to decide whether the eviction
 * hides something that was previously synced. Dropbox and OneDrive on-demand
 * keep the real filename (their eviction lives in filesystem attributes), so
 * there is nothing for a name check to see there. */
export function cloudPlaceholderTarget(name: string): string | null {
  if (!name.startsWith(".") || !name.endsWith(CLOUD_PLACEHOLDER_SUFFIX)) return null;
  const target = name.slice(1, -CLOUD_PLACEHOLDER_SUFFIX.length);
  return target.length > 0 ? target : null;
}
