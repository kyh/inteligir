// Where a file's bytes are kept, behind one port: private Vercel Blob on a deployment, a folder on
// disk anywhere else (`./file-store-of`). Every object sits at its own pathname,
// `files/<accountId>/<sha>/<nonce>`, written once and never over, and expires a day after it was
// written until the library keeps it; the store never checks what the bytes hash to, the library
// does.

// what the store holds at a pathname
export interface StoredObject {
  readonly bytes: number;
  readonly mime: string;
  // when it goes by itself, unix ms; null once kept
  readonly expiresAt: number | null;
}

// bytes `start` through `end` of an object, both counted
export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

interface ObjectRead {
  readonly body: ReadableStream<Uint8Array>;
  // the range the store answered; null for the whole object, which a store may answer to a range
  readonly range: ByteRange | null;
}

// the one upload a device may send: `bytes` of `mime` to `pathname`, until `validUntil`
export interface UploadAsk {
  readonly pathname: string;
  readonly mime: string;
  readonly bytes: number;
  readonly validUntil: number;
}

// where the device sends it: a PUT to `url`, absolute or a path on the cloud's origin, with
// `headers`
export interface UploadTicket {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

// what a prefix's removal came to by its deadline: every object under it gone, or some left for a
// later try, the deadline past or the store asking to slow down
type PrefixRemoval = "emptied" | "unfinished";

export interface FileStore {
  readonly uploadTicket: (ask: UploadAsk) => Promise<UploadTicket>;
  // bytes the cloud holds itself, written as an upload is: expiring, and never over another
  readonly put: (pathname: string, bytes: Uint8Array, mime: string) => Promise<void>;
  readonly head: (pathname: string) => Promise<StoredObject | null>;
  readonly read: (pathname: string, range: ByteRange | null) => Promise<ObjectRead | null>;
  // no longer expires
  readonly keep: (pathname: string) => Promise<void>;
  readonly remove: (pathname: string) => Promise<void>;
  // the folders directly under `prefix`, each as a prefix of its own
  readonly folders: (prefix: string) => Promise<string[]>;
  // every object under `prefix`, at the store's own pace, until `deadline` (unix ms)
  readonly removePrefix: (prefix: string, deadline: number) => Promise<PrefixRemoval>;
}

// how long an upload's object waits to be kept before it goes by itself
export const UNKEPT_TTL_DAYS = 1;
