// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import type { ThreadChangeKind, VaultChangeKind } from "./change-kinds";

export interface DbNotifier {
  notifyVault: (changes: VaultChangeKind[]) => void;
  notifyThread: (threadId: string, changes: ThreadChangeKind[]) => void;
}

export const noopNotifier: DbNotifier = {
  notifyThread() {
    /* empty */
  },
  notifyVault() {
    /* empty */
  },
};

// flushed after commit, so a subscriber never sees a notification for rolled-back state and
// never re-enters the database mid-transaction.
export class NotificationBuffer implements DbNotifier {
  private deliveries: ((target: DbNotifier) => void)[] = [];

  notifyVault(changes: VaultChangeKind[]): void {
    this.deliveries.push((target) => {
      target.notifyVault(changes);
    });
  }

  notifyThread(threadId: string, changes: ThreadChangeKind[]): void {
    this.deliveries.push((target) => {
      target.notifyThread(threadId, changes);
    });
  }

  flushTo(target: DbNotifier): void {
    const { deliveries } = this;
    this.deliveries = [];
    for (const deliver of deliveries) {
      deliver(target);
    }
  }
}
