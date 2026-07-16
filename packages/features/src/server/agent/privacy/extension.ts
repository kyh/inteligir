/**
 * Privacy extension — enforces `private: true` at the agent tool boundary
 * for BOTH agents (chat and delegation register the same EXTENSION_BUNDLES).
 *
 * Mechanism: pi 0.73.1's blockable `tool_call` event. The handler fires
 * before every tool executes; returning `{ block: true, reason }` short-
 * circuits the run and the model receives the reason as an error tool result
 * (pi-agent-core agent-loop.js prepareToolCall → createErrorToolResult). A
 * THROWING handler is caught into the same error result — so a probe that
 * blows up still blocks: fail-closed by construction. We therefore do NOT
 * try/catch around the decision; a throw IS the safe outcome. Re-verify this
 * contract in the installed package on every pi version bump (docs/
 * extensions.md "tool_call"; dist/core/agent-session.js _installAgentToolHooks;
 * pi-agent-core dist/agent-loop.js prepareToolCall).
 *
 * SOUNDNESS (read this before trusting it): only read/edit/write (and the
 * inactive grep/find/ls) are soundly gated, via a live frontmatter probe per
 * call. bash, execute, browser, and peekaboo get a best-effort literal-path
 * screen ONLY — `cat` with a glob, a pipe, or a screenshot of a private note
 * on screen all bypass it. Without a sandbox those tools can still leak
 * private content; AGENTS.md instructs the model not to, it does not prevent
 * it. docs/privacy.md is the honest statement of scope.
 */

import fs from "node:fs";
import path from "node:path";

import type { PiExtensionBundle, PrivacyPort } from "../extension";
import { WORKSPACE_DIR } from "../paths";
import { decideToolCall, type GateEnv } from "./gate";
import { resolvePiToolPath } from "./pi-path-parity";
import type { ToolCallEvent, ToolCallEventResult } from "@repo/features/server/pi/pi-types";

/** Canonicalize with nearest-existing-ancestor semantics (VaultManager's
 * realPath, mirrored): a not-yet-created file under a symlinked parent still
 * dereferences the parent, so a write creating a new file classifies right. */
function realPathResolve(p: string): string {
  const resolved = path.resolve(p);
  const tail: string[] = [];
  let current = resolved;
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) return resolved; // nothing exists up to the fs root
    tail.unshift(path.basename(current));
    current = parent;
  }
  try {
    const realBase = fs.realpathSync(current);
    return tail.length > 0 ? path.join(realBase, ...tail) : realBase;
  } catch {
    return resolved;
  }
}

/** The gate's environment, rebuilt per call: roots re-read so a vault switch
 * or logout/login is picked up live, never captured stale. */
function gateEnv(privacy: PrivacyPort): GateEnv {
  return {
    cwd: WORKSPACE_DIR,
    vaultRealRoot: privacy.vaultRealRoot(),
    vaultLexicalRoot: privacy.vaultLexicalRoot(),
    probe: (rel) => privacy.probe(rel),
    privateIndexPaths: () => privacy.privateIndexPaths(),
    // Resolve path args exactly as pi's tools will (same cwd, same expandPath
    // + read-variant semantics) — gate/tool agreement by construction.
    normalizePath: (inputPath) => resolvePiToolPath(inputPath, WORKSPACE_DIR),
    realpath: realPathResolve,
  };
}

/** The tool_call handler, exported for direct unit testing (the bundle wires
 * it verbatim). Returns undefined to allow; a block result to refuse. */
export function buildToolCallHandler(
  privacy: PrivacyPort,
): (event: ToolCallEvent) => ToolCallEventResult | undefined {
  return (event) => {
    const decision = decideToolCall(
      { toolName: event.toolName, input: event.input },
      gateEnv(privacy),
    );
    return decision.allow ? undefined : { block: true, reason: decision.reason };
  };
}

const privacyExtension: PiExtensionBundle = {
  name: "privacy",
  register:
    ({ ports }) =>
    (pi) => {
      pi.on("tool_call", buildToolCallHandler(ports.privacy));
    },
};

export default privacyExtension;
