// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import type { ThreadChangeKind } from "./change-kinds";

export interface DbNotifier {
  notifyThread: (threadId: string, changes: ThreadChangeKind[]) => void;
}

export const noopNotifier: DbNotifier = {
  notifyThread() {
    /* empty */
  },
};

// flushed after commit, so a subscriber never sees a notification for rolled-back state and
// never re-enters the database mid-transaction.
export class NotificationBuffer implements DbNotifier {
  private deliveries: ((target: DbNotifier) => void)[] = [];

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
