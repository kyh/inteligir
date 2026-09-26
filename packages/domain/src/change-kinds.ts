// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

export const VAULT_CHANGE_KINDS = ["files-changed", "sync-status-changed"] as const;
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
