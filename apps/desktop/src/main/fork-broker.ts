// the server is a utility process, which cannot fork one of its own (utilityProcess.fork is main's
// alone), and the packaged binary's runAsNode fuse keeps child_process from running node under this
// binary. so main forks the server's node children on request (the vault watcher, the ACP
// adapters), hands the server and the child the two ends of one channel, and reports each exit.
// the server is this app's own child and already runs whatever it likes, so nothing here polices
// what it asks for.

import type { ForkOptions } from "electron";
import type {
  AttachFrame,
  ForkReply,
  ForkRequest,
} from "inteligir/server/child-host/fork-broker-wire";
import { toErrorMessage } from "../types";

// the slice of a UtilityProcess the broker drives: index.ts forks the real one, a test a fake.
export interface BrokeredChild<Port> {
  readonly pid: number | undefined;
  once: {
    (event: "spawn", listener: () => void): void;
    (event: "exit", listener: (code: number) => void): void;
  };
  postMessage: (message: AttachFrame, transfer: Port[]) => void;
  kill: () => boolean;
}

export interface ForkBrokerArgs<Port> {
  fork: (modulePath: string, args: string[], options: ForkOptions) => BrokeredChild<Port>;
  createChannel: () => { port1: Port; port2: Port };
  // to the server that asked
  reply: (message: ForkReply, transfer: Port[]) => void;
  log: (message: string) => void;
}

export interface ForkBroker {
  fork: (request: ForkRequest) => void;
  // the server is gone, and a child it asked for has no one left to talk to
  dispose: () => void;
}

const forkOptions = (request: ForkRequest): ForkOptions => {
  const options: ForkOptions = {
    env: request.env,
    serviceName: request.serviceName,
    stdio: "inherit",
  };
  if (request.cwd !== undefined) {
    options.cwd = request.cwd;
  }
  return options;
};

export const createForkBroker = <Port>(args: ForkBrokerArgs<Port>): ForkBroker => {
  const live = new Set<BrokeredChild<Port>>();

  // main's own handlers must not throw: an uncaught error here is an error dialog. a reply to a
  // server that has already exited has nowhere to go.
  const reply = (message: ForkReply, transfer: Port[] = []): void => {
    try {
      args.reply(message, transfer);
    } catch (error) {
      args.log(`fork broker: could not answer the server (${toErrorMessage(error)})`);
    }
  };

  return {
    dispose() {
      for (const child of live) {
        child.kill();
      }
      live.clear();
    },
    fork(request) {
      const { id } = request;
      let child: BrokeredChild<Port>;
      try {
        child = args.fork(request.modulePath, request.args, forkOptions(request));
      } catch (error) {
        reply({ id, kind: "fork-failed", message: toErrorMessage(error) });
        return;
      }
      live.add(child);
      const abandon = (message: string): void => {
        reply({ id, kind: "fork-failed", message });
        child.kill();
      };
      child.once("spawn", () => {
        const { pid } = child;
        if (pid === undefined) {
          abandon("the child spawned without a pid");
          return;
        }
        const { port1, port2 } = args.createChannel();
        try {
          child.postMessage({ kind: "attach" }, [port2]);
        } catch (error) {
          abandon(toErrorMessage(error));
          return;
        }
        reply({ id, kind: "forked", pid }, [port1]);
      });
      child.once("exit", (code) => {
        live.delete(child);
        reply({ code, id, kind: "exited" });
      });
    },
  };
};
