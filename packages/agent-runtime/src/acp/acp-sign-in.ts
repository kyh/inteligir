// a sign-in the adapter runs itself: the host asks for the method by id through `authenticate` and
// waits, and the adapter drives the vendor's login (codex opens the browser and answers once its
// login completes). The child lives only for the sign-in, and never outlives it.

import { once } from "node:events";
import { PROTOCOL_VERSION, client } from "@agentclientprotocol/sdk";
import type { AuthMethod, ClientConnection, InitializeRequest } from "@agentclientprotocol/sdk";
import { z } from "zod";
import { openAdapterChannel, spawnNodeAdapter, terminateAdapter } from "./acp-runtime.js";
import type { AcpAgentRuntimeOptions } from "./acp-runtime.js";
import type { AgentSignIn, HarnessDefinition } from "./harness-registry.js";
import { describeProviderError } from "./provider-error.js";

export type AgentSignInResult =
  | { outcome: "signed-in" }
  | { outcome: "cancelled" }
  | { outcome: "failed"; detail: string };

export interface AdapterSignInArgs {
  harness: HarnessDefinition;
  // absent: node forks the adapter, as the runtime's own default does
  spawnAdapter?: AcpAgentRuntimeOptions["spawnAdapter"] | undefined;
  env: Record<string, string>;
  cwd: string;
  signal: AbortSignal;
}

// an adapter advertises a terminal method only to a client that says it can run one, so asking
// shows every way in the adapter offers, not only the ones it runs itself.
const SIGN_IN_INITIALIZE: InitializeRequest = {
  clientCapabilities: {
    auth: { terminal: true },
    fs: { readTextFile: false, writeTextFile: false },
  },
  protocolVersion: PROTOCOL_VERSION,
};

const ABORTED = Symbol("aborted");

const unlessAborted = async <T>(
  work: Promise<T>,
  signal: AbortSignal,
): Promise<T | typeof ABORTED> => {
  if (signal.aborted) {
    return ABORTED;
  }
  const aborted = (async (): Promise<typeof ABORTED> => {
    await once(signal, "abort");
    return ABORTED;
  })();
  return await Promise.race([work, aborted]);
};

const withAdapter = async <T>(
  args: AdapterSignInArgs,
  work: (connection: ClientConnection) => Promise<T>,
): Promise<T> => {
  const { child } = (args.spawnAdapter ?? spawnNodeAdapter)(args.harness, args.env, args.cwd);
  const channel = openAdapterChannel(args.harness, child);
  const connection = client({ name: "inteligir" }).connect(channel.stream);
  void (async () => {
    connection.close(await channel.exited);
  })();
  try {
    return await work(connection);
  } finally {
    await terminateAdapter(child, channel.gone);
  }
};

// what the adapter offers under the initialize every sign-in sends; ABORTED when the signal stops it.
const initializedMethods = async (
  connection: ClientConnection,
  signal: AbortSignal,
): Promise<AuthMethod[] | typeof ABORTED> => {
  const initialized = await unlessAborted(
    connection.agent.request("initialize", SIGN_IN_INITIALIZE),
    signal,
  );
  return initialized === ABORTED ? ABORTED : (initialized.authMethods ?? []);
};

export const readAuthMethods = async (args: AdapterSignInArgs): Promise<AuthMethod[]> =>
  await withAdapter(args, async (connection) => {
    const methods = await initializedMethods(connection, args.signal);
    if (methods === ABORTED) {
      throw new Error(`The ${args.harness.displayName} adapter was stopped before it answered`);
    }
    return methods;
  });

// the protocol reads an absent type as the agent kind; the SDK's union types only the terminal one,
// so the wire's own field is read, not the union's.
const authMethodKindSchema = z.object({ type: z.string().default("agent") });

const offersAgentMethod = (methods: readonly AuthMethod[], methodId: string): boolean =>
  methods.some(
    (method) =>
      method.id === methodId && authMethodKindSchema.safeParse(method).data?.type === "agent",
  );

export const runAgentSignIn = async (
  args: AdapterSignInArgs & { method: AgentSignIn },
): Promise<AgentSignInResult> => {
  const { displayName } = args.harness;
  const { methodId } = args.method;
  if (args.signal.aborted) {
    return { outcome: "cancelled" };
  }
  try {
    return await withAdapter(args, async (connection): Promise<AgentSignInResult> => {
      const methods = await initializedMethods(connection, args.signal);
      if (methods === ABORTED) {
        return { outcome: "cancelled" };
      }
      if (!offersAgentMethod(methods, methodId)) {
        return {
          detail: `${displayName} does not offer "${methodId}" as a way to sign in here.`,
          outcome: "failed",
        };
      }
      const answered = await unlessAborted(
        connection.agent.request("authenticate", { methodId }),
        args.signal,
      );
      return answered === ABORTED ? { outcome: "cancelled" } : { outcome: "signed-in" };
    });
  } catch (error) {
    return args.signal.aborted
      ? { outcome: "cancelled" }
      : {
          detail: `${displayName} did not finish signing in: ${describeProviderError(error)}`,
          outcome: "failed",
        };
  }
};
