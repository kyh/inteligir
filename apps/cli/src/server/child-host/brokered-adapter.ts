// the server's stand-in for an adapter child main forked through the broker: its stdio arrives as
// frames on the port, and its exit as main's report. it keeps ChildProcess's order: `exit` may come
// before the streams end, which they do when the port closes.

import { PassThrough } from "node:stream";
import type { AdapterProcess } from "@repo/agent-runtime/acp/acp-runtime";
import { signalProcess } from "./fork-broker-client";
import type { BrokeredFork, ForkAttachment, SignalProcess } from "./fork-broker-client";
import type { MessagePortLike } from "./message-port";
import { frameChunk, fromChildFrameSchema } from "./stdio-frames";

type ExitListener = (code: number | null, signal: NodeJS.Signals | null) => void;

export class BrokeredAdapterProcess implements AdapterProcess {
  // written before main has forked the child, and held until it has: the first request is on its
  // way by then. once the child is gone, writes are dropped, as a dead pipe's are.
  readonly stdin = new PassThrough();
  readonly stdout = new PassThrough();
  readonly stderr = new PassThrough();
  exitCode: number | null = null;
  // main reports a code alone: a child a signal killed exits with that signal's number
  readonly signalCode: NodeJS.Signals | null = null;
  #exited = false;
  #pid: number | null = null;
  // a kill asked for before main has named the pid lands once it has
  #pendingSignal: NodeJS.Signals | null = null;
  readonly #exitListeners: ExitListener[] = [];
  readonly #signal: SignalProcess;

  constructor(fork: BrokeredFork, signal: SignalProcess) {
    this.#signal = signal;
    void this.#attach(fork);
    void this.#awaitExit(fork);
  }

  async #attach(fork: BrokeredFork): Promise<void> {
    const attachment = await fork.attachment;
    if (attachment.kind === "failed") {
      this.stderr.write(`the adapter could not be started: ${attachment.message}\n`);
      this.#endOutput();
    } else {
      this.#pid = attachment.pid;
      this.#listen(attachment.port);
      const pending = this.#pendingSignal;
      this.#pendingSignal = null;
      if (pending !== null) {
        this.kill(pending);
      }
    }
    await this.#pumpStdin(attachment);
  }

  async #pumpStdin(attachment: ForkAttachment): Promise<void> {
    try {
      for await (const chunk of this.stdin) {
        if (attachment.kind === "attached" && !this.#exited && chunk instanceof Uint8Array) {
          attachment.port.postMessage({ chunk: frameChunk(chunk), kind: "stdin" });
        }
      }
    } catch {
      // a destroyed stdin has nothing more to send
    }
    if (attachment.kind === "attached" && !this.#exited) {
      attachment.port.postMessage({ kind: "stdin-end" });
    }
  }

  #listen(port: MessagePortLike): void {
    port.on("message", ({ data }) => {
      const parsed = fromChildFrameSchema.safeParse(data);
      if (!parsed.success) {
        return;
      }
      const stream = parsed.data.kind === "stdout" ? this.stdout : this.stderr;
      if (!stream.writableEnded) {
        stream.write(parsed.data.chunk);
      }
    });
    port.on("close", () => {
      this.#endOutput();
    });
    port.start();
  }

  async #awaitExit(fork: BrokeredFork): Promise<void> {
    const code = await fork.exit;
    this.#exited = true;
    this.exitCode = code;
    for (const listener of this.#exitListeners.splice(0)) {
      listener(code, null);
    }
  }

  #endOutput(): void {
    for (const stream of [this.stdout, this.stderr]) {
      if (!stream.writableEnded) {
        stream.end();
      }
    }
  }

  once(_event: "exit", listener: ExitListener): this {
    if (this.#exited) {
      listener(this.exitCode, null);
    } else {
      this.#exitListeners.push(listener);
    }
    return this;
  }

  kill(signal: NodeJS.Signals): boolean {
    if (this.#exited) {
      return false;
    }
    if (this.#pid === null) {
      this.#pendingSignal = signal;
      return true;
    }
    try {
      this.#signal(this.#pid, signal);
      return true;
    } catch {
      return false;
    }
  }
}

export const brokeredAdapterProcess = (
  fork: BrokeredFork,
  signal: SignalProcess = signalProcess,
): BrokeredAdapterProcess => new BrokeredAdapterProcess(fork, signal);
