// a utility process takes no stdin, and an ACP adapter speaks its protocol over stdin and stdout,
// so a brokered adapter's three streams ride its MessagePort to the server as these frames.

import { PassThrough, Writable } from "node:stream";
import { z } from "zod";
import type { MessagePortLike } from "./message-port";

export const toChildFrameSchema = z.discriminatedUnion("kind", [
  z.object({ chunk: z.instanceof(Uint8Array), kind: z.literal("stdin") }).strict(),
  z.object({ kind: z.literal("stdin-end") }).strict(),
]);
export type ToChildFrame = z.infer<typeof toChildFrameSchema>;

export const fromChildFrameSchema = z
  .object({ chunk: z.instanceof(Uint8Array), kind: z.enum(["stdout", "stderr"]) })
  .strict();
export type FromChildFrame = z.infer<typeof fromChildFrameSchema>;

// a copy, never the chunk: a structured clone carries a view's whole backing buffer, and a small
// Buffer's is the shared 8KiB pool.
export const frameChunk = (chunk: Uint8Array): Uint8Array<ArrayBuffer> => new Uint8Array(chunk);

// synchronous on purpose: the frame is on the port before a process.exit() right after the write
// can drop it, and that last stderr line is usually what names an adapter's crash.
const portWritable = (port: MessagePortLike, kind: FromChildFrame["kind"]): Writable =>
  new Writable({
    // oxlint-disable-next-line promise/prefer-await-to-callbacks -- a Writable learns a write is done only through its callback.
    write: (chunk: Buffer, _encoding, callback) => {
      const frame: FromChildFrame = { chunk: frameChunk(chunk), kind };
      port.postMessage(frame);
      // oxlint-disable-next-line promise/prefer-await-to-callbacks -- as above.
      callback();
    },
  });

export interface ChildStdio {
  stdin: PassThrough;
  stdout: Writable;
  stderr: Writable;
}

// the child's side. a closed port is the server gone, which an adapter hears as its stdin ending.
export const stdioOverPort = (port: MessagePortLike): ChildStdio => {
  const stdin = new PassThrough();
  const endStdin = (): void => {
    if (!stdin.writableEnded) {
      stdin.end();
    }
  };
  port.on("message", ({ data }) => {
    const parsed = toChildFrameSchema.safeParse(data);
    if (!parsed.success || stdin.writableEnded) {
      return;
    }
    if (parsed.data.kind === "stdin") {
      stdin.write(parsed.data.chunk);
    } else {
      endStdin();
    }
  });
  port.on("close", endStdin);
  port.start();
  return { stderr: portWritable(port, "stderr"), stdin, stdout: portWritable(port, "stdout") };
};
