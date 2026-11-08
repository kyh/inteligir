// A share from another app, saved: a page or a link the share sheet hands over is saved as its
// link, with the words shared beside it as its note, and the cloud's fill reads the page once it
// lands. Text alone is a thought.
// Platform-free: the scenario suite runs it under node.

import { ReplicaClosedError } from "@repo/library-replica/library-replica";
import type { LibraryReplica } from "@repo/library-replica/library-replica";
import { createPhoneSaves } from "./phone-saves";
import type { SavedItem, SaveTarget } from "./phone-saves";
import type { SharedSave } from "./share-payload";

// what became of a share: saved, refused, or its library gone under it, a sign-out landing while
// it was saved, which saved nothing and leaves the share to the next sign-in
type SharedOutcome = SavedItem | { readonly kind: "left" };

// a share saved as its link, else as text; null for a share that held nothing to save
export const saveShared = async (
  args: { readonly replica: LibraryReplica; readonly newBlockId: () => string },
  shared: SharedSave,
): Promise<SharedOutcome | null> => {
  const target: SaveTarget = { folderId: null };
  const saves = createPhoneSaves({ newBlockId: args.newBlockId, replica: args.replica });
  try {
    switch (shared.kind) {
      case "link": {
        return await saves.saveLink(shared, target);
      }
      case "text": {
        return await saves.saveText(shared.text, target);
      }
      case "nothing": {
        return null;
      }
      // no default
    }
  } catch (error) {
    if (error instanceof ReplicaClosedError) {
      return { kind: "left" };
    }
    throw error;
  }
};
