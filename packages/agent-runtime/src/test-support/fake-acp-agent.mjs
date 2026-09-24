// FAKE_ACP_MODE: message | fileChange (writes FAKE_ACP_FILE) | approval | promptEcho | silent |
// slow (a command left running until session/cancel, then the cancelled stop the real ones answer) |
// authOnSessionOpen | authOnPrompt (a signed-out vendor, refusing at the step the real ones do) |
// crashOnBoot (exits before the handshake, saying why on stderr, as a missing module would).
// session ids carry the pid, so two adapters never mint the same one.

import { writeFileSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import { PROTOCOL_VERSION, RequestError, agent, ndJsonStream } from "@agentclientprotocol/sdk";

const mode = process.env.FAKE_ACP_MODE ?? "message";
const filePath = process.env.FAKE_ACP_FILE ?? null;

let sessionCounter = 0;

// a slow prompt's release by session id: session/cancel is a notification, so nothing else can
// answer the prompt it names.
const releases = new Map();

/**
 * @param {import("@agentclientprotocol/sdk").AgentContext} client The connection this fake agent
 *   pushes session updates back through.
 * @param {import("@agentclientprotocol/sdk").PromptRequest} params The prompt being answered.
 * @returns {Promise<import("@agentclientprotocol/sdk").PromptResponse>} The turn's stop reason.
 */
const prompt = async (client, params) => {
  const { sessionId } = params;
  const update = async (sessionUpdate) => {
    await client.notify("session/update", { sessionId, update: sessionUpdate });
  };
  if (mode === "authOnPrompt") {
    throw RequestError.authRequired();
  }
  if (mode === "silent") {
    // oxlint-disable-next-line promise/avoid-new -- silent mode is a turn that never settles, which no combinator expresses
    return await new Promise(() => {
      /* empty */
    });
  }
  if (mode === "slow") {
    // registered before the first update, so a cancel sent as soon as the host sees work lands.
    // oxlint-disable-next-line promise/avoid-new -- the prompt is released by a notification, which no combinator expresses
    const released = new Promise((resolve) => {
      releases.set(sessionId, resolve);
    });
    await update({
      kind: "execute",
      sessionUpdate: "tool_call",
      status: "in_progress",
      title: "sleep 600",
      toolCallId: "call_slow",
    });
    await update({
      content: { text: "working on it", type: "text" },
      sessionUpdate: "agent_message_chunk",
    });
    await released;
    return { stopReason: "cancelled" };
  }
  if (mode === "promptEcho") {
    const leading = params.prompt.find((block) => block.type === "text");
    await update({
      content: { text: leading?.text ?? "", type: "text" },
      sessionUpdate: "agent_message_chunk",
    });
    return { stopReason: "end_turn" };
  }
  if (mode === "approval") {
    const outcome = await client.request("session/request_permission", {
      options: [
        { kind: "allow_once", name: "Allow", optionId: "yes" },
        { kind: "reject_once", name: "Deny", optionId: "no" },
      ],
      sessionId,
      toolCall: {
        kind: "execute",
        status: "pending",
        title: "rm -rf scratch",
        toolCallId: "call_1",
      },
    });
    // a permission answered cancelled means the client cancelled the turn.
    if (outcome.outcome.outcome === "cancelled") {
      return { stopReason: "cancelled" };
    }
    if (outcome.outcome.outcome === "selected" && outcome.outcome.optionId === "yes") {
      await update({
        content: { text: "approved and done", type: "text" },
        sessionUpdate: "agent_message_chunk",
      });
    }
    return { stopReason: "end_turn" };
  }
  if (mode === "fileChange" && filePath !== null) {
    await update({
      kind: "edit",
      locations: [{ path: filePath }],
      sessionUpdate: "tool_call",
      status: "in_progress",
      title: "Edit note.md",
      toolCallId: "call_edit",
    });
    writeFileSync(filePath, "fake agent wrote this\n");
    await update({
      sessionUpdate: "tool_call_update",
      status: "completed",
      toolCallId: "call_edit",
    });
    await update({
      content: { text: "edited the note", type: "text" },
      sessionUpdate: "agent_message_chunk",
    });
    return { stopReason: "end_turn" };
  }
  await update({ content: { text: "hello ", type: "text" }, sessionUpdate: "agent_message_chunk" });
  await update({
    content: { text: "from the fake agent", type: "text" },
    sessionUpdate: "agent_message_chunk",
  });
  return { stopReason: "end_turn" };
};

if (mode === "crashOnBoot") {
  // exit only once the line is written: a pipe write is asynchronous here, and the host's error
  // names the crash from it.
  process.stderr.write("fake agent: cannot start\n", () => {
    process.exit(3);
  });
} else {
  agent({ name: "fake-acp-agent" })
    .onRequest("initialize", () => ({
      agentCapabilities: { loadSession: true },
      protocolVersion: PROTOCOL_VERSION,
    }))
    .onRequest("session/new", () => {
      if (mode === "authOnSessionOpen") {
        throw RequestError.authRequired();
      }
      sessionCounter += 1;
      return { sessionId: `fakeacp_${String(process.pid)}_${String(sessionCounter)}` };
    })
    .onRequest("session/load", () => {
      if (mode === "authOnSessionOpen") {
        throw RequestError.authRequired();
      }
      return {};
    })
    .onRequest("session/prompt", async ({ client, params }) => await prompt(client, params))
    .onNotification("session/cancel", ({ params }) => {
      releases.get(params.sessionId)?.();
      releases.delete(params.sessionId);
    })
    .connect(ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)));
}
