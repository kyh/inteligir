// ---------------------------------------------------------------------------
// Composition-root smoke test. Every other server test exercises a manager in
// isolation; nothing else executes createHost() itself, so without this file
// the wiring it owns — seam installation ORDER, dependency-ordered singleton
// construction, handler completeness, the lock/harden/vault/knowledge/sync
// boot sequence, and the teardown that unwinds it — is covered only by
// launching the real app.
//
// It runs against a throwaway home directory. Both `~/.inteligir` (json-store,
// agent paths) and the default vault root (~/Documents/Inteligir) are computed
// from os.homedir() at MODULE scope, hence the dynamic import below — it must
// stay after the mock registration. Without the redirect this test would take
// the developer's real host lock (fighting a running dev app), prune real
// snapshots, and create a real vault.
//
// The redirect MOCKS os.homedir rather than setting process.env.HOME. $HOME is
// shared process state: vitest imports several test files into one worker
// before running any of them, so a top-level env assignment here silently
// repoints ~/.inteligir for every OTHER file in the worker — a cross-file
// break that surfaces in CI while passing locally. vi.mock is file-scoped and
// cannot leak.
//
// createHost() throws on a second call per process by design, so this file
// boots exactly one host — keep it that way, and keep it in its own file so
// vitest's per-file isolation gives it a clean module registry.
// ---------------------------------------------------------------------------

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";

import type { HostPlatform } from "../platform";

const tmpHome = path.join(process.env["TMPDIR"] ?? "/tmp", `inteligir-boot-${process.pid}`);

vi.mock("node:os", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:os")>();
  const patched = { ...actual, homedir: () => tmpHome };
  return { ...patched, default: patched };
});

// Imported AFTER the homedir mock is registered — see the header.
const { createHost } = await import("../boot/create-host");
const { HOST_METHODS } = await import("../handlers/handler-registry");

function testPlatform(): HostPlatform {
  return {
    isPackaged: false,
    userDataDir: path.join(tmpHome, "userData"),
    resourcesDir: path.join(tmpHome, "resources"),
    strictResources: false,
    secretCipher: {
      kind: "safe-storage",
      isAvailable: () => true,
      encrypt: (plain: string) => Buffer.from(plain, "utf8").toString("base64"),
      decrypt: (cipher: string) => Buffer.from(cipher, "base64").toString("utf8"),
    },
    openExternal: () => Promise.resolve(),
    trashItem: () => Promise.resolve(),
    pickDirectory: () => Promise.resolve(null),
    notify: () => {},
    anyUiFocused: () => false,
  };
}

describe("createHost", () => {
  let host: ReturnType<typeof createHost>;

  beforeAll(() => {
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.mkdirSync(path.join(tmpHome, "resources"), { recursive: true });
    host = createHost(testPlatform());
  });

  afterAll(async () => {
    await host.dispose();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("returns a validated handler for every host-owned registry method", () => {
    // collectHandlers already throws on a gap at construction; asserting the
    // shape here makes the failure legible rather than a boot stack trace.
    expect(Object.keys(host.handlers).toSorted()).toEqual([...HOST_METHODS].toSorted());
    for (const handler of Object.values(host.handlers)) {
      expect(typeof handler).toBe("function");
    }
  });

  it("refuses a second host in the process", () => {
    expect(() => createHost(testPlatform())).toThrow(/only run once/);
  });

  it("validates payloads at the handler boundary, synchronously", () => {
    // readVaultDoc requires { path: string }; the transport passes raw wire
    // values straight in, so the schema check has to live in the handler. It
    // throws BEFORE producing a promise — the ws host's try/catch around
    // dispatch depends on that, so assert the sync shape, not a rejection.
    expect(() => host.handlers.readVaultDoc({ nope: 1 })).toThrow(/payload validation failed/);
  });

  it("boots: takes the lock, hardens the app dir, and readies the vault", () => {
    host.start();

    const appDir = path.join(tmpHome, ".inteligir");
    expect(fs.existsSync(path.join(appDir, "host.lock"))).toBe(true);
    // Owner-only — session transcripts and snapshots carry note content
    // (CLAUDE.md § Decisions).
    expect(fs.statSync(appDir).mode & 0o777).toBe(0o700);

    const vaultRoot = path.join(tmpHome, "Documents", "Inteligir");
    expect(fs.existsSync(vaultRoot)).toBe(true);
  });

  it("is idempotent on repeated start()", () => {
    expect(() => host.start()).not.toThrow();
  });

  it("serves a real round-trip through the composed handlers", async () => {
    await Promise.resolve(host.handlers.writeVaultDoc({ path: "smoke.md", content: "# hi\n" }));
    await expect(Promise.resolve(host.handlers.readVaultDoc({ path: "smoke.md" }))).resolves.toBe(
      "# hi\n",
    );

    const root = await Promise.resolve(host.handlers.getVaultRoot(undefined));
    expect(root).toBe(path.join(tmpHome, "Documents", "Inteligir"));
  });

  it("emits events through the bus the transport folds over", async () => {
    const seen: string[] = [];
    const unsubscribe = host.events.onAny((method) => seen.push(method));
    // A structural write refreshes the listing and broadcasts.
    await Promise.resolve(host.handlers.writeVaultDoc({ path: "second.md", content: "x\n" }));
    await Promise.resolve(host.handlers.refreshVault(undefined));
    unsubscribe();

    expect(seen).toContain("onVaultChanged");
  });
});
