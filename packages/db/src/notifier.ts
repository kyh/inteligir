// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import type {
  DocChangeKind,
  ThreadChangeKind,
  VaultChangeKind,
} from "@repo/server-contract/notifications";

/**
 * The seam the write layer announces changes through. The server's ws bus
 * implements it at the edge; everything below it stays transport-blind.
 */
export interface DbNotifier {
  /** `paths` names the vault-relative paths a files-changed announcement
   *  covers; omitted means the change has no path list and every consumer
   *  must re-diff (see the contract's vault changed message). */
  notifyVault(changes: VaultChangeKind[], paths?: readonly string[]): void;
  notifyDoc(docId: string, changes: DocChangeKind[]): void;
  notifyThread(threadId: string, changes: ThreadChangeKind[]): void;
}

export const noopNotifier: DbNotifier = {
  notifyVault() {},
  notifyDoc() {},
  notifyThread() {},
};

/**
 * A DbNotifier that records instead of delivering, for multi-write
 * transactions: the writes inside the transaction announce into the buffer,
 * and the caller flushes AFTER commit — so a subscriber can never observe a
 * notification for state that was rolled back, and never re-enters the
 * database mid-transaction.
 */
export class NotificationBuffer implements DbNotifier {
  private deliveries: Array<(target: DbNotifier) => void> = [];

  notifyVault(changes: VaultChangeKind[], paths?: readonly string[]): void {
    this.deliveries.push((target) => target.notifyVault(changes, paths));
  }

  notifyDoc(docId: string, changes: DocChangeKind[]): void {
    this.deliveries.push((target) => target.notifyDoc(docId, changes));
  }

  notifyThread(threadId: string, changes: ThreadChangeKind[]): void {
    this.deliveries.push((target) => target.notifyThread(threadId, changes));
  }

  flushTo(target: DbNotifier): void {
    const deliveries = this.deliveries;
    this.deliveries = [];
    for (const deliver of deliveries) {
      deliver(target);
    }
  }
}
