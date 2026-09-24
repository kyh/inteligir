// the server's half of main's fork broker (apps/desktop/src/main/fork-broker.ts): the server and
// each child talk directly over one MessageChannel, and main reports the exit.

import { forkReplySchema } from "./fork-broker-wire";
import type { ForkRequest } from "./fork-broker-wire";
import type { MessagePortLike, ParentPortLike } from "./message-port";

export interface ForkSpec {
  modulePath: string;
  args: readonly string[];
  env: Readonly<Record<string, string>>;
  cwd?: string;
  serviceName: string;
}

export type ForkAttachment =
  | { kind: "attached"; port: MessagePortLike; pid: number }
  | { kind: "failed"; message: string };

// neither promise rejects, so a fork nobody awaits cannot become an unhandled rejection.
export interface BrokeredFork {
  attachment: Promise<ForkAttachment>;
  // the code main saw the child exit with; null when it never ran
  exit: Promise<number | null>;
}

// a brokered child is signalled by its pid: main names it, and the child runs as this user.
export type SignalProcess = (pid: number, signal: NodeJS.Signals) => void;

export const signalProcess: SignalProcess = (pid, signal) => {
  process.kill(pid, signal);
};

export interface ForkBrokerClient {
  fork: (spec: ForkSpec) => BrokeredFork;
}

interface PendingFork {
  attachment: PromiseWithResolvers<ForkAttachment>;
  exit: PromiseWithResolvers<number | null>;
}

export const createForkBrokerClient = (parentPort: ParentPortLike): ForkBrokerClient => {
  const pending = new Map<string, PendingFork>();
  let forkCount = 0;

  parentPort.on("message", ({ data, ports }) => {
    const parsed = forkReplySchema.safeParse(data);
    if (!parsed.success) {
      return;
    }
    const reply = parsed.data;
    const fork = pending.get(reply.id);
    if (fork === undefined) {
      return;
    }
    switch (reply.kind) {
      case "forked": {
        const [port] = ports;
        fork.attachment.resolve(
          port === undefined
            ? { kind: "failed", message: "the child was forked without a channel" }
            : { kind: "attached", pid: reply.pid, port },
        );
        break;
      }
      case "fork-failed": {
        pending.delete(reply.id);
        fork.attachment.resolve({ kind: "failed", message: reply.message });
        fork.exit.resolve(null);
        break;
      }
      case "exited": {
        pending.delete(reply.id);
        fork.attachment.resolve({
          kind: "failed",
          message: `exited (code ${String(reply.code)}) before it was attached`,
        });
        fork.exit.resolve(reply.code);
        break;
      }
      // no default
    }
  });

  return {
    fork(spec) {
      forkCount += 1;
      const id = `fork_${String(forkCount)}`;
      const fork: PendingFork = {
        attachment: Promise.withResolvers(),
        exit: Promise.withResolvers(),
      };
      pending.set(id, fork);
      const request: ForkRequest = {
        args: [...spec.args],
        env: { ...spec.env },
        id,
        kind: "fork",
        modulePath: spec.modulePath,
        serviceName: spec.serviceName,
      };
      if (spec.cwd !== undefined) {
        request.cwd = spec.cwd;
      }
      parentPort.postMessage(request);
      return { attachment: fork.attachment.promise, exit: fork.exit.promise };
    },
  };
};
