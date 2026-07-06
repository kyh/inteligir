// A Map-backed SyncPort fake for driving SyncManager end-to-end without a real
// coordinator. It mints monotonic per-file versions, honors optimistic
// concurrency exactly like the wire contract (a stale expected-version comes
// back as a typed `version-conflict`, never a throw), bumps a vault generation,
// and broadcasts VaultChange to subscribers — enough to exercise the whole
// reconcile+execute loop.

import crypto from "node:crypto";

import { ABSENT_VERSION, type VaultFile, type VaultPath } from "@repo/core/sync/vault-file";
import type { VaultManifest } from "@repo/core/sync/manifest";
import type {
  DeleteResult,
  GetResult,
  PutResult,
  SyncPort,
  Unsubscribe,
  VaultChange,
} from "@repo/core/sync/sync-port";

function sha256Hex(bytes: Uint8Array): string {
  return crypto.createHash("sha256").update(bytes).digest("hex");
}

type Stored = { file: VaultFile; content: Uint8Array };

export class InMemorySyncPort implements SyncPort {
  private readonly files = new Map<VaultPath, Stored>();
  private generation = 0;
  private readonly subscribers = new Set<(change: VaultChange) => void>();

  constructor(private readonly vaultId: string) {}

  /** Current vault-wide generation counter (test assertions). */
  currentGeneration(): number {
    return this.generation;
  }

  listManifest(): Promise<VaultManifest> {
    return Promise.resolve({
      vaultId: this.vaultId,
      generation: this.generation,
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

  putFile(path: VaultPath, content: Uint8Array, expectedBaseVersion: number): Promise<PutResult> {
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
      return Promise.resolve({ ok: false, reason: "version-conflict", current: current.file });
    }
    const file: VaultFile = {
      path,
      contentHash: sha256Hex(content),
      version: currentVersion + 1,
      size: content.length,
    };
    this.files.set(path, { file, content: new Uint8Array(content) });
    this.generation += 1;
    this.emit({ kind: "upserted", file });
    return Promise.resolve({ ok: true, file });
  }

  deleteFile(path: VaultPath, expectedBaseVersion: number): Promise<DeleteResult> {
    const current = this.files.get(path);
    if (!current) return Promise.resolve({ ok: false, reason: "not-found" });
    if (current.file.version !== expectedBaseVersion) {
      return Promise.resolve({ ok: false, reason: "version-conflict", current: current.file });
    }
    this.files.delete(path);
    this.generation += 1;
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
