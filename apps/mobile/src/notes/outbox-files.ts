// an attachment waiting in the outbox keeps its bytes in a file of its own, named by its blob oid,
// never in the database beside the rows. expo-outbox-files.ts is the app's; they go with the
// outbox when a sign-out discards it or a revocation wipes it.

export interface OutboxFiles {
  // resolves once the bytes are whole on disk
  stage: (name: string, bytes: Uint8Array) => Promise<void>;
  read: (name: string) => Promise<Uint8Array>;
  // the uri of a staged file, or null
  find: (name: string) => Promise<string | null>;
  remove: (name: string) => Promise<void>;
  clear: () => Promise<void>;
}

// the folder the files sit in, which a clear deletes
export interface OutboxFolder extends OutboxFiles {
  // makes the folder when it is missing, and answers its filesystem path
  ensure: () => Promise<string>;
}

// the rows naming a staged photo live in the database the iCloud backup leaves out, so a backup
// holding the photo would restore bytes nothing sends. Flagged before every stage, since the flag
// goes with a cleared folder.
export const excludedFromBackup = (
  folder: OutboxFolder,
  excludeFromBackup: (directory: string) => Promise<void>,
): OutboxFiles => ({
  clear: folder.clear,
  find: folder.find,
  read: folder.read,
  remove: folder.remove,
  stage: async (name, bytes) => {
    await excludeFromBackup(await folder.ensure());
    await folder.stage(name, bytes);
  },
});
