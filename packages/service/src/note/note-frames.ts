// What a frame on a note's socket is, read off its y-protocols header before y-partyserver takes
// it: an awareness frame, which presence being off drops, or a sync frame that writes (step 2 or an
// update), which the note weighs against its caps. A text frame is a custom message.

import * as decoding from "lib0/decoding";
import type { WSMessage } from "partyserver";

// y-protocols' message types, and a sync message's own
const MESSAGE_SYNC = 0;
const MESSAGE_AWARENESS = 1;
const SYNC_STEP_2 = 1;
const SYNC_UPDATE = 2;

export type FrameKind = "awareness" | "write" | "other";

// a binary frame's bytes; null for a text one
const bytesOf = (message: WSMessage): Uint8Array | null => {
  if (message instanceof ArrayBuffer) {
    return new Uint8Array(message);
  }
  if (ArrayBuffer.isView(message)) {
    return new Uint8Array(message.buffer, message.byteOffset, message.byteLength);
  }
  return null;
};

export const frameKind = (message: WSMessage): FrameKind => {
  const bytes = bytesOf(message);
  if (bytes === null || bytes.length === 0) {
    return "other";
  }
  try {
    const decoder = decoding.createDecoder(bytes);
    const type = decoding.readVarUint(decoder);
    if (type === MESSAGE_AWARENESS) {
      return "awareness";
    }
    if (type !== MESSAGE_SYNC) {
      return "other";
    }
    const step = decoding.readVarUint(decoder);
    return step === SYNC_STEP_2 || step === SYNC_UPDATE ? "write" : "other";
  } catch {
    // a frame too short to read a header from, which y-partyserver refuses too
    return "other";
  }
};

// a binary frame's weight; a text frame carries no write
export const frameBytes = (message: WSMessage): number => bytesOf(message)?.byteLength ?? 0;
