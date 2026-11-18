export interface StoredObject {
  readonly bytes: number;
  readonly mime: string;
  readonly expiresAt: number | null;
}

export interface ByteRange {
  readonly start: number;
  readonly end: number;
}

interface ObjectRead {
  readonly body: ReadableStream<Uint8Array>;
  readonly range: ByteRange | null;
}

export interface UploadAsk {
  readonly pathname: string;
  readonly mime: string;
  readonly bytes: number;
  readonly validUntil: number;
}

export interface UploadTicket {
  readonly url: string;
  readonly headers: Readonly<Record<string, string>>;
}

type PrefixRemoval = "emptied" | "unfinished";

export interface FileStore {
  readonly uploadTicket: (ask: UploadAsk) => Promise<UploadTicket>;
  readonly put: (pathname: string, bytes: Uint8Array, mime: string) => Promise<void>;
  readonly head: (pathname: string) => Promise<StoredObject | null>;
  readonly read: (pathname: string, range: ByteRange | null) => Promise<ObjectRead | null>;
  readonly keep: (pathname: string) => Promise<void>;
  readonly remove: (pathname: string) => Promise<void>;
  readonly folders: (prefix: string) => Promise<string[]>;
  readonly removePrefix: (prefix: string, deadline: number) => Promise<PrefixRemoval>;
}

export const UNKEPT_TTL_DAYS = 1;
