// stands in for the `codex app-server` codex-acp drives: answers the handshake a session open needs,
// appends each thread/start and thread/resume request to FAKE_VENDOR_RECORD as one json line and
// refuses it, so the session never opens. What the adapter asked codex for is the whole assertion.

import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";

const recordPath = process.env.FAKE_VENDOR_RECORD;

const ANSWERS = new Map([
  ["account/read", { account: null, requiresOpenaiAuth: false }],
  ["initialize", { codexHome: process.cwd(), userAgent: "fake-codex-app-server" }],
  ["skills/list", { data: [] }],
]);
const THREAD_OPENS = new Set(["thread/resume", "thread/start"]);

const send = (message) => {
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

for await (const line of createInterface({ input: process.stdin })) {
  const message = JSON.parse(line);
  if (message.id === undefined) {
    continue;
  }
  if (THREAD_OPENS.has(message.method)) {
    if (recordPath !== undefined) {
      appendFileSync(
        recordPath,
        `${JSON.stringify({ method: message.method, params: message.params })}\n`,
      );
    }
    send({ error: { code: -32_603, message: "the fake codex opens no thread" }, id: message.id });
    continue;
  }
  send({ id: message.id, result: ANSWERS.get(message.method) ?? {} });
}
