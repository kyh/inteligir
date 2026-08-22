// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

// One Hono root splitting /api/v1 (the contract table), GET /ws (the
// invalidation bus), GET /pair/callback (the browser-approve landing), and a
// fallback — vite middlewares in dev, static client + the Start server entry's
// fetch in prod.

import { randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { resolve } from "node:path";
import { createNodeWebSocket } from "@hono/node-ws";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import { serveStatic } from "@hono/node-server/serve-static";
import type { HttpBindings } from "@hono/node-server";
import type { DbConnection } from "@repo/db/connection";
import { rebindThreadOrigins } from "@repo/db/threads";
import { API_ERROR_STATUS, type ApiErrorResponse } from "@repo/server-contract/errors";
import { API_BASE_PATH, apiRoutes, type AgentStatus } from "@repo/server-contract/routes";
import { WS_PATH } from "@repo/server-contract/notifications";
import { typedRoutes } from "@repo/typed-routes/typed-routes";
import { Hono, type Context, type MiddlewareHandler, type Next } from "hono";
import { PAIR_CALLBACK_PATH } from "@repo/cloud-contract/pairing";
import { CONNECTOR_OAUTH_CALLBACK_PATH } from "@repo/server-contract/connectors";
import { browserRequestProblem, buildLocalAppOrigins } from "./browser-request-guard";
import type { OpenExternalUrl } from "./cloud/browser-opener";
import { handlePairCallback } from "./cloud/pair-callback";
import { registerCloudRoutes } from "./cloud/routes";
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
import { registerConnectorRoutes } from "./connectors/routes";
import { registerFolderRoutes } from "./folders/routes";
import { registerNoteIntelligenceRoutes } from "./note-intelligence/routes";
import { buildContentSecurityPolicy } from "./csp";
import { CLI_SKILL_MD } from "./guide/cli-skill";
import { proveIdentity } from "./instance-identity";
import type { KnowledgeRuntime } from "./knowledge/knowledge-runtime";
import { renameNoteWithLinkRewrite } from "./knowledge/rename";
import { createCommentsService } from "./comments/comments-service";
import { registerCommentsRoutes } from "./comments/routes";
import { registerKnowledgeRoutes } from "./knowledge/routes";
import { registerAgentRoutes } from "./agent/agent-routes";
import { ProposalService } from "./proposals/proposal-service";
import { registerProposalRoutes } from "./proposals/routes";
import { registerThreadRoutes } from "./threads/routes";
import { ThreadService } from "./threads/service";
import type { CreateTurnDriver } from "./threads/turn-driver";
import { registerVaultRoutes } from "./vault/routes";
import type { VaultRuntime } from "./vault/vault-runtime";
import { registerVoiceRoutes } from "./voice/routes";
import {
  ScriptedVoiceService,
  ParakeetVoiceService,
  type VoiceService,
} from "./voice/voice-service";
import { VoiceStreamHub, type VoiceStreamConnection } from "./voice/voice-stream-hub";
import { VOICE_STREAM_PATH } from "@repo/server-contract/voice";
import type { WsBus } from "./ws-bus";

/** Thrown by the typed-routes validation wrapper; everything else is a 500. */
class ApiValidationError extends Error {}

type NodeMiddleware = (
  req: IncomingMessage,
  res: ServerResponse,
  next: (cause?: unknown) => void,
) => void;

export interface StartFetchOptions {
  context: { nonce: string };
}

export type AppFallback =
  | { kind: "dev"; middlewares: NodeMiddleware }
  | {
      kind: "prod";
      clientDir: string;
      /** The Start server entry's fetch. `context` is the request context Start
       *  threads into the router entry — this app puts the document's nonce
       *  there (src/router.tsx reads it back). */
      startFetch: (request: Request, options: StartFetchOptions) => Promise<Response>;
    }
  /** Tests: no UI behind the API — unmatched paths 404. */
  | { kind: "none" };

export interface CreateAppArgs {
  /** What the boot-time driver resolution decided; served on /system/status. */
  agent: AgentStatus;
  bus: WsBus;
  /** The sync loop's wire. main.ts supplies the real dial; injectable so a
   *  suite drives the whole loop without a network — and inert either way
   *  until someone pairs, since an install with no credential opens nothing. */
  cloudTransport?: CloudTransport;
  /** The app-owned MCP registry (issue #591); routes edit what sessions get. */
  connectors: ConnectorsService;
  /** The OAuth dance for hosted rows (issue #602); the callback route's owner. */
  connectorsOauth: ConnectorOauthFlow;
  /** Connected folders (issue #601): reference dirs sessions are told about. */
  folders: FoldersService;
  noteIntelligence: NoteIntelligence;
  config: AppConfig;
  /** The provider seam (agent-driver.ts resolves which driver boots). */
  createTurnDriver: CreateTurnDriver;
  /** The thread routes' store; system/status reads nothing from it (schemaVersion below). */
  db: DbConnection;
  fallback: AppFallback;
  /** This boot's secret (instance-identity.ts). Answers the identity challenge
   *  a client uses to tell this server from anything else holding the port. */
  instanceSecret: string;
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
 * tell a served file from the document render behind it. */
type AppEnv = { Bindings: HttpBindings; Variables: { staticFilePath?: string } };

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

export function createApp(args: CreateAppArgs) {
  const app = new Hono<AppEnv>();
  const nodeWebSocket = createNodeWebSocket({ app });
  const upgradeWebSocket = nodeWebSocket.upgradeWebSocket.bind(nodeWebSocket);
  const injectWebSocket = nodeWebSocket.injectWebSocket.bind(nodeWebSocket);

  const allowedOrigins = buildLocalAppOrigins(args.config.port);
  const guardBrowserRequest = async (c: Context, next: Next) => {
    const problem = browserRequestProblem(
      {
        host: c.req.header("host"),
        origin: c.req.header("origin"),
        secFetchSite: c.req.header("sec-fetch-site"),
      },
      allowedOrigins,
    );
    if (problem !== null) {
      const body: ApiErrorResponse = {
        error: "forbidden_origin",
        message: problem,
      };
      return c.json(body, API_ERROR_STATUS.forbidden_origin);
    }
    await next();
    return undefined;
  };

  const api = new Hono();
  api.use("*", guardBrowserRequest);
  api.onError((error, context) => {
    if (error instanceof ApiValidationError) {
      const body: ApiErrorResponse = {
        error: "invalid_request",
        message: error.message,
      };
      return context.json(body, API_ERROR_STATUS.invalid_request);
    }
    // Never echo internals: the full error goes to the server log only.
    console.error(`api error on ${context.req.method} ${context.req.path}`, error);
    const body: ApiErrorResponse = {
      error: "internal",
      message: "Internal server error",
    };
    return context.json(body, API_ERROR_STATUS.internal);
  });
  const registrars = typedRoutes(api, {
    onValidationError: (message) => new ApiValidationError(message),
  });
  const { get, post } = registrars;

  get(apiRoutes.health, (c) => c.json({ ok: true }));
  get(apiRoutes.system.status, (c) =>
    c.json({
      version: args.version,
      dataDir: args.config.dataDir,
      vaultDir: args.config.vaultDir,
      schemaVersion: args.schemaVersion,
      uptimeMs: Date.now() - args.startedAt,
      agent: args.agent,
    }),
  );
  // Answers a caller's nonce with an HMAC keyed by this boot's secret, so a
  // client can tell THIS server from anything else that reached the port
  // first. Deliberately unauthenticated and unthrottled: the answer is worth
  // nothing without the secret, and refusing to answer would only stop the
  // legitimate client. The secret itself never leaves the process.
  get(apiRoutes.system.identity, (c, query) =>
    c.json({
      proof: proveIdentity(args.instanceSecret, query.challenge),
      dataDir: args.config.dataDir,
    }),
  );
  get(apiRoutes.guide, (c) => c.json({ markdown: CLI_SKILL_MD }));
  registerVaultRoutes(registrars, args.vault, (from, to) =>
    renameNoteWithLinkRewrite({
      service: args.vault.service,
      knowledge: args.knowledge,
      rebindThreads: (movedFrom, movedTo) =>
        rebindThreadOrigins(args.db, args.bus, { from: movedFrom, to: movedTo }),
      from,
      to,
    }),
  );
  registerKnowledgeRoutes(registrars, args.knowledge);

  // The sidecar rides the vault service, so containment, the watcher ping,
  // auto-commit and sync come with it; timestamps are unix seconds minted at
  // this boundary (issue #583).
  registerCommentsRoutes(
    registrars,
    createCommentsService(args.vault.service, () => Math.floor(Date.now() / 1000)),
  );

  registerConnectorRoutes(
    registrars,
    args.connectors,
    args.connectorsOauth,
    args.openExternalUrl ?? systemOpenExternalUrl,
  );
  registerFolderRoutes(registrars, args.folders);
  registerNoteIntelligenceRoutes(registrars, args.noteIntelligence);

  // Detect + guide: harness CLI/credential facts for Settings (issue #588).
  registerAgentRoutes(registrars);

  // `scripted` is selected by INTELIGIR_VOICE and is the whole reason the
  // scenario suite can drive a microphone: it answers `ready` with no model on
  // disk and no native binding loaded, so everything ABOVE the decode — the
  // permission, the capture, the wire, the composer insertion — is real.
  const voice: VoiceService =
    args.config.voice === "scripted"
      ? new ScriptedVoiceService()
      : new ParakeetVoiceService({ modelDir: args.config.modelDir });
  registerVoiceRoutes(registrars, voice);
  const voiceStreamHub = new VoiceStreamHub(voice);

  registerProposalRoutes({
    routes: { get, post },
    service: new ProposalService({
      db: args.db,
      notifier: args.bus,
      vault: args.vault.service,
    }),
  });

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
  registerCloudRoutes(registrars, cloud);
  registerThreadRoutes(registrars, threads);

  // Unmatched API paths answer JSON here — an API caller must never receive
  // the SPA shell or a Vite page from the fallthrough below.
  api.all("*", (c) => {
    const body: ApiErrorResponse = { error: "not_found", message: "Not found" };
    return c.json(body, API_ERROR_STATUS.not_found);
  });

  app.route(API_BASE_PATH, api);

  app.get(
    WS_PATH,
    guardBrowserRequest,
    upgradeWebSocket(() => ({
      onOpen: (_event, socket) => args.bus.registerClient(socket),
      onMessage: (event, socket) => args.bus.handleMessage(socket, event.data),
      onClose: (_event, socket) => args.bus.unregisterClient(socket),
    })),
  );

  // Beside `/ws`, behind the SAME guard, but its OWN endpoint: a dictation
  // socket carries PCM16 frames UP and `partial`/`final`/`error` messages DOWN
  // (issue #578) — a PAYLOAD, which the invalidation bus carries none of by
  // decision. Not a contract row for the reason `/ws` is not (a websocket is
  // neither a request/response pair nor something the typed client reaches), so
  // the route-table guard exempts it exactly as it exempts `/ws`. The hub tracks
  // every connection so the listener teardown can close them by name.
  app.get(
    VOICE_STREAM_PATH,
    guardBrowserRequest,
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

  // Beside the upgrade above and for the mirror-image reason: `/ws` is not a
  // contract row because a websocket is not a request/response pair, and this
  // one is not because what arrives is a BROWSER expecting a page. It carries
  // no origin guard either — the redirect that reaches it IS a cross-site
  // top-level navigation, which is exactly what that guard refuses — and the
  // single-use `state` the runtime is holding stands in its place.
  // `cloud/pair-callback.ts` states the whole argument.
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

  const fallback = args.fallback;
  if (fallback.kind === "dev") {
    app.all("*", (c) => {
      const { incoming, outgoing } = c.env;
      fallback.middlewares(incoming, outgoing, (cause?: unknown) => {
        if (cause !== undefined && cause !== null) {
          console.error("vite middleware error", cause);
          if (!outgoing.headersSent) {
            outgoing.statusCode = 500;
          }
          outgoing.end();
          return;
        }
        if (!outgoing.headersSent) {
          outgoing.statusCode = 404;
          outgoing.end("Not found");
        }
      });
      return RESPONSE_ALREADY_SENT;
    });
  }

  if (fallback.kind === "prod") {
    const clientDir = resolve(fallback.clientDir);
    const wsOrigin = `ws://127.0.0.1:${args.config.port}`;
    const serveClientFile = serveStatic<AppEnv>({
      root: clientDir,
      onFound: (path, c) => {
        c.set("staticFilePath", path);
      },
    });
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

    // ONE answer per URL, and it is the Start entry's, never a prerendered
    // file. A build-time shell is stale by construction — its head is rendered
    // against the whole manifest while its dehydrated payload names only
    // __root__, and being a file it can carry no per-request nonce. The entry
    // answers the URL that was actually asked for, so what the client hydrates
    // is what the client is about to render, and Start threads the nonce
    // through its own renderer. `ssr: false` on the workspace route
    // (src/routes/index.tsx) is what keeps that answer a SHELL rather than an
    // SSR of a browser-only tree.
    const renderDocument = async (request: Request): Promise<Response> => {
      const nonce = randomBytes(16).toString("base64");
      const response = await fallback.startFetch(request, { context: { nonce } });
      // Rebuilt rather than mutated: a Response the entry streams may carry
      // immutable headers, and a header set that silently no-ops would ship a
      // document with no policy on it.
      const headers = new Headers(response.headers);
      headers.set("cache-control", STATIC_NO_STORE_CACHE_CONTROL);
      // The document is the only response that can execute anything, so it is
      // the only one that carries the policy.
      headers.set("content-security-policy", buildContentSecurityPolicy({ nonce, wsOrigin }));
      headers.set("x-content-type-options", "nosniff");
      headers.set("referrer-policy", "no-referrer");
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
    };

    app.on(
      ["GET", "HEAD"],
      "*",
      staticCacheControl(STATIC_NO_STORE_CACHE_CONTROL),
      serveClientFile,
      (c): Promise<Response> => renderDocument(c.req.raw),
    );

    app.all("*", (c) => renderDocument(c.req.raw));
  }

  // Last, so nothing dials the cloud until the routes it will announce
  // invalidations through are mounted.
  cloud.start();

  return { app, cloud, injectWebSocket, voice, voiceStreamHub };
}
