// The ONE vault tree every platform crawl is pinned against. Desktop
// (packages/vault) and mobile (apps/mobile) each build it in their own
// filesystem and assert their manifest listing equals CRAWL_FIXTURE_MANIFEST,
// so an exclusion added to one walk and not the other fails a test instead of
// deleting the divergent files off every device on the next sync pass.

/** Every file the fixture vault contains, in no particular order. */
export const CRAWL_FIXTURE_FILES: readonly string[] = [
  "note.md",
  "assets/pic.png",
  // Hidden from a sidebar, present on disk — and so in the manifest.
  ".hidden.md",
  ".archive/moved.md",
  "deep/.stash/kept.md",
  ".gitignore",
  // In-flight atomic-write siblings: half-written bytes, never manifest files.
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
  // file of its own — it must never upload as an empty note.
  ".evicted.md.icloud",
];

/** The files a manifest listing of that tree must contain — sorted, so a
 * platform that orders its walk differently still compares equal. */
export const CRAWL_FIXTURE_MANIFEST: readonly string[] = [
  ".archive/moved.md",
  ".gitignore",
  ".hidden.md",
  "assets/pic.png",
  "deep/.stash/kept.md",
  "note.md",
];
