import type { DbNotifier } from "@repo/domain/notifier";
import type { DocChangeKind, ThreadChangeKind, VaultChangeKind } from "@repo/domain/change-kinds";

export interface NotifierRecorder extends DbNotifier {
  // `paths` absent: the notification named none, so every consumer re-diffs.
  vaultChanges: { changes: VaultChangeKind[]; paths?: readonly string[] }[];
  docChanges: { docId: string; changes: DocChangeKind[] }[];
  threadChanges: { threadId: string; changes: ThreadChangeKind[] }[];
  reset: () => void;
}

export const createNotifierRecorder = (): NotifierRecorder => {
  const recorder: NotifierRecorder = {
    docChanges: [],
    notifyDoc(docId, changes) {
      recorder.docChanges.push({ changes, docId });
    },
    notifyThread(threadId, changes) {
      recorder.threadChanges.push({ changes, threadId });
    },
    notifyVault(changes, paths) {
      recorder.vaultChanges.push(paths === undefined ? { changes } : { changes, paths });
    },
    reset() {
      recorder.vaultChanges = [];
      recorder.docChanges = [];
      recorder.threadChanges = [];
    },
    threadChanges: [],
    vaultChanges: [],
  };
  return recorder;
};
