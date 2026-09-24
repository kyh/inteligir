import { spawn } from "node:child_process";
import path from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import type { ProviderEvent } from "../../vocabulary/provider-event";
import { createAcpAgentRuntime } from "../acp-runtime";
import { describeFrame } from "../frame-trace";

const FAKE_AGENT = path.join(import.meta.dirname, "..", "..", "test-support", "fake-acp-agent.mjs");
const PROMPT_SECRET = "the note body the user asked about";
const HEADER_SECRET = "Bearer connector-secret-token";
// a slow runner's round trip through a node child, not a claim about speed.
const TURN_TIMEOUT_MS = 10_000;

describe("describeFrame", () => {
  it("names a frame by method, id and session, and keeps only protocol words from its body", () => {
    expect(
      describeFrame({
        id: 3,
        jsonrpc: "2.0",
        method: "session/prompt",
        params: { prompt: [{ text: PROMPT_SECRET, type: "text" }], sessionId: "sess_1" },
      }),
    ).toBe("request 3 session/prompt session=sess_1");
    expect(
      describeFrame({
        jsonrpc: "2.0",
        method: "session/update",
        params: {
          sessionId: "sess_1",
          update: {
            content: { text: PROMPT_SECRET, type: "text" },
            sessionUpdate: "agent_message_chunk",
          },
        },
      }),
    ).toBe("notification session/update session=sess_1 agent_message_chunk");
    expect(describeFrame({ id: 3, jsonrpc: "2.0", result: { stopReason: "end_turn" } })).toBe(
      "response 3 ok end_turn",
    );
    expect(
      describeFrame({ error: { code: -32_603, message: PROMPT_SECRET }, id: 4, jsonrpc: "2.0" }),
    ).toBe("response 4 error -32603");
  });

  it("leaves out a field an agent filled with prose rather than quote it", () => {
    expect(
      describeFrame({
        id: 5,
        jsonrpc: "2.0",
        method: "session/request_permission",
        params: { sessionId: PROMPT_SECRET, toolCall: { title: "rm -rf notes" } },
      }),
    ).toBe("request 5 session/request_permission");
  });
});

describe("the ACP runtime's frame trace", { timeout: 20_000 }, () => {
  it("names every frame both ways, and no prompt, reply or connector header", async () => {
    const lines: string[] = [];
    const events: ProviderEvent[] = [];
    const runtime = createAcpAgentRuntime({
      debugLog: (line) => {
        lines.push(line);
      },
      mcpServers: () => [
        {
          headers: { authorization: HEADER_SECRET },
          kind: "http",
          name: "notes",
          url: "https://mcp.test/notes",
        },
      ],
      onEvent: (event) => {
        events.push(event);
      },
      spawnAdapter: (_harness, env) => ({
        child: spawn(process.execPath, [FAKE_AGENT], {
          env: { ...env, FAKE_ACP_MODE: "promptEcho" },
          stdio: ["pipe", "pipe", "pipe"],
        }),
      }),
      workspacePath: process.cwd(),
    });
    onTestFinished(async () => {
      await runtime.shutdown();
    });

    await runtime.startThread({ providerId: "claude", threadId: "thr_trace" });
    await runtime.runTurn({
      input: [{ text: PROMPT_SECRET, type: "text" }],
      threadId: "thr_trace",
    });
    await vi.waitFor(
      () => {
        expect(events.some((event) => event.type === "turn/completed")).toBe(true);
      },
      { timeout: TURN_TIMEOUT_MS },
    );

    const methods = lines.map((line) => line.replace(/ session=\S+/u, ""));
    expect(methods).toEqual([
      "thread thr_trace sent request 0 initialize",
      "thread thr_trace received response 0 ok",
      "thread thr_trace sent request 1 session/new",
      "thread thr_trace received response 1 ok",
      "thread thr_trace sent request 2 session/prompt",
      "thread thr_trace received notification session/update agent_message_chunk",
      "thread thr_trace received response 2 ok end_turn",
    ]);
    const trace = lines.join("\n");
    expect(trace).not.toContain(PROMPT_SECRET);
    expect(trace).not.toContain(HEADER_SECRET);
  });
});
