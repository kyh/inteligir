// The dictation stream client, driven with a fake socket: the queue-until-open
// ordering, the terminal final/error, and the cancel that says nothing.

import { describe, expect, it } from "vitest";
import { DictationStreamClient, type DictationSocket } from "../dictation-stream";

function fakeSocket() {
  const sent: Array<string | ArrayBuffer> = [];
  let closed = false;
  const socket: DictationSocket = {
    send: (data) => sent.push(data),
    close: () => {
      closed = true;
    },
    onOpen: null,
    onMessage: null,
    onClose: null,
    onError: null,
  };
  return { socket, sent, isClosed: () => closed };
}

function recorder() {
  const partials: string[] = [];
  const finals: string[] = [];
  const errors: string[] = [];
  return {
    partials,
    finals,
    errors,
    handlers: {
      onPartial: (text: string) => partials.push(text),
      onFinal: (text: string) => finals.push(text),
      onError: (message: string) => errors.push(message),
    },
  };
}

describe("DictationStreamClient", () => {
  it("queues frames until the socket opens, then flushes and streams live", () => {
    const fake = fakeSocket();
    const rec = recorder();
    const client = new DictationStreamClient({
      createSocket: () => fake.socket,
      handlers: rec.handlers,
    });
    client.start();

    const first = new ArrayBuffer(4);
    client.pushPcm(first);
    expect(fake.sent).toEqual([]);

    fake.socket.onOpen?.();
    expect(fake.sent).toEqual([first]);

    const second = new ArrayBuffer(6);
    client.pushPcm(second);
    expect(fake.sent).toEqual([first, second]);
  });

  it("holds a finalize that races the open behind the queued frames", () => {
    const fake = fakeSocket();
    const rec = recorder();
    const client = new DictationStreamClient({
      createSocket: () => fake.socket,
      handlers: rec.handlers,
    });
    client.start();
    const frame = new ArrayBuffer(4);
    client.pushPcm(frame);
    client.finalize();

    fake.socket.onOpen?.();
    expect(fake.sent).toEqual([frame, JSON.stringify({ type: "finalize" })]);
  });

  it("delivers partials then a final, and the final is terminal", () => {
    const fake = fakeSocket();
    const rec = recorder();
    const client = new DictationStreamClient({
      createSocket: () => fake.socket,
      handlers: rec.handlers,
    });
    client.start();
    fake.socket.onOpen?.();

    fake.socket.onMessage?.({ data: JSON.stringify({ type: "partial", text: "hel" }) });
    fake.socket.onMessage?.({ data: JSON.stringify({ type: "partial", text: "hello" }) });
    fake.socket.onMessage?.({ data: JSON.stringify({ type: "final", text: "hello world" }) });

    expect(rec.partials).toEqual(["hel", "hello"]);
    expect(rec.finals).toEqual(["hello world"]);
    expect(fake.isClosed()).toBe(true);
  });

  it("turns a server error frame into onError", () => {
    const fake = fakeSocket();
    const rec = recorder();
    const client = new DictationStreamClient({
      createSocket: () => fake.socket,
      handlers: rec.handlers,
    });
    client.start();
    fake.socket.onOpen?.();
    fake.socket.onMessage?.({ data: JSON.stringify({ type: "error", message: "no runtime" }) });
    expect(rec.errors).toEqual(["no runtime"]);
    expect(rec.finals).toEqual([]);
    expect(fake.isClosed()).toBe(true);
  });

  it("treats a drop before the final as an error", () => {
    const fake = fakeSocket();
    const rec = recorder();
    const client = new DictationStreamClient({
      createSocket: () => fake.socket,
      handlers: rec.handlers,
    });
    client.start();
    fake.socket.onOpen?.();
    fake.socket.onClose?.();
    expect(rec.errors).toEqual(["The dictation connection closed."]);
  });

  it("says nothing on cancel and closes the socket", () => {
    const fake = fakeSocket();
    const rec = recorder();
    const client = new DictationStreamClient({
      createSocket: () => fake.socket,
      handlers: rec.handlers,
    });
    client.start();
    fake.socket.onOpen?.();
    client.cancel();
    expect(fake.isClosed()).toBe(true);
    expect(rec.errors).toEqual([]);
    expect(rec.finals).toEqual([]);
  });

  it("ignores a malformed or unknown down message", () => {
    const fake = fakeSocket();
    const rec = recorder();
    const client = new DictationStreamClient({
      createSocket: () => fake.socket,
      handlers: rec.handlers,
    });
    client.start();
    fake.socket.onOpen?.();
    fake.socket.onMessage?.({ data: "not json" });
    fake.socket.onMessage?.({ data: JSON.stringify({ type: "surprise" }) });
    fake.socket.onMessage?.({ data: 42 });
    expect(rec.partials).toEqual([]);
    expect(rec.finals).toEqual([]);
    expect(rec.errors).toEqual([]);
  });
});
