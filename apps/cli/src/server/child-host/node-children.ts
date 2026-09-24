// how this server starts its two node children, the vault watcher and the ACP adapters. run by node
// (`inteligir serve`, npx, a suite), it forks them with child_process over its own execPath, the
// server's defaults. run by the desktop shell, main forks each one for it through the broker.

import path from "node:path";
import type { AcpAgentRuntimeOptions } from "@repo/agent-runtime/acp/acp-runtime";
import type { ChildChannel } from "../vault/watcher/parcel-watcher-proxy";
import { createPortChannel } from "../vault/watcher/port-channel";
import { brokeredAdapterProcess } from "./brokered-adapter";
import { createForkBrokerClient, signalProcess } from "./fork-broker-client";
import type { ParentPortLike } from "./message-port";

export interface NodeChildren {
  // absent: the server's own child_process defaults
  watcherChannel?: () => ChildChannel;
  spawnAdapter?: AcpAgentRuntimeOptions["spawnAdapter"];
}

// the shell forks the bundle, so each child is the entry the build stages beside it.
const bundledEntry = (name: string): string => path.join(import.meta.dirname, `${name}.mjs`);

const definedEnv = (env: NodeJS.ProcessEnv): Record<string, string> =>
  Object.fromEntries(
    Object.entries(env).flatMap(([key, value]) => (value === undefined ? [] : [[key, value]])),
  );

export const resolveNodeChildren = (parentPort: ParentPortLike | null): NodeChildren => {
  if (parentPort === null) {
    return {};
  }
  const broker = createForkBrokerClient(parentPort);
  return {
    spawnAdapter: (harness, env, cwd) => ({
      child: brokeredAdapterProcess(
        broker.fork({
          args: [harness.adapterEntry],
          cwd,
          env,
          modulePath: bundledEntry("stdio-port-host"),
          serviceName: `inteligir-agent-${harness.id}`,
        }),
      ),
    }),
    watcherChannel: () =>
      createPortChannel(
        broker.fork({
          args: [],
          env: definedEnv(process.env),
          modulePath: bundledEntry("parcel-watcher-child"),
          serviceName: "inteligir-watcher",
        }),
        signalProcess,
      ),
  };
};
