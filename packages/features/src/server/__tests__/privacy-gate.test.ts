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

import { decideToolCall, type GateEnv } from "../agent/privacy/gate";
import { buildToolCallHandler } from "../agent/privacy/extension";
import type { PrivacyPort, PrivacyProbe } from "../agent/extension";

// The secret bytes that must never appear in anything the model sees.
const SECRET_BODY = "TOP SECRET: the rocket equation notes";

const CWD = "/ws";
const REAL_ROOT = "/real/vault";
const LEXICAL_ROOT = "/user/Documents/Vault";

const PROBES: Record<string, PrivacyProbe> = {
  "notes/secret.md": "private",
  "public.md": "public",
  "broken.md": "indeterminate",
  "sub/inner.md": "public",
};

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
    const handler = buildToolCallHandler(port());
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

  it("returns undefined (allow) for an unrelated tool call", () => {
    const handler = buildToolCallHandler(port());
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
