// FAKE_ACP_MODE: message | fileChange (writes FAKE_ACP_FILE) | approval | promptEcho | silent.
// session ids carry the pid: the runtime routes frames by provider session id across adapters.

import { writeFileSync } from "node:fs";
import { Readable, Writable } from "node:stream";
import {
  AgentSideConnection,
  PROTOCOL_VERSION,
  ndJsonStream,
} from "@zed-industries/agent-client-protocol";

const mode = process.env.FAKE_ACP_MODE ?? "message";
const filePath = process.env.FAKE_ACP_FILE ?? null;

let sessionCounter = 0;

/**
 * @param {import("@zed-industries/agent-client-protocol").AgentSideConnection} client The
 *   connection this fake agent pushes session updates back through.
 */
const buildAgent = (client) => ({
  cancel() {
    /* empty */
  },
  initialize() {
    return {
      agentCapabilities: { loadSession: true },
      protocolVersion: PROTOCOL_VERSION,
    };
  },
  loadSession(params) {
    return { sessionId: params.sessionId };
  },
  newSession() {
    sessionCounter += 1;
    return { sessionId: `fakeacp_${String(process.pid)}_${String(sessionCounter)}` };
  },
  async prompt(params) {
    const { sessionId } = params;
    if (mode === "silent") {
      // oxlint-disable-next-line promise/avoid-new -- silent mode is a turn that never settles, which no combinator expresses
      return await new Promise(() => {
        /* empty */
      });
    }
    if (mode === "promptEcho") {
      const leading = params.prompt.find((block) => block.type === "text");
      await client.sessionUpdate({
        sessionId,
        update: {
          content: { text: leading?.text ?? "", type: "text" },
          sessionUpdate: "agent_message_chunk",
        },
      });
      return { stopReason: "end_turn" };
    }
    if (mode === "approval") {
      const outcome = await client.requestPermission({
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
      if (outcome.outcome.outcome === "selected" && outcome.outcome.optionId === "yes") {
        await client.sessionUpdate({
          sessionId,
          update: {
            content: { text: "approved and done", type: "text" },
            sessionUpdate: "agent_message_chunk",
          },
        });
      }
      return { stopReason: "end_turn" };
    }
    if (mode === "fileChange" && filePath !== null) {
      await client.sessionUpdate({
        sessionId,
        update: {
          kind: "edit",
          locations: [{ path: filePath }],
          sessionUpdate: "tool_call",
          status: "in_progress",
          title: "Edit note.md",
          toolCallId: "call_edit",
        },
      });
      writeFileSync(filePath, "fake agent wrote this\n");
      await client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "tool_call_update",
          status: "completed",
          toolCallId: "call_edit",
        },
      });
      await client.sessionUpdate({
        sessionId,
        update: {
          content: { text: "edited the note", type: "text" },
          sessionUpdate: "agent_message_chunk",
        },
      });
      return { stopReason: "end_turn" };
    }
    await client.sessionUpdate({
      sessionId,
      update: {
        content: { text: "hello ", type: "text" },
        sessionUpdate: "agent_message_chunk",
      },
    });
    await client.sessionUpdate({
      sessionId,
      update: {
        content: { text: "from the fake agent", type: "text" },
        sessionUpdate: "agent_message_chunk",
      },
    });
    return { stopReason: "end_turn" };
  },
});

const stream = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
const connection = new AgentSideConnection(buildAgent, stream);
void connection;
