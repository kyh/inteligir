// The vault tree the crawl is pinned against: it is built on a real filesystem
// and the walk's complete listing must equal CRAWL_FIXTURE_LISTING, so a name
// silently added to (or dropped from) @repo/notes/knowledge/crawl-exclusions
// fails a test instead of making the user's files unreachable.

/** Every file the fixture vault contains, in no particular order. */
export const CRAWL_FIXTURE_FILES: readonly string[] = [
  "note.md",
  "assets/pic.png",
  // Hidden from a sidebar, present on disk — and so in the listing.
  ".hidden.md",
  ".archive/moved.md",
  "deep/.stash/kept.md",
  ".gitignore",
  // In-flight atomic-write siblings: half-written bytes, never vault files.
  "note.md.tmp",
  "deep/.stash/draft.md.tmp",
  // Hard-pruned trees: version control, note-app state, dependency and build
  // caches a vault in or beside a dev repo picks up, per-machine editor state.
  ".git/config",
  ".hg/store/data.i",
  "node_modules/pkg/index.js",
  ".obsidian/workspace.json",
  ".trash/old.md",
  ".venv/lib/python3.12/site.py",
  ".direnv/bin/x",
  ".next/cache/bundle.pack",
  ".turbo/daemon/log",
  ".cache/blob",
  ".pytest_cache/README.md",
  ".yarn/cache/pkg.zip",
  ".vscode/settings.json",
  ".idea/workspace.xml",
  ".claude/settings.local.json",
  // Volume metadata — a vault on an external drive or a network share.
  ".Spotlight-V100/store.db",
  ".fseventsd/000000000001",
  ".Trashes/501/old.md",
  "$RECYCLE.BIN/S-1-5-21/old.md",
  // OS-owned, rewritten on every browse.
  ".DS_Store",
  "assets/.DS_Store",
  "Thumbs.db",
  "desktop.ini",
  // AppleDouble sidecars, written beside a file on volumes with no xattrs.
  "._note.md",
  "assets/._pic.png",
  // A cloud placeholder: evidence that `evicted.md` is not on this disk, not a
  // file of its own — it must never surface as an empty note.
  ".evicted.md.icloud",
];

/** The files a complete listing of that tree must contain — sorted, so a walk
 * that orders its readdir differently still compares equal. */
export const CRAWL_FIXTURE_LISTING: readonly string[] = [
  ".archive/moved.md",
  ".gitignore",
  ".hidden.md",
  "assets/pic.png",
  "deep/.stash/kept.md",
  "note.md",
];
