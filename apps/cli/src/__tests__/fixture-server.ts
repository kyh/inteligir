import { createServer } from "node:http";
import { implement, ORPCError } from "@orpc/server";
import { RPCHandler } from "@orpc/server/node";
import { localContract } from "@repo/api/local";
import type { CloudStatusResponse } from "@repo/api/local/cloud/cloud-schema";
import type { CommentThreadWire } from "@repo/api/local/comments/comments-schema";
import type {
  ConnectorsResponse,
  ConnectorTransportInput,
  ConnectorTransportView,
} from "@repo/api/local/connectors/connectors-schema";
import type { ConnectedFoldersResponse } from "@repo/api/local/folders/folders-schema";
import {
  KNOWLEDGE_MATCHES_DEFAULT_LIMIT,
  KNOWLEDGE_PROBLEMS_DEFAULT_LIMIT,
  KNOWLEDGE_UNLINKED_DEFAULT_LIMIT,
  KNOWLEDGE_TAG_NOTES_DEFAULT_LIMIT,
} from "@repo/api/local/knowledge/knowledge-schema";
import type {
  BacklinkEntryWire,
  RelatedNoteWire,
  SearchResultWire,
  TagCountWire,
} from "@repo/api/local/knowledge/knowledge-schema";
import { docStem, isDocPath } from "@repo/notes/knowledge/doc-file";
import { collectVaultMatches } from "@repo/notes/knowledge/text-matches";
import { findUnlinkedMentions, mentionNames } from "@repo/notes/knowledge/unlinked-mentions";
import { KnowledgeIndex } from "@repo/notes/knowledge/knowledge-index";
import { RPC_PREFIX } from "@repo/api/local/routes";
import type { AgentStatus, SystemStatusResponse } from "@repo/api/local/system/system-schema";
import type { ThreadTimeline } from "@repo/api/local/thread-timeline";
import type {
  PendingInteraction,
  QueuedThreadMessage,
  Thread,
} from "@repo/api/local/threads/threads-schema";
import { DEFAULT_ATTACHMENT_LOCATION } from "@repo/api/local/vault/vault-schema";
import type {
  VaultEntry,
  VaultPrefsResponse,
  VaultRevision,
  VaultStatusResponse,
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
  vaultPrefs: VaultPrefsResponse;
  nextCreatedThreadId: string;
}

export const EMPTY_TIMELINE: ThreadTimeline = { maxSequence: 0, rows: [], tokenUsage: null };

export const makeThread = (overrides: Partial<Thread> & Pick<Thread, "id">): Thread => ({
  activeTurnId: null,
  archivedAt: null,
  createdAt: 1_700_000_000_000,
  originDocPath: null,
  providerId: null,
  status: "idle",
  title: null,
  updatedAt: 1_700_000_000_000,
  ...overrides,
});

export const FIXTURE_REVISION_SHA = "0f1e2d3c4b5a69788796a5b4c3d2e1f00f1e2d3c";

export const makeRevision = (
  overrides: Partial<VaultRevision> & Pick<VaultRevision, "sha">,
): VaultRevision => ({
  authorEmail: "vault@inteligir.local",
  authorName: "inteligir",
  authoredAt: "2026-08-01T10:00:00+00:00",
  path: "notes/hello.md",
  subject: "vault: update notes/hello.md",
  ...overrides,
});

export const makeFixtureState = (): FixtureState => ({
  agent: { detail: null, mode: "auto", runtime: "acp" },
  backlinks: [],
  cloud: { cloudUrl: FIXTURE_CLOUD_URL, state: "signed-out" },
  comments: new Map(),
  connectors: { servers: [] },
  dataDir: "/fixture/data",
  failWith: null,
  folders: { folders: [] },
  guideMarkdown: "# Fixture guide\n\nBe kind to the vault.\n",
  nextCreatedThreadId: "thr_created_1",
  refuseSend: null,
  related: [],
  revisions: new Map(),
  searchResults: [],
  tags: [],
  threads: [],
  vault: new Map(),
  vaultPrefs: { attachments: DEFAULT_ATTACHMENT_LOCATION },
  vaultStatus: { lastError: null, lastSyncAt: null, state: "no-remote" },
});

const deriveTree = (vault: Map<string, string>): VaultEntry[] => {
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
};

const findThread = (state: FixtureState, threadId: string): FixtureThread | undefined =>
  state.threads.find((entry) => entry.thread.id === threadId);

const commentsBody = (state: FixtureState, path: string) => {
  const threads = state.comments.get(path) ?? [];
  return { orphanMarkers: [], path, strayIds: [], threads, total: threads.length };
};

const base = implement(localContract).$context<FixtureState>();

const agentsRouter = {
  setDefault: base.agents.setDefault.handler(({ input }) => ({
    defaultId: input.id,
    harnesses: [],
  })),
  status: base.agents.status.handler(() => ({ defaultId: "claude", harnesses: [] })),
};

const cloudRouter = {
  login: base.cloud.login.handler(({ context, input }) => {
    context.cloud = {
      accountEmail: input.email,
      cloudUrl: FIXTURE_CLOUD_URL,
      connected: false,
      cursor: 0,
      deviceId: `dev_${input.deviceName ?? "fixture-host"}`,
      lastError: null,
      lastSyncedAt: null,
      pending: 0,
      state: "signed-in",
    };
    return context.cloud;
  }),
  logout: base.cloud.logout.handler(({ context }) => {
    context.cloud = { cloudUrl: FIXTURE_CLOUD_URL, state: "signed-out" };
    return context.cloud;
  }),
  status: base.cloud.status.handler(({ context }) => context.cloud),
  syncNow: base.cloud.syncNow.handler(({ context }) => context.cloud),
};

const commentsRouter = {
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
  list: base.comments.list.handler(({ context, input }) => commentsBody(context, input.path)),
  remove: base.comments.remove.handler(({ context, input, errors }) => {
    const threads = context.comments.get(input.path) ?? [];
    const remaining = threads.filter((row) => row.rootId !== input.id);
    if (remaining.length === threads.length) {
      throw errors.NOT_FOUND({ message: `no thread ${input.id}` });
    }
    context.comments.set(input.path, remaining);
    return { ...commentsBody(context, input.path), removedIds: [input.id] };
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
};

const storedTransport = (transport: ConnectorTransportInput): ConnectorTransportView => {
  if (transport.kind === "stdio") {
    return { args: transport.args, command: transport.command, kind: "stdio" };
  }
  if (transport.kind === "oauth") {
    return {
      authorizationEndpoint: transport.authorizationEndpoint,
      clientId: transport.clientId,
      kind: "oauth",
      scopes: transport.scopes,
      status: "needs-auth",
      tokenEndpoint: transport.tokenEndpoint,
      url: transport.url,
    };
  }
  return {
    hasAuth: Object.keys(transport.headers ?? {}).length > 0,
    kind: "http",
    url: transport.url,
  };
};

const connectorsRouter = {
  add: base.connectors.add.handler(({ context, input, errors }) => {
    if (context.connectors.servers.some((row) => row.name === input.name)) {
      throw errors.ALREADY_EXISTS({ message: `"${input.name}" exists` });
    }
    context.connectors.servers.push({
      enabled: true,
      name: input.name,
      transport: storedTransport(input.transport),
    });
    return context.connectors;
  }),
  list: base.connectors.list.handler(({ context }) => context.connectors),
  oauthBegin: base.connectors.oauthBegin.handler(({ context, input, errors }) => {
    const row = context.connectors.servers.find((candidate) => candidate.name === input.name);
    if (row === undefined) {
      throw errors.NOT_FOUND({ message: `no connector ${input.name}` });
    }
    return { opened: input.open, url: `${FIXTURE_CLOUD_URL}/oauth/${input.name}/authorize` };
  }),
  oauthDisconnect: base.connectors.oauthDisconnect.handler(({ context, input, errors }) => {
    const row = context.connectors.servers.find((candidate) => candidate.name === input.name);
    if (row === undefined) {
      throw errors.NOT_FOUND({ message: `no connector ${input.name}` });
    }
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
};

const foldersRouter = {
  add: base.folders.add.handler(({ context, input, errors }) => {
    if (context.folders.folders.includes(input.path)) {
      throw errors.ALREADY_EXISTS({ message: `"${input.path}" is connected` });
    }
    context.folders.folders.push(input.path);
    return context.folders;
  }),
  list: base.folders.list.handler(({ context }) => context.folders),
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
  backlinks: base.knowledge.backlinks.handler(({ context, input }) => ({
    backlinks: context.backlinks,
    path: input.path,
    total: context.backlinks.length,
  })),
  // the real fold over the fixture vault: a stub list would not exercise the rows' shape
  matches: base.knowledge.matches.handler(({ context, input }) =>
    collectVaultMatches(
      [...context.vault].map(([path, body]) => ({ body, path, title: docStem(path) })),
      input.q,
      { caseSensitive: input.caseSensitive ?? false, wholeWord: input.wholeWord ?? false },
      input.limit ?? KNOWLEDGE_MATCHES_DEFAULT_LIMIT,
    ),
  ),
  // the real collector over an in-memory index of the fixture vault, so a leaf sees real rows
  problems: base.knowledge.problems.handler(({ context, input }) => {
    const index = new KnowledgeIndex();
    for (const [path, body] of context.vault) {
      if (isDocPath(path)) {
        index.setDoc(path, body);
      } else {
        index.setOther(path);
      }
    }
    return index.problems({
      includeConventionFolders: input.includeConventionFolders ?? false,
      limit: input.limit ?? KNOWLEDGE_PROBLEMS_DEFAULT_LIMIT,
    });
  }),
  related: base.knowledge.related.handler(({ context, input }) => ({
    path: input.path,
    related: context.related.slice(0, input.limit),
  })),
  renameTag: base.knowledge.renameTag.handler(({ context, input }) => ({
    from: input.from,
    rewritten: [...context.vault.keys()].filter((path) => path.startsWith("notes/")),
    skipped: [],
    to: input.to,
  })),
  search: base.knowledge.search.handler(({ context, input }) => ({
    results: input.q.length === 0 ? [] : context.searchResults,
  })),
  // the fixture vault's own bytes, the family by prefix: a tag is `[\w/-]`, so anything else ends it
  tagNotes: base.knowledge.tagNotes.handler(({ context, input }) => {
    const family = new RegExp(`(^|\\s)#${input.tag}(?:/[\\w-]+)*(?![\\w/-])`, "iu");
    const all = [...context.vault.entries()]
      .filter(([, content]) => family.test(content))
      .map(([path]) => path)
      .toSorted();
    const offset = input.offset ?? 0;
    return {
      paths: all.slice(offset, offset + (input.limit ?? KNOWLEDGE_TAG_NOTES_DEFAULT_LIMIT)),
      tag: input.tag,
      total: all.length,
    };
  }),
  tags: base.knowledge.tags.handler(({ context }) => ({
    tags: context.tags,
    total: context.tags.length,
  })),
  // the real scan over the fixture vault, excluding what the fixture's backlinks already link
  unlinkedMentions: base.knowledge.unlinkedMentions.handler(({ context, input }) => ({
    path: input.path,
    ...findUnlinkedMentions(
      [...context.vault].map(([path, body]) => ({ body, path, title: docStem(path) })),
      {
        exclude: new Set([input.path, ...context.backlinks.map((entry) => entry.sourcePath)]),
        limit: input.limit ?? KNOWLEDGE_UNLINKED_DEFAULT_LIMIT,
        names: mentionNames(input.path, []),
      },
    ),
  })),
  wikiTargets: base.knowledge.wikiTargets.handler(() => ({ targets: [] })),
};

const systemRouter = {
  guide: base.system.guide.handler(({ context }) => ({ markdown: context.guideMarkdown })),
  status: base.system.status.handler(({ context }) => {
    const status: SystemStatusResponse = {
      agent: context.agent,
      dataDir: context.dataDir,
      dataDirScope: "root",
      schemaVersion: 3,
      uptimeMs: 65_000,
      vaultDir: "/fixture/vault",
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
    const overrides: Partial<Thread> & Pick<Thread, "id"> = {
      id: context.nextCreatedThreadId,
      originDocPath: input.originDocPath ?? null,
    };
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
  list: base.threads.list.handler(({ context }) => ({
    threads: context.threads.map((entry) => entry.thread),
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

const vaultRouter = {
  assetWrite: base.vault.assetWrite.handler(({ input }) => ({
    path: `${input.dir}/${input.baseName}`,
  })),
  commitNow: base.vault.commitNow.handler(() => ({ files: 0 })),
  // a path with revisions and no bytes on disk: the fixture's "deleted".
  deleted: base.vault.deleted.handler(({ context }) => ({
    entries: [...context.revisions]
      .filter(([path]) => !context.vault.has(path))
      .flatMap(([path, rows]) => {
        const [newest] = rows;
        return newest === undefined
          ? []
          : [{ deletedAt: newest.revision.authoredAt, path, sha: newest.revision.sha }];
      }),
  })),
  history: base.vault.history.handler(({ context, input }) => ({
    revisions: (context.revisions.get(input.path) ?? []).map((row) => row.revision),
  })),
  mkdir: base.vault.mkdir.handler(({ input }) => ({ path: input.path })),
  prefs: base.vault.prefs.handler(({ context }) => context.vaultPrefs),
  read: base.vault.read.handler(({ context, input, errors }) => {
    const content = context.vault.get(input.path);
    if (content === undefined) {
      throw errors.NOT_FOUND({ message: `No file at ${input.path}` });
    }
    return { content, path: input.path };
  }),
  remove: base.vault.remove.handler(({ context, input, errors }) => {
    if (!context.vault.delete(input.path)) {
      throw errors.NOT_FOUND({ message: `No file at ${input.path}` });
    }
    return { ok: true } as const;
  }),
  rename: base.vault.rename.handler(({ context, input, errors }) => {
    const content = context.vault.get(input.from);
    if (content === undefined) {
      throw errors.NOT_FOUND({ message: `No file at ${input.from}` });
    }
    context.vault.delete(input.from);
    context.vault.set(input.to, content);
    return { path: input.to, rewritten: [], skipped: [] };
  }),
  revision: base.vault.revision.handler(({ context, input, errors }) => {
    const row = (context.revisions.get(input.path) ?? []).find(
      ({ revision }) => revision.sha === input.sha,
    );
    if (row === undefined) {
      throw errors.NOT_FOUND({ message: `${input.path} does not exist at ${input.sha}` });
    }
    return { content: row.content };
  }),
  setPrefs: base.vault.setPrefs.handler(({ context, input }) => {
    context.vaultPrefs = { attachments: input.attachments };
    return context.vaultPrefs;
  }),
  status: base.vault.status.handler(({ context }) => context.vaultStatus),
  syncNow: base.vault.syncNow.handler(({ context }) => context.vaultStatus),
  tree: base.vault.tree.handler(({ context }) => ({
    entries: deriveTree(context.vault),
    name: "vault",
    root: "/fixture/vault",
  })),
  write: base.vault.write.handler(({ context, input, errors }) => {
    if (input.ifAbsent === true && context.vault.has(input.path)) {
      throw errors.ALREADY_EXISTS({ message: `A file already exists at ${input.path}` });
    }
    context.vault.set(input.path, input.content);
    return { path: input.path };
  }),
};

const voiceRouter = {
  install: base.voice.install.handler(() => ({
    detail: "the fixture server does not dictate",
    state: "unavailable",
  })),
  remove: base.voice.remove.handler(() => ({
    detail: "the fixture server does not dictate",
    state: "unavailable",
  })),
  status: base.voice.status.handler(() => ({
    detail: "the fixture server does not dictate",
    state: "unavailable",
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
