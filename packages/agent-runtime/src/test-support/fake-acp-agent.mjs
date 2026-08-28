// A scripted ACP agent for tests: speaks the real protocol over stdio through
// the official lib's AgentSideConnection, so the runtime under test exercises
// the same wire it uses in production. FAKE_ACP_MODE picks the scenario:
//
//   message      one turn: two message chunks, then end_turn
//   fileChange   one turn: an edit tool call writing FAKE_ACP_FILE (real
//                bytes, so commit attribution sees a dirty tree), completed,
//                a confirmation chunk, then end_turn
//   approval     one turn: a permission request first; allowed → chunk +
//                end_turn, denied → end_turn immediately
//   promptEcho   one turn: echoes the prompt's LEADING text block back as a
//                message chunk, so a caller can assert what it actually sent
//   silent       accepts the prompt and never settles it (watchdog food)
//
// Session ids are minted `fakeacp_<n>`; loadSession echoes the requested id
// so resume paths can assert identity survival.

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

/** @param {import("@zed-industries/agent-client-protocol").AgentSideConnection} client */
function buildAgent(client) {
  return {
    async initialize() {
      return {
        protocolVersion: PROTOCOL_VERSION,
        agentCapabilities: { loadSession: true },
      };
    },
    async newSession() {
      sessionCounter += 1;
      return { sessionId: `fakeacp_${String(sessionCounter)}` };
    },
    async loadSession(params) {
      return { sessionId: params.sessionId };
    },
    async prompt(params) {
      const sessionId = params.sessionId;
      if (mode === "silent") {
        return new Promise(() => {});
      }
      if (mode === "promptEcho") {
        const leading = params.prompt.find((block) => block.type === "text");
        await client.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: leading?.text ?? "" },
          },
        });
        return { stopReason: "end_turn" };
      }
      if (mode === "approval") {
        const outcome = await client.requestPermission({
          sessionId,
          options: [
            { optionId: "yes", kind: "allow_once", name: "Allow" },
            { optionId: "no", kind: "reject_once", name: "Deny" },
          ],
          toolCall: {
            toolCallId: "call_1",
            title: "rm -rf scratch",
            kind: "execute",
            status: "pending",
          },
        });
        if (outcome.outcome.outcome === "selected" && outcome.outcome.optionId === "yes") {
          await client.sessionUpdate({
            sessionId,
            update: {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: "approved and done" },
            },
          });
        }
        return { stopReason: "end_turn" };
      }
      if (mode === "fileChange" && filePath !== null) {
        await client.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call",
            toolCallId: "call_edit",
            title: "Edit note.md",
            kind: "edit",
            status: "in_progress",
            locations: [{ path: filePath }],
          },
        });
        writeFileSync(filePath, "fake agent wrote this\n");
        await client.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "tool_call_update",
            toolCallId: "call_edit",
            status: "completed",
          },
        });
        await client.sessionUpdate({
          sessionId,
          update: {
            sessionUpdate: "agent_message_chunk",
            content: { type: "text", text: "edited the note" },
          },
        });
        return { stopReason: "end_turn" };
      }
      await client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "hello " },
        },
      });
      await client.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "from the fake agent" },
        },
      });
      return { stopReason: "end_turn" };
    },
    async cancel() {},
  };
}

const stream = ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin));
const connection = new AgentSideConnection(buildAgent, stream);
void connection;
