// ---------------------------------------------------------------------------
// One JSON document under the app's document directory, over Expo's
// synchronous File API. The read/write pair every persisted mobile store sits
// on (today the chat outbox); a fresh `File` instance per
// call so `exists` reflects current state.
//
// The replace goes through a temp sibling written in full and then renamed
// over the target. Creating the target with `overwrite` and writing into it
// leaves the document EMPTY between the two calls, and a kill in that window
// (a phone's normal way of dying) truncates a queue the app promised to keep.
// The rename itself is remove-then-move natively, so a kill inside THAT window
// leaves the target absent with the complete payload still at the temp name —
// `read` adopts it rather than reporting an empty document.
//
// `read` reports an unreadable-but-present document as its own state rather
// than as absence: the two mean opposite things to a durable queue, and
// collapsing them turns "I could not read your messages" into "you had none".
// ---------------------------------------------------------------------------

import { File, Paths } from "expo-file-system";

type FileRead =
  | { readonly kind: "absent" }
  | { readonly kind: "text"; readonly text: string }
  /** Present on disk, but the bytes could not be read back. */
  | { readonly kind: "unreadable" };

export type JsonTextFile = {
  read: () => FileRead;
  /** Replace the whole document. */
  write: (text: string) => void;
  /** Move an unreadable document aside so a later write cannot erase it. */
  quarantine: () => void;
};

export function createExpoJsonFile(name: string): JsonTextFile {
  const make = () => new File(Paths.document, name);
  return {
    read: () => {
      const file = make();
      if (!file.exists) {
        const temp = new File(Paths.document, `${name}.writing`);
        if (!temp.exists) return { kind: "absent" };
        try {
          const text = temp.textSync();
          temp.moveSync(make(), { overwrite: true });
          return { kind: "text", text };
        } catch {
          return { kind: "unreadable" };
        }
      }
      try {
        return { kind: "text", text: file.textSync() };
      } catch {
        return { kind: "unreadable" };
      }
    },
    write: (text) => {
      const temp = new File(Paths.document, `${name}.writing`);
      temp.create({ intermediates: true, overwrite: true });
      temp.write(text);
      temp.moveSync(make(), { overwrite: true });
    },
    quarantine: () => {
      const file = make();
      if (!file.exists) return;
      file.moveSync(new File(Paths.document, `${name}.unreadable`), { overwrite: true });
    },
  };
}
