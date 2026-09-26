// Settings' connectors are the default agent's own, resolved per call from the stored choice, so a
// change of agent moves the section to the other vendor's config at once. Every call on one vendor's
// config waits for the one before it: two adds of one name would both pass the list's check, and
// codex would let the second replace the first.

import { HARNESSES } from "@repo/agent-runtime/acp/harness-registry";
import type { HarnessId } from "@repo/agent-runtime/acp/harness-registry";
import type {
  ConnectorAddRequest,
  ConnectorsResponse,
} from "@repo/api/local/connectors/connectors-schema";
import type { VendorProcessContext } from "../agents/vendor-process";
import { createClaudeMcpConfig } from "./claude-mcp-config";
import { createCodexMcpConfig } from "./codex-mcp-config";
import { createMcpSignIns } from "./mcp-sign-ins";
import type { CreateMcpSignInsArgs } from "./mcp-sign-ins";
import type { VendorMcpConfigs, VendorMcpServer } from "./vendor-mcp-config";

export interface ConnectorsService {
  list: () => Promise<ConnectorsResponse>;
  add: (request: ConnectorAddRequest) => Promise<ConnectorsResponse>;
  remove: (name: string) => Promise<ConnectorsResponse>;
  signIn: (name: string) => Promise<ConnectorsResponse>;
  // ends every running sign-in with its vendor process.
  dispose: () => Promise<void>;
}

export interface CreateConnectorsServiceArgs {
  configs: VendorMcpConfigs;
  defaultHarness: () => HarnessId;
  signInWindowMs?: CreateMcpSignInsArgs["windowMs"];
}

export const createVendorMcpConfigs = (context: VendorProcessContext): VendorMcpConfigs => ({
  claude: createClaudeMcpConfig(context),
  codex: createCodexMcpConfig(context),
});

export const createConnectorsService = (args: CreateConnectorsServiceArgs): ConnectorsService => {
  const signIns = createMcpSignIns(
    args.signInWindowMs === undefined ? {} : { windowMs: args.signInWindowMs },
  );
  const chains = new Map<HarnessId, Promise<void>>();

  const exclusive = async <T>(harness: HarnessId, work: () => Promise<T>): Promise<T> => {
    const previous = chains.get(harness) ?? Promise.resolve();
    const next = (async () => {
      await previous;
      return await work();
    })();
    chains.set(
      harness,
      (async () => {
        try {
          await next;
        } catch {
          // the rejection is the caller's; the chain only orders the next call.
        }
      })(),
    );
    return await next;
  };

  const answer = (harness: HarnessId, servers: VendorMcpServer[]): ConnectorsResponse => ({
    agent: { displayName: HARNESSES[harness].displayName, id: harness },
    servers: servers.map((server) => ({ ...server, signIn: signIns.state(harness, server.name) })),
  });

  // every call answers the whole list as the vendor holds it once the call's own work is done.
  const onDefault = async (
    work: (harness: HarnessId) => Promise<void> = async () => {
      await Promise.resolve();
    },
  ): Promise<ConnectorsResponse> => {
    const harness = args.defaultHarness();
    return await exclusive(harness, async () => {
      await work(harness);
      return answer(harness, await args.configs[harness].list());
    });
  };

  return {
    add: async (request) =>
      await onDefault(async (harness) => {
        const started = await args.configs[harness].add(request.name, request.target);
        if (started !== null) {
          signIns.adopt(harness, request.name, started);
        }
      }),
    dispose: async () => {
      await signIns.dispose();
    },
    list: async () => await onDefault(),
    remove: async (name) =>
      await onDefault(async (harness) => {
        await signIns.forget(harness, name);
        await args.configs[harness].remove(name);
      }),
    signIn: async (name) =>
      await onDefault(async (harness) => {
        if (!signIns.running(harness, name)) {
          signIns.adopt(harness, name, await args.configs[harness].signIn(name));
        }
      }),
  };
};
