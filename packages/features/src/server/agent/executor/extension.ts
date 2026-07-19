/**
 * Executor (code mode) extension — gives the agent a single `execute` tool
 * (plus `resume`) backed by executor's daemon.
 *
 * Executor runs as a child daemon (managed by main/executor/executor-daemon.ts)
 * and acts as the integration layer / backend. Rather than registering each
 * remote tool individually, the agent writes TypeScript against executor's
 * typed `tools.*` catalog (discover, describe, invoke); only the returned data
 * flows back. The code runs server-side in executor's sandbox via the daemon's
 * `POST /executions` endpoint.
 *
 * Tool addresses are connection-scoped (executor v1.5):
 * `tools.<integration>.<owner>.<connection>.<tool>`. Auth failures come back
 * structured (`connection_value_missing` etc.) — those mean the USER must
 * connect the integration in the Extensions panel; the agent can't mint
 * credentials itself, so execute/resume append an actionable hint when one is
 * detected in the result.
 *
 * setup() installs the executor binary; register() ensures the daemon is up,
 * then registers the execute/resume tools.
 */

import { Type } from "@sinclair/typebox";
import { toErrorMessage } from "@repo/features/wire-helpers";
import type { ExtensionAPI } from "@repo/features/server/pi/pi-types";

import type { ExecutorPort, PiExtensionBundle } from "../extension";
import { textResult } from "../extension-helpers";
import type { ExecutorExecuteResult } from "@repo/features/executor";
import { isRecord } from "@repo/features/wire-helpers";

const EXECUTE_DESCRIPTION = `Execute TypeScript in a sandboxed runtime with access to the user's connected integrations.

Workflow:
1. const { items } = await tools.search({ query: "<intent + key nouns>", limit: 12 });
2. const path = items[0]?.path; if (!path) return "No matching tools found.";
3. const details = await tools.describe.tool({ path }); // inputTypeScript / outputTypeScript
4. const result = await tools.<integration>.<owner>.<connection>.<tool>(input);

Rules:
- Tool addresses are connection-scoped: tools.<integration>.<owner>.<connection>.<tool>, e.g. tools.google_calendar.user.default.calendar.events.list. Always call the exact path returned by tools.search — never invent segments.
- The tools object is a lazy proxy — Object.keys won't work; discover with tools.search(), or tools.executor.coreTools.integrations.list() / tools.executor.coreTools.connections.list().
- Tool calls return { ok: true, data } or { ok: false, error }. Branch on result.ok.
- Auth failures are structured: error.code is one of connection_value_missing / connection_rejected / oauth_connection_missing / oauth_refresh_failed / oauth_reauth_required. They mean the user has not connected (or must reconnect) that integration — do NOT retry and do NOT try to create credentials; tell the user to open the Extensions panel (Connectors) and connect the integration named in error.details.source.id.
- For large collections, filter in code rather than calling per-item tools. Do not use fetch — all API calls go through tools.*.
- TypeScript type syntax is stripped before execution; decorators and enum are unsupported.
- If execution pauses for interaction, resume it with the resume tool using the returned executionId.`;

const ExecuteSchema = Type.Object({
  code: Type.String({ description: "TypeScript to run in the sandbox. Must return a value." }),
});

const ResumeSchema = Type.Object({
  executionId: Type.String({ description: "The executionId from a paused execute result." }),
  action: Type.Union([Type.Literal("accept"), Type.Literal("decline"), Type.Literal("cancel")], {
    description: "How to resume the paused interaction.",
  }),
  content: Type.Optional(
    Type.Record(Type.String(), Type.Unknown(), {
      description: "Response payload matching the requested schema (for form elicitations).",
    }),
  ),
});

const executorExtension: PiExtensionBundle = {
  name: "executor",
  // The executor binary is a main-owned resource (daemon child process); its
  // pinned CLI metadata arrives through ports rather than a static import.
  cli: ({ executor }) => executor.cli,
  setup: async ({ onProgress, force, ports }) => {
    onProgress({ step: "Downloading executor runtime", percent: null });
    await ports.executor.install(force);
  },
  register:
    ({ ports }) =>
    async (pi) => {
      const up = await ports.executor.start();
      if (!up) {
        console.warn("[executor] daemon unavailable — code-mode tools will not be registered");
        return;
      }
      registerExecute(pi, ports.executor);
      registerResume(pi, ports.executor);
    },
};

export default executorExtension;

// ---------------------------------------------------------------------------
// Structured auth-failure detection. Executor returns auth failures as
// { ok: false, error: { code, message, details: { category: "authentication",
// source: { id: <integration> }, … } } } wherever the sandboxed code surfaced
// them — so scan the structured result for that shape and turn it into an
// instruction the model can act on (point the USER at the Extensions panel)
// instead of raw JSON it might retry against.
// ---------------------------------------------------------------------------

const AUTH_FAILURE_CODES = new Set([
  "connection_value_missing",
  "connection_rejected",
  "oauth_connection_missing",
  "oauth_refresh_failed",
  "oauth_reauth_required",
]);

const AUTH_SCAN_MAX_DEPTH = 6;

type AuthFailure = { code: string; integration: string | null };

function authFailureOf(value: unknown): AuthFailure | null {
  if (!isRecord(value)) return null;
  const code = value["code"];
  if (typeof code !== "string" || !AUTH_FAILURE_CODES.has(code)) return null;
  const details = value["details"];
  const source = isRecord(details) ? details["source"] : undefined;
  const id = isRecord(source) ? source["id"] : undefined;
  return { code, integration: typeof id === "string" ? id : null };
}

function findAuthFailure(value: unknown, depth = 0): AuthFailure | null {
  if (depth > AUTH_SCAN_MAX_DEPTH) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findAuthFailure(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!isRecord(value)) return null;
  const direct = authFailureOf(value);
  if (direct) return direct;
  for (const nested of Object.values(value)) {
    const found = findAuthFailure(nested, depth + 1);
    if (found) return found;
  }
  return null;
}

/** Append an actionable connect instruction when the result carries a
 * structured auth failure; pass the text through untouched otherwise. */
function withAuthHint(result: ExecutorExecuteResult): string {
  const failure = findAuthFailure(result.structured);
  if (!failure) return result.text;
  const target = failure.integration
    ? `the "${failure.integration}" integration`
    : "this integration";
  return (
    `${result.text}\n\n` +
    `[auth required] ${target} has no working credential (${failure.code}). ` +
    `You cannot fix this from code. Tell the user to open the Extensions panel → Connectors ` +
    `and connect${failure.integration ? ` ${failure.integration}` : " it"}, then retry.`
  );
}

function registerExecute(pi: ExtensionAPI, executor: ExecutorPort): void {
  pi.registerTool({
    name: "execute",
    label: "execute",
    description: EXECUTE_DESCRIPTION,
    parameters: ExecuteSchema,
    execute: async (_id, params) => {
      try {
        const result = await executor.execute(params.code);
        return textResult(withAuthHint(result));
      } catch (err) {
        return textResult(`execute failed: ${toErrorMessage(err)}`);
      }
    },
  });
}

function registerResume(pi: ExtensionAPI, executor: ExecutorPort): void {
  pi.registerTool({
    name: "resume",
    label: "resume",
    description:
      "Resume a paused execution by its executionId. Use after `execute` returns a paused result " +
      "that requests interaction (e.g. an approval elicitation).",
    parameters: ResumeSchema,
    execute: async (_id, params) => {
      try {
        const result = await executor.resume(params.executionId, params.action, params.content);
        return textResult(withAuthHint(result));
      } catch (err) {
        return textResult(`resume failed: ${toErrorMessage(err)}`);
      }
    },
  });
}
