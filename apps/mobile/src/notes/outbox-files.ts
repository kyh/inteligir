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
