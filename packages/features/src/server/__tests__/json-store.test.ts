import { afterEach, describe, it, expect, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import {
  JsonStore,
  type FsAdapter,
  type StoreRecoveryEvent,
  type StoreVersioning,
} from "../storage/json-store";

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

const NumbersSchema = Type.Array(Type.Number());
const RecordsSchema = Type.Array(Type.Object({ count: Type.Number() }));

// Silence the unconditional corruption/quarantine log; tests that care about
// logging assert against this spy.
const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
afterEach(() => {
  consoleError.mockClear();
});

describe("JsonStore", () => {
  it("returns default value when file missing", () => {
    const fs = memoryFs();
    const store = new JsonStore<number[]>("/test.json", NumbersSchema, [], { fs });
    expect(store.read()).toEqual([]);
  });

  it("reads and validates from file", () => {
    const fs = memoryFs();
    fs.files.set("/test.json", JSON.stringify([1, 2, 3]));
    const store = new JsonStore<number[]>("/test.json", NumbersSchema, [], { fs });
    expect(store.read()).toEqual([1, 2, 3]);
  });

  it("returns default on invalid data", () => {
    const fs = memoryFs();
    fs.files.set("/test.json", JSON.stringify("not an array"));
    const store = new JsonStore<number[]>("/test.json", NumbersSchema, [99], {
      fs,
      onRecovery: () => undefined,
    });
    expect(store.read()).toEqual([99]);
  });

  it("returns default on malformed JSON", () => {
    const fs = memoryFs();
    fs.files.set("/test.json", "{broken");
    const store = new JsonStore<number[]>("/test.json", NumbersSchema, [], {
      fs,
      onRecovery: () => undefined,
    });
    expect(store.read()).toEqual([]);
  });

  it("does not expose the cached default by reference", () => {
    const fs = memoryFs();
    const defaultValue = [{ count: 1 }];
    const store = new JsonStore<{ count: number }[]>("/test.json", RecordsSchema, defaultValue, {
      fs,
    });

    const first = store.read();
    const row = first[0];
    if (!row) throw new Error("missing row");
    row.count = 99;

    expect(store.read()).toEqual([{ count: 1 }]);
    expect(defaultValue).toEqual([{ count: 1 }]);
  });

  it("caches after first read", () => {
    const fs = memoryFs();
    fs.files.set("/test.json", JSON.stringify([1]));
    const store = new JsonStore<number[]>("/test.json", NumbersSchema, [], { fs });

    expect(store.read()).toEqual([1]);
    // Modify file — cache should still return old value
    fs.files.set("/test.json", JSON.stringify([999]));
    expect(store.read()).toEqual([1]);
  });

  it("write updates cache and file", () => {
    const fs = memoryFs();
    const store = new JsonStore<number[]>("/test.json", NumbersSchema, [], { fs });

    store.write([10, 20]);
    expect(store.read()).toEqual([10, 20]);
    expect(JSON.parse(fs.files.get("/test.json") ?? "")).toEqual([10, 20]);
  });

  it("does not retain the caller's written object by reference", () => {
    const fs = memoryFs();
    const store = new JsonStore<{ count: number }[]>("/test.json", RecordsSchema, [], { fs });
    const data = [{ count: 1 }];

    store.write(data);
    const row = data[0];
    if (!row) throw new Error("missing row");
    row.count = 99;

    expect(store.read()).toEqual([{ count: 1 }]);
  });

  it("update reads, transforms, writes atomically", () => {
    const fs = memoryFs();
    fs.files.set("/test.json", JSON.stringify([1, 2]));
    const store = new JsonStore<number[]>("/test.json", NumbersSchema, [], { fs });

    const result = store.update((nums) => [...nums, 3]);
    expect(result).toEqual([1, 2, 3]);
    expect(store.read()).toEqual([1, 2, 3]);
  });

  it("invalidate clears cache", () => {
    const fs = memoryFs();
    fs.files.set("/test.json", JSON.stringify([1]));
    const store = new JsonStore<number[]>("/test.json", NumbersSchema, [], { fs });

    store.read(); // populate cache
    fs.files.set("/test.json", JSON.stringify([999]));
    store.invalidate();
    expect(store.read()).toEqual([999]);
  });
});

describe("JsonStore write-time validation", () => {
  // T deliberately looser than the schema so the test can hand the store a
  // value its schema rejects — the runtime stand-in for a programmer bug
  // (encode/decode drift, schema↔generic mismatch).
  it("throws on a write whose value fails the schema, persisting nothing", () => {
    const fs = memoryFs();
    const store = new JsonStore<unknown[]>("/test.json", NumbersSchema, [], { fs });

    expect(() => store.write(["not a number"])).toThrow(
      /refusing to write value that fails schema validation/,
    );
    expect(fs.files.has("/test.json")).toBe(false);
    expect(store.read()).toEqual([]); // cache untouched — still the default
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("refusing to write value that fails schema validation"),
    );
  });

  it("accepts a subsequent valid write after a rejected one", () => {
    const fs = memoryFs();
    const store = new JsonStore<unknown[]>("/test.json", NumbersSchema, [], { fs });

    expect(() => store.write(["bad"])).toThrow(/schema validation/);
    store.write([1, 2]);
    expect(JSON.parse(fs.files.get("/test.json") ?? "")).toEqual([1, 2]);
    expect(store.read()).toEqual([1, 2]);
  });

  it("validates the encoded (disk) shape, not the in-memory one", () => {
    const fs = memoryFs();
    // In-memory Set ↔ on-disk number[]: the schema describes the disk shape,
    // so the check must run after encode or every encoding store would throw.
    const store = new JsonStore<Set<number>>("/test.json", NumbersSchema, new Set(), {
      fs,
      decode: (raw) => {
        if (!Value.Check(NumbersSchema, raw)) throw new Error("expected number[]");
        return new Set(raw);
      },
      encode: (value) => [...value],
    });

    store.write(new Set([1, 2]));
    expect(JSON.parse(fs.files.get("/test.json") ?? "")).toEqual([1, 2]);
  });
});

describe("JsonStore file modes", () => {
  it("passes the configured mode to every write, including recovery backups", () => {
    const fs = memoryFs();
    fs.files.set("/cred.json", "{broken");
    const store = new JsonStore<number[]>("/cred.json", NumbersSchema, [], {
      fs,
      mode: 0o600,
      onRecovery: () => undefined,
    });

    expect(store.read()).toEqual([]); // corrupt file moved aside, store reset
    store.write([1]);

    expect(fs.modes.get("/cred.json")).toBe(0o600);
  });

  it("creates the file 0o600 and its directory 0o700 through the real adapter", () => {
    if (process.platform === "win32") return; // POSIX modes don't apply
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "json-store-mode-"));
    const filePath = path.join(dir, "nested", "secrets.json");
    try {
      const store = new JsonStore<number[]>(filePath, NumbersSchema, [], { mode: 0o600 });
      store.write([1, 2]);

      expect(fs.statSync(filePath).mode & 0o777).toBe(0o600);
      expect(fs.statSync(path.dirname(filePath)).mode & 0o777).toBe(0o700);
      expect(JSON.parse(fs.readFileSync(filePath, "utf8"))).toEqual([1, 2]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("JsonStore corruption recovery", () => {
  it("moves the corrupt file aside, logs, and surfaces the recovery event", () => {
    const fs = memoryFs();
    fs.files.set("/test.json", "{broken");
    const events: StoreRecoveryEvent[] = [];
    const store = new JsonStore<number[]>("/test.json", NumbersSchema, [7], {
      fs,
      onRecovery: (event) => events.push(event),
    });

    expect(store.read()).toEqual([7]);

    // Original moved (not deleted): the live path is gone, a .corrupt-<ts>
    // backup holds the original bytes.
    expect(fs.files.has("/test.json")).toBe(false);
    const backupKey = [...fs.files.keys()].find((k) => k.startsWith("/test.json.corrupt-"));
    if (!backupKey) throw new Error("expected a corrupt backup file");
    expect(fs.files.get(backupKey)).toBe("{broken");

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "corrupt",
      filePath: "/test.json",
      backupPath: backupKey,
      reason: "unparseable JSON",
    });
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining(backupKey));
  });

  it("falls back to a backup copy when the adapter cannot rename", () => {
    const files = new Map<string, string>([["/test.json", "not json"]]);
    const fs: FsAdapter = {
      read: (path) => files.get(path) ?? null,
      write: (path, content) => {
        files.set(path, content);
      },
    };
    const store = new JsonStore<number[]>("/test.json", NumbersSchema, [], {
      fs,
      onRecovery: () => undefined,
    });

    expect(store.read()).toEqual([]);
    expect(files.get("/test.json")).toBe("not json");
    const backupKey = [...files.keys()].find((k) => k.startsWith("/test.json.corrupt-"));
    expect(backupKey ? files.get(backupKey) : undefined).toBe("not json");
  });

  it("logs even when no onRecovery handler is registered", () => {
    const fs = memoryFs();
    fs.files.set("/test.json", "][");
    const store = new JsonStore<number[]>("/test.json", NumbersSchema, [], { fs });

    expect(store.read()).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("/test.json"));
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("unparseable JSON"));
  });
});

// Versioned wire format: v1 stored items as strings, v2 stores numbers.
const VersionedSchema = Type.Object(
  { version: Type.Literal(2), items: Type.Array(Type.Number()) },
  { additionalProperties: false },
);

type Versioned = { version: 2; items: number[] };

const DEFAULT_VERSIONED: Versioned = { version: 2, items: [] };

function migrateV1toV2(raw: unknown): unknown {
  if (typeof raw !== "object" || raw === null || !("items" in raw) || !Array.isArray(raw.items)) {
    throw new Error("bad v1 shape");
  }
  return { version: 2, items: raw.items.map((item) => Number(item)) };
}

function versionedStore(
  fs: FsAdapter,
  over?: Partial<StoreVersioning>,
  onRecovery?: (event: StoreRecoveryEvent) => void,
): JsonStore<Versioned> {
  return new JsonStore<Versioned>("/test.json", VersionedSchema, DEFAULT_VERSIONED, {
    fs,
    onRecovery: onRecovery ?? (() => undefined),
    versioning: {
      current: 2,
      // The unversioned era stored a bare string array.
      fromLegacy: (raw) => ({ version: 1, items: raw }),
      migrations: { 1: migrateV1toV2 },
      ...over,
    },
  });
}

describe("JsonStore versioning", () => {
  it("migrates a legacy unversioned file through the full chain and persists the result", () => {
    const fs = memoryFs();
    fs.files.set("/test.json", JSON.stringify(["1", "2"]));
    const store = versionedStore(fs);

    expect(store.read()).toEqual({ version: 2, items: [1, 2] });
    // Upgrade is written back so the chain doesn't re-run every launch.
    expect(JSON.parse(fs.files.get("/test.json") ?? "")).toEqual({ version: 2, items: [1, 2] });
  });

  it("runs a vN→vN+1 migration on a versioned file", () => {
    const fs = memoryFs();
    fs.files.set("/test.json", JSON.stringify({ version: 1, items: ["3"] }));
    const store = versionedStore(fs);

    expect(store.read()).toEqual({ version: 2, items: [3] });
    expect(JSON.parse(fs.files.get("/test.json") ?? "")).toEqual({ version: 2, items: [3] });
  });

  it("reads a current-version file without touching it", () => {
    const fs = memoryFs();
    const content = JSON.stringify({ version: 2, items: [4] });
    fs.files.set("/test.json", content);
    const store = versionedStore(fs);

    expect(store.read()).toEqual({ version: 2, items: [4] });
    expect(fs.files.get("/test.json")).toBe(content);
  });

  it("quarantines a newer-version file without data loss (moved, not deleted)", () => {
    const fs = memoryFs();
    const newer = JSON.stringify({ version: 3, items: [9], futureField: true });
    fs.files.set("/test.json", newer);
    const events: StoreRecoveryEvent[] = [];
    const store = versionedStore(fs, undefined, (event) => events.push(event));

    expect(store.read()).toEqual(DEFAULT_VERSIONED);

    expect(fs.files.has("/test.json")).toBe(false);
    const backupKey = [...fs.files.keys()].find((k) => k.startsWith("/test.json.newer-v3-"));
    if (!backupKey) throw new Error("expected a newer-version quarantine file");
    expect(fs.files.get(backupKey)).toBe(newer);

    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      kind: "newer-version",
      filePath: "/test.json",
      backupPath: backupKey,
      fileVersion: 3,
      supportedVersion: 2,
    });
    expect(consoleError).toHaveBeenCalledWith(expect.stringContaining("newer than supported"));
  });

  it("treats a throwing migration as corruption", () => {
    const fs = memoryFs();
    fs.files.set("/test.json", JSON.stringify({ version: 1, items: ["3"] }));
    const events: StoreRecoveryEvent[] = [];
    const store = versionedStore(
      fs,
      {
        migrations: {
          1: () => {
            throw new Error("boom");
          },
        },
      },
      (event) => events.push(event),
    );

    expect(store.read()).toEqual(DEFAULT_VERSIONED);
    expect(events[0]).toMatchObject({ kind: "corrupt" });
    if (events[0]?.kind !== "corrupt") throw new Error("expected corrupt event");
    expect(events[0].reason).toContain("migration from v1 failed: boom");
    expect([...fs.files.keys()].some((k) => k.startsWith("/test.json.corrupt-"))).toBe(true);
  });

  it("treats a migration that does not advance the version as corruption", () => {
    const fs = memoryFs();
    fs.files.set("/test.json", JSON.stringify({ version: 1, items: ["3"] }));
    const events: StoreRecoveryEvent[] = [];
    const store = versionedStore(fs, { migrations: { 1: (raw) => raw } }, (event) =>
      events.push(event),
    );

    expect(store.read()).toEqual(DEFAULT_VERSIONED);
    if (events[0]?.kind !== "corrupt") throw new Error("expected corrupt event");
    expect(events[0].reason).toContain("did not advance");
  });

  it("treats a version with no registered migration as corruption", () => {
    const fs = memoryFs();
    fs.files.set("/test.json", JSON.stringify({ version: 0, items: [] }));
    const events: StoreRecoveryEvent[] = [];
    const store = versionedStore(fs, undefined, (event) => events.push(event));

    expect(store.read()).toEqual(DEFAULT_VERSIONED);
    if (events[0]?.kind !== "corrupt") throw new Error("expected corrupt event");
    expect(events[0].reason).toContain("no migration registered from v0");
  });

  it("treats a throwing fromLegacy as corruption", () => {
    const fs = memoryFs();
    fs.files.set("/test.json", JSON.stringify({ items: [] }));
    const events: StoreRecoveryEvent[] = [];
    const store = versionedStore(
      fs,
      {
        fromLegacy: () => {
          throw new Error("never had an unversioned era");
        },
      },
      (event) => events.push(event),
    );

    expect(store.read()).toEqual(DEFAULT_VERSIONED);
    if (events[0]?.kind !== "corrupt") throw new Error("expected corrupt event");
    expect(events[0].reason).toContain("legacy migration failed");
  });
});

// The default adapter's on-disk permission contract: every JsonStore under
// ~/.inteligir defaults to owner-only files (session-adjacent state can carry
// note content or credentials). Real fs in a temp dir — mode bits are the
// thing under test.
const fileMode = (p: string) => fs.statSync(p).mode & 0o777;

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "json-store-mode-"));
}

describe("JsonStore file modes (real fs)", () => {
  it("writes data files 0600 by default", () => {
    const file = path.join(tempDir(), "store.json");
    const store = new JsonStore<number[]>(file, NumbersSchema, []);
    store.write([1]);
    expect(fileMode(file)).toBe(0o600);
  });

  it("lets an explicit mode win over the default", () => {
    const file = path.join(tempDir(), "store.json");
    const store = new JsonStore<number[]>(file, NumbersSchema, [], { mode: 0o640 });
    store.write([1]);
    expect(fileMode(file)).toBe(0o640);
  });

  it("heals a stale crash-leftover tmp file's mode instead of inheriting it", () => {
    const dir = tempDir();
    const file = path.join(dir, "store.json");
    // A crashed previous write left a world-readable tmp behind; writeFileSync
    // only applies mode on create, so without the explicit chmod the rename
    // would carry 0644 onto the target.
    fs.writeFileSync(`${file}.tmp`, "stale", { encoding: "utf8", mode: 0o644 });
    const store = new JsonStore<number[]>(file, NumbersSchema, []);
    store.write([1]);
    expect(fileMode(file)).toBe(0o600);
  });
});
