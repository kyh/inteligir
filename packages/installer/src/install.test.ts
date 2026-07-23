import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installCliFromGithubRelease,
  readCliVersion,
  type InstallCliFromGithubReleaseOptions,
} from "./install";

// Shell-script fake binaries can't exec on Windows; the dev/CI matrix is
// macOS + ubuntu, so these guards exist only for stray local runs.
const isWindows = process.platform === "win32";

const ARTIFACT = "fakecli-test-arch.tar.gz";
const VERSION = "1.2.3";
const TAG_BASE = `https://github.com/acme/tool/releases/download/v${VERSION}`;
const ARTIFACT_URL = `${TAG_BASE}/${ARTIFACT}`;

// install.ts logs unconditionally; silence and assert against the spies.
const consoleLog = vi.spyOn(console, "log").mockImplementation(() => undefined);
const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

let tmpDirs: string[] = [];

function tmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cli-bootstrap-install-"));
  tmpDirs.push(dir);
  return dir;
}

beforeEach(() => {
  consoleLog.mockClear();
  consoleWarn.mockClear();
  consoleError.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  for (const dir of tmpDirs) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

function sha256(data: Buffer | string): string {
  return createHash("sha256").update(data).digest("hex");
}

/** Copy into a fresh ArrayBuffer-backed view so it satisfies BodyInit. */
function toBytes(data: Buffer | string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(typeof data === "string" ? Buffer.from(data) : data);
}

function okBody(data: Buffer | string): Response {
  return new Response(toBytes(data));
}

/** A 200 response whose body dies partway through — a truncated download. */
function partialBody(prefix: Buffer): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(Uint8Array.from(prefix));
      controller.error(new Error("connection reset"));
    },
  });
  return new Response(stream);
}

/**
 * Stub global fetch with a url → response table. Unrouted urls 404.
 * Returns the list of fetched urls for call-count/ordering assertions.
 */
function stubFetch(routes: Map<string, () => Response>): string[] {
  const calls: string[] = [];
  vi.stubGlobal("fetch", (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const route = routes.get(url);
    return Promise.resolve(
      route ? route() : new Response(null, { status: 404, statusText: "Not Found" }),
    );
  });
  return calls;
}

/** POSIX shell script that reports `version` from `--version`. */
function fakeCliScript(version: string, marker = "fakecli"): string {
  return `#!/bin/sh\necho "${marker} ${version}"\n`;
}

/**
 * Build a real .tar.gz with the given entries (path → content), using the
 * same `tar` binary the production extract path shells out to.
 */
function makeTarGz(entries: Record<string, string>): Buffer {
  const work = tmpDir();
  const srcDir = path.join(work, "tar-src");
  fs.mkdirSync(srcDir, { recursive: true });
  for (const [entryPath, content] of Object.entries(entries)) {
    const abs = path.join(srcDir, entryPath);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content);
  }
  const topLevel = [
    ...new Set(
      Object.keys(entries)
        .map((entry) => entry.split("/")[0])
        .filter((first): first is string => first !== undefined),
    ),
  ];
  const archivePath = path.join(work, "artifact.tar.gz");
  execFileSync("tar", ["-czf", archivePath, "-C", srcDir, ...topLevel]);
  return fs.readFileSync(archivePath);
}

function baseOpts(
  binDir: string,
  over: Partial<InstallCliFromGithubReleaseOptions> = {},
): InstallCliFromGithubReleaseOptions {
  return {
    owner: "acme",
    repo: "tool",
    version: VERSION,
    artifactName: () => ARTIFACT,
    binName: "fakecli",
    binDir,
    verify: "checksums-txt",
    ...over,
  };
}

function expectFailedClosed(binDir: string, errFragment: string): void {
  // No binary installed, staging cleaned up, failure logged (not thrown).
  expect(fs.existsSync(path.join(binDir, "fakecli"))).toBe(false);
  expect(fs.readdirSync(binDir)).toEqual([]);
  expect(consoleError).toHaveBeenCalledWith(
    expect.stringContaining("install failed"),
    expect.objectContaining({ message: expect.stringContaining(errFragment) }),
  );
}

describe("tarball + checksums-txt (shared install machinery)", () => {
  it("downloads, verifies, extracts, and installs the binary", async () => {
    const binDir = tmpDir();
    const tarGz = makeTarGz({ fakecli: fakeCliScript(VERSION) });
    stubFetch(
      new Map([
        [ARTIFACT_URL, () => okBody(tarGz)],
        [`${TAG_BASE}/checksums.txt`, () => okBody(`${sha256(tarGz)}  ${ARTIFACT}\n`)],
      ]),
    );

    await installCliFromGithubRelease(baseOpts(binDir));

    const binPath = path.join(binDir, "fakecli");
    expect(fs.readFileSync(binPath, "utf8")).toBe(fakeCliScript(VERSION));
    if (!isWindows) expect(fs.statSync(binPath).mode & 0o111).not.toBe(0);
    // Staging dir is gone; only the installed binary remains.
    expect(fs.readdirSync(binDir)).toEqual(["fakecli"]);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("fails closed on checksum mismatch", async () => {
    const binDir = tmpDir();
    const tarGz = makeTarGz({ fakecli: fakeCliScript(VERSION) });
    stubFetch(
      new Map([
        [ARTIFACT_URL, () => okBody(tarGz)],
        // Valid-looking hash, but of different bytes.
        [`${TAG_BASE}/checksums.txt`, () => okBody(`${sha256("other bytes")}  ${ARTIFACT}\n`)],
      ]),
    );

    await installCliFromGithubRelease(baseOpts(binDir));

    expectFailedClosed(binDir, "checksum mismatch");
  });

  it("never clobbers an existing install when the new download fails verification", async () => {
    const binDir = tmpDir();
    const oldScript = fakeCliScript("1.0.0");
    const binPath = path.join(binDir, "fakecli");
    fs.writeFileSync(binPath, oldScript);
    fs.chmodSync(binPath, 0o755);

    const tarGz = makeTarGz({ fakecli: fakeCliScript(VERSION) });
    stubFetch(
      new Map([
        [ARTIFACT_URL, () => okBody(tarGz)],
        [`${TAG_BASE}/checksums.txt`, () => okBody(`${sha256("corrupted")}  ${ARTIFACT}\n`)],
      ]),
    );

    await installCliFromGithubRelease(baseOpts(binDir));

    expect(fs.readFileSync(binPath, "utf8")).toBe(oldScript);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("install failed"),
      expect.objectContaining({ message: expect.stringContaining("checksum mismatch") }),
    );
  });

  it("fails closed when the download dies mid-stream", async () => {
    const binDir = tmpDir();
    const tarGz = makeTarGz({ fakecli: fakeCliScript(VERSION) });
    stubFetch(
      new Map([
        [ARTIFACT_URL, () => partialBody(tarGz.subarray(0, 8))],
        [`${TAG_BASE}/checksums.txt`, () => okBody(`${sha256(tarGz)}  ${ARTIFACT}\n`)],
      ]),
    );

    await installCliFromGithubRelease(baseOpts(binDir));

    expectFailedClosed(binDir, "connection reset");
  });

  it("fails closed on a corrupt archive that passes its checksum", async () => {
    const binDir = tmpDir();
    const garbage = Buffer.from("definitely not a gzip stream");
    stubFetch(
      new Map([
        [ARTIFACT_URL, () => okBody(garbage)],
        [`${TAG_BASE}/checksums.txt`, () => okBody(`${sha256(garbage)}  ${ARTIFACT}\n`)],
      ]),
    );

    await installCliFromGithubRelease(baseOpts(binDir));

    // tar exits non-zero; the message is platform tar's, so just assert the
    // fail-closed state and that a failure was logged.
    expect(fs.existsSync(path.join(binDir, "fakecli"))).toBe(false);
    expect(fs.readdirSync(binDir)).toEqual([]);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("install failed"),
      expect.anything(),
    );
  });

  it("fails closed when the checksum fetch 404s, without downloading the artifact", async () => {
    const binDir = tmpDir();
    const tarGz = makeTarGz({ fakecli: fakeCliScript(VERSION) });
    const calls = stubFetch(new Map([[ARTIFACT_URL, () => okBody(tarGz)]]));

    await installCliFromGithubRelease(baseOpts(binDir));

    expectFailedClosed(binDir, "checksum fetch failed");
    expect(calls).toEqual([`${TAG_BASE}/checksums.txt`]);
  });

  it("fails closed when the artifact fetch 404s", async () => {
    const binDir = tmpDir();
    stubFetch(
      new Map([[`${TAG_BASE}/checksums.txt`, () => okBody(`${sha256("x")}  ${ARTIFACT}\n`)]]),
    );

    await installCliFromGithubRelease(baseOpts(binDir));

    expectFailedClosed(binDir, "artifact fetch failed: 404");
  });

  it("extracts a binary nested under a directory via archiveBinPath", async () => {
    const binDir = tmpDir();
    const tarGz = makeTarGz({ "nested-dir/fakecli": fakeCliScript(VERSION) });
    stubFetch(
      new Map([
        [ARTIFACT_URL, () => okBody(tarGz)],
        [`${TAG_BASE}/checksums.txt`, () => okBody(`${sha256(tarGz)}  ${ARTIFACT}\n`)],
      ]),
    );

    await installCliFromGithubRelease(baseOpts(binDir, { archiveBinPath: "nested-dir/fakecli" }));

    expect(fs.readFileSync(path.join(binDir, "fakecli"), "utf8")).toBe(fakeCliScript(VERSION));
    expect(fs.readdirSync(binDir)).toEqual(["fakecli"]);
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe("checksums-txt mode", () => {
  it("finds our artifact's row among others and installs", async () => {
    const binDir = tmpDir();
    const tarGz = makeTarGz({ fakecli: fakeCliScript(VERSION) });
    const checksums = [
      `${sha256("linux build")}  fakecli-other-arch.tar.gz`,
      `${sha256(tarGz)}  ${ARTIFACT}`,
      `${sha256("windows build")}  fakecli-third-arch.zip`,
    ].join("\n");
    stubFetch(
      new Map([
        [ARTIFACT_URL, () => okBody(tarGz)],
        [`${TAG_BASE}/checksums.txt`, () => okBody(checksums)],
      ]),
    );

    await installCliFromGithubRelease(baseOpts(binDir, { verify: "checksums-txt" }));

    expect(fs.existsSync(path.join(binDir, "fakecli"))).toBe(true);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("fails closed when checksums.txt has no row for our artifact", async () => {
    const binDir = tmpDir();
    const tarGz = makeTarGz({ fakecli: fakeCliScript(VERSION) });
    const calls = stubFetch(
      new Map([
        [ARTIFACT_URL, () => okBody(tarGz)],
        [
          `${TAG_BASE}/checksums.txt`,
          () => okBody(`${sha256("something else")}  some-other-file.tar.gz\n`),
        ],
      ]),
    );

    await installCliFromGithubRelease(baseOpts(binDir, { verify: "checksums-txt" }));

    expectFailedClosed(binDir, "not found / invalid");
    expect(calls).toEqual([`${TAG_BASE}/checksums.txt`]);
  });
});

describe("inline-sha256 mode", () => {
  it("installs when the pinned hash matches", async () => {
    const binDir = tmpDir();
    const tarGz = makeTarGz({ fakecli: fakeCliScript(VERSION) });
    stubFetch(new Map([[ARTIFACT_URL, () => okBody(tarGz)]]));

    await installCliFromGithubRelease(
      baseOpts(binDir, { verify: "inline-sha256", sha256: { [ARTIFACT]: sha256(tarGz) } }),
    );

    expect(fs.existsSync(path.join(binDir, "fakecli"))).toBe(true);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("fails closed before any network when no hash is pinned for this artifact", async () => {
    const binDir = tmpDir();
    const calls = stubFetch(new Map());

    await installCliFromGithubRelease(
      baseOpts(binDir, {
        verify: "inline-sha256",
        sha256: { "some-other-artifact.tar.gz": sha256("other") },
      }),
    );

    expectFailedClosed(binDir, "no valid pinned hash");
    expect(calls).toEqual([]);
  });

  it("rejects a malformed pinned hash instead of treating it as 'no verification'", async () => {
    const binDir = tmpDir();
    const calls = stubFetch(new Map());

    await installCliFromGithubRelease(
      baseOpts(binDir, { verify: "inline-sha256", sha256: { [ARTIFACT]: "DEADBEEF" } }),
    );

    expectFailedClosed(binDir, "no valid pinned hash");
    expect(calls).toEqual([]);
  });
});

describe.skipIf(isWindows)("binary kind", () => {
  // The live browser-extension config: a raw binary artifact + inline-sha256.
  it("downloads the raw binary, verifies the pinned hash, and chmods it", async () => {
    const binDir = tmpDir();
    const script = fakeCliScript(VERSION);
    stubFetch(new Map([[ARTIFACT_URL, () => okBody(script)]]));

    await installCliFromGithubRelease(
      baseOpts(binDir, {
        artifactKind: "binary",
        verify: "inline-sha256",
        sha256: { [ARTIFACT]: sha256(script) },
      }),
    );

    const binPath = path.join(binDir, "fakecli");
    expect(fs.statSync(binPath).mode & 0o111).not.toBe(0);
    expect(await readCliVersion(binPath)).toBe(VERSION);
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe.skipIf(isWindows)("idempotent re-install", () => {
  it("skips the network entirely when the installed version already matches", async () => {
    const binDir = tmpDir();
    const binPath = path.join(binDir, "fakecli");
    fs.writeFileSync(binPath, fakeCliScript(VERSION));
    fs.chmodSync(binPath, 0o755);
    const calls = stubFetch(new Map());

    await installCliFromGithubRelease(baseOpts(binDir));

    expect(calls).toEqual([]);
    expect(fs.readFileSync(binPath, "utf8")).toBe(fakeCliScript(VERSION));
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("force: true re-downloads even when the installed version matches", async () => {
    const binDir = tmpDir();
    const binPath = path.join(binDir, "fakecli");
    fs.writeFileSync(binPath, fakeCliScript(VERSION, "old-build"));
    fs.chmodSync(binPath, 0o755);

    const fresh = fakeCliScript(VERSION, "fresh-build");
    const tarGz = makeTarGz({ fakecli: fresh });
    const calls = stubFetch(
      new Map([
        [ARTIFACT_URL, () => okBody(tarGz)],
        [`${TAG_BASE}/checksums.txt`, () => okBody(`${sha256(tarGz)}  ${ARTIFACT}\n`)],
      ]),
    );

    await installCliFromGithubRelease(baseOpts(binDir, { force: true }));

    expect(calls).toContain(ARTIFACT_URL);
    expect(fs.readFileSync(binPath, "utf8")).toBe(fresh);
    expect(consoleError).not.toHaveBeenCalled();
  });

  it("re-installs over a corrupt existing binary (version unreadable)", async () => {
    const binDir = tmpDir();
    const binPath = path.join(binDir, "fakecli");
    fs.writeFileSync(binPath, "truncated garbage, not executable output");
    fs.chmodSync(binPath, 0o755);

    const tarGz = makeTarGz({ fakecli: fakeCliScript(VERSION) });
    stubFetch(
      new Map([
        [ARTIFACT_URL, () => okBody(tarGz)],
        [`${TAG_BASE}/checksums.txt`, () => okBody(`${sha256(tarGz)}  ${ARTIFACT}\n`)],
      ]),
    );

    await installCliFromGithubRelease(baseOpts(binDir));

    expect(fs.readFileSync(binPath, "utf8")).toBe(fakeCliScript(VERSION));
  });
});

describe("archive kind (binary + sidecars)", () => {
  it("moves every extracted file into binDir and replaces stale sidecars", async () => {
    const binDir = tmpDir();
    fs.writeFileSync(path.join(binDir, "fakecli.wasm"), "stale sidecar");

    const tarGz = makeTarGz({
      fakecli: fakeCliScript(VERSION),
      "fakecli.wasm": "fresh sidecar",
    });
    stubFetch(
      new Map([
        [ARTIFACT_URL, () => okBody(tarGz)],
        [`${TAG_BASE}/checksums.txt`, () => okBody(`${sha256(tarGz)}  ${ARTIFACT}\n`)],
      ]),
    );

    await installCliFromGithubRelease(baseOpts(binDir, { artifactKind: "archive" }));

    expect(fs.readdirSync(binDir).toSorted()).toEqual(["fakecli", "fakecli.wasm"]);
    expect(fs.readFileSync(path.join(binDir, "fakecli"), "utf8")).toBe(fakeCliScript(VERSION));
    expect(fs.readFileSync(path.join(binDir, "fakecli.wasm"), "utf8")).toBe("fresh sidecar");
    if (!isWindows) {
      expect(fs.statSync(path.join(binDir, "fakecli")).mode & 0o111).not.toBe(0);
    }
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe("unsupported platform", () => {
  it("warns and skips without touching the network", async () => {
    const binDir = tmpDir();
    const calls = stubFetch(new Map());

    await installCliFromGithubRelease(baseOpts(binDir, { artifactName: () => null }));

    expect(calls).toEqual([]);
    expect(fs.existsSync(path.join(binDir, "fakecli"))).toBe(false);
    expect(consoleWarn).toHaveBeenCalledWith(expect.stringContaining("unsupported platform"));
    expect(consoleError).not.toHaveBeenCalled();
  });
});

describe("postInstall hook", () => {
  it("receives the installed path; hook errors are logged, not fatal", async () => {
    const binDir = tmpDir();
    const tarGz = makeTarGz({ fakecli: fakeCliScript(VERSION) });
    stubFetch(
      new Map([
        [ARTIFACT_URL, () => okBody(tarGz)],
        [`${TAG_BASE}/checksums.txt`, () => okBody(`${sha256(tarGz)}  ${ARTIFACT}\n`)],
      ]),
    );

    const seen: string[] = [];
    await installCliFromGithubRelease(
      baseOpts(binDir, {
        postInstall: (binPath) => {
          seen.push(binPath);
          return Promise.reject(new Error("hook exploded"));
        },
      }),
    );

    expect(seen).toEqual([path.join(binDir, "fakecli")]);
    // Binary stays installed despite the hook failure.
    expect(fs.existsSync(path.join(binDir, "fakecli"))).toBe(true);
    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining("post-install failed"),
      expect.objectContaining({ message: "hook exploded" }),
    );
  });
});

describe.skipIf(isWindows)("readCliVersion", () => {
  it("extracts the first x.y.z from --version output", async () => {
    const dir = tmpDir();
    const binPath = path.join(dir, "fakecli");
    fs.writeFileSync(binPath, fakeCliScript("4.5.6"));
    fs.chmodSync(binPath, 0o755);

    expect(await readCliVersion(binPath)).toBe("4.5.6");
  });

  it("returns null for a missing binary", async () => {
    expect(await readCliVersion(path.join(tmpDir(), "nope"))).toBe(null);
  });

  it("returns null when the binary cannot be executed", async () => {
    const dir = tmpDir();
    const binPath = path.join(dir, "fakecli");
    fs.writeFileSync(binPath, "plain text, no exec bit");

    expect(await readCliVersion(binPath)).toBe(null);
  });
});
