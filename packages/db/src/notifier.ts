// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import type {
  DocChangeKind,
  SystemChangeKind,
  ThreadChangeKind,
  VaultChangeKind,
} from "@repo/server-contract/notifications";

/**
 * The seam the write layer announces changes through. The server's ws bus
 * implements it at the edge; everything below it stays transport-blind.
 */
export interface DbNotifier {
  notifySystem(changes: SystemChangeKind[]): void;
  notifyVault(changes: VaultChangeKind[]): void;
  notifyDoc(docId: string, changes: DocChangeKind[]): void;
  notifyThread(threadId: string, changes: ThreadChangeKind[]): void;
}

export const noopNotifier: DbNotifier = {
  notifySystem() {},
  notifyVault() {},
  notifyDoc() {},
  notifyThread() {},
};
