// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

// One Hono root splitting /rpc (the oRPC handler), the four routes that are
// deliberately not procedures (`@repo/api/local/routes` says why), the
// two browser landings, and — when this install ships one — the built
// workspace UI as static files. Everything but /health and the landings is
// behind the device token (server-file.ts).

import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createNodeWebSocket } from "@hono/node-ws";
import { serveStatic } from "@hono/node-server/serve-static";
import type { DbConnection } from "@repo/db/connection";
import { rebindThreadOrigins } from "@repo/db/threads";
import {
  HEALTH_PATH,
  RPC_PREFIX,
  VAULT_ASSET_PATH,
  VOICE_STREAM_PATH,
  WS_PATH,
} from "@repo/api/local/routes";
import type { AgentStatus } from "@repo/api/local/system/system-schema";
import { onError, ORPCError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/fetch";
import { Hono, type Context, type MiddlewareHandler, type Next } from "hono";
import { PAIR_CALLBACK_PATH } from "@repo/api/cloud/pairing/pairing-schema";
import { CONNECTOR_OAUTH_CALLBACK_PATH } from "@repo/api/local/connectors/connectors-schema";
import type { OpenExternalUrl } from "./cloud/browser-opener";
import { handlePairCallback } from "./cloud/pair-callback";
import {
  createCloudRuntime,
  type CloudRuntimeArgs,
  type CloudTransport,
} from "./cloud/sync-runtime";
import type { AppConfig } from "./config";
import type { ConnectorsService } from "./connectors/connectors-service";
import { handleConnectorOauthCallback } from "./connectors/oauth-callback";
import type { ConnectorOauthFlow } from "./connectors/oauth-flow";
import { systemOpenExternalUrl } from "./cloud/browser-opener";
import type { FoldersService } from "./folders/folders-service";
import type { NoteIntelligence } from "./note-intelligence/note-intelligence";
import { websocketOrigin } from "@repo/api/local/routes";
import { documentSecurityHeaders } from "./csp";
import { loopbackRequestOrigin } from "./loopback-origin";
import { presentedToken, serverTokenCookie, tokenAccepted } from "./server-file";
import type { KnowledgeRuntime } from "./knowledge/knowledge-runtime";
import { renameNoteWithLinkRewrite } from "./knowledge/rename";
import { createCommentsService } from "./comments/comments-service";
import type { AppContext } from "./orpc";
import { ProposalService } from "./proposals/proposal-service";
import { localRouter } from "./root-router";
import { ThreadService } from "./threads/service";
import type { CreateTurnDriver } from "./threads/turn-driver";
import { handleVaultAsset } from "./vault/asset-route";
import type { VaultRuntime } from "./vault/vault-runtime";
import {
  ScriptedVoiceService,
  ParakeetVoiceService,
  type VoiceService,
} from "./voice/voice-service";
import { VoiceStreamHub, type VoiceStreamConnection } from "./voice/voice-stream-hub";
import type { WsBus } from "./ws-bus";

export interface CreateAppArgs {
  /** What the boot-time driver resolution decided; served on system.status. */
  agent: AgentStatus;
  bus: WsBus;
  /** The sync loop's wire. main.ts supplies the real dial; injectable so a
   *  suite drives the whole loop without a network — and inert either way
   *  until someone pairs, since an install with no credential opens nothing. */
  cloudTransport?: CloudTransport;
  /** The app-owned MCP registry (issue #591); the connectors procedures edit
   *  what sessions get. */
  connectors: ConnectorsService;
  /** The OAuth dance for hosted rows (issue #602); the callback route's owner. */
  connectorsOauth: ConnectorOauthFlow;
  /** Connected folders (issue #601): reference dirs sessions are told about. */
  folders: FoldersService;
  noteIntelligence: NoteIntelligence;
  config: AppConfig;
  /** The provider seam (agent-driver.ts resolves which driver boots). */
  createTurnDriver: CreateTurnDriver;
  /** The thread procedures' store; system.status reads nothing from it. */
  db: DbConnection;
  /** The workspace UI this server answers, or null when it has none. The
   *  bundle is the DESKTOP renderer's build, staged beside this program so
   *  `inteligir serve --open` lands a browser in the product; null is a
   *  checkout that has not built one, and every route suite. */
  clientDir: string | null;
  /** This boot's bearer (server-file.ts). Every privileged surface requires
   *  it; the data dir it was written into is what makes holding it meaningful. */
  serverToken: string;
  knowledge: KnowledgeRuntime;
  /** Tests: watch a pairing send the user to their browser without a window
   *  opening on whoever ran the suite. */
  openExternalUrl?: OpenExternalUrl;
  /** Resolved once at boot, after migrate — not a SELECT per status request. */
  schemaVersion: number;
  startedAt: number;
  vault: VaultRuntime;
  version: string;
}

const STATIC_ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";
const STATIC_NO_STORE_CACHE_CONTROL = "no-store";

/** Marks a request `serveStatic` answered, so the cache-control wrapper can
 * tell a served file from the shell behind it. */
type AppEnv = { Variables: { staticFilePath?: string } };

// Set after the chain answers: serveStatic's own onFound header writes land
// after it has already built its Response, so they never reach the wire — the
// wrapper stamps the finalized response instead.
const staticCacheControl =
  (cacheControl: string): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    await next();
    if (c.get("staticFilePath") !== undefined) {
      c.res.headers.set("cache-control", cacheControl);
    }
  };

/** Below this, a refusal is normal control flow rather than a server fault: a
 *  missing row, a rejected input, a conflict a client is expected to merge.
 *  Logging those would be noise, and the log is the only place internals may
 *  appear at all. */
const SERVER_FAULT_STATUS = 500;

export function createApp(args: CreateAppArgs) {
  const app = new Hono<AppEnv>();
  const nodeWebSocket = createNodeWebSocket({ app });
  const upgradeWebSocket = nodeWebSocket.upgradeWebSocket.bind(nodeWebSocket);
  const injectWebSocket = nodeWebSocket.injectWebSocket.bind(nodeWebSocket);

  // THE ONE GATE, and it sits at the HTTP boundary rather than in a procedure
  // middleware because three of the four surfaces it protects are not
  // procedures: the invalidation bus, the dictation stream and the vault's
  // asset bytes. A gate per transport is a gate that can disagree with itself.
  //
  // `/health` is deliberately outside it — a supervisor's spawn probe must
  // answer before it has any reason to hold a credential, and `{ok:true}`
  // discloses nothing a bound port does not.
  //
  // The two browser landings (`/pair/callback`, the connector OAuth callback)
  // are outside it too, and cannot be inside it: what arrives is a cross-site
  // top-level navigation carrying no credential by construction. Their
  // single-use `state` stands in its place, which is the whole argument
  // `cloud/pair-callback.ts` states.
  const requireServerToken = async (c: Context, next: Next) => {
    if (
      !tokenAccepted(
        args.serverToken,
        presentedToken({
          authorization: c.req.header("authorization"),
          cookie: c.req.header("cookie"),
        }),
      )
    ) {
      return c.text("This request carried no valid inteligir device token", 401);
    }
    await next();
    return undefined;
  };

  // `scripted` is selected by INTELIGIR_VOICE and is the whole reason the
  // scenario suite can drive a microphone: it answers `ready` with no model on
  // disk and no native binding loaded, so everything ABOVE the decode — the
  // permission, the capture, the wire, the composer insertion — is real.
  const voice: VoiceService =
    args.config.voice === "scripted"
      ? new ScriptedVoiceService()
      : new ParakeetVoiceService({ modelDir: args.config.modelDir });
  const voiceStreamHub = new VoiceStreamHub(voice);

  // Built BEFORE the thread service, which needs its outbox hook at
  // construction; the ingest sink goes back the other way once that service
  // exists. An install with no credential in its data dir starts nothing here.
  const cloudArgs: CloudRuntimeArgs = {
    db: args.db,
    dataDir: args.config.dataDir,
    cloudUrl: args.config.cloudUrl,
    vault: args.vault.service,
  };
  if (args.cloudTransport !== undefined) cloudArgs.transport = args.cloudTransport;
  if (args.openExternalUrl !== undefined) cloudArgs.openExternalUrl = args.openExternalUrl;
  const cloud = createCloudRuntime(cloudArgs);
  const threads = new ThreadService({
    db: args.db,
    notifier: args.bus,
    createTurnDriver: args.createTurnDriver,
    sync: cloud,
  });
  cloud.attach(threads);

  // Everything a handler can reach, built once. The comments sidecar rides the
  // vault service, so containment, the watcher ping, auto-commit and sync come
  // with it; its timestamps are unix seconds minted at this boundary (#583).
  const services = {
    cloud,
    comments: createCommentsService(args.vault.service, () => Math.floor(Date.now() / 1000)),
    connectors: args.connectors,
    connectorsOauth: args.connectorsOauth,
    folders: args.folders,
    knowledge: args.knowledge,
    noteIntelligence: args.noteIntelligence,
    openExternalUrl: args.openExternalUrl ?? systemOpenExternalUrl,
    proposals: new ProposalService({
      db: args.db,
      notifier: args.bus,
      vault: args.vault.service,
    }),
    renameNote: (from: string, to: string) =>
      renameNoteWithLinkRewrite({
        service: args.vault.service,
        knowledge: args.knowledge,
        rebindThreads: (movedFrom, movedTo) =>
          rebindThreadOrigins(args.db, args.bus, { from: movedFrom, to: movedTo }),
        from,
        to,
      }),
    system: {
      version: args.version,
      dataDir: args.config.dataDir,
      vaultDir: args.config.vaultDir,
      schemaVersion: args.schemaVersion,
      startedAt: args.startedAt,
      agent: args.agent,
    },
    threads,
    vault: args.vault,
    voice,
  } satisfies Omit<AppContext, "requestHost">;

  const rpc = new RPCHandler(localRouter, {
    interceptors: [
      onError((cause: unknown) => {
        // Never echo internals: the full error goes to the server log only,
        // and only for the classes that are genuinely faults.
        if (cause instanceof ORPCError && cause.status < SERVER_FAULT_STATUS) {
          return;
        }
        console.error("rpc error", cause);
      }),
    ],
  });

  app.use(`${RPC_PREFIX}/*`, requireServerToken);
  app.all(`${RPC_PREFIX}/*`, async (c) => {
    const { response } = await rpc.handle(c.req.raw, {
      prefix: RPC_PREFIX,
      context: { ...services, requestHost: c.req.header("host") },
    });
    return response ?? c.text("Not found", 404);
  });

  app.get(HEALTH_PATH, (c) => c.json({ ok: true } as const));

  app.get(VAULT_ASSET_PATH, requireServerToken, (c) => handleVaultAsset(c, args.vault.service));

  app.get(
    WS_PATH,
    requireServerToken,
    upgradeWebSocket(() => ({
      onOpen: (_event, socket) => args.bus.registerClient(socket),
      onMessage: (event, socket) => args.bus.handleMessage(socket, event.data),
      onClose: (_event, socket) => args.bus.unregisterClient(socket),
    })),
  );

  // Beside `/ws`, behind the SAME gate, but its OWN endpoint: a dictation
  // socket carries PCM16 frames UP and `partial`/`final`/`error` messages DOWN
  // (issue #578) — a PAYLOAD, which the invalidation bus carries none of by
  // decision. The hub tracks every connection so the listener teardown can
  // close them by name.
  app.get(
    VOICE_STREAM_PATH,
    requireServerToken,
    upgradeWebSocket(() => {
      let connection: VoiceStreamConnection | null = null;
      return {
        onOpen: (_event, socket) => {
          connection = voiceStreamHub.open(socket);
        },
        onMessage: (event) => {
          connection?.receive(event.data);
        },
        onClose: () => {
          void connection?.dispose();
          connection = null;
        },
      };
    }),
  );

  // Beside the upgrades above and for the mirror-image reason: those are not
  // procedures because a websocket is not a request/response pair, and this one
  // is not because what arrives is a BROWSER expecting a page. It carries no
  // token either — the redirect that reaches it IS a cross-site top-level
  // navigation, which cannot carry one — and the single-use `state` the runtime
  // is holding stands in its place. `cloud/pair-callback.ts` states the whole
  // argument.
  app.get(PAIR_CALLBACK_PATH, async (c) => {
    const answer = await handlePairCallback(cloud, new URL(c.req.url));
    return c.body(answer.body, answer.status, answer.headers);
  });

  // The connectors' own browser landing (issue #602) — same argument, same
  // shape, a different provider on the far side (`connectors/oauth-callback.ts`).
  app.get(CONNECTOR_OAUTH_CALLBACK_PATH, async (c) => {
    const answer = await handleConnectorOauthCallback(args.connectorsOauth, new URL(c.req.url));
    return c.body(answer.body, answer.status, answer.headers);
  });

  if (args.clientDir !== null) {
    const clientDir = resolve(args.clientDir);
    /** The document's policy names the socket origin the CALLER reached, taken
     *  from its own Host header rather than the configured port — a dev port
     *  may have been probed upward at bind, and `connect-src` naming the value
     *  that was asked for rather than the one that answered is a policy that
     *  refuses this app's own invalidation socket. Falls back to the configured
     *  port for a request that names no loopback host. */
    // Read ONCE: the bundle is staged at build time and immutable for this
    // process's life, so re-reading it is a disk hit per deep link.
    const shellDocument = readFileSync(join(clientDir, "index.html"), "utf8");
    const configuredOrigin = `http://127.0.0.1:${String(args.config.port)}`;
    const documentHeadersFor = (host: string | undefined): Record<string, string> =>
      documentSecurityHeaders({
        wsOrigin: websocketOrigin(loopbackRequestOrigin(host) ?? configuredOrigin),
      });
    const serveClientFile = serveStatic<AppEnv>({
      root: clientDir,
      onFound: (path, c) => {
        c.set("staticFilePath", path);
      },
    });

    /**
     * The document's own headers, stamped by CONTENT TYPE rather than by
     * route, because two producers answer one: `serveStatic` hands back
     * `index.html` for `/` itself, and the fallback below reads the same file
     * for every deep link the router owns. A rule per producer is two rules
     * that can disagree about the policy on the same bytes.
     *
     * This is also where the browser gets its credential: it is the one client
     * that cannot set a header for itself (server-file.ts says why), and the
     * document is the one response it is guaranteed to receive first.
     */
    const documentHeaders: MiddlewareHandler<AppEnv> = async (c, next) => {
      await next();
      if (!(c.res.headers.get("content-type") ?? "").includes("text/html")) {
        return;
      }
      c.res.headers.set("cache-control", STATIC_NO_STORE_CACHE_CONTROL);
      for (const [name, value] of Object.entries(documentHeadersFor(c.req.header("host")))) {
        c.res.headers.set(name, value);
      }
      c.res.headers.set("set-cookie", serverTokenCookie(args.serverToken));
    };

    // Only /assets/* carries content hashes, so only it may be immutable —
    // and an asset miss must 404: answering it with the shell hands the
    // module loader HTML and produces an opaque MIME error instead.
    app.on(
      ["GET", "HEAD"],
      "/assets/*",
      staticCacheControl(STATIC_ASSET_CACHE_CONTROL),
      serveClientFile,
      (c) => c.text("Not found", 404),
    );

    // ONE answer per URL and it is a FILE: the router reads the URL
    // client-side, so every deep link is the same document.
    app.on(
      ["GET", "HEAD"],
      "*",
      documentHeaders,
      staticCacheControl(STATIC_NO_STORE_CACHE_CONTROL),
      serveClientFile,
      (c) => c.html(shellDocument),
    );
  }

  // Last, so nothing dials the cloud until the surfaces it will announce
  // invalidations through are mounted.
  cloud.start();

  // `services` is returned so a suite can call procedures IN-PROCESS through
  // `createRouterClient` instead of over a socket — the same graph, minus the
  // wire.
  return { app, cloud, injectWebSocket, services, voice, voiceStreamHub };
}
