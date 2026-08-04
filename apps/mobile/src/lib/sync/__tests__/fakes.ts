// In-memory fakes for the sync adapters, so the PURE logic is exercised on node
// with no real expo-file-system / expo-crypto. Mirrors @repo/notes's own engine
// test doubles.

import type { JsonFile } from "@repo/notes/sync/base-store";
import type { Hasher } from "@repo/notes/sync/engine";
import type { VaultPath } from "@repo/notes/sync/vault-file";

import type { VaultEntry, VaultFs } from "../sync-io";

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * The exact async Web-Crypto sha-256 the mobile client injects (via expo-crypto)
 * — used here so equal bytes hash equal against @repo/notes's InMemorySyncPort.
 */
export function webCryptoHasher(): Hasher {
  return async (bytes) => {
    const digest = await crypto.subtle.digest("SHA-256", new Uint8Array(bytes));
    return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  };
}

/** A flat-map `VaultFs` fake that derives directory structure from POSIX paths.
 * `stat` mirrors a real filesystem's: a monotonic per-write "mtime" tick, so an
 * unchanged file keeps its stat across passes and EVERY write moves it — even a
 * same-length content edit (what a real ms mtime does). */
type MemVault = {
  readonly fs: VaultFs;
  readonly files: Map<VaultPath, Uint8Array>;
  writeText(path: string, text: string): void;
  readText(path: string): string | null;
};

export function memVaultFs(): MemVault {
  const files = new Map<VaultPath, Uint8Array>();
  const mtimes = new Map<VaultPath, number>();
  let tick = 0;
  const touch = (path: VaultPath): void => {
    tick += 1;
    mtimes.set(path, tick);
  };

  const fs: VaultFs = {
    listDir: (relDir) => {
      const prefix = relDir === "" ? "" : `${relDir}/`;
      const children = new Map<string, boolean>(); // name -> isDirectory
      for (const path of files.keys()) {
        if (!path.startsWith(prefix)) continue;
        const rest = path.slice(prefix.length);
        if (rest === "") continue;
        const slash = rest.indexOf("/");
        if (slash === -1) children.set(rest, false);
        else children.set(rest.slice(0, slash), true);
      }
      const entries: VaultEntry[] = [];
      for (const [name, isDirectory] of children) entries.push({ name, isDirectory });
      return entries;
    },
    exists: (path) => files.has(path),
    readBytes: (path) => {
      const bytes = files.get(path);
      if (bytes === undefined) throw new Error(`memVaultFs: read of absent ${path}`);
      return bytes;
    },
    writeBytes: (path, bytes) => {
      files.set(path, new Uint8Array(bytes));
      touch(path);
    },
    remove: (path) => {
      files.delete(path);
      mtimes.delete(path);
    },
    stat: (path) => {
      const bytes = files.get(path);
      if (bytes === undefined) return null;
      return { lastModified: mtimes.get(path) ?? 0, size: bytes.byteLength };
    },
  };

  return {
    fs,
    files,
    writeText: (path, text) => {
      files.set(path, encoder.encode(text));
      touch(path);
    },
    readText: (path) => {
      const bytes = files.get(path);
      return bytes === undefined ? null : decoder.decode(bytes);
    },
  };
}

/** An in-memory `JsonFile` fake. `peek()` reveals the stored text for assertions. */
export function fakeJsonFile(): { readonly file: JsonFile; peek(): string | null } {
  let current: string | null = null;
  return {
    file: {
      read: () => current,
      write: (text) => {
        current = text;
      },
    },
    peek: () => current,
  };
}
