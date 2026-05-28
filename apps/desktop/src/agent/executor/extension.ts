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
 * setup() installs the executor binary; register() ensures the daemon is up,
 * then registers the execute/resume tools.
 */

import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@repo/pi-driver";

import { execute, resumeExecution } from "@/main/executor/executor-client";
import { installExecutor, getExecutorDaemon } from "@/main/executor/executor-daemon";
import type { PiExtensionBundle } from "@/agent/extension";
import { textResult } from "@/agent/extension-helpers";

const EXECUTE_DESCRIPTION = `Execute TypeScript in a sandboxed runtime with access to configured API tools.

Workflow:
1. const { items } = await tools.search({ query: "<intent + key nouns>", limit: 12 });
2. const path = items[0]?.path; if (!path) return "No matching tools found.";
3. const details = await tools.describe.tool({ path }); // inputTypeScript / outputTypeScript
4. const result = await tools.<namespace>.<tool>(input);

Rules:
- Always namespace tool calls: tools.<namespace>.<tool>(args). The tools object is a lazy proxy — Object.keys won't work; use tools.search() or tools.executor.sources.list().
- Tool calls return { ok: true, data } or { ok: false, error }. Branch on result.ok.
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
  setup: async ({ onProgress }) => {
    onProgress({ step: "Downloading executor runtime", percent: null });
    await installExecutor();
  },
  register: () => async (pi) => {
    const conn = await getExecutorDaemon().start();
    if (!conn) {
      console.warn("[executor] daemon unavailable — code-mode tools will not be registered");
      return;
    }
    registerExecute(pi);
    registerResume(pi);
  },
};

export default executorExtension;

function registerExecute(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "execute",
    label: "execute",
    description: EXECUTE_DESCRIPTION,
    parameters: ExecuteSchema,
    execute: async (_id, params) => {
      try {
        const result = await execute(params.code);
        return textResult(result.text);
      } catch (err) {
        return textResult(`execute failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  });
}

function registerResume(pi: ExtensionAPI): void {
  pi.registerTool({
    name: "resume",
    label: "resume",
    description:
      "Resume a paused execution by its executionId. Use after `execute` returns a paused result " +
      "that requests interaction (e.g. an approval or OAuth handoff).",
    parameters: ResumeSchema,
    execute: async (_id, params) => {
      try {
        const result = await resumeExecution(params.executionId, params.action, params.content);
        return textResult(result.text);
      } catch (err) {
        return textResult(`resume failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    },
  });
}
