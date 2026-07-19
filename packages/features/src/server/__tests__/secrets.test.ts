import { describe, expect, it, vi } from "vitest";

import { SecretStore } from "../secrets";
import type { FsAdapter } from "../storage/json-store";
import type { SecretCipher } from "../platform";

function memoryFs(): FsAdapter & { files: Map<string, string>; modes: Map<string, number> } {
  const files = new Map<string, string>();
  const modes = new Map<string, number>();
  return {
    files,
    modes,
    read: (path) => files.get(path) ?? null,
    write: (path, content, mode) => {
      files.set(path, content);
      if (mode !== undefined) modes.set(path, mode);
    },
    rename: (from, to) => {
      const content = files.get(from);
      if (content === undefined) throw new Error(`rename: missing ${from}`);
      files.delete(from);
      files.set(to, content);
    },
  };
}

// Reversible toy cipher — enough to prove plaintext never hits the adapter.
function fakeCipher(available = true): SecretCipher {
  return {
    kind: "safe-storage",
    isAvailable: () => available,
    encrypt: (plaintext) => Buffer.from(plaintext, "utf8").toString("base64"),
    decrypt: (data) => Buffer.from(data, "base64").toString("utf8"),
  };
}

const PATH = "/secrets.json";

describe("SecretStore", () => {
  it("round-trips a secret through the cipher", () => {
    const fs = memoryFs();
    const store = new SecretStore({ storePath: PATH, cipher: fakeCipher(), fs });

    store.set("voice.key", "sk-elevenlabs-123");

    expect(store.get("voice.key")).toBe("sk-elevenlabs-123");
    expect(store.has("voice.key")).toBe(true);
    expect(store.get("missing")).toBeNull();
  });

  it("never writes the plaintext to disk when the cipher is available", () => {
    const fs = memoryFs();
    const store = new SecretStore({ storePath: PATH, cipher: fakeCipher(), fs });

    store.set("voice.key", "sk-elevenlabs-123");

    const raw = fs.files.get(PATH) ?? "";
    expect(raw).not.toContain("sk-elevenlabs-123");
    expect(raw).toContain("safe-storage");
  });

  it("falls back to a marked plaintext entry when encryption is unavailable", () => {
    const fs = memoryFs();
    const store = new SecretStore({ storePath: PATH, cipher: fakeCipher(false), fs });

    store.set("voice.key", "sk-plain");

    const parsed: unknown = JSON.parse(fs.files.get(PATH) ?? "");
    expect(parsed).toMatchObject({
      version: 1,
      secrets: { "voice.key": { kind: "plaintext", data: "sk-plain" } },
    });
    expect(store.get("voice.key")).toBe("sk-plain");
  });

  it("writes the file with mode 0o600", () => {
    const fs = memoryFs();
    const store = new SecretStore({ storePath: PATH, cipher: fakeCipher(), fs });

    store.set("voice.key", "sk");

    expect(fs.modes.get(PATH)).toBe(0o600);
  });

  it("persists across instances at the same path", () => {
    const fs = memoryFs();
    new SecretStore({ storePath: PATH, cipher: fakeCipher(), fs }).set("voice.key", "sk-1");

    const reopened = new SecretStore({ storePath: PATH, cipher: fakeCipher(), fs });
    expect(reopened.get("voice.key")).toBe("sk-1");
  });

  it("delete removes the entry", () => {
    const fs = memoryFs();
    const store = new SecretStore({ storePath: PATH, cipher: fakeCipher(), fs });

    store.set("voice.key", "sk");
    store.delete("voice.key");

    expect(store.has("voice.key")).toBe(false);
    expect(store.get("voice.key")).toBeNull();
    expect(fs.files.get(PATH) ?? "").not.toContain("voice.key");
  });

  it("reads an undecryptable entry as absent instead of throwing", () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const fs = memoryFs();
      const cipher: SecretCipher = {
        ...fakeCipher(),
        decrypt: () => {
          throw new Error("keychain changed");
        },
      };
      const store = new SecretStore({ storePath: PATH, cipher, fs });

      store.set("voice.key", "sk");

      expect(store.get("voice.key")).toBeNull();
      expect(consoleError).toHaveBeenCalledWith(
        expect.stringContaining("failed to decrypt"),
        expect.any(Error),
      );
    } finally {
      consoleError.mockRestore();
    }
  });
});
