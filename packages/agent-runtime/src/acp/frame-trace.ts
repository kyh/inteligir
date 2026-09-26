// a line names a frame by its method, id and session and never by its params or result: a prompt,
// a message chunk and a tool call's command all ride there. what it does carry beyond that must
// parse as a protocol word, so a field an agent filled with prose is left out rather than quoted.

import type { AnyMessage, Stream } from "@agentclientprotocol/sdk";
import { z } from "zod";

const protocolWord = z.string().regex(/^[\w.-]{1,128}$/u);

const paramsFactsSchema = z.object({
  sessionId: protocolWord.optional(),
  update: z.object({ sessionUpdate: protocolWord }).optional(),
});

const resultFactsSchema = z.object({
  outcome: z.object({ outcome: protocolWord }).optional(),
  sessionId: protocolWord.optional(),
  stopReason: protocolWord.optional(),
});

const joined = (parts: readonly (string | undefined)[]): string =>
  parts.filter((part) => part !== undefined).join(" ");

const sessionFact = (sessionId: string | undefined): string | undefined =>
  sessionId === undefined ? undefined : `session=${sessionId}`;

export const describeFrame = (message: AnyMessage): string => {
  if ("method" in message) {
    const head =
      "id" in message
        ? `request ${String(message.id)} ${message.method}`
        : `notification ${message.method}`;
    const params = paramsFactsSchema.safeParse(message.params);
    return params.success
      ? joined([head, sessionFact(params.data.sessionId), params.data.update?.sessionUpdate])
      : head;
  }
  if ("error" in message) {
    return `response ${String(message.id)} error ${message.error.code}`;
  }
  const head = `response ${String(message.id)} ok`;
  const result = resultFactsSchema.safeParse(message.result);
  return result.success
    ? joined([
        head,
        sessionFact(result.data.sessionId),
        result.data.stopReason,
        result.data.outcome?.outcome,
      ])
    : head;
};

const tap = (
  direction: "sent" | "received",
  debugLog: (line: string) => void,
): TransformStream<AnyMessage, AnyMessage> =>
  new TransformStream({
    transform(message, controller) {
      debugLog(`${direction} ${describeFrame(message)}`);
      controller.enqueue(message);
    },
  });

// installed only while the trace is on, so an untraced connection runs on the stream as built.
export const traceFrames = (stream: Stream, debugLog: (line: string) => void): Stream => {
  const outbound = tap("sent", debugLog);
  void (async () => {
    try {
      await outbound.readable.pipeTo(stream.writable);
    } catch {
      // a closed stdin is the adapter's exit, which the connection's close reports.
    }
  })();
  return {
    readable: stream.readable.pipeThrough(tap("received", debugLog)),
    writable: outbound.writable,
  };
};
