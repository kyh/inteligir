// records what the pinned adapters really send, one live turn per scenario, through the runtime
// itself, so the replay suite pins AcpTurnMapper to the wire rather than to a fake's beliefs. needs
// both vendors signed in; spends real model calls, except a staged scenario's. `pnpm --filter
// @repo/agent-runtime record:transcripts [claude|codex] [scenario…]` rewrites
// src/acp/__tests__/fixtures/<adapter>@<version>/, or only the named scenarios' files.

import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
import { z } from "zod";
import { createAcpAgentRuntime } from "../src/acp/acp-runtime.js";
import { HARNESS_IDS, isHarnessId, requireHarness } from "../src/acp/harness-registry.js";
import type { HarnessDefinition, HarnessId } from "../src/acp/harness-registry.js";

const FIXTURES_DIR = path.resolve(import.meta.dirname, "..", "src", "acp", "__tests__", "fixtures");
const TURN_TIMEOUT_MS = 5 * 60_000;

// the scrubbed spellings every fixture uses, so a re-record diffs only where the wire moved.
const VAULT = "/vault";
const HOME = "/home/user";
const SESSION = "session_recorded";

// one server-sent event of the Responses API, as far as a staged failure needs it.
interface ResponsesEvent {
  type: string;
  response: { id: string; error?: { code: string; message: string } };
}

// what a local model endpoint streams in answer to every request, in place of the vendor's own,
// for a failure no prompt causes on demand. codex alone can be pointed at one with no sign-in (a
// model provider in a scratch CODEX_HOME, which also keeps the run out of ~/.codex); the adapter
// and the vendor binary are still the pinned ones, so the frames are still theirs.
interface StagedUpstream {
  harness: "codex";
  events: readonly ResponsesEvent[];
}

interface Scenario {
  name: string;
  prompt: string;
  seed?: Record<string, string>;
  staged?: StagedUpstream;
}

const SCENARIOS: readonly Scenario[] = [
  {
    name: "reply",
    prompt: "Reply with exactly the word pong and nothing else. Do not use any tools.",
  },
  {
    name: "plan",
    prompt:
      "Think it through first. Then record a two-item todo list with your todo or plan tool (TodoWrite, TaskCreate or update_plan, whichever you have): 1) read note.md, 2) summarize it in one sentence. Do both items, marking each complete as you finish it.",
    seed: { "note.md": "# Draft\n\nThe launch moves to Thursday.\n" },
  },
  {
    name: "edit",
    prompt:
      "Create a new file hello.md whose only line is `hello`. Then edit the existing file note.md so the word draft becomes final. Use your file tools, not the shell.",
    seed: { "note.md": "# Notes\n\nThis is a draft.\n" },
  },
  {
    name: "command",
    prompt: "Run the shell command `ls` once and tell me how many entries it printed.",
    seed: { "a.md": "a\n", "b.md": "b\n" },
  },
  {
    name: "failed-command",
    prompt:
      "Run the shell command `cat missing-file.md` exactly once, do not retry or try anything else, and tell me what happened.",
  },
  {
    name: "context-overflow",
    prompt: "Reply with exactly the word pong and nothing else. Do not use any tools.",
    // what the API streams for an input past the model's context window, which codex reads as
    // contextWindowExceeded.
    staged: {
      events: [
        { response: { id: "resp_staged" }, type: "response.created" },
        {
          response: {
            error: {
              code: "context_length_exceeded",
              message:
                "Your input exceeds the context window of this model. Please adjust your input and try again.",
            },
            id: "resp_staged",
          },
          type: "response.failed",
        },
      ],
      harness: "codex",
    },
  },
];

const runsOn = (scenario: Scenario, harnessId: HarnessId): boolean =>
  scenario.staged === undefined || scenario.staged.harness === harnessId;

const packageJsonSchema = z.object({ name: z.string(), version: z.string() });

// the adapter's own package.json, found by walking up from its entry: a bump names its own folder.
const adapterLabel = (harness: HarnessDefinition): string => {
  let dir = path.dirname(harness.adapterEntry);
  while (dir !== path.dirname(dir)) {
    try {
      const pkg = packageJsonSchema.parse(
        JSON.parse(readFileSync(path.join(dir, "package.json"), "utf-8")),
      );
      return `${pkg.name.replace(/^@[^/]+\//u, "")}@${pkg.version}`;
    } catch {
      dir = path.dirname(dir);
    }
  }
  throw new Error(`no package.json above ${harness.adapterEntry}`);
};

const promptResponseSchema = z.object({ result: z.object({ stopReason: z.string() }) });

// an extension notification (`_auth/status_update`) names the signed-in account, and no handler
// reads one, so it is not kept.
const extensionFrameSchema = z.object({ method: z.string().startsWith("_") });

// the vendor's own slash commands and the user's installed skills: personal, long, and unread.
const commandsFrameSchema = z.looseObject({
  params: z.looseObject({
    update: z.looseObject({ sessionUpdate: z.literal("available_commands_update") }),
  }),
});

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/gu;

const scrub = (line: string, dir: string, sessionId: string): string | null => {
  const frame: unknown = JSON.parse(line);
  if (extensionFrameSchema.safeParse(frame).success) {
    return null;
  }
  const commands = commandsFrameSchema.safeParse(frame);
  const kept = commands.success
    ? JSON.stringify({
        ...commands.data,
        params: {
          ...commands.data.params,
          update: { ...commands.data.params.update, availableCommands: [] },
        },
      })
    : line;
  return kept
    .replaceAll(realpathSync(dir), VAULT)
    .replaceAll(dir, VAULT)
    .replaceAll(path.basename(dir), path.basename(VAULT))
    .replaceAll(homedir(), HOME)
    .replaceAll(sessionId, SESSION)
    .replaceAll(EMAIL, "user@example.com");
};

const listeningAddressSchema = z.object({ port: z.number() });

interface Staged {
  codexHome: string;
  close: () => Promise<void>;
}

const stageUpstream = async (upstream: StagedUpstream): Promise<Staged> => {
  const server = createServer((request, response) => {
    request.resume();
    if (request.method !== "POST" || request.url?.endsWith("/responses") !== true) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, { "content-type": "text/event-stream" });
    for (const event of upstream.events) {
      response.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
    }
    response.end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = listeningAddressSchema.parse(server.address());
  const codexHome = mkdtempSync(path.join(tmpdir(), "acp-transcript-codex-home-"));
  writeFileSync(
    path.join(codexHome, "config.toml"),
    [
      'model_provider = "staged"',
      "[model_providers.staged]",
      'name = "staged"',
      `base_url = "http://127.0.0.1:${String(port)}/v1"`,
      'wire_api = "responses"',
      "",
    ].join("\n"),
  );
  return {
    close: async () => {
      server.closeAllConnections();
      server.close();
      await once(server, "close");
      rmSync(codexHome, { force: true, recursive: true });
    },
    codexHome,
  };
};

const record = async (harnessId: HarnessId, scenario: Scenario): Promise<string[]> => {
  const dir = mkdtempSync(path.join(tmpdir(), "acp-transcript-"));
  const staged = scenario.staged === undefined ? null : await stageUpstream(scenario.staged);
  for (const [name, content] of Object.entries(scenario.seed ?? {})) {
    writeFileSync(path.join(dir, name), content);
  }
  const frames: string[] = [];
  const stderr: string[] = [];
  let recording = false;
  const turn = new EventTarget();
  const answered = once(turn, "answered", { signal: AbortSignal.timeout(TURN_TIMEOUT_MS) });
  const runtime = createAcpAgentRuntime({
    onEvent: () => {
      /* the replay suite maps the frames; this run only records them */
    },
    onInteractiveRequest: async () => await Promise.resolve({ decision: "allow_once" }),
    onStderr: (line) => {
      stderr.push(line);
    },
    spawnAdapter: (spawned, env) => {
      const child = spawn(process.execPath, [spawned.adapterEntry], {
        cwd: dir,
        env: staged === null ? env : { ...env, CODEX_HOME: staged.codexHome },
        stdio: ["pipe", "pipe", "pipe"],
      });
      let partial = "";
      child.stdout.on("data", (chunk: Buffer) => {
        const lines = (partial + chunk.toString("utf-8")).split("\n");
        partial = lines.pop() ?? "";
        for (const line of lines.filter((candidate) => candidate.trim() !== "")) {
          if (!recording) {
            continue;
          }
          frames.push(line);
          if (promptResponseSchema.safeParse(JSON.parse(line)).success) {
            turn.dispatchEvent(new Event("answered"));
          }
        }
      });
      return { child };
    },
    workspacePath: dir,
  });
  const threadId = `record_${harnessId}_${scenario.name}`;
  try {
    const { providerThreadId } = await runtime.startThread({ providerId: harnessId, threadId });
    recording = true;
    await runtime.runTurn({ input: [{ text: scenario.prompt, type: "text" }], threadId });
    await answered;
    return frames.flatMap((line) => scrub(line, dir, providerThreadId) ?? []);
  } catch (error) {
    process.stderr.write(`${stderr.join("\n")}\n`);
    throw error;
  } finally {
    await runtime.shutdown();
    await staged?.close();
    rmSync(dir, { force: true, recursive: true });
  }
};

const requested = process.argv.slice(2);
const scenarioNames = new Set(SCENARIOS.map((scenario) => scenario.name));
const unknown = requested.filter((arg) => !isHarnessId(arg) && !scenarioNames.has(arg));
if (unknown.length > 0) {
  throw new Error(
    `Unknown harness or scenario ${unknown.join(", ")}; harnesses: ${HARNESS_IDS.join(", ")}; scenarios: ${[...scenarioNames].join(", ")}`,
  );
}
const named = requested.filter((arg) => scenarioNames.has(arg));
const harnessIds = requested.some(isHarnessId) ? requested.filter(isHarnessId) : HARNESS_IDS;

for (const harnessId of harnessIds) {
  const label = adapterLabel(requireHarness(harnessId));
  // a whole recording replaces the old version's, which would otherwise still be replayed; a named
  // scenario rewrites its own file alone.
  if (named.length === 0) {
    const adapterName = label.slice(0, label.lastIndexOf("@") + 1);
    for (const stale of readdirSync(FIXTURES_DIR).filter((entry) =>
      entry.startsWith(adapterName),
    )) {
      rmSync(path.join(FIXTURES_DIR, stale), { force: true, recursive: true });
    }
  }
  const outDir = path.join(FIXTURES_DIR, label);
  mkdirSync(outDir, { recursive: true });
  const scenarios = SCENARIOS.filter(
    (scenario) =>
      runsOn(scenario, harnessId) && (named.length === 0 || named.includes(scenario.name)),
  );
  for (const scenario of scenarios) {
    process.stdout.write(`${harnessId}: ${scenario.name}… `);
    const frames = await record(harnessId, scenario);
    writeFileSync(path.join(outDir, `${scenario.name}.ndjson`), `${frames.join("\n")}\n`);
    process.stdout.write(`${String(frames.length)} frames\n`);
  }
}
