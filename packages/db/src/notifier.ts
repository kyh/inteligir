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

/**
 * A DbNotifier that records instead of delivering, for multi-write
 * transactions: the writes inside the transaction announce into the buffer,
 * and the caller flushes AFTER commit — so a subscriber can never observe a
 * notification for state that was rolled back, and never re-enters the
 * database mid-transaction.
 */
export class NotificationBuffer implements DbNotifier {
  private deliveries: Array<(target: DbNotifier) => void> = [];

  notifySystem(changes: SystemChangeKind[]): void {
    this.deliveries.push((target) => target.notifySystem(changes));
  }

  notifyVault(changes: VaultChangeKind[]): void {
    this.deliveries.push((target) => target.notifyVault(changes));
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
