// A scripted stand-in for `codex app-server`, speaking its newline JSON-RPC
// protocol on stdio — bb's fake-provider-process pattern. Modes (argv[2]):
//   happy    — a turn streams an agent message and completes.
//   approval — the turn additionally raises a command-execution approval
//              REQUEST mid-turn, waits for the response, and echoes the
//              decision back as a `fake/approvalResolved` notification (an
//              unknown method, so consumers observe it as provider/unhandled).
// Every turn ends with `turn/completed`; `turn/steer` echoes a
// `fake/steered` notification the same way.

import { createInterface } from "node:readline";

const mode = process.argv[2] ?? "happy";

let turnCounter = 0;
let providerThreadId = null;
let pendingApproval = null;

function send(message) {
  process.stdout.write(JSON.stringify(message) + "\n");
}

function result(id, value) {
  send({ jsonrpc: "2.0", id, result: value });
}

function notify(method, params) {
  send({ jsonrpc: "2.0", method, params });
}

function runTurn(params) {
  turnCounter += 1;
  const threadId = params.threadId;
  const turnId = `cturn_${turnCounter}`;
  const itemId = `citem_${turnCounter}`;
  const text = `Echo: ${params.input?.[0]?.text ?? ""}`;
  const midpoint = Math.ceil(text.length / 2);
  notify("turn/started", { threadId, turn: { id: turnId, status: "inProgress" } });
  notify("item/started", {
    threadId,
    turnId,
    item: { type: "agentMessage", id: itemId, text: "" },
  });
  notify("item/agentMessage/delta", { threadId, turnId, itemId, delta: text.slice(0, midpoint) });
  notify("item/agentMessage/delta", { threadId, turnId, itemId, delta: text.slice(midpoint) });
  notify("item/completed", {
    threadId,
    turnId,
    item: { type: "agentMessage", id: itemId, text },
  });
  if (mode === "approval") {
    const commandItemId = `ccmd_${turnCounter}`;
    pendingApproval = { threadId, turnId, commandItemId };
    send({
      jsonrpc: "2.0",
      id: `fake-approval-${turnCounter}`,
      method: "item/commandExecution/requestApproval",
      params: {
        threadId,
        turnId,
        itemId: commandItemId,
        reason: "The fake wants to run a command",
        command: "touch approved.md",
        cwd: null,
        availableDecisions: ["accept", "acceptForSession", "decline"],
      },
    });
    return;
  }
  notify("turn/completed", { threadId, turn: { id: turnId, status: "completed" } });
}

function finishApprovedTurn(decision) {
  const approval = pendingApproval;
  pendingApproval = null;
  if (approval === null) {
    return;
  }
  notify("fake/approvalResolved", { threadId: approval.threadId, decision });
  notify("item/completed", {
    threadId: approval.threadId,
    turnId: approval.turnId,
    item: {
      type: "commandExecution",
      id: approval.commandItemId,
      command: "touch approved.md",
      cwd: "/",
      status: decision === "decline" ? "declined" : "completed",
      aggregatedOutput: null,
      exitCode: decision === "decline" ? null : 0,
      durationMs: 5,
    },
  });
  notify("turn/completed", {
    threadId: approval.threadId,
    turn: { id: approval.turnId, status: "completed" },
  });
}

const stdin = createInterface({ input: process.stdin });
stdin.on("line", (line) => {
  let message;
  try {
    message = JSON.parse(line);
  } catch {
    return;
  }
  if (message.method === undefined && message.id !== undefined) {
    // A response to the fake's own approval request.
    finishApprovedTurn(message.result?.decision ?? "decline");
    return;
  }
  switch (message.method) {
    case "initialize":
      result(message.id, {});
      return;
    case "thread/start":
      providerThreadId = "cthr_1";
      result(message.id, { thread: { id: providerThreadId } });
      return;
    case "thread/resume":
      providerThreadId = message.params.threadId;
      result(message.id, { thread: { id: providerThreadId } });
      return;
    case "turn/start":
      result(message.id, {});
      runTurn(message.params);
      return;
    case "turn/steer":
      result(message.id, {});
      notify("fake/steered", {
        threadId: message.params.threadId,
        text: message.params.input?.[0]?.text ?? "",
      });
      return;
    case "turn/interrupt":
      result(message.id, {});
      notify("turn/completed", {
        threadId: message.params.threadId,
        turn: { id: message.params.turnId, status: "interrupted" },
      });
      return;
    case "model/list":
      result(message.id, { data: [{ id: "gpt-5.3-codex", model: "gpt-5.3-codex" }] });
      return;
    default:
      if (message.id !== undefined) {
        send({
          jsonrpc: "2.0",
          id: message.id,
          error: { code: -32601, message: `Unsupported method ${message.method}` },
        });
      }
  }
});
