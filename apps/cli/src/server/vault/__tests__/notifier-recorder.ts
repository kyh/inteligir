import type { DbNotifier } from "@repo/domain/notifier";
import type { DocChangeKind, VaultChangeKind } from "@repo/domain/change-kinds";

export interface NotifierRecorder extends DbNotifier {
  vaultChanges: VaultChangeKind[][];
  docChanges: { docId: string; changes: DocChangeKind[] }[];
  reset: () => void;
}

export const createNotifierRecorder = (): NotifierRecorder => {
  const recorder: NotifierRecorder = {
    docChanges: [],
    notifyDoc(docId, changes) {
      recorder.docChanges.push({ changes, docId });
    },
    notifyThread() {},
    notifyVault(changes) {
      recorder.vaultChanges.push(changes);
    },
    reset() {
      recorder.vaultChanges = [];
      recorder.docChanges = [];
    },
    vaultChanges: [],
  };
  return recorder;
};
