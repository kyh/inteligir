// ---------------------------------------------------------------------------
// BLOCKABLE-CONTRACT GUARD — the whole privacy model rests on this.
//
// privacy/extension.ts refuses a tool call by returning `{ block: true }`
// from pi's `tool_call` hook (and by THROWING when a probe or a checkpoint
// capture fails). That only keeps private notes away from the model while pi
// still honours both: a `block` that stopped preventing execution, or a throw
// that got swallowed into "allow", would silently turn the gate into a
// no-op — the code would look identical and every unit test over the pure
// decision core would still pass.
//
// So this drives the INSTALLED pi's own machinery, not a description of it:
//   - pi-coding-agent's ExtensionRunner.emitToolCall — the dispatcher that
//     returns the first blocking result and (unlike its user_bash sibling)
//     does NOT catch handler throws;
//   - pi-agent-core's agent loop — the layer that turns a block into an error
//     tool result and skips tool.execute entirely.
// The CONTROL case (same fixture, no hook) executes the tool, so a broken
// fixture fails loudly instead of passing the block cases for free.
//
// Between them sits agent-session's `beforeToolCall` installer, which only
// rethrows; instantiating a whole AgentSession to prove three lines is not
// worth it, so its rethrow is pinned as a source tripwire below.
//
// pi's internals are not public exports, so they are reached by file path
// (as pi-path-parity.test.ts does). If a locator throws, that IS the signal:
// pi moved the module — re-verify the contract by hand before touching it.
// ---------------------------------------------------------------------------

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { buildToolCallHandler } from "../privacy/extension";
import type { PrivacyPort, PrivacyProbe } from "../extension";

// @repo/agent declares the dependency, so pnpm links pi under this package's
// own node_modules; pi-agent-core is pi's own dependency and therefore a
// sibling of pi's REAL package dir under the same scope directory.
const PI_PKG = fileURLToPath(
  new URL("../../node_modules/@earendil-works/pi-coding-agent", import.meta.url),
);

function piFile(...segments: string[]): string {
  const file = path.join(PI_PKG, "dist", ...segments);
  if (!fs.existsSync(file)) {
    throw new Error(
      `pi's dist/${segments.join("/")} not found at ${file} — pi moved it; re-verify the ` +
        `tool_call blockable contract by hand before updating this locator.`,
    );
  }
  return file;
}

function piAgentCoreFile(...segments: string[]): string {
  const file = path.join(fs.realpathSync(PI_PKG), "..", "pi-agent-core", "dist", ...segments);
  if (!fs.existsSync(file)) {
    throw new Error(
      `pi-agent-core's dist/${segments.join("/")} not found at ${file} — the install layout ` +
        `or the package changed; re-verify the tool_call blockable contract by hand.`,
    );
  }
  return file;
}

// ---- Boundary types for the untyped deep imports -------------------------------

type ToolCallHookEvent = {
  type: "tool_call";
  toolName: string;
  toolCallId: string;
  input: Record<string, unknown>;
};
type ToolCallHookResult = { block?: boolean; reason?: string };
type ToolCallHook = (event: ToolCallHookEvent) => ToolCallHookResult | undefined;

/** The subset of pi's ExtensionRunner this drives. `extensions` is pi's loaded
 * -extension record shape: a handler map keyed by event name. */
type ExtensionRunnerCtor = new (
  extensions: { path: string; handlers: Map<string, ToolCallHook[]> }[],
  runtime: unknown,
  cwd: string,
  sessionManager: unknown,
  modelRegistry: unknown,
) => { emitToolCall(event: ToolCallHookEvent): Promise<ToolCallHookResult | undefined> };

type LoopToolResult = { content: { type: string; text?: string }[] };
type LoopTool = {
  name: string;
  label: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (id: string, args: Record<string, unknown>) => Promise<LoopToolResult>;
};
type LoopMessage = {
  role: string;
  content: unknown;
  toolName?: string;
  isError?: boolean;
};
type BeforeToolCall = (args: {
  toolCall: { id: string; name: string; arguments: Record<string, unknown> };
  args: Record<string, unknown>;
}) => Promise<ToolCallHookResult | undefined>;
type RunAgentLoop = (
  prompts: LoopMessage[],
  context: { systemPrompt: string; tools: LoopTool[]; messages: LoopMessage[] },
  config: Record<string, unknown>,
  emit: (event: unknown) => void,
  signal: AbortSignal | undefined,
  streamFn: () => unknown,
) => Promise<LoopMessage[]>;

/** Parse-at-boundary for a deep import: demand the named export EXISTS and is
 * callable. The structural shape above is unverifiable at runtime — every
 * assertion in this file is what actually exercises it. */
function pickCallable<T>(mod: unknown, name: string, isT: (value: unknown) => value is T): T {
  if (typeof mod !== "object" || mod === null) {
    throw new Error(`pi module did not load — re-verify the tool_call blockable contract`);
  }
  const value: unknown = Reflect.get(mod, name);
  if (!isT(value)) {
    throw new Error(
      `pi no longer exports a callable ${name}() — re-verify the tool_call blockable ` +
        `contract by hand before updating this test`,
    );
  }
  return value;
}

function isRunnerCtor(value: unknown): value is ExtensionRunnerCtor {
  return typeof value === "function";
}

function isRunAgentLoop(value: unknown): value is RunAgentLoop {
  return typeof value === "function";
}

async function loadModule(file: string): Promise<unknown> {
  return await import(/* @vite-ignore */ pathToFileURL(file).href);
}

// ---- The privacy world under test ----------------------------------------------

/** Content that must never reach the model when the note is private. */
const SECRET_BODY = "TOP SECRET: the launch codes";

let vaultRoot: string;
let secretPath: string;
let ExtensionRunner: ExtensionRunnerCtor;
let runAgentLoop: RunAgentLoop;

function privacyPort(overrides?: Partial<PrivacyPort>): PrivacyPort {
  return {
    probe: (rel): PrivacyProbe => (rel === "secret.md" ? "private" : "public"),
    vaultRealRoot: () => vaultRoot,
    vaultLexicalRoot: () => vaultRoot,
    privateIndexPaths: () => ["secret.md"],
    ...overrides,
  };
}

/** pi's loaded-extension record, carrying the REAL privacy handler. */
function privacyExtensions(
  port: PrivacyPort,
): { path: string; handlers: Map<string, ToolCallHook[]> }[] {
  return [
    {
      path: "privacy",
      handlers: new Map([["tool_call", [buildToolCallHandler(port, null)]]]),
    },
  ];
}

function newRunner(port: PrivacyPort): InstanceType<ExtensionRunnerCtor> {
  return new ExtensionRunner(privacyExtensions(port), {}, vaultRoot, {}, {});
}

function readEvent(): ToolCallHookEvent {
  return {
    type: "tool_call",
    toolName: "read",
    toolCallId: "call-1",
    input: { path: secretPath },
  };
}

beforeAll(async () => {
  ExtensionRunner = pickCallable(
    await loadModule(piFile("core", "extensions", "runner.js")),
    "ExtensionRunner",
    isRunnerCtor,
  );
  runAgentLoop = pickCallable(
    await loadModule(piAgentCoreFile("agent-loop.js")),
    "runAgentLoop",
    isRunAgentLoop,
  );

  vaultRoot = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "pi-tool-call-contract-")));
  secretPath = path.join(vaultRoot, "secret.md");
  fs.writeFileSync(secretPath, `---\nprivate: true\n---\n\n${SECRET_BODY}\n`);
});

afterAll(() => {
  fs.rmSync(vaultRoot, { recursive: true, force: true });
});

// ---- Layer 1: pi's extension dispatcher ----------------------------------------

describe("pi tool_call dispatch (ExtensionRunner)", () => {
  it("returns the gate's block result for a private note", async () => {
    const result = await newRunner(privacyPort()).emitToolCall(readEvent());
    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("private");
    expect(JSON.stringify(result)).not.toContain(SECRET_BODY);
  });

  it("allows a public note (the dispatcher is not blocking everything)", async () => {
    const event = { ...readEvent(), input: { path: path.join(vaultRoot, "public.md") } };
    expect(await newRunner(privacyPort()).emitToolCall(event)).toBeUndefined();
  });

  it("propagates a throwing handler instead of swallowing it into an allow", async () => {
    // FAIL-CLOSED by construction: the gate deliberately does not try/catch,
    // because a probe (or a checkpoint capture) that blows up must stop the
    // call. emitToolCall must therefore reject — unlike emitUserBash, which
    // catches handler errors and continues.
    const exploding = privacyPort({
      probe: () => {
        throw new Error("probe exploded");
      },
    });
    await expect(newRunner(exploding).emitToolCall(readEvent())).rejects.toThrow("probe exploded");
  });
});

// ---- Layer 2: agent-session's installer ----------------------------------------

describe("pi agent-session tool hook installer", () => {
  it("rethrows out of beforeToolCall rather than returning undefined", () => {
    // Source tripwire, not a behavioural test: a whole AgentSession is far too
    // much fixture for three lines. If pi ever catches here and returns, a
    // throwing gate handler becomes an ALLOW — so a bump that reshapes this
    // must be re-verified by hand, and failing here is how that happens.
    const source = fs.readFileSync(piFile("core", "agent-session.js"), "utf8");
    const start = source.indexOf("this.agent.beforeToolCall");
    const end = source.indexOf("this.agent.afterToolCall", start);
    expect(start, "pi no longer installs beforeToolCall in agent-session.js").toBeGreaterThan(-1);
    expect(end, "pi no longer installs afterToolCall in agent-session.js").toBeGreaterThan(start);
    const installer = source.slice(start, end);
    expect(installer).toContain("emitToolCall");
    for (const clause of installer.split("catch").slice(1)) {
      expect(clause, "pi's beforeToolCall installer swallows a handler throw").toContain("throw");
    }
  });
});

// ---- Layer 3: the agent loop honours the block ----------------------------------

type LoopOutcome = { executed: boolean; results: LoopMessage[] };

/** What agent-session installs as `beforeToolCall`: forward the call to the
 * extension runner, verbatim, letting a throw through. */
function sessionHook(runner: InstanceType<ExtensionRunnerCtor>): BeforeToolCall {
  return (event) =>
    runner.emitToolCall({
      type: "tool_call",
      toolName: event.toolCall.name,
      toolCallId: event.toolCall.id,
      input: event.args,
    });
}

/** Drive ONE real pi turn whose scripted assistant message calls `read` on the
 * private note, with the given pre-execution hook. */
async function runOneToolTurn(beforeToolCall: BeforeToolCall | undefined): Promise<LoopOutcome> {
  let executed = false;
  const tool: LoopTool = {
    name: "read",
    label: "Read",
    description: "Read a file",
    parameters: {
      type: "object",
      properties: { path: { type: "string" } },
      required: ["path"],
      additionalProperties: false,
    },
    execute: async () => {
      executed = true;
      return { content: [{ type: "text", text: SECRET_BODY }] };
    },
  };
  const assistant = {
    role: "assistant",
    api: "test",
    provider: "test",
    model: "test",
    stopReason: "toolUse",
    content: [{ type: "toolCall", id: "call-1", name: "read", arguments: { path: secretPath } }],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: {} },
  };
  const messages: LoopMessage[] = [];
  const returned = await runAgentLoop(
    [{ role: "user", content: "read the note" }],
    { systemPrompt: "", tools: [tool], messages },
    {
      model: { id: "test", provider: "test", api: "test" },
      convertToLlm: (input: LoopMessage[]) => input,
      shouldStopAfterTurn: () => true,
      ...(beforeToolCall ? { beforeToolCall } : {}),
    },
    () => {},
    undefined,
    () => ({
      [Symbol.asyncIterator]: async function* () {},
      result: () => assistant,
    }),
  );
  return { executed, results: returned.filter((message) => message.role === "toolResult") };
}

function resultText(message: LoopMessage | undefined): string {
  return JSON.stringify(message?.content ?? null);
}

describe("pi agent loop honours the tool_call verdict", () => {
  it("CONTROL: with no hook the tool executes and its output reaches the model", async () => {
    const outcome = await runOneToolTurn(undefined);
    expect(outcome.executed).toBe(true);
    expect(outcome.results).toHaveLength(1);
    expect(resultText(outcome.results[0])).toContain(SECRET_BODY);
  });

  it("a blocked call never executes, and the model gets the reason as an error", async () => {
    const outcome = await runOneToolTurn(sessionHook(newRunner(privacyPort())));
    expect(outcome.executed).toBe(false);
    expect(outcome.results).toHaveLength(1);
    expect(outcome.results[0]?.isError).toBe(true);
    expect(resultText(outcome.results[0])).toContain("private");
    expect(resultText(outcome.results[0])).not.toContain(SECRET_BODY);
  });

  it("a throwing hook never executes the tool either (fail closed)", async () => {
    const exploding = privacyPort({
      probe: () => {
        throw new Error("probe exploded");
      },
    });
    const outcome = await runOneToolTurn(sessionHook(newRunner(exploding)));
    expect(outcome.executed).toBe(false);
    expect(outcome.results[0]?.isError).toBe(true);
    expect(resultText(outcome.results[0])).not.toContain(SECRET_BODY);
  });
});
