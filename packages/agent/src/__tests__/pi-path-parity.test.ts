// ---------------------------------------------------------------------------
// DRIFT GUARD — pins that our replicated pi path resolver (privacy/
// pi-path-parity.ts) produces the SAME target as pi's REAL path-utils for a
// battery of adversarial inputs. The privacy gate classifies paths through
// the replication; if a pi upgrade adds or changes a normalization (a new
// prefix strip, another unicode mapping, one more fs-fallback variant), the
// gate would silently diverge from what the tools actually open — and any
// such divergence is a private-content bypass (`@vault/…`, NBSP
// filenames: the gate classifies one file, pi opens another). This test
// imports pi's INSTALLED path-utils.js (not exported publicly — reached by
// file path, test-only; prod code stays self-contained) so that drift fails
// HERE, loudly, instead of shipping as a vulnerability.
//
// If this test can't even locate/load pi's path-utils, that is itself the
// signal: pi moved the module — re-verify parity by hand before "fixing" the
// locator.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { expandPiPath, resolvePiToolPath } from "../privacy/pi-path-parity";

// pi declares exports only for "." and "./hooks", so the internal module is
// reached by file path. @repo/agent declares the dependency, so pnpm links
// it under this package's own node_modules — a stable location.
const PI_PATH_UTILS = fileURLToPath(
  new URL(
    "../../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/path-utils.js",
    import.meta.url,
  ),
);

type PathFn = (...args: string[]) => string;

/** Parse-at-boundary for the untyped deep import: demand a function export
 * and a string return, loudly naming what moved if pi refactored. */
function pickPathFn(mod: unknown, name: string): PathFn {
  if (typeof mod !== "object" || mod === null) {
    throw new Error("pi path-utils did not load as a module — re-verify gate parity");
  }
  const value: unknown = Reflect.get(mod, name);
  if (typeof value !== "function") {
    throw new Error(`pi path-utils no longer exports ${name}() — re-verify gate parity`);
  }
  return (...args: string[]): string => {
    const out: unknown = value(...args);
    if (typeof out !== "string") {
      throw new Error(`pi ${name}() returned a non-string — re-verify gate parity`);
    }
    return out;
  };
}

let piExpandPath: PathFn;
let piResolveReadPath: PathFn;
let cwd: string;

const NBSP = String.fromCharCode(0xa0);
const EN_QUAD = String.fromCharCode(0x2000);
const EM_SPACE = String.fromCharCode(0x2003);
const NARROW_NBSP = String.fromCharCode(0x202f);
const IDEOGRAPHIC_SPACE = String.fromCharCode(0x3000);
const E_ACUTE_NFC = String.fromCharCode(0xe9); // é as one codepoint
const COMBINING_ACUTE = String.fromCharCode(0x0301);
const CURLY_QUOTE = String.fromCharCode(0x2019);

beforeAll(async () => {
  if (!fs.existsSync(PI_PATH_UTILS)) {
    throw new Error(
      `pi's path-utils.js not found at ${PI_PATH_UTILS} — pi moved it; ` +
        `re-verify privacy-gate path parity before updating this locator.`,
    );
  }
  const loaded: unknown = await import(/* @vite-ignore */ pathToFileURL(PI_PATH_UTILS).href);
  piExpandPath = pickPathFn(loaded, "expandPath");
  piResolveReadPath = pickPathFn(loaded, "resolveReadPath");

  // A real workspace on disk so the fs-fallback variants exercise the same
  // filesystem both resolvers probe.
  cwd = fs.mkdtempSync(path.join(os.tmpdir(), "pi-path-parity-"));
  fs.mkdirSync(path.join(cwd, "vault"), { recursive: true });
  fs.writeFileSync(path.join(cwd, "vault", "secret.md"), "private: true");
  fs.writeFileSync(path.join(cwd, "vault", "meeting notes.md"), "x"); // ASCII space
  fs.writeFileSync(path.join(cwd, "vault", `don${CURLY_QUOTE}t.md`), "x"); // curly quote on disk
  fs.writeFileSync(path.join(cwd, "vault", `cafe${COMBINING_ACUTE}.md`), "x"); // NFD on disk
  fs.writeFileSync(path.join(cwd, "vault", `at 1.23${NARROW_NBSP}PM.png`), "x"); // AM/PM narrow NBSP
});

afterAll(() => {
  fs.rmSync(cwd, { recursive: true, force: true });
});

// Every shape the gate must agree with pi on: @-prefix, unicode spaces, ~,
// file:// URLs (new in 0.80), absolute (0.80 normalizes these through
// resolve()), relative, dot, and the fs-fallback bait (queried in the form a
// model would type, stored on disk in the variant form pi falls back to).
function batteryInputs(): string[] {
  return [
    "@vault/secret.md",
    "@./vault/secret.md",
    "@/etc/hosts",
    "@@double.md",
    `./vault/meeting${NBSP}notes.md`,
    `vault/meeting${EN_QUAD}notes.md`,
    `vault/meeting${EM_SPACE}notes.md`,
    `vault/meeting${NARROW_NBSP}notes.md`,
    `vault/meeting${IDEOGRAPHIC_SPACE}notes.md`,
    "~",
    "~/notes/secret.md",
    "~//double-sep.md",
    "~tilde-not-home/x.md",
    `./vault/caf${E_ACUTE_NFC}.md`,
    "./vault/don't.md",
    "./vault/at 1.23 PM.png",
    "./vault/secret.md",
    "vault/secret.md",
    "/absolute/elsewhere.md",
    "/absolute/../abs-dotdot.md",
    "//double/root.md",
    "file:///abs/file-url.md",
    "@file:///abs/at-file-url.md",
    "plain.md",
    "./nested/../vault/secret.md",
    ".",
    "",
  ];
}

describe("pi path-resolution parity (drift guard)", () => {
  it("expandPiPath matches pi's expandPath on the full battery", () => {
    for (const input of batteryInputs()) {
      expect(expandPiPath(input), JSON.stringify(input)).toBe(piExpandPath(input));
    }
  });

  it("resolvePiToolPath matches pi's resolveReadPath on the full battery", () => {
    for (const input of batteryInputs()) {
      expect(resolvePiToolPath(input, cwd), JSON.stringify(input)).toBe(
        piResolveReadPath(input, cwd),
      );
    }
  });

  it("the confirmed @-bypass input resolves to the real vault file (both resolvers)", () => {
    const target = path.join(cwd, "vault", "secret.md");
    expect(resolvePiToolPath("@vault/secret.md", cwd)).toBe(target);
    expect(piResolveReadPath("@vault/secret.md", cwd)).toBe(target);
  });

  it("a file:// URL of the vault file resolves to the real file (0.80's new expansion, both resolvers)", () => {
    // The 0.80 sibling of the @-bypass: pi now converts file:// URLs to
    // filesystem paths BEFORE opening, so the gate must classify the
    // converted target, never the raw URL string.
    const target = path.join(cwd, "vault", "secret.md");
    const url = pathToFileURL(target).href;
    expect(resolvePiToolPath(url, cwd)).toBe(target);
    expect(piResolveReadPath(url, cwd)).toBe(target);
  });

  it("a malformed file:// URL throws in BOTH resolvers (gate throw = blocked call)", () => {
    // `file://vault/x.md` parses "vault" as a URL host — fileURLToPath
    // rejects it. pi errors the tool call; the gate's throw propagates
    // through the tool_call handler, which pi catches into a blocking error
    // result. Parity means agreeing on the throw too.
    expect(() => piResolveReadPath("file://vault/x.md", cwd)).toThrow();
    expect(() => resolvePiToolPath("file://vault/x.md", cwd)).toThrow();
  });

  it("fs-fallback variants redirect to the on-disk file pi will open", () => {
    // Curly-quote and AM/PM narrow-NBSP names are NOT fs-equivalent to their
    // typed forms on any platform, so the fallback deterministically fires.
    expect(resolvePiToolPath("./vault/don't.md", cwd)).toBe(
      path.join(cwd, "vault", `don${CURLY_QUOTE}t.md`),
    );
    expect(resolvePiToolPath("./vault/at 1.23 PM.png", cwd)).toBe(
      path.join(cwd, "vault", `at 1.23${NARROW_NBSP}PM.png`),
    );
    // NFC-vs-NFD equivalence differs per filesystem (APFS matches either
    // form; ext4 needs the fallback) — parity with pi is what matters, and
    // the battery above already pins it; here pin that SOME real file is
    // found either way, never a phantom.
    const nfcQuery = resolvePiToolPath(`./vault/caf${E_ACUTE_NFC}.md`, cwd);
    expect(fs.existsSync(nfcQuery)).toBe(true);
  });

  it("unicode-space forms resolve to the real ASCII-space file (both resolvers)", () => {
    const target = path.join(cwd, "vault", "meeting notes.md");
    const query = `./vault/meeting${NBSP}notes.md`;
    expect(resolvePiToolPath(query, cwd)).toBe(target);
    expect(piResolveReadPath(query, cwd)).toBe(target);
  });
});
