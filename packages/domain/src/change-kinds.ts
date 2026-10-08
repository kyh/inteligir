// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

// the cloud sync's status: the `sync` entity, the one the renderer's sync row reads.
export const SYNC_CHANGE_KINDS = ["sync-status-changed"] as const;
export type SyncChangeKind = (typeof SYNC_CHANGE_KINDS)[number];

export const THREAD_CHANGE_KINDS = [
  "thread-created",
  "events-appended",
  "status-changed",
  "archived-changed",
  "queue-changed",
  "interactions-changed",
  "title-changed",
] as const;
export type ThreadChangeKind = (typeof THREAD_CHANGE_KINDS)[number];
