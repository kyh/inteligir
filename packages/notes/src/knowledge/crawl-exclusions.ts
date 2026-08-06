// ---------------------------------------------------------------------------
// What a vault crawl leaves OUT of the vault ENTIRELY — the one exclusion set
// the walk applies before anything else sees a path.
//
// A name here is not hidden, it is absent: the listing never carries it, the
// knowledge index never projects it, and nothing downstream can offer the user
// a file the crawl refused to produce. So only names NO vault can hold as a
// real note belong here. A rule that varies per vault, per user or over time —
// a `.gitignore` entry, a hidden-file preference — is a VIEW filter, applied by
// the consumer over a complete crawl, never in this file.
//
// Dot-entries are NOT excluded wholesale. Hiding them declutters a sidebar; a
// `.archive/` folder is still the user's notes, and pruning it here would make
// a whole subtree unreachable the moment someone drags a folder into it. The
// named trees below are the documented exception: each is tool- or OS-owned,
// regenerated on demand, and never the user's notes.
// ---------------------------------------------------------------------------

/** Directory names hard-pruned at every depth — never descended, never listed,
 * whatever the ignore files say. A vault that sits in or beside a dev repo
 * would otherwise crawl gigabytes of regenerable build output; a vault on an
 * external drive or a network share would crawl the volume's own bookkeeping.
 * Every name here is owned by a tool or the OS and rebuilt on demand, so
 * nothing is lost by never seeing it. */
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
  // Editor / agent workspace state: settings and local history, rewritten
  // constantly and meaningless as notes.
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
 * that catches one mid-save must not offer the half-written bytes to anyone. */
const TMP_SUFFIX = ".tmp";

/** OS-owned metadata files. Excluded not because they are hidden but because
 * the OS rewrites them on every browse, so a crawl that carried them would
 * churn on its own schedule forever while nothing ever reads them back. */
const OS_METADATA_NAMES: ReadonlySet<string> = new Set([".DS_Store", "Thumbs.db", "desktop.ini"]);

/** macOS's AppleDouble sidecar: writing `note.md` to a volume with no extended
 * attributes (exFAT, SMB, most USB sticks) leaves `._note.md` beside it
 * carrying the attributes. It is derived from the file next to it and is
 * never a note of its own. */
const APPLE_DOUBLE_PREFIX = "._";

const CLOUD_PLACEHOLDER_SUFFIX = ".icloud";

/** Pruned at every depth whatever the entry's type — a crawl neither descends
 * nor lists these. */
export function isPrunedName(name: string): boolean {
  return SKIP_DIRS.has(name);
}

/** Files a crawl must leave out of the vault entirely. */
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
 * own: it never belongs in a listing, and the name it yields is how a caller
 * reports the eviction as a file it could not account for. Dropbox and OneDrive
 * on-demand keep the real filename (their eviction lives in filesystem
 * attributes), so there is nothing for a name check to see there. */
export function cloudPlaceholderTarget(name: string): string | null {
  if (!name.startsWith(".") || !name.endsWith(CLOUD_PLACEHOLDER_SUFFIX)) return null;
  const target = name.slice(1, -CLOUD_PLACEHOLDER_SUFFIX.length);
  return target.length > 0 ? target : null;
}
