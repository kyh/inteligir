// ---------------------------------------------------------------------------
// Where the agent's parts are put together — the one place that knows the whole
// shape, so `UserHost` does not have to.
//
// It also holds the runtime choice: a real Cloudflare Sandbox, or the scripted
// in-memory one. That is a single `if`, made once, on a var the deployment sets
// (`AGENT_RUNTIME`) — and everything downstream of it is identical, because the
// port is the same five verbs either way (./sandbox-port).
//
// The scripted branch is not a test double bolted on the side. It is how this
// repo is developed: `@cloudflare/sandbox` needs the Workers Paid plan and a
// built image, and the entire test suite — plus anyone running `wrangler dev`
// without Docker — has neither. Carrying the desktop's login-free agent flow
// (`INTELIGIR_FAUX_AGENT=1`) over meant making the login-free path a first-class
// runtime rather than a mock.
// ---------------------------------------------------------------------------

import type { AppAgentEvent } from "@repo/bridge/agent-events";
import type { AgentConfirmationRequest } from "@repo/bridge/ipc-registry";
import type { AgentReport, AgentReportReply } from "@repo/agent-container/protocol";

import type { UserKnowledge } from "../host/knowledge/user-knowledge";
import type { UserVault } from "../host/vault/user-vault";
import { AgentRunner } from "./agent-runner";
import { AgentSnapshots } from "./agent-snapshots";
import { ChatStore } from "./chat-store";
import { createCfSandboxPort } from "./cf-sandbox";
import { FakeSandbox } from "./fake-sandbox";
import { ProviderCredentials, type CredentialKv } from "./provider-credentials";
import { sandboxRuntimeEnabled } from "./provider-catalog";
import type { SandboxPort } from "./sandbox-port";
import { VaultRevisions } from "./vault-revisions";

export type AgentCompositionDeps = {
  readonly env: Env;
  readonly userId: string;
  readonly sql: SqlStorage;
  readonly kv: CredentialKv;
  readonly bucket: R2Bucket;
  /** R2 key prefix for this user's blobs — the vault's own. */
  readonly prefix: string;
  readonly vault: UserVault;
  readonly knowledge: UserKnowledge;
  readonly emitAgentEvent: (event: AppAgentEvent) => void;
  readonly emitConfirmation: (request: AgentConfirmationRequest) => void;
  readonly onBusyChanged: () => void;
  /** The origin this deployment is reached on when no public host is declared. */
  readonly publicOrigin: () => string;
  /** Work the object must not be evicted before finishing — `ctx.waitUntil`. */
  readonly defer: (work: Promise<unknown>) => void;
};

export type AgentComposition = {
  readonly runner: AgentRunner;
  readonly chat: ChatStore;
  readonly credentials: ProviderCredentials;
  readonly revisions: VaultRevisions;
  readonly snapshots: AgentSnapshots;
  /** The scripted container, or `null` on the real runtime. */
  readonly scripted: () => FakeSandbox | null;
};

export function composeAgent(deps: AgentCompositionDeps): AgentComposition {
  const chat = new ChatStore(deps.sql);
  const revisions = new VaultRevisions(deps.sql);
  const snapshots = new AgentSnapshots({
    sql: deps.sql,
    bucket: deps.bucket,
    prefix: deps.prefix,
    vault: {
      lookup: (path) => {
        const file = deps.vault.lookup(path);
        return file === null ? null : { state: file.state, key: file.key };
      },
      writeText: (path, content) => deps.vault.writeText(path, content),
    },
  });
  const credentials = new ProviderCredentials({
    kv: deps.kv,
    userId: deps.userId,
    secret: deps.env.BETTER_AUTH_SECRET,
    env: deps.env,
    // Bound rather than passed bare: `fetch` on workerd is an unbound global,
    // and a method-shaped reference to it throws on call.
    fetch: (input, init) => fetch(input, init),
  });

  // The scripted container is built EAGERLY (it is a few fields in memory) so
  // `scripted` is a plain constant rather than something a caller has to
  // provoke into existing. `report` is the PRODUCTION report entry, not a stub:
  // a scripted turn therefore drives the real transcript, the real tool
  // executor and the real confirmation broker, and only the process that would
  // have produced the reports is fake. The runner it reports into is
  // constructed just below, which is why the reference is deferred.
  let runner: AgentRunner | null = null;
  const scripted = sandboxRuntimeEnabled(deps.env)
    ? null
    : new FakeSandbox({
        report: (report: AgentReport): Promise<AgentReportReply> => {
          if (runner === null) throw new Error("the agent runner is not composed yet");
          return runner.report(report);
        },
        defer: deps.defer,
      });

  // A real container's stub is built once and captured, so its state survives
  // between turns; the scripted one already is.
  let cfPort: SandboxPort | null = null;

  runner = new AgentRunner({
    env: deps.env,
    userId: deps.userId,
    kv: deps.kv,
    vault: deps.vault,
    knowledge: deps.knowledge,
    chat,
    snapshots,
    credentials,
    revisions,
    sandbox: () => {
      if (scripted !== null) return scripted;
      cfPort ??= createCfSandboxPort({
        namespace: deps.env.AGENT_SANDBOX,
        // One container per user, named after their host object so a log line
        // about a container names the account it belongs to.
        name: `user-${deps.userId}`,
      });
      return cfPort;
    },
    publicOrigin: deps.publicOrigin,
    emitAgentEvent: deps.emitAgentEvent,
    emitConfirmation: deps.emitConfirmation,
    onBusyChanged: deps.onBusyChanged,
  });

  return { runner, chat, credentials, revisions, snapshots, scripted: () => scripted };
}
