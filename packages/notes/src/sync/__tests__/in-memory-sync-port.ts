// The shared in-memory rig for driving SyncEngine end-to-end without a real
// coordinator: a Map-backed SyncPort fake (mints monotonic per-file versions,
// honors optimistic concurrency exactly like the wire contract — a stale
// expected-version comes back as a typed `version-conflict`, never a throw —
// and broadcasts VaultChange to subscribers), plus the Map-backed `MemoryVault`
// SyncIo fake and the Web Crypto hasher the engine tests inject.

import { ABSENT_VERSION, type VaultFile, type VaultPath } from "../vault-file";
import type { VaultManifest } from "../manifest";
import type { Hasher, SyncIo } from "../engine";
import type {
  DeleteResult,
  GetResult,
  PutResult,
  SyncPort,
  Unsubscribe,
  VaultChange,
} from "../sync-port";

const enc = new TextEncoder();
const dec = new TextDecoder();

// Web Crypto (the WebWorker-lib global) rather than node crypto: @repo/notes
// stays node-free even in tests, and this is the exact async digest the mobile
// client will use. It must match the engine's injected hasher so equal bytes
// hash equal (reconcile relies on that).
async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // Copy into a fresh (non-shared) buffer so the type is `<ArrayBuffer>`, which
  // `BufferSource` requires — a plain Uint8Array may be SharedArrayBuffer-backed.
  const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** The engine-injectable form of the same digest the port fake hashes with. */
export function webCryptoHasher(): Hasher {
  return sha256Hex;
}

export function encode(text: string): Uint8Array {
  return enc.encode(text);
}

/** A Map-backed vault implementing the engine's `SyncIo`, plus text helpers. */
export class MemoryVault {
  private readonly files = new Map<VaultPath, Uint8Array>();

  readonly io: SyncIo = {
    list: () => [...this.files.keys()].toSorted(),
    read: (path) => {
      const bytes = this.files.get(path);
      if (bytes === undefined) throw new Error(`MemoryVault: read of absent ${path}`);
      return bytes;
    },
    write: (path, content) => {
      this.files.set(path, new Uint8Array(content));
    },
    remove: (path) => {
      this.files.delete(path);
    },
  };

  writeText(path: string, text: string): void {
    this.files.set(path, enc.encode(text));
  }

  readText(path: string): string | null {
    const bytes = this.files.get(path);
    return bytes === undefined ? null : dec.decode(bytes);
  }

  delete(path: string): void {
    this.files.delete(path);
  }

  paths(): string[] {
    return [...this.files.keys()].toSorted();
  }
}

type Stored = { file: VaultFile; content: Uint8Array };

export class InMemorySyncPort implements SyncPort {
  private readonly files = new Map<VaultPath, Stored>();
  private readonly subscribers = new Set<(change: VaultChange) => void>();

  constructor(private readonly vaultId: string) {}

  listManifest(): Promise<VaultManifest> {
    return Promise.resolve({
      vaultId: this.vaultId,
      files: [...this.files.values()].map((stored) => stored.file),
    });
  }

  getFile(path: VaultPath): Promise<GetResult> {
    const stored = this.files.get(path);
    return Promise.resolve(
      stored
        ? { ok: true, file: stored.file, content: stored.content }
        : { ok: false, reason: "not-found" },
    );
  }

  async putFile(
    path: VaultPath,
    content: Uint8Array,
    expectedBaseVersion: number,
  ): Promise<PutResult> {
    const current = this.files.get(path);
    const currentVersion = current?.file.version ?? ABSENT_VERSION;
    if (currentVersion !== expectedBaseVersion) {
      if (!current) {
        // A correct client only submits a nonzero expected version for a file it
        // just saw on the coordinator — so this can't happen against a fresh
        // snapshot. Surface it loudly rather than fabricate a `current`.
        throw new Error(
          `InMemorySyncPort: putFile on absent ${path} with expected ${expectedBaseVersion}`,
        );
      }
      return { ok: false, reason: "version-conflict", current: current.file };
    }
    const file: VaultFile = {
      path,
      contentHash: await sha256Hex(content),
      version: currentVersion + 1,
      size: content.length,
    };
    this.files.set(path, { file, content: new Uint8Array(content) });
    this.emit({ kind: "upserted", file });
    return { ok: true, file };
  }

  deleteFile(path: VaultPath, expectedBaseVersion: number): Promise<DeleteResult> {
    const current = this.files.get(path);
    if (!current) return Promise.resolve({ ok: false, reason: "not-found" });
    if (current.file.version !== expectedBaseVersion) {
      return Promise.resolve({ ok: false, reason: "version-conflict", current: current.file });
    }
    this.files.delete(path);
    this.emit({ kind: "deleted", path });
    return Promise.resolve({ ok: true });
  }

  subscribe(onChange: (change: VaultChange) => void): Unsubscribe {
    this.subscribers.add(onChange);
    return () => {
      this.subscribers.delete(onChange);
    };
  }

  private emit(change: VaultChange): void {
    for (const subscriber of this.subscribers) subscriber(change);
  }
}
