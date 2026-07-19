// ---------------------------------------------------------------------------
// The privacy gate's decision matrix — SECURITY tests. These pin:
//  (1) the block/allow verdict per tool × path-form × probe result,
//  (2) fail-closed behavior (indeterminate probe, unresolvable vault root),
//  (3) the outbound payload: what the model would receive on a block (pi
//      turns the reason into an error tool result verbatim) NEVER contains
//      the note's content — only its path,
//  (4) the HONEST LIMITATION, pinned so nobody oversells it: a globbed bash
//      command bypasses the literal-path heuristic and is allowed.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import { classifyVaultDocWrite, decideToolCall, type GateEnv } from "../privacy/gate";
import { buildToolCallHandler } from "../privacy/extension";
import type { PrivacyPort, PrivacyProbe, VaultDocWrite } from "../extension";

// The secret bytes that must never appear in anything the model sees.
const SECRET_BODY = "TOP SECRET: the rocket equation notes";

const CWD = "/ws";
const REAL_ROOT = "/real/vault";
const LEXICAL_ROOT = "/user/Documents/Vault";

const PROBES: Record<string, PrivacyProbe> = {
  "notes/secret.md": "private",
  "meeting notes.md": "private", // ASCII space — the unicode-space bypass target
  "public.md": "public",
  "plans/roadmap v2.md": "public",
  "broken.md": "indeterminate",
  "sub/inner.md": "public",
};

// Pure double of the host resolver's normalization (pi-path-parity.ts):
// @-strip, unicode spaces → ASCII space, ~ → HOME. The on-disk variant
// fallbacks (NFD/curly/AM-PM) need a filesystem, so tests emulate those with
// per-test overrides; the REAL resolver's agreement with pi's own path-utils
// is pinned separately by pi-path-parity.test.ts.
const HOME = "/user";
function stubNormalizePath(p: string): string {
  const stripped = p.startsWith("@") ? p.slice(1) : p;
  const normalized = stripped.replace(/[  -   　]/g, " ");
  if (normalized === "~") return HOME;
  if (normalized.startsWith("~/")) return HOME + normalized.slice(1);
  return normalized;
}

/** Stubbed fs world: /ws/vault and the lexical root are symlinks to the real
 * root; /real/vault/link-out.md is a symlink escaping the vault. */
function stubRealpath(p: string): string {
  for (const alias of [`${CWD}/vault`, LEXICAL_ROOT]) {
    if (p === alias) return REAL_ROOT;
    if (p.startsWith(`${alias}/`)) return REAL_ROOT + p.slice(alias.length);
  }
  if (p === `${REAL_ROOT}/link-out.md`) return "/elsewhere/leaked.md";
  return p;
}

function env(overrides?: Partial<GateEnv>): GateEnv {
  return {
    cwd: CWD,
    vaultRealRoot: REAL_ROOT,
    vaultLexicalRoot: LEXICAL_ROOT,
    probe: (rel) => PROBES[rel] ?? "absent",
    privateIndexPaths: () => ["notes/secret.md"],
    normalizePath: stubNormalizePath,
    realpath: stubRealpath,
    ...overrides,
  };
}

function decide(toolName: string, input: Record<string, unknown>, e: GateEnv = env()) {
  return decideToolCall({ toolName, input }, e);
}

describe("privacy gate — read/edit/write (live probe)", () => {
  it.each([
    ["./vault/notes/secret.md"],
    ["vault/notes/secret.md"],
    [`${CWD}/vault/notes/secret.md`],
    [`${REAL_ROOT}/notes/secret.md`],
    [`${LEXICAL_ROOT}/notes/secret.md`],
  ])("blocks every path form of a private note: %s", (p) => {
    for (const tool of ["read", "edit", "write"]) {
      const decision = decide(tool, { path: p });
      expect(decision.allow, `${tool} ${p}`).toBe(false);
    }
  });

  it("allows a public note and a new (absent) file", () => {
    expect(decide("read", { path: "./vault/public.md" })).toEqual({ allow: true });
    expect(decide("edit", { path: "./vault/public.md" })).toEqual({ allow: true });
    expect(decide("write", { path: "./vault/brand-new.md" })).toEqual({ allow: true });
  });

  it("blocks an indeterminate (unreadable-frontmatter) note — fail-closed", () => {
    const decision = decide("read", { path: "./vault/broken.md" });
    expect(decision.allow).toBe(false);
    if (!decision.allow) expect(decision.reason).toContain("fail-closed");
  });

  it("treats a probe that reports indeterminate for ANY reason as private", () => {
    const decision = decide(
      "read",
      { path: "./vault/public.md" },
      env({ probe: () => "indeterminate" }),
    );
    expect(decision.allow).toBe(false);
  });

  it("allows paths outside the vault and non-doc vault files", () => {
    expect(decide("read", { path: "/etc/hosts" })).toEqual({ allow: true });
    expect(decide("read", { path: "./scratch/tmp.md" })).toEqual({ allow: true });
    expect(decide("read", { path: "./vault/photo.png" })).toEqual({ allow: true });
  });

  it("a symlink escaping the vault is not vault content — allowed through", () => {
    // The gate protects VAULT notes; a link-out resolves outside the real
    // root, so it is classified outside and never given a vault-relative rel.
    expect(decide("read", { path: "./vault/link-out.md" })).toEqual({ allow: true });
  });

  it("the block reason carries the path, never the content (outbound payload)", () => {
    const decision = decide("read", { path: "./vault/notes/secret.md" });
    expect(decision.allow).toBe(false);
    const payload = JSON.stringify(decision);
    expect(payload).toContain("notes/secret.md");
    expect(payload).not.toContain(SECRET_BODY);
    expect(payload).not.toContain("rocket");
  });
});

describe("privacy gate — pi path-normalization parity (bypass regressions)", () => {
  // The confirmed CRITICAL bypass: pi's expandPath strips a leading `@`, so
  // "@vault/…" reads through the ./vault symlink while a raw-string gate
  // classified it "outside the vault" and never probed. Pinned per tool.
  it("blocks the `@`-prefixed form of a private note (read/edit/write)", () => {
    for (const tool of ["read", "edit", "write"]) {
      expect(decide(tool, { path: "@vault/notes/secret.md" }).allow, tool).toBe(false);
      expect(decide(tool, { path: "@./vault/notes/secret.md" }).allow, tool).toBe(false);
    }
  });

  it("still allows the `@` form of public / genuinely-outside paths", () => {
    expect(decide("read", { path: "@vault/public.md" })).toEqual({ allow: true });
    expect(decide("read", { path: "@scratch/tmp.md" })).toEqual({ allow: true });
  });

  // The confirmed HIGH bypass: pi maps unicode spaces (NBSP/en/em/…) to ASCII
  // space, so an NBSP-spelled filename opened the real "meeting notes.md"
  // while the gate probed a phantom → "absent" → allow.
  it("blocks a private note addressed with unicode spaces in the filename", () => {
    const nbsp = String.fromCharCode(0xa0);
    const enQuad = String.fromCharCode(0x2000);
    for (const tool of ["read", "edit", "write"]) {
      expect(decide(tool, { path: `./vault/meeting${nbsp}notes.md` }).allow, tool).toBe(false);
      expect(decide(tool, { path: `vault/meeting${enQuad}notes.md` }).allow, tool).toBe(false);
    }
  });

  it("still allows a public note addressed with a unicode space", () => {
    const nbsp = String.fromCharCode(0xa0);
    expect(decide("read", { path: `./vault/plans/roadmap${nbsp}v2.md` })).toEqual({ allow: true });
  });

  // `~`-absolute addressing: pi expands ~ to the homedir; a raw-string gate
  // treated "~" as a literal directory under the workspace → "outside".
  it("blocks a private note addressed ~-absolute; allows ~ paths outside the vault", () => {
    expect(decide("read", { path: "~/Documents/Vault/notes/secret.md" }).allow).toBe(false);
    expect(decide("edit", { path: "~/Documents/Vault/notes/secret.md" }).allow).toBe(false);
    expect(decide("read", { path: "~/elsewhere/notes.md" })).toEqual({ allow: true });
  });

  // pi's read retries NFD / curly-quote filename variants that exist on disk;
  // the injected resolver returns the variant pi WILL open, and the gate must
  // probe that — never conclude "absent" from the phantom literal.
  it("blocks when pi's fs-fallback would open an NFD or curly-quote variant of a private note", () => {
    const eAcute = String.fromCharCode(0xe9); // é (NFC)
    const nfdRel = `cafe${String.fromCharCode(0x0301)}.md`; // café.md in NFD
    const curlyRel = `don${String.fromCharCode(0x2019)}t.md`; // don’t.md
    const withVariants = env({
      probe: (rel) => (rel === nfdRel || rel === curlyRel ? "private" : "absent"),
      // Emulate resolveReadPath's on-disk probing: the literal is absent but
      // its NFD (or curly-quote) sibling exists and is what pi will read.
      normalizePath: (p) => {
        const s = stubNormalizePath(p);
        if (s.endsWith(`caf${eAcute}.md`)) return s.slice(0, -`caf${eAcute}.md`.length) + nfdRel;
        if (s.endsWith("don't.md")) return s.slice(0, -"don't.md".length) + curlyRel;
        return s;
      },
    });
    expect(decide("read", { path: `./vault/caf${eAcute}.md` }, withVariants).allow).toBe(false);
    expect(decide("read", { path: "./vault/don't.md" }, withVariants).allow).toBe(false);
    // A genuinely absent file (no variant either) still allows — the tool's
    // own ENOENT is the honest reply.
    expect(decide("read", { path: "./vault/never-existed.md" }, withVariants)).toEqual({
      allow: true,
    });
  });
});

describe("privacy gate — vaultRealRoot null (fail-closed, mustFix)", () => {
  const nullRoot = () => env({ vaultRealRoot: null });

  it("blocks anything under ./vault when the root can't be verified", () => {
    for (const p of ["./vault/anything.md", "vault/notes/secret.md", `${CWD}/vault/x.md`]) {
      const decision = decide("read", { path: p }, nullRoot());
      expect(decision.allow, p).toBe(false);
    }
  });

  it("blocks the configured root's lexical prefix too", () => {
    expect(decide("read", { path: `${LEXICAL_ROOT}/x.md` }, nullRoot()).allow).toBe(false);
  });

  it("still allows clearly-outside paths", () => {
    expect(decide("read", { path: "/etc/hosts" }, nullRoot())).toEqual({ allow: true });
  });
});

describe("privacy gate — grep/find/ls (coarse, defensive)", () => {
  it("blocks a scan whose directory subtree holds a private note", () => {
    expect(decide("grep", { pattern: "x", path: "./vault" }).allow).toBe(false);
    expect(decide("ls", { path: "./vault/notes" }).allow).toBe(false);
    expect(decide("find", { pattern: "*", path: "./vault" }).allow).toBe(false);
  });

  it("allows a scan of a vault subtree with no private notes", () => {
    expect(decide("grep", { pattern: "x", path: "./vault/sub" })).toEqual({ allow: true });
  });

  it("blocks a direct private doc target; allows a public one", () => {
    expect(decide("grep", { pattern: "x", path: "./vault/notes/secret.md" }).allow).toBe(false);
    expect(decide("grep", { pattern: "x", path: "./vault/public.md" })).toEqual({ allow: true });
  });

  it("defaults to cwd (outside the vault) when no path is given — allowed", () => {
    expect(decide("grep", { pattern: "x" })).toEqual({ allow: true });
  });
});

describe("privacy gate — bash/execute/browser/peekaboo (best-effort ONLY)", () => {
  it("blocks a bash command naming a private note literally (both forms)", () => {
    expect(decide("bash", { command: "cat ./vault/notes/secret.md" }).allow).toBe(false);
    expect(decide("bash", { command: "cat vault/notes/secret.md | head" }).allow).toBe(false);
  });

  it("allows bash touching public notes and unrelated commands", () => {
    expect(decide("bash", { command: "cat ./vault/public.md" })).toEqual({ allow: true });
    expect(decide("bash", { command: "ls -la /tmp" })).toEqual({ allow: true });
  });

  it("does not trip on substrings of other filenames (boundary check)", () => {
    const e = env({ privateIndexPaths: () => ["a.md"] });
    expect(decide("bash", { command: "cat ./vault/data.md" }, e)).toEqual({ allow: true });
    expect(decide("bash", { command: "cat ./vault/a.md" }, e).allow).toBe(false);
  });

  it("HONEST LIMITATION (pinned): a globbed command bypasses the heuristic", () => {
    // This is the documented hole — bash is NOT soundly gated without a
    // sandbox. If this assertion ever fails, someone made the heuristic
    // smarter; update docs/privacy.md rather than deleting this pin.
    expect(decide("bash", { command: "cat ./vault/notes/*.md" })).toEqual({ allow: true });
  });

  it("blocks execute code and browser/peekaboo args referencing a private path", () => {
    expect(decide("execute", { code: "read('./vault/notes/secret.md')" }).allow).toBe(false);
    expect(
      decide("browser", { args: ["open", "file:///x"], stdin: "vault/notes/secret.md" }).allow,
    ).toBe(false);
    expect(decide("peekaboo", { args: ["type", "./vault/notes/secret.md"] }).allow).toBe(false);
    expect(decide("execute", { code: "tools.search({query: 'weather'})" })).toEqual({
      allow: true,
    });
  });

  it("leaves curated tools alone (search_vault filters at the KnowledgePort)", () => {
    expect(decide("search_vault", { query: "rocket" })).toEqual({ allow: true });
    expect(decide("get_backlinks", { path: "notes/secret.md" })).toEqual({ allow: true });
    expect(decide("resume", { executionId: "x", action: "accept" })).toEqual({ allow: true });
  });

  it("rename_note is covered by the unknown-tool arg screen — a private-note rename blocks", () => {
    // rename_note is deliberately NOT in the curated KNOWLEDGE_TOOLS set: its
    // args are real vault paths, so the opaque literal-path screen must apply.
    // Both sides screen — renaming a private note away, or onto its path.
    for (const from of ["./vault/notes/secret.md", "vault/notes/secret.md", "notes/secret.md"]) {
      expect(decide("rename_note", { from, to: "renamed.md" }).allow, from).toBe(false);
    }
    expect(decide("rename_note", { from: "public.md", to: "notes/secret.md" }).allow).toBe(false);
    // A rename touching no indexed private note passes the gate; the
    // KnowledgePort still live-probes the source (knowledge-rename-port.test).
    expect(decide("rename_note", { from: "./vault/public.md", to: "renamed.md" })).toEqual({
      allow: true,
    });
  });

  it("screens an UNKNOWN tool's args for a private path (no silent fail-open)", () => {
    // A future/connector tool the dispatch doesn't name gets the same
    // best-effort screen bash does, not a blanket allow.
    expect(decide("some_connector", { url: "read ./vault/notes/secret.md" }).allow).toBe(false);
    expect(decide("resume", { executionId: "x", content: "cat vault/notes/secret.md" }).allow).toBe(
      false,
    );
    // …but an unknown tool that names no private path still passes.
    expect(decide("some_connector", { url: "https://example.com" })).toEqual({ allow: true });
  });
});

describe("privacy extension handler (the piece pi invokes)", () => {
  function port(overrides?: Partial<PrivacyPort>): PrivacyPort {
    return {
      probe: (rel) => PROBES[rel] ?? "absent",
      vaultRealRoot: () => null, // no real fs in tests → fail-closed world
      vaultLexicalRoot: () => LEXICAL_ROOT,
      privateIndexPaths: () => ["notes/secret.md"],
      ...overrides,
    };
  }

  it("returns { block, reason } for a private read; the payload the model sees has no content", () => {
    const handler = buildToolCallHandler(port(), null);
    const result = handler({
      type: "tool_call",
      toolCallId: "call-1",
      toolName: "read",
      input: { path: `${LEXICAL_ROOT}/notes/secret.md` },
    });
    expect(result).toBeDefined();
    expect(result?.block).toBe(true);
    // Mirror what pi persists/sends: createErrorToolResult(reason) — the
    // reason string IS the tool result the model reads. Stringify and assert
    // the note body is absent.
    const outbound = JSON.stringify(result);
    expect(outbound).not.toContain(SECRET_BODY);
    expect(outbound).not.toContain("rocket");
  });

  it("resolves `@vault/…` through pi's real normalization (regression: the @-bypass)", () => {
    // The REAL wiring (resolvePiToolPath, no stub): "@vault/x.md" must strip
    // to "vault/x.md" and classify as vault-shaped. In this fail-closed world
    // (vaultRealRoot null) that means BLOCK — before the fix the raw string
    // resolved to "<cwd>/@vault/x.md", classified "outside", and was allowed
    // straight through to pi's read, which stripped the @ and read the note.
    const handler = buildToolCallHandler(port(), null);
    const result = handler({
      type: "tool_call",
      toolCallId: "call-at",
      toolName: "read",
      input: { path: "@vault/x.md" },
    });
    expect(result?.block).toBe(true);
  });

  it("returns undefined (allow) for an unrelated tool call", () => {
    const handler = buildToolCallHandler(port(), null);
    const result = handler({
      type: "tool_call",
      toolCallId: "call-2",
      toolName: "bash",
      input: { command: "echo hello" },
    });
    expect(result).toBeUndefined();
  });

  it("a throwing probe propagates — pi catches it into an error result (fail-closed)", () => {
    const handler = buildToolCallHandler(
      port({
        probe: () => {
          throw new Error("probe exploded");
        },
        vaultRealRoot: () => REAL_ROOT,
      }),
      null,
    );
    // Deliberately NO try/catch in the handler: the throw reaches pi, which
    // converts it into an error tool result (agent-loop.js prepareToolCall
    // catch) — the call never executes. Pin that the throw escapes.
    expect(() =>
      handler({
        type: "tool_call",
        toolCallId: "call-3",
        toolName: "read",
        input: { path: `${REAL_ROOT}/public.md` },
      }),
    ).toThrow("probe exploded");
  });
});

const classify = (toolName: string, input: Record<string, unknown>, e: GateEnv = env()) =>
  classifyVaultDocWrite({ toolName, input }, e);

/** A minimal pi ToolCallEvent for the handler tests below. */
const toolCall = (toolName: string, path: string) =>
  ({ type: "tool_call", toolCallId: "cp-1", toolName, input: { path } }) as const;

describe("classifyVaultDocWrite — the checkpoint seam's capture coordinate", () => {
  it("names the vault-relative target of an in-vault doc edit/write (all path forms)", () => {
    for (const tool of ["edit", "write"] as const) {
      for (const p of [
        "./vault/public.md",
        "vault/public.md",
        `${CWD}/vault/public.md`,
        `${REAL_ROOT}/public.md`,
        `${LEXICAL_ROOT}/public.md`,
      ]) {
        expect(classify(tool, { path: p }), `${tool} ${p}`).toEqual({ rel: "public.md", tool });
      }
    }
  });

  it("resolves through pi's normalization — the @-form names the same file", () => {
    expect(classify("write", { path: "@vault/public.md" })).toEqual({
      rel: "public.md",
      tool: "write",
    });
  });

  it("returns null for reads, scans, and opaque tools — only mutations checkpoint", () => {
    for (const tool of ["read", "grep", "find", "ls", "bash", "execute"]) {
      expect(classify(tool, { path: "./vault/public.md" }), tool).toBeNull();
    }
  });

  it("returns null for non-vault paths, non-doc vault files, and the vault root", () => {
    expect(classify("write", { path: "/etc/hosts" })).toBeNull();
    expect(classify("write", { path: "./scratch/tmp.md" })).toBeNull();
    expect(classify("edit", { path: "./vault/photo.png" })).toBeNull();
    expect(classify("edit", { path: "./vault" })).toBeNull();
  });

  it("returns null in the unverifiable-root world (the gate blocks those calls anyway)", () => {
    expect(
      classify("write", { path: "./vault/public.md" }, env({ vaultRealRoot: null })),
    ).toBeNull();
  });

  it("returns null for a schema-less call (no string path)", () => {
    expect(classify("write", {})).toBeNull();
    expect(classify("write", { path: 42 })).toBeNull();
  });
});

describe("privacy extension handler — the checkpoint seam (block wins, fail closed)", () => {
  function port(overrides?: Partial<PrivacyPort>): PrivacyPort {
    return {
      probe: (rel) => PROBES[rel] ?? "absent",
      // A WORKING world (unlike the fail-closed handler tests above): the
      // seam only matters when calls are allowed through. None of these
      // paths exist on the test machine, so realPathResolve is an identity
      // over them and classification stays deterministic.
      vaultRealRoot: () => REAL_ROOT,
      vaultLexicalRoot: () => LEXICAL_ROOT,
      privateIndexPaths: () => ["notes/secret.md"],
      ...overrides,
    };
  }

  it("captures pre-execution for an ALLOWED in-vault doc write, and allows it", () => {
    const captured: VaultDocWrite[] = [];
    const handler = buildToolCallHandler(port(), { capture: (t) => captured.push(t) });
    expect(handler(toolCall("write", `${REAL_ROOT}/public.md`))).toBeUndefined();
    expect(handler(toolCall("edit", `${REAL_ROOT}/public.md`))).toBeUndefined();
    expect(captured).toEqual([
      { rel: "public.md", tool: "write" },
      { rel: "public.md", tool: "edit" },
    ]);
  });

  it("captures NOTHING for a privacy-BLOCKED write — block wins, the file is never read", () => {
    const captured: VaultDocWrite[] = [];
    const handler = buildToolCallHandler(port(), { capture: (t) => captured.push(t) });
    const result = handler(toolCall("write", `${REAL_ROOT}/notes/secret.md`));
    expect(result?.block).toBe(true);
    expect(captured).toEqual([]);
  });

  it("captures nothing for reads and for writes outside the vault", () => {
    const captured: VaultDocWrite[] = [];
    const handler = buildToolCallHandler(port(), { capture: (t) => captured.push(t) });
    expect(handler(toolCall("read", `${REAL_ROOT}/public.md`))).toBeUndefined();
    expect(handler(toolCall("write", "/etc/hosts"))).toBeUndefined();
    expect(handler(toolCall("write", `${REAL_ROOT}/photo.png`))).toBeUndefined();
    expect(captured).toEqual([]);
  });

  it("a capture failure THROWS through — pi blocks the write (fail-closed undo)", () => {
    const handler = buildToolCallHandler(port(), {
      capture: () => {
        throw new Error("snapshot disk full");
      },
    });
    expect(() => handler(toolCall("write", `${REAL_ROOT}/public.md`))).toThrow(
      "snapshot disk full",
    );
  });

  it("a null checkpoint port (background agent) gates privacy exactly as before", () => {
    const handler = buildToolCallHandler(port(), null);
    expect(handler(toolCall("write", `${REAL_ROOT}/public.md`))).toBeUndefined();
    expect(handler(toolCall("write", `${REAL_ROOT}/notes/secret.md`))?.block).toBe(true);
  });
});
