import { text } from "node:stream/consumers";
import { describe, expect, it, vi } from "vitest";
import { fromChildFrameSchema, stdioOverPort } from "../stdio-frames";
import type { FromChildFrame } from "../stdio-frames";
import { fakeChannel } from "./fake-ports";

describe("a child's stdio over its port", () => {
  it("feeds stdin from the server's frames until it ends it", async () => {
    const { port1, port2 } = fakeChannel();
    const stdio = stdioOverPort(port2);
    port1.postMessage({ chunk: new TextEncoder().encode("hello "), kind: "stdin" });
    port2.receive({ data: "not a frame", ports: [] });
    port1.postMessage({ chunk: new TextEncoder().encode("child"), kind: "stdin" });
    port1.postMessage({ kind: "stdin-end" });
    expect(await text(stdio.stdin)).toBe("hello child");
  });

  it("ends stdin when the server's end closes, as an adapter reads its parent going away", async () => {
    const { port1, port2 } = fakeChannel();
    const stdio = stdioOverPort(port2);
    port1.close();
    expect(await text(stdio.stdin)).toBe("");
  });

  it("posts each write as a copy of its own bytes, never the pool behind a small Buffer", async () => {
    const { port1, port2 } = fakeChannel();
    const frames: FromChildFrame[] = [];
    port1.on("message", ({ data }) => {
      const parsed = fromChildFrameSchema.safeParse(data);
      if (parsed.success) {
        frames.push(parsed.data);
      }
    });
    port1.start();
    const stdio = stdioOverPort(port2);
    const pooled = Buffer.from("out");
    expect(pooled.buffer.byteLength).toBeGreaterThan(pooled.length);
    stdio.stdout.write(pooled);
    stdio.stderr.write("err");
    await vi.waitFor(() => {
      expect(frames.map((frame) => frame.kind)).toEqual(["stdout", "stderr"]);
    });
    expect(frames.map((frame) => new TextDecoder().decode(frame.chunk))).toEqual(["out", "err"]);
    expect(frames[0]?.chunk.buffer.byteLength).toBe(3);
  });
});
