// Settings' connectors are the default agent's own, resolved per call from the stored choice, so a
// change of agent moves the section to the other vendor's config at once. Every call on one vendor's
// config waits for the one before it: two adds of one name would both pass the list's check, and
// codex would let the second replace the first. A plain list answers from the last read for a few
// seconds: reading codex's spawns it and runs OAuth discovery against every URL row, and Settings
// asks every 1.5s while a sign-in waits. Every edit, and every sign-in's end, reads again.

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
import type { CreateMcpSignInsArgs, McpSignInRun } from "./mcp-sign-ins";
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
  listCacheMs?: number;
}

// long enough to absorb a poll, short enough that a row added in a terminal shows on the next look
const LIST_CACHE_MS = 10_000;

interface ListRead {
  servers: VendorMcpServer[];
  at: number;
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
  const listCacheMs = args.listCacheMs ?? LIST_CACHE_MS;
  const lastReads = new Map<HarnessId, ListRead>();
  // a read that began before a forget must not keep what it read past it
  let forgets = 0;

  const forgetList = (harness: HarnessId): void => {
    lastReads.delete(harness);
    forgets += 1;
  };

  const readList = async (harness: HarnessId): Promise<VendorMcpServer[]> => {
    const last = lastReads.get(harness);
    if (last !== undefined && Date.now() - last.at < listCacheMs) {
      return last.servers;
    }
    const began = forgets;
    const servers = await args.configs[harness].list();
    if (began === forgets) {
      lastReads.set(harness, { at: Date.now(), servers });
    }
    return servers;
  };

  // a finished sign-in changes the auth the vendor reports for its row
  const adopt = (harness: HarnessId, name: string, run: McpSignInRun): void => {
    signIns.adopt(harness, name, run);
    void (async () => {
      await Promise.allSettled([run.ended]);
      forgetList(harness);
    })();
  };

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

  // every call answers the whole list as the vendor holds it once the call's own work is done;
  // one with work to do reads it afresh, whether or not the work got as far as the vendor.
  const onDefault = async (
    work?: (harness: HarnessId) => Promise<void>,
  ): Promise<ConnectorsResponse> => {
    const harness = args.defaultHarness();
    return await exclusive(harness, async () => {
      if (work !== undefined) {
        forgetList(harness);
        await work(harness);
      }
      return answer(harness, await readList(harness));
    });
  };

  return {
    add: async (request) =>
      await onDefault(async (harness) => {
        const started = await args.configs[harness].add(request.name, request.target);
        if (started !== null) {
          adopt(harness, request.name, started);
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
          adopt(harness, name, await args.configs[harness].signIn(name));
        }
      }),
  };
};
