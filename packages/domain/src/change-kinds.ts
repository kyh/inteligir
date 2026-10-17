// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

// import-changed: an import job's counts or state moved. targets-changed: a settle added,
// removed or renamed a path, or changed a doc's aliases or id, so the set of link targets moved; a
// body edit does not, which is every fill's and every keystroke's change.
export const VAULT_CHANGE_KINDS = [
  "files-changed",
  "sync-status-changed",
  "import-changed",
  "targets-changed",
] as const;
export type VaultChangeKind = (typeof VAULT_CHANGE_KINDS)[number];

export const DOC_CHANGE_KINDS = ["content-changed"] as const;
export type DocChangeKind = (typeof DOC_CHANGE_KINDS)[number];

export const THREAD_CHANGE_KINDS = [
  "thread-created",
  "events-appended",
  "status-changed",
  "archived-changed",
  "queue-changed",
  "interactions-changed",
  "origin-changed",
  "title-changed",
  "changes-committed",
] as const;
export type ThreadChangeKind = (typeof THREAD_CHANGE_KINDS)[number];
