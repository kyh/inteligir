// ---------------------------------------------------------------------------
// Where one user's host is put together — the ONE artifact holding the whole
// wiring graph, so `UserHost` does not have to and no test has to rebuild it.
//
// The object itself is then three things and nothing else: the entry points
// (`fetch`, the socket callbacks, `alarm`), the gate every frame crosses
// (./socket-gate) and the deadline multiplex (./host-alarm). Everything they
// act on is composed here.
//
// Every part is per-INSTANCE, never module scope: one Worker isolate serves
// many tenants' Durable Objects in one module scope, so a shared field would
// fan one user's events onto another user's sockets.
// ---------------------------------------------------------------------------

import type { IpcEmit } from "@repo/bridge/ipc-contract";
import { UI_STATE_OPEN_NOTE_KEY } from "@repo/bridge/ui-state";

import { composeAgent, type AgentComposition } from "../agent/agent-composition";
import { providerSettings } from "../agent/provider-catalog";
import { TextGenerator } from "../ai/text-generator";
import { CaptureInbox } from "../capture/capture-inbox";
import { CaptureService } from "../capture/capture-service";
import { composeVoice, type VoiceComposition } from "../voice/voice-composition";
import { resolveDailyNotePath } from "./daily-note";
import { collectHandlers, type HostHandlers } from "./handler-registry";
import { cloudAppState, registerCloudHandlers } from "./handlers";
import { HostLimits } from "./host-limits";
import { userIdFromHostName } from "./host-address";
import { UserKnowledge } from "./knowledge/user-knowledge";
import { SocketTickets } from "./socket-ticket";
import { createCloudStores, type CloudStores } from "./stores";
import { SEED_OPEN_NOTE, seedVault } from "./vault/seed";
import { UserVault, VAULT_ROOT, type VaultChange } from "./vault/user-vault";

/** Where the last authenticated socket's origin is kept — the OAuth redirect
 * URI's fallback when no public host is declared. Persisted, because the object
 * hibernates between the socket that saw it and the connect that needs it. */
const LAST_ORIGIN_KEY = "host/last-origin";

export type HostCompositionDeps = {
  readonly env: Env;
  readonly ctx: DurableObjectState;
  /** Announce one event to this user's own sockets. Every part composed here
   * that has something to say says it through this, and the object binds it to
   * the gate that decides which sockets may hear it (./socket-gate) — so there
   * is no bus in between and nothing else can subscribe to one user's events. */
  readonly emit: IpcEmit;
  /** A deadline this host must wake for may have moved — a mutation armed the
   * retention sweep, a routine's schedule changed, indexing work is left over.
   * The object re-derives its ONE alarm from every concern (./host-alarm). */
  readonly onDeadlineChanged: () => void;
};

export type HostComposition = {
  /** This user's vault: the manifest in this object's own SQLite, the bytes in
   * R2 under this object's name (./vault/user-vault). */
  readonly vault: UserVault;
  /** The link/search index over that vault (./knowledge/user-knowledge). */
  readonly knowledge: UserKnowledge;
  /** The agent, and the container it drives (../agent/agent-composition). */
  readonly agent: AgentComposition;
  /** The editor's AI — no-tools text turns, run directly from this object
   * rather than through the container (../ai/text-generator). */
  readonly ai: TextGenerator;
  /** Text-to-speech and dictation (../voice). */
  readonly voice: VoiceComposition;
  /** The deep-link capture inbox and the nav parking over it (../capture). */
  readonly captureInbox: CaptureInbox;
  readonly capture: CaptureService;
  /** This user's durable host state (./stores). */
  readonly stores: CloudStores;
  /** Unspent socket tickets (./socket-ticket). */
  readonly tickets: SocketTickets;
  /** This account's budgets for the HTTP leaves (./host-limits). */
  readonly limits: HostLimits;
  /** This object's own R2 prefix — the namespace an account purge sweeps. */
  readonly prefix: string;
  /** The complete, schema-validated handler map. Construction throws if the
   * registry declares a method nothing here answers. */
  readonly handlers: HostHandlers;
  /** The origin this deployment is reached on: the declared public host, else
   * the last origin an authenticated socket arrived on. */
  readonly publicOrigin: () => string;
  /** Record the origin an AUTHENTICATED socket arrived on — never a pending
   * one, so an unauthenticated caller cannot set the origin a later OAuth
   * redirect URI is built from. */
  readonly rememberOrigin: (origin: string) => void;
  /**
   * Push the provider snapshot to whatever sockets are open.
   *
   * The OAuth round-trip finishes on a REDIRECT — a different tab, arriving as
   * an HTTP request rather than a frame — so the workspace has no other way to
   * learn that the connect it started is over. A deployment that offers no
   * provider at all has nothing to say, and says nothing.
   */
  readonly announceProviders: () => void;
  /** Land a brand-new account in a workspace rather than an empty one: seed the
   * vault and point ui-state at the note it opens on. Idempotent — every later
   * connect is one COUNT query. */
  readonly seedVault: () => Promise<void>;
};

export function composeHost(deps: HostCompositionDeps): HostComposition {
  const { env, ctx, emit } = deps;
  const kv = ctx.storage.kv;
  // An object addressed by id rather than by name can never authenticate (the
  // bind check compares against `userHostName`), so it can never write — the
  // fallback keeps the prefix total without inventing a second namespace anyone
  // can reach. The empty userId is the same argument: an object nobody can name
  // never reaches a credential.
  const prefix = ctx.id.name ?? ctx.id.toString();
  const userId = userIdFromHostName(ctx.id.name) ?? "";

  const stores = createCloudStores(kv);
  const dailyPath = (now: Date): string => resolveDailyNotePath(stores.uiState.read(), now);

  // The vault announces every mutation, and two of its listeners are built FROM
  // it — so the fan-out below is a hoisted declaration rather than a circular
  // dependency. Nothing can fire it before this function returns: a mutation
  // needs a caller, and there is none until the object starts serving.
  const vault = new UserVault({
    sql: ctx.storage.sql,
    bucket: env.VAULT_FILES,
    prefix,
    onChanged: (change) => announce(change),
  });

  const knowledge = new UserKnowledge({
    storage: ctx.storage,
    vault,
    onUpdated: () => {
      emit("onKnowledgeUpdated", {});
    },
    // An index rebuild too large for one pass is a deadline like any other:
    // the object must come back for the next slice on its own.
    onDeadlineChanged: deps.onDeadlineChanged,
  });

  const publicOrigin = (): string => {
    const declared = env.PUBLIC_HOST;
    if (declared !== undefined && declared !== "") return `https://${declared}`;
    const stored = kv.get(LAST_ORIGIN_KEY);
    return typeof stored === "string" ? stored : "";
  };

  const agent = composeAgent({
    env,
    userId,
    sql: ctx.storage.sql,
    kv,
    bucket: env.VAULT_FILES,
    prefix,
    vault,
    knowledge,
    dailyPath,
    publicOrigin,
    emitAgentEvent: (event) => {
      emit("onAgentEvent", event);
    },
    emitConfirmation: (request) => {
      emit("onAgentConfirmationRequested", request);
    },
    emitDelegations: (result) => {
      emit("onDelegationsUpdated", result);
    },
    emitDelegationStream: (id, text) => {
      emit("onDelegationStreamed", { id, text });
    },
    emitRoutines: (result) => {
      emit("onRoutinesUpdated", result);
    },
    emitEditCaptured: (capture) => {
      emit("onAgentEditCaptured", capture);
    },
    onBusyChanged: () => {
      emit("onAppState", cloudAppState(agent.runner.agentBusy()));
    },
    // A routine's schedule moved, or a background run took the lane and with it
    // a lease to reclaim.
    onDeadlineChanged: deps.onDeadlineChanged,
    defer: (work) => {
      ctx.waitUntil(work);
    },
  });

  function announce(change: VaultChange): void {
    // A mutation can create a deadline (a delete arms the retention sweep), so
    // the alarm is re-derived at the end of the inbound path rather than from
    // here — this callback is synchronous and the alarm is storage I/O. The
    // index is told the same way: recording is synchronous, and the projection
    // it implies runs on the way out.
    deps.onDeadlineChanged();
    knowledge.record(change);
    // Every writer moves the agent workspace's revision, so a container that
    // wakes after a browser edit materializes the delta rather than the note it
    // last saw.
    agent.revisions.record(change);
    emit("onVaultChanged", {
      root: VAULT_ROOT,
      // An EMPTY change is `refresh()`'s own announcement: it asserts nothing
      // about the manifest, so every client re-reads. Every real mutation names
      // at least one path, which is what lets a client skip the work a change
      // it can see did not cause.
      changed:
        change.upserted.length + change.removed.length === 0
          ? null
          : {
              upserted: change.upserted.map((file) => file.path),
              removed: [...change.removed],
            },
    });
  }

  const ai = new TextGenerator({
    env,
    credentials: agent.credentials,
    // Bound rather than passed bare: `fetch` on workerd is an unbound global,
    // and a method-shaped reference to it throws on call.
    fetch: (input, init) => fetch(input, init),
    emitDelta: (requestId, delta) => {
      emit("onAiStreamed", { requestId, delta });
    },
  });

  const voice = composeVoice({
    env,
    userId,
    kv,
    uiState: stores.uiState,
    emitAudio: (pcm) => {
      // A registry-declared binary channel: the transport packs the bytes
      // rather than base64-ing them into JSON (see BINARY_CHANNELS). COPIED out
      // of the reader's chunk, which the stream is free to reuse the moment
      // this returns.
      const audio = new ArrayBuffer(pcm.byteLength);
      new Uint8Array(audio).set(pcm);
      emit("onTtsAudio", { audio });
    },
    emitTranscript: (transcript) => {
      emit("onSttTranscript", transcript);
    },
    defer: (work) => {
      ctx.waitUntil(work);
    },
  });

  const captureInbox = new CaptureInbox({
    kv,
    vault,
    dailyPath,
    onApply: (event) => {
      emit("onCaptureApply", event);
    },
    now: () => Date.now(),
  });
  const capture = new CaptureService({
    kv,
    inbox: captureInbox,
    onNav: (event) => {
      emit("onDeepLinkNav", event);
    },
  });

  const announceProviders = (): void => {
    const snapshot = providerSettings(env, agent.credentials.selection(), (provider) =>
      agent.credentials.connected(provider),
    );
    if (snapshot !== null) emit("onAiProviderChanged", snapshot);
  };

  const handlers = collectHandlers((handle) => {
    registerCloudHandlers(handle, {
      stores,
      emit,
      vault,
      knowledge,
      agent: {
        env,
        userId,
        runner: agent.runner,
        chat: agent.chat,
        credentials: agent.credentials,
        origin: publicOrigin,
        scripted: agent.scripted,
        announce: announceProviders,
      },
      background: {
        delegations: agent.delegations,
        routines: agent.routines,
        snapshots: agent.snapshots,
      },
      ai,
      voice,
      capture: { inbox: captureInbox, service: capture },
    });
  });

  return {
    vault,
    knowledge,
    agent,
    ai,
    voice,
    captureInbox,
    capture,
    stores,
    tickets: new SocketTickets(ctx.storage.sql),
    limits: new HostLimits(ctx.storage.sql),
    prefix,
    handlers,
    publicOrigin,
    rememberOrigin: (origin) => {
      kv.put(LAST_ORIGIN_KEY, origin);
    },
    announceProviders,
    seedVault: async () => {
      if (!(await seedVault(vault))) return;
      // A seeded vault opens ON something. Written here rather than in the UI
      // because only the writer of those files knows which one is the landing
      // note, and the workspace restores this key on boot like any session.
      stores.uiState.update((current) => ({
        ...current,
        [UI_STATE_OPEN_NOTE_KEY]: SEED_OPEN_NOTE,
      }));
    },
  };
}
