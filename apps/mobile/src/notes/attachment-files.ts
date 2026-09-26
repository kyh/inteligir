// attachments are fetched when first opened and kept as files named `<oid><ext>`: a blob's oid
// names its bytes, so a file never goes stale, and the one a move or a later commit leaves alone
// is found again. expo-attachment-files.ts is the app's; a sign-in, a sign-out and a revocation
// clear them with the mirror.

export interface AttachmentFiles {
  // the uri of a held file, or null
  find: (name: string) => Promise<string | null>;
  // must not interleave with `clear`: the store checks its fence immediately before, so a save
  // for a sign-in that ended never lands
  save: (name: string, bytes: Uint8Array) => Promise<string>;
  clear: () => Promise<void>;
}
