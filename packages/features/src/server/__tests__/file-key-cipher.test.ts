import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createFileKeyCipher } from "../lib/file-key-cipher";
import { SecretStore } from "../secrets";
import type { FsAdapter } from "../lib/json-store";
import type { SecretCipher } from "../platform";

let dir: string;
let keyPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "file-key-cipher-"));
  keyPath = path.join(dir, "keys", "secret.key");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("createFileKeyCipher", () => {
  it("round-trips through AES-256-GCM", () => {
    const cipher = createFileKeyCipher(keyPath);
    const data = cipher.encrypt("sk-elevenlabs-123");
    expect(data).not.toContain("sk-elevenlabs-123");
    expect(cipher.decrypt(data)).toBe("sk-elevenlabs-123");
  });

  it("lazily creates the key file with mode 0600 and reuses it across instances", () => {
    const first = createFileKeyCipher(keyPath);
    const data = first.encrypt("secret");

    expect(fs.statSync(keyPath).mode & 0o777).toBe(0o600);
    expect(createFileKeyCipher(keyPath).decrypt(data)).toBe("secret");
  });

  it("rejects tampered ciphertext (GCM auth)", () => {
    const cipher = createFileKeyCipher(keyPath);
    const raw = Buffer.from(cipher.encrypt("secret"), "base64");
    const lastByteIndex = raw.length - 1;
    raw[lastByteIndex] = (raw[lastByteIndex] ?? 0) ^ 0xff;
    expect(() => cipher.decrypt(raw.toString("base64"))).toThrow();
  });

  it("reports unavailable on a corrupt key file instead of regenerating it", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      fs.mkdirSync(path.dirname(keyPath), { recursive: true });
      fs.writeFileSync(keyPath, "way-too-short");
      const cipher = createFileKeyCipher(keyPath);
      expect(cipher.isAvailable()).toBe(false);
    } finally {
      consoleError.mockRestore();
    }
  });
});

// Cross-mode contract: an entry written on desktop (safe-storage) must read
// as "not configured" under a file-key host — never quarantine, never
// garbage — and vice versa.
function memoryFs(): FsAdapter & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    read: (p) => files.get(p) ?? null,
    write: (p, content) => {
      files.set(p, content);
    },
    rename: (from, to) => {
      const content = files.get(from);
      if (content === undefined) throw new Error(`rename: missing ${from}`);
      files.delete(from);
      files.set(to, content);
    },
  };
}

describe("SecretStore across install modes", () => {
  it("degrades a foreign-mode entry to not-configured", () => {
    const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const fsAdapter = memoryFs();
      const safeStorageLike: SecretCipher = {
        kind: "safe-storage",
        isAvailable: () => true,
        encrypt: (plaintext) => Buffer.from(plaintext, "utf8").toString("base64"),
        decrypt: (data) => Buffer.from(data, "base64").toString("utf8"),
      };
      new SecretStore({ storePath: "/secrets.json", cipher: safeStorageLike, fs: fsAdapter }).set(
        "voice.key",
        "sk-desktop",
      );

      const serverStore = new SecretStore({
        storePath: "/secrets.json",
        cipher: createFileKeyCipher(keyPath),
        fs: fsAdapter,
      });
      expect(serverStore.get("voice.key")).toBeNull();
      expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining("another install mode"));

      // The store itself stays healthy: same key is writable in this mode.
      serverStore.set("voice.key", "sk-server");
      expect(serverStore.get("voice.key")).toBe("sk-server");
    } finally {
      consoleWarn.mockRestore();
    }
  });

  it("file-key entries survive a store reload and never hit disk in plaintext", () => {
    const fsAdapter = memoryFs();
    const cipher = createFileKeyCipher(keyPath);
    new SecretStore({ storePath: "/secrets.json", cipher, fs: fsAdapter }).set(
      "voice.key",
      "sk-server",
    );

    const raw = fsAdapter.files.get("/secrets.json") ?? "";
    expect(raw).not.toContain("sk-server");
    expect(raw).toContain("file-key");

    const reopened = new SecretStore({ storePath: "/secrets.json", cipher, fs: fsAdapter });
    expect(reopened.get("voice.key")).toBe("sk-server");
  });
});
