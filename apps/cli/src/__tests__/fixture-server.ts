import { createServer } from "node:http";
import { implement, ORPCError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/node";
import { localContract } from "@repo/contract/local";
import type { CloudStatusResponse } from "@repo/contract/local/cloud/cloud-schema";
import { RPC_PREFIX } from "@repo/contract/local/routes";
import type { AgentStatus, SystemStatusResponse } from "@repo/contract/local/system/system-schema";
import type { ThreadTimeline } from "@repo/contract/local/thread-timeline";
import type {
  PendingInteraction,
  QueuedThreadMessage,
  Thread,
} from "@repo/contract/local/threads/threads-schema";
import type { ThreadStatus } from "@repo/domain/thread-status";
import { boundAddressSchema } from "../server/__tests__/bound-address";

// required so a command that reaches the wire without the bearer fails rather than passes.
export const FIXTURE_SERVER_TOKEN = "fixture-server-token";

export const FIXTURE_HANDOFF_NONCE = "fixture-handoff";

const FIXTURE_CLOUD_URL = "https://cloud.fixture";

export interface FixtureThread {
  thread: Thread;
  pendingInteractions: PendingInteraction[];
  queuedMessages?: QueuedThreadMessage[];
  timeline: ThreadTimeline;
  // each threads.get consumes one entry; the last one sticks.
  statusSequence?: ThreadStatus[];
}

export interface FixtureState {
  dataDir: string;
  failWith: { code: "BAD_REQUEST" | "INTERNAL_SERVER_ERROR"; message: string } | null;
  refuseSend: { code: "PROVIDER_UNAVAILABLE"; message: string } | null;
  // false: the server of an unbuilt checkout, which mints no browser handoff.
  servesUi: boolean;
  cloud: CloudStatusResponse;
  threads: FixtureThread[];
  agent: AgentStatus;
  nextCreatedThreadId: string;
}

export const EMPTY_TIMELINE: ThreadTimeline = { maxSequence: 0, rows: [], tokenUsage: null };

export const makeThread = (overrides: Partial<Thread> & Pick<Thread, "id">): Thread => ({
  activeTurnId: null,
  archivedAt: null,
  createdAt: 1_700_000_000_000,
  providerId: null,
  runsElsewhere: false,
  status: "idle",
  title: null,
  updatedAt: 1_700_000_000_000,
  ...overrides,
});

export const makeInteraction = (
  overrides: Partial<PendingInteraction> & Pick<PendingInteraction, "id" | "threadId">,
): PendingInteraction => ({
  createdAt: 1_700_000_000_000,
  payload: null,
  requestKey: `req_${overrides.id}`,
  resolution: null,
  resolvedAt: null,
  status: "pending",
  turnId: "turn_1",
  ...overrides,
});

export const makeFixtureState = (): FixtureState => ({
  agent: { detail: null, mode: "auto", runtime: "unavailable" },
  cloud: { cloudUrl: FIXTURE_CLOUD_URL, revokeError: null, state: "signed-out" },
  dataDir: "/fixture/data",
  failWith: null,
  nextCreatedThreadId: "thr_created_1",
  refuseSend: null,
  servesUi: true,
  threads: [],
});

const findThread = (state: FixtureState, threadId: string): FixtureThread | undefined =>
  state.threads.find((entry) => entry.thread.id === threadId);

const base = implement(localContract).$context<FixtureState>();

const cloudRouter = {
  login: base.cloud.login.handler(({ context, input }) => {
    context.cloud = {
      accountEmail: input.email,
      cloudUrl: FIXTURE_CLOUD_URL,
      connected: false,
      cursor: 0,
      deviceId: `dev_${input.deviceName ?? "fixture-host"}`,
      dropped: 0,
      lastError: null,
      lastSyncedAt: null,
      pending: 0,
      state: "signed-in",
    };
    return context.cloud;
  }),
  logout: base.cloud.logout.handler(({ context }) => {
    context.cloud = { cloudUrl: FIXTURE_CLOUD_URL, revokeError: null, state: "signed-out" };
    return context.cloud;
  }),
  // no verb reaches these; the contract asks every server to answer them
  deleteAccount: base.cloud.deleteAccount.handler(({ errors }) => {
    throw errors.PRECONDITION_FAILED({ message: "no account in the fixture" });
  }),
  devices: base.cloud.devices.handler(() => ({ devices: [] })),
  prefs: base.cloud.prefs.handler(() => ({ phoneRequests: true })),
  revokeDevice: base.cloud.revokeDevice.handler(({ errors }) => {
    throw errors.NOT_FOUND({ message: "no devices in the fixture" });
  }),
  setPrefs: base.cloud.setPrefs.handler(({ input }) => input),
  signUp: base.cloud.signUp.handler(({ errors }) => {
    throw errors.FORBIDDEN({ message: "no invite in the fixture" });
  }),
  status: base.cloud.status.handler(({ context }) => context.cloud),
  syncNow: base.cloud.syncNow.handler(({ context }) => context.cloud),
};

const systemRouter = {
  browserHandoff: base.system.browserHandoff.handler(({ context, errors }) => {
    if (!context.servesUi) {
      throw errors.NOT_FOUND({ message: "This server serves no UI (an unbuilt checkout)." });
    }
    return { nonce: FIXTURE_HANDOFF_NONCE };
  }),
  status: base.system.status.handler(({ context }) => {
    const status: SystemStatusResponse = {
      agent: context.agent,
      dataDir: context.dataDir,
      schemaVersion: 3,
      uptimeMs: 65_000,
      version: "9.9.9-fixture",
    };
    return status;
  }),
};

const threadsRouter = {
  answerInteraction: base.threads.answerInteraction.handler(({ context, input, errors }) => {
    const entry = findThread(context, input.threadId);
    const interaction = entry?.pendingInteractions.find((row) => row.id === input.interactionId);
    if (entry === undefined || interaction === undefined) {
      throw errors.NOT_FOUND({ message: "Interaction not found" });
    }
    const resolved: PendingInteraction = {
      ...interaction,
      resolution: input.resolution,
      resolvedAt: 1_700_000_002_000,
      status: "resolved",
    };
    entry.pendingInteractions = entry.pendingInteractions.map((row) =>
      row.id === resolved.id ? resolved : row,
    );
    return { interaction: resolved };
  }),
  archive: base.threads.archive.handler(({ context, input, errors }) => {
    const entry = findThread(context, input.threadId);
    if (entry === undefined) {
      throw errors.NOT_FOUND({ message: "Not found" });
    }
    entry.thread = { ...entry.thread, archivedAt: 1_700_000_001_000 };
    return { thread: entry.thread };
  }),
  create: base.threads.create.handler(({ context, input }) => {
    const overrides: Partial<Thread> & Pick<Thread, "id"> = { id: context.nextCreatedThreadId };
    if (input.title !== undefined) {
      overrides.title = input.title;
    }
    const thread = makeThread(overrides);
    context.threads.push({ pendingInteractions: [], thread, timeline: EMPTY_TIMELINE });
    return { thread };
  }),
  get: base.threads.get.handler(({ context, input, errors }) => {
    const entry = findThread(context, input.threadId);
    if (entry === undefined) {
      throw errors.NOT_FOUND({ message: "Not found" });
    }
    const nextStatus = entry.statusSequence?.shift();
    if (nextStatus !== undefined) {
      entry.thread = { ...entry.thread, status: nextStatus };
    }
    return {
      pendingInteractions: entry.pendingInteractions,
      queuedMessages: entry.queuedMessages ?? [],
      thread: entry.thread,
    };
  }),
  interrupt: base.threads.interrupt.handler(({ context, input, errors }) => {
    const entry = findThread(context, input.threadId);
    if (entry === undefined) {
      throw errors.NOT_FOUND({ message: "Not found" });
    }
    if (entry.thread.status === "idle" || entry.thread.status === "error") {
      return { stop: "not-running", thread: entry.thread };
    }
    entry.thread = { ...entry.thread, status: "stopping" };
    return { stop: "requested", thread: entry.thread };
  }),
  // one page whatever the limit: paging is the real composition's (action-list.test.ts).
  list: base.threads.list.handler(({ context, input }) => ({
    nextCursor: null,
    threads: context.threads
      .map((entry) => entry.thread)
      .filter((thread) => input.includeArchived === true || thread.archivedAt === null),
  })),
  listInteractions: base.threads.listInteractions.handler(({ context, input }) => ({
    interactions: context.threads
      .filter((entry) => input.threadId === undefined || entry.thread.id === input.threadId)
      .flatMap((entry) => entry.pendingInteractions),
  })),
  send: base.threads.send.handler(({ context, input, errors }) => {
    const entry = findThread(context, input.threadId);
    if (entry === undefined) {
      throw errors.NOT_FOUND({ message: "Not found" });
    }
    const refusal = context.refuseSend;
    if (refusal !== null) {
      throw errors.PROVIDER_UNAVAILABLE({ message: refusal.message });
    }
    return { kind: "started", turnId: `turn_for_${input.threadId}` };
  }),
  timeline: base.threads.timeline.handler(({ context, input, errors }) => {
    const entry = findThread(context, input.threadId);
    if (entry === undefined) {
      throw errors.NOT_FOUND({ message: "Not found" });
    }
    return { kind: "full", timeline: entry.timeline };
  }),
};

// a middleware rather than a handler interceptor, so the refusal reaches the client as an ORPCError like a real one.
const fixtureRouter = base
  .use(({ context, next }) => {
    const failure = context.failWith;
    if (failure !== null) {
      throw new ORPCError(failure.code, { message: failure.message });
    }
    return next();
  })
  .router({
    cloud: cloudRouter,
    system: systemRouter,
    threads: threadsRouter,
  });

export interface FixtureServer {
  baseUrl: string;
  close: () => Promise<void>;
}

export const serveFixture = async (state: FixtureState): Promise<FixtureServer> => {
  const handler = new RPCHandler(fixtureRouter);
  const server = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${FIXTURE_SERVER_TOKEN}`) {
      response.writeHead(401, { "content-type": "text/plain" });
      response.end("This request carried no valid inteligir device token");
      return;
    }
    void (async () => {
      const { matched } = await handler.handle(request, response, {
        context: state,
        prefix: RPC_PREFIX,
      });
      if (!matched) {
        response.writeHead(404, { "content-type": "text/plain" });
        response.end("Not found");
      }
    })();
  });
  // oxlint-disable-next-line promise/avoid-new -- bridges the http server's "listening" callback
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = boundAddressSchema.parse(server.address());
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: async () => {
      // oxlint-disable-next-line promise/avoid-new -- bridges the http server's close callback
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    },
  };
};
