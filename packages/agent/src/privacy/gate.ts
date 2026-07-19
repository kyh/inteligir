// ---------------------------------------------------------------------------
// The privacy gate's PURE decision core — SECURITY-CRITICAL.
//
// decideToolCall answers "may this pi tool call run?" for every tool of both
// agents (chat + delegation). It is deliberately fs-free: the live-disk
// frontmatter probe, the vault-root realpaths, and the symlink resolver all
// arrive through GateEnv, so the whole decision matrix is unit-testable and
// the fail-closed branches are pinned by tests, not hope.
//
// Enforcement tiers (docs/privacy.md is the user-facing version):
//  - read/edit/write on an in-vault .md doc: LIVE probe per call. Only
//    "public" (or "absent" — the tool's own ENOENT / write-creates-new is the
//    honest reply) allows; "private"/"indeterminate" blocks with a structured
//    reason. The index is never trusted here — no TOCTOU on the direct path.
//  - grep/find/ls (inactive today — INITIAL_ACTIVE_TOOLS is read/bash/edit/
//    write — but gated defensively): a private doc target blocks; a directory
//    target blocks when ANY indexed private note lives under it. KNOWN-COARSE:
//    one private note anywhere makes a vault-root grep/ls refuse entirely.
//    Whoever activates these tools later inherits that rule knowingly.
//  - bash / execute / browser / peekaboo: BEST-EFFORT ONLY. We block a call
//    whose input string literally references an indexed private note's
//    vault-relative path — nothing more. Command parsing can never be sound:
//    `cat ./vault/*.md`, pipes, $(...), cd, encodings, and a peekaboo
//    screenshot of a private note on screen ALL bypass this heuristic. The
//    honest statement: without a sandbox these tools can still read private
//    notes; the AGENTS.md rule instructs the model not to, it does not
//    prevent it. Do NOT present this heuristic as a security boundary.
//  - vaultRealRoot unresolvable (null): FAIL CLOSED — anything lexically
//    under ./vault (the workspace symlink) or the configured root is blocked
//    rather than treated as outside-vault.
//
// Path arguments are classified through the injected env.normalizePath —
// pi's OWN resolution semantics (pi-path-parity.ts) — never the raw string:
// gate and tool must agree on the target BY CONSTRUCTION, or an alias form
// (`@vault/…`, NBSP-spaced filename, `~`-absolute) reads a private note
// through a gate that probed a phantom path.
// ---------------------------------------------------------------------------

import path from "node:path";

import { isDocPath } from "@repo/domain/knowledge/doc-file";

import type { PrivacyProbe, VaultDocWrite } from "../extension";

/** Everything the decision core needs, injected (no fs in this module). */
export type GateEnv = {
  /** The agent workspace dir — pi tools resolve relative paths against it. */
  cwd: string;
  /** pi-parity path normalization (expandPath + resolveReadPath semantics):
   * maps a tool's raw `path` argument to the target pi's file tools will
   * ACTUALLY open — `@`-prefix strip, unicode-space mapping, `~` expansion,
   * and the on-disk filename-variant fallbacks. The gate must never resolve
   * the raw string itself: gate-vs-tool resolution divergence was a confirmed
   * private-content bypass (`@vault/…`, NBSP filenames). Wired to
   * pi-path-parity.ts's resolvePiToolPath; injected so this module stays
   * fs-free and the decision matrix unit-testable. */
  normalizePath: (inputPath: string) => string;
  /** realpath of the vault root, or null when it could not be resolved. */
  vaultRealRoot: string | null;
  /** The configured vault root, lexically resolved (no symlink deref) — the
   * fail-closed fallback prefix used only while vaultRealRoot is null. */
  vaultLexicalRoot: string | null;
  /** LIVE disk frontmatter probe for a vault-relative path. */
  probe: (rel: string) => PrivacyProbe;
  /** Indexed private note paths (vault-relative) — the best-effort prefilter
   * for bash/execute/browser/peekaboo strings and directory scans. */
  privateIndexPaths: () => string[];
  /** Symlink-resolving canonicalizer (nearest-existing-ancestor semantics,
   * mirroring VaultManager's realPath). Injected so tests stub the fs. */
  realpath: (p: string) => string;
};

export type GateDecision = { allow: true } | { allow: false; reason: string };

const ALLOW: GateDecision = { allow: true };

/** pi built-ins whose single `path` names the file they read or mutate. */
const FILE_TOOLS = new Set(["read", "edit", "write"]);
/** pi built-ins that scan a file or directory subtree. */
const SCAN_TOOLS = new Set(["grep", "find", "ls"]);
/** Curated knowledge tools: privacy is enforced at the KnowledgePort (private
 * hits dropped entirely + live re-probe), so the gate leaves them alone — a
 * path-shaped arg here is a lookup key, not a read. */
const KNOWLEDGE_TOOLS = new Set(["search_vault", "get_backlinks"]);

/** Gate one tool call. `input` is the already-validated tool arguments (pi
 * validates before the tool_call hook fires). Unknown tools pass — the
 * curated read surfaces (search_vault/get_backlinks) filter privately at the
 * KnowledgePort instead. */
export function decideToolCall(
  call: { toolName: string; input: Record<string, unknown> },
  env: GateEnv,
): GateDecision {
  if (FILE_TOOLS.has(call.toolName)) {
    return decideFileTool(stringField(call.input, "path"), env);
  }
  if (SCAN_TOOLS.has(call.toolName)) {
    // grep/find/ls default to the cwd when no path is given.
    return decideScanTool(stringField(call.input, "path") ?? ".", env);
  }
  if (call.toolName === "bash") {
    return decideOpaqueInput(stringField(call.input, "command"), env, "bash command");
  }
  if (call.toolName === "execute") {
    return decideOpaqueInput(stringField(call.input, "code"), env, "execute code");
  }
  if (call.toolName === "browser" || call.toolName === "peekaboo") {
    const args = stringArrayField(call.input, "args") ?? [];
    const stdin = stringField(call.input, "stdin") ?? "";
    return decideOpaqueInput([...args, stdin].join("\n"), env, `${call.toolName} input`);
  }
  if (KNOWLEDGE_TOOLS.has(call.toolName)) return ALLOW;
  // Unknown tool (e.g. a connector registered by the executor bundle). We can't
  // classify its arguments, so this is NOT a boundary — but it gets the same
  // best-effort literal-private-path screen bash does, rather than a silent
  // allow. A FUTURE tool that can read vault content must be added to the
  // dispatch above with a real decision, never left to this fallthrough.
  return decideOpaqueInput(collectStrings(call.input).join("\n"), env, `${call.toolName} input`);
}

/** Classify a pi tool call as an in-vault DOC mutation (edit/write) and hand
 * back its vault-relative target — the checkpoint seam's capture coordinate.
 * Returns null for everything else: reads, scans, non-vault paths, non-docs,
 * and the unverifiable-root state (decideToolCall blocks those calls anyway,
 * so nothing capturable slips past as null here). Runs the SAME classifyPath
 * / parity resolution as the decision core, so the checkpointed file is the
 * file pi's tool will actually open — never a re-derivation from the raw
 * string. Callers run it strictly AFTER an allow decision; it must never
 * influence one. */
export function classifyVaultDocWrite(
  call: { toolName: string; input: Record<string, unknown> },
  env: GateEnv,
): VaultDocWrite | null {
  if (call.toolName !== "edit" && call.toolName !== "write") return null;
  const inputPath = stringField(call.input, "path");
  if (inputPath === null) return null;
  const target = classifyPath(inputPath, env);
  if (target.kind !== "vault") return null;
  if (target.rel === "" || !isDocPath(target.rel)) return null;
  return { rel: target.rel, tool: call.toolName };
}

/** Every top-level string (and string-array element) of a tool's input — the
 * text screened for unknown tools above. */
function collectStrings(input: Record<string, unknown>): string[] {
  const out: string[] = [];
  for (const value of Object.values(input)) {
    if (typeof value === "string") out.push(value);
    else if (Array.isArray(value)) {
      for (const item of value) if (typeof item === "string") out.push(item);
    }
  }
  return out;
}

// ---- Path classification -------------------------------------------------------

type Target =
  | { kind: "outside" }
  | { kind: "vault"; rel: string } // "" = the vault root itself
  | { kind: "unverifiable" }; // vaultRealRoot null AND the path is vault-shaped

function isUnder(target: string, root: string): boolean {
  return target === root || target.startsWith(root + path.sep);
}

function classifyPath(inputPath: string, env: GateEnv): Target {
  // FIRST resolve through pi's OWN normalization so the gate classifies the
  // file pi's tool will open, not the literal string the model typed — the
  // raw input was the `@`/unicode-space/`~` bypass class (see GateEnv).
  const resolved = path.resolve(env.cwd, env.normalizePath(inputPath));
  if (env.vaultRealRoot === null) {
    // FAIL CLOSED (mustFix): with no verified root, a path under the ./vault
    // workspace symlink or the configured root cannot be probed — block it
    // rather than let a realpath failure open the gate.
    if (isUnder(resolved, path.resolve(env.cwd, "vault"))) return { kind: "unverifiable" };
    if (env.vaultLexicalRoot !== null && isUnder(resolved, path.resolve(env.vaultLexicalRoot))) {
      return { kind: "unverifiable" };
    }
    return { kind: "outside" };
  }
  // Mirror VaultManager.resolve's symlink story: canonicalize, then require
  // the REAL target under the REAL root. A symlink planted in the vault that
  // points out resolves outside → not vault content, the gate ignores it.
  const real = env.realpath(resolved);
  if (!isUnder(real, env.vaultRealRoot)) return { kind: "outside" };
  const rel = path.relative(env.vaultRealRoot, real).split(path.sep).join("/");
  return { kind: "vault", rel };
}

// ---- Per-tier decisions ---------------------------------------------------------

function privateReason(rel: string, probe: PrivacyProbe): string {
  // Path only — NEVER file content. This string becomes the error tool result
  // the model reads and pi persists to the session transcript.
  return probe === "indeterminate"
    ? `./vault/${rel} has unreadable frontmatter and is treated as private (fail-closed). ` +
        `Do not try to access it another way — tell the user the note could not be read.`
    : `./vault/${rel} is marked private (frontmatter \`private: true\`) and cannot be accessed ` +
        `by AI tools. Do not try to access it another way — tell the user the note is private.`;
}

function unverifiableReason(inputPath: string): string {
  return (
    `The vault location could not be verified, so vault paths are refused fail-closed ` +
    `(requested: ${inputPath}). Tell the user the vault looks misconfigured.`
  );
}

function decideFileTool(inputPath: string | null, env: GateEnv): GateDecision {
  if (inputPath === null) return ALLOW; // schema-invalid call — the tool errors itself
  const target = classifyPath(inputPath, env);
  if (target.kind === "outside") return ALLOW;
  if (target.kind === "unverifiable")
    return { allow: false, reason: unverifiableReason(inputPath) };
  if (target.rel === "" || !isDocPath(target.rel)) return ALLOW; // dir / non-doc vault file
  const probe = env.probe(target.rel);
  if (probe === "public" || probe === "absent") return ALLOW;
  return { allow: false, reason: privateReason(target.rel, probe) };
}

function decideScanTool(inputPath: string, env: GateEnv): GateDecision {
  const target = classifyPath(inputPath, env);
  if (target.kind === "outside") return ALLOW;
  if (target.kind === "unverifiable")
    return { allow: false, reason: unverifiableReason(inputPath) };
  if (target.rel !== "" && isDocPath(target.rel)) {
    const probe = env.probe(target.rel);
    if (probe === "public" || probe === "absent") return ALLOW;
    return { allow: false, reason: privateReason(target.rel, probe) };
  }
  // Directory (or the root) — refuse when any INDEXED private note lives under
  // it. Coarse by design (see header) and index-lagged: a note marked private
  // in the last ~100ms may be missed here; the direct-read tier still blocks.
  const dir = target.rel;
  const hit = env
    .privateIndexPaths()
    .find((p) => dir === "" || p === dir || p.startsWith(dir + "/"));
  if (hit !== undefined) {
    return {
      allow: false,
      reason:
        `./vault/${dir === "" ? "" : dir + "/"} contains private notes (frontmatter ` +
        `\`private: true\`), so scanning it is refused. Name a specific non-private file ` +
        `or folder instead, or use search_vault.`,
    };
  }
  return ALLOW;
}

/** Best-effort literal-path screen for opaque inputs (bash command, execute
 * code, browser/peekaboo args). See the header: this is NOT sound and must
 * never be sold as a boundary — it removes the naive shortest-path case only. */
function decideOpaqueInput(text: string | null, env: GateEnv, what: string): GateDecision {
  if (text === null || text === "") return ALLOW;
  const hit = env.privateIndexPaths().find((rel) => referencesPath(text, rel));
  if (hit === undefined) return ALLOW;
  return {
    allow: false,
    reason:
      `The ${what} references ./vault/${hit}, which is marked private (frontmatter ` +
      `\`private: true\`). Do not access private notes through system tools — tell the ` +
      `user the note is private.`,
  };
}

/** Literal containment with a crude word boundary on both sides, so private
 * `a.md` doesn't trip on `data.md`. Both the bare vault-relative form and the
 * `./vault/`-prefixed form match (the prefix ends in `/`, not a word char). */
function referencesPath(text: string, rel: string): boolean {
  const wordish = /[A-Za-z0-9_.-]/;
  let from = 0;
  for (;;) {
    const at = text.indexOf(rel, from);
    if (at === -1) return false;
    const before = at === 0 ? "" : (text[at - 1] ?? "");
    const after = text[at + rel.length] ?? "";
    if (!(before !== "" && wordish.test(before)) && !wordish.test(after)) return true;
    from = at + 1;
  }
}

// ---- Input field readers (validated upstream; defensive here) -------------------

function stringField(input: Record<string, unknown>, key: string): string | null {
  const value = input[key];
  return typeof value === "string" ? value : null;
}

function stringArrayField(input: Record<string, unknown>, key: string): string[] | null {
  const value = input[key];
  if (!Array.isArray(value)) return null;
  return value.filter((item): item is string => typeof item === "string");
}
