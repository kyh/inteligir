// a row over the cap never reaches another device, and the item it carries stays pending there
// forever. the clip cuts payload text alone — never a type, an id, a status or a scope — so a
// peer's fold settles every row the same way and only the cut text reads short. the local row
// keeps every byte: this runs on the outbox's copy.

import type { ThreadEvent, ThreadEventItem } from "@repo/domain/provider-event";
import { z } from "zod";
import { utf8ByteLength } from "../bytes";

const QUOTE_BYTES = 2;

interface PayloadText {
  text: string;
  // what the value costs inside the event's json now, quotes included.
  bytes: number;
  set: (clipped: string) => void;
}

// a tool's result and arguments are free-form json: one that is not text is cut as its
// serialization, so a structure too wide to fit still has a text to cut.
const payloadText = <V>(value: V, set: (clipped: string) => void): PayloadText => {
  const json = JSON.stringify(value);
  const text = z.string().safeParse(value);
  return { bytes: utf8ByteLength(json), set, text: text.success ? text.data : json };
};

const serializedBytes = (text: string): number =>
  utf8ByteLength(JSON.stringify(text)) - QUOTE_BYTES;

// a slice of `budget` code units bounds the walk, since none serializes to under a byte. a pair the
// slice splits leaves a lone half at its far end, whose six-byte escape never fits, so a cut never
// lands inside a character.
const fittingPrefix = (text: string, budget: number): string => {
  let bytes = 0;
  let end = 0;
  for (const char of text.slice(0, budget)) {
    bytes += serializedBytes(char);
    if (bytes > budget) {
      break;
    }
    end += char.length;
  }
  return text.slice(0, end);
};

const fittingSuffix = (text: string, budget: number): string => {
  if (budget <= 0) {
    return "";
  }
  const lastUnits = text.slice(-budget);
  let bytes = 0;
  let start = text.length;
  for (const char of [...lastUnits].toReversed()) {
    bytes += serializedBytes(char);
    if (bytes > budget) {
      break;
    }
    start -= char.length;
  }
  return text.slice(start);
};

const elisionMarker = (elidedBytes: number): string => `[… ${elidedBytes} bytes elided …]`;

// the middle goes: a command's first lines say what ran and its last say how it ended.
const elideMiddle = (text: string, budget: number): string => {
  const head = fittingPrefix(text, Math.ceil(budget / 2));
  const tail = fittingSuffix(text.slice(head.length), budget - serializedBytes(head));
  const elided = utf8ByteLength(text) - utf8ByteLength(head) - utf8ByteLength(tail);
  return `${head}${elisionMarker(elided)}${tail}`;
};

const partTexts = (parts: string[]): PayloadText[] =>
  parts.map((part, index) =>
    payloadText(part, (clipped) => {
      parts[index] = clipped;
    }),
  );

const itemPayload = (item: ThreadEventItem): PayloadText[] => {
  switch (item.type) {
    case "userMessage":
    case "agentMessage":
    case "plan": {
      return [
        payloadText(item.text, (clipped) => {
          item.text = clipped;
        }),
      ];
    }
    case "reasoning": {
      return [...partTexts(item.content), ...partTexts(item.summary)];
    }
    case "toolCall": {
      const texts: PayloadText[] = [];
      if (item.error !== undefined) {
        texts.push(
          payloadText(item.error, (clipped) => {
            item.error = clipped;
          }),
        );
      }
      if (item.result !== undefined) {
        texts.push(
          payloadText(item.result, (clipped) => {
            item.result = clipped;
          }),
        );
      }
      const args = item.arguments ?? {};
      for (const [key, value] of Object.entries(args)) {
        if (value !== undefined) {
          texts.push(
            payloadText(value, (clipped) => {
              args[key] = clipped;
            }),
          );
        }
      }
      return texts;
    }
    case "commandExecution": {
      const command = payloadText(item.command, (clipped) => {
        item.command = clipped;
      });
      if (item.aggregatedOutput === undefined) {
        return [command];
      }
      return [
        command,
        payloadText(item.aggregatedOutput, (clipped) => {
          item.aggregatedOutput = clipped;
        }),
      ];
    }
    case "fileChange": {
      return item.changes.flatMap((change) =>
        change.diff === undefined
          ? []
          : [
              payloadText(change.diff, (clipped) => {
                change.diff = clipped;
              }),
            ],
      );
    }
    // no default
  }
};

const eventPayload = (event: ThreadEvent): PayloadText[] => {
  switch (event.type) {
    case "client/turn/requested": {
      return [
        payloadText(event.text, (clipped) => {
          event.text = clipped;
        }),
      ];
    }
    case "item/started":
    case "item/completed": {
      return itemPayload(event.item);
    }
    case "item/agentMessage/delta":
    case "item/commandExecution/outputDelta":
    case "item/plan/delta":
    case "item/reasoning/summaryTextDelta":
    case "item/reasoning/textDelta": {
      return [
        payloadText(event.delta, (clipped) => {
          event.delta = clipped;
        }),
      ];
    }
    case "provider/error": {
      const message = payloadText(event.message, (clipped) => {
        event.message = clipped;
      });
      if (event.detail === undefined) {
        return [message];
      }
      return [
        message,
        payloadText(event.detail, (clipped) => {
          event.detail = clipped;
        }),
      ];
    }
    case "turn/completed": {
      const { error } = event;
      if (error === undefined) {
        return [];
      }
      return [
        payloadText(error.message, (clipped) => {
          error.message = clipped;
        }),
      ];
    }
    // a thread's facts are names, not payload: a cut origin would point at another note.
    case "thread/archived":
    case "thread/meta":
    case "thread/tokenUsage/updated":
    case "turn/started": {
      return [];
    }
    // no default
  }
};

// largest text first, each cut once, until the event fits. an event whose envelope alone is over
// the cap comes back still over it, and the outbox's refusal is the backstop.
export const clipThreadEventForSync = (event: ThreadEvent, maxBytes: number): ThreadEvent => {
  let excess = utf8ByteLength(JSON.stringify(event)) - maxBytes;
  if (excess <= 0) {
    return event;
  }
  const clipped = structuredClone(event);
  const largestFirst = eventPayload(clipped).toSorted((left, right) => right.bytes - left.bytes);
  for (const payload of largestFirst) {
    if (excess <= 0) {
      break;
    }
    // the marker's digits are bounded by the whole text's byte count, so reserving that one is safe.
    const reserve = QUOTE_BYTES + serializedBytes(elisionMarker(utf8ByteLength(payload.text)));
    if (payload.bytes <= reserve) {
      continue;
    }
    const replacement = elideMiddle(payload.text, Math.max(0, payload.bytes - excess - reserve));
    payload.set(replacement);
    excess -= payload.bytes - utf8ByteLength(JSON.stringify(replacement));
  }
  return clipped;
};
