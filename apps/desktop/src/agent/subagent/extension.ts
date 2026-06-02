/**
 * Subagent extension — delegate work to isolated agents with their own context
 * windows.
 *
 * Each invocation spawns a separate one-shot `pi` process in JSON mode
 * (`--mode json -p --no-session`), so the subagent's context never pollutes the
 * main conversation. The child inherits PI_CODING_AGENT_DIR, so it shares the
 * host's auth and model registry, but runs with `--no-context-files` and
 * `--no-extensions` — it gets pi's built-in tools (read/bash/grep/edit/…) and
 * its own system prompt, NOT the Chief-of-Staff persona or the privileged
 * in-process tools (manage_ui, manage_tasks). That isolation is the point:
 * subagents are sandboxed workers, not shell operators.
 *
 * The host stays on the in-process SDK (createAgentSession); only subagents run
 * out-of-process. See agents.ts for definition discovery.
 *
 * Modes:
 *   - single:   { agent, task }
 *   - parallel: { tasks: [{ agent, task }, …] }   (bounded concurrency)
 *   - chain:    { chain: [{ agent, task }, …] }    ({previous} interpolated)
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

import { Type, type Static } from "@sinclair/typebox";
import { seedDirectory } from "@repo/agent-runtime/seed";

import { inteligirPath } from "@/main/lib/json-store";
import type { PiExtensionBundle } from "@/agent/extension";
import { textResult, type ToolTextResult } from "@/agent/extension-helpers";
import { discoverAgents, type AgentConfig } from "@/agent/subagent/agents";

// Mirror setup.ts — openai-codex is the only configured provider, so subagents
// authenticate the same way. Definitions may override the model via frontmatter.
const AUTH_PROVIDER = "openai-codex";
const DEFAULT_MODEL = "gpt-5.5";

const MAX_PARALLEL_TASKS = 8;
const MAX_CONCURRENCY = 4;
const SUBAGENT_TIMEOUT_MS = 600_000;

const AGENT_DIR = inteligirPath();
const WORKSPACE_DIR = inteligirPath("workspace");

// ---------------------------------------------------------------------------
// pi process invocation
// ---------------------------------------------------------------------------

let cachedPiCli: string | null = null;

/** Path to pi's CLI entry, resolved from the same node_modules the host uses. */
function resolvePiCli(): string {
  if (!cachedPiCli) {
    cachedPiCli = createRequire(import.meta.url).resolve(
      "@mariozechner/pi-coding-agent/dist/cli.js",
    );
  }
  return cachedPiCli;
}

type SubagentUsage = {
  turns: number;
  input: number;
  output: number;
  cost: number;
  contextTokens: number;
};

type SubagentResult = {
  agent: string;
  task: string;
  output: string;
  exitCode: number;
  stderr: string;
  usage: SubagentUsage;
  model?: string;
  errorMessage?: string;
  /** Last assistant turn's stop reason (e.g. "stop", "max_tokens", "error"). */
  stopReason?: string;
};

// Loose shapes for the JSONL events pi emits in --mode json.
type PiBlock = { type: string; text?: string };
type PiMessage = {
  role?: string;
  content?: string | PiBlock[];
  model?: string;
  errorMessage?: string;
  stopReason?: string;
  usage?: {
    input?: number;
    output?: number;
    cost?: { total?: number };
    totalTokens?: number;
  };
};
type PiEvent = { type?: string; message?: PiMessage };

function emptyUsage(): SubagentUsage {
  return { turns: 0, input: 0, output: 0, cost: 0, contextTokens: 0 };
}

function messageText(message: PiMessage): string {
  if (typeof message.content === "string") return message.content;
  if (!Array.isArray(message.content)) return "";
  return message.content
    .filter((block) => block.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("");
}

/** Write the system prompt to a private temp file; pi reads it via a flag. */
async function writePromptFile(agentName: string): Promise<{ dir: string; filePath: string }> {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "inteligir-subagent-"));
  const safeName = agentName.replace(/[^\w.-]+/g, "_");
  return { dir, filePath: path.join(dir, `prompt-${safeName}.md`) };
}

async function runSubagent(
  agent: AgentConfig,
  task: string,
  signal: AbortSignal | undefined,
): Promise<SubagentResult> {
  const result: SubagentResult = {
    agent: agent.name,
    task,
    output: "",
    exitCode: 0,
    stderr: "",
    usage: emptyUsage(),
    model: agent.model ?? DEFAULT_MODEL,
  };

  // Don't spawn at all if we're already aborted — keeps a host interrupt from
  // launching the next chain step or the rest of the parallel queue.
  if (signal?.aborted) {
    result.exitCode = 125;
    result.errorMessage = "Aborted before start";
    return result;
  }

  const args = [
    "--mode",
    "json",
    "-p",
    "--no-session",
    "--no-context-files",
    "--no-extensions",
    "--provider",
    AUTH_PROVIDER,
    "--model",
    result.model as string,
  ];
  if (agent.tools && agent.tools.length > 0) args.push("--tools", agent.tools.join(","));

  let tmpDir: string | null = null;
  let tmpPromptPath: string | null = null;
  try {
    if (agent.systemPrompt.trim()) {
      const tmp = await writePromptFile(agent.name);
      tmpDir = tmp.dir;
      tmpPromptPath = tmp.filePath;
      await fs.promises.writeFile(tmpPromptPath, agent.systemPrompt, { encoding: "utf-8", mode: 0o600 });
      args.push("--append-system-prompt", tmpPromptPath);
    }
    args.push(`Task: ${task}`);

    result.exitCode = await new Promise<number>((resolve) => {
      const proc = spawn(process.execPath, [resolvePiCli(), ...args], {
        cwd: WORKSPACE_DIR,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          ELECTRON_RUN_AS_NODE: "1",
          PI_CODING_AGENT_DIR: AGENT_DIR,
        },
      });

      let aborted = false;
      let settled = false;
      let buffer = "";

      // Single resolve site — `error` may precede `close`, and either can fire
      // after a timeout/abort kill.
      const finish = (code: number) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        // The `settled` guard above makes this single-resolve; the linter's
        // flow analysis can't see it across the two event handlers.
        // oxlint-disable-next-line promise/no-multiple-resolved
        resolve(code);
      };

      const processLine = (line: string) => {
        if (!line.trim()) return;
        let event: PiEvent;
        try {
          event = JSON.parse(line) as PiEvent;
        } catch {
          return;
        }
        const message = event.message;
        if (!message) return;

        if (event.type === "message_end" && message.role === "assistant") {
          const text = messageText(message);
          if (text.trim()) result.output = text;
          result.usage.turns += 1;
          const usage = message.usage;
          if (usage) {
            result.usage.input += usage.input ?? 0;
            result.usage.output += usage.output ?? 0;
            result.usage.cost += usage.cost?.total ?? 0;
            result.usage.contextTokens = usage.totalTokens ?? result.usage.contextTokens;
          }
          if (message.model) result.model = message.model;
          // Reflect only the latest turn — clear a prior turn's error/stop when
          // a later turn succeeds, so a recovered multi-turn run (exit 0) isn't
          // left flagged as failed and wrongly halting a chain.
          result.errorMessage = message.errorMessage || undefined;
          result.stopReason = message.stopReason || undefined;
        }
      };

      proc.stdout.on("data", (data: Buffer) => {
        buffer += data.toString();
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) processLine(line);
      });
      proc.stderr.on("data", (data: Buffer) => {
        result.stderr += data.toString();
      });

      // SIGTERM, then SIGKILL if the child hasn't exited. Checks our own
      // `settled` flag, not `proc.killed` — Node sets `killed` as soon as a
      // signal is *sent*, so it can't tell us whether the process actually died.
      const killWithEscalation = () => {
        proc.kill("SIGTERM");
        setTimeout(() => {
          if (!settled) proc.kill("SIGKILL");
        }, 5000);
      };

      const timer = setTimeout(() => {
        aborted = true;
        killWithEscalation();
      }, SUBAGENT_TIMEOUT_MS);

      const onAbort = () => {
        aborted = true;
        killWithEscalation();
      };
      if (signal) {
        if (signal.aborted) onAbort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }

      proc.on("close", (code) => {
        if (buffer.trim()) processLine(buffer);
        if (aborted && !result.errorMessage) result.errorMessage = "Subagent timed out or was aborted";
        finish(code ?? (aborted ? 124 : 0));
      });
      proc.on("error", (err) => {
        result.stderr += `\n${err instanceof Error ? err.message : String(err)}`;
        finish(1);
      });
    });

    return result;
  } finally {
    if (tmpPromptPath) await fs.promises.rm(tmpPromptPath, { force: true }).catch(() => {});
    if (tmpDir) await fs.promises.rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Result formatting
// ---------------------------------------------------------------------------

function formatUsage(usage: SubagentUsage, model?: string): string {
  const parts: string[] = [];
  if (usage.turns) parts.push(`${usage.turns} turn${usage.turns === 1 ? "" : "s"}`);
  if (usage.input) parts.push(`↑${usage.input}`);
  if (usage.output) parts.push(`↓${usage.output}`);
  if (usage.cost) parts.push(`$${usage.cost.toFixed(4)}`);
  if (model) parts.push(model);
  return parts.join(" ");
}

function formatResult(result: SubagentResult): string {
  const header = `### ${result.agent}`;
  const body = result.output.trim() || "(no output)";
  const footer = formatUsage(result.usage, result.model);
  const lines = [header, body];
  if (result.errorMessage) lines.push(`\n[error] ${result.errorMessage}`);
  // Surface a non-normal stop (e.g. truncation) so the caller knows the reply
  // may be incomplete even when the process exited cleanly.
  if (result.stopReason && result.stopReason !== "stop") {
    lines.push(`[stopped: ${result.stopReason}]`);
  }
  if (result.exitCode !== 0) lines.push(`[exit ${result.exitCode}]`);
  if (result.stderr.trim()) lines.push(`[stderr]\n${result.stderr.trim()}`);
  if (footer) lines.push(`_(${footer})_`);
  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Concurrency
// ---------------------------------------------------------------------------

async function mapWithConcurrency<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = Array.from<TOut>({ length: items.length });
  let next = 0;
  await Promise.all(
    Array.from({ length: limit }, async () => {
      for (;;) {
        const current = next++;
        if (current >= items.length) return;
        results[current] = await fn(items[current]!, current);
      }
    }),
  );
  return results;
}

// ---------------------------------------------------------------------------
// Tool schema + registration
// ---------------------------------------------------------------------------

const TaskItem = Type.Object({
  agent: Type.String({ description: "Name of the subagent to invoke." }),
  task: Type.String({ description: "Task to delegate to the subagent." }),
});

const SubagentSchema = Type.Object({
  agent: Type.Optional(Type.String({ description: "Subagent name (single mode)." })),
  task: Type.Optional(Type.String({ description: "Task to delegate (single mode)." })),
  tasks: Type.Optional(
    Type.Array(TaskItem, {
      description: "Run these {agent, task} pairs in parallel (isolated contexts).",
    }),
  ),
  chain: Type.Optional(
    Type.Array(TaskItem, {
      description:
        "Run these {agent, task} pairs sequentially. Use the placeholder {previous} " +
        "in a task to inject the prior step's output.",
    }),
  ),
});

type SubagentParams = Static<typeof SubagentSchema>;

function findAgent(agents: AgentConfig[], name: string): AgentConfig | undefined {
  return agents.find((a) => a.name === name);
}

function unknownAgentResult(agents: AgentConfig[], name: string): ToolTextResult {
  const available = agents.map((a) => `"${a.name}"`).join(", ") || "none";
  return textResult(`Unknown subagent "${name}". Available: ${available}.`);
}

/** A chain step we deliberately did not run (abort, or a prior step failed), so
 *  a truncated chain can't be mistaken for a complete, successful pipeline. */
function skippedResult(agentName: string, task: string, reason: string): SubagentResult {
  return {
    agent: agentName,
    task,
    output: "",
    exitCode: 125,
    stderr: "",
    usage: emptyUsage(),
    errorMessage: reason,
  };
}

function buildDescription(agents: AgentConfig[]): string {
  const list =
    agents.length > 0
      ? agents.map((a) => `- ${a.name}: ${a.description}`).join("\n")
      : "- (no subagents defined yet — add Markdown defs under ~/.inteligir/agents/)";
  return (
    "Delegate work to a subagent that runs in its own isolated context window, " +
    "then return its result. Use this to keep a long or noisy sub-task out of the " +
    "main conversation, or to fan out independent work.\n\n" +
    "Modes (provide exactly one):\n" +
    "- single: { agent, task }\n" +
    "- parallel: { tasks: [{ agent, task }, …] }\n" +
    "- chain: { chain: [{ agent, task }, …] } — {previous} is replaced with the prior step's output.\n\n" +
    // This list is fixed when the tool is registered (session start). Defs added
    // to ~/.inteligir/agents/ mid-session still work — invocation re-discovers
    // them — but only appear here next session.
    `Subagents available this session:\n${list}`
  );
}

const subagentExtension: PiExtensionBundle = {
  name: "subagent",

  // Seed the bundled agent definitions into ~/.inteligir/agents on first run,
  // the same way skills/AGENTS.md are seeded in setup.ts.
  setup: async ({ bundledResourcesDir }) => {
    seedDirectory(path.join(bundledResourcesDir, "agents"), path.join(AGENT_DIR, "agents"));
  },

  register: () => (pi) => {
    const agents = discoverAgents(AGENT_DIR, WORKSPACE_DIR);

    pi.registerTool({
      name: "subagent",
      label: "subagent",
      description: buildDescription(agents),
      parameters: SubagentSchema,
      execute: async (_toolCallId, params: SubagentParams, signal?: AbortSignal) => {
        // Re-discover per call so defs added mid-session are picked up.
        const live = discoverAgents(AGENT_DIR, WORKSPACE_DIR);

        // Enforce the documented "exactly one mode" contract up front so an
        // ambiguous payload (e.g. both chain and tasks) is rejected rather than
        // silently running whichever mode is checked first.
        const hasSingle = Boolean(params.agent || params.task);
        const hasParallel = Boolean(params.tasks && params.tasks.length > 0);
        const hasChain = Boolean(params.chain && params.chain.length > 0);
        if (Number(hasSingle) + Number(hasParallel) + Number(hasChain) > 1) {
          return textResult(
            "Provide exactly one mode: { agent, task } | { tasks: [...] } | { chain: [...] }.",
          );
        }

        // chain — sequential, threading {previous} through. Validate every
        // agent up front (like parallel) so a bad name on a later step doesn't
        // discard the completed, already-paid-for output of earlier ones.
        if (params.chain && params.chain.length > 0) {
          const missing = params.chain.find((s) => !findAgent(live, s.agent));
          if (missing) return unknownAgentResult(live, missing.agent);

          const results: SubagentResult[] = [];
          let previous = "";
          // Once set, later steps are recorded as skipped rather than run — so a
          // downstream agent is never handed an empty {previous}, and the result
          // shows every step instead of silently truncating.
          let halted: string | null = null;
          for (const step of params.chain) {
            const reason = signal?.aborted ? "Aborted before start" : halted;
            if (reason) {
              results.push(skippedResult(step.agent, step.task, reason));
              continue;
            }
            const task = step.task.replaceAll("{previous}", previous);
            const result = await runSubagent(findAgent(live, step.agent)!, task, signal);
            results.push(result);
            previous = result.output;
            const failedStop = result.stopReason === "error" || result.stopReason === "aborted";
            if (result.exitCode !== 0 || result.errorMessage || failedStop) {
              halted = `Skipped: prior step "${step.agent}" did not complete successfully`;
            }
          }
          return textResult(results.map(formatResult).join("\n\n---\n\n"));
        }

        // parallel — bounded concurrency over independent tasks.
        if (params.tasks && params.tasks.length > 0) {
          if (params.tasks.length > MAX_PARALLEL_TASKS) {
            return textResult(
              `Too many parallel tasks (${params.tasks.length}). Max is ${MAX_PARALLEL_TASKS}.`,
            );
          }
          const missing = params.tasks.find((t) => !findAgent(live, t.agent));
          if (missing) return unknownAgentResult(live, missing.agent);

          const results = await mapWithConcurrency(params.tasks, MAX_CONCURRENCY, (t) =>
            runSubagent(findAgent(live, t.agent)!, t.task, signal),
          );
          return textResult(results.map(formatResult).join("\n\n---\n\n"));
        }

        // single
        if (params.agent && params.task) {
          const agent = findAgent(live, params.agent);
          if (!agent) return unknownAgentResult(live, params.agent);
          const result = await runSubagent(agent, params.task, signal);
          return textResult(formatResult(result));
        }

        const available = live.map((a) => `"${a.name}"`).join(", ") || "none";
        return textResult(
          `Provide exactly one mode: { agent, task } | { tasks: [...] } | { chain: [...] }. ` +
            `Available subagents: ${available}.`,
        );
      },
    });
  },
};

export default subagentExtension;
