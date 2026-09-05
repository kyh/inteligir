import { createServer } from "node:http";
import { implement, ORPCError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/node";
import { localContract } from "@repo/api/local";
import type { CloudStatusResponse } from "@repo/api/local/cloud/cloud-schema";
import type { CommentThreadWire } from "@repo/api/local/comments/comments-schema";
import type { ConnectorsResponse } from "@repo/api/local/connectors/connectors-schema";
import type { ConnectedFoldersResponse } from "@repo/api/local/folders/folders-schema";
import {
  KNOWLEDGE_MATCHES_DEFAULT_LIMIT,
  KNOWLEDGE_UNLINKED_DEFAULT_LIMIT,
  type BacklinkEntryWire,
  type RelatedNoteWire,
  type SearchResultWire,
  type TagCountWire,
} from "@repo/api/local/knowledge/knowledge-schema";
import { docStem } from "@repo/notes/knowledge/doc-file";
import { collectVaultMatches } from "@repo/notes/knowledge/text-matches";
import { findUnlinkedMentions, mentionNames } from "@repo/notes/knowledge/unlinked-mentions";
import { RPC_PREFIX } from "@repo/api/local/routes";
import type { AgentStatus, SystemStatusResponse } from "@repo/api/local/system/system-schema";
import type { ThreadTimeline } from "@repo/api/local/thread-timeline";
import type {
  PendingInteraction,
  QueuedThreadMessage,
  Thread,
} from "@repo/api/local/threads/threads-schema";
import {
  type VaultEntry,
  type VaultRevision,
  type VaultStatusResponse,
} from "@repo/api/local/vault/vault-schema";
import type { ThreadStatus } from "@repo/domain/thread-status";
import { boundAddressSchema } from "../server/__tests__/bound-address";

// required so a command that reaches the wire without the bearer fails rather than passes.
export const FIXTURE_SERVER_TOKEN = "fixture-server-token";

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
  vault: Map<string, string>;
  // newest first.
  revisions: Map<string, { revision: VaultRevision; content: string }[]>;
  searchResults: SearchResultWire[];
  tags: TagCountWire[];
  backlinks: BacklinkEntryWire[];
  related: RelatedNoteWire[];
  connectors: ConnectorsResponse;
  folders: ConnectedFoldersResponse;
  cloud: CloudStatusResponse;
  threads: FixtureThread[];
  comments: Map<string, CommentThreadWire[]>;
  guideMarkdown: string;
  agent: AgentStatus;
  vaultStatus: VaultStatusResponse;
  nextCreatedThreadId: string;
}

export const EMPTY_TIMELINE: ThreadTimeline = { rows: [], maxSequence: 0, tokenUsage: null };

export function makeThread(overrides: Partial<Thread> & Pick<Thread, "id">): Thread {
  return {
    title: null,
    status: "idle",
    activeTurnId: null,
    originDocPath: null,
    providerId: null,
    archivedAt: null,
    createdAt: 1_700_000_000_000,
    updatedAt: 1_700_000_000_000,
    ...overrides,
  };
}

export const FIXTURE_REVISION_SHA = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c";

export function makeRevision(
  overrides: Partial<VaultRevision> & Pick<VaultRevision, "sha">,
): VaultRevision {
  return {
    authoredAt: "2026-08-01T10:00:00+00:00",
    authorName: "inteligir",
    authorEmail: "vault@inteligir.local",
    subject: "vault: update notes/hello.md",
    path: "notes/hello.md",
    ...overrides,
  };
}

export function makeFixtureState(): FixtureState {
  return {
    dataDir: "/fixture/data",
    failWith: null,
    refuseSend: null,
    vault: new Map(),
    revisions: new Map(),
    searchResults: [],
    tags: [],
    backlinks: [],
    related: [],
    connectors: { servers: [] },
    folders: { folders: [] },
    cloud: { state: "signed-out", cloudUrl: FIXTURE_CLOUD_URL },
    threads: [],
    comments: new Map(),
    guideMarkdown: "# Fixture guide\n\nBe kind to the vault.\n",
    agent: { mode: "auto", runtime: "acp", detail: null },
    vaultStatus: { state: "no-remote", lastSyncAt: null, lastError: null },
    nextCreatedThreadId: "thr_created_1",
  };
}

function deriveTree(vault: Map<string, string>): VaultEntry[] {
  const dirs = new Set<string>();
  for (const path of vault.keys()) {
    const segments = path.split("/");
    for (let depth = 1; depth < segments.length; depth += 1) {
      dirs.add(segments.slice(0, depth).join("/"));
    }
  }
  const dirEntries: VaultEntry[] = [...dirs].toSorted().map((path) => ({ kind: "dir", path }));
  const fileEntries: VaultEntry[] = [...vault.keys()].toSorted().map((path) => ({
    kind: "file",
    path,
  }));
  return [...dirEntries, ...fileEntries];
}

function findThread(state: FixtureState, threadId: string): FixtureThread | undefined {
  return state.threads.find((entry) => entry.thread.id === threadId);
}

function commentsBody(state: FixtureState, path: string) {
  const threads = state.comments.get(path) ?? [];
  return { path, threads, total: threads.length, orphanMarkers: [], strayIds: [] };
}

const base = implement(localContract).$context<FixtureState>();

const agentsRouter = {
  status: base.agents.status.handler(() => ({ harnesses: [], defaultId: "claude" })),
  setDefault: base.agents.setDefault.handler(({ input }) => ({
    harnesses: [],
    defaultId: input.id,
  })),
};

const cloudRouter = {
  status: base.cloud.status.handler(({ context }) => context.cloud),
  login: base.cloud.login.handler(({ context, input }) => {
    context.cloud = {
      state: "signed-in",
      cloudUrl: FIXTURE_CLOUD_URL,
      accountEmail: input.email,
      deviceId: `dev_${input.deviceName ?? "fixture-host"}`,
      connected: false,
      pending: 0,
      cursor: 0,
      lastSyncedAt: null,
      lastError: null,
    };
    return context.cloud;
  }),
  logout: base.cloud.logout.handler(({ context }) => {
    context.cloud = { state: "signed-out", cloudUrl: FIXTURE_CLOUD_URL };
    return context.cloud;
  }),
  syncNow: base.cloud.syncNow.handler(({ context }) => context.cloud),
};

const commentsRouter = {
  list: base.comments.list.handler(({ context, input }) => commentsBody(context, input.path)),
  add: base.comments.add.handler(({ context, input }) => {
    const threads = context.comments.get(input.path) ?? [];
    threads.push({
      anchored: false,
      replies: [],
      resolved: false,
      root: { createdAt: 1, source: input.source ?? "user", text: input.text, updatedAt: 1 },
      rootId: input.id,
    });
    context.comments.set(input.path, threads);
    return commentsBody(context, input.path);
  }),
  reply: base.comments.reply.handler(({ context, input, errors }) => {
    const threads = context.comments.get(input.path) ?? [];
    const thread = threads.find((row) => row.rootId === input.parentId);
    if (thread === undefined) {
      throw errors.NOT_FOUND({ message: `no thread ${input.parentId}` });
    }
    thread.replies.push({
      entry: { createdAt: 2, source: input.source ?? "user", text: input.text, updatedAt: 2 },
      id: input.id,
    });
    return commentsBody(context, input.path);
  }),
  resolve: base.comments.resolve.handler(({ context, input, errors }) => {
    const thread = (context.comments.get(input.path) ?? []).find((row) => row.rootId === input.id);
    if (thread === undefined) {
      throw errors.NOT_FOUND({ message: `no thread ${input.id}` });
    }
    thread.resolved = input.resolved;
    return commentsBody(context, input.path);
  }),
  remove: base.comments.remove.handler(({ context, input, errors }) => {
    const threads = context.comments.get(input.path) ?? [];
    const remaining = threads.filter((row) => row.rootId !== input.id);
    if (remaining.length === threads.length) {
      throw errors.NOT_FOUND({ message: `no thread ${input.id}` });
    }
    context.comments.set(input.path, remaining);
    return { ...commentsBody(context, input.path), removedIds: [input.id] };
  }),
};

const connectorsRouter = {
  list: base.connectors.list.handler(({ context }) => context.connectors),
  add: base.connectors.add.handler(({ context, input, errors }) => {
    if (context.connectors.servers.some((row) => row.name === input.name)) {
      throw errors.ALREADY_EXISTS({ message: `"${input.name}" exists` });
    }
    context.connectors.servers.push({
      enabled: true,
      name: input.name,
      transport:
        input.transport.kind === "stdio"
          ? { args: input.transport.args, command: input.transport.command, kind: "stdio" }
          : input.transport.kind === "oauth"
            ? {
                authorizationEndpoint: input.transport.authorizationEndpoint,
                clientId: input.transport.clientId,
                kind: "oauth",
                scopes: input.transport.scopes,
                status: "needs-auth",
                tokenEndpoint: input.transport.tokenEndpoint,
                url: input.transport.url,
              }
            : {
                hasAuth: Object.keys(input.transport.headers ?? {}).length > 0,
                kind: "http",
                url: input.transport.url,
              },
    });
    return context.connectors;
  }),
  remove: base.connectors.remove.handler(({ context, input, errors }) => {
    const before = context.connectors.servers.length;
    context.connectors.servers = context.connectors.servers.filter(
      (row) => row.name !== input.name,
    );
    if (context.connectors.servers.length === before) {
      throw errors.NOT_FOUND({ message: `no connector ${input.name}` });
    }
    return context.connectors;
  }),
  toggle: base.connectors.toggle.handler(({ context, input, errors }) => {
    const row = context.connectors.servers.find((candidate) => candidate.name === input.name);
    if (row === undefined) {
      throw errors.NOT_FOUND({ message: `no connector ${input.name}` });
    }
    row.enabled = input.enabled;
    return context.connectors;
  }),
  oauthBegin: base.connectors.oauthBegin.handler(({ context, input, errors }) => {
    const row = context.connectors.servers.find((candidate) => candidate.name === input.name);
    if (row === undefined) {
      throw errors.NOT_FOUND({ message: `no connector ${input.name}` });
    }
    return { url: `${FIXTURE_CLOUD_URL}/oauth/${input.name}/authorize`, opened: input.open };
  }),
  oauthDisconnect: base.connectors.oauthDisconnect.handler(({ context, input, errors }) => {
    const row = context.connectors.servers.find((candidate) => candidate.name === input.name);
    if (row === undefined) {
      throw errors.NOT_FOUND({ message: `no connector ${input.name}` });
    }
    return context.connectors;
  }),
};

const foldersRouter = {
  list: base.folders.list.handler(({ context }) => context.folders),
  add: base.folders.add.handler(({ context, input, errors }) => {
    if (context.folders.folders.includes(input.path)) {
      throw errors.ALREADY_EXISTS({ message: `"${input.path}" is connected` });
    }
    context.folders.folders.push(input.path);
    return context.folders;
  }),
  remove: base.folders.remove.handler(({ context, input, errors }) => {
    const before = context.folders.folders.length;
    context.folders.folders = context.folders.folders.filter((row) => row !== input.path);
    if (context.folders.folders.length === before) {
      throw errors.NOT_FOUND({ message: `not connected: ${input.path}` });
    }
    return context.folders;
  }),
};

const knowledgeRouter = {
  search: base.knowledge.search.handler(({ context, input }) => ({
    results: input.q.length === 0 ? [] : context.searchResults,
  })),
  // the real fold over the fixture vault: a stub list would not exercise the rows' shape
  matches: base.knowledge.matches.handler(({ context, input }) =>
    collectVaultMatches(
      [...context.vault].map(([path, body]) => ({ path, title: docStem(path), body })),
      input.q,
      { caseSensitive: input.caseSensitive ?? false, wholeWord: input.wholeWord ?? false },
      input.limit ?? KNOWLEDGE_MATCHES_DEFAULT_LIMIT,
    ),
  ),
  wikiTargets: base.knowledge.wikiTargets.handler(() => ({ targets: [] })),
  backlinks: base.knowledge.backlinks.handler(({ context, input }) => ({
    path: input.path,
    backlinks: context.backlinks,
    total: context.backlinks.length,
  })),
  // the real scan over the fixture vault, excluding what the fixture's backlinks already link
  unlinkedMentions: base.knowledge.unlinkedMentions.handler(({ context, input }) => ({
    path: input.path,
    ...findUnlinkedMentions(
      [...context.vault].map(([path, body]) => ({ path, title: docStem(path), body })),
      {
        names: mentionNames(input.path, []),
        exclude: new Set([input.path, ...context.backlinks.map((entry) => entry.sourcePath)]),
        limit: input.limit ?? KNOWLEDGE_UNLINKED_DEFAULT_LIMIT,
      },
    ),
  })),
  related: base.knowledge.related.handler(({ context, input }) => ({
    path: input.path,
    related: context.related.slice(0, input.limit),
  })),
  tags: base.knowledge.tags.handler(({ context }) => ({
    tags: context.tags,
    total: context.tags.length,
  })),
  renameTag: base.knowledge.renameTag.handler(({ context, input }) => ({
    from: input.from,
    to: input.to,
    rewritten: [...context.vault.keys()].filter((path) => path.startsWith("notes/")),
    skipped: [],
  })),
};

const systemRouter = {
  status: base.system.status.handler(({ context }) => {
    const status: SystemStatusResponse = {
      version: "9.9.9-fixture",
      dataDir: context.dataDir,
      vaultDir: "/fixture/vault",
      schemaVersion: 3,
      uptimeMs: 65_000,
      agent: context.agent,
    };
    return status;
  }),
  guide: base.system.guide.handler(({ context }) => ({ markdown: context.guideMarkdown })),
};

const threadsRouter = {
  list: base.threads.list.handler(({ context }) => ({
    threads: context.threads.map((entry) => entry.thread),
  })),
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
      thread: entry.thread,
      pendingInteractions: entry.pendingInteractions,
      queuedMessages: entry.queuedMessages ?? [],
    };
  }),
  create: base.threads.create.handler(({ context, input }) => {
    const overrides: Partial<Thread> & Pick<Thread, "id"> = {
      id: context.nextCreatedThreadId,
      originDocPath: input.originDocPath ?? null,
    };
    if (input.title !== undefined) {
      overrides.title = input.title;
    }
    const thread = makeThread(overrides);
    context.threads.push({ thread, pendingInteractions: [], timeline: EMPTY_TIMELINE });
    return { thread };
  }),
  archive: base.threads.archive.handler(({ context, input, errors }) => {
    const entry = findThread(context, input.threadId);
    if (entry === undefined) {
      throw errors.NOT_FOUND({ message: "Not found" });
    }
    entry.thread = { ...entry.thread, archivedAt: 1_700_000_001_000 };
    return { thread: entry.thread };
  }),
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
  listInteractions: base.threads.listInteractions.handler(({ context, input }) => ({
    interactions: context.threads
      .filter((entry) => input.threadId === undefined || entry.thread.id === input.threadId)
      .flatMap((entry) => entry.pendingInteractions),
  })),
  answerInteraction: base.threads.answerInteraction.handler(({ context, input, errors }) => {
    const entry = findThread(context, input.threadId);
    const interaction = entry?.pendingInteractions.find((row) => row.id === input.interactionId);
    if (entry === undefined || interaction === undefined) {
      throw errors.NOT_FOUND({ message: "Interaction not found" });
    }
    const resolved: PendingInteraction = {
      ...interaction,
      status: "resolved",
      resolution: input.resolution,
      resolvedAt: 1_700_000_002_000,
    };
    entry.pendingInteractions = entry.pendingInteractions.map((row) =>
      row.id === resolved.id ? resolved : row,
    );
    return { interaction: resolved };
  }),
};

const vaultRouter = {
  tree: base.vault.tree.handler(({ context }) => ({
    root: "/fixture/vault",
    name: "vault",
    entries: deriveTree(context.vault),
  })),
  read: base.vault.read.handler(({ context, input, errors }) => {
    const content = context.vault.get(input.path);
    if (content === undefined) {
      throw errors.NOT_FOUND({ message: `No file at ${input.path}` });
    }
    return { path: input.path, content };
  }),
  history: base.vault.history.handler(({ context, input }) => ({
    revisions: (context.revisions.get(input.path) ?? []).map((row) => row.revision),
  })),
  revision: base.vault.revision.handler(({ context, input, errors }) => {
    const row = (context.revisions.get(input.path) ?? []).find(
      ({ revision }) => revision.sha === input.sha,
    );
    if (row === undefined) {
      throw errors.NOT_FOUND({ message: `${input.path} does not exist at ${input.sha}` });
    }
    return { content: row.content };
  }),
  commitNow: base.vault.commitNow.handler(() => ({ files: 0 })),
  write: base.vault.write.handler(({ context, input, errors }) => {
    if (input.ifAbsent === true && context.vault.has(input.path)) {
      throw errors.ALREADY_EXISTS({ message: `A file already exists at ${input.path}` });
    }
    context.vault.set(input.path, input.content);
    return { path: input.path };
  }),
  assetWrite: base.vault.assetWrite.handler(({ input }) => ({
    path: `${input.dir}/${input.baseName}`,
  })),
  rename: base.vault.rename.handler(({ context, input, errors }) => {
    const content = context.vault.get(input.from);
    if (content === undefined) {
      throw errors.NOT_FOUND({ message: `No file at ${input.from}` });
    }
    context.vault.delete(input.from);
    context.vault.set(input.to, content);
    return { path: input.to, rewritten: [], skipped: [] };
  }),
  mkdir: base.vault.mkdir.handler(({ input }) => ({ path: input.path })),
  // a path with revisions and no bytes on disk: the fixture's "deleted".
  deleted: base.vault.deleted.handler(({ context }) => ({
    entries: [...context.revisions]
      .filter(([path]) => !context.vault.has(path))
      .flatMap(([path, rows]) => {
        const newest = rows[0];
        return newest === undefined
          ? []
          : [{ path, deletedAt: newest.revision.authoredAt, sha: newest.revision.sha }];
      }),
  })),
  remove: base.vault.remove.handler(({ context, input, errors }) => {
    if (!context.vault.delete(input.path)) {
      throw errors.NOT_FOUND({ message: `No file at ${input.path}` });
    }
    return { ok: true } as const;
  }),
  status: base.vault.status.handler(({ context }) => context.vaultStatus),
  syncNow: base.vault.syncNow.handler(({ context }) => context.vaultStatus),
};

const voiceRouter = {
  status: base.voice.status.handler(() => ({
    state: "unavailable",
    detail: "the fixture server does not dictate",
  })),
  install: base.voice.install.handler(() => ({
    state: "unavailable",
    detail: "the fixture server does not dictate",
  })),
  remove: base.voice.remove.handler(() => ({
    state: "unavailable",
    detail: "the fixture server does not dictate",
  })),
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
    agents: agentsRouter,
    cloud: cloudRouter,
    comments: commentsRouter,
    connectors: connectorsRouter,
    folders: foldersRouter,
    knowledge: knowledgeRouter,
    system: systemRouter,
    threads: threadsRouter,
    vault: vaultRouter,
    voice: voiceRouter,
  });

export interface FixtureServer {
  baseUrl: string;
  close(): Promise<void>;
}

export async function serveFixture(state: FixtureState): Promise<FixtureServer> {
  const handler = new RPCHandler(fixtureRouter);
  const server = createServer((request, response) => {
    if (request.headers.authorization !== `Bearer ${FIXTURE_SERVER_TOKEN}`) {
      response.writeHead(401, { "content-type": "text/plain" });
      response.end("This request carried no valid inteligir device token");
      return;
    }
    void (async () => {
      const { matched } = await handler.handle(request, response, {
        prefix: RPC_PREFIX,
        context: state,
      });
      if (!matched) {
        response.writeHead(404, { "content-type": "text/plain" });
        response.end("Not found");
      }
    })();
  });
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const { port } = boundAddressSchema.parse(server.address());
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      }),
  };
}
