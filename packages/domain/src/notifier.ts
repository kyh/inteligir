// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import type { DocChangeKind, ThreadChangeKind, VaultChangeKind } from "./change-kinds";

export interface DbNotifier {
  // omitted `paths` means no path list: every consumer must re-diff.
  notifyVault(changes: VaultChangeKind[], paths?: readonly string[]): void;
  notifyDoc(docId: string, changes: DocChangeKind[]): void;
  notifyThread(threadId: string, changes: ThreadChangeKind[]): void;
}

export const noopNotifier: DbNotifier = {
  notifyVault() {},
  notifyDoc() {},
  notifyThread() {},
};

// flushed after commit, so a subscriber never sees a notification for rolled-back state and
// never re-enters the database mid-transaction.
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
