import type { DbNotifier } from "@repo/db/notifier";
import type { DocChangeKind, VaultChangeKind } from "@repo/server-contract/notifications";

export interface NotifierRecorder extends DbNotifier {
  vaultChanges: VaultChangeKind[][];
  docChanges: Array<{ docId: string; changes: DocChangeKind[] }>;
  reset(): void;
}

export function createNotifierRecorder(): NotifierRecorder {
  const recorder: NotifierRecorder = {
    vaultChanges: [],
    docChanges: [],
    notifyVault(changes) {
      recorder.vaultChanges.push(changes);
    },
    notifyDoc(docId, changes) {
      recorder.docChanges.push({ docId, changes });
    },
    notifyThread() {},
    reset() {
      recorder.vaultChanges = [];
      recorder.docChanges = [];
    },
  };
  return recorder;
}
